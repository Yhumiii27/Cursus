// Dossiers de prise en charge OPCO (lot 11, chantier C4, t189) : règles partagées par le serveur (server/src/actions/opco.ts,
// server/src/relances.ts, server/src/dataset.ts) et l'écran Plan & budget. Version allégée retenue par l'entreprise le
// 31 octobre 2026 (« quelques dossiers par an ») : dossier rattaché à une action du plan, états, montants, pièces et
// échéances ; ni export comptable des versements, ni aide au montage, ni dossiers d'alternance (colonne `empId` réservée).
// - États : à déposer → déposé → accordé ou refusé → justificatifs envoyés (« facturé ») → remboursé (au moins un
//   versement) → soldé ; abandonné (motif codé) avant le solde ; retour d'un cran par l'administrateur RH (`statutPrecedent`).
//   Chaque transition reçoit l'état affiché (`de`) : un double clic ne la refait pas (`controleTransition`). Un acompte
//   reçu après l'accord fait passer à « remboursé » sans dispenser des justificatifs : leur envoi s'enregistre encore
//   (`controleFacturation`) et le solde les exige (`controleSolde`).
// - Montants calculés, jamais stockés (`montantsOpco`) : à récupérer = accordé (ou facturé s'il est plus bas) moins les
//   sommes reçues par l'entreprise ; en subrogation, rien n'est à récupérer, le paiement de l'organisme est suivi ; reste à
//   charge = coût de l'action moins la prise en charge. Comptés sur l'exercice de l'action du plan (choix par défaut).
// - Un exercice clos ne bloque pas un dossier : les remboursements arrivent après la clôture.
// - Échéances (`echeanceOpco`) : dépôt avant le début, accord attendu 7 jours avant, justificatifs après la fin,
//   remboursement après l'envoi des justificatifs ; délais réglables (30, 90 et 60 jours, à confirmer avec le service RH).
// Les conditions d'OPCO 2i (délais, pièces, Pro-A de la chimie) n'ont pas été vérifiées : tout ce qui en dépend est réglable
// ou seulement signalé, jamais bloquant, sauf les pièces de la demande de remboursement quand les pièces sont activées.
import { addD, days, isValidDate, parse } from '../dates.ts';
import type {
  CodeOpco, DispositifOpco, DossierOpco, EcartSoldeOpco, ISODate, MotifAbandonOpco, MotifRefusOpco, NaturePiece, PlanAction, Session, Settings, StatutOpco,
  VersementOpco,
} from '../types.ts';
import { coutRetenu } from './exercices.ts';
import { palierDe, type Relance } from './relances.ts';

// — Listes fermées —

/** Opérateurs de compétences agréés ; OPCO 2i couvre les industries chimiques (IDCC 0044). */
export const OPCOS: Record<CodeOpco, string> = {
  opco2i: 'OPCO 2i', atlas: 'Atlas', akto: 'Akto', afdas: 'Afdas', constructys: 'Constructys', ocapiat: 'Ocapiat', opcoep: 'OPCO EP',
  mobilites: 'OPCO Mobilités', sante: 'OPCO Santé', uniformation: 'Uniformation', commerce: 'L’Opcommerce',
};
export const CODES_OPCO = Object.keys(OPCOS) as CodeOpco[];

/** Dispositifs : libellé, et frais annexes ou rémunération demandables en plus des coûts pédagogiques. */
export const DISPOSITIFS_OPCO: Record<DispositifOpco, { label: string; annexes: boolean }> = {
  plan: { label: 'Plan de développement des compétences', annexes: false },
  pro_a: { label: 'Pro-A (reconversion ou promotion par alternance)', annexes: true },
  contrat_pro: { label: 'Contrat de professionnalisation', annexes: true },
  apprentissage: { label: 'Contrat d’apprentissage', annexes: true },
  tutorat: { label: 'Fonction tutorale', annexes: false },
  versement_volontaire: { label: 'Versements volontaires de l’entreprise', annexes: true },
  autre: { label: 'Autre financement par l’OPCO', annexes: true },
};
export const LISTE_DISPOSITIFS = Object.keys(DISPOSITIFS_OPCO) as DispositifOpco[];

/**
 * États : libellé ; `enCours` : le dossier attend encore quelque chose (échéances, relances) ; `actif` : il compte pour la
 * ligne du plan qui le porte (sa suppression est refusée, il suit son report) — tout sauf refusé et abandonné.
 */
export const STATUTS_OPCO: Record<StatutOpco, { label: string; enCours: boolean; actif: boolean }> = {
  a_deposer: { label: 'À déposer', enCours: true, actif: true },
  depose: { label: 'Déposé', enCours: true, actif: true },
  accorde: { label: 'Accordé', enCours: true, actif: true },
  refuse: { label: 'Refusé', enCours: false, actif: false },
  facture: { label: 'Justificatifs envoyés', enCours: true, actif: true },
  rembourse: { label: 'Remboursé', enCours: true, actif: true },
  solde: { label: 'Soldé', enCours: false, actif: true },
  abandonne: { label: 'Abandonné', enCours: false, actif: false },
};
export const estStatutOpco = (s: unknown): s is StatutOpco => typeof s === 'string' && Object.hasOwn(STATUTS_OPCO, s);

