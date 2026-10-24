// Astreintes (t049, lot 7, étape 1) : actions astreinte.planifier / modifier / annuler / intervention / retirerIntervention
// sur le jeu de démonstration (Karim Haddad, 12, encadre la Maintenance : Mehdi Benali, 2, et Thomas Garnier, 6 ; horaire J
// proposé), le 10 octobre 2026 : contrôles, e-mail au salarié avec l'événement d'agenda (.ics), manager prévenu quand le
// service RH agit, journal sans texte libre, ligne INT-AST de la feuille de temps (heures, nuit, repos après une
// intervention), grille protégée, instantanés par profil, migration nommée et références.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { json, nouvelleBase, PG, SQLITE_SEUL, sqlite } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { ASTREINTES_ACTIVITE_INDEX } = await import('../server/src/migrations/lot7-astreintes.ts');
const { controlerOrphelins, REFERENCES } = await import('../server/src/integrite.ts');
const { TRAITEMENTS } = await import('../server/src/conservation.ts');
const { Domain } = await import('../shared/domain.ts');
const { calcSheet } = await import('../shared/rules/temps.ts');
const { horloge } = await import('../server/src/astreintes.ts');
/** Heure présente des actions (heure de Paris, au jour CURSUS_TODAY) : 9 h par défaut, pour des tests indépendants de l'horloge. */
const aParis = (hhmm: string) => { horloge.maintenant = () => new Date(`2026-10-10T${hhmm}:00+02:00`); };
aParis('09:00');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Dataset = Awaited<ReturnType<typeof loadFull>>;
type Astreinte = NonNullable<Dataset['astreintes']>[number];
type Feuille = Dataset['feuilles'][number];
interface Courriel { a: string[]; objet: string; texte: string; pj?: { nom: string; type: string; base64: string }[] }

const texteDe = (b64: string) => Buffer.from(b64, 'base64').toString('utf8');

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteId = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', (empId ? [empId] : [])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteId(empId), role, methode: 'demo' }))!;
  // Chemin de POST /api/actions/:nom (server/src/app.ts) : action et journal dans une transaction.
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o: { message?: string | null; result?: unknown } = typeof r === 'object' && r !== null ? r as { message?: string; result?: unknown } : { message: r as string | null };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result ?? null });
    return o.message ?? '';
  });
  const refuse = async (u: User, name: string, p: Record<string, unknown>, motif: RegExp, status?: number) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && motif.test(e.message) && (!status || e.status === status), `${name} : ${motif}`);
  const mails = async (type: string) => (await db.all<{ cible: string; type: string; contenu: unknown }>('envois'))
    .filter(e => e.cible === 'email' && e.type === type).map(e => json<Courriel>(e.contenu));
  const journal = async (action: string) => (await db.all<{ action: string; payload: unknown; salaries: unknown }>('journal')).filter(j => j.action === action)
    .map(j => ({ payload: json<Record<string, unknown>>(j.payload), salaries: json<number[]>(j.salaries) }));
  const astreintes = async () => await db.all<Astreinte>('astreintes');
  /** Astreinte écrite directement (dates hors des contrôles de saisie : commencée, passée). */
  const inserer = async (du: string, au: string, o: Partial<Astreinte> = {}) => (await db.insert<Astreinte>('astreintes', {
    empId: 2, equipe: 'Maintenance', du, debut: '18:00', au, fin: '08:00', communiqueLe: '2026-09-20', motif: null, creeLe: '2026-09-20T08:00:00.000Z', creePar: 'Karim Haddad', ...o,
  })).id;
  const feuille = async (week: string, empId = 2) => (await db.all<Feuille>('feuilles')).find(f => f.empId === empId && f.week === week);
  const RH = await user(null, 'rh'), KARIM = await user(12, 'manager'), MEHDI = await user(2, 'collaborateur'), THOMAS = await user(6, 'collaborateur');
  return { db, user, run, refuse, mails, journal, astreintes, inserer, feuille, RH, KARIM, MEHDI, THOMAS };
}

