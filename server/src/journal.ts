// Journal des actions (table `journal`) : ce qui y est écrit, combien de temps il est gardé, sa consultation.
// - Liste blanche par action (REGLES) : du paramètre reçu, seuls des identifiants, codes, dates et statuts
//   sont recopiés, avec les anciennes et nouvelles valeurs utiles de la ligne modifiée. Jamais de numéro de
//   passeport, de mot de passe, de CSV importé, de texte libre (motifs, comptes rendus) ni de donnée de santé :
//   les messages sont expurgés des natures médicales d'absence et des vaccins. Une action sans règle ne
//   recopie aucun champ.
// - Salariés concernés (`salaries`) : historique de la fiche, filtre « salarié », export de ses données.
// - Conservation (décision de l'entreprise, shared/journal.ts) : 1 an pour tout ; les actions liées à la
//   paie passent alors dans une archive, hors de l'écran, que le service RH consulte sur demande, et sont
//   supprimées au bout de 3 ans. Les envois anciens de la file d'envoi sont purgés en même temps.
// - Consultation (service RH, y compris un profil en lecture seule de l'espace RH) : filtres, pagination,
//   export CSV (formules neutralisées), archive ; l'export et la consultation de l'archive sont tracés.
import express, { type Request, type Response, type Router } from 'express';
import { ESPACE_LABEL, NATURES_ABSENCE, VACCINS } from '../../shared/constants.ts';
import { addD, isValidDate } from '../../shared/dates.ts';
import { Domain } from '../../shared/domain.ts';
import { fmtIso, matricule, num, plural } from '../../shared/format.ts';
import {
  ACTION_APPEL_KEYSTONE, ACTIONS_CONNEXION, changementsTexte, CONSERVATION_ARCHIVE_PAIE_MOIS, CONSERVATION_ENVOIS_MOIS, CONSERVATION_JOURNAL_MOIS,
  estActionPaie, FAMILLES_JOURNAL, JOURNAL_LABEL, libelleAction,
} from '../../shared/journal.ts';
import { natureMedicale } from '../../shared/rules/absences.ts';
import type { CurrentUser, LigneTemps } from '../../shared/types.ts';
import { journaliser, type Compte } from './comptes.ts';
import { identite, type Identite } from './connexion.ts';
import { loadFull, scopeIds } from './dataset.ts';
import type { Db, TableName } from './db.ts';
import { purgerEnvois } from './envois.ts';

type P = Record<string, any>;
type Ligne = Record<string, any>;

// — Liste blanche par action —

interface Cible {
  table: TableName;
  /** Clé de la ligne modifiée par l'action (null : aucune). */
  cle: (p: P, db: Db) => unknown;
  /** Colonnes dont les anciennes et nouvelles valeurs sont tracées. `aplatir` : objet JSON comparé clé par clé. */
  colonnes: readonly string[];
  aplatir?: boolean;
}

interface Contexte { db: Db; user: CurrentUser; avant: Ligne | null; apres: Ligne | null; result: unknown }

interface Regle {
  /** Champs du paramètre recopiés tels quels ; fonction quand ils dépendent du contenu (formalités). */
  champs?: readonly string[] | ((p: P) => readonly string[]);
  /** Valeurs calculées ajoutées au contenu tracé (jamais de texte libre). */
  extra?: (p: P, avant: Ligne | null) => Ligne;
  /** Ligne modifiée : ses colonnes sont lues avant et après l'action. */
  cible?: Cible;
  /** Salariés concernés, en plus de `empId` (paramètre, ou ligne modifiée). */
  salaries?: (p: P, x: Contexte) => unknown[];
  /** Tracée seulement si… (saisie d'heures : correction d'une feuille soumise). */
  tracer?: (avant: Ligne | null, apres: Ligne | null, p: P) => boolean;
  /** Code inscrit au journal à la place du nom de l'action (correction d'heures). */
  code?: (avant: Ligne | null) => string;
  /** Anciennes et nouvelles valeurs propres à l'action, à la place de la comparaison des colonnes ; message éventuel. */
  changements?: (avant: Ligne | null, apres: Ligne | null, p: P, db: Db) => { avant: Ligne; apres: Ligne; extra?: Ligne; message?: string } | null;
  /** Modifications successives du même objet par le même compte regroupées sur une ligne pendant N minutes. */
  regrouper?: number;
}

const parId = (table: TableName, colonnes: readonly string[]): Cible => ({ table, cle: p => Number(p.id) || null, colonnes });
const FICHE = ['nom', 'poste', 'equipe', 'statut', 'typeContrat', 'temps', 'heures', 'forfaitHeures', 'forfaitJours', 'jourOff', 'tempsDepuis', 'entree', 'fin', 'agence'];
const FEUILLE: Cible = {
  table: 'feuilles', colonnes: ['statut'],
  cle: (p, db) => (db.sql.prepare('SELECT id FROM feuilles WHERE emp_id = ? AND week = ?').get(Number(p.empId) || 0, String(p.week ?? '')) as { id: number } | undefined)?.id ?? null,
};
const soumise = (f: Ligne | null) => f?.statut === 'soumise';
const totalHeures = (f: Ligne | null) => ((f?.lignes ?? []) as LigneTemps[]).reduce((n, l) => n + l.h.reduce((a, b) => a + num(b), 0), 0);
const heuresTexte = (h: number) => `${String(Math.round(h * 100) / 100).replace('.', ',')} h`;
const nomSalarie = (db: Db, id: unknown) => db.get<{ nom: string }>('employes', Number(id))?.nom ?? `salarié n° ${id}`;

