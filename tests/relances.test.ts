// Tests du chantier « entretiens, plan de formation et déplacements », étape 2, t034 : récapitulatif des échéances par
// paliers (90, 30, 7 jours, puis échu), envoyé au service RH, aux managers (sans donnée de santé) et au référent HSE
// (formations et habilitations), une seule fois par palier (table `relances`), à partir de 7 h, désactivable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_PUBLIC_URL = 'https://cursus.example.fr';
for (const k of ['CURSUS_MAIL_FROM', 'CURSUS_MAIL_TENANT', 'CURSUS_MAIL_CLIENT_ID', 'CURSUS_MAIL_CLIENT_SECRET', 'CURSUS_OIDC_TENANT', 'CURSUS_OIDC_CLIENT_ID', 'CURSUS_OIDC_CLIENT_SECRET']) delete process.env[k];

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { recapitulatifEcheances, relancerEcheances } = await import('../server/src/relances.ts');
const { tachesEmails } = await import('../server/src/notifications.ts');
const { Domain } = await import('../shared/domain.ts');
const { jourDEnvoi, palierDe, paliersRelance, relancesDues } = await import('../shared/rules/relances.ts');
const { appliquerReglages, reglagesParDefaut } = await import('../shared/reglages.ts');
const { VACCINS } = await import('../shared/constants.ts');
const { equipeLabel } = await import('../shared/format.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Ligne = Record<string, any>;

const RH_MAIL = 'rh@entreprise.example';

function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const compteDe = (empId: number | null) => db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number };
  const RH = currentUser(db, { compteId: compteDe(null).id, role: 'rh', methode: 'demo' })!;
  const run = (u: User, name: string, p: Record<string, unknown> = {}) => db.tx(() => ACTIONS[name](makeCtx(db, u, loadFull(db, u)), p));
  run(RH, 'messagerie.regler', { rh: RH_MAIL });
  /** Récapitulatifs mis en file, par adresse : texte de l'e-mail. */
  const recaps = () => {
    const out: Record<string, string[]> = {};
    for (const e of db.all<Ligne>('envois').filter(x => x.type === 'echeances.recapitulatif')) (out[e.contenu.a[0]] ??= []).push(e.contenu.texte);
    return out;
  };
  return { db, run, RH, recaps, passer: () => db.tx(() => recapitulatifEcheances(db)) };
}
/** Exécute `f` à une autre date du jour. */
function le<T>(jour: string, f: () => T): T {
  const avant = process.env.CURSUS_TODAY;
  process.env.CURSUS_TODAY = jour;
  try { return f(); } finally { process.env.CURSUS_TODAY = avant; }
}

test('paliers : 90, 30 et 7 jours puis échu ; réglage contrôlé ; jour d’envoi', () => {
  assert.equal(palierDe(120, [90, 30, 7]), null);
  assert.equal(palierDe(90, [90, 30, 7]), '90');
  assert.equal(palierDe(31, [90, 30, 7]), '90');
  assert.equal(palierDe(30, [90, 30, 7]), '30');
  assert.equal(palierDe(0, [90, 30, 7]), '7');
  assert.equal(palierDe(-1, [90, 30, 7]), 'echu');
  assert.equal(palierDe(45, [30]), null);
  const s = reglagesParDefaut();
  assert.deepEqual([s.relancesActives, s.relancesPaliers, s.relancesJour], [true, [90, 30, 7], 'quotidien']);
  assert.deepEqual(paliersRelance([7, '60', 8, 7], [90]), [60, 7], 'valeurs proposées seules, sans doublon, de la plus lointaine à la plus proche');
  assert.deepEqual(paliersRelance([], [90, 30]), [90, 30], 'liste vide : paliers en vigueur gardés');
  assert.deepEqual(appliquerReglages(s, { relancesPaliers: [15], relancesJour: 'dimanche' }).relancesPaliers, [15]);
  assert.equal(appliquerReglages(s, { relancesJour: 'dimanche' }).relancesJour, 'quotidien', 'jour inconnu : valeur en vigueur');
  assert.ok(jourDEnvoi({ relancesJour: 'quotidien' }, 5));
  assert.ok(jourDEnvoi({ relancesJour: 'lundi' }, 0));
  assert.ok(!jourDEnvoi({ relancesJour: 'lundi' }, 5));
});

