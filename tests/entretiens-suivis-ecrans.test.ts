// Tests : entretiens suivis, étape 2 (lot 12, chantier C3, t194) — ce que les écrans, les rappels et les indicateurs
// calculent (shared/rules/objectifs-suivi.ts), l'« À faire » du collaborateur (shared/rules/a-faire.ts), le récapitulatif
// des échéances (shared/rules/relances.ts), le compte rendu imprimé (client/src/dialogs/compteRendu-suivi.ts), l'adresse
// de l'écran Entretiens (client/src/state/url.ts) et la vue « Mes objectifs ».
// Jeu de démonstration au 10 octobre 2026 : Mehdi Benali (2), Maintenance ; Karim Haddad (12) encadre la Maintenance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
delete process.env.CURSUS_DEMO;

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ALLOWED_VIEWS } = await import('../shared/constants.ts');
const { Domain } = await import('../shared/domain.ts');
const { aFaireCollaborateur } = await import('../shared/rules/a-faire.ts');
const { relancesDues } = await import('../shared/rules/relances.ts');
const O = await import('../shared/rules/objectifs-suivi.ts');
const { sectionsSuivi } = await import('../client/src/dialogs/compteRendu-suivi.ts');
const { statutEntretien } = await import('../shared/rules/remise.ts');
const R = await import('../shared/rules/objectifs.ts');
const { adresse, lireUrl } = await import('../client/src/state/url.ts');
type Objectif = import('../shared/types.ts').Objectif;
type Entretien = import('../shared/types.ts').Entretien;
type Dataset = import('../shared/types.ts').Dataset;
type Compte = import('../server/src/comptes.ts').Compte;

const TODAY = '2026-10-10';
const obj = (o: Partial<Objectif>): Objectif => ({
  id: 1, empId: 2, entretienId: 10, evalueEntretienId: null, reconduitDe: null, libelle: 'Réduire les arrêts de ligne', mesure: null, categorie: 'individuel',
  poids: null, echeance: '2026-10-31', avancement: 20, statut: 'ouvert', evaluation: null, commentaireSal: null, creeLe: '2026-01-15T09:00:00.000Z', creePar: '',
  modifieLe: null, modifiePar: null, ajusteLe: null, ajusteMotif: null, libelleInitial: null, ...o,
});
const ent = (o: Partial<Entretien>): Entretien => ({ id: 10, empId: 2, type: 'annuel', date: '2026-01-15', statut: 'realise', cr: {}, info: false, signSal: null, signMgr: null, ...o });

test('rappel : objectif en cours, à échéance, sans mise à jour depuis 30 jours ; jamais un objectif d’un entretien planifié', () => {
  const entretiens = [ent({ id: 10 }), ent({ id: 11, statut: 'planifie', date: '2026-10-20' })];
  const liste = [
    obj({ id: 1 }),
    obj({ id: 2, modifieLe: '2026-10-01T08:00:00.000Z' }), // mis à jour il y a 9 jours
    obj({ id: 3, avancement: 100 }), // atteint à 100 %
    obj({ id: 4, echeance: null }), // sans échéance
    obj({ id: 5, entretienId: 11 }), // fixé à un entretien encore planifié
    obj({ id: 6, statut: 'atteint' }),
    obj({ id: 7, echeance: '2027-03-31' }), // lointaine : hors de l'« À faire », mais relancée par paliers
    obj({ id: 8, echeance: '2026-09-30', modifieLe: '2026-09-10T08:00:00.000Z' }), // dépassée, dernière mise à jour il y a 30 jours
  ];
  assert.deepEqual(O.objectifsSansMiseAJour(liste, entretiens, TODAY).map(o => o.id), [8, 1, 7]);
  assert.deepEqual(O.objectifsAMettreAJour(liste, entretiens, 2, TODAY).map(o => o.id), [8, 1]);
  assert.deepEqual(O.objectifsAMettreAJour(liste, entretiens, 3, TODAY), [], 'les objectifs d’un autre salarié');
  assert.equal(O.derniereMiseAJour(obj({ modifieLe: '2026-10-01T23:30:00.000Z' })), '2026-10-01');
});

