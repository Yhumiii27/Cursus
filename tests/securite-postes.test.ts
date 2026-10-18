// Lot 6, chantier 4, étape 1 : postes à risques particuliers et formation renforcée des CDD, intérimaires et alternants
// (t061, art. L4154-2), couverture minimale des équipes en SST et équipiers incendie (t067, art. R4224-15), entretien de
// parcours après la visite de mi-carrière (t069). Jeu de démonstration au 10 octobre 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
for (const k of ['CURSUS_MAIL_FROM', 'CURSUS_MAIL_TENANT', 'CURSUS_MAIL_CLIENT_ID', 'CURSUS_MAIL_CLIENT_SECRET']) delete process.env[k];

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull, buildSnapshot } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { recapitulatifEcheances } = await import('../server/src/relances.ts');
const { Domain } = await import('../shared/domain.ts');
const { appliquerReglages, reglagesParDefaut, ReglageInvalide } = await import('../shared/reglages.ts');
const { JOURNAL_LABEL } = await import('../shared/journal.ts');
const { controlerPoste } = await import('../shared/rules/exigences.ts');
const R = await import('../shared/rules/formation-renforcee.ts');
const C = await import('../shared/rules/couverture.ts');
const { relancesDues } = await import('../shared/rules/relances.ts');
const { obligations } = await import('../shared/rules/entretiens.ts');
const { ENTRETIEN_MI_CARRIERE, entretienMiCarriere } = await import('../shared/rules/entretien-mi-carriere.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Ligne = Record<string, any>;
type Chantier = Parameters<InstanceType<typeof Domain>['resourceStatus']>[1];

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (trace au journal comprise). */
function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const compteDe = (empId: number | null) => db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number };
  const user = (empId: number | null, role: User['role']) => currentUser(db, { compteId: compteDe(empId).id, role, methode: 'demo' })!;
  const run = (u: User, name: string, p: Record<string, unknown>) => db.tx(() => {
    const t = preparerTrace(db, name, p);
    const r = ACTIONS[name](makeCtx(db, u, loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    journaliserAction(db, t, { user: u, compte: db.get('comptes', u.compteId)!, message: o.message ?? null, result: o.result });
    return String(o.message);
  });
  const refuse = (u: User, name: string, p: Record<string, unknown>, motif: RegExp) => assert.throws(() => run(u, name, p),
    (e: unknown) => e instanceof ActionError && e.status === 400 && motif.test(e.message), `${name} devait être refusé`);
  const RH = user(null, 'rh');
  const domain = (u: User = RH) => new Domain(u.role === 'rh' && u === RH ? loadFull(db, RH) : buildSnapshot(db, u));
  const emp = (id: number, d = domain()) => d.enrich(90, !!d.ds.settings.uniquementReglementaire).find(e => e.id === id)!;
  const poste = (nom: string) => db.all<Ligne>('postes').find(p => p.nom === nom)!;
  const journal = (action: string) => db.all<Ligne>('journal').filter(l => l.action === action);
  return { db, run, refuse, user, RH, domain, emp, poste, journal };
}
const chantier = (o: Partial<Chantier>): Chantier => ({ id: 'K-TEST', nom: 'Essai', client: 'Client', lieu: 'Lyon', pays: 'FR', debut: '2026-11-02', fin: '2026-11-06', chef: 'X', habs: [], certs: [], ressources: [4], statut: 'actif', ...o });

// — t061 : postes à risques particuliers et formation renforcée —

test('formation renforcée : sans case ni formation désignée, aucun effet ; avertissement et proposition sans cochage d’office', () => {
  const { run, RH, domain, emp, poste } = fresh();
  const d = domain();
  assert.equal(d.ds.settings.formationRenforceeCode, '', 'non désignée par défaut');
  assert.ok(d.ds.referentiels.postes.every(p => !p.risquesL4154), 'aucun poste coché par défaut');
  const renforcees = (id: number) => emp(id).manquants.filter(m => m.renforcee);
  assert.deepEqual(renforcees(4), [], 'Lucas Martin (CDD) : rien de plus que le SST de la Logistique');
  assert.equal(R.avertissementRenforcee(d.ds), 'Formation renforcée non désignée : aucune exigence tant qu’elle ne l’est pas.');
  // Poste coché, formation toujours non désignée : rien n'est exigé, l'avertissement le dit.
  run(RH, 'referentiel.poste.enregistrer', { id: poste('Préparateur de commandes').id, nom: 'Préparateur de commandes', formations: [], habilitations: [], risquesL4154: true });
  assert.equal(poste('Préparateur de commandes').risquesL4154, true);
  assert.deepEqual(renforcees(4), []);
  assert.match(R.avertissementRenforcee(domain().ds)!, /non désignée : le poste à risques particuliers n’exige encore rien/);
  // Postes à examiner : suivi renforcé, exposé, habilitation SIR ou ATEX exigée ; jamais cochés d'office.
  const ref = d.ds.referentiels;
  assert.deepEqual(R.raisonsDExaminer(ref, { sir: true, expose: false, habilitations: [], risquesL4154: false }), ['suivi individuel renforcé']);
  assert.deepEqual(R.raisonsDExaminer(ref, { sir: false, expose: false, habilitations: ['atex'], risquesL4154: false }), ['habilitation exigée : Habilitation ATEX']);
  assert.deepEqual(R.raisonsDExaminer(ref, { sir: true, expose: true, habilitations: ['atex'], risquesL4154: true }), [], 'déjà coché : rien à proposer');
  assert.equal(controlerPoste({ nom: 'Soudeur' }, ref).poste!.risquesL4154, false, 'décoché par défaut');
});

test('formation renforcée : exigée des CDD, intérimaires et alternants du poste coché, depuis l’entrée ; Non conforme et échéance', () => {
  const { run, RH, domain, emp, poste, journal } = fresh();
  run(RH, 'parametres.maj', { formationRenforceeCode: 'PRAP' });
  assert.equal(domain().ds.settings.formationRenforceeCode, 'prap', 'code ramené en minuscules');
  assert.equal(R.avertissementRenforcee(domain().ds), null);
  // Opératrice : Léa Girard (intérim, entrée le 15 juin 2026, PRAP du 5 mars 2026) et Marion Petit (CDI).
  const msg = run(RH, 'referentiel.poste.enregistrer', { id: poste('Opératrice').id, nom: 'Opératrice', formations: [], habilitations: [], risquesL4154: true });
  assert.match(msg, /1 salarié devient non conforme : Léa Girard \(PRAP\)/, 'annoncé au message, comme toute exigence');
  const lea = emp(15);
  assert.deepEqual(lea.manquants.map(m => [m.id, m.renforcee, m.depuis]), [['prap', true, '2026-06-15']], 'la PRAP d’avant l’entrée ne compte pas');
  assert.equal(lea.worst, 'exp');
  assert.deepEqual(emp(13).manquants, [], 'Marion Petit (CDI) : non concernée');
  const ech = domain().echeances(domain().enrich(90, false), 90).filter(x => x.kind === 'exigence' && x.emp.id === 15);
  assert.deepEqual(ech.map(x => [x.statut, x.kindLabel, x.action?.label]), [['Formation renforcée non suivie', 'Exigence du contrat Intérim sur poste à risques (art. L4154-2)', 'Inscrire à la formation']]);
  // Filtre « réglementaires uniquement » : la PRAP (recommandée) reste exigée comme formation renforcée.
  run(RH, 'parametres.maj', { uniquementReglementaire: true });
  assert.equal(emp(15).manquants.length, 1);
  // Certification obtenue depuis l'entrée : exigence remplie.
  run(RH, 'cert.ajouter', { empId: 15, f: 'prap', date: '2026-10-01' });
  assert.deepEqual(emp(15).manquants, []);
  // Journal : la case, avant et après, et son libellé.
  const l = journal('referentiel.poste.enregistrer').at(-1)!;
  assert.deepEqual([l.payload.avant.risquesL4154, l.payload.apres.risquesL4154], [false, true]);
  assert.ok(JOURNAL_LABEL['referentiel.poste.enregistrer']);
});

test('formation renforcée : No Go CERTIFICATION, réserve si une session est planifiée avant le démarrage ; paie sans l’exigence', () => {
  const { db, run, RH, domain, emp, poste, user } = fresh();
  run(RH, 'parametres.maj', { formationRenforceeCode: 'prap' });
  run(RH, 'referentiel.poste.enregistrer', { id: poste('Préparateur de commandes').id, nom: 'Préparateur de commandes', formations: [], habilitations: [], risquesL4154: true });
  const d = domain(), lucas = emp(4, d);
  const r = d.resourceStatus(lucas, chantier({}), []);
  assert.equal(r.status, 'nogo');
  assert.deepEqual(r.reasons.map(x => [x.level, x.code, x.minimal]), [['nogo', 'CERTIFICATION', 'Formation renforcée à la sécurité non suivie']]);
  // Session de PRAP planifiée avant le démarrage : réserve ; après, toujours No Go.
  run(RH, 'session.creer', { f: 'prap', date: '2026-10-20', lieu: 'Salle 2', places: 6 });
  const s = db.all<Ligne>('sessions').find(x => x.formation === 'prap' && x.date === '2026-10-20')!;
  db.insert('inscriptions', { empId: 4, sessionId: s.id, convoc: 'later', date: '2026-10-10', convocLe: null });
  const d2 = domain();
  assert.deepEqual(d2.resourceStatus(emp(4, d2), chantier({}), []).reasons.map(x => [x.level, x.minimal]), [['reserve', 'Formation renforcée planifiée avant le démarrage']]);
  assert.equal(d2.resourceStatus(emp(4, d2), chantier({ debut: '2026-10-15', fin: '2026-10-30' }), []).status, 'nogo');
  // Profil paie : ni titres ni exigences, donc ni la case du poste.
  const paie = buildSnapshot(db, user(7, 'rh'));
  assert.ok(paie.referentiels.postes.every(p => !p.risquesL4154));
  assert.deepEqual(new Domain(paie).enrich(90, false).find(e => e.id === 4)!.manquants, []);
});

test('réglage de la formation renforcée : code contrôlé, sans lecture du catalogue', () => {
  const s = reglagesParDefaut();
  assert.equal(appliquerReglages(s, { formationRenforceeCode: ' SST ' }).formationRenforceeCode, 'sst');
  assert.equal(appliquerReglages(s, { formationRenforceeCode: '' }).formationRenforceeCode, '');
  assert.throws(() => appliquerReglages(s, { formationRenforceeCode: 'accueil sécurité' }), ReglageInvalide);
  // Code inconnu ou archivé : sans effet, annoncé.
  assert.match(R.avertissementRenforcee({ referentiels: { formations: [], postes: [] }, settings: { formationRenforceeCode: 'inconnue' } })!, /« inconnue » absente du catalogue ou archivée/);
});

// — t067 : couverture minimale des équipes —

test('couverture : aucun seuil par défaut ; démonstration Production, manque daté aux expirations', () => {
  const { domain } = fresh();
  const ds = domain().ds;
  assert.deepEqual(C.etatsCouverture({ ...ds, referentiels: { ...ds.referentiels, equipes: ds.referentiels.equipes.map(q => ({ ...q, couverture: null })) } }, 90), [], 'sans seuil, rien');
  const [p] = C.etatsCouverture(ds, 90);
  assert.equal(p.equipe, 'Production');
  assert.equal(p.compte, 5);
  // Marion Petit valide jusqu'au 30 octobre, Sophie Lemaire jusqu'au 2 décembre : 3 sur 4 le 3 décembre.
  assert.deepEqual(p.manque && [p.manque.le, p.manque.compte, p.manque.jusquau], ['2026-12-03', 3, null]);
  assert.deepEqual(p.manque!.causes.map(c => [c.type, c.empId, c.le]), [['expiration', 3, '2026-12-02'], ['expiration', 13, '2026-10-30']]);
  assert.equal(C.causesTexte(p.manque!.causes), 'Sophie Lemaire (certification valide jusqu’au 2 déc. 2026) · Marion Petit (certification valide jusqu’au 30 oct. 2026)');
  assert.equal(C.couvertureTexte(p, 'SST', ds.today), 'SST : 3 sur 4 minimum le 3 déc. 2026');
  // Horizon plus court : pas encore de manque.
  assert.equal(C.etatsCouverture(ds, 30)[0].manque, null);
});

test('couverture : absence, sortie, entrée à venir et titulaires trop peu nombreux ; jours limites', () => {
  const { domain } = fresh();
  // Sans les congés de Julien Moreau (du 12 au 16 octobre dans la démonstration), remplacés ci-dessous par un arrêt.
  const demo = domain().ds, base = { ...demo, absences: demo.absences.filter(a => a.empId !== 8) };
  const prod = (min: number) => ({ ...base.referentiels, equipes: base.referentiels.equipes.map(q => (q.nom === 'Production' ? { ...q, couverture: [{ formation: 'sst', min }] } : q)) });
  const abs = (empId: number, du: string, au: string, statut = 'validee') => ({ id: 900 + empId, empId, type: 'MALADIE', du, au, statut }) as never;
  // Seuil 5 : Julien Moreau absent du 12 au 16 octobre (arrêt validé), manque du 12 au 16, puis de nouveau au 30 octobre.
  const ds = { ...base, referentiels: prod(5), absences: [...base.absences, abs(8, '2026-10-12', '2026-10-16')] };
  const [x] = C.etatsCouverture(ds, 90);
  assert.deepEqual([x.compte, x.manque!.le, x.manque!.jusquau, x.manque!.causes.map(c => c.type)], [5, '2026-10-12', '2026-10-16', ['absence']]);
  assert.equal(C.causesTexte(x.manque!.causes), 'Julien Moreau (absent)');
  // Demande en attente : elle ne retire personne.
  assert.equal(C.etatsCouverture({ ...ds, absences: [...base.absences, abs(8, '2026-10-12', '2026-10-16', 'demandee')] }, 90)[0].manque!.le, '2026-10-31');
  // Sortie : dernier jour le 20 octobre, absent du compte le 21.
  const sortie = { ...base, referentiels: prod(5), employes: base.employes.map(e => (e.id === 22 ? { ...e, fin: '2026-10-20' } : e)) };
  const y = C.etatsCouverture(sortie, 90)[0].manque!;
  assert.deepEqual([y.le, y.causes.map(c => [c.type, c.le])], ['2026-10-21', [['sortie', '2026-10-20']]]);
  // Membre qui entre le 1er novembre, SST à jour : compté à partir de ce jour seulement.
  const entree = { ...base, referentiels: prod(6), employes: base.employes.map(e => (e.id === 22 ? { ...e, entree: '2026-11-01' } : e)) };
  assert.deepEqual([C.etatsCouverture(entree, 90)[0].compte, C.etatsCouverture(entree, 90)[0].manque!.le], [4, '2026-10-10']);
  // Minimum jamais atteignable : manque aujourd'hui, titulaires trop peu nombreux, sans fin dans l'horizon.
  const z = C.etatsCouverture({ ...base, referentiels: prod(6) }, 90)[0];
  assert.deepEqual([z.manque!.le, z.manque!.jusquau, C.causesTexte(z.manque!.causes)], ['2026-10-10', null, 'titulaires trop peu nombreux']);
  assert.ok(C.manqueImmediat(z, base.today));
  // Formation archivée : plus suivie.
  const archivee = { ...base, referentiels: { ...prod(4), formations: base.referentiels.formations.map(f => (f.id === 'sst' ? { ...f, archive: '2026-10-01' } : f)) } };
  assert.deepEqual(C.etatsCouverture(archivee, 90), []);
});

test('couverture : saisie contrôlée avec les exigences de l’équipe, journal en codes et nombres', () => {
  const { db, run, refuse, RH, journal } = fresh();
  refuse(RH, 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: [], habilitations: [], couverture: [{ formation: 'sst', min: 9 }] }, /un nombre entier de 1 à 5 \(5 membres présents\)/);
  refuse(RH, 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: [], habilitations: [], couverture: [{ formation: 'inconnue', min: 1 }] }, /formation inconnue ou archivée/);
  refuse(RH, 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: [], habilitations: [], couverture: [{ formation: 'sst', min: 1 }, { formation: 'sst', min: 2 }] }, /SST figure deux fois/);
  refuse(RH, 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: [], habilitations: [], couverture: [{ formation: '', min: 1 }] }, /choisissez la formation/);
  const msg = run(RH, 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: [], habilitations: [], couverture: [{ formation: 'SST', min: 2 }, { formation: 'epi', min: 1 }] });
  assert.match(msg, /couverture minimale : 2 titulaires SST, 1 titulaire EPI incendie/);
  assert.deepEqual(db.get<Ligne>('equipes', 'Maintenance')!.couverture, [{ formation: 'sst', min: 2 }, { formation: 'epi', min: 1 }]);
  const l = journal('referentiel.equipe.exigences').at(-1)!;
  assert.deepEqual([l.payload.couvertureAvant, l.payload.couverture], [[], [{ formation: 'sst', min: 2 }, { formation: 'epi', min: 1 }]]);
  // Sans `couverture` : inchangée ; liste vide : retirée.
  run(RH, 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: [], habilitations: [] });
  assert.equal(db.get<Ligne>('equipes', 'Maintenance')!.couverture.length, 2);
  assert.match(run(RH, 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: [], habilitations: [], couverture: [] }), /couverture minimale retirée/);
  assert.equal(db.get<Ligne>('equipes', 'Maintenance')!.couverture, null);
  // Contrôle partagé : équipe vide, 1 au plus ; formation archivée déjà suivie, gardée.
  const ref = { formations: [{ id: 'sst', court: 'SST', archive: '2026-10-01' }] } as never;
  assert.equal(C.controlerCouverture([{ formation: 'sst', min: 1 }], ref, 0, [{ formation: 'sst', min: 1 }]).erreur, null);
  assert.match(C.controlerCouverture([{ formation: 'sst', min: 1 }], ref, 0).erreur!, /archivée/);
  assert.deepEqual(C.lignesCouverture([{ formation: 'SST', min: 2 }, { formation: '<b>', min: 1 }, 'x', { formation: 'epi', min: 1.5 }]), [{ formation: 'sst', min: 2 }]);
});