/** Correction d'une feuille soumise par son valideur : total d'heures avant et après (lignes ajoutées, retirées, proposées). */
const correctionTotal: Regle['changements'] = (av, ap) => soumise(av) && totalHeures(av) !== totalHeures(ap)
  ? { avant: { heures: totalHeures(av) }, apres: { heures: totalHeures(ap) } } : null;
const ligneTemps: Partial<Regle> = { cible: FEUILLE, code: av => (soumise(av) ? 'temps.correction' : ''), changements: correctionTotal };

export const REGLES: Record<string, Regle> = {
  // Fiches et équipes
  'employe.creer': { champs: ['equipe', 'poste', 'statut', 'typeContrat', 'temps', 'entree', 'fin'], salaries: (_p, x) => [(x.result as { id?: number } | null)?.id] },
  // Les champs modifiés sont nommés ; seules les colonnes de FICHE ont leurs valeurs (ni visite médicale, ni reprise, ni naissance).
  'employe.modifier': { champs: ['id'], extra: p => ({ champsModifies: Object.keys(p).filter(k => k !== 'id' && /^[A-Za-z]{1,40}$/.test(k)).slice(0, 30) }), cible: parId('employes', FICHE), salaries: p => [p.id] },
  'equipe.creer': { champs: ['nom', 'managerId'], salaries: p => [p.managerId] },
  'equipe.renommer': { champs: ['nom', 'nouveau'] },
  'equipe.supprimer': { champs: ['nom'] },
  'equipe.manager': { champs: ['nom', 'managerId'], cible: { table: 'equipes', cle: p => String(p.nom ?? ''), colonnes: ['managerId'] }, salaries: (p, x) => [p.managerId, x.avant?.managerId] },
  'equipe.affecter': { champs: ['empId', 'equipe'], cible: { table: 'employes', cle: p => Number(p.empId) || null, colonnes: ['equipe'] } },
  // Formations
  'plan.inscrire': { champs: ['empId', 'certId', 'inscriptionId', 'sessionId', 'conv'] },
  'cert.ajouter': { champs: ['empId', 'f', 'date'] },
  'session.creer': { champs: ['f', 'date', 'lieu', 'places', 'planId'] },
  'session.confirmer': { champs: ['id'], cible: parId('sessions', ['statut']), salaries: (p, x) => inscrits(x.db, p.id) },
  'session.modifier': { champs: ['id'], cible: parId('sessions', ['date', 'lieu', 'places', 'statut']), salaries: (p, x) => inscrits(x.db, p.id) },
  'session.annuler': { champs: ['id'], cible: parId('sessions', ['statut']), salaries: (p, x) => inscrits(x.db, p.id) },
  // Résultats de chaque inscrit (présent, reçu) ; ni la note ni le commentaire de l'évaluation à chaud.
  'session.cloturer': {
    champs: ['id'], cible: parId('sessions', ['statut']),
    extra: p => ({ participants: participants(p).map((x: P) => ({ empId: Number(x?.empId) || null, present: !!x?.present, reussi: typeof x?.reussi === 'boolean' ? x.reussi : null })) }),
    salaries: p => participants(p).map((x: P) => x?.empId),
  },
  'plan.importer': { champs: ['exercice', 'mode'] },
  'plan.avancer': { champs: ['id'], cible: parId('planActions', ['statut']) },
  'budget.enveloppes': { champs: ['exercice', 'enveloppes'] },
  // Habilitations : le motif d'une suspension ou d'un retrait (texte libre, parfois médical) n'est pas recopié.
  'hab.delivrer': { champs: ['empId', 'h', 'date', 'par', 'mode'] },
  'hab.suspendre': { champs: ['empId', 'h', 'date'] },
  'hab.lever': { champs: ['empId', 'h'] },
  'hab.retirer': { champs: ['empId', 'h', 'date'] },
  'medical.demander': { champs: ['empId'] },
  // Demandes des collaborateurs : ni motif, ni réponse, ni contenu d'une déclaration.
  'demande.formation': { champs: ['empId', 'f', 'sessionId'], salaries: (p, x) => [p.empId ?? x.user.empId] },
  'demande.habilitation': { champs: ['empId', 'h'], salaries: (p, x) => [p.empId ?? x.user.empId] },
  'demande.accepter': { champs: ['id'], cible: parId('demandesCollab', ['statut']) },
  'demande.refuser': { champs: ['id'], cible: parId('demandesCollab', ['statut']) },
  // Déplacements : jamais le numéro de passeport ni une vaccination (donnée de santé) ; le motif n'est pas recopié.
  'voyage.creer': { champs: ['empId', 'dest', 'depart', 'retour'] },
  'formalite.enregistrer': {
    champs: p => p.kind === 'passeport' ? ['empId', 'kind', 'expire'] : p.kind === 'visa' ? ['empId', 'kind', 'dest', 'visaType', 'obtenu', 'expire'] : ['empId', 'kind'],
  },
  'voyages.importer': {},
  'keystone.accepter': { champs: ['id'], cible: parId('demandesKeystone', ['statut']) },
  'keystone.refuser': { champs: ['id'], cible: parId('demandesKeystone', ['statut']) },
  // Feuilles de temps : la saisie du salarié n'est pas tracée cellule par cellule ; la correction d'une feuille
  // soumise par son valideur l'est (temps.correction, action liée à la paie), avec l'ancienne et la nouvelle valeur.
  'temps.setCell': {
    champs: ['empId', 'week'], cible: FEUILLE, code: () => 'temps.correction',
    tracer: (av, ap, p) => soumise(av) && cellule(av, p) !== cellule(ap, p),
    changements: (av, ap, p, db) => {
      const l = (ap?.lignes as LigneTemps[] | undefined)?.[Number(p.li)];
      if (!l) return null;
      const jour = addD(String(p.week), Number(p.di)), a = cellule(av, p), b = cellule(ap, p);
      return {
        avant: { heures: a }, apres: { heures: b }, extra: { projet: l.projet, jour },
        message: `Correction d’heures — ${nomSalarie(db, p.empId)}, ${l.projet} le ${fmtIso(jour)} : ${heuresTexte(a)} → ${heuresTexte(b)}`,
      };
    },
  },
  'temps.addLine': { champs: ['empId', 'week', 'projet'], ...ligneTemps },
  'temps.removeLine': { champs: ['empId', 'week'], extra: (p, av) => ({ projet: (av?.lignes as LigneTemps[] | undefined)?.[Number(p.li)]?.projet ?? null }), ...ligneTemps },
  'temps.suggest': { champs: ['empId', 'week'], ...ligneTemps },
  'temps.submit': { champs: ['empId', 'week'], cible: FEUILLE },
  'temps.validate': { champs: ['empId', 'week'], cible: FEUILLE },
  'temps.reject': { champs: ['empId', 'week'], cible: FEUILLE },
  'temps.pushSage': {},
  // Absences : la nature n'est jamais recopiée (son absence trahirait une nature médicale) ; dates et statut seulement.
  'absence.demander': { champs: ['empId', 'kind', 'du', 'au'] },
  'absence.decider': { champs: ['id', 'ok'], cible: parId('absences', ['statut']) },
  'absence.signaler': { champs: ['empId', 'du', 'au'] },
  'absence.saisir': { champs: ['empId', 'du', 'au', 'justificatif', 'justificatifLe'] },
  'absence.qualifier': { champs: ['id', 'du', 'au', 'justificatif', 'justificatifLe'], cible: parId('absences', ['du', 'au', 'statut', 'justificatif']) },
  'absence.prolonger': { champs: ['id', 'au'], cible: parId('absences', ['au', 'statut']) },
  'absence.annuler': { champs: ['id'], cible: parId('absences', ['statut']) },
  'cet.placer': { champs: ['empId', 'kind', 'jours'] },
  'report.accorder': { champs: ['empId', 'jours'] },
  // Entretiens : la section rédigée est nommée, jamais son contenu ; une ligne par compte rendu et par demi-heure.
  'entretien.planifier': { champs: ['empId', 'kind', 'date'] },
  'entretien.modifier': {
    champs: ['id', 'info'], extra: p => (p.section ? { sections: [String(p.section)] } : {}),
    cible: { table: 'entretiens', cle: p => Number(p.id) || null, colonnes: [] }, regrouper: 30,
  },
  'entretien.clore': { champs: ['id'], cible: parId('entretiens', ['statut', 'signMgr']) },
  'entretien.signer': { champs: ['id'], cible: parId('entretiens', ['signSal']) },
  // Administration
  'parametres.maj': { cible: { table: 'settings', cle: () => 'app', colonnes: ['value'], aplatir: true } },
  'demo.reinitialiser': {},
  'compte.creer': { champs: ['empId', 'type', 'identifiant', 'profilRh'] },
  'compte.profil': { champs: ['id', 'profilRh'], cible: parId('comptes', ['profilRh']) },
  'compte.activer': { champs: ['id', 'actif'], cible: parId('comptes', ['actif']) },
  'compte.reinitialiser': { champs: ['id'], cible: parId('comptes', []) },
  'envoi.relancer': { champs: ['id'] },
  'envoi.classer': { champs: ['id'] },
};

