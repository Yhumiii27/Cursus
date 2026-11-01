// Forfait annuel en heures (lot 12, chantier C1, étape 2) : ce que les écrans et l'échéance du service RH tirent de la règle.
// - périodes suivies, plages terminées à clôturer (fin de période, sortie en cours de période, ligne rouverte ou annulée),
//   lignes à revoir, groupes du bandeau ;
// - suivi de la période en cours : projection au rythme des feuilles validées (4 semaines au moins), ligne en vigueur ;
// - échéance de la clôture (dernier jour du mois qui suit la fin de la plage) et relances du récapitulatif : une par
//   échéance, à la seule boîte du service RH, sans nom ni heure, une fois par palier (deux moteurs) ;
// - onglet de l'écran Temps et droits de lecture de l'écran (quantités : service RH, paie, le salarié lui-même).
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Démonstration lue en janvier 2027 : la période 2026 (suivie depuis le 1er janvier 2026 en démonstration) est terminée.
process.env.CURSUS_TODAY = '2027-01-20';

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { recapitulatifEcheances } = await import('../server/src/relances.ts');
const { Domain } = await import('../shared/domain.ts');
const { addD, isFerie, mondayOf } = await import('../shared/dates.ts');
const F = await import('../shared/rules/forfait-heures.ts');
const V = await import('../client/src/components/temps/forfait-heures-vue.ts');
type Dataset = Awaited<ReturnType<typeof loadFull>>;
type Employe = Dataset['employes'][number];
type Feuille = Dataset['feuilles'][number];
type Ligne = import('../shared/types.ts').ClotureForfaitHeures;
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

/** Cadre au forfait annuel en heures de la démonstration (Élodie Bernard, 1 607 h). */
const EMP = 11;
const ANNUEL = { statut: 'cadre', typeContrat: 'cdi', temps: 'forfait_heures_annuel', heures: null, forfaitHeures: 1607, forfaitJours: null, jourOff: [] } as const;

const base = await (async () => {
  const db = await nouvelleBase();
  await seedDemo(db);
  return await loadFull(db, { role: 'rh', empId: null, nom: 'Essai', intitule: 'RH', profilRh: 'rh_admin' });
})();
new Domain(base);

let nid = 1;
/** Feuilles validées de `du` à `au` : `h` heures chaque jour ouvré non férié, une par semaine, au forfait annuel. */
function feuilles(du: string, au: string, h: number, statut = 'validee'): Feuille[] {
  const out: Feuille[] = [];
  for (let w = mondayOf(du); w <= au; w = addD(w, 7)) {
    const hs = Array.from({ length: 7 }, (_, i) => { const j = addD(w, i); return j < du || j > au || i >= 5 || isFerie(j) ? 0 : h; });
    if (hs.some(x => x > 0)) out.push({ id: nid++, empId: EMP, week: w, statut, comment: null, sage: true, keystone: false, contrat: ANNUEL, lignes: [{ projet: 'INT-LOG', tache: 'Logistique', ks: false, h: hs }] } as unknown as Feuille);
  }
  return out;
}
/** Domaine d'essai : le cadre seul en feuilles, suivi depuis le 1er janvier 2027, jour d'essai au choix. */
function domaine(o: { employe?: Partial<Employe>; feuilles?: Feuille[]; settings?: Record<string, unknown>; today: string; lignes?: Partial<Ligne>[] }) {
  const e = { ...base.employes.find(x => x.id === EMP)!, entree: '2022-09-05', fin: null, ...ANNUEL, ...o.employe } as Employe;
  return new Domain({
    ...base, today: o.today, employes: base.employes.map(x => (x.id === EMP ? e : x)), feuilles: o.feuilles ?? [], absences: [], contratsHistorique: [],
    cloturesForfaitHeures: (o.lignes ?? []) as Ligne[], settings: { ...base.settings, forfaitHeuresDebutSuivi: '2027-01-01', ...o.settings } as Dataset['settings'],
  });
}
/** Ligne confirmée photographiée d'après le calcul de la plage. */
const ligneDe = (c: NonNullable<ReturnType<typeof F.clotureForfaitHeures>>, o: Partial<Ligne> = {}): Ligne => ({
  id: 1, empId: EMP, debut: c.debut, fin: c.fin, motifFin: c.motifFin, version: 1, remplaceId: null, forfait: c.forfait, cible: c.cible, absences: c.absences, realise: c.realise,
  hfa25: c.hfa25, hfa50: c.hfa50, hca10: c.hca10, hca25: c.hca25, nonRealise: c.nonRealise, statut: 'confirmee', confirmeeLe: '2028-01-10T09:00:00.000Z', confirmeePar: 'Admin',
  lotId: null, sage: false, horsFichier: false, rouverteLe: null, rouvertePar: null, rouverteMotif: null, annuleeLe: null, annuleePar: null, annuleeMotif: null, ...o,
});
const ANNEE = feuilles('2027-01-01', '2027-12-31', 7.5);

