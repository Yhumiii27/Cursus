// Lot 12, chantier C6 (badgeage virtuel, t191), étape 1 : règles pures du pointage et du débit-crédit, par valeurs.
// - heure de Paris aux nuits de changement d'heure (dernier dimanche de mars et d'octobre 2026) ;
// - appariement (sens déduit en alternance, entrée ou sortie orpheline, entrée en cours), dédoublonnage sous 60 s,
//   neutralisation par une correction ;
// - poste rattaché au jour de sa première entrée (nuit du dimanche au lundi), pauses, plages réelles qui remplacent
//   l'estimation dans controlesReposNuit (repos de 11 h, pause, nuit) ;
// - anomalies calculées (jamais la nature d'une absence) ; populations, exclusions et activation (COHERENCE) ;
// - théorique du jour, solde de la semaine et report plafonné (3 h, 10 h).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../shared/rules/pointage.ts');
const DC = await import('../shared/rules/debit-credit.ts');
const { controlesReposNuit } = await import('../shared/rules/repos-nuit.ts');
const { appliquerReglages, ReglageInvalide, reglagesParDefaut } = await import('../shared/reglages.ts');
type PL = import('../shared/rules/pointage.ts').PointageLu;

let n = 0;
/** Pointage brut à l'instant UTC `h` (sens facultatif). */
const p = (h: string, sens: 'E' | 'S' | null = null, o: Partial<PL> = {}): PL => ({ id: ++n, horodatage: h, sens, annuleId: null, ...o });
const t = (h: string) => Date.parse(h);

test('heure de Paris : instants aux nuits de mars et d’octobre, heure inexistante et heure vécue deux fois', () => {
  // Dernier dimanche de mars 2026 (29) : 2 h → 3 h ; d'octobre (25) : 3 h → 2 h.
  assert.equal(new Date(P.instantParis('2026-03-29', 6 * 60)).toISOString(), '2026-03-29T04:00:00.000Z', '6 h en heure d’été');
  assert.equal(new Date(P.instantParis('2026-03-28', 22 * 60)).toISOString(), '2026-03-28T21:00:00.000Z', '22 h en heure d’hiver');
  assert.equal(new Date(P.instantParis('2026-10-25', 6 * 60)).toISOString(), '2026-10-25T05:00:00.000Z', '6 h en heure d’hiver');
  assert.equal(new Date(P.instantParis('2026-10-25', 150)).toISOString(), '2026-10-25T00:30:00.000Z', '2 h 30 vécue deux fois : la première');
  assert.equal(new Date(P.instantParis('2026-03-29', 150)).toISOString(), '2026-03-29T01:30:00.000Z', '2 h 30 inexistante : une heure plus tard');
  assert.deepEqual(P.heureParis('2026-10-25T01:30:00Z'), { jour: '2026-10-25', minutes: 150 }, 'seconde 2 h 30');
  assert.equal(P.hhmmParis('2026-10-11T22:30:00Z'), '00:30');
  assert.deepEqual(P.heureParis('2026-10-11T22:30:00Z').jour, '2026-10-12', 'minuit passé à Paris, encore la veille en UTC');
  assert.equal(P.instantValide('2026-10-12T06:00:00+02:00'), '2026-10-12T04:00:00.000Z');
  assert.equal(P.instantValide('12/10/2026 06:00'), null);
  // Fuseau exigé : sans lui, l'heure dépendrait du fuseau du processus (UTC chez un hébergeur, Paris dans l'image).
  assert.equal(P.instantValide('2026-10-10T08:00'), null);
  assert.equal(P.instantValide('2026-10-10T08:00:00'), null);
  assert.equal(P.instantValide('2026-10-10T08:00:00.000'), null);
  assert.equal(P.instantValide('2026-10-10T08:00Z'), '2026-10-10T08:00:00.000Z');
  assert.equal(P.instantValide('2026-10-10T08:00:00.123Z'), '2026-10-10T08:00:00.123Z');
  assert.equal(P.instantValide('2026-10-10T08:00:00-01:30'), '2026-10-10T09:30:00.000Z');
  assert.equal(P.instantValide('2026-10-10T08:00:00+0200'), null, 'décalage sans deux-points');
  assert.equal(P.instantValide(42), null);
});

