// Robustesse de la session côté client : erreurs réseau en français, réponse 401 signalée (session
// expirée) sauf pour un échec de connexion, brouillon de la reconnexion Microsoft (sessionStorage) :
// relu pour 30 minutes, jamais pour un dialogue de mot de passe.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

const { api, lienMicrosoft, MSG_RESEAU, surSessionExpiree } = await import('../client/src/api.ts');
const { effacerBrouillon, lireBrouillon, sauverBrouillon } = await import('../client/src/state/brouillon.ts');

const fetchOrigine = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOrigine; surSessionExpiree(null); });
/** Remplace fetch : `reponse(url)` renvoie la réponse, ou lève comme un réseau coupé. */
const simuler = (reponse: (url: string) => Response) => { globalThis.fetch = (async (url: string) => reponse(url)) as typeof fetch; };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('réseau coupé : message en français, statut 0, jamais « Failed to fetch »', async () => {
  simuler(() => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(api.data(), (e: Error & { status: number }) => e.message === MSG_RESEAU && e.status === 0);
  const r = await api.action('absence.demander', {});
  assert.deepEqual([r.ok, r.error, r.status], [false, MSG_RESEAU, 0]);
  assert.match(MSG_RESEAU, /^Connexion au serveur impossible/);
});

test('serveur arrêté derrière le proxy (502 sans message de Cursus) : message explicite', async () => {
  simuler(() => new Response('<html>Bad Gateway</html>', { status: 502 }));
  await assert.rejects(api.session(), /Serveur indisponible \(erreur 502\)/);
  simuler(() => json(403, { error: 'Réservé au service RH' }));
  await assert.rejects(api.journal(), /Réservé au service RH/, 'le message de Cursus reste prioritaire');
});

test('réponse 401 : session expirée signalée, sauf un échec de connexion', async () => {
  let n = 0;
  surSessionExpiree(() => { n++; });
  simuler(() => json(401, { error: 'Connexion requise' }));
  const r = await api.action('session.creer', {});
  assert.deepEqual([r.ok, r.status, n], [false, 401, 1]);
  await assert.rejects(api.data(), (e: Error & { status: number }) => e.status === 401);
  await assert.rejects(api.mode('manager'));
  assert.equal(n, 3);
  simuler(() => json(401, { error: 'Identifiant ou mot de passe incorrect.' }));
  await assert.rejects(api.login('karim.haddad', 'faux'), /incorrect/);
  assert.equal(n, 3, 'mauvais mot de passe : pas une session expirée');
});

test('lien de connexion Microsoft : page de retour, identifiant proposé, choix d’un autre compte', () => {
  assert.equal(lienMicrosoft(), '/api/auth/microsoft');
  assert.equal(lienMicrosoft({ retour: '/' }), '/api/auth/microsoft');
  assert.equal(lienMicrosoft({ retour: '/temps', identifiant: 'karim.haddad@entreprise.example', choix: true }),
    '/api/auth/microsoft?retour=%2Ftemps&identifiant=karim.haddad%40entreprise.example&choix=1');
});

// — Brouillon de la reconnexion Microsoft —

class Stockage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

test('brouillon : relu pour le même onglet pendant 30 minutes, puis effacé', (t) => {
  const s = new Stockage();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = s;
  t.after(() => { delete (globalThis as { sessionStorage?: unknown }).sessionStorage; });
  const ui = { search: 'Karim', equipe: 'Maintenance' } as never;
  sauverBrouillon({ compteId: 7, role: 'manager', view: 'absences', ui, dialog: null });
  const b = lireBrouillon()!;
  assert.deepEqual([b.compteId, b.role, b.view, b.dialog, b.champs], [7, 'manager', 'absences', null, null]);
  assert.deepEqual(b.ui, ui);
  // Plus de 30 minutes : effacé à la lecture.
  s.setItem('cursus.brouillon', JSON.stringify({ ...b, at: Date.now() - 31 * 60_000 }));
  assert.equal(lireBrouillon(), null);
  assert.equal(s.getItem('cursus.brouillon'), null);
  // Brouillon illisible : effacé.
  s.setItem('cursus.brouillon', '{');
  assert.equal(lireBrouillon(), null);
  assert.equal(s.getItem('cursus.brouillon'), null);
  // Dialogue qui porte un mot de passe : jamais conservé.
  sauverBrouillon({ compteId: 7, role: 'rh', view: 'parametres', ui, dialog: { type: 'motDePasseProvisoire', nom: 'X', identifiant: 'x', motDePasse: 'abcd-efgh-ijkl-mnop' } });
  assert.equal(lireBrouillon()!.dialog, null);
  assert.ok(!s.getItem('cursus.brouillon')!.includes('abcd-efgh'));
  effacerBrouillon();
  assert.equal(lireBrouillon(), null);
});

test('brouillon : stockage refusé (navigation privée) sans erreur', () => {
  (globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem() { throw new Error('refusé'); }, setItem() { throw new Error('refusé'); }, removeItem() { throw new Error('refusé'); } };
  try {
    assert.doesNotThrow(() => sauverBrouillon({ compteId: 1, role: 'rh', view: 'dashboard', ui: {} as never, dialog: null }));
    assert.equal(lireBrouillon(), null);
  } finally {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  }
});
