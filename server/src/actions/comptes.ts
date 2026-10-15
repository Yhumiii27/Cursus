// Comptes et accès (administrateur RH) : création, profil RH, rattachement d'un compte externe à une fiche,
// désactivation, mot de passe provisoire (compte Cursus) ou retrait du rattachement à l'identité Microsoft
// (compte Microsoft 365).
// Cursus garde toujours au moins un administrateur RH en mesure de se connecter.
import { COMPTE_TYPE_LABEL, PROFILS_RH } from '../../../shared/constants.ts';
import { plural } from '../../../shared/format.ts';
import type { ProfilRh } from '../../../shared/types.ts';
import { revokeSessionsDuCompte } from '../auth.ts';
import { adminsDurables, attribuerProvisoire, type Compte, creerCompte, nomDuCompte, PROFILS, rattacherCompte, refusDuCompte } from '../comptes.ts';
import { adresseDuCompte } from '../messagerie.ts';
import { ActionError, requireRhAdmin, str, type ActionHandler, type Ctx } from './context.ts';

function getCompte(ctx: Ctx, id: unknown): Compte {
  const c = ctx.db.get<Compte>('comptes', Number(id));
  if (!c) throw new ActionError('Compte introuvable', 404);
  return c;
}

const DERNIER_ADMIN = 'Cursus doit garder au moins un administrateur RH actif, sans date de sortie : désignez-en un autre d’abord';
const fermees = (n: number) => n ? ` — ${plural(n, 'session fermée', 'sessions fermées')}` : '';

/** Compte d'un salarié (`empId`) ou externe (`nom`, `adresse`) ; un compte Cursus reçoit un mot de passe provisoire. */
const creer: ActionHandler = (ctx, p) => {
  requireRhAdmin(ctx);
  const { compte, motDePasse } = creerCompte(ctx.db, {
    empId: p.empId ? Number(p.empId) : null, nom: str(p.nom), adresse: str(p.adresse), type: p.type, identifiant: str(p.identifiant), profilRh: p.profilRh,
  }, ctx.user.nom);
  const nom = nomDuCompte(ctx.db, compte);
  // Compte Microsoft 365 d'un salarié sans adresse e-mail : son identifiant devient l'adresse de sa fiche.
  const email = adresseDuCompte(ctx.db, compte) ? ' · adresse e-mail reprise sur la fiche' : '';
  const profil = (compte.profilRh !== 'aucun' ? ` · ${PROFILS_RH[compte.profilRh].label}` : '') + email;
  return {
    message: `Compte créé — ${nom} · ${compte.identifiant} (${COMPTE_TYPE_LABEL[compte.type]})${profil}${motDePasse ? ' · mot de passe provisoire à communiquer' : ''}`,
    // Affiché une seule fois par l'interface ; ni conservé en clair, ni écrit dans le journal.
    result: { id: compte.id, motDePasse },
  };
};

const profil: ActionHandler = (ctx, p) => {
  requireRhAdmin(ctx);
  const c = getCompte(ctx, p.id);
  const next = str(p.profilRh) as ProfilRh;
  if (!PROFILS.includes(next)) throw new ActionError('Profil RH inconnu');
  if (next === c.profilRh) return null;
  if (c.profilRh === 'rh_admin' && !adminsDurables(ctx.db, c.id, null) && !refusDuCompte(ctx.db, c)) throw new ActionError(DERNIER_ADMIN);
  if (!c.empId && next === 'aucun') throw new ActionError('Un compte externe n’ouvre que l’espace RH : désactivez-le plutôt');
  ctx.db.update<Compte>('comptes', c.id, { profilRh: next });
  // Les sessions ouvertes dans l'espace RH passent à un autre espace du compte, ou sont fermées (auth.ts).
  return `${nomDuCompte(ctx.db, c)} — profil RH : ${PROFILS_RH[next].label}`;
};

