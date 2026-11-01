// Banc d'oracle (lot 9, chantier 4) : suite d'écritures aléatoire et reproductible, tirée d'une graine, puis, après chaque
// pas, comparaison de tout ce que sert la lecture partagée avec la relecture complète (scripts/charge/verifier.ts) :
// - écritures : actions du registre ACTIONS (POST /api/actions/:nom, l'application montée sur une boucle locale) par des
//   comptes tirés au hasard, dans leurs espaces, avec des paramètres tirés des données du moment (salarié, semaine,
//   absence, session…) ; et du SQL direct, comme une reprise ou un outil (INSERT, UPDATE, DELETE, upsert ON CONFLICT,
//   instruction de plusieurs lignes) ;
// - avant chaque action : jeu remis à l'action (`donneesAction`) contre `loadFull` de son compte, dans une même
//   transaction ; après : instantané renvoyé contre l'instantané lu directement ;
// - après chaque pas (ou tous les `verifierTous` pas) : vue de chaque compte, espace et profil RH (PROFILS_RH), entrée du
//   cache et jeu d'action de chaque lecteur, contre la lecture directe (`instantaneDirect`, `loadFull`).
// Il juge le cache tel qu'il est : depuis l'étape 2 du lot 9, le cache incrémental (entrée dérivée par le delta des lignes
// changées, vues reportées ; compteurs `statistiquesCache` de server/src/cache-instantane.ts). La relecture complète
// (`loadFull`) lit les tables dans leur fenêtre de lecture du jour (`FENETRES`, lot 12, socle) : le banc compare donc à
// la lecture brute fenêtrée, comme le cache.
// Un appel refusé (4xx) fait partie du jeu : il ne doit rien changer. Une 5xx est une erreur du banc ou de Cursus.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { addD, mondayOf } from '../../shared/dates.ts';
import { ACTIVITE_ASTREINTE, droitsRh, ENT_TYPES, PROFILS_RH } from '../../shared/constants.ts';
import { contratFige } from '../../shared/rules/temps.ts';
import type { Absence, CurrentUser, Dataset, FeuilleTemps } from '../../shared/types.ts';
import { ACTIONS } from '../../server/src/actions/index.ts';
import { createApp } from '../../server/src/app.ts';
import { empreinteSession, sign } from '../../server/src/auth.ts';
import { espacesDuCompte, type Compte } from '../../server/src/comptes.ts';
import { currentUser, loadFull } from '../../server/src/dataset.ts';
import type { Db } from '../../server/src/db.ts';
import { comptesDemo, seedDemo } from '../../server/src/seed.ts';
import { aleatoire, type Aleatoire } from '../../scripts/charge/commun.ts';
import { insererPortable, type JeuFabrique, peuplerJeu } from '../../scripts/charge/fabrique.ts';
import {
  cleLecteur, comparerJeuAction, comparerReponse, type Divergence, lecteursDe, verifierExactitude,
} from '../../scripts/charge/verifier.ts';

/** Compte connecté dans un espace : session ouverte en base, cookie signé comme par Cursus. */
interface Acteur { compteId: number; role: CurrentUser['role']; cookie: string; cle: string }

/**
 * Actions jamais tirées : la remise à zéro de la démonstration (efface les comptes et leurs sessions, la suite ne
 * pourrait plus écrire) ; l'activation des comptes et la réinitialisation des mots de passe (comptes du banc rendus
 * inutilisables) ; l'essai d'envoi et la messagerie (aucun effet sur les données lues).
 */
const EXCLUES = new Set(['demo.reinitialiser', 'compte.activer', 'compte.reinitialiser', 'messagerie.essai', 'messagerie.recapituler']);

/** Lecteur interne des tirages : tout le jeu, paie comprise (aucune réponse n'en sort). */
const TIRAGE: CurrentUser = { role: 'rh', empId: null, nom: 'Banc d’oracle', intitule: 'Tirages', profilRh: 'rh_admin' };

/**
 * Paramètres d'une action tirés de l'état du moment `ds`, pour `acteur` (salarié de l'acteur favorisé). Saisie :
 * `saisie` tire un salarié que l'acteur peut saisir (lui-même, son équipe ; tous pour le service RH), `modifiable`
 * une feuille encore saisissable (brouillon, à corriger) de l'un d'eux qui vérifie `garder`, ou null, `soumises` une feuille soumise que l'acteur peut valider
 * (`validables` : son équipe, tous pour le service RH, jamais lui-même) ; `cible` : feuille ou absence visée, tirée avec
 * l'acteur (`acteurAdapte` de `rejouer`), ou null.
 */
type Tirage = (x: {
  ds: Dataset; r: Aleatoire; empId: () => number; semaine: (empId: number, statut?: string) => string; date: (min: number, max: number) => string; user: CurrentUser;
  saisie: () => number; modifiable: (garder: (f: FeuilleTemps) => boolean) => FeuilleTemps | null; validables: Set<number>; soumises: (r: Aleatoire) => { empId: number; week: string } | null;
  cible: FeuilleTemps | Absence | null;
  /** Validations groupées par salarié (`OptionsOracle.lotsGroupes`). */
  lotsGroupes: boolean;
}) => Record<string, unknown>;

const KINDS = ['CP', 'RTT', 'RECUP'];
const NATURES = ['MALADIE', 'ENFANT_MALADE', 'SANS_SOLDE', 'AT', 'MARIAGE'];
/** Élément de `l` au hasard, ou null si `l` est vide. */
const parmi = <T>(r: Aleatoire, l: readonly T[]): T | null => (l.length ? r.choix(l) : null);
/** Fiche du salarié `empId`, ou une autre si elle n'existe plus (anonymisée, retirée par un essai). */
const fiche = (ds: Dataset, r: Aleatoire, empId: number) => ds.employes.find(x => x.id === empId) ?? r.choix(ds.employes);
const id = <T extends { id: number }>(r: Aleatoire, l: readonly T[] | undefined, filtre: (x: T) => boolean = () => true) => {
  const c = (l ?? []).filter(filtre);
  return c.length ? r.choix(c).id : r.entre(1, 50);
};

/**
 * Tirages ciblés des actions les plus fréquentes (saisie, absences, compteurs, fiches, sessions) : les autres actions du
 * registre reçoivent des paramètres tirés d'après les noms qu'elles lisent (`tirageGenerique`).
 */
