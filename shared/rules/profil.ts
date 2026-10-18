// Fiche collaborateur : champs modifiables selon le rôle et contrôles de cohérence
// (statut, nature du contrat, organisation du temps de travail).
import { estMotifReprise, STATUTS, TEMPS_TRAVAIL, TYPES_CONTRAT } from '../constants.ts';
import { isValidDate } from '../dates.ts';
import { r1 } from '../format.ts';
import type { Employe, Equipe, MotifSortie, Statut, TempsTravail, TypeContrat } from '../types.ts';
import { controleMatriculePaie, normaliserMatricule, type TitulaireMatricule, unicite } from './matricules.ts';
import { controleEssai, estMotifSortie } from './contrats.ts';
import { controleAdresse, normaliserAdresse } from './messagerie.ts';
import { ageAu, mineurAu, refusEquipeNuit } from './mineurs.ts';

/** Âge minimal d'un salarié : 14 ans, pour des travaux légers pendant les vacances scolaires (art. L4153-3). */
export const AGE_MINIMUM = 14;

/** Champs d'une fiche saisis par le service RH. */
export interface ProfilInput {
  nom: string;
  /** Intitulé du poste : celui du poste choisi dans le référentiel (`posteId`), conservé sur la fiche. */
  poste: string;
  /** Poste du référentiel (shared/rules/exigences.ts), dont les exigences s'appliquent ; null : intitulé seul. */
  posteId?: number | null;
  equipe: string | null;
  statut: Statut;
  typeContrat: TypeContrat;
  temps: TempsTravail;
  heures: number | null;
  forfaitHeures: number | null;
  forfaitJours: number | null;
  jourOff: number[];
  /** Date d'effet de l'organisation du temps (renseignée lors d'un changement de régime). */
  tempsDepuis: string | null;
  entree: string;
  /** Dernier jour du contrat : fin prévue (CDD, mission, alternance), ou date de sortie enregistrée (tous contrats). */
  fin: string | null;
  /**
   * Motif de la sortie (liste fermée MOTIFS_SORTIE) : enregistré ou annulé par `employe.sortie` et `employe.annulerSortie`,
   * jamais par `employe.modifier` ; une fiche reprise d'un autre outil peut le porter à sa création.
   */
  motifSortie?: MotifSortie | null;
  /** Période d'essai écrite au contrat : dernier jour, et dernier jour après renouvellement (aucune valeur proposée). */
  essaiFin?: string | null;
  essaiRenouveleJusquau?: string | null;
  /** Année de naissance : dérivée de `naissanceLe` quand la date est saisie (`normaliserProfil`), seule connue sinon. */
  naissance: number;
  /** Date de naissance complète (shared/rules/mineurs.ts) ; null : inconnue, la fiche garde son année. */
  naissanceLe?: string | null;
  /** Salarié mineur : date de la déclaration de dérogation pour travaux réglementés (shared/rules/mineurs.ts) ; null : aucune. */
  derogationTravauxLe?: string | null;
  agence: string | null;
  /** Matricule du dossier de paie (Sage) : 1 à 20 lettres et chiffres, unique (shared/rules/matricules.ts). */
  matriculePaie: string | null;
  /** Adresse e-mail professionnelle (notifications, convocations). */
  email: string | null;
  visite: string | null;
  repriseMotif: string | null;
  repriseDate: string | null;
}

export const PROFIL_FIELDS: (keyof ProfilInput)[] = [
  'nom', 'poste', 'posteId', 'equipe', 'statut', 'typeContrat', 'temps', 'heures', 'forfaitHeures', 'forfaitJours', 'jourOff', 'tempsDepuis',
  'entree', 'fin', 'motifSortie', 'essaiFin', 'essaiRenouveleJusquau', 'naissance', 'naissanceLe', 'derogationTravauxLe', 'agence', 'matriculePaie', 'email', 'visite', 'repriseMotif', 'repriseDate',
];

