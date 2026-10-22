// Journal des actions (table `journal`) : ce qui y est écrit, combien de temps il est gardé, sa consultation.
// - Liste blanche par action (REGLES) : du paramètre reçu, seuls des identifiants, codes, dates et statuts
//   sont recopiés, avec les anciennes et nouvelles valeurs utiles de la ligne modifiée. Jamais de numéro de
//   passeport, de mot de passe, de CSV importé, de texte libre (motifs, comptes rendus) ni de donnée de santé :
//   les messages sont expurgés des natures d'absence, médicales ou non (un même terme neutre, pour qu'aucune
//   ne se déduise du marqueur), et des vaccins. Une action sans règle ne recopie aucun champ.
// - Salariés concernés (`salaries`) : historique de la fiche, filtre « salarié », export de ses données.
// - Conservation (décision de l'entreprise, shared/journal.ts) : 1 an pour tout ; les actions liées à la
//   paie passent alors dans une archive, hors de l'écran, que le service RH consulte sur demande, et sont
//   supprimées au bout de 3 ans. Les envois anciens de la file d'envoi sont purgés en même temps.
// - Consultation (droit « rh », ou « consultation » d'un profil en lecture seule, qui ne voit pas le détail des
//   actions touchant à la santé) : filtres, pagination, export CSV (formules neutralisées), archive ; l'export
//   et chaque consultation de l'archive sont tracés.
import express, { type Request, type Response, type Router } from 'express';
import { ESPACE_LABEL, NATURES_ABSENCE, TS_LABEL, VACCINS } from '../../shared/constants.ts';
import { addD, debutJourParis, isFerie, isValidDate } from '../../shared/dates.ts';
import { Domain } from '../../shared/domain.ts';
import { fmtIso, num, plural } from '../../shared/format.ts';
import { erreurReference } from '../../shared/rules/lots-paie.ts';
import { matriculeAffiche } from '../../shared/rules/matricules.ts';
import { estTypeTitre } from '../../shared/rules/contrats.ts';
import { estDemi } from '../../shared/rules/demi-journees.ts';
import { estObjetPiece } from '../../shared/rules/pieces.ts';
import {
  ACTION_APPEL_KEYSTONE, ACTIONS_CONNEXION, ACTIONS_PAIE, changementsTexte, CONSERVATION_ARCHIVE_PAIE_MOIS, CONSERVATION_ENVOIS_MOIS,
  CONSERVATION_JOURNAL_MOIS, dossierComplet, estActionPaie, familleAction, FAMILLES_JOURNAL, JOURNAL_LABEL, lecteurJournal, libelleAction,
} from '../../shared/journal.ts';
import { CODE_PAYS, CODE_TITRE, codeDestination, codeTitre, type ReferentielId } from '../../shared/rules/referentiels.ts';
import { estTypeReprise } from '../../shared/rules/reprise.ts';
import { CODE_ACTIVITE, normaliserCodeActivite } from '../../shared/rules/activites.ts';
import { CODE_HORAIRE, normaliserCodeHoraire } from '../../shared/rules/horaires.ts';
import { reglageAnnee } from '../../shared/rules/feries.ts';
import { estTypeDerogation, JOURS_FEUILLE } from '../../shared/rules/semaine.ts';
import { controlesMineur } from '../../shared/rules/mineurs.ts';
import { lignesCouverture } from '../../shared/rules/couverture.ts';
import { corDeLaFeuille } from '../../shared/rules/temps.ts';
import type { CalendrierFeries, ClotureConges, CurrentUser, Employe, FeuilleTemps, InformationCp, LigneTemps } from '../../shared/types.ts';
import type { ContactsConfidentialite } from '../../shared/confidentialite.ts';
import { journaliser, type Compte } from './comptes.ts';
import { lireConfidentialite } from './confidentialite.ts';
import { identite, type Identite } from './connexion.ts';
import { loadFull, scopeIds } from './dataset.ts';
import { type Db, enSerie, jsonLu, type TableName } from './db.ts';
import { purgerEnvois } from './envois.ts';
import { copieAvantMigration } from './sauvegarde.ts';

type P = Record<string, any>;
type Ligne = Record<string, any>;

// — Liste blanche par action —

interface Cible {
  table: TableName;
  /** Clé de la ligne modifiée par l'action (null : aucune). */
  cle: (p: P, db: Db) => unknown;  // valeur, ou promesse de la valeur (lecture en base)
  /** Colonnes dont les anciennes et nouvelles valeurs sont tracées. `aplatir` : objet JSON comparé clé par clé. */
  colonnes: readonly string[];
  aplatir?: boolean;
  /**
   * Champs de texte libre, comparés mais jamais recopiés : seul le fait qu'ils soient renseignés est tracé
   * (MENTION_TEXTE), par exemple la référence de l'accord des heures supplémentaires dans les réglages.
   */
  masques?: readonly string[];
}

/** Ce que la règle sait de l'action : ligne visée avant et après, état lu avant l'action (`etat`), résultat. */
interface Contexte { db: Db; user: CurrentUser; avant: Ligne | null; apres: Ligne | null; etat: unknown; result: unknown }

type Changements = { avant: Ligne; apres: Ligne; extra?: Ligne; message?: string };

interface Regle {
  /** Champs du paramètre recopiés tels quels ; fonction quand ils dépendent du contenu (formalités). */
  champs?: readonly string[] | ((p: P) => readonly string[]);
  /** Valeurs calculées ajoutées au contenu tracé (jamais de texte libre). */
  extra?: (p: P, avant: Ligne | null) => Ligne;
  /** Ligne modifiée : ses colonnes sont lues avant et après l'action. */
  cible?: Cible;
  /**
   * État lu avant l'action, en plus de la ligne visée, quand l'action le modifie : inscrits d'une session (une
   * annulation détache les recyclages rattachés), feuilles à transmettre à la paie, dernier déplacement avant un import.
   */
  etat?: (db: Db, p: P) => unknown;  // valeur, ou promesse attendue avant l'action
  /** Valeurs lues après l'action (feuilles transmises, total d'heures), ajoutées au contenu tracé. */
  bilan?: (p: P, x: Contexte) => Ligne | Promise<Ligne>;
  /** Salariés concernés, en plus de `empId` (paramètre, ou ligne modifiée). */
  salaries?: (p: P, x: Contexte) => unknown[] | Promise<unknown[]>;
  /** Tracée seulement si… (saisie d'heures : modification par le manager ou le service RH). */
  tracer?: (p: P, x: Contexte) => boolean | Promise<boolean>;
  /** Code inscrit au journal à la place du nom de l'action (correction d'heures) ; vide : le nom de l'action. */
  code?: (p: P, x: Contexte) => string | Promise<string>;
  /** Anciennes et nouvelles valeurs propres à l'action, à la place de la comparaison des colonnes ; message éventuel. */
  changements?: (p: P, x: Contexte) => Changements | null | Promise<Changements | null>;
  /** Modifications successives du même objet par le même compte regroupées sur une ligne pendant N minutes. */
  regrouper?: number;
}

const parId = (table: TableName, colonnes: readonly string[]): Cible => ({ table, cle: p => Number(p.id) || null, colonnes });
/** Hiérarchie (t136) : éléments en attente redirigés (`result.redirections`) : type, identifiant, ancien et nouveau valideur (0 : service RH). */
const redirigesDe = (result: unknown): Ligne[] => (result as { redirections?: Ligne[] } | null)?.redirections ?? [];
const bilanRedirections = (result: unknown): Ligne => {
  const r = redirigesDe(result);
  return r.length ? { redirections: r.map(e => ({ kind: e.kind, id: e.id, avant: e.avant, apres: e.apres })) } : {};
};
const salariesRediriges = (result: unknown): unknown[] => redirigesDe(result).map(e => e.empId);
/**
 * Élément d'un référentiel, désigné par `id` (modification, archivage) ou `code` (création) et normalisé comme l'action :
 * son code, recopié seulement s'il en a la forme (jamais un texte libre), et ses colonnes avant et après. `archiver` :
 * archivage, ou rétablissement (`retablir`), sans recopier la valeur reçue.
 */
function referentiel(table: ReferentielId, colonnes: readonly string[], archiver = false): Partial<Regle> {
  const [normaliser, motif] = table === 'destinations' ? [codeDestination, CODE_PAYS] : [codeTitre, CODE_TITRE];
  const code = (p: P) => {
    const c = normaliser(p.id != null && p.id !== '' ? p.id : p.code);
    return motif.test(c) ? c : null;
  };
  return { extra: p => ({ code: code(p), ...(archiver ? { retablir: p.archive === false } : {}) }), cible: { table, cle: code, colonnes } };
}
/** Activité interne visée (`id` : modification, archivage ; `code` : création), recopiée seulement si c'est un code d'activité. */
const codeActivite = (p: P) => {
  const c = normaliserCodeActivite(p.id != null && p.id !== '' ? p.id : p.code);
  return CODE_ACTIVITE.test(c) ? c : null;
};
/** Horaire de poste visé (`id` : modification, archivage ; `code` : création, choix du jour), recopié seulement si c'est un code. */
const codeHoraire = (p: P, champ: 'id' | 'code' = 'id') => {
  const c = normaliserCodeHoraire(champ === 'id' && p.id != null && p.id !== '' ? p.id : p.code);
  return CODE_HORAIRE.test(c) ? c : null;
};
/** Horaire du jour d'une feuille (lu avant et après `temps.horaire`) : code, « aucun » ou non choisi (null). */
const horaireDuJour = (f: Ligne | null, p: P) => ((f?.horaires ?? []) as (string | null)[])[Number(p.di)] ?? null;
/** Réglage des fériés d'une année, sans auteur ni motif (texte libre) : modalité, férié de solidarité, fériés non chômés. */
const feriesDeLAnnee = async (db: Db, annee: unknown) => {
  const { solidarite, solidariteFerie, nonChomes } = reglageAnnee(await db.getSetting<CalendrierFeries>('calendrierFeries', {}), Number(annee));
  return { solidarite, solidariteFerie, nonChomes };
};
/** Salariés dont un titre change de statut avec la règle modifiée (résultat de l'action). */
const salariesTouches = (x: Contexte) => (x.result as { salaries?: unknown[] } | null | undefined)?.salaries ?? [];
/** Référentiel désigné (`referentiel.charger`), seulement s'il en est un : jamais la valeur reçue telle quelle. */
const referentielRecu = (p: P): ReferentielId | null => (['formations', 'habilitations', 'destinations'].includes(p.referentiel) ? p.referentiel : null);
const nombreReferentiel = async (db: Db, p: P) => { const r = referentielRecu(p); return r ? await db.count(r) : 0; };
const FICHE = [
  'nom', 'poste', 'posteId', 'equipe', 'statut', 'typeContrat', 'temps', 'heures', 'forfaitHeures', 'forfaitJours', 'jourOff', 'tempsDepuis', 'entree', 'fin',
  'motifSortie', 'essaiFin', 'essaiRenouveleJusquau', 'agence', 'matriculePaie', 'derogationTravauxLe', 'motifRecours', 'cddFinInitiale',
];
/**
 * Solde de RTT de l'année affiché avant un changement de régime qui ne le couvre plus (garde-fou de `employe.modifier`) :
 * gardé au journal pour la paie, avec le nouveau droit au prorata et les jours posés après la date d'effet, sous un code
 * de l'archive paie (`employe.rtt`).
 */