const TIRAGES: Record<string, Tirage> = {
  // Saisie (lot 9, relecture de l'étape 1) : salarié parmi ceux que l'acteur peut saisir, feuille modifiable qui a des
  // lignes et ligne prise parmi les siennes ; sinon presque toutes les saisies étaient refusées (« Cellule invalide »).
  'temps.setCell': ({ r, saisie, modifiable, ds }) => {
    const sh = r.si(0.9) ? modifiable(f => f.lignes.some(l => l.projet !== ACTIVITE_ASTREINTE.code)) : null;
    if (!sh) return { empId: saisie(), week: mondayOf(ds.today), li: 0, di: r.entre(0, 4), value: String(r.entre(0, 9)) };
    const lignes = sh.lignes.map((l, i) => [l, i] as const).filter(([l]) => l.projet !== ACTIVITE_ASTREINTE.code);
    return { empId: sh.empId, week: sh.week, li: r.choix(lignes)[1], di: r.entre(0, 4), value: String(r.entre(0, 9)) };
  },
  'temps.addLine': ({ r, saisie, modifiable, ds }) => {
    const sh = r.si(0.7) ? modifiable(() => true) : null;
    return { empId: sh?.empId ?? saisie(), week: sh?.week ?? mondayOf(ds.today), projet: r.choix(ds.referentiels.projets.filter(x => x.statut !== 'archive' && x.code !== ACTIVITE_ASTREINTE.code)).code };
  },
  'temps.removeLine': ({ r, saisie, modifiable, semaine }) => {
    const sh = modifiable(f => f.lignes.length > 1);
    if (!sh) { const e = saisie(); return { empId: e, week: semaine(e), li: r.entre(0, 2) }; }
    const li = r.entre(0, sh.lignes.length - 1);
    return { empId: sh.empId, week: sh.week, li, projet: sh.lignes[li].projet, tache: sh.lignes[li].tache, lignes: sh.lignes.length };
  },
  'temps.submit': ({ saisie, modifiable, semaine }) => {
    const sh = modifiable(f => f.lignes.some(l => l.h.some(v => Number(v) > 0)));
    if (sh) return { empId: sh.empId, week: sh.week };
    const e = saisie();
    return { empId: e, week: semaine(e, 'brouillon') };
  },
  'temps.validate': ({ r, soumises, empId, semaine, cible }) => (cible && 'week' in cible ? { empId: cible.empId, week: cible.week } : soumises(r) ?? { empId: empId(), week: semaine(empId(), 'soumise') }),
  'temps.reject': ({ r, soumises, empId, semaine, cible }) => ({
    ...cible && 'week' in cible ? { empId: cible.empId, week: cible.week } : soumises(r) ?? { empId: empId(), week: semaine(empId(), 'soumise') }, comment: 'Merci de vérifier',
  }),
  'temps.rouvrir': ({ r, ds, user, empId, semaine }) => {
    const f = parmi(r, ds.feuilles.filter(x => x.statut === 'validee' && x.empId !== user.empId));
    return f ? { empId: f.empId, week: f.week, motif: 'Correction des heures (banc d’oracle)' } : { empId: empId(), week: semaine(empId(), 'validee'), motif: 'Correction des heures (banc d’oracle)' };
  },
  'temps.validerLot': ({ r, ds, validables, lotsGroupes }) => {
    const candidates = ds.feuilles.filter(f => f.statut === 'soumise' && validables.has(f.empId));
    if (lotsGroupes) {
      // Lot de fin de mois (lot 10, chantier B) : toutes les feuilles soumises de trois à huit salariés, semaines
      // consécutives comprises, dans l'ordre des semaines ou à rebours, salariés à la suite ou entremêlés : c'est là que
      // les mémos par salarié du Domain partagé sont repris (autres salariés) ou oubliés (feuille de la veille, contingent).
      const salaries = [...new Set(candidates.map(f => f.empId))];
      const choisis = Array.from({ length: Math.min(salaries.length, r.entre(3, 8)) }, () => salaries.splice(r.entre(0, salaries.length - 1), 1)[0]);
      const parSalarie = choisis.map(e => {
        const siennes = candidates.filter(f => f.empId === e).sort((a, b) => a.week.localeCompare(b.week));
        return r.si(0.5) ? siennes : siennes.reverse();
      });
      const lot: FeuilleTemps[] = [];
      if (r.si(0.5)) lot.push(...parSalarie.flat());
      else for (let i = 0; parSalarie.some(l => i < l.length); i++) for (const l of parSalarie) if (i < l.length) lot.push(l[i]);
      return { feuilles: lot.slice(0, 30).map(f => ({ empId: f.empId, week: f.week })) };
    }
    const lot = Array.from({ length: Math.min(candidates.length, r.entre(1, 4)) }, () => r.choix(candidates));
    return { feuilles: [...new Map(lot.map(f => [f.id, { empId: f.empId, week: f.week }])).values()] };
  },
  // Absences : salarié parmi ceux de l'acteur, absence visée tirée avec l'acteur (`cible`) quand elle existe.
  'absence.demander': ({ r, saisie, date }) => { const du = date(1, 60); return { empId: saisie(), kind: r.choix(KINDS), du, au: addD(du, r.entre(0, 3)) }; },
  'absence.decider': ({ r, ds, cible }) => ({ id: cible?.id ?? id(r, ds.absences, a => a.statut === 'demandee'), ok: r.si(0.7), motif: 'Effectif insuffisant' }),
  'absence.annuler': ({ r, ds, cible }) => ({ id: cible?.id ?? id(r, ds.absences) }),
  'absence.signaler': ({ saisie, date }) => { const du = date(-3, 2); return { empId: saisie(), du, au: du }; },
  'absence.saisir': ({ r, empId, date }) => { const du = date(-20, 20); return { empId: empId(), nature: r.choix(NATURES), du, au: addD(du, r.entre(0, 2)) }; },
  'absence.qualifier': ({ r, ds, cible }) => ({ id: cible?.id ?? id(r, ds.absences, a => a.statut === 'signalee'), nature: r.choix(NATURES) }),
  'absence.prolonger': ({ r, ds, date, cible }) => ({ id: cible?.id ?? id(r, ds.absences), au: date(0, 15) }),
  'cet.placer': ({ r, empId }) => ({ empId: empId(), kind: r.choix(['CP', 'RTT']), jours: r.entre(1, 2) }),
  'report.accorder': ({ r, empId }) => ({ empId: empId(), jours: r.entre(1, 2), motif: 'Report accordé (banc d’oracle)' }),
  'equipe.affecter': ({ r, empId, ds }) => ({ empId: empId(), equipe: r.choix(ds.referentiels.equipes).nom }),
  'employe.modifier': ({ r, empId, ds }) => {
    const e = fiche(ds, r, empId());
    // lot 11 — indicateurs : sexe et catégorie d'emploi (service RH seulement), vidés parfois.
    if (r.si(0.2)) return { id: e.id, sexe: r.choix(['F', 'M', '']), categorie: r.choix(['ouvrier', 'employe', 'tam', 'cadre', '']), avant: { sexe: e.sexe ?? null, categorie: e.categorie ?? null } };
    return r.si(0.5) ? { id: e.id, email: `${e.id}.${r.entre(1, 99)}@essai.example`, avant: { email: e.email } } : { id: e.id, poste: r.choix(ds.employes).poste, avant: { poste: e.poste } };
  },
  'employe.contactUrgence': ({ r, empId }) => ({ empId: empId(), nom: `Contact ${r.entre(1, 99)}`, telephone: `06 00 00 00 ${String(r.entre(10, 99))}` }),
  'parametres.maj': ({ r }) => (r.si(0.5) ? { relancesActives: r.si(0.5) } : { horizonAlerte: r.entre(30, 90) }),
  'entretien.planifier': ({ r, empId, date }) => ({ empId: empId(), kind: r.choix(Object.keys(ENT_TYPES)), date: date(3, 60) }),
  'session.creer': ({ r, ds, date }) => ({ f: r.choix(ds.referentiels.formations).id, date: date(10, 90), lieu: 'Salle B', places: r.entre(4, 12) }),
  'plan.inscrire': ({ r, empId, ds }) => {
    const e = fiche(ds, r, empId());
    return { empId: e.id, sessionId: id(r, ds.sessions), certId: e.certs.length ? r.choix(e.certs).id : undefined, conv: 'later' };
  },
  'cert.ajouter': ({ r, empId, ds, date }) => ({ empId: empId(), f: r.choix(ds.referentiels.formations).id, date: date(-300, -1) }),
  'hab.delivrer': ({ r, empId, ds, date }) => ({ empId: empId(), h: r.choix(ds.referentiels.habilitations).id, date: date(-30, 0), par: 'Direction' }),
  'medical.demander': ({ empId }) => ({ empId: empId(), motif: 'Visite à la demande' }),
  'voyage.creer': ({ r, empId, ds, date }) => { const d = date(10, 60); return { empId: empId(), dest: r.choix(ds.referentiels.destinations).code, motif: 'Mission', depart: d, retour: addD(d, r.entre(1, 5)) }; },
  'demande.formation': ({ r, ds }) => ({ f: r.choix(ds.referentiels.formations).id, motif: 'Montée en compétence' }),
  'mandat.enregistrer': ({ r, empId, date }) => ({ empId: empId(), role: r.choix(['titulaire', 'suppleant']), du: date(-100, 0), credit: r.entre(5, 20) }),
  'astreinte.planifier': ({ empId, date }) => { const du = date(8, 40); return { empId: empId(), du, au: addD(du, 6), debut: '18:00', fin: '08:00' }; },
  // lot 11 — notes de frais : note, dépense, véhicule et avance tirés dans l'état du moment (module activé en démonstration).
  'frais.note.creer': ({ r, saisie, ds }) => ({ empId: saisie(), periode: ds.today.slice(0, 7), medicale: r.si(0.2) }),
  'frais.ligne.ajouter': ({ r, ds, date }) => {
    const n = parmi(r, (ds.notesFrais ?? []).filter(x => x.statut === 'brouillon' || x.statut === 'a_corriger'));
    return { noteId: n?.id ?? id(r, ds.notesFrais), date: date(-20, 0), categorie: n?.medicale ? 'medical' : r.choix(['divers', 'repas', 'train']), montant: r.entre(5, 90), sansJustificatif: true, attestation: true };
  },
  'frais.ligne.modifier': ({ r, ds }) => ({ id: id(r, ds.lignesFrais), montant: r.entre(5, 90) }),
  'frais.ligne.supprimer': ({ r, ds }) => ({ id: id(r, ds.lignesFrais) }),
  'frais.note.soumettre': ({ r, ds }) => ({ id: id(r, ds.notesFrais, n => (n.statut === 'brouillon' || n.statut === 'a_corriger') && (ds.lignesFrais ?? []).some(l => l.noteId === n.id)) }),
  'frais.note.valider': ({ r, ds }) => ({ id: id(r, ds.notesFrais, n => n.statut === 'soumise') }),
  'frais.note.renvoyer': ({ r, ds }) => ({ id: id(r, ds.notesFrais, n => n.statut === 'soumise' || n.statut === 'validee'), motif: 'Justificatif illisible' }),
  'frais.note.controler': ({ r, ds }) => ({ id: id(r, ds.notesFrais, n => n.statut === 'validee') }),
  'frais.ligne.refuser': ({ r, ds }) => ({ id: id(r, ds.lignesFrais), motif: 'Dépense personnelle' }),
  'frais.ligne.plafonner': ({ r, ds }) => ({ id: id(r, ds.lignesFrais), montant: r.entre(1, 20) }),
  'frais.note.annuler': ({ r, ds }) => ({ id: id(r, ds.notesFrais, n => n.statut !== 'payee' && n.statut !== 'en_paiement') }),
  'frais.vehicule.declarer': ({ r, saisie, ds }) => ({ empId: saisie(), type: 'voiture', cv: r.entre(3, 8), du: ds.today }),
  'frais.forfait.enregistrer': ({ r }) => ({ annee: 2026, code: r.choix(['panier', 'repas_hors_locaux']), montant: r.entre(5, 12) }),
  'frais.taux.enregistrer': ({ r, ds }) => ({ devise: r.choix(['USD', 'GBP']), mois: ds.today.slice(0, 7), taux: r.entre(80, 120) / 100 }),
  'frais.avance.demander': ({ r, saisie }) => ({ empId: saisie(), montant: r.entre(1, 5) * 100 }),
  'frais.avance.valider': ({ r, ds }) => ({ id: id(r, ds.avancesFrais, a => a.statut === 'demandee') }),
  'frais.avance.refuser': ({ r, ds }) => ({ id: id(r, ds.avancesFrais, a => a.statut === 'demandee'), motif: 'Mission annulée' }),
  'frais.avance.annuler': ({ r, ds }) => ({ id: id(r, ds.avancesFrais, a => a.statut === 'demandee') }),
  // lot 12 — C1 (forfait annuel en heures)
  // Clôture d'une plage de l'an passé ou de l'année (le plus souvent refusée : plage en cours, semaines sans feuille), puis
  // réouverture ou annulation d'une ligne existante.
  'forfaitHeures.cloturer': ({ r, empId, ds }) => ({ lignes: [{ empId: empId(), debut: `${Number(ds.today.slice(0, 4)) - r.entre(0, 1)}-01-01` }] }),
  'forfaitHeures.rouvrir': ({ r, ds }) => ({ id: id(r, ds.cloturesForfaitHeures, l => l.statut === 'confirmee'), motif: 'Feuille corrigée (banc d’oracle)' }),
  'forfaitHeures.annuler': ({ r, ds }) => ({ id: id(r, ds.cloturesForfaitHeures, l => l.statut !== 'annulee'), motif: 'Clôture faite trop tôt (banc d’oracle)' }),
  // lot 12 — C2 (notes de frais : activation)
  // lot 12 — C3 (entretiens suivis et 360°)
  // Objectifs et souhaits : entretien annuel planifié (fixation, évaluation), objectif de l'état voulu, codes fixes.
  'objectif.ajouter': ({ r, ds, date }) => ({ entretienId: id(r, ds.entretiens, x => x.type === 'annuel' && x.statut === 'planifie'), libelle: `Objectif ${r.entre(1, 99)}`, categorie: r.choix(['individuel', 'collectif', 'developpement']), echeance: date(60, 300) }),
  'objectif.proposer': ({ r, ds }) => ({ entretienId: id(r, ds.entretiens, x => x.type === 'annuel' && x.statut === 'planifie'), libelle: `Proposition ${r.entre(1, 99)}`, categorie: 'developpement' }),
  'objectif.modifier': ({ r, ds }) => ({ id: id(r, ds.objectifs, o => o.statut === 'propose' || o.statut === 'ouvert'), poids: r.si(0.5) ? r.entre(0, 30) : null }),
  'objectif.retirer': ({ r, ds }) => ({ id: id(r, ds.objectifs, o => o.statut === 'propose' || o.statut === 'ouvert') }),
  'objectif.avancer': ({ r, ds }) => ({ id: id(r, ds.objectifs, o => o.statut === 'ouvert'), avancement: r.entre(0, 100) }),
  'objectif.ajuster': ({ r, ds, date }) => ({ id: id(r, ds.objectifs, o => o.statut === 'ouvert'), echeance: date(30, 200), motif: 'Ajustement (banc d’oracle)' }),
  'objectif.evaluer': ({ r, ds }) => {
    const o = parmi(r, (ds.objectifs ?? []).filter(y => y.statut === 'ouvert'));
    return { id: o?.id ?? r.entre(1, 20), entretienId: id(r, ds.entretiens, x => x.type === 'annuel' && x.statut === 'planifie' && (!o || x.empId === o.empId)), statut: r.choix(['atteint', 'partiel', 'reconduit']) };
  },
  'entretien.souhait': ({ r, ds }) => ({ id: id(r, ds.entretiens, x => x.statut === 'planifie' && ['epp', 'reprise', 'annuel', 'mi_annee'].includes(x.type)), f: r.choix(ds.referentiels.formations).id, priorite: 'normale' }),
  'entretien.avisSouhait': ({ r, ds }) => {
    const x = parmi(r, ds.entretiens.filter(y => y.statut === 'planifie' && (y.souhaits ?? []).length));
    return { id: x?.id ?? r.entre(1, 50), cle: x ? r.choix(x.souhaits!).cle : 's1', avis: r.choix(['favorable', 'defavorable', 'a_discuter']) };
  },
  // lot 12 — C4 (organismes de formation et e-learning) : fiches (créées, renommées — nom recopié dans le catalogue —,
  // Qualiopi), conditions, archivage, vérification, fusion de deux fiches du même type, contacts, tarifs, modules,
  // inscriptions (individuelles), fin déclarée, import d'un fichier d'avancement, fin validée, abandon, correction, annulation.
  'organisme.enregistrer': ({ r, ds, date }) => {
    const o = parmi(r, (ds.organismes ?? []).filter(x => x.fusionneDans == null));
    const qualiopi = { qualiopi: r.si(0.6), qualiopiValideJusquau: date(-30, 400) };
    return o && r.si(0.6) ? { id: o.id, ...qualiopi, ...(r.si(0.4) ? { nomUsuel: `${o.nomUsuel.replace(/ \(\d+\)$/, '')} (${r.entre(1, 99)})` } : {}) }
      : { nomUsuel: `Organisme oracle ${r.entre(1, 999)}`, type: r.choix(['externe', 'independant']), ...qualiopi };
  },
  'organisme.conditions': ({ r, ds }) => ({ id: id(r, ds.organismes), subrogationAcceptee: r.si(0.5), delaiAnnulationJours: r.entre(0, 30) }),
  'organisme.archiver': ({ r, ds }) => ({ id: id(r, ds.organismes), archive: r.si(0.7) }),
  'organisme.verifier': ({ r, ds }) => ({ id: id(r, ds.organismes, o => o.aVerifier) }),
  'organisme.fusionner': ({ r, ds }) => {
    const actives = (ds.organismes ?? []).filter(o => o.fusionneDans == null && !o.archive);
    const s = parmi(r, actives), c = parmi(r, actives.filter(o => s && o.id !== s.id && (o.type === 'interne') === (s.type === 'interne')));
    return { source: s?.id ?? r.entre(1, 20), cible: c?.id ?? r.entre(1, 20), motif: 'Doublon (banc d’oracle)' };
  },
  'organisme.contact.enregistrer': ({ r, ds }) => ({ organismeId: id(r, ds.organismes), nom: `Contact ${r.entre(1, 99)}`, role: r.choix(['commercial', 'formateur']), principal: r.si(0.5) }),
  'organisme.contact.retirer': ({ r, ds }) => ({ id: id(r, ds.organismeContacts, c => !c.archive) }),
  'organisme.tarif.enregistrer': ({ r, ds }) => ({ organismeId: id(r, ds.organismes), formation: r.choix(ds.referentiels.formations).id, montantHt: r.entre(50, 900), unite: 'stagiaire' }),
  'organisme.tarif.archiver': ({ r, ds }) => ({ id: id(r, ds.organismeTarifs, t => !t.archive) }),
  'elearning.module.enregistrer': ({ r, ds }) => (r.si(0.5) && ds.modulesElearning?.length
    ? { id: id(r, ds.modulesElearning), dureeHeures: r.entre(1, 8), accesMois: r.entre(1, 12) }
    : { code: `MOD-${r.entre(1, 999)}`, intitule: 'Module du banc d’oracle', url: 'https://elearning.entreprise.example/m', organismeId: id(r, ds.organismes, o => !o.archive && o.fusionneDans == null), dureeHeures: r.entre(1, 8) }),
  'elearning.module.archiver': ({ r, ds }) => ({ id: id(r, ds.modulesElearning), archive: r.si(0.7) }),
  'elearning.inscrire': ({ r, ds, empId }) => ({ moduleId: id(r, ds.modulesElearning, m => !m.archive), empIds: [empId(), empId()], echeance: addD(ds.today, r.entre(10, 90)) }),
  'elearning.declarer': ({ r, ds }) => ({ id: id(r, ds.inscriptionsElearning, i => i.statut === 'inscrit' || i.statut === 'en_cours') }),
  'elearning.importer': ({ r, ds }) => {
    const ouvertes = (ds.inscriptionsElearning ?? []).filter(i => i.statut === 'inscrit' || i.statut === 'en_cours');
    const ligne = (i: (typeof ouvertes)[number]) => `EMP-${String(i.empId).padStart(4, '0')};${ds.modulesElearning?.find(m => m.id === i.moduleId)?.code ?? '?'};${r.choix(['en cours', 'terminé'])};${r.entre(0, 100)}`;
    return { texte: ['matricule;module;statut;avancement', ...ouvertes.slice(0, 3).map(ligne)].join('\n'), apercu: r.si(0.2) };
  },
  'elearning.terminer': ({ r, ds }) => {
    const i = parmi(r, (ds.inscriptionsElearning ?? []).filter(x => x.statut === 'inscrit' || x.statut === 'en_cours'));
    return { id: i?.id ?? r.entre(1, 20), de: i?.statut, reussi: r.si(0.8) };
  },
  'elearning.abandonner': ({ r, ds }) => {
    const i = parmi(r, (ds.inscriptionsElearning ?? []).filter(x => x.statut === 'inscrit' || x.statut === 'en_cours'));
    return { id: i?.id ?? r.entre(1, 20), de: i?.statut };
  },
  'elearning.corriger': ({ r, ds }) => ({ id: id(r, ds.inscriptionsElearning, i => i.statut === 'en_cours'), echeance: addD(ds.today, r.entre(10, 90)), motif: 'Correction (banc d’oracle)' }),
  'elearning.annuler': ({ r, ds }) => ({ id: id(r, ds.inscriptionsElearning, i => !i.suivieId), motif: 'Doublon (banc d’oracle)' }),
  // lot 12 — C5 (planning d'équipe)
  // lot 12 — C6 (badgeage virtuel) : tirages des pointages à part (`TIRAGES_POINTAGE`), comme ceux des dossiers OPCO.
};

