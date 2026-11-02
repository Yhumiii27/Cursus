// Planning d'équipe (lot 12, chantier C5, étape 2) sur le jeu de démonstration du 10 octobre 2026 à 9 h (Karim Haddad, 12,
// encadre la Maintenance : Mehdi Benali, 2, dont l'habilitation électrique est expirée ; Thomas Garnier, 6, aptitude à
// vérifier ; Romain Chevalier, 18) : aperçu des dialogues Publier et Valider un échange identique à la décision du serveur,
// pré-remplissage de la feuille par le poste publié (jamais un brouillon, ni module désactivé ; figé à la soumission), postes
// publiés dans le flux d'agenda, reprise des « équipes par quart » en groupes de roulement (règle et action
// planning.reprise : droits, rejeu, journal sans texte libre).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { json, nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { horloge } = await import('../server/src/astreintes.ts');
const { calendrierFlux, evenementsAgenda } = await import('../server/src/agenda.ts');
const { Domain } = await import('../shared/domain.ts');
const { apercuEchange, apercuPublication, fenetreControles, joursPlanifiesDe } = await import('../shared/rules/planning-apercu.ts');
const { horairesPlanifies } = await import('../shared/rules/planning-feuille.ts');
const { horairesAFiger, horairesDeLaFeuille } = await import('../shared/rules/horaires.ts');
const { equipesParQuart, proposerReprise } = await import('../shared/rules/planning-reprise.ts');
const { calcSheet } = await import('../shared/rules/temps.ts');
const { JOURNAL_LABEL } = await import('../shared/journal.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Creneau = import('../shared/types-planning.ts').Creneau;
type Equipe = import('../shared/types.ts').Equipe;
type ContenuAgenda = import('../shared/types.ts').ContenuAgenda;

horloge.maintenant = () => new Date('2026-10-10T09:00:00+02:00');

async function fresh(actif = true) {
  const db = await nouvelleBase();
  await seedDemo(db);
  if (actif) await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), planningActif: true });
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
  const refuse = async (u: User, name: string, p: Record<string, unknown>, motif: RegExp, status?: number) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && motif.test(e.message) && (!status || e.status === status), `${name} : ${motif}`);
  const domaine = async (u: User) => new Domain(await loadFull(db, u));
  const RH = await user(null, 'rh'), KARIM = await user(12, 'manager'), THOMAS = await user(6, 'collaborateur'), ROMAIN = await user(18, 'collaborateur');
  return { db, run, refuse, domaine, RH, KARIM, THOMAS, ROMAIN };
}

test('aperçu de la publication : mêmes refus, alertes et délai de prévenance que le serveur', async () => {
  const { run, refuse, domaine, KARIM } = await fresh();
  for (const [empId, groupe] of [[2, 'A'], [6, 'A'], [18, 'B']] as const) await run(KARIM, 'planning.roulement.affecter', { empId, cycle: '2X8', groupe, du: '2026-10-12' });
  await run(KARIM, 'planning.generer', { equipe: 'Maintenance', du: '2026-10-12', au: '2026-10-25' });
  const d = await domaine(KARIM);
  // Début ramené à aujourd'hui ; Mehdi : habilitation expirée, refus ; Thomas : réserve d'aptitude ; délai court la 1re semaine.
  const a = apercuPublication(d, 'Maintenance', '2026-10-01', '2026-10-18');
  assert.equal(a.du, '2026-10-10');
  assert.equal(a.brouillons.length, 21);
  assert.deepEqual(a.salaries.sort((x, y) => x - y), [2, 6, 18]);
  assert.deepEqual(a.verrou, []);
  assert.equal(a.delai, 7);
  assert.equal(a.horsDelai.length, 15, 'du lundi au vendredi, communiqués moins de 7 jours avant');
  assert.ok(a.alertes.refus.length > 0 && a.alertes.refus.every(x => x.empId === 2 && x.code === 'habilitation'));
  assert.deepEqual(a.alertes.alertes.filter(x => x.code === 'aptitude').map(x => x.empId), [6]);
  await refuse(KARIM, 'planning.publier', { equipe: 'Maintenance', du: '2026-10-12', au: '2026-10-18', motif: 'x', motifAlertes: 'y' }, /Mehdi Benali — 12 oct\. 2026 : habilitation exigée/, 409);
  // Sans Mehdi : l'aperçu ne relève plus de refus, et le serveur publie avec le même nombre d'alertes.
  await run(KARIM, 'planning.roulement.terminer', { id: 1, au: '2026-10-11' });
  for (const c of (await domaine(KARIM)).ds.creneaux!.filter(c => c.empId === 2)) await run(KARIM, 'planning.creneau.annuler', { id: c.id });
  const b = apercuPublication(await domaine(KARIM), 'Maintenance', '2026-10-12', '2026-10-18');
  assert.deepEqual(b.alertes.refus, []);
  const p = await run(KARIM, 'planning.publier', { equipe: 'Maintenance', du: '2026-10-12', au: '2026-10-18', motif: 'Mise en place', motifAlertes: 'Visite programmée' });
  assert.equal((p.result as { alertes: number; horsDelai: number }).alertes, b.alertes.alertes.length);
  assert.equal((p.result as { horsDelai: number }).horsDelai, b.horsDelai.length);
  // Période vide, ou passée : rien à publier.
  assert.equal(apercuPublication(await domaine(KARIM), 'Maintenance', '2026-10-01', '2026-10-05').brouillons.length, 0);
  assert.equal(apercuPublication(await domaine(KARIM), 'Maintenance', '2026-10-12', '2026-10-18').brouillons.length, 0);
});

