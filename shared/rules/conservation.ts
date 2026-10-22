// Conservation des dossiers des salariés sortis (t016) : durée de chaque catégorie de données, en années après la sortie,
// et dossiers dont une durée est échue. Décision de l'entreprise : « Cursus propose, le RH confirme » ; réponse du
// 18 octobre 2026 : durées préremplies (dossier 5 ans, temps 3 ans, paie 5 ans, titre de séjour 5 ans, santé 5 ans,
// passeport et visas effacés à la sortie) mais inactives tant que la référence de la décision du DPO n'est pas saisie.
// Aucune purge automatique : la tâche planifiée (server/src/conservation.ts) ne fait que signaler les dossiers échus,
// l'administrateur RH confirme chaque effacement (un par un ou par lot, avec un motif : `employe.anonymiser`).
import { addD, addM } from '../dates.ts';
import type { CategorieConservation, Employe, ISODate, Settings } from '../types.ts';
import { sorti } from './contrats.ts';

/** Définition d'une catégorie : libellé, réglage de sa durée, ce qui est effacé à son échéance. */
export interface DefCategorie {
  label: string;
  reglage: keyof Settings & `conservation${string}Ans`;
  /** Ce que Cursus efface à l'échéance (texte de l'écran et du dialogue de confirmation). */
  effacement: string;
  /**
   * Effacement propre à la catégorie, avant l'anonymisation du dossier ; faux : ses données sont gardées jusqu'à
   * l'anonymisation du dossier, sans nom (éléments de paie déjà transmis).
   */
  partielle: boolean;
}

/** Catégories, dans l'ordre de l'écran ; le dossier (fiche et identité) clôt tout. */
export const CATEGORIES_CONSERVATION: Record<CategorieConservation, DefCategorie> = {
  dossier: {
    label: 'Dossier du salarié (fiche et identité)', reglage: 'conservationDossierAns', partielle: false,
    effacement: 'identité remplacée par « Salarié anonymisé n° … » (nom, adresse e-mail, date de naissance complète, matricule de paie, contact d’urgence retirés), compte de connexion fermé, demandes et notifications supprimées, pièces effacées, nom retiré du journal ; heures par projet, absences, coûts de formation et lots de paie gardés sans nom',
  },
  temps: {
    label: 'Temps de travail et absences', reglage: 'conservationTempsAns', partielle: true,
    effacement: 'commentaires et motifs saisis sur les feuilles, les absences, les reports et les clôtures ; justificatifs d’absence',
  },
  paie: {
    label: 'Éléments de paie et soldes de sortie', reglage: 'conservationPaieAns', partielle: false,
    effacement: 'rien avant l’anonymisation du dossier : les lots transmis et le solde de sortie restent, sans nom',
  },
  sante: {
    label: 'Santé au travail et vaccinations', reglage: 'conservationSanteAns', partielle: true,
    effacement: 'visites, avis et restrictions, suivi médical, demandes de visite, vaccinations et leurs déclarations',
  },
  passeport: {
    label: 'Passeport et visas', reglage: 'conservationPasseportAns', partielle: true,
    effacement: 'passeport, visas, déclarations et copies de ces documents',
  },
  titreSejour: {
    label: 'Titre de séjour (registre unique du personnel)', reglage: 'conservationTitreSejourAns', partielle: true,
    effacement: 'type, numéro, expiration et vérifications du titre de séjour',
  },
  entretiens: {
    label: 'Entretiens professionnels', reglage: 'conservationEntretiensAns', partielle: true,
    effacement: 'entretiens et leurs comptes rendus',
  },
  formations: {
    label: 'Formations et habilitations', reglage: 'conservationFormationsAns', partielle: true,
    effacement: 'motifs des corrections et des mesures, demandes de formation et d’habilitation, attestations et titres joints ; certifications et coûts gardés',
  },
};
export const CATEGORIES = Object.keys(CATEGORIES_CONSERVATION) as CategorieConservation[];
export const estCategorie = (v: unknown): v is CategorieConservation => typeof v === 'string' && Object.hasOwn(CATEGORIES_CONSERVATION, v);

/** Durée en années au plus d'une catégorie (contrôle du réglage). */
export const DUREE_MAX_ANS = 10;
/**
 * Durée minimale du dossier : le journal garde 3 ans les actions liées à la paie (shared/journal.ts) et la prescription
 * des salaires court 3 ans (art. L3245-1). L'anonymisation retire aussi le nom du journal (server/src/conservation.ts).
 */
export const DOSSIER_MIN_ANS = 3;

/** Nom donné à la fiche anonymisée (aucune autre donnée d'identité ne reste). */
export const nomAnonyme = (id: number) => `Salarié anonymisé n° ${id}`;

/** Les propositions ne sont faites que la fonction activée et la référence de la décision du DPO saisie. */
export const conservationActive = (s: Pick<Settings, 'conservationActive' | 'conservationDecisionDpo'>) => s.conservationActive && !!s.conservationDecisionDpo.trim();

/** Durée de chaque catégorie, en années (réglages). */
export const dureesConservation = (s: Settings): Record<CategorieConservation, number> =>
  Object.fromEntries(CATEGORIES.map(c => [c, Number(s[CATEGORIES_CONSERVATION[c].reglage]) || 0])) as Record<CategorieConservation, number>;

/**
 * Premier jour où une catégorie est échue : le lendemain du dernier jour du contrat augmenté de la durée (0 an : dès le
 * lendemain de la sortie). « Date de sortie + durée < aujourd'hui ».
 */
export const echeanceConservation = (fin: ISODate, ans: number): ISODate => addD(addM(fin, 12 * ans), 1);

/**
 * Catégories échues d'un salarié sorti, pas encore effacées (`effacees`), ni son dossier anonymisé ; `aDesDonnees` écarte
 * une catégorie partielle sans rien à effacer (salarié sans passeport…). Le dossier échu emporte toutes les catégories.
 * null : rien à proposer (salarié présent, dossier déjà anonymisé, rien d'échu).
 */
export function categoriesEchues(
  e: Pick<Employe, 'fin'> & { anonymiseLe?: ISODate | null }, s: Settings, ti: ISODate,
  effacees: ReadonlySet<CategorieConservation> = new Set(), aDesDonnees: (c: CategorieConservation) => boolean = () => true,
): { categories: CategorieConservation[]; dossier: boolean } | null {
  if (!e.fin || e.anonymiseLe || !sorti(e, ti)) return null;
  const durees = dureesConservation(s);
  const echue = (c: CategorieConservation) => echeanceConservation(e.fin!, durees[c]) <= ti;
  const dossier = echue('dossier');
  const categories = CATEGORIES.filter(c => c !== 'dossier' && CATEGORIES_CONSERVATION[c].partielle && !effacees.has(c) && (dossier || echue(c)) && aDesDonnees(c));
  if (!dossier && !categories.length) return null;
  return { categories: dossier ? ['dossier', ...categories] : categories, dossier };
}

/** Catégories nommées dans un message : « passeport et visas, entretiens professionnels ». */
export const categoriesTexte = (l: readonly CategorieConservation[]) => l.map(c => CATEGORIES_CONSERVATION[c].label.toLowerCase()).join(', ');