/** Participants d'une clôture (bornés : une session compte quelques dizaines d'inscrits). */
const participants = (p: P): P[] => (Array.isArray(p.participants) ? p.participants.slice(0, 500) : []);

function cellule(f: Ligne | null, p: P): number {
  return num((f?.lignes as LigneTemps[] | undefined)?.[Number(p.li)]?.h?.[Number(p.di)]);
}

/** Inscrits d'une session de formation (recyclages et formations initiales). */
function inscrits(db: Db, sessionId: unknown): number[] {
  const id = Number(sessionId) || 0;
  return (db.sql.prepare('SELECT emp_id AS e FROM certifications WHERE session_id = ? UNION SELECT emp_id FROM inscriptions WHERE session_id = ?').all(id, id) as { e: number }[]).map(r => r.e);
}

/** Retire une nature d'absence médicale (code) d'un objet tracé, par sécurité (aucune règle n'en recopie). */
function sansSante(o: Ligne): Ligne {
  for (const k of ['type', 'nature', 'kind']) if (typeof o[k] === 'string' && natureMedicale(o[k])) delete o[k];
  return o;
}

/**
 * Valeur recopiée : scalaires, listes et petits objets (enveloppes budgétaires) ; une chaîne est bornée, un
 * objet volumineux n'est pas recopié (un refus d'accès trace aussi le paramètre envoyé, par n'importe qui).
 */
