// Astreintes (t049, lot 7, étape 1) : règles pures de shared/rules/astreintes.ts — délai de prévenance (15 jours, motif des
// circonstances exceptionnelles en dessous, un jour franc au moins), chevauchements (autre astreinte, absence en vigueur),
// salarié mineur, contrat, astreinte commencée (fin avancée seulement), interventions (dans l'astreinte, pas à venir, sans
// chevauchement, fin le lendemain), heures et périodes d'un mois ; contrôle du repos quotidien après une intervention
// (shared/rules/repos-nuit.ts : repos dû en entier après sa fin, temps d'astreinte sans intervention compté comme repos),
// heures de nuit des interventions et réglages des astreintes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const A = await import('../shared/rules/astreintes.ts');
const R = await import('../shared/rules/repos-nuit.ts');
const { appliquerReglages, ReglageInvalide, reglagesParDefaut } = await import('../shared/reglages.ts');
type Astreinte = Parameters<typeof A.heuresAstreinte>[0] & Parameters<typeof A.controlerIntervention>[0];
type Intervention = Parameters<typeof A.controlerIntervention>[2][number];

const TI = '2026-10-10';
const MEHDI = { id: 2, nom: 'Mehdi Benali', entree: '2021-03-01', fin: null, typeContrat: 'cdi' as const, naissance: 1994, naissanceLe: '1994-05-12' };
const S = reglagesParDefaut();
const astreinte = (o: Partial<Astreinte> = {}): Astreinte => ({
  id: 1, empId: 2, equipe: 'Maintenance', du: '2026-10-30', debut: '18:00', au: '2026-11-06', fin: '08:00', communiqueLe: '2026-10-01', motif: null,
  creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Karim Haddad', modifieLe: null, modifiePar: null, annuleLe: null, annulePar: null, annuleMotif: null, ...o,
});
const intervention = (o: Partial<Intervention> = {}): Intervention => ({
  id: 1, astreinteId: 1, empId: 2, jour: '2026-10-31', debut: '22:00', fin: '01:30', heures: 3.5, declareLe: '2026-11-01T08:00:00.000Z', declarePar: 'Mehdi Benali', ...o,
});
const vide = { astreintes: [], absences: [] };

test('délai de prévenance : 15 jours par défaut, motif en dessous, un jour franc au moins (art. R3121-3)', () => {
  assert.deepEqual(A.prevenance('2026-10-25', TI, S), { jours: 15, court: false, refus: null });
  assert.deepEqual([A.prevenance('2026-10-24', TI, S).court, A.prevenance('2026-10-24', TI, S).refus], [true, null]);
  assert.equal(A.prevenance('2026-10-12', TI, S).refus, null, 'communiquée le samedi pour le lundi : le dimanche est un jour franc');
  assert.match(A.prevenance('2026-10-11', TI, S).refus!, /un jour franc au moins.*12 oct\. 2026 au plus tôt/);
  assert.match(A.prevenance('2026-10-10', TI, S).refus!, /trop tard/);
  // Délai réglé par un accord : 7 jours.
  assert.equal(A.prevenance('2026-10-17', TI, { ...S, astreinteDelaiPrevenance: 7 }).court, false);
  assert.equal(A.prevenance('2026-10-16', TI, { ...S, astreinteDelaiPrevenance: 7 }).court, true);

  const saisie = { du: '2026-10-20', debut: '18 h', au: '2026-10-23', fin: '8' };
  const sansMotif = A.controlerAstreinte(vide, MEHDI, saisie, TI, S);
  assert.equal(sansMotif.valeurs, null);
  assert.match(sansMotif.erreurs.motif!, /10 jours avant son début, moins que le délai de prévenance de 15 jours.*circonstances exceptionnelles/);
  const avecMotif = A.controlerAstreinte(vide, MEHDI, { ...saisie, motif: '  Arrêt  technique avancé  ' }, TI, S);
  assert.deepEqual(avecMotif.valeurs, { du: '2026-10-20', debut: '18:00', au: '2026-10-23', fin: '08:00', motif: 'Arrêt technique avancé' });
  assert.equal(avecMotif.prevenance?.court, true);
  // Délai tenu : un motif saisi est gardé, aucun n'est exigé.
  assert.equal(A.controlerAstreinte(vide, MEHDI, { ...saisie, du: '2026-10-30', au: '2026-11-06' }, TI, S).valeurs?.motif, null);
  assert.match(A.controlerAstreinte(vide, MEHDI, { ...saisie, du: '2026-10-11', motif: 'Panne' }, TI, S).erreurs.du!, /jour franc/, 'motif sans effet sous un jour franc');
});

