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
import { addD, isValidDate } from '../../shared/dates.ts';
import { Domain } from '../../shared/domain.ts';
import { fmtIso, num, plural } from '../../shared/format.ts';
import { erreurReference } from '../../shared/rules/lots-paie.ts';
import { matriculeAffiche } from '../../shared/rules/matricules.ts';
import {
  ACTION_APPEL_KEYSTONE, ACTIONS_CONNEXION, ACTIONS_PAIE, changementsTexte, CONSERVATION_ARCHIVE_PAIE_MOIS, CONSERVATION_ENVOIS_MOIS,
  CONSERVATION_JOURNAL_MOIS, dossierComplet, estActionPaie, familleAction, FAMILLES_JOURNAL, JOURNAL_LABEL, lecteurJournal, libelleAction,
} from '../../shared/journal.ts';
import { CODE_PAYS, CODE_TITRE, codeDestination, codeTitre, type ReferentielId } from '../../shared/rules/referentiels.ts';
import { estTypeReprise } from '../../shared/rules/reprise.ts';
import type { ClotureConges, CurrentUser, FeuilleTemps, LigneTemps } from '../../shared/types.ts';
import type { ContactsConfidentialite } from '../../shared/confidentialite.ts';
import { journaliser, type Compte } from './comptes.ts';
import { lireConfidentialite } from './confidentialite.ts';
import { identite, type Identite } from './connexion.ts';
import { loadFull, scopeIds } from './dataset.ts';
import type { Db, TableName } from './db.ts';
import { purgerEnvois } from './envois.ts';
import { copieAvantMigration } from './sauvegarde.ts';

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
  /**
   * Champs de texte libre, comparés mais jamais recopiés : seul le fait qu'ils soient renseignés est tracé
   * (MENTION_TEXTE), par exemple la référence de l'accord des heures supplémentaires dans les réglages.
   */
  masques?: readonly string[];
}

/** Ce que la règle sait de l'action : ligne visée avant et après, état lu avant l'action (`etat`), résultat. */
interface Contexte { db: Db; user: CurrentUser; avant: Ligne | null; apres: Ligne | null; etat: unknown; result: unknown }

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
  etat?: (db: Db, p: P) => unknown;
  /** Valeurs lues après l'action (feuilles transmises, total d'heures), ajoutées au contenu tracé. */
  bilan?: (p: P, x: Contexte) => Ligne;
  /** Salariés concernés, en plus de `empId` (paramètre, ou ligne modifiée). */
  salaries?: (p: P, x: Contexte) => unknown[];
  /** Tracée seulement si… (saisie d'heures : modification par le manager ou le service RH). */
  tracer?: (p: P, x: Contexte) => boolean;
  /** Code inscrit au journal à la place du nom de l'action (correction d'heures) ; vide : le nom de l'action. */
  code?: (p: P, x: Contexte) => string;
  /** Anciennes et nouvelles valeurs propres à l'action, à la place de la comparaison des colonnes ; message éventuel. */
  changements?: (p: P, x: Contexte) => { avant: Ligne; apres: Ligne; extra?: Ligne; message?: string } | null;
  /** Modifications successives du même objet par le même compte regroupées sur une ligne pendant N minutes. */
  regrouper?: number;
}

const parId = (table: TableName, colonnes: readonly string[]): Cible => ({ table, cle: p => Number(p.id) || null, colonnes });
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
/** Salariés dont un titre change de statut avec la règle modifiée (résultat de l'action). */
const salariesTouches = (x: Contexte) => (x.result as { salaries?: unknown[] } | null | undefined)?.salaries ?? [];
/** Référentiel désigné (`referentiel.charger`), seulement s'il en est un : jamais la valeur reçue telle quelle. */
const referentielRecu = (p: P): ReferentielId | null => (['formations', 'habilitations', 'destinations'].includes(p.referentiel) ? p.referentiel : null);
const nombreReferentiel = (db: Db, p: P) => { const r = referentielRecu(p); return r ? db.count(r) : 0; };
const FICHE = ['nom', 'poste', 'posteId', 'equipe', 'statut', 'typeContrat', 'temps', 'heures', 'forfaitHeures', 'forfaitJours', 'jourOff', 'tempsDepuis', 'entree', 'fin', 'motifSortie', 'agence', 'matriculePaie'];
/**
 * Solde de RTT de l'année affiché avant un changement de régime qui n'en ouvre plus (garde-fou de `employe.modifier`) :
 * gardé au journal pour la paie, sous un code de l'archive paie (`employe.rtt`).
 */
