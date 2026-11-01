// Cycles de roulement du planning d'équipe (lot 12, chantier C5, t192) : référentiel « Cycles » tenu par le service RH (écran
// Référentiels → Cycles à l'étape 2, actions planning.cycle.* de server/src/actions/planning.ts), à côté des horaires de
// poste (shared/rules/horaires.ts) dont il enchaîne les codes jour par jour.
// - Un cycle porte un code (choisi une fois pour toutes), un libellé, une longueur en jours (1 à 70), une séquence (un code
//   d'horaire en vigueur ou un repos par jour), ses groupes (A, B, C…) et le décalage de chacun, et un jour d'origine (premier
//   jour de la séquence pour le groupe de décalage 0) : deux salariés du même groupe ont le même poste le même jour, quelle
//   que soit la date de leur affectation.
// - Modèles génériques amorcés une fois par base (choix par défaut du chantier, en attendant les tableaux de roulement
//   réels) : Journée, 2x8 (matin et après-midi alternés par semaine), 3x8 (matin, après-midi, nuit), 5x8 (feu continu). Ils
//   ne s'amorcent que si leurs horaires d'exemple existent et sont en vigueur (migration `lot12-planning`).
// - On archive au lieu de supprimer ; l'archivage est refusé tant qu'une affectation en cours ou à venir l'emploie.
// - Indicateurs calculés (jamais stockés) : heures moyennes par semaine sur le cycle, postes de nuit et dimanches travaillés
//   par semaine en moyenne, alerte quand la moyenne dépasse 44 h (art. L3121-22) ou l'horaire contractuel.
// Contrôles partagés par le dialogue (étape 2) et l'action, comme ceux des horaires.
import { addD, days, isValidDate, mondayOf, parse } from '../dates.ts';
import { fH } from '../format.ts';
import type { Horaire, ISODate } from '../types.ts';
import type { Cycle, GroupeCycle, Roulement } from '../types-planning.ts';
import { dureeHoraire, horaireDe } from './horaires.ts';
import { heuresDeNuit, plageDuJour, type ReglagesNuit } from './repos-nuit.ts';

/** Code d'un cycle : 1 à 8 lettres majuscules ou chiffres (JOUR, 2X8, 3X8…). */
export const CODE_CYCLE = /^[A-Z0-9]{1,8}$/;
/** Code d'un groupe : une à trois lettres ou chiffres (A, B, C, G1…). */
export const CODE_GROUPE = /^[A-Z0-9]{1,3}$/;
export const NOM_CYCLE_MAX = 60;
/** Longueur d'un cycle : de 1 jour à 10 semaines. */
export const LONGUEUR_MAX = 70;
/** Groupes d'un cycle : 1 à 10. */
export const GROUPES_MAX = 10;
/** Moyenne hebdomadaire sur 12 semaines au-delà de laquelle le cycle est signalé (art. L3121-22). */
export const MOYENNE_CYCLE_MAX = 44;
/** Origine des modèles amorcés : un lundi (le groupe A commence la séquence ce jour-là). */
export const ORIGINE_MODELES: ISODate = '2027-01-04';

const repos = (n: number): null[] => Array.from({ length: n }, () => null);
const fois = (code: string, n: number): string[] => Array.from({ length: n }, () => code);

/** Modèles génériques amorcés (horaires d'exemple J, M, AM et N : shared/rules/horaires.ts), modifiables et archivables. */
export const CYCLES_MODELES: readonly Omit<Cycle, 'archive' | 'creeLe' | 'creePar'>[] = [
  { code: 'JOUR', nom: 'Journée (du lundi au vendredi)', longueur: 7, sequence: [...fois('J', 5), ...repos(2)], groupes: [{ code: 'A', decalage: 0 }], origine: ORIGINE_MODELES },
  {
    code: '2X8', nom: '2x8 : matin et après-midi alternés par semaine', longueur: 14, sequence: [...fois('M', 5), ...repos(2), ...fois('AM', 5), ...repos(2)],
    groupes: [{ code: 'A', decalage: 0 }, { code: 'B', decalage: 7 }], origine: ORIGINE_MODELES,
  },
  {
    code: '3X8', nom: '3x8 : matin, après-midi, nuit', longueur: 21, sequence: [...fois('M', 5), ...repos(2), ...fois('AM', 5), ...repos(2), ...fois('N', 5), ...repos(2)],
    groupes: [{ code: 'A', decalage: 0 }, { code: 'B', decalage: 7 }, { code: 'C', decalage: 14 }], origine: ORIGINE_MODELES,
  },
  {
    // Feu continu : deux matins, deux après-midi, deux nuits, quatre jours de repos ; cinq groupes décalés de deux jours.
    code: '5X8', nom: '5x8 : feu continu (2 matins, 2 après-midi, 2 nuits, 4 repos)', longueur: 10, sequence: [...fois('M', 2), ...fois('AM', 2), ...fois('N', 2), ...repos(4)],
    groupes: ['A', 'B', 'C', 'D', 'E'].map((code, i) => ({ code, decalage: 2 * i })), origine: ORIGINE_MODELES,
  },
];

