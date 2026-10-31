// Entités et sites (lot 11, chantier C1, étape 1 ; shared/rules/entites.ts, server/src/actions/entites.ts) : contrôles par
// valeurs (SIREN, SIRET et clé de Luhn, IDCC, deux niveaux, fermeture), actions et droits, journal en liste blanche,
// amorçage neutre au démarrage (server/src/demarrage.ts : aucun valideur changé), équipe parente qui suit l'entité,
// présents de l'organigramme par espace, cache de l'instantané (delta et oracle après la création, le renommage et la
// fermeture d'une entité et le rattachement d'une équipe), et schéma PostgreSQL (0016_entites.sql). Sur le moteur de la
// suite (SQLite par défaut, PostgreSQL avec npm run test:pg).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
delete process.env.CURSUS_DEMO;
delete process.env.CURSUS_CACHE_INSTANTANE;
delete process.env.CURSUS_CACHE_INCREMENTAL;
delete process.env.CURSUS_VUES_REPORT;

const { PG, nouvelleBase } = await import('./base.ts');
const { seedDemo, comptesDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { amorcerEntites, CODE_ENTITE_AMORCEE, mettreAJourBase } = await import('../server/src/demarrage.ts');
const { assembler, lireBrut, LECTURES, ORDRE_LECTURE } = await import('../server/src/lecture-brute.ts');
const { appliquerDelta, lireDelta } = await import('../server/src/delta.ts');
const { geler } = await import('../server/src/cache-instantane.ts');
const { REFERENCES } = await import('../server/src/integrite.ts');
const { lecteursDe, verifierExactitude } = await import('../scripts/charge/verifier.ts');
const { valideurHierarchique } = await import('../shared/rules/hierarchie.ts');
const {
  chiffres, controleEntiteEquipe, controlerEntite, controlerSite, controleSite, controleUnite, entiteEquipe, entiteOuverte, equipesDeLEntite,
  equipesRessemblantAUnSite, luhn, normaliserIdcc, rattachementSalarie, refusFermeture, refusReouverture, sirenValide, siretValide, societeDe,
} = await import('../shared/rules/entites.ts');
type Db = Awaited<ReturnType<typeof nouvelleBase>>;
type User = Parameters<typeof loadFull>[1];
type Entite = NonNullable<Awaited<ReturnType<typeof loadFull>>['referentiels']['entites']>[number];
type Site = NonNullable<Awaited<ReturnType<typeof loadFull>>['referentiels']['sites']>[number];
type Brut = Awaited<ReturnType<typeof lireBrut>>;

const T = '2026-10-10';
const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const GEST: User = { role: 'rh', empId: 14, nom: 'Antoine Leroy', intitule: 'Gestionnaire RH', profilRh: 'rh_gestionnaire' };
const MEHDI: User = { role: 'collaborateur', empId: 2, nom: 'Mehdi Benali', intitule: 'Technicien de maintenance' };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: 'Manager · Maintenance' };

const societe = (o: Partial<Entite> = {}): Entite => ({
  code: 'epc2i', nom: 'EPC2I', type: 'societe', parente: null, siren: '552100554', siret: null, idcc: '0044', siteCode: null, ordre: 0, actif: true, fermeLe: null, source: 'local', ...o,
});
const etab = (o: Partial<Entite> = {}): Entite => ({
  code: 'lyon', nom: 'Établissement de Lyon', type: 'etablissement', parente: 'epc2i', siren: null, siret: '55210055400013', idcc: null, siteCode: null, ordre: 1, actif: true, fermeLe: null, source: 'local', ...o,
});
const SITES: Site[] = [{ code: 'lab67', libelle: 'Laboratoire 67', actif: true, ordre: 0 }, { code: 'ancien', libelle: 'Ancien site', actif: false, ordre: 1 }];
const eq = (nom: string, o: { managerId?: number | null; parente?: string | null; entite?: string | null; siteCode?: string | null; uniteCode?: string | null; ordre?: number } = {}) =>
  ({ nom, managerId: o.managerId ?? null, ordre: o.ordre ?? 0, parente: o.parente ?? null, entite: o.entite ?? null, siteCode: o.siteCode ?? null, uniteCode: o.uniteCode ?? null });

// — Règles pures —

test('SIREN et SIRET : 9 et 14 chiffres, clé de Luhn ; règle de La Poste ; IDCC sur 4 chiffres', () => {
  assert.equal(luhn('79927398713'), true);
  assert.equal(luhn('79927398710'), false);
  assert.equal(luhn('12a4'), false);
  assert.equal(sirenValide('552100554'), true);
  assert.equal(sirenValide('552100555'), false, 'clé fausse');
  assert.equal(sirenValide('55210055'), false, '8 chiffres');
  assert.equal(siretValide('55210055400013'), true);
  assert.equal(siretValide('54205118000066'), true);
  assert.equal(siretValide('55210055400014'), false, 'clé fausse');
  assert.equal(siretValide('5521005540001'), false, '13 chiffres');
  assert.equal(siretValide('12345678900003'), false, 'SIREN invalide même si la clé du SIRET tombe juste');
  // La Poste (SIREN 356000000) : la somme des chiffres du SIRET est un multiple de 5, sans clé de Luhn.
  assert.equal(siretValide('35600000049837'), true);
  assert.equal(siretValide('35600000000048'), false);
  assert.equal(chiffres('552 100 554.00013'), '55210055400013');
  assert.equal(normaliserIdcc('44'), '0044');
  assert.equal(normaliserIdcc(' 0044 '), '0044');
  assert.equal(normaliserIdcc('0'), null);
  assert.equal(normaliserIdcc('12345'), null);
  assert.equal(normaliserIdcc('chimie'), null);
});

