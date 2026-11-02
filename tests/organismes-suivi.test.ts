// Tests : suivi des organismes de formation (lot 12, chantier C4, étape 2 ; shared/rules/organismes-suivi.ts, relances
// Qualiopi de server/src/relances.ts, évaluations consolidées de server/src/vues-organismes.ts, organisme prévu d'une ligne
// du plan par `plan.modifier`, état d'écran des onglets Organismes et E-learning du client).
// Jeu de démonstration au 10 octobre 2026 (server/src/seed-organismes.ts) : Apave certifié jusqu'au 30 juin 2027, AFTRAL à
// renouveler (30 novembre 2026), Socotec échu (30 septembre 2026), fiches reprises sans date ni NDA, deux services internes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
delete process.env.CURSUS_DEMO;

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { Domain } = await import('../shared/domain.ts');
const { SEUIL_ANONYMAT } = await import('../shared/rules/evaluation-formation.ts');
const {
  avertissementsPlan, comparatifFormation, exercicesGlissants, indicateursOrganismes, indicateursOrganismesAffiches, indicateursOrganismesAgreges, organismesASurveiller,
  relancesQualiopi,
} = await import('../shared/rules/organismes-suivi.ts');
const { filtrerInscriptions, filtrerOrganismes } = await import('../client/src/components/organismes/etat.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Compte = import('../server/src/comptes.ts').Compte;
type Organisme = import('../shared/types-organismes.ts').Organisme;

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one<Compte>(empId ? 'SELECT * FROM comptes WHERE emp_id = ?' : 'SELECT * FROM comptes WHERE emp_id IS NULL', empId ? [empId] : []))!;
  const personne = async (empId: number | null, role: User['role'] = 'rh') => (await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' }))!;
  const u = { admin: await personne(null), gest: await personne(14), lecture: await personne(11), hse: await personne(23), paie: await personne(7), karim: await personne(12, 'manager') };
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
  const code = async (c: string) => (await db.one<Organisme>('SELECT id FROM organismes WHERE code = ?', [c]))!.id;
  return { db, u, run, code };
}

/** Fiche minimale pour les règles pures. */
const fiche = (x: Partial<Organisme>): Organisme => ({
  id: 1, code: 'X', raisonSociale: null, nomUsuel: 'X', type: 'externe', siret: null, nda: '11755468475', ndaRegion: null, qualiopi: true, qualiopiCategories: ['formation'],
  qualiopiCertificateur: null, qualiopiNumero: null, qualiopiValideJusquau: '2027-06-30', qualiopiVerifieLe: null, adresse: null, siteWeb: null, subrogationAcceptee: false,
  delaiAnnulationJours: null, conditions: null, alias: [], aVerifier: false, source: 'saisie', archive: null, creeLe: null, creePar: null, fusionneDans: null, fusionneLe: null,
  fusionnePar: null, fusionneMotif: null, ...x,
});

test('relances Qualiopi : premier palier réglé, 15 jours, puis échue ; ni service interne, ni fiche sans date, archivée ou fusionnée', () => {
  const s = { organismeAlerteQualiopiJours: 60 };
  const liste = [
    fiche({ id: 1, code: 'LOIN', qualiopiValideJusquau: '2027-06-30' }),
    fiche({ id: 2, code: 'J60', nomUsuel: 'AFTRAL', qualiopiValideJusquau: '2026-11-30' }),
    fiche({ id: 3, code: 'J15', qualiopiValideJusquau: '2026-10-20' }),
    fiche({ id: 4, code: 'ECHU', qualiopiValideJusquau: '2026-09-30' }),
    fiche({ id: 5, code: 'INT', type: 'interne', qualiopiValideJusquau: '2026-10-20' }),
    fiche({ id: 6, code: 'SANS', qualiopiValideJusquau: null }),
    fiche({ id: 7, code: 'ARCH', qualiopiValideJusquau: '2026-10-20', archive: '2026-10-01' }),
    fiche({ id: 8, code: 'FUS', qualiopiValideJusquau: '2026-10-20', fusionneDans: 1 }),
    fiche({ id: 9, code: 'NON', qualiopi: false, qualiopiValideJusquau: '2026-10-20' }),
  ];
  const r = relancesQualiopi(liste, '2026-10-10', s);
  assert.deepEqual(r.map(x => [x.cle, x.palier]), [['organisme:2:qualiopi:2026-11-30', '60'], ['organisme:3:qualiopi:2026-10-20', '15'], ['organisme:4:qualiopi:2026-09-30', 'echu']]);
  assert.ok(r.every(x => x.rhSeul && !x.sante && x.empId === 0 && x.categorie === 'organisme'), 'boîte du service RH seulement, sans salarié');
  assert.match(r[0].libelle, /Qualiopi de AFTRAL \(J60\)/);
  // Palier réglé plus court : la fiche à 51 jours n'est pas encore relancée.
  assert.deepEqual(relancesQualiopi(liste, '2026-10-10', { organismeAlerteQualiopiJours: 30 }).map(x => x.palier), ['15', 'echu']);
});

