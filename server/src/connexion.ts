// Routes de la session : état (/api/session), changement d'espace (/api/mode), connexion par compte
// local (/api/login), mot de passe (/api/motdepasse), déconnexion (/api/logout) et liste des comptes
// pour l'administrateur RH (/api/comptes). Connexion Microsoft 365 : routes de server/src/microsoft.ts,
// montées ici ; la déconnexion d'une session Microsoft renvoie aussi l'adresse de déconnexion Microsoft.
// En démonstration, la connexion reste libre (choix d'un compte, mot de passe quelconque) mais passe
// par les mêmes comptes que la production.
import express, { type Request, type Response, type Router } from 'express';
import { aDroitRh, BLOCAGE_MINUTES, ECHECS_MAX, ESPACE_LABEL, PROFILS_RH } from '../../shared/constants.ts';
import { controleMotDePasse, normaliserIdentifiant } from '../../shared/rules/comptes.ts';
import type { CurrentUser, Role } from '../../shared/types.ts';
import {
  clearSessionCookie, DEMO, LimiteParIp, openSession, readSession, revokeSession, revokeSessionsDuCompte, ROLES, updateSession, type SessionInfo,
} from './auth.ts';
import {
  compteBloque, compteParIdentifiant, compterTentative, compteSession, comptesVue, compteValide, enregistrerConnexion, espacesDuCompte,
  hacherMotDePasse, journaliser, nomDuCompte, refusDuCompte, tentativeAdmise, verifierMotDePasse, type Compte,
} from './comptes.ts';
import { currentUser } from './dataset.ts';
import type { Db } from './db.ts';
import { emailMode } from './integrations/email.ts';
import { KEYSTONE_MODE } from './integrations/keystone.ts';
import { sageMode } from './integrations/sage.ts';
import { OIDC, routesMicrosoft } from './microsoft.ts';

export interface Identite { session: SessionInfo; compte: Compte; user: CurrentUser }

/**
 * Personne authentifiée par la requête : session valide, compte en mesure de se connecter, espace
 * ouvert au compte et, pour une connexion par mot de passe, mot de passe provisoire déjà remplacé.
 */
export function identite(db: Db, req: Request): Identite | null {
  const session = readSession(db, req);
  const compte = compteValide(db, session?.compteId);
  if (!session || !compte || (session.methode === 'local' && compte.changerMotDePasse)) return null;
  const user = currentUser(db, session);
  return user ? { session, compte, user } : null;
}

/** En-tête par lequel l'onglet indique l'espace qu'il affiche (client/src/api.ts). */
export const EN_TETE_ESPACE = 'x-cursus-espace';
export const ESPACE_CHANGE = 'Espace changé dans un autre onglet : rien n’a été enregistré. L’écran passe à l’espace actif ; recommencez si besoin.';

/**
 * Tous les onglets partagent la session, donc l'espace actif : il a pu changer dans un autre onglet.
 * Une action ou une lecture faite pour un autre espace que celui de la session est refusée (409) ; le
 * client relit alors la session, sans rejouer l'action. Sans en-tête (autre client), pas de contrôle.
 */
export function espaceChange(req: Request, res: Response, id: Identite): boolean {
  const espace = req.get(EN_TETE_ESPACE);
  if (!espace || espace === id.session.role) return false;
  res.status(409).json({ error: ESPACE_CHANGE });
  return true;
}

/** Réponse générique d'un échec de connexion : ne dit pas si l'identifiant existe. */
export const ECHEC_CONNEXION = `Identifiant ou mot de passe incorrect. Après ${ECHECS_MAX} échecs, le compte est bloqué ${BLOCAGE_MINUTES} minutes.`;
const TROP_DE_TENTATIVES = 'Trop de tentatives de connexion depuis ce poste : réessayez dans quelques minutes.';