test('jours planifiés de la fenêtre des contrôles : brouillon devant la version publiée, brouillons passés ignorés, remplacements', () => {
  const c = (id: number, jour: string, statut: Creneau['statut'], horaire: string | null, remplaceId: number | null = null) =>
    ({ id, empId: 6, jour, statut, horaire, debut: horaire ? '08:00' : null, fin: horaire ? '16:00' : null, pause: 0, remplaceId }) as Creneau;
  assert.deepEqual(fenetreControles('2026-10-14', '2026-10-20'), ['2026-07-27', '2026-10-27']);
  const lignes = [c(1, '2026-10-09', 'brouillon', 'J'), c(2, '2026-10-09', 'publie', 'M'), c(3, '2026-10-12', 'publie', 'J'), c(4, '2026-10-12', 'brouillon', 'N', 3),
    c(5, '2026-10-13', 'annule', 'J'), c(6, '2025-01-01', 'publie', 'J'), { ...c(7, '2026-10-14', 'publie', 'J'), empId: 2 }];
  const j = joursPlanifiesDe(lignes, 6, '2026-10-12', '2026-10-18', '2026-10-10', new Map([['2026-10-15', null], ['2026-10-16', c(8, '2026-10-16', 'publie', 'AM')]]));
  assert.deepEqual(j.map(x => [x.jour, x.horaire?.code ?? null]), [['2026-10-09', 'M'], ['2026-10-12', 'N'], ['2026-10-15', null], ['2026-10-16', 'AM']]);
});