function propre(v: unknown): unknown {
  if (typeof v === 'string') return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  if (v === undefined) return null;
  if (typeof v === 'object' && v !== null && JSON.stringify(v).length > 2000) return '[contenu volumineux non recopié]';
  return v;
}

/** Champs du paramètre retenus par la règle de l'action (rien sans règle). */
export function champsRetenus(action: string, p: P, avant: Ligne | null = null): Ligne {
  const r = REGLES[action];
  if (!r || !p || typeof p !== 'object') return {};
  const noms = typeof r.champs === 'function' ? r.champs(p) : r.champs ?? [];
  const out: Ligne = {};
  for (const k of noms) if (p[k] !== undefined && p[k] !== '') out[k] = propre(p[k]);
  return sansSante({ ...out, ...(r.extra?.(p, avant) ?? {}) });
}

/** Ligne de la cible, lue telle quelle (colonnes de la table). */
function lireCible(db: Db, c: Cible | undefined, p: P): Ligne | null {
  if (!c) return null;
  const cle = c.cle(p, db);
  return cle == null ? null : db.get<Ligne>(c.table, cle) ?? null;
}

/** Anciennes et nouvelles valeurs des colonnes qui ont changé. */
function comparer(c: Cible, avant: Ligne | null, apres: Ligne | null): { avant: Ligne; apres: Ligne } | null {
  const a: Ligne = {}, b: Ligne = {};
  const paires: [string, unknown, unknown][] = c.aplatir
    ? c.colonnes.flatMap(col => {
      const x = (avant?.[col] ?? {}) as Ligne, y = (apres?.[col] ?? {}) as Ligne;
      return [...new Set([...Object.keys(x), ...Object.keys(y)])].map(k => [k, x[k], y[k]] as [string, unknown, unknown]);
    })
    : c.colonnes.map(col => [col, avant?.[col], apres?.[col]]);
  for (const [k, x, y] of paires) {
    if (JSON.stringify(x ?? null) === JSON.stringify(y ?? null)) continue;
    a[k] = x ?? null;
    b[k] = y ?? null;
  }
  return Object.keys(a).length || Object.keys(b).length ? { avant: a, apres: b } : null;
}

const entiers = (ids: unknown[]) => [...new Set(ids.map(Number).filter(n => Number.isInteger(n) && n > 0))];

// — Messages expurgés —

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Termes de santé : natures d'absence médicales (libellés, abrégés, motifs de reprise) et vaccins. */
const TERMES_SANTE = [...new Set([
  ...Object.values(NATURES_ABSENCE).filter(n => n.medicale).flatMap(n => [n.label, n.abrege, n.court, n.reprise ?? '']),
  ...Object.values(VACCINS).flatMap(v => [v.nom, v.nom.replace(/ \(.*\)/, ''), v.court]),
].filter(t => t.length > 2))].sort((a, b) => b.length - a.length);
const SANTE = new RegExp(`(?<![\\p{L}])(?:${TERMES_SANTE.map(echapper).join('|')})(?![\\p{L}])`, 'giu');
export const MENTION_SANTE = '[donnée de santé]';

/** Message tracé sans donnée de santé (nature médicale d'une absence, vaccin) : le RH la retrouve dans le dossier. */
export function expurgerMessage(m: string | null): string | null {
  return m == null ? null : m.replace(SANTE, MENTION_SANTE);
}

// — Écriture —

/** État lu avant une action : la ligne visée par la règle. */
export interface Trace { action: string; p: P; regle: Regle | undefined; avant: Ligne | null }

export function preparerTrace(db: Db, action: string, p: unknown): Trace {
  const regle = REGLES[action];
  const params = p && typeof p === 'object' ? (p as P) : {};
  return { action, p: params, regle, avant: lireCible(db, regle?.cible, params) };
}

/**
 * Trace une action réussie (dans sa transaction) : code, champs retenus, anciennes et nouvelles valeurs,
 * salariés concernés, message expurgé. Rien pour une saisie d'heures sur une feuille en brouillon.
 */
