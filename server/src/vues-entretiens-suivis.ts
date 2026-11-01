// Entretiens suivis et feedback 360° dans l'instantané envoyé au navigateur (lot 12, chantier C3), appelé par
// server/src/dataset.ts (une ligne par vue, posée par le socle du lot 12 ; contexte : server/src/vues-lot12.ts). Au
// socle, le chantier n'a encore aucun champ : les projections ne remplacent rien. Le chantier y écrit, sur le modèle de
// server/src/frais-vues.ts, ce que reçoivent le manager et le collaborateur (`entretiensSuivisVueSalarie`) et les
// profils restreints de l'espace RH (`entretiensSuivisVueProfil` ; la comptabilité a sa liste blanche,
// server/src/frais-vues.ts). Le service RH (droit « rh ») reçoit l'instantané complet.
import type { ContexteVueProfil, ContexteVueSalarie, Projection } from './vues-lot12.ts';

/** Champs du chantier vus par un manager (son périmètre) ou un collaborateur (les siens). */
export function entretiensSuivisVueSalarie(_x: ContexteVueSalarie): Projection {
  return {};
}

/** Champs du chantier vus par un profil restreint de l'espace RH (paie, référent HSE, lecture seule). */
export function entretiensSuivisVueProfil(_x: ContexteVueProfil): Projection {
  return {};
}
