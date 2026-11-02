// Lot 12, chantier C6 (badgeage virtuel, t191), étape 3 : géolocalisation au pointage et Permissions-Policy dynamique.
// - règles pures (shared/rules/geolocalisation.ts) : distance, verdict (dans, hors, imprécise, refusée ; le doute profite au
//   salarié), lecture de la position, verdict lu par le manager, populations, activation (COHERENCE) ;
// - anomalies : hors zone, position non vérifiée (même texte pour un refus et une imprécision) ;
// - pointage.pointer : verdict seul gardé, jamais les coordonnées (table, journal, réponse) ; un refus n'empêche jamais de
//   pointer ; position ignorée hors d'une population géolocalisée ou sans zone active ; jamais de position hors ligne (rejeu
//   d'un salarié géolocalisé : position non vérifiée) ;
// - zones : administrateur RH, journal sans coordonnées (libellé dans le message seulement), route réservée au service RH ;
// - GET /api/pointages/etat : position demandée au seul salarié concerné ; GET /api/pointages : verdict réduit pour le
//   manager ;
// - Permissions-Policy : geolocation=() par défaut, (self) sur les pages dès l'option active, jamais sur l'API.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET ??= randomBytes(32).toString('hex');

const { nouvelleBase, json } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { createApp } = await import('../server/src/app.ts');
const { empreinteSession, sign } = await import('../server/src/auth.ts');
const { instantServeur } = await import('../server/src/pointages.ts');
const { permissionsPolicy } = await import('../server/src/securite.ts');
const { refusHorsLigne } = await import('../shared/hors-ligne.ts');
const { anomaliesPointage } = await import('../shared/rules/pointage.ts');
const G = await import('../shared/rules/geolocalisation.ts');
const { libelleAction, familleAction } = await import('../shared/journal.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Db = Awaited<ReturnType<typeof nouvelleBase>>;

const serveurs: Server[] = [];
after(() => { for (const s of serveurs) s.close(); });

const ACCORD = 'Accord d’entreprise sur le temps de travail du 1er mars 2026';
const FINALITE = 'Équipes de chantier itinérantes : aucun autre moyen de pointer sur place';
const POPULATIONS = [
  { critere: 'equipe', valeur: 'Maintenance', mode: 'controle', effet: '2026-01-01' },
  { critere: 'equipe', valeur: 'Logistique', mode: 'controle', effet: '2026-01-01' },
];
/** Chantier de démonstration : centre à Strasbourg, 300 m de rayon. */
const CHANTIER = { libelle: 'Chantier de Strasbourg', siteCode: null, chantierId: 'K-2614', lat: 48.5734, lng: 7.7521, rayonM: 300 };
/** Position dans le chantier (≈ 110 m du centre), et à Colmar (≈ 64 km). */
const DANS = { lat: 48.5744, lng: 7.7521, precision: 20 };
const COLMAR = { lat: 48.0794, lng: 7.3585, precision: 20 };

async function fresh(geoloc = true) {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => ((await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number }).id;
  const personne = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
  const P = {
    admin: await personne(null, 'rh'), gest: await personne(14, 'rh'), mgr: await personne(12, 'manager'),
    coll: await personne(2, 'collaborateur'), autC: await personne(6, 'collaborateur'), log: await personne(4, 'collaborateur'),
    maint: await personne(18, 'collaborateur'),
  };
  const run = async (user: User, name: string, payload: Record<string, unknown>, o: { horsLigne?: boolean } = {}) => await db.tx(async () => {
    const t = await preparerTrace(db, name, payload);
    const ctx = makeCtx(db, user, await loadFull(db, user));
    ctx.horsLigne = o.horsLigne;
    const r = await ACTIONS[name](ctx, payload);
    const x = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user, compte: { id: 0, identifiant: user.nom } as never, message: x.message ?? null, result: x.result, horsLigne: o.horsLigne });
    return x as { message: string; result?: Record<string, any> };
  });
  const refuse = async (user: User, name: string, payload: Record<string, unknown>, motif: RegExp, status = 400, o: { horsLigne?: boolean } = {}) =>
    await assert.rejects(async () => await run(user, name, payload, o), (e: unknown) => e instanceof ActionError && motif.test(e.message) && e.status === status, `${name} : ${motif}`);
  await run(P.admin, 'parametres.maj', { pointageActif: true, pointageAccord: ACCORD, pointageCseLe: '2026-02-15', pointagePopulations: POPULATIONS });
  if (geoloc) {
    await run(P.admin, 'parametres.maj', { geolocActive: true, geolocFinalite: FINALITE, geolocAipdLe: '2026-09-30', geolocPopulations: [{ critere: 'equipe', valeur: 'Maintenance' }] });
    await run(P.admin, 'pointage.zone.enregistrer', CHANTIER);
  }
  return { db, P, run, refuse, compteDe };
}
const pointages = async (db: Db, empId: number) => await db.query<Record<string, unknown>>('SELECT * FROM pointages WHERE emp_id = ? ORDER BY id', [empId]);
/** Aucune coordonnée (degrés décimaux de la position envoyée) dans un texte. */
const sansCoordonnees = (t: string, quoi: string) => { for (const c of ['48.5744', '7.7521', '48.0794', '7.3585']) assert.ok(!t.includes(c), `${quoi} : ${c}`); };