test('contrôle d’une astreinte : champs, durée, contrat, mineur, chevauchements', () => {
  const ok = { du: '2026-10-30', debut: '18:00', au: '2026-11-06', fin: '08:00' };
  const e = A.controlerAstreinte(vide, MEHDI, {}, TI, S).erreurs;
  assert.deepEqual(Object.keys(e).sort(), ['au', 'debut', 'du', 'fin']);
  assert.match(A.controlerAstreinte(vide, MEHDI, { ...ok, au: '2026-10-30', fin: '17:00' }, TI, S).erreurs.fin!, /doit suivre son début/);
  assert.match(A.controlerAstreinte(vide, MEHDI, { ...ok, au: '2026-12-15' }, TI, S).erreurs.au!, /31 jours au plus/);
  assert.match(A.controlerAstreinte(vide, MEHDI, { ...ok, motif: 'x'.repeat(501) }, TI, S).erreurs.motif!, /500 caractères/);
  assert.match(A.controlerAstreinte(vide, { ...MEHDI, fin: '2026-11-02' }, ok, TI, S).erreurs.general!, /hors du contrat \(fin de contrat le 2 nov\. 2026\)/);
  // Salarié de moins de 18 ans : refus par défaut ; permis par le réglage.
  const jeune = { ...MEHDI, naissance: 2009, naissanceLe: '2009-03-01' };
  assert.match(A.controlerAstreinte(vide, jeune, ok, TI, S).erreurs.general!, /moins de 18 ans : pas d’astreinte/);
  assert.ok(A.controlerAstreinte(vide, jeune, ok, TI, { ...S, astreinteMineurs: true }).valeurs);
  // Vue sans la date de naissance (indication « mineur » du jour) : refus de même.
  assert.ok(A.controlerAstreinte(vide, { ...MEHDI, naissanceLe: null, mineur: true }, ok, TI, S).erreurs.general);
  // Autre astreinte : chevauchement refusé, à la suite permise ; une astreinte annulée ne compte pas.
  const deja = astreinte({ id: 7, du: '2026-10-23', debut: '18:00', au: '2026-10-30', fin: '18:00' });
  assert.ok(A.controlerAstreinte({ astreintes: [deja], absences: [] }, MEHDI, ok, TI, S).valeurs, 'astreinte qui suit la précédente sans interruption');
  assert.match(A.controlerAstreinte({ astreintes: [{ ...deja, fin: '20:00' }], absences: [] }, MEHDI, ok, TI, S).erreurs.general!, /déjà planifiée du 23 oct\. 2026 à 18 h au 30 oct\. 2026 à 20 h/);
  assert.ok(A.controlerAstreinte({ astreintes: [{ ...deja, fin: '20:00', annuleLe: '2026-10-05T08:00:00.000Z' }], absences: [] }, MEHDI, ok, TI, S).valeurs);
  assert.ok(A.controlerAstreinte({ astreintes: [{ ...deja, fin: '20:00', empId: 6 }], absences: [] }, MEHDI, ok, TI, S).valeurs, 'astreinte d’un collègue');
  // Absence en vigueur : refus ; demande en attente : avertissement ; refusée ou annulée : rien.
  const abs = (statut: string) => ({ absences: [{ id: 3, empId: 2, du: '2026-11-02', au: '2026-11-03', statut }], astreintes: [] }) as never;
  assert.match(A.controlerAstreinte(abs('validee'), MEHDI, ok, TI, S).erreurs.general!, /Absence validée du 2 nov\. au 3 nov\. 2026 : le salarié est absent/);
  assert.match(A.controlerAstreinte(abs('signalee'), MEHDI, ok, TI, S).erreurs.general!, /Absence signalée/);
  assert.deepEqual(A.controlerAstreinte(abs('demandee'), MEHDI, ok, TI, S).avertissements, ['Demande d’absence en attente du 2 nov. au 3 nov. 2026']);
  assert.deepEqual(A.controlerAstreinte(abs('refusee'), MEHDI, ok, TI, S).avertissements, []);
});