test('entité : création d’une société puis d’un établissement, contrôles champ par champ', () => {
  const s = controlerEntite({ code: ' EPC2I ', nom: ' EPC2I   SAS ', type: 'societe', siren: '552 100 554', idcc: '44', siret: '552 100 554 00005' }, [], SITES, null);
  assert.deepEqual(s.erreurs, {});
  assert.deepEqual(s.entite, {
    code: 'epc2i', nom: 'EPC2I SAS', type: 'societe', parente: null, siren: '552100554', siret: '55210055400005', idcc: '0044', siteCode: null, ordre: 0, actif: true, fermeLe: null, source: 'local',
  });
  const entites: Entite[] = [s.entite!];
  const e = controlerEntite({ code: 'lyon', nom: 'Lyon', type: 'etablissement', parente: 'epc2i', siret: '55210055400013', siteCode: 'lab67' }, entites, SITES, null);
  assert.deepEqual(e.erreurs, {});
  assert.equal(e.entite!.ordre, 1);
  assert.equal(e.entite!.siteCode, 'lab67');
  assert.equal(e.entite!.siren, null);
  // Refus, champ par champ.
  const err = (p: Parameters<typeof controlerEntite>[0], liste: Entite[] = entites, existant: Entite | null = null) => controlerEntite(p, liste, SITES, existant).erreurs;
  assert.match(err({ nom: 'X', type: 'societe' }).code!, /Indiquez le code/);
  assert.match(err({ code: '1abc', nom: 'X', type: 'societe' }).code!, /2 à 32 lettres/);
  assert.match(err({ code: 'epc2i', nom: 'X', type: 'societe' }).code!, /existe déjà/);
  assert.match(err({ code: 'x2', nom: '', type: 'societe' }).nom!, /raison sociale/);
  assert.match(err({ code: 'x2', nom: 'N'.repeat(121), type: 'societe' }).nom!, /120 caractères/);
  assert.match(err({ code: 'x2', nom: 'X', type: 'filiale' }).type!, /société ou établissement/);
  assert.match(err({ code: 'x2', nom: 'X', type: 'societe', parente: 'epc2i' }).parente!, /pas de société parente/);
  assert.match(err({ code: 'x2', nom: 'X', type: 'societe', siren: '552100555' }).siren!, /clé de contrôle/);
  assert.match(err({ code: 'x2', nom: 'X', type: 'societe', siren: '552100554' }).siren!, /déjà celui d’une autre société/);
  assert.match(err({ code: 'x2', nom: 'X', type: 'etablissement' }).parente!, /Choisissez la société/);
  assert.match(err({ code: 'x2', nom: 'X', type: 'etablissement', parente: 'inconnue' }).parente!, /introuvable/);
  assert.match(err({ code: 'x2', nom: 'X', type: 'etablissement', parente: 'lyon' }, [...entites, e.entite!]).parente!, /introuvable/, 'un établissement n’est pas une société');
  assert.match(err({ code: 'x2', nom: 'X', type: 'etablissement', parente: 'epc2i' }, [societe({ actif: false, fermeLe: '2026-01-01' })]).parente!, /est fermée/);
  assert.match(err({ code: 'x2', nom: 'X', type: 'etablissement', parente: 'epc2i', siren: '552100554' }).siren!, /celui de la société/);
  assert.match(err({ code: 'x2', nom: 'X', type: 'etablissement', parente: 'epc2i', siret: '55210055400014' }).siret!, /clé de contrôle/);
  assert.match(err({ code: 'x2', nom: 'X', type: 'etablissement', parente: 'epc2i', siret: '73282932000009' }).siret!, /commencer par le SIREN de la société \(552100554\)/);
  assert.match(err({ code: 'x2', nom: 'X', type: 'etablissement', parente: 'epc2i', siret: '55210055400005' }).siret!, /déjà celui d’une autre entité/);
  assert.match(err({ code: 'x2', nom: 'X', type: 'societe', siren: '732829320', siret: '55210055400021' }).siret!, /commencer par le SIREN/, 'siège d’une société');
  assert.match(err({ code: 'x2', nom: 'X', type: 'societe', idcc: 'chimie' }).idcc!, /1 à 4 chiffres/);
  assert.match(err({ code: 'x2', nom: 'X', type: 'societe', siteCode: 'nulle_part' }).siteCode!, /inconnu/);
  assert.match(err({ code: 'x2', nom: 'X', type: 'societe', siteCode: 'ancien' }).siteCode!, /plus actif/);
  assert.equal(controlerEntite({ code: 'x2', nom: 'X', type: 'societe' }, [], [], null).entite!.ordre, 0);
});

test('entité : modification (type fixé, SIREN qui garde les SIRET des établissements, site déjà porté)', () => {
  const entites = [societe(), etab({ siteCode: 'ancien' })];
  // Le type et le code ne changent pas ; le site inactif déjà porté reste admis.
  const m = controlerEntite({ code: 'autre', type: 'societe', nom: 'Lyon Est', parente: 'epc2i', siret: '55210055400013', siteCode: 'ancien' }, entites, SITES, entites[1]);
  assert.deepEqual(m.erreurs, {});
  assert.deepEqual([m.entite!.code, m.entite!.type, m.entite!.nom, m.entite!.ordre], ['lyon', 'etablissement', 'Lyon Est', 1]);
  // Établissement d'une société fermée depuis : il garde sa société.
  const fermee = [societe({ actif: false, fermeLe: '2026-09-01' }), etab()];
  assert.deepEqual(controlerEntite({ nom: 'Lyon', parente: 'epc2i', siret: '55210055400013' }, fermee, SITES, fermee[1]).erreurs, {});
  // SIREN de la société changé : refusé tant qu'un établissement porte un SIRET d'un autre SIREN.
  assert.match(controlerEntite({ nom: 'EPC2I', siren: '732829320' }, entites, SITES, entites[0]).erreurs.siren!, /SIRET de Établissement de Lyon ne commence pas/);
  assert.deepEqual(controlerEntite({ nom: 'EPC2I', siren: '552100554' }, entites, SITES, entites[0]).erreurs, {});
  // Champs vidés : null.
  assert.deepEqual([controlerEntite({ nom: 'EPC2I' }, entites, SITES, entites[0]).entite!.siren], [null]);
});