test('récapitulatif : RH tout le périmètre, manager son équipe sans santé, référent HSE formations et habilitations', () => {
  const { db, recaps, passer } = fresh();
  const n = passer();
  assert.ok(n.relances > 0 && n.emails >= 4);
  const r = recaps();
  const rh = r[RH_MAIL][0];
  // Service RH : titres, visites, formalités, entretiens, déplacements au dossier incomplet.
  for (const attendu of ['Certification réglementaire CACES R486', 'Visite médicale', 'Formalité sanitaire de voyage', 'Entretien de parcours professionnel', 'Déplacement Inde']) {
    assert.ok(rh.includes(attendu), attendu);
  }
  assert.match(rh, /Échéances dépassées :\n• /);
  // Jamais de donnée de santé : ni nom de vaccin, ni avis.
  for (const t of Object.values(r).flat()) {
    for (const v of Object.values(VACCINS)) assert.ok(!t.includes(v.nom), v.nom);
    assert.ok(!/inaptitude|Inapte/.test(t));
  }
  // Karim Haddad (Maintenance) : son équipe, sans visite ni vaccination, sans lui-même.
  const karim = r['karim.haddad@entreprise.example'][0];
  assert.match(karim, /Thomas Garnier \(Maintenance\) — Certification réglementaire CACES R486/);
  assert.ok(!karim.includes('Visite médicale') && !karim.includes('Formalité sanitaire'));
  assert.ok(!karim.includes('Karim Haddad (Maintenance)'));
  assert.ok(!karim.includes('Production)'), 'pas les autres équipes');
  // Sarah Cohen, référente HSE (et manager de Qualité & HSE) : formations et habilitations de tous ; le reste, pour son
  // équipe seulement.
  const hse = r['sarah.cohen@entreprise.example'][0];
  assert.match(hse, /Antoine Leroy \(Administration\) — Certification réglementaire EPI incendie/);
  assert.ok(!/(Logistique|Production|Maintenance|Administration|Commercial)\) — (Entretien|État des lieux|Visite|Déplacement|Passeport|Fin de contrat)/.test(hse));
  // Une seule fois par palier : le passage suivant n'envoie rien.
  assert.deepEqual(passer(), { emails: 0, relances: 0 });
  assert.equal(db.all('relances').length, n.relances);
});

test('récapitulatif : boîte du service RH non renseignée, rien n’est noté ; les échéances partent après son réglage', () => {
  const { db, run, RH, recaps, passer } = fresh();
  run(RH, 'messagerie.regler', { rh: '' });
  // Mise en service sans adresse RH : ni e-mail (managers compris), ni relance notée.
  assert.deepEqual(passer(), { emails: 0, relances: 0 });
  assert.equal(db.all('relances').length, 0);
  assert.equal(Object.keys(recaps()).length, 0);
  // Boîte réglée quelques jours plus tard : les échéances dépassées lui parviennent, visites médicales comprises.
  run(RH, 'messagerie.regler', { rh: RH_MAIL });
  le('2026-10-13', () => assert.ok(passer().relances > 0));
  assert.match(recaps()[RH_MAIL][0], /Échéances dépassées :\n• /);
  assert.ok(recaps()[RH_MAIL][0].includes('Visite médicale'));
});

test('récapitulatif : un nouveau palier franchi repart, une fois ; fin de contrat ; salarié sorti absent', () => {
  const { recaps, passer } = fresh();
  passer();
  const avant = Object.values(recaps()).flat().length;
  // Julien Moreau, ATEX le 2 novembre : relancé sous 30 jours le 10 octobre, puis sous 7 jours le 27.
  le('2026-10-27', () => {
    passer();
    const nouveaux = recaps()[RH_MAIL].slice(1).join('\n');
    assert.match(nouveaux, /Sous 7 jours :\n(• .*\n)*• Julien Moreau \(Production\) — Certification réglementaire ATEX : échéance le 2 nov\. 2026/);
    assert.deepEqual(passer(), { emails: 0, relances: 0 });
  });
  // CDD de l'employé 4 jusqu'au 29 janvier 2027 : relancé à 90 jours.
  le('2026-11-01', () => {
    passer();
    assert.match(recaps()[RH_MAIL].at(-1)!, /Fin de contrat \(CDD\) : échéance le 29 janv\. 2027/);
  });
  assert.ok(Object.values(recaps()).flat().length > avant);
  // Salarié sorti : plus aucune relance.
  const db2 = fresh();
  db2.db.update('employes', 6, { fin: '2026-10-05' });
  db2.passer();
  assert.ok(!Object.values(db2.recaps()).flat().some(t => t.includes('Thomas Garnier')));
});