test('astreinte modifiée : à venir, contrôlée comme à la planification ; commencée, sa fin seulement, avancée', () => {
  const a = astreinte();
  // À venir : nouvelles dates, elle-même exclue des chevauchements ; motif d'origine repris.
  assert.deepEqual(A.controlerAstreinte({ astreintes: [a], absences: [] }, MEHDI, { au: '2026-11-05' }, TI, S, a).valeurs,
    { du: '2026-10-30', debut: '18:00', au: '2026-11-05', fin: '08:00', motif: null });
  assert.ok(A.controlerAstreinte({ astreintes: [a], absences: [] }, MEHDI, { du: '2026-10-20' }, TI, S, { ...a, motif: 'Arrêt technique' }).valeurs, 'motif déjà donné');
  // Commencée (le 31 octobre).
  const ti = '2026-10-31';
  assert.match(A.controlerAstreinte(vide, MEHDI, { du: '2026-10-29' }, ti, S, a).erreurs.du!, /seule sa fin peut être avancée/);
  assert.match(A.controlerAstreinte(vide, MEHDI, { au: '2026-11-08' }, ti, S, a).erreurs.au!, /pas reculée/);
  assert.match(A.controlerAstreinte(vide, MEHDI, { au: '2026-10-30', fin: '23:00' }, ti, S, a).erreurs.au!, /maintenant au plus tôt \(31 oct\. 2026 à 0 h\)/);
  // À l'heure près : fin avancée jusqu'à maintenant (le 31 octobre à 9 h 30), pas avant.
  const neuf = A.instant(ti, '09:30');
  assert.match(A.controlerAstreinte(vide, MEHDI, { au: ti, fin: '09:00' }, ti, S, a, null, neuf).erreurs.au!, /maintenant au plus tôt \(31 oct\. 2026 à 9 h 30\)/);
  assert.deepEqual(A.controlerAstreinte(vide, MEHDI, { au: ti, fin: '09:30' }, ti, S, a, null, neuf).valeurs, { du: '2026-10-30', debut: '18:00', au: ti, fin: '09:30', motif: null });
  const finIntervention = A.bornesIntervention(intervention({ jour: '2026-11-02', debut: '03:00', fin: '05:00' })).fin;
  assert.match(A.controlerAstreinte(vide, MEHDI, { au: '2026-11-02', fin: '04:00' }, ti, S, a, finIntervention).erreurs.au!, /après la dernière intervention/);
  assert.deepEqual(A.controlerAstreinte(vide, MEHDI, { au: '2026-11-03' }, ti, S, a, finIntervention).valeurs?.au, '2026-11-03');
  // Ni le délai de prévenance, ni les chevauchements ne sont refaits pour une fin avancée.
  assert.ok(A.controlerAstreinte({ astreintes: [], absences: [{ id: 1, empId: 2, du: '2026-11-01', au: '2026-11-01', statut: 'validee' }] }, MEHDI, { au: '2026-11-03' }, ti, S, a).valeurs);
});

