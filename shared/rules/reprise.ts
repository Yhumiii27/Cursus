// Reprise des données depuis Lucca à la mise en service (écran Mise en service, action `reprise.importer`) : salariés,
// soldes d'ouverture des congés, certifications, habilitations et visites médicales.
// - Import générique : fichier CSV (lireCsv de imports.ts : « ; », guillemets, BOM), première ligne d'en-têtes, colonnes
//   reconnues par leur nom (`reconnaitreColonnes`) puis rapprochées à la main dans l'aperçu. Un modèle CSV par import.
// - Analyse partagée par l'aperçu et le serveur (`analyserReprise`) : le serveur relit le fichier avec les mêmes
//   colonnes et n'écrit que les lignes que l'aperçu annonçait. Rejouable : un salarié se retrouve par son matricule de
//   paie, sinon par son nom et sa date d'entrée, et sa fiche est mise à jour, jamais dupliquée ; un titre ou une visite
//   déjà enregistrés ne sont pas réécrits.
// - Les soldes sont repris tels quels, à la date d'arrêté choisie, sans recalcul (`reprise` de conges.ts) ; après
//   l'import, Cursus fait foi (décision de l'entreprise du 15 octobre 2026).
// - Titres repris : prérequis manquants en avertissement (la délivrance a eu lieu), élément absent du catalogue ou
//   archivé refusé. Visite sans avis : enregistrée « apte » seulement si le service RH le confirme dans l'aperçu.
import { MED_VALIDITE, TYPES_CONTRAT } from '../constants.ts';
import { addMonths, isValidDate, parse, toIso } from '../dates.ts';
import type { Domain } from '../domain.ts';
import { fJ, fmt, fmtIso, key, plural } from '../format.ts';
import type { AvisMedical, Employe, Formation, HabType, ISODate, MotifSortie, Statut, TempsTravail, TypeContrat } from '../types.ts';
import { lireCsv } from './imports.ts';
import { MOTIFS_SORTIE } from './contrats.ts';
import { matriculesPris, normaliserMatricule } from './matricules.ts';
import { adressesPrises } from './messagerie.ts';
import { PROFIL_FIELDS, profilOf, validerProfil, type ProfilInput } from './profil.ts';

export type TypeReprise = 'salaries' | 'soldes' | 'certifications' | 'habilitations' | 'visites';

/** Colonne attendue : identifiant, libellé (en-tête du modèle), noms reconnus (forme `key` : minuscules sans accent). */
export interface ChampReprise { id: string; label: string; noms: string[]; aide?: string }

const MATRICULE: ChampReprise = {
  id: 'matricule', label: 'Matricule de paie',
  noms: ['matricule', 'matricule de paie', 'matricule paie', 'n matricule', 'numero de matricule', 'id salarie', 'identifiant salarie', 'code salarie', 'n salarie', 'numero salarie'],
  aide: 'Matricule du dossier de paie (Sage), ou matricule Cursus EMP-0001',
};
const NOM: ChampReprise = { id: 'nom', label: 'Nom', noms: ['nom', 'nom complet', 'nom prenom', 'prenom nom', 'collaborateur', 'salarie', 'nom d usage', 'nom de famille'] };
const PRENOM: ChampReprise = { id: 'prenom', label: 'Prénom', noms: ['prenom'], aide: 'Joint au nom (« Prénom Nom ») s’il est dans une colonne à part' };

/**
 * Les cinq imports, dans l'ordre conseillé (référentiels chargés d'abord : écran Référentiels). Les visites passent avant
 * les habilitations : l'aptitude médicale, prérequis de plusieurs habilitations, est alors connue à leur aperçu.
 */