const soldeRttGarde = (x: Contexte) => (x.result as { soldeRtt?: Ligne } | null)?.soldeRtt ?? null;
const FEUILLE: Cible = {
  table: 'feuilles', colonnes: ['statut'],
  cle: (p, db) => (db.sql.prepare('SELECT id FROM feuilles WHERE emp_id = ? AND week = ?').get(Number(p.empId) || 0, String(p.week ?? '')) as { id: number } | undefined)?.id ?? null,
};
const totalHeures = (f: Ligne | null) => ((f?.lignes ?? []) as LigneTemps[]).reduce((n, l) => n + l.h.reduce((a, b) => a + num(b), 0), 0);
const heuresTexte = (h: number) => `${String(Math.round(h * 100) / 100).replace('.', ',')} h`;
const nomSalarie = (db: Db, id: unknown) => db.get<{ nom: string }>('employes', Number(id))?.nom ?? `salarié n° ${id}`;
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
/** Soumission, validation : statut avant et après, et total d'heures de la feuille (ce qui part en paie). */
const statutEtTotal: Partial<Regle> = { cible: FEUILLE, bilan: (_p, x) => ({ heures: totalHeures(x.apres) }) };

/** Inscrits avant et après l'action : une annulation ou des places retirées détachent des recyclages rattachés. */
const inscritsAvantApres: Partial<Regle> = { etat: (db, p) => inscrits(db, p.id), salaries: (p, x) => [...(x.etat as number[]), ...inscrits(x.db, p.id)] };

/** Lot de paie renvoyé par l'action (`paie.lot…`, `temps.pushSage`) : son numéro et ses feuilles `{ empId, week }`. */
const lotDuResultat = (x: Contexte) => x.result as { lot?: number; feuilles?: { empId: number; week: string }[] } | null | undefined;
const lotRetenu = (x: Contexte) => ({ lot: lotDuResultat(x)?.lot ?? null, feuilles: lotDuResultat(x)?.feuilles ?? [] });
const salariesDuLot = (x: Contexte) => (lotDuResultat(x)?.feuilles ?? []).map(f => f.empId);
/** Feuilles transmises à la paie : validées et non transmises avant l'action, marquées transmises après. */
const transmises = (x: Contexte) => (x.etat as number[]).map(id => x.db.get<FeuilleTemps>('feuilles', id)).filter((f): f is FeuilleTemps => !!f?.sage);
/** Lignes de clôture des congés créées par l'action (identifiants au-delà du dernier d'avant l'action). */
const cloturees = (x: Contexte) => (x.db.sql.prepare('SELECT id FROM clotures WHERE id > ? ORDER BY id').all(Number(x.etat) || 0) as { id: number }[])
  .map(r => x.db.get<ClotureConges>('clotures', r.id)!);
/**
 * Jours rendus à une période de CP close par un refus ou une annulation : reports reçus créés par l'action (identifiants
 * au-delà du dernier d'avant), tracés par leurs jours, période et échéance — jamais leur motif.
 */
const reportsRendus: Partial<Regle> = {
  etat: db => Number((db.sql.prepare('SELECT MAX(id) AS n FROM reports').get() as { n: number | null }).n ?? 0),
  bilan: (_p, x) => {
    const l = x.db.sql.prepare('SELECT id, jours, periode, expire FROM reports WHERE id > ? ORDER BY id').all(Number(x.etat) || 0) as Ligne[];
    return l.length ? { reportsRendus: l.map(r => ({ id: r.id, jours: r.jours, periode: r.periode, expire: r.expire })) } : {};
  },
};
/** Salariés des déplacements créés par un import (identifiants au-delà du dernier d'avant l'action). */
const importes = (x: Contexte) => (x.db.sql.prepare('SELECT emp_id AS e FROM voyages WHERE id > ? ORDER BY id').all(Number(x.etat) || 0) as { e: number }[]).map(r => r.e);

