// Tests : sessions de formation sur plusieurs jours (t118, lot 5) — dernier jour, jours et horaires (contrôles communs au
// dialogue et au serveur), création et modification, conflits et contrat sur toute la plage, clôture datée du dernier
// jour, invitation d'agenda (.ics) en journées entières ou à l'heure de Paris, heures de formation proposées dans la
// feuille de temps (ligne interne INT-FORM, jamais envoyée à Keystone), réglage, migration nommée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_PUBLIC_URL = 'https://cursus.example.fr';
for (const k of ['CURSUS_MAIL_FROM', 'CURSUS_MAIL_TENANT', 'CURSUS_MAIL_CLIENT_ID', 'CURSUS_MAIL_CLIENT_SECRET']) delete process.env[k];

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { calendrier } = await import('../server/src/integrations/email.ts');
const { heuresKeystone } = await import('../server/src/integrations/keystone.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const journal = await import('../server/src/journal.ts');
const { REGLES } = journal;
const { CHAMP_LABEL } = await import('../shared/journal.ts');
const { ACTIVITE_FORMATION_PROJET, PLAGE_SESSIONS } = await import('../server/src/migrations/formations.ts');
const { Domain } = await import('../shared/domain.ts');
const { ACTIVITES_INTERNES } = await import('../shared/constants.ts');
const { conflitsDates, conflitsSession } = await import('../shared/rules/conflits.ts');
const { dureeHeures, formationsAProposer, fusionProposition, lignesFormation } = await import('../shared/rules/formations-temps.ts');
const {
  completerSession, controlePlage, decalerPlage, finSession, heuresHoraire, joursOuvres, joursSession, joursTexte, plageCourte, plageTexte, sessionDu,
} = await import('../shared/rules/plage-session.ts');
const { controleSession, etatInscription } = await import('../shared/rules/sessions.ts');
const { suggestLines } = await import('../shared/rules/temps.ts');
type User = Parameters<typeof buildSnapshot>[1];
type Envoi = import('../shared/types.ts').Envoi;
type Courriel = import('../shared/types.ts').Courriel;

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const HSE = { role: 'rh', empId: null, nom: 'Référent HSE', intitule: '', profilRh: 'referent_hse' } as User;

function le<T>(date: string, fn: () => T): T {
  const avant = process.env.CURSUS_TODAY;
  process.env.CURSUS_TODAY = date;
  try { return fn(); } finally { process.env.CURSUS_TODAY = avant; }
}

function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const run = (user: User, name: string, payload: Record<string, unknown>) => db.tx(() => ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload));
  const refused = (user: User, name: string, payload: Record<string, unknown>, motif: RegExp) =>
    assert.throws(() => run(user, name, payload), (e: unknown) => e instanceof ActionError && motif.test(e.message), `${name} devait être refusé (${motif})`);
  const domain = () => new Domain(loadFull(db, RH));
  const session = (id: number) => domain().session(id)!;
  const mails = (type: string) => db.all<Envoi>('envois').filter(e => e.cible === 'email' && e.type === type).map(e => e.contenu as unknown as Courriel);
  return { db, run, refused, domain, session, mails };
}
const texteDe = (base64: string) => Buffer.from(base64, 'base64').toString('utf8');
const message = (r: unknown) => String(typeof r === 'object' && r ? (r as { message: string }).message : r);

// — Règles de la plage —