/**
 * Compte externe rattaché à la fiche d'un salarié saisie après lui (le premier administrateur RH, créé avant toute
 * fiche) : un membre du service RH qui est aussi salarié ne décide pas de ses propres absences, feuilles de temps
 * ou entretiens, ce que Cursus ne vérifie que sur un compte rattaché à sa fiche.
 */
const rattacher: ActionHandler = (ctx, p) => {
  requireRhAdmin(ctx);
  const c = getCompte(ctx, p.id);
  const avant = nomDuCompte(ctx.db, c);
  const r = rattacherCompte(ctx.db, c, Number(p.empId));
  return `Compte de ${avant} (${c.identifiant}) rattaché à la fiche de ${nomDuCompte(ctx.db, r)}`;
};

/** Désactiver ferme aussitôt toutes les sessions du compte ; réactiver lève aussi un blocage temporaire. */
const activer: ActionHandler = (ctx, p) => {
  requireRhAdmin(ctx);
  const c = getCompte(ctx, p.id);
  const nom = nomDuCompte(ctx.db, c);
  if (p.actif) {
    if (c.actif) return null;
    ctx.db.update<Compte>('comptes', c.id, { actif: true, echecs: 0, blocageFin: null });
    const refus = refusDuCompte(ctx.db, { ...c, actif: true });
    return `Compte de ${nom} réactivé${refus ? ` — connexion toujours refusée (${refus.charAt(0).toLowerCase()}${refus.slice(1)})` : ''}`;
  }
  if (!c.actif) return null;
  if (c.id === ctx.user.compteId) throw new ActionError('Vous ne pouvez pas désactiver votre propre compte', 403);
  if (c.profilRh === 'rh_admin' && !adminsDurables(ctx.db, c.id, null)) throw new ActionError(DERNIER_ADMIN);
  ctx.db.update<Compte>('comptes', c.id, { actif: false });
  return `Compte de ${nom} désactivé${fermees(revokeSessionsDuCompte(ctx.db, c.id))}`;
};

/**
 * Nouveau mot de passe provisoire d'un compte Cursus (oubli, blocage) ; pour un compte Microsoft 365, retrait
 * du rattachement à l'identité Microsoft (identité recréée) : la prochaine connexion avec l'adresse du compte
 * le rattache de nouveau. Dans les deux cas, ses sessions sont fermées.
 */
const reinitialiser: ActionHandler = (ctx, p) => {
  requireRhAdmin(ctx);
  const c = getCompte(ctx, p.id);
  if (c.type !== 'local') {
    if (c.id === ctx.user.compteId) throw new ActionError('Compte Microsoft 365 : votre propre rattachement ne peut pas être retiré', 403);
    if (!c.oid) throw new ActionError('Compte Microsoft 365 pas encore rattaché : le mot de passe se gère chez Microsoft');
    ctx.db.update<Compte>('comptes', c.id, { oid: null });
    const n = revokeSessionsDuCompte(ctx.db, c.id);
    return `Rattachement Microsoft retiré pour ${nomDuCompte(ctx.db, c)} — la prochaine connexion Microsoft avec ${c.identifiant} le rétablit${fermees(n)}`;
  }
  if (c.id === ctx.user.compteId) throw new ActionError('Pour votre propre compte, utilisez « Changer mon mot de passe »', 403);
  const motDePasse = attribuerProvisoire(ctx.db, c);
  const n = revokeSessionsDuCompte(ctx.db, c.id);
  return {
    message: `Mot de passe provisoire attribué à ${nomDuCompte(ctx.db, c)} (${c.identifiant}) — à changer à la prochaine connexion${fermees(n)}`,
    result: { id: c.id, motDePasse },
  };
};

export const comptesActions: Record<string, ActionHandler> = {
  'compte.creer': creer,
  'compte.profil': profil,
  'compte.rattacher': rattacher,
  'compte.activer': activer,
  'compte.reinitialiser': reinitialiser,
};