test('périodes suivies : de celle du début du suivi à celle du jour, période non civile comprise', () => {
  assert.deepEqual(F.periodesSuivies({ forfaitHeuresDebutSuivi: '2027-01-01' }, '2028-01-20'), [{ debut: '2027-01-01', fin: '2027-12-31' }, { debut: '2028-01-01', fin: '2028-12-31' }]);
  assert.deepEqual(F.periodesSuivies({ forfaitHeuresDebutSuivi: '2027-01-01' }, '2026-12-31'), [], 'avant le début du suivi : rien');
  // Période de juin à mai : celle qui contient le début du suivi commence en juin 2026.
  assert.deepEqual(F.periodesSuivies({ forfaitHeuresDebutSuivi: '2027-01-01', forfaitHeuresDebutPeriode: '06-01' }, '2027-07-01').map(p => p.debut), ['2026-06-01', '2027-06-01']);
});

test('plages à clôturer : période terminée, ligne confirmée exclue, rouverte ou annulée reprise ; groupes du bandeau', () => {
  const d = domaine({ feuilles: ANNEE, today: '2028-01-20' });
  const [p, ...reste] = F.plagesAClore(d);
  assert.deepEqual(reste, []);
  assert.deepEqual([p.e.id, p.reference, p.calc.debut, p.calc.fin, p.calc.blocages, p.ligne], [EMP, { debut: '2027-01-01', fin: '2027-12-31' }, '2027-01-01', '2027-12-31', [], null]);
  // Période en cours (2028) : rien à clôturer tant qu'elle court.
  assert.equal(F.plagesAClore(domaine({ feuilles: ANNEE, today: '2027-12-31' })).length, 0, 'le dernier jour de la plage : pas encore');
  // Ligne confirmée : plus à clôturer ; rouverte (à confirmer) ou annulée : de nouveau.
  const c = p.calc;
  assert.deepEqual(F.plagesAClore(domaine({ feuilles: ANNEE, today: '2028-01-20', lignes: [ligneDe(c)] })), []);
  const rouverte = F.plagesAClore(domaine({ feuilles: ANNEE, today: '2028-01-20', lignes: [ligneDe(c, { statut: 'proposee', rouverteLe: '2028-01-12T09:00:00.000Z' })] }));
  assert.equal(rouverte[0].ligne?.statut, 'proposee');
  assert.equal(F.plagesAClore(domaine({ feuilles: ANNEE, today: '2028-01-20', lignes: [ligneDe(c, { statut: 'annulee' })] })).length, 1);
  // Bandeau : un groupe par période ; feuille de décembre soumise : la plage est bloquée, toujours listée.
  const bloquee = domaine({ feuilles: ANNEE.map(f => (f.week === '2027-12-13' ? { ...f, statut: 'soumise' } as Feuille : f)), today: '2028-01-20' });
  const [g] = V.groupesAClore(bloquee);
  assert.deepEqual([g.reference.debut, g.plages.length, g.bloquees, g.enCours], ['2027-01-01', 1, 1, false]);
  assert.equal(V.groupeTexte(g), '1 plage à clôturer (1 salarié), dont 1 bloquée (feuille à valider, semaine sans feuille…)');
  // Sortie le 30 juin 2027 : plage close à la sortie, à clôturer dès le lendemain, dans la période en cours.
  const sorti = domaine({ employe: { fin: '2027-06-30' }, feuilles: feuilles('2027-01-01', '2027-06-30', 7.5), today: '2027-07-01' });
  const [s] = F.plagesAClore(sorti);
  assert.deepEqual([s.calc.fin, s.calc.motifFin, s.calc.blocages], ['2027-06-30', 'sortie', []]);
  assert.match(V.groupeTexte(V.groupesAClore(sorti)[0]), /période en cours : sorties et avenants/);
  // Dossier anonymisé, ou salarié jamais au forfait : jamais listé.
  assert.deepEqual(F.plagesAClore(domaine({ employe: { anonymiseLe: '2028-01-02' }, feuilles: ANNEE, today: '2028-01-20' })), []);
  assert.equal(F.concerneParForfaitHeures(d, d.emp(2)!), false);
});