export const MOTIFS_REFUS_OPCO: Record<MotifRefusOpco, string> = {
  hors_criteres: 'Hors des critères de prise en charge', delai_depasse: 'Délai de dépôt dépassé', budget_epuise: 'Budget de l’OPCO épuisé',
  organisme_non_certifie: 'Organisme non certifié Qualiopi', autre: 'Autre motif',
};
export const MOTIFS_ABANDON_OPCO: Record<MotifAbandonOpco, string> = {
  formation_annulee: 'Formation annulée ou reportée', non_eligible: 'Action non éligible', hors_delai: 'Hors délai (accord ou justificatifs)',
  renonciation: 'Renonciation de l’entreprise', autre: 'Autre motif',
};
export const ECARTS_SOLDE_OPCO: Record<EcartSoldeOpco, string> = { aucun: 'Aucun écart', perte: 'Perte (accord non perçu)', partiel: 'Prise en charge partielle' };

/** Natures des pièces d'un dossier (`pieces.nature`). */
export const NATURES_PIECE_OPCO: Record<NaturePiece, string> = {
  demande: 'Demande de prise en charge déposée', accord: 'Accord de l’OPCO', convention: 'Convention ou contrat de formation', programme: 'Programme',
  convocation: 'Convocation', emargement: 'Feuilles d’émargement', certificat_realisation: 'Certificat de réalisation ou attestation d’assiduité',
  facture: 'Facture', avis_paiement: 'Avis de paiement', autre: 'Autre pièce',
};
export const estNaturePiece = (n: unknown): n is NaturePiece => typeof n === 'string' && Object.hasOwn(NATURES_PIECE_OPCO, n);

const dans = <T extends string>(liste: Record<T, unknown>) => (v: unknown): v is T => typeof v === 'string' && Object.hasOwn(liste, v);
export const estCodeOpco = dans(OPCOS);
export const estDispositifOpco = dans(DISPOSITIFS_OPCO);
export const estMotifRefusOpco = dans(MOTIFS_REFUS_OPCO);
export const estMotifAbandonOpco = dans(MOTIFS_ABANDON_OPCO);
export const estEcartSoldeOpco = dans(ECARTS_SOLDE_OPCO);

// — Saisie —

/** Montant d'un dossier au plus (même borne que le coût réel d'une action, shared/rules/exercices.ts). */
export const MONTANT_OPCO_MAX = 1_000_000;
export const HEURES_OPCO_MAX = 10_000;
export const EFFECTIF_OPCO_MAX = 10_000;
/** Accord attendu au plus tard ce nombre de jours avant le début de la formation (échéance « accord »). */
export const DELAI_ACCORD_JOURS = 7;
/** Conservation des factures et des accords (art. L123-22 du Code de commerce) : 10 ans après la fin de l'exercice. */
export const CONSERVATION_PIECE_OPCO_ANS = 10;

/** Montant en euros (virgule admise), 0 ou plus, arrondi au centime ; null si la saisie ne convient pas. */
export function montantOpco(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.').replace(/\s/g, '')) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= MONTANT_OPCO_MAX ? Math.round(n * 100) / 100 : null;
}

/** Nombre borné (heures : décimal ; effectif : entier), 0 ou plus ; null si la saisie ne convient pas. */
function nombre(v: unknown, max: number, entier: boolean): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max && (!entier || Number.isInteger(n)) ? (entier ? n : Math.round(n * 100) / 100) : null;
}
export const heuresOpco = (v: unknown) => nombre(v, HEURES_OPCO_MAX, false);
export const effectifOpco = (v: unknown) => nombre(v, EFFECTIF_OPCO_MAX, true);

/**
 * Référence administrative (numéro de dossier de l'OPCO, référence d'un accord ou d'un virement) : un code sans espace,
 * 40 caractères au plus. Jamais un texte libre : elle est recopiée au journal.
 */
export const REFERENCE_OPCO = /^[A-Za-z0-9][A-Za-z0-9./_-]{0,39}$/;
export const referenceValide = (v: string) => REFERENCE_OPCO.test(v);

/** SIRET : 14 chiffres, clé de Luhn (établissements de La Poste, SIREN 356 000 000 : somme des chiffres multiple de 5). */
export function siretValide(v: string): boolean {
  if (!/^\d{14}$/.test(v)) return false;
  if (v.startsWith('356000000')) return [...v].reduce((n, c) => n + Number(c), 0) % 5 === 0;
  let somme = 0;
  for (let i = 0; i < 14; i++) {
    let c = Number(v[13 - i]) * (i % 2 ? 2 : 1);
    if (c > 9) c -= 9;
    somme += c;
  }
  return somme % 10 === 0;
}

/** Numéro de déclaration d'activité d'un organisme de formation (NDA) : 11 chiffres. */
export const ndaValide = (v: string) => /^\d{11}$/.test(v);

/** Champs saisis d'un dossier, avant contrôle (texte d'un formulaire ou valeurs de l'API). */
export interface SaisieOpco {
  opco: unknown; dispositif: unknown; reference: unknown; du: unknown; au: unknown; heures: unknown; effectif: unknown;
  montantDemande: unknown; montantDemandeAnnexes: unknown; subrogation: unknown; organismeSiret: unknown; organismeNda: unknown; organismeQualiopi: unknown;
}
/** Champs contrôlés, tels qu'enregistrés. */
export type ChampsOpco = Pick<DossierOpco, 'opco' | 'dispositif' | 'reference' | 'du' | 'au' | 'heures' | 'effectif' | 'montantDemande' | 'montantDemandeAnnexes'
  | 'subrogation' | 'organismeSiret' | 'organismeNda' | 'organismeQualiopi'>;