/**
 * Champs qu'un manager peut modifier pour un membre de son équipe ; le contrat et le statut restent au RH, comme le poste
 * du référentiel (`posteId`), dont les exigences décident de la conformité : le manager n'en précise que l'intitulé.
 */
export const MANAGER_FIELDS: (keyof ProfilInput)[] = ['poste', 'jourOff'];

export const JOURS_SEMAINE = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];

export function profilOf(e: Employe): ProfilInput {
  const o = {} as Record<string, unknown>;
  PROFIL_FIELDS.forEach(k => { o[k] = (e as unknown as Record<string, unknown>)[k] ?? null; });
  return { ...(o as unknown as ProfilInput), jourOff: e.jourOff ?? [] };
}

export const PROFIL_VIDE = (equipe: string | null, today: string): ProfilInput => ({
  nom: '', poste: '', posteId: null, equipe, statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', heures: null, forfaitHeures: null, forfaitJours: null,
  jourOff: [], tempsDepuis: null, entree: today, fin: null, motifSortie: null, essaiFin: null, essaiRenouveleJusquau: null, naissance: Number(today.slice(0, 4)) - 30, naissanceLe: null, derogationTravauxLe: null, agence: null, matriculePaie: null, email: null, visite: null, repriseMotif: null, repriseDate: null,
});

/**
 * Normalise une fiche : les paramètres sans objet pour l'organisation du temps choisie sont vidés,
 * les valeurs par défaut légales sont appliquées (218 jours, 1 607 heures).
 */
export function normaliserProfil(p: ProfilInput): ProfilInput {
  const t = p.temps;
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const txt = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(String(v).replace(',', '.')));
  return {
    ...p,
    nom: txt(p.nom),
    poste: txt(p.poste),
    posteId: p.posteId == null || (p.posteId as unknown) === '' ? null : Number(p.posteId),
    equipe: s(p.equipe),
    heures: t === 'partiel' || t === 'forfait_heures_hebdo' ? n(p.heures) : null,
    forfaitHeures: t === 'forfait_heures_annuel' ? (n(p.forfaitHeures) ?? 1607) : null,
    forfaitJours: t === 'forfait_jours' ? (n(p.forfaitJours) ?? 218) : null,
    jourOff: t === 'partiel' && Array.isArray(p.jourOff) ? [...new Set(p.jourOff.map(Number))].filter(j => Number.isInteger(j) && j >= 0 && j <= 4).sort() : [],
    tempsDepuis: s(p.tempsDepuis),
    entree: txt(p.entree),
    // La date de fin sert de date de sortie pour tous les contrats : celle d'un CDI n'existe qu'avec son motif (validerProfil).
    fin: s(p.fin),
    motifSortie: s(p.motifSortie) as MotifSortie | null,
    essaiFin: s(p.essaiFin),
    essaiRenouveleJusquau: s(p.essaiRenouveleJusquau),
    // L'année suit la date complète quand elle est saisie : les deux ne peuvent pas se contredire.
    naissanceLe: s(p.naissanceLe),
    naissance: isValidDate(s(p.naissanceLe)) ? Number(s(p.naissanceLe)!.slice(0, 4)) : Number(p.naissance),
    derogationTravauxLe: s(p.derogationTravauxLe),
    agence: p.typeContrat === 'interim' ? s(p.agence) : null,
    matriculePaie: normaliserMatricule(p.matriculePaie),
    email: normaliserAdresse(p.email),
    visite: s(p.visite),
    repriseMotif: s(p.repriseMotif),
    repriseDate: s(p.repriseDate),
  };
}

/**
 * Contrôles bloquants (`errors`) et points d'attention (`warnings`).
 * `encadre` : équipes dont le collaborateur est manager (un intérimaire ne peut pas l'être).
 * `adressesPrises` : adresses e-mail des autres salariés, avec leur nom (`adressesPrises` de rules/messagerie.ts).
 * `matricules` : matricules de paie des autres salariés (`matriculesPris` de rules/matricules.ts), matricule enregistré
 * sur la fiche (`actuel`, inchangé : pas de nouveau contrôle) et réutilisation confirmée par l'administrateur RH.
 */