test('à arbitrer : entretiens planifiés du périmètre avec souhaits sans avis ou propositions du salarié', () => {
  const souhait = { cle: 's1', f: 'sst', libelle: null, priorite: 'normale' as const, objectifId: null, auteur: 'sal' as const, avis: null, demandeId: null, verseLe: null, nonVerse: null };
  const entretiens = [
    ent({ id: 20, statut: 'planifie', date: '2026-10-20', souhaits: [souhait] }),
    ent({ id: 21, empId: 3, statut: 'planifie', date: '2026-10-18' }),
    ent({ id: 22, empId: 4, statut: 'planifie', date: '2026-10-22', souhaits: [{ ...souhait, avis: 'favorable' }] }),
    ent({ id: 23, empId: 5, statut: 'planifie', date: '2026-10-25', souhaits: [souhait] }), // hors du périmètre
  ];
  const objectifs = [obj({ id: 1, empId: 3, entretienId: 21, statut: 'propose' }), obj({ id: 2, empId: 3, entretienId: 21 })];
  const a = O.aArbitrer(entretiens, objectifs, new Set([2, 3, 4]));
  assert.deepEqual(a.map(x => [x.entretien.id, x.souhaits, x.propositions]), [[21, 0, 1], [20, 1, 0]]);
});

test('indicateurs : taux d’objectifs fixés et évalués, résultats masqués sous 3 salariés, souhaits versés, acceptés, réalisés', () => {
  // Annuels 2025 (objectifs à évaluer en 2026) et annuels 2026 (objectifs fixés, évaluations des objectifs 2025).
  const entretiens: Entretien[] = [
    ent({ id: 1, empId: 1, date: '2025-11-10' }), ent({ id: 2, empId: 2, date: '2025-11-12' }), ent({ id: 3, empId: 3, date: '2025-11-14' }),
    ent({ id: 4, empId: 4, date: '2025-11-15' }),
    ent({ id: 11, empId: 1, date: '2026-10-01' }), ent({ id: 12, empId: 2, date: '2026-10-02' }), ent({ id: 13, empId: 3, date: '2026-10-03' }),
    ent({ id: 14, empId: 4, date: '2026-10-04', souhaits: [
      { cle: 's1', f: 'sst', libelle: null, priorite: 'haute', objectifId: null, auteur: 'sal', avis: 'favorable', demandeId: 50, verseLe: '2026-10-04', nonVerse: null },
      { cle: 's2', f: null, libelle: 'Anglais', priorite: 'basse', objectifId: null, auteur: 'sal', avis: 'favorable', demandeId: 51, verseLe: '2026-10-04', nonVerse: null },
      { cle: 's3', f: 'caces', libelle: null, priorite: 'normale', objectifId: null, auteur: 'mgr', avis: 'favorable', demandeId: 49, verseLe: '2026-10-04', nonVerse: 'deja_demande' },
      { cle: 's4', f: null, libelle: 'Excel', priorite: 'normale', objectifId: null, auteur: 'sal', avis: 'defavorable', demandeId: null, verseLe: null, nonVerse: null },
    ] }),
  ];
  const objectifs: Objectif[] = [
    // Période précédente : 4 objectifs, 3 évalués à un entretien 2026, dont 2 dans l'équipe A (2 salariés : masquée).
    obj({ id: 1, empId: 1, entretienId: 1, statut: 'atteint', evalueEntretienId: 11 }),
    obj({ id: 2, empId: 2, entretienId: 2, statut: 'partiel', evalueEntretienId: 12 }),
    obj({ id: 3, empId: 3, entretienId: 3, statut: 'non_atteint', evalueEntretienId: 13 }),
    obj({ id: 4, empId: 4, entretienId: 4 }),
    // Fixés en 2026 à deux des quatre annuels (une proposition ne compte pas).
    obj({ id: 5, empId: 1, entretienId: 11 }), obj({ id: 6, empId: 2, entretienId: 12 }), obj({ id: 7, empId: 3, entretienId: 13, statut: 'propose' }),
  ];
  const src = {
    entretiens, objectifs,
    employes: [{ id: 1, equipe: 'A' }, { id: 2, equipe: 'A' }, { id: 3, equipe: 'B' }, { id: 4, equipe: 'B' }],
    demandesCollab: [
      { id: 50, statut: 'acceptee', suite: { planId: 7 } }, { id: 51, statut: 'acceptee', suite: { sessionId: 9 } },
    ] as unknown as Dataset['demandesCollab'],
    plan: [{ id: 7, statut: 'prevu' as const }], sessions: [{ id: 9, statut: 'Clôturée' as const }],
  };
  const x = O.indicateursSuivi(src, new Set([1, 2, 3, 4]), 2026);
  assert.equal(x.annuels, 4);
  assert.equal(x.annuelsAvecObjectifs, 2);
  assert.equal(O.taux(x.annuelsAvecObjectifs, x.annuels), 50);
  assert.deepEqual([x.aEvaluer, x.evalues], [4, 3]);
  // Équipe A : 2 salariés évalués, sous le seuil de 3 → masquée ; avec un seuil de 2, ses résultats apparaissent.
  assert.deepEqual(x.resultats.map(r => [r.equipe, !!r.masque]), [['A', true], ['B', true]]);
  const y = O.indicateursSuivi(src, new Set([1, 2, 3, 4]), 2026, 2);
  assert.deepEqual(y.resultats[0], { equipe: 'A', salaries: 2, resultats: { atteint: 1, partiel: 1, non_atteint: 0, sans_objet: 0, reconduit: 0 } });
  assert.equal(y.resultats[1].masque, true, 'équipe B : un seul salarié évalué');
  assert.deepEqual(x.souhaits, { exprimes: 4, favorables: 3, verses: 2, acceptes: 2, realises: 1 });
  assert.equal(O.taux(0, 0), null);
  // Plan & budget : demandes versées de l'exercice et lignes du plan d'origine « entretien ».
  assert.deepEqual(O.souhaitsVersesDeLExercice({
    demandesCollab: [{ type: 'formation', entretienId: 14, date: '2026-10-04', statut: 'acceptee' }, { type: 'formation', entretienId: null, date: '2026-10-04', statut: 'acceptee' },
      { type: 'formation', entretienId: 3, date: '2025-11-14', statut: 'attente' }] as unknown as Dataset['demandesCollab'],
    plan: [{ exercice: 2026, origine: 'entretien' }, { exercice: 2026, origine: 'demande' }, { exercice: 2025, origine: 'entretien' }],
  }, 2026), { versees: 1, acceptees: 1, lignesPlan: 1 });
});