test('aperçu d’un échange : refus du collègue qui travaille déjà, poste modifié, brouillon en attente ; alertes recalculées', async () => {
  const { run, domaine, KARIM, THOMAS, ROMAIN } = await fresh();
  await run(KARIM, 'planning.roulement.affecter', { empId: 6, cycle: '2X8', groupe: 'A', du: '2026-10-19' });
  await run(KARIM, 'planning.roulement.affecter', { empId: 18, cycle: '2X8', groupe: 'B', du: '2026-10-19' });
  await run(KARIM, 'planning.generer', { equipe: 'Maintenance', du: '2026-10-19', au: '2026-10-25' });
  await run(KARIM, 'planning.publier', { equipe: 'Maintenance', du: '2026-10-19', au: '2026-10-25', motifAlertes: 'Visite programmée' });
  const d0 = await domaine(KARIM);
  const lundiThomas = d0.ds.creneaux!.find(c => c.empId === 6 && c.jour === '2026-10-19')!;
  const samediRomain = d0.ds.creneaux!.find(c => c.empId === 18 && c.jour === '2026-10-24')!;
  // Cession d'un jour où Romain travaille : refus.
  const cession = { demandeurId: 6, partenaireId: 18, creneauDemandeur: lundiThomas.id, creneauPartenaire: null };
  assert.match(apercuEchange(d0, cession).refus!, /travaille déjà le 19 oct\. 2026/);
  // Échange du lundi de Thomas contre le samedi (repos publié) de Romain : contrôles des deux, réserve d'aptitude de Thomas.
  const lundiRomain = d0.ds.creneaux!.find(c => c.empId === 18 && c.jour === '2026-10-19')!;
  const meme = apercuEchange(d0, { ...cession, creneauPartenaire: lundiRomain.id });
  assert.equal(meme.refus, null);
  assert.ok(meme.alertes.alertes.some(x => x.empId === 6 && x.code === 'aptitude'));
  assert.match(apercuEchange(d0, { ...cession, creneauPartenaire: samediRomain.id }).refus ?? '', /^$|travaille/);
  await run(THOMAS, 'planning.echange.proposer', { creneauId: lundiThomas.id, partenaireId: 18, creneauPartenaire: lundiRomain.id });
  await run(ROMAIN, 'planning.echange.accepter', { id: 1 });
  // Modification en brouillon sur ces jours : refus de l'aperçu comme du serveur.
  await run(KARIM, 'planning.creneau.modifier', { id: lundiRomain.id, horaire: 'J' });
  assert.match(apercuEchange(await domaine(KARIM), { ...cession, creneauPartenaire: lundiRomain.id }).refus!, /attend sa publication/);
  // Poste annulé depuis : l'échange sera annulé.
  assert.match(apercuEchange(await domaine(KARIM), { ...cession, creneauDemandeur: 999999 }).refus!, /modifié ou annulé/);
  assert.match(apercuEchange(await domaine(KARIM), { ...cession, creneauPartenaire: 999999 }).refus!, /modifié ou annulé/);
  // Salarié inconnu de l'instantané : ignoré.
  assert.equal(apercuEchange(await domaine(KARIM), { demandeurId: 6, partenaireId: 999, creneauDemandeur: lundiThomas.id, creneauPartenaire: null }).refus, null);
});

