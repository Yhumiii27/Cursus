// Échéances du contrat (lot 4, chantier 5, étape 2) : période d'essai saisie depuis le contrat (t063 : aucune durée
// proposée, maximum légal en avertissement, alerte au dernier jour du délai de prévenance), fins de CDD, de mission et
// d'alternance dans les Échéances, au tableau de bord et chez le manager ; titre de séjour valant autorisation de travail
// (t064 : alertes réglables, expiré non conforme et en « No Go CONTRAT » avec un libellé générique pour Keystone, numéro
// réservé au service RH et absent du journal, verdict seul pour le manager et les profils restreints, export des données).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
delete process.env.KEYSTONE_URL;
delete process.env.KEYSTONE_TOKEN;

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS, changeVerdicts } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { donneesSalarie } = await import('../server/src/donnees.ts');
const { suivreVerdicts } = await import('../server/src/integrations/keystone-verdicts.ts');
const { contexte, enregistrerAffectation, enregistrerChantier } = await import('../server/src/integrations/keystone-entrant.ts');
const { Domain } = await import('../shared/domain.ts');
const { iso } = await import('../shared/dates.ts');
const { matricule } = await import('../shared/format.ts');
const { appliquerReglages, ReglageInvalide } = await import('../shared/reglages.ts');
const {
  controleEssai, essaiMaximum, joursOuvrablesAvant, limitePrevenance, prevenance, SITUATION_A_REGULARISER, validerAutorisation,
} = await import('../shared/rules/contrats.ts');
const { PROFIL_VIDE, profilOf, validerProfil } = await import('../shared/rules/profil.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Compte = import('../server/src/comptes.ts').Compte;
interface Ligne { action: string; payload: Record<string, any>; salaries: number[] | null; message: string | null }

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', [...(empId ? [empId] : [])])) as { id: number };
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get<Compte>('comptes', u.compteId!))!, message: o.message ?? null, result: o.result });
    if (changeVerdicts(name)) await suivreVerdicts(db);
    return o;
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>, re: RegExp, status = 400) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && re.test(e.message), `${name} : ${re}`);
  const RH = await user(null, 'rh');
  const domain = async (u: User = RH) => new Domain(await buildSnapshot(db, u));
  const contrats = (d: InstanceType<typeof Domain>, horizon = 90) => d.echeances(d.enrich(horizon, false), horizon).filter(x => x.kind === 'contrat');
  return { db, user, run, refus, RH, domain, contrats };
}

test('période d’essai : maximum légal selon le contrat (CDI par statut, CDD, intérim), sans durée proposée', async () => {
  const cdi = (statut: 'ouvrier' | 'technicien' | 'cadre') => essaiMaximum({ statut, typeContrat: 'cdi', entree: '2026-09-01', fin: null })!;
  assert.deepEqual([cdi('ouvrier').fin, cdi('ouvrier').renouvele], ['2026-10-31', '2026-12-31'], '2 mois, 4 renouvellement compris');
  assert.deepEqual([cdi('technicien').fin, cdi('technicien').renouvele], ['2026-11-30', '2027-02-28']);
  assert.deepEqual([cdi('cadre').fin, cdi('cadre').renouvele], ['2026-12-31', '2027-04-30']);
  // CDD : 1 jour par semaine, 2 semaines au plus jusqu'à 6 mois de contrat, 1 mois au-delà ; pas de renouvellement légal.
  const cdd = (fin: string) => essaiMaximum({ statut: 'ouvrier', typeContrat: 'cdd', entree: '2026-09-01', fin })!;
  assert.equal((await cdd('2026-10-12')).fin, '2026-09-06', 'CDD de 6 semaines : 6 jours');
  assert.equal((await cdd('2026-11-30')).fin, '2026-09-13', 'CDD de 3 mois : 13 semaines, 13 jours');
  assert.equal((await cdd('2026-12-31')).fin, '2026-09-14', 'CDD de 4 mois : 17 jours, plafonnés à 2 semaines');
  assert.equal((await cdd('2027-08-31')).fin, '2026-09-30', 'CDD d’un an : 1 mois');
  assert.equal((await cdd('2027-08-31')).renouvele, null);
  // Intérim : 2, 3 ou 5 jours travaillés selon la durée de la mission (le 1er septembre 2026 est un mardi).
  const interim = (fin: string | null) => essaiMaximum({ statut: 'ouvrier', typeContrat: 'interim', entree: '2026-09-01', fin })!.fin;
  assert.deepEqual([interim('2026-09-15'), interim('2026-10-15'), interim('2026-12-31'), interim(null)], ['2026-09-02', '2026-09-03', '2026-09-07', '2026-09-07']);
  // Une nouvelle fiche ne porte aucune période d'essai.
  assert.deepEqual([PROFIL_VIDE(null, '2026-10-10').essaiFin, PROFIL_VIDE(null, '2026-10-10').essaiRenouveleJusquau], [null, null]);
});

