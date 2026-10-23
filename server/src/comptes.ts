// Comptes de connexion : un par personne — un salarié, ou une personne externe (nom et adresse).
// Un compte Microsoft 365 s'authentifie chez Microsoft (server/src/microsoft.ts : `oid` renseigné à la
// première connexion) ; un compte local à Cursus, pour le personnel sans compte d'entreprise
// (ouvriers, intérimaires, alternants), par un mot de passe haché avec scrypt.
// Les espaces ouverts découlent du compte : RH selon le profil (service RH, référent HSE, paie, lecture seule),
// manager si le salarié encadre au moins une équipe, collaborateur s'il est salarié.
import { randomBytes, randomInt, scrypt, scryptSync, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { BLOCAGE_MINUTES, COMPTE_TYPE_LABEL, ECHECS_MAX, ouvreEspaceRh, PROFILS_RH } from '../../shared/constants.ts';
import { estActionPaie } from '../../shared/journal.ts';
import { adresseValide, controleIdentifiant, normaliserIdentifiant } from '../../shared/rules/comptes.ts';
import type { CompteSession, CompteType, CompteVue, Employe, ProfilRh, Role } from '../../shared/types.ts';
import { ActionError } from './actions/context.ts';
import { todayIso } from './dataset.ts';
import type { Db } from './db.ts';

export interface Compte {
  id: number;
  empId: number | null;
  /** Compte externe uniquement : nom et adresse (ceux d'un salarié viennent de sa fiche). */
  nom: string | null;
  adresse: string | null;
  identifiant: string;
  type: CompteType;
  oid: string | null;
  profilRh: ProfilRh;
  actif: boolean;
  /** Empreinte scrypt (compte local) ; null tant qu'aucun mot de passe n'a été attribué. */
  motDePasse: string | null;
  changerMotDePasse: boolean;
  echecs: number | null;
  blocageFin: string | null;
  creation: string;
  creePar: string | null;
  derniereConnexion: string | null;
}

export const PROFILS = Object.keys(PROFILS_RH) as ProfilRh[];

export async function compteParIdentifiant(db: Db, identifiant: string): Promise<Compte | undefined> {
  return (await db.where<Compte>('comptes', 'identifiant', normaliserIdentifiant(identifiant)))[0];
}

type EmpCompte = Pick<Employe, 'id' | 'nom' | 'fin' | 'poste' | 'equipe'>;
const salarie = async (db: Db, c: Compte) => c.empId ? await db.get<EmpCompte>('employes', c.empId) : undefined;

/** Nom affiché de la personne : celui de la fiche du salarié, ou celui du compte externe. */
export async function nomDuCompte(db: Db, c: Compte): Promise<string> {
  return (c.empId ? (await salarie(db, c))?.nom : c.nom) ?? c.identifiant;
}

/** Espaces ouverts par le compte, dans l'ordre d'arrivée après connexion. */
export async function espacesDuCompte(db: Db, c: Compte): Promise<Role[]> {
  const out: Role[] = [];
  if (ouvreEspaceRh(c.profilRh)) out.push('rh');
  if (c.empId && await salarie(db, c)) {
    // Manager d'une équipe, ou suppléant d'un manager absent pendant sa délégation (t135) : l'espace manager s'ouvre
    // le premier jour de la délégation et se ferme après le dernier, ou dès sa révocation.
    const jour = todayIso();
    if (await db.one('SELECT 1 FROM equipes WHERE manager_id = ? LIMIT 1', [c.empId])
      || await db.one('SELECT 1 FROM delegations WHERE suppleant_id = ? AND revoquee_le IS NULL AND du <= ? AND au >= ? LIMIT 1', [c.empId, jour, jour])) out.push('manager');
    out.push('collaborateur');
  }
  return out;
}

/** Le salarié rattaché a-t-il quitté l'entreprise (date de sortie passée) ? */
const sorti = async (db: Db, c: Compte) => { const fin = (await salarie(db, c))?.fin; return !!fin && fin < todayIso(); };

/** Motif pour lequel le compte ne peut pas ouvrir de session, ou null. */
export async function refusDuCompte(db: Db, c: Compte): Promise<string | null> {
  if (!c.actif) return 'Compte désactivé : adressez-vous au service RH';
  if (c.empId && !await salarie(db, c)) return 'Fiche du salarié introuvable : adressez-vous au service RH';
  if (await sorti(db, c)) return 'Accès fermé : la date de sortie de ce salarié est passée';
  if (!(await espacesDuCompte(db, c)).length) return 'Aucun espace n’est ouvert à ce compte : adressez-vous au service RH';
  return null;
}

/** Compte apte à ouvrir une session (existant, actif, salarié présent, au moins un espace). */
export async function compteValide(db: Db, id: number | null | undefined): Promise<Compte | null> {
  const c = id ? await db.get<Compte>('comptes', id) : undefined;
  return c && !await refusDuCompte(db, c) ? c : null;
}

export async function compteSession(db: Db, c: Compte): Promise<CompteSession> {
  return {
    id: c.id, identifiant: c.identifiant, nom: await nomDuCompte(db, c), type: c.type, profilRh: c.profilRh,
    espaces: await espacesDuCompte(db, c), changerMotDePasse: c.type === 'local' && c.changerMotDePasse,
  };
}

/** Compte bloqué après des échecs de connexion répétés (jusqu'à `blocageFin`). */
export const compteBloque = (c: Compte, maintenant = new Date().toISOString()) => !!c.blocageFin && c.blocageFin > maintenant;

/** Liste des comptes pour l'administrateur RH (sans empreinte de mot de passe). */
export async function comptesVue(db: Db): Promise<CompteVue[]> {
  const vues: CompteVue[] = [];
  for (const c of await db.all<Compte>('comptes')) {
    vues.push({
      id: c.id, empId: c.empId, nom: await nomDuCompte(db, c), adresse: c.adresse, identifiant: c.identifiant, type: c.type, profilRh: c.profilRh,
      espaces: await espacesDuCompte(db, c), actif: c.actif, sorti: await sorti(db, c), changerMotDePasse: c.type === 'local' && c.changerMotDePasse, rattache: !!c.oid,
      bloqueJusqua: compteBloque(c) ? c.blocageFin : null, creation: c.creation, creePar: c.creePar, derniereConnexion: c.derniereConnexion,
    });
  }
  return vues.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/** Administrateurs RH en mesure de se connecter, hors le compte `sauf`. */
export async function adminsActifs(db: Db, sauf?: number): Promise<number> {
  let n = 0;
  for (const c of await db.where<Compte>('comptes', 'profilRh', 'rh_admin')) if (c.id !== sauf && !await refusDuCompte(db, c)) n++;
  return n;
}

/**
 * Administrateurs RH en mesure de se connecter, hors le compte `sauf`, qui le resteront après le `apres` : compte externe,
 * ou salarié dont le contrat (sortie enregistrée, fin de CDD…) court au-delà de cette date ; sans date, salarié sans
 * aucune date de fin. Garde-fou du dernier administrateur (désactivation, changement de profil, sortie) : une sortie à
 * venir ne compte pas pour un administrateur durable, sans quoi deux sorties successives fermeraient tous les comptes.
 */
export async function adminsDurables(db: Db, sauf: number | undefined, apres: string | null): Promise<number> {
  let n = 0;
  for (const c of await db.where<Compte>('comptes', 'profilRh', 'rh_admin')) {
    if (c.id === sauf || await refusDuCompte(db, c)) continue;
    const fin = (await salarie(db, c))?.fin;
    if (!fin || (apres != null && fin > apres)) n++;
  }
  return n;
}

// — Mots de passe —
// Empreinte « scrypt$<log2 N>$<r>$<p>$<sel>$<empreinte> » : les paramètres voyagent avec l'empreinte
// et peuvent être relevés plus tard sans invalider les mots de passe existants.

const SCRYPT = { log2N: 15, r: 8, p: 1, longueur: 32 };
const options = (log2N: number, r: number, p: number): ScryptOptions => ({ N: 2 ** log2N, r, p, maxmem: 256 * 2 ** log2N * r * p });

export function hacherMotDePasse(mdp: string): string {
  const { log2N, r, p, longueur } = SCRYPT;
  const sel = randomBytes(16);
  const h = scryptSync(mdp.normalize('NFC'), sel, longueur, options(log2N, r, p));
  return ['scrypt', log2N, r, p, sel.toString('base64url'), h.toString('base64url')].join('$');
}

/** Empreinte de référence : vérifiée quand le compte n'a pas de mot de passe, pour un temps de réponse identique. */
let empreinteFactice: string | null = null;

/**
 * Compare un mot de passe à une empreinte (comparaison en temps constant). Sans empreinte (compte
 * inconnu, compte Microsoft, compte bloqué), le calcul a quand même lieu et la réponse est non.
 */
export async function verifierMotDePasse(mdp: string, empreinte: string | null): Promise<boolean> {
  const ref = empreinte ?? (empreinteFactice ??= hacherMotDePasse(randomBytes(16).toString('hex')));
  const [algo, log2N, r, p, sel, attendu] = ref.split('$');
  if (algo !== 'scrypt' || !sel || !attendu) return false;
  const cible = Buffer.from(attendu, 'base64url');
  const h = await new Promise<Buffer>((res, rej) => scrypt(String(mdp).normalize('NFC'), Buffer.from(sel, 'base64url'), cible.length,
    options(Number(log2N), Number(r), Number(p)), (err, k) => err ? rej(err) : res(k)));
  return timingSafeEqual(h, cible) && empreinte !== null;
}

/** Mot de passe provisoire lisible (sans 0, O, 1, l, I), 16 caractères en quatre groupes. */
export function motDePasseProvisoire(): string {
  const A = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => A[randomInt(A.length)]).join('')).join('-');
}