export const REPRISES: Record<TypeReprise, { label: string; court: string; aide: string; champs: ChampReprise[]; requis: string[]; exemple: string[][] }> = {
  salaries: {
    label: 'Salariés', court: 'salariés',
    aide: 'Une ligne par salarié, sorties comprises. Fiche retrouvée par le matricule de paie, sinon par le nom et la date d’entrée : mise à jour, jamais dupliquée. Équipes absentes créées ou rapprochées d’une équipe existante.',
    champs: [
      MATRICULE, NOM, PRENOM,
      { id: 'poste', label: 'Poste', noms: ['poste', 'fonction', 'emploi', 'intitule de poste', 'intitule du poste', 'metier'] },
      { id: 'equipe', label: 'Équipe', noms: ['equipe', 'service', 'departement', 'unite', 'atelier'] },
      { id: 'statut', label: 'Statut', noms: ['statut', 'categorie', 'college', 'csp', 'categorie socioprofessionnelle', 'categorie professionnelle'], aide: 'Ouvrier / employé, technicien / agent de maîtrise (ETAM), cadre' },
      { id: 'typeContrat', label: 'Contrat', noms: ['contrat', 'type de contrat', 'nature du contrat', 'nature de contrat'], aide: 'CDI, CDD, intérim, alternance (apprentissage, professionnalisation)' },
      { id: 'temps', label: 'Temps de travail', noms: ['temps de travail', 'organisation du temps', 'organisation du temps de travail', 'regime', 'regime horaire', 'horaire', 'modalite horaire'], aide: '35 h, 39 h avec RTT, forfait jours, forfait annuel en heures, forfait hebdomadaire, temps partiel, cadre dirigeant' },
      { id: 'heures', label: 'Heures par semaine', noms: ['heures par semaine', 'heures hebdomadaires', 'duree hebdomadaire', 'heures hebdo', 'heures'], aide: 'Temps partiel, forfait hebdomadaire' },
      { id: 'forfaitJours', label: 'Forfait jours', noms: ['forfait jours', 'jours du forfait', 'nombre de jours du forfait'] },
      { id: 'forfaitHeures', label: 'Forfait annuel en heures', noms: ['forfait annuel en heures', 'forfait heures', 'forfait annuel'] },
      { id: 'entree', label: 'Date d’entrée', noms: ['date d entree', 'entree', 'date entree', 'date d embauche', 'embauche', 'date d arrivee', 'arrivee'] },
      { id: 'fin', label: 'Date de fin', noms: ['date de fin', 'fin', 'fin de contrat', 'date de fin de contrat', 'date de sortie', 'sortie', 'depart', 'date de depart'], aide: 'Fin prévue (CDD, mission, alternance) ou dernier jour d’un salarié sorti' },
      { id: 'motifSortie', label: 'Motif de sortie', noms: ['motif de sortie', 'motif de depart', 'motif sortie', 'motif de fin de contrat'] },
      { id: 'naissance', label: 'Naissance', noms: ['date de naissance', 'naissance', 'annee de naissance'], aide: 'Date ou année' },
      { id: 'agence', label: 'Agence d’intérim', noms: ['agence d interim', 'agence', 'entreprise de travail temporaire'] },
      { id: 'email', label: 'Adresse e-mail', noms: ['adresse e mail', 'e mail', 'email', 'mail', 'courriel', 'adresse e mail professionnelle', 'email professionnel', 'adresse professionnelle'] },
    ],
    requis: ['nom', 'entree'],
    exemple: [
      ['Matricule de paie', 'Prénom', 'Nom', 'Poste', 'Équipe', 'Statut', 'Contrat', 'Temps de travail', 'Heures par semaine', 'Forfait jours', 'Forfait annuel en heures', 'Date d’entrée', 'Date de fin', 'Motif de sortie', 'Naissance', 'Agence d’intérim', 'Adresse e-mail'],
      ['A0123', 'Julie', 'Martin', 'Technicienne de maintenance', 'Maintenance', 'Technicien', 'CDI', '39 h avec RTT', '', '', '', '01/09/2015', '', '', '12/04/1988', '', 'julie.martin@exemple.fr'],
      ['A0456', 'Marc', 'Petit', 'Opérateur de production', 'Production', 'Ouvrier', 'CDD', '35 h', '', '', '', '05/01/2026', '30/06/2027', '', '1997', '', 'marc.petit@exemple.fr'],
      ['A0789', 'Nora', 'Saïd', 'Responsable qualité', 'Qualité', 'Cadre', 'CDI', 'Forfait jours', '', '218', '', '01/02/2020', '', '', '1980', '', 'nora.said@exemple.fr'],
      ['', 'Léa', 'Roux', 'Cariste', 'Logistique', 'Ouvrier', 'Intérim', '35 h', '', '', '', '04/01/2027', '26/03/2027', '', '2001', 'Agence Intérim Lyon', ''],
    ],
  },
  soldes: {
    label: 'Soldes de congés', court: 'soldes',
    aide: 'Soldes arrêtés dans l’ancien outil à la date de reprise, repris tels quels : CP de la période en cours (N-1), CP acquis sur la période en cours d’acquisition (N), RTT ou jours de repos de l’année, récupération (heures), CET (jours). Une cellule vide : compteur non repris.',
    champs: [
      MATRICULE, NOM, PRENOM,
      { id: 'cpN1', label: 'CP N-1', noms: ['cp n 1', 'solde cp n 1', 'conges payes n 1', 'cp periode precedente', 'cp acquis', 'solde cp acquis', 'cp a prendre'] },
      { id: 'cpN', label: 'CP N', noms: ['cp n', 'solde cp n', 'conges payes n', 'cp en cours', 'cp en cours d acquisition', 'cp en acquisition'] },
      { id: 'rtt', label: 'RTT', noms: ['rtt', 'solde rtt', 'jours de repos', 'jrtt', 'repos forfait', 'jours de repos forfait'] },
      { id: 'recup', label: 'Récupération (heures)', noms: ['recuperation heures', 'recuperation', 'recup', 'repos compensateur', 'heures de recuperation', 'rcr'] },
      { id: 'cet', label: 'CET (jours)', noms: ['cet jours', 'cet', 'compte epargne temps', 'solde cet', 'epargne temps'] },
    ],
    requis: [],
    exemple: [
      ['Matricule de paie', 'Prénom', 'Nom', 'CP N-1', 'CP N', 'RTT', 'Récupération (heures)', 'CET (jours)'],
      ['A0123', 'Julie', 'Martin', '12,5', '14,58', '10', '7,5', '4'],
      ['A0456', 'Marc', 'Petit', '3', '14,58', '', '', ''],
    ],
  },
  certifications: {
    label: 'Certifications', court: 'certifications',
    aide: 'Formations suivies, avec leur date d’obtention. La formation doit figurer au catalogue (écran Référentiels), désignée par son code, son nom court ou son nom.',
    champs: [
      MATRICULE, NOM, PRENOM,
      { id: 'formation', label: 'Formation', noms: ['formation', 'code formation', 'intitule de la formation', 'intitule', 'certification', 'stage'] },
      { id: 'date', label: 'Date d’obtention', noms: ['date d obtention', 'obtention', 'obtenue le', 'date de la formation', 'date de fin de formation', 'date'] },
    ],
    requis: ['formation', 'date'],
    exemple: [['Matricule de paie', 'Prénom', 'Nom', 'Formation', 'Date d’obtention'], ['A0123', 'Julie', 'Martin', 'SST', '14/03/2025'], ['A0456', 'Marc', 'Petit', 'CACES R489', '02/02/2026']],
  },
  visites: {
    label: 'Visites médicales', court: 'visites',
    aide: 'Dernière visite de chaque salarié et avis du médecin du travail : apte, apte avec restrictions, inapte. Sans avis, la visite n’est enregistrée « apte » qu’après confirmation dans l’aperçu ; les restrictions se recopient ensuite sur la fiche.',
    champs: [
      MATRICULE, NOM, PRENOM,
      { id: 'date', label: 'Date de visite', noms: ['date de visite', 'date de la visite', 'visite', 'date visite medicale', 'derniere visite', 'date'] },
      { id: 'avis', label: 'Avis', noms: ['avis', 'aptitude', 'avis d aptitude', 'conclusion', 'resultat', 'avis du medecin'] },
    ],
    requis: ['date'],
    exemple: [['Matricule de paie', 'Prénom', 'Nom', 'Date de visite', 'Avis'], ['A0123', 'Julie', 'Martin', '10/06/2025', 'Apte'], ['A0456', 'Marc', 'Petit', '15/01/2026', 'Apte avec restrictions']],
  },
  habilitations: {
    label: 'Habilitations', court: 'habilitations',
    aide: 'Habilitations délivrées, avec leur date et leur signataire (à défaut, le signataire du référentiel). Un prérequis manquant n’est qu’un avertissement : la délivrance a eu lieu.',
    champs: [
      MATRICULE, NOM, PRENOM,
      { id: 'habilitation', label: 'Habilitation', noms: ['habilitation', 'code habilitation', 'intitule de l habilitation', 'titre', 'autorisation'] },
      { id: 'date', label: 'Date de délivrance', noms: ['date de delivrance', 'delivrance', 'delivree le', 'date d habilitation', 'date'] },
      { id: 'signataire', label: 'Signataire', noms: ['signataire', 'delivree par', 'delivre par', 'par', 'responsable'] },
    ],
    requis: ['habilitation', 'date'],
    exemple: [['Matricule de paie', 'Prénom', 'Nom', 'Habilitation', 'Date de délivrance', 'Signataire'], ['A0123', 'Julie', 'Martin', 'Habilitation électrique', '20/03/2025', 'Directeur du site']],
  },
};
export const TYPES_REPRISE = Object.keys(REPRISES) as TypeReprise[];
export const estTypeReprise = (v: unknown): v is TypeReprise => typeof v === 'string' && Object.hasOwn(REPRISES, v);

/** Date de reprise conseillée : compteurs arrêtés dans Lucca au 1er janvier 2027 (réponse de l'entreprise). */
export const DATE_REPRISE_CONSEILLEE = '2027-01-01';