// — Sur le jeu de démonstration —

async function domaine() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compte = (await db.one<Compte>('SELECT * FROM comptes WHERE emp_id IS NULL'))!;
  const rh = (await currentUser(db, { compteId: compte.id, role: 'rh', methode: 'demo' }))!;
  return await loadFull(db, rh);
}

test('« À faire » du collaborateur et récapitulatif des échéances : objectifs sans mise à jour, sans leur texte', async () => {
  const base = await domaine();
  const clos = ent({ id: 9001, empId: 2, date: '2026-01-15' });
  const full = { ...base, entretiens: [...base.entretiens, clos] } as Dataset;
  full.objectifs = [obj({ id: 501, entretienId: clos.id, echeance: '2026-10-31', libelle: 'Texte confidentiel de l’objectif' }), obj({ id: 502, entretienId: clos.id, echeance: '2026-10-31', modifieLe: '2026-10-05T08:00:00.000Z' })];
  const d = new Domain(full);
  assert.deepEqual(aFaireCollaborateur(d, 2).objectifs.map(o => o.id), [501]);
  const r = relancesDues(d, d.enrich(full.settings.horizonAlerte, full.settings.uniquementReglementaire), [90, 30, 7]).filter(x => x.categorie === 'objectif');
  assert.deepEqual(r.map(x => [x.cle, x.palier, x.empId, x.sante]), [['objectif:501:2026-10-31', '30', 2, false]]);
  assert.equal(r[0].libelle, 'Objectif à échéance, avancement à mettre à jour');
  assert.doesNotMatch(JSON.stringify(r), /confidentiel/);
  // Réglage objectifsActifs éteint : rien n'est rappelé.
  const eteint = new Domain({ ...full, settings: { ...full.settings, objectifsActifs: false } });
  assert.deepEqual(aFaireCollaborateur(eteint, 2).objectifs, []);
  assert.equal(relancesDues(eteint, eteint.enrich(90, false), [90, 30, 7]).filter(x => x.categorie === 'objectif').length, 0);
});