test('règles : distance, verdict (le doute profite au salarié), position reçue, verdict lu par le manager', () => {
  assert.ok(Math.abs(G.distanceM(CHANTIER, COLMAR) - 64_000) < 2_000, 'Strasbourg – Colmar : environ 64 km');
  assert.ok(Math.abs(G.distanceM(CHANTIER, DANS) - 111) < 3);
  const zones = [{ ...CHANTIER, actif: true }];
  assert.equal(G.verdictZone(DANS, zones, 100), 'dans');
  assert.equal(G.verdictZone(COLMAR, zones, 100), 'hors');
  assert.equal(G.verdictZone(null, zones, 100), 'refusee', 'rien reçu : non partagée');
  assert.equal(G.verdictZone('refusee', zones, 100), 'refusee');
  assert.equal(G.verdictZone('indisponible', zones, 100), 'imprecise');
  assert.equal(G.verdictZone({ ...DANS, precision: 250 }, zones, 100), 'imprecise', 'précision plus large que l’exigée, cercle qui déborde');
  // Cercle d'incertitude entier dans une zone : « dans », même avec une précision plus large que l'exigée (aucun doute).
  const grande = [{ ...CHANTIER, rayonM: 2_000, actif: true }];
  assert.equal(G.verdictZone({ lat: CHANTIER.lat, lng: CHANTIER.lng, precision: 150 }, grande, 100), 'dans');
  assert.equal(G.verdictZone({ lat: CHANTIER.lat + 1_900 / 111_195, lng: CHANTIER.lng, precision: 150 }, grande, 100), 'imprecise', 'cercle qui déborde : la précision exigée s’applique');
  assert.equal(G.verdictZone({ lat: CHANTIER.lat, lng: CHANTIER.lng, precision: 150 }, [{ ...grande[0], actif: false }], 100), 'imprecise', 'zone désactivée : ignorée');
  // À 350 m du centre (50 m hors du rayon) avec 80 m d'incertitude : le cercle touche la zone, ni « dans » ni « hors ».
  const limite = { lat: CHANTIER.lat + 350 / 111_195, lng: CHANTIER.lng, precision: 80 };
  assert.equal(G.verdictZone(limite, zones, 100), 'imprecise');
  assert.equal(G.verdictZone({ ...limite, precision: 20 }, zones, 100), 'hors');
  assert.equal(G.verdictZone(DANS, [{ ...CHANTIER, actif: false }], 100), 'hors', 'zone désactivée : ignorée');
  // Position reçue.
  assert.deepEqual(G.lirePosition({ lat: 48.5, lng: 7.7, precision: 12 }), { lat: 48.5, lng: 7.7, precision: 12 });
  assert.equal(G.lirePosition(undefined), null);
  assert.equal(G.lirePosition('refusee'), 'refusee');
  for (const v of [{ lat: 91, lng: 0, precision: 1 }, { lat: '48', lng: 7, precision: 1 }, { lat: 48, lng: 7 }, 'ailleurs', 12]) assert.ok(typeof G.lirePosition(v) === 'object' && G.lirePosition(v) !== null && 'refus' in (G.lirePosition(v) as object), JSON.stringify(v));
  // Le manager : « dans » ou « hors » seulement, jamais un refus ; le salarié et le service RH : le verdict entier.
  assert.deepEqual(['dans', 'hors', 'imprecise', 'refusee', null].map(v => G.verdictPourLecteur(v as never, false)), ['dans', 'hors', null, null, null]);
  assert.equal(G.verdictPourLecteur('refusee', true), 'refusee');
  // Zones saisies.
  assert.match(String(G.lireZone({ libelle: '', lat: 1, lng: 1, rayonM: 100 })), /Libellé/);
  assert.match(String(G.lireZone({ libelle: 'A', lat: '', lng: 1, rayonM: 100 })), /Latitude/);
  assert.match(String(G.lireZone({ libelle: 'A', lat: 1, lng: 200, rayonM: 100 })), /Longitude/);
  assert.match(String(G.lireZone({ libelle: 'A', lat: 1, lng: 1, rayonM: 5 })), /Rayon/);
  assert.deepEqual(G.lireZone({ libelle: ' A ', lat: '48.12345678', lng: 7, rayonM: 100, siteCode: ' ' }), { libelle: 'A', siteCode: null, chantierId: null, lat: 48.123457, lng: 7, rayonM: 100, actif: true });
});