/** Codes d'horaire employés par un cycle (sans doublon). */
export const horairesDuCycle = (c: Pick<Cycle, 'sequence'>): string[] => [...new Set(c.sequence.filter((x): x is string => !!x))];
export const cycleDe = (cycles: readonly Cycle[] | undefined, code: string | null | undefined) => (code ? (cycles ?? []).find(c => c.code === code) ?? null : null);
export const cyclesEnVigueur = (cycles: readonly Cycle[] | undefined) => (cycles ?? []).filter(c => !c.archive);
export const normaliserCodeCycle = (v: unknown) => String(v ?? '').trim().toUpperCase();

/**
 * Indice dans la séquence du jour `jour` pour le groupe `groupe` : jours écoulés depuis l'origine, moins le décalage du groupe,
 * ramenés à la longueur du cycle. null : groupe inconnu.
 */
export function indiceDuJour(c: Pick<Cycle, 'longueur' | 'groupes' | 'origine'>, groupe: string, jour: ISODate): number | null {
  const g = c.groupes.find(x => x.code === groupe);
  if (!g || !(c.longueur > 0)) return null;
  const n = days(parse(c.origine), parse(jour)) - g.decalage;
  return ((n % c.longueur) + c.longueur) % c.longueur;
}

/** Code d'horaire prévu par le cycle le jour `jour` pour le groupe (null : repos, ou groupe inconnu). */
export function horaireDuCycle(c: Pick<Cycle, 'longueur' | 'groupes' | 'origine' | 'sequence'>, groupe: string, jour: ISODate): string | null {
  const i = indiceDuJour(c, groupe, jour);
  return i == null ? null : c.sequence[i] ?? null;
}

// — Contrôles de saisie —

export interface ErreursCycle { code?: string; nom?: string; longueur?: string; sequence?: string; groupes?: string; origine?: string }

/**
 * Création (`existant` null : code choisi, jamais modifié ensuite, unique parmi les cycles archivés compris) ou modification
 * d'un cycle. Séquence de `longueur` jours, chaque jour un code d'horaire en vigueur ou un repos (null, « », « - »), au moins
 * un jour travaillé ; groupes aux codes uniques, décalages entiers de 0 à la longueur moins un, deux à deux distincts ;
 * origine : une date (un lundi conseillé, non exigé).
 */
export function controlerCycle(
  p: { code?: unknown; nom?: unknown; longueur?: unknown; sequence?: unknown; groupes?: unknown; origine?: unknown },
  cycles: readonly Cycle[], horaires: readonly Horaire[], existant: Cycle | null,
): { erreurs: ErreursCycle; valeurs: Omit<Cycle, 'archive' | 'creeLe' | 'creePar'> | null } {
  const erreurs: ErreursCycle = {};
  const code = existant ? existant.code : normaliserCodeCycle(p.code);
  const nom = String(p.nom ?? existant?.nom ?? '').replace(/\s+/g, ' ').trim();
  if (!existant) {
    if (!code) erreurs.code = 'Indiquez le code du cycle (2X8, 3X8…).';
    else if (!CODE_CYCLE.test(code)) erreurs.code = 'Code : 1 à 8 lettres ou chiffres.';
    else if (cycles.some(c => c.code === code)) erreurs.code = `Le code ${code} existe déjà (archivés compris).`;
  }
  if (!nom) erreurs.nom = 'Indiquez le libellé du cycle.';
  else if (nom.length > NOM_CYCLE_MAX) erreurs.nom = `Libellé : ${NOM_CYCLE_MAX} caractères au plus.`;
  const sequenceRecue = p.sequence ?? existant?.sequence;
  const longueur = Number(p.longueur ?? (Array.isArray(sequenceRecue) ? sequenceRecue.length : existant?.longueur));
  if (!Number.isInteger(longueur) || longueur < 1 || longueur > LONGUEUR_MAX) erreurs.longueur = `Longueur : un nombre entier de jours, de 1 à ${LONGUEUR_MAX}.`;
  let sequence: (string | null)[] = [];
  if (!Array.isArray(sequenceRecue)) erreurs.sequence = 'Indiquez la séquence : un horaire ou un repos pour chaque jour du cycle.';
  else {
    sequence = sequenceRecue.map(x => { const v = String(x ?? '').trim().toUpperCase(); return v && v !== '-' ? v : null; });
    if (!erreurs.longueur && sequence.length !== longueur) erreurs.sequence = `La séquence compte ${sequence.length} jours au lieu de ${longueur}.`;
    else if (!sequence.some(Boolean)) erreurs.sequence = 'La séquence doit compter au moins un jour travaillé.';
    else {
      const inconnus = [...new Set(sequence.filter((x): x is string => !!x && !horaires.some(h => h.code === x && !h.archive)))];
      if (inconnus.length) erreurs.sequence = `Horaire${inconnus.length > 1 ? 's' : ''} inconnu${inconnus.length > 1 ? 's' : ''} ou archivé${inconnus.length > 1 ? 's' : ''} : ${inconnus.join(', ')}.`;
    }
  }
  let groupes: GroupeCycle[] = [];
  const groupesRecus = p.groupes ?? existant?.groupes;
  if (!Array.isArray(groupesRecus) || !groupesRecus.length) erreurs.groupes = 'Indiquez au moins un groupe (A, décalage 0).';
  else if (groupesRecus.length > GROUPES_MAX) erreurs.groupes = `${GROUPES_MAX} groupes au plus.`;
  else {
    groupes = groupesRecus.map(g => ({ code: String((g as GroupeCycle)?.code ?? '').trim().toUpperCase(), decalage: Number((g as GroupeCycle)?.decalage) }));
    if (groupes.some(g => !CODE_GROUPE.test(g.code))) erreurs.groupes = 'Code d’un groupe : 1 à 3 lettres ou chiffres.';
    else if (new Set(groupes.map(g => g.code)).size !== groupes.length) erreurs.groupes = 'Deux groupes portent le même code.';
    else if (!erreurs.longueur && groupes.some(g => !Number.isInteger(g.decalage) || g.decalage < 0 || g.decalage >= longueur)) erreurs.groupes = `Décalage d’un groupe : un nombre entier de jours, de 0 à ${longueur - 1}.`;
    else if (new Set(groupes.map(g => g.decalage)).size !== groupes.length) erreurs.groupes = 'Deux groupes ont le même décalage : ils auraient le même poste chaque jour.';
  }
  const origine = String(p.origine ?? existant?.origine ?? ORIGINE_MODELES);
  if (!isValidDate(origine)) erreurs.origine = 'Jour d’origine invalide.';
  return Object.keys(erreurs).length
    ? { erreurs, valeurs: null }
    : { erreurs, valeurs: { code, nom, longueur, sequence, groupes, origine } };
}