// lot 11 — dossiers OPCO
/** Dossier OPCO de l'un des états `statuts`, au hasard (null : aucun). */
const dossierOpcoDans = (ds: Dataset, r: Aleatoire, ...statuts: string[]) => parmi(r, (ds.dossiersOpco ?? []).filter(d => statuts.includes(d.statut)));
/**
 * Tirages des actions sur les dossiers OPCO (lot 11, chantier C4) : dossier dans l'état que l'action attend (`de` affiché),
 * montants et motifs codés. Ils ne sont pas des cibles (`TIRAGES`) : une action OPCO est tirée parmi toutes les actions du
 * registre, ou ajoutée en renfort (`OptionsOracle.renfort`) par le test du chantier (tests/opco-actions.test.ts).
 */
const TIRAGES_OPCO: Record<string, Tirage> = {
  'opco.creer': ({ r, ds, date }) => {
    const du = date(5, 60);
    return { planActionId: id(r, ds.plan, l => l.statut !== 'reporte'), dispositif: r.choix(['plan', 'tutorat', 'versement_volontaire']), du, au: addD(du, r.entre(0, 3)), montantDemande: r.entre(200, 3000) };
  },
  'opco.modifier': ({ r, ds }) => ({ id: dossierOpcoDans(ds, r, 'a_deposer', 'depose', 'accorde')?.id ?? r.entre(1, 20), heures: r.entre(7, 35), motif: 'Correction (banc d’oracle)' }),
  'opco.deposer': ({ r, ds }) => ({ id: dossierOpcoDans(ds, r, 'a_deposer')?.id ?? r.entre(1, 20), de: 'a_deposer', reference: `OPCO-${r.entre(1, 999)}` }),
  'opco.accorder': ({ r, ds }) => ({ id: dossierOpcoDans(ds, r, 'depose')?.id ?? r.entre(1, 20), de: 'depose', montantAccorde: r.entre(100, 3000) }),
  'opco.refuser': ({ r, ds }) => ({ id: dossierOpcoDans(ds, r, 'depose')?.id ?? r.entre(1, 20), de: 'depose', motif: 'budget_epuise' }),
  'opco.facturer': ({ r, ds }) => ({ id: dossierOpcoDans(ds, r, 'accorde')?.id ?? r.entre(1, 20), de: 'accorde', montantFacture: r.entre(100, 3000) }),
  'opco.versement': ({ r, ds }) => ({ id: dossierOpcoDans(ds, r, 'accorde', 'facture', 'rembourse')?.id ?? r.entre(1, 20), montant: r.entre(50, 1500) }),
  'opco.annulerVersement': ({ r, ds }) => ({ id: id(r, (ds.versementsOpco ?? []).filter(v => !v.annuleLe)), motif: 'Saisi deux fois (banc d’oracle)' }),
  'opco.solder': ({ r, ds }) => { const d = dossierOpcoDans(ds, r, 'facture', 'rembourse'); return { id: d?.id ?? r.entre(1, 20), de: d?.statut ?? 'facture' }; },
  'opco.abandonner': ({ r, ds }) => { const d = dossierOpcoDans(ds, r, 'a_deposer', 'depose'); return { id: d?.id ?? r.entre(1, 20), de: d?.statut ?? 'a_deposer', motif: 'formation_annulee' }; },
  'opco.rouvrir': ({ r, ds }) => { const d = dossierOpcoDans(ds, r, 'depose', 'accorde', 'refuse', 'facture', 'solde', 'abandonne'); return { id: d?.id ?? r.entre(1, 20), de: d?.statut, motif: 'Retour (banc d’oracle)' }; },
  'opco.supprimer': ({ r, ds }) => ({ id: dossierOpcoDans(ds, r, 'a_deposer', 'abandonne')?.id ?? r.entre(1, 20), motif: 'Doublon (banc d’oracle)' }),
};