test('entité : ouverture, société d’un établissement, fermeture et réouverture', () => {
  const entites = [societe(), etab()];
  assert.equal(entiteOuverte(entites[0]), true);
  assert.equal(entiteOuverte(societe({ actif: false, fermeLe: '2026-01-01' })), false);
  assert.equal(entiteOuverte(undefined), false);
  assert.equal(societeDe(entites, entites[1])?.code, 'epc2i');
  assert.equal(societeDe(entites, entites[0])?.code, 'epc2i');
  const equipes = [eq('Production', { entite: 'lyon' }), eq('Maintenance', { parente: 'Production', entite: 'epc2i' }), eq('Commercial', { entite: 'epc2i' })];
  // L'entité posée sur une équipe rattachée n'est pas lue : elle hérite de son équipe racine.
  assert.equal(entiteEquipe(equipes, 'Maintenance'), 'lyon');
  assert.equal(entiteEquipe(equipes, 'Inconnue'), null);
  assert.deepEqual(equipesDeLEntite(equipes, 'lyon'), ['Production', 'Maintenance']);
  assert.match(refusFermeture(entites[1], entites, equipes)!, /Des équipes relèvent de Établissement de Lyon \(Production, Maintenance\) : rattachez-les/);
  assert.match(refusFermeture(entites[0], entites, [equipes[2]])!, /Une équipe relève de EPC2I \(Commercial\) : rattachez-la/);
  assert.match(refusFermeture(entites[0], entites, [])!, /établissements ouverts \(Établissement de Lyon\)/);
  assert.equal(refusFermeture(entites[0], [entites[0], etab({ actif: false, fermeLe: '2026-01-01' })], []), null);
  assert.equal(refusFermeture(entites[1], entites, []), null);
  assert.match(refusReouverture(entites[1], [societe({ actif: false, fermeLe: '2026-01-01' }), entites[1]])!, /La société EPC2I est fermée/);
  assert.equal(refusReouverture(entites[1], entites), null);
  assert.equal(refusReouverture(entites[0], entites), null);
});

test('rattachements : équipe racine seule, site et unité Matrix, site et unité du salarié', () => {
  const entites = [societe({ siteCode: 'siege' }), etab({ siteCode: 'lab67' }), etab({ code: 'nord', nom: 'Nord', siret: null, actif: false, fermeLe: '2026-01-01' })];
  const equipes = [eq('Production', { entite: 'lyon', uniteCode: 'PRD' }), eq('Maintenance', { parente: 'Production', siteCode: 'atelier', uniteCode: 'PRD-MAINT' }),
    eq('Méthodes', { parente: 'Maintenance' }), eq('Commercial', { entite: 'epc2i' }), eq('Sans', {})];
  assert.match(controleEntiteEquipe(equipes, entites, 'Maintenance', 'epc2i')!, /rattachée à l’équipe Production : elle relève de l’entité de son équipe racine/);
  assert.match(controleEntiteEquipe(equipes, entites, 'Inconnue', 'epc2i')!, /introuvable/);
  assert.match(controleEntiteEquipe(equipes, entites, 'Sans', 'inconnue')!, /Entité inconnue introuvable/);
  assert.match(controleEntiteEquipe(equipes, entites, 'Sans', 'nord')!, /L’entité Nord est fermée/);
  assert.equal(controleEntiteEquipe(equipes, entites, 'Sans', 'lyon'), null);
  assert.equal(controleEntiteEquipe(equipes, entites, 'Production', null), null);
  assert.equal(controleSite(SITES, null, 'lab67'), null);
  assert.equal(controleSite(SITES, 'ancien', 'ancien'), null, 'site inactif déjà porté');
  assert.match(controleSite(SITES, 'Lab 67', null)!, /Code de site/);
  assert.match(controleSite(SITES, 'inconnu', null)!, /Site inconnu inconnu/);
  assert.match(controleSite(SITES, 'ancien', null)!, /Ancien site n’est plus actif/);
  assert.equal(controleSite(SITES, 'lab67', null), null);
  assert.equal(controleUnite(equipes, 'Sans', null), null);
  assert.match(controleUnite(equipes, 'Sans', 'prd')!, /trois lettres majuscules/);
  assert.match(controleUnite(equipes, 'Sans', 'PRD-MAINT')!, /déjà celui de l’équipe Maintenance/);
  assert.equal(controleUnite(equipes, 'Maintenance', 'PRD-MAINT'), null);
  assert.equal(controleUnite(equipes, 'Sans', 'LOG-QUAI-EQ1'), null);
  // Salarié : site et unité de son équipe, sinon d'une équipe au-dessus, le site à défaut de l'entité.
  assert.deepEqual(rattachementSalarie(equipes, entites, 'Méthodes'), { siteCode: 'atelier', uniteCode: 'PRD-MAINT' });
  assert.deepEqual(rattachementSalarie(equipes, entites, 'Production'), { siteCode: 'lab67', uniteCode: 'PRD' });
  assert.deepEqual(rattachementSalarie(equipes, entites, 'Commercial'), { siteCode: 'siege', uniteCode: null });
  assert.deepEqual(rattachementSalarie(equipes, entites, 'Sans'), { siteCode: null, uniteCode: null });
  assert.deepEqual(rattachementSalarie(equipes, entites, 'Inconnue'), { siteCode: null, uniteCode: null });
  assert.deepEqual(rattachementSalarie(equipes, entites, null), { siteCode: null, uniteCode: null });
});

