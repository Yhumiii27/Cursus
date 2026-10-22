// Agenda (t036, lot 6 chantier 7 étape 2) : .ics joint à la décision d'un congé validé et à son annulation (même UID),
// flux personnel par abonnement (désactivé par défaut, jeton haché et révocable, absences sous le libellé « Absent »,
// contenu réglable, 404 identique pour tout jeton inutilisable, débit limité), journal sans jeton.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_DEMO = '1';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { createApp } = await import('../server/src/app.ts');
const { currentUser, loadFull, buildSnapshot } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const agenda = await import('../server/src/agenda.ts');
const { LimiteurDebit } = await import('../server/src/debit.ts');
const { appliquerReglages, ReglageInvalide } = await import('../shared/reglages.ts');
const { DEFAULT_SETTINGS } = await import('../server/src/dataset.ts');
const { familleAction, JOURNAL_LABEL } = await import('../shared/journal.ts');
const { cheminJournal, reglerJournaux } = await import('../server/src/logs.ts');
const { donneesSalarie } = await import('../server/src/donnees.ts');
type Db = InstanceType<typeof Db>;
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

const dir = mkdtempSync(join(tmpdir(), 'cursus-agenda-'));
const db = new Db(':memory:');
await appliquerMigrations(db);
await seedDemo(db);
let srv: Server, port: number;
before(async () => {
  await new Promise<void>(ok => { srv = createApp(db, { production: false, journalRequetes: false, dist: join(dir, 'sans-interface') }).listen(0, '127.0.0.1', () => { port = (srv.address() as AddressInfo).port; ok(); }); });
});
after(() => { srv.close(); db.sql.close(); rmSync(dir, { recursive: true, force: true }); });

function lire(chemin: string): Promise<{ status: number; headers: IncomingHttpHeaders; corps: string }> {
  return new Promise((ok, ko) => {
    request({ host: '127.0.0.1', port, path: chemin }, r => {
      let corps = '';
      r.setEncoding('utf8');
      r.on('data', (m: string) => { corps += m; });
      r.on('end', () => ok({ status: r.statusCode!, headers: r.headers, corps }));
    }).on('error', ko).end();
  });
}
const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', (empId ? [empId] : [])) as { id: number }).id;
const personne = async (empId: number | null, role: 'rh' | 'manager' | 'collaborateur') => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
async function agir(u: User, nom: string, p: Record<string, unknown>) {
  return await db.tx(async () => {
    const trace = await preparerTrace(db, nom, p);
    const r = await ACTIONS[nom](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, trace, { user: u, compte: { id: u.compteId!, identifiant: 'essai' } as never, message: o.message ?? null, result: o.result });
    return o as { message: string; result?: any };
  });
}
const reglages = async (r: Record<string, unknown>) => await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), ...r });
const derniersEnvois = async (type: string) => (await db.query('SELECT contenu FROM envois WHERE type = ? ORDER BY id DESC', [type])).map(r => JSON.parse(String((r as { contenu: string }).contenu)));
const contenuIcs = (pj: { base64: string }) => Buffer.from(pj.base64, 'base64').toString('utf8');

test('.ics d’un congé : journées entières, UID stable de l’absence, annulation du même événement', () => {
  const ics = agenda.icsConge({ id: 42, type: 'CP', du: '2026-12-21', au: '2026-12-24', debutDemi: null, finDemi: 'matin' });
  assert.match(ics, /UID:absence-42@/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261221/);
  assert.match(ics, /DTEND;VALUE=DATE:20261225/);
  assert.match(ics, /SUMMARY:Congés payés/);
  assert.match(ics, /DESCRIPTION:Demi-journée : matin le dernier jour/);
  assert.match(ics, /METHOD:PUBLISH/);
  const annule = agenda.icsConge({ id: 42, type: 'CP', du: '2026-12-21', au: '2026-12-24', debutDemi: null, finDemi: 'matin' }, { annule: true });
  assert.match(annule, /METHOD:CANCEL/);
  assert.match(annule, /STATUS:CANCELLED/);
  assert.match(annule, /UID:absence-42@/);
  assert.match(agenda.icsConge({ id: 1, type: 'MALADIE' as never, du: '2026-12-21', au: '2026-12-21', debutDemi: null, finDemi: null }), /SUMMARY:Absent/, 'jamais une nature');
});