// lot 12 — C6 (badgeage virtuel)
/**
 * Tirages des actions du badgeage (lot 12, chantier C6) : pointage pour soi (refusé tant que le module est inactif),
 * correction d'un salarié que l'acteur peut saisir, décisions sur une demande en attente, motifs codés. Hors des cibles
 * (`TIRAGES`) : ajoutés en renfort par le test du chantier (tests/pointage-actions.test.ts), module activé.
 */
const TIRAGES_POINTAGE: Record<string, Tirage> = {
  'pointage.pointer': ({ r, user }) => ({ empId: user.empId ?? 2, ...(r.si(0.3) ? { sens: r.choix(['E', 'S']) } : {}) }),
  'pointage.corriger': ({ r, saisie, ds }) => ({
    empId: saisie(), nature: 'ajout', horodatage: `${addD(ds.today, -r.entre(0, 5))}T0${r.entre(5, 9)}:${String(r.entre(0, 59)).padStart(2, '0')}:00.000Z`,
    sens: r.choix(['E', 'S']), motif: r.choix(['oubli', 'appareil', 'mission', 'formation', 'autre']), ...(r.si(0.5) ? { commentaire: 'Banc d’oracle' } : {}),
  }),
  'pointage.validerCorrection': ({ r, ds }) => ({ id: id(r, ds.correctionsPointage, c => c.statut === 'demandee') }),
  'pointage.refuserCorrection': ({ r, ds }) => ({ id: id(r, ds.correctionsPointage, c => c.statut === 'demandee'), motif: 'Refus (banc d’oracle)' }),
  'pointage.annulerCorrection': ({ r, ds }) => ({ id: id(r, ds.correctionsPointage, c => c.statut === 'demandee') }),
};