test('lignes à revoir : feuille rouverte après la clôture ; jamais une ligne remplacée par une version plus récente', () => {
  const d = domaine({ feuilles: ANNEE, today: '2028-01-20' });
  const c = F.clotureForfaitHeures(d, d.emp(EMP)!, { debut: '2027-01-01', fin: '2027-12-31' })!;
  const rouvertes = ANNEE.map(f => (f.week === '2027-06-07' ? { ...f, reouverture: { le: '2028-01-15T08:00:00.000Z' } } as Feuille : f));
  const [r] = F.lignesARevoir(domaine({ feuilles: rouvertes, today: '2028-01-20', lignes: [ligneDe(c)] }));
  assert.match(r.motif, /feuille de la semaine du 7 juin 2027 rouverte après la clôture/);
  assert.deepEqual(F.lignesARevoir(domaine({ feuilles: rouvertes, today: '2028-01-20', lignes: [ligneDe(c, { sage: true }), ligneDe(c, { id: 2, version: 2, statut: 'proposee' })] })), []);
  assert.deepEqual(F.lignesARevoir(domaine({ feuilles: ANNEE, today: '2028-01-20', lignes: [ligneDe(c)] })), []);
});

test('suivi de la période en cours : projection au rythme des feuilles validées, 4 semaines au moins', () => {
  // Feuilles validées du 1er janvier au dimanche 27 juin 2027 (7,5 h par jour ouvré), jour d'essai le 10 juillet.
  const d = domaine({ feuilles: feuilles('2027-01-01', '2027-06-27', 7.5), today: '2027-07-10' });
  const [s] = F.suiviForfaitHeures(d, d.emp(EMP)!);
  assert.equal(s.enCours, true);
  assert.equal(s.couvertJusquau, '2027-06-27');
  // 126 jours ouvrés moins 4 fériés (1er janvier, lundi de Pâques, Ascension, lundi de Pentecôte) à 7,5 h, sur 178 jours :
  // rapportés aux 365 jours de l'année.
  assert.equal(s.calc.realise, 122 * 7.5);
  assert.equal(s.projection, Math.round(122 * 7.5 * 365 / 178 * 100) / 100);
  assert.equal(s.ligne, null);
  // Moins de 4 semaines couvertes : pas de projection.
  const debut = domaine({ feuilles: feuilles('2027-01-01', '2027-01-17', 7.5), today: '2027-01-20' });
  assert.equal(F.suiviForfaitHeures(debut, debut.emp(EMP)!)[0].projection, null);
  // Aucune feuille : ni couverture ni projection.
  const rien = domaine({ today: '2027-03-01' });
  assert.deepEqual([F.suiviForfaitHeures(rien, rien.emp(EMP)!)[0].couvertJusquau, F.suiviForfaitHeures(rien, rien.emp(EMP)!)[0].projection], [null, null]);
});

test('échéance et relances : dernier jour du mois qui suit la fin, une relance par échéance, ni nom ni heure', () => {
  assert.equal(F.echeanceCloture('2027-12-31'), '2028-01-31');
  assert.equal(F.echeanceCloture('2027-06-30'), '2027-07-31');
  assert.equal(F.echeanceCloture('2027-01-15'), '2027-02-28');
  const d = domaine({ feuilles: ANNEE, today: '2028-01-20' });
  const [r, ...reste] = F.relancesForfaitHeures(d, [90, 30, 7]);
  assert.deepEqual(reste, []);
  assert.deepEqual(r, {
    cle: 'forfait-heures:2028-01-31', empId: 0, categorie: 'forfaitHeures', echeance: '2028-01-31', jours: 11, palier: '30', sante: false, rhSeul: true,
    libelle: 'Forfait annuel en heures — 1 période terminée à clôturer (Temps de travail)',
  });
  assert.doesNotMatch(JSON.stringify(r), /Bernard|\d h\b/, 'ni nom ni heure');
  // Échéance passée : échue ; au-delà du premier palier : rien encore.
  assert.equal(F.relancesForfaitHeures(domaine({ feuilles: ANNEE, today: '2028-02-02' }), [90, 30, 7])[0].palier, 'echu');
  assert.deepEqual(F.relancesForfaitHeures(domaine({ feuilles: ANNEE, today: '2028-01-20' }), [7]), []);
  // Ligne confirmée : plus de relance.
  const c = F.clotureForfaitHeures(d, d.emp(EMP)!, { debut: '2027-01-01', fin: '2027-12-31' })!;
  assert.deepEqual(F.relancesForfaitHeures(domaine({ feuilles: ANNEE, today: '2028-01-20', lignes: [ligneDe(c)] }), [90, 30, 7]), []);
});