test('décision d’un congé validé : .ics joint ; annulation d’un congé validé à venir : .ics d’annulation', async () => {
  const mehdi = await personne(2, 'collaborateur'), karim = await personne(12, 'manager');
  const d = await agir(mehdi, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-21', au: '2026-12-23' });
  assert.match(d.message, /Demande/);
  const id = (await db.one(`SELECT id FROM absences WHERE emp_id = 2 AND du = '2026-12-21'`) as { id: number }).id;
  await agir(karim, 'absence.decider', { id, ok: true });
  const e = (await derniersEnvois('absence.decision'))[0];
  assert.match(e.texte, /Ouvrez le fichier joint pour ajouter ces jours à votre agenda/);
  assert.equal(e.pj.length, 1);
  assert.match(e.pj[0].type, /^text\/calendar/);
  assert.match(contenuIcs(e.pj[0]), new RegExp(`UID:absence-${id}@`));
  await agir(karim, 'absence.annuler', { id });
  const a = (await derniersEnvois('absence.annulee'))[0];
  assert.match(a.objet, /^Congés annulés/);
  assert.match(contenuIcs(a.pj[0]), /METHOD:CANCEL/);
  assert.match(contenuIcs(a.pj[0]), new RegExp(`UID:absence-${id}@`));
  // Refus : aucun .ics.
  await agir(mehdi, 'absence.demander', { empId: 2, kind: 'CP', du: '2027-01-04', au: '2027-01-04' });
  const id2 = (await db.one(`SELECT id FROM absences WHERE emp_id = 2 AND du = '2027-01-04'`) as { id: number }).id;
  await agir(karim, 'absence.decider', { id: id2, ok: false, motif: 'Inventaire' });
  assert.equal((await derniersEnvois('absence.decision'))[0].pj, undefined);
});

test('réglages : flux désactivé par défaut, contenu complet, liste fermée', () => {
  assert.equal(DEFAULT_SETTINGS.agendaFluxActif, false);
  assert.deepEqual(DEFAULT_SETTINGS.agendaContenu, ['sessions', 'entretiens', 'absences', 'deplacements']);
  assert.deepEqual(appliquerReglages(DEFAULT_SETTINGS, { agendaContenu: ['absences', 'inconnu', 'sessions'] }).agendaContenu, ['sessions', 'absences']);
  assert.throws(() => appliquerReglages(DEFAULT_SETTINGS, { agendaContenu: 'absences' }), ReglageInvalide);
  for (const a of ['agenda.creerJeton', 'agenda.revoquerJeton', 'agenda.revoquerTout']) {
    assert.ok(JOURNAL_LABEL[a]);
    assert.equal(familleAction(a)?.id, 'conservation');
  }
});

test('flux personnel : jeton montré une fois et haché, absences « Absent », contenu réglé, révocation, 404 sans indice', async () => {
  const mehdi = await personne(2, 'collaborateur');
  // Désactivé : création refusée, et le flux répond 404.
  await assert.rejects(async () => await agir(mehdi, 'agenda.creerJeton', {}), (e: unknown) => e instanceof ActionError && e.status === 409);
  await reglages({ agendaFluxActif: true });
  await assert.rejects(async () => await agir(await personne(null, 'rh'), 'agenda.creerJeton', {}), (e: unknown) => e instanceof ActionError && e.status === 403);
  const r = await agir(mehdi, 'agenda.creerJeton', {});
  const jeton: string = r.result.jeton;
  assert.match(jeton, /^[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(r.message, new RegExp(jeton));
  const ligne = (await db.where<Record<string, any>>('jetonsAgenda', 'empId', 2)).at(-1)!;
  assert.equal(ligne.empreinte, agenda.empreinteJeton(jeton), 'stocké haché');
  assert.ok(!JSON.stringify(await db.query('SELECT * FROM journal')).includes(jeton), 'jamais au journal');
  assert.deepEqual((await buildSnapshot(db, mehdi)).agendaJeton, { creeLe: ligne.creeLe });
  assert.equal((await buildSnapshot(db, await personne(6, 'collaborateur'))).agendaJeton, null);
  // Absence de santé, entretien planifié, déplacement : publiés, l'absence sous « Absent ».
  await db.insert('absences', { empId: 2, type: 'MALADIE', du: '2026-11-02', au: '2026-11-04', statut: 'validee', keystone: false, justificatif: true });
  await db.insert('voyages', { empId: 2, dest: 'MA', depart: '2026-11-16', retour: '2026-11-20', motif: 'Chantier Tanger', origine: 'cursus' });
  const f = await lire(`/api/agenda/${jeton}.ics`);
  assert.equal(f.status, 200);
  assert.match(String(f.headers['content-type']), /^text\/calendar/);
  assert.match(f.corps, /^BEGIN:VCALENDAR\r\n/);
  assert.doesNotMatch(f.corps, /METHOD:/, 'abonnement : sans méthode');
  assert.match(f.corps, /SUMMARY:Absent/);
  assert.doesNotMatch(f.corps, /[Mm]aladie|Arrêt/);
  assert.match(f.corps, /SUMMARY:Déplacement : Maroc/);
  assert.equal((f.corps.match(/BEGIN:VEVENT/g) ?? []).length, (f.corps.match(/END:VEVENT/g) ?? []).length);
  assert.ok((await db.where<Record<string, any>>('jetonsAgenda', 'empId', 2)).at(-1)!.dernierAcces, 'dernier accès noté');
  // Contenu réglé : sans les absences.
  await reglages({ agendaContenu: ['deplacements'] });
  const g = await lire(`/api/agenda/${jeton}.ics`);
  assert.doesNotMatch(g.corps, /SUMMARY:Absent/);
  assert.match(g.corps, /Déplacement/);
  await reglages({ agendaContenu: ['sessions', 'entretiens', 'absences', 'deplacements'] });
  // Jeton mal formé, inconnu : 404, même réponse.
  const inconnu = await lire(`/api/agenda/${'A'.repeat(43)}.ics`);
  const malForme = await lire('/api/agenda/abc.ics');
  assert.equal(inconnu.status, 404);
  assert.equal(malForme.status, 404);
  assert.equal(inconnu.corps, malForme.corps);
  // Nouveau jeton : l'ancien ne vaut plus ; révocation par le salarié, puis par l'administrateur RH.
  const nouveau: string = (await agir(mehdi, 'agenda.creerJeton', {})).result.jeton;
  assert.equal((await lire(`/api/agenda/${jeton}.ics`)).status, 404);
  assert.equal((await lire(`/api/agenda/${nouveau}.ics`)).status, 200);
  assert.match((await agir(mehdi, 'agenda.revoquerJeton', {})).message, /révoqué/);
  assert.equal((await lire(`/api/agenda/${nouveau}.ics`)).status, 404);
  const troisieme: string = (await agir(mehdi, 'agenda.creerJeton', {})).result.jeton;
  await assert.rejects(async () => await agir(await personne(14, 'rh'), 'agenda.revoquerTout', {}), (e: unknown) => e instanceof ActionError && e.status === 403);
  assert.match((await agir(await personne(null, 'rh'), 'agenda.revoquerTout', {})).message, /^1 abonnement révoqué/);
  assert.equal((await lire(`/api/agenda/${troisieme}.ics`)).status, 404);
  // Flux désactivé ensuite : 404 ; compte désactivé ou salarié sorti : 404.
  const q: string = (await agir(mehdi, 'agenda.creerJeton', {})).result.jeton;
  await reglages({ agendaFluxActif: false });
  assert.equal((await lire(`/api/agenda/${q}.ics`)).status, 404);
  await reglages({ agendaFluxActif: true });
  await db.run('UPDATE comptes SET actif = 0 WHERE emp_id = 2');
  assert.equal((await lire(`/api/agenda/${q}.ics`)).status, 404);
  await db.run('UPDATE comptes SET actif = 1 WHERE emp_id = 2');
  assert.equal((await lire(`/api/agenda/${q}.ics`)).status, 200);
});

test('flux : fuseau de Paris une seule fois, créneaux d’une session ; débit limité par jeton', async () => {
  const evs = [
    { uid: 'a@x', date: '2026-11-02', creneaux: [{ jour: '2026-11-02', debut: '09:00', fin: '12:00' }], titre: 'Formation : SST' },
    { uid: 'b@x', date: '2026-11-03', creneaux: [{ jour: '2026-11-03', debut: '14:00', fin: '17:00' }], titre: 'Formation : CACES' },
    { uid: 'c@x', date: '2026-11-05', titre: 'Absent' },
  ];
  const ics = agenda.calendrierFlux(evs);
  assert.equal((ics.match(/BEGIN:VTIMEZONE/g) ?? []).length, 1);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 3);
  assert.match(ics, /DTSTART;TZID=Europe\/Paris:20261102T090000/);
  assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
  // Limiteur propre au flux : 10 lectures d'avance par jeton, puis 429.
  const l = new LimiteurDebit({ capacite: 2, parMinute: 1 }, () => 0);
  assert.equal(l.prendre('x'), 0);
  assert.equal(l.prendre('x'), 0);
  assert.ok(l.prendre('x') > 0);
  assert.equal(agenda.DEBIT_AGENDA.jeton.capacite, 10);
});

test('récapitulatif quotidien : la décision d’un congé validé n’annonce pas de fichier joint', async () => {
  const mehdi = await personne(2, 'collaborateur'), karim = await personne(12, 'manager');
  await db.run(`UPDATE employes SET notifications = 'quotidien' WHERE id = 2`);
  try {
    await agir(mehdi, 'absence.demander', { empId: 2, kind: 'CP', du: '2027-02-15', au: '2027-02-16' });
    const id = (await db.one(`SELECT id FROM absences WHERE emp_id = 2 AND du = '2027-02-15'`) as { id: number }).id;
    await agir(karim, 'absence.decider', { id, ok: true });
    const n = await db.one(`SELECT texte FROM notifications WHERE emp_id = 2 AND type = 'absence.decision' ORDER BY id DESC`) as { texte: string };
    assert.match(n.texte, /a été validée/);
    assert.doesNotMatch(n.texte, /fichier joint/);
  } finally {
    await db.run('UPDATE employes SET notifications = NULL WHERE id = 2');
  }
});

test('journaux du serveur : le jeton du flux est masqué dans le chemin de chaque requête', async () => {
  await reglages({ agendaFluxActif: true });
  const jeton: string = (await agir(await personne(2, 'collaborateur'), 'agenda.creerJeton', {})).result.jeton;
  const lignes: string[] = [];
  const retablir = reglerJournaux({ format: 'texte', sortie: l => { lignes.push(l); } });
  const app = createApp(db, { production: false, journalRequetes: true, dist: join(dir, 'sans-interface') });
  const s2 = await new Promise<Server>(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  try {
    const p2 = (s2.address() as AddressInfo).port;
    const statut = await new Promise<number>((ok, ko) => {
      request({ host: '127.0.0.1', port: p2, path: `/api/agenda/${jeton}.ics` }, r => { r.resume(); r.on('end', () => ok(r.statusCode!)); }).on('error', ko).end();
    });
    assert.equal(statut, 200);
    await new Promise(r => setImmediate(r));
  } finally {
    await new Promise(ok => s2.close(ok));
    retablir();
  }
  assert.ok(lignes.some(l => l.startsWith('GET /api/agenda/… → 200')), lignes.join('\n'));
  assert.ok(!lignes.join('\n').includes(jeton), 'jeton absent des journaux');
  assert.equal(cheminJournal(`/API/Agenda/${jeton}.ics?x=1`), '/API/Agenda/…');
});

test('export des données remis au salarié : ni l’auteur d’une révocation ni celui d’un effacement, ni son motif', async () => {
  await reglages({ agendaFluxActif: true });
  await agir(await personne(2, 'collaborateur'), 'agenda.creerJeton', {});
  await agir(await personne(null, 'rh'), 'agenda.revoquerTout', {});
  await db.insert('effacements', { empId: 2, categories: ['passeport'], le: '2026-10-10T08:00:00.000Z', par: 'Sandrine Vidal', motif: 'Décision du DPO', avantEcheance: false, elements: 2 });
  const salarie = JSON.stringify(await donneesSalarie(db, 2, { journal: false, par: 'Mehdi Benali' }));
  assert.doesNotMatch(salarie, /revoquePar|Décision du DPO|Sandrine Vidal/);
  const rh = JSON.stringify(await donneesSalarie(db, 2, { journal: true, par: 'Sandrine Vidal' }));
  assert.match(rh, /revoquePar/);
  assert.match(rh, /Décision du DPO/);
});