const soldeRttGarde = (x: Contexte) => (x.result as { soldeRtt?: Ligne } | null)?.soldeRtt ?? null;
const FEUILLE: Cible = {
  table: 'feuilles', colonnes: ['statut'],
  cle: async (p, db) => (await db.one('SELECT id FROM feuilles WHERE emp_id = ? AND week = ?', [Number(p.empId) || 0, String(p.week ?? '')]) as { id: number } | undefined)?.id ?? null,
};
const totalHeures = (f: Ligne | null) => ((f?.lignes ?? []) as LigneTemps[]).reduce((n, l) => n + l.h.reduce((a, b) => a + num(b), 0), 0);
const heuresTexte = (h: number) => `${String(Math.round(h * 100) / 100).replace('.', ',')} h`;
const nomSalarie = async (db: Db, id: unknown) => (await db.get<{ nom: string }>('employes', Number(id)))?.nom ?? `salarié n° ${id}`;
/** Statut de la feuille avant la saisie (une feuille créée par la saisie est un brouillon). */
const statutFeuille = (f: Ligne | null) => String(f?.statut ?? 'brouillon');

/**
 * Heures saisies par quelqu'un d'autre que le salarié (son manager, le service RH), quel que soit le statut de la
 * feuille : soumise, mais aussi renvoyée ou en brouillon, qu'un valideur peut modifier puis soumettre lui-même.
 */
const parAutrui = (p: P, u: CurrentUser) => u.empId !== (Number(p.empId) || null);
/** Ligne ajoutée, retirée ou proposée par autrui qui change le total d'heures : correction (total avant et après). */
const corrigeTotal = (p: P, x: Contexte) => parAutrui(p, x.user) && totalHeures(x.avant) !== totalHeures(x.apres);
const ligneTemps: Partial<Regle> = {
  cible: FEUILLE,
  code: (p, x) => (corrigeTotal(p, x) ? 'temps.correction' : ''),
  changements: (p, x) => (corrigeTotal(p, x)
    ? { avant: { heures: totalHeures(x.avant) }, apres: { heures: totalHeures(x.apres) }, extra: { feuille: statutFeuille(x.avant) } } : null),
};
/**
 * Dépassement des durées maximales motivé : le fait que le motif soit renseigné, jamais son texte ; salarié mineur
 * (décision de l'entreprise du 17 octobre 2026 : motif ou référence de dérogation tracé au journal), contrôles en cause.
 */
async function depassementTrace(p: P, x: Contexte): Promise<Ligne> {
  if (!x.apres?.motifDepassement) return {};
  const e = await x.db.get<Employe>('employes', Number(p.empId) || 0);
  const lignes = (x.apres.lignes ?? []) as LigneTemps[];
  const perDay = Array.from({ length: JOURS_FEUILLE }, (_, i) => lignes.reduce((n, l) => n + num(l.h[i]), 0));
  const codes = e ? controlesMineur(e, String(x.apres.week ?? ''), perDay).codes.filter(c => c === 'jour_8h' || c === 'semaine_35h') : [];
  return { motifDepassement: MENTION_TEXTE, ...(codes.length ? { depassementMineur: codes } : {}) };
}
/** Soumission, validation : statut avant et après, et total d'heures de la feuille (ce qui part en paie). */
const statutEtTotal: Partial<Regle> = { cible: FEUILLE, bilan: async (p, x) => ({ heures: totalHeures(x.apres), ...await depassementTrace(p, x) }) };

/** Inscrits avant et après l'action : une annulation ou des places retirées détachent des recyclages rattachés. */
const inscritsAvantApres: Partial<Regle> = { etat: async (db, p) => await inscrits(db, p.id), salaries: async (p, x) => [...(x.etat as number[]), ...await inscrits(x.db, p.id)] };

/**
 * Lot de paie renvoyé par l'action (`paie.lot…`, `temps.pushSage`) : son numéro, ses feuilles `{ empId, week }` et ses
 * absences (identifiants seuls : ni nature, ni rubrique, qui en révèlerait la catégorie) ; soldes de sortie (identifiants).
 */
const lotDuResultat = (x: Contexte) => x.result as {
  lot?: number; feuilles?: { empId: number; week: string }[]; absences?: { id: number; empId: number }[]; sorties?: { id: number; empId: number }[];
  deplacements?: { source?: string; id: number; empId: number }[];
  correctifs?: { empId: number; week: string }[];
} | null | undefined;
const lotRetenu = (x: Contexte) => {
  const r = lotDuResultat(x);
  return {
    lot: r?.lot ?? null, feuilles: r?.feuilles ?? [], ...(r?.absences?.length ? { absences: r.absences.map(a => a.id) } : {}),
    ...(r?.correctifs?.length ? { correctifs: r.correctifs } : {}),
    ...(r?.sorties?.length ? { sorties: r.sorties.map(s => s.id) } : {}),
    // Séjours du lot (t031) : identifiants seuls (mission ou déplacement), jamais les quantités ni le pays.
    ...(r?.deplacements?.length ? { deplacements: r.deplacements.map(s => `${s.source}:${s.id}`) } : {}),
  };
};
const salariesDuLot = (x: Contexte) => [...new Set([
  ...(lotDuResultat(x)?.feuilles ?? []).map(f => f.empId), ...(lotDuResultat(x)?.absences ?? []).map(a => a.empId), ...(lotDuResultat(x)?.sorties ?? []).map(a => a.empId),
  ...(lotDuResultat(x)?.deplacements ?? []).map(a => a.empId),
])];
/** Feuilles transmises à la paie : validées et non transmises avant l'action, marquées transmises après. */
const transmises = async (x: Contexte) => (await Promise.all((x.etat as number[]).map(id => x.db.get<FeuilleTemps>('feuilles', id)))).filter((f): f is FeuilleTemps => !!f?.sage);
/** Lignes de clôture des congés créées par l'action (identifiants au-delà du dernier d'avant l'action). */
const cloturees = async (x: Contexte) => Promise.all((await x.db.query('SELECT id FROM clotures WHERE id > ? ORDER BY id', [Number(x.etat) || 0]) as { id: number }[])
  .map(async r => (await x.db.get<ClotureConges>('clotures', r.id))!));
/**
 * Jours rendus à une période de CP close par un refus ou une annulation : reports reçus créés par l'action (identifiants
 * au-delà du dernier d'avant), tracés par leurs jours, période et échéance — jamais leur motif.
 */
const reportsRendus: Partial<Regle> = {
  etat: async db => Number((await db.one('SELECT MAX(id) AS n FROM reports') as { n: number | null }).n ?? 0),
  bilan: async (_p, x) => {
    const l = await x.db.query('SELECT id, jours, periode, expire FROM reports WHERE id > ? ORDER BY id', [Number(x.etat) || 0]) as Ligne[];
    return l.length ? { reportsRendus: l.map(r => ({ id: r.id, jours: r.jours, periode: r.periode, expire: r.expire })) } : {};
  },
};
/** Salariés des déplacements créés par un import (identifiants au-delà du dernier d'avant l'action). */
const importes = async (x: Contexte) => (await x.db.query('SELECT emp_id AS e FROM voyages WHERE id > ? ORDER BY id', [Number(x.etat) || 0]) as { e: number }[]).map(r => r.e);