test('pré-remplissage : le poste publié du jour est proposé sur la feuille (jamais un brouillon), figé à la soumission', async () => {
  const { db, run, domaine, KARIM, THOMAS } = await fresh();
  await run(KARIM, 'planning.roulement.affecter', { empId: 6, cycle: '2X8', groupe: 'B', du: '2026-10-19' });
  await run(KARIM, 'planning.generer', { equipe: 'Maintenance', du: '2026-10-19', au: '2026-11-01' });
  // Brouillons : rien de proposé.
  assert.equal(horairesPlanifies((await domaine(THOMAS)).ds, 6, '2026-10-19'), undefined);
  assert.equal(horairesPlanifies((await domaine(KARIM)).ds, 6, '2026-10-19'), undefined, 'le manager voit les brouillons, mais seuls les postes publiés comptent');
  await run(KARIM, 'planning.publier', { equipe: 'Maintenance', du: '2026-10-19', au: '2026-10-25', motifAlertes: 'Visite programmée' });
  const d = await domaine(THOMAS);
  const p = horairesPlanifies(d.ds, 6, '2026-10-19')!;
  assert.deepEqual(p.map(x => x?.code ?? x), ['M', 'M', 'M', 'M', 'M', null, null]);
  assert.equal(horairesPlanifies(d.ds, 6, '2026-10-26'), undefined, 'semaine non publiée');
  assert.equal(horairesPlanifies(d.ds, 6, null), undefined);
  assert.equal(horairesPlanifies({ ...d.ds, settings: { ...d.ds.settings, planningActif: false } }, 6, '2026-10-19'), undefined, 'module désactivé');
  // Feuille en saisie : l'horaire publié passe devant celui de l'équipe, seulement les jours qui portent des heures.
  const perDay = [7.5, 7.5, 0, 0, 0, 0, 0];
  const jours = horairesDeLaFeuille(d.ds.referentiels, 'Maintenance', null, perDay, p);
  assert.deepEqual(jours.slice(0, 3).map(j => [j.code, j.propose, j.horaire?.debut]), [['M', true, '05:00'], ['M', true, '05:00'], [null, false, undefined]]);
  // Choix explicite sur la feuille : il l'emporte ; feuille validée : rien de proposé.
  assert.equal(horairesDeLaFeuille(d.ds.referentiels, 'Maintenance', { statut: 'brouillon', horaires: ['M', null, null, null, null, null, null] }, perDay, p)[0].code, 'M');
  assert.equal(horairesDeLaFeuille(d.ds.referentiels, 'Maintenance', { statut: 'validee', horaires: undefined, horairesFiges: [null, null, null, null, null, null, null] }, perDay, p)[0].code, null);
  assert.deepEqual(horairesAFiger(d.ds.referentiels, 'Maintenance', { statut: 'brouillon', horaires: undefined }, perDay, p).horairesFiges?.[0]?.code, 'M');
  // Semaine passée (poste publié le lundi 5 octobre) : feuille soumise par le salarié, horaire publié figé, repris par le décompte.
  await db.insert<Creneau>('creneaux', {
    empId: 6, jour: '2026-10-05', equipe: 'Maintenance', horaire: 'N', debut: '21:00', fin: '05:00', pause: 30, source: 'manuel', statut: 'publie', version: 1,
    publieLe: '2026-09-20T08:00:00.000Z', publiePar: 'Karim Haddad', communiqueLe: '2026-09-20', horsDelai: false, creeLe: '2026-09-20T08:00:00.000Z', creePar: 'Karim Haddad',
  });
  await run(THOMAS, 'temps.addLine', { empId: 6, week: '2026-10-05', projet: 'INT-MAINT' });
  const li = (await domaine(THOMAS)).ds.feuilles.find(f => f.empId === 6 && f.week === '2026-10-05')!.lignes.length - 1;
  await run(THOMAS, 'temps.setCell', { empId: 6, week: '2026-10-05', li, di: 0, value: '7.5' });
  const dt = await domaine(THOMAS);
  const sh = dt.ds.feuilles.find(f => f.empId === 6 && f.week === '2026-10-05')!;
  assert.ok(calcSheet(dt, dt.emp(6)!, sh));
  await run(THOMAS, 'temps.submit', { empId: 6, week: '2026-10-05' });
  const soumise = (await db.all<{ empId: number; week: string; horairesFiges: unknown }>('feuilles')).find(f => f.empId === 6 && f.week === '2026-10-05')!;
  assert.deepEqual(json<({ code: string; debut: string } | null)[]>(soumise.horairesFiges)[0], { code: 'N', debut: '21:00', fin: '05:00', pause: 30 });
});

test('flux d’agenda : postes publiés (ni brouillon, ni repos), module activé seulement', async () => {
  const { db, run, KARIM } = await fresh();
  await run(KARIM, 'planning.roulement.affecter', { empId: 6, cycle: '3X8', groupe: 'C', du: '2026-10-19' });
  await run(KARIM, 'planning.generer', { equipe: 'Maintenance', du: '2026-10-19', au: '2026-11-01' });
  await run(KARIM, 'planning.publier', { equipe: 'Maintenance', du: '2026-10-19', au: '2026-10-25', motifAlertes: 'Visite programmée' });
  const s = { agendaContenu: ['postes'] as ContenuAgenda[], planningActif: true };
  const evs = await evenementsAgenda(db, 6, s, '2026-10-10');
  const postes = evs.filter(e => e.uid.startsWith('poste-'));
  assert.equal(postes.length, 5, 'cinq nuits publiées ; les repos et les brouillons de la semaine suivante n’y sont pas');
  assert.deepEqual([postes[0].date, postes[0].titre, postes[0].plage], ['2026-10-19', 'Poste N', { debut: '21:00', finJour: '2026-10-20', fin: '05:00' }]);
  assert.match(postes[0].uid, /^poste-6-2026-10-19@/);
  assert.match(calendrierFlux(postes), /DTSTART;TZID=Europe\/Paris:20261019T210000/);
  assert.equal((await evenementsAgenda(db, 6, { ...s, planningActif: false }, '2026-10-10')).filter(e => e.uid.startsWith('poste-')).length, 0);
  // Contenu réglé par l'administrateur (Paramètres → Agenda) : sans « postes », aucun poste dans le flux.
  assert.equal((await evenementsAgenda(db, 6, { ...s, agendaContenu: ['sessions'] }, '2026-10-10')).filter(e => e.uid.startsWith('poste-')).length, 0);
});