test('sites : saisie contrôlée ; équipes racines au nom de site signalées', () => {
  assert.deepEqual(controlerSite({ code: ' PDE ', libelle: ' Plateforme  PDE ' }, SITES, null).site, { code: 'pde', libelle: 'Plateforme PDE', actif: true, ordre: 2 });
  assert.deepEqual(controlerSite({ code: 'pde', libelle: 'PDE' }, [], null).site!.ordre, 0);
  assert.match(controlerSite({ libelle: 'X' }, SITES, null).erreurs.code!, /Indiquez le code/);
  assert.match(controlerSite({ code: '_x', libelle: 'X' }, SITES, null).erreurs.code!, /2 à 32 lettres/);
  assert.match(controlerSite({ code: 'lab67', libelle: 'X' }, SITES, null).erreurs.code!, /existe déjà/);
  assert.match(controlerSite({ code: 'pde', libelle: '' }, SITES, null).erreurs.libelle!, /Indiquez le libellé/);
  assert.match(controlerSite({ code: 'pde', libelle: 'L'.repeat(81) }, SITES, null).erreurs.libelle!, /80 caractères/);
  assert.deepEqual(controlerSite({ libelle: 'Labo 67', actif: false }, SITES, SITES[0]).site, { code: 'lab67', libelle: 'Labo 67', actif: false, ordre: 0 });
  assert.equal(controlerSite({ libelle: 'Ancien' }, SITES, SITES[1]).site!.actif, false, 'actif gardé s’il n’est pas envoyé');
  const equipes = [eq('Site de Lyon'), eq('Usine 2'), eq('Établissement Nord'), eq('Dépôts'), eq('Atelier mécanique'), eq('Maintenance'), eq('Plateforme', { parente: 'Usine 2' }), eq('Situation')];
  assert.deepEqual(equipesRessemblantAUnSite(equipes), ['Site de Lyon', 'Usine 2', 'Établissement Nord', 'Dépôts']);
});

// — Actions, journal, amorçage —

async function demo(): Promise<Db> {
  const db = await nouvelleBase();
  await seedDemo(db);
  await db.tx(async () => await comptesDemo(db));
  return db;
}
/**
 * `run` suit le chemin de POST /api/actions/:nom (état lu avant l'action, trace au journal après), avec le compte de la
 * personne (RH : l'administratrice ; GEST : le gestionnaire RH ; MEHDI, KARIM : leurs comptes de démonstration).
 */