const texteDe = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const vide = (v: unknown) => v === undefined || v === null || texteDe(v) === '';

/**
 * Contrôle de la saisie d'un dossier : erreurs par champ (vide : aucune) et valeurs enregistrées. SIRET et NDA s'écrivent
 * avec ou sans espaces ; les frais annexes ne sont admis que pour un dispositif qui les prévoit.
 */
export function controlerSaisieOpco(v: SaisieOpco): { erreurs: Partial<Record<keyof SaisieOpco, string>>; champs: ChampsOpco } {
  const erreurs: Partial<Record<keyof SaisieOpco, string>> = {};
  const opco = estCodeOpco(v.opco) ? v.opco : null;
  if (!opco) erreurs.opco = 'OPCO à choisir dans la liste';
  const dispositif = estDispositifOpco(v.dispositif) ? v.dispositif : null;
  if (!dispositif) erreurs.dispositif = 'Dispositif à choisir dans la liste';
  const reference = texteDe(v.reference) || null;
  if (reference && !referenceValide(reference)) erreurs.reference = 'Numéro de dossier : lettres, chiffres, « . », « / », « _ » ou « - », sans espace, 40 caractères au plus';
  const date = (x: unknown, champ: 'du' | 'au') => {
    const t = texteDe(x) || null;
    if (t && !isValidDate(t)) erreurs[champ] = 'Date invalide';
    return t && isValidDate(t) ? t : null;
  };
  const du = date(v.du, 'du'), au = date(v.au, 'au');
  if (du && au && au < du) erreurs.au = 'La fin de la formation précède son début';
  const heures = vide(v.heures) ? null : heuresOpco(v.heures);
  if (!vide(v.heures) && heures === null) erreurs.heures = `Heures : nombre de 0 à ${HEURES_OPCO_MAX.toLocaleString('fr-FR')}`;
  const effectif = vide(v.effectif) ? null : effectifOpco(v.effectif);
  if (!vide(v.effectif) && effectif === null) erreurs.effectif = 'Effectif : nombre entier de personnes, 0 ou plus';
  const montant = (x: unknown, champ: 'montantDemande' | 'montantDemandeAnnexes', libelle: string) => {
    const m = vide(x) ? null : montantOpco(x);
    if (!vide(x) && m === null) erreurs[champ] = `${libelle} : montant en euros, 0 ou plus`;
    return m;
  };
  const montantDemande = montant(v.montantDemande, 'montantDemande', 'Montant demandé');
  const montantDemandeAnnexes = montant(v.montantDemandeAnnexes, 'montantDemandeAnnexes', 'Frais annexes ou rémunération');
  if (montantDemandeAnnexes && dispositif && !DISPOSITIFS_OPCO[dispositif].annexes) {
    erreurs.montantDemandeAnnexes = `${DISPOSITIFS_OPCO[dispositif].label} : ni frais annexes ni rémunération demandables`;
  }
  const siret = texteDe(v.organismeSiret).replace(/\s/g, '') || null;
  if (siret && !siretValide(siret)) erreurs.organismeSiret = 'SIRET de l’organisme : 14 chiffres (clé de contrôle incorrecte)';
  const nda = texteDe(v.organismeNda).replace(/\s/g, '') || null;
  if (nda && !ndaValide(nda)) erreurs.organismeNda = 'Numéro de déclaration d’activité : 11 chiffres';
  return {
    erreurs,
    champs: {
      opco: opco ?? 'opco2i', dispositif: dispositif ?? 'plan', reference, du, au, heures, effectif, montantDemande, montantDemandeAnnexes,
      subrogation: v.subrogation === true || v.subrogation === 'true', organismeSiret: siret, organismeNda: nda,
      organismeQualiopi: v.organismeQualiopi === true || v.organismeQualiopi === 'true',
    },
  };
}

// — Transitions —

export type EtapeOpco = 'deposer' | 'accorder' | 'refuser' | 'facturer' | 'solder' | 'abandonner';
/** États de départ et d'arrivée de chaque transition. Le versement (remboursé) et le retour d'un cran sont à part. */
export const TRANSITIONS_OPCO: Record<EtapeOpco, { de: readonly StatutOpco[]; vers: StatutOpco }> = {
  deposer: { de: ['a_deposer'], vers: 'depose' },
  accorder: { de: ['depose'], vers: 'accorde' },
  refuser: { de: ['depose'], vers: 'refuse' },
  // Remboursé par un acompte reçu avant l'envoi des justificatifs : l'envoi reste à faire (`controleFacturation`).
  facturer: { de: ['accorde', 'rembourse'], vers: 'facture' },
  solder: { de: ['facture', 'rembourse'], vers: 'solde' },
  abandonner: { de: ['a_deposer', 'depose', 'accorde', 'facture'], vers: 'abandonne' },
};
/** États où un versement de l'OPCO s'enregistre (un acompte peut suivre l'accord). */
export const STATUTS_VERSEMENT: readonly StatutOpco[] = ['accorde', 'facture', 'rembourse'];

