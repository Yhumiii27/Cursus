// Mise en service (t123) : lecture robuste des fichiers CSV, colonnes reconnues par leur nom, imports des salariés, des
// soldes d'ouverture, des certifications, des habilitations et des visites médicales sur une base de production vide ;
// aperçu et serveur d'accord, import rejouable sans doublon, soldes repris tels quels et justes après le 1er janvier et
// le 1er juin, journal et confidentialité des lots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, pourLecteur, preparerTrace, REGLES } = await import('../server/src/journal.ts');
const { Domain } = await import('../shared/domain.ts');
const { estActionPaie, familleAction, JOURNAL_LABEL } = await import('../shared/journal.ts');
const { lireCsv, parsePlan, SAMPLE_PLAN_CSV } = await import('../shared/rules/imports.ts');
const R = await import('../shared/rules/reprise.ts');
const { cetInfo, cpInfo, recupInfo, rttInfo, soldePeriode } = await import('../shared/rules/conges.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Db = InstanceType<typeof Db>;
interface Ligne { action: string; message: string | null; payload: Record<string, any>; salaries: number[] | null }

const ADMIN = { role: 'rh', empId: null, nom: 'Responsable RH', intitule: '', profilRh: 'rh_admin', compteId: 1 } as unknown as User;

/** Base de production vide, référentiels types chargés ; `run` suit le chemin de POST /api/actions/:nom (trace comprise). */
function base() {
  const db = new Db(':memory:');
  db.insert('comptes', { empId: null, nom: 'Responsable RH', adresse: 'rh@exemple.fr', identifiant: 'rh@exemple.fr', type: 'microsoft', oid: null, profilRh: 'rh_admin', actif: true, motDePasse: null, changerMotDePasse: false, echecs: 0, blocageFin: null, creation: '2026-10-01T08:00:00Z', creePar: null, derniereConnexion: null });
  const run = (name: string, p: Record<string, unknown>, u: User = ADMIN) => db.tx(() => {
    const t = preparerTrace(db, name, p);
    const r = ACTIONS[name](makeCtx(db, u, loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    journaliserAction(db, t, { user: u, compte: db.get('comptes', 1)!, message: o.message ?? null, result: o.result });
    return { message: String(o.message), result: o.result as Record<string, any> };
  });
  for (const referentiel of ['formations', 'habilitations']) run('referentiel.charger', { referentiel });
  const domain = (today?: string) => { const ds = loadFull(db, ADMIN); return new Domain(today ? { ...ds, today } : ds); };
  /** Analyse (aperçu) puis import du même fichier, colonnes reconnues par leur nom ; `colonnes` : rapprochement manuel. */
  const importer = (type: string, texte: string, o: Record<string, unknown> = {}) => {
    const colonnes = (o.colonnes as (string | null)[]) ?? R.reconnaitreColonnes(type as any, lireCsv(texte).lignes[0]);
    const apercu = R.analyserReprise(domain(), type as any, texte, { colonnes, ...o } as any);
    const r = run('reprise.importer', { type, texte, colonnes, ...o });
    return { apercu, ...r };
  };
  const emp = (nom: string) => loadFull(db, ADMIN).employes.find(e => e.nom === nom)!;
  return { db, run, domain, importer, emp };
}

const SALARIES = [
  '﻿Matricule;Prénom;Nom;Intitulé du poste;Département;Catégorie;Type de contrat;Temps de travail;Date d\'entrée;Date de fin;Date de naissance;Adresse e-mail',
  'A0123;Julie;Martin;"Technicienne de maintenance; électricité";Maintenance;ETAM;CDI;39 h avec RTT;01/09/2015;;12/04/1988;julie.martin@exemple.fr',
  'A0456;Marc;Petit;Opérateur de production;Production;Ouvrier;CDD;35 h;05/01/2026;30/06/2027;1997;marc.petit@exemple.fr',
  'A0789;Nora;Saïd;"Responsable ""qualité""";Qualité;Cadre;CDI;Forfait jours;01/02/2020;;1980;nora.said@exemple.fr',
].join('\r\n');

test('lecture CSV : BOM, guillemets, « ; » et sauts de ligne dans une cellule, séparateurs détectés', () => {
  const a = lireCsv('﻿nom;poste\r\n"Martin; Julie";"Chef ""d’équipe"""\r\n\r\n"Petit\nMarc";Opérateur\n');
  assert.equal(a.sep, ';');
  assert.deepEqual(a.lignes, [['nom', 'poste'], ['Martin; Julie', 'Chef "d’équipe"'], ['Petit\nMarc', 'Opérateur']]);
  assert.deepEqual(a.numeros, [1, 2, 4], 'numéro de la ligne dans le fichier (ligne vide écartée)');
  assert.equal(lireCsv('a\tb\n1\t2').sep, '\t');
  assert.deepEqual(lireCsv('a,b,"c,d"\n1,2,3').lignes[0], ['a', 'b', 'c,d']);
  assert.equal(lireCsv('"a;b",c;d').sep, ';', 'séparateur compté hors guillemets');
  // Les imports du plan et des déplacements passent par la même lecture.
  assert.equal(parsePlan(new Domain(loadFull(base().db, ADMIN)), SAMPLE_PLAN_CSV).length, 11);
});

test('colonnes reconnues par leur nom (export Lucca), le plus précis l’emporte, chaque champ une seule fois', () => {
  const cols = R.reconnaitreColonnes('salaries', lireCsv(SALARIES).lignes[0]);
  assert.deepEqual(cols, ['matricule', 'prenom', 'nom', 'poste', 'equipe', 'statut', 'typeContrat', 'temps', 'entree', 'fin', 'naissance', 'email']);
  assert.deepEqual(R.reconnaitreColonnes('soldes', ['Matricule', 'Solde CP N-1', 'Solde CP N', 'RTT', 'Récupération (heures)', 'CET', 'Commentaire']),
    ['matricule', 'cpN1', 'cpN', 'rtt', 'recup', 'cet', null]);
  assert.deepEqual(R.reconnaitreColonnes('visites', ['Nom', 'Date', 'Date de visite', 'Aptitude']), ['nom', null, 'date', 'avis'], 'en-tête exact d’abord');
  // Le modèle de chaque import est reconnu tel quel.
  for (const t of R.TYPES_REPRISE) {
    const m = R.modeleReprise(t);
    assert.ok(R.reconnaitreColonnes(t, m.entetes).every(c => c !== null), `modèle ${t}`);
  }
});

test('salariés : aperçu ligne à ligne, fiches créées avec leurs équipes, rejouer ne duplique rien', () => {
  const { importer, emp, db, domain } = base();
  const r = importer('salaries', SALARIES, { comptes: true });
  assert.deepEqual(r.apercu.lignes.map(l => [l.n, l.issue]), [[2, 'creation'], [3, 'creation'], [4, 'creation']]);
  assert.deepEqual(r.apercu.equipesInconnues, ['Maintenance', 'Production', 'Qualité']);
  assert.match(r.message, /^Import des salariés : 3 ajouts · 3 comptes Microsoft 365 créés$/);
  const julie = emp('Julie Martin');
  assert.deepEqual([julie.poste, julie.equipe, julie.statut, julie.typeContrat, julie.temps, julie.entree, julie.naissance, julie.matriculePaie, julie.email],
    ['Technicienne de maintenance; électricité', 'Maintenance', 'technicien', 'cdi', '39h_rtt', '2015-09-01', 1988, 'A0123', 'julie.martin@exemple.fr']);
  assert.equal(emp('Nora Saïd').poste, 'Responsable "qualité"');
  assert.equal(emp('Nora Saïd').forfaitJours, 218, 'forfait jours : 218 par défaut');
  assert.equal(emp('Marc Petit').fin, '2027-06-30');
  assert.deepEqual(domain().equipes, ['Maintenance', 'Production', 'Qualité']);
  assert.equal(db.all('comptes').length, 4);
  // Rejouer : fiches retrouvées par leur matricule, rien à écrire.
  const bis = R.analyserReprise(domain(), 'salaries', SALARIES, { colonnes: R.reconnaitreColonnes('salaries', lireCsv(SALARIES).lignes[0]) });
  assert.deepEqual(bis.lignes.map(l => l.issue), ['ignoree', 'ignoree', 'ignoree']);
  assert.throws(() => importer('salaries', SALARIES), /Aucune ligne à importer : 3 déjà à jour ou ignorées, 0 refusée/);
  // Fichier corrigé : mise à jour par matricule, et sans matricule par le nom et la date d'entrée.
  const corrige = SALARIES.replace('Opérateur de production', 'Conducteur de ligne').replace('A0789;', ';').replace('Qualité;Cadre', 'Production;Cadre');
  const m = importer('salaries', corrige);
  assert.deepEqual(m.apercu.lignes.map(l => l.issue), ['ignoree', 'maj', 'maj']);
  assert.equal(loadFull(db, ADMIN).employes.length, 3, 'aucun doublon');
  assert.deepEqual([emp('Marc Petit').poste, emp('Nora Saïd').equipe, emp('Nora Saïd').matriculePaie], ['Conducteur de ligne', 'Production', 'A0789']);
});

test('salariés : erreurs nommées par ligne, doublons du fichier, réembauche sur un matricule confirmée dans l’aperçu', () => {
  const { importer, run, emp, domain } = base();
  importer('salaries', SALARIES);
  const fichier = [
    'Matricule;Nom;Poste;Statut;Contrat;Temps;Entrée;Naissance',
    'B1;Paul Durand;Soudeur;Chef;CDI;35 h;01/03/2021;1990',
    'B2;Inès Bah;Cariste;Ouvrier;CDI;35 h;31/02/2021;1992',
    'B3;Luc Morel;Cariste;Ouvrier;CDI;35 h;01/03/2021;',
    'B4;Ana Lima;Peintre;Ouvrier;CDI;35 h;01/04/2022;1985',
    'B4;Ana Lima bis;Peintre;Ouvrier;CDI;35 h;01/05/2022;1986',
    'A0123;Julie Martin;Technicienne de maintenance;Technicien;CDD;39 h avec RTT;01/09/2015;1988',
  ].join('\n');
  const a = R.analyserReprise(domain(), 'salaries', fichier, { colonnes: R.reconnaitreColonnes('salaries', lireCsv(fichier).lignes[0]) });
  const motif = (n: number) => a.lignes.find(l => l.n === n)!.erreurs.join(' | ');
  assert.match(motif(2), /^Statut non reconnu : « Chef »$/);
  assert.match(motif(3), /^Date d’entrée illisible/);
  assert.match(motif(4), /^Année de naissance manquante$/);
  assert.equal(a.lignes.find(l => l.n === 5)!.issue, 'creation');
  assert.match(motif(6), /^Matricule de paie déjà attribué à Ana Lima$/, 'doublon de matricule dans le fichier');
  // Le CDD de Julie Martin est sans date de fin : refus du contrôle de la fiche (validerProfil).
  assert.match(motif(7), /Date de fin requise pour un contrat CDD/);
  // Réembauche : Marc Petit sorti, son matricule réutilisé par une nouvelle embauche après son départ.
  run('employe.modifier', { id: emp('Marc Petit').id, fin: '2026-09-30', typeContrat: 'cdd' });
  const reembauche = 'Matricule;Nom;Poste;Statut;Contrat;Temps;Entrée;Naissance\nA0456;Marc Petit;Conducteur de ligne;Ouvrier;CDI;35 h;05/10/2026;1997';
  const sans = R.analyserReprise(domain(), 'salaries', reembauche, { colonnes: R.reconnaitreColonnes('salaries', lireCsv(reembauche).lignes[0]) });
  assert.equal(sans.lignes[0].issue, 'refus');
  assert.match(sans.lignes[0].confirmation!, /^Réembauche : réutiliser le matricule A0456 de Marc Petit, sorti le 30 sept\. 2026$/);
  assert.throws(() => importer('salaries', reembauche), /Aucune ligne à importer/);
  const r = importer('salaries', reembauche, { confirmations: [2] });
  assert.equal(r.apercu.lignes[0].issue, 'creation');
  assert.equal(r.result.crees, 1);
});

test('salariés : une fiche qui vit dans Cursus ne change ni de régime ni de sortie par l’import', () => {
  const { importer, run, emp, domain } = base();
  importer('salaries', SALARIES);
  run('absence.demander', { empId: emp('Julie Martin').id, kind: 'CP', du: '2026-11-02', au: '2026-11-03' });
  const autre = SALARIES.replace('39 h avec RTT', '35 h');
  const a = R.analyserReprise(domain(), 'salaries', autre, { colonnes: R.reconnaitreColonnes('salaries', lireCsv(autre).lignes[0]) });
  assert.match(a.lignes[0].erreurs[0], /^Changement de régime de temps ou de contrat : à faire depuis la fiche/);
  const sortie = 'Matricule;Nom;Entrée;Date de sortie;Motif de sortie\nA0789;Nora Saïd;01/02/2020;30/09/2026;Démission';
  const s = R.analyserReprise(domain(), 'salaries', sortie, { colonnes: R.reconnaitreColonnes('salaries', lireCsv(sortie).lignes[0]) });
  assert.match(s.lignes[0].erreurs[0], /^Sortie à enregistrer depuis la fiche/);
  // Une nouvelle fiche peut porter sa sortie (salarié parti avant la mise en service, repris pour l'historique).
  const parti = 'Matricule;Nom;Poste;Entrée;Date de sortie;Motif de sortie;Naissance\nC9;Hugo Blanc;Magasinier;01/02/2019;31/08/2026;Démission;1975';
  importer('salaries', parti);
  assert.deepEqual([emp('Hugo Blanc').fin, emp('Hugo Blanc').motifSortie], ['2026-08-31', 'demission']);
});

test('soldes d’ouverture : repris tels quels à la date d’arrêté, justes après le 1er janvier et le 1er juin', () => {
  const { importer, emp, domain, db } = base();
  importer('salaries', SALARIES);
  const soldes = 'Matricule;Nom;Solde CP N-1;CP N;RTT;Récupération (heures);CET\nA0123;Julie Martin;12,5;7;4;6;3\nA0456;Marc Petit;3;;9;;\nZ999;Inconnu;1;;;;';
  const r = importer('soldes', soldes, { dateReprise: '2027-01-01' });
  assert.deepEqual(r.apercu.lignes.map(l => l.issue), ['creation', 'creation', 'refus']);
  assert.match(r.apercu.lignes[2].erreurs[0], /^Matricule de paie Z999 inconnu/);
  assert.match(r.message, /^Import des soldes : 2 ajouts, 1 ligne refusée · soldes au 1 janv\. 2027$/);
  const julie = emp('Julie Martin'), marc = emp('Marc Petit');
  // 2 janvier 2027 : soldes de l'ancien outil, sans recalcul.
  const jan = domain('2027-01-02');
  assert.equal(cpInfo(jan, julie)!.solde, 12.5);
  assert.equal(rttInfo(jan, julie, 2027)!.solde, 4);
  assert.equal(recupInfo(jan, julie)!.solde, 6);
  assert.equal(cetInfo(jan, julie).total, 3);
  assert.equal(cpInfo(jan, marc)!.solde, 3);
  // Marc Petit (35 h) : pas de RTT, valeur ignorée avec un avertissement.
  assert.match(r.apercu.lignes[1].avertissements.join(' '), /Ni RTT ni jours de repos pour ce régime/);
  // 1er juin 2027 : la période suivante part des 7 jours acquis au 1er janvier, plus les 5 mois acquis depuis.
  const juin = domain('2027-06-02');
  assert.ok(Math.abs(soldePeriode(juin, julie, 2027) - (7 + 25 / 12 * 5)) < 1e-9, String(soldePeriode(juin, julie, 2027)));
  // Rejouer : déjà repris ; une autre date d'arrêté met à jour.
  assert.throws(() => importer('soldes', soldes.split('\n').slice(0, 3).join('\n'), { dateReprise: '2027-01-01' }), /Aucune ligne à importer/);
  const maj = importer('soldes', soldes.split('\n').slice(0, 2).join('\n'), { dateReprise: '2026-12-31' });
  assert.equal(maj.apercu.lignes[0].issue, 'maj');
  assert.equal((db.get('soldesReprise', julie.id) as any).arreteLe, '2026-12-31');
  assert.throws(() => importer('soldes', soldes, { dateReprise: '2027-02-30' }), /Date de reprise des soldes invalide/);
});

test('certifications et habilitations : catalogue exigé, prérequis manquant en avertissement, rejouable', () => {
  const { importer, emp, run, db } = base();
  importer('salaries', SALARIES);
  run('referentiel.formation.archiver', { id: 'rgpd' });
  const certs = 'Matricule;Formation;Date d\'obtention\nA0123;SST;14/03/2025\nA0123;Inconnue;14/03/2025\nA0456;rgpd;01/01/2026\nA0456;CACES R489;02/02/2027';
  const c = importer('certifications', certs);
  assert.deepEqual(c.apercu.lignes.map(l => [l.issue, l.erreurs[0] ?? '']), [
    ['creation', ''], ['refus', 'Formation absente du catalogue : « Inconnue » (écran Référentiels)'], ['refus', 'Formation archivée au catalogue : RGPD'], ['refus', 'Date d’obtention à venir : 2 févr. 2027'],
  ]);
  assert.deepEqual(emp('Julie Martin').certs.map(x => [x.f, x.obtenue]), [['sst', '2025-03-14']]);
  assert.throws(() => importer('certifications', certs), /Aucune ligne à importer/);
  // Habilitation électrique sans la formation prérequise : avertissement, délivrance reprise quand même.
  const habs = 'Matricule;Habilitation;Date de délivrance;Signataire\nA0123;he;20/03/2025;Directeur du site\nA0123;he;20/03/2024;Directeur du site\nA0456;Habilitation inconnue;01/01/2026;X';
  const h = importer('habilitations', habs);
  assert.deepEqual(h.apercu.lignes.map(l => l.issue), ['creation', 'ignoree', 'refus']);
  assert.match(h.apercu.lignes[0].avertissements.join(' '), /^Prérequis non satisfaits : .* — délivrée quand même \(reprise\)/);
  assert.equal(h.apercu.lignes[1].avertissements[0], 'Ligne 2 plus récente');
  assert.deepEqual(emp('Julie Martin').habs.map(x => [x.h, x.delivree, x.par]), [['he', '2025-03-20', 'Directeur du site']]);
  // Une délivrance plus récente remplace l'ancienne date, sans nouveau titre.
  importer('habilitations', 'Matricule;Habilitation;Date de délivrance\nA0123;he;01/09/2026');
  assert.deepEqual(emp('Julie Martin').habs.map(x => [x.delivree, x.par]), [['2026-09-01', loadFull(db, ADMIN).referentiels.habilitations.find(x => x.id === 'he')!.signataire]]);
});

test('visites : avis exigé, visite sans avis enregistrée apte seulement sur confirmation, restrictions signalées', () => {
  const { importer, emp, domain } = base();
  importer('salaries', SALARIES);
  const visites = 'Matricule;Date de visite;Avis\nA0123;10/06/2025;\nA0456;15/01/2026;Apte avec restrictions\nA0789;01/03/2026;Inapte\nA0789;01/03/2025;Apte';
  const sans = R.analyserReprise(domain(), 'visites', visites, { colonnes: ['matricule', 'date', 'avis'] });
  assert.equal(sans.lignes[0].issue, 'refus');
  assert.match(sans.lignes[0].erreurs[0], /^Avis absent : aptitude laissée « à vérifier »/);
  assert.equal(sans.lignes[3].issue, 'ignoree', 'visite plus ancienne du même salarié');
  // Sans confirmation : Julie Martin reste sans visite (aptitude à vérifier).
  importer('visites', visites);
  assert.equal(emp('Julie Martin').visite, null);
  const marc = emp('Marc Petit');
  assert.deepEqual([marc.visite, marc.avis, marc.restrictions.map(x => x.texte)], ['2026-01-15', 'restrictions', [R.RESTRICTION_A_RECOPIER]]);
  assert.ok(domain().medInfo(marc).ok, 'aptitude valide, avec restrictions en vigueur');
  assert.equal(emp('Nora Saïd').avis, 'inapte');
  const r = importer('visites', visites, { confirmations: [2] });
  assert.deepEqual(r.apercu.lignes.map(l => l.issue), ['creation', 'ignoree', 'ignoree', 'ignoree']);
  assert.deepEqual([emp('Julie Martin').visite, emp('Julie Martin').avis], ['2025-06-10', 'apte']);
});

test('journal et confidentialité : code par import, ni fichier ni noms au journal, lots réservés au service RH', () => {
  const { importer, db } = base();
  importer('salaries', SALARIES);
  importer('visites', 'Matricule;Date de visite;Avis\nA0123;10/06/2025;Apte');
  const lignes = db.all<Ligne>('journal').filter(j => j.action.startsWith('reprise.'));
  assert.deepEqual(lignes.map(j => j.action), ['reprise.salaries', 'reprise.visites']);
  const sal = lignes[0];
  assert.deepEqual(Object.keys(sal.payload).sort(), ['comptes', 'comptesCrees', 'crees', 'dateReprise', 'ignorees', 'lot', 'majs', 'refusees', 'type']);
  assert.ok(!JSON.stringify(sal.payload).includes('Martin'), 'aucun contenu du fichier');
  assert.equal(sal.salaries?.length, 3);
  assert.ok(REGLES['reprise.importer'] && JOURNAL_LABEL['reprise.importer'] && JOURNAL_LABEL['reprise.soldes']);
  assert.equal(familleAction('reprise.visites')?.id, 'reprise');
  assert.ok(estActionPaie('reprise.soldes') && !estActionPaie('reprise.salaries'), 'soldes repris : archive paie');
  // Lecture seule : message de l'import des visites masqué.
  const lecture = { ...ADMIN, profilRh: 'lecture_seule' } as User;
  const vue = pourLecteur(lecture, [{ action: 'reprise.visites', message: 'Import des visites : 1 ajout', details: {} }] as any);
  assert.notEqual(vue[0].message, 'Import des visites : 1 ajout');
  // Lots : service RH seulement.
  assert.equal(loadFull(db, ADMIN).reprises.length, 2);
  assert.equal(loadFull(db, ADMIN).reprises[0].type, 'visites', 'le plus récent d’abord');
  assert.deepEqual(loadFull(db, ADMIN).reprises[1].rapport[0], { n: 2, issue: 'Ajout', nom: 'Julie Martin', motif: 'Technicienne de maintenance; électricité · équipe Maintenance · CDI · matricule A0123 · Équipe Maintenance créée' });
});

test('lots de reprise : absents des instantanés du manager, du collaborateur et des profils restreints', () => {
  const db = new Db(':memory:');
  seedDemo(db);
  const compte = (empId: number | null) => (db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL').get(...(empId ? [empId] : [])) as { id: number }).id;
  const u = (empId: number | null, role: User['role']) => currentUser(db, { compteId: compte(empId), role, methode: 'demo' })!;
  const RH = u(null, 'rh');
  db.tx(() => ACTIONS['reprise.importer'](makeCtx(db, RH, loadFull(db, RH)), { type: 'soldes', texte: 'Nom;CP N-1\nMehdi Benali;10', colonnes: ['nom', 'cpN1'], dateReprise: '2026-10-01' }));
  assert.equal(buildSnapshot(db, RH).reprises.length, 1);
  for (const [empId, role] of [[12, 'manager'], [2, 'collaborateur'], [23, 'rh'], [7, 'rh'], [11, 'rh']] as const) {
    assert.deepEqual(buildSnapshot(db, u(empId, role)).reprises, [], `${empId} ${role}`);
  }
  // Gestionnaire RH : consulte les lots, n'importe pas.
  assert.throws(() => ACTIONS['reprise.importer'](makeCtx(db, u(14, 'rh'), loadFull(db, RH)), { type: 'soldes' }),
    (e: unknown) => e instanceof ActionError && e.status === 403);
});