const runSur = (db: Db) => async (qui: User, nom: string, p: Record<string, unknown>) => await db.tx(async () => {
  const c = await db.one<{ id: number }>(qui.empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', qui.empId ? [qui.empId] : []);
  const u = (await currentUser(db, { compteId: c!.id, role: qui.role, methode: 'demo' } as never))!;
  const t = await preparerTrace(db, nom, p);
  const r = await ACTIONS[nom](makeCtx(db, u, await loadFull(db, u)), p);
  const o = typeof r === 'object' && r !== null ? r : { message: r };
  await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', c!.id))!, message: o.message ?? null, result: o.result });
  return o.message;
});
const refus = async (f: Promise<unknown>, motif: RegExp, statut = 400) => {
  await assert.rejects(f, (e: unknown) => e instanceof ActionError && e.status === statut && motif.test(e.message));
};
/** Dernière ligne de `action` qui porte des valeurs avant et après (une action sans effet ne trace que ses codes). */
const changementDe = async (db: Db, action: string) => (await db.query<{ payload: unknown }>('SELECT payload FROM journal WHERE action = ? ORDER BY id DESC', [action]))
  .map(l => (typeof l.payload === 'string' ? JSON.parse(l.payload) : l.payload) as Record<string, unknown>).find(x => x.avant);
const journalDe = async (db: Db, action: string) => {
  const l = await db.one<{ message: string; payload: unknown }>('SELECT message, payload FROM journal WHERE action = ? ORDER BY id DESC LIMIT 1', [action]);
  return l ? { message: l.message, payload: typeof l.payload === 'string' ? JSON.parse(l.payload) : l.payload } : null;
};

test('amorçage au démarrage : une société sous la raison sociale du responsable, équipes racines rattachées, aucun valideur changé', async () => {
  const db = await nouvelleBase();
  await seedDemo(db);
  await db.tx(async () => {
    await db.insert('equipes', { nom: 'Site de Lyon', managerId: null, ordre: 10 });
    await db.insert('equipes', { nom: 'Méthodes', managerId: null, ordre: 11, parente: 'Production' });
    await db.setSetting('confidentialite', { responsable: 'EPC2I SAS\n12 rue de l’Usine, 67000 Strasbourg', dpo: null });
  });
  const avant = await loadFull(db, RH);
  const valideurs = avant.employes.map(e => valideurHierarchique(avant.referentiels.equipes, e));
  const bilan = await amorcerEntites(db);
  assert.deepEqual(bilan, { code: CODE_ENTITE_AMORCEE, nom: 'EPC2I SAS', equipes: 7, equipesSite: ['Site de Lyon'] });
  const apres = await loadFull(db, RH);
  assert.deepEqual(apres.referentiels.entites, [{
    code: 'entreprise', nom: 'EPC2I SAS', type: 'societe', parente: null, siren: null, siret: null, idcc: null, siteCode: null, ordre: 0, actif: true, fermeLe: null, source: 'local',
  }]);
  assert.deepEqual(apres.referentiels.equipes.map(q => [q.nom, q.entite ?? null]), [
    ['Logistique', 'entreprise'], ['Maintenance', 'entreprise'], ['Production', 'entreprise'], ['Qualité & HSE', 'entreprise'], ['Administration', 'entreprise'],
    ['Commercial', 'entreprise'], ['Site de Lyon', 'entreprise'], ['Méthodes', null],
  ]);
  assert.deepEqual(apres.employes.map(e => valideurHierarchique(apres.referentiels.equipes, e)), valideurs, 'aucun valideur changé');
  const j = (await journalDe(db, 'entite.amorcer'))!;
  assert.deepEqual(j.payload, { code: 'entreprise', equipes: 7, equipesSite: ['Site de Lyon'] });
  assert.match(j.message, /^Entité EPC2I SAS créée, 7 équipes racines rattachées ; à vérifier par le service RH \(nom de site, conversion à la main\) : Site de Lyon$/);
  // Idempotent : une entité existe, plus rien n'est fait (même après le démarrage complet).
  assert.equal(await amorcerEntites(db), null);
  await mettreAJourBase(db);
  assert.equal(await db.count('entites'), 1);
});

test('amorçage d’une base neuve : « Entreprise », sans équipe ni ligne de journal', async () => {
  const db = await nouvelleBase();
  await mettreAJourBase(db);
  assert.deepEqual((await db.all<Entite>('entites')).map(x => [x.code, x.nom, x.type, x.actif]), [['entreprise', 'Entreprise', 'societe', true]]);
  assert.equal(await journalDe(db, 'entite.amorcer'), null);
});

test('actions : entités, sites et rattachements, refus, équipe parente qui suit l’entité, journal en liste blanche', async () => {
  const db = await demo();
  const run = runSur(db);
  await amorcerEntites(db);
  // Création d'une société et d'un établissement, puis d'un site.
  assert.equal(await run(RH, 'entite.creer', { code: 'epc2i', nom: 'EPC2I', type: 'societe', siren: '552 100 554', idcc: '44' }), 'Société EPC2I créée : proposée au rattachement des équipes');
  assert.equal(await run(GEST, 'entite.creer', { code: 'lyon', nom: 'Lyon', type: 'etablissement', parente: 'epc2i', siret: '55210055400013' }),
    'Établissement Lyon créé (société EPC2I) : proposé au rattachement des équipes');
  await refus(run(RH, 'entite.creer', { code: 'lyon', nom: 'Doublon', type: 'societe' }), /existe déjà/);
  assert.equal(await run(RH, 'site.enregistrer', { code: 'lab67', libelle: 'Laboratoire 67' }), 'Site Laboratoire 67 créé');
  assert.equal(await run(RH, 'site.enregistrer', { id: 'lab67', libelle: 'Laboratoire 67' }), null, 'rien de changé');
  assert.equal(await run(RH, 'site.enregistrer', { id: 'lab67', libelle: 'Labo 67', actif: false }), 'Site Labo 67 enregistré : plus proposé (les équipes qui le portent le gardent)');
  assert.equal(await run(RH, 'site.enregistrer', { id: 'lab67', libelle: 'Labo 67', actif: true }), 'Site Labo 67 enregistré');
  await refus(run(RH, 'site.enregistrer', { id: 'inconnu', libelle: 'X' }), /Site introuvable/, 404);
  await refus(run(RH, 'site.enregistrer', { code: 'lab67', libelle: 'X' }), /existe déjà/);
  // Modification : nom et SIRET ; le type ne change pas ; une entité de Matrix ne se modifie pas.
  assert.equal(await run(RH, 'entite.modifier', { code: 'lyon', nom: 'Lyon Est', siret: '55210055400021', idcc: '0044' }), 'Établissement Lyon Est enregistré');
  assert.equal(await run(RH, 'entite.modifier', { code: 'lyon', nom: 'Lyon Est', siret: '55210055400021', idcc: '0044' }), null, 'rien de changé');
  await refus(run(RH, 'entite.modifier', { code: 'lyon', type: 'societe', nom: 'X' }), /Le type d’une entité ne change pas/);
  await refus(run(RH, 'entite.modifier', { code: 'lyon', nom: 'X', siret: '73282932000009' }), /commencer par le SIREN/);
  await refus(run(RH, 'entite.modifier', { code: 'inconnue', nom: 'X' }), /Entité introuvable/, 404);
  await db.tx(async () => await db.insert('entites', { code: 'groupe', nom: 'Groupe', type: 'societe', parente: null, siren: null, siret: null, idcc: null, siteCode: null, ordre: 9, actif: true, fermeLe: null, source: 'matrix' }));
  await refus(run(RH, 'entite.modifier', { code: 'groupe', nom: 'X' }), /tenue par Matrix/);
  await refus(run(RH, 'entite.fermer', { code: 'groupe' }), /tenue par Matrix/);
  // Rattachements d'équipe : racine seulement, site, unité.
  assert.equal(await run(RH, 'equipe.entite', { nom: 'Maintenance', entite: 'lyon' }), 'L’équipe Maintenance relève de Lyon Est, avec ses équipes rattachées');
  assert.equal(await run(RH, 'equipe.entite', { nom: 'Maintenance', entite: 'lyon' }), null);
  await refus(run(RH, 'equipe.entite', { nom: 'Inconnue', entite: 'lyon' }), /Équipe introuvable/, 404);
  assert.equal(await run(RH, 'equipe.site', { nom: 'Maintenance', siteCode: 'lab67' }), 'L’équipe Maintenance est rattachée au site Labo 67');
  assert.equal(await run(RH, 'equipe.site', { nom: 'Maintenance', siteCode: 'lab67' }), null);
  await refus(run(RH, 'equipe.site', { nom: 'Production', siteCode: 'inconnu' }), /Site inconnu inconnu/);
  assert.equal(await run(RH, 'equipe.unite', { nom: 'Maintenance', uniteCode: 'prd-maint' }), 'L’équipe Maintenance correspond à l’unité PRD-MAINT de l’organigramme de Matrix');
  assert.equal(await run(RH, 'equipe.unite', { nom: 'Maintenance', uniteCode: 'PRD-MAINT' }), null);
  await refus(run(RH, 'equipe.unite', { nom: 'Production', uniteCode: 'PRD-MAINT' }), /déjà celui de l’équipe Maintenance/);
  // Équipe parente (actions/hierarchie.ts) : rattachée, la Maintenance hérite de l'entité de la Production ; détachée, elle
  // garde l'entité dont elle relevait.
  await run(RH, 'equipe.parente', { nom: 'Maintenance', parente: 'Production' });
  let q = (await loadFull(db, RH)).referentiels.equipes.find(x => x.nom === 'Maintenance')!;
  assert.equal(q.entite, null);
  const jp = (await journalDe(db, 'equipe.parente'))!.payload;
  assert.deepEqual([jp.avant, jp.apres], [{ parente: null, entite: 'lyon' }, { parente: 'Production', entite: null }]);
  await refus(run(RH, 'equipe.entite', { nom: 'Maintenance', entite: 'epc2i' }), /relève de l’entité de son équipe racine/);
  await run(RH, 'equipe.parente', { nom: 'Maintenance', parente: '' });
  q = (await loadFull(db, RH)).referentiels.equipes.find(x => x.nom === 'Maintenance')!;
  assert.equal(q.entite, 'entreprise', 'entité héritée de la Production gardée');
  // Fermeture : refusée tant que l'entité porte des équipes ; administrateur RH seul ; réouverture.
  await run(RH, 'equipe.entite', { nom: 'Maintenance', entite: 'lyon' });
  await refus(run(RH, 'entite.fermer', { code: 'lyon' }), /Une équipe relève de Lyon Est \(Maintenance\)/);
  await refus(run(GEST, 'entite.fermer', { code: 'lyon' }), /administrateur RH/, 403);
  await refus(run(RH, 'entite.fermer', { code: 'epc2i' }), /établissements ouverts \(Lyon Est\)/);
  assert.equal(await run(RH, 'equipe.entite', { nom: 'Maintenance', entite: '' }), 'L’équipe Maintenance ne relève plus d’aucune entité');
  assert.equal(await run(RH, 'entite.fermer', { code: 'lyon' }), 'Établissement Lyon Est fermé : plus proposé au rattachement des équipes');
  assert.equal(await run(RH, 'entite.fermer', { code: 'lyon' }), null);
  await refus(run(RH, 'equipe.entite', { nom: 'Maintenance', entite: 'lyon' }), /L’entité Lyon Est est fermée/);
  assert.equal(await run(RH, 'entite.fermer', { code: 'epc2i' }), 'Société EPC2I fermée : plus proposée au rattachement des équipes');
  await refus(run(RH, 'entite.rouvrir', { code: 'lyon' }), /La société EPC2I est fermée : rouvrez-la d’abord/);
  assert.equal(await run(RH, 'entite.rouvrir', { code: 'epc2i' }), 'Société EPC2I rouverte');
  assert.equal(await run(RH, 'entite.rouvrir', { code: 'epc2i' }), null);
  assert.equal(await run(RH, 'entite.rouvrir', { code: 'lyon' }), 'Établissement Lyon Est rouvert');
  await db.tx(async () => await db.run(`UPDATE entites SET actif = FALSE, ferme_le = '2026-01-01' WHERE code = 'groupe'`));
  await refus(run(RH, 'entite.rouvrir', { code: 'groupe' }), /tenue par Matrix/);
  // Journal : codes, type, SIREN, SIRET, IDCC, site et unité ; le nom d'une entité ou d'un site seulement « renseigné ».
  assert.deepEqual((await journalDe(db, 'entite.creer'))!.payload, {
    code: 'lyon', avant: { nom: null, type: null, parente: null, siret: null }, apres: { nom: '[texte renseigné]', type: 'etablissement', parente: 'epc2i', siret: '55210055400013' },
  });
  // Une modification sans effet (même saisie) ne trace que le code.
  assert.deepEqual((await journalDe(db, 'entite.modifier'))!.payload, { code: 'lyon' });
  const modifiee = (await db.query<{ payload: unknown }>(`SELECT payload FROM journal WHERE action = 'entite.modifier' ORDER BY id`))
    .map(l => (typeof l.payload === 'string' ? JSON.parse(l.payload) : l.payload) as Record<string, unknown>).find(x => x.avant);
  assert.deepEqual(modifiee, {
    code: 'lyon', avant: { nom: '[texte renseigné]', siret: '55210055400013', idcc: null }, apres: { nom: '[texte renseigné]', siret: '55210055400021', idcc: '0044' },
  });
  assert.deepEqual(await changementDe(db, 'entite.rouvrir'), { code: 'lyon', avant: { actif: false, fermeLe: T }, apres: { actif: true, fermeLe: null } });
  assert.deepEqual(await changementDe(db, 'site.enregistrer'), { code: 'lab67', avant: { actif: false }, apres: { actif: true } });
  assert.deepEqual(await changementDe(db, 'equipe.site'), { nom: 'Maintenance', avant: { siteCode: null }, apres: { siteCode: 'lab67' } });
  assert.deepEqual(await changementDe(db, 'equipe.unite'), { nom: 'Maintenance', avant: { uniteCode: null }, apres: { uniteCode: 'PRD-MAINT' } });
  assert.deepEqual(await changementDe(db, 'equipe.entite'), { nom: 'Maintenance', avant: { entite: 'lyon' }, apres: { entite: null } });
  const tout = JSON.stringify(await db.query(`SELECT payload FROM journal WHERE action LIKE 'entite.%' OR action LIKE 'site.%'`));
  assert.ok(!tout.includes('Lyon Est') && !tout.includes('Labo 67'), 'aucun nom d’entité ni de site au contenu tracé');
});

test('organigramme : impression et export tracés (entité, nombre de lignes), selon le réglage organigrammeOuvert', async () => {
  const db = await demo();
  const run = runSur(db);
  await amorcerEntites(db);
  assert.equal(await run(MEHDI, 'organigramme.imprimer', { lignes: 24 }), 'Organigramme imprimé : 24 lignes');
  assert.deepEqual((await journalDe(db, 'organigramme.imprimer'))!.payload, { entite: null, lignes: 24 });
  assert.equal(await run(KARIM, 'organigramme.exporter', { entite: 'entreprise', lignes: 1 }), 'Organigramme exporté (Entreprise) : 1 ligne');
  assert.deepEqual((await journalDe(db, 'organigramme.exporter'))!.payload, { entite: 'entreprise', lignes: 1 });
  await refus(run(KARIM, 'organigramme.exporter', { entite: 'inconnue', lignes: 1 }), /Entité introuvable/, 404);
  await refus(run(KARIM, 'organigramme.exporter', { lignes: -1 }), /Nombre de lignes invalide/);
  await refus(run(KARIM, 'organigramme.exporter', { lignes: '3' }), /Nombre de lignes invalide/);
  await run(RH, 'parametres.maj', { organigrammeOuvert: 'managers' });
  assert.deepEqual((await journalDe(db, 'parametres.maj'))!.payload, { avant: { organigrammeOuvert: 'tous' }, apres: { organigrammeOuvert: 'managers' } });
  await refus(run(MEHDI, 'organigramme.imprimer', { lignes: 3 }), /réservé/, 403);
  assert.ok(await run(KARIM, 'organigramme.imprimer', { lignes: 3 }));
  await run(RH, 'parametres.maj', { organigrammeOuvert: 'rh' });
  await refus(run(KARIM, 'organigramme.imprimer', { lignes: 3 }), /réservé/, 403);
  assert.ok(await run(RH, 'organigramme.imprimer', { lignes: 3 }));
  await run(RH, 'parametres.maj', { organigrammeOuvert: 'nimporte' });
  assert.equal((await loadFull(db, RH)).settings.organigrammeOuvert, 'rh', 'valeur hors liste : réglage gardé');
});

test('présents de l’organigramme : calculés sur toutes les fiches, transmis selon le réglage, sans les dates', async () => {
  const db = await demo();
  await db.tx(async () => {
    await db.update('employes', 6, { fin: '2026-10-09' });
    await db.update('employes', 9, { entree: '2026-11-02' });
  });
  const vue = async (u: User) => (await db.lecture(async () => await buildSnapshot(db, u))).presentsOrganigramme;
  const tous = (await loadFull(db, RH)).presentsOrganigramme!;
  assert.ok(tous.includes(2) && !tous.includes(6) && !tous.includes(9), 'sorti la veille et embauche à venir exclus');
  assert.deepEqual(await vue(MEHDI), tous);
  assert.deepEqual(await vue(KARIM), tous);
  await db.tx(async () => await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), organigrammeOuvert: 'managers' }));
  assert.deepEqual(await vue(MEHDI), []);
  assert.deepEqual(await vue(KARIM), tous);
  await db.tx(async () => await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), organigrammeOuvert: 'rh' }));
  assert.deepEqual(await vue(KARIM), []);
  assert.deepEqual(await vue({ role: 'rh', empId: null, nom: 'Lecture', intitule: 'Lecture seule', profilRh: 'lecture_seule' }), tous);
  // L'annuaire, lui, ne change pas (sa minimisation est une tâche à part).
  assert.equal((await db.lecture(async () => await buildSnapshot(db, MEHDI))).annuaire.length, (await loadFull(db, RH)).annuaire.length);
});