export function journaliserAction(db: Db, t: Trace, x: { user: CurrentUser; compte: Compte; message: string | null; result?: unknown }) {
  const { regle, p, avant } = t;
  const apres = lireCible(db, regle?.cible, p);
  if (regle?.tracer && !regle.tracer(avant, apres, p)) return;
  const code = regle?.code?.(avant) || t.action;
  const payload = champsRetenus(t.action, p, avant);
  const propres = regle?.changements?.(avant, apres, p, db) ?? null;
  const diff = propres ?? (regle?.cible ? comparer(regle.cible, avant, apres) : null);
  if (propres?.extra) Object.assign(payload, propres.extra);
  if (diff) Object.assign(payload, { avant: diff.avant, apres: diff.apres });
  const salaries = entiers([
    p.empId, avant?.empId, apres?.empId, ...(regle?.salaries?.(p, { db, user: x.user, avant, apres, result: x.result }) ?? []),
  ]);
  const message = expurgerMessage(propres?.message ?? x.message);
  if (regle?.regrouper && regrouper(db, regle.regrouper, code, x.compte.id, payload)) return;
  journaliser(db, { actor: x.user.nom, role: x.user.role, action: code, message, payload, compte: x.compte, salaries });
}

/** Ajoute la modification à la dernière ligne du même compte sur le même objet, si elle date de moins de `minutes`. */
function regrouper(db: Db, minutes: number, action: string, compteId: number, payload: Ligne): boolean {
  const depuis = new Date(Date.now() - minutes * 60_000).toISOString();
  const der = db.sql.prepare('SELECT id, payload FROM journal WHERE compte_id = ? AND action = ? AND at >= ? ORDER BY id DESC LIMIT 1')
    .get(compteId, action, depuis) as { id: number; payload: string } | undefined;
  const prec = der ? lireJson(der.payload) as Ligne : null;
  if (!der || !prec || prec.id !== payload.id) return false;
  const fusion: Ligne = { ...prec };
  for (const [k, v] of Object.entries(payload)) fusion[k] = Array.isArray(v) && Array.isArray(prec[k]) ? [...new Set([...prec[k], ...v])] : v;
  db.update('journal', der.id, { at: new Date().toISOString(), payload: fusion });
  return true;
}

/** Refus d'accès (403) d'une personne connectée : action ou écran réservé, motif ; rien n'a été modifié. */
export function tracerRefus(db: Db, id: Pick<Identite, 'user' | 'compte'>, quoi: string, motif: string, extra: { action?: string; p?: unknown } = {}) {
  const payload = { ...(extra.action ? { action: extra.action, ...champsRetenus(extra.action, extra.p as P) } : {}) };
  const p = (extra.p ?? {}) as P;
  journaliser(db, {
    actor: id.user.nom, role: id.user.role, action: 'acces.refuse', message: `${quoi} — ${expurgerMessage(motif)}`, payload, compte: id.compte,
    salaries: entiers([p.empId]),
  });
}

// — Conservation —

const ilYa = (maintenant: Date, mois: number) => { const d = new Date(maintenant); d.setMonth(d.getMonth() - mois); return d.toISOString(); };

export interface BilanConservation { supprimees: number; archivees: number; supprimeesArchive: number; envois: number }

/**
 * Applique les durées de conservation : au-delà de 3 ans, toute ligne est supprimée (archive comprise) ; au-delà
 * d'1 an, une action liée à la paie passe dans l'archive, les autres lignes (connexions comprises) sont supprimées.
 * Les envois réussis ou simulés de plus d'1 an quittent la file d'envoi. Une ligne résume ce qui a été fait.
 */
export function appliquerConservation(db: Db, maintenant = new Date()): BilanConservation {
  const un = ilYa(maintenant, CONSERVATION_JOURNAL_MOIS), trois = ilYa(maintenant, CONSERVATION_ARCHIVE_PAIE_MOIS);
  return db.tx(() => {
    const n = (sql: string, ...a: string[]) => Number(db.sql.prepare(sql).run(...a).changes);
    const supprimeesArchive = n('DELETE FROM journal WHERE at < ?', trois);
    const archivees = n('UPDATE journal SET archivee = ? WHERE paie = 1 AND archivee IS NULL AND at < ?', maintenant.toISOString(), un);
    const supprimees = n('DELETE FROM journal WHERE (paie IS NULL OR paie = 0) AND at < ?', un);
    const envois = purgerEnvois(db, ilYa(maintenant, CONSERVATION_ENVOIS_MOIS));
    const b = { supprimees, archivees, supprimeesArchive, envois };
    if (supprimees || archivees || supprimeesArchive || envois) {
      const parts = [
        supprimees && `${plural(supprimees, 'ligne supprimée', 'lignes supprimées')} (plus d’un an)`,
        archivees && `${plural(archivees, 'action liée à la paie archivée', 'actions liées à la paie archivées')}`,
        supprimeesArchive && `${plural(supprimeesArchive, 'ligne supprimée', 'lignes supprimées')} de l’archive (plus de 3 ans)`,
        envois && `${plural(envois, 'envoi ancien retiré', 'envois anciens retirés')} de la file d’envoi`,
      ].filter(Boolean);
      journaliser(db, { actor: 'Cursus', role: null, action: 'journal.conservation', message: `Durée de conservation : ${parts.join(' · ')}`, payload: b });
    }
    return b;
  });
}

