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
import { type Db, enSerie } from './db.ts';
import { emailMode } from './integrations/email.ts';
import { KEYSTONE_MODE } from './integrations/keystone.ts';
import { sageMode } from './integrations/sage.ts';
import { OIDC, routesMicrosoft } from './microsoft.ts';

export interface Identite { session: SessionInfo; compte: Compte; user: CurrentUser }

/**
 * Personne authentifiée par la requête : session valide, compte en mesure de se connecter, espace
 * ouvert au compte et, pour une connexion par mot de passe, mot de passe provisoire déjà remplacé.
 */
export function identite(db: Db, req: Request): Promise<Identite | null> {
  return db.exclusif(async () => {
    const session = await readSession(db, req);
    const compte = await compteValide(db, session?.compteId);
    if (!session || !compte || (session.methode === 'local' && compte.changerMotDePasse)) return null;
    const user = await currentUser(db, session);
    return user ? { session, compte, user } : null;
  });
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
  const tracer = async (c: Compte | null | undefined, action: string, message: string, role: Role | null, req: Request, extra: Record<string, unknown> = {}) => {
    if (c) await journaliser(db, { actor: await nomDuCompte(db, c), role, action, message, payload: { ip: ip(req), ...extra }, compte: c });
  };
  const compteDe = async (s: SessionInfo | null) => (s?.compteId ? await db.get<Compte>('comptes', s.compteId) : undefined);

  /** Comptes proposés sur l'écran de connexion de démonstration, par espace. */
  async function loginOptions() {
    const out: Record<Role, { id: number; nom: string }[]> = { rh: [], manager: [], collaborateur: [] };
    for (const c of await db.all<Compte>('comptes')) {
      if (await refusDuCompte(db, c)) continue;
      const nom = await nomDuCompte(db, c), espaces = await espacesDuCompte(db, c);
      if (espaces.includes('rh')) out.rh.push({ id: c.id, nom: `${nom} — ${PROFILS_RH[c.profilRh].label}` });
      if (espaces.includes('manager')) {
        const equipes = (await db.where<{ nom: string }>('equipes', 'managerId', c.empId)).map(q => q.nom);
        out.manager.push({ id: c.id, nom: `${nom} — ${equipes.join(', ')}` });
      }
      if (espaces.includes('collaborateur')) out.collaborateur.push({ id: c.id, nom });
    }
    for (const l of Object.values(out)) l.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    return out;
  }

  async function payload(s: SessionInfo | null) {
    const c = await compteValide(db, s?.compteId);
    const enAttente = !!c && s?.methode === 'local' && c.changerMotDePasse;
    return {
      demo: DEMO, role: s?.role ?? 'rh', user: s && c && !enAttente ? await currentUser(db, s) : null, compte: c ? await compteSession(db, c) : null, methode: s?.methode ?? null,
      // Bouton « Se connecter avec Microsoft » : seulement si la connexion Microsoft 365 est configurée.
      microsoft: !!OIDC,
      // La liste des comptes (annuaire, organigramme) n'est exposée qu'en démonstration.
      loginOptions: DEMO ? await loginOptions() : null, integrations: { keystone: KEYSTONE_MODE, sage: sageMode(), email: emailMode() },
    };
  }

  /** Démonstration : compte RH ouvert d'office (le premier administrateur RH en mesure de se connecter). */
  const rhDemo = async () => {
    for (const c of await db.where<Compte>('comptes', 'profilRh', 'rh_admin')) if (!await refusDuCompte(db, c)) return c.id;
    return null;
  };

  /**
   * Démonstration : compte ouvert pour un espace — le compte en cours s'il y a accès, sinon le dernier
   * compte choisi pour cet espace, ou le compte RH de démonstration ; null : l'écran de connexion propose les comptes.
   */
  async function compteDemo(cur: SessionInfo | null, role: Role): Promise<number | null> {
    const ok = async (id: number | null | undefined) => { const c = await compteValide(db, id); return c && (await espacesDuCompte(db, c)).includes(role) ? c.id : null; };
    return await ok(cur?.compteId) ?? await ok(cur?.demoComptes?.[role]) ?? (role === 'rh' ? await rhDemo() : null);
  }

  /** Session de démonstration dans l'espace `role` : mise à jour, ou ouverte si la requête n'en porte pas. */
  async function sessionDemo(res: Response, cur: SessionInfo | null, role: Role): Promise<SessionInfo> {
    const compteId = await compteDemo(cur, role);
    const demoComptes = { ...cur?.demoComptes, ...(compteId ? { [role]: compteId } : {}) };
    const s: SessionInfo = { ...cur, compteId, role, methode: 'demo', demoComptes };
    return cur ? await updateSession(db, s) : await openSession(db, res, s);
  }

  // Chaque route s'exécute seule sur la base (`enSerie`), sauf la connexion et le mot de passe, dont le calcul de
  // l'empreinte (et la déconnexion Microsoft, une requête réseau) se fait hors de la file : étapes en `db.exclusif`.
  r.get('/api/session', enSerie(db, async (req: Request, res: Response) => {
    let s = await readSession(db, req);
    // En démonstration, l'espace RH s'ouvre directement à la première visite.
    if (!s && DEMO) {
      s = await sessionDemo(res, null, 'rh');
      await tracer(await compteDe(s), 'connexion', 'Connexion (démonstration) — espace RH ouvert à la première visite', 'rh', req, { methode: 'demo' });
    }
    res.json(await payload(s));
  }));

  /** Changement d'espace : seulement vers un espace du compte connecté (démonstration : connexion libre). */
  r.post('/api/mode', enSerie(db, async (req: Request, res: Response) => {
    const role = req.body?.role as Role;
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Espace inconnu' });
    const cur = await readSession(db, req);
    const change = async (s: SessionInfo) => {
      if (cur?.role !== s.role) await tracer(await compteDe(s), 'espace.change', `Espace ${cur ? `${ESPACE_LABEL[cur.role]} → ` : ''}${ESPACE_LABEL[s.role]}`, s.role, req, { de: cur?.role ?? null, vers: s.role });
      return s;
    };
    if (DEMO) return res.json(await payload(await change(await sessionDemo(res, cur, role))));
    const id = await identite(db, req);
    if (!cur || !id) return res.status(401).json({ error: 'Connexion requise' });
    if (!(await espacesDuCompte(db, id.compte)).includes(role)) {
      await tracer(id.compte, 'acces.refuse', `Changement d’espace — l’espace ${ESPACE_LABEL[role]} n’est pas ouvert à ce compte`, cur.role, req, { vers: role });
      return res.status(403).json({ error: 'Cet espace n’est pas ouvert à votre compte' });
    }
    res.json(await payload(await change(await updateSession(db, { ...cur, role }))));
  }));

  r.post('/api/login', async (req, res) => {
    const b = req.body ?? {};
    // Étape d'un seul tenant (session en cours, compte, tentative comptée), puis calcul de l'empreinte hors de la file,
    // puis le reste d'un seul tenant : comme avec l'accès synchrone d'avant, de part et d'autre du calcul.
    const avant = await db.exclusif(async () => {
      const cur = await readSession(db, req);
      // Démonstration : choix d'un compte de l'espace, mot de passe quelconque (aucun pour l'espace RH).
      if (DEMO && b.compteId !== undefined) {
        const role = b.role as Role;
        if (!ROLES.includes(role)) { res.status(400).json({ error: 'Espace inconnu' }); return null; }
        const c = await db.get<Compte>('comptes', Number(b.compteId));
        if (!c || !(await espacesDuCompte(db, c)).includes(role)) { res.status(400).json({ error: 'Compte inconnu pour cet espace' }); return null; }
        const refus = await refusDuCompte(db, c);
        if (refus) { res.status(403).json({ error: refus }); return null; }
        if (role !== 'rh' && !String(b.password ?? '').trim()) { res.status(400).json({ error: 'Mot de passe requis' }); return null; }
        // Chaque connexion ouvre une nouvelle session (nouvel identifiant, 12 h) et révoque la précédente.
        if (cur?.id) await revokeSession(db, cur.id);
        await enregistrerConnexion(db, c);
        const s = await openSession(db, res, { compteId: c.id, role, methode: 'demo', demoComptes: { ...cur?.demoComptes, [role]: c.id } });
        await tracer(c, 'connexion', `Connexion (démonstration) — espace ${ESPACE_LABEL[role]}`, role, req, { methode: 'demo' });
        res.json(await payload(s));
        return null;
      }

      // Compte local : identifiant et mot de passe. La tentative est comptée dès son arrivée, pour l'adresse
      // comme pour le compte, avant le calcul du mot de passe qui rend la main : une rafale de requêtes
      // simultanées ne passe ni la limite de l'adresse ni le blocage du compte (comptes.ts).
      const adresse = ip(req);
      if (limite.depasse(adresse)) { tropDeTentatives(res, adresse); return null; }
      const identifiant = normaliserIdentifiant(typeof b.identifiant === 'string' ? b.identifiant : '');
      const mdp = typeof b.motDePasse === 'string' ? b.motDePasse : '';
      if (!identifiant || !mdp) { res.status(400).json({ error: 'Identifiant et mot de passe requis' }); return null; }
      limite.echec(adresse);
      const trouve = await compteParIdentifiant(db, identifiant);
      const local = trouve?.type === 'local' ? trouve : null;
      const tentative = local && !compteBloque(local) ? await compterTentative(db, local) : null;
      return { cur, adresse, mdp, trouve, local, tentative };
    });
    if (!avant) return;
    const { cur, adresse, mdp, trouve, local, tentative } = avant;
    // Le calcul a lieu même sans compte ou compte bloqué : même temps de réponse dans tous les cas.
    const ok = await verifierMotDePasse(mdp, tentative ? local!.motDePasse : null);
    await db.exclusif(async () => {
      const c = local ? await db.get<Compte>('comptes', local.id) ?? null : null; // relu après l'attente
      const trace = async (action: string, message: string, role: Role | null = null) => await journaliser(db, {
        // Identifiant inconnu : il n'est pas recopié (ce peut être un mot de passe saisi dans le mauvais champ).
        actor: c ? await nomDuCompte(db, c) : trouve ? await nomDuCompte(db, trouve) : 'Identifiant inconnu', role, action, message,
        payload: { ip: adresse }, compte: c ?? trouve ?? null,
      });
      if (!ok || !c || !tentative) {
        if (!trouve) await trace('connexion.refusee', 'Identifiant inconnu');
        else if (!local) await trace('connexion.refusee', 'Compte Microsoft 365 : pas de connexion par mot de passe');
        else if (!tentative) await trace('connexion.refusee', `Compte bloqué jusqu’à ${heure(local.blocageFin!)}`);
        else await trace('connexion.refusee', tentative.bloque ? `Mot de passe incorrect — compte bloqué ${BLOCAGE_MINUTES} minutes après ${ECHECS_MAX} échecs` : `Mot de passe incorrect (échec ${tentative.echecs} sur ${ECHECS_MAX})`);
        return res.status(401).json({ error: ECHEC_CONNEXION });
      }
      // Mot de passe exact, mais compte bloqué pendant le calcul par une tentative simultanée : même refus.
      if (!tentativeAdmise(c, tentative)) {
        await trace('connexion.refusee', `Compte bloqué jusqu’à ${heure(c.blocageFin!)}`);
        return res.status(401).json({ error: ECHEC_CONNEXION });
      }
      // Mot de passe exact : le compte doit encore pouvoir se connecter (actif, salarié présent).
      const refus = await refusDuCompte(db, c);
      if (refus) {
        await revokeSessionsDuCompte(db, c.id);
        await trace('connexion.refusee', refus);
        return res.status(403).json({ error: refus });
      }
      limite.rendre(adresse);
      if (cur?.id) await revokeSession(db, cur.id);
      await enregistrerConnexion(db, c);
      const role = (await espacesDuCompte(db, c))[0];
      await trace('connexion', c.changerMotDePasse ? 'Connexion — mot de passe provisoire à remplacer' : 'Connexion', role);
      res.json(await payload(await openSession(db, res, { compteId: c.id, role, methode: 'local', demoComptes: {} })));
    });
  });

  /** Changement du mot de passe d'un compte local (obligatoire après un mot de passe provisoire). */
  r.post('/api/motdepasse', async (req, res) => {
    // Comme pour la connexion : contrôles et tentative d'un seul tenant, calcul hors de la file, puis le reste.
    const avant = await db.exclusif(async () => {
      const s = await readSession(db, req);
      const c = await compteValide(db, s?.compteId);
      if (!s || !c) { res.status(401).json({ error: 'Connexion requise' }); return null; }
      if (c.type !== 'local') { res.status(400).json({ error: 'Compte Microsoft 365 : le mot de passe se gère chez Microsoft' }); return null; }
      const adresse = ip(req);
      if (limite.depasse(adresse)) { tropDeTentatives(res, adresse); return null; }
      const actuel = typeof req.body?.actuel === 'string' ? req.body.actuel : '';
      const nouveau = typeof req.body?.nouveau === 'string' ? req.body.nouveau : '';
      const err = controleMotDePasse(nouveau, c.identifiant);
      if (err) { res.status(400).json({ error: err }); return null; }
      if (actuel === nouveau) { res.status(400).json({ error: 'Choisissez un mot de passe différent de l’actuel' }); return null; }
      if (compteBloque(c)) { bloque(c); return null; }
      // Tentative comptée avant le calcul, comme à la connexion.
      limite.echec(adresse);
      const tentative = await compterTentative(db, c);
      return { s, c, adresse, actuel, nouveau, tentative };
    });
    function bloque(x: Compte) { return res.status(403).json({ error: `Compte bloqué jusqu’à ${heure(x.blocageFin!)} après des échecs répétés` }); }
    if (!avant) return;
    const { s, c, adresse, actuel, nouveau, tentative } = avant;
    const ok = await verifierMotDePasse(actuel, c.motDePasse);
    await db.exclusif(async () => {
      const apres = await db.get<Compte>('comptes', c.id) ?? c;
      const trace = async (action: string, message: string) => await journaliser(db, { actor: await nomDuCompte(db, apres), role: s.role, action, message, payload: { ip: adresse }, compte: apres });
      if (!ok) {
        await trace('motdepasse.refuse', tentative.bloque ? `Mot de passe actuel incorrect — compte bloqué ${BLOCAGE_MINUTES} minutes` : 'Mot de passe actuel incorrect');
        return res.status(400).json({ error: tentative.bloque ? `Mot de passe actuel incorrect : compte bloqué ${BLOCAGE_MINUTES} minutes` : 'Mot de passe actuel incorrect' });
      }
      if (!tentativeAdmise(apres, tentative)) return bloque(apres);
      limite.rendre(adresse);
      await db.update<Compte>('comptes', c.id, { motDePasse: hacherMotDePasse(nouveau), changerMotDePasse: false, echecs: 0, blocageFin: null });
      // Les autres sessions du compte sont fermées : seule celle qui a changé le mot de passe reste ouverte.
      const n = await revokeSessionsDuCompte(db, c.id, s.id);
      await trace('motdepasse.change', `Mot de passe changé${n ? ` — ${n} autre${n > 1 ? 's' : ''} session${n > 1 ? 's' : ''} fermée${n > 1 ? 's' : ''}` : ''}`);
      res.json(await payload(await readSession(db, req)));
    });
  });

  r.post('/api/logout', async (req, res) => {
    const microsoft = await db.exclusif(async () => {
      const s = await readSession(db, req);
      if (!s) { clearSessionCookie(res); res.json(await payload(null)); return false; }
      await revokeSession(db, s.id!);
      await tracer(await compteDe(s), 'deconnexion', 'Déconnexion', s.role, req, { methode: s.methode });
      // Session Microsoft : suite ci-dessous, hors de la file (adresse de déconnexion lue chez Microsoft).
      if (s.methode === 'microsoft' && OIDC) return true;
      if (DEMO) {
        // Le cookie présenté ne vaut plus rien ; la démonstration garde l'espace, sans compte, jusqu'au choix
        // d'un autre compte. Le compte quitté n'est plus proposé d'office dans les autres espaces.
        const demoComptes = Object.fromEntries(Object.entries(s.demoComptes ?? {}).filter(([, id]) => id !== s.compteId));
        res.json(await payload(await openSession(db, res, { compteId: null, role: s.role, methode: 'demo', demoComptes }, s.expiration)));
        return false;
      }
      clearSessionCookie(res);
      res.json(await payload(null));
      return false;
    });
    // Session Microsoft : le navigateur passe ensuite par la déconnexion Microsoft, qui revient sur Cursus.
    if (microsoft && OIDC) {
      clearSessionCookie(res);
      const deconnexion = await OIDC.urlDeconnexion();
      res.json({ ...await db.exclusif(() => payload(null)), deconnexion });
    }
  });

  r.get('/api/comptes', enSerie(db, async (req: Request, res: Response) => {
    const id = await identite(db, req);
    if (!id || id.user.role !== 'rh' || !aDroitRh(id.user.profilRh, 'admin')) {
      await tracer(id?.compte, 'acces.refuse', 'Comptes et accès — réservé à l’administrateur RH', id?.user.role ?? null, req);
      return res.status(403).json({ error: 'Réservé à l’administrateur RH' });
    }
    res.json(await comptesVue(db));
  }));

  return r;
}

/** Heure de fin d'un blocage, à l'heure locale du serveur (« 14 h 05 »). */
function heure(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
}