test('période d’essai : cohérence bloquante, maximum légal et renouvellement en avertissement', () => {
  const base = { statut: 'technicien' as const, typeContrat: 'cdi' as const, entree: '2026-09-14', fin: null };
  assert.deepEqual(controleEssai({ ...base, essaiFin: '2026-12-13' }), { errors: [], warnings: [] });
  assert.match(controleEssai({ ...base, essaiFin: '2026-09-01' }).errors.join(), /précède la date d’entrée/);
  assert.match(controleEssai({ ...base, essaiRenouveleJusquau: '2027-01-31' }).errors.join(), /sans la fin de la période initiale/);
  assert.match(controleEssai({ ...base, essaiFin: '2026-12-13', essaiRenouveleJusquau: '2026-12-01' }).errors.join(), /finir après la période initiale/);
  assert.match(controleEssai({ ...base, typeContrat: 'cdd', fin: '2026-12-31', essaiFin: '2027-01-15' }).errors.join(), /dépasse la fin prévue du contrat/);
  assert.match(controleEssai({ ...base, essaiFin: '2026-12-20' }).warnings.join(), /au-delà du maximum légal \(3 mois pour un technicien \/ agent de maîtrise, art\. L1221-19\) : le 13 déc\. 2026/);
  assert.match(controleEssai({ ...base, essaiFin: '2026-12-13', essaiRenouveleJusquau: '2027-04-01' }).warnings.join(), /renouvelé au-delà du maximum légal \(6 mois/);
  assert.match(controleEssai({ ...base, typeContrat: 'cdd', fin: '2027-09-13', essaiFin: '2026-10-01', essaiRenouveleJusquau: '2026-10-10' }).warnings.join(), /aucun renouvellement prévu par la loi/);
  // Avec la fiche : erreur bloquante, avertissement non bloquant.
  const fiche = { ...PROFIL_VIDE('Maintenance', '2026-10-10'), nom: 'Nouvel Embauché', poste: 'Technicien', statut: 'technicien' as const, entree: '2026-09-14', naissance: 1995 };
  const opts = { equipes: ['Maintenance'], year: 2026 };
  assert.ok(!validerProfil({ ...fiche, essaiFin: '2026-08-01' }, opts).ok);
  const v = validerProfil({ ...fiche, essaiFin: '2026-12-20' }, opts);
  assert.ok(v.ok && v.warnings.some(w => /maximum légal/.test(w)));
});

test('délai de prévenance : dernier jour pour notifier une rupture de l’essai (art. L1221-25)', () => {
  assert.deepEqual(prevenance('2026-09-01', '2026-09-05'), { jusquau: '2026-09-06', texte: '24 heures' });
  assert.deepEqual(prevenance('2026-09-01', '2026-09-20'), { jusquau: '2026-09-22', texte: '48 heures' });
  assert.deepEqual(prevenance('2026-09-01', '2026-11-01'), { jusquau: '2026-11-15', texte: '2 semaines' });
  assert.deepEqual(prevenance('2026-09-01', '2026-12-15'), { jusquau: '2027-01-15', texte: '1 mois' });
  // Essai de 2 mois : 2 semaines avant la fin ; de 4 mois : notifier au plus tard au troisième mois (2 semaines suffisent alors).
  assert.deepEqual(limitePrevenance({ entree: '2026-09-01', typeContrat: 'cdi', essaiFin: '2026-10-31', essaiRenouveleJusquau: null }), { le: '2026-10-17', delai: '2 semaines' });
  assert.deepEqual(limitePrevenance({ entree: '2026-09-01', typeContrat: 'cdi', essaiFin: '2026-10-31', essaiRenouveleJusquau: '2026-12-31' }), { le: '2026-12-01', delai: '2 semaines' });
  // Intérim, essai de moins d'une semaine : la fin de l'essai elle-même.
  assert.deepEqual(limitePrevenance({ entree: '2026-09-01', typeContrat: 'interim', essaiFin: '2026-09-03', essaiRenouveleJusquau: null }), { le: '2026-09-03', delai: null });
  assert.deepEqual(limitePrevenance({ entree: '2026-09-01', typeContrat: 'cdd', essaiFin: '2026-09-04', essaiRenouveleJusquau: null }), { le: '2026-09-04', delai: null });
  assert.equal(limitePrevenance({ entree: '2026-09-01', typeContrat: 'cdi', essaiFin: null, essaiRenouveleJusquau: null }), null);
});

test('échéances « Contrats » : fin d’essai, fin de CDD ; journal de la fiche ; tableau de bord et résumé du manager', async () => {
  const { db, run, RH, user, domain, contrats } = await fresh();
  // Embauche du 14 septembre, technicien en CDI, essai de 3 mois écrit au contrat.
  const { id } = (await run(RH, 'employe.creer', {
    ...PROFIL_VIDE('Maintenance', '2026-10-10'), nom: 'Nina Morel', poste: 'Technicienne', statut: 'technicien', entree: '2026-09-14', naissance: 1998, essaiFin: '2026-12-13',
  })).result as { id: number };
  const essai = contrats(await domain()).find(x => x.emp.id === id)!;
  assert.deepEqual([essai.label, iso(essai.exp), essai.kindLabel, essai.key, essai.statut, essai.action?.intent],
    ['Fin d’essai le 13 déc. 2026', '2026-11-29', 'Période d’essai · prévenance de 2 semaines', 'due', 'À décider', { type: 'openContrat', empId: id, quoi: 'fiche' }]);
  // Renouvellement saisi sur la fiche : journal des dates, échéance déplacée.
  await run(RH, 'employe.modifier', { id, essaiRenouveleJusquau: '2027-03-13' });
  const j = (await db.all<Ligne>('journal')).findLast(x => x.action === 'employe.modifier')!;
  assert.deepEqual([j.payload.avant, j.payload.apres], [{ essaiRenouveleJusquau: null }, { essaiRenouveleJusquau: '2027-03-13' }]);
  const ren = contrats(await domain()).find(x => x.emp.id === id)!;
  assert.deepEqual([ren.label, iso(ren.exp), ren.kindLabel], ['Fin d’essai renouvelé le 13 mars 2027', '2027-02-13', 'Période d’essai · prévenance de 1 mois']);
  // Fin de CDD (Lucas Martin, 29 janvier 2027) : prévue au-delà du seuil, à anticiper en deçà ; la sortie enregistrée la remplace.
  const cdd = async (h: number) => contrats(await domain(), h).find(x => x.emp.id === 4)!;
  assert.deepEqual([(await cdd(90)).label, (await cdd(90)).key, (await cdd(90)).statut, (await cdd(180)).key, (await cdd(180)).action?.label], ['Fin de CDD', 'ok', 'Prévue', 'due', 'Enregistrer la sortie']);
  assert.ok(contrats(await domain()).some(x => x.emp.id === 24 && x.label === 'Fin d’alternance'));
  await run(RH, 'employe.sortie', { id: 4, date: '2027-01-29', motif: 'fin_cdd' });
  assert.ok(!contrats(await domain()).some(x => x.emp.id === 4), 'sortie enregistrée : plus d’échéance de fin de contrat');
  // Manager (Karim Haddad, Maintenance) : la période d'essai de sa nouvelle recrue lui est transmise, et son échéance.
  const mgr = await domain(await user(12, 'manager'));
  assert.equal(mgr.emp(id)!.essaiRenouveleJusquau, '2027-03-13');
  assert.ok(contrats(mgr).some(x => x.emp.id === id));
  // Référent HSE : ni la période d'essai ni son échéance.
  const hse = await domain(await user(23, 'rh'));
  assert.equal(hse.emp(id)!.essaiFin, null);
  assert.ok(!contrats(hse).some(x => x.emp.id === id));
});

test('titre de séjour : contrôles, alertes réglables, non conforme et No Go CONTRAT (libellé générique), journal sans numéro, vues', async () => {
  const { db, run, refus, RH, user, domain, contrats } = await fresh();
  // Jeu de démonstration : titre de Fatou Ndiaye à renouveler (fin janvier, sous l'alerte de 120 jours).
  const fatou = contrats(await domain()).find(x => x.emp.id === 17)!;
  assert.deepEqual([fatou.kindLabel, fatou.label, fatou.key, fatou.statut], ['Titre de séjour', 'Carte pluriannuelle', 'due', 'Renouvellement à demander']);
  // Contrôles : numéro exigé, expiration exigée, vérification jamais future.
  await refus(RH, 'employe.autorisationTravail', { id: 2, requise: true, type: 'salarie', expire: '2027-06-30' }, /Numéro du titre requis/);
  await refus(RH, 'employe.autorisationTravail', { id: 2, requise: true, type: 'salarie', numero: 'AB1234567' }, /expiration du titre requise/);
  await refus(RH, 'employe.autorisationTravail', { id: 2, requise: true, type: 'inconnu', numero: 'AB1234567', expire: '2027-06-30' }, /Type de titre/);
  await refus(RH, 'employe.autorisationTravail', { id: 2, requise: true, type: 'salarie', numero: 'AB1234567', expire: '2027-06-30', verifieLe: '2026-11-01' }, /future/);
  // Relance sous 60 jours.
  await run(RH, 'employe.autorisationTravail', { id: 2, requise: true, type: 'salarie', numero: 'ab 123 4567', expire: '2026-11-30', verifieLe: '2016-08-26' });
  assert.deepEqual((await db.get<{ autorisationTravail: unknown }>('employes', 2))!.autorisationTravail, { type: 'salarie', numero: 'AB1234567', expire: '2026-11-30', demandeLe: null, verifieLe: '2016-08-26' });
  assert.equal(contrats(await domain()).find(x => x.emp.id === 2)!.statut, 'Relance');

  // Chantier de Mehdi Benali reçu de Keystone : Go / No Go avant et après l'expiration.
  await db.tx(async () => {
    await enregistrerChantier(await contexte(db), 'K-TS', { nom: 'Arrêt technique', lieu: 'Feyzin', pays: 'FR', debut: '2026-10-19', fin: '2026-10-30' });
    await enregistrerAffectation(await contexte(db), 'AF-K-TS-0', { matricule: matricule(2), chantier: 'K-TS', du: '2026-10-19', au: '2026-10-30' });
    await suivreVerdicts(db);
  });
  const motifs = (d: InstanceType<typeof Domain>) => d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === 'K-TS')!.res.find(r => r.e.id === 2)!.reasons;
  assert.ok(!motifs(await domain()).some(r => r.code === 'CONTRAT'));

  // Titre expiré : avertissement (pas de blocage), non conforme, échéance « non conforme », No Go CONTRAT.
  const r = await run(RH, 'employe.autorisationTravail', { id: 2, requise: true, type: 'salarie', numero: 'AB1234567', expire: '2026-10-01', verifieLe: '2016-08-26' });
  assert.match(String(r.message), /Titre expiré le 1 oct\. 2026/);
  const d = await domain();
  assert.equal(d.enrich(90, false).find(e => e.id === 2)!.worst, 'exp');
  assert.deepEqual(contrats(d).filter(x => x.emp.id === 2).map(x => [x.key, x.statut]), [['exp', 'Expiré — non conforme']]);
  const m = motifs(d).find(x => x.code === 'CONTRAT')!;
  assert.deepEqual([m.level, m.minimal, m.detailed, m.transmis], ['nogo', SITUATION_A_REGULARISER, 'Autorisation de travail expirée le 1 oct. 2026', SITUATION_A_REGULARISER]);
  // Keystone : code CONTRAT, et en partage détaillé le seul libellé générique, jamais le titre de séjour.
  const ch = d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === 'K-TS')!;
  const detail = JSON.stringify([d.verdictKeystone(ch, true, '2026-10-10T05:00:00.000Z'), d.keystonePayload(ch, true, '2026-10-10T05:00:00.000Z')]);
  assert.ok(detail.includes(SITUATION_A_REGULARISER) && !/séjour|autorisation de travail|AB1234567/i.test(detail), detail);
  const envoi = (await db.all<{ type: string; contenu: Record<string, any> }>('envois')).filter(e => e.type === 'verdict.modifie').at(-1)!.contenu;
  assert.deepEqual(envoi.ressource.motifs, [{ code: 'CONTRAT', niveau: 'NO_GO' }]);

  // Journal : type, expiration, vérification ; le numéro n'y figure jamais (seul son changement est signalé).
  const lignes = (await db.all<Ligne>('journal')).filter(x => x.action === 'employe.autorisationTravail');
  assert.equal(lignes.length, 2);
  assert.ok(lignes.every(l => !JSON.stringify(l).includes('AB1234567') && !JSON.stringify(l).includes('4567')), 'numéro absent du journal');
  assert.deepEqual([lignes[1].payload.avant, lignes[1].payload.apres], [{ expire: '2026-11-30' }, { expire: '2026-10-01' }]);
  assert.deepEqual(lignes[0].salaries, [2]);

  // Vues : manager et référent HSE, verdict seul ; lecture seule, sans numéro ; l'intéressé, son titre.
  for (const u of [await user(12, 'manager'), await user(23, 'rh'), await user(7, 'rh')]) {
    const e = (await buildSnapshot(db, u)).employes.find(x => x.id === 2)!;
    assert.deepEqual([e.autorisationTravail, e.autorisationVerdict], [null, 'expiree'], u.nom);
    assert.ok(!JSON.stringify(await buildSnapshot(db, u)).includes('AB1234567'));
  }
  const autre = (await buildSnapshot(db, await user(12, 'manager'))).employes.find(x => x.id === 6)!;
  assert.equal(autre.autorisationVerdict, 'valide', 'aucun titre requis : « valide », sans révéler qui en a un');
  const mgr = await domain(await user(12, 'manager'));
  assert.ok(motifs(new Domain(await buildSnapshot(db, await user(23, 'rh')))).some(x => x.code === 'CONTRAT' && x.detailed === `${SITUATION_A_REGULARISER} avec le service RH`));
  assert.equal(mgr.enrich(90, false).find(e => e.id === 2)!.worst, 'exp');
  assert.ok(!contrats(mgr).some(x => x.emp.id === 2), 'verdict seul : aucune échéance datée');
  assert.deepEqual((await buildSnapshot(db, await user(11, 'rh'))).employes.find(x => x.id === 2)!.autorisationTravail, { type: 'salarie', numero: null, expire: '2026-10-01', demandeLe: null, verifieLe: '2016-08-26' });
  assert.equal((await buildSnapshot(db, await user(2, 'collaborateur'))).employes.find(x => x.id === 2)!.autorisationTravail?.numero, 'AB1234567');
  // Export des données personnelles (droit d'accès) : le titre fait partie de la fiche.
  assert.deepEqual(((await donneesSalarie(db, 2, { journal: false, par: 'test' }))!.sections as Record<string, any>).Fiche.autorisationTravail.numero, 'AB1234567');

  // Ressortissant de l'UE : titre effacé, plus d'échéance ni de No Go.
  await run(RH, 'employe.autorisationTravail', { id: 2, requise: false });
  assert.equal((await db.get<{ autorisationTravail: unknown }>('employes', 2))!.autorisationTravail, null);
  assert.ok(!motifs(await domain()).some(x => x.code === 'CONTRAT'));
  // Réglages : la relance vient après la première alerte.
  await assert.rejects(async () => appliquerReglages((await buildSnapshot(db, RH)).settings, { titreSejourRelance: 120, titreSejourAlerte: 90 }), ReglageInvalide);
  assert.equal(appliquerReglages((await buildSnapshot(db, RH)).settings, { titreSejourAlerte: 150 }).titreSejourAlerte, 150);
});