/**
 * Lignes écrites avant la liste blanche (contenu complet de la requête : numéro de passeport, CSV, vaccins…) :
 * contenu réduit aux champs retenus, salariés concernés retrouvés, message expurgé, action de paie marquée.
 * Une seule fois par base (réglage `journalExpurge`), et seulement les lignes sans `salaries` : une ligne écrite
 * depuis (anciennes et nouvelles valeurs comprises) n'est jamais reprise, même après une réinitialisation de la
 * démonstration qui efface le réglage. Les lignes du système (connexions, appels et messages de Keystone)
 * n'ont jamais contenu de requête : leur contenu est gardé.
 */
export function reprendreJournal(db: Db) {
  if (db.getSetting<boolean>('journalExpurge', false)) return;
  db.tx(() => {
    const lignes = db.sql.prepare('SELECT id, action, message, payload FROM journal WHERE salaries IS NULL').all() as { id: number; action: string; message: string | null; payload: string | null }[];
    const maj = db.sql.prepare('UPDATE journal SET payload = ?, message = ?, salaries = ?, paie = ? WHERE id = ?');
    for (const l of lignes) {
      const p = (lireJson(l.payload) ?? {}) as P;
      const regle = REGLES[l.action];
      let payload: Ligne = p, salaries: number[] = [];
      if (regle) {
        const ligne = lireCible(db, regle.cible, p);
        payload = champsRetenus(l.action, p, null);
        salaries = entiers([p.empId, ligne?.empId, ...participants(p).map(x => x?.empId),
          ...(l.action === 'employe.modifier' ? [p.id] : [])]);
      } else if (!JOURNAL_LABEL[l.action] && !l.action.startsWith('keystone.')) payload = {};
      maj.run(JSON.stringify(payload), expurgerMessage(l.message), JSON.stringify(salaries), estActionPaie(l.action) ? 1 : 0, l.id);
    }
    db.setSetting('journalExpurge', true);
  });
}

/** Au démarrage : index, reprise des anciennes lignes, conservation appliquée puis relancée toutes les heures. */
export function demarrerJournal(db: Db) {
  db.sql.exec('CREATE INDEX IF NOT EXISTS journal_at ON journal (at)');
  db.sql.exec('CREATE INDEX IF NOT EXISTS journal_action ON journal (action)');
  reprendreJournal(db);
  const appliquer = () => { try { appliquerConservation(db); } catch (err) { console.error('Conservation du journal :', err); } };
  appliquer();
  setInterval(appliquer, 3600_000).unref();
}

// — Consultation —

const lireJson = (s: unknown): unknown => { try { return s == null ? null : JSON.parse(String(s)); } catch { return null; } };

export interface FiltreJournal {
  /** tout (sans les appels de Keystone), operations, connexions, keystone, archive (actions de paie archivées). */
  vue: 'tout' | 'operations' | 'connexions' | 'keystone' | 'archive';
  du: string | null; au: string | null;
  /** Personne : nom ou identifiant de l'auteur (contient). */
  auteur: string | null;
  /** Code exact, ou `famille:<id>` (FAMILLES_JOURNAL). */
  action: string | null;
  /** Salarié concerné. */
  salarie: number | null;
}

const VUES = ['tout', 'operations', 'connexions', 'keystone', 'archive'] as const;
const texte = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);

/** Filtres lus dans la requête ; une valeur invalide est ignorée. Ancien paramètre `filtre` accepté. */
export function lireFiltre(q: Record<string, unknown>): FiltreJournal {
  const vue = VUES.find(v => v === q.vue) ?? VUES.find(v => v === q.filtre) ?? 'tout';
  const date = (v: unknown) => (typeof v === 'string' && isValidDate(v) ? v : null);
  const salarie = Number(q.salarie);
  return { vue, du: date(q.du), au: date(q.au), auteur: texte(q.auteur), action: texte(q.action), salarie: Number.isInteger(salarie) && salarie > 0 ? salarie : null };
}

/** Début d'une journée à l'heure locale du serveur, en ISO (les horodatages du journal sont en UTC). */
const debutJour = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const like = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;

