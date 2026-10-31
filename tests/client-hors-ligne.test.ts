// File hors ligne de l'application mobile (lot 11, chantier C2, étape 1 : client/src/state/hors-ligne.ts), sans
// navigateur : magasin en mémoire (à la place d'IndexedDB), WebCrypto de Node, envoi espionné.
// - chiffrement AES-GCM au repos avec une clé non extractible : rien de la saisie n'est lisible dans le magasin ;
// - liée au compte et à l'espace ; registre des actions admises ;
// - rejeu en série, pause entre deux envois, une seule relecture à la fin, clé d'idempotence = identifiant de l'entrée ;
// - pièces envoyées d'abord avec leur propre clé, jetons passés à l'action, jamais renvoyées après un arrêt ;
// - refus → « À reprendre » avec le motif ; réseau, session, serveur occupé → arrêt, la saisie attend ;
// - purges : complète, autre compte, au-delà de 7 jours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActionResponse } from '../client/src/api.ts';

const { FileHorsLigne, magasinMemoire } = await import('../client/src/state/hors-ligne.ts');
const { PAUSE_REJEU_MS } = await import('../shared/hors-ligne.ts');
type Envoyeur = import('../client/src/state/hors-ligne.ts').Envoyeur;

const MEHDI = { compteId: 3, espace: 'collaborateur' as const };
const saisie = (di: number, value = '7') => ({ empId: 2, week: '2026-10-12', projet: 'INT-MAINT', tache: 'Maintenance interne', di, value, base: '0' });

/** Banc : magasin en mémoire, horloge réglable, pauses notées, envois espionnés (réponses dans l'ordre de `reponses`). */
function banc(reponses: (ActionResponse | 'pieceOk' | { pieceErreur: number; message?: string })[] = []) {
  let maintenant = new Date('2026-10-12T08:00:00Z');
  const magasin = magasinMemoire();
  const j = { actions: [] as { nom: string; payload: Record<string, unknown>; cle: string }[], pieces: [] as { nom: string; cle: string; octets: number[] }[], pauses: [] as number[], relectures: 0 };
  const f = new FileHorsLigne(magasin, { maintenant: () => maintenant, pause: async ms => { j.pauses.push(ms); } });
  const envoyeur: Envoyeur = {
    action: async (nom, payload, cle) => {
      j.actions.push({ nom, payload, cle });
      const r = reponses.shift();
      if (!r || typeof r === 'string' || 'pieceErreur' in r) throw new Error('réponse d’action inattendue');
      return r;
    },
    piece: async (p, cle) => {
      j.pieces.push({ nom: p.nom, cle, octets: [...p.octets] });
      const r = reponses.shift();
      if (r === 'pieceOk') return { jeton: `jeton-${j.pieces.length}` };
      if (r && typeof r === 'object' && 'pieceErreur' in r) throw Object.assign(new Error(r.message ?? 'refus'), { status: r.pieceErreur });
      throw new Error('réponse de pièce inattendue');
    },
  };
  return { f, magasin, j, envoyeur, avancer: (jours: number) => { maintenant = new Date(maintenant.getTime() + jours * 86_400_000); }, relire: () => { j.relectures++; } };
}
const ok: ActionResponse = { ok: true, message: 'ok', relire: true };

test('ajout : registre des actions hors ligne, contenu chiffré au repos avec une clé non extractible', async () => {
  const b = banc();
  await assert.rejects(b.f.ajouter(MEHDI, 'temps.validate', { empId: 2 }), /non admise hors ligne/);
  const id = await b.f.ajouter(MEHDI, 'temps.saisir', saisie(0), { pieces: [{ nom: 'recu.jpg', type: 'image/jpeg', octets: new Uint8Array([0xff, 0xd8, 1, 2, 3]) }] });
  assert.match(id, /^[0-9a-f-]{36}$/);
  const cle = b.magasin.contenu.get('cle') as CryptoKey;
  assert.equal(cle.extractable, false);
  assert.deepEqual(cle.usages.sort(), ['decrypt', 'encrypt']);
  await assert.rejects(crypto.subtle.exportKey('raw', cle));
  // Rien de la saisie en clair dans le magasin (ni l'action, ni le projet, ni la pièce).
  const brut = JSON.stringify([...b.magasin.contenu.entries()].filter(([k]) => k !== 'cle'), (_k, v) => (v instanceof ArrayBuffer ? [...new Uint8Array(v)] : v));
  assert.doesNotMatch(brut, /temps\.saisir|INT-MAINT|Maintenance|recu\.jpg/);
  assert.match(brut, /"compteId":3/);
  const [e] = await b.f.lister(MEHDI);
  assert.deepEqual({ ...e, creeLe: undefined }, { id, nom: 'temps.saisir', payload: saisie(0), creeLe: undefined, etat: 'attente', motif: null, tentatives: 0, pieces: 1 });
  assert.equal(await b.f.taille(), 1);
  await assert.rejects(b.f.ajouter(MEHDI, 'temps.saisir', saisie(0), { pieces: Array.from({ length: 11 }, () => ({ nom: 'a', type: 'image/png', octets: new Uint8Array(1) })) }), /10 pièces/);
});

