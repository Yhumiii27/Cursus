// Géolocalisation au pointage (lot 12, chantier C6, étape 3 ; règles : shared/rules/geolocalisation.ts). Une seule lecture
// de la position, au clic sur « Pointer » et seulement quand le serveur la demande (GET /api/pointages/etat : `geoloc`,
// population géolocalisée et zone active) : jamais `watchPosition`, jamais en arrière-plan, jamais hors ligne. La position
// part avec le pointage ; le serveur en tire un verdict et ne la garde pas. Rien n'est gardé sur l'appareil.
// - Refus du salarié (ou fonction fermée par la Permissions-Policy d'une coque chargée avant l'activation : la page doit
//   être rechargée) : « refusee » ; délai dépassé, appareil sans position : « indisponible ». Le pointage part toujours.
// - Minuteur de garde (`GARDE_POSITION_MS`) : le délai `timeout` du navigateur ne court qu'après l'autorisation (W3C
//   Geolocation), et une invite laissée ouverte ou fermée sans choix (Firefox) n'appelle aucun rappel. Passé ce délai, la
//   lecture rend « indisponible » et le pointage part ; un rappel tardif est ignoré.
import { DELAI_POSITION_MS, type PositionRecue } from '../../../shared/rules/geolocalisation.ts';

/** Attente totale de la position au plus (millisecondes), invite d'autorisation comprise : au-delà, le pointage part sans elle. */
export const GARDE_POSITION_MS = DELAI_POSITION_MS + 2_000;

/** Position lue au clic (degrés arrondis à 6 décimales, soit environ 10 cm), ou la raison de son absence. */
export async function positionAuClic(): Promise<PositionRecue> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return 'indisponible';
  return await new Promise<PositionRecue>(resoudre => {
    let fini = false;
    const ok = (r: PositionRecue) => { if (fini) return; fini = true; clearTimeout(garde); resoudre(r); };
    const garde = setTimeout(() => ok('indisponible'), GARDE_POSITION_MS);
    navigator.geolocation.getCurrentPosition(
      p => ok({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6, precision: Math.round(p.coords.accuracy) }),
      e => ok(e.code === e.PERMISSION_DENIED ? 'refusee' : 'indisponible'),
      { enableHighAccuracy: true, timeout: DELAI_POSITION_MS, maximumAge: 0 },
    );
  });
}