function clauses(f: FiltreJournal): { where: string; params: (string | number)[] } {
  const w: string[] = [], params: (string | number)[] = [];
  const liste = (xs: readonly string[]) => { params.push(...xs); return xs.map(() => '?').join(', '); };
  if (f.vue === 'archive') w.push('archivee IS NOT NULL');
  else {
    w.push('archivee IS NULL');
    if (f.vue === 'keystone') { w.push('action = ?'); params.push(ACTION_APPEL_KEYSTONE); }
    else {
      w.push('action <> ?');
      params.push(ACTION_APPEL_KEYSTONE);
      if (f.vue === 'connexions') w.push(`action IN (${liste(ACTIONS_CONNEXION)})`);
      if (f.vue === 'operations') w.push(`action NOT IN (${liste(ACTIONS_CONNEXION)})`);
    }
  }
  if (f.du) { w.push('at >= ?'); params.push(debutJour(f.du)); }
  if (f.au) { w.push('at < ?'); params.push(debutJour(addD(f.au, 1))); }
  if (f.auteur) { w.push(`(actor LIKE ? ESCAPE '\\' OR identifiant LIKE ? ESCAPE '\\')`); params.push(like(f.auteur), like(f.auteur)); }
  if (f.action?.startsWith('famille:')) {
    const fam = FAMILLES_JOURNAL.find(x => x.id === f.action!.slice(8));
    if (fam) {
      w.push(`(${fam.prefixes.map(p => (p.endsWith('.') ? `action LIKE ? ESCAPE '\\'` : 'action = ?')).join(' OR ')})`);
      params.push(...fam.prefixes.map(p => (p.endsWith('.') ? `${p.replace(/[\\%_]/g, '\\$&')}%` : p)));
    }
  } else if (f.action) { w.push('action = ?'); params.push(f.action); }
  if (f.salarie) { w.push('EXISTS (SELECT 1 FROM json_each(journal.salaries) WHERE value = ?)'); params.push(f.salarie); }
  return { where: w.length ? `WHERE ${w.join(' AND ')}` : '', params };
}

export interface LigneJournal {
  id: number; at: string; actor: string; role: string | null; action: string; message: string | null; identifiant: string | null;
  salaries: number[]; details: Ligne; archivee: string | null;
}

const COLONNES = 'id, at, actor, role, action, message, identifiant, payload, salaries, archivee';
const decoder = (r: Ligne): LigneJournal => ({
  id: r.id, at: r.at, actor: r.actor, role: r.role ?? null, action: r.action, message: r.message ?? null, identifiant: r.identifiant ?? null,
  salaries: (lireJson(r.salaries) as number[] | null) ?? [], details: (lireJson(r.payload) as Ligne | null) ?? {}, archivee: r.archivee ?? null,
});

export const TAILLE_PAGE = 50;
export const TAILLE_MAX = 200;
/** Lignes au plus dans un export CSV. */
export const EXPORT_MAX = 100_000;

/** Page de lignes filtrées, les plus récentes d'abord, et nombre total de lignes du filtre. */
export function lireJournal(db: Db, f: FiltreJournal, page = 1, taille = TAILLE_PAGE) {
  const { where, params } = clauses(f);
  const total = Number((db.sql.prepare(`SELECT COUNT(*) AS n FROM journal ${where}`).get(...params) as { n: number }).n);
  const lignes = (db.sql.prepare(`SELECT ${COLONNES} FROM journal ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, taille, (page - 1) * taille) as Ligne[]).map(decoder);
  return { lignes, total, page, taille };
}

/**
 * Cellule CSV (séparateur « ; ») : une valeur qui commence par =, +, -, @ (ou une tabulation, un retour) serait
 * exécutée comme formule par le tableur ; elle est précédée d'une apostrophe.
 */
export function celluleCsv(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const ROLE_LABEL: Record<string, string> = { ...ESPACE_LABEL, rh: 'Service RH', integration: 'Intégration' };

/** Fichier CSV du journal (UTF-8 avec BOM pour Excel) : une ligne par entrée, libellés français. */
export function csvJournal(db: Db, lignes: LigneJournal[]): string {
  const noms = new Map((db.sql.prepare('SELECT id, nom FROM employes').all() as { id: number; nom: string }[]).map(e => [e.id, e.nom]));
  const tete = ['Date', 'Heure', 'Auteur', 'Identifiant', 'Espace', 'Action', 'Code', 'Salariés concernés', 'Message', 'Anciennes et nouvelles valeurs', 'Détail', 'Archivée le'];
  const corps = lignes.map(l => {
    const d = new Date(l.at);
    return [
      d.toLocaleDateString('fr-FR'), d.toLocaleTimeString('fr-FR'), l.actor, l.identifiant, l.role ? ROLE_LABEL[l.role] ?? l.role : '', libelleAction(l.action), l.action,
      l.salaries.map(id => `${noms.get(id) ?? 'salarié supprimé'} (${matricule(id)})`).join(', '), l.message, changementsTexte(l.details),
      Object.keys(l.details).length ? JSON.stringify(l.details) : '', l.archivee ? new Date(l.archivee).toLocaleDateString('fr-FR') : '',
    ];
  });
  return '﻿' + [tete, ...corps].map(r => r.map(celluleCsv).join(';')).join('\r\n') + '\r\n';
}

/** Filtres appliqués, en clair (ligne de journal d'un export ou d'une consultation de l'archive). */
function filtresTexte(db: Db, f: FiltreJournal): string {
  const parts = [
    f.vue !== 'tout' && { operations: 'opérations', connexions: 'connexions', keystone: 'appels de Keystone', archive: 'archive paie' }[f.vue],
    f.du && `depuis le ${fmtIso(f.du)}`, f.au && `jusqu’au ${fmtIso(f.au)}`, f.auteur && `auteur « ${f.auteur} »`,
    f.action && `action ${f.action.startsWith('famille:') ? FAMILLES_JOURNAL.find(x => x.id === f.action!.slice(8))?.label ?? f.action : libelleAction(f.action)}`,
    f.salarie && `salarié ${nomSalarie(db, f.salarie)}`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'aucun filtre';
}

/** Journal consultable : tout profil de l'espace RH (gestionnaire, administrateur, et profils en lecture seule). */
export const lecteurJournal = (u: CurrentUser) => u.role === 'rh';

/** Personne connectée autorisée, ou réponse 401 / 403 (le refus d'une personne connectée est tracé). */
export function exigerRh(db: Db, req: Request, res: Response, quoi: string): Identite | null {
  const id = identite(db, req);
  if (!id) { res.status(401).json({ error: 'Connexion requise' }); return null; }
  if (!lecteurJournal(id.user)) {
    tracerRefus(db, id, quoi, 'réservé au service RH');
    res.status(403).json({ error: 'Réservé au service RH' });
    return null;
  }
  return id;
}

/** Fichier joint à télécharger (jamais mis en cache : données personnelles). */
export function fichierJoint(res: Response, type: string, nom: string, contenu: string) {
  res.set({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${nom}"`, 'Cache-Control': 'no-store' });
  res.send(contenu);
}

const jourLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Routes du journal : consultation, export CSV, trace des exports faits par l'interface. */
export function routesJournal(db: Db): Router {
  const r = express.Router();

  r.get('/api/journal', (req, res) => {
    const id = exigerRh(db, req, res, 'Journal des actions');
    if (!id) return;
    const f = lireFiltre(req.query as Record<string, unknown>);
    const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
    const taille = Math.min(TAILLE_MAX, Math.max(1, Math.floor(Number(req.query.taille)) || TAILLE_PAGE));
    const out = lireJournal(db, f, page, taille);
    // L'archive n'apparaît qu'à la demande : chaque consultation (première page) est tracée.
    if (f.vue === 'archive' && page === 1) {
      journaliser(db, { actor: id.user.nom, role: id.user.role, action: 'journal.archive', message: `Consultation de l’archive paie — ${plural(out.total, 'ligne', 'lignes')} (${filtresTexte(db, f)})`, compte: id.compte, salaries: f.salarie ? [f.salarie] : [] });
    }
    res.json(out);
  });

  r.get('/api/journal/csv', (req, res) => {
    const id = exigerRh(db, req, res, 'Export du journal');
    if (!id) return;
    const f = lireFiltre(req.query as Record<string, unknown>);
    const { lignes, total } = lireJournal(db, f, 1, EXPORT_MAX);
    journaliser(db, {
      actor: id.user.nom, role: id.user.role, action: 'journal.export', compte: id.compte, salaries: f.salarie ? [f.salarie] : [],
      message: `Export CSV du journal — ${plural(lignes.length, 'ligne', 'lignes')}${total > lignes.length ? ` sur ${total}` : ''} (${filtresTexte(db, f)})`,
    });
    fichierJoint(res, 'text/csv; charset=utf-8', `journal${f.vue === 'archive' ? '-archive-paie' : ''}-${jourLocal()}.csv`, csvJournal(db, lignes));
  });

  // Exports et impressions produits par le navigateur (CSV des échéances, liste d'une session, passeport formation,
  // compte rendu d'entretien) : l'interface les signale ici pour qu'ils figurent au journal.
  r.post('/api/exports', (req, res) => {
    const id = identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    const b = (req.body ?? {}) as P;
    const titre = typeof b.titre === 'string' ? b.titre.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 160) : '';
    if (!titre) return res.status(400).json({ error: 'Export sans titre' });
    const lignes = Number.isInteger(b.lignes) && b.lignes >= 0 ? b.lignes as number : null;
    // Salarié concerné : seulement dans le périmètre de la personne (une trace ne s'ajoute pas à une fiche étrangère).
    const empId = Number(b.empId);
    const dans = Number.isInteger(empId) && empId > 0 && (id.user.role === 'rh' ? !!db.get('employes', empId) : scopeIds(new Domain(loadFull(db, id.user)), id.user).includes(empId));
    journaliser(db, {
      actor: id.user.nom, role: id.user.role, action: 'export', compte: id.compte, salaries: dans ? [empId] : [],
      message: `${b.nature === 'impression' ? 'Impression' : 'Export CSV'} : ${expurgerMessage(titre)}${lignes != null ? ` (${plural(lignes, 'ligne', 'lignes')})` : ''}`,
      payload: { nature: b.nature === 'impression' ? 'impression' : 'csv', ...(lignes != null ? { lignes } : {}) },
    });
    res.status(204).end();
  });

  return r;
}
