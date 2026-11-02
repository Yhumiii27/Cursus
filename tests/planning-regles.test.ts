// Planning d'équipe (lot 12, chantier C5, étape 1) : règles pures. Cycles (séquence, groupes, indicateurs, modèles
// amorcés), génération (fériés, sortie, brouillons gardés), heure de Paris aux nuits du changement d'heure, contrôles sur
// plusieurs semaines (repos quotidien de la loi ou de l'accord, jamais réduit pour un mineur ; repos hebdomadaire de 35 h
// exactes ; 6 jours ; dimanche ; 10 h, 48 h, 44 h sur 12 semaines ; travailleur de nuit ; nuit d'un mineur ; sortie),
// habilitations à la date du créneau et réserve d'aptitude neutre, délai de prévenance, verrous de la publication, échanges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { configurerFeries } = await import('../shared/dates.ts');
const cycles = await import('../shared/rules/cycles.ts');
const planning = await import('../shared/rules/planning.ts');
const ctl = await import('../shared/rules/planning-controles.ts');
const { HORAIRES_EXEMPLES } = await import('../shared/rules/horaires.ts');
const { appliquerReglages, ReglageInvalide } = await import('../shared/reglages.ts');
const { DEFAULT_SETTINGS } = await import('../server/src/dataset.ts');
type Creneau = import('../shared/types-planning.ts').Creneau;
type HoraireFige = import('../shared/types.ts').HoraireFige;

