// Politique de dépenses et limites d'exonération (lot 11, chantier C5) : alertes calculées sur chaque ligne d'une note,
// jamais stockées, montrées au salarié, au valideur et au contrôleur (écrans de l'étape 2) ; les alertes bloquantes
// refusent la soumission. Deux notions distinctes (relecture critique du lot 11) :
// - dépassement de la politique interne (plafond de la catégorie, réglage `fraisPlafonds`, vide par défaut : aucune
//   politique connue) : alerte ; la ligne est acceptée avec un motif (`motifDepassement`) ou ramenée au plafond par le
//   contrôleur (`montantRetenu`). Ce n'est jamais une réintégration dans l'assiette des cotisations ;
// - allocation au-delà de la limite d'exonération (arrêté du 20 décembre 2002) : allocation forfaitaire au-delà du
//   montant URSSAF de l'année (`forfaitsFrais`), indemnité kilométrique au-delà du barème plafonné à 7 CV : la part au-delà
//   est réintégrable dans l'assiette, signalée à la paie (rubrique FRAIS_REINT).
// Un frais réel justifié (repas, hôtel, train… sur facture) n'est jamais présenté comme réintégrable.
// Autres alertes : justificatif manquant (sauf indemnité kilométrique, allocation forfaitaire, montant sous le seuil, ou
// attestation sur l'honneur), repas d'affaires sans invités, soumission au-delà du délai, dépense un week-end ou un jour
// d'absence validée, barème ou limite de l'année manquant, cumul avec un forfait de grand déplacement (bloquant :
// shared/rules/frais-cumul.ts), restaurant au-delà de la note simplifiée (facture au nom de l'entreprise à vérifier).
import { addM, weekday } from '../dates.ts';
import type { CodeForfaitFrais, ForfaitFrais, ISODate, LigneFrais, Settings } from '../types.ts';
import { CATEGORIES_FRAIS, montantRetenu, r2 } from './frais.ts';
import { type CumulForfait, RUBRIQUE_CUMUL } from './frais-cumul.ts';
import { factureEntrepriseAVerifier } from './frais-tva.ts';

export type NiveauAlerteFrais = 'info' | 'alerte' | 'bloquant';
export type CodeAlerteFrais = 'plafond' | 'justificatif' | 'attestation' | 'invites' | 'delai' | 'weekend' | 'absence' | 'bareme' | 'limite' | 'cumul' | 'facture' | 'doublon';
/** Alerte d'une ligne : code, niveau, texte (sans nature de dépense médicale), part réintégrable éventuelle (euros). */
export interface AlerteFrais { code: CodeAlerteFrais; niveau: NiveauAlerteFrais; texte: string; reintegrable?: number }

export const FORFAITS_FRAIS: Record<CodeForfaitFrais, string> = {
  repas_restaurant: 'Repas au restaurant en déplacement',
  repas_hors_locaux: 'Repas hors des locaux, sans restaurant',
  panier: 'Panier sur le lieu de travail',
  gd_repas: 'Grand déplacement : repas',
  gd_logement_idf: 'Grand déplacement : logement et petit-déjeuner (Paris et petite couronne)',
  gd_logement_autres: 'Grand déplacement : logement et petit-déjeuner (autres départements)',
  etranger: 'Mission à l’étranger : indemnité journalière (par pays)',
};
export const estCodeForfait = (v: unknown): v is CodeForfaitFrais => typeof v === 'string' && Object.hasOwn(FORFAITS_FRAIS, v);

/** Code de forfait d'une ligne : « gd_repas », ou « etranger:MA » (pays). */
export function forfaitDeLaLigne(forfait: string | null | undefined): { code: CodeForfaitFrais; pays: string | null } | null {
  if (!forfait) return null;
  const [code, pays] = forfait.split(':');
  return estCodeForfait(code) ? { code, pays: code === 'etranger' ? pays ?? null : null } : null;
}

/** Limite d'exonération d'un forfait pour une année (montant saisi par le service RH) ; null si elle n'est pas saisie. */
export function limiteForfait(forfaits: readonly ForfaitFrais[] | undefined, annee: number, forfait: string | null | undefined): number | null {
  const f = forfaitDeLaLigne(forfait);
  if (!f) return null;
  return (forfaits ?? []).find(x => x.annee === annee && x.code === f.code && (x.pays ?? null) === f.pays)?.montant ?? null;
}

