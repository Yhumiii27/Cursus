// CDD et intérim (t053) : motif de recours, durée maximale renouvellements compris, nombre de renouvellements et délai de
// carence entre deux contrats. Tout est en avertissement : rien n'est bloqué, le service RH vérifie le contrat signé.
// Depuis les ordonnances de 2017, la convention ou l'accord de branche étendu fixe la durée maximale (art. L1242-8), le
// nombre de renouvellements (art. L1243-13) et le délai de carence (art. L1244-3) ; à défaut, les règles supplétives de la
// loi s'appliquent (art. L1242-8-1, L1243-13-1, L1244-3-1 et L1244-4-1) : ce sont les valeurs ci-dessous. Un accord de la
// CCN Industries chimiques qui y dérogerait se règle dans Paramètres → Contrats, avec sa référence (à vérifier).
// Les renouvellements sont les lignes `renouvellement` de l'historique des contrats (shared/rules/historique-contrat.ts) ;
// la fiche ne garde que le motif et le terme initial.
import { addD, addM, days, isFerie, isValidDate, parse, weekday } from '../dates.ts';
import { fmtIso, key, plural } from '../format.ts';
import type { Employe, ISODate, MotifRecours, Settings } from '../types.ts';

/** Nombre de renouvellements prévu par la loi, à défaut d'accord de branche (art. L1243-13-1). */
export const CDD_RENOUVELLEMENTS_LEGAL = 2;

export interface MotifRecoursDef {
  label: string;
  article: string;
  /** Durée maximale renouvellements compris, en mois (art. L1242-8-1) ; null : aucune durée légale (saison, dispositif). */
  dureeMois: number | null;
  /** Renouvellements admis par la loi (CDD senior : un seul). */
  renouvellements: number;
  /** CDD à terme imprécis possible (art. L1242-7) : il prend fin avec son objet, sans durée maximale. */
  termeImprecis: boolean;
  /** Délai de carence applicable au contrat suivant sur le même poste (exceptions de l'art. L1244-4-1 : faux). */
  carence: boolean;
}

/** Motifs de recours : liste fermée, sans texte libre (le contrat écrit précise le salarié remplacé ou la tâche). */
export const MOTIFS_RECOURS: Record<MotifRecours, MotifRecoursDef> = {
  remplacement: { label: 'Remplacement d’un salarié absent', article: 'art. L1242-2, 1°', dureeMois: 18, renouvellements: 2, termeImprecis: true, carence: false },
  remplacement_suppression: {
    label: 'Remplacement d’un salarié parti avant la suppression de son poste', article: 'art. L1242-2, 1°, d', dureeMois: 24, renouvellements: 2, termeImprecis: false, carence: true,
  },
  attente_cdi: { label: 'Attente de l’entrée en service d’un salarié recruté en CDI', article: 'art. L1242-2, 1°, e', dureeMois: 9, renouvellements: 2, termeImprecis: true, carence: true },
  accroissement: { label: 'Accroissement temporaire d’activité', article: 'art. L1242-2, 2°', dureeMois: 18, renouvellements: 2, termeImprecis: false, carence: true },
  travaux_urgents: { label: 'Travaux urgents nécessités par des mesures de sécurité', article: 'art. L1242-2, 2°', dureeMois: 9, renouvellements: 2, termeImprecis: false, carence: false },
  saisonnier_usage: { label: 'Emploi saisonnier ou d’usage', article: 'art. L1242-2, 3°', dureeMois: null, renouvellements: 2, termeImprecis: true, carence: false },
  export: { label: 'Commande exceptionnelle à l’exportation', article: 'art. L1242-8-1', dureeMois: 24, renouvellements: 2, termeImprecis: false, carence: true },
  senior: { label: 'CDD senior (plus de 57 ans, en recherche d’emploi)', article: 'art. L1242-3 et D1242-2', dureeMois: 36, renouvellements: 1, termeImprecis: false, carence: true },
  politique_emploi: {
    label: 'Politique de l’emploi ou formation (contrat aidé, complément de formation)', article: 'art. L1242-3', dureeMois: null, renouvellements: 2, termeImprecis: false, carence: true,
  },
};
export const estMotifRecours = (v: unknown): v is MotifRecours => typeof v === 'string' && Object.hasOwn(MOTIFS_RECOURS, v);

type ReglagesCdd = Pick<Settings, 'cddRenouvellementsMax' | 'cddDureeMaxMois' | 'cddAccordBranche'>;
/** Mention de l'accord de branche qui déroge à la loi, ou de la règle supplétive. */
const source = (s: ReglagesCdd, legal: string) => (s.cddAccordBranche ? `accord de branche : ${s.cddAccordBranche}` : legal);