test('couverture : transmise par le serveur, par équipe encadrée pour le manager, sans nom d’absent pour le référent HSE', () => {
  const { db, user } = fresh();
  db.update('equipes', 'Maintenance', { couverture: [{ formation: 'sst', min: 4 }] });
  // Absence validée de Mehdi Benali (Maintenance) dans l'horizon.
  db.insert('absences', { empId: 2, type: 'MALADIE', du: '2026-10-20', au: '2026-10-22', statut: 'validee', keystone: false, signaleLe: null, signalePar: null, signaleParInteresse: false, justificatif: false, justificatifLe: null, finInitiale: null, annuleeLe: null, annuleePar: null });
  const rh = buildSnapshot(db, user(null, 'rh')).couverture!;
  assert.deepEqual(rh.map(x => x.equipe), ['Maintenance', 'Production']);
  // Maintenance : Bastien Morel, Mehdi Benali, Karim Haddad et Romain Chevalier ont le SST ; Thomas Garnier non.
  const m = rh.find(x => x.equipe === 'Maintenance')!;
  assert.deepEqual([m.compte, m.manque!.le, m.manque!.causes.map(c => [c.type, c.nom])], [4, '2026-10-20', [['absence', 'Mehdi Benali']]]);
  // Manager de la Maintenance : son équipe seule ; collaborateur : rien.
  assert.deepEqual(buildSnapshot(db, user(12, 'manager')).couverture!.map(x => x.equipe), ['Maintenance']);
  assert.deepEqual(buildSnapshot(db, user(2, 'collaborateur')).couverture, []);
  // Référent HSE : toutes les équipes, l'absent sans son nom ; lecture seule : avec ; paie : rien, ni les seuils.
  const hse = buildSnapshot(db, user(23, 'rh')).couverture!.find(x => x.equipe === 'Maintenance')!;
  assert.deepEqual(hse.manque!.causes, [{ type: 'absence', empId: null, nom: null, le: null }]);
  assert.equal(C.causesTexte(hse.manque!.causes), 'un membre (absent)');
  assert.equal(buildSnapshot(db, user(11, 'rh')).couverture!.find(x => x.equipe === 'Maintenance')!.manque!.causes[0].nom, 'Mehdi Benali');
  const paie = buildSnapshot(db, user(7, 'rh'));
  assert.deepEqual(paie.couverture, []);
  assert.ok(paie.referentiels.equipes.every(q => !q.couverture));
});