test('fiches à surveiller (échu, à renouveler, sans date, NDA absent) et filtres de l’onglet Organismes', () => {
  const liste = [
    fiche({ id: 1, nomUsuel: 'Bien' }), fiche({ id: 2, nomUsuel: 'Bientôt', qualiopiValideJusquau: '2026-11-30' }), fiche({ id: 3, nomUsuel: 'Échu', qualiopiValideJusquau: '2026-09-30' }),
    fiche({ id: 4, nomUsuel: 'Repris', qualiopiValideJusquau: null, nda: null, aVerifier: true, source: 'reprise' }), fiche({ id: 5, nomUsuel: 'Interne', type: 'interne', nda: null }),
    fiche({ id: 6, nomUsuel: 'Archivé', archive: '2026-01-01' }), fiche({ id: 7, nomUsuel: 'Fusionné', archive: '2026-01-01', fusionneDans: 1 }),
  ];
  assert.deepEqual(organismesASurveiller(liste, '2026-10-10', { organismeAlerteQualiopiJours: 60 }).map(a => [a.organisme.nomUsuel, a.etat, a.ndaManquant]),
    [['Échu', 'echu', false], ['Bientôt', 'a_echeance', false], ['Repris', 'a_verifier', true]]);
  const noms = (f: Parameters<typeof filtrerOrganismes>[1]) => filtrerOrganismes(liste, f, '2026-10-10', 60).map(o => o.nomUsuel);
  assert.deepEqual(noms('tous'), ['Bien', 'Bientôt', 'Échu', 'Interne', 'Repris']);
  assert.deepEqual(noms('a_verifier'), ['Repris']);
  assert.deepEqual(noms('qualiopi'), ['Bientôt', 'Échu', 'Repris']);
  assert.deepEqual(noms('nda'), ['Repris'], 'un service interne n’a pas de déclaration d’activité');
  assert.deepEqual(noms('archives'), ['Archivé'], 'une fiche fusionnée se lit depuis celle qui l’a absorbée');
});

test('exercices glissants : 3 par défaut, l’année en cours comprise', () => {
  assert.deepEqual(exercicesGlissants('2026-10-10'), [2024, 2025, 2026]);
  assert.deepEqual(exercicesGlissants('2026-10-10', 5), [2022, 2023, 2024, 2025, 2026]);
});