test('appariement : sens déduit en alternance, orphelins, entrée en cours, doublons sous 60 s, neutralisation', () => {
  const l = [p('2026-10-12T06:00:00Z'), p('2026-10-12T06:00:30Z'), p('2026-10-12T10:00:00Z'), p('2026-10-12T11:00:00Z'), p('2026-10-12T15:00:00Z')];
  const a = P.apparier(l);
  assert.equal(a.doublons.length, 1, 'double appui à 30 s');
  assert.deepEqual(a.paires.map(x => [x.debut, x.fin]), [[t('2026-10-12T06:00:00Z'), t('2026-10-12T10:00:00Z')], [t('2026-10-12T11:00:00Z'), t('2026-10-12T15:00:00Z')]]);
  assert.deepEqual(a.orphelins, []);
  // Sens donnés : entrée suivie d'une entrée (sortie manquante), sortie sans entrée.
  const b = P.apparier([p('2026-10-12T06:00:00Z', 'E'), p('2026-10-12T07:00:00Z', 'E'), p('2026-10-12T12:00:00Z', 'S'), p('2026-10-12T13:00:00Z', 'S')]);
  assert.deepEqual(b.orphelins.map(o => o.manque), ['sortie', 'entree']);
  assert.equal(b.paires.length, 1);
  // Deux pointages de sens différents à moins de 60 s ne sont pas des doublons.
  assert.equal(P.apparier([p('2026-10-12T06:00:00Z', 'E'), p('2026-10-12T06:00:20Z', 'S')]).paires.length, 1);
  // Entrée ouverte : en cours si elle date de moins de 24 h, sinon sortie manquante.
  const ouverte = [p('2026-10-12T06:00:00Z', 'E')];
  assert.ok(P.apparier(ouverte, t('2026-10-12T09:00:00Z')).enCours);
  assert.equal(P.apparier(ouverte, t('2026-10-13T07:00:00Z')).orphelins[0].manque, 'sortie');
  assert.equal(P.apparier(ouverte).orphelins[0].manque, 'sortie', 'sans instant de lecture : sortie manquante');
  assert.equal(P.sensSuivant(ouverte, t('2026-10-12T09:00:00Z')), 'S');
  assert.equal(P.sensSuivant([], t('2026-10-12T09:00:00Z')), 'E');
  // Paire de plus de 24 h : sortie manquante et entrée manquante.
  assert.deepEqual(P.apparier([p('2026-10-12T06:00:00Z', 'E'), p('2026-10-13T08:00:00Z', 'S')]).orphelins.map(o => o.manque), ['sortie', 'entree']);
  // Une correction neutralise un pointage : la ligne qui le désigne et lui sont écartés.
  const faux = p('2026-10-12T08:00:00Z', 'E');
  const c = P.apparier([p('2026-10-12T06:00:00Z', 'E'), faux, p('2026-10-12T08:00:00Z', 'E', { annuleId: faux.id }), p('2026-10-12T14:00:00Z', 'S')]);
  assert.equal(c.paires.length, 1);
  assert.deepEqual(c.orphelins, []);
});