test('règles : populations, activation refusée sans badgeage, finalité, AIPD ni population ; exclusions', () => {
  assert.match(String(G.lirePopulationsGeoloc([{ critere: 'x', valeur: 'A' }])), /critère inconnu/);
  assert.match(String(G.lirePopulationsGeoloc([{ critere: 'equipe', valeur: 'A' }, { critere: 'equipe', valeur: 'A' }])), /en double/);
  assert.deepEqual(G.lirePopulationsGeoloc([{ critere: 'equipe', valeur: ' Maintenance ' }]), [{ critere: 'equipe', valeur: 'Maintenance' }]);
  const s = { geolocActive: true, pointageActif: true, geolocFinalite: FINALITE, geolocAipdLe: '2026-09-30', geolocPopulations: [{ critere: 'equipe' as const, valeur: 'Maintenance' }] };
  assert.equal(G.refusActivationGeoloc(s), null);
  assert.equal(G.refusActivationGeoloc({ ...s, geolocActive: false, geolocFinalite: '' }), null);
  assert.match(String(G.refusActivationGeoloc({ ...s, pointageActif: false })), /avec le badgeage/);
  assert.match(String(G.refusActivationGeoloc({ ...s, geolocFinalite: ' ' })), /finalité/);
  assert.match(String(G.refusActivationGeoloc({ ...s, geolocAipdLe: null })), /AIPD/);
  assert.match(String(G.refusActivationGeoloc({ ...s, geolocPopulations: [] })), /population/);
  const x = {
    settings: { pointageActif: true, pointageInterim: false, pointagePopulations: POPULATIONS as never, geolocActive: true, geolocPopulations: s.geolocPopulations },
    equipes: [{ nom: 'Maintenance', managerId: 12 }, { nom: 'Logistique', managerId: 16 }],
  };
  const tech = { equipe: 'Maintenance', temps: '35h', typeContrat: 'CDI' } as never;
  assert.equal(G.geolocAu(x, tech, '2026-10-10'), true);
  assert.equal(G.geolocAu(x, { equipe: 'Logistique', temps: '35h', typeContrat: 'CDI' } as never, '2026-10-10'), false, 'pointe sur place : jamais géolocalisé');
  assert.equal(G.geolocAu(x, { equipe: 'Maintenance', temps: 'forfait_jours', typeContrat: 'CDI' } as never, '2026-10-10'), false, 'forfait jours : ne pointe pas');
  assert.equal(G.geolocAu(x, tech, '2025-12-31'), false, 'avant la date d’effet de sa population badgée');
  assert.equal(G.geolocAu({ ...x, settings: { ...x.settings, geolocActive: false } }, tech, '2026-10-10'), false);
});