test('reprise des équipes par quart : détection, règle, action (service RH, rejouable, journal sans texte libre)', async () => {
  const eq = (nom: string, ordre: number, parente: string | null, horaire: string | null) => ({ nom, ordre, parente, horaire, managerId: null }) as Equipe;
  const equipes = [eq('Production', 1, null, null), eq('Prod. nuit', 4, 'Production', 'N'), eq('Prod. matin', 2, 'Production', 'M'), eq('Prod. après-midi', 3, 'Production', 'AM'),
    eq('Maintenance', 5, null, 'J'), eq('Seule', 6, 'Maintenance', 'J')];
  assert.deepEqual(equipesParQuart(equipes), [{ parente: 'Production', equipes: ['Prod. matin', 'Prod. après-midi', 'Prod. nuit'] }]);

  const { db, run, refuse, domaine, RH, KARIM } = await fresh();
  const ds = (await domaine(RH)).ds;
  const base = { du: '2026-10-19', equipes: ds.referentiels.equipes, cycles: ds.cycles!, roulements: ds.roulements!, employes: ds.employes };
  assert.equal(proposerReprise({ ...base, code: 'XX', noms: ['Maintenance'] }).erreur, 'Cycle inconnu ou archivé');
  assert.match(proposerReprise({ ...base, code: '3X8', noms: [] }).erreur!, /Choisissez les équipes/);
  assert.match(proposerReprise({ ...base, code: '3X8', noms: ['Inconnue'] }).erreur!, /Équipe inconnue : Inconnue/);
  assert.match(proposerReprise({ ...base, code: 'JOUR', noms: ['Maintenance', 'Production'] }).erreur!, /n’a que 1 groupe pour 2 équipes/);
  // Ordre des équipes du référentiel : Maintenance (2e) avant Production (3e) → groupes A et B ; salariés sortis exclus.
  const r = proposerReprise({ ...base, code: '2X8', noms: ['Production', 'Maintenance'], exclus: new Set([12]) });
  assert.equal(r.erreur, null);
  assert.deepEqual([...new Set(r.lignes.map(l => `${l.equipe}:${l.groupe}`))], ['Maintenance:A', 'Production:B']);
  assert.deepEqual(r.ignores, [{ empId: 12, equipe: 'Maintenance', raison: 'votre propre planning, tenu par votre manager' }]);

  // Action : service RH seulement, module activé.
  await refuse(KARIM, 'planning.reprise', { cycle: '2X8', du: '2026-10-19', equipes: ['Maintenance'] }, /service RH|Réservé/i, 403);
  await refuse(RH, 'planning.reprise', { cycle: '2X8', du: '19/10/2026', equipes: ['Maintenance'] }, /Date de début invalide/);
  await refuse(RH, 'planning.reprise', { cycle: '2X8', du: '2026-10-19', equipes: 'Maintenance' }, /Choisissez les équipes/);
  await run(KARIM, 'planning.roulement.affecter', { empId: 6, cycle: 'JOUR', groupe: 'A', du: '2026-10-12' });
  const o = await run(RH, 'planning.reprise', { cycle: '2x8', du: '2026-10-19', equipes: ['Maintenance'] });
  const membres = (await domaine(RH)).ds.employes.filter(e => e.equipe === 'Maintenance' && (!e.fin || e.fin >= '2026-10-19')).length;
  assert.match(o.message!, new RegExp(`^Équipes par quart reprises dans le cycle 2X8 à partir du 19 oct\\. 2026 : ${membres - 1} salariés affectés · 1 laissé de côté \\(Thomas Garnier : Déjà affecté au cycle JOUR`));
  const roulements = (await db.all<{ empId: number; cycle: string; groupe: string; equipe: string }>('roulements')).filter(x => x.cycle === '2X8');
  assert.equal(roulements.length, membres - 1);
  assert.ok(roulements.every(x => x.groupe === 'A' && x.equipe === 'Maintenance'));
  // Rejouée : plus personne à affecter.
  assert.match((await run(RH, 'planning.reprise', { cycle: '2X8', du: '2026-10-19', equipes: ['Maintenance'] })).message!, /^Aucun salarié à affecter : \d+ déjà affectés ou hors contrat$/);
  const journal = (await db.all<{ action: string; payload: unknown; salaries: unknown }>('journal')).filter(j => j.action === 'planning.reprise');
  assert.deepEqual(json(journal[0].payload), { cycle: '2X8', du: '2026-10-19', equipes: ['Maintenance'], affectes: membres - 1, ignores: 1 });
  assert.equal(json<number[]>(journal[0].salaries).length, membres - 1);
  assert.deepEqual(json(journal[1].payload), { cycle: '2X8', du: '2026-10-19', affectes: 0, ignores: membres });
  assert.ok(JOURNAL_LABEL['planning.reprise']);
  // Module désactivé : 409.
  const x = await fresh(false);
  await x.refuse(x.RH, 'planning.reprise', { cycle: '2X8', du: '2026-10-19', equipes: ['Maintenance'] }, /désactivé/, 409);
});