/** Plafond interne de la catégorie (réglage `fraisPlafonds`) ; null : aucun. Une indemnité ou une allocation n'en a pas. */
export function plafondInterne(plafonds: Settings['fraisPlafonds'] | undefined, l: Pick<LigneFrais, 'categorie'>): number | null {
  if (l.categorie === 'ik' || l.categorie === 'forfait') return null;
  const p = plafonds?.[l.categorie];
  return typeof p === 'number' && p > 0 ? p : null;
}

/** Dépassement de la politique interne : montant demandé au-delà du plafond de la catégorie (0 : aucun). */
export function depassementPolitique(plafonds: Settings['fraisPlafonds'] | undefined, l: Pick<LigneFrais, 'categorie' | 'montantEur'>): number {
  const p = plafondInterne(plafonds, l);
  return p === null ? 0 : r2(Math.max(0, l.montantEur - p));
}

/**
 * Part réintégrable d'une ligne (allocation au-delà de la limite d'exonération) : allocation forfaitaire au-delà de la
 * limite de l'année, indemnité kilométrique au-delà du barème plafonné (`limiteIk`). Un frais réel : toujours 0. null :
 * limite ou barème de l'année absent (à saisir avant de conclure).
 */
export function reintegrable(l: Pick<LigneFrais, 'categorie' | 'forfait' | 'date' | 'refuseeLe' | 'montantEur' | 'montantRetenu'>,
  cx: { forfaits?: readonly ForfaitFrais[]; limiteIk?: number | null }): number | null {
  if (l.refuseeLe) return 0;
  if (l.categorie === 'forfait') {
    const limite = limiteForfait(cx.forfaits, Number(l.date.slice(0, 4)), l.forfait);
    return limite === null ? null : r2(Math.max(0, montantRetenu(l) - limite));
  }
  if (l.categorie === 'ik') return cx.limiteIk == null ? null : r2(Math.max(0, montantRetenu(l) - cx.limiteIk));
  return 0;
}

/** Ce que les alertes d'une ligne lisent en plus de la ligne : réglages, jour, pièces jointes, forfaits, barème, absences, cumul. */
export interface ContexteAlertes {
  settings: Pick<Settings, 'fraisPlafonds' | 'fraisSeuilJustificatif' | 'fraisDelaiSoumissionMois'>;
  today: ISODate;
  /** Justificatifs en vigueur joints à la ligne. */
  justificatifs: number;
  forfaits?: readonly ForfaitFrais[];
  /** Indemnité kilométrique au barème plafonné pour ce trajet (null : barème de l'année absent). */
  limiteIk?: number | null;
  /** Jour d'absence validée du salarié. */
  absent?: boolean;
  /** Cumul avec un forfait de grand déplacement déjà payé ce jour-là. */
  cumul?: CumulForfait | null;
  /** Autres lignes qui doublonnent celle-ci (même salarié, date, montant, commerçant ; ou même justificatif). */
  doublons?: readonly number[];
}