/**
 * Restriction inscrite sur une visite reprise « apte avec restrictions » : l'ancien outil n'en donne pas le texte. Elle
 * signale l'aptitude à vérifier (réserve au Go / No Go, manager prévenu) jusqu'à ce que le service RH recopie l'avis
 * sur la fiche ; elle ne dit rien de l'état de santé.
 */
export const RESTRICTION_A_RECOPIER = 'Restrictions à recopier depuis l’avis du médecin du travail (reprise de l’ancien outil)';

/**
 * Colonnes reconnues par leur en-tête : un nom attendu égal à l'en-tête, sinon contenu dans lui (mots entiers) — le plus
 * long l'emporte (« Solde CP N-1 » : CP N-1, pas CP N). Chaque champ ne sert qu'une fois ; une colonne non reconnue est
 * ignorée (null), à rapprocher à la main.
 */
export function reconnaitreColonnes(type: TypeReprise, entetes: string[]): (string | null)[] {
  const champs = REPRISES[type].champs;
  const pris = new Set<string>();
  const score = (k: string, nom: string) => (k === nom ? 1000 + nom.length : ` ${k} `.includes(` ${nom} `) ? nom.length : 0);
  // Les correspondances exactes d'abord, les plus longues en tête : « Date » ne prend pas le champ d'une colonne « Date de
  // visite » plus loin.
  const meilleurs = entetes.map(h => {
    const k = key(h);
    return champs.map(c => ({ id: c.id, s: Math.max(0, ...c.noms.map(n => score(k, n))) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  });
  const ordre = entetes.map((_, i) => i).sort((a, b) => (meilleurs[b][0]?.s ?? 0) - (meilleurs[a][0]?.s ?? 0));
  const out: (string | null)[] = entetes.map(() => null);
  for (const i of ordre) {
    const c = meilleurs[i].find(x => !pris.has(x.id));
    if (c) { out[i] = c.id; pris.add(c.id); }
  }
  return out;
}

/** Modèle CSV d'un import : en-têtes reconnus et lignes d'exemple fictives. */
export const modeleReprise = (type: TypeReprise) => ({ entetes: REPRISES[type].exemple[0], lignes: REPRISES[type].exemple.slice(1) });

/** Ce que l'analyse prévoit pour une ligne : création, mise à jour, rien (déjà à jour, ignorée) ou refus (motif). */
export type IssueReprise = 'creation' | 'maj' | 'ignoree' | 'refus';
export const ISSUE_LABEL: Record<IssueReprise, string> = { creation: 'Ajout', maj: 'Mise à jour', ignoree: 'Ignorée', refus: 'Refusée' };

/** Écriture prévue pour une ligne retenue (serveur : actions/reprise.ts). */
export type EcritureReprise =
  | { type: 'salaries'; profil: ProfilInput; equipeACreer: string | null; reutiliser: boolean }
  | { type: 'soldes'; arreteLe: ISODate; cpSolde: number | null; cpSoldeSuivant: number | null; rttSolde: number | null; recup: number | null; cetSolde: number | null }
  | { type: 'certifications'; f: string; date: ISODate }
  | { type: 'habilitations'; h: string; date: ISODate; par: string; titreId: number | null }
  | { type: 'visites'; date: ISODate; avis: AvisMedical };

export interface LigneReprise {
  /** Numéro de la ligne dans le fichier (l'en-tête est la ligne 1 en général). */
  n: number;
  empId: number | null;
  /** Salarié désigné (nom de la fiche, ou celui du fichier). */
  nom: string;
  issue: IssueReprise;
  /** Ce qui sera écrit, en clair (« SST, obtenue le 14 mars 2025 »). */
  detail: string;
  erreurs: string[];
  avertissements: string[];
  /** Case à cocher de l'aperçu (réembauche sur un matricule, visite sans avis) ; `confirmee` : cochée. */
  confirmation: string | null;
  confirmee: boolean;
  ecriture: EcritureReprise | null;
}

/** Paramètres d'un import : colonnes rapprochées, date de reprise (soldes), équipes rapprochées, lignes confirmées. */
export interface OptionsReprise {
  /** Champ de chaque colonne du fichier (null : colonne ignorée). */
  colonnes: (string | null)[];
  dateReprise?: string | null;
  /** Équipe du fichier → équipe existante de Cursus, ou '' : équipe à créer sous ce nom. Absente : nom identique, sinon créée. */
  equipes?: Record<string, string>;
  /** Numéros des lignes confirmées dans l'aperçu. */
  confirmations?: number[];
  /**
   * Salariés : case « Créer les comptes Microsoft 365 » cochée, avec les fiches qui ont déjà un compte ; null ou absent :
   * case décochée. Une fiche déjà à jour sans compte devient alors une mise à jour (compte à créer).
   */
  avecCompte?: number[] | null;
  /** Fiche rattachée au compte qui importe : ses propres soldes sont repris par un autre membre du service RH. */
  soiMeme?: number | null;
}

export interface AnalyseReprise {
  entetes: string[];
  lignes: LigneReprise[];
  /** Erreur qui empêche tout import (fichier vide, colonne requise absente, date de reprise invalide). */
  bloquant: string | null;
  /** Équipes du fichier inconnues de Cursus (salariés) : à créer ou à rapprocher. */
  equipesInconnues: string[];
}

// — Lecture des valeurs —

/** Nombre d'une cellule (virgule décimale, espaces) ; vide : null ; illisible : NaN. */
const nombre = (s: string | undefined): number | null => {
  const v = (s ?? '').replace(/\s/g, '').replace(',', '.');
  if (!v) return null;
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
};
/**
 * Statut d'une cellule. « Non cadre » (export qui ne distingue que cadres et non-cadres) ne dit pas s'il s'agit d'un
 * ouvrier ou d'un technicien : `non_cadre`, traité comme un statut absent (testé avant « cadre », qu'il contient).
 */
const statutDe = (s: string): Statut | 'non_cadre' | null => {
  const k = key(s);
  if (/\b(non|pas)\s+cadres?\b/.test(k)) return 'non_cadre';
  if (/\b(cadre|ingenieur|ic)\b/.test(k)) return 'cadre';
  if (/\b(techn\w*|maitrise|etam|tam|am)\b/.test(k)) return 'technicien';
  if (/\b(ouvrier\w*|employe\w*|oe)\b/.test(k)) return 'ouvrier';
  return null;
};
const contratDe = (s: string): TypeContrat | null => {
  const k = key(s);
  if (/\b(interim\w*|temporaire|ett)\b/.test(k)) return 'interim';
  if (/\b(altern\w*|apprenti\w*|professionnalisation|contrat pro)\b/.test(k)) return 'alternance';
  if (/\bcdd\b|duree determinee/.test(k)) return 'cdd';
  if (/\bcdi\b|duree indeterminee/.test(k)) return 'cdi';
  return null;
};
const tempsDe = (s: string): TempsTravail | null => {
  const k = key(s);
  if (/dirigeant/.test(k)) return 'dirigeant';
  if (/partiel/.test(k)) return 'partiel';
  if (/forfait/.test(k) && /jour/.test(k)) return 'forfait_jours';
  if (/forfait/.test(k) && /(annuel|an|annee|1607)\b/.test(k)) return 'forfait_heures_annuel';
  if (/forfait/.test(k)) return 'forfait_heures_hebdo';
  if (/\b39\b|rtt/.test(k)) return '39h_rtt';
  if (/\b35\b|collectif|temps plein|temps complet/.test(k)) return '35h';
  return null;
};
const motifSortieDe = (s: string): MotifSortie | null => {
  const k = key(s);
  const m = (Object.entries(MOTIFS_SORTIE) as [MotifSortie, string][]).find(([id, l]) => key(id) === k || key(l) === k)
    ?? (Object.entries(MOTIFS_SORTIE) as [MotifSortie, string][]).find(([, l]) => k && key(l).includes(k));
  return m ? m[0] : null;
};
/**
 * Avis d'une cellule. La négation d'abord (« Non apte » contient « apte »), puis « sans restriction » (contient
 * « restriction ») : un salarié inapte ne doit jamais ressortir apte.
 */
const avisDe = (s: string): AvisMedical | null => {
  const k = key(s);
  if (/\b(non|pas)\s+apte\b|\binapt/.test(k)) return 'inapte';
  if (/\bsans\s+(restrictions?|reserves?|amenagements?)\b/.test(k)) return /\bapte\b/.test(k) ? 'apte' : null;
  if (/restriction|amenagement|reserve/.test(k)) return 'restrictions';
  if (/\bapte\b/.test(k)) return 'apte';
  return null;
};
const naissanceDe = (s: string): number | null => {
  const v = s.trim();
  if (/^\d{4}$/.test(v)) return Number(v);
  const iso = toIso(v);
  return iso ? Number(iso.slice(0, 4)) : null;
};
/** Date d'une cellule : JJ/MM/AAAA ou AAAA-MM-JJ ; vide : null ; illisible : ''. */
const dateDe = (s: string | undefined): ISODate | null | '' => (!s?.trim() ? null : toIso(s) ?? '');
const nombreTexte = (n: number) => fJ(n).replace(/ j$/, '');

/** Ligne du fichier : valeur de chaque champ rapproché (cellules d'une même colonne ignorée écartées). */
type Valeurs = Record<string, string>;
function valeurs(cells: string[], colonnes: (string | null)[]): Valeurs {
  const v: Valeurs = {};
  colonnes.forEach((c, i) => { if (c && cells[i] != null && v[c] == null) v[c] = cells[i].trim(); });
  return v;
}
/** Nom complet : « Prénom Nom » quand le prénom a sa colonne. */
const nomDe = (v: Valeurs) => [v.prenom, v.nom].filter(x => x?.trim()).join(' ').replace(/\s+/g, ' ').trim();

/**
 * Salarié désigné par une ligne (soldes, titres, visites) : matricule de paie (ou matricule Cursus EMP-0001), sinon nom
 * (« Prénom Nom » ou « Nom Prénom »). Un salarié présent l'emporte sur une ancienne fiche (réembauche) ; deux homonymes
 * présents : refus, le matricule les distingue.
 */
export function trouverSalarie(d: Domain, v: Valeurs): { e: Employe | null; erreur: string | null } {
  const presents = (l: Employe[]) => { const p = l.filter(e => !e.fin || e.fin >= d.ti); return p.length ? p : l; };
  const brut = (v.matricule ?? '').trim();
  const cursus = /^EMP-?0*(\d+)$/i.exec(brut);
  if (cursus) {
    const e = d.emp(Number(cursus[1]));
    return e ? { e, erreur: null } : { e: null, erreur: `Matricule ${brut.toUpperCase()} inconnu` };
  }
  const m = normaliserMatricule(brut);
  if (m) {
    const l = presents(d.ds.employes.filter(e => e.matriculePaie === m));
    return l.length ? { e: l[0], erreur: null } : { e: null, erreur: `Matricule de paie ${m} inconnu : importez d’abord les salariés` };
  }
  const nom = nomDe(v);
  if (!nom) return { e: null, erreur: 'Ni matricule ni nom' };
  const inverse = [v.nom, v.prenom].filter(x => x?.trim()).join(' ');
  const l = presents(d.ds.employes.filter(e => key(e.nom) === key(nom) || (v.prenom && key(e.nom) === key(inverse))));
  if (!l.length) return { e: null, erreur: `Salarié inconnu : ${nom}` };
  if (l.length > 1) return { e: null, erreur: `${plural(l.length, 'salarié', 'salariés')} nommés ${nom} : précisez le matricule de paie` };
  return { e: l[0], erreur: null };
}

const ligneVide = (n: number, nom: string): LigneReprise => ({
  n, empId: null, nom, issue: 'refus', detail: '', erreurs: [], avertissements: [], confirmation: null, confirmee: false, ecriture: null,
});
/** Issue finale : une erreur refuse la ligne, une ligne sans écriture est ignorée. */
const conclure = (l: LigneReprise): LigneReprise => ({ ...l, issue: l.erreurs.length ? 'refus' : l.ecriture ? l.issue : 'ignoree', ecriture: l.erreurs.length ? null : l.ecriture });

/**
 * Analyse d'un fichier : une ligne de compte rendu par ligne du fichier (en-tête exclu). Partagée par l'aperçu (client)
 * et l'import (serveur), sur les mêmes données : ce que l'aperçu annonce est ce que le serveur écrit.
 */
export function analyserReprise(d: Domain, type: TypeReprise, texte: string, o: OptionsReprise): AnalyseReprise {
  const { lignes: rows, numeros } = lireCsv(texte);
  const entetes = rows[0] ?? [];
  const vide = { entetes, lignes: [], equipesInconnues: [] };
  if (rows.length < 2) return { ...vide, bloquant: rows.length ? 'Aucune ligne sous l’en-tête du fichier.' : 'Fichier vide.' };
  const colonnes = entetes.map((_, i) => {
    const c = o.colonnes?.[i];
    return typeof c === 'string' && REPRISES[type].champs.some(x => x.id === c) ? c : null;
  });
  const manque = REPRISES[type].requis.filter(c => !colonnes.includes(c)).map(c => REPRISES[type].champs.find(x => x.id === c)!.label);
  if (type !== 'salaries' && !colonnes.includes('matricule') && !colonnes.includes('nom')) manque.unshift('Matricule de paie ou Nom');
  if (type === 'soldes' && !['cpN1', 'cpN', 'rtt', 'recup', 'cet'].some(c => colonnes.includes(c))) manque.push('un solde au moins');
  if (manque.length) return { ...vide, bloquant: `Colonne à rapprocher : ${manque.join(', ')}.` };
  const dateReprise = o.dateReprise ?? null;
  if (type === 'soldes' && !isValidDate(dateReprise)) return { ...vide, bloquant: 'Date de reprise des soldes invalide.' };
  const confirmees = new Set((o.confirmations ?? []).map(Number));
  const lignes = rows.slice(1).map((cells, i) => ({ n: numeros[i + 1], v: valeurs(cells, colonnes) }));
  switch (type) {
    case 'salaries': return analyserSalaries(d, entetes, lignes, o.equipes ?? {}, confirmees, o.avecCompte ?? null);
    case 'soldes': return { entetes, bloquant: null, equipesInconnues: [], lignes: lignes.map(l => analyserSolde(d, l.n, l.v, dateReprise!, o.soiMeme ?? null)) };
    case 'certifications': return { entetes, bloquant: null, equipesInconnues: [], lignes: analyserCertifications(d, lignes) };
    case 'habilitations': return { entetes, bloquant: null, equipesInconnues: [], lignes: analyserHabilitations(d, lignes) };
    case 'visites': return { entetes, bloquant: null, equipesInconnues: [], lignes: analyserVisites(d, lignes, confirmees) };
  }
}

// — Salariés —

/** Champs du régime de temps et du contrat : leur changement sur une fiche qui a déjà des feuilles ou des absences passe par la fiche. */
const REGIME: (keyof ProfilInput)[] = ['temps', 'heures', 'forfaitHeures', 'forfaitJours', 'statut', 'typeContrat'];

/** Nom comparé sans ordre des mots (« Julie Martin », « MARTIN Julie ») : une faute de matricule ne passe pas pour une mise à jour. */
const memeNom = (a: string, b: string) => key(a).split(' ').sort().join(' ') === key(b).split(' ').sort().join(' ');

function analyserSalaries(d: Domain, entetes: string[], lignes: { n: number; v: Valeurs }[], equipesO: Record<string, string>, confirmees: Set<number>, avecCompte: number[] | null): AnalyseReprise {
  const existantes = d.equipes;
  // Équipe du fichier : rapprochement choisi dans l'aperçu, sinon même nom (casse et accents ignorés), sinon à créer.
  const inconnues = [...new Set(lignes.map(l => (l.v.equipe ?? '').trim()).filter(Boolean))]
    .filter(q => !existantes.some(x => key(x) === key(q)));
  const equipeDe = (q: string): { nom: string; creer: boolean } => {
    const choix = equipesO[q];
    if (choix && existantes.includes(choix)) return { nom: choix, creer: false };
    const meme = existantes.find(x => key(x) === key(q));
    return meme ? { nom: meme, creer: false } : { nom: q.replace(/\s+/g, ' ').trim(), creer: true };
  };
  const aCreer = [...new Set(inconnues.map(q => equipeDe(q)).filter(x => x.creer).map(x => x.nom))];
  // Matricules, adresses et salariés déjà retenus plus haut dans le fichier (doublons du fichier).
  const matriculesFichier: Record<string, { id: number; nom: string; sortiLe: ISODate | null }> = {};
  const adressesFichier: Record<string, string> = {};
  const vus = new Map<string, number>();
  const out = lignes.map(({ n, v }): LigneReprise => {
    const nom = nomDe(v);
    const l = ligneVide(n, nom || '—');
    const m = normaliserMatricule(v.matricule);
    const entree = dateDe(v.entree);
    if (!nom) l.erreurs.push('Nom manquant');
    if (entree === '') l.erreurs.push(`Date d’entrée illisible : « ${v.entree} »`);
    else if (!entree) l.erreurs.push('Date d’entrée manquante');
    if (l.erreurs.length) return conclure(l);
    // Fiche existante : matricule de paie (fiche présente d'abord), sinon même nom et même date d'entrée.
    const parMatricule = m ? d.ds.employes.filter(e => e.matriculePaie === m).sort((a, b) => Number(!!a.fin && a.fin < d.ti) - Number(!!b.fin && b.fin < d.ti))[0] : undefined;
    // Même matricule, autre date d'entrée : réembauche d'un salarié sorti, nouvelle fiche (réutilisation à confirmer).
    const reembauche = parMatricule && parMatricule.entree !== entree && parMatricule.fin && parMatricule.fin < entree!;
    const e = (reembauche ? undefined : parMatricule) ?? d.ds.employes.find(x => key(x.nom) === key(nom) && x.entree === entree);
    const cle = e ? `id:${e.id}` : `${key(nom)}|${entree}`;
    if (vus.has(cle)) { l.erreurs.push(`Même salarié qu’à la ligne ${vus.get(cle)}`); return conclure(l); }
    // Fiche trouvée par le matricule mais autre nom ou autre date d'entrée : faute de frappe probable, la mise à jour
    // renommerait la personne et lui attribuerait l'historique d'une autre. Refus : le fichier est à vérifier.
    if (e && e === parMatricule && (!memeNom(e.nom, nom) || e.entree !== entree)) {
      l.erreurs.push(`Matricule ${m} porté par ${e.nom} (entrée le ${fmtIso(e.entree)}) : nom ou date d’entrée différents, vérifiez le fichier`);
      return conclure(l);
    }
    if (e && m && e.matriculePaie && e.matriculePaie !== m) {
      l.erreurs.push(`Matricule de paie ${m} différent de celui de la fiche (${e.matriculePaie}) : à corriger depuis la fiche`);
      return conclure(l);
    }
    const base: ProfilInput = e ? profilOf(e) : {
      nom, poste: '', equipe: null, statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', heures: null, forfaitHeures: null, forfaitJours: null, jourOff: [],
      tempsDepuis: null, entree: entree!, fin: null, motifSortie: null, naissance: NaN, agence: null, matriculePaie: null, email: null, visite: null,
      repriseMotif: null, repriseDate: null,
    };
    const p: ProfilInput = { ...base, nom, entree: entree! };
    const lire = <T>(champ: string, f: (s: string) => T | null, libelle: string, appliquer: (x: T) => void) => {
      const s = (v[champ] ?? '').trim();
      if (!s) return false;
      const x = f(s);
      if (x == null || (typeof x === 'number' && Number.isNaN(x))) l.erreurs.push(`${libelle} non reconnu : « ${s} »`);
      else appliquer(x);
      return true;
    };
    if (v.poste?.trim()) p.poste = v.poste.trim();
    let nonCadre = false;
    if (!lire('statut', statutDe, 'Statut', x => { if (x === 'non_cadre') nonCadre = true; else p.statut = x; }) && !e) l.avertissements.push('Statut absent : ouvrier / employé retenu');
    // « Non cadre » : la fiche existante garde son statut s'il n'est pas cadre ; sinon ouvrier / employé, à préciser.
    if (nonCadre && (!e || p.statut === 'cadre')) {
      p.statut = 'ouvrier';
      l.avertissements.push('Statut « non cadre » : ouvrier / employé retenu, à préciser sur la fiche (technicien, agent de maîtrise)');
    }
    if (!lire('typeContrat', contratDe, 'Contrat', x => { p.typeContrat = x; }) && !e) l.avertissements.push('Contrat absent : CDI retenu');
    if (!lire('temps', tempsDe, 'Temps de travail', x => { p.temps = x; }) && !e) l.avertissements.push('Temps de travail absent : horaire collectif 35 h retenu');
    lire('heures', nombre, 'Heures par semaine', x => { p.heures = x; });
    lire('forfaitJours', nombre, 'Forfait jours', x => { p.forfaitJours = x; });
    lire('forfaitHeures', nombre, 'Forfait annuel en heures', x => { p.forfaitHeures = x; });
    lire('naissance', naissanceDe, 'Naissance', x => { p.naissance = x; });
    if (!e && Number.isNaN(p.naissance)) l.erreurs.push('Année de naissance manquante');
    const fin = dateDe(v.fin);
    if (fin === '') l.erreurs.push(`Date de fin illisible : « ${v.fin} »`);
    else if (fin) p.fin = fin;
    lire('motifSortie', motifSortieDe, 'Motif de sortie', x => { p.motifSortie = x; });
    if (v.agence?.trim()) p.agence = v.agence.trim();
    if (v.email?.trim()) p.email = v.email.trim();
    if (m) p.matriculePaie = m;
    let equipeACreer: string | null = null;
    if (v.equipe?.trim()) {
      const q = equipeDe(v.equipe.trim());
      p.equipe = q.nom;
      if (q.creer) { equipeACreer = q.nom; l.avertissements.push(`Équipe ${q.nom} créée`); }
    }
    if (l.erreurs.length) return conclure(l);
    // Fiche existante : sortie et régime ne changent pas par l'import quand ils emportent des effets (fiche, bouton « Sortie »).
    if (e) {
      if ((e.motifSortie ?? null) !== (p.motifSortie ?? null) || (e.motifSortie && e.fin !== p.fin)) {
        l.erreurs.push(e.motifSortie ? 'Sortie enregistrée : elle se modifie depuis la fiche (bouton « Sortie »)'
          : 'Sortie à enregistrer depuis la fiche (bouton « Sortie ») : elle annule ce qui était prévu après le départ');
      }
      const actif = d.ds.feuilles.some(f => f.empId === e.id) || d.ds.absences.some(a => a.empId === e.id);
      if (actif && REGIME.some(k => JSON.stringify(base[k]) !== JSON.stringify(p[k]))) {
        l.erreurs.push('Changement de régime de temps ou de contrat : à faire depuis la fiche (feuilles figées, compteur de RTT)');
      }
      if (l.erreurs.length) return conclure(l);
    }
    const reutiliser = confirmees.has(n);
    const val = validerProfil(p, {
      equipes: [...existantes, ...aCreer], year: d.year, encadre: e ? d.teamsOf(e.id) : [],
      adressesPrises: { ...adressesPrises(d.ds.employes, e?.id), ...adressesFichier },
      matricules: { pris: { ...matriculesPris(d.ds.employes, d.ti, e?.id), ...matriculesFichier }, actuel: e?.matriculePaie ?? null, reutiliser },
    });
    l.erreurs.push(...val.errors.map(x => x.replace(/\.$/, '')));
    l.avertissements.push(...val.warnings.map(x => x.replace(/\.$/, '')));
    if (val.matriculeAConfirmer) {
      const t = val.matriculeAConfirmer;
      l.confirmation = `Réembauche : réutiliser le matricule ${p.matriculePaie} de ${t.nom}, sorti le ${fmtIso(t.sortiLe!)}`;
      l.confirmee = reutiliser;
    }
    l.empId = e?.id ?? null;
    l.nom = e?.nom ?? nom;
    const P = val.profil;
    l.detail = [P.poste, P.equipe ? `équipe ${P.equipe}` : 'à affecter', TYPES_CONTRAT[P.typeContrat]?.label,
      P.matriculePaie ? `matricule ${P.matriculePaie}` : '', P.fin ? `fin le ${fmtIso(P.fin)}` : ''].filter(Boolean).join(' · ');
    if (!l.erreurs.length) {
      vus.set(cle, n);
      // Salarié sorti dans le fichier : son matricule peut servir à une réembauche plus bas (à confirmer).
      if (P.matriculePaie) matriculesFichier[P.matriculePaie] = { id: -n, nom: P.nom, sortiLe: P.fin && P.fin < d.ti ? P.fin : null };
      if (P.email) adressesFichier[P.email] = P.nom;
    }
    // Compte Microsoft 365 à créer (case cochée) : salarié présent, avec une adresse, sans compte.
    const compte = avecCompte != null && !!P.email && !(P.fin && P.fin < d.ti) && !(e && avecCompte.includes(e.id));
    if (e && PROFIL_FIELDS.every(k => JSON.stringify(profilOf(e)[k] ?? null) === JSON.stringify(P[k] ?? null))) {
      l.avertissements = ['Fiche déjà à jour'];
      // Ouverture progressive (service RH, équipe pilote, puis tout le site) : rejouer le fichier, case cochée, crée les
      // comptes manquants sans rien changer à la fiche.
      if (!compte) { l.issue = 'ignoree'; return conclure(l); }
    }
    if (compte) l.avertissements.push('Compte Microsoft 365 à créer');
    l.issue = e ? 'maj' : 'creation';
    l.ecriture = { type: 'salaries', profil: P, equipeACreer, reutiliser: !!val.matriculeAConfirmer && reutiliser };
    return conclure(l);
  });
  return { entetes, lignes: out, bloquant: null, equipesInconnues: inconnues };
}

// — Soldes —

/**
 * Soldes d'un salarié. Même date d'arrêté qu'un import précédent : seuls les compteurs lus remplacent ceux déjà repris
 * (Lucca peut exporter un compteur par fichier, un fichier corrigé peut ne porter qu'une colonne). Autre date d'arrêté :
 * les compteurs repris se rapportaient à une autre période, ceux qui manquent au fichier ne sont plus repris (aperçu).
 */
function analyserSolde(d: Domain, n: number, v: Valeurs, arreteLe: ISODate, soiMeme: number | null): LigneReprise {
  const { e, erreur } = trouverSalarie(d, v);
  const l = ligneVide(n, e?.nom ?? (nomDe(v) || v.matricule || '—'));
  if (!e) { l.erreurs.push(erreur!); return conclure(l); }
  l.empId = e.id;
  // Pas de décision sur soi-même (comme report.accorder ou la clôture des congés).
  if (soiMeme != null && e.id === soiMeme) { l.erreurs.push('Vos propres soldes sont repris par un autre membre du service RH'); return conclure(l); }
  const lu: Record<'cpN1' | 'cpN' | 'rtt' | 'recup' | 'cet', number | null> = { cpN1: null, cpN: null, rtt: null, recup: null, cet: null };
  const bornes = { cpN1: [-60, 100], cpN: [-60, 100], rtt: [-30, 60], recup: [-500, 2000], cet: [0, 400] } as const;
  const noms = { cpN1: 'CP N-1', cpN: 'CP N', rtt: 'RTT', recup: 'Récupération', cet: 'CET' };
  for (const k of Object.keys(lu) as (keyof typeof lu)[]) {
    const x = nombre(v[k]);
    if (x == null) continue;
    if (Number.isNaN(x)) l.erreurs.push(`${noms[k]} illisible : « ${v[k]} »`);
    else if (x < bornes[k][0] || x > bornes[k][1]) l.erreurs.push(`${noms[k]} hors des bornes (${bornes[k][0]} à ${bornes[k][1]})`);
    else lu[k] = x;
  }
  if (l.erreurs.length) return conclure(l);
  const c = d.contratOf(e);
  if (c.interim) { l.avertissements.push('Intérimaire : congés suivis par son agence, rien n’est repris'); return conclure(l); }
  if (lu.rtt != null && !c.rtt && !c.forfait) { l.avertissements.push('Ni RTT ni jours de repos pour ce régime : RTT ignorés'); lu.rtt = null; }
  if (lu.recup != null && (c.forfait || c.partiel || c.dirigeant || c.annuel)) { l.avertissements.push('Pas de récupération pour ce régime : ignorée'); lu.recup = null; }
  if (Object.values(lu).every(x => x == null)) { l.avertissements.push('Aucun solde à reprendre'); return conclure(l); }
  // Congés déjà saisis dans Cursus avant la date d'arrêté : comptés en plus du solde repris, qui les inclut sans doute.
  const avant = d.ds.absences.filter(a => a.empId === e.id && (a.type === 'CP' || a.type === 'RTT') && (a.statut === 'validee' || a.statut === 'demandee') && a.du < arreteLe);
  if (avant.length) l.avertissements.push(`${plural(avant.length, 'congé saisi', 'congés saisis')} dans Cursus avant le ${fmtIso(arreteLe)} : décompté en plus du solde repris`);
  const R = d.ds.soldesReprise.find(s => s.empId === e.id);
  const recupR = R ? R.recupAcquis - R.recupPris : 0;
  const deja = { cpN1: R?.cpSolde ?? null, cpN: R?.cpSoldeSuivant ?? null, rtt: R?.rttSolde ?? null, recup: recupR || null, cet: R?.cetSolde ?? null };
  const repris = Object.values(deja).some(x => x != null);
  const fusion = !!R && R.arreteLe === arreteLe;
  // Compteurs après l'import : ceux du fichier, et à même date d'arrêté ceux déjà repris que le fichier ne porte pas.
  const apres = fusion ? { cpN1: lu.cpN1 ?? deja.cpN1, cpN: lu.cpN ?? deja.cpN, rtt: lu.rtt ?? deja.rtt, recup: lu.recup ?? deja.recup, cet: lu.cet ?? deja.cet } : lu;
  const ecriture = { type: 'soldes' as const, arreteLe, cpSolde: apres.cpN1, cpSoldeSuivant: apres.cpN, rttSolde: apres.rtt, recup: apres.recup, cetSolde: apres.cet };
  l.detail = [`au ${fmtIso(arreteLe)}`, lu.cpN1 != null ? `CP N-1 ${nombreTexte(lu.cpN1)} j` : '', lu.cpN != null ? `CP N ${nombreTexte(lu.cpN)} j` : '',
    lu.rtt != null ? `RTT ${nombreTexte(lu.rtt)} j` : '', lu.recup != null ? `récupération ${nombreTexte(lu.recup)} h` : '', lu.cet != null ? `CET ${nombreTexte(lu.cet)} j` : '']
    .filter(Boolean).join(' · ');
  const gardes = (Object.keys(deja) as (keyof typeof deja)[]).filter(k => deja[k] != null && lu[k] == null).map(k => noms[k]);
  if (fusion && gardes.length) l.detail += ` · inchangés : ${gardes.join(', ')}`;
  if (fusion && (Object.keys(apres) as (keyof typeof apres)[]).every(k => (k === 'recup' ? apres.recup || null : apres[k] ?? null) === deja[k])) {
    l.avertissements.push('Soldes déjà repris');
    return conclure(l);
  }
  if (repris && !fusion && gardes.length) {
    l.avertissements.push(`Date d’arrêté changée (soldes repris au ${R!.arreteLe ? fmtIso(R!.arreteLe) : '—'}) : ${gardes.join(', ')} absents du fichier, plus repris`);
  }
  l.issue = repris ? 'maj' : 'creation';
  l.ecriture = ecriture;
  return conclure(l);
}

// — Titres —

const trouverFormation = (d: Domain, s: string): Formation | undefined => {
  const k = key(s);
  return d.ds.referentiels.formations.find(f => f.id === s.trim().toLowerCase() || key(f.court) === k || key(f.nom) === k);
};
const trouverHabilitation = (d: Domain, s: string): HabType | undefined => {
  const k = key(s);
  return d.ds.referentiels.habilitations.find(h => h.id === s.trim().toLowerCase() || key(h.nom) === k);
};
/** Date passée (ou du jour) d'une cellule ; erreur nommée sinon. */
function datePassee(d: Domain, l: LigneReprise, s: string | undefined, libelle: string): ISODate | null {
  const x = dateDe(s);
  if (x === '') l.erreurs.push(`${libelle} illisible : « ${s} »`);
  else if (!x) l.erreurs.push(`${libelle} manquante`);
  else if (x > d.ti) l.erreurs.push(`${libelle} à venir : ${fmtIso(x)}`);
  else return x;
  return null;
}

function analyserCertifications(d: Domain, lignes: { n: number; v: Valeurs }[]): LigneReprise[] {
  const vus = new Map<string, number>();
  return lignes.map(({ n, v }) => {
    const { e, erreur } = trouverSalarie(d, v);
    const l = ligneVide(n, e?.nom ?? (nomDe(v) || v.matricule || '—'));
    if (!e) l.erreurs.push(erreur!);
    const fm = v.formation?.trim() ? trouverFormation(d, v.formation) : undefined;
    if (!v.formation?.trim()) l.erreurs.push('Formation manquante');
    else if (!fm) l.erreurs.push(`Formation absente du catalogue : « ${v.formation} » (écran Référentiels)`);
    else if (fm.archive) l.erreurs.push(`Formation archivée au catalogue : ${fm.court}`);
    const date = datePassee(d, l, v.date, 'Date d’obtention');
    if (!e || !fm || !date || l.erreurs.length) return conclure(l);
    l.empId = e.id;
    l.detail = `${fm.court}, obtenue le ${fmtIso(date)}`;
    const cle = `${e.id}|${fm.id}|${date}`;
    if (e.certs.some(c => c.f === fm.id && c.obtenue === date)) { l.avertissements.push('Déjà enregistrée'); return conclure(l); }
    if (vus.has(cle)) { l.avertissements.push(`Même certification qu’à la ligne ${vus.get(cle)}`); return conclure(l); }
    vus.set(cle, n);
    const recente = e.certs.filter(c => c.f === fm.id).map(c => c.obtenue).sort().at(-1);
    if (recente && recente > date) l.avertissements.push(`Plus ancienne que celle du ${fmtIso(recente)} : gardée en historique`);
    if (e.fin && e.fin < d.ti) l.avertissements.push('Salarié sorti : certification gardée au dossier');
    l.issue = 'creation';
    l.ecriture = { type: 'certifications', f: fm.id, date };
    return conclure(l);
  });
}

/** Lignes remplacées par une ligne plus récente du même fichier (même salarié, même habilitation ou visite) : ignorées. */
function plusRecentes(lignes: LigneReprise[], cle: (l: LigneReprise) => string | null, date: (l: LigneReprise) => string) {
  const garde = new Map<string, LigneReprise>();
  for (const l of lignes) {
    const k = cle(l);
    if (!k) continue;
    const g = garde.get(k);
    if (!g || date(l) > date(g)) garde.set(k, l);
  }
  return lignes.map(l => {
    const k = cle(l), g = k ? garde.get(k) : null;
    return g && g !== l ? { ...l, issue: 'ignoree' as const, ecriture: null, confirmation: null, avertissements: [`Ligne ${g.n} plus récente`] } : l;
  });
}

function analyserHabilitations(d: Domain, lignes: { n: number; v: Valeurs }[]): LigneReprise[] {
  // Prérequis évalués sur le dossier enrichi (certifications en vigueur, aptitude), salariés sortis compris.
  const enrichis = new Map(d.enrich(d.ds.settings.horizonAlerte, false, { sortis: true }).map(x => [x.id, x]));
  const out = lignes.map(({ n, v }) => {
    const { e, erreur } = trouverSalarie(d, v);
    const l = ligneVide(n, e?.nom ?? (nomDe(v) || v.matricule || '—'));
    if (!e) l.erreurs.push(erreur!);
    const hm = v.habilitation?.trim() ? trouverHabilitation(d, v.habilitation) : undefined;
    if (!v.habilitation?.trim()) l.erreurs.push('Habilitation manquante');
    else if (!hm) l.erreurs.push(`Habilitation absente du référentiel : « ${v.habilitation} » (écran Référentiels)`);
    else if (hm.archive) l.erreurs.push(`Habilitation archivée au référentiel : ${hm.nom}`);
    const date = datePassee(d, l, v.date, 'Date de délivrance');
    const par = (v.signataire ?? '').trim() || hm?.signataire?.trim() || '';
    if (hm && !par) l.erreurs.push('Signataire manquant (ni dans le fichier, ni au référentiel)');
    if (!e || !hm || !date || l.erreurs.length) return conclure(l);
    l.empId = e.id;
    l.detail = `${hm.nom}, délivrée le ${fmtIso(date)} par ${par} · valide jusqu’au ${fmt(addMonths(parse(date), hm.validite))}`;
    const t = e.habs.find(x => x.h === hm.id);
    if (t?.delivree && t.delivree === date) { l.avertissements.push('Déjà enregistrée'); return conclure(l); }
    if (t?.delivree && t.delivree > date) { l.avertissements.push(`Délivrance plus récente déjà enregistrée (${fmtIso(t.delivree)})`); return conclure(l); }
    if (t?.delivree && t.mesure) {
      l.erreurs.push(`${t.mesure === 'retrait' ? 'Retirée' : 'Suspendue'} : à traiter depuis la fiche`);
      return conclure(l);
    }
    const x = enrichis.get(e.id);
    const info = x ? d.habInfo({ h: hm.id, delivree: date }, x.rawCerts, x.med, d.ds.settings.horizonAlerte) : null;
    if (info && !info.prereqOk) l.avertissements.push(`Prérequis non satisfaits : ${info.failing.map(c => c.label).join(', ')} — délivrée quand même (reprise)`);
    l.issue = t ? 'maj' : 'creation';
    l.ecriture = { type: 'habilitations', h: hm.id, date, par, titreId: t?.id ?? null };
    return conclure(l);
  });
  return plusRecentes(out, l => (l.ecriture?.type === 'habilitations' ? `${l.empId}|${l.ecriture.h}` : null), l => (l.ecriture as { date: string }).date);
}

function analyserVisites(d: Domain, lignes: { n: number; v: Valeurs }[], confirmees: Set<number>): LigneReprise[] {
  const out = lignes.map(({ n, v }) => {
    const { e, erreur } = trouverSalarie(d, v);
    const l = ligneVide(n, e?.nom ?? (nomDe(v) || v.matricule || '—'));
    if (!e) l.erreurs.push(erreur!);
    const date = datePassee(d, l, v.date, 'Date de visite');
    const brut = (v.avis ?? '').trim();
    let avis = brut ? avisDe(brut) : null;
    // Jamais la cellule recopiée : elle peut contenir un diagnostic, et le motif d'un refus est conservé au compte rendu.
    if (brut && !avis) l.erreurs.push('Avis non reconnu : attendu apte, apte avec restrictions ou inapte');
    if (!e || !date || l.erreurs.length) return conclure(l);
    l.empId = e.id;
    if (e.visite && e.visite > date) { l.avertissements.push(`Visite plus récente déjà enregistrée (${fmtIso(e.visite)})`); return conclure(l); }
    if (!avis) {
      // Sans avis, l'aptitude reste « à vérifier » : la visite n'est enregistrée « apte » que sur confirmation explicite.
      l.confirmation = 'Aucun avis dans le fichier : enregistrer la visite comme « apte »';
      l.confirmee = confirmees.has(n);
      if (!l.confirmee) {
        l.erreurs.push('Avis absent : aptitude laissée « à vérifier » (cochez pour l’enregistrer apte)');
        return conclure(l);
      }
      avis = 'apte';
      l.avertissements.push('Avis « apte » confirmé par le service RH');
    }
    if (e.visite === date && (e.avis ?? 'apte') === avis) { l.avertissements.push('Déjà enregistrée'); return { ...conclure(l), confirmation: null }; }
    if (avis === 'restrictions') l.avertissements.push('Restrictions à recopier sur la fiche (« Avis du médecin du travail ») : une mention provisoire les signale d’ici là');
    if (avis === 'inapte') l.avertissements.push('Inapte : habilitations qui exigent l’aptitude non valides');
    const exp = addMonths(parse(date), MED_VALIDITE);
    l.detail = `Visite du ${fmtIso(date)} · ${avis === 'apte' ? 'apte' : avis === 'inapte' ? 'inapte' : 'apte avec restrictions'}${avis !== 'inapte' ? ` · à renouveler avant le ${fmt(exp)}` : ''}`;
    l.issue = e.visite ? 'maj' : 'creation';
    l.ecriture = { type: 'visites', date, avis };
    return conclure(l);
  });
  return plusRecentes(out, l => (l.ecriture?.type === 'visites' ? String(l.empId) : null), l => (l.ecriture as { date: string }).date);
}

/** Décompte d'une analyse : lignes à ajouter, à mettre à jour, ignorées, refusées. */
export function bilanReprise(lignes: LigneReprise[]) {
  const n = (i: IssueReprise) => lignes.filter(l => l.issue === i).length;
  return { crees: n('creation'), majs: n('maj'), ignorees: n('ignoree'), refusees: n('refus') };
}
