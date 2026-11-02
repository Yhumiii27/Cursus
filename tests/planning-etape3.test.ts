// Planning d'équipe (lot 12, chantier C5, étape 3) sur le jeu de démonstration du 10 octobre 2026 (Karim Haddad, 12, encadre
// la Maintenance : Thomas Garnier, 6, sans SST ; Romain Chevalier, 18, SST valide) : conflits d'un créneau avec une mission
// ou une tâche Keystone, une session de formation, une astreinte (information, sans blocage ni motif, jamais au journal) ;
// couverture minimale par créneau (effectif, secouristes à chaque horaire tenu, absences pour le planificateur seul) ; vue
// du référent HSE sans postes « à pourvoir ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { json, nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { horloge } = await import('../server/src/astreintes.ts');
const { Domain } = await import('../shared/domain.ts');
const { conflitsDuJour, conflitsPlanning } = await import('../shared/rules/planning-conflits.ts');
const { couvertureCreneaux, creneauCouvertureTexte, manquesCreneau, titulaireLe } = await import('../shared/rules/couverture-creneaux.ts');
const { apercuPublication, controlesSalarie, fichesEnrichies, joursPlanifiesDe } = await import('../shared/rules/planning-apercu.ts');
const { GRAVITE } = await import('../shared/rules/planning-controles.ts');
const { HORAIRES_EXEMPLES } = await import('../shared/rules/horaires.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Creneau = import('../shared/types-planning.ts').Creneau;
type HoraireFige = import('../shared/types.ts').HoraireFige;

horloge.maintenant = () => new Date('2026-10-10T09:00:00+02:00');
const H: Record<string, HoraireFige> = Object.fromEntries(HORAIRES_EXEMPLES.map(h => [h.code, { code: h.code, debut: h.debut, fin: h.fin, pause: h.pause }]));

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), planningActif: true });
  const compteId = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', (empId ? [empId] : [])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteId(empId), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const ctx = makeCtx(db, u, await loadFull(db, u));
    const r = await ACTIONS[name](ctx, p);
    const o: { message?: string | null; result?: unknown } = typeof r === 'object' && r !== null ? r as { message?: string; result?: unknown } : { message: r as string | null };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result ?? null });
    return o;
  });
  return { db, user, run, RH: await user(null, 'rh'), KARIM: await user(12, 'manager') };
}
type Db = Awaited<ReturnType<typeof fresh>>['db'];

/** Créneau écrit directement (publié le 1er octobre, ou brouillon). */
const creneau = async (db: Db, empId: number | null, jour: string, horaire: string | null, statut: 'publie' | 'brouillon' = 'publie') => {
  const h = horaire ? H[horaire] : null;
  return (await db.insert<Creneau>('creneaux', {
    empId, jour, equipe: 'Maintenance', horaire, debut: h?.debut ?? null, fin: h?.fin ?? null, pause: h?.pause ?? 0, source: 'manuel', statut,
    version: statut === 'publie' ? 1 : null, publieLe: statut === 'publie' ? '2026-10-01T08:00:00.000Z' : null, publiePar: statut === 'publie' ? 'Karim Haddad' : null,
    communiqueLe: statut === 'publie' ? '2026-10-01' : null, horsDelai: false, creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Karim Haddad',
  })).id;
};

