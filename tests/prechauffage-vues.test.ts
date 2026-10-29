// Préchauffage des vues (lot 10, chantier A ; server/src/prechauffage-vues.ts, server/src/demarrage.ts) :
// - ordre : un compte RH par profil, les autres comptes RH, puis managers, puis collaborateurs, chacun par dernière
//   connexion ; seuls les comptes actifs ;
// - après le préchauffage, GET /api/data de chaque compte ne calcule plus aucune vue et sert la vue de la lecture directe ;
//   les grands corps (vues RH) partent compressés sans nouvelle compression ;
// - un tour de boucle rendu entre deux vues (une requête de santé passe pendant le préchauffage) ;
// - CURSUS_PRECHAUFFAGE_VUES=0, arrêt du serveur, cache désactivé : rien ou interrompu ; jamais sous node --test au
//   démarrage (`prechaufferDemarrage`, `prechaufferChaqueJour`).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
delete process.env.CURSUS_DEMO;
delete process.env.CURSUS_CACHE_INSTANTANE;
delete process.env.CURSUS_PRECHAUFFAGE_VUES;

const { grosseDemo, lecteurs, serveur, session } = await import('./support/vues-lot10.ts');
const { lecteursAPrechauffer, prechaufferVues, prechauffageVuesActif } = await import('../server/src/prechauffage-vues.ts');
const { prechaufferChaqueJour, prechaufferDemarrage } = await import('../server/src/demarrage.ts');
const { cleVue, remettreStatistiques, statistiquesCache, viderCache } = await import('../server/src/cache-instantane.ts');
const cc = await import('../server/src/corps-compresses.ts');
type Session = import('./support/vues-lot10.ts').Session;

const fermetures: (() => void)[] = [];
after(() => { for (const f of fermetures) f(); });

test('ordre : RH par profil, autres RH, managers, collaborateurs, par dernière connexion ; comptes actifs seulement', async () => {
  const db = await grosseDemo();
  // Dernières connexions : le collaborateur du compte le plus élevé est le plus récent ; un compte désactivé est ignoré.
  const comptes = await db.all<{ id: number; empId: number | null; profilRh: string }>('comptes');
  const collab = comptes.filter(c => c.empId && c.profilRh === 'aucun').at(-1)!;
  await db.update('comptes', collab.id, { derniereConnexion: '2026-10-10T07:00:00.000Z' });
  const inactif = comptes.filter(c => c.empId && c.profilRh === 'aucun')[0];
  await db.update('comptes', inactif.id, { actif: false });
  const ordre = await lecteursAPrechauffer(db);
  const roles = ordre.map(u => u.role);
  assert.deepEqual(roles, [...roles].sort((a, b) => ['rh', 'manager', 'collaborateur'].indexOf(a) - ['rh', 'manager', 'collaborateur'].indexOf(b)), 'RH, managers, collaborateurs');
  const rh = ordre.filter(u => u.role === 'rh');
  const profils = rh.map(u => u.profilRh);
  const premiers = profils.slice(0, new Set(profils).size);
  assert.equal(new Set(premiers).size, premiers.length, 'un compte par profil d’abord');
  assert.equal(ordre.find(u => u.role === 'collaborateur')!.empId, collab.empId, 'collaborateur connecté le plus récemment en premier');
  assert.ok(!ordre.some(u => u.role === 'collaborateur' && u.empId === inactif.empId), 'compte désactivé ignoré');
  assert.equal(ordre.length, (await lecteurs(db)).length);
});

test('après le préchauffage : aucune vue recalculée par GET /api/data, vues exactes, grands corps déjà compressés', async () => {
  const db = await grosseDemo();
  viderCache(db);
  remettreStatistiques();
  const { base, fermer } = await serveur(db, { compression: true });
  fermetures.push(fermer);
  // Requête de santé pendant le préchauffage : elle passe entre deux vues.
  let santeServie = false;
  const prechauffage = prechaufferVues(db, { compression: true });
  const sante = fetch(`${base}/api/health`).then(r => { santeServie = true; return r.status; });
  const bilan = await prechauffage;
  assert.equal(await sante, 200);
  assert.ok(santeServie);
  const ordre = await lecteursAPrechauffer(db);
  assert.equal(bilan.vues, ordre.length);
  assert.equal(bilan.interrompu, false);
  assert.ok(bilan.corps >= 1, 'au moins un grand corps compressé (vue RH)');
  const calculees = statistiquesCache(db).vuesCalculees;
  assert.equal(calculees.rh + calculees.manager + calculees.collaborateur, new Set(ordre.map(cleVue)).size, 'une vue par clé');
  const sessions: Session[] = [];
  for (const { compte, user } of await lecteurs(db)) sessions.push(await session(db, compte, user));
  const n0 = cc.compressionsFaites;
  const avant = statistiquesCache(db).vuesCalculees;
  for (const s of sessions) {
    const r = await fetch(`${base}/api/data`, { headers: { cookie: s.cookie, 'x-cursus-espace': s.espace, 'accept-encoding': 'br' } });
    assert.equal(r.status, 200);
    const ds = await r.json() as { user: { empId: number | null } };
    assert.equal(ds.user.empId, s.user.empId);
  }
  assert.deepEqual(statistiquesCache(db).vuesCalculees, avant, 'aucune vue recalculée');
  // Les sessions ouvertes ne changent pas la révision (table hors instantané) : corps des comptes RH déjà compressés.
  assert.equal(cc.compressionsFaites, n0, 'aucune nouvelle compression');
});

test('préchauffage coupé, arrêté, sans cache ; jamais sous node --test au démarrage', async () => {
  const db = await grosseDemo();
  assert.equal(prechauffageVuesActif({ CURSUS_PRECHAUFFAGE_VUES: '0' }), false);
  assert.equal(prechauffageVuesActif({}), true);
  process.env.CURSUS_PRECHAUFFAGE_VUES = '0';
  try {
    assert.deepEqual({ ...await prechaufferVues(db, { compression: true }), ms: 0 }, { vues: 0, corps: 0, ms: 0, interrompu: false });
  } finally {
    delete process.env.CURSUS_PRECHAUFFAGE_VUES;
  }
  let n = 0;
  const arrete = await prechaufferVues(db, { compression: true, arrete: () => ++n > 2 });
  assert.equal(arrete.interrompu, true);
  assert.equal(arrete.vues, 2, 'arrêté avant la troisième vue');
  process.env.CURSUS_CACHE_INSTANTANE = '0';
  try {
    const sans = await prechaufferVues(db, { compression: true });
    assert.deepEqual([sans.vues, sans.interrompu], [0, true], 'cache désactivé : rien à garder');
  } finally {
    delete process.env.CURSUS_CACHE_INSTANTANE;
  }
  const avertissements: string[] = [];
  const echec = await prechaufferVues({ ...db, all: async () => { throw new Error('base indisponible'); } } as unknown as typeof db, { compression: true, avertir: m => avertissements.push(m) });
  assert.equal(echec.interrompu, true);
  assert.match(avertissements[0], /Préchauffage des vues impossible : base indisponible/);
  // Démarrage du serveur : jamais sous node --test (ni pour les outils, qui ne l'appellent pas).
  assert.equal(await prechaufferDemarrage(db, { compression: true }), null);
  const arreter = prechaufferChaqueJour(db, { compression: true, jour: () => '2026-10-10' });
  arreter();
});