test('point de suivi : signature du salarié facultative, jamais dans l’« À faire »', async () => {
  const base = await domaine();
  const full = { ...base, entretiens: [...base.entretiens] } as Dataset;
  full.entretiens.push(ent({ id: 9002, empId: 2, type: 'point', date: '2026-10-05', signMgr: '2026-10-05' }), ent({ id: 9003, empId: 2, type: 'mi_annee', date: '2026-06-05', signMgr: '2026-06-05' }));
  const ids = aFaireCollaborateur(new Domain(full), 2).comptesRendus.map(x => x.id);
  assert.ok(!ids.includes(9002), 'point de suivi');
  assert.ok(ids.includes(9003), 'le point de mi-année se signe');
});

test('compte rendu imprimé : objectifs repris et évalués, objectifs fixés, souhaits avec avis et suite', async () => {
  const base = await domaine();
  const full = { ...base, entretiens: [...base.entretiens] } as Dataset;
  full.entretiens.push(ent({ id: 9010, empId: 2, date: '2025-11-10' }), ent({
    id: 9011, empId: 2, date: '2026-10-20', statut: 'planifie',
    souhaits: [{ cle: 's1', f: null, libelle: 'Anglais technique', priorite: 'haute', objectifId: null, auteur: 'sal', avis: 'favorable', demandeId: null, verseLe: null, nonVerse: null }],
  }), ent({ id: 9012, empId: 2, type: 'epp', date: '2026-09-01' }), ent({ id: 9013, empId: 2, type: 'mi_annee', date: '2026-06-01' }));
  full.objectifs = [
    obj({ id: 1, entretienId: 9010, statut: 'atteint', evalueEntretienId: 9011, evaluation: 'Très bon suivi' }),
    obj({ id: 2, entretienId: 9010, libelle: 'Former deux apprentis' }),
    obj({ id: 3, entretienId: 9011, libelle: 'Nouvel objectif', poids: 40, categorie: 'collectif' }),
  ];
  const d = new Domain(full);
  const s = sectionsSuivi(d, d.ds.entretiens.find(x => x.id === 9011)!);
  assert.deepEqual(s.map(x => x.title), ['Objectifs de la période précédente · Évaluateur', 'Objectifs fixés pour la période à venir', 'Souhaits de formation']);
  assert.deepEqual(s[0].table!.rows.map(r => [r[0], r[2], r[3]]), [['Réduire les arrêts de ligne', 'Atteint', 'Très bon suivi'], ['Former deux apprentis', 'Non évalué', '']]);
  assert.deepEqual(s[1].table!.rows[0].slice(0, 3), ['Nouvel objectif', 'Collectif', '40 %']);
  assert.deepEqual(s[2].table!.rows[0], ['Anglais technique', 'Salarié', 'Haute', 'Favorable', 'Versé à la clôture']);
  // Parcours professionnel : jamais d'objectif (art. L6315-1), seulement les souhaits.
  assert.deepEqual(sectionsSuivi(d, d.ds.entretiens.find(x => x.id === 9012)!).map(x => x.title), ['Souhaits de formation']);
  // Point de mi-année : objectifs en cours (l'objectif 2), sans évaluation.
  const mi = sectionsSuivi(d, d.ds.entretiens.find(x => x.id === 9013)!);
  assert.equal(mi[0].title, 'Objectifs en cours');
  assert.deepEqual(mi[0].table!.rows.map(r => r[0]), ['Former deux apprentis']);
});

