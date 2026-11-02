// Géolocalisation au pointage côté interface (lot 12, chantier C6, étape 3), sans navigateur :
// - lecture de la position au clic (pwa/position.ts) : une seule lecture, jamais `watchPosition`, ni position gardée
//   (maximumAge 0) ; refus du salarié : « refusee » ; délai ou appareil sans position : « indisponible » ;
// - verdict affiché (components/temps/pointage-etat.ts) et suppression confirmée d'une zone (state/confirmations-pointage.ts).
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

const { positionAuClic } = await import('../client/src/pwa/position.ts');
const { verdictTexte } = await import('../client/src/components/temps/pointage-etat.ts');
const { suppressionZonePointage } = await import('../client/src/state/confirmations-pointage.ts');

const origine = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
afterEach(() => { if (origine) Object.defineProperty(globalThis, 'navigator', origine); });

/** Navigateur simulé : `reponse` appelle le rappel de succès ou d'erreur ; les appels sont relevés. */
function navigateur(reponse: (ok: PositionCallback, ko: PositionErrorCallback) => void) {
  const appels: { methode: string; options?: PositionOptions }[] = [];
  const geolocation = {
    getCurrentPosition: (ok: PositionCallback, ko: PositionErrorCallback, options?: PositionOptions) => { appels.push({ methode: 'getCurrentPosition', options }); reponse(ok, ko); },
    watchPosition: () => { appels.push({ methode: 'watchPosition' }); return 0; },
    clearWatch: () => undefined,
  };
  Object.defineProperty(globalThis, 'navigator', { value: { geolocation }, configurable: true });
  return appels;
}
const erreur = (code: number) => ({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' }) as GeolocationPositionError;

test('position au clic : une lecture, sans cache ni suivi, arrondie ; refus et échec sans bloquer', async () => {
  let appels = navigateur(ok => ok({ coords: { latitude: 48.57441234, longitude: 7.75212345, accuracy: 18.6 } } as GeolocationPosition));
  assert.deepEqual(await positionAuClic(), { lat: 48.574412, lng: 7.752123, precision: 19 });
  assert.deepEqual(appels.map(a => a.methode), ['getCurrentPosition'], 'jamais watchPosition');
  assert.equal(appels[0].options?.maximumAge, 0, 'aucune position gardée par le navigateur');
  assert.ok((appels[0].options?.timeout ?? 0) > 0, 'délai borné');
  appels = navigateur((_ok, ko) => ko(erreur(1)));
  assert.equal(await positionAuClic(), 'refusee');
  navigateur((_ok, ko) => ko(erreur(3)));
  assert.equal(await positionAuClic(), 'indisponible');
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  assert.equal(await positionAuClic(), 'indisponible', 'appareil sans géolocalisation');
});

test('verdict affiché et suppression d’une zone confirmée', () => {
  assert.deepEqual((['dans', 'hors', 'imprecise', 'refusee'] as const).map(verdictTexte), ['dans la zone', 'hors zone', 'position imprécise', 'position non partagée']);
  const c = suppressionZonePointage({ id: 4, libelle: 'Chantier de Strasbourg' });
  assert.equal(c.action, 'pointage.zone.supprimer');
  assert.deepEqual(c.payload, { id: 4 });
  assert.match(c.question, /Chantier de Strasbourg/);
});
