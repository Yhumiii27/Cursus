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

const { Db } = await import('../server/src/db.ts');
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
type Db = InstanceType<typeof Db>;
type User = NonNullable<ReturnType<typeof currentUser>>;

const dir = mkdtempSync(join(tmpdir(), 'cursus-agenda-'));
const db = new Db(':memory:');
appliquerMigrations(db);
seedDemo(db);
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
const compteDe = (empId: number | null) => (db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL').get(...(empId ? [empId] : [])) as { id: number }).id;
const personne = (empId: number | null, role: 'rh' | 'manager' | 'collaborateur') => currentUser(db, { compteId: compteDe(empId), role, methode: 'demo' })!;
function agir(u: User, nom: string, p: Record<string, unknown>) {
  return db.tx(() => {
    const trace = preparerTrace(db, nom, p);
    const r = ACTIONS[nom](makeCtx(db, u, loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    journaliserAction(db, trace, { user: u, compte: { id: u.compteId!, identifiant: 'essai' } as never, message: o.message ?? null, result: o.result });
    return o as { message: string; result?: any };
  });
}
const reglages = (r: Record<string, unknown>) => db.setSetting('app', { ...db.getSetting<Record<string, unknown>>('app', {}), ...r });
const derniersEnvois = (type: string) => db.sql.prepare('SELECT contenu FROM envois WHERE type = ? ORDER BY id DESC').all(type).map(r => JSON.parse(String((r as { contenu: string }).contenu)));
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

test('décision d’un congé validé : .ics joint ; annulation d’un congé validé à venir : .ics d’annulation', () => {
  const mehdi = personne(2, 'collaborateur'), karim = personne(12, 'manager');
  const d = agir(mehdi, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-21', au: '2026-12-23' });
  assert.match(d.message, /Demande/);
  const id = (db.sql.prepare(`SELECT id FROM absences WHERE emp_id = 2 AND du = '2026-12-21'`).get() as { id: number }).id;
  agir(karim, 'absence.decider', { id, ok: true });
  const e = derniersEnvois('absence.decision')[0];
  assert.match(e.texte, /Ouvrez le fichier joint pour ajouter ces jours à votre agenda/);
  assert.equal(e.pj.length, 1);
  assert.match(e.pj[0].type, /^text\/calendar/);
  assert.match(contenuIcs(e.pj[0]), new RegExp(`UID:absence-${id}@`));
  agir(karim, 'absence.annuler', { id });
  const a = derniersEnvois('absence.annulee')[0];
  assert.match(a.objet, /^Congés annulés/);
  assert.match(contenuIcs(a.pj[0]), /METHOD:CANCEL/);
  assert.match(contenuIcs(a.pj[0]), new RegExp(`UID:absence-${id}@`));
  // Refus : aucun .ics.
  agir(mehdi, 'absence.demander', { empId: 2, kind: 'CP', du: '2027-01-04', au: '2027-01-04' });
  const id2 = (db.sql.prepare(`SELECT id FROM absences WHERE emp_id = 2 AND du = '2027-01-04'`).get() as { id: number }).id;
  agir(karim, 'absence.decider', { id: id2, ok: false, motif: 'Inventaire' });
  assert.equal(derniersEnvois('absence.decision')[0].pj, undefined);
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
  const mehdi = personne(2, 'collaborateur');
  // Désactivé : création refusée, et le flux répond 404.
  assert.throws(() => agir(mehdi, 'agenda.creerJeton', {}), (e: unknown) => e instanceof ActionError && e.status === 409);
  reglages({ agendaFluxActif: true });
  assert.throws(() => agir(personne(null, 'rh'), 'agenda.creerJeton', {}), (e: unknown) => e instanceof ActionError && e.status === 403);
  const r = agir(mehdi, 'agenda.creerJeton', {});
  const jeton: string = r.result.jeton;
  assert.match(jeton, /^[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(r.message, new RegExp(jeton));
  const ligne = db.where<Record<string, any>>('jetonsAgenda', 'empId', 2).at(-1)!;
  assert.equal(ligne.empreinte, agenda.empreinteJeton(jeton), 'stocké haché');
  assert.ok(!JSON.stringify(db.sql.prepare('SELECT * FROM journal').all()).includes(jeton), 'jamais au journal');
  assert.deepEqual(buildSnapshot(db, mehdi).agendaJeton, { creeLe: ligne.creeLe });
  assert.equal(buildSnapshot(db, personne(6, 'collaborateur')).agendaJeton, null);
  // Absence de santé, entretien planifié, déplacement : publiés, l'absence sous « Absent ».
  db.insert('absences', { empId: 2, type: 'MALADIE', du: '2026-11-02', au: '2026-11-04', statut: 'validee', keystone: false, justificatif: true });
  db.insert('voyages', { empId: 2, dest: 'MA', depart: '2026-11-16', retour: '2026-11-20', motif: 'Chantier Tanger', origine: 'cursus' });
  const f = await lire(`/api/agenda/${jeton}.ics`);
  assert.equal(f.status, 200);
  assert.match(String(f.headers['content-type']), /^text\/calendar/);
  assert.match(f.corps, /^BEGIN:VCALENDAR\r\n/);
  assert.doesNotMatch(f.corps, /METHOD:/, 'abonnement : sans méthode');
  assert.match(f.corps, /SUMMARY:Absent/);
  assert.doesNotMatch(f.corps, /[Mm]aladie|Arrêt/);
  assert.match(f.corps, /SUMMARY:Déplacement : Maroc/);
  assert.equal((f.corps.match(/BEGIN:VEVENT/g) ?? []).length, (f.corps.match(/END:VEVENT/g) ?? []).length);
  assert.ok(db.where<Record<string, any>>('jetonsAgenda', 'empId', 2).at(-1)!.dernierAcces, 'dernier accès noté');
  // Contenu réglé : sans les absences.
  reglages({ agendaContenu: ['deplacements'] });
  const g = await lire(`/api/agenda/${jeton}.ics`);
  assert.doesNotMatch(g.corps, /SUMMARY:Absent/);
  assert.match(g.corps, /Déplacement/);
  reglages({ agendaContenu: ['sessions', 'entretiens', 'absences', 'deplacements'] });
  // Jeton mal formé, inconnu : 404, même réponse.
  const inconnu = await lire(`/api/agenda/${'A'.repeat(43)}.ics`);
  const malForme = await lire('/api/agenda/abc.ics');
  assert.equal(inconnu.status, 404);
  assert.equal(malForme.status, 404);
  assert.equal(inconnu.corps, malForme.corps);
  // Nouveau jeton : l'ancien ne vaut plus ; révocation par le salarié, puis par l'administrateur RH.
  const nouveau: string = agir(mehdi, 'agenda.creerJeton', {}).result.jeton;
  assert.equal((await lire(`/api/agenda/${jeton}.ics`)).status, 404);
  assert.equal((await lire(`/api/agenda/${nouveau}.ics`)).status, 200);
  assert.match(agir(mehdi, 'agenda.revoquerJeton', {}).message, /révoqué/);
  assert.equal((await lire(`/api/agenda/${nouveau}.ics`)).status, 404);
  const troisieme: string = agir(mehdi, 'agenda.creerJeton', {}).result.jeton;
  assert.throws(() => agir(personne(14, 'rh'), 'agenda.revoquerTout', {}), (e: unknown) => e instanceof ActionError && e.status === 403);
  assert.match(agir(personne(null, 'rh'), 'agenda.revoquerTout', {}).message, /^1 abonnement révoqué/);
  assert.equal((await lire(`/api/agenda/${troisieme}.ics`)).status, 404);
  // Flux désactivé ensuite : 404 ; compte désactivé ou salarié sorti : 404.
  const q: string = agir(mehdi, 'agenda.creerJeton', {}).result.jeton;
  reglages({ agendaFluxActif: false });
  assert.equal((await lire(`/api/agenda/${q}.ics`)).status, 404);
  reglages({ agendaFluxActif: true });
  db.sql.prepare('UPDATE comptes SET actif = 0 WHERE emp_id = 2').run();
  assert.equal((await lire(`/api/agenda/${q}.ics`)).status, 404);
  db.sql.prepare('UPDATE comptes SET actif = 1 WHERE emp_id = 2').run();
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