/** Engagements de Thomas (6) autour de la semaine du 19 octobre. */
async function engagements(db: Db) {
  await db.insert('missions', { empId: 6, projet: 'HLT-026', lieu: 'Lyon', du: '2026-10-20', au: '2026-10-21', type: 'Mission', ref: null });
  await db.insert('missions', { empId: 6, projet: 'NDC-031', lieu: '', du: '2026-10-23', au: '2026-10-23', type: 'Mission', ref: null });
  await db.insert('taches', { ref: null, empId: 6, projet: 'HLT-026', tache: 'Montage', debut: '2026-10-19', fin: '2026-10-21', heures: { '2026-10-19': 3, '2026-10-21': 4 } });
  // Session sans horaire le 19 (journée entière) ; session du matin le 22 (le poste de nuit ne la chevauche pas, mais le
  // repos qui les sépare est trop court), puis le 24, jour de repos planifié.
  const s1 = (await db.insert<{ id: number }>('sessions', { formation: 'sst', date: '2026-10-19', fin: '2026-10-19', jours: ['2026-10-19'], horaires: [], lieu: 'Site', places: 8, statut: 'Confirmée' })).id;
  const s2 = (await db.insert<{ id: number }>('sessions', {
    formation: 'epi', date: '2026-10-22', fin: '2026-10-24', jours: ['2026-10-22', '2026-10-24'], horaires: [{ debut: '09:00', fin: '12:00', pause: 0 }], lieu: 'Site', places: 8, statut: 'Confirmée',
  })).id;
  for (const sessionId of [s1, s2]) await db.insert('inscriptions', { empId: 6, sessionId, convoc: 'now', date: '2026-10-01', convocLe: '2026-10-01' });
  const ast = { empId: 6, equipe: 'Maintenance', communiqueLe: '2026-10-01', motif: null, creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Karim Haddad' };
  // Astreinte le soir du 22 qui couvre le poste de nuit ; une autre, annulée, le 20.
  await db.insert('astreintes', { ...ast, du: '2026-10-22', debut: '18:00', au: '2026-10-23', fin: '08:00' });
  await db.insert('astreintes', { ...ast, du: '2026-10-20', debut: '08:00', au: '2026-10-20', fin: '20:00', annuleLe: '2026-10-05T08:00:00.000Z', annulePar: 'Karim Haddad', annuleMotif: 'Inutile' });
}

test('conflits : mission (poste ou repos), heures Keystone un jour de repos, session qui chevauche, astreinte ; absences et annulées ignorées', async () => {
  const { db, RH } = await fresh();
  await engagements(db);
  // Absence validée le 23 : le poste n'y est pas tenu, la mission de ce jour-là n'est pas un conflit.
  await db.insert('absences', { empId: 6, type: 'CP', du: '2026-10-23', au: '2026-10-23', jours: 1, statut: 'validee', creeLe: '2026-10-01T08:00:00Z' });
  const d = new Domain(await loadFull(db, RH));
  const jours = [
    { jour: '2026-10-19', horaire: H.J }, { jour: '2026-10-20', horaire: H.J }, { jour: '2026-10-21', horaire: null }, { jour: '2026-10-22', horaire: H.N },
    { jour: '2026-10-23', horaire: H.J }, { jour: '2026-10-24', horaire: null }, { jour: '2026-10-25', horaire: null },
  ];
  const c = conflitsPlanning(d, 6, jours, '2026-10-19', '2026-10-25', new Set(['2026-10-23']));
  assert.deepEqual(c.map(x => [x.jour, x.code]), [
    ['2026-10-19', 'conflit_session'],
    ['2026-10-20', 'conflit_mission'],
    ['2026-10-21', 'conflit_mission'], ['2026-10-21', 'conflit_mission'], ['2026-10-21', 'conflit_mission'],
    ['2026-10-22', 'conflit_session'], ['2026-10-22', 'conflit_astreinte'],
    ['2026-10-24', 'conflit_session'],
  ], 'heures Keystone un jour de poste (19) : rien ; astreinte annulée (20) : rien');
  // Session du matin le jour d'un poste de nuit (22) : le temps de formation est du temps de travail, 9 h de repos seulement.
  assert.match(conflitsDuJour(c, 6, '2026-10-22')[0].texte,
    /^22 oct\. 2026 : session de formation EPI incendie de 09:00 à 12:00 : 9 h de repos avant le poste N planifié, moins que le repos quotidien de 11 h \(art\. L3131-1\)$/);
  assert.match(conflitsDuJour(c, 6, '2026-10-20')[0].texte, /^20 oct\. 2026 : mission Keystone HLT-026 \(Lyon\) pendant le poste J planifié$/);
  assert.deepEqual(conflitsDuJour(c, 6, '2026-10-21').map(x => x.texte.replace(/^.* : /, '')), [
    'mission Keystone HLT-026 (Lyon) un jour de repos planifié', '8 h prévues par Keystone (INT-MAINT) un jour de repos planifié', '4 h prévues par Keystone (HLT-026) un jour de repos planifié',
  ], 'la tâche INT-MAINT de démonstration compte aussi');
  assert.match(conflitsDuJour(c, 6, '2026-10-19')[0].texte, /session de formation SST pendant le poste J planifié/);
  assert.match(conflitsDuJour(c, 6, '2026-10-22')[1].texte, /astreinte du 22 oct\. 2026 18:00 au 23 oct\. 2026 08:00 pendant le poste N planifié/);
  assert.match(conflitsDuJour(c, 6, '2026-10-24')[0].texte, /session de formation EPI incendie de 09:00 à 12:00 un jour de repos planifié/);
  // Sans absence : la mission du 23 (sans lieu) apparaît ; hors période ou sans jour planifié : rien.
  assert.match(conflitsPlanning(d, 6, jours, '2026-10-23', '2026-10-23')[0].texte, /mission Keystone NDC-031 pendant le poste J planifié$/);
  assert.deepEqual(conflitsPlanning(d, 6, jours, '2026-11-02', '2026-11-08'), []);
  assert.deepEqual(conflitsPlanning(d, 18, jours, '2026-10-19', '2026-10-25').map(x => x.texte), ['21 oct. 2026 : 8 h prévues par Keystone (K-2614) un jour de repos planifié'],
    'Romain : sa seule tâche de démonstration, aucun engagement de Thomas');
  // Session à 08:00 le lendemain d'un poste de nuit fini à 05:00, ce lendemain étant un jour de poste de l'après-midi
  // (instantané modifié en mémoire ; la session de démonstration du 27 est écartée du constat) : 3 h de repos après la nuit, 1 h avant l'après-midi ; rattachées au jour de chaque
  // poste, une seule fois par paire. Repos réduit par l'accord (9 h) : la session du 22 (9 h avant la nuit) passe.
  const matin = { ...d.ds.sessions[0], id: 998, formation: 'sst', date: '2026-10-28', fin: '2026-10-28', jours: ['2026-10-28'], horaires: [{ debut: '08:00', fin: '12:00', pause: 0 }], statut: 'Confirmée' as const };
  const dm = new Domain({ ...d.ds, sessions: [...d.ds.sessions, matin], inscriptions: [...d.ds.inscriptions, { id: 998, empId: 6, sessionId: 998, convoc: 'now', date: '2026-10-01', convocLe: null }] });
  const nuitPuisAm = [{ jour: '2026-10-27', horaire: H.N }, { jour: '2026-10-28', horaire: H.AM }];
  assert.deepEqual(conflitsPlanning(dm, 6, nuitPuisAm, '2026-10-26', '2026-11-01').filter(x => x.texte.includes(' SST ')).map(x => x.texte), [
    '27 oct. 2026 : session de formation SST du 28 oct. 2026 de 08:00 à 12:00 : 3 h de repos après le poste N planifié, moins que le repos quotidien de 11 h (art. L3131-1)',
    '28 oct. 2026 : session de formation SST de 08:00 à 12:00 : 1 h de repos avant le poste AM planifié, moins que le repos quotidien de 11 h (art. L3131-1)',
  ]);
  // Poste de la nuit hors de la période : la session de la période reste signalée au jour de son poste.
  assert.deepEqual(conflitsPlanning(dm, 6, nuitPuisAm, '2026-10-28', '2026-10-28').filter(x => x.texte.includes(' SST ')).map(x => x.texte.replace(/ :.*?: /, ' : ')), [
    '28 oct. 2026 : 3 h de repos après le poste N du 27 oct. 2026, moins que le repos quotidien de 11 h (art. L3131-1)',
    '28 oct. 2026 : 1 h de repos avant le poste AM planifié, moins que le repos quotidien de 11 h (art. L3131-1)',
  ]);
  const reduit = new Domain({ ...d.ds, settings: { ...d.ds.settings, planningReposQuotidienAccord: 9 } });
  assert.deepEqual(conflitsPlanning(reduit, 6, jours, '2026-10-22', '2026-10-22').map(x => x.code), ['conflit_astreinte']);
  // Salarié mineur : 12 h exigées, même avec l'accord.
  const mineur = new Domain({ ...reduit.ds, employes: reduit.ds.employes.map(e => (e.id === 6 ? { ...e, naissance: 2010, naissanceLe: '2010-01-01' } : e)) });
  assert.match(conflitsPlanning(mineur, 6, jours, '2026-10-22', '2026-10-22')[0].texte, /9 h de repos avant le poste N planifié, moins que le repos quotidien de 12 h \(salarié de moins de 18 ans, art\. L3164-1\)$/);
  // Formation inconnue du référentiel (instantané modifié en mémoire : la base l'interdit) : son code.
  const inconnue = { ...d.ds.sessions[0], id: 999, formation: 'inconnue', date: '2026-10-25', fin: '2026-10-25', jours: ['2026-10-25'], horaires: [], statut: 'Confirmée' as const };
  const di = new Domain({ ...d.ds, sessions: [...d.ds.sessions, inconnue], inscriptions: [...d.ds.inscriptions, { id: 999, empId: 6, sessionId: 999, convoc: 'now', date: '2026-10-01', convocLe: null }] });
  assert.match(conflitsPlanning(di, 6, jours, '2026-10-25', '2026-10-25')[0].texte, /session de formation inconnue un jour de repos/);
  // Instantané sans missions, tâches ni astreintes (profil qui ne les reçoit pas) : rien.
  const vide = new Domain({ ...d.ds, missions: undefined, taches: undefined, astreintes: undefined, sessions: [], inscriptions: [] } as unknown as typeof d.ds);
  assert.deepEqual(conflitsPlanning(vide, 6, jours, '2026-10-19', '2026-10-25'), []);
  // Gravité « info » : jamais un refus ni une alerte à motiver.
  assert.deepEqual([GRAVITE.conflit_mission, GRAVITE.conflit_session, GRAVITE.conflit_astreinte], ['info', 'info', 'info']);
});

test('publication : conflits en information (ni refus, ni motif), jamais au journal ; aperçu et contrôles du salarié', async () => {
  const { db, run, journal, KARIM } = await (async () => {
    const f = await fresh();
    const journal = async (action: string) => (await f.db.all<{ action: string; payload: unknown; message: string }>('journal')).filter(j => j.action === action);
    return { ...f, journal };
  })();
  await engagements(db);
  for (const jour of ['2026-10-19', '2026-10-20']) await creneau(db, 6, jour, 'J', 'brouillon');
  await creneau(db, 6, '2026-10-21', null, 'brouillon');
  const d = new Domain(await loadFull(db, KARIM));
  const a = apercuPublication(d, 'Maintenance', '2026-10-19', '2026-10-21');
  assert.deepEqual(a.alertes.infos.filter(x => x.code.startsWith('conflit_')).map(x => [x.jour, x.code]),
    [['2026-10-19', 'conflit_session'], ['2026-10-20', 'conflit_mission'], ['2026-10-21', 'conflit_mission'], ['2026-10-21', 'conflit_mission'], ['2026-10-21', 'conflit_mission']]);
  assert.ok(!a.alertes.refus.some(x => x.code.startsWith('conflit_')) && !a.alertes.alertes.some(x => x.code.startsWith('conflit_')));
  // Sans fiche enrichie : les conflits restent signalés.
  const emp = d.emp(6)!;
  const sans = controlesSalarie(d, emp, undefined, joursPlanifiesDe(d.ds.creneaux ?? [], 6, '2026-10-19', '2026-10-21', d.ti), '2026-10-19', '2026-10-21');
  assert.equal(sans.filter(x => x.code.startsWith('conflit_')).length, 5);
  assert.ok(fichesEnrichies(d).has(6));
  // Le serveur publie : les conflits ne demandent aucun motif ; le journal n'en garde rien.
  const motifAlertes = a.alertes.alertes.length ? 'Recyclage programmé' : undefined;
  const r = await run(KARIM, 'planning.publier', { equipe: 'Maintenance', du: '2026-10-19', au: '2026-10-21', ...(motifAlertes ? { motifAlertes } : {}) });
  assert.match(String(r.message), /publi/i);
  const j = await journal('planning.publier');
  assert.equal(j.length, 1);
  const trace = JSON.stringify(j[0]);
  for (const mot of ['HLT-026', 'Lyon', 'conflit', 'astreinte', 'SST', 'Recyclage']) assert.ok(!trace.includes(mot), `journal sans « ${mot} »`);
  // Seul le nombre d'alertes à motiver est noté, les conflits n'y comptent pas.
  assert.equal(json<{ alertes?: number }>(j[0].payload).alertes ?? a.alertes.alertes.length, a.alertes.alertes.length);
});

test('couverture par créneau : effectif face au besoin, secouristes à chaque horaire tenu, absences pour le planificateur seul', () => {
  const certs = (f: string, obtenue: string) => [{ id: 1, f, obtenue, sessionId: null }];
  const ds = {
    employes: [
      { id: 1, certs: certs('sst', '2025-12-01') }, { id: 2, certs: [] }, { id: 3, certs: certs('sst', '2024-01-01') }, { id: 4, certs: certs('sst', '2026-10-25') },
    ] as never,
    referentiels: {
      equipes: [{ nom: 'Q', couverture: [{ formation: 'sst', min: 1 }, { formation: 'vieille', min: 1 }, { formation: 'absente', min: 1 }] }, { nom: 'R', couverture: null }] as never,
      formations: [{ id: 'sst', validite: 24, archive: null }, { id: 'vieille', validite: 12, archive: '2026-01-01' }],
    },
    besoinsPoste: [
      { id: 1, equipe: 'Q', horaire: 'N', jours: [0, 1, 2, 3, 4, 5, 6], effectifMin: 2, posteId: null, activite: null, exigences: { formations: [], habilitations: [] }, du: '2026-01-01', au: null, archive: null },
      { id: 2, equipe: 'Q', horaire: 'AM', jours: [1], effectifMin: 1, posteId: null, activite: null, exigences: { formations: [], habilitations: [] }, du: '2026-01-01', au: null, archive: null },
      { id: 3, equipe: 'Q', horaire: 'J', jours: [1], effectifMin: 1, posteId: null, activite: null, exigences: { formations: [], habilitations: [] }, du: '2026-01-01', au: null, archive: '2026-02-01' },
    ],
    absences: [{ empId: 1, du: '2026-10-20', au: '2026-10-20', statut: 'validee' as const }, { empId: 3, du: '2026-10-19', au: '2026-10-20', statut: 'signalee' as const }],
  };
  const c = (empId: number | null, jour: string, horaire: string | null, equipe = 'Q') => ({ empId, jour, equipe, horaire });
  const creneaux = [
    c(1, '2026-10-20', 'N'), c(2, '2026-10-20', 'N'), c(3, '2026-10-20', 'M'), c(null, '2026-10-20', 'M'), c(2, '2026-10-20', 'J', 'R'), c(4, '2026-10-20', null),
    c(1, '2026-10-21', 'N'), c(2, '2026-10-21', 'N'), c(4, '2026-10-26', 'N'), c(9, '2026-10-26', 'N'),
  ];
  // Mardi 20 octobre : N (2 postes sur 2, SST tenu par 1), M (SST échu de 3, « à pourvoir » non compté), AM (besoin seul).
  const sans = couvertureCreneaux(ds, 'Q', ['2026-10-20', '2026-10-21'], creneaux, false);
  assert.deepEqual(sans.map(x => [x.jour, x.horaire, x.postes, x.besoin, x.formations.map(f => f.titulaires).join(), x.manque]), [
    ['2026-10-20', 'AM', 0, 1, '0', true],
    ['2026-10-20', 'M', 1, 0, '0', true],
    ['2026-10-20', 'N', 2, 2, '1', false],
    ['2026-10-21', 'N', 2, 2, '1', false],
  ], 'formation archivée ou inconnue : ignorée ; besoin archivé ou d’un autre jour : ignoré ; autre équipe : ignorée');
  // Planificateur : l'absent du 20 ne compte pas.
  const avecTous = couvertureCreneaux(ds, 'Q', ['2026-10-20'], creneaux, true);
  const avec = avecTous.find(x => x.horaire === 'N')!;
  assert.deepEqual([avec.postes, avec.formations[0].titulaires, avec.manque], [1, 0, true]);
  assert.deepEqual(avecTous.find(x => x.horaire === 'M') && [avecTous.find(x => x.horaire === 'M')!.postes, avecTous.find(x => x.horaire === 'M')!.manque], [0, true], 'seul salarié du matin absent : créneau découvert');
  const court = (f: string) => f.toUpperCase();
  assert.equal(creneauCouvertureTexte(avec, court), 'N : 1 sur 2 postes · SST 0 sur 1');
  assert.deepEqual(manquesCreneau(avec, court), ['effectif', 'SST']);
  assert.equal(creneauCouvertureTexte(sans[1], court), 'M : 1 poste · SST 0 sur 1');
  assert.equal(creneauCouvertureTexte(sans[0], court), 'AM : 0 sur 1 poste · SST 0 sur 1');
  // Certification obtenue après le jour du créneau, ou salarié inconnu de l'instantané : pas titulaire.
  const lundi = couvertureCreneaux(ds, 'Q', ['2026-10-26'], creneaux, false)[0];
  assert.deepEqual([lundi.postes, lundi.formations[0].titulaires], [2, 1]);
  assert.equal(titulaireLe({ certs: certs('sst', '2026-10-25') as never }, { id: 'sst', validite: 24 }, '2026-10-24'), false);
  // Équipe sans ligne de couverture ni besoin : effectif seul.
  assert.deepEqual(couvertureCreneaux(ds, 'R', ['2026-10-20'], creneaux, false).map(x => [x.horaire, x.postes, x.formations.length, x.manque]), [['J', 1, 0, false]]);
  assert.deepEqual(couvertureCreneaux({ ...ds, besoinsPoste: undefined }, 'Q', ['2026-10-22'], creneaux, false), []);
  // Jour sans aucun créneau de l'équipe (semaine pas encore générée ni publiée) : aucun créneau, même avec des besoins.
  assert.deepEqual(couvertureCreneaux(ds, 'Q', ['2026-10-22', '2026-10-27'], creneaux, false), []);
  // Un repos ou un « à pourvoir » suffit à dire que l'équipe a un planning ce jour-là : le besoin crée alors son créneau.
  assert.deepEqual(couvertureCreneaux(ds, 'Q', ['2026-10-22'], [c(4, '2026-10-22', null)], false).map(x => [x.horaire, x.postes, x.besoin, x.manque]), [['N', 0, 2, true]]);
  assert.deepEqual(couvertureCreneaux(ds, 'Q', ['2026-10-22'], [c(null, '2026-10-22', 'N')], false).map(x => [x.horaire, x.postes, x.besoin]), [['N', 0, 2]]);
});

test('couverture par créneau : une équipe publiée sur une seule semaine n’a aucun manque la semaine suivante', () => {
  const ds = {
    employes: [{ id: 1, certs: [] }] as never,
    referentiels: { equipes: [{ nom: 'M', couverture: [{ formation: 'sst', min: 1 }] }] as never, formations: [{ id: 'sst', validite: 24, archive: null }] },
    besoinsPoste: [{ id: 1, equipe: 'M', horaire: 'N', jours: [0, 1, 2, 3, 4, 5, 6], effectifMin: 1, posteId: null, activite: null, exigences: { formations: [], habilitations: [] }, du: '2026-01-01', au: null, archive: null }],
    absences: [],
  };
  const r = couvertureCreneaux(ds, 'M', ['2026-10-19', '2026-10-26'], [{ empId: 1, jour: '2026-10-19', equipe: 'M', horaire: 'N' }], false);
  assert.deepEqual(r.map(x => [x.jour, x.horaire, x.postes, x.besoin, x.manque]), [['2026-10-19', 'N', 1, 1, true]], 'le 26 : rien de planifié, rien de suivi');
});

test('couverture par créneau dans l’aperçu de la publication ; référent HSE sans postes « à pourvoir »', async () => {
  const { db, user, KARIM } = await fresh();
  await db.update('equipes', 'Maintenance', { couverture: [{ formation: 'sst', min: 1 }] });
  // Thomas (sans SST) seul au poste de nuit du 20 ; Romain (SST) au poste de nuit du 21.
  await creneau(db, 6, '2026-10-20', 'N', 'brouillon');
  await creneau(db, 18, '2026-10-21', 'N', 'brouillon');
  const d = new Domain(await loadFull(db, KARIM));
  const a = apercuPublication(d, 'Maintenance', '2026-10-19', '2026-10-25');
  assert.deepEqual(a.couverture.map(x => [x.jour, x.horaire, x.formations[0].titulaires]), [['2026-10-20', 'N', 0]]);
  assert.deepEqual(apercuPublication(d, 'Maintenance', '2026-11-02', '2026-11-08').couverture, [], 'aucun brouillon : rien');
  // Un poste « à pourvoir » publié : la lecture seule et la paie le reçoivent, jamais le référent HSE.
  await creneau(db, null, '2026-10-22', 'N');
  await creneau(db, 18, '2026-10-22', 'M');
  const hse = await buildSnapshot(db, await user(23, 'rh'));
  assert.deepEqual(hse.creneauxAPourvoir, []);
  assert.ok(hse.creneaux!.length > 0 && hse.creneaux!.every(c => c.empId != null));
  assert.equal((await buildSnapshot(db, await user(11, 'rh'))).creneauxAPourvoir!.length, 1);
  assert.equal((await buildSnapshot(db, await user(7, 'rh'))).creneauxAPourvoir!.length, 1);
});
