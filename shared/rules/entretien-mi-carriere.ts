// Entretien de parcours de mi-carrière (t069) : après la visite médicale de mi-carrière (art. L4624-2-2,
// shared/rules/visites-dues.ts), un entretien de parcours professionnel est proposé au salarié, dans un délai que la loi
// rattache à la visite. Délai réglable dans Paramètres → Entretien de mi-carrière (`entretienMiCarriereMois`, 2 mois par
// défaut : lecture la plus prudente du texte), à confirmer juridiquement, comme l'effet d'un accord de branche ou
// d'entreprise ; suivi désactivable (`entretienMiCarriereActif`).
// - Déclenchement : une visite de motif `mi_carriere` réalisée (demande close par l'avis, ou avis saisi avec ce motif).
//   Sans visite enregistrée, rien : l'obligation de visite reste suivie par les visites dues.
// - Échéance : la visite + le délai. Un entretien de parcours réalisé depuis la visite la satisfait ; plus proche que
//   l'échéance périodique (4 ans), elle l'avance (`obligations`, shared/rules/entretiens.ts) ; une fois réalisé, la
//   périodicité repart de lui.
// - Confidentialité : le manager et la lecture seule ne reçoivent pas les visites médicales ; le serveur leur transmet la
//   seule échéance (`Employe.entretienMiCarriere`, server/src/dataset.ts), « entretien de mi-carrière à planifier avant
//   le … », sans mention de la visite.
import { addM } from '../dates.ts';
import type { Dataset, Employe, ISODate } from '../types.ts';

type Source = Pick<Dataset, 'settings' | 'demandesVisite' | 'entretiens'>;

/** Libellé de l'obligation (liste des entretiens, récapitulatif des échéances). */
export const ENTRETIEN_MI_CARRIERE = 'Entretien de parcours de mi-carrière';

/**
 * Entretien de parcours dû après la visite de mi-carrière : échéance, et date de la visite (null : vue sans les visites,
 * échéance calculée par le serveur). Null : suivi désactivé, aucune visite de mi-carrière enregistrée, ou entretien de
 * parcours déjà réalisé depuis.
 */
export function entretienMiCarriere(ds: Source, e: Pick<Employe, 'id'> & Partial<Pick<Employe, 'entretienMiCarriere'>>): { due: ISODate; visite: ISODate | null } | null {
  if (!ds.settings.entretienMiCarriereActif) return null;
  // Vue sans les visites médicales : l'échéance précalculée par le serveur, telle quelle.
  if (e.entretienMiCarriere !== undefined) return e.entretienMiCarriere ? { due: e.entretienMiCarriere, visite: null } : null;
  const visite = ds.demandesVisite
    .filter(x => x.empId === e.id && x.motif === 'mi_carriere' && x.statut === 'realisee')
    .map(x => x.closeLe ?? x.le).sort().at(-1);
  if (!visite) return null;
  if (ds.entretiens.some(x => x.empId === e.id && x.type === 'epp' && x.statut === 'realise' && x.date >= visite)) return null;
  return { due: addM(visite, ds.settings.entretienMiCarriereMois || 2), visite };
}