test('relance déjà prise en charge (session planifiée) ou entretien planifié à venir : non relancés', () => {
  const { db } = fresh();
  const d = new Domain(loadFull(db, currentUser(db, { compteId: 1, role: 'rh', methode: 'demo' })!));
  const dues = relancesDues(d, d.enrich(90, false), [90, 30, 7]);
  // Entretien annuel de Mehdi planifié le 20 octobre : rien à relancer pour lui côté entretiens.
  assert.ok(!dues.some(r => r.empId === 2 && r.categorie === 'entretien' && r.cle.includes(':annuel:')));
  // Échéances planifiées (session) écartées.
  const planifiees = d.echeances(d.enrich(90, false), 90).filter(x => x.planned).map(x => `${x.emp.id}:${x.label}`);
  assert.ok(planifiees.length > 0);
  assert.ok(!dues.some(r => planifiees.some(p => r.cle.includes(p))));
});

test('entretien annuel planifié à une date dépassée, jamais clos : relancé comme échu', () => {
  const { db, recaps, passer } = fresh();
  const x = db.sql.prepare(`SELECT id, emp_id AS empId, date FROM entretiens WHERE type = 'annuel' AND statut = 'planifie' ORDER BY date`).get() as { id: number; empId: number; date: string };
  // Le lendemain de la date prévue, sans clôture ni reprogrammation.
  const lendemain = new Date(Date.parse(x.date) + 86400000).toISOString().slice(0, 10);
  le(lendemain, () => {
    const d = new Domain(loadFull(db, currentUser(db, { compteId: 1, role: 'rh', methode: 'demo' })!));
    const r = relancesDues(d, d.enrich(90, false), [90, 30, 7]).find(y => y.cle === `entretien:${x.empId}:annuel:${x.date}`);
    assert.ok(r, 'relance de l’entretien annuel dépassé');
    assert.equal(r!.palier, 'echu');
    assert.match(r!.libelle, /planifié, date dépassée/);
    passer();
    assert.ok(recaps()[RH_MAIL][0].includes(`${d.emp(x.empId)!.nom} (${equipeLabel(d.emp(x.empId)!)}) — ${r!.libelle}`));
  });
});

test('tâche de fond : à partir de 7 h, une fois par jour, le jour réglé, désactivable', () => {
  const { db, run, RH, recaps } = fresh();
  assert.equal(db.tx(() => relancerEcheances(db, 6)), null, 'avant 7 h');
  run(RH, 'parametres.maj', { relancesActives: false });
  assert.equal(db.tx(() => relancerEcheances(db, 7)), null, 'désactivé');
  assert.equal(Object.keys(recaps()).length, 0);
  run(RH, 'parametres.maj', { relancesActives: true, relancesJour: 'lundi' });
  // Samedi 10 octobre : déjà passé aujourd'hui ; lundi 12 : envoi.
  le('2026-10-11', () => assert.equal(db.tx(() => relancerEcheances(db, 8)), null, 'dimanche'));
  le('2026-10-12', () => {
    assert.ok(db.tx(() => relancerEcheances(db, 8))!.emails > 0);
    assert.equal(db.tx(() => relancerEcheances(db, 9)), null, 'une fois par jour');
  });
  // Lancée par la tâche des e-mails (tous les quarts d'heure), le lendemain, en mode quotidien.
  run(RH, 'parametres.maj', { relancesJour: 'quotidien' });
  le('2026-10-13', () => tachesEmails(db, 7));
  assert.equal(db.getSetting('relancesEcheancesLe', null), '2026-10-13');
});

test('exigences manquantes et échéances du contrat : relancées au service RH ; titre de séjour jamais au manager', () => {
  const { db, RH } = fresh();
  // Le 15 novembre, le titre de séjour de la démonstration (expire le 29 janvier 2027) est sous 90 jours.
  const dues = le('2026-11-15', () => {
    const full = loadFull(db, RH), d = new Domain(full);
    return relancesDues(d, d.enrich(full.settings.horizonAlerte, full.settings.uniquementReglementaire), [90, 30, 7]);
  });
  // Exigences de la démonstration (Lucas Martin, cariste sans CACES) : relancées comme échues, en formation ou habilitation.
  const exigences = dues.filter(r => r.cle.startsWith('exigence:'));
  assert.ok(exigences.length && exigences.every(r => r.palier === 'echu' && ['formation', 'habilitation'].includes(r.categorie)));
  assert.ok(!dues.some(r => r.categorie === 'formalite' && /exigée|essai|séjour/i.test(r.libelle)));
  // Titres de séjour : catégorie contrat, sans type de titre, exclus du récapitulatif des managers.
  const titres = dues.filter(r => r.cle.startsWith('titre:'));
  assert.equal(titres.length, 1);
  for (const r of titres) assert.deepEqual([r.categorie, r.libelle, r.sante], ['contrat', 'Titre de séjour', true]);
  // Une fin de contrat n'est relancée qu'une fois.
  const fins = dues.filter(r => /Fin de contrat|Fin de CDD/.test(r.libelle)).map(r => r.empId);
  assert.equal(new Set(fins).size, fins.length);
});