/** Affectations en cours ou à venir au jour `ti` qui emploient le cycle (archivage refusé tant qu'il y en a). */
export const roulementsDuCycle = (roulements: readonly Roulement[] | undefined, code: string, ti: ISODate) =>
  (roulements ?? []).filter(r => r.cycle === code && (!r.au || r.au >= ti));

// — Indicateurs —

export interface IndicateursCycle {
  /** Heures de travail par semaine en moyenne sur le cycle (pauses retirées). */
  heuresSemaine: number;
  /** Postes qui comptent des heures de nuit, par semaine en moyenne. */
  nuitsSemaine: number;
  /** Dimanches travaillés par semaine en moyenne (0 à 1), pour le groupe de décalage 0. */
  dimanches: number;
  /** Alertes : moyenne au-delà de 44 h, ou de l'horaire contractuel donné. */
  alertes: string[];
}

/**
 * Indicateurs d'un cycle (calculés à l'écran et à l'enregistrement, jamais stockés) : sur la séquence, heures de chaque poste
 * (durée de l'horaire hors pause), postes qui empiètent sur la plage de nuit réglée, dimanches d'après le jour d'origine, sur
 * un nombre entier de semaines (plus petit multiple commun de la longueur et de 7). `contrat` : horaire hebdomadaire
 * contractuel à comparer (35 h…), facultatif.
 */
export function indicateursCycle(c: Pick<Cycle, 'longueur' | 'sequence' | 'origine'>, horaires: readonly Horaire[], nuit: Pick<ReglagesNuit, 'nuitDebut' | 'nuitFin'>, contrat?: number): IndicateursCycle {
  const pgcd = (a: number, b: number): number => (b ? pgcd(b, a % b) : a);
  const n = c.longueur / pgcd(c.longueur, 7) * 7;
  let heures = 0, nuits = 0, dimanches = 0;
  for (let i = 0; i < n; i++) {
    const h = horaireDe({ horaires: [...horaires] }, c.sequence[i % c.longueur]);
    if (!h) continue;
    const duree = dureeHoraire(h);
    heures += duree;
    if (heuresDeNuit(plageDuJour(h, duree, 0), nuit) > 0) nuits++;
    if (parse(addD(c.origine, i)).getDay() === 0) dimanches++;
  }
  const semaines = n / 7, arrondi = (x: number) => Math.round(x * 100) / 100;
  const heuresSemaine = arrondi(heures / semaines);
  const alertes: string[] = [];
  if (heuresSemaine > MOYENNE_CYCLE_MAX) alertes.push(`${fH(heuresSemaine)} par semaine en moyenne sur le cycle : plus de ${MOYENNE_CYCLE_MAX} h en moyenne sur 12 semaines (art. L3121-22)`);
  if (contrat && heuresSemaine > contrat) alertes.push(`${fH(heuresSemaine)} par semaine en moyenne, au-delà de l’horaire contractuel de ${fH(contrat)} : heures supplémentaires ou repos à prévoir`);
  return { heuresSemaine, nuitsSemaine: arrondi(nuits / semaines), dimanches: arrondi(dimanches / semaines), alertes };
}

/** Lundi de la semaine de l'origine (affichage de la séquence par semaines). */
export const lundiOrigine = (c: Pick<Cycle, 'origine'>) => mondayOf(c.origine);
