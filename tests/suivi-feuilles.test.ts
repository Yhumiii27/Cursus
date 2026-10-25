// Suivi des feuilles de temps (lot 4, chantier 4, étape 2 : t130) : état de chaque semaine × collaborateur (échéance
// réglable, semaines hors contrat, couvertes par une absence ou antérieures à la saisie exclues), relance par e-mail du
// salarié et de son valideur, validation groupée qui reprend les contrôles feuille par feuille et liste les refus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { Domain } = await import('../shared/domain.ts');
const S = await import('../shared/rules/suivi-feuilles.ts');
const { estActionPaie, libelleAction } = await import('../shared/journal.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Ligne = { action: string; message: string | null; payload: Record<string, any>; salaries: number[]; paie: boolean };

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => ((await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return o.message;
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>, status: number, re?: RegExp) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && (!re || re.test(e.message)), `${name} : refus ${status}`);
  const ADMIN = await user(null, 'rh');
  const domain = async () => new Domain(await loadFull(db, ADMIN));
  const feuille = async (empId: number, week: string, statut: string, h = [7, 7, 7, 7, 7]) => {
    (await db.run('DELETE FROM feuilles WHERE emp_id = ? AND week = ?', [empId, week]));
    return await db.insert<{ id: number }>('feuilles', { empId, week, statut, comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-MAINT', tache: 'Maintenance interne', ks: false, h }], contrat: null });
  };
  const journal = async (action: string) => (await db.all<Ligne>('journal')).filter(l => l.action === action);
  const statut = async (empId: number, week: string) => ((await db.one('SELECT statut FROM feuilles WHERE emp_id = ? AND week = ?', [empId, week])) as { statut: string } | undefined)?.statut;
  return { db, user, run, refus, domain, feuille, journal, statut, ADMIN, PAIE: await user(7, 'rh'), KARIM: await user(12, 'manager'), HUGO: await user(16, 'manager'), MEHDI: await user(2, 'collaborateur') };
}

test('t130 échéance d’une feuille : le lundi suivant à 12 h par défaut, réglable', () => {
  assert.deepEqual(S.limiteFeuille('2026-10-05', {}), { jour: '2026-10-12', heure: 12 });
  assert.deepEqual(S.limiteFeuille('2026-10-05', { feuilleLimiteJour: 3, feuilleLimiteHeure: 9 }), { jour: '2026-10-14', heure: 9 });
  assert.equal(S.echue('2026-10-05', {}, { jour: '2026-10-11', heure: 23 }), false);
  assert.equal(S.echue('2026-10-05', {}, { jour: '2026-10-12', heure: 11 }), false, 'lundi 11 h : pas encore');
  assert.equal(S.echue('2026-10-05', {}, { jour: '2026-10-12', heure: 12 }), true, 'lundi midi : en retard');
  assert.equal(S.echue('2026-10-05', {}, { jour: '2026-10-13', heure: 0 }), true);
  assert.equal(S.delaiTexte({}), 'le lundi de la semaine suivante à 12 h');
  assert.equal(S.delaiTexte({ feuilleLimiteJour: 5, feuilleLimiteHeure: 18 }), 'le vendredi de la semaine suivante à 18 h');
  assert.match(S.limiteTexte('2026-10-05', {}), /^lundi 12 oct\.? à 12 h$/);
  assert.deepEqual(S.semainesSuivies('2026-10-10', 3), ['2026-09-21', '2026-09-28', '2026-10-05']);
  assert.equal(S.semainesSuivies('2026-10-10').length, 5);
  // Heure de Paris : 8 h 30 UTC le 10 octobre (heure d'été) font 10 h.
  assert.deepEqual(S.maintenantParis('2026-10-10', new Date('2026-10-10T08:30:00Z')), { jour: '2026-10-10', heure: 10 });
  assert.equal(S.semainesTexte([{ week: '2026-09-28' }, { week: '2026-10-05' }]), 'S40, S41');
  assert.equal(S.ETATS_SEMAINE.a_corriger.label, 'À corriger');
});

test('t130 tableau semaine × collaborateur : états, retards, exclusions et compteurs', async () => {
  const { db, domain, feuille } = await fresh();
  const m = { jour: '2026-10-10', heure: 10 };
  // Mehdi : semaine 40 renvoyée pour correction ; Thomas : semaine 40 soumise ; Romain : semaine 41 en brouillon, semaine
  // 40 jamais saisie ; Bastien : semaine 41 en congés ; Camille (Logistique) entrée le 1er octobre.
  await feuille(2, '2026-09-28', 'rejetee');
  await feuille(18, '2026-10-05', 'brouillon');
  await db.exec(`DELETE FROM feuilles WHERE emp_id = 18 AND week = '2026-09-28'`);
  await db.insert('absences', { empId: 24, type: 'CP', du: '2026-10-05', au: '2026-10-09', statut: 'validee', keystone: false, justificatif: false });
  const semaines = S.semainesSuivies('2026-10-10', 5);
  const lignes = S.etatSemaines(await domain(), [2, 6, 18, 24], semaines, m);
  const etats = Object.fromEntries(lignes.map(l => [l.emp.id, l.cellules.map(c => `${c.etat ?? '-'}${c.enRetard ? '!' : ''}`)]));
  // Semaines du 7 et du 14 septembre : avant la première feuille enregistrée dans Cursus, exclues.
  assert.deepEqual(etats, {
    2: ['-', '-', 'transmise', 'a_corriger!', 'attendue'],
    6: ['-', '-', 'transmise', 'soumise', 'attendue'],
    18: ['-', '-', 'transmise', 'absente!', 'brouillon'],
    24: ['-', '-', 'transmise', 'soumise', '-'],
  });
  assert.deepEqual(S.compteursSuivi(lignes), { aSaisir: 3, enRetard: 2, aValider: 2 });
  // Lundi 12 octobre à midi : le brouillon de la semaine 41 passe en retard ; la feuille absente de Mehdi aussi.
  const lundi = S.etatSemaines(await domain(), [2, 18], ['2026-10-05'], { jour: '2026-10-12', heure: 12 });
  assert.deepEqual(lundi.map(l => [l.cellules[0].etat, l.cellules[0].enRetard]), [['absente', true], ['brouillon', true]]);
  // Hors contrat : avant l'entrée.
  await db.update('employes', 1, { entree: '2026-10-01' });
  assert.deepEqual(S.etatSemaines(await domain(), [1], ['2026-09-21', '2026-09-28'], m)[0].cellules.map(c => c.etat), [null, 'validee']);
  // Aucune feuille dans Cursus : rien n'est attendu ; collaborateur inconnu ignoré.
  await db.exec('DELETE FROM feuilles');
  assert.equal(S.debutSaisie(await domain()), null);
  assert.deepEqual(S.etatSemaines(await domain(), [2, 999], ['2026-10-05'], m).map(l => l.cellules[0].etat), [null]);
});

test('t130 vue du manager : début de la saisie calculé sur toutes les feuilles, comme la relance du serveur', async () => {
  const { db, run, KARIM } = await fresh();
  const m = { jour: '2026-10-10', heure: 13 };
  const equipe = [2, 6, 18, 24];
  const semaines = S.semainesSuivies('2026-10-10', 5);
  // L'équipe de Karim n'a encore rien saisi dans Cursus (mise en service « tout en même temps ») ; les autres équipes, si.
  await db.exec(`DELETE FROM feuilles WHERE emp_id IN (${[...equipe, 12].join(', ')})`);
  const serveur = S.compteursSuivi(S.etatSemaines(new Domain(await loadFull(db, KARIM)), equipe, semaines, m));
  const vue = await buildSnapshot(db, KARIM);
  assert.ok(vue.feuilles.every(f => equipe.includes(f.empId) || f.empId === 12), 'instantané du manager réduit à son équipe');
  assert.equal(vue.debutSaisieFeuilles, (await loadFull(db, KARIM)).debutSaisieFeuilles);
  const ecran = S.compteursSuivi(S.etatSemaines(new Domain(vue), equipe, semaines, m));
  assert.ok(serveur.enRetard > 0);
  assert.deepEqual(ecran, serveur, 'l’écran du manager montre les feuilles que le serveur relance');
  const relancees = (await run(KARIM, 'temps.relancer', {}) as string).match(/pour (\d+) feuille/)![1];
  assert.equal(Number(relancees), ecran.enRetard);
});

test('t130 relance : salarié et valideur notifiés, périmètre du manager, rien à relancer', async () => {
  const { db, run, refus, feuille, journal, ADMIN, PAIE, KARIM, HUGO, MEHDI } = await fresh();
  const mails = async () => (await db.all<{ type: string; contenu: { a: string[]; objet: string; texte: string } }>('envois')).filter(e => e.type === 'temps.relance');
  const recap = async () => (await db.all<{ type: string; empId: number | null; objet: string; texte: string }>('notifications')).filter(n => n.type === 'temps.relance');
  await refus(KARIM, 'temps.relancer', {}, 400, /Aucune feuille de temps en retard/);
  await feuille(2, '2026-09-28', 'rejetee');
  await feuille(6, '2026-09-28', 'brouillon');
  await refus(MEHDI, 'temps.relancer', {}, 403);
  await refus(PAIE, 'temps.relancer', {}, 403, /réservée aux managers et au service RH/);
  await refus(HUGO, 'temps.relancer', { empId: 2 }, 403, /hors de votre périmètre/);
  // Le manager relance son équipe : chaque salarié est notifié ; lui-même, auteur de la relance, ne l'est pas.
  assert.equal(await run(KARIM, 'temps.relancer', {}), 'Relance envoyée pour 2 feuilles de temps — 2 collaborateurs et son valideur');
  const m = await mails();
  assert.deepEqual(m.map(x => x.contenu.a[0]).sort(), ['mehdi.benali@entreprise.example', 'thomas.garnier@entreprise.example']);
  const mehdi = m.find(x => x.contenu.a[0].startsWith('mehdi'))!;
  assert.equal(mehdi.contenu.objet, 'Feuille de temps à corriger — semaine 40');
  assert.match(mehdi.contenu.texte, /semaine 40 \(.*\) : renvoyée pour correction/);
  assert.match(m.find(x => x.contenu.a[0].startsWith('thomas'))!.contenu.texte, /en brouillon, pas encore soumise[\s\S]*Relance de Karim Haddad\./);
  assert.equal((await recap()).length, 0, 'Karim, auteur de la relance, ne se notifie pas');
  const j = (await journal('temps.relancer')).at(-1)!;
  assert.deepEqual(j.salaries.sort(), [2, 6]);
  assert.deepEqual(j.payload.feuilles, [{ empId: 2, week: '2026-09-28' }, { empId: 6, week: '2026-09-28' }]);
  assert.equal(libelleAction('email.temps.relance'), 'E-mail simulé : Relance des feuilles de temps en retard');
  // Le service RH relance un salarié : lui et son manager (récapitulatif quotidien de Karim).
  assert.match(String(await run(ADMIN, 'temps.relancer', { empId: 2 })), /^Relance envoyée pour 1 feuille de temps — Mehdi Benali et son valideur$/);
  const r = (await recap()).at(-1)!;
  assert.equal(r.empId, 12);
  assert.equal(r.objet, '1 feuille de temps en retard — 1 collaborateur');
  assert.match(r.texte, /- Mehdi Benali : semaine 40 \(renvoyée pour correction\)/);
  // Relance faite par le service RH : « Relance du service RH. » (jamais « de le service RH »), au salarié comme au valideur.
  assert.match((await mails()).at(-1)!.contenu.texte, /Relance du service RH\./);
  assert.match(r.texte, /Relance du service RH\./);
  assert.ok(![...(await mails()).map(x => x.contenu.texte), r.texte].some(t => /de le service/.test(t)));
  assert.match(String(await run(ADMIN, 'temps.relancer', {})), /2 collaborateurs et son valideur$/);
});

test('t130 validation groupée : contrôles feuille par feuille, refus listés sans tout annuler', async () => {
  const { run, refus, feuille, journal, statut, ADMIN, KARIM, HUGO, MEHDI, PAIE } = await fresh();
  const W = '2026-10-05';
  await feuille(2, W, 'soumise');
  await feuille(6, W, 'soumise', [11, 7, 7, 7, 7]);
  await feuille(3, W, 'soumise');
  await refus(MEHDI, 'temps.validerLot', { feuilles: [{ empId: 2, week: W }] }, 403);
  await refus(PAIE, 'temps.validerLot', { feuilles: [{ empId: 2, week: W }] }, 403);
  await refus(KARIM, 'temps.validerLot', { feuilles: 'toutes' }, 400, /invalides/);
  await refus(KARIM, 'temps.validerLot', { feuilles: [{ empId: 2, week: '2026-10-06' }] }, 400, /invalides/);
  await refus(KARIM, 'temps.validerLot', { feuilles: Array.from({ length: 201 }, () => ({ empId: 2, week: W })) }, 400, /200 feuilles au plus/);
  await refus(HUGO, 'temps.validerLot', { feuilles: [{ empId: 2, week: W }] }, 403, /^Validation réservée au manager du salarié ou au service RH$/);
  await refus(HUGO, 'temps.validerLot', { feuilles: [{ empId: 2, week: W }, { empId: 6, week: W }] }, 403, /^Aucune feuille validée : /);
  // Karim : Mehdi validée ; Thomas (plus de 10 h un jour, sans motif) et Sophie (hors de son équipe) refusées, listées.
  const msg = String(await run(KARIM, 'temps.validerLot', { feuilles: [{ empId: 2, week: W }, { empId: 6, week: W }, { empId: 3, week: W }] }));
  assert.match(msg, /^1 feuille validée · 2 feuilles non validées, à ouvrir une à une : Thomas Garnier S41 \(Plus de 10 h sur une journée .*motif du dépassement.*\) ; Sophie Lemaire S41 \(Validation réservée au manager du salarié ou au service RH\)$/);
  assert.deepEqual([await statut(2, W), await statut(6, W), await statut(3, W)], ['validee', 'soumise', 'soumise'], 'un refus n’annule pas les autres');
  const j = (await journal('temps.validerLot')).at(-1)!;
  assert.deepEqual([j.payload.validees, j.payload.refus, j.salaries, j.paie], [[{ empId: 2, week: W }], 2, [2], true]);
  assert.ok(estActionPaie('temps.validerLot'));
  // Plus rien de validable : refus avec la liste.
  await refus(KARIM, 'temps.validerLot', { feuilles: [{ empId: 6, week: W }] }, 400, /^Aucune feuille validée — 1 refus : Thomas Garnier S41/);
  // Feuille déjà validée (validation reprise après une interruption, lot 8) : sautée, sans refus ni nouvelle écriture.
  assert.equal(await run(KARIM, 'temps.validerLot', { feuilles: [{ empId: 2, week: W }] }), 'Aucune nouvelle feuille validée · 1 feuille déjà validée, sautée');
  assert.match(String(await run(KARIM, 'temps.validerLot', { feuilles: [{ empId: 2, week: W }, { empId: 6, week: W }] })),
    /^Aucune nouvelle feuille validée · 1 feuille déjà validée, sautée · 1 feuille non validée, à ouvrir une à une : Thomas Garnier S41/);
  // Hors de son périmètre, une feuille validée n'est pas « déjà validée » : refusée comme avant.
  await refus(HUGO, 'temps.validerLot', { feuilles: [{ empId: 2, week: W }] }, 400, /Aucune feuille en attente de validation/);
  // Le service RH valide ce que le manager ne pouvait pas.
  assert.equal(await run(ADMIN, 'temps.validerLot', { feuilles: [{ empId: 3, week: W }] }), '1 feuille validée');
});