export type Issue = { faire: true } | { deja: string } | { refus: string };

/**
 * Transition demandée sur un dossier dans l'état `statut`, l'écran affichant `de` (facultatif) : à faire ; déjà faite
 * (double clic, autre onglet : rien n'est refait) ; ou refusée, avec le message.
 */
export function controleTransition(etape: EtapeOpco, statut: StatutOpco, de?: unknown): Issue {
  const t = TRANSITIONS_OPCO[etape];
  if (de !== undefined && de !== null && de !== '') {
    if (!estStatutOpco(de)) return { refus: 'État attendu invalide' };
    if (de !== statut) {
      return statut === t.vers ? { deja: `déjà ${STATUTS_OPCO[statut].label.toLowerCase()}` }
        : { refus: `le dossier est maintenant « ${STATUTS_OPCO[statut].label} » — vérifiez-le, puis réessayez` };
    }
  }
  if (!t.de.includes(statut)) return { refus: `impossible depuis l’état « ${STATUTS_OPCO[statut].label} »` };
  return { faire: true };
}

/**
 * Envoi des justificatifs (`opco.facturer`) : depuis l'accord, ou depuis « remboursé » quand un acompte a précédé l'envoi —
 * le dossier reste alors « remboursé », seuls la date et le montant facturé se posent. Déjà envoyés à l'état remboursé :
 * rien n'est refait (double clic), ou refus si l'écran affichait un autre état.
 */
export function controleFacturation(d: Pick<DossierOpco, 'statut' | 'factureLe'>, de?: unknown): Issue {
  if (d.statut === 'rembourse' && d.factureLe) {
    if (de === 'rembourse') return { deja: 'justificatifs déjà envoyés' };
    if (de !== undefined && de !== null && de !== '') return controleTransition('facturer', d.statut, de);
    return { refus: 'justificatifs déjà envoyés' };
  }
  return controleTransition('facturer', d.statut, de);
}

/**
 * Solde (`opco.solder`) : la transition, et les justificatifs envoyés — un dossier remboursé par acompte ne se solde
 * qu'après l'envoi de la facture et du certificat de réalisation (`opco.facturer`, avec leur contrôle).
 */
export function controleSolde(d: Pick<DossierOpco, 'statut' | 'factureLe'>, de?: unknown): Issue {
  const t = controleTransition('solder', d.statut, de);
  if ('faire' in t && !d.factureLe) return { refus: 'justificatifs (facture, certificat de réalisation) à envoyer avant le solde' };
  return t;
}

/**
 * État d'un dossier abandonné avant son abandon, déduit de ce qui est renseigné (versements, justificatifs, accord, dépôt).
 */
export function statutAvantAbandon(d: Pick<DossierOpco, 'deposeLe' | 'accordLe' | 'factureLe'>, versements: number): StatutOpco {
  if (versements) return 'rembourse';
  if (d.factureLe) return 'facture';
  if (d.accordLe) return 'accorde';
  return d.deposeLe ? 'depose' : 'a_deposer';
}

/** Champs effacés quand un dossier quitte un état par un retour d'un cran (`opco.rouvrir`). */
export const CHAMPS_ETAT: Partial<Record<StatutOpco, readonly (keyof DossierOpco)[]>> = {
  depose: ['deposeLe'],
  accorde: ['accordLe', 'montantAccorde', 'accordReference', 'plafondHoraire'],
  refuse: ['refusLe', 'refusMotif'],
  facture: ['factureLe', 'montantFacture'],
  solde: ['soldeLe', 'soldeEcart', 'soldeNature'],
  abandonne: ['abandonLe', 'abandonMotif'],
};

/**
 * Retour d'un cran (administrateur RH) : l'état précédent, ou un refus. Un dossier remboursé revient à l'état d'avant par
 * l'annulation de ses versements, jamais directement.
 */
export function statutPrecedent(d: Pick<DossierOpco, 'statut' | 'deposeLe' | 'accordLe' | 'factureLe'>, versements: number): { vers: StatutOpco } | { refus: string } {
  switch (d.statut) {
    case 'a_deposer': return { refus: 'dossier encore à déposer : rien à rouvrir' };
    case 'depose': return { vers: 'a_deposer' };
    case 'accorde': case 'refuse': return { vers: 'depose' };
    case 'facture': return { vers: 'accorde' };
    case 'rembourse': return { refus: 'dossier remboursé : annulez d’abord le versement saisi par erreur' };
    case 'solde': return { vers: versements ? 'rembourse' : 'facture' };
    case 'abandonne': return { vers: statutAvantAbandon(d, versements) };
  }
}

/** Le dossier compte pour la ligne du plan qui le porte : sa suppression est refusée, il suit son report. */
export const dossierActif = (d: Pick<DossierOpco, 'statut' | 'annuleLe'>) => !d.annuleLe && STATUTS_OPCO[d.statut].actif;

// — Montants —

/** Versements en vigueur d'un dossier (ni annulés, ni d'un autre dossier). */
export const versementsDe = (versements: readonly VersementOpco[] | undefined, dossierId: number) =>
  (versements ?? []).filter(v => v.dossierId === dossierId && !v.annuleLe);

const centimes = (n: number) => Math.round(n * 100) / 100;

