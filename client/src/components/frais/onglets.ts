// Onglets de l'écran Notes de frais (lot 11, chantier C5, étape 2 ; pages/Frais.tsx), selon l'espace, sans React (adresse
// de la page : state/url.ts ; tests/client-frais.test.ts).
// - Collaborateur : ses notes seulement (« Mes frais », sans onglet).
// - Manager : notes à valider (et avances), notes de l'équipe, ses propres notes.
// - Service RH et comptabilité : notes à contrôler, toutes les notes, avances, exports comptables, tableau de bord ;
//   lot 12 — C2 : historique (recherche dans toute la base, notes archivées comprises : ?onglet=historique).
import type { Role } from '../../../../shared/types.ts';

/** `premier` : aucun onglet choisi (adresse sans paramètre), le premier de l'espace. */
export type OngletFrais = 'premier' | 'notes' | 'valider' | 'equipe' | 'controle' | 'avances' | 'exports' | 'tableau' | 'historique';

/** Onglets de l'espace, dans l'ordre ; le premier est celui par défaut. */
export function ongletsFrais(role: Role): OngletFrais[] {
  if (role === 'rh') return ['controle', 'notes', 'avances', 'exports', 'tableau', 'historique'];
  if (role === 'manager') return ['valider', 'equipe', 'notes'];
  return ['notes'];
}

export const LIBELLES_ONGLETS_FRAIS: Record<OngletFrais, string> = {
  premier: '', notes: 'Notes', valider: 'À valider', equipe: 'Équipe', controle: 'À contrôler', avances: 'Avances', exports: 'Exports comptables', tableau: 'Tableau de bord',
  historique: 'Historique',
};

/** Onglet affiché : celui demandé s'il existe dans l'espace, sinon le premier. */
export const ongletFraisDe = (role: Role, demande: OngletFrais): OngletFrais => (ongletsFrais(role).includes(demande) ? demande : ongletsFrais(role)[0]);
