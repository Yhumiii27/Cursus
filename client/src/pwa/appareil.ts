// Réglages propres à cet appareil (lot 11, chantier C2, t196), gardés dans le navigateur (localStorage, convenance
// seulement : jamais une donnée personnelle) :
// - « Appareil partagé » (tablette d'atelier ou de chantier) : ni saisie gardée hors ligne, ni notifications ; la file
//   et l'abonnement sont retirés quand on la coche (Mes appareils) ;
// - encart d'installation iOS masqué pour cet appareil (« Ne plus afficher »).
// Stockage indisponible (navigation privée) : réglages par défaut, rien ne casse.
const PARTAGE = 'cursus-appareil-partage';
const ENCART_IOS = 'cursus-encart-ios-masque';

function lire(cle: string): boolean {
  try { return localStorage.getItem(cle) === '1'; } catch { return false; }
}
function ecrire(cle: string, v: boolean): void {
  try { if (v) localStorage.setItem(cle, '1'); else localStorage.removeItem(cle); } catch { /* stockage indisponible */ }
}

export const appareilPartage = () => lire(PARTAGE);
export const definirAppareilPartage = (v: boolean) => ecrire(PARTAGE, v);
export const encartIosMasque = () => lire(ENCART_IOS);
export const masquerEncartIos = () => ecrire(ENCART_IOS, true);