test('couverture : relancée au récapitulatif du service RH, du manager de l’équipe et du référent HSE, sans nom', () => {
  const { db, run, RH, domain } = fresh();
  const d = domain();
  const r = relancesDues(d, d.enrich(90, false), [90, 30, 7]).filter(x => x.categorie === 'couverture');
  assert.deepEqual(r.map(x => [x.cle, x.equipe, x.empId, x.palier, x.libelle]), [['couverture:Production:sst:2026-12-03', 'Production', 0, '90', 'Couverture SST : 3 sur 4 minimum']]);
  run(RH, 'messagerie.regler', { rh: 'rh@entreprise.example' });
  db.tx(() => recapitulatifEcheances(db));
  const textes = db.all<Ligne>('envois').filter(x => x.type === 'echeances.recapitulatif').map(e => [e.contenu.a[0], e.contenu.texte as string]);
  const avec = textes.filter(([, t]) => t.includes('Équipe Production — Couverture SST : 3 sur 4 minimum : à partir du 3 déc. 2026')).map(([a]) => a);
  // Service RH, Sophie Lemaire (manager de la Production) et Sarah Cohen (référente HSE) ; pas le manager de la Maintenance.
  assert.equal(avec.length, 3);
  assert.ok(avec.includes('rh@entreprise.example'));
  const karim = db.get<Ligne>('employes', 12)!.email;
  assert.ok(!avec.includes(karim));
});

