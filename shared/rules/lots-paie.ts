// Lots de paie : feuilles validées d'une période de paie réunies en un lot au contenu figé, fichier d'import pour Sage
// tiré de ce contenu (format réglé par la paie), cycle du lot (généré → transmis à la confirmation de l'import, ou
// annulé avant elle). Partagé par les actions (server/src/actions/paie.ts), le téléchargement
// (server/src/fichier-paie.ts) et l'écran Temps (client/src/components/LotsPaie.tsx).
// Périmètre du fichier : heures validées de la semaine du lundi au dimanche (semaine à 7 jours, heures du dimanche aussi
// en HDIM) ; absences, déplacements et nuit restent saisis dans Sage (PERIMETRE_FICHIER, repris par l'écran, la
// confirmation et la procédure).
import type { ColonneFichierPaie, FeuilleTemps, FormatFichierPaie, ISODate, LotPaie, SagePush, Settings, StatutLotPaie } from '../types.ts';
import { periodesSemaine } from './paie.ts';

/** Ce que le fichier contient, et ce qu'il ne contient pas (écran, confirmation, docs/DEPLOIEMENT.md). */
export const PERIMETRE_FICHIER = 'Heures validées de la semaine, samedi et dimanche compris (heures du dimanche aussi en HDIM) : absences, déplacements et heures de nuit restent saisis dans Sage.';

export const STATUTS_LOT: Record<StatutLotPaie, { label: string; cls: string }> = {
  genere: { label: 'Import à confirmer', cls: 'tag-accent' },
  transmis: { label: 'Transmis', cls: 'tag-neutral' },
  annule: { label: 'Annulé', cls: 'tag-outline' },
};

/** Lot qui réserve ses feuilles : généré ou transmis (un lot annulé les a libérées). */
export const lotActif = (l: Pick<LotPaie, 'statut'>) => l.statut !== 'annule';

// — Choix des feuilles —

/** Première période de paie où partent les heures d'une feuille transmise le jour `today` (rappel compris). */
export const periodeDeLaFeuille = (week: ISODate, s: Partial<Settings> | undefined, today: ISODate) => periodesSemaine(week, s, today)[0].periode;

/**
 * Feuilles d'un lot de la période `periode` : celles dont la (première) période de destination vient au plus tard.
 * Une semaine ventilée jour par jour sur deux périodes part entière avec la première ; ses lignes portent chacune la leur.
 */
export function feuillesDuLot<T extends Pick<FeuilleTemps, 'week'>>(sheets: readonly T[], periode: string, s: Partial<Settings> | undefined, today: ISODate): T[] {
  return sheets.filter(sh => periodeDeLaFeuille(sh.week, s, today) <= periode);
}

// — Fichier d'import —

export const FORMAT_FICHIER_DEFAUT: FormatFichierPaie = { separateur: ';', colonnes: ['matricule', 'periode', 'rubrique', 'quantite'], formatPeriode: 'AAAA-MM', decimale: ',', entete: true };

export const SEPARATEURS: Record<FormatFichierPaie['separateur'], string> = { ';': 'Point-virgule ( ; )', ',': 'Virgule ( , )', tab: 'Tabulation' };
export const FORMATS_PERIODE: Record<FormatFichierPaie['formatPeriode'], string> = { 'AAAA-MM': '2026-10', 'MM/AAAA': '10/2026', AAAAMM: '202610', MMAAAA: '102026' };
export const DECIMALES: Record<FormatFichierPaie['decimale'], string> = { ',': 'Virgule (7,5)', '.': 'Point (7.5)' };
export const COLONNES_FICHIER: Record<ColonneFichierPaie, string> = { matricule: 'Matricule de paie', periode: 'Période', rubrique: 'Code rubrique Sage', quantite: 'Quantité' };
/** Nom des colonnes dans la ligne d'en-tête : sans accent, lisible par tout outil d'import. */
const ENTETE: Record<ColonneFichierPaie, string> = { matricule: 'matricule', periode: 'periode', rubrique: 'rubrique', quantite: 'quantite' };

const COLONNES = Object.keys(COLONNES_FICHIER) as ColonneFichierPaie[];

/**
 * Format reçu (`paie.formatFichier`) contrôlé : chaque champ absent garde sa valeur ; les quatre colonnes, chacune une
 * fois ; le séparateur décimal différent du séparateur de colonnes. Message d'erreur en français, sinon le format.
 */