export const REGLES: Record<string, Regle> = {
  // Fiches et équipes
  // Réembauche : réutilisation d'un matricule de paie confirmée par l'administrateur RH (`reutiliserMatricule`).
  'employe.creer': {
    champs: ['equipe', 'poste', 'statut', 'typeContrat', 'temps', 'entree', 'fin', 'motifSortie', 'essaiFin', 'essaiRenouveleJusquau', 'matriculePaie', 'reutiliserMatricule', 'motifRecours', 'cddFinInitiale'], salaries: (_p, x) => [(x.result as { id?: number } | null)?.id],
    // Poste du référentiel retenu (choisi, rattaché d'après l'intitulé ou créé) : lu sur la fiche créée.
    bilan: async (_p, x) => ({ posteId: (await x.db.get<{ posteId: number | null }>('employes', Number((x.result as { id?: number } | null)?.id)))?.posteId ?? null }),
  },
  // Les champs modifiés sont nommés ; seules les colonnes de FICHE ont leurs valeurs (ni visite médicale, ni reprise, ni année ou date de naissance).
  // Les valeurs d'origine envoyées pour le contrôle des modifications concurrentes (`avant`) ne sont jamais recopiées.
  'employe.modifier': {
    champs: ['id', 'reutiliserMatricule'], extra: p => ({ champsModifies: Object.keys(p).filter(k => k !== 'id' && k !== 'confirmerRtt' && k !== 'reutiliserMatricule' && k !== 'avant' && /^[A-Za-z]{1,40}$/.test(k)).slice(0, 30) }),
    cible: parId('employes', FICHE), salaries: p => [p.id],
    code: (_p, x) => (soldeRttGarde(x) ? 'employe.rtt' : ''),
    // Avenant programmé à une date future (t074) : identifiant de la ligne de l'historique des contrats et sa date d'effet.
    bilan: (_p, x) => {
      const s = soldeRttGarde(x), a = (x.result as { avenant?: { id: number; effet: string } } | null)?.avenant;
      return { ...(s ? { soldeRtt: { annee: s.annee, droit: s.droit, pris: s.pris, poses: s.poses, solde: s.solde, effet: s.effet, nouveauDroit: s.nouveauDroit, apresEffet: s.apresEffet } } : {}), ...(a ? { avenant: { id: a.id, effet: a.effet } } : {}) };
    },
  },
  // Renouvellement d'un CDD (t053) : nouveau terme, date de signature, fin et terme initial avant et après, nombre de
  // renouvellements ; la référence de l'avenant (texte du service RH) n'est jamais recopiée, seulement le fait qu'elle soit donnée.
  'employe.renouvelerCdd': {
    champs: ['id'], salaries: p => [p.id],
    extra: p => ({ jusquau: isValidDate(p.jusquau) ? p.jusquau : null, signeLe: isValidDate(p.signeLe) ? p.signeLe : null, ...(typeof p.reference === 'string' && p.reference.trim() ? { reference: MENTION_TEXTE } : {}) }),
    cible: parId('employes', ['fin', 'cddFinInitiale']),
    bilan: (_p, x) => { const r = x.result as { ligne?: number; renouvellements?: number } | null; return { ligne: r?.ligne ?? null, renouvellements: r?.renouvellements ?? null }; },
  },
  // Annulation d'un avenant programmé : la ligne de l'historique, son salarié et sa date d'effet.
  'employe.annulerAvenant': {
    champs: ['id'], salaries: (_p, x) => [(x.result as { empId?: number } | null)?.empId],
    bilan: (_p, x) => ({ effet: (x.result as { effet?: string } | null)?.effet ?? null }),
  },
  // Sortie : date et motif (code de la liste fermée), nombre d'éléments annulés, identifiant du solde de sortie photographié
  // (ses quantités sont dans le message) ; jamais le détail d'une absence.
  'employe.sortie': {
    champs: ['id', 'date', 'motif'], cible: parId('employes', ['fin', 'motifSortie']), salaries: p => [p.id],
    bilan: (_p, x) => {
      const r = x.result as { annulations?: Ligne; soldeSortie?: number } | null;
      return { ...(r?.annulations ?? {}), ...(r?.soldeSortie ? { soldeSortie: r.soldeSortie } : {}) };
    },
  },
  'employe.annulerSortie': { champs: ['id'], cible: parId('employes', ['fin', 'motifSortie']), salaries: p => [p.id] },
  // Titre de séjour : type, expiration, demande d'authentification et vérification en préfecture, avant et après ; jamais
  // le numéro (masqué : seul le fait qu'il change est tracé). Des valeurs reçues, seules celles qui ont la forme d'un code
  // ou d'une date sont recopiées, et seulement pour un titre requis (sinon l'action les ignore) : jamais de texte libre.
  'employe.autorisationTravail': {
    champs: ['id', 'requise'], salaries: p => [p.id],
    extra: p => (p.requise !== true ? {} : {
      type: estTypeTitre(p.type) ? p.type : null,
      expire: p.type !== 'resident_permanent' && isValidDate(p.expire) ? p.expire : null,
      demandeLe: isValidDate(p.demandeLe) ? p.demandeLe : null,
      verifieLe: isValidDate(p.verifieLe) ? p.verifieLe : null,
    }),
    cible: { ...parId('employes', ['autorisationTravail']), aplatir: true, masques: ['numero'] },
  },
  'equipe.creer': { champs: ['nom', 'managerId'], salaries: p => [p.managerId] },
  'equipe.renommer': { champs: ['nom', 'nouveau'] },
  'equipe.supprimer': { champs: ['nom'] },
  // Renommage et manager en une action : nom et manager avant et après (l'équipe est relue sous son nouveau nom).
  'equipe.modifier': {
    champs: ['nom', 'nouveau', 'managerId'], cible: { table: 'equipes', cle: p => String(p.nom ?? ''), colonnes: ['nom', 'managerId'] },
    changements: async (p, x) => {
      const apres = await x.db.get<Ligne>('equipes', String(p.nouveau || p.nom || '')) ?? null;
      const avant: Ligne = {}, nouv: Ligne = {};
      for (const c of ['nom', 'managerId']) {
        if (JSON.stringify(x.avant?.[c] ?? null) === JSON.stringify(apres?.[c] ?? null)) continue;
        avant[c] = x.avant?.[c] ?? null;
        nouv[c] = apres?.[c] ?? null;
      }
      return Object.keys(avant).length ? { avant, apres: nouv } : null;
    },
    bilan: (_p, x) => bilanRedirections(x.result),
    salaries: (p, x) => [p.managerId, x.avant?.managerId, ...salariesRediriges(x.result)],
  },
  // Hiérarchie (t136) : éléments en attente des managers d'équipes rattachées, redirigés vers le nouveau manager.
  'equipe.manager': {
    champs: ['nom', 'managerId'], cible: { table: 'equipes', cle: p => String(p.nom ?? ''), colonnes: ['managerId'] },
    bilan: (_p, x) => bilanRedirections(x.result),
    salaries: (p, x) => [p.managerId, x.avant?.managerId, ...salariesRediriges(x.result)],
  },
  'equipe.affecter': { champs: ['empId', 'equipe'], cible: { table: 'employes', cle: p => Number(p.empId) || null, colonnes: ['equipe'] } },
  // Équipe parente (t136) : avant et après, et éléments en attente redirigés (type, identifiant, ancien et nouveau valideur,
  // 0 pour le service RH) ; salariés concernés : ceux des éléments redirigés.
  'equipe.parente': {
    champs: ['nom', 'parente'], cible: { table: 'equipes', cle: p => String(p.nom ?? ''), colonnes: ['parente'] },
    bilan: (_p, x) => bilanRedirections(x.result),
    salaries: (_p, x) => salariesRediriges(x.result),
  },
  // Formations
  'plan.inscrire': { champs: ['empId', 'certId', 'inscriptionId', 'sessionId', 'conv'] },
  'cert.ajouter': { champs: ['empId', 'f', 'date'] },
  // Corrections d'une saisie erronée (actions/corrections.ts) : formation, date et session avant et après ; annulation :
  // la certification annulée (formation, date) et sa date d'annulation. Jamais le motif (texte libre).
  'cert.modifier': { champs: ['id'], cible: parId('certifications', ['f', 'obtenue', 'sessionId']) },
  'cert.annuler': { champs: ['id'], extra: (_p, av) => ({ f: av?.f ?? null, obtenue: av?.obtenue ?? null }), cible: parId('certifications', ['annuleLe', 'sessionId']) },
  // Session sur plusieurs jours : dernier jour et jours, dates seules (comme session.modifier) ; pas les horaires.
  'session.creer': {
    champs: ['f', 'date', 'lieu', 'places', 'planId'],
    extra: p => ({
      ...(typeof p.fin === 'string' && isValidDate(p.fin) ? { fin: p.fin } : {}),
      ...(Array.isArray(p.jours) ? { jours: p.jours.filter(j => typeof j === 'string' && isValidDate(j)).slice(0, 31) } : {}),
    }),
  },
  'session.confirmer': { champs: ['id'], cible: parId('sessions', ['statut']), ...inscritsAvantApres },
  // Session sur plusieurs jours : ses jours (dates, premier et dernier compris), pas les horaires.
  'session.modifier': { champs: ['id'], cible: parId('sessions', ['date', 'jours', 'lieu', 'places', 'statut']), ...inscritsAvantApres },
  'session.annuler': { champs: ['id'], cible: parId('sessions', ['statut']), ...inscritsAvantApres },
  // Résultats de chaque inscrit (présent, reçu) ; ni la note ni le commentaire de l'évaluation à chaud.
  'session.cloturer': {
    // Le coût réel saisi n'est pas recopié : il n'est contrôlé que si la clôture réalise une action du plan, dont la trace
    // (planActions) le porte alors. Sinon ce serait un texte libre.
    champs: ['id'], cible: parId('sessions', ['statut']),
    extra: p => ({ participants: participants(p).map((x: P) => ({ empId: Number(x?.empId) || null, present: !!x?.present, reussi: typeof x?.reussi === 'boolean' ? x.reussi : null })) }),
    salaries: p => participants(p).map((x: P) => x?.empId),
  },
  'plan.importer': { champs: ['exercice', 'mode'] },
  'plan.avancer': { champs: ['id'], cible: parId('planActions', ['statut', 'coutReel', 'effectifReel']) },
  // Ligne du plan corrigée (avant et après ; de l'intitulé hors catalogue, seulement qu'il change) ou supprimée (exercice,
  // formation, équipe, trimestre, statut et coût de la ligne retirée). Jamais le motif.
  'plan.modifier': { champs: ['id'], cible: { ...parId('planActions', ['f', 'libelle', 'equipe', 'periode', 'effectif', 'cout']), masques: ['libelle'] } },
  'plan.supprimer': {
    champs: ['id'], cible: parId('planActions', ['annuleLe']),
    extra: (_p, av) => (av ? { exercice: av.exercice, f: av.f, equipe: av.equipe, periode: av.periode, statut: av.statut, cout: av.cout } : {}),
  },
  'budget.enveloppes': { champs: ['exercice', 'enveloppes'] },
  // Clôture d'un exercice : actions reportées (identifiants) sur l'exercice suivant.
  'plan.cloturerExercice': { champs: ['exercice', 'reporter'] },
  // Habilitations : le motif d'une suspension ou d'un retrait (texte libre, parfois médical) n'est pas recopié.
  'hab.delivrer': { champs: ['empId', 'h', 'date', 'par', 'mode'] },
  'hab.suspendre': { champs: ['empId', 'h', 'date'] },
  'hab.lever': { champs: ['empId', 'h'] },
  'hab.retirer': { champs: ['empId', 'h', 'date'] },
  // Habilitation exigée demandée (titre en attente de délivrance).
  'hab.demander': { champs: ['empId', 'h'] },
  // Santé au travail : ni le motif de la visite, ni l'avis, ni les restrictions (le message, masqué au lecteur, dit l'avis).
  'medical.demander': { champs: ['empId'] },
  'medical.annuler': { champs: ['id'] },
  'medical.avis': { champs: ['empId', 'date', 'suspendre', 'lever'] },
  // Type de suivi médical : l'identifiant seul (ni le type, ni la prochaine visite de l'avis, ni l'examen d'aptitude).
  'medical.suivi': { champs: ['empId'] },
  // Référentiels (catalogue, aucune donnée personnelle) : code de l'élément, valeurs avant et après de chaque champ.
  // Une validité modifiée rattache la ligne aux salariés dont un titre change de statut (le message en nomme).
  'referentiel.formation.enregistrer': {
    ...referentiel('formations', ['nom', 'court', 'type', 'validite', 'duree', 'organisme', 'cout', 'validation']), salaries: (_p, x) => salariesTouches(x),
  },
  'referentiel.formation.archiver': referentiel('formations', ['archive'], true),
  'referentiel.habilitation.enregistrer': {
    ...referentiel('habilitations', ['nom', 'detail', 'prereqs', 'medical', 'validite', 'signataire', 'sir']), salaries: (_p, x) => salariesTouches(x),
  },
  'referentiel.habilitation.archiver': referentiel('habilitations', ['archive'], true),
  // Vigilance (t068) : couleur et jour de vérification ; voyageurs vers un pays passé à l'orange ou au rouge, au journal.
  'referentiel.destination.enregistrer': {
    ...referentiel('destinations', ['pays', 'visa', 'visaSub', 'oblig', 'rec', 'passMois', 'secu', 'vigilance', 'vigilanceLe']),
    salaries: (_p, x) => (x.result as { salaries?: number[] } | null)?.salaries ?? [],
  },
  'referentiel.destination.archiver': referentiel('destinations', ['archive'], true),
  // Postes et exigences (aucune donnée personnelle) : identifiant du poste, intitulé et codes exigés avant et après ; la
  // ligne est rattachée aux salariés qui deviennent non conformes (le message en nomme).
  'referentiel.poste.enregistrer': {
    extra: p => ({ id: Number(p.id) || null }), cible: parId('postes', ['nom', 'formations', 'habilitations', 'sir', 'expose', 'risquesL4154']), salaries: (_p, x) => salariesTouches(x),
    // Création : le poste créé, lu après l'action.
    bilan: async (p, x) => {
      if (Number(p.id)) return {};
      const cree = await x.db.get<Ligne>('postes', Number((x.result as { id?: number } | null)?.id));
      return cree ? { id: cree.id, apres: { nom: cree.nom, formations: cree.formations, habilitations: cree.habilitations, ...(cree.sir ? { sir: true } : {}), ...(cree.expose ? { expose: true } : {}), ...(cree.risquesL4154 ? { risquesL4154: true } : {}) } } : {};
    },
  },
  'referentiel.poste.archiver': { extra: p => ({ id: Number(p.id) || null, retablir: p.archive === false }), cible: parId('postes', ['archive']) },
  // Case « travail de nuit ou en continu » (salariés mineurs exclus) : valeur avant et après, quand elle est envoyée ;
  // couverture minimale de même (codes de formation et nombres seulement : `lignesCouverture`).
  'referentiel.equipe.exigences': {
    extra: (p, avant) => ({
      ...(typeof p.nuit === 'boolean' ? { nuit: p.nuit, nuitAvant: avant?.nuit ?? null } : {}),
      ...(Array.isArray(p.couverture) ? { couverture: lignesCouverture(p.couverture), couvertureAvant: lignesCouverture(avant?.couverture) ?? [] } : {}),
      // Horaire de poste par défaut (lot 6) : code recopié seulement s'il en a la forme ; null : aucun.
      ...(p.horaire !== undefined ? { horaire: p.horaire ? codeHoraire({ code: p.horaire }, 'code') : null, horaireAvant: avant?.horaire ?? null } : {}),
    }),
    champs: ['nom'], cible: { table: 'equipes', cle: p => String(p.nom ?? ''), colonnes: ['exigences'], aplatir: true }, salaries: (_p, x) => salariesTouches(x),
  },
  // Activités internes (codes INT-… et ECOLE, aucune donnée personnelle) : code, libellé et statut avant et après.
  'referentiel.activite.enregistrer': { extra: p => ({ code: codeActivite(p) }), cible: { table: 'projets', cle: codeActivite, colonnes: ['nom', 'statut'] } },
  'referentiel.activite.archiver': { extra: p => ({ code: codeActivite(p), retablir: p.archive === false }), cible: { table: 'projets', cle: codeActivite, colonnes: ['statut'] } },
  // Horaires de poste (lot 6, aucune donnée personnelle) : code, libellé, heures et pause, archivage, avant et après.
  // La fin d'un horaire est tracée sous `finHoraire` (`fin` désigne la fin du contrat dans les libellés du journal).
  'referentiel.horaire.enregistrer': {
    extra: p => ({ code: codeHoraire(p) }), cible: { table: 'horaires', cle: p => codeHoraire(p), colonnes: ['nom', 'debut', 'fin', 'pause'] },
    changements: (_p, x) => {
      const vue = (h: Ligne | null) => (h ? { nom: h.nom, debut: h.debut, finHoraire: h.fin, pause: h.pause } : {});
      const avant: Ligne = vue(x.avant), apres: Ligne = vue(x.apres);
      const cles = Object.keys(apres).filter(k => avant[k] !== apres[k]);
      return { avant: Object.fromEntries(cles.map(k => [k, avant[k] ?? null])), apres: Object.fromEntries(cles.map(k => [k, apres[k]])) };
    },
  },
  'referentiel.horaire.archiver': { extra: p => ({ code: codeHoraire(p), retablir: p.archive === false }), cible: { table: 'horaires', cle: p => codeHoraire(p), colonnes: ['archive'] } },
  // Référentiel type : nombre d'éléments ajoutés.
  'referentiel.charger': {
    extra: p => ({ referentiel: referentielRecu(p) }), etat: async (db, p) => await nombreReferentiel(db, p), bilan: async (p, x) => ({ ajoutes: await nombreReferentiel(x.db, p) - Number(x.etat) }),
  },
  // Demandes des collaborateurs : ni motif, ni réponse, ni contenu d'une déclaration.
  'demande.formation': { champs: ['empId', 'f', 'sessionId'], salaries: (p, x) => [p.empId ?? x.user.empId] },
  'demande.habilitation': { champs: ['empId', 'h'], salaries: (p, x) => [p.empId ?? x.user.empId] },
  'demande.accepter': { champs: ['id'], cible: parId('demandesCollab', ['statut']) },
  'demande.refuser': { champs: ['id'], cible: parId('demandesCollab', ['statut']) },
  // Retrait par l'auteur, réouverture par le service RH : statut avant et après (ni le motif, ni la réponse).
  'demande.annuler': { champs: ['id'], cible: parId('demandesCollab', ['statut']) },
  // Réouverture : ce qu'elle a défait (identifiants : session quittée et session retrouvée, certification, inscription,
  // titre d'habilitation) ; ligne du plan supprimée : exercice, formation, équipe, trimestre et coût, comme plan.supprimer.
  'demande.reouvrir': {
    champs: ['id'], cible: parId('demandesCollab', ['statut']),
    bilan: async (_p, x) => {
      const defait = ((x.result as { defait?: Ligne } | null)?.defait ?? {}) as Ligne;
      const l = defait.planId ? await x.db.get<Ligne>('planActions', defait.planId) : null;
      return { defait: l ? { ...defait, exercice: l.exercice, f: l.f, equipe: l.equipe, periode: l.periode, cout: l.cout } : defait };
    },
  },
  // Déplacements : jamais le numéro de passeport ni une vaccination (donnée de santé) ; le motif n'est pas recopié.
  'voyage.creer': { champs: ['empId', 'dest', 'depart', 'retour'] },
  'voyage.detachement': { champs: ['id', 'detachementLe', 'informationLe'], cible: parId('voyages', ['detachementLe', 'informationLe']) },
  // Modification : destination et dates avant et après (le motif, texte libre, n'est pas recopié) ; annulation : sa date,
  // et seulement le fait qu'un motif soit renseigné.
  // Coordonnées sur place (t068) : date d'inscription sur Ariane ; hébergement et contact local, textes libres, masqués.
  'voyage.modifier': {
    champs: ['id'],
    cible: { ...parId('voyages', ['dest', 'depart', 'retour', 'detachementLe', 'informationLe', 'arianeLe', 'hebergement', 'contactSurPlace']), masques: ['hebergement', 'contactSurPlace'] },
  },
  // Contact d'urgence (t068) : le salarié seul, jamais le nom ni le téléphone (seul le fait qu'ils soient renseignés).
  'employe.contactUrgence': {
    champs: ['empId'], salaries: p => [p.empId],
    cible: { table: 'employes', cle: p => Number(p.empId) || null, colonnes: ['urgenceNom', 'urgenceTel'], masques: ['urgenceNom', 'urgenceTel'] },
  },
  // Grand déplacement d'un chantier (t031) : code du chantier, qualification avant et après ; salariés de ses missions.
  'chantier.grandDeplacement': {
    extra: p => ({ chantier: typeof p.id === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(p.id) ? p.id : null }),
    cible: { table: 'chantiers', cle: p => (typeof p.id === 'string' ? p.id : null), colonnes: ['grandDeplacement'] },
    salaries: (_p, x) => (x.result as { salaries?: number[] } | null)?.salaries ?? [],
  },
  'voyage.annuler': { champs: ['id'], cible: { ...parId('voyages', ['annuleLe', 'annuleMotif']), masques: ['annuleMotif'] } },
  // Pièces justificatives (server/src/actions/pieces.ts) : objet et identifiants, nombre de pièces ; jamais le nom du fichier
  // (il peut nommer une donnée de santé), ni les jetons, ni le motif d'un retrait.
  'piece.joindre': {
    extra: p => ({ objet: estObjetPiece(p.objet) ? p.objet : null, objetId: Number(p.objetId) || null, pieces: (Array.isArray(p.jetons) ? p.jetons.length : 0) || (p.jeton ? 1 : 0) }),
    salaries: (_p, x) => [(x.result as { empId?: number } | null)?.empId],
  },
  'piece.retirer': {
    champs: ['id'], extra: (_p, av) => ({ objet: av?.objet ?? null, objetId: av?.objetId ?? null }),
    cible: { table: 'pieces', cle: p => Number(p.id) || null, colonnes: ['retireeLe', 'retireeMotif'], masques: ['retireeMotif'] },
  },
  'formalite.enregistrer': {
    champs: p => p.kind === 'passeport' ? ['empId', 'kind', 'expire'] : p.kind === 'visa' ? ['empId', 'kind', 'dest', 'visaType', 'obtenu', 'expire'] : ['empId', 'kind'],
  },
  // Import : nombre de déplacements créés et leurs salariés, jamais le CSV.
  'voyages.importer': {
    etat: async db => Number((await db.one('SELECT MAX(id) AS n FROM voyages') as { n: number | null }).n ?? 0),
    bilan: async (_p, x) => ({ deplacements: (await importes(x)).length }), salaries: async (_p, x) => await importes(x),
  },
  'keystone.accepter': { champs: ['id'], cible: parId('demandesKeystone', ['statut']) },
  'keystone.refuser': { champs: ['id'], cible: parId('demandesKeystone', ['statut']) },
  // Feuilles de temps : la saisie du salarié n'est pas tracée cellule par cellule ; celle de son manager ou du
  // service RH l'est, quel que soit le statut de la feuille (temps.correction, action liée à la paie), avec
  // l'ancienne et la nouvelle valeur ; soumission et validation portent le total d'heures de la feuille. Un jour férié,
  // la saisie du salarié lui-même l'est aussi (`temps.ferie` : heures majorées, shared/rules/majorations.ts).
  'temps.setCell': {
    champs: ['empId', 'week'], cible: FEUILLE, code: (p, x) => (parAutrui(p, x.user) ? 'temps.correction' : 'temps.ferie'),
    tracer: (p, x) => (parAutrui(p, x.user) || celluleFeriee(p)) && cellule(x.avant, p) !== cellule(x.apres, p),
    changements: async (p, x) => {
      const l = (x.apres?.lignes as LigneTemps[] | undefined)?.[Number(p.li)];
      if (!l) return null;
      const jour = addD(String(p.week), Number(p.di)), a = cellule(x.avant, p), b = cellule(x.apres, p), feuille = statutFeuille(x.avant);
      const etat = feuille === 'brouillon' ? 'en brouillon' : (TS_LABEL as Record<string, string>)[feuille]?.toLowerCase() ?? feuille;
      const quoi = parAutrui(p, x.user) ? 'Correction d’heures' : 'Heures un jour férié';
      return {
        avant: { heures: a }, apres: { heures: b }, extra: { projet: l.projet, jour, feuille, ...(isFerie(jour) ? { ferie: true } : {}) },
        message: `${quoi} — ${await nomSalarie(x.db, p.empId)}, ${l.projet} le ${fmtIso(jour)}${isFerie(jour) && quoi !== 'Heures un jour férié' ? ' (férié)' : ''} : ${heuresTexte(a)} → ${heuresTexte(b)} (feuille ${etat})`,
      };
    },
  },
  'temps.addLine': { champs: ['empId', 'week', 'projet'], ...ligneTemps },
  // Horaire du jour (lot 6) : tracé quand il est choisi par autrui (manager, service RH), comme une correction d'heures ;
  // le choix du salarié sur sa propre feuille ne l'est pas. Code avant et après, jour et statut de la feuille.
  'temps.horaire': {
    champs: ['empId', 'week'], cible: FEUILLE, tracer: (p, x) => parAutrui(p, x.user) && horaireDuJour(x.avant, p) !== horaireDuJour(x.apres, p),
    changements: (p, x) => ({
      avant: { horaire: horaireDuJour(x.avant, p) }, apres: { horaire: horaireDuJour(x.apres, p) },
      extra: { jour: isValidDate(String(p.week ?? '')) ? addD(String(p.week), Number(p.di) || 0) : null, feuille: statutFeuille(x.avant) },
    }),
  },
  'temps.removeLine': { champs: ['empId', 'week'], extra: (p, av) => ({ projet: (av?.lignes as LigneTemps[] | undefined)?.[Number(p.li)]?.projet ?? null }), ...ligneTemps },
  'temps.suggest': { champs: ['empId', 'week'], ...ligneTemps },
  'temps.submit': { champs: ['empId', 'week'], ...statutEtTotal },
  // Validation : en plus, la contrepartie obligatoire en repos figée sur la feuille (heures, shared/rules/durees.ts).
  'temps.validate': { champs: ['empId', 'week'], cible: FEUILLE, bilan: (_p, x) => ({ heures: totalHeures(x.apres), ...(corDeLaFeuille(x.apres as FeuilleTemps | null) ? { cor: corDeLaFeuille(x.apres as FeuilleTemps | null) } : {}) }) },
  'temps.reject': { champs: ['empId', 'week'], cible: FEUILLE },
  // Réouverture d'une feuille validée (administrateur RH, t131) : statut avant et après, renvoi au salarié, feuille déjà
  // transmise et son lot d'origine ; le motif (texte libre) reste sur la feuille, seul le fait qu'il soit renseigné est tracé.
  'temps.rouvrir': {
    champs: ['empId', 'week'], cible: FEUILLE,
    extra: (p, av) => ({ renvoyer: p.renvoyer === true, motif: MENTION_TEXTE, transmise: !!av?.sage, lot: av?.lotId ?? null }),
  },
  // Suivi des feuilles : relance (salarié visé ou tout le périmètre ; semaines relancées, salarié par salarié) et
  // validation groupée (feuilles validées, nombre de refus ; le message nomme les refus).
  'temps.relancer': {
    champs: ['empId'], bilan: (_p, x) => ({ feuilles: (x.result as { feuilles?: unknown[] } | null)?.feuilles ?? [] }),
    salaries: (_p, x) => ((x.result as { feuilles?: { empId: number }[] } | null)?.feuilles ?? []).map(f => f.empId),
  },
  'temps.validerLot': {
    bilan: (_p, x) => {
      const r = x.result as { validees?: unknown[]; refus?: unknown[] } | null;
      return { validees: r?.validees ?? [], refus: r?.refus?.length ?? 0 };
    },
    salaries: (_p, x) => ((x.result as { validees?: { empId: number }[] } | null)?.validees ?? []).map(f => f.empId),
  },
  // Transmission à la paie : semaines transmises, salarié par salarié (archive paie, historique, export de ses données).
  'temps.pushSage': {
    etat: async db => (await db.where<FeuilleTemps>('feuilles', 'statut', 'validee')).filter(f => !f.sage).map(f => f.id),
    bilan: async (_p, x) => ({ ...lotRetenu(x), feuilles: (await transmises(x)).map(f => ({ empId: f.empId, week: f.week })) }),
    salaries: async (_p, x) => [...new Set([...(await transmises(x)).map(f => f.empId), ...(lotDuResultat(x)?.absences ?? []).map(a => a.empId)])],
  },
  // Dérogation au repos dominical d'une équipe : équipe et type (codes) ; de la référence de l'accord, seulement le fait
  // qu'elle soit renseignée.
  'temps.derogationDominicale': {
    champs: ['equipe'], extra: p => ({ type: estTypeDerogation(p.type) ? p.type : null, reference: typeof p.reference === 'string' && p.reference.trim() ? MENTION_TEXTE : null }),
  },
  // Mandats au CSE : rôle, dates et crédit d'heures, avant et après (le salarié est celui du mandat).
  'mandat.enregistrer': { champs: ['id', 'empId'], cible: parId('mandats', ['role', 'du', 'au', 'credit']) },
  'mandat.supprimer': { champs: ['id'], cible: parId('mandats', ['role', 'du', 'au', 'credit']) },
  // Correspondance d'une rubrique avec le plan de paie Sage : codes, case « exportée », date de confirmation.

  'paie.rubrique': {
    champs: ['code', 'codeSage', 'active', 'confirmer'],
    cible: { table: 'rubriquesPaie', cle: p => (typeof p.code === 'string' && p.code ? p.code : null), colonnes: ['codeSage', 'active', 'confirmeLe'] },
  },
  // Lots de paie : période choisie, numéro du lot, feuilles salarié par salarié ; confirmation de l'import (statut, date,
  // référence d'import contrôlée : un code) ou annulation ; format du fichier d'import (codes, avant et après).
  'paie.lotGenerer': { champs: ['periode'], bilan: (_p, x) => lotRetenu(x), salaries: (_p, x) => salariesDuLot(x) },
  // Référence recopiée seulement si c'est un code valide (une requête refusée a pu porter un texte libre).
  'paie.lotConfirmer': { champs: p => (erreurReference(String(p.reference ?? '')) ? ['id'] : ['id', 'reference']), cible: parId('lotsPaie', ['statut', 'confirmeLe']), bilan: (_p, x) => lotRetenu(x), salaries: (_p, x) => salariesDuLot(x) },
  'paie.lotAnnuler': { champs: ['id'], cible: parId('lotsPaie', ['statut', 'annuleLe']), bilan: (_p, x) => lotRetenu(x), salaries: (_p, x) => salariesDuLot(x) },
  'paie.formatFichier': { cible: { table: 'settings', cle: () => 'formatFichierPaie', colonnes: ['value'], aplatir: true } },
  // Absences : la nature n'est jamais recopiée (son absence trahirait une nature médicale) ; dates et statut seulement.
  // Demi-journées : la valeur normalisée seule (« matin », « apres_midi » ou null), jamais la chaîne reçue.
  'absence.demander': { champs: ['empId', 'kind', 'du', 'au'], extra: p => ({ debutDemi: estDemi(p.debutDemi) ? p.debutDemi : null, finDemi: estDemi(p.finDemi) ? p.finDemi : null }) },
  'absence.decider': { champs: ['id', 'ok'], cible: parId('absences', ['statut']), ...reportsRendus },
  'absence.signaler': { champs: ['empId', 'du', 'au'] },
  'absence.saisir': { champs: ['empId', 'du', 'au', 'justificatif', 'justificatifLe'] },
  'absence.qualifier': { champs: ['id', 'du', 'au', 'justificatif', 'justificatifLe'], cible: parId('absences', ['du', 'au', 'statut', 'justificatif']) },
  'absence.prolonger': { champs: ['id', 'au'], cible: parId('absences', ['au', 'statut']) },
  'absence.annuler': { champs: ['id'], cible: parId('absences', ['statut']), ...reportsRendus },
  'cet.placer': { champs: ['empId', 'kind', 'jours', 'annee'] },
  'report.accorder': { champs: ['empId', 'jours', 'expire'] },
  // Information au retour d'un arrêt (art. L3141-19-3) : arrêt visé, jour, jours communiqués et échéances ; jamais le texte
  // envoyé. Masquée à la lecture seule (elle désigne un arrêt de santé : ACTIONS_SANTE).
  'conges.informer': {
    champs: ['id'], cible: parId('absences', []),
    bilan: async (p, x) => {
      // Dernière information de l'arrêt (un arrêt prolongé après l'information en reçoit une autre à son terme).
      const i = (await x.db.where<InformationCp>('informationsCp', 'absenceId', Number(p.id))).sort((u, v) => v.id - u.id)[0];
      return i ? { le: i.le, jours: i.jours, arret: i.arret, limite: i.limite, echeance: i.echeance } : {};
    },
  },
  // Clôture d'une période de congés : décision de chaque ligne enregistrée (report, perte, solde nul ; jours, échéance),
  // jamais le motif d'un report imposé (il laisse deviner une absence de santé).
  'conges.cloturer': {
    champs: ['type', 'periode'],
    etat: async db => Number((await db.one('SELECT MAX(id) AS n FROM clotures') as { n: number | null }).n ?? 0),
    bilan: async (_p, x) => ({ lignes: (await cloturees(x)).map(c => ({ empId: c.empId, decision: c.decision, solde: c.solde, reportes: c.reportes, perdus: c.perdus, expire: c.expire })) }),
    salaries: async (_p, x) => (await cloturees(x)).map(c => c.empId),
  },
  // Entretiens : la section rédigée est nommée, jamais son contenu ; une ligne par compte rendu et par demi-heure.
  'entretien.planifier': { champs: ['empId', 'kind', 'date'] },
  // Annulation : type, date et statut de l'entretien retiré (jamais le compte rendu).
  'entretien.annuler': { champs: ['id'], cible: parId('entretiens', ['type', 'date', 'statut']) },
  'entretien.modifier': {
    champs: ['id', 'info'], extra: p => (p.section ? { sections: [String(p.section)] } : {}),
    cible: { table: 'entretiens', cle: p => Number(p.id) || null, colonnes: [] }, regrouper: 30,
  },
  'entretien.clore': { champs: ['id'], cible: parId('entretiens', ['statut', 'signMgr']) },
  'entretien.signer': { champs: ['id'], cible: parId('entretiens', ['signSal']) },
  // Remise du compte rendu (mode, jour) ; premier téléchargement par le salarié, tracé une fois.
  // La date envoyée n'est pas recopiée (ignorée en mode portail, donc non contrôlée) : remiseLe, avant et après, la trace.
  'entretien.remettre': { champs: ['id', 'mode'], cible: parId('entretiens', ['remiseLe', 'remiseMode']) },
  'entretien.telecharger': { champs: ['id'], cible: parId('entretiens', ['telechargeLe']), tracer: (_p, x) => !x.avant?.telechargeLe && !!x.apres?.telechargeLe },
  // Administration
  // Réglages : anciennes et nouvelles valeurs, sauf la référence de l'accord des heures supplémentaires (texte libre).
  'parametres.maj': {
    cible: { table: 'settings', cle: () => 'app', colonnes: ['value'], aplatir: true, masques: ['heuresSupAccord', 'heuresComplementairesAccord', 'moyenne12SemainesAccord', 'contingentAccord', 'cddAccordBranche'] },
  },
  // Jours fériés d'une année (lot 6) : année, réglage avant et après ; le motif d'une année engagée (texte libre) n'est
  // jamais recopié, seulement le fait qu'il soit renseigné. Salariés dont une absence est recalculée (résultat).
  'parametres.feries': {
    extra: p => ({ annee: Number.isInteger(Number(p.annee)) ? Number(p.annee) : null, ...(typeof p.motif === 'string' && p.motif.trim() ? { motif: MENTION_TEXTE } : {}) }),
    etat: async (db, p) => await feriesDeLAnnee(db, p.annee),
    changements: async (p, x) => ({ avant: x.etat as Ligne, apres: await feriesDeLAnnee(x.db, p.annee) }),
    salaries: (_p, x) => salariesTouches(x),
  },
  'demo.reinitialiser': {},
  'compte.creer': { champs: ['empId', 'type', 'identifiant', 'profilRh'] },
  'compte.profil': { champs: ['id', 'profilRh'], cible: parId('comptes', ['profilRh']) },
  'compte.activer': { champs: ['id', 'actif'], cible: parId('comptes', ['actif']) },
  'compte.reinitialiser': { champs: ['id'], cible: parId('comptes', []) },
  'envoi.relancer': { champs: ['id'] },
  'envoi.classer': { champs: ['id'] },
  // Page Confidentialité : nom des champs dont la valeur a réellement changé (l'écran Paramètres envoie toujours les
  // deux), par comparaison du réglage lu avant et après l'action ; jamais leur texte (coordonnées saisies librement).
  'confidentialite.regler': {
    etat: async db => await lireConfidentialite(db),
    bilan: async (_p, x) => {
      const avant = x.etat as ContactsConfidentialite, apres = await lireConfidentialite(x.db);
      return { champsModifies: (['responsable', 'dpo'] as const).filter(k => avant[k] !== apres[k]) };
    },
  },
  // Reprise depuis Lucca (écran Mise en service) : code par import (`reprise.soldes`…), date de reprise, case des comptes,
  // décompte et salariés concernés ; jamais le fichier, ni les colonnes, ni les noms d'équipes (textes du fichier).
  // Comptes Microsoft 365 ouverts par l'import : fiche et identifiant de chacun, comme compte.creer (accès au site).
  'reprise.importer': {
    code: p => (estTypeReprise(p.type) ? `reprise.${p.type}` : ''),
    extra: p => ({ type: estTypeReprise(p.type) ? p.type : null, dateReprise: isValidDate(p.dateReprise) ? p.dateReprise : null, comptes: p.comptes === true }),
    bilan: (_p, x) => {
      const r = (x.result ?? {}) as Record<string, unknown>;
      const ouverts = (Array.isArray(r.comptesOuverts) ? r.comptesOuverts as P[] : []).slice(0, 1000)
        .map(c => ({ empId: Number(c.empId) || null, identifiant: String(c.identifiant ?? '').slice(0, 254) }));
      return {
        lot: r.lot ?? null, crees: r.crees ?? 0, majs: r.majs ?? 0, ignorees: r.ignorees ?? 0, refusees: r.refusees ?? 0, comptesCrees: r.comptes ?? 0,
        ...(ouverts.length ? { comptesOuverts: ouverts } : {}),
      };
    },
    salaries: (_p, x) => salariesTouches(x),
  },
};