export function routesConnexion(db: Db): Router {
  const r = express.Router();
  r.use(routesMicrosoft(db));
  const limite = new LimiteParIp();
  const ip = (req: Request) => req.ip ?? req.socket.remoteAddress ?? '';
  /** Refus 429 d'une adresse qui a dépassé ses échecs : Retry-After jusqu'à la fin de sa fenêtre. */
  const tropDeTentatives = (res: Response, adresse: string) =>
    res.status(429).set('Retry-After', String(limite.attente(adresse))).json({ error: TROP_DE_TENTATIVES });
  /** Connexion, déconnexion, changement d'espace ou refus d'accès, signé du compte (rien sans compte). */
  const tracer = (c: Compte | null | undefined, action: string, message: string, role: Role | null, req: Request, extra: Record<string, unknown> = {}) => {
    if (c) journaliser(db, { actor: nomDuCompte(db, c), role, action, message, payload: { ip: ip(req), ...extra }, compte: c });
  };
  const compteDe = (s: SessionInfo | null) => (s?.compteId ? db.get<Compte>('comptes', s.compteId) : undefined);

  /** Comptes proposés sur l'écran de connexion de démonstration, par espace. */
  function loginOptions() {
    const out: Record<Role, { id: number; nom: string }[]> = { rh: [], manager: [], collaborateur: [] };
    for (const c of db.all<Compte>('comptes')) {
      if (refusDuCompte(db, c)) continue;
      const nom = nomDuCompte(db, c), espaces = espacesDuCompte(db, c);
      if (espaces.includes('rh')) out.rh.push({ id: c.id, nom: `${nom} — ${PROFILS_RH[c.profilRh].label}` });
      if (espaces.includes('manager')) {
        const equipes = db.where<{ nom: string }>('equipes', 'managerId', c.empId).map(q => q.nom);
        out.manager.push({ id: c.id, nom: `${nom} — ${equipes.join(', ')}` });
      }
      if (espaces.includes('collaborateur')) out.collaborateur.push({ id: c.id, nom });
    }
    for (const l of Object.values(out)) l.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    return out;
  }

  function payload(s: SessionInfo | null) {
    const c = compteValide(db, s?.compteId);
    const enAttente = !!c && s?.methode === 'local' && c.changerMotDePasse;
    return {
      demo: DEMO, role: s?.role ?? 'rh', user: s && c && !enAttente ? currentUser(db, s) : null, compte: c ? compteSession(db, c) : null, methode: s?.methode ?? null,
      // Bouton « Se connecter avec Microsoft » : seulement si la connexion Microsoft 365 est configurée.
      microsoft: !!OIDC,
      // La liste des comptes (annuaire, organigramme) n'est exposée qu'en démonstration.
      loginOptions: DEMO ? loginOptions() : null, integrations: { keystone: KEYSTONE_MODE, sage: sageMode(), email: emailMode() },
    };
  }

  /** Démonstration : compte RH ouvert d'office (le premier administrateur RH en mesure de se connecter). */
  const rhDemo = () => db.where<Compte>('comptes', 'profilRh', 'rh_admin').find(c => !refusDuCompte(db, c))?.id ?? null;

  /**
   * Démonstration : compte ouvert pour un espace — le compte en cours s'il y a accès, sinon le dernier
   * compte choisi pour cet espace, ou le compte RH de démonstration ; null : l'écran de connexion propose les comptes.
   */
  function compteDemo(cur: SessionInfo | null, role: Role): number | null {
    const ok = (id: number | null | undefined) => { const c = compteValide(db, id); return c && espacesDuCompte(db, c).includes(role) ? c.id : null; };
    return ok(cur?.compteId) ?? ok(cur?.demoComptes?.[role]) ?? (role === 'rh' ? rhDemo() : null);
  }

  /** Session de démonstration dans l'espace `role` : mise à jour, ou ouverte si la requête n'en porte pas. */
  function sessionDemo(res: Response, cur: SessionInfo | null, role: Role): SessionInfo {
    const compteId = compteDemo(cur, role);
    const demoComptes = { ...cur?.demoComptes, ...(compteId ? { [role]: compteId } : {}) };
    const s: SessionInfo = { ...cur, compteId, role, methode: 'demo', demoComptes };
    return cur ? updateSession(db, s) : openSession(db, res, s);
  }

  r.get('/api/session', (req, res) => {
    let s = readSession(db, req);
    // En démonstration, l'espace RH s'ouvre directement à la première visite.
    if (!s && DEMO) {
      s = sessionDemo(res, null, 'rh');
      tracer(compteDe(s), 'connexion', 'Connexion (démonstration) — espace RH ouvert à la première visite', 'rh', req, { methode: 'demo' });
    }
    res.json(payload(s));
  });

  /** Changement d'espace : seulement vers un espace du compte connecté (démonstration : connexion libre). */
  r.post('/api/mode', (req, res) => {
    const role = req.body?.role as Role;
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Espace inconnu' });
    const cur = readSession(db, req);
    const change = (s: SessionInfo) => {
      if (cur?.role !== s.role) tracer(compteDe(s), 'espace.change', `Espace ${cur ? `${ESPACE_LABEL[cur.role]} → ` : ''}${ESPACE_LABEL[s.role]}`, s.role, req, { de: cur?.role ?? null, vers: s.role });
      return s;
    };
    if (DEMO) return res.json(payload(change(sessionDemo(res, cur, role))));
    const id = identite(db, req);
    if (!cur || !id) return res.status(401).json({ error: 'Connexion requise' });
    if (!espacesDuCompte(db, id.compte).includes(role)) {
      tracer(id.compte, 'acces.refuse', `Changement d’espace — l’espace ${ESPACE_LABEL[role]} n’est pas ouvert à ce compte`, cur.role, req, { vers: role });
      return res.status(403).json({ error: 'Cet espace n’est pas ouvert à votre compte' });
    }
    res.json(payload(change(updateSession(db, { ...cur, role }))));
  });

  r.post('/api/login', async (req, res) => {
    const b = req.body ?? {};
    const cur = readSession(db, req);
    // Démonstration : choix d'un compte de l'espace, mot de passe quelconque (aucun pour l'espace RH).
    if (DEMO && b.compteId !== undefined) {
      const role = b.role as Role;
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'Espace inconnu' });
      const c = db.get<Compte>('comptes', Number(b.compteId));
      if (!c || !espacesDuCompte(db, c).includes(role)) return res.status(400).json({ error: 'Compte inconnu pour cet espace' });
      const refus = refusDuCompte(db, c);
      if (refus) return res.status(403).json({ error: refus });
      if (role !== 'rh' && !String(b.password ?? '').trim()) return res.status(400).json({ error: 'Mot de passe requis' });
      // Chaque connexion ouvre une nouvelle session (nouvel identifiant, 12 h) et révoque la précédente.
      if (cur?.id) revokeSession(db, cur.id);
      enregistrerConnexion(db, c);
      const s = openSession(db, res, { compteId: c.id, role, methode: 'demo', demoComptes: { ...cur?.demoComptes, [role]: c.id } });
      tracer(c, 'connexion', `Connexion (démonstration) — espace ${ESPACE_LABEL[role]}`, role, req, { methode: 'demo' });
      return res.json(payload(s));
    }

    // Compte local : identifiant et mot de passe. La tentative est comptée dès son arrivée, pour l'adresse
    // comme pour le compte, avant le calcul du mot de passe qui rend la main : une rafale de requêtes
    // simultanées ne passe ni la limite de l'adresse ni le blocage du compte (comptes.ts).
    const adresse = ip(req);
    if (limite.depasse(adresse)) return tropDeTentatives(res, adresse);
    const identifiant = normaliserIdentifiant(typeof b.identifiant === 'string' ? b.identifiant : '');
    const mdp = typeof b.motDePasse === 'string' ? b.motDePasse : '';
    if (!identifiant || !mdp) return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
    limite.echec(adresse);
    const trouve = compteParIdentifiant(db, identifiant);
    const local = trouve?.type === 'local' ? trouve : null;
    const tentative = local && !compteBloque(local) ? compterTentative(db, local) : null;
    // Le calcul a lieu même sans compte ou compte bloqué : même temps de réponse dans tous les cas.
    const ok = await verifierMotDePasse(mdp, tentative ? local!.motDePasse : null);
    const c = local ? db.get<Compte>('comptes', local.id) ?? null : null; // relu après l'attente
    const trace = (action: string, message: string, role: Role | null = null) => journaliser(db, {
      // Identifiant inconnu : il n'est pas recopié (ce peut être un mot de passe saisi dans le mauvais champ).
      actor: c ? nomDuCompte(db, c) : trouve ? nomDuCompte(db, trouve) : 'Identifiant inconnu', role, action, message,
      payload: { ip: adresse }, compte: c ?? trouve ?? null,
    });
    if (!ok || !c || !tentative) {
      if (!trouve) trace('connexion.refusee', 'Identifiant inconnu');
      else if (!local) trace('connexion.refusee', 'Compte Microsoft 365 : pas de connexion par mot de passe');
      else if (!tentative) trace('connexion.refusee', `Compte bloqué jusqu’à ${heure(local.blocageFin!)}`);
      else trace('connexion.refusee', tentative.bloque ? `Mot de passe incorrect — compte bloqué ${BLOCAGE_MINUTES} minutes après ${ECHECS_MAX} échecs` : `Mot de passe incorrect (échec ${tentative.echecs} sur ${ECHECS_MAX})`);
      return res.status(401).json({ error: ECHEC_CONNEXION });
    }
    // Mot de passe exact, mais compte bloqué pendant le calcul par une tentative simultanée : même refus.
    if (!tentativeAdmise(c, tentative)) {
      trace('connexion.refusee', `Compte bloqué jusqu’à ${heure(c.blocageFin!)}`);
      return res.status(401).json({ error: ECHEC_CONNEXION });
    }
    // Mot de passe exact : le compte doit encore pouvoir se connecter (actif, salarié présent).
    const refus = refusDuCompte(db, c);
    if (refus) {
      revokeSessionsDuCompte(db, c.id);
      trace('connexion.refusee', refus);
      return res.status(403).json({ error: refus });
    }
    limite.rendre(adresse);
    if (cur?.id) revokeSession(db, cur.id);
    enregistrerConnexion(db, c);
    const role = espacesDuCompte(db, c)[0];
    trace('connexion', c.changerMotDePasse ? 'Connexion — mot de passe provisoire à remplacer' : 'Connexion', role);
    res.json(payload(openSession(db, res, { compteId: c.id, role, methode: 'local', demoComptes: {} })));
  });

  /** Changement du mot de passe d'un compte local (obligatoire après un mot de passe provisoire). */
  r.post('/api/motdepasse', async (req, res) => {
    const s = readSession(db, req);
    const c = compteValide(db, s?.compteId);
    if (!s || !c) return res.status(401).json({ error: 'Connexion requise' });
    if (c.type !== 'local') return res.status(400).json({ error: 'Compte Microsoft 365 : le mot de passe se gère chez Microsoft' });
    const adresse = ip(req);
    if (limite.depasse(adresse)) return tropDeTentatives(res, adresse);
    const actuel = typeof req.body?.actuel === 'string' ? req.body.actuel : '';
    const nouveau = typeof req.body?.nouveau === 'string' ? req.body.nouveau : '';
    const err = controleMotDePasse(nouveau, c.identifiant);
    if (err) return res.status(400).json({ error: err });
    if (actuel === nouveau) return res.status(400).json({ error: 'Choisissez un mot de passe différent de l’actuel' });
    const bloque = (x: Compte) => res.status(403).json({ error: `Compte bloqué jusqu’à ${heure(x.blocageFin!)} après des échecs répétés` });
    if (compteBloque(c)) return bloque(c);
    // Tentative comptée avant le calcul, comme à la connexion.
    limite.echec(adresse);
    const tentative = compterTentative(db, c);
    const ok = await verifierMotDePasse(actuel, c.motDePasse);
    const apres = db.get<Compte>('comptes', c.id) ?? c;
    const trace = (action: string, message: string) => journaliser(db, { actor: nomDuCompte(db, apres), role: s.role, action, message, payload: { ip: adresse }, compte: apres });
    if (!ok) {
      trace('motdepasse.refuse', tentative.bloque ? `Mot de passe actuel incorrect — compte bloqué ${BLOCAGE_MINUTES} minutes` : 'Mot de passe actuel incorrect');
      return res.status(400).json({ error: tentative.bloque ? `Mot de passe actuel incorrect : compte bloqué ${BLOCAGE_MINUTES} minutes` : 'Mot de passe actuel incorrect' });
    }
    if (!tentativeAdmise(apres, tentative)) return bloque(apres);
    limite.rendre(adresse);
    db.update<Compte>('comptes', c.id, { motDePasse: hacherMotDePasse(nouveau), changerMotDePasse: false, echecs: 0, blocageFin: null });
    // Les autres sessions du compte sont fermées : seule celle qui a changé le mot de passe reste ouverte.
    const n = revokeSessionsDuCompte(db, c.id, s.id);
    trace('motdepasse.change', `Mot de passe changé${n ? ` — ${n} autre${n > 1 ? 's' : ''} session${n > 1 ? 's' : ''} fermée${n > 1 ? 's' : ''}` : ''}`);
    res.json(payload(readSession(db, req)));
  });

  r.post('/api/logout', async (req, res) => {
    const s = readSession(db, req);
    if (!s) { clearSessionCookie(res); return res.json(payload(null)); }
    revokeSession(db, s.id!);
    tracer(compteDe(s), 'deconnexion', 'Déconnexion', s.role, req, { methode: s.methode });
    // Session Microsoft : le navigateur passe ensuite par la déconnexion Microsoft, qui revient sur Cursus.
    if (s.methode === 'microsoft' && OIDC) {
      clearSessionCookie(res);
      return res.json({ ...payload(null), deconnexion: await OIDC.urlDeconnexion() });
    }
    if (DEMO) {
      // Le cookie présenté ne vaut plus rien ; la démonstration garde l'espace, sans compte, jusqu'au choix
      // d'un autre compte. Le compte quitté n'est plus proposé d'office dans les autres espaces.
      const demoComptes = Object.fromEntries(Object.entries(s.demoComptes ?? {}).filter(([, id]) => id !== s.compteId));
      return res.json(payload(openSession(db, res, { compteId: null, role: s.role, methode: 'demo', demoComptes }, s.expiration)));
    }
    clearSessionCookie(res);
    res.json(payload(null));
  });

  r.get('/api/comptes', (req, res) => {
    const id = identite(db, req);
    if (!id || id.user.role !== 'rh' || !aDroitRh(id.user.profilRh, 'admin')) {
      tracer(id?.compte, 'acces.refuse', 'Comptes et accès — réservé à l’administrateur RH', id?.user.role ?? null, req);
      return res.status(403).json({ error: 'Réservé à l’administrateur RH' });
    }
    res.json(comptesVue(db));
  });

  return r;
}

/** Heure de fin d'un blocage, à l'heure locale du serveur (« 14 h 05 »). */
function heure(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
}