test('évaluations consolidées : par fiche de la session (figée), plusieurs exercices et cumul, masquées sous le seuil dans la vue agrégée', async () => {
  const { db, u, code } = await fresh();
  const croix = await code('CROIX-ROUGE-FRANCAISE'), inrs = await code('INRS');
  // Sessions SST clôturées en 2025 et 2026 avec la Croix-Rouge, présences et avis à chaud ; puis le catalogue passe à l'INRS.
  const session = async (date: string, presents: number[], notes: number[]) => {
    const s = await db.insert<{ id: number }>('sessions', {
      formation: 'sst', date, fin: date, jours: [date], horaires: [], lieu: 'Salle', places: 12, statut: 'Clôturée', planId: null, organismeId: croix,
      bilan: { le: date, par: 'RH', note: null, commentaire: null, motif: null },
    });
    for (const [k, empId] of presents.entries()) {
      const p = await db.insert<{ id: number }>('participations', { sessionId: s.id, empId, present: true, resultat: 'acquis', certId: null });
      if (notes[k] != null) {
        await db.insert('evaluationsFormation', {
          participationId: p.id, formationSuivieId: null, empId, type: 'chaud', repondant: 'salarie', note: notes[k], efficacite: null, commentaire: 'Très bien', le: date,
          saisiPar: null, recueilli: false,
        });
      }
    }
    return s.id;
  };
  await session('2025-03-10', [2, 3, 4], [4, 5, 3]);
  await session('2026-02-10', [5, 6], [2, 4]);
  await db.run(`UPDATE formations SET organisme_id = ?, organisme = 'INRS' WHERE id = 'sst'`, [inrs]);
  const full = await loadFull(db, u.gest);
  const d = new Domain(full);
  const tous = indicateursOrganismes(d, exercicesGlissants(d.ti));
  const x = tous.find(i => i.organismeId === croix)!;
  assert.ok(x, 'sessions comptées avec l’organisme figé à leur création, malgré le catalogue');
  assert.deepEqual(x.exercices.map(e => [e.exercice, e.sessions, e.ligne.participants, e.ligne.chaud, e.ligne.moyenneChaud]), [[2024, 0, 0, 0, null], [2025, 1, 3, 3, 4], [2026, 1, 2, 2, 3]]);
  assert.deepEqual([x.cumul.sessions, x.cumul.ligne.participants, x.cumul.ligne.moyenneChaud], [2, 5, 3.6]);
  assert.equal(x.horizon, 3);
  assert.ok(!tous.some(i => i.organismeId === inrs && i.cumul.ligne.participants > 0), 'rien ne bascule vers le nouvel organisme du catalogue');
  assert.deepEqual(comparatifFormation(tous, 'sst', croix)[0], { organismeId: croix, ligne: x.parFormation.find(f => f.formation === 'sst')!.ligne });
  // Vue agrégée : sous 3 réponses, ni moyenne (2026 : 2 avis) ; le cumul (5 avis) est masqué lui aussi, sinon il redonnerait
  // la moyenne de 2026 (5 × 3,6 − 3 × 4) ; 2025 (3 avis) reste lisible.
  const agregee = indicateursOrganismesAgreges(d, [3], SEUIL_ANONYMAT).find(i => i.organismeId === croix)!;
  assert.equal(agregee.exercices[2].ligne.moyenneChaud, null);
  assert.equal(agregee.exercices[2].ligne.masque, true);
  assert.equal(agregee.exercices[1].ligne.moyenneChaud, 4);
  assert.equal(agregee.cumul.ligne.moyenneChaud, null);
  assert.equal(indicateursOrganismes(d, exercicesGlissants(d.ti), SEUIL_ANONYMAT).find(i => i.organismeId === croix)!.cumul.ligne.moyenneChaud, 3.6,
    'masquage ligne par ligne seul : le cumul resterait lisible');
  // Instantané : le référent HSE et la lecture seule reçoivent les indicateurs calculés (3 et 5 exercices), sans aucun
  // avis nominatif ; le service RH les calcule lui-même ; manager et paie n'en reçoivent pas.
  for (const user of [u.hse, u.lecture]) {
    const s = await buildSnapshot(db, user);
    assert.deepEqual(s.evaluationsFormation, []);
    assert.deepEqual([...new Set(s.indicateursOrganismes!.map(i => i.horizon))].sort(), [3, 5]);
    const vue = indicateursOrganismesAffiches(new Domain(s), exercicesGlissants(s.today)).find(i => i.organismeId === croix)!;
    assert.equal(vue.exercices[2].ligne.moyenneChaud, null, 'masquée sous le seuil');
    assert.ok(!JSON.stringify(s.indicateursOrganismes).includes('Très bien'), 'jamais de commentaire');
  }
  assert.equal((await buildSnapshot(db, u.gest)).indicateursOrganismes, undefined);
  for (const user of [u.karim, u.paie]) assert.deepEqual((await buildSnapshot(db, user)).indicateursOrganismes ?? [], []);
});

type Indicateurs = import('../shared/rules/organismes-suivi.ts').IndicateursOrganisme;
type Ligne = import('../shared/types.ts').LigneEvaluation;

/**
 * Aucune soustraction entre lignes publiées ne redonne un groupe de 1 à 2 réponses : cumul moins exercices lisibles,
 * horizon long moins horizon court (cumul et formations), cumul moins formations lisibles ; pour les avis à chaud et à froid.
 */