test('anomalies : hors zone ; position imprécise ou non partagée sous le même texte, pointage gardé', () => {
  const p = (id: number, h: string, sens: 'E' | 'S', zone: string | null) => ({ id, horodatage: h, sens, annuleId: null, zone: zone as never });
  const l = [p(1, '2026-10-08T06:00:00.000Z', 'E', 'hors'), p(2, '2026-10-08T14:00:00.000Z', 'S', 'refusee'), p(3, '2026-10-09T06:00:00.000Z', 'E', 'imprecise'), p(4, '2026-10-09T14:00:00.000Z', 'S', 'dans')];
  const a = anomaliesPointage({ du: '2026-10-05', au: '2026-10-11', pointages: l, maintenant: Date.parse('2026-10-10T10:00:00Z') });
  const z = a.filter(x => x.code === 'hors_zone' || x.code === 'zone_non_verifiee');
  assert.deepEqual(z.map(x => [x.jour, x.code]), [['2026-10-08', 'hors_zone'], ['2026-10-08', 'zone_non_verifiee'], ['2026-10-09', 'zone_non_verifiee']]);
  assert.equal(z[1].texte.replace(/\d{2}:\d{2}/, ''), z[2].texte.replace(/\d{2}:\d{2}/, ''), 'refus et imprécision indiscernables');
  assert.ok(!z.some(x => /refus/i.test(x.texte)));
  // Pointages sans verdict (géolocalisation inactive) : aucune anomalie de zone.
  assert.ok(!anomaliesPointage({ du: '2026-10-05', au: '2026-10-11', pointages: l.map(x => ({ ...x, zone: null })), maintenant: Date.parse('2026-10-10T10:00:00Z') }).some(x => /zone/.test(x.code)));
});

test('réglages : activation contrôlée (COHERENCE), finalité jamais recopiée au journal ; désactivée par défaut', async () => {
  const { db, P, run, refuse } = await fresh(false);
  const s = await loadFull(db, P.admin);
  assert.equal(s.settings.geolocActive, false);
  assert.equal(s.settings.geolocPrecisionM, 100);
  await refuse(P.admin, 'parametres.maj', { geolocActive: true }, /finalité/);
  await refuse(P.admin, 'parametres.maj', { geolocActive: true, geolocFinalite: FINALITE }, /AIPD/);
  await refuse(P.admin, 'parametres.maj', { geolocActive: true, geolocFinalite: FINALITE, geolocAipdLe: '2026-09-30' }, /population/);
  await run(P.admin, 'parametres.maj', { geolocPrecisionM: 5 });
  assert.equal((await loadFull(db, P.admin)).settings.geolocPrecisionM, 20, 'précision ramenée à 20 m au moins');
  await run(P.admin, 'parametres.maj', { geolocActive: true, geolocFinalite: FINALITE, geolocAipdLe: '2026-09-30', geolocPopulations: [{ critere: 'equipe', valeur: 'Maintenance' }] });
  // Le badgeage ne se coupe plus sans couper la géolocalisation.
  await refuse(P.admin, 'parametres.maj', { pointageActif: false }, /avec le badgeage/);
  const [j] = await db.query<{ payload: unknown }>(`SELECT payload FROM journal WHERE action = 'parametres.maj' ORDER BY id DESC LIMIT 1`);
  assert.ok(!JSON.stringify(json(j.payload)).includes('itinérantes'), 'finalité jamais recopiée');
  assert.match(JSON.stringify(json(j.payload)), /geolocActive/);
});