export interface MontantsOpco {
  /** Coûts pédagogiques et frais annexes demandés. */
  demande: number;
  /** Montant accordé (0 tant que l'OPCO n'a pas accordé, et pour un refus). */
  accorde: number;
  facture: number | null;
  /** Prise en charge attendue : l'accordé, ou le facturé s'il est plus bas. */
  attendu: number;
  recuEntreprise: number;
  payeOrganisme: number;
  /** Encore à récupérer par l'entreprise (rien en subrogation, ni pour un dossier clos). */
  aRecuperer: number;
  /** En subrogation : encore à payer par l'OPCO à l'organisme. */
  attenduOrganisme: number;
  /** Prise en charge retenue : attendue tant que le dossier court, reçue une fois soldé, refusé ou abandonné. */
  priseEnCharge: number;
}

/** Montants d'un dossier, calculés à partir de ses champs et de ses versements en vigueur ; jamais stockés. */
export function montantsOpco(d: DossierOpco, versements: readonly VersementOpco[] | undefined): MontantsOpco {
  const siens = versementsDe(versements, d.id);
  const recuEntreprise = centimes(siens.filter(v => v.destinataire === 'entreprise').reduce((n, v) => n + v.montant, 0));
  const payeOrganisme = centimes(siens.filter(v => v.destinataire === 'organisme').reduce((n, v) => n + v.montant, 0));
  const accorde = d.accordLe ? d.montantAccorde ?? 0 : 0;
  const attendu = d.montantFacture != null && d.factureLe ? Math.min(accorde, d.montantFacture) : accorde;
  const enCours = STATUTS_VERSEMENT.includes(d.statut);
  const recu = centimes(recuEntreprise + payeOrganisme);
  return {
    demande: centimes((d.montantDemande ?? 0) + (d.montantDemandeAnnexes ?? 0)),
    accorde,
    facture: d.factureLe ? d.montantFacture : null,
    attendu,
    recuEntreprise,
    payeOrganisme,
    aRecuperer: enCours && !d.subrogation ? centimes(Math.max(0, attendu - recuEntreprise)) : 0,
    attenduOrganisme: enCours && d.subrogation ? centimes(Math.max(0, attendu - payeOrganisme)) : 0,
    priseEnCharge: enCours ? Math.max(attendu, recu) : d.statut === 'a_deposer' || d.statut === 'depose' ? 0 : recu,
  };
}

/**
 * Écart figé au solde : accordé moins reçu (entreprise et organisme), et sa qualification proposée — aucun écart, perte
 * (rien reçu), prise en charge partielle.
 */
export function ecartAuSolde(d: DossierOpco, versements: readonly VersementOpco[] | undefined): { ecart: number; nature: EcartSoldeOpco } {
  const m = montantsOpco(d, versements);
  const ecart = centimes(Math.max(0, m.accorde - m.recuEntreprise - m.payeOrganisme));
  return { ecart, nature: ecart <= 0 ? 'aucun' : m.recuEntreprise + m.payeOrganisme > 0 ? 'partiel' : 'perte' };
}

/**
 * Coût de l'action du plan et reste à charge : coût retenu (réel une fois réalisée, sinon prévu) moins la prise en charge
 * de ses dossiers actifs.
 */
export function resteACharge(l: Pick<PlanAction, 'id' | 'statut' | 'cout' | 'coutReel'>, dossiers: readonly DossierOpco[], versements: readonly VersementOpco[] | undefined) {
  const cout = coutRetenu(l);
  const priseEnCharge = centimes(dossiers.filter(d => d.planActionId === l.id && !d.annuleLe).reduce((n, d) => n + montantsOpco(d, versements).priseEnCharge, 0));
  return { cout, priseEnCharge, reste: centimes(cout - priseEnCharge) };
}

// — Échéances et retards —

export type EtapeEcheanceOpco = 'depot' | 'accord' | 'justificatifs' | 'remboursement';
export const ECHEANCES_OPCO: Record<EtapeEcheanceOpco, string> = {
  depot: 'Dossier à déposer avant le début de la formation',
  accord: 'Accord de l’OPCO attendu avant le début de la formation',
  justificatifs: 'Justificatifs à envoyer à l’OPCO après la formation',
  remboursement: 'Remboursement attendu de l’OPCO',
};
export interface EcheanceOpco { dossierId: number; etape: EtapeEcheanceOpco; echeance: ISODate; jours: number; retard: boolean; libelle: string }
/** Délais réglés (Paramètres → Formations, shared/reglages.ts). */
export type DelaisOpco = Pick<Settings, 'opcoDelaiDepot' | 'opcoDelaiJustificatifs' | 'opcoDelaiRemboursement'>;

/**
 * Prochaine échéance d'un dossier en cours, ou null (dates manquantes, dossier clos, rien d'attendu) :
 * - à déposer : `opcoDelaiDepot` jours avant le début de la formation ;
 * - déposé : accord attendu `DELAI_ACCORD_JOURS` jours avant le début ;
 * - accordé : justificatifs `opcoDelaiJustificatifs` jours après la fin ;
 * - justificatifs envoyés ou remboursé, encore à recevoir : remboursement `opcoDelaiRemboursement` jours après l'envoi ;
 *   en subrogation, le paiement de l'organisme par l'OPCO.
 */