test('planifier : le manager pour son équipe, 15 jours avant ; e-mail au salarié avec l’événement d’agenda ; journal', async () => {
  const { run, refuse, mails, journal, astreintes, db, RH, KARIM, MEHDI, THOMAS } = await fresh();
  const m = await run(KARIM, 'astreinte.planifier', { empId: 2, du: '2026-10-30', debut: '18 h', au: '2026-11-06', fin: '8 h' });
  // Demande de congé de Mehdi en attente le 2 novembre (démonstration) : signalée, sans blocage.
  assert.equal(m, 'Astreinte de Mehdi Benali planifiée du 30 oct. 2026 à 18 h au 6 nov. 2026 à 8 h (158 h) · e-mail envoyé au salarié, avec l’événement d’agenda · Demande d’absence en attente le 2 nov. 2026');
  const [a] = await astreintes();
  assert.deepEqual([a.empId, a.equipe, a.du, a.debut, a.au, a.fin, a.communiqueLe, a.motif, a.creePar, a.annuleLe], [2, 'Maintenance', '2026-10-30', '18:00', '2026-11-06', '08:00', '2026-10-10', null, 'Karim Haddad', null]);
  const [mail] = await mails('astreinte.planifiee');
  assert.match(mail.objet, /^Astreinte du 30 oct\. 2026 à 18 h au 6 nov\. 2026 à 8 h$/);
  assert.match(mail.texte, /^Bonjour Mehdi Benali,\n\nKarim Haddad vous informe de votre astreinte du 30 oct\. 2026 à 18 h au 6 nov\. 2026 à 8 h \(158 h\)\./);
  assert.match(mail.texte, /déclarez-la sur votre feuille de temps « Intervention d’astreinte »|déclarez-la sur votre feuille de temps \(« Intervention d’astreinte »\)/);
  assert.equal(mail.pj![0].nom, 'astreinte-2026-10-30.ics');
  const ics = texteDe(mail.pj![0].base64);
  assert.match(ics, /METHOD:PUBLISH\r\n[\s\S]*BEGIN:VTIMEZONE\r\nTZID:Europe\/Paris[\s\S]*UID:astreinte-1@[^\r]+\r\nDTSTART;TZID=Europe\/Paris:20261030T180000\r\nDTEND;TZID=Europe\/Paris:20261106T080000\r\n/);
  assert.match(ics, /SUMMARY:Astreinte\r\n/);
  // Journal : identifiants, jours, heures, date de communication ; salarié concerné.
  const [j] = await journal('astreinte.planifier');
  assert.deepEqual(j.payload, { empId: 2, id: 1, du: '2026-10-30', debut: '18:00', au: '2026-11-06', fin: '08:00', communiqueLe: '2026-10-10' });
  assert.deepEqual(j.salaries, [2]);
  // Manager qui planifie : rien ne lui est notifié ; le service RH qui planifie : le manager l'est (récapitulatif quotidien).
  assert.equal(await db.count('notifications'), 0);
  await run(RH, 'astreinte.planifier', { empId: 6, du: '2026-11-06', debut: '08:00', au: '2026-11-13', fin: '08:00' });
  const n = await db.all<{ empId: number; type: string; objet: string }>('notifications');
  assert.deepEqual(n.map(x => [x.empId, x.type, x.objet]), [[12, 'astreinte.planifiee', 'Astreinte du 6 nov. 2026 à 8 h au 13 nov. 2026 à 8 h — Thomas Garnier']]);
  assert.match((await mails('astreinte.planifiee'))[1].texte, /Le service RH vous informe de votre astreinte/);
  // Droits : ni le salarié, ni un collègue ; le manager pour son équipe seulement.
  await refuse(MEHDI, 'astreinte.planifier', { empId: 2, du: '2026-11-20', debut: '18:00', au: '2026-11-27', fin: '08:00' }, /manager du salarié ou le service RH/, 403);
  await refuse(THOMAS, 'astreinte.planifier', { empId: 2, du: '2026-11-20', debut: '18:00', au: '2026-11-27', fin: '08:00' }, /manager du salarié ou le service RH/, 403);
  await refuse(KARIM, 'astreinte.planifier', { empId: 3, du: '2026-11-20', debut: '18:00', au: '2026-11-27', fin: '08:00' }, /manager du salarié ou le service RH/, 403);
});