export const REGLES: Record<string, Regle> = {
  // Fiches et équipes
  // Réembauche : réutilisation d'un matricule de paie confirmée par l'administrateur RH (`reutiliserMatricule`).
  'employe.creer': {
    champs: ['equipe', 'poste', 'statut', 'typeContrat', 'temps', 'entree', 'fin', 'motifSortie', 'matriculePaie', 'reutiliserMatricule'], salaries: (_p, x) => [(x.result as { id?: number } | null)?.id],
    // Poste du référentiel retenu (choisi, rattaché d'après l'intitulé ou créé) : lu sur la fiche créée.
    bilan: (_p, x) => ({ posteId: x.db.get<{ posteId: number | null }>('employes', Number((x.result as { id?: number } | null)?.id))?.posteId ?? null }),
  },
  // Les champs modifiés sont nommés ; seules les colonnes de FICHE ont leurs valeurs (ni visite médicale, ni reprise, ni naissance).
  'employe.modifier': {
    champs: ['id', 'reutiliserMatricule'], extra: p => ({ champsModifies: Object.keys(p).filter(k => k !== 'id' && k !== 'confirmerRtt' && k !== 'reutiliserMatricule' && /^[A-Za-z]{1,40}$/.test(k)).slice(0, 30) }),
    cible: parId('employes', FICHE), salaries: p => [p.id],
    code: (_p, x) => (soldeRttGarde(x) ? 'employe.rtt' : ''),
    bilan: (_p, x) => { const s = soldeRttGarde(x); return s ? { soldeRtt: { annee: s.annee, droit: s.droit, pris: s.pris, poses: s.poses, solde: s.solde } } : {}; },
  },
  // Sortie : date et motif (code de la liste fermée), nombre d'éléments annulés ; jamais le détail d'une absence.
  'employe.sortie': {
    champs: ['id', 'date', 'motif'], cible: parId('employes', ['fin', 'motifSortie']), salaries: p => [p.id],
    bilan: (_p, x) => (x.result as { annulations?: Ligne } | null)?.annulations ?? {},
  },
  'employe.annulerSortie': { champs: ['id'], cible: parId('employes', ['fin', 'motifSortie']), salaries: p => [p.id] },
  'equipe.creer': { champs: ['nom', 'managerId'], salaries: p => [p.managerId] },
  'equipe.renommer': { champs: ['nom', 'nouveau'] },
  'equipe.supprimer': { champs: ['nom'] },
  'equipe.manager': { champs: ['nom', 'managerId'], cible: { table: 'equipes', cle: p => String(p.nom ?? ''), colonnes: ['managerId'] }, salaries: (p, x) => [p.managerId, x.avant?.managerId] },
  'equipe.affecter': { champs: ['empId', 'equipe'], cible: { table: 'employes', cle: p => Number(p.empId) || null, colonnes: ['equipe'] } },
  // Formations
  'plan.inscrire': { champs: ['empId', 'certId', 'inscriptionId', 'sessionId', 'conv'] },
  'cert.ajouter': { champs: ['empId', 'f', 'date'] },
  'session.creer': { champs: ['f', 'date', 'lieu', 'places', 'planId'] },
  'session.confirmer': { champs: ['id'], cible: parId('sessions', ['statut']), ...inscritsAvantApres },
  'session.modifier': { champs: ['id'], cible: parId('sessions', ['date', 'lieu', 'places', 'statut']), ...inscritsAvantApres },
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
  // Référentiels (catalogue, aucune donnée personnelle) : code de l'élément, valeurs avant et après de chaque champ.
  // Une validité modifiée rattache la ligne aux salariés dont un titre change de statut (le message en nomme).
  'referentiel.formation.enregistrer': {
    ...referentiel('formations', ['nom', 'court', 'type', 'validite', 'duree', 'organisme', 'cout', 'validation']), salaries: (_p, x) => salariesTouches(x),
  },
  'referentiel.formation.archiver': referentiel('formations', ['archive'], true),
  'referentiel.habilitation.enregistrer': {
    ...referentiel('habilitations', ['nom', 'detail', 'prereqs', 'medical', 'validite', 'signataire']), salaries: (_p, x) => salariesTouches(x),
  },
  'referentiel.habilitation.archiver': referentiel('habilitations', ['archive'], true),
  'referentiel.destination.enregistrer': referentiel('destinations', ['pays', 'visa', 'visaSub', 'oblig', 'rec', 'passMois', 'secu']),
  'referentiel.destination.archiver': referentiel('destinations', ['archive'], true),
  // Postes et exigences (aucune donnée personnelle) : identifiant du poste, intitulé et codes exigés avant et après ; la
  // ligne est rattachée aux salariés qui deviennent non conformes (le message en nomme).
  'referentiel.poste.enregistrer': {
    extra: p => ({ id: Number(p.id) || null }), cible: parId('postes', ['nom', 'formations', 'habilitations']), salaries: (_p, x) => salariesTouches(x),
    // Création : le poste créé, lu après l'action.
    bilan: (p, x) => {
      if (Number(p.id)) return {};
      const cree = x.db.get<Ligne>('postes', Number((x.result as { id?: number } | null)?.id));
      return cree ? { id: cree.id, apres: { nom: cree.nom, formations: cree.formations, habilitations: cree.habilitations } } : {};
    },
  },
  'referentiel.poste.archiver': { extra: p => ({ id: Number(p.id) || null, retablir: p.archive === false }), cible: parId('postes', ['archive']) },
  'referentiel.equipe.exigences': {
    champs: ['nom'], cible: { table: 'equipes', cle: p => String(p.nom ?? ''), colonnes: ['exigences'], aplatir: true }, salaries: (_p, x) => salariesTouches(x),
  },
  // Référentiel type : nombre d'éléments ajoutés.
  'referentiel.charger': {
    extra: p => ({ referentiel: referentielRecu(p) }), etat: (db, p) => nombreReferentiel(db, p), bilan: (p, x) => ({ ajoutes: nombreReferentiel(x.db, p) - Number(x.etat) }),
  },
  // Demandes des collaborateurs : ni motif, ni réponse, ni contenu d'une déclaration.
  'demande.formation': { champs: ['empId', 'f', 'sessionId'], salaries: (p, x) => [p.empId ?? x.user.empId] },
  'demande.habilitation': { champs: ['empId', 'h'], salaries: (p, x) => [p.empId ?? x.user.empId] },
  'demande.accepter': { champs: ['id'], cible: parId('demandesCollab', ['statut']) },
  'demande.refuser': { champs: ['id'], cible: parId('demandesCollab', ['statut']) },
  // Déplacements : jamais le numéro de passeport ni une vaccination (donnée de santé) ; le motif n'est pas recopié.
  'voyage.creer': { champs: ['empId', 'dest', 'depart', 'retour'] },
  'voyage.detachement': { champs: ['id', 'detachementLe', 'informationLe'], cible: parId('voyages', ['detachementLe', 'informationLe']) },
  'formalite.enregistrer': {
    champs: p => p.kind === 'passeport' ? ['empId', 'kind', 'expire'] : p.kind === 'visa' ? ['empId', 'kind', 'dest', 'visaType', 'obtenu', 'expire'] : ['empId', 'kind'],
  },
  // Import : nombre de déplacements créés et leurs salariés, jamais le CSV.
  'voyages.importer': {
    etat: db => Number((db.sql.prepare('SELECT MAX(id) AS n FROM voyages').get() as { n: number | null }).n ?? 0),
    bilan: (_p, x) => ({ deplacements: importes(x).length }), salaries: (_p, x) => importes(x),
  },
  'keystone.accepter': { champs: ['id'], cible: parId('demandesKeystone', ['statut']) },
  'keystone.refuser': { champs: ['id'], cible: parId('demandesKeystone', ['statut']) },
  // Feuilles de temps : la saisie du salarié n'est pas tracée cellule par cellule ; celle de son manager ou du
  // service RH l'est, quel que soit le statut de la feuille (temps.correction, action liée à la paie), avec
  // l'ancienne et la nouvelle valeur ; soumission et validation portent le total d'heures de la feuille.
  'temps.setCell': {
    champs: ['empId', 'week'], cible: FEUILLE, code: () => 'temps.correction',
    tracer: (p, x) => parAutrui(p, x.user) && cellule(x.avant, p) !== cellule(x.apres, p),
    changements: (p, x) => {
      const l = (x.apres?.lignes as LigneTemps[] | undefined)?.[Number(p.li)];
      if (!l) return null;
      const jour = addD(String(p.week), Number(p.di)), a = cellule(x.avant, p), b = cellule(x.apres, p), feuille = statutFeuille(x.avant);
      const etat = feuille === 'brouillon' ? 'en brouillon' : (TS_LABEL as Record<string, string>)[feuille]?.toLowerCase() ?? feuille;
      return {
        avant: { heures: a }, apres: { heures: b }, extra: { projet: l.projet, jour, feuille },
        message: `Correction d’heures — ${nomSalarie(x.db, p.empId)}, ${l.projet} le ${fmtIso(jour)} : ${heuresTexte(a)} → ${heuresTexte(b)} (feuille ${etat})`,
      };
    },
  },
  'temps.addLine': { champs: ['empId', 'week', 'projet'], ...ligneTemps },
  'temps.removeLine': { champs: ['empId', 'week'], extra: (p, av) => ({ projet: (av?.lignes as LigneTemps[] | undefined)?.[Number(p.li)]?.projet ?? null }), ...ligneTemps },
  'temps.suggest': { champs: ['empId', 'week'], ...ligneTemps },
  'temps.submit': { champs: ['empId', 'week'], ...statutEtTotal },
  'temps.validate': { champs: ['empId', 'week'], ...statutEtTotal },
  'temps.reject': { champs: ['empId', 'week'], cible: FEUILLE },
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
    etat: db => db.where<FeuilleTemps>('feuilles', 'statut', 'validee').filter(f => !f.sage).map(f => f.id),
    bilan: (_p, x) => ({ lot: lotDuResultat(x)?.lot ?? null, feuilles: transmises(x).map(f => ({ empId: f.empId, week: f.week })) }), salaries: (_p, x) => transmises(x).map(f => f.empId),
  },
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
  'absence.demander': { champs: ['empId', 'kind', 'du', 'au'] },
  'absence.decider': { champs: ['id', 'ok'], cible: parId('absences', ['statut']), ...reportsRendus },
  'absence.signaler': { champs: ['empId', 'du', 'au'] },
  'absence.saisir': { champs: ['empId', 'du', 'au', 'justificatif', 'justificatifLe'] },
  'absence.qualifier': { champs: ['id', 'du', 'au', 'justificatif', 'justificatifLe'], cible: parId('absences', ['du', 'au', 'statut', 'justificatif']) },
  'absence.prolonger': { champs: ['id', 'au'], cible: parId('absences', ['au', 'statut']) },
  'absence.annuler': { champs: ['id'], cible: parId('absences', ['statut']), ...reportsRendus },
  'cet.placer': { champs: ['empId', 'kind', 'jours', 'annee'] },
  'report.accorder': { champs: ['empId', 'jours', 'expire'] },
  // Clôture d'une période de congés : décision de chaque ligne enregistrée (report, perte, solde nul ; jours, échéance),
  // jamais le motif d'un report imposé (il laisse deviner une absence de santé).
  'conges.cloturer': {
    champs: ['type', 'periode'],
    etat: db => Number((db.sql.prepare('SELECT MAX(id) AS n FROM clotures').get() as { n: number | null }).n ?? 0),
    bilan: (_p, x) => ({ lignes: cloturees(x).map(c => ({ empId: c.empId, decision: c.decision, solde: c.solde, reportes: c.reportes, perdus: c.perdus, expire: c.expire })) }),
    salaries: (_p, x) => cloturees(x).map(c => c.empId),
  },
  // Entretiens : la section rédigée est nommée, jamais son contenu ; une ligne par compte rendu et par demi-heure.
  'entretien.planifier': { champs: ['empId', 'kind', 'date'] },
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
  'parametres.maj': { cible: { table: 'settings', cle: () => 'app', colonnes: ['value'], aplatir: true, masques: ['heuresSupAccord'] } },
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
    etat: db => lireConfidentialite(db),
    bilan: (_p, x) => {
      const avant = x.etat as ContactsConfidentialite, apres = lireConfidentialite(x.db);
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

function cellule(f: Ligne | null, p: P): number {
  return num((f?.lignes as LigneTemps[] | undefined)?.[Number(p.li)]?.h?.[Number(p.di)]);
}

/** Inscrits d'une session de formation (recyclages et formations initiales). */
function inscrits(db: Db, sessionId: unknown): number[] {
  const id = Number(sessionId) || 0;
  return (db.sql.prepare('SELECT emp_id AS e FROM certifications WHERE session_id = ? UNION SELECT emp_id FROM inscriptions WHERE session_id = ?').all(id, id) as { e: number }[]).map(r => r.e);
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
  return sansNature({ ...out, ...(r.extra?.(p, avant) ?? {}) });
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

export function preparerTrace(db: Db, action: string, p: unknown): Trace {
  const regle = REGLES[action];
  const params = p && typeof p === 'object' ? (p as P) : {};
  return { action, p: params, regle, avant: lireCible(db, regle?.cible, params), etat: regle?.etat?.(db, params) };
}

/**
 * Trace une action réussie (dans sa transaction) : code, champs retenus, anciennes et nouvelles valeurs,
 * salariés concernés, message expurgé. Rien pour la saisie d'heures du salarié sur sa propre feuille.
 */
export function journaliserAction(db: Db, t: Trace, x: { user: CurrentUser; compte: Compte; message: string | null; result?: unknown }) {
  const { regle, p, avant } = t;
  const ctx: Contexte = { db, user: x.user, avant, apres: lireCible(db, regle?.cible, p), etat: t.etat, result: x.result };
  if (regle?.tracer && !regle.tracer(p, ctx)) return;
  const code = regle?.code?.(p, ctx) || t.action;
  const payload = { ...champsRetenus(t.action, p, avant), ...(regle?.bilan?.(p, ctx) ?? {}) };
  const propres = regle?.changements?.(p, ctx) ?? null;
  const diff = propres ?? (regle?.cible ? comparer(regle.cible, avant, ctx.apres) : null);
  if (propres?.extra) Object.assign(payload, propres.extra);
  if (diff) Object.assign(payload, { avant: diff.avant, apres: diff.apres });
  const salaries = entiers([p.empId, avant?.empId, ctx.apres?.empId, ...(regle?.salaries?.(p, ctx) ?? [])]);
  const message = expurgerMessage(propres?.message ?? x.message);
  if (regle?.regrouper && regrouper(db, { minutes: regle.regrouper, action: code, compteId: x.compte.id, payload })) return;
  journaliser(db, { actor: x.user.nom, role: x.user.role, action: code, message, payload, compte: x.compte, salaries });
}

/**
 * Ajoute la modification à la dernière ligne du même compte sur le même objet (même valeur de `cle`), si elle date
 * de moins de `minutes` : listes réunies, autres valeurs remplacées, message recalculé au besoin.
 */
function regrouper(db: Db, o: { minutes: number; action: string; compteId: number; payload: Ligne; cle?: string; message?: (fusion: Ligne) => string }): boolean {
  const cle = o.cle ?? 'id';
  const depuis = new Date(Date.now() - o.minutes * 60_000).toISOString();
  const der = db.sql.prepare('SELECT id, payload FROM journal WHERE compte_id = ? AND action = ? AND at >= ? ORDER BY id DESC LIMIT 1')
    .get(o.compteId, o.action, depuis) as { id: number; payload: string } | undefined;
  const prec = der ? lireJson(der.payload) as Ligne : null;
  if (!der || !prec || prec[cle] !== o.payload[cle]) return false;
  const fusion: Ligne = { ...prec };
  for (const [k, v] of Object.entries(o.payload)) fusion[k] = Array.isArray(v) && Array.isArray(prec[k]) ? [...new Set([...prec[k], ...v])] : v;
  db.update('journal', der.id, { at: new Date().toISOString(), payload: fusion, ...(o.message ? { message: o.message(fusion) } : {}) });
  return true;
}

/** Longueur au plus d'un motif de refus recopié (il peut reprendre des clés envoyées par le client). */
const MOTIF_MAX = 200;

/** Refus d'accès (403) d'une personne connectée : action ou écran réservé, motif borné ; rien n'a été modifié. */
export function tracerRefus(db: Db, id: Pick<Identite, 'user' | 'compte'>, quoi: string, motif: string, extra: { action?: string; p?: unknown } = {}) {
  const payload = { ...(extra.action ? { action: extra.action, ...champsRetenus(extra.action, extra.p as P) } : {}) };
  const p = (extra.p ?? {}) as P;
  const court = motif.length > MOTIF_MAX ? `${motif.slice(0, MOTIF_MAX)}…` : motif;
  journaliser(db, {
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
      // Bilan du jour (heure locale du serveur) : la ligne déjà écrite aujourd'hui est complétée.
      const minuit = new Date(maintenant);
      minuit.setHours(0, 0, 0, 0);
      const du = db.sql.prepare('SELECT id, payload FROM journal WHERE action = ? AND at >= ? AND at <= ? ORDER BY id DESC LIMIT 1')
        .get('journal.conservation', minuit.toISOString(), maintenant.toISOString()) as { id: number; payload: string } | undefined;
      const prec = (du ? lireJson(du.payload) : null) as (BilanConservation & { passages?: number }) | null;
      const total = prec
        ? { supprimees: num(prec.supprimees) + supprimees, archivees: num(prec.archivees) + archivees, supprimeesArchive: num(prec.supprimeesArchive) + supprimeesArchive, envois: num(prec.envois) + envois }
        : b;
      const payload = { ...total, passages: prec ? (prec.passages ?? 1) + 1 : 1 };
      const message = `Durée de conservation : ${bilanTexte(total)}`;
      if (du && prec) db.update('journal', du.id, { at: maintenant.toISOString(), message, payload });
      else journaliser(db, { at: maintenant.toISOString(), actor: 'Cursus', role: null, action: 'journal.conservation', message, payload });
    }
    return b;
  });
}

/**
 * Lignes déjà écrites d'une action devenue « liée à la paie » (ACTIONS_PAIE élargie depuis) : marquées comme telles,
 * pour qu'elles passent dans l'archive au lieu d'être supprimées.
 */
export function marquerPaie(db: Db): number {
  const dans = ACTIONS_PAIE.map(() => '?').join(', ');
  return Number(db.sql.prepare(`UPDATE journal SET paie = 1 WHERE (paie IS NULL OR paie = 0) AND (action IN (${dans}) OR action LIKE 'sage.%')`).run(...ACTIONS_PAIE).changes);
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
export function reprendreJournal(db: Db): number {
  if (db.getSetting<boolean>('journalExpurge', false)) return 0;
  return db.tx(() => {
    const lignes = db.sql.prepare('SELECT id, action, message, payload FROM journal WHERE salaries IS NULL').all() as { id: number; action: string; message: string | null; payload: string | null }[];
    const maj = db.sql.prepare('UPDATE journal SET payload = ?, message = ?, salaries = ?, paie = ? WHERE id = ?');
    let reduites = 0;
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
      const message = expurgerMessage(l.message);
      if (JSON.stringify(payload) !== JSON.stringify(p) || message !== l.message) reduites++;
      maj.run(JSON.stringify(payload), message, JSON.stringify(salaries), estActionPaie(l.action) ? 1 : 0, l.id);
    }
    db.setSetting('journalExpurge', true);
    return reduites;
  });
}

/**
 * Au démarrage : reprise des anciennes lignes, conservation appliquée puis relancée toutes les heures. Index du journal
 * (`journal_at`, `journal_action`) : migration nommée (server/src/migrations/exploitation.ts).
 */
export function demarrerJournal(db: Db) {
  const reduites = reprendreJournal(db);
  if (reduites) {
    // La copie faite avant la migration (et toute sauvegarde antérieure) garde l'ancien journal, non expurgé.
    const copie = copieAvantMigration(db);
    console.log(`Journal : ${plural(reduites, 'ligne antérieure expurgée', 'lignes antérieures expurgées')} (numéros de passeport, CSV, natures d’absence…). `
      + (copie
        ? `La copie ${copie} contient encore l’ancien journal : supprimez-la une fois la mise à jour vérifiée (docs/DEPLOIEMENT.md).`
        : 'Les sauvegardes antérieures contiennent encore l’ancien journal (docs/DEPLOIEMENT.md).'));
  }
  marquerPaie(db);
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

/** Le filtre « Action » désigne-t-il les appels de Keystone (code exact, ou leur famille) ? */
const appelsDemandes = (action: string | null) => action === ACTION_APPEL_KEYSTONE || (!!action?.startsWith('famille:') && familleAction(ACTION_APPEL_KEYSTONE)?.id === action.slice(8));

function clauses(f: FiltreJournal): { where: string; params: (string | number)[] } {
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
  // Salarié désigné par son nom et son matricule de paie (matricule Cursus tant qu'il manque, ou fiche supprimée).
  const fiches = new Map((db.sql.prepare('SELECT id, nom, matricule_paie AS matriculePaie FROM employes').all() as { id: number; nom: string; matriculePaie: string | null }[]).map(e => [e.id, e]));
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
function filtresTexte(db: Db, f: FiltreJournal): string {
  const parts = [
    f.vue !== 'tout' && { operations: 'opérations', connexions: 'connexions', keystone: 'appels de Keystone', archive: 'archive paie' }[f.vue],
    f.du && `depuis le ${fmtIso(f.du)}`, f.au && `jusqu’au ${fmtIso(f.au)}`, f.auteur && `auteur « ${f.auteur} »`,
    f.action && `action ${f.action.startsWith('famille:') ? FAMILLES_JOURNAL.find(x => x.id === f.action!.slice(8))?.label ?? f.action : libelleAction(f.action)}`,
    f.salarie && `salarié ${nomSalarie(db, f.salarie)}`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'aucun filtre';
}

/**
 * Personne connectée qui a le droit demandé (par défaut : lire le journal, droit « rh » ou « consultation »,
 * shared/journal.ts), ou réponse 401 / 403 (le refus d'une personne connectée est tracé). Le profil compte, pas
 * l'espace : un profil restreint de l'espace RH (référent HSE, paie) n'a ni le journal ni l'export des données.
 */
export function exigerRh(db: Db, req: Request, res: Response, quoi: string, autorise: (u: CurrentUser) => boolean = lecteurJournal): Identite | null {
  const id = identite(db, req);
  if (!id) { res.status(401).json({ error: 'Connexion requise' }); return null; }
  if (!autorise(id.user)) {
    tracerRefus(db, id, quoi, 'réservé au service RH');
    res.status(403).json({ error: 'Réservé au service RH' });
    return null;
  }
  return id;
}

/** Actions dont le message ou le détail touche à la santé : absence (dates d'un arrêt), visite médicale, vaccination, document déclaré. */
const ACTIONS_SANTE = new Set([
  'absence.saisir', 'absence.qualifier', 'absence.prolonger', 'absence.annuler', 'medical.demander', 'medical.annuler', 'medical.avis',
  'formalite.enregistrer', 'demande.accepter', 'email.visite.demande', 'reprise.visites',
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
function tracerArchive(db: Db, id: Identite, f: FiltreJournal, page: number, total: number) {
  const filtres = filtresTexte(db, f);
  const message = (x: Ligne) => {
    const pages = (x.pages as number[]).slice().sort((a, b) => a - b);
    const vues = pages.length === 1 && pages[0] === 1 ? '' : ` · ${pages.length > 1 ? 'pages' : 'page'} ${pages.slice(0, 20).join(', ')}${pages.length > 20 ? '…' : ''}`;
    return `Consultation de l’archive paie — ${plural(total, 'ligne', 'lignes')} (${filtres})${vues}`;
  };
  const payload = { filtres, pages: [page] };
  if (regrouper(db, { minutes: 15, action: 'journal.archive', compteId: id.compte.id, payload, cle: 'filtres', message })) return;
  journaliser(db, { actor: id.user.nom, role: id.user.role, action: 'journal.archive', message: message(payload), payload, compte: id.compte, salaries: f.salarie ? [f.salarie] : [] });
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
    // L'archive n'apparaît qu'à la demande : chaque consultation est tracée, quelle que soit la page lue.
    if (f.vue === 'archive') tracerArchive(db, id, f, page, out.total);
    res.json({ ...out, lignes: pourLecteur(id.user, out.lignes) });
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
    fichierJoint(res, 'text/csv; charset=utf-8', `journal${f.vue === 'archive' ? '-archive-paie' : ''}-${jourLocal()}.csv`, csvJournal(db, pourLecteur(id.user, lignes)));
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