/** Participants d'une clôture (bornés : une session compte quelques dizaines d'inscrits). */
const participants = (p: P): P[] => (Array.isArray(p.participants) ? p.participants.slice(0, 500) : []);

/** Cellule saisie un jour férié (jour de la semaine `week`, `di` : 0 = lundi). */
const celluleFeriee = (p: P) => isValidDate(String(p.week ?? '')) && isFerie(addD(String(p.week), Number(p.di) || 0));
function cellule(f: Ligne | null, p: P): number {
  return num((f?.lignes as LigneTemps[] | undefined)?.[Number(p.li)]?.h?.[Number(p.di)]);
}

/** Inscrits d'une session de formation (recyclages et formations initiales). */
async function inscrits(db: Db, sessionId: unknown): Promise<number[]> {
  const id = Number(sessionId) || 0;
  return (await db.query('SELECT emp_id AS e FROM certifications WHERE session_id = ? UNION SELECT emp_id FROM inscriptions WHERE session_id = ?', [id, id]) as { e: number }[]).map(r => r.e);
}

/** Retire une nature d'absence (code, médicale ou non) d'un objet tracé, par sécurité (aucune règle n'en recopie). */
function sansNature(o: Ligne): Ligne {
  for (const k of ['type', 'nature', 'kind']) if (typeof o[k] === 'string' && Object.hasOwn(NATURES_ABSENCE, o[k])) delete o[k];
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
  // Pièces justificatives jointes par l'action (server/src/actions/pieces.ts) : leur nombre, jamais leurs jetons.
  const pieces = Array.isArray(p.pieces) ? p.pieces.length : typeof p.pieces === 'string' && p.pieces ? 1 : 0;
  if (pieces) out.pieces = pieces;
  return sansNature({ ...out, ...(r.extra?.(p, avant) ?? {}) });
}