/** Nouveau mot de passe provisoire pour un compte local : à changer à la prochaine connexion, compte débloqué. */
export async function attribuerProvisoire(db: Db, c: Compte): Promise<string> {
  const mdp = motDePasseProvisoire();
  await db.update<Compte>('comptes', c.id, { motDePasse: hacherMotDePasse(mdp), changerMotDePasse: true, echecs: 0, blocageFin: null });
  return mdp;
}

// — Échecs de connexion —
// Une tentative de mot de passe est comptée AVANT le calcul scrypt, qui rend la main : des tentatives
// envoyées en même temps ne passent pas toutes le contrôle du blocage avant que la première ne soit
// comptée. Une connexion réussie remet le compteur à zéro.

/** Tentative comptée : son rang parmi les tentatives successives sans succès, et le blocage qu'elle a posé. */
export interface Tentative { echecs: number; bloque: boolean; blocage: string | null }

/**
 * Compte une tentative avant la vérification du mot de passe : la cinquième tentative successive sans
 * succès bloque le compte quinze minutes (elle-même est encore vérifiée). `c` doit avoir été lu sans
 * attente depuis le contrôle de `compteBloque`.
 */
export async function compterTentative(db: Db, c: Compte): Promise<Tentative> {
  // Compteur relu et écrit d'un seul tenant (`exclusif`) : deux tentatives simultanées ne lisent jamais le même nombre.
  return db.exclusif(async () => {
    const n = ((await db.get<Compte>('comptes', c.id))?.echecs ?? c.echecs ?? 0) + 1;
    if (n < ECHECS_MAX) { await db.update<Compte>('comptes', c.id, { echecs: n }); return { echecs: n, bloque: false, blocage: null }; }
    const blocage = new Date(Date.now() + BLOCAGE_MINUTES * 60_000).toISOString();
    await db.update<Compte>('comptes', c.id, { echecs: 0, blocageFin: blocage });
    return { echecs: n, bloque: true, blocage };
  });
}