test('titre de séjour : contrôle à l’embauche (vérification en préfecture 2 jours ouvrables avant, art. R5221-41)', () => {
  // Lundi 2 novembre 2026 : 2 jours ouvrables avant, le vendredi 30 octobre (samedi compris, dimanche et 1er novembre exclus).
  assert.equal(joursOuvrablesAvant('2026-11-02', 2), '2026-10-30');
  const titre = { requise: true, type: 'salarie', numero: 'XY98765', expire: '2028-01-31' };
  const embauche = { entree: '2026-11-02', ti: '2026-10-10' };
  assert.deepEqual(validerAutorisation({ ...titre, verifieLe: '2026-10-09' }, embauche).warnings, []);
  assert.match(validerAutorisation(titre, embauche).warnings.join(), /non tracée/);
  // Sans date d'envoi, une réponse reçue après la date limite ne prouve rien : la date d'envoi est à tracer.
  assert.match(validerAutorisation({ ...titre, verifieLe: '2026-10-10' }, { entree: '2026-10-12', ti: '2026-10-10' }).warnings.join(), /Réponse de la préfecture reçue après le 9 oct\. 2026 : tracez la date d’envoi/);
  // La règle porte sur l'envoi de la demande : envoyée le 27 octobre, réponse le 31, aucune alerte ; sans réponse, non plus
  // (passé 2 jours ouvrables, l'obligation est remplie) ; envoyée le 31, tardive.
  const apres = { entree: '2026-11-02', ti: '2026-11-02' };
  assert.deepEqual(validerAutorisation({ ...titre, demandeLe: '2026-10-27', verifieLe: '2026-10-31' }, apres).warnings, []);
  assert.deepEqual(validerAutorisation({ ...titre, demandeLe: '2026-10-27' }, apres).warnings, []);
  assert.match(validerAutorisation({ ...titre, demandeLe: '2026-10-31', verifieLe: '2026-10-31' }, apres).warnings.join(), /Demande d’authentification à envoyer à la préfecture au moins 2 jours ouvrables avant l’embauche, soit le 30 oct\. 2026/);
  assert.match(validerAutorisation({ ...titre, demandeLe: '2026-10-30', verifieLe: '2026-10-29' }, apres).errors.join(), /antérieure à l’envoi de la demande/);
  assert.match(validerAutorisation({ ...titre, demandeLe: '2026-11-03' }, apres).errors.join(), /demande d’authentification future/);
  assert.deepEqual(validerAutorisation({ ...titre, demandeLe: '2026-10-27' }, apres).valeur, { type: 'salarie', numero: 'XY98765', expire: '2028-01-31', demandeLe: '2026-10-27', verifieLe: null });
  // Ancienne embauche (titre renouvelé depuis) : pas d'avertissement d'embauche.
  assert.deepEqual(validerAutorisation({ ...titre, verifieLe: '2026-09-01' }, { entree: '2016-09-01', ti: '2026-10-10' }).warnings, []);
  // Carte de résident permanent : sans expiration.
  assert.deepEqual(validerAutorisation({ requise: true, type: 'resident_permanent', numero: 'RP12345', verifieLe: '2016-08-01' }, { entree: '2016-09-01', ti: '2026-10-10' }).valeur,
    { type: 'resident_permanent', numero: 'RP12345', expire: null, demandeLe: null, verifieLe: '2016-08-01' });
});