const eur = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Alertes d'une ligne, dans l'ordre : bloquantes d'abord (refusent la soumission), puis alertes et informations. */
export function alertesLigne(l: LigneFrais, cx: ContexteAlertes): AlerteFrais[] {
  const out: AlerteFrais[] = [];
  const def = CATEGORIES_FRAIS[l.categorie];
  if (l.refuseeLe) return out;
  // Justificatif : exigé pour un frais réel au-delà du seuil, sauf attestation sur l'honneur.
  if (def.justificatif && l.montantEur > cx.settings.fraisSeuilJustificatif && !cx.justificatifs) {
    if (l.sansJustificatif && l.attestation) out.push({ code: 'attestation', niveau: 'alerte', texte: 'Sans justificatif : attestation sur l’honneur du salarié' });
    else out.push({ code: 'justificatif', niveau: 'bloquant', texte: 'Justificatif manquant : joignez le reçu, ou attestez sur l’honneur l’avoir perdu' });
  }
  if (l.categorie === 'repas_affaires' && !l.invites?.trim()) out.push({ code: 'invites', niveau: 'bloquant', texte: 'Repas d’affaires : indiquez les invités' });
  if (cx.cumul) out.push({ code: 'cumul', niveau: 'bloquant', texte: `Dépense déjà couverte par le forfait du ${RUBRIQUE_CUMUL[cx.cumul.rubrique]} : un forfait et des frais réels ne se cumulent pas` });
  // Politique interne : alerte, acceptée avec un motif ou plafonnée ; jamais une réintégration.
  const plafond = plafondInterne(cx.settings.fraisPlafonds, l), depasse = depassementPolitique(cx.settings.fraisPlafonds, l);
  if (plafond !== null && depasse > 0) {
    if (l.montantRetenu != null && l.montantRetenu <= plafond) out.push({ code: 'plafond', niveau: 'info', texte: `Ramené au plafond de la politique (${eur(plafond)})` });
    else if (l.motifDepassement?.trim()) out.push({ code: 'plafond', niveau: 'alerte', texte: `Au-delà du plafond de la politique (${eur(plafond)}) de ${eur(depasse)}, avec un motif` });
    else out.push({ code: 'plafond', niveau: 'bloquant', texte: `Au-delà du plafond de la politique (${eur(plafond)}) de ${eur(depasse)} : indiquez le motif` });
  }
  // Limite d'exonération (forfaits, indemnités kilométriques) : part réintégrable signalée à la paie.
  const annee = Number(l.date.slice(0, 4));
  const r = reintegrable(l, cx);
  if (r === null) {
    out.push({ code: 'bareme', niveau: 'alerte', texte: l.categorie === 'ik' ? `Barème kilométrique ${annee} manquant : à saisir par le service RH` : `Limite d’exonération ${annee} de ce forfait manquante : à saisir par le service RH` });
  } else if (r > 0) {
    out.push({ code: 'limite', niveau: 'info', texte: `Allocation au-delà de la limite d’exonération : ${eur(r)} réintégrables dans l’assiette des cotisations (signalés à la paie)`, reintegrable: r });
  }
  if (cx.doublons?.length) out.push({ code: 'doublon', niveau: 'alerte', texte: `Doublon possible avec ${cx.doublons.length > 1 ? `${cx.doublons.length} autres dépenses` : 'une autre dépense'} (même date, même montant, même commerçant, ou même justificatif)` });
  if (factureEntrepriseAVerifier(l)) out.push({ code: 'facture', niveau: 'alerte', texte: 'Restaurant au-delà de 150 € HT : la TVA ne se récupère que sur une facture au nom de l’entreprise' });
  // Délai de soumission : mois de la dépense plus le délai réglé.
  if (cx.settings.fraisDelaiSoumissionMois > 0 && addM(`${l.date.slice(0, 7)}-01`, cx.settings.fraisDelaiSoumissionMois + 1) <= cx.today) {
    out.push({ code: 'delai', niveau: 'alerte', texte: `Dépense de plus de ${cx.settings.fraisDelaiSoumissionMois} mois : soumise au-delà du délai de la politique` });
  }
  if (cx.absent) out.push({ code: 'absence', niveau: 'alerte', texte: 'Dépense un jour d’absence' });
  if (weekday(l.date) >= 5 && l.categorie !== 'hotel') out.push({ code: 'weekend', niveau: 'info', texte: 'Dépense un week-end' });
  const ordre: Record<NiveauAlerteFrais, number> = { bloquant: 0, alerte: 1, info: 2 };
  return out.sort((a, b) => ordre[a.niveau] - ordre[b.niveau]);
}

/** Alertes bloquantes (refusent la soumission). */
export const bloquantes = (alertes: readonly AlerteFrais[]) => alertes.filter(a => a.niveau === 'bloquant');

/** Part réintégrable totale des lignes (allocations au-delà des limites) ; les limites manquantes ne comptent pas. */
export const totalReintegrable = (alertes: readonly AlerteFrais[]) => r2(alertes.reduce((n, a) => n + (a.reintegrable ?? 0), 0));