function aucuneLigneRecalculable(liste: readonly Indicateurs[]) {
  const dims: [string, (l: Ligne) => number, (l: Ligne) => boolean][] = [
    ['chaud', l => l.chaud, l => l.chaud > 0 && l.moyenneChaud != null],
    ['froid', l => l.froid, l => l.froid > 0 && l.tauxEfficacite != null],
  ];
  const sous = (n: number) => n > 0 && n < SEUIL_ANONYMAT;
  for (const [nom, n, visible] of dims) {
    for (const x of liste) {
      for (const e of x.exercices) assert.ok(!(visible(e.ligne) && sous(n(e.ligne))), `${nom} : exercice ${e.exercice} lisible sous le seuil`);
      if (visible(x.cumul.ligne)) {
        assert.ok(!sous(x.exercices.reduce((k, e) => k + (n(e.ligne) > 0 && !visible(e.ligne) ? n(e.ligne) : 0), 0)), `${nom} : cumul moins exercices (${x.horizon})`);
        assert.ok(!sous(n(x.cumul.ligne) - x.parFormation.reduce((k, f) => k + (visible(f.ligne) ? n(f.ligne) : 0), 0)), `${nom} : cumul moins formations (${x.horizon})`);
      } else if (n(x.cumul.ligne) > 0 && x.parFormation.some(f => visible(f.ligne))) {
        assert.notEqual(x.parFormation.reduce((k, f) => k + (visible(f.ligne) ? n(f.ligne) : 0), 0), n(x.cumul.ligne), `${nom} : cumul masqué recomposé par les formations (${x.horizon})`);
      }
      for (const y of liste.filter(y => y.organismeId === x.organismeId && y.horizon > x.horizon)) {
        if (visible(x.cumul.ligne) && visible(y.cumul.ligne)) assert.ok(!sous(n(y.cumul.ligne) - n(x.cumul.ligne)), `${nom} : cumul ${y.horizon} moins cumul ${x.horizon}`);
        for (const f of y.parFormation) {
          const c = x.parFormation.find(g => g.formation === f.formation);
          if (c && visible(c.ligne) && visible(f.ligne)) assert.ok(!sous(n(f.ligne) - n(c.ligne)), `${nom} : ${f.formation} ${y.horizon} moins ${x.horizon}`);
        }
      }
    }
  }
}

test('évaluations consolidées, vue agrégée : aucune ligne masquée ne se recalcule par différence (cumul, horizons, formations)', async () => {
  const { db, u, code } = await fresh();
  const croix = await code('CROIX-ROUGE-FRANCAISE');
  // Session SST de la Croix-Rouge, présences, avis à chaud (note) et à froid (efficacité).
  const session = async (date: string, avis: [number, number, 'efficace' | 'partielle' | 'non'][]) => {
    const s = await db.insert<{ id: number }>('sessions', {
      formation: 'sst', date, fin: date, jours: [date], horaires: [], lieu: 'Salle', places: 12, statut: 'Clôturée', planId: null, organismeId: croix,
      bilan: { le: date, par: 'RH', note: null, commentaire: null, motif: null },
    });
    for (const [empId, note, efficacite] of avis) {
      const p = await db.insert<{ id: number }>('participations', { sessionId: s.id, empId, present: true, resultat: 'acquis', certId: null });
      const ev = { participationId: p.id, formationSuivieId: null, empId, repondant: 'salarie', commentaire: null, le: date, saisiPar: null, recueilli: false };
      await db.insert('evaluationsFormation', { ...ev, type: 'chaud', note, efficacite: null });
      await db.insert('evaluationsFormation', { ...ev, type: 'froid', note: null, efficacite });
    }
  };
  // Cas 3 + 1 : 2025, trois avis (4, 5, 3 ; efficaces) ; 2026, un seul stagiaire (emp 5 : 1, « non »).
  await session('2025-03-10', [[2, 4, 'efficace'], [3, 5, 'efficace'], [4, 3, 'efficace']]);
  await session('2026-02-10', [[5, 1, 'non']]);
  // 2023 (hors des 3 exercices, dans les 5) : un seul avis ; l'écart entre les deux horizons porterait sur lui.
  await session('2023-05-10', [[6, 2, 'partielle']]);
  const d = new Domain(await loadFull(db, u.gest));
  const brut = indicateursOrganismes(d, exercicesGlissants(d.ti), SEUIL_ANONYMAT).find(i => i.organismeId === croix)!;
  assert.deepEqual([brut.cumul.ligne.chaud, brut.cumul.ligne.non], [4, 1], 'sans masquage complémentaire, 2026 = cumul − 2025');
  const liste = indicateursOrganismesAgreges(d, [3, 5], SEUIL_ANONYMAT);
  aucuneLigneRecalculable(liste);
  const trois = liste.find(i => i.organismeId === croix && i.horizon === 3)!, cinq = liste.find(i => i.organismeId === croix && i.horizon === 5)!;
  assert.equal(trois.exercices.find(e => e.exercice === 2025)!.ligne.moyenneChaud, 4, 'un exercice d’au moins 3 avis reste lisible');
  assert.equal(trois.exercices.find(e => e.exercice === 2025)!.ligne.efficaces, 3);
  for (const x of [trois, cinq]) {
    assert.equal(x.cumul.ligne.moyenneChaud, null);
    assert.deepEqual([x.cumul.ligne.non, x.cumul.ligne.tauxEfficacite], [0, null]);
    assert.equal(x.parFormation.find(f => f.formation === 'sst')!.ligne.moyenneChaud, null, 'la formation n’est que le cumul');
  }
  // Instantané du référent HSE et de la lecture seule : même garantie.
  for (const user of [u.hse, u.lecture]) aucuneLigneRecalculable((await buildSnapshot(db, user)).indicateursOrganismes!);
});

