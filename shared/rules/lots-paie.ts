// Lots de paie : feuilles validées d'une période de paie réunies en un lot au contenu figé, fichier d'import pour Sage
// tiré de ce contenu (format réglé par la paie : colonnes facultatives, encodage UTF-8 ou Windows-1252), cycle du lot (généré → transmis à la confirmation de l'import, ou
// annulé avant elle). Partagé par les actions (server/src/actions/paie.ts), le téléchargement
// (server/src/fichier-paie.ts) et l'écran Temps (client/src/components/LotsPaie.tsx).
// Périmètre du fichier : heures validées du lundi au vendredi seulement ; absences, déplacements, samedi, dimanche et
// nuit restent saisis dans Sage (PERIMETRE_FICHIER, repris par l'écran, la confirmation et la procédure).
import { encoderTexte } from '../encodage.ts';
import type { ColonneFichierPaie, FeuilleTemps, FormatFichierPaie, ISODate, LotPaie, SagePush, Settings, StatutLotPaie } from '../types.ts';
import { periodesSemaine, type RubriqueVue } from './paie.ts';

/** Ce que le fichier contient, et ce qu'il ne contient pas (écran, confirmation, docs/DEPLOIEMENT.md). */
export const PERIMETRE_FICHIER = 'Heures validées du lundi au vendredi seulement : absences, déplacements et heures du samedi, du dimanche ou de nuit restent saisis dans Sage.';

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

export const FORMAT_FICHIER_DEFAUT: FormatFichierPaie = {
  separateur: ';', colonnes: ['matricule', 'periode', 'rubrique', 'quantite'], formatPeriode: 'AAAA-MM', decimale: ',', entete: true,
  encodage: 'utf-8', formatDate: 'JJ/MM/AAAA',
};

export const SEPARATEURS: Record<FormatFichierPaie['separateur'], string> = { ';': 'Point-virgule ( ; )', ',': 'Virgule ( , )', tab: 'Tabulation' };
export const FORMATS_PERIODE: Record<FormatFichierPaie['formatPeriode'], string> = { 'AAAA-MM': '2026-10', 'MM/AAAA': '10/2026', AAAAMM: '202610', MMAAAA: '102026' };
export const DECIMALES: Record<FormatFichierPaie['decimale'], string> = { ',': 'Virgule (7,5)', '.': 'Point (7.5)' };
export const ENCODAGES: Record<FormatFichierPaie['encodage'], string> = { 'utf-8': 'UTF-8 (sans BOM)', 'windows-1252': 'Windows-1252 (ANSI)' };
export const FORMATS_DATE: Record<FormatFichierPaie['formatDate'], string> = { 'JJ/MM/AAAA': '01/10/2026', 'AAAA-MM-JJ': '2026-10-01', JJMMAAAA: '01102026' };
export const COLONNES_FICHIER: Record<ColonneFichierPaie, string> = {
  matricule: 'Matricule de paie', periode: 'Période', rubrique: 'Code rubrique Sage', quantite: 'Quantité',
  dossier: 'Code dossier', libelle: 'Libellé de la rubrique', debut: 'Début de période', fin: 'Fin de période',
};
/** Colonnes toujours présentes, chacune une fois ; les autres sont facultatives, absentes par défaut. */
export const COLONNES_OBLIGATOIRES: readonly ColonneFichierPaie[] = ['matricule', 'periode', 'rubrique', 'quantite'];
export const COLONNES_FACULTATIVES = (Object.keys(COLONNES_FICHIER) as ColonneFichierPaie[]).filter(c => !COLONNES_OBLIGATOIRES.includes(c));
/** Nom des colonnes dans la ligne d'en-tête : sans accent, lisible par tout outil d'import. */
const ENTETE: Record<ColonneFichierPaie, string> = {
  matricule: 'matricule', periode: 'periode', rubrique: 'rubrique', quantite: 'quantite', dossier: 'dossier', libelle: 'libelle', debut: 'debut', fin: 'fin',
};

/**
 * Choix parmi les clés d'une table (séparateur, période, colonne…) : la valeur reçue, ou null si elle n'en est pas une.
 * Seule une chaîne est admise : un tableau comme ['dossier'] vaut « dossier » une fois converti et passerait sinon.
 */
const choix = <K extends string>(table: Record<K, string>, v: unknown): K | null => (typeof v === 'string' && Object.hasOwn(table, v) ? v as K : null);

/**
 * Format reçu (`paie.formatFichier`) contrôlé : chaque champ absent garde sa valeur ; les quatre colonnes obligatoires,
 * chacune une fois, les facultatives une fois au plus ; le séparateur décimal différent du séparateur de colonnes.
 * Message d'erreur en français, sinon le format.
 */