export function echeanceOpco(d: DossierOpco, versements: readonly VersementOpco[] | undefined, s: DelaisOpco, today: ISODate): EcheanceOpco | null {
  if (d.annuleLe) return null;
  const faire = (etape: EtapeEcheanceOpco, echeance: ISODate, libelle = ECHEANCES_OPCO[etape]): EcheanceOpco => {
    const jours = days(parse(today), parse(echeance));
    return { dossierId: d.id, etape, echeance, jours, retard: jours < 0, libelle };
  };
  if (d.statut === 'a_deposer') return d.du ? faire('depot', addD(d.du, -s.opcoDelaiDepot)) : null;
  if (d.statut === 'depose') return d.du ? faire('accord', addD(d.du, -DELAI_ACCORD_JOURS)) : null;
  // Accordé, ou remboursé par un acompte avant l'envoi des justificatifs : ceux-ci restent attendus.
  if (d.statut === 'accorde' || (d.statut === 'rembourse' && !d.factureLe)) return d.au ? faire('justificatifs', addD(d.au, s.opcoDelaiJustificatifs)) : null;
  if ((d.statut === 'facture' || d.statut === 'rembourse') && d.factureLe) {
    const m = montantsOpco(d, versements);
    if (m.aRecuperer > 0) return faire('remboursement', addD(d.factureLe, s.opcoDelaiRemboursement));
    if (m.attenduOrganisme > 0) return faire('remboursement', addD(d.factureLe, s.opcoDelaiRemboursement), 'Paiement de l’organisme par l’OPCO attendu (subrogation)');
  }
  return null;
}

/** Dossiers en retard (échéance dépassée), du plus ancien retard au plus récent. */
export function retardsOpco(dossiers: readonly DossierOpco[], versements: readonly VersementOpco[] | undefined, s: DelaisOpco, today: ISODate): EcheanceOpco[] {
  return dossiers.map(d => echeanceOpco(d, versements, s, today)).filter((e): e is EcheanceOpco => !!e?.retard)
    .sort((a, b) => a.echeance.localeCompare(b.echeance) || a.dossierId - b.dossierId);
}

/** Action du plan nommée dans une relance : formation du catalogue (nom court) ou intitulé, équipe, exercice ; jamais de montant. */
export type NomActionPlan = (l: PlanAction) => string;

/**
 * Relances du récapitulatif des échéances (server/src/relances.ts), pour la seule boîte du service RH : une par dossier en
 * cours et par étape, avec la date de l'échéance (`opco:<id>:<étape>:<AAAA-MM-JJ>`, comme les autres relances : une
 * échéance déplacée — dates de la formation reportées, retour d'un cran — repart de zéro), aux paliers réglés puis échue. Ni montant ni nom de salarié : l'action du plan
 * et l'échéance seulement.
 */
export function relancesOpco(
  dossiers: readonly DossierOpco[], versements: readonly VersementOpco[] | undefined, plan: readonly PlanAction[], s: DelaisOpco, today: ISODate,
  paliers: readonly number[], nom: NomActionPlan,
): Relance[] {
  const out: Relance[] = [];
  for (const d of dossiers) {
    const e = echeanceOpco(d, versements, s, today);
    const l = plan.find(x => x.id === d.planActionId);
    if (!e || !l) continue;
    const palier = palierDe(e.jours, paliers);
    if (!palier) continue;
    out.push({
      cle: `opco:${d.id}:${e.etape}:${e.echeance}`, empId: 0, categorie: 'opco', echeance: e.echeance, jours: e.jours, palier, sante: false, rhSeul: true,
      libelle: `Dossier OPCO — ${nom(l)} : ${e.libelle.charAt(0).toLowerCase()}${e.libelle.slice(1)}`,
    });
  }
  return out;
}

// — Pièces —

export interface PieceAttendue { nature: NaturePiece; requise: boolean }

/** Avancement d'un dossier pour ses pièces : 0 à déposer, 1 déposé (ou refusé), 2 accordé, 3 justificatifs envoyés, 4 payé. */
function niveauPieces(d: Pick<DossierOpco, 'statut' | 'deposeLe' | 'accordLe' | 'factureLe'>, versements: number): number {
  const statut = d.statut === 'abandonne' ? statutAvantAbandon(d, versements) : d.statut;
  return { a_deposer: 0, depose: 1, refuse: 1, accorde: 2, facture: 3, rembourse: 4, solde: 4, abandonne: 0 }[statut];
}

/**
 * Pièces attendues à l'état du dossier (à confirmer avec les conditions de l'OPCO) : convention et programme dès la
 * préparation ; demande déposée ; accord ; facture et certificat de réalisation (ou, à défaut, feuilles d'émargement) pour la
 * demande de remboursement ; avis de paiement une fois payé (facultatif en subrogation, l'OPCO payant l'organisme).
 */
export function piecesAttendues(d: Pick<DossierOpco, 'statut' | 'deposeLe' | 'accordLe' | 'factureLe' | 'subrogation'>, versements = 0): PieceAttendue[] {
  const n = niveauPieces(d, versements);
  const out: PieceAttendue[] = [{ nature: 'convention', requise: true }, { nature: 'programme', requise: true }];
  if (n >= 1) out.push({ nature: 'demande', requise: true });
  if (n >= 2 && d.statut !== 'refuse') out.push({ nature: 'accord', requise: true });
  if (n >= 3) out.push({ nature: 'facture', requise: true }, { nature: 'certificat_realisation', requise: true }, { nature: 'emargement', requise: false });
  if (n >= 4) out.push({ nature: 'avis_paiement', requise: !d.subrogation });
  return out;
}

