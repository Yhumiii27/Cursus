// Tests : organismes de formation et e-learning sur la base, sur les deux moteurs (lot 12, chantier C4, étape 1 ;
// server/src/reprise-organismes.ts, server/src/actions/organismes.ts, server/src/actions/elearning.ts,
// server/src/vues-organismes.ts, server/src/journal-organismes.ts).
// Reprise sans perte des textes libres (rapprochement par clé, alias, SIRET concordants seulement, jamais de réunion de deux
// SIRET différents, idempotente, journal en compteurs), `formations.organisme` tenu à jour dans la même transaction
// (contrat pub_titres_detenus, lu sur PostgreSQL), fiches, conditions, contacts, tarifs, fusion, session figée à sa
// création, cycle d'une inscription (fin déclarée, validée par le service RH : formation suivie et certification comptées
// une fois), import d'avancement, journal en liste blanche, instantané par espace et par profil, banc d'oracle.
// Jeu de démonstration au 10 octobre 2026 (server/src/seed-organismes.ts) : Mehdi Benali (2) et Thomas Garnier (6),
// Maintenance (Karim Haddad, 12), inscrits au module RGPD-EL ; Sophie Lemaire (3) au module ATEX-THEO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
delete process.env.CURSUS_DEMO;

const { nouvelleBase, PG } = await import('./base.ts');
const { seedDemo, FORMATIONS } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { controlerOrphelins } = await import('../server/src/integrite.ts');
const { reprendreOrganismes, repriseNecessaire } = await import('../server/src/reprise-organismes.ts');
const { mettreAJourBase } = await import('../server/src/demarrage.ts');
const { Domain } = await import('../shared/domain.ts');
const { realisationsDe } = await import('../shared/rules/heures-formation.ts');
const { suivieCertifiee } = await import('../shared/rules/formations-suivies.ts');
const { baseDemo, rejouer, resumeRapport } = await import('./support/oracle.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Compte = import('../server/src/comptes.ts').Compte;
type Organisme = import('../shared/types-organismes.ts').Organisme;
type InscriptionElearning = import('../shared/types-organismes.ts').InscriptionElearning;

const SIRET_X = '55123456000003', SIRET_Y = '81234567000002';

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one<Compte>(empId ? 'SELECT * FROM comptes WHERE emp_id = ?' : 'SELECT * FROM comptes WHERE emp_id IS NULL', empId ? [empId] : []))!;
  const personne = async (empId: number | null, role: User['role'] = 'rh') => (await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' }))!;
  const u = {
    admin: await personne(null), gest: await personne(14), lecture: await personne(11), hse: await personne(23), paie: await personne(7),
    karim: await personne(12, 'manager'), hugo: await personne(16, 'manager'), mehdi: await personne(2, 'collaborateur'),
  };
  // Action exécutée comme par POST /api/actions/:nom : journal compris, signé du compte de la personne.
  const run = async (user: User, name: string, payload: Record<string, unknown>) => {
    const compte = await compteDe(user.empId ?? user.salarieId ?? null);
    return await db.tx(async () => {
      const t = await preparerTrace(db, name, payload);
      const r = await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), payload);
      const o = typeof r === 'object' && r !== null ? r : { message: r, result: undefined };
      await journaliserAction(db, t, { user, compte, message: o.message ?? null, result: o.result });
      return o as { message: string | null; result?: any };
    });
  };
  const msg = async (user: User, name: string, payload: Record<string, unknown>) => (await run(user, name, payload)).message ?? '';
  const refus = async (user: User, name: string, payload: Record<string, unknown>, motif: RegExp, statut = 400) => {
    await assert.rejects(async () => await run(user, name, payload), (e: unknown) => {
      assert.ok(e instanceof ActionError, String(e));
      assert.equal(e.status, statut, e.message);
      assert.match(e.message, motif);
      return true;
    });
  };
  const code = async (c: string) => (await db.one<Organisme>('SELECT id FROM organismes WHERE code = ?', [c]))!.id;
  const fiche = async (id: number) => (await db.get<Organisme>('organismes', id))!;
  const moduleId = async (c: string) => (await db.one<{ id: number }>('SELECT id FROM modules_elearning WHERE code = ?', [c]))!.id;
  const inscription = async (empId: number, module: string) => (await db.one<{ id: number }>(
    'SELECT i.id FROM inscriptions_elearning i JOIN modules_elearning m ON m.id = i.module_id WHERE i.emp_id = ? AND m.code = ? ORDER BY i.id DESC LIMIT 1', [empId, module]))!.id;
  const lireInscription = async (id: number) => (await db.get<InscriptionElearning>('inscriptionsElearning', id))!;
  const journal = async (action: string) => (await db.query<{ payload: unknown; message: string; salaries: unknown }>('SELECT payload, message, salaries FROM journal WHERE action = ? ORDER BY id', [action]))
    .map(l => ({ payload: (typeof l.payload === 'string' ? JSON.parse(l.payload) : l.payload) as Record<string, any>, message: l.message, salaries: l.salaries }));
  const reglages = async (r: Record<string, unknown>) => await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), ...r });
  const organismeFormation = async (f: string) => ({ ...(await db.one<{ organisme: string; organisme_id: number | null }>('SELECT organisme, organisme_id FROM formations WHERE id = ?', [f]))! });
  return { db, u, run, msg, refus, code, fiche, moduleId, inscription, lireInscription, journal, reglages, organismeFormation };
}