test('planifier : délai court motivé, jour franc, chevauchements, absence, salarié mineur', async () => {
  const { run, refuse, mails, journal, astreintes, db, RH, KARIM } = await fresh();
  const p = { empId: 2, du: '2026-10-16', debut: '18:00', au: '2026-10-19', fin: '08:00' };
  await refuse(KARIM, 'astreinte.planifier', p, /6 jours avant son début, moins que le délai de prévenance de 15 jours.*circonstances exceptionnelles/, 400);
  const m = await run(KARIM, 'astreinte.planifier', { ...p, motif: 'Remplacement de Thomas, arrêt imprévu' });
  assert.match(m, /délai de prévenance de 6 jours : circonstances exceptionnelles notées/);
  assert.equal((await astreintes())[0].motif, 'Remplacement de Thomas, arrêt imprévu');
  assert.match((await mails('astreinte.planifiee'))[0].texte, /circonstances exceptionnelles : Remplacement de Thomas, arrêt imprévu/);
  assert.equal((await journal('astreinte.planifier'))[0].payload.motif, '[texte renseigné]', 'jamais le texte du motif au journal');
  // Moins d'un jour franc : refus, même motivé.
  await refuse(KARIM, 'astreinte.planifier', { ...p, du: '2026-10-11', au: '2026-10-12', motif: 'Panne' }, /un jour franc au moins/);
  // Chevauchement avec l'astreinte planifiée ; à la suite, permis.
  await refuse(KARIM, 'astreinte.planifier', { ...p, du: '2026-10-18', au: '2026-10-21', motif: 'Panne' }, /déjà planifiée du 16 oct\. 2026 à 18 h au 19 oct\. 2026 à 8 h/);
  await run(KARIM, 'astreinte.planifier', { ...p, du: '2026-10-19', debut: '08:00', au: '2026-10-21', motif: 'Panne' });
  // Absence validée de Mehdi : refus.
  await db.insert('absences', { empId: 2, type: 'CP', du: '2026-11-23', au: '2026-11-27', statut: 'validee', keystone: false, justificatif: false });
  await refuse(KARIM, 'astreinte.planifier', { ...p, du: '2026-11-20', au: '2026-11-24' }, /Absence validée du 23 nov\. au 27 nov\. 2026 : le salarié est absent/);
  // Salarié de moins de 18 ans : refus, sauf réglage contraire de l'administrateur RH.
  await db.update('employes', 2, { naissance: 2009, naissanceLe: '2009-06-01' });
  await refuse(KARIM, 'astreinte.planifier', { ...p, du: '2026-12-04', au: '2026-12-07' }, /moins de 18 ans : pas d’astreinte/);
  await run(RH, 'parametres.maj', { astreinteMineurs: true });
  await run(KARIM, 'astreinte.planifier', { ...p, du: '2026-12-04', au: '2026-12-07' });
  // Le service RH ne planifie pas sa propre astreinte (Antoine Leroy, gestionnaire RH).
  const ANTOINE = await (async () => { const u = await currentUser(db, { compteId: (await db.one('SELECT id FROM comptes WHERE emp_id = 14') as { id: number }).id, role: 'rh', methode: 'demo' }); return u!; })();
  await refuse(ANTOINE, 'astreinte.planifier', { empId: 14, du: '2026-11-06', debut: '18:00', au: '2026-11-13', fin: '08:00' }, /Astreinte pour vous-même/, 403);
});

test('modifier : nouvelle communication, e-mail de mise à jour (même événement) ; commencée, fin avancée seulement', async () => {
  const { run, refuse, mails, journal, astreintes, inserer, KARIM, RH } = await fresh();
  await run(KARIM, 'astreinte.planifier', { empId: 2, du: '2026-10-30', debut: '18:00', au: '2026-11-06', fin: '08:00' });
  assert.equal(await run(KARIM, 'astreinte.modifier', { id: 1, au: '2026-11-06', fin: '08:00' }), 'Aucune modification');
  const m = await run(KARIM, 'astreinte.modifier', { id: 1, au: '2026-11-05' });
  assert.match(m, /^Astreinte de Mehdi Benali modifiée : du 30 oct\. 2026 à 18 h au 5 nov\. 2026 à 8 h \(134 h\) · e-mail envoyé/);
  const [maj] = await mails('astreinte.modifiee');
  assert.match(maj.texte, /Karim Haddad modifie votre astreinte \(prévue du 30 oct\. 2026 à 18 h au 6 nov\. 2026 à 8 h\) : elle a lieu du 30 oct\. 2026 à 18 h au 5 nov\. 2026 à 8 h/);
  assert.match(texteDe(maj.pj![0].base64), /METHOD:PUBLISH[\s\S]*UID:astreinte-1@[\s\S]*DTEND;TZID=Europe\/Paris:20261105T080000/);
  const [rien, j] = await journal('astreinte.modifier');
  assert.deepEqual([rien.payload, j.payload.id, j.payload.avant, j.payload.apres], [{ id: 1 }, 1, { au: '2026-11-06' }, { au: '2026-11-05' }]);
  // Rapprochée sous le délai : motif exigé, puis gardé (masqué au journal).
  await refuse(KARIM, 'astreinte.modifier', { id: 1, du: '2026-10-20', au: '2026-10-23' }, /circonstances exceptionnelles/);
  await run(KARIM, 'astreinte.modifier', { id: 1, du: '2026-10-20', au: '2026-10-23', motif: 'Arrêt technique avancé' });
  const a = (await astreintes())[0];
  assert.deepEqual([a.du, a.au, a.motif, a.communiqueLe, a.modifiePar], ['2026-10-20', '2026-10-23', 'Arrêt technique avancé', '2026-10-10', 'Karim Haddad']);
  assert.deepEqual((await journal('astreinte.modifier'))[2].payload.apres, { du: '2026-10-20', au: '2026-10-23', motif: '[texte renseigné]' });
  // Commencée (du 9 au 16 octobre) : fin avancée, jamais reculée, ni début changé.
  const id = await inserer('2026-10-09', '2026-10-16');
  await refuse(KARIM, 'astreinte.modifier', { id, au: '2026-10-20' }, /pas reculée/);
  await refuse(KARIM, 'astreinte.modifier', { id, du: '2026-10-08' }, /seule sa fin peut être avancée/);
  assert.match(await run(RH, 'astreinte.modifier', { id, au: '2026-10-12' }), /au 12 oct\. 2026 à 8 h .* · fin avancée · e-mail envoyé/);
  // Terminée ou annulée : 409.
  const passee = await inserer('2026-09-25', '2026-10-02');
  await refuse(KARIM, 'astreinte.modifier', { id: passee, au: '2026-10-01' }, /Astreinte terminée/, 409);
});