test('poste : pauses sous 5 h, rattachement au jour de la première entrée, nuit du dimanche au lundi', () => {
  // Matin et après-midi avec 45 min de pause : un poste de 7 h 15.
  const [jour] = P.postesDesPointages([p('2026-10-13T06:00:00Z'), p('2026-10-13T10:00:00Z'), p('2026-10-13T10:45:00Z'), p('2026-10-13T14:00:00Z')]);
  assert.deepEqual([jour.jour, jour.travail, jour.pauses, jour.pauseMax], ['2026-10-13', 435, [45], 45]);
  // Poste de nuit du dimanche 11 au lundi 12 octobre (22 h – 6 h à Paris) : rattaché au dimanche, semaine du 5 octobre.
  const nuit = P.postesDesPointages([p('2026-10-11T20:00:00Z', 'E'), p('2026-10-12T04:00:00Z', 'S'), p('2026-10-12T12:00:00Z'), p('2026-10-12T20:00:00Z')]);
  assert.deepEqual(nuit.map(x => [x.jour, x.travail]), [['2026-10-11', 480], ['2026-10-12', 480]]);
  // Plages réelles de la semaine du lundi 12 : le dimanche précédent en veille, 8 h de repos seulement avant le lundi.
  const r = P.plagesReelles(nuit, '2026-10-12');
  assert.deepEqual(r.veille, { debut: -120, fin: 360, pause: 0 });
  assert.deepEqual(r.plages[0], { debut: 840, fin: 1320, pause: 0 });
  assert.deepEqual(r.nuitParJour, [1, 0, 0, 0, 0, 0, 0], '21 h – 22 h le lundi');
  const c = controlesReposNuit([null, null, null, null, null, null, null], [8, 0, 0, 0, 0, 0, 0], '2026-10-12', { reelles: r });
  assert.deepEqual(c.codes, ['repos_quotidien', 'pause'], 'repos réel de 8 h, aucune pause en 8 h (l’estimation sans horaire ne contrôlait rien)');
  assert.match(c.repos[0], /8 h avant le lun\. 12 oct\./);
  assert.equal(c.nuit, 1);
  // Sans plages réelles et sans horaire : aucun contrôle (comportement d'avant).
  assert.deepEqual(controlesReposNuit([null, null, null, null, null, null, null], [8, 0, 0, 0, 0, 0, 0], '2026-10-12', {}).codes, []);
  // Pause réelle : 10 min sur 7 h de travail.
  const sansPause = P.plagesReelles(P.postesDesPointages([p('2026-10-13T05:00:00Z'), p('2026-10-13T09:00:00Z'), p('2026-10-13T09:10:00Z'), p('2026-10-13T12:10:00Z')]), '2026-10-12');
  assert.deepEqual(controlesReposNuit(Array(7).fill(null), [0, 7, 0, 0, 0, 0, 0], '2026-10-12', { reelles: sansPause }).codes, ['pause']);
});

test('nuits de changement d’heure : durées et heures de nuit réelles (mars : 7 h, octobre : 9 h)', () => {
  // Samedi 22 h – dimanche 6 h à Paris, nuit du 28 au 29 mars 2026 : 7 heures réelles, toutes de nuit.
  const mars = P.postesDesPointages([p('2026-03-28T21:00:00Z', 'E'), p('2026-03-29T04:00:00Z', 'S')]);
  assert.deepEqual([mars[0].jour, mars[0].travail], ['2026-03-28', 420]);
  assert.equal(P.heuresDeNuitReelles(mars[0].paires), 7);
  // Nuit du 24 au 25 octobre 2026 : 9 heures réelles, toutes de nuit.
  const oct = P.postesDesPointages([p('2026-10-24T20:00:00Z', 'E'), p('2026-10-25T05:00:00Z', 'S')]);
  assert.deepEqual([oct[0].jour, oct[0].travail], ['2026-10-24', 540]);
  assert.equal(P.heuresDeNuitReelles(oct[0].paires), 9);
  // Plage de nuit commencée à 23 h : 8 h de nuit sur le même poste d'octobre (23 h – 6 h, dont 2 h – 3 h deux fois).
  assert.equal(P.heuresDeNuitReelles(oct[0].paires, { nuitDebut: 23, nuitFin: 7 }), 8);
  // Journée : aucune heure de nuit ; poste de 4 h à 12 h : 2 h de nuit.
  assert.equal(P.heuresDeNuitReelles([[t('2026-10-12T05:00:00Z'), t('2026-10-12T15:00:00Z')]]), 0);
  assert.equal(P.heuresDeNuitReelles([[t('2026-10-12T02:00:00Z'), t('2026-10-12T10:00:00Z')]]), 2);
  // Plages réelles de la semaine du 19 octobre, dont le dimanche 25 en heure d'hiver : 9 h de nuit le samedi 24.
  assert.deepEqual(P.plagesReelles(oct, '2026-10-19').nuitParJour, [0, 0, 0, 0, 0, 9, 0]);
});

