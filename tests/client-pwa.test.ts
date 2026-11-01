// Application mobile côté interface (lot 11, chantier C2, étape 2), sans navigateur :
// - saisie gardée hors ligne (client/src/pwa/saisie-hors-ligne.ts) : ce qui entre dans la file et sous quelle forme
//   (temps.setCell devient temps.saisir avec la valeur vue), l'instantané en mémoire qui montre la saisie, les libellés ;
// - pilote (client/src/pwa/pilote.ts) : envoi en ligne comme avant, file sur réseau absent avec la clé de l'envoi
//   interrompu, saisie d'un autre salarié jamais gardée, rejeu et ses messages, purge d'un autre compte, appareil partagé ;
// - photo d'un justificatif (client/src/pwa/photo.ts), clé VAPID, détection iOS et standalone, barre d'onglets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActionResponse, SessionState } from '../client/src/api.ts';
import type { Dataset } from '../shared/types.ts';

const { appliquerLocalement, libelleSaisie, versFile } = await import('../client/src/pwa/saisie-hors-ligne.ts');
const { MESSAGE_GARDEE, PiloteHorsLigne, porteurDe } = await import('../client/src/pwa/pilote.ts');
const { FileHorsLigne, magasinMemoire } = await import('../client/src/state/hors-ligne.ts');
const { COTE_MAX_PHOTO, dimensionsReduites, photoTelleQuelle, preparerPhoto } = await import('../client/src/pwa/photo.ts');
const { octetsB64u } = await import('../client/src/pwa/push.ts');
const { estIos, estStandalone } = await import('../client/src/pwa/enregistrement.ts');
const { ongletsDe } = await import('../client/src/layout/onglets.ts');
const { ACTIONS_PAIE } = await import('../shared/journal.ts');

const SEMAINE = '2026-10-12';
/** Instantané réduit de Mehdi Benali (salarié 2) : une feuille avec une ligne, un projet de plus au référentiel. */
function donnees(): Dataset {
  return {
    user: { empId: 2 },
    feuilles: [{ id: 7, empId: 2, week: SEMAINE, statut: 'brouillon', comment: null, sage: false, keystone: false, contrat: null,
      lignes: [{ projet: 'INT-MAINT', tache: 'Maintenance interne', ks: false, h: [3, 0, 0, 0, 0, 0, 0] }] }],
    referentiels: { projets: [{ code: 'INT-MAINT', nom: 'Maintenance interne' }, { code: 'K-2620', nom: 'Maintenance zone ATEX' }] },
  } as unknown as Dataset;
}