export function controlerFormat(p: Record<string, unknown>, actuel: FormatFichierPaie): FormatFichierPaie | string {
  const f: FormatFichierPaie = { ...actuel };
  if (p.separateur !== undefined) {
    if (!Object.hasOwn(SEPARATEURS, String(p.separateur))) return 'Séparateur inconnu : point-virgule, virgule ou tabulation';
    f.separateur = p.separateur as FormatFichierPaie['separateur'];
  }
  if (p.formatPeriode !== undefined) {
    if (!Object.hasOwn(FORMATS_PERIODE, String(p.formatPeriode))) return 'Format de période inconnu';
    f.formatPeriode = p.formatPeriode as FormatFichierPaie['formatPeriode'];
  }
  if (p.decimale !== undefined) {
    if (!Object.hasOwn(DECIMALES, String(p.decimale))) return 'Séparateur décimal inconnu : virgule ou point';
    f.decimale = p.decimale as FormatFichierPaie['decimale'];
  }
  if (p.entete !== undefined) f.entete = !!p.entete;
  if (p.colonnes !== undefined) {
    const c = p.colonnes;
    if (!Array.isArray(c) || c.length !== COLONNES.length || COLONNES.some(x => !c.includes(x))) return 'Ordre des colonnes : matricule, période, rubrique et quantité, chacune une fois';
    f.colonnes = c as ColonneFichierPaie[];
  }
  if (f.separateur === f.decimale) return 'Le séparateur décimal doit différer du séparateur de colonnes';
  return f;
}

/** Période AAAA-MM dans le format du fichier. */
export function periodeFichier(p: string, f: FormatFichierPaie['formatPeriode']): string {
  const [a, m] = p.split('-');
  return f === 'MM/AAAA' ? `${m}/${a}` : f === 'AAAAMM' ? `${a}${m}` : f === 'MMAAAA' ? `${m}${a}` : p;
}

/** Quantités du fichier au centième (quart d'heure : 0,25) ; les totaux du lot, contrôlés dans Sage, de même. */
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface LigneFichier { matricule: string; periode: string; rubrique: string; quantite: number }

/**
 * Lignes du fichier : une par salarié, période et rubrique, quantités additionnées sur la période (rappel d'une période
 * close compris, puisqu'il part sur la période ouverte), triées par matricule, période et rubrique ; quantité nulle omise.
 */
export function lignesFichier(contenu: Pick<SagePush, 'lignes'>): LigneFichier[] {
  const somme = new Map<string, LigneFichier>();
  for (const l of contenu.lignes) {
    for (const [rubrique, q] of Object.entries(l.rubriques)) {
      const periode = l.periode ?? '';
      const cle = `${l.matricule}|${periode}|${rubrique}`;
      const x = somme.get(cle) ?? { matricule: l.matricule, periode, rubrique, quantite: 0 };
      x.quantite = r2(x.quantite + q);
      somme.set(cle, x);
    }
  }
  return [...somme.values()].filter(x => x.quantite !== 0)
    .sort((a, b) => a.matricule.localeCompare(b.matricule) || a.periode.localeCompare(b.periode) || a.rubrique.localeCompare(b.rubrique));
}

/**
 * Texte du fichier d'import : colonnes dans l'ordre réglé, séparateur, période et décimale au format choisi, en-tête
 * facultatif, lignes séparées par CRLF. Contenu fait de matricules, codes et nombres (contrôlés à la saisie) : ni BOM, ni
 * apostrophe devant un tiret, que l'import de Sage lirait.
 */
export function fichierLot(contenu: Pick<SagePush, 'lignes'>, f: FormatFichierPaie = FORMAT_FICHIER_DEFAUT): string {
  const sep = f.separateur === 'tab' ? '\t' : f.separateur;
  const cellule = (s: string) => (s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const valeur = (l: LigneFichier, c: ColonneFichierPaie) => c === 'periode' ? periodeFichier(l.periode, f.formatPeriode)
    : c === 'quantite' ? String(l.quantite).replace('.', f.decimale) : l[c];
  const rows = lignesFichier(contenu).map(l => f.colonnes.map(c => cellule(valeur(l, c))).join(sep));
  return [...(f.entete ? [f.colonnes.map(c => ENTETE[c]).join(sep)] : []), ...rows].join('\r\n') + '\r\n';
}

/** « sage-paie-2026-10-lot-12.csv » (`.txt` avec la tabulation). */
export const nomFichierLot = (l: Pick<LotPaie, 'id' | 'periode'>, f: FormatFichierPaie = FORMAT_FICHIER_DEFAUT) =>
  `sage-paie-${l.periode}-lot-${l.id}.${f.separateur === 'tab' ? 'txt' : 'csv'}`;

/** Totaux d'un contenu : lignes du fichier, salariés (matricules), quantité par code Sage. */
export function resumeContenu(contenu: Pick<SagePush, 'lignes'>): LotPaie['resume'] {
  const lignes = lignesFichier(contenu), rubriques: Record<string, number> = {};
  for (const l of lignes) rubriques[l.rubrique] = r2((rubriques[l.rubrique] ?? 0) + l.quantite);
  return { lignes: lignes.length, salaries: new Set(lignes.map(l => l.matricule)).size, rubriques };
}

/** « HN 1 225 · HS25 12,5 » : totaux d'un lot. */
export const totauxTexte = (r: LotPaie['resume']) =>
  Object.entries(r.rubriques).map(([k, v]) => `${k} ${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`).join(' · ');

/** Référence de l'import dans Sage (accusé facultatif) : 1 à 40 lettres, chiffres, tiret, point, barre ou soulignement. */
export function erreurReference(v: string): string | null {
  const t = v.trim();
  return !t || /^[A-Za-z0-9_./-]{1,40}$/.test(t) ? null : 'Référence : 40 caractères au plus, lettres, chiffres, tiret, point, barre oblique ou soulignement.';
}