test('reprise : textes libres repris en fiches (clé, internes à part, alias), objets rattachés, textes intacts ; idempotente', async () => {
  const { db, code, fiche, journal } = await fresh();
  // Démonstration : une fiche par organisme du catalogue et des formations suivies, rien ne reste à reprendre.
  const fiches = await db.all<Organisme>('organismes', 'id');
  assert.deepEqual(fiches.filter(o => o.source === 'reprise' && o.code !== 'APAVE-SUD').map(o => [o.code, o.nomUsuel, o.type]).sort(), [
    ['AFTRAL', 'AFTRAL', 'externe'], ['APAVE', 'Apave', 'externe'], ['CROIX-ROUGE-FRANCAISE', 'Croix-Rouge française', 'externe'], ['GRETA-INDUSTRIE', 'GRETA Industrie', 'externe'],
    ['INRS', 'INRS', 'externe'], ['INTERNE-DSI', 'Interne · DSI', 'interne'], ['INTERNE-HSE', 'Interne · HSE', 'interne'], ['SOCOTEC', 'Socotec', 'externe'],
  ]);
  for (const f of FORMATIONS) {
    const r = (await db.one<{ organisme: string; organisme_id: number }>('SELECT organisme, organisme_id FROM formations WHERE id = ?', [f.id]))!;
    assert.equal(r.organisme, f.organisme, `${f.id} : texte d’origine gardé`);
    assert.equal((await fiche(r.organisme_id)).nomUsuel, f.organisme);
  }
  assert.equal(Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE organisme_id IS NULL'))!.n), 0, 'sessions passées : celui du catalogue');
  // Lignes du plan : sans fiche propre, celle de leur formation (organismeDuPlan) ; un changement de formation la suit.
  assert.equal(Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM plan_actions WHERE organisme_id IS NOT NULL'))!.n), 0);
  assert.equal((await db.one<{ organisme_id: number }>(`SELECT organisme_id FROM formations_suivies WHERE organisme = 'GRETA Industrie'`))!.organisme_id, await code('GRETA-INDUSTRIE'));
  assert.equal(await repriseNecessaire(db), false);
  assert.equal(await reprendreOrganismes(db), null);
  // Base existante complétée hors de Cursus : nouvelles formations (deux graphies d'une même clé dont les dossiers OPCO
  // portent des SIRET différents), textes saisis par Vigie sur les certifications, formation suivie en minuscules.
  const formation = async (id: string, organisme: string) => await db.insert('formations', { ...FORMATIONS[0], id, nom: `Formation ${id}`, court: id, organisme, organismeId: null });
  await formation('bv1', 'Bureau Veritas');
  await formation('bv2', 'BUREAU VERITAS SA');
  await formation('inco', 'Organisme non renseigné');
  for (const [f, siret, nda] of [['bv1', SIRET_X, '11755468475'], ['bv1', SIRET_X, '11755468475'], ['bv2', SIRET_Y, null]] as const) {
    const l = await db.insert<{ id: number }>('planActions', { exercice: 2026, f, libelle: null, equipe: 'Maintenance', periode: 'T4', effectif: 1, cout: 100, statut: 'prevu', origine: null });
    await db.insert('dossiersOpco', {
      planActionId: l.id, empId: null, exercice: 2026, opco: 'opco2i', dispositif: 'plan', statut: 'a_deposer', subrogation: false, organismeSiret: siret, organismeNda: nda,
      organismeQualiopi: true, creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Reprise',
    });
  }
  const [c1, c2] = (await db.query<{ id: number }>('SELECT id FROM certifications ORDER BY id LIMIT 2'));
  await db.run('UPDATE certifications SET organisme = ? WHERE id = ?', ['Apave SAS', c1.id]);
  await db.run('UPDATE certifications SET organisme = ? WHERE id = ?', ['Institut Nouveau', c2.id]);
  await db.insert('formationsSuivies', { empId: 3, f: null, libelle: 'Atelier sécurité', du: '2026-05-04', au: '2026-05-04', duree: 3, organisme: 'apave', obligatoire: false, origine: 'saisie', le: '2026-05-05' });
  assert.equal(await repriseNecessaire(db), true);
  const bilan = await reprendreOrganismes(db);
  assert.deepEqual(bilan, { fiches: 3, rattachements: 6, alias: 2, conflits: 1, siret: 2, nda: 1, qualiopi: 2 });
  const bv = (await db.all<Organisme>('organismes', 'id')).filter(o => o.code.startsWith('BUREAU-VERITAS'));
  assert.deepEqual(bv.map(o => [o.code, o.siret, o.nda, o.qualiopi, o.qualiopiValideJusquau, o.aVerifier, o.alias]), [
    ['BUREAU-VERITAS', SIRET_X, '11755468475', true, null, true, ['Bureau Veritas']],
    ['BUREAU-VERITAS-SA', SIRET_Y, null, true, null, true, ['BUREAU VERITAS SA']],
  ], 'jamais réunis : SIRET différents');
  assert.deepEqual([(await db.one<{ organisme_id: number }>(`SELECT organisme_id FROM formations WHERE id = 'bv2'`))!.organisme_id], [bv[1].id]);
  assert.equal((await db.one<{ organisme_id: number | null }>(`SELECT organisme_id FROM formations WHERE id = 'inco'`))!.organisme_id, null, '« Organisme non renseigné » : jamais une fiche');
  assert.equal(Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM dossiers_opco WHERE organisme_id IS NULL'))!.n), 0, 'dossiers rattachés par leur ligne du plan');
  const apave = await fiche(await code('APAVE'));
  assert.deepEqual(apave.alias, ['Apave', 'apave', 'Apave SAS'], 'graphies conservées ; aucune donnée de la fiche vérifiée remplacée');
  assert.equal(apave.siret, '77568516000001');
  assert.equal((await db.one<{ code: string }>(`SELECT code FROM organismes WHERE nom_usuel = 'Institut Nouveau'`))!.code, 'INSTITUT-NOUVEAU', 'texte de Vigie : une fiche, sans rattachement');
  assert.equal((await db.one<{ organisme: string }>('SELECT organisme FROM certifications WHERE id = ?', [c1.id]))!.organisme, 'Apave SAS', 'texte intact');
  // Journal : compteurs seulement.
  const [j] = await journal('migration.organismes');
  assert.deepEqual(j.payload, bilan);
  assert.doesNotMatch(JSON.stringify(j), /Bureau|Veritas|Apave|Institut|55123456|81234567/);
  assert.match(j.message, /^Reprise des organismes de formation : 3 fiches créées \(à vérifier\), 6 rattachements, 1 conflit de SIRET/);
  // Rejouée : rien ; au démarrage aussi (mettreAJourBase, deux moteurs).
  assert.equal(await repriseNecessaire(db), false);
  assert.equal(await reprendreOrganismes(db), null);
  await mettreAJourBase(db);
  assert.equal((await journal('migration.organismes')).length, 1);
  assert.equal((await controlerOrphelins(db)).orphelins, 0);
  // Base neuve : rien à reprendre.
  const vide = await nouvelleBase();
  assert.equal(await repriseNecessaire(vide), false);
});

test('reprise : deux SIRET sur la clé d’une fiche saisie sans SIRET — jamais réunis dans cette fiche', async () => {
  const { db, u, run } = await fresh();
  // Fiche saisie (source « saisie », sans SIRET) : elle ne reçoit pas de SIRET à la reprise.
  const saisie = (await run(u.gest, 'organisme.enregistrer', { nomUsuel: 'Bureau Veritas' })).result.id as number;
  for (const [f, texte, siret] of [['bv1', 'Bureau Veritas', SIRET_X], ['bv2', 'BUREAU VERITAS SA', SIRET_Y], ['bv3', 'Bureau Veritas', null]] as const) {
    await db.insert('formations', { ...FORMATIONS[0], id: f, nom: `Formation ${f}`, court: f, organisme: texte, organismeId: null });
    const l = await db.insert<{ id: number }>('planActions', { exercice: 2026, f, libelle: null, equipe: 'Maintenance', periode: 'T4', effectif: 1, cout: 100, statut: 'prevu', origine: null });
    await db.insert('dossiersOpco', {
      planActionId: l.id, empId: null, exercice: 2026, opco: 'opco2i', dispositif: 'plan', statut: 'a_deposer', subrogation: false, organismeSiret: siret, organismeNda: null,
      organismeQualiopi: false, creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Reprise',
    });
  }
  const bilan = (await reprendreOrganismes(db))!;
  assert.equal(bilan.conflits, 1);
  const lien = async (f: string) => Number((await db.one<{ organisme_id: number }>('SELECT organisme_id FROM formations WHERE id = ?', [f]))!.organisme_id);
  const [x, y, sans] = [await lien('bv1'), await lien('bv2'), await lien('bv3')];
  assert.equal(new Set([x, y, sans]).size, 3, 'une fiche par SIRET, la fiche saisie pour le texte sans SIRET');
  assert.equal(sans, saisie);
  const siretDe = async (id: number) => (await db.get<Organisme>('organismes', id))!.siret;
  assert.deepEqual([await siretDe(x), await siretDe(y), await siretDe(saisie)], [SIRET_X, SIRET_Y, null]);
  // Dossiers OPCO : chacun sur la fiche de sa formation.
  const dossiers = await db.query<{ f: string; organisme_id: number }>('SELECT p.f AS f, d.organisme_id AS organisme_id FROM dossiers_opco d JOIN plan_actions p ON p.id = d.plan_action_id WHERE p.f IN (\'bv1\', \'bv2\', \'bv3\') ORDER BY p.f');
  assert.deepEqual(dossiers.map(d => [d.f, Number(d.organisme_id)]), [['bv1', x], ['bv2', y], ['bv3', saisie]]);
  assert.equal(await repriseNecessaire(db), false);
});

test('formations.organisme tenu à jour dans la même transaction (contrat pub_titres_detenus) : renommage, rattachement, fusion', async () => {
  const { db, u, run, msg, code, organismeFormation, fiche } = await fresh();
  const apave = await code('APAVE'), sud = await code('APAVE-SUD');
  assert.equal(await msg(u.gest, 'organisme.enregistrer', { id: apave, nomUsuel: 'Apave Formation' }), 'Organisme « Apave Formation » modifié · nom repris par 3 formations du catalogue');
  for (const f of ['elec', 'atex', 'aipr']) assert.deepEqual(await organismeFormation(f), { organisme: 'Apave Formation', organisme_id: apave });
  // Formation rattachée à une autre fiche : son nom ; détachée (vide) : texte saisi gardé.
  await run(u.hse, 'referentiel.formation.enregistrer', { ...FORMATIONS.find(f => f.id === 'atex'), id: 'atex', organismeId: sud });
  assert.deepEqual(await organismeFormation('atex'), { organisme: 'APAVE Sud Europe', organisme_id: sud });
  await run(u.hse, 'referentiel.formation.enregistrer', { ...FORMATIONS.find(f => f.id === 'aipr'), id: 'aipr', organisme: 'Prestataire libre', organismeId: '' });
  assert.deepEqual(await organismeFormation('aipr'), { organisme: 'Prestataire libre', organisme_id: null });
  // Champ absent (dialogue sans sélecteur) : rattachement gardé tant que le texte désigne la fiche (nom usuel ou alias, nom
  // usuel réécrit) ; un autre texte détache la formation, texte saisi gardé (repris au démarrage suivant).
  await run(u.hse, 'referentiel.formation.enregistrer', { ...FORMATIONS.find(f => f.id === 'elec'), id: 'elec', organisme: 'Apave Formation' });
  assert.deepEqual(await organismeFormation('elec'), { organisme: 'Apave Formation', organisme_id: apave });
  await run(u.hse, 'referentiel.formation.enregistrer', { ...FORMATIONS.find(f => f.id === 'elec'), id: 'elec', organisme: 'APAVE' });
  assert.deepEqual(await organismeFormation('elec'), { organisme: 'Apave Formation', organisme_id: apave }, 'alias : même fiche');
  await run(u.hse, 'referentiel.formation.enregistrer', { ...FORMATIONS.find(f => f.id === 'elec'), id: 'elec', organisme: 'Socotec' });
  assert.deepEqual(await organismeFormation('elec'), { organisme: 'Socotec', organisme_id: null }, 'texte saisi gardé, jamais contredit par la fiche');
  await reprendreOrganismes(db);
  assert.deepEqual(await organismeFormation('elec'), { organisme: 'Socotec', organisme_id: await code('SOCOTEC') }, 'repris au démarrage suivant');
  await run(u.hse, 'referentiel.formation.enregistrer', { ...FORMATIONS.find(f => f.id === 'elec'), id: 'elec', organismeId: apave });
  // Fusion : la formation rattachée à la fiche absorbée prend la fiche qui reste et son nom.
  const r = await run(u.admin, 'organisme.fusionner', { source: sud, cible: apave, motif: 'Agence saisie deux fois', objets: 1 });
  assert.match(r.message!, /^« APAVE Sud Europe » fusionné dans « Apave Formation » — 1 objet réaffecté · nom repris par 1 formation du catalogue$/);
  assert.deepEqual(await organismeFormation('atex'), { organisme: 'Apave Formation', organisme_id: apave });
  assert.deepEqual((await fiche(apave)).alias, ['Apave', 'APAVE Sud Europe', 'Apave sud']);
  if (PG) {
    // Vue publiée : l'organisme des titres détenus suit la fiche (coalesce(certification, formation)).
    const lignes = await db.query<{ code: string; organisme: string }>(`SELECT code, organisme FROM pub_titres_detenus WHERE nature = 'formation' AND code IN ('elec', 'atex', 'aipr', 'sst') ORDER BY code`);
    assert.ok(lignes.some(l => l.code === 'elec'), 'certifications elec publiées');
    for (const l of lignes) assert.equal(l.organisme, { elec: 'Apave Formation', atex: 'Apave Formation', aipr: 'Prestataire libre', sst: 'Croix-Rouge française' }[l.code], l.code);
  }
});

test('fiches : création, conditions (service RH), archivage, vérification ; fusion refusée (SIRET, interne, confirmation périmée) puis faite', async () => {
  const { db, u, run, msg, refus, code, fiche } = await fresh();
  const r = await run(u.hse, 'organisme.enregistrer', { nomUsuel: 'Formateur Dupont', type: 'independant', siret: '732 829 320 00074', nda: '11 75 5468475', qualiopi: true, qualiopiValideJusquau: '2027-03-31' });
  const id = r.result.id as number;
  assert.deepEqual((({ code, type, siret, nda, source, aVerifier, creePar }) => ({ code, type, siret, nda, source, aVerifier, creePar }))(await fiche(id)),
    { code: 'FORMATEUR-DUPONT', type: 'independant', siret: '73282932000074', nda: '11755468475', source: 'saisie', aVerifier: false, creePar: 'Sarah Cohen' });
  await refus(u.hse, 'organisme.enregistrer', { nomUsuel: 'APAVE' }, /fusionnez/);
  await refus(u.hse, 'organisme.enregistrer', { id: 999 }, /introuvable/, 404);
  // Conditions : service RH seulement.
  await refus(u.hse, 'organisme.conditions', { id, conditions: 'Paiement à 30 jours' }, /service RH/, 403);
  await run(u.gest, 'organisme.conditions', { id, subrogationAcceptee: true, delaiAnnulationJours: 7, conditions: 'Paiement à 30 jours' });
  assert.deepEqual((({ subrogationAcceptee, delaiAnnulationJours, conditions }) => ({ subrogationAcceptee, delaiAnnulationJours, conditions }))(await fiche(id)), { subrogationAcceptee: true, delaiAnnulationJours: 7, conditions: 'Paiement à 30 jours' });
  // Archivage : refusé tant qu'une formation ou un module la désigne ; rétablissement ; vérification d'une fiche reprise.
  await refus(u.gest, 'organisme.archiver', { id: await code('APAVE') }, /Organisme par défaut de .*ATEX-THEO/);
  assert.match(await msg(u.gest, 'organisme.archiver', { id }), /archivé/);
  assert.match(await msg(u.gest, 'organisme.archiver', { id }), /déjà archivé/);
  await refus(u.gest, 'elearning.module.enregistrer', { code: 'DUP', intitule: 'x', url: 'https://x.example', organismeId: id }, /archivé ou fusionné/);
  assert.match(await msg(u.gest, 'organisme.archiver', { id, archive: false }), /rétabli/);
  assert.match(await msg(u.gest, 'organisme.archiver', { id, archive: false }), /déjà en vigueur/);
  const croix = await code('CROIX-ROUGE-FRANCAISE');
  assert.equal((await fiche(croix)).aVerifier, true);
  assert.match(await msg(u.hse, 'organisme.verifier', { id: croix }), /vérifié$/);
  assert.match(await msg(u.hse, 'organisme.verifier', { id: croix }), /déjà vérifié/);
  // Fusion : administrateur RH, motif ; jamais deux SIRET différents, ni un service interne avec un externe.
  const apave = await code('APAVE'), aftral = await code('AFTRAL'), sud = await code('APAVE-SUD');
  await refus(u.gest, 'organisme.fusionner', { source: sud, cible: apave, motif: 'x' }, /administrateur RH/, 403);
  await refus(u.admin, 'organisme.fusionner', { source: aftral, cible: apave, motif: 'x' }, /SIRET différents/);
  await refus(u.admin, 'organisme.fusionner', { source: await code('INTERNE-HSE'), cible: apave, motif: 'x' }, /service interne/);
  await refus(u.admin, 'organisme.fusionner', { source: sud, cible: apave, motif: ' ' }, /Motif/);
  await refus(u.admin, 'organisme.fusionner', { source: sud, cible: 999, motif: 'x' }, /introuvable/, 404);
  // Rattachements de la fiche absorbée : une session, un contact ; confirmation périmée (nombre affiché différent) refusée.
  await db.run('UPDATE sessions SET organisme_id = ? WHERE id = 2', [sud]);
  await run(u.hse, 'organisme.contact.enregistrer', { organismeId: sud, nom: 'Paul Durand', role: 'formateur' });
  await refus(u.admin, 'organisme.fusionner', { source: sud, cible: apave, motif: 'Doublon', objets: 1 }, /ont changé \(2 aujourd’hui\)/, 409);
  const f = await run(u.admin, 'organisme.fusionner', { source: sud, cible: apave, motif: 'Doublon de l’agence', objets: 2 });
  assert.deepEqual(f.result.rattachements, { formations: 0, sessions: 1, suivies: 0, plan: 0, dossiers: 0, modules: 0, contacts: 1, tarifs: 0 });
  const s = await fiche(sud);
  assert.deepEqual([s.fusionneDans, s.archive, s.fusionneLe, s.fusionnePar, s.fusionneMotif, s.aVerifier], [apave, '2026-10-10', '2026-10-10', 'Sandrine Vidal', 'Doublon de l’agence', false]);
  assert.equal((await db.one<{ organisme_id: number }>('SELECT organisme_id FROM sessions WHERE id = 2'))!.organisme_id, apave);
  await refus(u.gest, 'organisme.enregistrer', { id: sud, nomUsuel: 'Autre' }, /a été fusionné dans Apave/);
  await refus(u.admin, 'organisme.fusionner', { source: sud, cible: apave, motif: 'x' }, /déjà fusionné/);
  await refus(u.gest, 'organisme.archiver', { id: sud, archive: false }, /fusionné/);
  // SIRET et déclaration d'activité de la fiche absorbée repris s'ils manquent à celle qui reste.
  const dupont2 = (await run(u.hse, 'organisme.enregistrer', { nomUsuel: 'Dupont Formation', nda: '11930567894' })).result.id as number;
  await run(u.admin, 'organisme.fusionner', { source: id, cible: dupont2, motif: 'Même formateur' });
  assert.deepEqual([(await fiche(dupont2)).siret, (await fiche(dupont2)).nda], ['73282932000074', '11930567894']);
  assert.equal((await controlerOrphelins(db)).orphelins, 0);
});

test('session : organisme figé à la création (catalogue, ligne du plan, ou choisi) ; un changement du catalogue ne la réattribue pas', async () => {
  const { db, u, run, refus, code } = await fresh();
  const croix = await code('CROIX-ROUGE-FRANCAISE'), aftral = await code('AFTRAL');
  const s1 = (await run(u.gest, 'session.creer', { f: 'sst', date: '2026-12-01', lieu: 'Site de Lyon', places: 8 })).result.id as number;
  const s2 = (await run(u.gest, 'session.creer', { f: 'sst', date: '2026-12-02', lieu: 'Site de Lyon', places: 8, organismeId: aftral })).result.id as number;
  await run(u.hse, 'referentiel.formation.enregistrer', { ...FORMATIONS.find(f => f.id === 'sst'), id: 'sst', organismeId: aftral });
  const s3 = (await run(u.gest, 'session.creer', { f: 'sst', date: '2026-12-03', lieu: 'Site de Lyon', places: 8 })).result.id as number;
  const org = async (id: number) => (await db.one<{ organisme_id: number }>('SELECT organisme_id FROM sessions WHERE id = ?', [id]))!.organisme_id;
  assert.deepEqual([await org(s1), await org(s2), await org(s3)], [croix, aftral, aftral]);
  const ds = await loadFull(db, u.gest);
  const { organismeDeSession } = await import('../shared/rules/organismes.ts');
  assert.equal(organismeDeSession(ds, ds.sessions.find(s => s.id === s1)!)!.nomUsuel, 'Croix-Rouge française', 'historique gardé');
  await run(u.gest, 'organisme.enregistrer', { nomUsuel: 'Ancien prestataire' });
  const ancien = await code('ANCIEN-PRESTATAIRE');
  await run(u.gest, 'organisme.archiver', { id: ancien });
  await refus(u.gest, 'session.creer', { f: 'sst', date: '2026-12-04', lieu: 'Lyon', places: 8, organismeId: ancien }, /archivé ou fusionné/);
  await refus(u.gest, 'session.creer', { f: 'sst', date: '2026-12-04', lieu: 'Lyon', places: 8, organismeId: 999 }, /Organisme inconnu/);
});

test('dossier OPCO prérempli par la fiche de la ligne du plan ; formation suivie rattachée à une fiche (texte libre admis)', async () => {
  const { db, u, run, refus, code } = await fresh();
  const aftral = await code('AFTRAL'), apave = await code('APAVE');
  const fco = (await db.one<{ id: number }>(`SELECT id FROM plan_actions WHERE f = 'fco' AND statut = 'prevu'`))!.id;
  const d1 = (await run(u.gest, 'opco.creer', { planActionId: fco, du: '2026-11-16', au: '2026-11-17' })).result.id as number;
  const d2 = (await run(u.gest, 'opco.creer', { planActionId: fco, organismeId: apave, organismeQualiopi: false })).result.id as number;
  // Qualiopi d'AFTRAL valable jusqu'au 30 novembre 2026 : échu à la date de début, il n'est pas déclaré ; sans date de
  // validité (fiche reprise), non plus.
  const d3 = (await run(u.gest, 'opco.creer', { planActionId: fco, du: '2026-12-07', au: '2026-12-08' })).result.id as number;
  assert.equal(!!(await db.one<{ q: unknown }>('SELECT organisme_qualiopi AS q FROM dossiers_opco WHERE id = ?', [d3]))!.q, false, 'Qualiopi échu au début : non déclaré');
  await db.run('UPDATE organismes SET qualiopi_valide_jusquau = NULL WHERE id = ?', [aftral]);
  const d4 = (await run(u.gest, 'opco.creer', { planActionId: fco, du: '2026-11-16' })).result.id as number;
  assert.equal(!!(await db.one<{ q: unknown }>('SELECT organisme_qualiopi AS q FROM dossiers_opco WHERE id = ?', [d4]))!.q, false, 'sans date de validité : non déclaré');
  const dossier = async (id: number) => ({ ...(await db.one<Record<string, unknown>>('SELECT organisme_id, organisme_siret, organisme_nda, organisme_qualiopi FROM dossiers_opco WHERE id = ?', [id]))! });
  assert.deepEqual({ ...await dossier(d1), organisme_qualiopi: !!(await dossier(d1)).organisme_qualiopi }, { organisme_id: aftral, organisme_siret: '44712345000002', organisme_nda: '11930567893', organisme_qualiopi: true });
  assert.deepEqual({ ...await dossier(d2), organisme_qualiopi: !!(await dossier(d2)).organisme_qualiopi }, { organisme_id: apave, organisme_siret: '77568516000001', organisme_nda: '11755468475', organisme_qualiopi: false }, 'saisie gardée');
  // Formation suivie : fiche choisie (son nom), puis texte libre seul.
  const x = (await run(u.hse, 'formationSuivie.enregistrer', { empId: 3, libelle: 'Habilitation chimique', du: '2026-09-01', au: '2026-09-02', duree: 14, organismeId: apave })).result.id as number;
  const suivie = async () => ({ ...(await db.one<{ organisme: string | null; organisme_id: number | null }>('SELECT organisme, organisme_id FROM formations_suivies WHERE id = ?', [x]))! });
  assert.deepEqual(await suivie(), { organisme: 'Apave', organisme_id: apave });
  await run(u.hse, 'formationSuivie.modifier', { id: x, organismeId: '', organisme: 'Cabinet Martin', motif: 'Organisme corrigé' });
  assert.deepEqual(await suivie(), { organisme: 'Cabinet Martin', organisme_id: null });
  await run(u.hse, 'formationSuivie.modifier', { id: x, organismeId: aftral, motif: 'Organisme corrigé' });
  assert.deepEqual(await suivie(), { organisme: 'AFTRAL', organisme_id: aftral });
  await refus(u.hse, 'formationSuivie.modifier', { id: x, organismeId: 999, motif: 'x' }, /Organisme inconnu/);
  // Texte seul (dialogue actuel) : fiche gardée si le texte la désigne encore, sinon détachée (jamais contredite).
  await run(u.hse, 'formationSuivie.modifier', { id: x, organisme: 'Aftral', duree: 15, motif: 'Durée corrigée' });
  assert.deepEqual(await suivie(), { organisme: 'Aftral', organisme_id: aftral });
  await run(u.hse, 'formationSuivie.modifier', { id: x, organisme: 'AFPA Strasbourg', motif: 'Organisme corrigé' });
  assert.deepEqual(await suivie(), { organisme: 'AFPA Strasbourg', organisme_id: null });
  // Démonstration : formation suivie de Mehdi Benali, « GRETA Industrie » corrigé sans sélecteur.
  const greta = (await db.one<{ id: number }>(`SELECT id FROM formations_suivies WHERE organisme = 'GRETA Industrie'`))!.id;
  await run(u.hse, 'formationSuivie.modifier', { id: greta, organisme: 'AFPA Strasbourg', motif: 'Organisme corrigé' });
  assert.equal((await db.one<{ organisme_id: number | null }>('SELECT organisme_id FROM formations_suivies WHERE id = ?', [greta]))!.organisme_id, null);
});

test('ligne du plan : organisme lu sur sa formation ; une autre formation, un autre organisme (session, dossier OPCO)', async () => {
  const { db, u, run, code } = await fresh();
  const aftral = await code('AFTRAL'), croixRouge = await code('CROIX-ROUGE-FRANCAISE');
  const l = (await db.one<{ id: number; organisme_id: number | null }>(`SELECT id, organisme_id FROM plan_actions WHERE f = 'fco' AND statut = 'prevu' ORDER BY id LIMIT 1`))!;
  assert.equal(l.organisme_id, null, 'pas figée par la reprise');
  // Ligne d'une base qui porterait encore l'organisme de son ancienne formation : remis à celui du catalogue.
  await db.run('UPDATE plan_actions SET organisme_id = ? WHERE id = ?', [aftral, l.id]);
  await run(u.gest, 'plan.modifier', { id: l.id, f: 'sst', motif: 'Formation corrigée' });
  assert.equal((await db.one<{ organisme_id: number | null }>('SELECT organisme_id FROM plan_actions WHERE id = ?', [l.id]))!.organisme_id, null);
  const d = (await run(u.gest, 'opco.creer', { planActionId: l.id })).result.id as number;
  assert.equal(Number((await db.one<{ organisme_id: number }>('SELECT organisme_id FROM dossiers_opco WHERE id = ?', [d]))!.organisme_id), croixRouge);
  const s = (await run(u.gest, 'session.creer', { f: 'sst', date: '2026-12-03', lieu: 'Site de Lyon', places: 8, planId: l.id })).result.id as number;
  assert.equal(Number((await db.one<{ organisme_id: number }>('SELECT organisme_id FROM sessions WHERE id = ?', [s]))!.organisme_id), croixRouge);
  // Démarrage suivant : rien à reprendre, aucune nouvelle entrée au journal.
  assert.equal(await repriseNecessaire(db), false);
});

test('contacts (droit « formations ») et tarifs (service RH) : un seul contact principal, retrait par archivage', async () => {
  const { db, u, run, msg, refus, code } = await fresh();
  const apave = await code('APAVE');
  const c = (await run(u.hse, 'organisme.contact.enregistrer', { organismeId: apave, nom: 'Paul Durand', email: 'paul.durand@apave.example', role: 'formateur', principal: true })).result.id as number;
  const principaux = async () => (await db.query<{ nom: string }>('SELECT nom FROM organisme_contacts WHERE organisme_id = ? AND principal = ? ORDER BY id', [apave, true])).map(x => x.nom);
  assert.deepEqual(await principaux(), ['Paul Durand']);
  await run(u.hse, 'organisme.contact.enregistrer', { id: c, fonction: 'Formateur électricité' });
  await refus(u.hse, 'organisme.contact.enregistrer', { organismeId: apave, nom: 'X', email: 'pas-une-adresse' }, /e-mail/);
  assert.match(await msg(u.hse, 'organisme.contact.retirer', { id: c }), /^Contact retiré — Apave$/);
  assert.equal(await msg(u.hse, 'organisme.contact.retirer', { id: c }), 'Contact déjà retiré');
  await refus(u.hse, 'organisme.contact.enregistrer', { id: c, nom: 'Y' }, /introuvable ou retiré/, 404);
  await refus(u.hse, 'organisme.tarif.enregistrer', { organismeId: apave, formation: 'atex', montantHt: 350 }, /service RH/, 403);
  const t = (await run(u.gest, 'organisme.tarif.enregistrer', { organismeId: apave, formation: 'atex', montantHt: '350', valableDu: '2026-01-01' })).result.id as number;
  await run(u.gest, 'organisme.tarif.enregistrer', { id: t, montantHt: 365 });
  const ds = await loadFull(db, u.gest);
  const { tarifEnVigueur } = await import('../shared/rules/organismes.ts');
  assert.equal(tarifEnVigueur(ds.organismeTarifs, apave, 'atex', '2026-10-10')?.montantHt, 365);
  assert.match(await msg(u.gest, 'organisme.tarif.archiver', { id: t }), /^Tarif archivé — Apave$/);
  assert.equal(await msg(u.gest, 'organisme.tarif.archiver', { id: t }), 'Tarif déjà archivé');
});

test('e-learning : module, inscriptions, fin déclarée par le salarié, validée par le service RH (formation suivie et certification comptées une fois)', async () => {
  const { db, u, run, msg, refus, code, moduleId, inscription, lireInscription } = await fresh();
  await refus(u.hse, 'elearning.module.enregistrer', { code: 'X1', intitule: 'Essai', url: 'http://elearning.example' }, /https/);
  const m = (await run(u.hse, 'elearning.module.enregistrer', { code: 'sec-1', intitule: 'Sécurité générale', url: 'https://elearning.example/sec', organismeId: await code('INTERNE-HSE'), formation: 'epi', dureeHeures: '1,5' })).result.id as number;
  assert.equal(await msg(u.hse, 'elearning.module.enregistrer', { id: m, accesMois: 3 }), 'Module d’e-learning SEC-1 modifié');
  // Inscription depuis une ligne du plan (équipe Maintenance), puis individuelle : un déjà inscrit est passé.
  const ligne = (await db.one<{ id: number }>(`SELECT id FROM plan_actions WHERE equipe = 'Maintenance' AND annule_le IS NULL ORDER BY id LIMIT 1`))!.id;
  const r = await run(u.hse, 'elearning.inscrire', { moduleId: m, planActionId: ligne, echeance: '2026-12-31' });
  const equipe = (await loadFull(db, u.gest)).employes.filter(e => e.equipe === 'Maintenance' && (!e.fin || e.fin >= '2026-10-10')).map(e => e.id);
  assert.deepEqual([...r.result.empIds].sort(), [...equipe].sort());
  assert.match(await msg(u.hse, 'elearning.inscrire', { moduleId: m, empIds: [2, 3] }), /^Module SEC-1 : 1 salarié inscrit · 1 déjà inscrit$/);
  await refus(u.hse, 'elearning.inscrire', { moduleId: m, empIds: [] }, /au moins un salarié/);
  await refus(u.hse, 'elearning.inscrire', { moduleId: m, empId: 2, echeance: '2026-01-01' }, /précède/);
  // Fin déclarée : le salarié lui-même, une fois ; ni son manager, ni le service RH à sa place.
  const mehdi = await inscription(2, 'RGPD-EL');
  await refus(u.karim, 'elearning.declarer', { id: mehdi }, /Seul le salarié inscrit/, 403);
  await refus(u.gest, 'elearning.declarer', { id: mehdi }, /Seul le salarié inscrit/, 403);
  assert.match(await msg(u.mehdi, 'elearning.declarer', { id: mehdi }), /fin déclarée ; le service RH la valide$/);
  assert.match(await msg(u.mehdi, 'elearning.declarer', { id: mehdi }), /fin déjà déclarée le 10 oct\. 2026/);
  // Fin validée (service RH) : formation suivie « elearning » et certification RGPD ; heures comptées une seule fois.
  await refus(u.hse, 'elearning.terminer', { id: mehdi }, /service RH/, 403);
  await refus(u.gest, 'elearning.terminer', { id: mehdi, de: 'inscrit' }, /désormais « En cours »/, 409);
  await refus(u.gest, 'elearning.terminer', { id: mehdi, termineLe: '2026-10-11' }, /futur/);
  assert.match(await msg(u.gest, 'elearning.terminer', { id: mehdi, de: 'en_cours', termineLe: '2026-10-09', reussi: 'oui' }), /^RGPD-EL terminé — Mehdi Benali · formation suivie enregistrée \(2 h\) · RGPD ajoutée au dossier de Mehdi Benali/);
  const i = await lireInscription(mehdi);
  assert.deepEqual([i.statut, i.termineLe, i.heures, i.reussi, i.avancement], ['termine', '2026-10-09', 2, true, 100]);
  const ds = await loadFull(db, u.gest);
  const suivie = ds.formationsSuivies!.find(x => x.id === i.suivieId)!;
  assert.deepEqual([suivie.origine, suivie.f, suivie.du, suivie.au, suivie.duree, suivie.organisme, suivie.organismeId], ['elearning', 'rgpd', '2026-09-15', '2026-10-09', 2, 'Interne · DSI', await code('INTERNE-DSI')]);
  const d = new Domain(ds);
  assert.equal(d.emp(2)!.certs.find(c => c.id === i.certId)?.obtenue, '2026-10-09');
  assert.ok(suivieCertifiee(d.emp(2), suivie));
  assert.deepEqual(realisationsDe(d, 2026).filter(x => x.empId === 2 && x.intitule.startsWith('Sensibilisation RGPD')).map(x => [x.source, x.heures]), [['certification', 2]]);
  assert.match(await msg(u.gest, 'elearning.terminer', { id: mehdi, de: 'en_cours' }), /déjà terminé/);
  await refus(u.hse, 'elearning.abandonner', { id: mehdi, de: 'en_cours' }, /désormais « Terminé »/, 409);
  await refus(u.hse, 'elearning.abandonner', { id: mehdi }, /terminé, elle ne change plus/);
  // Module sans formation du catalogue (ATEX-THEO) : formation suivie seule, intitulé du module, organisme de la fiche.
  const sophie = await inscription(3, 'ATEX-THEO');
  await run(u.admin, 'elearning.terminer', { id: sophie, heures: 4, reussi: '' });
  const fini = await lireInscription(sophie);
  const s2 = (await loadFull(db, u.gest)).formationsSuivies!.find(x => x.id === fini.suivieId)!;
  assert.deepEqual([s2.f, s2.libelle, s2.duree, s2.organisme, fini.certId, fini.reussi], [null, 'ATEX niveau 1 — partie théorique', 4, 'Apave', null, null]);
  // Nouvelle inscription possible après une fin (recyclage) ; abandon ; correction motivée ; annulation.
  assert.match(await msg(u.hse, 'elearning.inscrire', { moduleId: await moduleId('ATEX-THEO'), empId: 3 }), /1 salarié inscrit/);
  const nouvelle = await inscription(3, 'ATEX-THEO');
  await refus(u.hse, 'elearning.corriger', { id: nouvelle, echeance: '2026-12-15' }, /Motif/);
  assert.equal(await msg(u.hse, 'elearning.corriger', { id: nouvelle, echeance: null }), 'Aucune modification');
  await run(u.hse, 'elearning.corriger', { id: nouvelle, echeance: '2026-12-15', avancement: '25 %', motif: 'Échéance reportée' });
  assert.deepEqual((({ echeance, avancement, avancementSource, corrigeMotif }) => ({ echeance, avancement, avancementSource, corrigeMotif }))(await lireInscription(nouvelle)),
    { echeance: '2026-12-15', avancement: 25, avancementSource: 'rh', corrigeMotif: 'Échéance reportée' });
  assert.match(await msg(u.hse, 'elearning.abandonner', { id: nouvelle, de: 'en_cours' }), /abandonnée/);
  assert.match(await msg(u.hse, 'elearning.abandonner', { id: nouvelle }), /déjà abandonné/);
  await refus(u.hse, 'elearning.corriger', { id: nouvelle, echeance: '2026-12-20', motif: 'x' }, /abandonné/);
  // Annulation : administrateur RH ; refusée tant que la formation suivie produite est en vigueur.
  await refus(u.gest, 'elearning.annuler', { id: mehdi, motif: 'x' }, /administrateur RH/, 403);
  await refus(u.admin, 'elearning.annuler', { id: mehdi, motif: 'Saisie sur la mauvaise fiche' }, /supprimez d’abord la formation suivie/);
  await run(u.admin, 'formationSuivie.annuler', { id: i.suivieId, motif: 'Erreur' });
  await refus(u.admin, 'elearning.annuler', { id: mehdi, motif: 'Saisie sur la mauvaise fiche' }, /supprimez d’abord la certification/);
  await run(u.admin, 'cert.annuler', { id: i.certId, motif: 'Erreur' });
  assert.match(await msg(u.admin, 'elearning.annuler', { id: mehdi, motif: 'Saisie sur la mauvaise fiche' }), /supprimée \(saisie erronée\)/);
  await refus(u.admin, 'elearning.annuler', { id: mehdi, motif: 'x' }, /introuvable ou annulée/, 404);
  // Module archivé : plus d'inscription ; rétabli.
  assert.match(await msg(u.hse, 'elearning.module.archiver', { id: m }), /archivé — plus proposé ; \d+ inscriptions ouvertes continuent/);
  await refus(u.hse, 'elearning.inscrire', { moduleId: m, empId: 7 }, /archivé/);
  assert.match(await msg(u.hse, 'elearning.module.archiver', { id: m, archive: false }), /rétabli/);
  assert.equal((await controlerOrphelins(db)).orphelins, 0);
});

test('import d’avancement : aperçu sans effet, lignes valides appliquées, idempotent, colonnes fermées ; fin d’office seulement par réglage', async () => {
  const { u, run, refus, reglages, inscription, lireInscription } = await fresh();
  const fichier = ['matricule;module;statut;avancement;date de fin;réussite', 'EMP-0002;RGPD-EL;en cours;75;;', 'EMP-0006;RGPD-EL;terminé;;09/10/2026;oui', 'EMP-0099;RGPD-EL;;10;;'].join('\n');
  const apercu = await run(u.hse, 'elearning.importer', { texte: fichier, apercu: true });
  assert.equal(apercu.message, 'Aperçu — 3 lignes lues : 2 inscriptions mises à jour, 1 ligne en erreur (rien n’est enregistré)');
  assert.deepEqual(apercu.result.erreurs, [{ n: 4, erreurs: ['salarié introuvable (matricule ou e-mail)'] }]);
  assert.equal((await lireInscription(await inscription(2, 'RGPD-EL'))).avancement, 40);
  const r = await run(u.hse, 'elearning.importer', { texte: fichier });
  assert.equal(r.message, '3 lignes lues : 2 inscriptions mises à jour, 1 ligne en erreur');
  assert.deepEqual((({ avancement, avancementSource, statut }) => ({ avancement, avancementSource, statut }))(await lireInscription(await inscription(2, 'RGPD-EL'))), { avancement: 75, avancementSource: 'import', statut: 'en_cours' });
  const thomas = await lireInscription(await inscription(6, 'RGPD-EL'));
  assert.deepEqual([thomas.avancement, thomas.avancementLe, thomas.reussi, thomas.statut, thomas.suivieId], [100, '2026-10-09', true, 'en_cours', null], 'fin à valider par le service RH');
  assert.equal((await run(u.hse, 'elearning.importer', { texte: fichier })).message, '3 lignes lues : 0 inscription mise à jour, 2 inchangées, 1 ligne en erreur');
  await refus(u.hse, 'elearning.importer', { texte: 'matricule;module;durée de connexion\nEMP-0002;RGPD-EL;3h' }, /Colonne non admise.*aucun temps de connexion/);
  await refus(u.karim, 'elearning.importer', { texte: fichier }, /référent HSE/, 403);
  // Réglage : fin validée d'office pour un module sans attestation exigée (« terminé » et « réussi ») ; annoncée dès l'aperçu.
  await reglages({ elearningFinAutoImport: true });
  const apercuFin = await run(u.gest, 'elearning.importer', { texte: 'matricule;module;statut;réussite\nEMP-0006;RGPD-EL;terminé;oui\nEMP-0003;ATEX-THEO;terminé;oui', apercu: true });
  assert.equal(apercuFin.message, 'Aperçu — 2 lignes lues : 2 inscriptions mises à jour, 1 fin validée d’office (rien n’est enregistré)');
  assert.equal(apercuFin.result.terminees, 1);
  assert.equal((await lireInscription(await inscription(6, 'RGPD-EL'))).statut, 'en_cours', 'aperçu : rien n’est écrit');
  const fin = await run(u.gest, 'elearning.importer', { texte: 'matricule;module;statut;réussite\nEMP-0006;RGPD-EL;terminé;oui\nEMP-0003;ATEX-THEO;terminé;oui' });
  assert.equal(fin.message, '2 lignes lues : 2 inscriptions mises à jour, 1 fin validée d’office');
  assert.equal((await lireInscription(await inscription(6, 'RGPD-EL'))).statut, 'termine');
  assert.equal((await lireInscription(await inscription(3, 'ATEX-THEO'))).statut, 'en_cours', 'attestation exigée : validation du service RH');
});

test('journal : liste blanche (jamais un contact, une URL, un alias, un avancement, une réussite ni un motif ; SIRET noté modifié)', async () => {
  const { db, u, run, code, moduleId, inscription, journal } = await fresh();
  const apave = await code('APAVE');
  const id = (await run(u.hse, 'organisme.enregistrer', { nomUsuel: 'Jean Martin Formation', type: 'independant', siret: '73282932000074' })).result.id as number;
  await run(u.hse, 'organisme.enregistrer', { id, siret: '55123456000003', nda: '11755468475', qualiopi: true, qualiopiValideJusquau: '2027-01-31' });
  await run(u.gest, 'organisme.conditions', { id, conditions: 'Annulation sans frais à J-10', delaiAnnulationJours: 10 });
  await run(u.hse, 'organisme.contact.enregistrer', { organismeId: id, nom: 'Jean Martin', email: 'jean.martin@exemple.example', telephone: '06 12 34 56 78', role: 'formateur' });
  await run(u.gest, 'organisme.tarif.enregistrer', { organismeId: apave, libelle: 'Audit sur site', montantHt: 900, unite: 'jour' });
  await run(u.admin, 'organisme.fusionner', { source: await code('APAVE-SUD'), cible: apave, motif: 'Motif très personnel' });
  await run(u.hse, 'elearning.module.enregistrer', { id: await moduleId('RGPD-EL'), url: 'https://secret.example/lien', intitule: 'Nouvel intitulé' });
  await run(u.hse, 'elearning.importer', { texte: 'matricule;module;avancement\nEMP-0002;RGPD-EL;77' });
  await run(u.hse, 'elearning.corriger', { id: await inscription(2, 'RGPD-EL'), avancement: 66, echeance: '2026-12-31', motif: 'Motif de correction' });
  await run(u.gest, 'elearning.terminer', { id: await inscription(6, 'RGPD-EL'), reussi: false });
  const tout = JSON.stringify(await db.query("SELECT action, message, payload FROM journal WHERE action LIKE 'organisme.%' OR action LIKE 'elearning.%'"));
  for (const interdit of ['Jean Martin', 'jean.martin', '06 12', 'Annulation sans frais', 'secret.example', 'https://', 'Nouvel intitulé', 'APAVE Sud Europe', 'Apave sud', 'Motif', '"avancement"', '"reussi"',
    '73282932000074', '55123456000003', '11755468475', 'Audit sur site']) {
    assert.doesNotMatch(tout, new RegExp(interdit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), interdit);
  }
  const [creation, modif] = await journal('organisme.enregistrer');
  assert.deepEqual(creation.payload, { organisme: id, code: 'JEAN-MARTIN-FORMATION', type: 'independant', qualiopi: false, qualiopiValideJusquau: null, siret: '[SIRET modifié]', nda: null });
  assert.deepEqual(modif.payload.avant, { siret: '[SIRET modifié]', nda: null, qualiopi: false, qualiopiValideJusquau: null });
  assert.deepEqual(modif.payload.apres, { siret: '[SIRET modifié]', nda: '[déclaration d’activité modifiée]', qualiopi: true, qualiopiValideJusquau: '2027-01-31' });
  assert.deepEqual((await journal('organisme.conditions'))[0].payload.apres, { delaiAnnulationJours: 10, conditions: '[texte renseigné]' });
  assert.deepEqual((await journal('organisme.contact.enregistrer'))[0].payload, { contact: (await db.one<{ id: number }>('SELECT max(id) AS id FROM organisme_contacts'))!.id, organisme: id, role: 'formateur', principal: false });
  assert.equal((await journal('organisme.tarif.enregistrer'))[0].payload.montantHt, 900);
  assert.deepEqual((({ codeSource, codeCible }) => ({ codeSource, codeCible }))((await journal('organisme.fusionner'))[0].payload), { codeSource: 'APAVE-SUD', codeCible: 'APAVE' });
  assert.deepEqual((await journal('elearning.module.enregistrer'))[0].payload.apres, { url: '[lien modifié]', intitule: '[texte renseigné]' });
  assert.deepEqual((await journal('elearning.importer'))[0].payload, { apercu: false, lignes: 1, modifiees: 1, inchangees: 0, terminees: 0, erreurs: 0 });
  assert.equal((await journal('elearning.importer'))[0].salaries !== null && JSON.stringify((await journal('elearning.importer'))[0].salaries).includes('2'), false, 'import : aucun salarié désigné');
  assert.deepEqual((await journal('elearning.corriger'))[0].payload.apres, { echeance: '2026-12-31', corrigeLe: '2026-10-10' });
  // Échouée : ni certification, ni réussite au journal.
  assert.deepEqual(Object.keys((await journal('elearning.terminer'))[0].payload.apres).sort(), ['heures', 'statut', 'suivieId', 'termineLe']);
  // Familles, libellés ; hors des actions liées à la paie.
  const { familleAction, estActionPaie, JOURNAL_LABEL } = await import('../shared/journal.ts');
  for (const a of [...Object.keys(ACTIONS).filter(n => n.startsWith('organisme.') || n.startsWith('elearning.')), 'migration.organismes']) {
    assert.equal(familleAction(a)!.id, a.startsWith('elearning.') ? 'formations' : 'referentiels', a);
    assert.ok(JOURNAL_LABEL[a], a);
    assert.equal(estActionPaie(a), false, a);
  }
});

test('instantané : nom réduit pour tous ; fiches, contacts et tarifs selon le droit ; inscriptions du périmètre sans motif ; rien pour la paie', async () => {
  const { db, u, run, code, inscription } = await fresh();
  await run(u.admin, 'organisme.fusionner', { source: await code('APAVE-SUD'), cible: await code('APAVE'), motif: 'Doublon' });
  await run(u.hse, 'elearning.corriger', { id: await inscription(2, 'RGPD-EL'), echeance: '2026-12-31', motif: 'Motif à garder au service RH' });
  await run(u.hse, 'organisme.enregistrer', { nomUsuel: 'Jean Dupont, coach', type: 'independant' });
  const rh = await buildSnapshot(db, u.gest);
  assert.equal(rh.organismes!.find(o => o.code === 'APAVE-SUD')!.fusionneMotif, 'Doublon');
  assert.ok(rh.organismeContacts!.length && rh.organismeTarifs!.length && rh.modulesElearning!.some(m => m.coutLicence === 45));
  assert.equal(rh.inscriptionsElearning!.find(i => i.empId === 2)!.corrigeMotif, 'Motif à garder au service RH');
  // Référentiels de tous les espaces : fiches du catalogue et fiches confirmées ; ni formateur indépendant, ni texte libre
  // d'une formation suivie repris et encore à vérifier (« GRETA Industrie », saisi sur la seule formation de Mehdi Benali).
  // APAVE-SUD : fusionnée par l'administrateur RH (plus à vérifier), nommée pour ses anciens rattachements.
  const publiees = ['AFTRAL', 'APAVE', 'APAVE-SUD', 'CROIX-ROUGE-FRANCAISE', 'INRS', 'INTERNE-DSI', 'INTERNE-HSE', 'SOCOTEC'];
  for (const user of [u.gest, u.hse, u.lecture, u.paie, u.karim, u.hugo, u.mehdi]) {
    const s = await buildSnapshot(db, user);
    const nom = `${user.role} ${user.profilRh ?? user.nom}`;
    assert.deepEqual(Object.keys(s.referentiels.organismes![0]).sort(), ['archive', 'code', 'id', 'nomUsuel', 'type'], nom);
    assert.deepEqual(s.referentiels.organismes!.map(o => o.code).sort(), publiees, nom);
  }
  assert.ok((await buildSnapshot(db, u.gest)).organismes!.some(o => o.code === 'GRETA-INDUSTRIE'), 'service RH : toutes les fiches');
  const hse = await buildSnapshot(db, u.hse);
  assert.equal(hse.organismes!.length, rh.organismes!.length);
  assert.equal(hse.organismes!.find(o => o.code === 'APAVE-SUD')!.fusionneMotif, null);
  assert.ok(hse.organismeContacts!.length && hse.organismeTarifs!.length && hse.modulesElearning!.some(m => m.coutLicence === 45));
  assert.equal(hse.inscriptionsElearning!.length, 3);
  assert.equal(hse.inscriptionsElearning!.find(i => i.empId === 2)!.corrigeMotif, null);
  const lecture = await buildSnapshot(db, u.lecture);
  assert.ok(lecture.organismes!.length);
  assert.deepEqual([lecture.organismeContacts, lecture.organismeTarifs], [[], []], 'contacts et tarifs : droit « formations » seulement');
  assert.ok(lecture.modulesElearning!.every(m => m.coutLicence === null));
  const paie = await buildSnapshot(db, u.paie);
  assert.deepEqual([paie.organismes, paie.organismeContacts, paie.organismeTarifs, paie.modulesElearning, paie.inscriptionsElearning], [[], [], [], [], []]);
  const karim = await buildSnapshot(db, u.karim);
  assert.deepEqual([karim.organismes, karim.organismeContacts, karim.organismeTarifs], [[], [], []]);
  assert.deepEqual(karim.inscriptionsElearning!.map(i => i.empId).sort(), [2, 6], 'son équipe (Maintenance)');
  assert.ok(karim.inscriptionsElearning!.every(i => i.corrigeMotif === null) && karim.modulesElearning!.every(m => m.coutLicence === null));
  assert.ok(karim.modulesElearning!.some(m => m.url.startsWith('https://')), 'lien d’accès transmis');
  assert.deepEqual((await buildSnapshot(db, u.hugo)).inscriptionsElearning, []);
  const mehdi = await buildSnapshot(db, u.mehdi);
  assert.deepEqual(mehdi.inscriptionsElearning!.map(i => i.empId), [2]);
  // Auteurs (membres du service RH) retirés hors du service RH, comme dans la copie de ses données.
  assert.ok(rh.inscriptionsElearning!.some(i => i.inscritPar));
  for (const s of [mehdi, karim, hse, lecture]) assert.ok(s.inscriptionsElearning!.every(i => i.inscritPar === null && i.corrigePar === null && i.annulePar === null));
  assert.deepEqual([mehdi.organismes, mehdi.organismeContacts, mehdi.organismeTarifs], [[], [], []]);
  // Inscription annulée : service RH seulement.
  await db.run(`UPDATE inscriptions_elearning SET annule_le = '2026-10-10', annule_par = 'Essai', annule_motif = 'Doublon' WHERE emp_id = 3`);
  assert.equal((await buildSnapshot(db, u.gest)).inscriptionsElearning!.length, 3);
  assert.equal((await buildSnapshot(db, u.hse)).inscriptionsElearning!.length, 2);
});

test('banc d’oracle : actions organisme.* et elearning.* en renfort, cache incrémental exact après chaque pas', async () => {
  const db = await baseDemo(nouvelleBase);
  const noms = Object.keys(ACTIONS).filter(n => n.startsWith('organisme.') || n.startsWith('elearning.'));
  const renfort = [...noms, ...noms, ...noms, ...Array<string>(6).fill('organisme.enregistrer'), ...Array<string>(6).fill('elearning.inscrire'), 'elearning.terminer', 'elearning.importer', 'organisme.fusionner'];
  const x = await rejouer(db, { graine: 20261101, pas: 120, verifierTous: 4, jeux: 0, sql: 0.1, renfort });
  const resume = resumeRapport(x);
  assert.deepEqual(x.divergences, [], resume);
  assert.deepEqual(x.erreurs, [], resume);
  const validees = Object.entries(x.actions).filter(([n, s]) => (n.startsWith('organisme.') || n.startsWith('elearning.')) && s.ok).map(([n]) => n);
  assert.ok(validees.length >= 3, resume);
});