test('compte rendu imprimé d’un annuel clos : ses seuls objectifs, même quand l’annuel suivant est clos, même réglage coupé', async () => {
  const base = await domaine();
  const full = { ...base, entretiens: [...base.entretiens] } as Dataset;
  // Annuel 2025 (O10 fixé), annuel 2026 clos (O10 évalué atteint, O20 fixé, en cours), annuel 2027 planifié.
  full.entretiens.push(ent({ id: 9101, empId: 2, date: '2025-11-10', cr: {} }), ent({ id: 9102, empId: 2, date: '2026-10-02' }),
    ent({ id: 9103, empId: 2, date: '2027-10-02', statut: 'planifie' }));
  full.objectifs = [
    obj({ id: 10, entretienId: 9101, libelle: 'O10', statut: 'atteint', evalueEntretienId: 9102, evaluation: 'Bien' }),
    obj({ id: 20, entretienId: 9102, libelle: 'O20' }),
  ];
  const d = new Domain(full);
  const x = (id: number) => d.ds.entretiens.find(y => y.id === id)!;
  // Sections des objectifs seulement (celle des souhaits de formation suit son propre réglage).
  const objs = (dd: typeof d, id: number) => sectionsSuivi(dd, x(id)).filter(y => y.title.startsWith('Objectifs'));
  const titres = (id: number) => objs(d, id).map(y => y.title);
  // 2025 : O10 fixé ; rien de la période précédente (O20 vient d'un annuel postérieur).
  assert.deepEqual(titres(9101), ['Objectifs fixés pour la période à venir']);
  assert.deepEqual(objs(d, 9101)[0].table!.rows.map(r => r[0]), ['O10']);
  assert.deepEqual(R.objectifsARevoir(d.ds.objectifs!, d.ds.entretiens, x(9101)), []);
  // 2026 : O10 évalué à cet entretien, O20 fixé.
  const n = objs(d, 9102);
  assert.deepEqual(n.map(y => y.title), ['Objectifs de la période précédente · Évaluateur', 'Objectifs fixés pour la période à venir']);
  assert.deepEqual([n[0].table!.rows.map(r => [r[0], r[2]]), n[1].table!.rows.map(r => r[0])], [[['O10', 'Atteint']], ['O20']]);
  // 2027 planifié : O20 à évaluer.
  assert.deepEqual(R.objectifsARevoir(d.ds.objectifs!, d.ds.entretiens, x(9103)).map(o => o.id), [20]);
  // Réglage coupé après coup : le compte rendu clos garde ses objectifs ; l'annuel planifié et le point n'en montrent plus.
  const eteint = new Domain({ ...full, settings: { ...full.settings, objectifsActifs: false } });
  assert.deepEqual(objs(eteint, 9102), n);
  // Même règle pour la section texte « Objectifs de l'année à venir » (dialogs/compteRendu.ts, sectionsDe) : remplacée
  // tant que le bloc des objectifs s'affiche, de retour pour l'annuel planifié réglage coupé.
  const off = { objectifsActifs: false };
  assert.equal(R.objectifsDuCompteRendu(d.ds.objectifs!, d.ds.entretiens, x(9102), off).avec, true);
  assert.deepEqual(objs(eteint, 9103), []);
  assert.equal(R.objectifsDuCompteRendu(d.ds.objectifs!, d.ds.entretiens, x(9103), off).avec, false);
  assert.equal(R.objectifsDuCompteRendu(d.ds.objectifs!, d.ds.entretiens, { ...x(9102), type: 'point' }, off).avec, false);
});

