// Organismes de formation et e-learning dans l'instantané envoyé au navigateur (lot 12, chantier C4), appelé par
// server/src/dataset.ts (une ligne par vue, posée par le socle du lot 12 ; contexte : server/src/vues-lot12.ts). Au
// socle, le chantier n'a encore aucun champ : les projections ne remplacent rien. Le chantier y écrit, sur le modèle de
// server/src/frais-vues.ts, ce que reçoivent le manager et le collaborateur (`organismesVueSalarie`) et les profils
// restreints de l'espace RH (`organismesVueProfil` ; la comptabilité a sa liste blanche, server/src/frais-vues.ts). Le
// service RH (droit « rh ») reçoit l'instantané complet.
import type { ContexteVueProfil, ContexteVueSalarie, Projection } from './vues-lot12.ts';

/** Champs du chantier vus par un manager (son périmètre) ou un collaborateur (les siens). */
export function organismesVueSalarie(_x: ContexteVueSalarie): Projection {
  return {};
}

/** Champs du chantier vus par un profil restreint de l'espace RH (paie, référent HSE, lecture seule). */
export function organismesVueProfil(_x: ContexteVueProfil): Projection {
  return {};
}