/** Durée maximale d'un CDD selon son motif et les réglages (mois et texte), ou null : aucune durée maximale. */
export function dureeMaxCdd(motif: MotifRecours, s: ReglagesCdd): { mois: number; texte: string } | null {
  const m = MOTIFS_RECOURS[motif];
  if (m.dureeMois == null) return null;
  if (s.cddDureeMaxMois > 0 && motif !== 'senior') return { mois: s.cddDureeMaxMois, texte: `${s.cddDureeMaxMois} mois, ${source(s, 'art. L1242-8')}` };
  return { mois: m.dureeMois, texte: `${m.dureeMois} mois pour ce motif, art. L1242-8-1` };
}

/** Renouvellements admis : réglage d'un accord de branche, sinon la loi (un seul pour un CDD senior). */
export function renouvellementsMax(motif: MotifRecours | null, s: ReglagesCdd): { n: number; texte: string } {
  if (s.cddRenouvellementsMax !== CDD_RENOUVELLEMENTS_LEGAL) return { n: s.cddRenouvellementsMax, texte: source(s, 'art. L1243-13') };
  const n = motif ? MOTIFS_RECOURS[motif].renouvellements : CDD_RENOUVELLEMENTS_LEGAL;
  return { n, texte: motif === 'senior' ? 'art. D1242-7' : 'art. L1243-13-1' };
}

/** Dernier jour d'un contrat de `mois` mois commencé le `entree`. */
const finApres = (entree: ISODate, mois: number) => addD(addM(entree, mois), -1);

/** Saisie contrôlée : la fiche (ou sa saisie) et ce que l'historique en sait. */
export interface SaisieCdd {
  typeContrat: Employe['typeContrat']; entree: string; fin: string | null; motifRecours?: string | null; cddFinInitiale?: string | null;
}

/**
 * Contrôles d'un CDD (fiche, renouvellement) : motif dans la liste et terme initial cohérent (bloquants) ; motif à
 * renseigner, durée maximale dépassée renouvellements compris, renouvellements au-delà du nombre admis, fin repoussée sans
 * renouvellement (avertissements, sans blocage). `renouvellements` : nombre enregistré, celui en cours compris ;
 * `finEnregistree` : fin du contrat avant la saisie (fiche modifiée) ; `sortie` : sortie enregistrée (la fin n'est alors plus
 * le terme du contrat). Intérim : motif facultatif (art. L1251-6), contrôlé seulement s'il est donné.
 */
export function controleCdd(p: SaisieCdd, o: { renouvellements: number; reglages: ReglagesCdd; finEnregistree?: string | null; sortie?: boolean }): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  if (p.typeContrat !== 'cdd' && p.typeContrat !== 'interim') return { errors, warnings };
  const motif = p.motifRecours || null;
  if (motif && !estMotifRecours(motif)) errors.push('Motif de recours à choisir dans la liste.');
  if (p.typeContrat === 'interim') return { errors, warnings };
  const initiale = p.cddFinInitiale || null;
  if (initiale && !isValidDate(initiale)) errors.push('Terme initial du CDD invalide.');
  else if (initiale && isValidDate(p.entree) && initiale < p.entree) errors.push('Le terme initial du CDD précède la date d’entrée.');
  else if (initiale && p.fin && !o.sortie && initiale > p.fin) errors.push('Le terme initial du CDD dépasse sa fin actuelle.');
  if (errors.length) return { errors, warnings };
  if (!motif) warnings.push('Motif de recours du CDD à renseigner : il est écrit au contrat (art. L1242-2 et L1242-12).');
  if (o.sortie || !p.fin || !isValidDate(p.fin) || !isValidDate(p.entree)) return { errors, warnings };
  const m = motif && estMotifRecours(motif) ? motif : null;
  const max = m ? dureeMaxCdd(m, o.reglages) : null;
  if (m && max && p.fin > finApres(p.entree, max.mois)) {
    const imprecis = MOTIFS_RECOURS[m].termeImprecis ? ' (un CDD à terme imprécis, art. L1242-7, prend fin avec son objet : la fin saisie en est la date prévue)' : '';
    warnings.push(`Durée du CDD au-delà du maximum, renouvellements compris (${max.texte}) : le ${fmtIso(finApres(p.entree, max.mois))} au plus tard${imprecis}. Au-delà, le contrat peut être requalifié en CDI (art. L1245-1).`);
  }
  const r = renouvellementsMax(m, o.reglages);
  if (o.renouvellements > r.n) {
    warnings.push(`${plural(o.renouvellements, 'renouvellement', 'renouvellements')} pour ${plural(r.n, 'admis', 'admis')} (${r.texte}) : le contrat peut être requalifié en CDI (art. L1245-1).`);
  }
  if (o.finEnregistree && isValidDate(o.finEnregistree) && p.fin > o.finEnregistree) {
    warnings.push(`Fin du CDD repoussée du ${fmtIso(o.finEnregistree)} au ${fmtIso(p.fin)} sans renouvellement : enregistrez plutôt un renouvellement (bouton « Renouveler » de la fiche), qui garde la trace de l’avenant et compte les renouvellements.`);
  }
  return { errors, warnings };
}