test('commencée à l’heure de son début ; raccourcie avant son début : ni délai, ni nouvelle communication', () => {
  // Astreinte du 10 octobre à 18 h : le 10 à 9 h, elle n'a pas commencé (annulable) ; à 18 h, si.
  const a = astreinte({ du: TI, au: '2026-10-17' }), neuf = A.instant(TI, '09:00');
  assert.deepEqual([A.astreinteCommencee(a, neuf), A.astreinteCommencee(a, A.instant(TI, '18:00')), A.astreinteTerminee(a, A.instant('2026-10-17', '08:00'))], [false, true, true]);
  // Raccourcie le jour même (fin avancée au 12 octobre) : sous le jour franc, permis, la programmation communiquée tient.
  const r = A.controlerAstreinte({ astreintes: [a], absences: [] }, MEHDI, { au: '2026-10-12' }, TI, S, a, null, neuf);
  assert.deepEqual([r.valeurs, r.reduction, r.prevenance], [{ du: TI, debut: '18:00', au: '2026-10-12', fin: '08:00', motif: null }, true, null]);
  // Début repoussé dans la période (lendemain 8 h) : toujours une réduction ; avancée ou étendue : nouvelle programmation.
  assert.equal(A.controlerAstreinte(vide, MEHDI, { du: '2026-10-11', debut: '08:00' }, TI, S, a, null, neuf).reduction, true);
  assert.match(A.controlerAstreinte(vide, MEHDI, { debut: '17:00' }, TI, S, a, null, neuf).erreurs.du!, /trop tard/);
  assert.match(A.controlerAstreinte(vide, MEHDI, { au: '2026-10-18' }, TI, S, a, null, neuf).erreurs.du!, /trop tard/);
  // Astreinte de demain, fin avancée : plus de refus du jour franc.
  const demain = astreinte({ du: '2026-10-11', au: '2026-10-18' });
  assert.equal(A.controlerAstreinte(vide, MEHDI, { au: '2026-10-14' }, TI, S, demain).valeurs?.au, '2026-10-14');
  // Une réduction lève une absence signalée depuis : aucun contrôle de chevauchement.
  const arret = { astreintes: [], absences: [{ id: 1, empId: 2, du: '2026-10-15', au: '2026-10-20', statut: 'signalee' as const }] };
  assert.ok(A.controlerAstreinte(arret, MEHDI, { au: '2026-10-14' }, TI, S, demain).valeurs);
});

test('astreintes qui chevauchent une absence ou une sortie après coup', () => {
  const a = astreinte(), b = astreinte({ id: 2, du: '2026-11-13', au: '2026-11-20' });
  assert.deepEqual(A.astreintesChevauchant([b, a], 2, '2026-11-02', '2026-11-04').map(x => x.id), [1]);
  assert.deepEqual(A.astreintesChevauchant([b, a], 2, '2026-11-06', null).map(x => x.id), [1, 2], 'sortie : toutes celles qui finissent après');
  assert.deepEqual(A.astreintesChevauchant([b, a], 2, '2026-11-07', '2026-11-12'), []);
  assert.deepEqual(A.astreintesChevauchant([{ ...a, annuleLe: '2026-10-05T08:00:00.000Z' }, { ...b, empId: 6 }], 2, '2026-10-01', null), []);
  assert.equal(A.astreintesTexte([a, b]), 'Astreintes du 30 oct. 2026 à 18 h au 6 nov. 2026 à 8 h, du 13 nov. 2026 à 18 h au 20 nov. 2026 à 8 h');
});

test('heures et texte d’une astreinte, heures et périodes d’un mois (récapitulatif, art. R3121-2)', () => {
  const a = astreinte();
  assert.equal(A.heuresAstreinte(a), 158, 'du vendredi 18 h au vendredi suivant 8 h');
  assert.equal(A.periodeAstreinteTexte(a), 'du 30 oct. 2026 à 18 h au 6 nov. 2026 à 8 h');
  assert.equal(A.periodeAstreinteTexte({ du: '2026-11-07', debut: '08:00', au: '2026-11-07', fin: '18:30' }), 'le 7 nov. 2026 de 8 h à 18 h 30');
  const ints = [intervention(), intervention({ id: 2, jour: '2026-11-03', debut: '02:00', fin: '04:00', heures: 2 }), intervention({ id: 3, empId: 6 })];
  assert.deepEqual(A.bilanMensuel([a], ints, 2, '2026-10'), { periodes: 1, heures: 30, interventions: 1, heuresInterventions: 3.5 });
  assert.deepEqual(A.bilanMensuel([a], ints, 2, '2026-11'), { periodes: 0, heures: 128, interventions: 1, heuresInterventions: 2 });
  assert.deepEqual(A.bilanMensuel([{ ...a, annuleLe: '2026-10-05T08:00:00.000Z' }], [], 2, '2026-10'), { periodes: 0, heures: 0, interventions: 0, heuresInterventions: 0 });
  assert.equal(A.bilanTexte(A.bilanMensuel([a], ints, 2, '2026-10')), '1 période, 30 h d’astreinte, 1 intervention (3,5 h)');
  // Arrêté à un instant (mois en cours) : heures accomplies seulement, astreinte et intervention à venir exclues.
  assert.deepEqual(A.bilanMensuel([a], ints, 2, '2026-10', A.instant('2026-10-31', '06:00')), { periodes: 1, heures: 12, interventions: 0, heuresInterventions: 0 });
  assert.deepEqual(A.bilanMensuel([a], ints, 2, '2026-10', A.instant('2026-10-30', '18:00')), { periodes: 0, heures: 0, interventions: 0, heuresInterventions: 0 });
  assert.equal(A.COMPENSATION_LABEL[A.reglagesAstreinte(S).astreinteCompensation], 'Financière : montant sur le bulletin de paie');
});

