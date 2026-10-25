// Modifications concurrentes d'une fiche collaborateur (t108) : deux personnes du service RH qui modifient la même fiche
// ne s'écrasent plus sans avertissement. Le dialogue n'envoie que les champs modifiés, avec leur valeur d'origine (`avant`,
// celle de l'ouverture) ; le serveur compare chacune à la valeur enregistrée et refuse tout l'enregistrement (412) si l'une
// a changé entre-temps. Les champs liés partent ensemble (poste du référentiel et intitulé ; organisation du temps et ses
// paramètres ; nature du contrat, fin et agence ; période d'essai ; visite et reprise) : leurs contrôles portent sur
// l'ensemble. Le serveur ne compare que les champs envoyés (une valeur d'origine pour un autre champ est refusée). Les
// autres appelants (import, appel ancien) n'envoient pas `avant` et ne sont pas contrôlés.
import type { ProfilInput } from './profil.ts';
import { normaliserProfil, PROFIL_FIELDS } from './profil.ts';

type Champ = keyof ProfilInput;

/** Champs envoyés ensemble dès que l'un d'eux change. */
export const GROUPES_FICHE: readonly (readonly Champ[])[] = [
  ['poste', 'posteId'],
  ['temps', 'heures', 'forfaitHeures', 'forfaitJours', 'jourOff', 'tempsDepuis'],
  ['typeContrat', 'fin', 'agence', 'motifRecours', 'cddFinInitiale'],
  ['essaiFin', 'essaiRenouveleJusquau'],
  ['naissance', 'naissanceLe'],
  ['visite', 'repriseMotif', 'repriseDate'],
];

/** Libellés des champs de la fiche, pour nommer ceux qui ont changé entre-temps. */
export const LIBELLE_CHAMP_FICHE: Record<Champ, string> = {
  nom: 'Nom', poste: 'Poste', posteId: 'Poste du référentiel', equipe: 'Équipe', statut: 'Statut', typeContrat: 'Nature du contrat',
  temps: 'Organisation du temps', heures: 'Heures', forfaitHeures: 'Forfait en heures', forfaitJours: 'Forfait en jours',
  jourOff: 'Jours non travaillés', tempsDepuis: 'Date d’effet du régime de temps', entree: 'Date d’entrée', fin: 'Fin de contrat',
  motifSortie: 'Motif de sortie', essaiFin: 'Fin de la période d’essai', essaiRenouveleJusquau: 'Essai renouvelé jusqu’au',
  motifRecours: 'Motif de recours', cddFinInitiale: 'Terme initial du CDD',
  naissance: 'Année de naissance', naissanceLe: 'Date de naissance', derogationTravauxLe: 'Dérogation pour travaux réglementés', agence: 'Agence d’intérim', matriculePaie: 'Matricule de paie', email: 'Adresse e-mail',
  visite: 'Visite médicale', repriseMotif: 'Motif de l’absence longue', repriseDate: 'Date de reprise',
};

const egal = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Champs qui diffèrent entre deux fiches, complétés des champs de leur groupe. */
export function champsDifferents(a: ProfilInput, b: ProfilInput): Set<Champ> {
  const changes = new Set(PROFIL_FIELDS.filter(k => !egal(a[k], b[k])));
  for (const g of GROUPES_FICHE) if (g.some(k => changes.has(k))) g.forEach(k => changes.add(k));
  return changes;
}

/**
 * Champs à envoyer : ceux dont la saisie diffère de la fiche d'origine, complétés des champs de leur groupe, dans l'ordre
 * de PROFIL_FIELDS ; seulement parmi `permis` (champs ouverts au rôle).
 */
export function champsAEnvoyer(origine: ProfilInput, saisie: ProfilInput, permis: readonly Champ[] = PROFIL_FIELDS): Champ[] {
  const changes = champsDifferents(origine, saisie);
  return PROFIL_FIELDS.filter(k => changes.has(k) && permis.includes(k));
}

/**
 * Champs dont la valeur d'origine reçue (`avant`) n'est plus celle de la fiche enregistrée (`actuelle`) : quelqu'un d'autre
 * les a modifiés depuis l'ouverture du dialogue. Les clés inconnues sont ignorées.
 */
export function champsEnConflit(avant: unknown, actuelle: ProfilInput): Champ[] {
  if (!avant || typeof avant !== 'object' || Array.isArray(avant)) return [];
  const a = avant as Record<string, unknown>;
  return PROFIL_FIELDS.filter(k => Object.hasOwn(a, k) && !egal(a[k], actuelle[k]));
}

/**
 * Champs envoyés (`envoi`, parmi `champs`) dont la valeur change la fiche enregistrée (`actuelle`), comparés après
 * normalisation (normaliserProfil, comme à l'enregistrement) : un champ lié renvoyé inchangé n'en fait pas partie.
 */
export function champsModifies(actuelle: ProfilInput, envoi: Record<string, unknown>, champs: readonly Champ[]): Champ[] {
  const avant = normaliserProfil(actuelle);
  const apres = normaliserProfil({ ...actuelle, ...Object.fromEntries(champs.map(k => [k, envoi[k]])) } as ProfilInput);
  return champs.filter(k => !egal(avant[k], apres[k]));
}

/** Message du refus : champs modifiés entre-temps, et par qui quand le journal le dit. */
export function messageConflit(champs: readonly Champ[], par?: string | null): string {
  const noms = champs.map(k => LIBELLE_CHAMP_FICHE[k]).join(', ');
  return `Fiche modifiée entre-temps${par ? ` par ${par}` : ''} (${noms}) : rien n’a été enregistré. Reprenez la fiche à jour, puis enregistrez de nouveau`;
}