test('plage : jours ouvrés par défaut (week-end et fériés sautés), premier et dernier jour toujours compris', () => {
  // Du jeudi 29 octobre au mardi 3 novembre 2026 : le 1er novembre (dimanche, férié) et le week-end sautés.
  assert.deepEqual(joursOuvres('2026-10-29', '2026-11-03'), ['2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03']);
  // Le mercredi 11 novembre est férié ; une session qui commence un samedi le garde.
  assert.deepEqual(joursOuvres('2026-11-10', '2026-11-12'), ['2026-11-10', '2026-11-12']);
  assert.deepEqual(joursOuvres('2026-11-14', '2026-11-16'), ['2026-11-14', '2026-11-16']);
  assert.deepEqual(joursOuvres('2026-11-18', '2026-11-18'), ['2026-11-18']);
  // Session d'une base ancienne (ni fin ni jours) : un jour ; jours enregistrés hors de la plage écartés.
  const ancienne = { date: '2026-11-18' };
  assert.equal(finSession(ancienne), '2026-11-18');
  assert.deepEqual(joursSession(ancienne), ['2026-11-18']);
  assert.deepEqual(completerSession({ ...ancienne, fin: null as unknown as string, jours: null as unknown as string[], horaires: null as never }),
    { date: '2026-11-18', fin: '2026-11-18', jours: ['2026-11-18'], horaires: [] });
  assert.deepEqual(joursSession({ date: '2026-11-20', fin: '2026-11-23', jours: ['2026-11-23', '2026-11-20', '2026-11-30'] }), ['2026-11-20', '2026-11-23']);
  assert.deepEqual(decalerPlage({ date: '2026-11-20', fin: '2026-11-23', jours: ['2026-11-20', '2026-11-23'], horaires: [] }, 7),
    { fin: '2026-11-30', jours: ['2026-11-27', '2026-11-30'], horaires: [] });
  // Textes : un jour, plusieurs jours, horaires.
  const caces = { date: '2026-10-21', fin: '2026-10-23', jours: ['2026-10-21', '2026-10-22', '2026-10-23'], horaires: [{ debut: '08:30', fin: '16:30', pause: 60 }] };
  assert.equal(plageTexte(ancienne), 'le 18 nov. 2026');
  assert.equal(plageTexte(caces), 'du 21 oct. au 23 oct. 2026 · 3 jours');
  assert.equal(plageTexte(caces, { horaires: true }), 'du 21 oct. au 23 oct. 2026 · 3 jours · 8 h 30 – 16 h 30 (pause 60 min)');
  assert.equal(plageCourte(caces), '21 oct. → 23 oct. 2026');
  assert.equal(sessionDu(ancienne), 'du 18 nov. 2026');
  assert.deepEqual(joursTexte(caces), ['mer. 21 oct. · 8 h 30 – 16 h 30 (pause 60 min)', 'jeu. 22 oct. · 8 h 30 – 16 h 30 (pause 60 min)', 'ven. 23 oct. · 8 h 30 – 16 h 30 (pause 60 min)']);
  assert.equal(heuresHoraire(caces.horaires[0]), 7);
});