// — Relecture de l'étape 2 —

test('horizon : rien n’est généré, ajouté ni publié au-delà des 12 semaines de l’instantané ; en deçà, l’aperçu voit tout', async () => {
  const { refusHorizon, horsFenetre, fenetrePlanning } = await import('../shared/rules/planning.ts');
  assert.deepEqual(fenetrePlanning('2026-10-10'), { du: '2026-08-15', au: '2027-01-02' });
  assert.equal(refusHorizon('2027-01-02', '2026-10-10'), null);
  assert.match(refusHorizon('2027-01-03', '2026-10-10')!, /12 semaines à venir : jusqu’au 2 janv\. 2027 au plus tard/);
  assert.equal(horsFenetre('2026-10-12', '2026-10-25', '2026-10-10'), false);
  assert.equal(horsFenetre('2026-07-27', '2026-08-09', '2026-10-10'), true, 'plus de 8 semaines passées');
  assert.equal(horsFenetre('2026-12-28', '2027-01-10', '2026-10-10'), true, 'au-delà des 12 semaines à venir');

  const { run, refuse, domaine, KARIM } = await fresh();
  for (const [empId, groupe] of [[6, 'A'], [18, 'B']] as const) await run(KARIM, 'planning.roulement.affecter', { empId, cycle: '2X8', groupe, du: '2026-10-12' });
  // Le cas relevé : janvier 2027 généré puis publié le 10 octobre, invisible de l'écran. Refusé désormais.
  await refuse(KARIM, 'planning.generer', { equipe: 'Maintenance', du: '2027-01-11', au: '2027-02-07' }, /12 semaines à venir/);
  // Douze semaines depuis le lundi suivant un samedi : elles débordent de la fenêtre de deux jours ; refusé aussi.
  await refuse(KARIM, 'planning.generer', { equipe: 'Maintenance', du: '2026-10-12', au: '2027-01-03' }, /12 semaines à venir/);
  await refuse(KARIM, 'planning.creneau.ajouter', { equipe: 'Maintenance', jour: '2027-01-03', horaire: 'J' }, /12 semaines à venir/);
  await refuse(KARIM, 'planning.publier', { equipe: 'Maintenance', du: '2026-12-28', au: '2027-01-10', motifAlertes: 'x' }, /12 semaines à venir/);
  // Jusqu'au dernier jour de la fenêtre : généré, et l'aperçu du dialogue voit chacun des brouillons créés.
  const g = await run(KARIM, 'planning.generer', { equipe: 'Maintenance', du: '2026-12-07', au: '2027-01-02' });
  const crees = (g.result as { crees: number }).crees;
  assert.ok(crees > 0);
  assert.equal(apercuPublication(await domaine(KARIM), 'Maintenance', '2026-12-07', '2027-01-02').brouillons.length, crees);
});