test('rejeu : en série, dans l’ordre, pause entre deux envois, clé = identifiant, une seule relecture ; compte et espace seulement', async () => {
  const b = banc([ok, ok]);
  const a = await b.f.ajouter(MEHDI, 'temps.saisir', saisie(0));
  await b.f.ajouter({ compteId: 3, espace: 'manager' }, 'temps.saisir', saisie(1));
  await b.f.ajouter({ compteId: 9, espace: 'collaborateur' }, 'temps.saisir', saisie(2));
  const c = await b.f.ajouter(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' });
  const r = await b.f.rejouer(MEHDI, b.envoyeur, b.relire);
  assert.deepEqual(r, { envoyees: 2, aReprendre: 0, restantes: 0, arret: null });
  assert.deepEqual(b.j.actions.map(x => [x.nom, x.cle]), [['temps.saisir', a], ['absence.demander', c]]);
  assert.deepEqual(b.j.pauses, [PAUSE_REJEU_MS]);
  assert.equal(b.j.relectures, 1);
  assert.deepEqual(await b.f.lister(MEHDI), []);
  assert.equal((await b.f.lister({ compteId: 3, espace: 'manager' })).length, 1, 'autre espace : gardée');
  assert.equal(await b.f.taille(), 2);
  // File vide : aucune relecture.
  const vide = await b.f.rejouer(MEHDI, b.envoyeur, b.relire);
  assert.deepEqual(vide, { envoyees: 0, aReprendre: 0, restantes: 0, arret: null });
  assert.equal(b.j.relectures, 1);
});

test('rejeu : refus → « À reprendre » avec le motif ; réseau, session, serveur occupé → arrêt, saisie en attente ; un seul rejeu à la fois', async () => {
  const conflit: ActionResponse = { ok: false, message: null, error: 'Conflit : la cellule vaut maintenant 6 h', status: 409 };
  const b = banc([conflit, ok, { ok: false, message: null, error: 'Connexion au serveur impossible', status: 0 }]);
  const a = await b.f.ajouter(MEHDI, 'temps.saisir', saisie(0));
  await b.f.ajouter(MEHDI, 'temps.saisir', saisie(1));
  const c = await b.f.ajouter(MEHDI, 'temps.saisir', saisie(2));
  await b.f.ajouter(MEHDI, 'temps.saisir', saisie(3));
  const [r, r2] = await Promise.all([b.f.rejouer(MEHDI, b.envoyeur, b.relire), b.f.rejouer(MEHDI, b.envoyeur, b.relire)]);
  assert.equal(r, r2, 'second appel pendant le premier : le même rejeu');
  assert.deepEqual(r, { envoyees: 1, aReprendre: 1, restantes: 2, arret: 'reseau' });
  assert.equal(b.j.actions.length, 3);
  assert.equal(b.j.relectures, 1);
  const l = await b.f.lister(MEHDI);
  assert.deepEqual(l.map(e => [e.id === a ? 'a' : e.id === c ? 'c' : 'd', e.etat, e.motif, e.tentatives]), [
    ['a', 'a_reprendre', 'Conflit : la cellule vaut maintenant 6 h', 0], ['c', 'attente', null, 1], ['d', 'attente', null, 0]]);
  // « À reprendre » ne repart pas d'elle-même ; remise en attente par la personne, puis abandon.
  for (const [status, arret] of [[401, 'session'], [503, 'serveur'], [429, 'serveur']] as const) {
    const x = banc([{ ok: false, message: null, error: 'x', status }]);
    await x.f.ajouter(MEHDI, 'temps.saisir', saisie(0));
    assert.equal((await x.f.rejouer(MEHDI, x.envoyeur, x.relire)).arret, arret);
    assert.equal((await x.f.lister(MEHDI))[0].etat, 'attente');
  }
  await b.f.reprendre(a);
  assert.equal((await b.f.lister(MEHDI))[0].etat, 'attente');
  assert.equal((await b.f.lister(MEHDI))[0].motif, null);
  await b.f.abandonner(a);
  assert.equal((await b.f.lister(MEHDI)).length, 2);
});

test('pièces : envoyées d’abord avec leur propre clé, jetons passés à l’action ; jeton gardé après un arrêt, jamais renvoyée', async () => {
  const b = banc(['pieceOk', { pieceErreur: 0 }]);
  const id = await b.f.ajouter(MEHDI, 'temps.saisir', saisie(0), {
    champPieces: 'jetons',
    pieces: [{ nom: 'a.jpg', type: 'image/jpeg', octets: new Uint8Array([1, 2]) }, { nom: 'b.png', type: 'image/png', octets: new Uint8Array([3]) }],
  });
  const r = await b.f.rejouer(MEHDI, b.envoyeur, b.relire);
  assert.equal(r.arret, 'reseau');
  assert.deepEqual(b.j.pieces.map(p => [p.nom, p.octets]), [['a.jpg', [1, 2]], ['b.png', [3]]]);
  assert.notEqual(b.j.pieces[0].cle, id);
  assert.equal(b.j.actions.length, 0);
  // Reprise : seule la seconde pièce repart (même clé), puis l'action avec les deux jetons.
  const envoyeur: Envoyeur = {
    action: async (nom, payload, cle) => { b.j.actions.push({ nom, payload, cle }); return ok; },
    piece: async (p, cle) => { b.j.pieces.push({ nom: p.nom, cle, octets: [...p.octets] }); return { jeton: 'jeton-b' }; },
  };
  const r2 = await b.f.rejouer(MEHDI, envoyeur, b.relire);
  assert.deepEqual(r2, { envoyees: 1, aReprendre: 0, restantes: 0, arret: null });
  assert.deepEqual(b.j.pieces.map(p => p.nom), ['a.jpg', 'b.png', 'b.png']);
  assert.equal(b.j.pieces[1].cle, b.j.pieces[2].cle, 'même clé d’idempotence au renvoi');
  assert.deepEqual(b.j.actions[0].payload.jetons, ['jeton-1', 'jeton-b']);
  assert.equal(b.j.actions[0].cle, id);
  assert.deepEqual([...b.magasin.contenu.keys()].filter(k => k !== 'cle'), [], 'saisie et pièces effacées après l’envoi');
  // Pièce refusée (format) : « À reprendre » avec le motif du serveur.
  const c = banc([{ pieceErreur: 415, message: 'Format refusé : PDF, JPEG ou PNG seulement.' }]);
  await c.f.ajouter(MEHDI, 'temps.saisir', saisie(0), { pieces: [{ nom: 'x.heic', type: 'image/heic', octets: new Uint8Array([9]) }] });
  assert.equal((await c.f.rejouer(MEHDI, c.envoyeur, c.relire)).aReprendre, 1);
  assert.equal((await c.f.lister(MEHDI))[0].motif, 'Format refusé : PDF, JPEG ou PNG seulement.');
});

test('purges : complète (clé comprise), session d’un autre compte, saisies de plus de 7 jours', async () => {
  const b = banc();
  await b.f.ajouter(MEHDI, 'temps.saisir', saisie(0));
  assert.equal(await b.f.purgerAutreCompte(3), false);
  assert.equal(await b.f.taille(), 1);
  assert.equal(await b.f.purgerAutreCompte(4), true);
  assert.equal(b.magasin.contenu.size, 0, 'autre compte : tout est effacé, clé comprise');
  await b.f.ajouter(MEHDI, 'temps.saisir', saisie(0), { pieces: [{ nom: 'a.jpg', type: 'image/jpeg', octets: new Uint8Array([1]) }] });
  b.avancer(5);
  await b.f.ajouter(MEHDI, 'temps.saisir', saisie(1));
  b.avancer(3);
  assert.equal(await b.f.purgerAnciennes(), 1);
  assert.equal((await b.f.lister(MEHDI)).length, 1);
  assert.ok(b.magasin.contenu.has('cle'));
  assert.equal([...b.magasin.contenu.keys()].filter(k => k.startsWith('piece:')).length, 0, 'pièce de la saisie purgée');
  b.avancer(8);
  assert.equal(await b.f.purgerAnciennes(), 1);
  assert.equal(b.magasin.contenu.size, 0, 'file vide : clé effacée');
  await b.f.ajouter(MEHDI, 'temps.saisir', saisie(0));
  await b.f.purger();
  assert.equal(b.magasin.contenu.size, 0);
});
