// lot 12 — C4 (organismes de formation et e-learning) : état d'écran des onglets Organismes (Référentiels) et E-learning
// (Formations), gardé dans l'adresse de la page (state/url.ts) : filtres et fiche ouverte.
import { ETAT_QUALIOPI_LABEL, etatQualiopi, ndaManquant, organismeActif, TYPES_ORGANISME, type EtatQualiopi } from '../../../../shared/rules/organismes.ts';
import { finAValider, inscriptionOuverte } from '../../../../shared/rules/elearning.ts';
import type { InscriptionElearning, Organisme, StatutInscriptionElearning } from '../../../../shared/types-organismes.ts';

/** Filtre de la liste des organismes : en vigueur, à vérifier (reprise), Qualiopi à surveiller, NDA absent, archivés. */
export type FiltreOrganismes = 'tous' | 'a_verifier' | 'qualiopi' | 'nda' | 'archives';
export const FILTRES_ORGANISMES: [FiltreOrganismes, string][] = [
  ['tous', 'En vigueur'], ['a_verifier', 'À vérifier'], ['qualiopi', 'Qualiopi à surveiller'], ['nda', 'NDA absent'], ['archives', 'Archivés'],
];
/** Formations : sessions (écran d'avant le lot 12) ou e-learning. */
export type OngletFormations = 'sessions' | 'elearning';
/** Inscriptions de l'onglet E-learning : ouvertes, fins à valider, terminées, toutes. */
export type FiltreElearning = 'ouvertes' | 'a_valider' | 'terminees' | 'toutes';
export const FILTRES_ELEARNING: [FiltreElearning, string][] = [['ouvertes', 'En cours'], ['a_valider', 'Fins à valider'], ['terminees', 'Terminées'], ['toutes', 'Toutes']];

/** États Qualiopi qui demandent une action (filtre « Qualiopi à surveiller »). */
export const QUALIOPI_A_SURVEILLER: readonly EtatQualiopi[] = ['echu', 'a_echeance', 'a_verifier'];

/** Fiches retenues par le filtre (`jours` : premier palier d'alerte Qualiopi). */
export function filtrerOrganismes(liste: readonly Organisme[], filtre: FiltreOrganismes, today: string, jours: number): Organisme[] {
  return liste.filter(o => {
    if (filtre === 'archives') return !organismeActif(o) && o.fusionneDans == null;
    if (!organismeActif(o)) return false;
    if (filtre === 'a_verifier') return o.aVerifier;
    if (filtre === 'qualiopi') return QUALIOPI_A_SURVEILLER.includes(etatQualiopi(o, today, jours));
    if (filtre === 'nda') return ndaManquant(o);
    return true;
  }).sort((a, b) => a.nomUsuel.localeCompare(b.nomUsuel, 'fr'));
}

/** Classe de l'étiquette d'un état Qualiopi. */
export const CLS_QUALIOPI: Record<EtatQualiopi, string> = {
  certifie: 'tag-neutral', a_echeance: 'tag-accent', echu: 'tag-accent', a_verifier: 'tag-outline', non_certifie: 'tag-outline', sans_objet: 'tag-outline',
};
/** Libellé court d'un état Qualiopi (liste). */
export const QUALIOPI_COURT: Record<EtatQualiopi, string> = {
  certifie: 'Certifié', a_echeance: 'À renouveler', echu: 'Échu', a_verifier: 'Sans date', non_certifie: 'Non certifié', sans_objet: '—',
};
export { ETAT_QUALIOPI_LABEL, TYPES_ORGANISME };

/** Classe de l'étiquette d'un statut d'inscription. */
export const CLS_INSCRIPTION: Record<StatutInscriptionElearning | 'expire', string> = {
  inscrit: 'tag-outline', en_cours: 'tag-neutral', termine: 'tag-neutral', abandonne: 'tag-outline', expire: 'tag-accent',
};

/** Inscriptions retenues par le filtre de l'onglet E-learning (inscriptions supprimées : jamais). */
export function filtrerInscriptions(liste: readonly InscriptionElearning[], filtre: FiltreElearning): InscriptionElearning[] {
  return liste.filter(i => !i.annuleLe && (filtre === 'toutes' || (filtre === 'ouvertes' ? inscriptionOuverte(i)
    : filtre === 'a_valider' ? finAValider(i) : i.statut === 'termine')));
}