/** Ligne de la cible, lue telle quelle (colonnes de la table). */
async function lireCible(db: Db, c: Cible | undefined, p: P): Promise<Ligne | null> {
  if (!c) return null;
  const cle = await c.cle(p, db);
  return cle == null ? null : await db.get<Ligne>(c.table, cle) ?? null;
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
  // Texte libre masqué : « renseigné » ou vide, la modification restant visible par la présence du champ.
  const masque = (k: string, v: unknown) => (c.masques?.includes(k) ? (v ? MENTION_TEXTE : null) : v ?? null);
  for (const [k, x, y] of paires) {
    if (JSON.stringify(x ?? null) === JSON.stringify(y ?? null)) continue;
    a[k] = masque(k, x);
    b[k] = masque(k, y);
  }
  return Object.keys(a).length || Object.keys(b).length ? { avant: a, apres: b } : null;
}

const entiers = (ids: unknown[]) => [...new Set(ids.map(Number).filter(n => Number.isInteger(n) && n > 0))];

// — Messages expurgés —

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Expression qui reconnaît des termes entiers, sans tenir compte de la casse (le plus long d'abord). */
function termes(liste: string[]): RegExp {
  const t = [...new Set(liste.filter(x => x.length > 2))].sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![\\p{L}])(?:${t.map(echapper).join('|')})(?![\\p{L}])`, 'giu');
}
/**
 * Natures d'absence, médicales ou non (libellés, abrégés, motifs de reprise) : un même terme neutre pour toutes. Ne
 * masquer que les natures médicales désignerait justement celles-là (arrêt maladie, enfant malade…). Congés payés,
 * RTT et récupération ne sont pas des natures : ils restent lisibles.
 */
const NATURES = termes(Object.values(NATURES_ABSENCE).flatMap(n => [n.label, n.abrege, n.court, n.reprise ?? '']));
/** Vaccins : donnée de santé. */
const VACCINS_NOMMES = termes(Object.values(VACCINS).flatMap(v => [v.nom, v.nom.replace(/ \(.*\)/, ''), v.court]));
export const MENTION_NATURE = '[nature d’absence]';
export const MENTION_SANTE = '[donnée de santé]';
/** Texte libre renseigné, jamais recopié au journal (Cible.masques). */
export const MENTION_TEXTE = '[texte renseigné]';

/** Message tracé sans nature d'absence ni vaccin : le RH les retrouve dans le dossier. */
export function expurgerMessage(m: string | null): string | null {
  return m == null ? null : m.replace(NATURES, MENTION_NATURE).replace(VACCINS_NOMMES, MENTION_SANTE);
}

// — Écriture —

/** État lu avant une action : la ligne visée par la règle, et ce que l'action modifie au-delà (`etat`). */
export interface Trace { action: string; p: P; regle: Regle | undefined; avant: Ligne | null; etat: unknown }

export async function preparerTrace(db: Db, action: string, p: unknown): Promise<Trace> {
  const regle = REGLES[action];
  const params = p && typeof p === 'object' ? (p as P) : {};
  return { action, p: params, regle, avant: await lireCible(db, regle?.cible, params), etat: await regle?.etat?.(db, params) };
}

/**
 * Trace une action réussie (dans sa transaction) : code, champs retenus, anciennes et nouvelles valeurs,
 * salariés concernés, message expurgé. Rien pour la saisie d'heures du salarié sur sa propre feuille.
 */
export async function journaliserAction(db: Db, t: Trace, x: { user: CurrentUser; compte: Compte; message: string | null; result?: unknown }) {
  const { regle, p, avant } = t;
  const ctx: Contexte = { db, user: x.user, avant, apres: await lireCible(db, regle?.cible, p), etat: t.etat, result: x.result };
  if (regle?.tracer && !await regle.tracer(p, ctx)) return;
  const code = await regle?.code?.(p, ctx) || t.action;
  const payload = { ...champsRetenus(t.action, p, avant), ...(await regle?.bilan?.(p, ctx) ?? {}) };
  const propres = await regle?.changements?.(p, ctx) ?? null;
  const diff = propres ?? (regle?.cible ? comparer(regle.cible, avant, ctx.apres) : null);
  if (propres?.extra) Object.assign(payload, propres.extra);
  if (diff) Object.assign(payload, { avant: diff.avant, apres: diff.apres });
  const salaries = entiers([p.empId, avant?.empId, ctx.apres?.empId, ...(await regle?.salaries?.(p, ctx) ?? [])]);
  const message = expurgerMessage(propres?.message ?? x.message);
  if (regle?.regrouper && await regrouper(db, { minutes: regle.regrouper, action: code, compteId: x.compte.id, payload })) return;
  await journaliser(db, { actor: x.user.nom, role: x.user.role, action: code, message, payload, compte: x.compte, salaries });
}

/**
 * Ajoute la modification à la dernière ligne du même compte sur le même objet (même valeur de `cle`), si elle date
 * de moins de `minutes` : listes réunies, autres valeurs remplacées, message recalculé au besoin.
 */
async function regrouper(db: Db, o: { minutes: number; action: string; compteId: number; payload: Ligne; cle?: string; message?: (fusion: Ligne) => string }): Promise<boolean> {
  const cle = o.cle ?? 'id';
  const depuis = new Date(Date.now() - o.minutes * 60_000).toISOString();
  const der = await db.one('SELECT id, payload FROM journal WHERE compte_id = ? AND action = ? AND at >= ? ORDER BY id DESC LIMIT 1', [o.compteId, o.action, depuis]) as { id: number; payload: string } | undefined;
  const prec = der ? lireJson(der.payload) as Ligne : null;
  if (!der || !prec || prec[cle] !== o.payload[cle]) return false;
  const fusion: Ligne = { ...prec };
  for (const [k, v] of Object.entries(o.payload)) fusion[k] = Array.isArray(v) && Array.isArray(prec[k]) ? [...new Set([...prec[k], ...v])] : v;
  await db.update('journal', der.id, { at: new Date().toISOString(), payload: fusion, ...(o.message ? { message: o.message(fusion) } : {}) });
  return true;
}

/** Longueur au plus d'un motif de refus recopié (il peut reprendre des clés envoyées par le client). */
const MOTIF_MAX = 200;

/** Refus d'accès (403) d'une personne connectée : action ou écran réservé, motif borné ; rien n'a été modifié. */
export async function tracerRefus(db: Db, id: Pick<Identite, 'user' | 'compte'>, quoi: string, motif: string, extra: { action?: string; p?: unknown } = {}) {
  const payload = { ...(extra.action ? { action: extra.action, ...champsRetenus(extra.action, extra.p as P) } : {}) };
  const p = (extra.p ?? {}) as P;
  const court = motif.length > MOTIF_MAX ? `${motif.slice(0, MOTIF_MAX)}…` : motif;
  await journaliser(db, {
    actor: id.user.nom, role: id.user.role, action: 'acces.refuse', message: `${quoi} — ${expurgerMessage(court)}`, payload, compte: id.compte,
    salaries: entiers([p.empId]),
  });
}

// — Conservation —

const ilYa = (maintenant: Date, mois: number) => { const d = new Date(maintenant); d.setMonth(d.getMonth() - mois); return d.toISOString(); };

export interface BilanConservation { supprimees: number; archivees: number; supprimeesArchive: number; envois: number }

/** Bilan d'un ou plusieurs passages, en clair. */
function bilanTexte(b: BilanConservation): string {
  return [
    b.supprimees && `${plural(b.supprimees, 'ligne supprimée', 'lignes supprimées')} (plus d’un an)`,
    b.archivees && `${plural(b.archivees, 'action liée à la paie archivée', 'actions liées à la paie archivées')}`,
    b.supprimeesArchive && `${plural(b.supprimeesArchive, 'ligne supprimée', 'lignes supprimées')} de l’archive (plus de 3 ans)`,
    b.envois && `${plural(b.envois, 'envoi ancien retiré', 'envois anciens retirés')} de la file d’envoi`,
  ].filter(Boolean).join(' · ');
}

/**
 * Applique les durées de conservation : au-delà de 3 ans, toute ligne est supprimée (archive comprise) ; au-delà
 * d'1 an, une action liée à la paie passe dans l'archive, les autres lignes (connexions comprises) sont supprimées.
 * Les envois réussis ou simulés de plus d'1 an quittent la file d'envoi. Une ligne par jour résume ce qui a été
 * fait : la tâche tourne toutes les heures, chaque passage s'ajoute au bilan du jour au lieu d'écrire une ligne.
 */
export async function appliquerConservation(db: Db, maintenant = new Date()): Promise<BilanConservation> {
  const un = ilYa(maintenant, CONSERVATION_JOURNAL_MOIS), trois = ilYa(maintenant, CONSERVATION_ARCHIVE_PAIE_MOIS);
  return await db.tx(async () => {
    const n = async (sql: string, ...a: string[]) => Number((await db.run(sql, [...a])).changes);
    const supprimeesArchive = await n('DELETE FROM journal WHERE at < ?', trois);
    const archivees = await n('UPDATE journal SET archivee = ? WHERE paie = TRUE AND archivee IS NULL AND at < ?', maintenant.toISOString(), un);
    const supprimees = await n('DELETE FROM journal WHERE (paie IS NULL OR paie = FALSE) AND at < ?', un);
    const envois = await purgerEnvois(db, ilYa(maintenant, CONSERVATION_ENVOIS_MOIS));
    const b = { supprimees, archivees, supprimeesArchive, envois };
    if (supprimees || archivees || supprimeesArchive || envois) {
      // Bilan du jour (heure locale du serveur) : la ligne déjà écrite aujourd'hui est complétée.
      const minuit = new Date(maintenant);
      minuit.setHours(0, 0, 0, 0);
      const du = await db.one('SELECT id, payload FROM journal WHERE action = ? AND at >= ? AND at <= ? ORDER BY id DESC LIMIT 1', ['journal.conservation', minuit.toISOString(), maintenant.toISOString()]) as { id: number; payload: string } | undefined;
      const prec = (du ? lireJson(du.payload) : null) as (BilanConservation & { passages?: number }) | null;
      const total = prec
        ? { supprimees: num(prec.supprimees) + supprimees, archivees: num(prec.archivees) + archivees, supprimeesArchive: num(prec.supprimeesArchive) + supprimeesArchive, envois: num(prec.envois) + envois }
        : b;
      const payload = { ...total, passages: prec ? (prec.passages ?? 1) + 1 : 1 };
      const message = `Durée de conservation : ${bilanTexte(total)}`;
      if (du && prec) await db.update('journal', du.id, { at: maintenant.toISOString(), message, payload });
      else await journaliser(db, { at: maintenant.toISOString(), actor: 'Cursus', role: null, action: 'journal.conservation', message, payload });
    }
    return b;
  });
}

/**
 * Lignes déjà écrites d'une action devenue « liée à la paie » (ACTIONS_PAIE élargie depuis) : marquées comme telles,
 * pour qu'elles passent dans l'archive au lieu d'être supprimées.
 */
export async function marquerPaie(db: Db): Promise<number> {
  const dans = ACTIONS_PAIE.map(() => '?').join(', ');
  return Number((await db.run(`UPDATE journal SET paie = TRUE WHERE (paie IS NULL OR paie = FALSE) AND (action IN (${dans}) OR action LIKE 'sage.%')`, [...ACTIONS_PAIE])).changes);
}

/**
 * Lignes écrites avant la liste blanche (contenu complet de la requête : numéro de passeport, CSV, vaccins…) :
 * contenu réduit aux champs retenus, salariés concernés retrouvés, message expurgé, action de paie marquée.
 * Une seule fois par base (réglage `journalExpurge`), et seulement les lignes sans `salaries` : une ligne écrite
 * depuis (anciennes et nouvelles valeurs comprises) n'est jamais reprise, même après une réinitialisation de la
 * démonstration qui efface le réglage. Les lignes du système (connexions, appels et messages de Keystone)
 * n'ont jamais contenu de requête : leur contenu est gardé. Renvoie le nombre de lignes dont le contenu ou le
 * message a été réduit.
 */
export async function reprendreJournal(db: Db): Promise<number> {
  if (await db.getSetting<boolean>('journalExpurge', false)) return 0;
  return await db.tx(async () => {
    const lignes = await db.query('SELECT id, action, message, payload FROM journal WHERE salaries IS NULL') as { id: number; action: string; message: string | null; payload: string | null }[];
    let reduites = 0;
    for (const l of lignes) {
      const p = (lireJson(l.payload) ?? {}) as P;
      const regle = REGLES[l.action];
      let payload: Ligne = p, salaries: number[] = [];
      if (regle) {
        const ligne = await lireCible(db, regle.cible, p);
        payload = champsRetenus(l.action, p, null);
        salaries = entiers([p.empId, ligne?.empId, ...participants(p).map(x => x?.empId),
          ...(l.action === 'employe.modifier' ? [p.id] : [])]);
      } else if (!JOURNAL_LABEL[l.action] && !l.action.startsWith('keystone.')) payload = {};
      const message = expurgerMessage(l.message);
      if (JSON.stringify(payload) !== JSON.stringify(p) || message !== l.message) reduites++;
      await db.run('UPDATE journal SET payload = ?, message = ?, salaries = ?, paie = ? WHERE id = ?',
        [JSON.stringify(payload), message, JSON.stringify(salaries), estActionPaie(l.action), l.id]);
    }
    await db.setSetting('journalExpurge', true);
    return reduites;
  });
}

/**
 * Au démarrage : reprise des anciennes lignes, conservation appliquée puis relancée toutes les heures. Index du journal
 * (`journal_at`, `journal_action`) : migration nommée (server/src/migrations/exploitation.ts).
 */
export async function demarrerJournal(db: Db) {
  const reduites = await reprendreJournal(db);
  if (reduites) {
    // La copie faite avant la migration (et toute sauvegarde antérieure) garde l'ancien journal, non expurgé.
    const copie = copieAvantMigration(db);
    console.log(`Journal : ${plural(reduites, 'ligne antérieure expurgée', 'lignes antérieures expurgées')} (numéros de passeport, CSV, natures d’absence…). `
      + (copie
        ? `La copie ${copie} contient encore l’ancien journal : supprimez-la une fois la mise à jour vérifiée (docs/DEPLOIEMENT.md).`
        : 'Les sauvegardes antérieures contiennent encore l’ancien journal (docs/DEPLOIEMENT.md).'));
  }
  await marquerPaie(db);
  const appliquer = async () => { try { await appliquerConservation(db); } catch (err) { console.error('Conservation du journal :', err); } };
  await appliquer();
  setInterval(appliquer, 3600_000).unref();
}

// — Consultation —

const lireJson = (s: unknown): unknown => { try { return jsonLu(s); } catch { return null; } };

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
// Bornes des filtres par date : minuit à Paris, quel que soit le fuseau du serveur (shared/dates.ts).
const debutJour = (d: string) => debutJourParis(d);
const like = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;

/** Le filtre « Action » désigne-t-il les appels de Keystone (code exact, ou leur famille) ? */
const appelsDemandes = (action: string | null) => action === ACTION_APPEL_KEYSTONE || (!!action?.startsWith('famille:') && familleAction(ACTION_APPEL_KEYSTONE)?.id === action.slice(8));

function clauses(db: Db, f: FiltreJournal): { where: string; params: (string | number)[] } {
  const w: string[] = [], params: (string | number)[] = [];
  const liste = (xs: readonly string[]) => { params.push(...xs); return xs.map(() => '?').join(', '); };
  if (f.vue === 'archive') w.push('archivee IS NOT NULL');
  else {
    w.push('archivee IS NULL');
    if (f.vue === 'keystone') { w.push('action = ?'); params.push(ACTION_APPEL_KEYSTONE); }
    else {
      // Les appels de Keystone, nombreux, sont tenus à l'écart des autres vues, sauf si le filtre « Action » les désigne.
      if (!appelsDemandes(f.action)) {
        w.push('action <> ?');
        params.push(ACTION_APPEL_KEYSTONE);
      }
      if (f.vue === 'connexions') w.push(`action IN (${liste(ACTIONS_CONNEXION)})`);
      if (f.vue === 'operations') w.push(`action NOT IN (${liste(ACTIONS_CONNEXION)})`);
    }
  }
  if (f.du) { w.push('at >= ?'); params.push(debutJour(f.du)); }
  if (f.au) { w.push('at < ?'); params.push(debutJour(addD(f.au, 1))); }
  if (f.auteur) { w.push(`(actor ${db.like} ? ESCAPE '\\' OR identifiant ${db.like} ? ESCAPE '\\')`); params.push(like(f.auteur), like(f.auteur)); }
  if (f.action?.startsWith('famille:')) {
    const fam = FAMILLES_JOURNAL.find(x => x.id === f.action!.slice(8));
    if (fam) {
      w.push(`(${fam.prefixes.map(p => (p.endsWith('.') ? `action ${db.like} ? ESCAPE '\\'` : 'action = ?')).join(' OR ')})`);
      params.push(...fam.prefixes.map(p => (p.endsWith('.') ? `${p.replace(/[\\%_]/g, '\\$&')}%` : p)));
    }
  } else if (f.action) { w.push('action = ?'); params.push(f.action); }
  if (f.salarie) { w.push(db.contientEntier('journal.salaries')); params.push(f.salarie); }
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
export async function lireJournal(db: Db, f: FiltreJournal, page = 1, taille = TAILLE_PAGE) {
  const { where, params } = clauses(db, f);
  const total = Number((await db.one(`SELECT COUNT(*) AS n FROM journal ${where}`, [...params]) as { n: number }).n);
  const lignes = (await db.query(`SELECT ${COLONNES} FROM journal ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, taille, (page - 1) * taille]) as Ligne[]).map(decoder);
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
export async function csvJournal(db: Db, lignes: LigneJournal[]): Promise<string> {
  // Salarié désigné par son nom et son matricule de paie (matricule Cursus tant qu'il manque, ou fiche supprimée).
  const fiches = new Map((await db.query('SELECT id, nom, matricule_paie AS "matriculePaie" FROM employes') as { id: number; nom: string; matriculePaie: string | null }[]).map(e => [e.id, e]));
  const tete = ['Date', 'Heure', 'Auteur', 'Identifiant', 'Espace', 'Action', 'Code', 'Salariés concernés', 'Message', 'Anciennes et nouvelles valeurs', 'Détail', 'Archivée le'];
  const corps = lignes.map(l => {
    const d = new Date(l.at);
    return [
      d.toLocaleDateString('fr-FR'), d.toLocaleTimeString('fr-FR'), l.actor, l.identifiant, l.role ? ROLE_LABEL[l.role] ?? l.role : '', libelleAction(l.action), l.action,
      l.salaries.map(id => `${fiches.get(id)?.nom ?? 'salarié supprimé'} (${matriculeAffiche(fiches.get(id) ?? { id, matriculePaie: null })})`).join(', '), l.message, changementsTexte(l.details),
      Object.keys(l.details).length ? JSON.stringify(l.details) : '', l.archivee ? new Date(l.archivee).toLocaleDateString('fr-FR') : '',
    ];
  });
  return '﻿' + [tete, ...corps].map(r => r.map(celluleCsv).join(';')).join('\r\n') + '\r\n';
}