test('période d’essai rompue ou départ anticipé : la fiche reste modifiable, plus d’échéance d’essai ni de fin de contrat', async () => {
  const { db, run, refus, RH, user, domain, contrats } = await fresh();
  // Nina Morel, technicienne en CDI entrée le 14 septembre, essai jusqu'au 13 décembre ; rupture de l'essai au 20 octobre.
  const { id } = (await run(RH, 'employe.creer', {
    ...PROFIL_VIDE('Maintenance', '2026-10-10'), nom: 'Nina Morel', poste: 'Technicienne', statut: 'technicien', entree: '2026-09-14', naissance: 1998, essaiFin: '2026-12-13',
  })).result as { id: number };
  await run(RH, 'employe.sortie', { id, date: '2026-10-20', motif: 'fin_periode_essai' });
  // La date de sortie précède la fin de l'essai écrite au contrat : ni le RH ni le manager ne sont bloqués.
  await run(RH, 'employe.modifier', { id, poste: 'Technicienne de maintenance' });
  const KARIM = await user(12, 'manager');
  await run(KARIM, 'employe.modifier', { id, poste: 'Technicienne de maintenance électrique' });
  assert.equal((await db.get<{ essaiFin: string }>('employes', id))!.essaiFin, '2026-12-13', 'l’essai écrit au contrat est gardé');
  // Contrôle du dialogue, avec la vue du manager (sans le motif ni la fin prévue, mais l'indication de la sortie).
  const vue = (await buildSnapshot(db, KARIM)).employes.find(x => x.id === id)!;
  assert.deepEqual([vue.motifSortie, vue.finPrevue, vue.sortieEnregistree], [null, null, true]);
  const opts = { equipes: ['Maintenance'], year: 2026 };
  assert.deepEqual(validerProfil(profilOf(vue), { ...opts, contrat: { finPrevue: vue.finPrevue, sortieEnregistree: vue.sortieEnregistree } }).errors, []);
  // Rupture déjà enregistrée : plus « à décider », ni chez le service RH ni chez le manager.
  assert.ok(!contrats(await domain()).some(x => x.emp.id === id));
  assert.ok(!contrats(await domain(KARIM)).some(x => x.emp.id === id));

  // CDD avec essai, départ anticipé : l'essai reste borné par la fin prévue au contrat, pas par la date de sortie.
  await run(RH, 'employe.modifier', { id: 4, essaiFin: '2026-10-20' });
  await run(RH, 'employe.sortie', { id: 4, date: '2026-10-15', motif: 'fin_periode_essai' });
  await run(RH, 'employe.modifier', { id: 4, poste: 'Opérateur' });
  await refus(RH, 'employe.modifier', { id: 4, essaiFin: '2027-02-15' }, /dépasse la fin prévue du contrat/);
});