/**
 * Pièces requises absentes parmi `natures` (pièces en vigueur du dossier) ; le certificat de réalisation peut être remplacé
 * par les feuilles d'émargement.
 */
export function piecesManquantes(attendues: readonly PieceAttendue[], natures: readonly (NaturePiece | null | undefined)[]): NaturePiece[] {
  const presentes = new Set(natures);
  return attendues.filter(a => a.requise && !presentes.has(a.nature) && !(a.nature === 'certificat_realisation' && presentes.has('emargement'))).map(a => a.nature);
}

/** Pièces exigées pour envoyer les justificatifs (demande de remboursement) : facture et certificat de réalisation. */
export const piecesPourFacturer = (natures: readonly (NaturePiece | null | undefined)[]) =>
  piecesManquantes([{ nature: 'facture', requise: true }, { nature: 'certificat_realisation', requise: true }], natures);

/**
 * Fin de conservation d'une pièce d'un dossier : 10 ans après la fin de l'exercice pour la facture et l'accord (pièces
 * comptables, art. L123-22 du Code de commerce), l'exercice retenu étant celui du dossier ou, s'il est plus récent,
 * l'année du dépôt de la pièce ; null pour les autres (durée du dossier).
 */
export function conservationPieceOpco(nature: NaturePiece | null | undefined, exercice: number, today: ISODate): ISODate | null {
  if (nature !== 'facture' && nature !== 'accord') return null;
  return `${Math.max(exercice, Number(today.slice(0, 4))) + CONSERVATION_PIECE_OPCO_ANS}-12-31`;
}

// — Synthèse par exercice —

export interface LigneSyntheseOpco {
  cle: string; dossiers: number; demande: number; accorde: number; recu: number; aRecuperer: number; attenduOrganisme: number; refuse: number;
  priseEnCharge: number;
}
export interface SyntheseOpco {
  exercice: number;
  parStatut: Record<StatutOpco, number>;
  total: LigneSyntheseOpco;
  /** Coût retenu des actions qui portent un dossier actif, prise en charge et reste à charge ; taux : accordé / coût. */
  cout: number; resteACharge: number; tauxPriseEnCharge: number | null;
  parOpco: LigneSyntheseOpco[]; parDispositif: LigneSyntheseOpco[]; parEquipe: LigneSyntheseOpco[]; parTrimestre: LigneSyntheseOpco[];
  retards: number;
}

const ligneVide = (cle: string): LigneSyntheseOpco => ({ cle, dossiers: 0, demande: 0, accorde: 0, recu: 0, aRecuperer: 0, attenduOrganisme: 0, refuse: 0, priseEnCharge: 0 });
function ajouter(l: LigneSyntheseOpco, d: DossierOpco, m: MontantsOpco) {
  l.dossiers++;
  l.demande = centimes(l.demande + m.demande);
  l.accorde = centimes(l.accorde + m.accorde);
  l.recu = centimes(l.recu + m.recuEntreprise + m.payeOrganisme);
  l.aRecuperer = centimes(l.aRecuperer + m.aRecuperer);
  l.attenduOrganisme = centimes(l.attenduOrganisme + m.attenduOrganisme);
  if (d.statut === 'refuse') l.refuse = centimes(l.refuse + m.demande);
  l.priseEnCharge = centimes(l.priseEnCharge + m.priseEnCharge);
}

/**
 * État des dossiers d'un exercice (celui de l'action du plan) : nombre par état, montants, taux de prise en charge, reste
 * à charge, ventilation par OPCO, dispositif, équipe et trimestre de l'action, nombre de retards.
 */
export function syntheseOpco(
  exercice: number, dossiers: readonly DossierOpco[], versements: readonly VersementOpco[] | undefined, plan: readonly PlanAction[], s: DelaisOpco, today: ISODate,
): SyntheseOpco {
  const siens = dossiers.filter(d => d.exercice === exercice && !d.annuleLe);
  const parStatut = Object.fromEntries(Object.keys(STATUTS_OPCO).map(k => [k, 0])) as Record<StatutOpco, number>;
  const total = ligneVide('total');
  const groupes = { opco: new Map<string, LigneSyntheseOpco>(), dispositif: new Map<string, LigneSyntheseOpco>(), equipe: new Map<string, LigneSyntheseOpco>(), trimestre: new Map<string, LigneSyntheseOpco>() };
  const dans = (g: Map<string, LigneSyntheseOpco>, cle: string) => g.get(cle) ?? g.set(cle, ligneVide(cle)).get(cle)!;
  for (const d of siens) {
    parStatut[d.statut]++;
    const m = montantsOpco(d, versements), l = plan.find(x => x.id === d.planActionId);
    ajouter(total, d, m);
    ajouter(dans(groupes.opco, d.opco), d, m);
    ajouter(dans(groupes.dispositif, d.dispositif), d, m);
    ajouter(dans(groupes.equipe, l?.equipe ?? '—'), d, m);
    ajouter(dans(groupes.trimestre, l?.periode ?? '—'), d, m);
  }
  const actions = plan.filter(l => siens.some(d => d.planActionId === l.id && dossierActif(d)));
  const cout = centimes(actions.reduce((n, l) => n + coutRetenu(l), 0));
  const trier = (g: Map<string, LigneSyntheseOpco>) => [...g.values()].sort((a, b) => a.cle.localeCompare(b.cle));
  return {
    exercice, parStatut, total, cout,
    resteACharge: centimes(cout - total.priseEnCharge),
    tauxPriseEnCharge: cout > 0 ? Math.round(total.accorde / cout * 1000) / 10 : null,
    parOpco: trier(groupes.opco), parDispositif: trier(groupes.dispositif), parEquipe: trier(groupes.equipe), parTrimestre: trier(groupes.trimestre),
    retards: retardsOpco(siens, versements, s, today).length,
  };
}