/** Filtres appliqués, en clair (ligne de journal d'un export ou d'une consultation de l'archive). */
async function filtresTexte(db: Db, f: FiltreJournal): Promise<string> {
  const parts = [
    f.vue !== 'tout' && { operations: 'opérations', connexions: 'connexions', keystone: 'appels de Keystone', archive: 'archive paie' }[f.vue],
    f.du && `depuis le ${fmtIso(f.du)}`, f.au && `jusqu’au ${fmtIso(f.au)}`, f.auteur && `auteur « ${f.auteur} »`,
    f.action && `action ${f.action.startsWith('famille:') ? FAMILLES_JOURNAL.find(x => x.id === f.action!.slice(8))?.label ?? f.action : libelleAction(f.action)}`,
    f.salarie && `salarié ${await nomSalarie(db, f.salarie)}`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'aucun filtre';
}

/**
 * Personne connectée qui a le droit demandé (par défaut : lire le journal, droit « rh » ou « consultation »,
 * shared/journal.ts), ou réponse 401 / 403 (le refus d'une personne connectée est tracé). Le profil compte, pas
 * l'espace : un profil restreint de l'espace RH (référent HSE, paie) n'a ni le journal ni l'export des données.
 */
export async function exigerRh(db: Db, req: Request, res: Response, quoi: string, autorise: (u: CurrentUser) => boolean = lecteurJournal): Promise<Identite | null> {
  const id = await identite(db, req);
  if (!id) { res.status(401).json({ error: 'Connexion requise' }); return null; }
  if (!autorise(id.user)) {
    await tracerRefus(db, id, quoi, 'réservé au service RH');
    res.status(403).json({ error: 'Réservé au service RH' });
    return null;
  }
  return id;
}

/** Actions dont le message ou le détail touche à la santé : absence (dates d'un arrêt), visite médicale, vaccination, document déclaré. */
const ACTIONS_SANTE = new Set([
  'absence.saisir', 'absence.qualifier', 'absence.prolonger', 'absence.annuler', 'medical.demander', 'medical.annuler', 'medical.avis', 'medical.suivi',
  'formalite.enregistrer', 'demande.accepter', 'email.visite.demande', 'reprise.visites', 'conges.informer', 'email.conges.information',
  // Pièces justificatives : un justificatif d'absence ou un carnet de vaccination désigne une donnée de santé.
  'piece.deposer', 'piece.joindre', 'piece.retirer', 'piece.consulter',
]);
export const DETAIL_RESERVE = 'Détail réservé au service RH';

/**
 * Lignes lues par une personne sans le droit « rh » (profil en lecture seule : direction, DPO, auditeur) :
 * message et détail des actions touchant à la santé masqués ; l'action, sa date, son auteur et le salarié restent.
 */
export function pourLecteur(u: CurrentUser, lignes: LigneJournal[]): LigneJournal[] {
  if (dossierComplet(u)) return lignes;
  return lignes.map(l => (ACTIONS_SANTE.has(l.action) || ACTIONS_SANTE.has(String(l.details.action ?? ''))
    ? { ...l, message: l.message == null ? null : DETAIL_RESERVE, details: {} } : l));
}

/** Consultation de l'archive : une ligne par compte et par filtre pendant 15 minutes, avec les pages vues. */
async function tracerArchive(db: Db, id: Identite, f: FiltreJournal, page: number, total: number) {
  const filtres = await filtresTexte(db, f);
  const message = (x: Ligne) => {
    const pages = (x.pages as number[]).slice().sort((a, b) => a - b);
    const vues = pages.length === 1 && pages[0] === 1 ? '' : ` · ${pages.length > 1 ? 'pages' : 'page'} ${pages.slice(0, 20).join(', ')}${pages.length > 20 ? '…' : ''}`;
    return `Consultation de l’archive paie — ${plural(total, 'ligne', 'lignes')} (${filtres})${vues}`;
  };
  const payload = { filtres, pages: [page] };
  if (await regrouper(db, { minutes: 15, action: 'journal.archive', compteId: id.compte.id, payload, cle: 'filtres', message })) return;
  await journaliser(db, { actor: id.user.nom, role: id.user.role, action: 'journal.archive', message: message(payload), payload, compte: id.compte, salaries: f.salarie ? [f.salarie] : [] });
}

/** Fichier joint à télécharger (jamais mis en cache : données personnelles). */
export function fichierJoint(res: Response, type: string, nom: string, contenu: string | Buffer) {
  res.set({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${nom}"`, 'Cache-Control': 'no-store' });
  res.send(contenu);
}

const jourLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Routes du journal : consultation, export CSV, trace des exports faits par l'interface. */
export function routesJournal(db: Db): Router {
  const r = express.Router();

  r.get('/api/journal', enSerie(db, async (req: Request, res: Response) => {
    const id = await exigerRh(db, req, res, 'Journal des actions');
    if (!id) return;
    const f = lireFiltre(req.query as Record<string, unknown>);
    const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
    const taille = Math.min(TAILLE_MAX, Math.max(1, Math.floor(Number(req.query.taille)) || TAILLE_PAGE));
    const out = await lireJournal(db, f, page, taille);
    // L'archive n'apparaît qu'à la demande : chaque consultation est tracée, quelle que soit la page lue.
    if (f.vue === 'archive') await tracerArchive(db, id, f, page, out.total);
    res.json({ ...out, lignes: pourLecteur(id.user, out.lignes) });
  }));

  r.get('/api/journal/csv', enSerie(db, async (req: Request, res: Response) => {
    const id = await exigerRh(db, req, res, 'Export du journal');
    if (!id) return;
    const f = lireFiltre(req.query as Record<string, unknown>);
    const { lignes, total } = await lireJournal(db, f, 1, EXPORT_MAX);
    await journaliser(db, {
      actor: id.user.nom, role: id.user.role, action: 'journal.export', compte: id.compte, salaries: f.salarie ? [f.salarie] : [],
      message: `Export CSV du journal — ${plural(lignes.length, 'ligne', 'lignes')}${total > lignes.length ? ` sur ${total}` : ''} (${await filtresTexte(db, f)})`,
    });
    fichierJoint(res, 'text/csv; charset=utf-8', `journal${f.vue === 'archive' ? '-archive-paie' : ''}-${jourLocal()}.csv`, await csvJournal(db, pourLecteur(id.user, lignes)));
  }));

  // Exports et impressions produits par le navigateur (CSV des échéances, liste d'une session, passeport formation,
  // compte rendu d'entretien) : l'interface les signale ici pour qu'ils figurent au journal.
  r.post('/api/exports', enSerie(db, async (req: Request, res: Response) => {
    const id = await identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    const b = (req.body ?? {}) as P;
    const titre = typeof b.titre === 'string' ? b.titre.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 160) : '';
    if (!titre) return res.status(400).json({ error: 'Export sans titre' });
    const lignes = Number.isInteger(b.lignes) && b.lignes >= 0 ? b.lignes as number : null;
    // Salarié concerné : seulement dans le périmètre de la personne (une trace ne s'ajoute pas à une fiche étrangère).
    const empId = Number(b.empId);
    const dans = Number.isInteger(empId) && empId > 0 && (id.user.role === 'rh' ? !!await db.get('employes', empId) : scopeIds(new Domain(await loadFull(db, id.user)), id.user).includes(empId));
    await journaliser(db, {
      actor: id.user.nom, role: id.user.role, action: 'export', compte: id.compte, salaries: dans ? [empId] : [],
      message: `${b.nature === 'impression' ? 'Impression' : 'Export CSV'} : ${expurgerMessage(titre)}${lignes != null ? ` (${plural(lignes, 'ligne', 'lignes')})` : ''}`,
      payload: { nature: b.nature === 'impression' ? 'impression' : 'csv', ...(lignes != null ? { lignes } : {}) },
    });
    res.status(204).end();
  }));

  return r;
}