test('collaborateur tiers : refus sans détail, identique à un identifiant inconnu (ni dates, ni interventions, ni état)', async () => {
  const { run, refuse, inserer, RH, THOMAS } = await fresh();
  const astreinteId = await inserer('2026-10-05', '2026-10-07');
  await run(RH, 'astreinte.intervention', { astreinteId, jour: '2026-10-05', debut: '22:00', fin: '23:00' });
  const annulee = await inserer('2026-10-20', '2026-10-27', { annuleLe: '2026-10-01T08:00:00.000Z', annulePar: 'Karim Haddad', annuleMotif: 'Reporté' });
  const refus = /^Astreinte introuvable ou hors de votre périmètre$/;
  // Hors de l'astreinte, chevauchant l'intervention déclarée, astreinte annulée, identifiant inconnu : même refus.
  await refuse(THOMAS, 'astreinte.intervention', { astreinteId, jour: '2026-10-01', debut: '22:00', fin: '23:00' }, refus, 403);
  await refuse(THOMAS, 'astreinte.intervention', { astreinteId, jour: '2026-10-05', debut: '22:30', fin: '23:30' }, refus, 403);
  await refuse(THOMAS, 'astreinte.intervention', { astreinteId: annulee, jour: '2026-10-21', debut: '22:00', fin: '23:00' }, refus, 403);
  await refuse(THOMAS, 'astreinte.intervention', { astreinteId: 999, jour: '2026-10-05', debut: '22:00', fin: '23:00' }, refus, 403);
  for (const name of ['astreinte.modifier', 'astreinte.annuler']) {
    await refuse(THOMAS, name, { id: astreinteId, au: '2026-10-06', motif: 'x' }, refus, 403);
    await refuse(THOMAS, name, { id: 999, au: '2026-10-06', motif: 'x' }, refus, 403);
  }
  await refuse(THOMAS, 'astreinte.retirerIntervention', { id: 1 }, /^Intervention introuvable ou hors de votre périmètre$/, 403);
  await refuse(THOMAS, 'astreinte.retirerIntervention', { id: 999 }, /^Intervention introuvable ou hors de votre périmètre$/, 403);
  // Le service RH, qui voit tout : 404 pour un identifiant inconnu.
  await refuse(RH, 'astreinte.intervention', { astreinteId: 999, jour: '2026-10-05', debut: '22:00', fin: '23:00' }, /^Astreinte introuvable$/, 404);
});

test('commencée à l’heure de son début : annulée le jour même avant ; raccourcie sans délai de prévenance', async () => {
  const { run, refuse, mails, astreintes, inserer, KARIM } = await fresh();
  // Astreinte du 10 octobre (aujourd'hui) à 18 h : à 9 h, elle s'annule encore (salarié malade) ; à 19 h, 409.
  const ce = await inserer('2026-10-10', '2026-10-17', { communiqueLe: '2026-09-20' });
  aParis('19:00');
  await refuse(KARIM, 'astreinte.annuler', { id: ce, motif: 'Arrêt maladie' }, /Astreinte commencée/, 409);
  // Commencée : fin avancée jusqu'à maintenant (19 h), pas avant.
  await refuse(KARIM, 'astreinte.modifier', { id: ce, au: '2026-10-10', fin: '18:30' }, /maintenant au plus tôt \(10 oct\. 2026 à 19 h\)/);
  aParis('09:00');
  assert.match(await run(KARIM, 'astreinte.annuler', { id: ce, motif: 'Arrêt maladie' }), /^Astreinte de Mehdi Benali du 10 oct\. 2026 à 18 h au 17 oct\. 2026 à 8 h annulée/);
  // Astreinte de demain : fin avancée (réduction) permise malgré le jour franc ; communication d'origine gardée.
  const demain = await inserer('2026-10-11', '2026-10-18', { communiqueLe: '2026-09-20' });
  assert.match(await run(KARIM, 'astreinte.modifier', { id: demain, au: '2026-10-14' }), /modifiée : du 11 oct\. 2026 à 18 h au 14 oct\. 2026 à 8 h \(62 h\) · e-mail envoyé/);
  assert.equal((await astreintes()).find(a => a.id === demain)!.communiqueLe, '2026-09-20');
  assert.match((await mails('astreinte.modifiee'))[0].texte, /elle a lieu du 11 oct\. 2026 à 18 h au 14 oct\. 2026 à 8 h/);
  // Avancée ou prolongée : nouvelle programmation, jour franc exigé.
  await refuse(KARIM, 'astreinte.modifier', { id: demain, au: '2026-10-16' }, /trop tard/);
});