// — Écrans (lot 11, étape 2 : Plan & budget, Échéances) —

/** Montant au centime près, pour le détail d'un dossier : « 1 234,50 € » (les sommes des tableaux restent à l'euro). */
export const eurosOpco = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Dossiers en vigueur (non supprimés) d'une action du plan, du plus récent au plus ancien. */
export const dossiersDeLaLigne = (dossiers: readonly DossierOpco[] | undefined, planActionId: number) =>
  (dossiers ?? []).filter(d => d.planActionId === planActionId && !d.annuleLe).sort((a, b) => b.id - a.id);

/**
 * Champs proposés à la création d'un dossier depuis une ligne du plan : dates des sessions rattachées (non annulées ; du
 * premier jour de la première au dernier jour de la dernière), heures de la formation du catalogue, effectif (réel une
 * fois l'action réalisée) et coût retenu comme montant demandé. Tout reste modifiable.
 */
export function propositionDossier(
  l: Pick<PlanAction, 'id' | 'statut' | 'cout' | 'coutReel' | 'effectif' | 'effectifReel'>,
  sessions: readonly Pick<Session, 'planId' | 'date' | 'fin' | 'statut'>[], dureeHeures: number | null | undefined,
): { du: ISODate | null; au: ISODate | null; heures: number | null; effectif: number; montantDemande: number } {
  const siennes = sessions.filter(s => s.planId === l.id && s.statut !== 'Annulée');
  const du = siennes.length ? siennes.map(s => s.date).sort()[0] : null;
  const au = siennes.length ? siennes.map(s => s.fin || s.date).sort().at(-1)! : null;
  return {
    du, au, heures: dureeHeures ?? null,
    effectif: l.statut === 'realise' && l.effectifReel != null ? l.effectifReel : l.effectif,
    montantDemande: centimes(coutRetenu(l)),
  };
}

/**
 * Étapes proposées sur un dossier dans son état (boutons du panneau de détail), mêmes contrôles que le serveur :
 * `rouvrir` est réservé à l'administrateur RH (l'écran le masque aux autres). Un dossier supprimé n'en a aucune.
 */
export function etapesProposees(d: DossierOpco, versements: number): {
  modifier: boolean; deposer: boolean; accorder: boolean; refuser: boolean; facturer: boolean; versement: boolean; solder: boolean; abandonner: boolean;
  rouvrir: boolean;
} {
  const ok = (i: Issue) => 'faire' in i;
  const vivant = !d.annuleLe;
  return {
    modifier: vivant && STATUTS_OPCO[d.statut].enCours,
    deposer: vivant && ok(controleTransition('deposer', d.statut)),
    accorder: vivant && ok(controleTransition('accorder', d.statut)),
    refuser: vivant && ok(controleTransition('refuser', d.statut)),
    facturer: vivant && ok(controleFacturation(d)),
    versement: vivant && STATUTS_VERSEMENT.includes(d.statut),
    solder: vivant && ok(controleSolde(d)),
    abandonner: vivant && ok(controleTransition('abandonner', d.statut)),
    rouvrir: vivant && 'vers' in statutPrecedent(d, versements),
  };
}

/**
 * Coût net du plan d'un exercice : le réalisé (budgetSummary) moins les sommes versées par l'OPCO, à l'entreprise ou à
 * l'organisme en subrogation, sur les dossiers des actions réalisées de l'exercice. Les enveloppes ne changent pas.
 */
export function coutNetPlan(
  realise: number, exercice: number, plan: readonly Pick<PlanAction, 'id' | 'statut'>[], dossiers: readonly DossierOpco[] | undefined,
  versements: readonly VersementOpco[] | undefined,
): { verse: number; net: number } {
  const realisees = new Set(plan.filter(l => l.statut === 'realise').map(l => l.id));
  const verse = centimes((dossiers ?? []).filter(d => d.exercice === exercice && !d.annuleLe && d.planActionId != null && realisees.has(d.planActionId))
    .reduce((n, d) => n + versementsDe(versements, d.id).reduce((m, v) => m + v.montant, 0), 0));
  return { verse, net: centimes(realise - verse) };
}

/** Versements en vigueur reçus (ou payés à l'organisme) entre deux dates incluses, du plus ancien au plus récent. */
export const versementsDeLaPeriode = (versements: readonly VersementOpco[] | undefined, du: ISODate, au: ISODate) =>
  (versements ?? []).filter(v => !v.annuleLe && v.le >= du && v.le <= au).sort((a, b) => a.le.localeCompare(b.le) || a.id - b.id);