test('plage : contrôles du dernier jour, des jours et des horaires (dialogue et serveur)', () => {
  const ok = (v: Parameters<typeof controlePlage>[1]) => { const r = controlePlage('2026-10-21', v); assert.ok('plage' in r, JSON.stringify(r)); return r.plage; };
  const ko = (v: Parameters<typeof controlePlage>[1], champ: string, motif: RegExp) => {
    const r = controlePlage('2026-10-21', v);
    assert.ok('champ' in r && r.champ === champ && motif.test(r.message), JSON.stringify(r));
  };
  assert.deepEqual(ok({}), { fin: '2026-10-21', jours: ['2026-10-21'], horaires: [] });
  assert.deepEqual(ok({ fin: '2026-10-26' }).jours, ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26']);
  assert.deepEqual(ok({ fin: '2026-10-26', jours: ['2026-10-26', '2026-10-21', '2026-10-21'] }).jours, ['2026-10-21', '2026-10-26'], 'triés, sans doublon');
  assert.deepEqual(ok({ horaires: [{ debut: '08:30', fin: '12:00', pause: '' }] }).horaires, [{ debut: '08:30', fin: '12:00', pause: 0 }]);
  ko({ fin: '2026-10-20' }, 'fin', /précède le premier/);
  ko({ fin: '2026-13-01' }, 'fin', /date invalide/);
  ko({ fin: '2027-01-21' }, 'fin', /92 jours au plus/);
  ko({ fin: '2026-10-23', jours: ['2026-10-21', '2026-10-24'] }, 'jours', /hors de la période/);
  ko({ fin: '2026-10-23', jours: ['2026-10-21', '2026-10-22'] }, 'jours', /premier et le dernier jour/);
  ko({ fin: '2026-10-23', jours: 'lundi' }, 'jours', /dates invalides/);
  ko({ fin: '2026-12-31', jours: joursOuvres('2026-10-21', '2026-12-31') }, 'jours', /20 au plus/);
  ko({ horaires: [{ debut: '8h30', fin: '16:30' }] }, 'horaires', /au format 08:30/);
  ko({ horaires: [{ debut: '16:30', fin: '08:30' }] }, 'horaires', /la fin suit le début/);
  ko({ horaires: [{ debut: '08:30', fin: '09:30', pause: 60 }] }, 'horaires', /la pause dépasse la journée/);
  ko({ horaires: [{ debut: '08:30', fin: '16:30', pause: 300 }] }, 'horaires', /de 0 à 240/);
  ko({ fin: '2026-10-23', horaires: [{ debut: '08:30', fin: '16:30' }, { debut: '08:30', fin: '12:00' }] }, 'horaires', /un par jour/);
  ko({ horaires: 'matin' }, 'horaires', /invalides/);
  // controleSession les reprend après la date (premier jour) et avant le lieu.
  assert.match(controleSession('2026-10-10', { date: '2026-10-21', fin: '2026-10-20', lieu: 'Lyon', places: 6 })!, /précède le premier/);
  assert.equal(controleSession('2026-10-10', { date: '2026-10-21', fin: '2026-10-23', lieu: 'Lyon', places: 6 }), null);
  assert.equal(dureeHeures('7 h (MAC)'), 7);
  assert.equal(dureeHeures('3,5 h'), 3.5);
  assert.equal(dureeHeures('3 h 30'), 3.5);
  assert.equal(dureeHeures('1h30 (recyclage)'), 1.5);
  assert.equal(dureeHeures('21 h 15'), 21.25);
  assert.equal(dureeHeures('7 h, 2 jours'), 7);
  assert.equal(dureeHeures('2 jours'), null);
});

// — Actions —

test('session.creer et session.modifier : plage enregistrée, décalée avec la date, convocations et confirmation', () => {
  const { run, refused, session, db } = fresh();
  const r = run(RH, 'session.creer', { f: 'caces486', date: '2026-11-30', fin: '2026-12-02', horaires: [{ debut: '08:00', fin: '16:00', pause: 60 }], lieu: 'AFTRAL Saint-Priest', places: 6 });
  assert.match(message(r), /Session CACES R486 créée du 30 nov\. au 2 déc\. 2026 · 3 jours — 6 places/);
  const id = (r as { result: { id: number } }).result.id;
  assert.deepEqual([session(id).fin, session(id).jours, session(id).horaires], [
    '2026-12-02', ['2026-11-30', '2026-12-01', '2026-12-02'], [{ debut: '08:00', fin: '16:00', pause: 60 }],
  ]);
  refused(HSE, 'session.creer', { f: 'sst', date: '2026-11-30', fin: '2026-11-29', lieu: 'Lyon', places: 6 }, /précède le premier/);
  refused(RH, 'session.creer', { f: 'sst', date: '2026-11-30', horaires: [{ debut: '17:00', fin: '09:00' }], lieu: 'Lyon', places: 6 }, /la fin suit le début/);
  // Session d'un jour, comme avant (aucun champ de plage) ; écrite sans plage dans la table, elle tient en un jour.
  const un = (run(HSE, 'session.creer', { f: 'sst', date: '2026-12-03', lieu: 'Lyon', places: 6 }) as { result: { id: number } }).result.id;
  assert.deepEqual([session(un).fin, session(un).jours, session(un).horaires], ['2026-12-03', ['2026-12-03'], []]);

  // CACES R489 (session 3, du 21 au 23 octobre, confirmée, Lucas Martin et Yanis Bouzid convoqués). Nouvelle date seule :
  // la session garde sa forme, décalée d'autant ; convocations à renvoyer et nouvelle confirmation.
  assert.match(message(run(RH, 'session.modifier', { id: 3, date: '2026-10-28' })), /dates : du 28 oct\. au 30 oct\. 2026 · 3 jours/);
  assert.deepEqual([session(3).fin, session(3).jours, session(3).statut], ['2026-10-30', ['2026-10-28', '2026-10-29', '2026-10-30'], 'À confirmer']);
  assert.ok(db.all<{ sessionId: number; convoc: string }>('certifications').filter(c => c.sessionId === 3).every(c => c.convoc === 'later'));
  // Horaires seuls : convocations à renvoyer, sans nouvelle confirmation de l'organisme.
  run(RH, 'session.confirmer', { id: 3 });
  run(RH, 'convocation.envoyer', { sessionId: 3 });
  const h = run(RH, 'session.modifier', { id: 3, horaires: [{ debut: '09:00', fin: '17:00', pause: 60 }] });
  assert.match(message(h), /horaires : 9 h – 17 h \(pause 60 min\)/);
  assert.match(message(h), /2 convocations à renvoyer/);
  assert.equal(session(3).statut, 'Confirmée');
  // Dernier jour avancé : nouvelle plage, à faire confirmer.
  assert.match(message(run(RH, 'session.modifier', { id: 3, fin: '2026-10-29', jours: ['2026-10-28', '2026-10-29'] })), /dates : du 28 oct\. au 29 oct\. 2026 · 2 jours/);
  assert.equal(session(3).statut, 'À confirmer');
  assert.equal(run(RH, 'session.modifier', { id: 3, fin: '2026-10-29', jours: ['2026-10-28', '2026-10-29'] }), 'Aucune modification');
  // Le journal garde les jours de la session (dates), pas les horaires.
  assert.deepEqual(REGLES['session.modifier'].cible?.colonnes, ['date', 'jours', 'lieu', 'places', 'statut']);
  // Création : dernier jour et jours, dates seules.
  const { champsRetenus } = journal;
  assert.deepEqual(champsRetenus('session.creer', { f: 'caces489', date: '2026-12-01', fin: '2026-12-03', jours: ['2026-12-01', 'texte', '2026-12-03'], lieu: 'Lyon', places: 4 }),
    { f: 'caces489', date: '2026-12-01', fin: '2026-12-03', jours: ['2026-12-01', '2026-12-03'], lieu: 'Lyon', places: 4 });
});

test('inscription : conflits et contrat sur chacun des jours de la session, pas sur le week-end entre deux', () => {
  const { db, run, refused, domain } = fresh();
  // Session PRAP 10 : vendredi 20 et lundi 23 novembre. Une absence le samedi 21 ne compte pas ; une le lundi bloque.
  db.insert('absences', { empId: 4, type: 'CP', du: '2026-11-21', au: '2026-11-22', statut: 'validee', keystone: false });
  assert.deepEqual(conflitsSession(domain(), 4, domain().session(10)!).filter(c => c.bad), []);
  const lucas = () => domain().emp(4)!.certs.find(c => c.f === 'prap')!;
  db.insert('absences', { empId: 4, type: 'CP', du: '2026-11-23', au: '2026-11-23', statut: 'validee', keystone: false });
  refused(RH, 'plan.inscrire', { empId: 4, certId: lucas().id, sessionId: 10, conv: 'later' }, /Absence validée.*le 23 nov\. 2026/);
  // Un déplacement le jeudi 22 octobre croise la session CACES de Lucas (21-23 octobre) : averti, et nommé avec sa plage.
  const caces = conflitsDates(domain(), 4, '2026-10-22', '2026-10-22', 'voyage');
  assert.ok(caces.some(c => c.text === 'Inscrit à la session CACES R489 du 21 oct. au 23 oct. 2026 · 3 jours' && !c.bad), JSON.stringify(caces));
  assert.deepEqual(conflitsDates(domain(), 8, '2026-11-21', '2026-11-22', 'voyage').filter(c => /PRAP/.test(c.text)), [], 'week-end entre deux jours');
  // Autre session le troisième jour : bloquée (une session par jour).
  const r = run(RH, 'session.creer', { f: 'sst', date: '2026-10-23', lieu: 'Lyon', places: 6 }) as { result: { id: number } };
  const sstLucas = domain().emp(4)!.certs.find(c => c.f === 'sst');
  if (sstLucas) refused(RH, 'plan.inscrire', { empId: 4, certId: sstLucas.id, sessionId: r.result.id, conv: 'later' }, /Inscrit à la session CACES R489 du 21 oct\. au 23 oct\. 2026/);
  // Contrat qui s'achève pendant la session (dernier jour après la fin) : refusé.
  db.update('employes', 8, { fin: '2026-11-21' });
  const prap8 = domain().emp(8)!.certs.find(c => c.f === 'prap')!;
  run(RH, 'plan.desinscrire', { empId: 8, sessionId: 10 });
  refused(RH, 'plan.inscrire', { empId: 8, certId: prap8.id, sessionId: 10, conv: 'later' }, /dernier jour du contrat/);
});

test('clôture : à partir du dernier jour, certification datée du dernier jour ; session en cours non « passée »', () => {
  const { run, refused, domain } = fresh();
  le('2026-10-22', () => {
    const d = domain();
    // Session commencée (21-23 octobre) : ni passée, ni à clôturer ; ses inscrits restent planifiés.
    assert.equal(d.aCloturer().some(s => s.id === 3), false);
    assert.notEqual(d.sessionStatut(d.session(3)!), 'Session passée — à clôturer');
    assert.equal(d.enrich(90, false).find(e => e.id === 4)!.certs.find(c => c.f === 'caces489')!.session?.id, 3);
    assert.equal(etatInscription(d, d.ds.inscriptions.find(i => i.sessionId === 3)!)!.etat, 'planifiee');
    refused(RH, 'session.cloturer', { id: 3, participants: [] }, /dure jusqu’au 23 oct\. 2026/);
    // Inscrit d'une session commencée : ni déplacé ni désinscrit avant la clôture.
    const c = domain().emp(4)!.certs.find(x => x.f === 'caces489')!;
    refused(RH, 'plan.inscrire', { empId: 4, certId: c.id, sessionId: 4, conv: 'later' }, /en cours jusqu’au 23 oct\. 2026/);
  });
  le('2026-10-23', () => {
    const r = run(RH, 'session.cloturer', { id: 3, participants: [{ empId: 4, present: true, reussi: true }, { empId: 20, present: false }] });
    assert.match(String(r), /1 certification enregistrée/);
    const cert = domain().emp(4)!.certs.filter(c => c.f === 'caces489').sort((a, b) => b.id - a.id)[0];
    assert.equal(cert.obtenue, '2026-10-23', 'datée du dernier jour');
  });
});

test('session en cours : listée « en cours » du deuxième au dernier jour, puis à clôturer', () => {
  const { domain } = fresh();
  // Session CACES 3, du 21 au 23 octobre : à venir le premier jour, en cours ensuite, à clôturer après le dernier.
  const ou = (date: string) => le(date, () => {
    const d = domain();
    return { aVenir: d.upcoming().some(s => s.id === 3), enCours: d.enCours().some(s => s.id === 3), aCloturer: d.aCloturer().some(s => s.id === 3) };
  });
  assert.deepEqual(ou('2026-10-21'), { aVenir: true, enCours: false, aCloturer: false });
  assert.deepEqual(ou('2026-10-22'), { aVenir: false, enCours: true, aCloturer: false });
  assert.deepEqual(ou('2026-10-23'), { aVenir: false, enCours: true, aCloturer: false }, 'dernier jour : en cours, clôturable');
  assert.deepEqual(ou('2026-10-24'), { aVenir: false, enCours: false, aCloturer: true });
  // Une session d'un jour n'est jamais « en cours » : à venir le jour même, à clôturer le lendemain.
  assert.equal(le('2026-10-27', () => domain().enCours().some(s => s.id === 5)), false);
});

test('session en cours modifiée : convocations à renvoyer jusqu’au dernier jour, sans nouvelle confirmation', () => {
  const { run, refused, session } = fresh();
  le('2026-10-22', () => {
    // Dernier jour reculé au lundi 26 : les convocations repassent « à envoyer », la session reste confirmée.
    const r = run(RH, 'session.modifier', { id: 3, fin: '2026-10-26', jours: ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26'] });
    assert.match(message(r), /2 convocations à renvoyer/);
    assert.doesNotMatch(message(r), /à faire confirmer/);
    assert.equal(session(3).statut, 'Confirmée');
    // Renvoi possible tant que la session n'est pas finie ; désinscription toujours refusée.
    assert.match(message(run(RH, 'convocation.envoyer', { sessionId: 3 })), /2 convocations envoyées/);
    refused(RH, 'plan.desinscrire', { empId: 4, sessionId: 3 }, /en cours jusqu’au 26 oct\. 2026/);
  });
  le('2026-10-27', () => refused(RH, 'convocation.envoyer', { sessionId: 3, empIds: [4] }, /passée/));
});

// — Invitation d'agenda —

test('ICS : plusieurs journées entières, ou créneaux à l’heure de Paris (répétition, jours sautés, horaire différent)', () => {
  const lignes = (ics: string) => ics.split('\r\n');
  const fco = lignes(calendrier({ uid: 'formation-11-20@x', date: '2027-01-11', fin: '2027-01-15', titre: 'Formation : FCO' }));
  assert.ok(fco.includes('DTSTART;VALUE=DATE:20270111') && fco.includes('DTEND;VALUE=DATE:20270116'), 'fin exclusive : lendemain du dernier jour');
  assert.ok(!fco.some(l => l.startsWith('BEGIN:VTIMEZONE')));

  const un = lignes(calendrier({ uid: 'u@x', date: '2026-10-21', titre: 'Formation', creneaux: [{ jour: '2026-10-21', debut: '08:30', fin: '16:30' }] }));
  assert.ok(un.includes('DTSTART;TZID=Europe/Paris:20261021T083000') && un.includes('DTEND;TZID=Europe/Paris:20261021T163000'));
  assert.ok(un.includes('BEGIN:VTIMEZONE') && un.includes('TZID:Europe/Paris') && !un.some(l => l.startsWith('RRULE:FREQ=DAILY')), 'un seul jour : pas de répétition');

  // PRAP : vendredi 20 et lundi 23 novembre, le lundi l'après-midi seulement.
  const creneaux = [{ jour: '2026-11-20', debut: '09:00', fin: '17:00' }, { jour: '2026-11-23', debut: '13:30', fin: '17:00' }];
  const prap = calendrier({ uid: 'formation-10-8@x', date: '2026-11-20', titre: 'Formation : PRAP', creneaux, lieu: 'Lyon' }, new Date('2026-10-10T08:00:00Z'));
  const l = lignes(prap);
  assert.ok(l.includes('RRULE:FREQ=DAILY;COUNT=4'));
  assert.ok(l.includes('EXDATE;TZID=Europe/Paris:20261121T090000,20261122T090000'), 'samedi et dimanche sautés');
  assert.ok(l.includes('RECURRENCE-ID;TZID=Europe/Paris:20261123T090000') && l.includes('DTSTART;TZID=Europe/Paris:20261123T133000'));
  assert.equal(l.filter(x => x === 'BEGIN:VEVENT').length, 2);
  assert.equal(l.filter(x => x === 'UID:formation-10-8@x').length, 2, 'un seul UID : la série et son remplacement');
  assert.ok(l.every(x => Buffer.byteLength(x) <= 75));
  // Annulation : la série entière, sans remplacement.
  const annule = lignes(calendrier({ uid: 'formation-10-8@x', date: '2026-11-20', titre: 'Formation : PRAP', creneaux, annule: true }));
  assert.ok(annule.includes('METHOD:CANCEL') && annule.includes('STATUS:CANCELLED'));
  assert.equal(annule.filter(x => x === 'BEGIN:VEVENT').length, 1);
});

test('convocation : dates, jours et horaires dans le message, .ics de la session entière', () => {
  const { run, domain, mails } = fresh();
  const c = domain().emp(4)!.certs.find(x => x.f === 'caces489')!;
  run(RH, 'plan.inscrire', { empId: 4, certId: c.id, sessionId: 4, conv: 'later' });
  // Session CACES 4 (25 novembre) étendue sur deux jours sans horaire, puis convocation.
  run(RH, 'session.modifier', { id: 4, fin: '2026-11-26' });
  run(RH, 'convocation.envoyer', { sessionId: 4, empIds: [4] });
  const m = mails('convocation').at(-1)!;
  assert.match(m.objet, /Convocation : CACES R489 — Chariots élévateurs \(cat\. 3\) — 25 nov\. → 26 nov\. 2026/);
  assert.match(m.texte, /Dates : du mercredi 25 novembre au jeudi 26 novembre 2026 \(2 jours\)/);
  assert.match(m.texte, /Jours : mer\. 25 nov\. ; jeu\. 26 nov\./);
  const ics = texteDe(m.pj![0].base64);
  assert.match(ics, /DTSTART;VALUE=DATE:20261125\r\nDTEND;VALUE=DATE:20261127\r\n/);
  // Avec horaires : à l'heure de Paris ; l'annulation retire la série (même UID).
  run(RH, 'session.modifier', { id: 4, horaires: [{ debut: '08:30', fin: '16:30', pause: 60 }] });
  run(RH, 'convocation.envoyer', { sessionId: 4, empIds: [4] });
  const m2 = mails('convocation').at(-1)!;
  assert.match(m2.texte, /Horaires : 8 h 30 – 16 h 30 \(pause 60 min\), chaque jour/);
  assert.match(texteDe(m2.pj![0].base64), /DTSTART;TZID=Europe\/Paris:20261125T083000\r\n[\s\S]*RRULE:FREQ=DAILY;COUNT=2\r\n/);
  run(RH, 'plan.desinscrire', { empId: 4, sessionId: 4 });
  const a = mails('convocation.annulee').at(-1)!;
  assert.match(a.texte, /du mercredi 25 novembre au jeudi 26 novembre 2026 est annulée/);
  assert.match(texteDe(a.pj![0].base64), /METHOD:CANCEL\r\n[\s\S]*UID:formation-4-4@cursus\.example\.fr\r\n/);
});

// — Feuilles de temps —

test('feuille de temps : ligne INT-FORM des heures prévues, fériés et absences à zéro, jamais envoyée à Keystone', () => {
  const { db, run, domain } = fresh();
  const d = domain(), lucas = d.emp(4)!;
  // Semaine du 19 octobre : CACES du mercredi au vendredi, 8 h 30 – 16 h 30, pause d'une heure (7 h).
  const lignes = suggestLines(d, lucas, '2026-10-19');
  const form = lignes.filter(l => l.projet === 'INT-FORM');
  assert.deepEqual(form, [{ projet: 'INT-FORM', tache: 'CACES R489', ks: false, h: [0, 0, 7, 7, 7] }]);
  assert.ok(lignes.some(l => l.ks), 'les tâches Keystone restent proposées');
  assert.deepEqual(heuresKeystone(lignes)['INT-FORM'], undefined, 'activité interne : jamais vers Keystone');
  assert.ok(ACTIVITES_INTERNES.test('INT-FORM'));
  assert.equal(d.projet('INT-FORM'), 'Formation', 'activité interne parmi les projets');
  // Sans horaire : la durée du catalogue (FCO 35 h) répartie sur les jours de la session, ouvrés par défaut (le
  // mercredi 11 novembre, férié, n'en est pas : 8,75 h sur quatre jours), plafonnée à la journée de travail (7 h à
  // 35 h) ; un jour d'absence à zéro.
  const fco = (run(RH, 'session.creer', { f: 'fco', date: '2026-11-09', fin: '2026-11-13', lieu: 'AFTRAL', places: 6 }) as { result: { id: number } }).result.id;
  run(RH, 'plan.inscrire', { empId: 20, certId: domain().emp(20)!.certs.find(c => c.f === 'fco')!.id, sessionId: fco, conv: 'later' });
  db.insert('absences', { empId: 20, type: 'CP', du: '2026-11-13', au: '2026-11-13', statut: 'validee', keystone: false });
  assert.deepEqual(suggestLines(domain(), domain().emp(20)!, '2026-11-09').find(l => l.projet === 'INT-FORM')!.h, [7, 7, 0, 7, 0], '11 novembre férié, vendredi absent');
  // L'action temps.suggest enregistre la ligne, modifiable ensuite ; message qui nomme les deux sources.
  assert.match(String(run(RH, 'temps.suggest', { empId: 4, week: '2026-10-19' })), /depuis des tâches Keystone et des sessions de formation/);
  const sh = () => domain().ds.feuilles.find(f => f.empId === 4 && f.week === '2026-10-19')!;
  const li = sh().lignes.findIndex(l => l.projet === 'INT-FORM');
  run(RH, 'temps.setCell', { empId: 4, week: '2026-10-19', li, di: 4, value: '5' });
  assert.deepEqual(sh().lignes[li].h, [0, 0, 7, 7, 5]);
  // Après la clôture : le présent garde sa ligne, l'absent n'en a plus.
  le('2026-10-23', () => run(RH, 'session.cloturer', { id: 3, participants: [{ empId: 4, present: true, reussi: true }, { empId: 20, present: false }] }));
  assert.equal(lignesFormation(domain(), domain().emp(4)!, '2026-10-19', [], []).length, 1);
  assert.equal(lignesFormation(domain(), domain().emp(20)!, '2026-10-19', [], []).length, 0);
  // Session annulée : plus rien ; semaine sans session : rien.
  run(RH, 'session.annuler', { id: fco });
  assert.equal(suggestLines(domain(), domain().emp(20)!, '2026-11-09').some(l => l.projet === 'INT-FORM'), false);
  assert.equal(formationsAProposer(domain(), 4, '2026-10-12'), false);
});

test('« Proposer » : les lignes saisies sont gardées ; une session d’un jour sans horaire ne propose qu’une journée', () => {
  const { db, run, domain } = fresh();
  // Thomas Garnier (6), formation élec. « 21 h » le mardi 27 octobre, un seul jour, sans horaire : une journée de travail
  // (39 h, 7,8 h), pas 21 h ; la tâche Keystone du même jour reste proposée.
  const lignes = suggestLines(domain(), domain().emp(6)!, '2026-10-26');
  assert.deepEqual(lignes.find(l => l.projet === 'INT-FORM')!.h, [0, 7.8, 0, 0, 0]);
  assert.ok(lignes.some(l => l.ks && l.h[1] === 8));
  assert.match(String(run(RH, 'temps.suggest', { empId: 6, week: '2026-10-26' })), /depuis des tâches Keystone et des sessions de formation/);

  // Julien Moreau (8), sans tâche Keystone : INT-PROD saisi à la main, puis « Proposer » pour le PRAP du lundi 23 novembre.
  db.sql.exec('DELETE FROM taches');
  run(RH, 'temps.addLine', { empId: 8, week: '2026-11-23', projet: 'INT-PROD' });
  for (let di = 0; di < 5; di++) run(RH, 'temps.setCell', { empId: 8, week: '2026-11-23', li: 0, di, value: '7' });
  const r = run(RH, 'temps.suggest', { empId: 8, week: '2026-11-23' });
  assert.match(String(r), /depuis des sessions de formation — 1 ligne.*1 ligne déjà saisie conservée/);
  const sh = () => domain().ds.feuilles.find(f => f.empId === 8 && f.week === '2026-11-23')!;
  assert.deepEqual(sh().lignes.map(l => [l.projet, l.h]), [['INT-PROD', [7, 7, 7, 7, 7]], ['INT-FORM', [7, 0, 0, 0, 0]]]);
  // Proposer de nouveau : la ligne de la formation est remplacée, pas doublée ; la saisie à la main reste.
  const li = sh().lignes.findIndex(l => l.projet === 'INT-FORM');
  run(RH, 'temps.setCell', { empId: 8, week: '2026-11-23', li, di: 0, value: '3' });
  run(RH, 'temps.suggest', { empId: 8, week: '2026-11-23' });
  assert.deepEqual(sh().lignes.map(l => [l.projet, l.h]), [['INT-PROD', [7, 7, 7, 7, 7]], ['INT-FORM', [7, 0, 0, 0, 0]]]);

  // Au-delà de 24 h un jour, toutes lignes cumulées : les heures de formation sont réduites, Keystone reste proposé.
  const ks = { projet: 'K-1', tache: 'Chantier', ks: true, h: [10, 0, 0, 0, 0] };
  const form = { projet: 'INT-FORM', tache: 'PRAP', ks: false, h: [7, 7, 0, 0, 0] };
  const f = fusionProposition([{ projet: 'INT-PROD', tache: 'Conduite', ks: false, h: [10, 0, 0, 0, 0] }, { projet: 'K-1', tache: 'Ancienne', ks: true, h: [0, 0, 4, 0, 0] }], [ks, form]);
  assert.deepEqual(f.lignes.map(l => [l.projet, l.tache, l.h]), [['K-1', 'Chantier', [10, 0, 0, 0, 0]], ['INT-PROD', 'Conduite', [10, 0, 0, 0, 0]], ['INT-FORM', 'PRAP', [4, 7, 0, 0, 0]]]);
  assert.deepEqual([f.conservees, f.reduites], [1, true]);
  // Sans tâche Keystone cette semaine, les lignes Keystone d'une proposition précédente sont gardées.
  assert.equal(fusionProposition([{ projet: 'K-1', tache: 'Ancienne', ks: true, h: [0, 0, 4, 0, 0] }], [form]).conservees, 1);
});

test('réglage « Formations » : préremplissage désactivé, rien n’est proposé ; libellé au journal', () => {
  const { run, domain } = fresh();
  assert.equal(domain().ds.settings.formationsTemps, true, 'actif par défaut');
  assert.equal(formationsAProposer(domain(), 4, '2026-10-19'), true);
  run(RH, 'parametres.maj', { formationsTemps: false });
  assert.equal(domain().ds.settings.formationsTemps, false);
  assert.equal(formationsAProposer(domain(), 4, '2026-10-19'), false);
  assert.equal(suggestLines(domain(), domain().emp(4)!, '2026-10-19').some(l => l.projet === 'INT-FORM'), false);
  assert.equal(CHAMP_LABEL.formationsTemps, 'Heures de formation proposées dans les feuilles de temps', 'libellé au journal');
});

// — Migration —

test('migration nommée : sessions d’une base existante sur un jour, activité INT-FORM ajoutée une fois', () => {
  const db = new Db(':memory:');
  seedDemo(db);
  // Base d'avant le lot 5 : sessions sans plage, sans INT-FORM.
  db.sql.exec(`UPDATE sessions SET fin = NULL, jours = NULL, horaires = NULL; DELETE FROM projets WHERE code = 'INT-FORM'`);
  assert.equal(PLAGE_SESSIONS.necessaire!(db), true);
  assert.equal(ACTIVITE_FORMATION_PROJET.necessaire!(db), true);
  assert.equal(PLAGE_SESSIONS.executer(db), '13 sessions sur un jour');
  ACTIVITE_FORMATION_PROJET.executer(db);
  ACTIVITE_FORMATION_PROJET.executer(db);
  const lignes = db.sql.prepare('SELECT date, fin, jours, horaires FROM sessions WHERE id = 3').get() as Record<string, string>;
  assert.deepEqual({ ...lignes }, { date: '2026-10-21', fin: '2026-10-21', jours: '["2026-10-21"]', horaires: '[]' });
  assert.equal((db.sql.prepare(`SELECT COUNT(*) AS n FROM projets WHERE code = 'INT-FORM'`).get() as { n: number }).n, 1);
  assert.equal((db.sql.prepare('SELECT COUNT(*) AS n FROM sessions WHERE fin IS NULL').get() as { n: number }).n, 0);
  assert.equal(ACTIVITE_FORMATION_PROJET.necessaire!(db), false);
  // Liste complète : déjà faites, rien de plus ; la base est lue comme avant (une journée par session).
  appliquerMigrations(db);
  assert.deepEqual(appliquerMigrations(db), []);
  assert.equal(new Domain(loadFull(db, RH)).session(3)!.fin, '2026-10-21');
});