test('pointer : verdict seul gardé, refus sans blocage, ignorée hors population, jamais hors ligne ; journal sans coordonnées', async () => {
  const { db, P, run, refuse } = await fresh();
  // Dans la zone : verdict « dans », aucune coordonnée en base ni dans la réponse.
  const a = await run(P.coll, 'pointage.pointer', { empId: 2, position: DANS });
  assert.match(a.message, /^Arrivée pointée à \d{2}:\d{2} · dans la zone$/);
  assert.equal(a.result!.zone, 'dans');
  const [l] = await pointages(db, 2);
  assert.equal(l.zone, 'dans');
  sansCoordonnees(JSON.stringify(l), 'ligne du pointage');
  sansCoordonnees(JSON.stringify(a), 'réponse');
  // Refus de partager sa position : le pointage est enregistré (verdict « refusée »), sans erreur.
  const b = await run(P.autC, 'pointage.pointer', { empId: 6, position: 'refusee' });
  assert.match(b.message, /^Arrivée pointée à \d{2}:\d{2} · position non partagée, pointage enregistré$/);
  assert.equal((await pointages(db, 6))[0].zone, 'refusee');
  // Rien reçu (coque d'avant l'activation) : enregistré aussi, comme une position non partagée.
  const f = await run(P.autC, 'pointage.pointer', { empId: 6, sens: 'S' });
  assert.equal(f.result!.zone, 'refusee');
  // Hors zone (sortie, sens explicite).
  const c = await run(P.coll, 'pointage.pointer', { empId: 2, sens: 'S', position: COLMAR });
  assert.equal(c.result!.zone, 'hors');
  // Position illisible : refus sans rien enregistrer ; hors ligne : jamais de position.
  await refuse(P.coll, 'pointage.pointer', { empId: 2, sens: 'S', position: { lat: 'x' } }, /illisible/);
  const appareil = new Date(instantServeur() - 10 * 60_000).toISOString();
  await refuse(P.coll, 'pointage.pointer', { empId: 2, horodatageAppareil: appareil, position: DANS }, /jamais de position/, 400, { horsLigne: true });
  assert.match(String(refusHorsLigne('pointage.pointer', { empId: 2, horodatageAppareil: appareil, position: DANS }, 2)), /jamais de position/);
  // Rejeu hors ligne d'un salarié géolocalisé : aucune position lue, verdict « refusée » (position non vérifiée), pour que
  // couper le réseau ne contourne pas la vérification sans trace.
  const d = await run(P.coll, 'pointage.pointer', { empId: 2, horodatageAppareil: appareil, sens: 'S' }, { horsLigne: true });
  assert.equal(d.result!.zone, 'refusee', 'hors ligne : position non vérifiée');
  assert.equal((await pointages(db, 2)).find(x => x.id === d.result!.id)?.zone, 'refusee');
  // Logistique : pointe sur place, n'est pas géolocalisée ; une position reçue est ignorée (jamais écrite).
  const e = await run(P.log, 'pointage.pointer', { empId: 4, position: DANS });
  assert.match(e.message, /^Arrivée pointée à \d{2}:\d{2}$/);
  assert.equal((await pointages(db, 4))[0].zone, null);
  // Hors ligne hors population géolocalisée : aucun verdict.
  const h = await run(P.log, 'pointage.pointer', { empId: 4, horodatageAppareil: new Date(instantServeur() - 5 * 60_000).toISOString(), sens: 'S' }, { horsLigne: true });
  assert.equal(h.result!.zone, undefined, 'Logistique hors ligne : aucun verdict');
  // Aucune zone active : rien n'est demandé (routes, plus bas), rien n'est jugé.
  const [zone] = await db.query<{ id: number }>('SELECT id FROM zones_pointage');
  await run(P.admin, 'pointage.zone.enregistrer', { ...CHANTIER, id: zone.id, actif: false });
  // Salarié de Maintenance (population géolocalisée) : sa position est ignorée, aucun verdict (ni « hors »).
  const g = await run(P.maint, 'pointage.pointer', { empId: 18, position: COLMAR });
  assert.equal(g.result!.doublon, undefined);
  assert.equal(g.result!.zone, undefined);
  assert.equal((await pointages(db, 18)).find(x => x.id === g.result!.id)?.zone, null);
  // Rejeu hors ligne, sans zone active : aucun verdict non plus.
  const k = await run(P.coll, 'pointage.pointer', { empId: 2, horodatageAppareil: new Date(instantServeur() - 3 * 60_000).toISOString(), sens: 'E' }, { horsLigne: true });
  assert.equal(k.result!.doublon, undefined);
  assert.equal(k.result!.zone, undefined);
  // Jamais de ligne par pointage ; le journal (zones, réglages) ne porte aucune coordonnée.
  assert.equal((await db.query(`SELECT id FROM journal WHERE action = 'pointage.pointer'`)).length, 0);
  sansCoordonnees(JSON.stringify(await db.query('SELECT * FROM journal')), 'journal');
});