// — t069 : entretien de parcours après la visite de mi-carrière —

test('mi-carrière : rien sans visite ; entretien dû 2 mois après la visite, avancé, rempli par un entretien de parcours', () => {
  const { db, run, RH, domain } = fresh();
  const epp = (id: number, d = domain()) => obligations(d, [id]).find(o => o.kind === 'epp')!;
  // Thomas Garnier (Maintenance) : entretien de parcours périodique.
  const avant = epp(6);
  assert.equal(avant.libelle, undefined);
  assert.equal(entretienMiCarriere(domain().ds, { id: 6 }), null, 'aucune visite de mi-carrière : rien');
  db.insert('demandesVisite', { empId: 6, motif: 'mi_carriere', le: '2026-09-01', par: 'RH', statut: 'realisee', closeLe: '2026-09-15', closePar: 'RH' });
  const o = epp(6);
  assert.deepEqual([o.due, o.libelle, o.detail], ['2026-11-15', ENTRETIEN_MI_CARRIERE, 'Visite de mi-carrière du 15 sept. 2026 — entretien de mi-carrière à planifier avant le 15 nov. 2026']);
  assert.equal(o.st, 'soon');
  // Délai réglé à 1 mois : dû le 15 octobre ; suivi désactivé : l'échéance périodique revient.
  run(RH, 'parametres.maj', { entretienMiCarriereMois: 1 });
  assert.equal(epp(6).due, '2026-10-15');
  run(RH, 'parametres.maj', { entretienMiCarriereActif: false });
  assert.deepEqual(epp(6).due, avant.due);
  run(RH, 'parametres.maj', { entretienMiCarriereActif: true, entretienMiCarriereMois: 2 });
  // Entretien de parcours réalisé depuis la visite : rempli, la périodicité repart de lui.
  db.insert('entretiens', { empId: 6, type: 'epp', date: '2026-10-01', statut: 'realise', cr: {}, info: false, signSal: null, signMgr: null });
  assert.deepEqual([epp(6).due, epp(6).libelle], ['2030-10-01', undefined]);
  // Sans cet entretien, l'échéance de mi-carrière revient (2 mois après la visite).
  assert.equal(entretienMiCarriere({ ...domain().ds, entretiens: [] }, { id: 6 })!.due, '2026-11-15');
  assert.equal(appliquerReglages(reglagesParDefaut(), { entretienMiCarriereMois: 40 }).entretienMiCarriereMois, 12);
});