/** Valeur d'un paramètre d'après son nom, pour les actions sans tirage ciblé. */
function valeur(nom: string, action: string, x: Parameters<Tirage>[0]): unknown {
  const { r, ds, empId, semaine, date } = x;
  const famille = action.split('.')[0];
  // Lignes désignées par `id`, d'après la famille de l'action (absence.*, session.*…) ; inconnue : un entier au hasard.
  const tables: Record<string, string> = {
    absence: 'absences', session: 'sessions', entretien: 'entretiens', voyage: 'voyages', demande: 'demandesCollab', plan: 'plan', employe: 'employes',
    mandat: 'mandats', astreinte: 'astreintes', medical: 'demandesVisite', formationSuivie: 'formationsSuivies', forfait: 'avenantsForfait',
    equipe: 'delegations', conges: 'informationsCp', keystone: 'demandesKeystone', attente: 'attentesSession', evaluation: 'evaluationsFormation',
    // lot 11 — indicateurs
    indicateurs: 'indicateursArretes',
    // lot 11 — dossiers OPCO
    opco: 'dossiersOpco',
    // lot 12 — C1 (forfait annuel en heures)
    forfaitHeures: 'cloturesForfaitHeures',
    // lot 12 — C2 (notes de frais : activation)
    // lot 12 — C3 (entretiens suivis et 360°)
    objectif: 'objectifs',
    // lot 12 — C4 (organismes de formation et e-learning)
    organisme: 'organismes', elearning: 'inscriptionsElearning',
    // lot 12 — C5 (planning d'équipe) : `id` d'une action du planning désigne un créneau (les échanges ont leur tirage par nom).
    planning: 'creneaux',
    // lot 12 — C6 (badgeage virtuel)
    pointage: 'correctionsPointage',
  };
  const lignes = (nomListe: string | undefined) => (nomListe ? (ds as unknown as Record<string, { id: number }[] | undefined>)[nomListe] : undefined);
  const parFamille = (f: string) => (f === 'cert' ? ds.employes.flatMap(e => e.certs) : lignes(tables[f]));
  // lot 11 — organigramme : entités, sites et rattachements d'équipe tirés des données du moment (code existant, ou nouveau).
  const entites = ds.referentiels.entites ?? [], sites = ds.referentiels.sites ?? [];
  if (famille === 'entite' || famille === 'site' || famille === 'organigramme' || ['entite', 'siteCode', 'uniteCode'].includes(nom)) {
    switch (nom) {
      case 'code': return famille === 'site' ? `site_${r.entre(1, 4)}` : entites.length && r.si(0.6) ? r.choix(entites).code : `ent_${r.entre(1, 6)}`;
      case 'id': return sites.length && r.si(0.5) ? r.choix(sites).code : undefined;
      case 'type': return r.si(0.6) ? 'societe' : 'etablissement';
      case 'parente': { const s = entites.filter(x => x.type === 'societe'); return s.length ? r.choix(s).code : undefined; }
      case 'nom': return famille === 'entite' ? `Entité ${r.entre(1, 99)}` : r.choix(ds.referentiels.equipes).nom;
      case 'entite': return entites.length && r.si(0.8) ? r.choix(entites).code : '';
      case 'siteCode': return sites.length && r.si(0.8) ? r.choix(sites).code : '';
      case 'uniteCode': return r.si(0.7) ? `ORA-E${r.entre(1, 5)}` : '';
      case 'lignes': return r.entre(0, 40);
      default: break;
    }
  }
  switch (nom) {
    case 'empId': case 'managerId': case 'suppleantId': return empId();
    case 'id': return id(r, parFamille(famille));
    case 'week': case 'semaine': return semaine(empId());
    case 'li': return r.entre(0, 2);
    case 'di': return r.entre(0, 6);
    case 'value': return String(r.entre(0, 9));
    case 'du': case 'date': case 'depart': case 'le': case 'signeLe': case 'demandeLe': case 'verifieLe': return date(-15, 45);
    case 'au': case 'fin': case 'retour': case 'expire': case 'jusquau': return date(46, 120);
    case 'kind': return r.choix(KINDS);
    case 'nature': return r.choix(NATURES);
    case 'f': return r.choix(ds.referentiels.formations).id;
    case 'h': return r.choix(ds.referentiels.habilitations).id;
    case 'dest': return r.choix(ds.referentiels.destinations).code;
    case 'projet': return r.choix(ds.referentiels.projets).code;
    case 'equipe': case 'nom': case 'parente': return r.choix(ds.referentiels.equipes).nom;
    case 'sessionId': return id(r, ds.sessions);
    case 'certId': return id(r, ds.employes.flatMap(e => e.certs));
    case 'inscriptionId': return id(r, ds.inscriptions);
    case 'planId': return id(r, ds.plan);
    case 'demandeId': return id(r, ds.demandesCollab);
    case 'astreinteId': return id(r, lignes('astreintes'));
    case 'jours': case 'places': case 'effectif': case 'effectifReel': case 'note': case 'efficacite': return r.entre(1, 5);
    case 'cout': case 'coutReel': return r.entre(100, 900);
    case 'annee': case 'exercice': return Number(ds.today.slice(0, 4)) - r.entre(0, 1);
    case 'periode': return ds.today.slice(0, 7);
    case 'ok': case 'actif': case 'archive': case 'requise': case 'suspendre': case 'lever': case 'grandDeplacement': case 'alternant': case 'confirmer': case 'nonTenu': case 'renvoyer': return r.si(0.5);
    case 'profilRh': return r.choix(Object.keys(PROFILS_RH).filter(p => p !== 'rh_admin'));
    case 'perimetre': return ['feuilles', 'absences'];
    case 'motif': case 'comment': case 'commentaire': case 'reponse': case 'libelle': case 'texte': case 'lieu': case 'par': case 'reference': case 'numero': case 'telephone': case 'info': return `Banc d’oracle ${r.entre(1, 999)}`;
    // lot 12 — C1 (forfait annuel en heures)
    // lot 12 — C2 (notes de frais : activation)
    // lot 12 — C3 (entretiens suivis et 360°)
    // lot 12 — C4 (organismes de formation et e-learning)
    // lot 12 — C5 (planning d'équipe) : pour ses seules actions (les autres familles gardent leur tirage) : cycle et groupe
    // amorcés, horaire d'exemple, jour à venir, créneau publié (échanges), collègue, motif des alertes.
    case 'cycle': case 'groupe': case 'horaire': case 'jour': case 'creneauId': case 'creneauPartenaire': case 'partenaireId': case 'motifAlertes':
      if (famille !== 'planning') return undefined;
      return nom === 'cycle' ? r.choix(['JOUR', '2X8', '3X8', '5X8']) : nom === 'groupe' ? r.choix(['A', 'B', 'C']) : nom === 'horaire' ? r.choix(['J', 'M', 'AM', 'N', ''])
        : nom === 'jour' ? date(0, 40) : nom === 'partenaireId' ? r.choix(ds.employes).id : nom === 'motifAlertes' ? `Banc d’oracle ${r.entre(1, 999)}`
          : id(r, (ds.creneaux ?? []).filter(c => c.statut === 'publie' && c.horaire));
    // lot 12 — C6 (badgeage virtuel)
    default: return undefined;
  }
}

/** Noms des paramètres lus par une action (`p.nom` dans son code, plus le salarié et la semaine des actions de temps). */
const nomsLus = new Map<string, string[]>();
function parametresLus(action: string): string[] {
  let n = nomsLus.get(action);
  if (!n) {
    const code = ACTIONS[action].toString();
    n = [...new Set([...code.matchAll(/\bp\.([a-zA-Z_]+)/g)].map(m => m[1]))];
    if (action.startsWith('temps.')) n.push('empId', 'week');
    nomsLus.set(action, n = [...new Set(n)]);
  }
  return n;
}