/** Contrat antérieur sur le même poste ou du même titulaire, sorti, dont le délai de carence court encore. */
export interface Carence { empId: number; nom: string; fin: ISODate; duree: number; delai: number; possibleLe: ISODate; meme: 'poste' | 'titulaire' }

/** Jour qui suit `n` jours d'ouverture (lundi au vendredi, hors fériés) après `fin`. */
function apresJoursOuverture(fin: ISODate, n: number): ISODate {
  let j = fin, k = 0;
  while (k < n) { j = addD(j, 1); if (weekday(j) < 5 && !isFerie(j)) k++; }
  return addD(j, 1);
}

/**
 * Délai de carence (art. L1244-3 et L1244-3-1) avant un CDD ou une mission d'intérim qui commence le `entree` : contrat
 * antérieur (CDD ou intérim) sur le même poste du référentiel ou du même titulaire (matricule de paie, ou nom et date de
 * naissance), terminé avant l'entrée ; délai du tiers de sa durée, renouvellements compris, à partir de 14 jours, de la
 * moitié en deçà, compté en jours d'ouverture (ici du lundi au vendredi, hors fériés : à vérifier pour un service en
 * continu). Aucun délai pour les motifs exceptés (art. L1244-4-1 : nouvelle absence du salarié remplacé, travaux urgents,
 * emploi saisonnier ou d'usage). Rupture anticipée à l'initiative du salarié, refus du renouvellement : exceptions que
 * Cursus ne connaît pas, rappelées dans l'avertissement.
 */
export function carences(employes: readonly Employe[], p: SaisieCdd & { id?: number | null; posteId?: number | null; matriculePaie?: string | null; nom: string; naissanceLe?: string | null }): Carence[] {
  if ((p.typeContrat !== 'cdd' && p.typeContrat !== 'interim') || !isValidDate(p.entree)) return [];
  if (p.motifRecours && estMotifRecours(p.motifRecours) && !MOTIFS_RECOURS[p.motifRecours].carence) return [];
  const out: Carence[] = [];
  for (const e of employes) {
    if (e.id === p.id || (e.typeContrat !== 'cdd' && e.typeContrat !== 'interim') || !e.fin || !isValidDate(e.fin) || e.fin >= p.entree) continue;
    const poste = p.posteId != null && e.posteId === p.posteId;
    const titulaire = (!!p.matriculePaie && e.matriculePaie === p.matriculePaie)
      || (!!p.naissanceLe && e.naissanceLe === p.naissanceLe && !!key(p.nom) && key(e.nom) === key(p.nom));
    if (!poste && !titulaire) continue;
    const duree = days(parse(e.entree), parse(e.fin)) + 1;
    const delai = Math.ceil(duree / (duree >= 14 ? 3 : 2));
    const possibleLe = apresJoursOuverture(e.fin, delai);
    if (p.entree < possibleLe) out.push({ empId: e.id, nom: e.nom, fin: e.fin, duree, delai, possibleLe, meme: poste ? 'poste' : 'titulaire' });
  }
  return out;
}

/** Avertissement d'une carence non écoulée. */
export const carenceTexte = (c: Carence) =>
  `Délai de carence non écoulé : ${c.meme === 'poste' ? `le poste était pourvu par ${c.nom}` : `${c.nom} sortait d’un contrat`} jusqu’au ${fmtIso(c.fin)} (${plural(c.duree, 'jour', 'jours')}, renouvellements compris). `
  + `Délai de ${plural(c.delai, 'jour d’ouverture', 'jours d’ouverture')} (${c.duree >= 14 ? 'tiers' : 'moitié'} de cette durée, art. L1244-3-1) : nouveau contrat possible à partir du ${fmtIso(c.possibleLe)}, `
  + 'sauf exception (art. L1244-4-1 : rupture anticipée à l’initiative du salarié, refus du renouvellement…) ou accord de branche.';