test('registres : tables lues par les référentiels, ordre de lecture, références contrôlées', () => {
  assert.ok(LECTURES.referentiels.includes('entites') && LECTURES.referentiels.includes('sites'));
  assert.deepEqual(LECTURES.presentsOrganigramme, ['employes']);
  assert.equal(ORDRE_LECTURE.entites, 'ordre');
  assert.equal(ORDRE_LECTURE.sites, 'ordre');
  assert.ok(REFERENCES.some(r => r.table === 'equipes' && r.colonne === 'entite' && r.cible === 'entites' && r.cle === 'code'));
  assert.ok(REFERENCES.some(r => r.table === 'entites' && r.colonne === 'parente' && r.cible === 'entites'));
});

// — Cache de l'instantané : delta et oracle —

test('cache : delta et oracle après la création, le renommage et la fermeture d’une entité et le rattachement d’une équipe', async () => {
  const db = await demo();
  const run = runSur(db);
  const lecteurs = await lecteursDe(db);
  const depart = async () => await db.lecture(async () => ({ n: (await db.etatRevision()).n, brut: geler(await lireBrut(db)) }));
  let etat: { n: number; brut: Brut } = await depart();
  // Entrée du cache lue avant la suite : chaque révision suivante en est dérivée par le delta.
  assert.deepEqual((await verifierExactitude(db, lecteurs, { jeux: true })).divergences, []);
  const pas = async (quoi: string, fn: () => Promise<unknown>, champs: string[]) => {
    await fn();
    etat = await db.lecture(async () => {
      const { n } = await db.etatRevision();
      const ch = await db.lireChangements(etat.n, n);
      assert.ok(ch, `${quoi} : écart connu`);
      const f = appliquerDelta(etat.brut, await lireDelta(db, etat.brut, ch));
      const ref = await lireBrut(db);
      assert.deepStrictEqual(f.brut, ref, `${quoi} : lecture brute`);
      assert.deepStrictEqual(assembler(f.brut, T, 1, RH), assembler(ref, T, 1, RH), `${quoi} : instantané assemblé`);
      for (const c of champs) assert.ok(f.champsChanges.has(c as never), `${quoi} : champ ${c} changé`);
      assert.ok(!f.champsChanges.has('employes'), `${quoi} : fiches inchangées`);
      return { n, brut: geler(f.brut) };
    });
    const b = await verifierExactitude(db, lecteurs, { jeux: true });
    assert.deepEqual(b.divergences, [], `${quoi} : aucune divergence avec la lecture directe`);
    assert.ok(b.comparaisons > lecteurs.length);
  };
  await pas('création d’une entité', async () => await run(RH, 'entite.creer', { code: 'epc2i', nom: 'EPC2I', type: 'societe', siren: '552100554' }), ['referentiels']);
  await pas('établissement', async () => await run(RH, 'entite.creer', { code: 'lyon', nom: 'Lyon', type: 'etablissement', parente: 'epc2i' }), ['referentiels']);
  await pas('renommage', async () => await run(RH, 'entite.modifier', { code: 'epc2i', nom: 'EPC2I SAS', siren: '552100554' }), ['referentiels']);
  await pas('site', async () => await run(RH, 'site.enregistrer', { code: 'lab67', libelle: 'Laboratoire 67' }), ['referentiels']);
  await pas('rattachement d’une équipe', async () => await run(RH, 'equipe.entite', { nom: 'Maintenance', entite: 'lyon' }), ['referentiels']);
  await pas('site d’une équipe', async () => await run(RH, 'equipe.site', { nom: 'Maintenance', siteCode: 'lab67' }), ['referentiels']);
  await pas('réglage', async () => await run(RH, 'parametres.maj', { organigrammeOuvert: 'managers' }), ['settings']);
  await pas('détachement', async () => await run(RH, 'equipe.entite', { nom: 'Maintenance', entite: '' }), ['referentiels']);
  await pas('fermeture', async () => await run(RH, 'entite.fermer', { code: 'lyon' }), ['referentiels']);
  await pas('upsert direct', async () => await db.run(`INSERT INTO entites (code, nom, type, ordre, actif, source) VALUES ('nord', 'Nord', 'societe', 0, TRUE, 'local')
    ON CONFLICT (code) DO UPDATE SET nom = excluded.nom`), ['referentiels']);
  await pas('même ordre, autre nom', async () => await db.run(`INSERT INTO entites (code, nom, type, ordre, actif, source) VALUES ('nord', 'Nord bis', 'societe', 0, TRUE, 'local')
    ON CONFLICT (code) DO UPDATE SET nom = excluded.nom`), ['referentiels']);
  assert.deepEqual((await loadFull(db, RH)).referentiels.entites!.map(x => [x.code, x.nom, x.actif]),
    [['epc2i', 'EPC2I SAS', true], ['nord', 'Nord bis', true], ['lyon', 'Lyon', false]], 'ordre, puis ordre d’insertion');
});