export function validerProfil(raw: ProfilInput, opts: {
  equipes: string[]; year: number; encadre?: string[]; adressesPrises?: Record<string, string>;
  matricules?: { pris: Record<string, TitulaireMatricule>; actuel?: string | null; reutiliser?: boolean };
  /**
   * Fiche enregistrée : fin prévue au contrat avant la sortie, et indication d'une sortie enregistrée (vues sans le
   * motif). La période d'essai se compare à la fin prévue, jamais à la date de sortie.
   */
  contrat?: Partial<Pick<Employe, 'finPrevue' | 'sortieEnregistree'>>;
  /**
   * Date de naissance de la fiche enregistrée : `enregistree`, une date complète est déjà connue (elle se corrige, ne
   * s'efface pas : la fiche ne revient pas à l'année seule) ; `masquee`, vue sans la date (manager), qui ne contrôle pas
   * l'année : le serveur, qui a la date, contrôle la naissance.
   */
  naissance?: { enregistree?: boolean; masquee?: boolean };
  /**
   * Règles des salariés mineurs (shared/rules/mineurs.ts) : équipes et leur case « travail de nuit ou en continu »
   * (affectation refusée), date du jour (dérogation pour travaux réglementés non datée du futur). Absent : non contrôlées.
   */
  mineurs?: { equipes: readonly Pick<Equipe, 'nom' | 'nuit'>[]; today: string };
}) {
  const p = normaliserProfil(raw);
  const errors: string[] = [], warnings: string[] = [];
  if (!p.nom) errors.push('Nom requis.');
  if (!p.poste) errors.push('Poste requis.');
  else if (p.posteId != null && !Number.isInteger(p.posteId)) errors.push('Poste inconnu : choisissez-le dans la liste.');
  if (p.equipe && !opts.equipes.includes(p.equipe)) errors.push(`Équipe inconnue : ${p.equipe}.`);
  if (!STATUTS[p.statut]) errors.push('Statut inconnu.');
  if (!TYPES_CONTRAT[p.typeContrat]) errors.push('Nature du contrat inconnue.');
  if (!TEMPS_TRAVAIL[p.temps]) errors.push('Organisation du temps de travail inconnue.');
  if (!isValidDate(p.entree)) errors.push('Date d’entrée invalide.');
  if (TYPES_CONTRAT[p.typeContrat]?.fin && !p.fin) errors.push(`Date de fin requise pour un contrat ${TYPES_CONTRAT[p.typeContrat].label}.`);
  if (p.fin) {
    if (!isValidDate(p.fin)) errors.push('Date de fin invalide.');
    else if (isValidDate(p.entree) && p.fin < p.entree) errors.push('La date de fin précède la date d’entrée.');
  }
  // Sortie : motif en liste fermée, avec sa date ; un CDI ne prend fin que par une sortie enregistrée.
  if (p.motifSortie && !estMotifSortie(p.motifSortie)) errors.push('Motif de sortie à choisir dans la liste.');
  if (p.motifSortie && !p.fin) errors.push('Date de sortie requise avec le motif de sortie.');
  // (Vue du manager : le motif ne lui parvient pas, l'indication de la sortie si.)
  if (p.fin && p.typeContrat === 'cdi' && !p.motifSortie && !opts.contrat?.sortieEnregistree) errors.push('Un CDI ne prend fin que par une sortie enregistrée avec son motif.');
  // Période d'essai : cohérence avec le contrat (bloquant), maximum légal (avertissement, shared/rules/contrats.ts).
  if (isValidDate(p.entree)) {
    const essai = controleEssai({ ...p, finPrevue: opts.contrat?.finPrevue ?? null, sortieEnregistree: opts.contrat?.sortieEnregistree });
    errors.push(...essai.errors);
    warnings.push(...essai.warnings);
  }
  if (p.typeContrat === 'interim' && !p.agence) errors.push('Agence d’intérim requise.');
  if (p.typeContrat === 'interim' && opts.encadre?.length) errors.push(`Manager de l’équipe ${opts.encadre.join(', ')} : désignez d’abord un autre manager (Équipes & managers) avant de passer la fiche en intérim.`);
  if (p.typeContrat === 'interim' && ['forfait_jours', 'forfait_heures_annuel', 'forfait_heures_hebdo', 'dirigeant'].includes(p.temps)) {
    errors.push('Un intérimaire ne peut relever ni d’une convention de forfait ni du régime de cadre dirigeant : ils se concluent avec l’agence, son employeur.');
  }
  if (p.typeContrat === 'alternance' && !p.fin) warnings.push('Alternance sans date de fin : contrat d’apprentissage ou de professionnalisation conclu en CDI.');
  if (p.tempsDepuis && !isValidDate(p.tempsDepuis)) errors.push('Date d’effet du régime de temps invalide.');
  // Date de naissance : au moins 14 ans à l'entrée (travaux légers pendant les vacances scolaires, art. L4153-3) ; sans
  // elle, l'année seule, contrôlée comme avant la date complète.
  if (opts.naissance?.masquee) { /* contrôlée par le serveur */ } else if (p.naissanceLe) {
    if (!isValidDate(p.naissanceLe) || p.naissanceLe < '1940-01-01') errors.push('Date de naissance invalide.');
    else if (isValidDate(p.entree) && ageAu(p, p.entree) < AGE_MINIMUM) errors.push(`Date de naissance : moins de ${AGE_MINIMUM} ans à la date d’entrée.`);
  } else if (Number.isNaN(p.naissance) || opts.naissance?.enregistree) errors.push('Date de naissance requise.');
  else if (!(p.naissance >= 1940 && p.naissance <= opts.year - AGE_MINIMUM)) errors.push('Année de naissance invalide.');
  if (opts.mineurs && !opts.naissance?.masquee) {
    const refus = refusEquipeNuit(p, opts.mineurs.equipes.find(q => q.nom === p.equipe), opts.mineurs.today);
    if (refus) errors.push(refus);
  }
  if (p.derogationTravauxLe) {
    if (!isValidDate(p.derogationTravauxLe) || p.derogationTravauxLe < '2000-01-01') errors.push('Date de la dérogation pour travaux réglementés invalide.');
    else if (opts.mineurs && p.derogationTravauxLe > opts.mineurs.today) errors.push('Dérogation pour travaux réglementés : la date de la déclaration ne peut pas être future.');
    else if (opts.mineurs && !opts.naissance?.masquee && !mineurAu(p, opts.mineurs.today) && !(isValidDate(p.entree) && p.entree > opts.mineurs.today && mineurAu(p, p.entree))) {
      warnings.push('Dérogation pour travaux réglementés : sans objet pour un salarié de 18 ans ou plus (art. R4153-40).');
    }
  }
  const errEmail = controleAdresse(p.email, 'Adresse e-mail professionnelle');
  if (errEmail) errors.push(`${errEmail}.`);
  else if (p.email && opts.adressesPrises?.[p.email]) errors.push(`Adresse e-mail déjà attribuée à ${opts.adressesPrises[p.email]}.`);
  if (!p.email) warnings.push('Adresse e-mail professionnelle manquante : ni les notifications ni les convocations ne lui parviendront.');
  // Matricule de paie : format, unicité (réembauche : réutilisation confirmée par l'administrateur RH), et rappel tant qu'il manque.
  const errMatricule = controleMatriculePaie(p.matriculePaie);
  const u = !errMatricule && opts.matricules ? unicite(p.matriculePaie, opts.matricules.pris, opts.matricules) : null;
  if (errMatricule) errors.push(`${errMatricule}.`);
  else if (u?.erreur) errors.push(u.erreur);
  if (u?.avertissement) warnings.push(u.avertissement);
  if (!p.matriculePaie && p.typeContrat !== 'interim') warnings.push('Matricule de paie manquant : le salarié sera refusé d’une transmission réelle à la paie.');
  if (p.visite && !isValidDate(p.visite)) errors.push('Date de visite médicale invalide.');
  if (p.repriseDate && !isValidDate(p.repriseDate)) errors.push('Date de reprise invalide.');
  if (p.repriseDate && !p.repriseMotif) errors.push('Motif de l’absence longue requis avec la date de reprise.');
  // Liste fermée (MOTIFS_REPRISE) : aucun texte libre, donc aucune information médicale, sur la fiche.
  if (p.repriseMotif && !estMotifReprise(p.repriseMotif)) errors.push('Motif de reprise à choisir dans la liste (aucune information médicale).');

  const cadre = STATUTS[p.statut]?.cadre;
  switch (p.temps) {
    case 'partiel':
      if (!(p.heures != null && p.heures > 0 && p.heures < 35)) errors.push('Temps partiel : durée hebdomadaire entre 1 et 34,5 h.');
      else if (p.heures < 24) warnings.push('Durée inférieure au minimum légal de 24 h par semaine : demande écrite et motivée du salarié requise (art. L3123-27).');
      if (p.jourOff.length >= 5) errors.push('Au moins un jour travaillé par semaine.');
      else if (p.heures != null && p.heures / (5 - p.jourOff.length) > 10) {
        errors.push(`Répartition impossible : ${r1(p.heures / (5 - p.jourOff.length)).toLocaleString('fr-FR')} h par jour travaillé, au-delà de 10 h (art. L3121-18).`);
      }
      break;
    case 'forfait_heures_hebdo':
      if (!(p.heures != null && p.heures > 35 && p.heures <= 46)) errors.push('Forfait hebdomadaire : durée comprise entre 35 et 46 h (art. L3121-22 et L3121-23).');
      else if (p.heures > 44) warnings.push('Au-delà de 44 h : la durée moyenne de 44 h sur 12 semaines est dépassée chaque semaine (art. L3121-22) ; un accord collectif est nécessaire jusqu’à 46 h.');
      break;
    case 'forfait_heures_annuel':
      if (!(p.forfaitHeures != null && p.forfaitHeures >= 100 && p.forfaitHeures <= 2200)) errors.push('Forfait annuel en heures : durée annuelle invalide.');
      else if (p.forfaitHeures < 1607) warnings.push('Durée annuelle inférieure à 1 607 h : salarié à temps partiel (art. L3123-1) ; les heures au-delà sont des heures complémentaires, minimum légal équivalent à 24 h par semaine (art. L3123-27).');
      if (!cadre) warnings.push('Forfait annuel en heures pour un non-cadre : réservé aux salariés disposant d’une réelle autonomie dans l’organisation de leur emploi du temps (art. L3121-56), prévu par accord collectif.');
      break;
    case 'forfait_jours':
      if (!(p.forfaitJours != null && p.forfaitJours >= 1 && p.forfaitJours <= 218)) errors.push('Forfait jours : 218 jours par an au plus (art. L3121-64).');
      if (!cadre) warnings.push('Forfait jours pour un non-cadre : réservé aux salariés autonomes dont la durée du temps de travail ne peut être prédéterminée (art. L3121-58), prévu par accord collectif.');
      break;
    case 'dirigeant':
      if (!cadre) errors.push('Le régime de cadre dirigeant est réservé au statut cadre (art. L3111-2).');
      break;
  }
  if (p.typeContrat === 'alternance' && (p.temps === 'forfait_jours' || p.temps === 'forfait_heures_annuel' || p.temps === 'dirigeant')) {
    warnings.push('Un alternant relève en principe de l’horaire collectif : vérifier la compatibilité avec le contrat d’apprentissage ou de professionnalisation.');
  }
  return { profil: p, errors, warnings, ok: errors.length === 0, matriculeAConfirmer: u?.aConfirmer ?? null };
}