test('anomalies : orphelins, différé, sans pointage, absence, amplitude, repos, pause, durées, écart déclaré, après validation', () => {
  const maintenant = t('2026-10-16T12:00:00Z');
  const base = { du: '2026-10-12', au: '2026-10-16', maintenant };
  // Mardi : entrée sans sortie ; mercredi : rien alors qu'un travail est prévu ; jeudi : pointage un jour d'absence.
  const a = P.anomaliesPointage({
    ...base,
    pointages: [
      p('2026-10-12T06:00:00Z', 'E'), p('2026-10-12T14:00:00Z', 'S'),
      p('2026-10-13T06:00:00Z', 'E'),
      p('2026-10-15T06:00:00Z', 'E'), p('2026-10-15T10:00:00Z', 'S'),
      // Vendredi : pointage hors ligne reçu 20 min plus tard.
      p('2026-10-16T06:00:00Z', 'E', { horsLigne: true, recuLe: '2026-10-16T06:20:00Z' }),
    ],
    prevus: new Set(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']),
    absents: new Set(['2026-10-15']),
    declare: new Map([['2026-10-12', 7]]), ecartMin: 15,
    figes: new Map([['2026-10-12', 8]]),
  });
  assert.deepEqual(a.map(x => [x.jour, x.code]), [
    ['2026-10-12', 'ecart_declare'], ['2026-10-12', 'pause'], ['2026-10-13', 'sortie_manquante'], ['2026-10-14', 'sans_pointage'],
    ['2026-10-15', 'pendant_absence'], ['2026-10-16', 'differe'],
  ]);
  // Jamais la nature d'une absence.
  assert.ok(a.every(x => !/maladie|congé|accident/i.test(x.texte)));
  assert.match(a.find(x => x.code === 'ecart_declare')!.texte, /7 h déclarées, 8 h pointées/);
  // Le pointé figé à la validation diffère du pointé recalculé : pointage postérieur à la validation.
  const b = P.anomaliesPointage({ ...base, pointages: [p('2026-10-12T06:00:00Z', 'E'), p('2026-10-12T14:00:00Z', 'S')], figes: new Map([['2026-10-12', 7]]) });
  assert.ok(b.some(x => x.code === 'apres_validation'));
  // Amplitude de 14 h, plus de 10 h, repos de 8 h avant le lendemain.
  const c = P.anomaliesPointage({
    ...base, pointages: [p('2026-10-12T04:00:00Z', 'E'), p('2026-10-12T09:00:00Z', 'S'), p('2026-10-12T09:30:00Z', 'E'), p('2026-10-12T18:00:00Z', 'S'),
      p('2026-10-13T02:00:00Z', 'E'), p('2026-10-13T06:00:00Z', 'S')],
  });
  assert.deepEqual(c.map(x => x.code).sort(), ['amplitude', 'duree_jour', 'repos_quotidien']);
  // 48 h dans la semaine : six jours de 9 h.
  const semaine = Array.from({ length: 6 }, (_, i) => [p(`2026-10-${12 + i}T05:00:00Z`, 'E'), p(`2026-10-${12 + i}T14:00:00Z`, 'S'), p(`2026-10-${12 + i}T14:30:00Z`, 'E'), p(`2026-10-${12 + i}T14:31:00Z`, 'S')]).flat();
  assert.ok(P.anomaliesPointage({ du: '2026-10-12', au: '2026-10-18', maintenant: t('2026-10-19T08:00:00Z'), pointages: semaine }).some(x => x.code === 'duree_semaine'));
  // Coupure de plus de 5 h le même jour (8 h – 12 h, 17 h 30 – 19 h à Paris) : deux postes, mais une seule journée ; le
  // repos quotidien se lit entre deux journées (19 h → 8 h le lendemain : 13 h), jamais dans la coupure.
  const coupure = P.anomaliesPointage({
    ...base, pointages: [p('2026-10-13T06:00:00Z', 'E'), p('2026-10-13T10:00:00Z', 'S'), p('2026-10-13T15:30:00Z', 'E'), p('2026-10-13T17:00:00Z', 'S'),
      p('2026-10-14T06:00:00Z', 'E'), p('2026-10-14T10:00:00Z', 'S')],
  });
  assert.deepEqual(coupure.map(x => x.code), []);
  // Amplitude sur la journée entière : 6 h – 10 h puis 16 h – 21 h, 15 h d'amplitude ; et 21 h → 6 h le lendemain : 9 h de repos.
  const longue = P.anomaliesPointage({
    ...base, pointages: [p('2026-10-13T04:00:00Z', 'E'), p('2026-10-13T08:00:00Z', 'S'), p('2026-10-13T14:00:00Z', 'E'), p('2026-10-13T19:00:00Z', 'S'),
      p('2026-10-14T04:00:00Z', 'E'), p('2026-10-14T08:00:00Z', 'S')],
  });
  assert.deepEqual(longue.map(x => [x.jour, x.code]), [['2026-10-13', 'amplitude'], ['2026-10-14', 'repos_quotidien']]);
  assert.match(longue[0].texte, /Amplitude de 15 h \(06:00 – 21:00\)/);
  // Demi-journée d'absence : le pointage de l'autre demi-journée n'est pas une anomalie, même un peu plus long que son
  // théorique ; au-delà d'une fois et demie ce théorique (journée travaillée), il l'est, sans dire la nature de l'absence.
  const demi = (fin: string) => P.anomaliesPointage({
    ...base, pointages: [p('2026-10-13T06:00:00Z', 'E'), p(fin, 'S')], prevus: new Set(['2026-10-13']), demiAbsents: new Map([['2026-10-13', 210]]),
  });
  assert.deepEqual(demi('2026-10-13T10:00:00Z'), [], '8 h – 12 h pour 3 h 30 prévues : la demi-journée travaillée');
  assert.deepEqual(demi('2026-10-13T11:15:00Z'), [], '5 h 15 : une fois et demie le théorique, admis');
  const trop = demi('2026-10-13T15:00:00Z').filter(x => x.code !== 'pause');
  assert.deepEqual(trop.map(x => x.code), ['pendant_absence']);
  assert.match(trop[0].texte, /pointées pour .* prévues un jour d’absence d’une demi-journée$/);
  assert.ok(!/congé|CP|RTT|récupération/i.test(trop[0].texte));
  // Entrée du jour en cours : ni sortie manquante, ni « sans pointage » pour la journée qui n'est pas finie.
  const enCours = P.anomaliesPointage({ ...base, pointages: [p('2026-10-16T06:00:00Z', 'E')], prevus: new Set(['2026-10-16']) });
  assert.deepEqual(enCours, []);
});

test('populations : critère, date d’effet, la plus récente l’emporte, exclusions, module inactif', () => {
  const settings = {
    pointageActif: true, pointageInterim: false,
    pointagePopulations: [
      { critere: 'equipe', valeur: 'Production', mode: 'controle', effet: '2026-01-01' },
      { critere: 'equipe', valeur: 'Production', mode: 'calcule', effet: '2027-01-01' },
      { critere: 'regime', valeur: 'partiel', mode: 'controle', effet: '2026-06-01' },
      { critere: 'site', valeur: 'site_67', mode: 'controle', effet: '2026-01-01' },
      { critere: 'entite', valeur: 'epc', mode: 'calcule', effet: '2026-01-01' },
    ],
  } as const;
  const equipes = [
    { nom: 'Production', managerId: 1, parente: null, entite: 'epc', siteCode: null }, { nom: 'Ligne 2', managerId: 2, parente: 'Production' },
    { nom: 'Labo', managerId: 3, parente: null, entite: null, siteCode: 'site_67' },
  ];
  const x = { settings: settings as never, equipes };
  const e = (equipe: string, temps = '35h', typeContrat = 'cdi') => ({ equipe, temps, typeContrat }) as never;
  assert.equal(P.modeTempsAu(x, e('Ligne 2'), '2026-10-12'), 'calcule', 'équipe rattachée à la Production et entité : même date d’effet, la dernière de la liste');
  assert.equal(P.modeTempsAu({ ...x, settings: { ...settings, pointagePopulations: settings.pointagePopulations.slice(0, 2) } as never }, e('Ligne 2'), '2026-10-12'), 'controle', 'équipe rattachée');
  assert.equal(P.modeTempsAu(x, e('Ligne 2'), '2027-02-01'), 'calcule', 'la plus récente');
  assert.equal(P.modeTempsAu(x, e('Labo'), '2026-10-12'), 'controle', 'site de l’équipe');
  assert.equal(P.modeTempsAu(x, e('Labo'), '2025-12-31'), 'declaratif', 'avant la date d’effet');
  assert.equal(P.modeTempsAu(x, e('Ligne 2', 'forfait_jours'), '2026-10-12'), 'declaratif', 'forfait jours exclu');
  assert.equal(P.modeTempsAu(x, e('Ligne 2', 'dirigeant'), '2026-10-12'), 'declaratif', 'cadre dirigeant exclu');
  assert.equal(P.modeTempsAu(x, e('Ligne 2', '35h', 'interim'), '2026-10-12'), 'declaratif', 'intérimaire exclu par défaut');
  assert.equal(P.modeTempsAu({ ...x, settings: { ...settings, pointageInterim: true } as never }, e('Ligne 2', '35h', 'interim'), '2026-10-12'), 'calcule', 'intérimaire inclus par le réglage');
  assert.equal(P.modeTempsAu({ ...x, settings: { ...settings, pointageActif: false } as never }, e('Ligne 2'), '2026-10-12'), 'declaratif', 'module inactif');
  assert.equal(P.modeTempsAu(x, e('Autre', 'partiel'), '2026-10-12'), 'controle', 'régime');
  assert.ok(P.pointeAu(x, e('Labo'), '2026-10-12'));
  assert.equal(P.exclusionPointage({ temps: 'forfait_jours', typeContrat: 'cdi' }, false), 'forfait jours (décompte en jours)');
});

test('réglages : populations contrôlées, activation refusée sans l’accord ni l’avis du CSE (COHERENCE)', () => {
  const s = reglagesParDefaut();
  assert.equal(s.pointageActif, false);
  const pop = [{ critere: 'equipe', valeur: ' Maintenance ', mode: 'controle', effet: '2026-11-01' }];
  assert.deepEqual(appliquerReglages(s, { pointagePopulations: pop }).pointagePopulations, [{ critere: 'equipe', valeur: 'Maintenance', mode: 'controle', effet: '2026-11-01' }]);
  const refus = (p: Record<string, unknown>, m: RegExp) => assert.throws(() => appliquerReglages(s, p), (e: unknown) => e instanceof ReglageInvalide && m.test(e.message));
  refus({ pointagePopulations: 'Maintenance' }, /liste des populations/);
  refus({ pointagePopulations: [{ critere: 'poste', valeur: 'x', mode: 'controle', effet: '2026-11-01' }] }, /critère inconnu/);
  refus({ pointagePopulations: [{ critere: 'regime', valeur: 'forfait_jours', mode: 'controle', effet: '2026-11-01' }] }, /exclu du badgeage/);
  refus({ pointagePopulations: [{ critere: 'equipe', valeur: 'X', mode: 'badgeuse', effet: '2026-11-01' }] }, /mode inconnu/);
  refus({ pointagePopulations: [{ critere: 'equipe', valeur: 'X', mode: 'controle', effet: '2026-13-01' }] }, /date d’effet/);
  refus({ pointagePopulations: [{ critere: 'equipe', valeur: '', mode: 'controle', effet: '2026-11-01' }] }, /valeur requise/);
  refus({ pointagePopulations: [...pop, ...pop] }, /en double/);
  refus({ pointageActif: true }, /référence de l’accord d’entreprise et la date de l’avis du CSE/);
  refus({ pointageActif: true, pointageAccord: 'Accord du 1er mars 2026' }, /avis du CSE/);
  refus({ pointageCseLe: '2026-02-30' }, /date invalide/);
  const actif = appliquerReglages(s, { pointageActif: true, pointageAccord: 'Accord du 1er mars 2026', pointageCseLe: '2026-02-15' });
  assert.equal(actif.pointageActif, true);
  assert.equal(appliquerReglages(s, { conservationPointagesAns: 9 }).conservationPointagesAns, 5, '5 ans au plus (référentiel CNIL)');
  assert.equal(appliquerReglages(s, { conservationPointagesAns: 0 }).conservationPointagesAns, 1, '1 an au moins (art. D3171-16)');
});

test('pointage différé et corrections : heure de l’appareil, délai de demande', () => {
  const m = t('2026-10-12T10:00:00Z');
  assert.equal(P.refusHeureAppareil('2026-10-12T09:00:00.000Z', m), null);
  assert.match(P.refusHeureAppareil(null, m)!, /manquante/);
  assert.match(P.refusHeureAppareil('2026-10-12T10:06:00.000Z', m)!, /en avance/);
  assert.equal(P.refusHeureAppareil('2026-10-12T10:04:00.000Z', m), null, '5 min d’avance tolérées');
  assert.match(P.refusHeureAppareil('2026-10-04T09:00:00.000Z', m)!, /plus de 7 jours/);
  assert.equal(P.refusDelaiCorrection('2026-10-05', '2026-10-12', 7, false), null);
  assert.match(P.refusDelaiCorrection('2026-10-04', '2026-10-12', 7, false)!, /plus de 7 jours/);
  assert.equal(P.refusDelaiCorrection('2026-09-04', '2026-10-12', 7, true), null, 'service RH');
  assert.match(P.refusDelaiCorrection('2026-10-13', '2026-10-12', 7, true)!, /à venir/);
});

test('débit-crédit : théorique du jour, solde de la semaine, report plafonné à 3 h et cumul à 10 h', () => {
  const j = (jour: string, o: Partial<import('../shared/rules/debit-credit.ts').EntreeTheorique> = {}) =>
    DC.theoriqueDuJour({ jour, horaire: null, absence: null, ferie: false, horsContrat: false, jourOff: [], heuresSemaine: 35, ...o });
  assert.deepEqual(j('2026-10-12'), { jour: '2026-10-12', minutes: 420, motif: 'travaille' });
  assert.equal(j('2026-10-12', { heuresSemaine: 39 }).minutes, 468);
  assert.equal(j('2026-10-12', { horaire: { code: 'J', debut: '08:00', fin: '16:30', pause: 45 } }).minutes, 465, 'horaire du jour');
  assert.deepEqual(j('2026-10-17'), { jour: '2026-10-17', minutes: 0, motif: 'repos' }, 'samedi');
  assert.equal(j('2026-10-14', { jourOff: [2], heuresSemaine: 28 }).motif, 'repos', 'mercredi non travaillé du temps partiel');
  assert.equal(j('2026-10-12', { jourOff: [2], heuresSemaine: 28 }).minutes, 420, '28 h sur 4 jours');
  assert.equal(j('2026-11-11', { ferie: true }).motif, 'ferie');
  assert.deepEqual(j('2026-10-12', { absence: 'journee' }), { jour: '2026-10-12', minutes: 0, motif: 'absence' });
  assert.equal(j('2026-10-12', { absence: 'demi' }).minutes, 210);
  assert.equal(j('2026-10-12', { horsContrat: true }).motif, 'hors_contrat');
  const s = DC.soldeSemaine('2026-10-12', new Map([['2026-10-12', 480], ['2026-10-13', 400]]), jour => (jour <= '2026-10-13' ? 420 : 0));
  assert.deepEqual([s.realise, s.theorique, s.solde], [880, 840, 40]);
  // Semaines à +5 h, +2 h, +4 h, -1 h : reports de 3, 2, 3, -1 ; cumul plafonné à 10 h ; excédent signalé.
  const sem = (solde: number) => ({ week: '2026-10-12', realise: 0, theorique: 0, solde, jours: [] });
  const c = DC.cumulPeriode([sem(300), sem(120), sem(240), sem(240), sem(-60)]);
  assert.deepEqual(c.semaines.map(x => [x.report, x.cumul, x.excedent]), [[180, 180, 120], [120, 300, 0], [180, 480, 60], [180, 600, 120], [-60, 540, 0]]);
  assert.equal(c.cumul, 540);
  assert.equal(c.excedent, 300);
  assert.equal(DC.cumulPeriode([sem(-600)]).cumul, -180, 'débit reporté dans la même limite');
  assert.equal(DC.cumulPeriode([sem(300)], { reportMaxSemaine: 300, cumulMax: 900 }).cumul, 300, 'plafonds de l’accord');
});
