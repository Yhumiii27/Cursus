// Organismes de formation et e-learning dans l'instantané envoyé au navigateur (lot 12, chantier C4), appelé par
// server/src/dataset.ts (une ligne par vue, posée par le socle du lot 12 ; contexte : server/src/vues-lot12.ts). Le service
// RH (droit « rh ») reçoit l'instantané complet ; la comptabilité a sa liste blanche (server/src/frais-vues.ts), qui
// n'en contient rien.
// - Tous les espaces : `referentiels.organismes`, fiches réduites à {id, code, nomUsuel, type, archive}
//   (server/src/lecture-brute.ts), et les modules d'e-learning sans leur coût (sauf la paie, qui ne reçoit rien).
// - Fiches complètes : droit « formations » (référent HSE) et lecture seule, sans le motif d'une fusion (texte du service RH).
// - Contacts (données de tiers) et tarifs : droit « formations » seulement ; ni la lecture seule, ni la paie, ni le manager,
//   ni le collaborateur (CHAMPS_HORS_VUES de server/src/vues-cache.ts).
// - Inscriptions : les siennes pour le collaborateur, celles du périmètre pour le manager, toutes pour le référent HSE et la
//   lecture seule ; sans aucun motif (correction, annulation) ni inscription annulée hors du service RH.
import type { InscriptionElearning, ModuleElearning, Organisme } from '../../shared/types-organismes.ts';
import type { ContexteVueProfil, ContexteVueSalarie, Projection } from './vues-lot12.ts';

/** Fiche sans le motif d'une fusion (texte de l'administrateur RH). */
const ficheSansMotif = (o: Organisme): Organisme => (o.fusionneMotif ? { ...o, fusionneMotif: null } : o);
/** Module sans le coût d'une licence (donnée commerciale du service RH). */
const moduleSansCout = (m: ModuleElearning): ModuleElearning => (m.coutLicence != null ? { ...m, coutLicence: null } : m);
/** Inscriptions en vigueur (une inscription annulée reste au service RH), sans motif de correction ni d'annulation. */
const inscriptionsNeutres = (l: readonly InscriptionElearning[]): InscriptionElearning[] =>
  l.filter(i => !i.annuleLe).map(i => (i.corrigeMotif ? { ...i, corrigeMotif: null } : i));

/** Champs du chantier vus par un manager (son périmètre) ou un collaborateur (les siens). */
export function organismesVueSalarie(x: ContexteVueSalarie): Projection {
  return {
    organismes: [],
    organismeContacts: [],
    organismeTarifs: [],
    modulesElearning: (x.full.modulesElearning ?? []).map(moduleSansCout),
    // Lignes par salarié (CHAMPS_PAR_SALARIE) : lues à travers le périmètre de la vue (`mine`).
    inscriptionsElearning: inscriptionsNeutres(x.mine(x.full.inscriptionsElearning ?? [])),
  };
}

/** Champs du chantier vus par un profil restreint de l'espace RH (paie, référent HSE, lecture seule). */
export function organismesVueProfil(x: ContexteVueProfil): Projection {
  const formations = x.droits.includes('formations'), lecture = x.droits.includes('consultation');
  const voit = formations || lecture;
  return {
    organismes: voit ? (x.full.organismes ?? []).map(ficheSansMotif) : [],
    organismeContacts: formations ? x.full.organismeContacts ?? [] : [],
    organismeTarifs: formations ? x.full.organismeTarifs ?? [] : [],
    modulesElearning: voit ? (x.full.modulesElearning ?? []).map(m => (formations ? m : moduleSansCout(m))) : [],
    inscriptionsElearning: voit ? inscriptionsNeutres(x.full.inscriptionsElearning ?? []) : [],
  };
}