test('échéances « Contrats » : une sortie enregistrée retire la fin de CDD chez le manager et le référent HSE comme chez le RH', async () => {
  const { run, RH, user, domain, contrats } = await fresh();
  // Lucas Martin, CDD jusqu'au 29 janvier 2027 : démission au 15 novembre.
  const finCdd = (d: InstanceType<typeof Domain>) => contrats(d, 180).some(x => x.emp.id === 4 && x.label === 'Fin de CDD');
  const MGR = await user(16, 'manager'), HSE = await user(23, 'rh');
  assert.ok([await domain(), await domain(MGR), await domain(HSE)].every(finCdd));
  await run(RH, 'employe.sortie', { id: 4, date: '2026-11-15', motif: 'demission' });
  assert.deepEqual([await domain(), await domain(MGR), await domain(HSE)].map(finCdd), [false, false, false]);
  // Le motif ne leur parvient pas.
  for (const u of [MGR, HSE]) assert.deepEqual([(await domain(u)).emp(4)!.motifSortie, (await domain(u)).emp(4)!.finPrevue], [null, null]);
  // Fin d'essai notifiée (sortie le 24 octobre, essai jusqu'au 31) : plus d'échéance « À décider ».
  await run(RH, 'employe.modifier', { id: 2, essaiFin: '2026-10-31' });
  assert.ok(contrats(await domain()).some(x => x.emp.id === 2 && /^Fin d’essai/.test(x.label)));
  await run(RH, 'employe.sortie', { id: 2, date: '2026-10-24', motif: 'fin_periode_essai' });
  assert.ok(!contrats(await domain()).some(x => x.emp.id === 2 && /^Fin d’essai/.test(x.label)));
});