test('écran : onglet de Temps et quantités selon les droits (service RH, paie, salarié ; jamais le référent HSE)', () => {
  const d = domaine({ feuilles: ANNEE, today: '2028-01-20' });
  const droits = (o: Partial<import('../client/src/components/temps/forfait-heures-vue.ts').DroitsForfaitHeures>) =>
    ({ rh: false, paie: false, consultation: false, manager: false, collab: false, soi: null, ...o });
  assert.equal(V.ongletForfaitHeures(d, droits({ rh: true })), 'Forfait annuel en heures · 1', 'service RH : une plage à clôturer');
  assert.equal(V.ongletForfaitHeures(d, droits({ paie: true })), 'Forfait annuel en heures');
  assert.equal(V.ongletForfaitHeures(d, droits({ manager: true, soi: 23 })), 'Forfait annuel en heures');
  assert.equal(V.ongletForfaitHeures(d, droits({})), null, 'référent HSE : ni feuilles ni paie');
  assert.equal(V.voitQuantites(droits({ manager: true, soi: 23 }), EMP), false, 'manager : ni absences déduites ni heures de paie');
  assert.equal(V.voitQuantites(droits({ consultation: true }), EMP), false, 'lecture seule');
  assert.equal(V.voitQuantites(droits({ collab: true, soi: EMP }), EMP), true, 'le salarié lui-même');
  assert.equal(V.voitQuantites(droits({ paie: true }), EMP), true);
  // Aucun salarié au forfait et aucune ligne : pas d'onglet.
  const sans = domaine({ employe: { temps: '35h', forfaitHeures: null }, today: '2028-01-20' });
  assert.equal(V.ongletForfaitHeures(sans, droits({ rh: true })), null);
  assert.equal(V.heuresDuesTexte({ hfa25: 120, hfa50: 15.5, hca10: 0, hca25: 0, nonRealise: 0 }), 'HFA25 120 h · HFA50 15,5 h');
  assert.equal(V.heuresDuesTexte({ hfa25: 0, hfa50: 0, hca10: 0, hca25: 0, nonRealise: 20 }), 'heures non réalisées : 20 h (information, jamais retenues)');
  assert.equal(V.periodeTexte({ debut: '2027-06-01', fin: '2028-05-31' }), 'du 1 juin 2027 au 31 mai 2028');
});

test('récapitulatif des échéances : clôture à faire à la seule boîte du service RH, sans nom ni heure, une fois par palier', async () => {
  const db = await nouvelleBase();
  await seedDemo(db);
  const admin = (await currentUser(db, { compteId: (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id IS NULL'))!.id, role: 'rh', methode: 'demo' }))! as User;
  await db.tx(async () => await ACTIONS['messagerie.regler'](makeCtx(db, admin, await loadFull(db, admin)), { rh: 'rh@entreprise.example' }));
  const passer = async () => await db.tx(async () => await recapitulatifEcheances(db));
  await passer();
  const recaps = async () => (await db.query<{ contenu: unknown }>("SELECT contenu FROM envois WHERE type = 'echeances.recapitulatif' ORDER BY id"))
    .map(e => (typeof e.contenu === 'string' ? JSON.parse(e.contenu) : e.contenu) as { a: string[]; texte: string });
  const premiers = await recaps();
  const rh = premiers.find(e => e.a[0] === 'rh@entreprise.example')!;
  // Démonstration suivie depuis le 1er janvier 2026 : la plage 2026 d'Élodie Bernard, terminée le 31 décembre, est à clôturer
  // avant la fin de janvier 2027 (11 jours : palier de 30 jours).
  assert.match(rh.texte, /• Forfait annuel en heures — 1 période terminée à clôturer \(Temps de travail\) : échéance le 31 janv\. 2027/);
  for (const e of premiers.filter(x => x.a[0] !== 'rh@entreprise.example')) assert.doesNotMatch(e.texte, /Forfait annuel en heures/, `pas chez ${e.a[0]}`);
  const cles = (await db.query<{ cle: string; palier: string }>("SELECT cle, palier FROM relances WHERE cle LIKE 'forfait-heures:%'")).map(r => `${r.cle}|${r.palier}`);
  assert.deepEqual(cles, ['forfait-heures:2027-01-31|30']);
  // Passage suivant : rien de nouveau.
  await passer();
  assert.equal((await recaps()).length, premiers.length);
});