function tirageGenerique(action: string, x: Parameters<Tirage>[0]): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const nom of parametresLus(action)) {
    const v = valeur(nom, action, x);
    if (v !== undefined) p[nom] = v;
  }
  return p;
}

export interface OptionsOracle {
  graine: number;
  /** Nombre de pas (écritures tentées). */
  pas: number;
  /** Part des pas en SQL direct (0 à 1). */
  sql?: number;
  /** Comparaison complète tous les `verifierTous` pas (1 : après chaque pas), et toujours après le dernier. */
  verifierTous?: number;
  /** Lecteurs comparés à chaque vérification (par défaut : tous). */
  lecteurs?: (tous: CurrentUser[], r: Aleatoire) => CurrentUser[];
  /** Lecteurs comparés à la dernière vérification (par défaut : tous). */
  lecteursFinaux?: (tous: CurrentUser[]) => CurrentUser[];
  /**
   * Jeu d'action de chaque lecteur comparé tous les `jeux` pas et au dernier (0 : au dernier seulement) ; celui de l'acteur
   * l'est toujours, avant chaque action.
   */
  jeux?: number;
  /** Faux : écritures seules, sans aucune comparaison (reproductibilité du tirage, préparation d'un état). */
  verifier?: boolean;
  /** Actions ajoutées aux cibles, tirées d'autant plus souvent (lot 10, chantier B : validation groupée). */
  renfort?: string[];
  /**
   * Validations groupées tirées par salarié (toutes les feuilles soumises de quelques salariés, 30 au plus) plutôt que
   * de une à quatre feuilles prises au hasard dans toute la base (lot 10, chantier B).
   */
  lotsGroupes?: boolean;
}

export interface RapportOracle {
  /** Écritures tentées par action (et SQL direct par forme), avec leur issue. */
  actions: Record<string, { ok: number; refus: number }>;
  sql: Record<string, number>;
  /** Motifs des refus (action et début du message), pour régler les tirages. */
  motifs: Record<string, number>;
  /** Pas qui ont changé la révision de la base. */
  ecritures: number;
  /** Comparaisons qui ont jugé la lecture partagée ; `triviales` : jeux d'action lus directement, comparés à eux-mêmes. */
  comparaisons: number;
  triviales: number;
  verifications: number;
  divergences: Divergence[];
  /** Réponses 5xx (erreur de Cursus ou du banc). */
  erreurs: string[];
}

/** Écritures SQL directes, portables (SQLite et PostgreSQL), comme une reprise ou un outil hors de Cursus. */
const SQL_DIRECT: Record<string, (db: Db, ds: Dataset, r: Aleatoire) => Promise<void>> = {
  'UPDATE employes': async (db, ds, r) => { const e = r.choix(ds.employes); await db.run('UPDATE employes SET nom = ? WHERE id = ?', [`${e.nom.replace(/ \(\d+\)$/, '')} (${r.entre(1, 99)})`, e.id]); },
  // lot 11 — indicateurs : sexe d'une fiche changé hors de Cursus (reprise de Sage), mise à disposition du CSE d'un arrêté.
  'UPDATE employes sexe': async (db, ds, r) => { await db.run('UPDATE employes SET sexe = ? WHERE id = ?', [r.choix(['F', 'M', null]), r.choix(ds.employes).id]); },
  'UPDATE indicateurs_arretes': async (db, ds, r) => {
    const a = ds.indicateursArretes ?? [];
    if (a.length) await db.run('UPDATE indicateurs_arretes SET cse_le = ? WHERE id = ?', [addD(ds.today, -r.entre(0, 30)), r.choix(a).id]);
  },
  'UPDATE feuilles (plusieurs lignes)': async (db, ds, r) => { await db.run('UPDATE feuilles SET comment = ? WHERE emp_id = ?', [`Reprise ${r.entre(1, 99)}`, r.choix(ds.employes).id]); },
  'INSERT absences': async (db, ds, r) => {
    const du = addD(ds.today, r.entre(-40, 40));
    await db.run('INSERT INTO absences (emp_id, type, du, au, statut, keystone, justificatif) VALUES (?, ?, ?, ?, ?, FALSE, FALSE)', [r.choix(ds.employes).id, r.choix(KINDS), du, addD(du, r.entre(0, 2)), r.choix(['validee', 'demandee'])]);
  },
  'DELETE absences': async (db, ds, r) => { if (ds.absences.length) await db.run('DELETE FROM absences WHERE id = ?', [r.choix(ds.absences).id]); },
  'INSERT cet': async (db, ds, r) => { await db.run('INSERT INTO cet (emp_id, type, jours, date, periode) VALUES (?, ?, ?, ?, ?)', [r.choix(ds.employes).id, 'RTT', 1, ds.today, ds.today.slice(0, 4)]); },
  'DELETE cet': async (db, ds, r) => { if (ds.cet.length) await db.run('DELETE FROM cet WHERE id = ?', [r.choix(ds.cet).id]); },
  'upsert feuilles': async (db, ds, r) => {
    // Feuille créée avec une ligne de projet vide, comme une reprise : la saisie qui suit a une cellule où écrire.
    const e = r.choix(ds.employes), week = addD(mondayOf(ds.today), -7 * r.entre(0, 6));
    const pr = r.choix(ds.referentiels.projets.filter(x => x.statut !== 'archive' && x.code !== ACTIVITE_ASTREINTE.code));
    await db.run(`INSERT INTO feuilles (emp_id, week, statut, comment, sage, keystone, lignes, contrat, heures_sup) VALUES (?, ?, 'brouillon', ?, FALSE, FALSE, ?, ?, 'paiement')
      ON CONFLICT (emp_id, week) DO UPDATE SET comment = excluded.comment`,
    [e.id, week, `Upsert ${r.entre(1, 99)}`, JSON.stringify([{ projet: pr.code, tache: pr.nom, ks: false, h: [0, 0, 0, 0, 0, 0, 0] }]), JSON.stringify(contratFige(e))]);
  },
  'upsert projets': async (db, ds, r) => {
    const code = r.si(0.5) ? r.choix(ds.referentiels.projets).code : `ORA-${r.entre(1, 20)}`;
    await db.run(`INSERT INTO projets (code, nom, statut) VALUES (?, ?, 'actif') ON CONFLICT (code) DO UPDATE SET nom = excluded.nom`, [code, `Projet ${r.entre(1, 99)}`]);
  },
  'upsert equipes': async (db, ds, r) => {
    await db.run('INSERT INTO equipes (nom, manager_id, ordre) VALUES (?, NULL, ?) ON CONFLICT (nom) DO UPDATE SET ordre = excluded.ordre', [r.si(0.7) ? r.choix(ds.referentiels.equipes).nom : `Équipe oracle ${r.entre(1, 5)}`, r.entre(0, 20)]);
  },
  // lot 11 — dossiers OPCO : correction et versement écrits par un outil (reprise d'un tableur), sur un dossier existant.
  'UPDATE dossiers_opco': async (db, ds, r) => { const d = parmi(r, ds.dossiersOpco ?? []); if (d) await db.run('UPDATE dossiers_opco SET heures = ? WHERE id = ?', [r.entre(1, 40), d.id]); },
  // lot 12 — C4 : fiche corrigée par un outil (Qualiopi), avancement importé hors de Cursus.
  'UPDATE organismes': async (db, ds, r) => {
    const o = parmi(r, ds.organismes ?? []);
    if (o) await db.run('UPDATE organismes SET qualiopi_valide_jusquau = ? WHERE id = ?', [addD(ds.today, r.entre(-60, 400)), o.id]);
  },
  'UPDATE inscriptions_elearning': async (db, ds, r) => {
    const i = parmi(r, (ds.inscriptionsElearning ?? []).filter(x => x.statut === 'en_cours' || x.statut === 'inscrit'));
    if (i) await db.run(`UPDATE inscriptions_elearning SET avancement = ?, avancement_source = 'import', avancement_le = ? WHERE id = ?`, [r.entre(0, 99), ds.today, i.id]);
  },
  'INSERT versements_opco': async (db, ds, r) => {
    const d = parmi(r, (ds.dossiersOpco ?? []).filter(x => x.statut === 'rembourse'));
    if (d) await db.run(`INSERT INTO versements_opco (dossier_id, le, montant, destinataire, saisi_le, saisi_par) VALUES (?, ?, ?, 'entreprise', ?, 'Reprise')`, [d.id, ds.today, r.entre(10, 200), new Date().toISOString()]);
  },
  'upsert settings': async (db, _ds, r) => {
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', ['calendrierFeries', JSON.stringify(r.si(0.5) ? {} : { 2026: { solidarite: 'pentecote_travaillee', solidariteFerie: null, nonChomes: r.si(0.5) ? ['11_novembre'] : [], le: '2026-01-05T08:00:00.000Z', par: 'Banc d’oracle' } })]);
  },
};