test('manager lui-même planifié : « Mon planning » ouvert, échange proposé par un collègue accepté depuis son espace', async () => {
  const { ALLOWED_VIEWS } = await import('../shared/constants.ts');
  const { planifieLuiMeme } = await import('../client/src/components/planning/planning-vue.ts');
  const { db, run, domaine, KARIM } = await fresh();
  const MEHDI = await (async () => {
    const c = (await db.one('SELECT id FROM comptes WHERE emp_id = ?', [2])) as { id: number };
    return (await currentUser(db, { compteId: c.id, role: 'collaborateur', methode: 'demo' }))!;
  })();
  assert.ok((ALLOWED_VIEWS.manager as readonly string[]).includes('planning'));
  assert.equal((await domaine(KARIM)).emp(12)?.equipe, 'Maintenance', 'Karim, manager, est membre de l’équipe qu’il encadre');
  assert.equal(planifieLuiMeme((await domaine(KARIM)).ds, 12), false, 'pas encore planifié : pas d’entrée « Mon planning »');
  const sien = (await db.insert<Creneau>('creneaux', {
    empId: 2, jour: '2026-10-21', equipe: 'Maintenance', horaire: 'J', debut: '08:00', fin: '16:00', pause: 60, source: 'manuel', statut: 'publie', version: 1,
    publieLe: '2026-10-01T08:00:00.000Z', publiePar: 'Karim Haddad', communiqueLe: '2026-10-01', horsDelai: false, creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Karim Haddad',
  })).id;
  const p = await run(MEHDI, 'planning.echange.proposer', { creneauId: sien, partenaireId: 12 });
  const id = (p.result as { echange: number }).echange;
  // Son instantané de manager porte l'échange qu'on lui propose : l'entrée « Mon planning » s'affiche, avec sa pastille.
  const dk = await domaine(KARIM);
  assert.ok(dk.ds.echangesPoste!.some(e => e.id === id && e.partenaireId === 12 && e.statut === 'propose'));
  assert.equal(planifieLuiMeme(dk.ds, 12), true);
  await run(KARIM, 'planning.echange.accepter', { id });
  assert.equal((await db.get<{ statut: string }>('echangesPoste', id))!.statut, 'accepte');
});

test('notification push de l’échange à valider : onglet Planning d’équipe de Temps de travail, distincte de celle du collègue', async () => {
  const { chargePush } = await import('../server/src/envois-push.ts');
  const { ALLOWED_VIEWS } = await import('../shared/constants.ts');
  assert.equal(chargePush('planning.echange.valider')!.url, '/temps?onglet=planning');
  assert.equal(chargePush('planning.echange.demande')!.url, '/planning');
  assert.ok((ALLOWED_VIEWS.manager as readonly string[]).includes('temps'));
});

test('Paramètres → Planning : activation refusée sans la date de l’avis du CSE (COHERENCE), comme le badgeage', async () => {
  const { appliquerReglages, reglagesParDefaut, ReglageInvalide } = await import('../shared/reglages.ts');
  const DEFAULT_SETTINGS = reglagesParDefaut();
  assert.equal(DEFAULT_SETTINGS.planningCseLe, null);
  assert.throws(() => appliquerReglages(DEFAULT_SETTINGS, { planningActif: true }), (e: unknown) => e instanceof ReglageInvalide && /avis du CSE/.test(e.message));
  assert.throws(() => appliquerReglages(DEFAULT_SETTINGS, { planningCseLe: '2026-02-30' }), ReglageInvalide);
  const s = appliquerReglages(DEFAULT_SETTINGS, { planningActif: true, planningCseLe: '2026-10-01' });
  assert.deepEqual([s.planningActif, s.planningCseLe], [true, '2026-10-01']);
  // Module activé : la date ne s'efface plus ; désactivé, elle reste notée.
  assert.throws(() => appliquerReglages(s, { planningCseLe: '' }), ReglageInvalide);
  assert.equal(appliquerReglages(s, { planningActif: false }).planningCseLe, '2026-10-01');
});