test('mi-carrière : le manager et la lecture seule reçoivent l’échéance, jamais la visite', () => {
  const { db, user, domain } = fresh();
  db.insert('demandesVisite', { empId: 6, motif: 'mi_carriere', le: '2026-09-01', par: 'RH', statut: 'realisee', closeLe: '2026-09-15', closePar: 'RH' });
  const mgr = buildSnapshot(db, user(12, 'manager'));
  const thomas = mgr.employes.find(e => e.id === 6)!;
  assert.equal(thomas.entretienMiCarriere, '2026-11-15');
  assert.deepEqual(mgr.demandesVisite.filter(x => x.empId === 6), []);
  const o = obligations(new Domain(mgr), [6]).find(x => x.kind === 'epp')!;
  assert.deepEqual([o.due, o.libelle, o.detail], ['2026-11-15', ENTRETIEN_MI_CARRIERE, 'entretien de mi-carrière à planifier avant le 15 nov. 2026']);
  assert.ok(!/visite/i.test(o.detail));
  // Autres membres : null ; le manager lui-même (sa fiche, ses visites) : calculé sur son instantané.
  assert.equal(mgr.employes.find(e => e.id === 2)!.entretienMiCarriere, null);
  assert.equal(mgr.employes.find(e => e.id === 12)!.entretienMiCarriere, undefined);
  assert.equal(buildSnapshot(db, user(11, 'rh')).employes.find(e => e.id === 6)!.entretienMiCarriere, '2026-11-15');
  assert.equal(buildSnapshot(db, user(23, 'rh')).employes.find(e => e.id === 6)!.entretienMiCarriere, null);
  // Service RH : calculé sur l'instantané complet, avec la visite.
  assert.equal(domain().ds.employes.find(e => e.id === 6)!.entretienMiCarriere, undefined);
});