test('zones : administrateur RH, journal sans coordonnées, 404 ; suppression sans toucher aux verdicts', async () => {
  const { db, P, run, refuse } = await fresh();
  await refuse(P.gest, 'pointage.zone.enregistrer', CHANTIER, /administrateur RH/, 403);
  await refuse(P.admin, 'pointage.zone.enregistrer', { ...CHANTIER, rayonM: 20_000 }, /Rayon/);
  await refuse(P.admin, 'pointage.zone.enregistrer', { ...CHANTIER, id: 9999 }, /introuvable/, 404);
  const z = await run(P.admin, 'pointage.zone.enregistrer', { ...CHANTIER, libelle: 'Atelier de Colmar', lat: COLMAR.lat, lng: COLMAR.lng, siteCode: 'COL' });
  assert.equal(z.result!.creee, true);
  await run(P.coll, 'pointage.pointer', { empId: 2, position: COLMAR });
  const j = await db.query<{ payload: unknown; message: string }>(`SELECT payload, message FROM journal WHERE action = 'pointage.zone.enregistrer' ORDER BY id`);
  assert.equal(j.length, 2);
  const texte = JSON.stringify(j.map(x => json(x.payload)));
  assert.ok(!/48\.57|7\.75|48\.07|7\.35|Strasbourg|Colmar/.test(texte), texte);
  assert.match(texte, /"site":"COL"/);
  assert.match(libelleAction('pointage.zone.enregistrer'), /Zone de pointage/);
  assert.equal(familleAction('pointage.zone.supprimer')?.label, 'Temps — badgeage');
  await run(P.admin, 'pointage.zone.supprimer', { id: z.result!.id });
  await refuse(P.admin, 'pointage.zone.supprimer', { id: z.result!.id }, /introuvable/, 404);
  assert.equal((await pointages(db, 2))[0].zone, 'dans', 'verdict gardé après la suppression de la zone');
});

/** Session ouverte en base pour un compte, cookie signé comme par Cursus. */
async function cookieDe(db: Db, compteId: number, role: User['role']) {
  const id = randomBytes(32).toString('base64url');
  await db.insert('connexions', { id: empreinteSession(id), compteId, role, methode: 'local', demoComptes: {}, creation: new Date().toISOString(), expiration: new Date(Date.now() + 3600_000).toISOString(), activite: null });
  return `cursus_session=${id}.${await sign(db, id)}`;
}