test('session.creer : un choix d’organisme vide fige celui du catalogue, qui peut changer ensuite', async () => {
  const { db, u, run, code } = await fresh();
  const inrs = await code('INRS');
  const avant = (await db.one<{ organisme_id: number | null }>(`SELECT organisme_id FROM formations WHERE id = 'sst'`))!.organisme_id;
  assert.ok(avant != null && avant !== inrs, 'le catalogue SST indique une fiche');
  for (const organismeId of ['', null]) {
    const r = await run(u.gest, 'session.creer', { f: 'sst', date: '2026-12-01', lieu: 'Salle B', places: 8, organismeId });
    assert.equal((await db.one<{ organisme_id: number | null }>('SELECT organisme_id FROM sessions WHERE id = ?', [r.result.id]))!.organisme_id, avant, `organismeId ${JSON.stringify(organismeId)}`);
  }
  // Le catalogue passe à l'INRS : les sessions créées gardent leur organisme.
  await db.run(`UPDATE formations SET organisme_id = ?, organisme = 'INRS' WHERE id = 'sst'`, [inrs]);
  const full = await loadFull(db, u.gest);
  assert.ok(full.sessions.filter(x => x.date === '2026-12-01' && x.formation === 'sst').every(x => x.organismeId === avant));
});

test('plan : organisme prévu choisi par plan.modifier (motif, journal), retour au catalogue, marque Qualiopi de Plan & budget', async () => {
  const { db, u, run, code } = await fresh();
  const socotec = await code('SOCOTEC');
  const l = (await db.one<{ id: number }>(`SELECT id FROM plan_actions WHERE statut = 'prevu' AND f IS NOT NULL ORDER BY id LIMIT 1`))!;
  await assert.rejects(async () => await run(u.gest, 'plan.modifier', { id: l.id, organismeId: socotec, motif: '' }), (e: unknown) => e instanceof ActionError && /Motif/.test(e.message));
  const m = await run(u.gest, 'plan.modifier', { id: l.id, organismeId: socotec, motif: 'Prestataire changé' });
  assert.match(m.message!, /organisme : SOCOTEC/, 'le code de la fiche, jamais son nom usuel');
  assert.equal((await db.one<{ organisme_id: number }>('SELECT organisme_id FROM plan_actions WHERE id = ?', [l.id]))!.organisme_id, socotec);
  const j = (await db.query<{ payload: string; message: string | null }>(`SELECT payload, message FROM journal WHERE action = 'plan.modifier' ORDER BY id DESC LIMIT 1`))[0];
  const payload = typeof j.payload === 'string' ? JSON.parse(j.payload) : j.payload;
  assert.ok(!`${j.message} ${JSON.stringify(payload)}`.includes('Socotec'), 'jamais le nom usuel de la fiche au journal');
  assert.ok(!JSON.stringify(payload).includes('Prestataire changé'), 'jamais le motif');
  assert.ok(JSON.stringify(payload).includes('organismeId'), 'le changement d’organisme est tracé');
  // Socotec échu le 30 septembre 2026 : marque de la ligne.
  const full = await loadFull(db, u.gest);
  assert.match(avertissementsPlan(full, full.plan.find(x => x.id === l.id)!, full.today).join(' '), /Qualiopi échue/);
  await run(u.gest, 'plan.modifier', { id: l.id, organismeId: '', motif: 'Retour au catalogue' });
  assert.equal((await db.one<{ organisme_id: number | null }>('SELECT organisme_id FROM plan_actions WHERE id = ?', [l.id]))!.organisme_id, null);
  // Sans changement d'organisme ni d'autre champ : aucune modification.
  assert.equal((await run(u.gest, 'plan.modifier', { id: l.id, organismeId: '', motif: 'x' })).message, 'Aucune modification');
});