test('absences et sortie après coup : congé non validé pendant une astreinte, arrêt et sortie signalés', async () => {
  const { run, refuse, db, KARIM, RH, MEHDI } = await fresh();
  await run(KARIM, 'astreinte.planifier', { empId: 2, du: '2026-10-30', debut: '18:00', au: '2026-11-06', fin: '08:00' });
  // Demande de congé du 2 novembre (démonstration) : sa validation est refusée tant que l'astreinte tient.
  const demande = (await db.all<{ id: number; empId: number; statut: string; du: string }>('absences')).find(a => a.empId === 2 && a.statut === 'demandee' && a.du === '2026-11-02')!;
  await refuse(KARIM, 'absence.decider', { id: demande.id, ok: true }, /^Astreinte du 30 oct\. 2026 à 18 h au 6 nov\. 2026 à 8 h : annulez-la ou raccourcissez-la avant de valider cette absence$/);
  // Nouvelle demande du salarié : l'astreinte lui est signalée ; posée par le manager (validée d'emblée) : refusée.
  assert.match(await run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-11-05', au: '2026-11-05' }), / · Astreinte du 30 oct\. 2026 à 18 h au 6 nov\. 2026 à 8 h : à annuler ou raccourcir avant la validation$/);
  await refuse(KARIM, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-11-04', au: '2026-11-04' }, /annulez-la ou raccourcissez-la avant de valider/);
  // Arrêt signalé : jamais refusé, l'astreinte est signalée.
  assert.match(await run(KARIM, 'absence.signaler', { empId: 2, du: '2026-11-03', au: '2026-11-03' }), / · Astreinte du 30 oct\. 2026 à 18 h au 6 nov\. 2026 à 8 h : à annuler ou raccourcir$/);
  // Astreinte raccourcie au 2 novembre 8 h : le congé du 2 se valide (chevauchement au jour près : fin le 1er).
  await run(KARIM, 'astreinte.modifier', { id: 1, au: '2026-11-01', fin: '20:00' });
  assert.match(await run(KARIM, 'absence.decider', { id: demande.id, ok: true }), /validée/);
  // Sortie au 31 octobre : l'astreinte qui finit après est signalée.
  assert.match(await run(RH, 'employe.sortie', { id: 2, date: '2026-10-31', motif: 'demission' }), / · Astreinte du 30 oct\. 2026 à 18 h au 1 nov\. 2026 à 20 h : à annuler ou raccourcir$/);
});

test('annuler : motif obligatoire, annulation de l’événement d’agenda ; commencée : 409', async () => {
  const { run, refuse, mails, journal, astreintes, inserer, db, KARIM, RH } = await fresh();
  await run(KARIM, 'astreinte.planifier', { empId: 2, du: '2026-10-30', debut: '18:00', au: '2026-11-06', fin: '08:00' });
  await refuse(KARIM, 'astreinte.annuler', { id: 1 }, /motif de l’annulation/);
  assert.match(await run(RH, 'astreinte.annuler', { id: 1, motif: 'Arrêt technique reporté' }), /^Astreinte de Mehdi Benali du 30 oct\. 2026 à 18 h au 6 nov\. 2026 à 8 h annulée · e-mail envoyé/);
  const a = (await astreintes())[0];
  assert.deepEqual([!!a.annuleLe, a.annulePar, a.annuleMotif], [true, 'Sandrine Vidal', 'Arrêt technique reporté']);
  const [c] = await mails('astreinte.annulee');
  assert.match(c.texte, /Le service RH annule votre astreinte du 30 oct\. 2026 à 18 h au 6 nov\. 2026 à 8 h\.\n\nMotif : Arrêt technique reporté\n/);
  assert.equal(c.pj![0].nom, 'annulation-astreinte-2026-10-30.ics');
  assert.match(texteDe(c.pj![0].base64), /METHOD:CANCEL[\s\S]*UID:astreinte-1@[\s\S]*STATUS:CANCELLED/);
  assert.deepEqual((await journal('astreinte.annuler'))[0].payload.apres, { annuleLe: a.annuleLe, annuleMotif: '[texte renseigné]' });
  assert.equal(await run(KARIM, 'astreinte.annuler', { id: 1, motif: 'x' }), 'Astreinte déjà annulée');
  await refuse(KARIM, 'astreinte.modifier', { id: 1, au: '2026-11-05' }, /Astreinte annulée/, 409);
  // Une astreinte annulée ne bloque plus le créneau.
  await run(KARIM, 'astreinte.planifier', { empId: 2, du: '2026-10-30', debut: '18:00', au: '2026-11-06', fin: '08:00' });
  const id = await inserer('2026-10-09', '2026-10-16');
  await refuse(KARIM, 'astreinte.annuler', { id, motif: 'Panne réparée' }, /avancez sa fin/, 409);
  assert.equal(await db.count('astreintes'), 3, 'jamais supprimée');
});

test('intervention : ligne INT-AST de la feuille, heures de nuit, repos dû après sa fin ; retrait ; grille protégée', async () => {
  const { run, refuse, journal, inserer, feuille, db, KARIM, MEHDI, THOMAS, RH } = await fresh();
  const astreinteId = await inserer('2026-10-05', '2026-10-09');
  const base = { empId: 2, week: '2026-10-05' };
  // Mehdi saisit 7 h le lundi et le mardi (horaire J de la Maintenance : 8 h – 16 h).
  await run(MEHDI, 'temps.addLine', { ...base, projet: 'INT-MAINT' });
  await run(MEHDI, 'temps.setCell', { ...base, li: 0, di: 0, value: '7' });
  await run(MEHDI, 'temps.setCell', { ...base, li: 0, di: 1, value: '7' });
  const m = await run(MEHDI, 'astreinte.intervention', { astreinteId, jour: '2026-10-05', debut: '23:00', fin: '01:30' });
  assert.match(m, /^Intervention d’astreinte de Mehdi Benali déclarée le 5 oct\. 2026 de 23 h à 1 h 30 \(2,5 h\) : heures ajoutées à la feuille de temps · Repos quotidien de 11 h consécutives \(art\. L3131-1\) non respecté : 6,5 h avant le mar\. 6 oct\. \(fin de l’intervention d’astreinte à 1 h 30, reprise à 8 h/);
  let sh = (await feuille('2026-10-05'))!;
  assert.deepEqual(sh.lignes.map(l => [l.projet, l.tache, l.ks, l.h]), [['INT-MAINT', 'Maintenance interne', false, [7, 7, 0, 0, 0, 0, 0]], ['INT-AST', 'Intervention d’astreinte', false, [2.5, 0, 0, 0, 0, 0, 0]]]);
  const x = (await db.all<{ id: number; astreinteId: number; empId: number; jour: string; debut: string; fin: string; heures: number; declarePar: string }>('astreinteInterventions'))[0];
  assert.deepEqual([x.astreinteId, x.empId, x.jour, x.debut, x.fin, x.heures, x.declarePar], [astreinteId, 2, '2026-10-05', '23:00', '01:30', 2.5, 'Mehdi Benali']);
  // Décompte : travail effectif (9,5 h le lundi), 2,5 h de nuit, repos à motiver à la soumission.
  const d = new Domain(await loadFull(db, RH)), c = calcSheet(d, d.emp(2)!, sh);
  assert.deepEqual([c.perDay[0], c.total, c.nuit, c.nuitParJour[0]], [9.5, 16.5, 2.5, 2.5]);
  assert.equal(c.reposQuotidien.length, 1);
  await refuse(MEHDI, 'temps.submit', base, /Repos quotidien.*indiquez le motif du dépassement/);
  const [j] = await journal('astreinte.intervention');
  assert.deepEqual([j.payload, j.salaries], [{ astreinteId, jour: '2026-10-05', debut: '23:00', fin: '01:30', id: x.id, heures: 2.5 }, [2]]);
  // Grille : la ligne INT-AST ne se saisit, ne s'ajoute ni ne se supprime à la main.
  await refuse(MEHDI, 'temps.setCell', { ...base, li: 1, di: 0, value: '4' }, /se déclarent avec ses heures de début et de fin/);
  await refuse(MEHDI, 'temps.addLine', { empId: 2, week: '2026-10-12', projet: 'INT-AST' }, /se déclarent avec ses heures de début et de fin/);
  await refuse(MEHDI, 'temps.removeLine', { ...base, li: 1, projet: 'INT-AST' }, /retirez d’abord les interventions/);
  // Contrôles : hors de l'astreinte, à venir, chevauchement, collègue, absence.
  await refuse(MEHDI, 'astreinte.intervention', { astreinteId, jour: '2026-10-05', debut: '17:00', fin: '18:30' }, /en dehors de l’astreinte/);
  await refuse(MEHDI, 'astreinte.intervention', { astreinteId, jour: '2026-10-06', debut: '00:30', fin: '02:00' }, /déjà déclarée le 5 oct\. 2026 de 23 h à 1 h 30/);
  await refuse(THOMAS, 'astreinte.intervention', { astreinteId, jour: '2026-10-07', debut: '20:00', fin: '21:00' }, /^Astreinte introuvable ou hors de votre périmètre$/, 403);
  const futur = await inserer('2026-10-10', '2026-10-12');
  await refuse(MEHDI, 'astreinte.intervention', { astreinteId: futur, jour: '2026-10-11', debut: '20:00', fin: '21:00' }, /jour à venir refusé/);
  await db.insert('absences', { empId: 2, type: 'RTT', du: '2026-10-08', au: '2026-10-08', statut: 'validee', keystone: false, justificatif: false });
  await refuse(KARIM, 'astreinte.intervention', { astreinteId, jour: '2026-10-08', debut: '20:00', fin: '21:00' }, /Absence validée ce jour-là/);
  // Le manager déclare une seconde intervention (mercredi soir), puis la retire.
  await run(KARIM, 'astreinte.intervention', { astreinteId, jour: '2026-10-07', debut: '20:00', fin: '21:15' });
  sh = (await feuille('2026-10-05'))!;
  assert.deepEqual(sh.lignes[1].h, [2.5, 0, 1.25, 0, 0, 0, 0]);
  const seconde = (await db.all<{ id: number; jour: string }>('astreinteInterventions')).find(i => i.jour === '2026-10-07')!;
  assert.equal(await run(KARIM, 'astreinte.retirerIntervention', { id: seconde.id }), 'Intervention d’astreinte de Mehdi Benali du 7 oct. 2026 retirée (1,3 h retirées de la feuille de temps)');
  assert.deepEqual((await feuille('2026-10-05'))!.lignes[1].h, [2.5, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual((await journal('astreinte.retirerIntervention'))[0].payload.avant, { astreinteId, jour: '2026-10-07', debut: '20:00', fin: '21:15', heures: 1.25 });
  // Dernière intervention retirée : la ligne INT-AST disparaît.
  await run(MEHDI, 'astreinte.retirerIntervention', { id: x.id });
  assert.deepEqual((await feuille('2026-10-05'))!.lignes.map(l => l.projet), ['INT-MAINT']);
  assert.equal(await db.count('astreinteInterventions'), 0);
  // Feuille soumise : plus de déclaration par le salarié (son valideur corrige).
  await run(MEHDI, 'temps.submit', base);
  await refuse(MEHDI, 'astreinte.intervention', { astreinteId, jour: '2026-10-05', debut: '23:00', fin: '01:30' }, /déjà soumise ou validée/);
  assert.match(await run(KARIM, 'astreinte.intervention', { astreinteId, jour: '2026-10-05', debut: '23:00', fin: '01:30' }), /déclarée/);
  assert.equal((await feuille('2026-10-05'))!.statut, 'soumise');
});

test('soumission après une intervention : motif du repos exigé, contrôle tracé au journal (code seul)', async () => {
  const { run, refuse, journal, inserer, MEHDI } = await fresh();
  const astreinteId = await inserer('2026-10-05', '2026-10-09'), base = { empId: 2, week: '2026-10-05' };
  await run(MEHDI, 'temps.addLine', { ...base, projet: 'INT-MAINT' });
  for (const di of [0, 1, 2, 3, 4]) await run(MEHDI, 'temps.setCell', { ...base, li: 0, di, value: '7' });
  await run(MEHDI, 'astreinte.intervention', { astreinteId, jour: '2026-10-06', debut: '22:00', fin: '02:00' });
  await refuse(MEHDI, 'temps.submit', base, /6 h avant le mer\. 7 oct\. \(fin de l’intervention d’astreinte à 2 h/);
  await run(MEHDI, 'temps.submit', { ...base, motif: 'Panne du compresseur, reprise décalée impossible' });
  const [j] = await journal('temps.submit');
  assert.deepEqual([j.payload.heures, j.payload.motifDepassement, j.payload.reposNuit], [39, '[texte renseigné]', ['repos_quotidien']]);
});

test('instantanés : manager et salarié (motifs compris), paie et lecture seule (sans motif), rien pour le référent HSE', async () => {
  const { run, inserer, db, user, KARIM, MEHDI, THOMAS } = await fresh();
  await run(KARIM, 'astreinte.planifier', { empId: 2, du: '2026-10-16', debut: '18:00', au: '2026-10-19', fin: '08:00', motif: 'Panne de la ligne 2' });
  const annulee = await inserer('2026-11-20', '2026-11-27', { annuleLe: '2026-10-01T08:00:00.000Z', annulePar: 'Karim Haddad', annuleMotif: 'Arrêt technique reporté' });
  const astreinteId = await inserer('2026-10-05', '2026-10-09');
  await run(MEHDI, 'astreinte.intervention', { astreinteId, jour: '2026-10-05', debut: '23:00', fin: '01:30' });
  const vue = async (u: User) => await buildSnapshot(db, u);
  const k = await vue(KARIM);
  assert.deepEqual(k.astreintes!.map(a => [a.id, a.motif, a.annuleMotif]), [[1, 'Panne de la ligne 2', null], [annulee, null, 'Arrêt technique reporté'], [astreinteId, null, null]]);
  assert.equal(k.interventionsAstreinte!.length, 1);
  assert.equal((await vue(MEHDI)).astreintes!.length, 3);
  assert.deepEqual([(await vue(THOMAS)).astreintes, (await vue(THOMAS)).interventionsAstreinte], [[], []], 'collègue : rien de Mehdi');
  for (const [empId, attendu] of [[7, 3], [11, 3], [23, 0]] as const) {
    const s = await vue(await user(empId, 'rh'));
    assert.equal(s.astreintes!.length, attendu);
    assert.ok(s.astreintes!.every(a => !a.motif && !a.annuleMotif), 'aucun motif hors du service RH, du manager et du salarié');
    assert.equal(s.interventionsAstreinte!.length, attendu ? 1 : 0);
  }
});

test('références, conservation et migration nommée (activité INT-AST, index)', async () => {
  const { run, db, KARIM } = await fresh();
  for (const [t, c] of [['astreintes', 'emp_id'], ['astreinte_interventions', 'emp_id'], ['astreinte_interventions', 'astreinte_id']]) {
    assert.ok(REFERENCES.some(r => r.table === t && r.colonne === c), `${t}.${c} dans REFERENCES`);
  }
  assert.deepEqual([TRAITEMENTS['astreintes.emp_id'], TRAITEMENTS['astreinte_interventions.emp_id']], [{ mode: 'textes', categorie: 'temps' }, { mode: 'gardee' }]);
  await run(KARIM, 'astreinte.planifier', { empId: 2, du: '2026-10-30', debut: '18:00', au: '2026-11-06', fin: '08:00' });
  assert.equal((await controlerOrphelins(db)).orphelins, 0);
  assert.ok(await db.one(`SELECT 1 FROM projets WHERE code = 'INT-AST' AND statut = 'actif'`), 'activité amorcée par la démonstration (et une base PostgreSQL neuve)');
});

test('migration lot7-astreintes-activite-index : activité INT-AST ajoutée à une base qui ne l’a pas, une fois', { skip: PG && SQLITE_SEUL }, async () => {
  const { db } = await fresh();
  // Base neuve : migrations nommées appliquées (la nôtre comprise, sans effet sur l'activité déjà amorcée), puis plus rien.
  assert.ok((await appliquerMigrations(sqlite(db))).includes(ASTREINTES_ACTIVITE_INDEX.nom));
  assert.deepEqual(await appliquerMigrations(sqlite(db)), []);
  // Base d'avant le lot 7 : ni l'activité, ni les index.
  await db.run(`DELETE FROM projets WHERE code = 'INT-AST'`);
  await db.exec('DROP INDEX astreintes_emp');
  assert.equal(await ASTREINTES_ACTIVITE_INDEX.necessaire!(sqlite(db)), true);
  assert.match(String(await db.tx(async () => await ASTREINTES_ACTIVITE_INDEX.executer(sqlite(db)))), /^activité interne INT-AST ajoutée, index astreintes_emp/);
  assert.deepEqual({ ...await db.one(`SELECT nom, statut FROM projets WHERE code = 'INT-AST'`) }, { nom: 'Intervention d’astreinte', statut: 'actif' });
  assert.equal(await ASTREINTES_ACTIVITE_INDEX.necessaire!(sqlite(db)), false);
  // Activité archivée par le service RH : jamais rétablie.
  await db.run(`UPDATE projets SET statut = 'archive' WHERE code = 'INT-AST'`);
  await db.tx(async () => await ASTREINTES_ACTIVITE_INDEX.executer(sqlite(db)));
  assert.equal((await db.one(`SELECT statut FROM projets WHERE code = 'INT-AST'`) as { statut: string }).statut, 'archive');
});