/**
 * Mot de passe exact : la tentative n'aboutit que si le compte, relu après le calcul, n'a pas été bloqué
 * entre-temps par une tentative simultanée. Celle qui a posé le blocage reste admise (cinquième essai).
 */
export const tentativeAdmise = (c: Compte, t: Tentative) => !compteBloque(c) || c.blocageFin === t.blocage;

/** Connexion réussie : compteur d'échecs remis à zéro. Pour un compte local, après `tentativeAdmise` seulement. */
export async function enregistrerConnexion(db: Db, c: Compte) {
  await db.update<Compte>('comptes', c.id, { echecs: 0, blocageFin: null, derniereConnexion: new Date().toISOString() });
}

// — Création —

export interface NouveauCompte {
  /** Salarié rattaché ; absent pour un compte externe, qui exige alors `nom` et `adresse`. */
  empId?: number | null;
  nom?: string | null;
  adresse?: string | null;
  type: CompteType;
  identifiant: string;
  profilRh?: ProfilRh;
}

/**
 * Crée un compte après contrôle ; renvoie le mot de passe provisoire d'un compte local (affiché une
 * seule fois, jamais conservé en clair). `auteur` : nom de la personne qui crée le compte.
 */
export async function creerCompte(db: Db, x: NouveauCompte, auteur: string | null): Promise<{ compte: Compte; motDePasse: string | null }> {
  const type = x.type;
  if (type !== 'microsoft' && type !== 'local') throw new ActionError('Type de compte inconnu');
  const profilRh = x.profilRh ?? 'aucun';
  if (!PROFILS.includes(profilRh)) throw new ActionError('Profil RH inconnu');
  const identifiant = normaliserIdentifiant(String(x.identifiant ?? ''));
  const err = controleIdentifiant(type, identifiant);
  if (err) throw new ActionError(err);
  if (await compteParIdentifiant(db, identifiant)) throw new ActionError(`Identifiant déjà utilisé : ${identifiant}`);
  let nom: string | null = null, adresse: string | null = null;
  if (x.empId) {
    await ficheSansCompte(db, Number(x.empId), 'aucun compte à créer');
  } else {
    // Compte externe (pas de fiche salarié) : il n'ouvre que l'espace RH.
    nom = String(x.nom ?? '').trim();
    adresse = normaliserIdentifiant(String(x.adresse ?? '')) || (type === 'microsoft' ? identifiant : '');
    if (!nom || nom.length > 120) throw new ActionError('Nom de la personne requis (120 caractères au plus)');
    if (!adresseValide(adresse)) throw new ActionError('Adresse e-mail de la personne requise');
    if (!ouvreEspaceRh(profilRh)) throw new ActionError('Un compte externe n’ouvre que l’espace RH : choisissez un profil RH (service RH, référent HSE, paie ou lecture seule)');
  }
  const mdp = type === 'local' ? motDePasseProvisoire() : null;
  const compte = await db.insert<Compte>('comptes', {
    empId: x.empId ? Number(x.empId) : null, nom, adresse, identifiant, type, oid: null, profilRh, actif: true,
    motDePasse: mdp ? hacherMotDePasse(mdp) : null, changerMotDePasse: !!mdp, echecs: 0, blocageFin: null,
    creation: new Date().toISOString(), creePar: auteur, derniereConnexion: null,
  });
  return { compte, motDePasse: mdp };
}