test('onglet E-learning : filtres des inscriptions (en cours, fins à valider, terminées), jamais une inscription supprimée', async () => {
  const { db, u } = await fresh();
  const s = await buildSnapshot(db, u.gest);
  const l = s.inscriptionsElearning ?? [];
  assert.deepEqual(filtrerInscriptions(l, 'ouvertes').map(i => i.empId).sort(), [2, 3, 6]);
  assert.deepEqual(filtrerInscriptions(l, 'a_valider').map(i => i.empId), [6], 'fin déclarée par Thomas Garnier');
  assert.deepEqual(filtrerInscriptions(l, 'terminees'), []);
  assert.deepEqual(filtrerInscriptions([{ ...l[0], annuleLe: '2026-10-09' }], 'toutes'), []);
});

test('récapitulatif des échéances : Qualiopi à renouveler et échu à la seule boîte du service RH, une fois par palier', async () => {
  const { db, u, run } = await fresh();
  const { recapitulatifEcheances } = await import('../server/src/relances.ts');
  await run(u.admin, 'messagerie.regler', { rh: 'rh@entreprise.example' });
  await db.tx(async () => await recapitulatifEcheances(db));
  const envois = (await db.all<Record<string, any>>('envois')).filter(x => x.type === 'echeances.recapitulatif');
  const rh = envois.filter(e => e.contenu.a[0] === 'rh@entreprise.example').map(e => e.contenu.texte as string).join('\n');
  assert.match(rh, /Certification Qualiopi de AFTRAL \(AFTRAL\) : fin de validité : échéance le/);
  assert.match(rh, /Certification Qualiopi de Socotec \(SOCOTEC\) : fin de validité : dépassée depuis le/);
  for (const e of envois.filter(x => x.contenu.a[0] !== 'rh@entreprise.example')) assert.doesNotMatch(e.contenu.texte, /Qualiopi/, 'ni manager ni référent');
  const cles = (await db.query<{ cle: string }>(`SELECT cle FROM relances WHERE cle LIKE 'organisme:%'`)).map(r => r.cle).sort();
  assert.equal(cles.length, 2);
  // Second passage le même jour : rien de nouveau.
  assert.equal((await db.tx(async () => await recapitulatifEcheances(db))).relances, 0);
});

test('adresse : onglets Organismes et E-learning, fiche ouverte et filtres', async () => {
  const { lireUrl, adresse } = await import('../client/src/state/url.ts');
  const data = { referentiels: { formations: [] }, organismes: [fiche({ id: 4 })] } as never;
  assert.deepEqual(lireUrl('referentiels', '?onglet=organismes&organisme=4&filtre=a-verifier', data), { refOnglet: 'organismes', orgSel: 4, orgFiltre: 'a_verifier' });
  assert.deepEqual(lireUrl('referentiels', '?onglet=modules-elearning&organisme=9', data), { refOnglet: 'modules', orgSel: null, orgFiltre: 'tous' });
  assert.match(adresse('formations', { formOnglet: 'elearning', elFiltre: 'a_valider' } as never), /onglet=e-learning&inscriptions=a-valider/);
});
