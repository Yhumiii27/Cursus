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
  /**
   * Obligation légale qui impose de garder ces données jusqu'à leur échéance, même quand le salarié sorti exerce son droit
   * à l'effacement (art. 17-3-b du RGPD) ; absente : effaçable dès sa demande.
   */
  obligation?: string;
  /**
   * lot 11 — notes de frais : catégorie gardée au-delà du dossier : l'anonymisation du dossier n'efface pas ses données
   * encore dans leur durée (notes payées et justificatifs, terme comptable), elle les laisse sans nom.
   */
  auDelaDuDossier?: true;
}

/** Catégories, dans l'ordre de l'écran ; le dossier (fiche et identité) clôt tout. */
export const CATEGORIES_CONSERVATION: Record<CategorieConservation, DefCategorie> = {
  dossier: {
    label: 'Dossier du salarié (fiche et identité)', reglage: 'conservationDossierAns', partielle: false,
    obligation: 'registre unique du personnel, 5 ans après le départ (art. R1221-26) ; prescription des salaires (art. L3245-1)',
    effacement: 'identité remplacée par « Salarié anonymisé n° … » (nom, adresse e-mail, date de naissance complète, matricule de paie, contact d’urgence retirés), compte de connexion fermé, demandes et notifications supprimées, pièces effacées, nom retiré du journal ; heures par projet, absences, coûts de formation et lots de paie gardés sans nom',
  },
  temps: {
    label: 'Temps de travail et absences', reglage: 'conservationTempsAns', partielle: true,
    obligation: 'preuve des heures de travail, prescription des salaires (art. L3171-4 et L3245-1)',
    effacement: 'commentaires et motifs saisis sur les feuilles, les absences, les reports et les clôtures ; justificatifs d’absence',
  },
  paie: {
    label: 'Éléments de paie et soldes de sortie', reglage: 'conservationPaieAns', partielle: false,
    obligation: 'double des bulletins de paie (art. L3243-4)',
    effacement: 'rien avant l’anonymisation du dossier : les lots transmis et le solde de sortie restent, sans nom',
  },
  sante: {
    label: 'Santé au travail et vaccinations', reglage: 'conservationSanteAns', partielle: true,
    obligation: 'preuve du suivi de l’état de santé et des expositions (art. L4624-1 et suivants)',
    effacement: 'visites, avis et restrictions, suivi médical, demandes de visite, vaccinations et leurs déclarations',
  },
  passeport: {
    label: 'Passeport et visas', reglage: 'conservationPasseportAns', partielle: true,
    effacement: 'passeport, visas, déclarations et copies de ces documents',
  },
  titreSejour: {
    label: 'Titre de séjour (registre unique du personnel)', reglage: 'conservationTitreSejourAns', partielle: true,
    obligation: 'registre unique du personnel, 5 ans après le départ (art. R1221-26 et D1221-24)',
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
  // lot 11 — notes de frais (server/src/conservation.ts) : durée comptée depuis la sortie, et chaque note payée gardée au
  // moins la durée réglée depuis son paiement ; l'anonymisation du dossier ne les touche pas avant ce terme.
  frais: {
    label: 'Notes de frais et justificatifs', reglage: 'conservationFraisAns', partielle: true, auDelaDuDossier: true,
    obligation: 'pièces justificatives comptables, 10 ans (art. L123-22 du Code de commerce) ; 6 ans en matière fiscale (art. L102 B du LPF)',
    effacement: 'notes de frais, lignes, avances, véhicules déclarés et justificatifs joints, une fois leur terme comptable passé (paiement + durée réglée) ; les notes non payées aussitôt',
  },
};
export const CATEGORIES = Object.keys(CATEGORIES_CONSERVATION) as CategorieConservation[];
export const estCategorie = (v: unknown): v is CategorieConservation => typeof v === 'string' && Object.hasOwn(CATEGORIES_CONSERVATION, v);

/** Durée en années au plus d'une catégorie (contrôle du réglage). */
export const DUREE_MAX_ANS = 10;
/**
 * Durée minimale du dossier : les mentions du registre unique du personnel (identité, titre de séjour) se gardent 5 ans
 * après le départ (art. R1221-26), au-delà de la prescription des salaires (3 ans, art. L3245-1) et de l'archive paie du
 * journal (3 ans, shared/journal.ts). L'anonymisation retire aussi le nom du journal (server/src/conservation.ts).
 */
export const DOSSIER_MIN_ANS = 5;
// lot 11 — notes de frais : durée minimale des notes payées et de leurs justificatifs (art. L123-22 du Code de commerce).
export const FRAIS_MIN_ANS = 10;

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
 * Catégories échues d'un salarié sorti dont le dossier n'est pas anonymisé (anonymisé : seules les catégories gardées au-delà
 * du dossier, quand des données y ont passé leur terme) ; `aDesDonnees` écarte une catégorie partielle
 * sans rien à effacer (salarié sans passeport, catégorie déjà effacée : une donnée saisie après un effacement la fait
 * reproposer). Le dossier échu emporte toutes les catégories. null : rien à proposer (salarié présent, dossier déjà
 * anonymisé, rien d'échu).
 */
export function categoriesEchues(
  e: Pick<Employe, 'fin'> & { anonymiseLe?: ISODate | null }, s: Settings, ti: ISODate,
  aDesDonnees: (c: CategorieConservation) => boolean = () => true,
): { categories: CategorieConservation[]; dossier: boolean } | null {
  return selection(e, s, ti, aDesDonnees, false)?.r ?? null;
}

/**
 * Droit à l'effacement exercé par un salarié sorti avant l'échéance (art. 17 du RGPD) : seules les catégories sans
 * obligation légale en cours sont effacées (passeport et visas, entretiens, formations), ainsi que celles déjà échues ;
 * l'identité (registre unique du personnel), le titre de séjour, la santé et le temps restent jusqu'à leur échéance
 * (art. 17-3-b), listés dans `gardees` avec leur date. Le dossier échu s'anonymise en entier.
 */
export function categoriesDroitEffacement(
  e: Pick<Employe, 'fin'> & { anonymiseLe?: ISODate | null }, s: Settings, ti: ISODate,
  aDesDonnees: (c: CategorieConservation) => boolean = () => true,
): { categories: CategorieConservation[]; dossier: boolean; gardees: { categorie: CategorieConservation; jusquAu: ISODate }[] } | null {
  const x = selection(e, s, ti, aDesDonnees, true);
  return x ? { ...(x.r ?? { categories: [], dossier: false }), gardees: x.gardees } : null;
}

function selection(e: Pick<Employe, 'fin'> & { anonymiseLe?: ISODate | null }, s: Settings, ti: ISODate, aDesDonnees: (c: CategorieConservation) => boolean, demande: boolean) {
  // lot 11 — notes de frais : un dossier anonymisé garde les catégories gardées au-delà du dossier (notes payées encore
  // dans leur terme comptable) ; elles sont reproposées dès que des données y passent leur terme (`aDesDonnees` ne compte
  // que celles-là), sinon rien ne les effacerait jamais.
  if (e.anonymiseLe && !demande) {
    const reste = CATEGORIES.filter(c => CATEGORIES_CONSERVATION[c].auDelaDuDossier && aDesDonnees(c));
    return { r: reste.length ? { categories: reste, dossier: false } : null, gardees: [] };
  }
  if (!e.fin || e.anonymiseLe || !sorti(e, ti)) return null;
  const durees = dureesConservation(s);
  const echeance = (c: CategorieConservation) => echeanceConservation(e.fin!, durees[c]);
  const echue = (c: CategorieConservation) => echeance(c) <= ti || (demande && !CATEGORIES_CONSERVATION[c].obligation);
  const dossier = echeance('dossier') <= ti;
  const partielles = CATEGORIES.filter(c => c !== 'dossier' && CATEGORIES_CONSERVATION[c].partielle);
  const categories = partielles.filter(c => (dossier || echue(c)) && aDesDonnees(c));
  const gardees = dossier ? [] : (['dossier', ...partielles] as CategorieConservation[])
    .filter(c => !echue(c) && (c === 'dossier' || aDesDonnees(c))).map(c => ({ categorie: c, jusquAu: echeance(c) }));
  const r = !dossier && !categories.length ? null : { categories: dossier ? ['dossier' as const, ...categories] : categories, dossier };
  return { r, gardees };
}

/** Catégories nommées dans un message : « passeport et visas, entretiens professionnels ». */
export const categoriesTexte = (l: readonly CategorieConservation[]) => l.map(c => CATEGORIES_CONSERVATION[c].label.toLowerCase()).join(', ');