test('routes : position demandée au seul salarié concerné, verdict réduit pour le manager, zones au service RH ; Permissions-Policy', async () => {
  const { db, P, run, compteDe } = await fresh(false);
  const app = createApp(db, { production: false, journalRequetes: false, compression: false });
  const serveur = await new Promise<Server>(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  serveurs.push(serveur);
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  const get = async (chemin: string, cookie?: string, espace: string | null = 'rh') =>
    await fetch(`${base}${chemin}`, { headers: { ...(cookie ? { cookie } : {}), ...(espace ? { 'x-cursus-espace': espace } : {}) } });
  const politique = async (chemin: string) => (await get(chemin)).headers.get('permissions-policy') ?? '';
  // Option inactive : géolocalisation refusée à toute page.
  assert.equal(permissionsPolicy(false).includes('geolocation=()'), true);
  assert.match(await politique('/'), /geolocation=\(\)/);
  assert.match(await politique('/pointages'), /geolocation=\(\)/);
  const coll = await cookieDe(db, await compteDe(2), 'collaborateur'), mgr = await cookieDe(db, await compteDe(12), 'manager');
  const log = await cookieDe(db, await compteDe(4), 'collaborateur'), gest = await cookieDe(db, await compteDe(14), 'rh');
  assert.equal(((await (await get('/api/pointages/etat', coll, 'collaborateur')).json()) as { geoloc: boolean }).geoloc, false);
  // Option active (réglages, puis une zone) : (self) pour les pages, jamais pour l'API ; autres fonctions toujours fermées.
  await run(P.admin, 'parametres.maj', { geolocActive: true, geolocFinalite: FINALITE, geolocAipdLe: '2026-09-30', geolocPopulations: [{ critere: 'equipe', valeur: 'Maintenance' }] });
  const page = await politique('/');
  assert.match(page, /geolocation=\(self\)/);
  assert.match(page, /camera=\(\).*microphone=\(\)/);
  assert.match(await politique('/api/pointages/etat'), /geolocation=\(\)/);
  // Sans zone active, la position n'est pas demandée.
  assert.equal(((await (await get('/api/pointages/etat', coll, 'collaborateur')).json()) as { geoloc: boolean }).geoloc, false);
  await run(P.admin, 'pointage.zone.enregistrer', CHANTIER);
  assert.equal(((await (await get('/api/pointages/etat', coll, 'collaborateur')).json()) as { geoloc: boolean }).geoloc, true);
  assert.equal(((await (await get('/api/pointages/etat', log, 'collaborateur')).json()) as { geoloc: boolean }).geoloc, false, 'Logistique : pointe sur place');
  assert.equal(((await (await get('/api/pointages/etat?empId=2', mgr, 'manager')).json()) as { geoloc: boolean }).geoloc, false, 'jamais pour un autre');
  // Verdicts : le salarié et le service RH lisent « refusée », le manager ne lit rien (ni refus ni imprécision).
  await run(P.coll, 'pointage.pointer', { empId: 2, position: 'refusee' });
  const lire = async (cookie: string, espace: string) => ((await (await get('/api/pointages?empId=2', cookie, espace)).json()) as { pointages: { zone: string | null }[] }).pointages.map(p => p.zone);
  assert.deepEqual(await lire(coll, 'collaborateur'), ['refusee']);
  assert.deepEqual(await lire(gest, 'rh'), ['refusee']);
  assert.deepEqual(await lire(mgr, 'manager'), [null]);
  const etatMgr = await (await get('/api/pointages/etat?empId=2', mgr, 'manager')).json() as { pointages: { zone: string | null }[] };
  assert.deepEqual(etatMgr.pointages.map(p => p.zone), [null]);
  assert.ok(!JSON.stringify(etatMgr).includes('refusee'));
  // Zones : service RH seulement.
  assert.equal((await get('/api/pointages/zones', mgr, 'manager')).status, 403);
  const refus = await db.query<{ message: string }>(`SELECT message FROM journal WHERE action = 'acces.refuse' ORDER BY id DESC LIMIT 1`);
  assert.match(refus[0]?.message ?? '', /^Zones de pointage — réservées au service RH/, 'refus tracé');
  assert.equal((await get('/api/pointages/zones', await cookieDe(db, await compteDe(11), 'rh'))).status, 403, 'lecture seule');
  const zones = await (await get('/api/pointages/zones', gest)).json() as { zones: { libelle: string; rayonM: number }[] };
  assert.deepEqual(zones.zones.map(z => [z.libelle, z.rayonM]), [['Chantier de Strasbourg', 300]]);
  // Option coupée : de nouveau fermée à la page suivante.
  await run(P.admin, 'parametres.maj', { geolocActive: false });
  assert.match(await politique('/'), /geolocation=\(\)/);
});

test('mention d’information : paragraphe de la géolocalisation pour les seules populations désignées ; page Confidentialité', async () => {
  const { mentionInformationPointage } = await import('../shared/rules/pointage-information.ts');
  const { INFO_CONFIDENTIALITE } = await import('../shared/confidentialite.ts');
  const base = {
    pointageAccord: ACCORD, pointageCseLe: '2026-02-15', pointageDelaiCorrectionJours: 7, pointageHorsLigne: true, conservationPointagesAns: 3,
    pointagePopulations: [{ critere: 'equipe' as const, valeur: 'Maintenance', mode: 'controle' as const, effet: '2027-01-04' }],
  };
  const sans = mentionInformationPointage({ ...base, geolocActive: false, geolocPopulations: [{ critere: 'equipe', valeur: 'Maintenance' }], geolocFinalite: FINALITE }).join('\n');
  assert.match(sans, /Aucune position, aucune photo ni donnée biométrique/);
  assert.ok(!sans.includes(FINALITE));
  const avec = mentionInformationPointage({ ...base, geolocActive: true, geolocPopulations: [{ critere: 'equipe', valeur: 'Maintenance' }], geolocFinalite: FINALITE }).join('\n');
  for (const x of ['équipe (et équipes rattachées) « Maintenance » seulement', 'au moment du clic', 'jamais la position', 'Vous pouvez refuser', FINALITE, 'Aucune photo ni donnée biométrique']) assert.ok(avec.includes(x), x);
  assert.match(JSON.stringify(INFO_CONFIDENTIALITE), /seul le résultat \(dans la zone, hors zone…\) est gardé/);
});