test('titre de séjour : le journal ne recopie que des codes et des dates validés, jamais du texte libre', async () => {
  const { db, run, RH } = await fresh();
  const derniere = async () => (await db.all<Ligne>('journal')).filter(x => x.action === 'employe.autorisationTravail').at(-1)!;
  await run(RH, 'employe.autorisationTravail', { id: 2, requise: false, type: 'texte libre type', expire: 'Nationalité malienne', verifieLe: 'commentaire' });
  assert.ok(!/texte libre|Nationalité|commentaire/.test(JSON.stringify(await derniere())), JSON.stringify(await derniere()));
  await run(RH, 'employe.autorisationTravail', { id: 2, requise: true, type: 'resident_permanent', numero: 'AB12345', expire: 'Nationalité malienne' });
  const l = await derniere();
  assert.ok(!/Nationalité|AB12345/.test(JSON.stringify(l)), JSON.stringify(l));
  assert.deepEqual([l.payload.type, l.payload.expire, l.payload.demandeLe], ['resident_permanent', null, null]);
  await run(RH, 'employe.autorisationTravail', { id: 2, requise: true, type: 'salarie', numero: 'AB12345', expire: '2027-06-30', demandeLe: '2016-08-20', verifieLe: '2016-08-26' });
  assert.deepEqual([(await derniere()).payload.type, (await derniere()).payload.expire, (await derniere()).payload.demandeLe, (await derniere()).payload.verifieLe], ['salarie', '2027-06-30', '2016-08-20', '2016-08-26']);
});