test('file : temps.setCell devient temps.saisir (projet, tâche, jour, valeur vue), jamais l’indice de ligne', () => {
  const d = donnees();
  assert.deepEqual(versFile('temps.setCell', { empId: 2, week: SEMAINE, li: 0, di: 0, value: '7,5' }, d), {
    nom: 'temps.saisir', payload: { empId: 2, week: SEMAINE, projet: 'INT-MAINT', tache: 'Maintenance interne', di: 0, value: '7,5', base: '3' },
  });
  assert.equal(versFile('temps.setCell', { empId: 2, week: SEMAINE, li: 4, di: 0, value: '7' }, d), null, 'ligne inconnue');
  assert.deepEqual(versFile('temps.addLine', { empId: 2, week: SEMAINE, projet: 'K-2620' }, d)?.payload, { empId: 2, week: SEMAINE, projet: 'K-2620', siAbsente: true });
  const conge = { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' };
  assert.equal(versFile('absence.demander', conge, d)?.payload, conge, 'mêmes paramètres : la clé de l’envoi en ligne suit');
  // Jamais : une autre nature que les congés, un autre salarié, une validation, la paie, sans instantané.
  assert.equal(versFile('absence.demander', { ...conge, kind: 'MALADIE' }, d), null);
  assert.equal(versFile('absence.demander', { ...conge, kind: 'CET' }, d), null);
  assert.equal(versFile('temps.setCell', { empId: 3, week: SEMAINE, li: 0, di: 0, value: '7' }, d), null);
  for (const nom of ['temps.validate', 'absence.decider', 'temps.submit', ...ACTIONS_PAIE] as const) assert.equal(versFile(nom as never, { empId: 2 }, d), null, nom);
  assert.equal(versFile('temps.saisir', { empId: 2 }, null), null);
});

test('instantané en mémoire : heures et ligne ajoutée montrées, congé non décompté, rien d’autre de changé', () => {
  const d = donnees();
  const apres = appliquerLocalement(d, { nom: 'temps.saisir', payload: { empId: 2, week: SEMAINE, projet: 'INT-MAINT', tache: 'Maintenance interne', di: 2, value: '7,5', base: '0' } });
  assert.deepEqual(apres.feuilles[0].lignes[0].h, [3, 0, 7.5, 0, 0, 0, 0]);
  assert.deepEqual(d.feuilles[0].lignes[0].h, [3, 0, 0, 0, 0, 0, 0], 'instantané d’origine intact');
  const ligne = appliquerLocalement(d, { nom: 'temps.addLine', payload: { empId: 2, week: SEMAINE, projet: 'K-2620', siAbsente: true } });
  assert.deepEqual(ligne.feuilles[0].lignes.map(l => [l.projet, l.tache]), [['INT-MAINT', 'Maintenance interne'], ['K-2620', 'Maintenance zone ATEX']]);
  // Semaine sans feuille : créée en mémoire seulement.
  const nouvelle = appliquerLocalement(d, { nom: 'temps.addLine', payload: { empId: 2, week: '2026-10-19', projet: 'K-2620' } });
  assert.equal(nouvelle.feuilles.length, 2);
  assert.equal(nouvelle.feuilles[1].id, -1);
  assert.equal(appliquerLocalement(d, { nom: 'temps.addLine', payload: { empId: 2, week: SEMAINE, projet: 'INT-MAINT' } }), d, 'déjà sur la feuille');
  assert.equal(appliquerLocalement(d, { nom: 'temps.addLine', payload: { empId: 2, week: SEMAINE, projet: 'INCONNU' } }), d);
  assert.equal(appliquerLocalement(d, { nom: 'absence.demander', payload: { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-07' } }), d);
  assert.equal(appliquerLocalement(d, { nom: 'temps.saisir', payload: { empId: 2, week: SEMAINE, projet: 'K-2620', di: 0, value: '1' } }), d, 'ligne absente');
  assert.equal(libelleSaisie('temps.saisir', { week: SEMAINE, projet: 'INT-MAINT', di: 0, value: '7,5' }), 'Heures · INT-MAINT · lundi 12 octobre : 7,5 h');
  assert.equal(libelleSaisie('temps.addLine', { week: SEMAINE, projet: 'K-2620' }), 'Ligne K-2620 ajoutée · semaine du 12 oct. 2026');
  assert.equal(libelleSaisie('absence.demander', { kind: 'CP', du: '2026-12-07', au: '2026-12-08' }), 'Congés payés · du 7 déc. 2026 au 8 déc. 2026');
  assert.equal(libelleSaisie('absence.demander', { kind: 'RTT', du: '2026-12-07', au: '2026-12-07' }), 'RTT / repos · le 7 déc. 2026');
});

/** Banc du pilote : file en mémoire, API espionnée (réponses dans l'ordre), réseau et appareil partagé réglables. */
function banc(reponses: ActionResponse[] = []) {
  let session: SessionState | null = { role: 'collaborateur', user: {}, compte: { id: 3 } } as unknown as SessionState;
  let data: Dataset | null = donnees();
  const j = { appels: [] as { nom: string; payload: Record<string, unknown>; rejeu?: { cle: string; horsLigne?: boolean } }[], montres: 0, relectures: 0, messages: [] as [string, boolean][] };
  const reseau = { en: true, partage: false };
  const file = new FileHorsLigne(magasinMemoire(), { pause: async () => {} });
  const api = async (nom: string, payload: Record<string, unknown>, _e?: unknown, rejeu?: { cle: string; horsLigne?: boolean }) => {
    j.appels.push({ nom, payload, rejeu });
    return reponses.shift() ?? { ok: true, message: null };
  };
  const p = new PiloteHorsLigne({
    file, session: () => session, donnees: () => data, montrer: d => { data = d; j.montres++; },
    appelerApi: api as never,
    envoyeur: () => ({ action: async (nom, payload, cle) => await api(nom, payload, 'collaborateur', { cle }), piece: async () => ({ jeton: 'x' }) }),
    relire: () => { j.relectures++; }, notifier: (t, e) => { j.messages.push([t, !!e]); },
    enLigne: () => reseau.en, partage: () => reseau.partage, changement: () => {},
  });
  return { p, j, reseau, file, donnees: () => data, changerSession: (s: SessionState | null) => { session = s; } };
}
const RESEAU: ActionResponse = { ok: false, message: null, error: 'Connexion au serveur impossible', status: 0 };

test('pilote : en ligne comme avant ; réseau absent, la saisie est gardée et montrée, la clé de l’envoi interrompu suit', async () => {
  const b = banc([{ ok: true, message: null }, RESEAU, RESEAU]);
  assert.deepEqual(await b.p.appeler('temps.setCell', { empId: 2, week: SEMAINE, li: 0, di: 1, value: '4' }), { ok: true, message: null });
  assert.deepEqual(b.j.appels[0], { nom: 'temps.setCell', payload: { empId: 2, week: SEMAINE, li: 0, di: 1, value: '4' }, rejeu: undefined });
  // Serveur injoignable : gardée sous la forme temps.saisir, montrée dans la feuille affichée.
  assert.deepEqual(await b.p.appeler('temps.setCell', { empId: 2, week: SEMAINE, li: 0, di: 0, value: '8' }), { ok: true, message: MESSAGE_GARDEE });
  assert.equal(b.donnees()!.feuilles[0].lignes[0].h[0], 8);
  assert.deepEqual(b.p.entrees.map(e => [e.nom, e.payload.base]), [['temps.saisir', '3']]);
  // Demande de congé : envoyée avec sa clé, sans la marque du rejeu ; interrompue, la file garde la même clé.
  const conge = { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' };
  await b.p.appeler('absence.demander', conge);
  const envoi = b.j.appels[2];
  assert.equal(envoi.rejeu?.horsLigne, false);
  assert.equal(b.p.entrees[1].id, envoi.rejeu?.cle);
  // Hors ligne : rien ne part, la saisie va droit dans la file ; autre salarié : appel normal, rien de gardé.
  b.reseau.en = false;
  await b.p.appeler('temps.addLine', { empId: 2, week: SEMAINE, projet: 'K-2620' });
  assert.equal(b.j.appels.length, 3);
  assert.equal(b.p.entrees.length, 3);
  const autre = await b.p.appeler('temps.setCell', { empId: 5, week: SEMAINE, li: 0, di: 0, value: '8' });
  assert.equal(autre.message, null);
  assert.equal(b.j.appels.at(-1)!.nom, 'temps.setCell');
  // Une validation n'est jamais gardée.
  await b.p.appeler('temps.validate', { empId: 2, week: SEMAINE });
  assert.equal(b.p.entrees.length, 3);
});

test('pilote : rejeu au retour du réseau, messages, refus « À reprendre », purge d’un autre compte, appareil partagé', async () => {
  const b = banc([RESEAU, RESEAU]);
  b.reseau.en = false;
  await b.p.appeler('temps.setCell', { empId: 2, week: SEMAINE, li: 0, di: 0, value: '8' });
  await b.p.appeler('temps.setCell', { empId: 2, week: SEMAINE, li: 0, di: 1, value: '6' });
  assert.equal(await b.p.rejouer(), null, 'hors ligne : rien n’est tenté');
  b.reseau.en = true;
  const refus: ActionResponse = { ok: false, message: null, error: 'Conflit : la cellule a changé', status: 409 };
  const reponses = [{ ok: true, message: null, relire: true }, refus];
  const b2 = banc(reponses);
  b2.reseau.en = false;
  await b2.p.appeler('temps.setCell', { empId: 2, week: SEMAINE, li: 0, di: 0, value: '8' });
  await b2.p.appeler('temps.setCell', { empId: 2, week: SEMAINE, li: 0, di: 1, value: '6' });
  b2.reseau.en = true;
  const bilan = await b2.p.rejouer();
  assert.deepEqual(bilan, { envoyees: 1, aReprendre: 1, restantes: 0, arret: null });
  assert.deepEqual(b2.j.messages, [['1 saisie envoyée au retour du réseau', false], ['1 saisie refusée par le serveur : voyez « À reprendre »', true]]);
  assert.ok(b2.j.appels.every(a => a.rejeu?.horsLigne === undefined && a.rejeu?.cle), 'rejeu : clé et marque hors ligne (envoyeur)');
  assert.deepEqual(b2.p.entrees.map(e => [e.etat, e.motif]), [['a_reprendre', 'Conflit : la cellule a changé']]);
  assert.equal(b2.j.relectures, 1);
  await b2.p.abandonner(b2.p.entrees[0].id);
  assert.deepEqual(b2.p.entrees, []);
  // Session d'un autre compte : file de l'appareil purgée.
  assert.equal(await b.file.taille(), 2);
  b.changerSession({ role: 'collaborateur', user: {}, compte: { id: 9 } } as unknown as SessionState);
  b.reseau.en = false;
  await b.p.surSession();
  assert.equal(await b.file.taille(), 0);
  // Appareil partagé : rien n'est gardé, l'erreur d'origine revient à l'écran.
  const b3 = banc([RESEAU]);
  b3.reseau.partage = true;
  assert.equal((await b3.p.appeler('temps.setCell', { empId: 2, week: SEMAINE, li: 0, di: 0, value: '8' })).status, 0);
  assert.equal(await b3.file.taille(), 0);
  assert.equal(porteurDe(null), null);
  assert.deepEqual(porteurDe({ role: 'manager', user: {}, compte: { id: 4 } } as unknown as SessionState), { compteId: 4, espace: 'manager' });
});

test('photo : JPEG ou PNG de 10 Mo au plus gardé tel quel, sinon converti en JPEG réduit', async () => {
  assert.equal(photoTelleQuelle({ type: 'image/jpeg', size: 3_000_000 }), true);
  assert.equal(photoTelleQuelle({ type: 'image/png', size: 10 * 1024 * 1024 }), true);
  assert.equal(photoTelleQuelle({ type: 'image/png', size: 10 * 1024 * 1024 + 1 }), false);
  assert.equal(photoTelleQuelle({ type: 'image/heic', size: 2_000_000 }), false);
  assert.deepEqual(dimensionsReduites(4032, 3024), { l: COTE_MAX_PHOTO, h: 1200 });
  assert.deepEqual(dimensionsReduites(800, 600), { l: 800, h: 600 });
  const jpeg = new File([new Uint8Array([0xff, 0xd8])], 'recu.jpg', { type: 'image/jpeg' });
  assert.equal(await preparerPhoto(jpeg, async () => { throw new Error('jamais'); }), jpeg);
  const heic = new File([new Uint8Array(10)], 'IMG_0042.HEIC', { type: 'image/heic' });
  const converti = await preparerPhoto(heic, async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }));
  assert.deepEqual([converti.name, converti.type, converti.size], ['IMG_0042.jpg', 'image/jpeg', 3]);
  await assert.rejects(preparerPhoto(heic, async () => new Blob([new Uint8Array(10 * 1024 * 1024 + 1)])), /trop lourde/);
});

test('clé VAPID, iOS, application installée, barre d’onglets', () => {
  assert.deepEqual([...octetsB64u('BAEC_-8')], [4, 1, 2, 255, 239]);
  assert.equal(estIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)', 5), true);
  assert.equal(estIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), true, 'iPadOS se présente comme un Mac tactile');
  assert.equal(estIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), false);
  assert.equal(estIos('Mozilla/5.0 (Linux; Android 14; Pixel 7)', 5), false);
  const fen = (standalone: boolean, ios?: boolean) => ({ matchMedia: () => ({ matches: standalone }), navigator: { standalone: ios } }) as never;
  assert.equal(estStandalone(fen(true)), true);
  assert.equal(estStandalone(fen(false, true)), true);
  assert.equal(estStandalone(fen(false)), false);
  const item = (view: string) => ({ view, label: view, icon: (() => null) as never });
  assert.deepEqual(ongletsDe([['A', [item('portail'), item('entretiens')]], ['B', [item('temps'), item('absences'), item('missions')]]] as never).map(o => o.view),
    ['portail', 'entretiens', 'temps', 'absences']);
});