// — Schéma PostgreSQL —

test('PostgreSQL : contraintes de 0016_entites (formats, deux niveaux, fermeture, unicité de l’unité)', { skip: !PG && 'PostgreSQL seulement (CURSUS_TEST_ENGINE=pg)' }, async () => {
  const db = await nouvelleBase();
  const refuse = async (sql: string, motif: RegExp) => { await assert.rejects(db.tx(async () => await db.run(sql)), motif); };
  await db.tx(async () => await db.run(`INSERT INTO entites (code, nom, type, siren, ordre, actif, source) VALUES ('epc2i', 'EPC2I', 'societe', '552100554', 0, TRUE, 'local')`));
  await refuse(`INSERT INTO entites (code, nom, type, ordre, actif, source) VALUES ('EPC', 'X', 'societe', 0, TRUE, 'local')`, /entites_code_check/);
  await refuse(`INSERT INTO entites (code, nom, type, ordre, actif, source) VALUES ('x2', 'X', 'filiale', 0, TRUE, 'local')`, /entites_type_check/);
  await refuse(`INSERT INTO entites (code, nom, type, ordre, actif, source) VALUES ('x2', 'X', 'etablissement', 0, TRUE, 'local')`, /entites_parente_check/);
  await refuse(`INSERT INTO entites (code, nom, type, parente, ordre, actif, source) VALUES ('x2', 'X', 'etablissement', 'inconnue', 0, TRUE, 'local')`, /entites_parente_entites_code_fk/);
  await refuse(`INSERT INTO entites (code, nom, type, siret, ordre, actif, source) VALUES ('x2', 'X', 'societe', '123', 0, TRUE, 'local')`, /entites_siret_check/);
  await refuse(`INSERT INTO entites (code, nom, type, idcc, ordre, actif, source) VALUES ('x2', 'X', 'societe', '44', 0, TRUE, 'local')`, /entites_idcc_check/);
  await refuse(`INSERT INTO entites (code, nom, type, ordre, actif, source) VALUES ('x2', 'X', 'societe', 0, FALSE, 'local')`, /entites_ferme_le_check/);
  await refuse(`INSERT INTO entites (code, nom, type, ordre, actif, source) VALUES ('x2', 'X', 'societe', 0, TRUE, 'lucca')`, /entites_source_check/);
  await refuse(`INSERT INTO entites (code, nom, type, siren, ordre, actif, source) VALUES ('x2', 'X', 'societe', '552100554', 0, TRUE, 'local')`, /entites_siren_unique/);
  await refuse(`INSERT INTO sites (code, libelle, actif, ordre) VALUES ('Lab', 'X', TRUE, 0)`, /sites_code_check/);
  await db.tx(async () => {
    await db.run(`INSERT INTO equipes (nom, ordre, entite, site_code, unite_code) VALUES ('A', 0, 'epc2i', 'lab67', 'PRD-A1')`);
    await db.run(`INSERT INTO equipes (nom, ordre) VALUES ('B', 1)`);
  });
  await refuse(`UPDATE equipes SET unite_code = 'PRD-A1' WHERE nom = 'B'`, /equipes_unite_code_unique/);
  await refuse(`UPDATE equipes SET unite_code = 'prd' WHERE nom = 'B'`, /equipes_unite_code_check/);
  await refuse(`UPDATE equipes SET site_code = 'Lab 67' WHERE nom = 'B'`, /equipes_site_code_check/);
  await refuse(`UPDATE equipes SET entite = 'inconnue' WHERE nom = 'B'`, /equipes_entite_entites_code_fk/);
  await refuse(`DELETE FROM entites WHERE code = 'epc2i'`, /equipes_entite_entites_code_fk/);
  // Déclencheurs du cache de l'instantané : révision augmentée, lignes inscrites par code.
  const avant = (await db.etatRevision()).n;
  await db.tx(async () => await db.run(`UPDATE entites SET nom = 'EPC2I SAS' WHERE code = 'epc2i'`));
  const ch = await db.lireChangements(avant, (await db.etatRevision()).n);
  assert.deepEqual([...(ch!.get('entites') as Set<string>)], ['epc2i']);
});
