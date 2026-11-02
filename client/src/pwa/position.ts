// Géolocalisation au pointage (lot 12, chantier C6, étape 3 ; règles : shared/rules/geolocalisation.ts). Une seule lecture
// de la position, au clic sur « Pointer » et seulement quand le serveur la demande (GET /api/pointages/etat : `geoloc`,
// population géolocalisée et zone active) : jamais `watchPosition`, jamais en arrière-plan, jamais hors ligne. La position
// part avec le pointage ; le serveur en tire un verdict et ne la garde pas. Rien n'est gardé sur l'appareil.
// - Refus du salarié (ou fonction fermée par la Permissions-Policy d'une coque chargée avant l'activation : la page doit
//   être rechargée) : « refusee » ; délai dépassé, appareil sans position : « indisponible ». Le pointage part toujours.
import { DELAI_POSITION_MS, type PositionRecue } from '../../../shared/rules/geolocalisation.ts';

/** Position lue au clic (degrés arrondis à 6 décimales, soit environ 10 cm), ou la raison de son absence. */
export async function positionAuClic(): Promise<PositionRecue> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return 'indisponible';
  return await new Promise<PositionRecue>(ok => {
    navigator.geolocation.getCurrentPosition(
      p => ok({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6, precision: Math.round(p.coords.accuracy) }),
      e => ok(e.code === e.PERMISSION_DENIED ? 'refusee' : 'indisponible'),
      { enableHighAccuracy: true, timeout: DELAI_POSITION_MS, maximumAge: 0 },
    );
  });
}