/**
 * Fiche d'un salarié présent qui n'a pas encore de compte (un compte par personne). `sorti` complète le refus d'un
 * salarié sorti, `conseil` celui d'une fiche qui a déjà son compte.
 */
async function ficheSansCompte(db: Db, empId: number, sorti: string, conseil = ''): Promise<EmpCompte> {
  const e = await db.get<EmpCompte>('employes', empId);
  if (!e) throw new ActionError('Collaborateur introuvable', 404);
  if (e.fin && e.fin < todayIso()) throw new ActionError(`${e.nom} a quitté l’entreprise : ${sorti}`);
  const deja = (await db.where<Compte>('comptes', 'empId', e.id))[0];
  if (deja) throw new ActionError(`${e.nom} a déjà un compte (${deja.identifiant}${deja.actif ? '' : ', désactivé'})${conseil}`);
  return e;
}

/**
 * Rattache un compte externe à la fiche d'un salarié saisie après lui (le premier administrateur RH est créé avant
 * toute fiche) : le compte ouvre aussi les espaces du salarié, prend le nom de la fiche, et son titulaire ne décide
 * plus de ses propres absences, feuilles de temps ou entretiens (`estSoiMeme` de server/src/actions/context.ts).
 * L'adresse du compte est conservée.
 */
export async function rattacherCompte(db: Db, c: Compte, empId: number): Promise<Compte> {
  if (c.empId) throw new ActionError(`Compte déjà rattaché à la fiche de ${await nomDuCompte(db, c)}`);
  await ficheSansCompte(db, empId, 'aucun compte à rattacher', ' : portez le profil RH sur ce compte-là, puis désactivez celui-ci');
  await db.update<Compte>('comptes', c.id, { empId, nom: null });
  return (await db.get<Compte>('comptes', c.id))!;
}

/** Désignation courte d'un compte dans les messages : « Karim Haddad (karim.haddad@…, Microsoft 365) ». */
export async function libelleCompte(db: Db, c: Compte): Promise<string> {
  return `${await nomDuCompte(db, c)} (${c.identifiant}, ${COMPTE_TYPE_LABEL[c.type]})`;
}

// — Journal —

export interface EntreeJournal {
  actor: string; role: string | null; action: string; message: string | null; payload?: unknown;
  compte?: Pick<Compte, 'id' | 'identifiant'> | null;
  /** Salariés concernés (historique de la fiche, filtre « salarié », export de ses données). */
  salaries?: number[];
  /** Horodatage, maintenant par défaut (bilan de la durée de conservation : date du passage). */
  at?: string;
}

/** Longueur au plus d'un message du journal, par sécurité (un message peut reprendre une donnée reçue). */
const MESSAGE_MAX = 2000;

/**
 * Trace une opération dans le journal, signée du nom de la personne et de son compte. Le contenu est
 * déjà expurgé (liste blanche de server/src/journal.ts) ; une action liée à la paie est marquée pour
 * l'archive (conservée 3 ans au lieu d'1 an).
 */
export async function journaliser(db: Db, e: EntreeJournal) {
  const message = e.message != null && e.message.length > MESSAGE_MAX ? `${e.message.slice(0, MESSAGE_MAX)}…` : e.message;
  await db.insert('journal', {
    at: e.at ?? new Date().toISOString(), actor: e.actor, role: e.role, action: e.action, message, payload: e.payload ?? {},
    compteId: e.compte?.id ?? null, identifiant: e.compte?.identifiant ?? null, salaries: [...new Set(e.salaries ?? [])], paie: estActionPaie(e.action),
  });
}