export function controlerFormat(p: Record<string, unknown>, actuel: FormatFichierPaie): FormatFichierPaie | string {
  const f: FormatFichierPaie = { ...FORMAT_FICHIER_DEFAUT, ...actuel };
  const champs: [keyof FormatFichierPaie, Record<string, string>, string][] = [
    ['separateur', SEPARATEURS, 'Séparateur inconnu : point-virgule, virgule ou tabulation'],
    ['formatPeriode', FORMATS_PERIODE, 'Format de période inconnu'],
    ['decimale', DECIMALES, 'Séparateur décimal inconnu : virgule ou point'],
    ['encodage', ENCODAGES, 'Encodage inconnu : UTF-8 ou Windows-1252'],
    ['formatDate', FORMATS_DATE, 'Format de date inconnu'],
  ];
  for (const [k, table, erreur] of champs) {
    if (p[k] === undefined) continue;
    const v = choix(table, p[k]);
    if (v === null) return erreur;
    Object.assign(f, { [k]: v });
  }
  if (p.entete !== undefined) f.entete = !!p.entete;
  if (p.colonnes !== undefined) {
    const c = p.colonnes;
    if (!Array.isArray(c) || c.some(x => choix(COLONNES_FICHIER, x) === null) || new Set(c).size !== c.length || COLONNES_OBLIGATOIRES.some(x => !c.includes(x))) {
      return 'Colonnes : matricule, période, rubrique et quantité, chacune une fois ; une colonne facultative une fois au plus';
    }
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

/** Date AAAA-MM-JJ dans le format du fichier. */
export function dateFichier(iso: ISODate, f: FormatFichierPaie['formatDate']): string {
  const [a, m, j] = iso.split('-');
  return f === 'JJ/MM/AAAA' ? `${j}/${m}/${a}` : f === 'JJMMAAAA' ? `${j}${m}${a}` : iso;
}

/** Premier et dernier jour d'une période de paie AAAA-MM (mois civil). */
export function bornesPeriode(p: string): { debut: ISODate; fin: ISODate } {
  const [a, m] = p.split('-').map(Number);
  const jours = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { debut: `${p}-01`, fin: `${p}-${String(jours).padStart(2, '0')}` };
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
 * Libellé de chaque code Sage employé par un contenu : libellés des rubriques internes actives portées sur ce code
 * (« + » entre deux rubriques additionnées), à défaut le code lui-même. Figé dans le contenu à la génération du lot.
 */
export function libellesSage(contenu: Pick<SagePush, 'lignes'>, table: readonly Pick<RubriqueVue, 'codeSage' | 'active' | 'label'>[]): Record<string, string> {
  const codes = [...new Set(contenu.lignes.flatMap(l => Object.keys(l.rubriques)))].sort();
  return Object.fromEntries(codes.map(c => [c, table.filter(r => r.active && r.codeSage === c).map(r => r.label).join(' + ') || c]));
}

/**
 * Texte du fichier d'import : colonnes dans l'ordre réglé (facultatives comprises : dossier du contenu, libellé figé,
 * bornes de la période), séparateur, période, dates et décimale au format choisi, en-tête facultatif, lignes séparées par
 * CRLF. Ni BOM, ni apostrophe devant un tiret, que l'import de Sage lirait. `libelles` : ceux figés dans le contenu, ou
 * ceux de la table en vigueur pour un lot d'avant cette colonne. L'encodage s'applique ensuite (octetsFichierLot).
 */
export function fichierLot(
  contenu: Pick<SagePush, 'lignes'> & Partial<Pick<SagePush, 'dossier' | 'libelles'>>, f: FormatFichierPaie = FORMAT_FICHIER_DEFAUT, libelles = contenu.libelles ?? {},
): string {
  const sep = f.separateur === 'tab' ? '\t' : f.separateur;
  const cellule = (s: string) => (s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const valeur = (l: LigneFichier, c: ColonneFichierPaie): string => {
    switch (c) {
      case 'periode': return periodeFichier(l.periode, f.formatPeriode);
      case 'quantite': return String(l.quantite).replace('.', f.decimale);
      case 'dossier': return contenu.dossier ?? '';
      case 'libelle': return libelles[l.rubrique] ?? l.rubrique;
      case 'debut': case 'fin': return l.periode ? dateFichier(bornesPeriode(l.periode)[c], f.formatDate ?? 'JJ/MM/AAAA') : '';
      default: return l[c];
    }
  };
  const rows = lignesFichier(contenu).map(l => f.colonnes.map(c => cellule(valeur(l, c))).join(sep));
  return [...(f.entete ? [f.colonnes.map(c => ENTETE[c]).join(sep)] : []), ...rows].join('\r\n') + '\r\n';
}

/** Octets du fichier d'import, dans l'encodage réglé : UTF-8 sans BOM par défaut, ou Windows-1252. */
export const octetsFichierLot = (texte: string, f: Partial<Pick<FormatFichierPaie, 'encodage'>> = FORMAT_FICHIER_DEFAUT) => encoderTexte(texte, f.encodage ?? 'utf-8');

/** Type du fichier téléchargé, avec son jeu de caractères. */
export const typeFichierLot = (f: Partial<Pick<FormatFichierPaie, 'encodage'>> = FORMAT_FICHIER_DEFAUT) => `text/csv; charset=${f.encodage ?? 'utf-8'}`;

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