test('interventions : dans l’astreinte, faites, sans chevauchement ; fin le lendemain ; plages de la semaine', () => {
  const a = astreinte(), ti = '2026-11-06';
  assert.deepEqual(A.controlerIntervention(a, { jour: '2026-10-31', debut: '22 h', fin: '1 h 30' }, [], ti).valeurs, { jour: '2026-10-31', debut: '22:00', fin: '01:30', heures: 3.5 });
  assert.match(A.controlerIntervention(a, { jour: '2026-10-30', debut: '17:00', fin: '19:00' }, [], ti).erreurs.general!, /en dehors de l’astreinte/);
  assert.match(A.controlerIntervention(a, { jour: '2026-11-06', debut: '07:00', fin: '09:00' }, [], ti).erreurs.general!, /en dehors/);
  assert.match(A.controlerIntervention(a, { jour: '2026-11-02', debut: '07:00', fin: '09:00' }, [], '2026-11-01').erreurs.jour!, /jour à venir refusé/);
  assert.match(A.controlerIntervention(a, { jour: '2026-11-02', debut: '07:00', fin: '07:00' }, [], ti).erreurs.fin!, /doit différer/);
  assert.match(A.controlerIntervention(a, { jour: '2026-11-01', debut: '00:30', fin: '02:00' }, [intervention()], ti).erreurs.general!, /déjà déclarée le 31 oct\. 2026 de 22 h à 1 h 30/);
  assert.ok(A.controlerIntervention(a, { jour: '2026-11-01', debut: '01:30', fin: '02:00' }, [intervention()], ti).valeurs, 'à la suite de la précédente');
  assert.ok(A.controlerIntervention(a, { jour: '2026-11-01', debut: '00:30', fin: '02:00' }, [intervention({ empId: 6 })], ti).valeurs, 'celle d’un collègue');
  assert.match(A.controlerIntervention({ ...a, annuleLe: '2026-10-20T08:00:00.000Z' }, { jour: '2026-11-01', debut: '01:00', fin: '02:00' }, [], ti).erreurs.general!, /Astreinte annulée/);
  // Semaine du lundi 2 novembre : l'intervention du samedi 31 octobre n'en est pas ; celle du dimanche 1er l'est (-1).
  const dim = intervention({ id: 4, jour: '2026-11-01', debut: '23:00', fin: '01:00', heures: 2 }), lun = intervention({ id: 5, jour: '2026-11-02', debut: '20:00', fin: '21:00', heures: 1 });
  assert.deepEqual(A.plagesInterventions([intervention(), dim, lun], 2, '2026-11-02'), [{ di: -1, debut: -60, fin: 60 }, { di: 0, debut: 1200, fin: 1260 }]);
  assert.deepEqual(A.heuresInterventionsParJour([intervention(), dim, lun], 2, '2026-11-02'), [1, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([A.semaineIntervention(dim), A.jourIntervention(dim)], ['2026-10-26', 6]);
  assert.deepEqual(A.plagesInterventions([], 2, '2026-11-02'), []);
});

test('repos quotidien : dû en entier après la fin d’une intervention ; l’astreinte sans intervention compte comme repos', () => {
  const J = { code: 'J', debut: '08:00', fin: '16:00', pause: 60 };
  const SEM = '2026-11-02', horaires = [J, J, J, J, J, null, null], s = reglagesParDefaut();
  // Sans intervention : journées de 7 h, 16 h de repos entre deux jours.
  const base = R.controlesReposNuit(horaires, [7, 7, 7, 7, 7, 0, 0], SEM, { s });
  assert.deepEqual([base.repos, base.nuit], [[], 0]);
  // Intervention du lundi de 23 h à 1 h 30 (2,5 h, dans les heures du lundi) : 6 h 30 de repos avant la reprise du mardi.
  const int = A.plagesInterventions([intervention({ jour: SEM, debut: '23:00', fin: '01:30', heures: 2.5 })], 2, SEM);
  const r = R.controlesReposNuit(horaires, [9.5, 7, 7, 7, 7, 0, 0], SEM, { s, interventions: int });
  assert.equal(r.repos.length, 1);
  assert.match(r.repos[0], /Repos quotidien de 11 h consécutives \(art\. L3131-1\) non respecté : 6,5 h avant le mar\. 3 nov\. \(fin de l’intervention d’astreinte à 1 h 30, reprise à 8 h ; repos dû en entier après une intervention d’astreinte\)/);
  assert.deepEqual(r.codes, ['repos_quotidien']);
  assert.deepEqual([r.nuitParJour[0], r.nuit], [2.5, 2.5], 'heures de nuit de l’intervention (21 h – 6 h), rattachées au lundi');
  // Sans la plage de l'intervention, les 9,5 h prolongeraient l'horaire jusqu'à 18 h 30 : aucun repos insuffisant.
  assert.deepEqual(R.controlesReposNuit(horaires, [9.5, 7, 7, 7, 7, 0, 0], SEM, { s }).repos, []);
  // Intervention en soirée (18 h – 19 h) : le repos interrompu n'est pas contrôlé ; 13 h ensuite, suffisant.
  const soir = A.plagesInterventions([intervention({ jour: SEM, debut: '18:00', fin: '19:00', heures: 1 })], 2, SEM);
  assert.deepEqual(R.controlesReposNuit(horaires, [8, 7, 7, 7, 7, 0, 0], SEM, { s, interventions: soir }).repos, []);
  // Deux interventions dans la nuit : seul le repos après la dernière compte.
  const deux = A.plagesInterventions([
    intervention({ id: 1, jour: SEM, debut: '20:00', fin: '21:00', heures: 1 }), intervention({ id: 2, jour: '2026-11-03', debut: '02:00', fin: '03:00', heures: 1 }),
  ], 2, SEM);
  const r2 = R.controlesReposNuit(horaires, [8, 8, 7, 7, 7, 0, 0], SEM, { s, interventions: deux });
  assert.match(r2.repos[0], /5 h avant le mar\. 3 nov\. \(fin de l’intervention d’astreinte à 3 h, reprise à 8 h/);
  // Intervention du dimanche précédent (semaine d'avant), jusqu'à 1 h le lundi : 7 h de repos avant le lundi 8 h.
  const veille = A.plagesInterventions([intervention({ jour: '2026-11-01', debut: '23:00', fin: '01:00', heures: 2 })], 2, SEM);
  assert.match(R.controlesReposNuit(horaires, [7, 7, 7, 7, 7, 0, 0], SEM, { s, interventions: veille, veille: { horaire: null, heures: 2 } }).repos[0], /7 h avant le lun\. 2 nov\. \(fin de l’intervention d’astreinte à 1 h/);
  // Cadre dirigeant : ni repos ni pause contrôlés ; les heures de nuit de l'intervention restent comptées.
  const dir = R.controlesReposNuit(horaires, [9.5, 7, 7, 7, 7, 0, 0], SEM, { s, interventions: int, exclu: true });
  assert.deepEqual([dir.repos, dir.nuit], [[], 2.5]);
  // Salarié mineur (astreinte permise par le réglage) : intervention de nuit refusée comme un horaire de nuit.
  const mineur = R.controlesReposNuit(horaires, [9.5, 7, 7, 7, 7, 0, 0], SEM, { s, interventions: int, naissance: { naissance: 2010, naissanceLe: '2010-01-01' } });
  assert.match(mineur.nuitMineur[0], /Travail de nuit interdit.*lun\. 2 nov\. \(23 h – 1 h 30\)/);
  // La pause se contrôle sur les heures de l'horaire, sans celles de l'intervention.
  assert.deepEqual(R.controlesReposNuit([{ ...J, pause: 0 }, null, null, null, null, null, null], [5.5 + 1, 0, 0, 0, 0, 0, 0], SEM,
    { s, interventions: soir }).pauses, [], '5,5 h de poste et 1 h d’intervention : pas de pause exigée');
});

test('travailleur de nuit : les nuits des interventions comptent sur leur plage réelle (nuitDeLaFeuille, statutNuit)', () => {
  const J = { code: 'J', debut: '08:00', fin: '16:00', pause: 60 }, SEM = '2026-11-02', s = reglagesParDefaut();
  // Lundi : 7 h de poste et une intervention de 22 h à 1 h (3 h), toutes dans la ligne du jour (10 h).
  const lignes = [{ projet: 'INT-MAINT', tache: '', ks: false, h: [7, 7, 7, 7, 7, 0, 0] }, { projet: 'INT-AST', tache: '', ks: false, h: [3, 0, 0, 0, 0, 0, 0] }];
  const int = A.plagesInterventions([intervention({ jour: SEM, debut: '22:00', fin: '01:00', heures: 3 })], 2, SEM);
  const fige = { lignes, horairesFiges: [J, J, J, J, J, null, null] };
  assert.deepEqual(R.nuitDeLaFeuille(fige, s), [0, 0, 0, 0, 0, 0, 0], 'sans les interventions : 10 h étalées de 8 h à 19 h');
  assert.deepEqual(R.nuitDeLaFeuille(fige, s, int), [3, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(R.nuitDeLaFeuille({ lignes }, s, int), [3, 0, 0, 0, 0, 0, 0], 'feuille sans horaire figé : la nuit de l’intervention compte');
  // Deux semaines validées, sans horaire, avec deux nuits d'intervention de 3 h chacune : travailleur de nuit (L3122-5).
  const semaine = (week: string) => ({ id: week.length + Number(week.slice(8)), empId: 2, week, statut: 'validee', lignes: [{ projet: 'INT-AST', tache: '', ks: false, h: [3, 0, 3, 0, 0, 0, 0] }] });
  const nuits = (week: string, id: number) => [0, 2].map(i => intervention({ id: id + i, jour: A.joursDeLIntervention({ jour: week })[i], debut: '22:00', fin: '01:00', heures: 3 }));
  const feuilles = [semaine('2026-09-21'), semaine('2026-09-28')] as never;
  const interventionsAstreinte = [...nuits('2026-09-21', 10), ...nuits('2026-09-28', 20)];
  assert.equal(R.statutNuit({ feuilles, settings: s }, 2, '2026-10-10').travailleur, false, 'sans les interventions : aucune nuit');
  const t = R.statutNuit({ feuilles, settings: s, interventionsAstreinte }, 2, '2026-10-10');
  assert.deepEqual([t.travailleur, t.critere, t.semaines, t.heures12Mois], [true, 'hebdomadaire', 2, 12]);
});

test('réglages des astreintes : délai de 2 à 60 jours, moins de 15 jours avec la référence de l’accord, compensation, mineurs', () => {
  const s = reglagesParDefaut();
  assert.deepEqual(A.reglagesAstreinte(s), { astreinteDelaiPrevenance: 15, astreinteCompensation: 'financiere', astreinteMineurs: false, astreinteAccord: '' });
  assert.deepEqual(A.reglagesAstreinte(undefined), A.reglagesAstreinte(s), 'instantané sans les réglages : valeurs par défaut');
  assert.throws(() => appliquerReglages(s, { astreinteDelaiPrevenance: 10 }), (e: unknown) => e instanceof ReglageInvalide && /accord collectif \(art\. L3121-11\)/.test((e as Error).message));
  assert.equal(appliquerReglages(s, { astreinteDelaiPrevenance: 10, astreinteAccord: 'Accord du 3 mars 2027' }).astreinteDelaiPrevenance, 10);
  assert.equal(appliquerReglages(s, { astreinteDelaiPrevenance: 1, astreinteAccord: 'Accord' }).astreinteDelaiPrevenance, 2, 'un jour franc au moins');
  assert.equal(appliquerReglages(s, { astreinteDelaiPrevenance: 30 }).astreinteDelaiPrevenance, 30, 'plus long que la loi : sans accord');
  assert.equal(appliquerReglages(s, { astreinteCompensation: 'repos' }).astreinteCompensation, 'repos');
  assert.equal(appliquerReglages(s, { astreinteCompensation: 'autre' }).astreinteCompensation, 'financiere');
  assert.equal(appliquerReglages(s, { astreinteMineurs: true }).astreinteMineurs, true);
});