test('statut d’un point de suivi clos sans signature du salarié : « Clos », comme dans l’onglet Points de suivi', () => {
  assert.deepEqual(statutEntretien(ent({ type: 'point' })), ['Clos', 'tag-neutral']);
  assert.deepEqual(statutEntretien(ent({ type: 'point', signSal: '2026-10-06' })), ['Signé', 'tag-neutral']);
  assert.deepEqual(statutEntretien(ent({ type: 'point', statut: 'planifie' })), ['Planifié', 'tag-outline']);
  assert.deepEqual(statutEntretien(ent({ type: 'mi_annee' })), ['À signer', 'tag-outline']);
});

test('récapitulatif des échéances lu par la lecture seule : relances d’objectif sans le nom du salarié', async () => {
  const db = await nouvelleBase();
  await seedDemo(db);
  const { envoyerEmail } = await import('../server/src/integrations/email.ts');
  const { envoisPourLecteur, LIGNE_OBJECTIF_RESERVEE } = await import('../server/src/envois-lecteur.ts');
  const { listerEnvois } = await import('../server/src/envois.ts');
  const texte = ['Bonjour,', '', 'Sous 30 jours :', '• Mehdi Benali (Maintenance) — Objectif à échéance, avancement à mettre à jour : échéance le 31 oct. 2026',
    '• Mehdi Benali (Maintenance) — Formation SST : échéance le 2 nov. 2026'].join('\n');
  await envoyerEmail(db, 'echeances.recapitulatif', { a: ['rh@entreprise.example'], objet: 'Cursus — échéances à traiter : 2 nouvelles relances', texte });
  const envois = await listerEnvois(db, { cible: 'email' });
  const recap = envois.find(e => e.type === 'echeances.recapitulatif')!;
  const compte = async (empId: number | null) => (await db.one<Compte>(empId ? 'SELECT * FROM comptes WHERE emp_id = ?' : 'SELECT * FROM comptes WHERE emp_id IS NULL', empId ? [empId] : []))!;
  const rh = (await currentUser(db, { compteId: (await compte(null)).id, role: 'rh', methode: 'demo' }))!;
  const lecture = (await currentUser(db, { compteId: (await compte(11)).id, role: 'rh', methode: 'demo' }))!;
  assert.deepEqual(await envoisPourLecteur(db, rh, envois), envois);
  const lu = (await envoisPourLecteur(db, lecture, envois)).find(e => e.id === recap.id)!;
  const t = (lu.contenu as { texte: string }).texte;
  assert.doesNotMatch(t, /Mehdi Benali \(Maintenance\) — Objectif/);
  assert.ok(t.includes(LIGNE_OBJECTIF_RESERVEE));
  assert.match(t, /Mehdi Benali \(Maintenance\) — Formation SST/, 'les autres relances restent lisibles');
  assert.equal(lu.type, 'echeances.recapitulatif');
});

test('écrans : onglet et filtres d’Entretiens dans l’adresse, « Mes objectifs » dans l’espace collaborateur seulement', async () => {
  const data = await domaine();
  assert.deepEqual(lireUrl('entretiens', '?onglet=objectifs&statut=en-cours&echeance=sous-30-jours', data), { entOnglet: 'objectifs', objStatut: 'ouverts', objEcheance: 'proches' });
  assert.deepEqual(lireUrl('entretiens', '?onglet=inconnu&statut=x', data), { entOnglet: 'echeances', objStatut: 'tous', objEcheance: 'toutes' });
  assert.equal(adresse('entretiens', { entOnglet: 'points', objStatut: 'tous', objEcheance: 'depassees' } as never), '/entretiens?onglet=points&echeance=depassees');
  assert.equal(adresse('entretiens', { entOnglet: 'echeances', objStatut: 'tous', objEcheance: 'toutes' } as never), '/entretiens');
  assert.ok((ALLOWED_VIEWS.collaborateur as readonly string[]).includes('objectifs'));
  assert.ok(!(ALLOWED_VIEWS.manager as readonly string[]).includes('objectifs') && !(ALLOWED_VIEWS.rh as readonly string[]).includes('objectifs'));
});