/**
 * Banc ouvert sur `db` : l'application montée sur une boucle locale, une session par compte actif et par espace.
 * `fermer` arrête le serveur.
 */
export async function ouvrirBanc(db: Db): Promise<{ base: string; acteurs: Acteur[]; fermer: () => void }> {
  const app = createApp(db, { production: false, journalRequetes: false, compression: false });
  const serveur = await new Promise<Server>(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  // Connexions gardées plus longtemps qu'une vérification (plusieurs secondes sur le jeu d'un an) : sinon le serveur
  // ferme une connexion au repos au moment où le pas suivant la reprend (« fetch failed »).
  serveur.keepAliveTimeout = 600_000;
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  const acteurs: Acteur[] = [];
  for (const c of await db.all<Compte>('comptes')) {
    for (const role of await espacesDuCompte(db, c)) {
      const sid = randomBytes(32).toString('base64url');
      await db.insert('connexions', { id: empreinteSession(sid), compteId: c.id, role, methode: 'local', demoComptes: {}, creation: new Date().toISOString(), expiration: new Date(Date.now() + 12 * 3600_000).toISOString(), activite: null });
      acteurs.push({ compteId: c.id, role, cookie: `cursus_session=${sid}.${await sign(db, sid)}`, cle: `${role}|compte ${c.id}` });
    }
  }
  return { base, acteurs, fermer: () => { serveur.close(); serveur.closeAllConnections(); } };
}

/** Suite d'écritures de la graine `graine`, comparée à l'oracle (voir l'en-tête). */
export async function rejouer(db: Db, o: OptionsOracle): Promise<RapportOracle> {
  const r = aleatoire(o.graine);
  const banc = await ouvrirBanc(db);
  const rapport: RapportOracle = { actions: {}, sql: {}, motifs: {}, ecritures: 0, comparaisons: 0, triviales: 0, verifications: 0, divergences: [], erreurs: [] };
  const noms = Object.keys(ACTIONS).filter(n => !EXCLUES.has(n));
  // Saisie et absences plus souvent que le reste, comme dans la journée de travail.
  const cibles = [
    ...Object.keys(TIRAGES), ...Array<string>(5).fill('temps.setCell'), 'temps.addLine', 'temps.submit', 'temps.submit', 'temps.validate', 'temps.validate',
    'absence.demander', 'absence.demander', 'absence.decider', 'absence.decider', ...o.renfort ?? [],
  ];
  const verifier = o.verifier ?? true;
  const noter = (divergences: Divergence[]) => { rapport.divergences.push(...divergences); };
  /**
   * Acteur qui a le droit de faire l'action de temps ou d'absence `nom`, sur une ligne qui s'y prête (`cible`, tirée
   * d'abord dans `ds`) : le salarié, son manager ou le service RH (droit « rh » : ni le référent HSE, ni la paie, ni la
   * lecture seule) pour la saisie et les demandes ; son manager ou le service RH pour une validation ou une décision ; le
   * service RH pour la saisie ou la qualification d'une absence ; un administrateur RH pour une réouverture ou une
   * dérogation. Sans ligne qui s'y prête, n'importe quel acteur de ce droit ; null si aucun compte ne convient.
   */
  const acteurAdapte = async (nom: string, ds: Dataset): Promise<{ acteur: Acteur; user: CurrentUser; cible: FeuilleTemps | Absence | null } | null> => {
    const modifiable = (f: FeuilleTemps) => f.statut === 'brouillon' || f.statut === 'rejetee';
    const feuilles: Record<string, (f: FeuilleTemps) => boolean> = {
      'temps.setCell': f => modifiable(f) && f.lignes.some(l => l.projet !== ACTIVITE_ASTREINTE.code),
      'temps.addLine': modifiable,
      'temps.removeLine': f => modifiable(f) && f.lignes.length > 1,
      'temps.submit': f => modifiable(f) && f.lignes.some(l => l.h.some(v => Number(v) > 0)),
      'temps.validate': f => f.statut === 'soumise', 'temps.reject': f => f.statut === 'soumise', 'temps.validerLot': f => f.statut === 'soumise',
      'temps.rouvrir': f => f.statut === 'validee',
    };
    const absences: Record<string, (a: Absence) => boolean> = {
      'absence.decider': a => a.statut === 'demandee', 'absence.qualifier': a => a.statut === 'signalee',
      'absence.annuler': a => a.statut === 'demandee' || a.statut === 'validee', 'absence.prolonger': a => a.statut === 'validee' || a.statut === 'signalee',
    };
    const reserve = ['temps.rouvrir', 'temps.derogationDominicale', 'opco.rouvrir', 'opco.annulerVersement', 'opco.supprimer'].includes(nom) ? 'admin'
      // lot 11 — dossiers OPCO : service RH (droit « rh »).
      : ['absence.saisir', 'absence.qualifier'].includes(nom) || nom.startsWith('opco.') ? 'rh'
        : ['temps.validate', 'temps.reject', 'temps.validerLot', 'absence.decider'].includes(nom) ? 'valideur' : 'saisie';
    const cible: FeuilleTemps | Absence | null = feuilles[nom] ? parmi(r, ds.feuilles.filter(feuilles[nom])) : absences[nom] ? parmi(r, ds.absences.filter(absences[nom])) : null;
    const equipe = cible ? ds.employes.find(e => e.id === cible.empId)?.equipe : undefined;
    const managers = new Set(ds.referentiels.equipes.filter(q => q.nom === equipe).map(q => q.managerId));
    const candidats: { acteur: Acteur; user: CurrentUser; cible: FeuilleTemps | Absence | null }[] = [];
    for (const a of banc.acteurs) {
      if ((reserve === 'admin' || reserve === 'rh') && a.role !== 'rh') continue;
      if (reserve === 'valideur' && a.role === 'collaborateur') continue;
      const u = await currentUser(db, { id: 'oracle', compteId: a.compteId, role: a.role, methode: 'local' } as never);
      if (!u) continue;
      const droits = u.role === 'rh' ? droitsRh(u) : [];
      if (u.role === 'rh' && !(droits.includes('rh') && (reserve !== 'admin' || droits.includes('admin')))) continue;
      if (cible && u.role !== 'rh') {
        const soi = u.empId === cible.empId;
        if (reserve === 'valideur' ? soi || !managers.has(u.empId) : !soi && !(u.role === 'manager' && managers.has(u.empId))) continue;
      }
      if (cible && u.role === 'rh' && u.empId === cible.empId && reserve !== 'saisie') continue;
      candidats.push({ acteur: a, user: u, cible });
    }
    return parmi(r, candidats);
  };
  const agir = async (acteurTire: Acteur, userTire: CurrentUser, ds: Dataset, avant: number) => {
    // Action ciblée sept fois sur dix, sinon n'importe quelle action du registre.
    const nom = r.si(0.7) ? r.choix(cibles) : r.choix(noms);
    // Saisie, validation des feuilles et absences : acteur repris neuf fois sur dix parmi ceux qui en ont le droit (le
    // chemin que le cache incrémental doit tenir exact) ; la dixième fois, l'acteur tiré, refusé le plus souvent.
    // Lot 11 : de même pour les dossiers OPCO (service RH, administrateur RH pour les annulations).
    const adapte = /^(temps|absence|opco)\./.test(nom) && r.si(0.9) ? await acteurAdapte(nom, ds) : null;
    const { acteur, user, cible } = adapte ?? { acteur: acteurTire, user: userTire, cible: null };
    const equipesGerees = new Set(ds.referentiels.equipes.filter(q => q.managerId === user.empId).map(q => q.nom));
    const equipiers = ds.employes.filter(e => e.equipe && equipesGerees.has(e.equipe)).map(e => e.id);
    const rh = user.role === 'rh' && droitsRh(user).includes('rh');
    const saisissables = rh ? ds.employes.map(e => e.id) : user.role === 'manager' ? [user.empId!, ...equipiers] : user.empId ? [user.empId] : ds.employes.map(e => e.id);
    const peutSaisir = new Set(saisissables);
    const validables = new Set((rh ? ds.employes.map(e => e.id) : user.role === 'manager' ? equipiers : []).filter(e => e !== user.empId));
    const x: Parameters<Tirage>[0] = {
      ds, r, user, cible, lotsGroupes: o.lotsGroupes ?? false,
      empId: () => (user.empId && r.si(0.6) ? user.empId : equipiers.length && r.si(0.6) ? r.choix(equipiers) : r.choix(ds.employes).id),
      semaine: (empId, statut) => {
        const siennes = ds.feuilles.filter(f => f.empId === empId && (!statut || f.statut === statut)).sort((a, b) => b.week.localeCompare(a.week)).slice(0, 6);
        return siennes.length && r.si(0.8) ? r.choix(siennes).week : addD(mondayOf(ds.today), -7 * r.entre(-1, 5));
      },
      date: (min, max) => addD(ds.today, r.entre(min, max)),
      saisie: () => r.choix(saisissables),
      modifiable: garder => parmi(r, ds.feuilles.filter(f => peutSaisir.has(f.empId) && (f.statut === 'brouillon' || f.statut === 'rejetee') && garder(f))),
      validables,
      soumises: rr => { const f = parmi(rr, ds.feuilles.filter(y => y.statut === 'soumise' && validables.has(y.empId))); return f && { empId: f.empId, week: f.week }; },
    };
    const p = (TIRAGES[nom] ?? TIRAGES_OPCO[nom] ?? /* lot 12 — C6 */ TIRAGES_POINTAGE[nom] ?? ((y: Parameters<Tirage>[0]) => tirageGenerique(nom, y)))(x);
    // Jeu remis à l'action : celui que sa transaction lirait (aucune autre écriture ne s'intercale ici).
    // Entrée d'une révision dépassée (vérification sautée au pas précédent, `verifierTous` > 1) : l'action lit tout
    // directement, la comparaison est triviale et comptée à part.
    const jeu = verifier ? await comparerJeuAction(db, user, false) : null;
    if (jeu?.directe && !jeu.ecart) rapport.triviales++;
    else if (jeu) rapport.comparaisons++;
    if (jeu?.ecart) noter([{ objet: 'action', cle: `${cleLecteur(user)} avant ${nom}`, revision: avant, ecart: jeu.ecart }]);
    const res = await fetch(`${banc.base}/api/actions/${nom}`, {
      method: 'POST', headers: { cookie: acteur.cookie, 'x-cursus-espace': acteur.role, 'content-type': 'application/json' }, body: JSON.stringify(p),
    });
    const corps = await res.json() as { data?: Dataset; error?: string };
    const stat = rapport.actions[nom] ??= { ok: 0, refus: 0 };
    if (res.status === 200) stat.ok++;
    else {
      stat.refus++;
      const motif = `${nom} : ${String(corps.error ?? res.status).slice(0, 70)}`;
      rapport.motifs[motif] = (rapport.motifs[motif] ?? 0) + 1;
    }
    if (res.status >= 500) rapport.erreurs.push(`${nom} ${JSON.stringify(p)} → ${res.status} ${corps.error ?? ''}`);
    // Instantané renvoyé après l'action (lu par le cache, après la validation) contre la lecture directe.
    if (verifier && res.status === 200 && corps.data) {
      const apres = await currentUser(db, { id: 'oracle', compteId: acteur.compteId, role: acteur.role, methode: 'local' } as never);
      if (apres) {
        const e = await comparerReponse(db, apres, corps.data);
        rapport.comparaisons++;
        if (e) noter([{ objet: 'réponse', cle: `${cleLecteur(apres)} après ${nom}`, revision: await db.revisionBase(), ecart: e }]);
      }
    }
  };
  try {
    for (let pas = 1; pas <= o.pas; pas++) {
      const ds = await loadFull(db, TIRAGE);
      const avant = await db.revisionBase();
      if (r.si(o.sql ?? 0.2)) {
        const forme = r.choix(Object.keys(SQL_DIRECT));
        // Contrainte refusée (clé étrangère, unicité) : l'écriture est annulée par la base, comme pour un outil.
        try { await SQL_DIRECT[forme](db, ds, r); } catch { /* refusée par la base */ }
        rapport.sql[forme] = (rapport.sql[forme] ?? 0) + 1;
      } else {
        // Acteur : service RH (tous profils) deux fois sur cinq, manager une fois sur quatre, sinon un collaborateur ; les
        // actions réservées sont ainsi souvent faites par qui en a le droit, et parfois refusées.
        const espace = r.si(0.4) ? 'rh' : r.si(0.4) ? 'manager' : 'collaborateur';
        const acteurs = banc.acteurs.filter(a => a.role === espace);
        const acteur = r.choix(acteurs.length ? acteurs : banc.acteurs);
        const user = await currentUser(db, { id: 'oracle', compteId: acteur.compteId, role: acteur.role, methode: 'local' } as never);
        // Compte qui n'ouvre plus cet espace (profil retiré, équipe confiée à un autre par un pas précédent) : pas sans écriture.
        if (user) await agir(acteur, user, ds, avant);
      }
      if (await db.revisionBase() !== avant) rapport.ecritures++;
      const dernier = pas === o.pas;
      if (verifier && (dernier || pas % (o.verifierTous ?? 1) === 0)) {
        const tous = await lecteursDe(db);
        const lecteurs = dernier ? o.lecteursFinaux?.(tous) ?? tous : o.lecteurs?.(tous, r) ?? tous;
        const jeux = o.jeux ?? 1;
        const b = await verifierExactitude(db, lecteurs, { jeux: dernier || (jeux > 0 && pas % jeux === 0) });
        rapport.verifications++;
        rapport.comparaisons += b.comparaisons;
        rapport.triviales += b.triviales;
        noter(b.divergences.map(d => ({ ...d, cle: `${d.cle} (pas ${pas})` })));
      }
    }
  } finally {
    banc.fermer();
  }
  return rapport;
}

/** Base de démonstration (référentiel, jeu de démonstration et comptes), sur le moteur des tests. */
export async function baseDemo(nouvelle: () => Promise<Db>): Promise<Db> {
  const db = await nouvelle();
  await seedDemo(db);
  await db.tx(async () => await comptesDemo(db));
  return db;
}

/**
 * Jeu de charge d'un an (`npm run charge:generer -- --ans 1 --effectif 100 --interimaires 20 --seed 42`, hors journal,
 * envois, relevés et jetons d'agenda : scripts/charge/fabrique.ts) sur le moteur des tests : 120 fiches, ≈ 6 000
 * feuilles, ≈ 1 500 absences, 10 lots de paie transmis et 10 annulés.
 */
export async function baseUnAn(nouvelle: () => Promise<Db>): Promise<{ db: Db; jeu: JeuFabrique }> {
  const db = await baseDemo(nouvelle);
  const jeu = await peuplerJeu(db, aleatoire(42), { ans: 1, effectif: 100, interimaires: 20 }, insererPortable(db));
  return { db, jeu };
}

/** Résumé d'un rapport (message d'un test en échec). */
export function resumeRapport(x: RapportOracle): string {
  const ok = Object.values(x.actions).reduce((n, s) => n + s.ok, 0), refus = Object.values(x.actions).reduce((n, s) => n + s.refus, 0);
  return [
    `${x.ecritures} pas écrivants ; actions : ${ok} validées, ${refus} refusées ; SQL direct : ${Object.values(x.sql).reduce((n, v) => n + v, 0)} ; ${x.verifications} vérifications, ${x.comparaisons} comparaisons (${x.triviales} triviales à part)`,
    `actions validées : ${Object.entries(x.actions).filter(([, s]) => s.ok).map(([n, s]) => `${n} ${s.ok}`).join(', ')}`,
    ...x.erreurs.slice(0, 5).map(e => `5xx : ${e}`),
    ...x.divergences.slice(0, 10).map(d => `divergence ${d.objet} ${d.cle} (révision ${d.revision}) : ${d.ecart}`),
  ].join('\n');
}
