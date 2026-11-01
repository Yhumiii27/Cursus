// Notes de frais côté client (lot 11, chantier C5, étape 2), sans navigateur : compte gardé pour la dépense rapide de la
// page « Hors ligne » (identifiants seuls, survit à la purge d'une file vide, effacé à la déconnexion et sans les notes de
// frais), dépense gardée avec la photo du reçu quand le réseau manque, confirmations des renvois et refus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionState } from '../client/src/api.ts';

const { FileHorsLigne, magasinMemoire } = await import('../client/src/state/hors-ligne.ts');
const { PiloteHorsLigne } = await import('../client/src/pwa/pilote.ts');
const F = await import('../client/src/state/confirmations-frais.ts');

const session = { role: 'collaborateur', user: { empId: 2, role: 'collaborateur', nom: 'Mehdi Benali', intitule: '' }, compte: { id: 3 } } as unknown as SessionState;

function banc(s: SessionState | null = session) {
  let maintenant = new Date('2026-10-12T08:00:00Z');
  const magasin = magasinMemoire();
  const file = new FileHorsLigne(magasin, { maintenant: () => maintenant, pause: async () => {} });
  let sess = s;
  const p = new PiloteHorsLigne({
    file, session: () => sess, donnees: () => null, montrer: () => {}, appelerApi: async () => ({ ok: true, message: null }),
    envoyeur: () => ({ action: async () => ({ ok: true, message: null }), piece: async () => ({ jeton: 'j' }) }),
    relire: () => {}, notifier: () => {}, enLigne: () => false, partage: () => false, changement: () => {},
  });
  return { p, file, magasin, avancer: (j: number) => { maintenant = new Date(maintenant.getTime() + j * 86_400_000); }, changer: (x: SessionState | null) => { sess = x; } };
}

test('compte gardé pour la dépense rapide : identifiants seuls, gardé à la purge d’une file vide, effacé sans notes de frais', async () => {
  const b = banc();
  await b.p.memoriserPorteur(true);
  assert.deepEqual(await b.file.porteurGarde(), { compteId: 3, espace: 'collaborateur', empId: 2 });
  // Instantané pas encore lu, ou ouverture sans session : rien ne change.
  await b.p.memoriserPorteur(undefined);
  b.changer(null);
  await b.p.memoriserPorteur(false);
  assert.ok(await b.file.porteurGarde());
  b.changer(session);
  // File vide purgée (7 jours) : le compte gardé reste.
  assert.equal(await b.file.purgerAnciennes(), 0);
  assert.ok(await b.file.porteurGarde());
  // Notes de frais désactivées : effacé ; déconnexion (purge complète) : effacé aussi.
  await b.p.memoriserPorteur(false);
  assert.equal(await b.file.porteurGarde(), null);
  await b.p.memoriserPorteur(true);
  await b.p.purger();
  assert.equal(await b.file.porteurGarde(), null);
  await b.magasin.ecrire('porteur', { compteId: 'x' });
  assert.equal(await b.file.porteurGarde(), null, 'valeur illisible ignorée');
});

test('dépense gardée avec la photo du reçu : file chiffrée, photo dans `jetons` au rejeu ; impossible sans session', async () => {
  const b = banc();
  const ok = await b.p.garderAvecPieces('frais.ligne.ajouter', { empId: 2, date: '2026-10-09', categorie: 'repas', montant: 12 }, [{ nom: 'recu.jpg', type: 'image/jpeg', octets: new Uint8Array([1, 2, 3]) }]);
  assert.equal(ok, true);
  assert.deepEqual(b.p.entrees.map(e => [e.nom, e.pieces]), [['frais.ligne.ajouter', 1]]);
  const vus: Record<string, unknown>[] = [];
  const bilan = await b.file.rejouer({ compteId: 3, espace: 'collaborateur' }, { action: async (_n, p) => { vus.push(p); return { ok: true, message: null }; }, piece: async () => ({ jeton: 'jeton-1' }) }, () => {});
  assert.equal(bilan.envoyees, 1);
  assert.deepEqual(vus[0].jetons, ['jeton-1']);
  // Sans session, ou action hors du registre : rien n'est gardé.
  b.changer(null);
  assert.equal(await b.p.garderAvecPieces('frais.ligne.ajouter', {}, []), false);
  b.changer(session);
  assert.equal(await b.p.garderAvecPieces('frais.note.soumettre' as never, {}, []), false);
});

test('confirmations : renvoi et refus avec motif lu par qui le verra, annulation et retrait sans motif obligatoire', () => {
  const n = { id: 4, empId: 2, periode: '2026-10', medicale: false, statut: 'soumise' } as never;
  const r = F.renvoiNote(n, 'Mehdi Benali', false);
  assert.deepEqual([r.action, r.payload, r.motif?.requis], ['frais.note.renvoyer', { id: 4 }, true]);
  assert.match(r.question, /note n° 4 — octobre 2026 de Mehdi Benali/);
  assert.match(r.motif!.aide, /ni recopié au journal ni envoyé par e-mail/);
  assert.ok(F.renvoiNote(n, 'M', true).suites!.some(s => /validation du manager/.test(s)));
  const l = { id: 7, date: '2026-10-06', categorie: 'repas', montantEur: 22, montant: 22, devise: 'EUR' } as never;
  assert.equal(F.refusDepense(l, 'Mehdi Benali').action, 'frais.ligne.refuser');
  assert.match(F.refusDepense(l, 'Mehdi Benali').question, /repas, 22,00 €/);
  assert.equal(F.annulationNote(n, null).motif?.requis, false);
  assert.match(F.annulationNote(n, 'Mehdi Benali').question, /de Mehdi Benali/);
  assert.equal(F.suppressionDepense(l).motif, undefined);
  assert.equal(F.refusAvance({ id: 1, montant: 300 } as never, 'Mehdi Benali').action, 'frais.avance.refuser');
  assert.match(F.annulationExport(5, 2, true).suites![1], /retirez de la comptabilité/);
  assert.match(F.annulationExport(5, 1, false).question, /\(1 note\)/);
});