const H: Record<string, HoraireFige> = Object.fromEntries(HORAIRES_EXEMPLES.map(h => [h.code, { code: h.code, debut: h.debut, fin: h.fin, pause: h.pause }]));
const horaires = HORAIRES_EXEMPLES.map(h => ({ ...h, archive: null }));
const MAJEUR = { id: 1, nom: 'Paul Martin', entree: '2020-01-01', fin: null, typeContrat: 'cdi' as const, naissance: 1990 };
/** Jours planifiés d'une suite de codes à partir d'un jour (« » : repos). */
const suite = (du: string, codes: (string | HoraireFige)[]) => codes.map((c, i) => {
  const d = new Date(`${du}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
  return { jour: d.toISOString().slice(0, 10), horaire: typeof c === 'string' ? (c ? H[c] : null) : c };
});
const codes = (a: readonly { code: string }[]) => a.map(x => x.code).sort();
const controler = (jours: ReturnType<typeof suite>, o: Partial<Parameters<typeof ctl.controlesPlanning>[0]> = {}) =>
  ctl.controlesPlanning({ employe: MAJEUR, jours, du: jours[0].jour, au: jours.at(-1)!.jour, reglages: DEFAULT_SETTINGS, derogationDominicale: false, ...o });

// — Cycles —

test('cycles : modèles amorcés, poste du jour par groupe d’après l’origine, quel que soit le jour d’affectation', () => {
  assert.deepEqual(cycles.CYCLES_MODELES.map(c => c.code), ['JOUR', '2X8', '3X8', '5X8']);
  const deux = cycles.CYCLES_MODELES.find(c => c.code === '2X8')!;
  assert.equal(cycles.horaireDuCycle(deux, 'A', '2027-01-04'), 'M');
  assert.equal(cycles.horaireDuCycle(deux, 'B', '2027-01-04'), 'AM');
  assert.equal(cycles.horaireDuCycle(deux, 'A', '2027-01-09'), null, 'samedi : repos');
  assert.equal(cycles.horaireDuCycle(deux, 'A', '2027-01-11'), 'AM', 'semaine suivante : l’autre poste');
  assert.equal(cycles.horaireDuCycle(deux, 'A', '2026-12-28'), 'AM', 'avant l’origine : la séquence se prolonge à rebours');
  assert.equal(cycles.horaireDuCycle(deux, 'Z', '2027-01-04'), null, 'groupe inconnu');
  const cinq = cycles.CYCLES_MODELES.find(c => c.code === '5X8')!;
  assert.deepEqual(['A', 'B', 'C', 'D', 'E'].map(g => cycles.horaireDuCycle(cinq, g, '2027-01-04')), ['M', null, null, 'N', 'AM'], 'feu continu : chaque groupe à son rang');
});

test('cycles : indicateurs (heures par semaine en moyenne, nuits, dimanches) et alerte au-delà de 44 h ou du contrat', () => {
  const nuit = { nuitDebut: 21, nuitFin: 6 };
  const trois = cycles.indicateursCycle(cycles.CYCLES_MODELES.find(c => c.code === '3X8')!, horaires, nuit, 35);
  assert.equal(trois.heuresSemaine, 37.5);
  assert.equal(trois.dimanches, 0);
  assert.equal(trois.nuitsSemaine, 3.33, 'matin (5 h – 6 h) et nuit');
  assert.equal(trois.alertes.length, 1, 'au-delà de 35 h contractuelles');
  assert.equal(cycles.indicateursCycle(cycles.CYCLES_MODELES.find(c => c.code === '5X8')!, horaires, nuit).heuresSemaine, 31.5);
  const lourd = { longueur: 7, sequence: ['J', 'J', 'J', 'J', 'J', 'J', null], origine: '2027-01-04' };
  const gros = cycles.indicateursCycle(lourd, [{ code: 'J', nom: 'Long', debut: '06:00', fin: '14:00', pause: 0, archive: null }], nuit);
  assert.equal(gros.heuresSemaine, 48);
  assert.match(gros.alertes[0], /plus de 44 h en moyenne/);
});

test('cycles : contrôles de saisie (code unique, séquence de la longueur, horaires en vigueur, groupes distincts)', () => {
  const base = { code: 'essai', nom: ' Essai ', longueur: 7, sequence: ['J', 'J', 'J', 'J', 'J', '', '-'], groupes: [{ code: 'a', decalage: 0 }] };
  const ok = cycles.controlerCycle(base, [], horaires, null);
  assert.deepEqual(ok.valeurs, { code: 'ESSAI', nom: 'Essai', longueur: 7, sequence: ['J', 'J', 'J', 'J', 'J', null, null], groupes: [{ code: 'A', decalage: 0 }], origine: cycles.ORIGINE_MODELES });
  const erreur = (p: object, existants: object[] = []) => Object.values(cycles.controlerCycle({ ...base, ...p }, existants as never, horaires, null).erreurs)[0];
  assert.match(erreur({}, [{ code: 'ESSAI' }]) ?? '', /existe déjà/);
  assert.match(erreur({ sequence: ['J', 'J'] }) ?? '', /2 jours au lieu de 7/);
  assert.match(erreur({ sequence: ['X', 'J', 'J', 'J', 'J', '', ''] }) ?? '', /inconnu ou archivé : X/);
  assert.match(erreur({ sequence: ['', '', '', '', '', '', ''] }) ?? '', /au moins un jour travaillé/);
  assert.match(erreur({ groupes: [{ code: 'A', decalage: 0 }, { code: 'B', decalage: 0 }] }) ?? '', /même décalage/);
  assert.match(erreur({ groupes: [{ code: 'A', decalage: 9 }] }) ?? '', /de 0 à 6/);
  assert.match(erreur({ longueur: 99 }) ?? '', /de 1 à 70/);
  assert.equal(cycles.roulementsDuCycle([{ cycle: 'ESSAI', au: null }, { cycle: 'ESSAI', au: '2026-01-01' }] as never, 'ESSAI', '2026-10-10').length, 1, 'affectation finie : n’empêche plus l’archivage');
});

// — Génération —

test('génération : poste du cycle par groupe, repos un jour férié chômé (le cycle continue avec une dérogation), rien hors contrat', () => {
  configurerFeries({});
  const x = {
    equipe: 'Production', du: '2026-12-28', au: '2027-01-08', cycles: cycles.CYCLES_MODELES.map(c => ({ ...c, archive: null, creeLe: '', creePar: '' })), horaires,
    roulements: [
      { id: 1, empId: 1, cycle: 'JOUR', groupe: 'A', du: '2026-12-28', au: null, equipe: 'Production' },
      { id: 2, empId: 2, cycle: '2X8', groupe: 'B', du: '2027-01-04', au: '2027-01-05', equipe: 'Production' },
      { id: 3, empId: 3, cycle: 'JOUR', groupe: 'A', du: '2026-12-28', au: null, equipe: 'Logistique' },
    ] as never,
    employes: [{ ...MAJEUR, fin: '2027-01-06' }, { ...MAJEUR, id: 2 }, { ...MAJEUR, id: 3 }],
  };
  const g = planning.genererCreneaux({ ...x, derogation: false });
  const de = (empId: number) => g.creneaux.filter(c => c.empId === empId).map(c => [c.jour.slice(5), c.horaire] as const);
  assert.deepEqual(de(1), [['12-28', 'J'], ['12-29', 'J'], ['12-30', 'J'], ['12-31', 'J'], ['01-01', null], ['01-02', null], ['01-03', null], ['01-04', 'J'], ['01-05', 'J'], ['01-06', 'J']],
    'le 1er janvier chômé ; plus rien après la sortie du 6 janvier');
  assert.ok(g.creneaux.find(c => c.jour === '2027-01-01')!.ferie);
  assert.deepEqual(de(2), [['01-04', 'AM'], ['01-05', 'AM']], 'affectation bornée');
  assert.deepEqual(de(3), [], 'autre équipe');
  const continu = planning.genererCreneaux({ ...x, derogation: true });
  assert.equal(continu.creneaux.find(c => c.empId === 1 && c.jour === '2027-01-01')!.horaire, 'J', 'travail en continu : le férié se travaille');
  assert.deepEqual(planning.genererCreneaux({ ...x, cycles: [], derogation: false }).ignores[0].raison, 'cycle JOUR archivé ou inconnu');
  // Existant : un brouillon généré se remplace, un publié ou une correction à la main se garde.
  assert.equal(planning.sortGenere(undefined), 'inserer');
  assert.equal(planning.sortGenere({ statut: 'brouillon', source: 'cycle' }), 'remplacer');
  assert.equal(planning.sortGenere({ statut: 'brouillon', source: 'manuel' }), 'garder');
  assert.equal(planning.sortGenere({ statut: 'publie', source: 'cycle' }), 'garder');
});

// — Heure de Paris —

test('heure de Paris : poste de nuit de 7 h en mars, de 9 h en octobre ; heure qui n’existe pas, heure vécue deux fois', () => {
  const n = H.N; // 21 h – 5 h, pause 30 min
  assert.equal(ctl.heuresReelles(ctl.plageReelle('2027-03-27', n)), 6.5, 'nuit du 27 au 28 mars 2027 : 7 h d’amplitude');
  assert.equal(ctl.heuresReelles(ctl.plageReelle('2026-10-24', n)), 8.5, 'nuit du 24 au 25 octobre 2026 : 9 h d’amplitude');
  assert.equal(ctl.heuresReelles(ctl.plageReelle('2026-11-07', n)), 7.5, 'nuit ordinaire');
  assert.equal(ctl.instantParis('2026-07-01', '12:00') * 60_000, Date.parse('2026-07-01T10:00:00Z'), 'été : UTC + 2');
  assert.equal(ctl.instantParis('2026-12-01', '12:00') * 60_000, Date.parse('2026-12-01T11:00:00Z'), 'hiver : UTC + 1');
  assert.equal(ctl.instantParis('2027-03-28', '02:30') * 60_000, Date.parse('2027-03-28T01:30:00Z'), '2 h 30 n’existe pas : 3 h 30 d’été');
  assert.equal(ctl.instantParis('2026-10-25', '02:30') * 60_000, Date.parse('2026-10-25T00:30:00Z'), '2 h 30 vécue deux fois : la première');
  assert.equal(ctl.instantParis('2026-10-25', '03:30') * 60_000, Date.parse('2026-10-25T02:30:00Z'));
  // Repos compté en temps réel : de l'après-midi (fin 21 h) au matin (5 h), 8 h d'ordinaire, 7 h la nuit du passage à l'été.
  const repos = (du: string) => controler(suite(du, ['AM', 'M'])).find(a => a.code === 'repos_quotidien')!.texte;
  assert.match(repos('2027-03-27'), /7 h avant la prise de poste/);
  assert.match(repos('2026-10-24'), /9 h avant la prise de poste/);
  assert.match(repos('2026-11-07'), /8 h avant la prise de poste/);
});

// — Contrôles —

test('repos quotidien d’un mineur : 12 h (14 h avant 16 ans), l’accord ne le réduit jamais', () => {
  const accord = { ...DEFAULT_SETTINGS, planningReposQuotidienAccord: 9, planningAccord: 'Accord du 3 mars 2026' };
  const tot = { code: 'T6', debut: '06:00', fin: '12:00', pause: 30 };
  const jours = suite('2026-11-09', ['J', tot]); // 16 h → 6 h : 14 h
  const de17 = { ...MAJEUR, naissance: 2009, naissanceLe: '2009-03-01' }, de15 = { ...MAJEUR, naissance: 2011, naissanceLe: '2011-03-01' };
  assert.deepEqual(codes(controler(jours, { employe: de17, reglages: accord })), [], '14 h ≥ 12 h');
  assert.deepEqual(codes(controler(suite('2026-11-09', ['AM', tot]), { employe: de17, reglages: accord })), ['repos_quotidien'], '9 h : l’accord ne vaut pas pour un mineur');
  const tard = { code: 'T', debut: '08:00', fin: '16:30', pause: 30 };
  assert.deepEqual(codes(controler(suite('2026-11-09', [tard, tot]), { employe: de15 })), ['repos_quotidien'], '13 h 30 < 14 h avant 16 ans');
  assert.deepEqual(codes(controler(suite('2026-11-09', [tard, tot]), { employe: de17 })), [], '13 h 30 ≥ 12 h');
});

test('repos quotidien de l’accord : 9 h au moins, compensation signalée ; sinon la loi', () => {
  const tot = { code: 'T7', debut: '07:00', fin: '15:00', pause: 30 };
  const jours = suite('2026-11-09', ['AM', tot]); // 21 h → 7 h : 10 h de repos
  assert.deepEqual(codes(controler(jours)), ['repos_quotidien']);
  const accord = { ...DEFAULT_SETTINGS, planningReposQuotidienAccord: 9, planningAccord: 'Accord du 3 mars 2026' };
  const reduit = controler(jours, { reglages: accord });
  assert.deepEqual(reduit.map(a => [a.code, a.gravite]), [['repos_reduit', 'info']]);
  assert.match(reduit[0].texte, /réduit à 10 h par l’accord : un repos équivalent est dû en compensation/);
  assert.deepEqual(codes(controler(suite('2026-11-09', ['AM', 'M']), { reglages: accord })), ['repos_quotidien'], '8 h : sous l’accord aussi');
  // Réglage : 9 h au moins, référence de l'accord exigée en dessous de 11 h.
  assert.equal(appliquerReglages(DEFAULT_SETTINGS, { planningReposQuotidienAccord: 6, planningAccord: 'Accord' }).planningReposQuotidienAccord, 9);
  assert.throws(() => appliquerReglages(DEFAULT_SETTINGS, { planningReposQuotidienAccord: 10 }), (e: unknown) => e instanceof ReglageInvalide && /accord collectif/.test(e.message));
  assert.throws(() => appliquerReglages(DEFAULT_SETTINGS, { planningDelaiPrevenance: 3 }), ReglageInvalide);
  assert.equal(appliquerReglages(DEFAULT_SETTINGS, { planningNuitJour: 10, planningAccord: 'Accord nuit' }).planningNuitJour, 10);
});

test('semaine : 6 jours au plus, repos de 35 h exactes, dimanche sans dérogation ; 10 h, 48 h, moyenne de 44 h (information)', () => {
  const sept = controler(suite('2026-11-09', ['J', 'J', 'J', 'J', 'J', 'J', 'J']));
  // Sept jours de 7 h : 49 h (plus de 48 h, moyenne au-delà de 44 h).
  assert.deepEqual(codes(sept), ['dimanche', 'duree_semaine', 'jours_semaine', 'moyenne_12', 'repos_hebdo']);
  assert.deepEqual(codes(controler(suite('2026-11-09', ['J', 'J', 'J', 'J', 'J', 'J', 'J']), { derogationDominicale: true })), ['duree_semaine', 'jours_semaine', 'moyenne_12', 'repos_hebdo'], 'dérogation de l’équipe');
  assert.deepEqual(codes(controler(suite('2026-11-09', ['J', 'J', 'J', 'J', 'J', 'J', '']))), [], 'six jours, le dimanche et la nuit qui suit : repos de 40 h');
  // Repos de 35 h exactes : du samedi 16 h au lundi 3 h (35 h) suffit ; au lundi 2 h 59 (34 h 59), non.
  const lundi = (debut: string) => ({ code: 'L', debut, fin: '11:00', pause: 30 });
  const semaine = (debut: string) => suite('2026-11-08', ['J', 'J', 'J', 'J', 'J', 'J', 'J', '', lundi(debut)]);
  const autour = (debut: string) => ctl.controlesPlanning({ employe: MAJEUR, jours: semaine(debut), du: '2026-11-09', au: '2026-11-15', reglages: DEFAULT_SETTINGS, derogationDominicale: false });
  assert.deepEqual(codes(autour('03:00')), []);
  assert.deepEqual(codes(autour('02:59')), ['repos_hebdo']);
  const long = { code: 'L12', debut: '06:00', fin: '18:00', pause: 60 }; // 11 h
  const lourde = controler(suite('2026-11-09', [long, long, long, long, long, '', '']));
  assert.deepEqual([...new Set(codes(lourde))], ['duree_jour', 'duree_semaine', 'moyenne_12']);
  assert.equal(lourde.find(a => a.code === 'moyenne_12')!.gravite, 'info');
  assert.equal(lourde.filter(a => a.code === 'duree_jour').length, 5);
  assert.deepEqual(codes(controler(suite('2026-11-09', [long, long, long, long, long, '', '']), { dureesExclues: true })), [], 'cadre dirigeant, forfait jours');
});

test('travailleur de nuit : 8 h par poste de nuit (12 h par accord) ; mineur la nuit et poste hors contrat refusés', () => {
  const longue = { code: 'NL', debut: '20:00', fin: '06:00', pause: 30 }; // 9 h 30
  const nuits = suite('2026-11-09', [longue, '', longue, '', '', '', '']);
  const a = controler(nuits);
  assert.deepEqual(codes(a), ['nuit_jour', 'nuit_jour'], 'deux nuits dans la semaine : travailleur de nuit d’après le planning');
  assert.deepEqual(codes(controler(suite('2026-11-09', [longue, '', '', '', '', '', '']))), [], 'une nuit isolée');
  assert.deepEqual(codes(controler(suite('2026-11-09', [longue, '', '', '', '', '', '']), { travailleurNuit: true })), ['nuit_jour'], 'travailleur de nuit d’après les feuilles');
  assert.deepEqual(codes(controler(nuits, { reglages: { ...DEFAULT_SETTINGS, planningNuitJour: 10, planningAccord: 'Accord' } })), [], 'accord : 10 h');
  const mineur = controler(suite('2026-11-09', ['N']), { employe: { ...MAJEUR, naissance: 2010, naissanceLe: '2010-03-01' } });
  assert.deepEqual(mineur.map(x => [x.code, x.gravite]), [['nuit_mineur', 'refus']]);
  const sorti = controler(suite('2026-11-09', ['J', 'J']), { employe: { ...MAJEUR, fin: '2026-11-09' } });
  assert.deepEqual(sorti.map(x => [x.code, x.gravite, x.jour]), [['sortie', 'refus', '2026-11-10']]);
  // Absence en vigueur : ni travail, ni contrôle.
  assert.deepEqual(codes(controler(suite('2026-11-09', ['AM', 'M']), { absents: new Set(['2026-11-10']) })), []);
});

test('contrôles sur plusieurs semaines : fenêtre glissante (repos au passage de semaine, moyenne des semaines connues), mémoïsés', () => {
  // Dimanche après-midi puis lundi matin : le repos se compte par-dessus la semaine.
  const jours = suite('2026-11-15', ['AM', 'M']);
  const a = ctl.controlesPlanning({ employe: MAJEUR, jours, du: '2026-11-16', au: '2026-11-22', reglages: DEFAULT_SETTINGS, derogationDominicale: true });
  assert.deepEqual(codes(a), ['repos_quotidien']);
  assert.equal(a[0].jour, '2026-11-16');
  // Même liste de jours (identité) : alertes de la semaine reprises du mémo.
  const b = ctl.controlesPlanning({ employe: MAJEUR, jours, du: '2026-11-16', au: '2026-11-22', reglages: DEFAULT_SETTINGS, derogationDominicale: true });
  assert.equal(b.find(x => x.portee === 'semaine'), a.find(x => x.portee === 'semaine'));
  // Moyenne sur les semaines planifiées : 8 semaines à 46 h 30 → information.
  const long = { code: 'L', debut: '06:00', fin: '15:18', pause: 0 }; // 9 h 18
  const huit = Array.from({ length: 8 }, () => [long, long, long, long, long, '', '']).flat();
  const m = ctl.controlesPlanning({ employe: MAJEUR, jours: suite('2026-09-21', huit), du: '2026-11-09', au: '2026-11-15', reglages: DEFAULT_SETTINGS, derogationDominicale: false });
  assert.match(m.find(x => x.code === 'moyenne_12')!.texte, /46,5 h en moyenne sur 8 semaines planifiées|46 h 30 en moyenne sur 8 semaines planifiées/);
  // Portée : une alerte de semaine vaut pour tous les créneaux de la semaine.
  assert.equal(ctl.alertesDuJour(m, 1, '2026-11-11').length, m.filter(x => x.jour === '2026-11-09' && x.portee === 'semaine').length);
});

test('habilitations à la date du créneau : absente, retirée, suspendue → refus ; expirée pendant la période, formation → alerte ; aptitude neutre', () => {
  const d = (s: string) => new Date(`${s}T00:00:00`);
  const e = {
    id: 7,
    habs: [
      { h: 'elec', key: 'ok', mesure: null, exp: d('2026-11-12') },
      { h: 'caces', key: 'ok', mesure: 'suspension', exp: d('2028-01-01') },
      { h: 'nacelle', key: 'susp', mesure: null, exp: d('2028-01-01') },
      { h: 'pont', key: 'pending', mesure: null, exp: null },
      { h: 'atex', key: 'exp', mesure: null, exp: d('2026-10-01') },
    ],
    rawCerts: [{ id: 1, f: 'sst', obtenue: '2024-11-11', exp: d('2026-11-11') }],
    med: { ok: true, restrictions: [] },
  } as never;
  const noms = { habilitation: (id: string) => id.toUpperCase(), formation: (id: string) => id.toUpperCase() };
  const jour = (j: string, habilitations: string[], formations: string[] = []) => ({ jour: j, exigences: { habilitations, formations } });
  const a = ctl.alertesHabilitations(e, [jour('2026-11-10', ['elec']), jour('2026-11-13', ['elec', 'caces', 'nacelle', 'pont', 'atex', 'grue'], ['sst'])], '2026-11-09', '2026-10-10', noms);
  assert.deepEqual(a.map(x => [x.jour, x.code, x.gravite]), [
    ['2026-11-13', 'habilitation_expire', 'alerte'],
    ['2026-11-13', 'habilitation', 'refus'], ['2026-11-13', 'habilitation', 'refus'], ['2026-11-13', 'habilitation', 'refus'], ['2026-11-13', 'habilitation', 'refus'], ['2026-11-13', 'habilitation', 'refus'],
    ['2026-11-13', 'formation', 'alerte'],
  ]);
  assert.deepEqual(a.filter(x => x.code === 'habilitation').map(x => x.texte.replace(/^.* : habilitation exigée /, '')),
    ['CACES suspendue', 'NACELLE suspendue', 'PONT en attente de délivrance', 'ATEX expirée le 1 oct. 2026', 'GRUE non détenue']);
  // Aptitude : une seule réserve neutre, sans date ni restriction, pour toute la période.
  const inapte = ctl.alertesHabilitations({ ...(e as object), med: { ok: false, restrictions: [] } } as never, [jour('2026-11-10', []), jour('2026-11-11', [])], '2026-11-09', '2026-10-10', noms);
  assert.deepEqual(inapte.map(x => [x.code, x.portee, x.texte]), [['aptitude', 'periode', ctl.APTITUDE_PLANNING]]);
  assert.doesNotMatch(inapte[0].texte, /\d/);
  const restreint = ctl.alertesHabilitations({ ...(e as object), med: { ok: true, restrictions: [{ texte: 'Pas de port de charges', jusquau: '2026-10-01' }] } } as never, [jour('2026-11-10', [])], '2026-11-09', '2026-10-10', noms);
  assert.deepEqual(restreint, [], 'restriction échue aujourd’hui : rien (jamais projetée sur la date du créneau)');
  assert.ok(ctl.CODES_RESERVES.includes('aptitude'));
  assert.deepEqual(ctl.codesAcceptes([...a, ...inapte], 7, '2026-11-13'), ['habilitation_expire', 'formation', 'aptitude']);
});

// — Publication, échanges, affectations —

test('habilitations : prérequis de formation échu à la date du créneau ; échéance comparée à la partie à venir de la période', () => {
  const d = (s: string) => new Date(`${s}T00:00:00`);
  const noms = { habilitation: (id: string) => id.toUpperCase(), formation: (id: string) => id.toUpperCase() };
  const jour = (j: string) => ({ jour: j, exigences: { habilitations: ['elec'], formations: [] } });
  const avec = (prereqExp: string, exp = '2028-01-01') => ({
    id: 7, rawCerts: [], med: { ok: true, restrictions: [] },
    habs: [{ h: 'elec', key: 'ok', mesure: null, exp: d(exp), checks: [
      { type: 'cert', label: 'SST', ok: true, exp: d(prereqExp) },
      // Prérequis médical : jamais lu à la date du créneau (il révélerait l'échéance de la visite).
      { type: 'med', label: 'Aptitude médicale', ok: true, exp: d('2026-10-20') },
    ] }],
  }) as never;
  // Prérequis échu le 1er novembre : créneau du 5 novembre publié dès aujourd'hui → alerte « suspendue pendant la période ».
  const a = ctl.alertesHabilitations(avec('2026-11-01'), [jour('2026-10-30'), jour('2026-11-05')], '2026-10-26', '2026-10-10', noms);
  assert.deepEqual(a.map(x => [x.jour, x.code, x.gravite]), [['2026-11-05', 'habilitation_expire', 'alerte']]);
  assert.match(a[0].texte, /suspendue dès l’échéance de son prérequis SST le 1 nov\. 2026/);
  // Période qui commence après l'échéance du prérequis : refus, comme une habilitation suspendue.
  const b = ctl.alertesHabilitations(avec('2026-11-01'), [jour('2026-11-05')], '2026-11-02', '2026-10-10', noms);
  assert.deepEqual(b.map(x => [x.code, x.gravite]), [['habilitation', 'refus']]);
  assert.match(b[0].texte, /suspendue \(prérequis SST échu le 1 nov\. 2026\)/);
  assert.deepEqual(ctl.alertesHabilitations(avec('2027-06-01'), [jour('2026-11-05')], '2026-11-02', '2026-10-10', noms), [], 'prérequis valide : rien');
  // Échéance de l'habilitation déjà passée aujourd'hui : refus même si la période reçue commence avant (début ramené à aujourd'hui).
  const c = ctl.alertesHabilitations(avec('2027-06-01', '2026-10-01'), [jour('2026-11-05')], '2026-08-17', '2026-10-10', noms);
  assert.deepEqual(c.map(x => [x.code, x.gravite]), [['habilitation', 'refus']]);
});

test('repos quotidien : le poste qui suit la période est contrôlé quand le précédent en fait partie (alerte rattachée à ce dernier)', () => {
  const jours = [{ jour: '2026-11-03', horaire: H.N }, { jour: '2026-11-04', horaire: H.M }];
  const a = ctl.controlesPlanning({ employe: MAJEUR, jours, du: '2026-11-03', au: '2026-11-03', reglages: DEFAULT_SETTINGS, derogationDominicale: false });
  const r = a.filter(x => x.code === 'repos_quotidien');
  assert.deepEqual(r.map(x => [x.jour, x.gravite]), [['2026-11-03', 'alerte']]);
  assert.match(r[0].texte, /^4 nov\. 2026 : aucun repos avant la prise de poste/);
  assert.ok(ctl.codesAcceptes(a, 1, '2026-11-03').includes('repos_quotidien'));
  // Repos suffisant après la période : rien.
  const b = ctl.controlesPlanning({ employe: MAJEUR, jours: [{ jour: '2026-11-03', horaire: H.M }, { jour: '2026-11-04', horaire: H.M }], du: '2026-11-03', au: '2026-11-03', reglages: DEFAULT_SETTINGS, derogationDominicale: false });
  assert.deepEqual(b.filter(x => x.code === 'repos_quotidien'), []);
});

test('délai de prévenance : compté depuis la communication ; verrous d’une semaine validée et d’un jour passé', () => {
  assert.deepEqual(planning.prevenanceCreneau('2026-10-17', '2026-10-10', 7), { jours: 7, horsDelai: false });
  assert.deepEqual(planning.prevenanceCreneau('2026-10-16', '2026-10-10', 7), { jours: 6, horsDelai: true });
  assert.deepEqual(planning.prevenanceCreneau('2026-10-11', '2026-10-10', 7), { jours: 1, horsDelai: true }, 'pas de jour franc comme pour les astreintes');
  const nom = (id: number) => `Salarié ${id}`;
  const feuilles = [{ empId: 2, week: '2026-10-12', statut: 'validee' }, { empId: 3, week: '2026-10-12', statut: 'soumise' }];
  assert.deepEqual(planning.refusPublication([{ empId: 3, jour: '2026-10-13' }], feuilles as never, '2026-10-10', nom), []);
  assert.match(planning.refusPublication([{ empId: 2, jour: '2026-10-13' }], feuilles as never, '2026-10-10', nom)[0], /Feuille de temps déjà validée : Salarié 2 \(semaine du 12 oct\. 2026\)/);
  assert.match(planning.refusPublication([{ empId: 3, jour: '2026-10-09' }], feuilles as never, '2026-10-10', nom)[0], /jour passé se corrige sur la feuille de temps/);
  assert.equal(planning.refusPeriode('2026-10-12', '2027-01-03'), null);
  assert.match(planning.refusPeriode('2026-10-12', '2027-01-04') ?? '', /12 semaines/);
});

test('créneaux en vigueur : le brouillon qui remplace passe devant la version publiée pour le planificateur, jamais pour le salarié', () => {
  const c = (id: number, statut: Creneau['statut'], remplaceId: number | null = null) => ({ id, empId: 1, jour: '2026-10-20', statut, remplaceId, horaire: 'J' }) as Creneau;
  const lignes = [c(1, 'publie'), c(2, 'brouillon', 1), c(3, 'annule'), c(4, 'remplace')];
  assert.deepEqual(planning.creneauxPlanificateur(lignes).map(x => x.id), [2]);
  assert.deepEqual(planning.creneauxPublies(lignes).map(x => x.id), [1]);
  const absences = [{ empId: 1, du: '2026-10-19', au: '2026-10-21', statut: 'validee' }, { empId: 1, du: '2026-10-22', au: '2026-10-22', statut: 'demandee' }] as never;
  assert.equal(planning.etatPourPlanificateur({ empId: 1, jour: '2026-10-20', horaire: 'J' }, absences), 'absent');
  assert.equal(planning.etatPourPlanificateur({ empId: 1, jour: '2026-10-22', horaire: 'J' }, absences), 'poste', 'demande en attente : pas absent');
  assert.equal(planning.etatPourPlanificateur({ empId: null, jour: '2026-10-22', horaire: 'J' }, absences), 'a_pourvoir');
});

test('échanges : expiration au début d’un créneau, postes échangés ou cédés, refus d’un double poste', () => {
  const c = (id: number, empId: number, jour: string, horaire: string | null = 'J') => ({ id, empId, jour, horaire, debut: horaire ? '08:00' : null, fin: horaire ? '16:00' : null, pause: 60 }) as Creneau & { empId: number };
  const a = c(1, 1, '2026-10-20'), b = c(2, 2, '2026-10-21');
  const m = new Map([[1, a], [2, b]]);
  const e = { statut: 'propose' as const, creneauDemandeur: 1, creneauPartenaire: 2 };
  assert.equal(planning.echangeExpire(e, m, ctl.instantParis('2026-10-20', '07:59')), false);
  assert.equal(planning.echangeExpire(e, m, ctl.instantParis('2026-10-20', '08:00')), true);
  assert.equal(planning.echangeExpire({ ...e, statut: 'valide' }, m, ctl.instantParis('2026-10-30', '08:00')), false, 'décidé : n’expire plus');
  assert.equal(planning.echangeExpire(e, new Map([[1, a]]), 0), true, 'créneau sorti de la fenêtre : passé');
  const ech = planning.postesApresEchange(a, b, 2, [a, b]);
  assert.deepEqual([...ech.postes].map(([k, v]) => [k, v?.id ?? null]), [['1|2026-10-20', null], ['2|2026-10-20', 1], ['2|2026-10-21', null], ['1|2026-10-21', 2]]);
  assert.match(planning.postesApresEchange(a, null, 2, [a, c(3, 2, '2026-10-20')]).refus ?? '', /deux postes/);
  assert.equal(planning.postesApresEchange(a, null, 2, [a, c(3, 2, '2026-10-20', null)]).refus, null, 'un repos se cède');
});

test('affectations au roulement : cycle et groupe en vigueur, dans le contrat, sans chevauchement ; besoins du jour', () => {
  const cyc = cycles.CYCLES_MODELES.map(c => ({ ...c, archive: null, creeLe: '', creePar: '' }));
  const r = (p: object, existants: object[] = []) => planning.controlerRoulement({ cycle: '2x8', groupe: 'b', du: '2026-11-02', ...p }, MAJEUR, cyc, existants as never);
  assert.deepEqual(r({}).valeurs, { cycle: '2X8', groupe: 'B', du: '2026-11-02', au: null });
  assert.match(r({ groupe: 'C' }).erreurs.groupe ?? '', /Groupe inconnu du cycle 2X8 \(A, B\)/);
  assert.match(r({ du: '2019-12-31' }).erreurs.du ?? '', /hors du contrat/);
  assert.match(r({}, [{ empId: 1, cycle: 'JOUR', groupe: 'A', du: '2026-01-01', au: null }]).erreurs.general ?? '', /Déjà affecté au cycle JOUR/);
  assert.equal(r({}, [{ empId: 1, cycle: 'JOUR', groupe: 'A', du: '2026-01-01', au: '2026-11-01' }]).valeurs?.cycle, '2X8', 'affectation précédente finie la veille');
  const besoins = [{ id: 1, equipe: 'Production', horaire: 'N', jours: [0, 1, 2, 3, 4], effectifMin: 1, posteId: null, activite: null, exigences: { formations: ['sst'], habilitations: [] }, du: '2026-01-01', au: null, archive: null }];
  assert.equal(planning.besoinsDuJour(besoins, 'Production', 'N', '2026-11-02').length, 1, 'lundi');
  assert.equal(planning.besoinsDuJour(besoins, 'Production', 'N', '2026-11-07').length, 0, 'samedi');
  assert.equal(planning.besoinsDuJour(besoins, 'Production', 'M', '2026-11-02').length, 0);
});
