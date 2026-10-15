// Tests du Go / No Go : disponibilité sur la présence (fin de contrat, absences, jamais leur nature), déplacement
// couvrant la présence, formalités de détachement (certificat de sécurité sociale, information écrite au-delà de
// 4 semaines) et recalcul des verdicts transmis à Keystone après les actions d'absence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.CURSUS_TODAY = '2026-10-10';
delete process.env.KEYSTONE_URL;
delete process.env.KEYSTONE_TOKEN;

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS, changeVerdicts } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { suivreVerdicts } = await import('../server/src/integrations/keystone-verdicts.ts');
const { contexte, enregistrerAffectation, enregistrerChantier } = await import('../server/src/integrations/keystone-entrant.ts');
const { migrate, REPRISE_DETACHEMENT } = await import('../server/src/migrate.ts');
const { Domain } = await import('../shared/domain.ts');
const { CODES_MOTIF, secuDe } = await import('../shared/constants.ts');
const { matricule } = await import('../shared/format.ts');
type User = import('../shared/types.ts').CurrentUser;
type Voyage = import('../shared/types.ts').Voyage;
type Corps = Record<string, any>;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: 'Manager · Maintenance' };

/** Base de démonstration ; les actions passent par le même enchaînement que POST /api/actions/:nom (suivi des verdicts compris). */
function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const run = (user: User, name: string, payload: Record<string, unknown>) => db.tx(() => {
    const r = ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload);
    if (changeVerdicts(name)) suivreVerdicts(db);
    return r;
  });
  /** Domaine vu par le RH, à la date du jour ou à une autre date (`ti`). */
  const domain = (ti?: string) => new Domain(ti ? { ...loadFull(db, RH), today: ti } : loadFull(db, RH));
  const verdict = (chantier: string, empId: number, ti?: string) => {
    const d = domain(ti);
    return d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === chantier)!.res.find(r => r.e.id === empId)!;
  };
  /** Motifs d'une ressource : « CODE:niveau ». */
  const motifs = (chantier: string, empId: number, ti?: string) => verdict(chantier, empId, ti).reasons.map(r => `${r.code}:${r.level}`);
  const motif = (chantier: string, empId: number, code: string, ti?: string) => verdict(chantier, empId, ti).reasons.find(r => r.code === code);
  /** Verdicts mis en file pour Keystone (simulation) : chantier, statut et ressource. */
  const envoyes = () => db.all<{ type: string; contenu: Corps }>('envois').filter(e => e.type === 'verdict.modifie').map(e => e.contenu);
  /** Chantier et affectations reçus de Keystone, puis premier verdict mémorisé. */
  const chantier = (id: string, c: Corps, affectations: [empId: number, du: string, au: string][]) => db.tx(() => {
    enregistrerChantier(contexte(db), id, c);
    affectations.forEach(([empId, du, au], i) => enregistrerAffectation(contexte(db), `AF-${id}-${i}`, { matricule: matricule(empId), chantier: id, du, au }));
    suivreVerdicts(db);
  });
  const voyages = (empId: number) => db.all<Voyage>('voyages').filter(v => v.empId === empId);
  return { db, run, domain, verdict, motifs, motif, envoyes, chantier, voyages };
}
const refus = (re: RegExp, status = 400) => (e: unknown) => e instanceof ActionError && e.status === status && re.test(e.message);

// — t058 : fin de contrat —

test('t058 : un contrat qui finit pendant la présence bloque la ressource ; présence écourtée ou contrat prolongé, plus rien', () => {
  const { db, run, motifs, motif, envoyes, chantier, domain } = fresh();
  // Lucas Martin : CDD jusqu'au 29 janvier 2027. Léa Girard : intérimaire sans fin de mission connue.
  // Visite récente pour Lucas Martin (son aptitude échoit le 22 janvier 2027, avant le chantier : motif APTITUDE).
  db.update('employes', 4, { visite: '2026-06-01' });
  chantier('K-T1', { nom: 'Arrêt technique', lieu: 'Feyzin', pays: 'FR', debut: '2027-01-25', fin: '2027-02-05' }, [[4, '2027-01-25', '2027-02-05'], [15, '2027-01-25', '2027-02-05']]);
  assert.deepEqual(motifs('K-T1', 4), ['CONTRAT:nogo']);
  assert.deepEqual(motif('K-T1', 4, 'CONTRAT')!.minimal, 'Contrat terminé avant la fin du chantier');
  assert.equal(motif('K-T1', 4, 'CONTRAT')!.detailed, 'Fin de contrat le 29 janv. 2027 — présence prévue du 25 janv. au 5 févr. 2027');
  assert.deepEqual(motifs('K-T1', 15), []);

  // Fin de mission saisie par le RH : No Go signalé à Keystone (la fiche n'est pas une famille sans effet sur le verdict).
  run(RH, 'employe.modifier', { id: 15, fin: '2027-01-31' });
  assert.equal(motif('K-T1', 15, 'CONTRAT')!.detailed, 'Fin de mission le 31 janv. 2027 — présence prévue du 25 janv. au 5 févr. 2027');
  const v = envoyes().at(-1)!;
  assert.deepEqual([v.chantier, v.ressource.matricule, v.ressource.statut, v.ressource.motifs, v.ressource.precedent], ['K-T1', 'EMP-0015', 'NO_GO', [{ code: 'CONTRAT', niveau: 'NO_GO' }], 'GO']);

  // Présence de Lucas Martin écourtée par Keystone au dernier jour de son contrat : Go.
  chantier('K-T1', { nom: 'Arrêt technique', lieu: 'Feyzin', pays: 'FR', debut: '2027-01-25', fin: '2027-02-05' }, [[4, '2027-01-25', '2027-01-29']]);
  assert.deepEqual(motifs('K-T1', 4), []);
  // Contrat prolongé : Go.
  run(RH, 'employe.modifier', { id: 15, fin: '2027-02-28' });
  assert.deepEqual(motifs('K-T1', 15), []);

  // Entrée après le début de la présence (vu le 20 janvier 2026, avant son arrivée) : même motif.
  const d = domain('2026-01-20'), lucas = d.enrich(90, false).find(e => e.id === 4)!;
  const t0 = { ...d.chantier('K-T1')!, id: 'K-T0', debut: '2026-01-26', fin: '2026-02-06' };
  const r = d.resourceStatus(lucas, t0, []);
  assert.deepEqual(r.reasons.map(x => [x.code, x.level, x.minimal, x.detailed]), [['CONTRAT', 'nogo', 'Contrat non commencé au début du chantier', 'Entrée le 2 févr. 2026 — présence prévue du 26 janv. au 6 févr. 2026']]);
  // Chantier en cours le 4 février : il est arrivé, la borne d'entrée ne compte plus.
  const d4 = domain('2026-02-04');
  assert.deepEqual(d4.resourceStatus(d4.enrich(90, false).find(e => e.id === 4)!, t0, []).reasons, []);
});

// — t185 : absences pendant le chantier —

test('t185 : une absence pendant la présence bloque la ressource, sans jamais sa nature ; les actions d’absence recalculent le verdict', () => {
  const { db, run, motifs, motif, verdict, envoyes, domain } = fresh();
  assert.equal(verdict('K-2614', 18).status, 'go', 'Romain Chevalier, à Tanger du 27 octobre au 6 novembre');
  const dernier = () => envoyes().filter(v => v.chantier === 'K-2614' && v.ressource.matricule === 'EMP-0018').at(-1);

  // Demande de congés en attente : réserve.
  run(RH, 'absence.demander', { empId: 18, kind: 'CP', du: '2026-11-02', au: '2026-11-03' });
  assert.deepEqual(motifs('K-2614', 18), ['ABSENCE:reserve']);
  assert.equal(motif('K-2614', 18, 'ABSENCE')!.minimal, 'Demande d’absence en attente pendant le chantier');
  assert.deepEqual([dernier()!.ressource.statut, dernier()!.ressource.precedent], ['GO_RESERVE', 'GO']);

  // Validée par le manager : No Go, signalé à Keystone avec le seul code de motif.
  const id = db.all<{ id: number; empId: number; statut: string }>('absences').filter(a => a.empId === 18 && a.statut === 'demandee').at(-1)!.id;
  run(KARIM, 'absence.decider', { id, ok: true });
  assert.deepEqual(motifs('K-2614', 18), ['ABSENCE:nogo']);
  assert.equal(motif('K-2614', 18, 'ABSENCE')!.detailed, 'Absent du 2 nov. au 3 nov. 2026');
  assert.deepEqual(dernier()!.ressource, { matricule: 'EMP-0018', statut: 'NO_GO', motifs: [{ code: 'ABSENCE', niveau: 'NO_GO' }], precedent: 'GO_RESERVE' });

  // Annulée par le RH : Go de nouveau.
  run(RH, 'absence.annuler', { id });
  assert.equal(verdict('K-2614', 18).status, 'go');
  assert.deepEqual(dernier()!.ressource, { matricule: 'EMP-0018', statut: 'GO', motifs: [], precedent: 'NO_GO' });

  // Arrêt maladie : même motif ; ni Keystone (partage détaillé compris) ni l'écran Chantiers ne voient sa nature.
  run(RH, 'parametres.maj', { partageKeystone: 'detaille' });
  run(RH, 'absence.saisir', { empId: 18, nature: 'MALADIE', du: '2026-10-28', au: '2026-10-30', justificatif: true, justificatifLe: '2026-10-10' });
  assert.equal(motif('K-2614', 18, 'ABSENCE')!.detailed, 'Absent du 28 oct. au 30 oct. 2026');
  const d = domain(), ch = d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === 'K-2614')!;
  const sortie = JSON.stringify([d.verdictKeystone(ch, true), d.keystonePayload(ch, true), envoyes(), ch.res.flatMap(r => r.reasons)]);
  assert.doesNotMatch(sortie, /maladie|arrêt|congé|CP\b|MALADIE/i);

  // Une absence hors de la présence ne compte que pour le chantier qu'elle touche (Abidjan, à partir du 9 novembre).
  run(KARIM, 'absence.demander', { empId: 18, kind: 'RTT', du: '2026-11-09', au: '2026-11-09' });
  assert.deepEqual(motifs('K-2611', 18).filter(m => m.startsWith('ABSENCE')), ['ABSENCE:nogo']);
  assert.ok(!verdict('K-2614', 18).reasons.some(r => r.code === 'ABSENCE' && r.detailed.includes('9 nov.')));
});

test('t185 : chantier en cours — seule compte la présence restante : une absence terminée ne bloque plus', () => {
  const { run, motifs, motif, chantier, domain, envoyes } = fresh();
  // Sophie Lemaire, affectée du 1er au 30 octobre à un chantier en cours (aujourd'hui : 10 octobre).
  chantier('K-EC', { nom: 'Maintenance en cours', lieu: 'Lyon', pays: 'FR', debut: '2026-10-01', fin: '2026-10-30' }, [[3, '2026-10-01', '2026-10-30']]);
  const d = domain();
  assert.deepEqual(d.presenceRestante(3, d.chantier('K-EC')!), [{ du: '2026-10-10', au: '2026-10-30' }]);
  assert.deepEqual(motifs('K-EC', 3), []);
  // Arrêt du 5 au 6 octobre, saisi après sa reprise : Go, rien n'est signalé à Keystone.
  const avant = envoyes().length;
  run(RH, 'absence.saisir', { empId: 3, nature: 'MALADIE', du: '2026-10-05', au: '2026-10-06', justificatif: true, justificatifLe: '2026-10-07' });
  assert.deepEqual(motifs('K-EC', 3), []);
  assert.equal(envoyes().length, avant);
  // Vu le 4 octobre, avant l'arrêt : il tombait dans la présence, No Go.
  assert.deepEqual(motifs('K-EC', 3, '2026-10-04'), ['ABSENCE:nogo']);
  // Absence en cours (commencée hier) ou à venir : No Go.
  run(RH, 'absence.saisir', { empId: 3, nature: 'MALADIE', du: '2026-10-09', au: '2026-10-12', justificatif: true, justificatifLe: '2026-10-10' });
  assert.equal(motif('K-EC', 3, 'ABSENCE')!.detailed, 'Absent du 9 oct. au 12 oct. 2026');
  // Présence finie (affectation jusqu'au 8 octobre) : plus rien à évaluer sur la disponibilité ni, à l'étranger, le déplacement.
  chantier('K-EC2', { nom: 'Expertise', lieu: 'Tanger', pays: 'MA', debut: '2026-10-01', fin: '2026-10-30' }, [[3, '2026-10-01', '2026-10-08']]);
  assert.deepEqual(domain().presenceRestante(3, domain().chantier('K-EC2')!), []);
  assert.deepEqual(motifs('K-EC2', 3), []);
});

test('t185 : présence d’une ressource = ses affectations dans les dates du chantier', () => {
  const { run, motifs, chantier, domain } = fresh();
  // Mehdi Benali : présent la première semaine seulement d'un chantier de deux semaines, puis du 30 au 31 (jointif, fusionné).
  chantier('K-T2', { nom: 'Révision compresseurs', lieu: 'Lyon', pays: 'FR', debut: '2026-11-16', fin: '2026-11-30' }, [[2, '2026-11-10', '2026-11-20'], [2, '2026-11-21', '2026-11-22'], [2, '2026-11-30', '2026-12-04']]);
  const d = domain();
  assert.deepEqual(d.presence(2, d.chantier('K-T2')!), [{ du: '2026-11-16', au: '2026-11-22' }, { du: '2026-11-30', au: '2026-11-30' }]);
  assert.deepEqual(d.presence(3, d.chantier('K-T2')!), [{ du: '2026-11-16', au: '2026-11-30' }], 'sans affectation : les dates du chantier');
  // Récupération entre les deux présences : sans effet ; le dernier jour de présence : No Go.
  run(KARIM, 'absence.demander', { empId: 2, kind: 'RTT', du: '2026-11-25', au: '2026-11-25' });
  assert.deepEqual(motifs('K-T2', 2), []);
  run(KARIM, 'absence.demander', { empId: 2, kind: 'RTT', du: '2026-11-30', au: '2026-11-30' });
  assert.deepEqual(motifs('K-T2', 2), ['ABSENCE:nogo']);
});

test('t185 : les actions d’absence ne sont plus exclues du recalcul des verdicts', () => {
  for (const nom of ['absence.demander', 'absence.decider', 'absence.signaler', 'absence.saisir', 'absence.qualifier', 'absence.prolonger', 'absence.annuler', 'voyage.detachement', 'employe.modifier']) {
    assert.ok(changeVerdicts(nom), nom);
  }
  for (const nom of ['temps.setCell', 'cet.placer', 'report.accorder', 'entretien.planifier', 'envoi.relancer']) assert.ok(!changeVerdicts(nom), nom);
});

// — t084 : déplacement couvrant la présence —

test('t084 : seul un déplacement couvrant toute la présence vaut ; un voyage des mois plus tard, non', () => {
  const { db, run, motifs, motif, voyages } = fresh();
  // Thomas Garnier, à Tanger du 27 octobre au 6 novembre : demande Keystone en attente.
  assert.equal(motif('K-2614', 6, 'DEPLACEMENT')!.minimal, 'Déplacement en attente de validation RH');
  run(RH, 'keystone.refuser', { id: loadFull(db, RH).demandesKeystone.find(x => x.ref === 'DK-2026-0398')!.id });
  assert.equal(motif('K-2614', 6, 'DEPLACEMENT')!.minimal, 'Déplacement à créer');

  // Voyage au Maroc en mars : il ne couvre pas le chantier de novembre.
  run(RH, 'voyage.creer', { empId: 6, dest: 'MA', depart: '2027-03-08', retour: '2027-03-12', motif: 'Visite client — Casablanca' });
  assert.equal(motif('K-2614', 6, 'DEPLACEMENT')!.minimal, 'Déplacement à créer');
  assert.ok(!motifs('K-2614', 6).some(m => m.startsWith('DEPLACEMENT_PARTIEL') || m.startsWith('DETACHEMENT')));

  // Départ le lendemain du début : couverture partielle (réserve).
  run(RH, 'voyage.creer', { empId: 6, dest: 'MA', depart: '2026-10-28', retour: '2026-11-06', motif: 'Rétrofit — Tanger' });
  assert.ok(!motif('K-2614', 6, 'DEPLACEMENT'));
  const p = motif('K-2614', 6, 'DEPLACEMENT_PARTIEL')!;
  assert.equal(p.level, 'reserve');
  assert.equal(p.detailed, 'Couverture partielle : déplacement du 28 oct. au 6 nov. 2026, présence du 27 oct. au 6 nov. 2026');

  // Déplacement de la veille au lendemain : couvert ; seules ses formalités comptent. Il chevauche le précédent, ce que
  // `voyage.creer` refuse désormais (conflits de dates) ; une base antérieure peut en garder : inséré directement.
  db.insert('voyages', {
    empId: 6, dest: 'MA', depart: '2026-10-26', retour: '2026-11-07', motif: 'Rétrofit — Tanger', origine: 'cursus', ref: null, chantier: null,
    detachementLe: null, informationLe: null,
  });
  assert.ok(!motifs('K-2614', 6).some(m => m.startsWith('DEPLACEMENT')));
  assert.equal(voyages(6).length, 3);
  // Couverte : seules comptent les formalités du déplacement qui la couvre (celui du 28, sans certificat, est ignoré).
  // Départ dans 16 jours, certificat de la convention (21 jours indicatifs) pas demandé : réserve d'urgence ; No Go le jour du départ.
  assert.deepEqual(motifs('K-2614', 6).filter(m => m.startsWith('DETACHEMENT')), ['DETACHEMENT:reserve']);
  assert.equal(motif('K-2614', 6, 'DETACHEMENT')!.detailed, 'Détachement à préparer d’urgence : Certificat de détachement');
  assert.equal(motif('K-2614', 6, 'DETACHEMENT', '2026-10-26')!.level, 'nogo');
  run(RH, 'voyage.detachement', { id: voyages(6).find(v => v.depart === '2026-10-26')!.id, detachementLe: '2026-10-09' });
  assert.ok(!motifs('K-2614', 6).some(m => m.startsWith('DETACHEMENT')));
  // Romain Chevalier : déplacement aux dates exactes du chantier, dossier complet (certificat de détachement obtenu).
  assert.deepEqual(motifs('K-2614', 18), []);
});

// — t065 : formalités de détachement —

test('t065 : régime de sécurité sociale par destination, A1 par défaut en Europe', () => {
  assert.equal(secuDe({ code: 'DE', secu: null }), 'a1');
  assert.equal(secuDe({ code: 'CH', secu: null }), 'a1');
  assert.equal(secuDe({ code: 'MA', secu: null }), 'convention');
  assert.equal(secuDe({ code: 'GH', secu: null }), 'hors_convention');
  assert.equal(secuDe({ code: 'GH', secu: 'convention' }), 'convention', 'le référentiel prime sur le code pays');
  const { domain } = fresh();
  const d = domain(), romain = d.ds.voyages.find(v => v.empId === 18 && v.chantier === 'K-2614')!;
  const item = d.readiness(d.emp(18)!, romain).items.find(i => i.k === 'detachement')!;
  assert.deepEqual([item.label, item.ok], ['Certificat de détachement', true]);
  assert.match(item.text, /^Obtenu le 5 oct\. 2026 · Convention bilatérale/);
  assert.match(d.destSummary(d.destOf('GH')!), /sécurité sociale : Maintien au régime français\.$/);
});

test('t065 : certificat de détachement à obtenir avant le départ — réserve, puis No Go s’il n’est pas fait au départ', () => {
  const { db, run, motifs, motif, envoyes, voyages, domain } = fresh();
  // Nicolas Perrin, São Paulo du 18 au 29 janvier : convention bilatérale, certificat pas encore demandé.
  const bresil = voyages(22).find(v => v.dest === 'BR')!;
  assert.deepEqual(motifs('K-2631', 22).filter(m => m.startsWith('DETACHEMENT')), ['DETACHEMENT:reserve']);
  assert.equal(motif('K-2631', 22, 'DETACHEMENT')!.detailed, 'Détachement à préparer : Certificat de détachement');
  // Moins de 21 jours avant le départ, toujours rien : délai indicatif entamé, « Urgent » au dossier voyage, mais réserve.
  const d = domain('2027-01-05');
  assert.equal(d.tripsAll().find(t => t.id === bresil.id)!.r.items.find(i => i.k === 'detachement')!.statut, 'Urgent');
  assert.equal(motif('K-2631', 22, 'DETACHEMENT', '2027-01-05')!.level, 'reserve');
  assert.equal(motif('K-2631', 22, 'DETACHEMENT', '2027-01-05')!.detailed, 'Détachement à préparer d’urgence : Certificat de détachement');
  // Jour du départ sans certificat : il n'est pas fait au départ, No Go.
  assert.equal(motif('K-2631', 22, 'DETACHEMENT', '2027-01-17')!.level, 'reserve');
  assert.equal(motif('K-2631', 22, 'DETACHEMENT', '2027-01-18')!.level, 'nogo');
  assert.equal(motif('K-2631', 22, 'DETACHEMENT', '2027-01-18')!.minimal, 'Formalités de détachement non faites au départ');
  assert.equal(motif('K-2631', 22, 'DETACHEMENT', '2027-01-18')!.detailed, 'Détachement non fait au départ : Certificat de détachement');

  // Contrôles de la saisie.
  assert.throws(() => run(RH, 'voyage.detachement', { id: bresil.id, detachementLe: '2026-10-11' }), refus(/Certificat de détachement : la date ne peut pas être à venir/));
  assert.throws(() => run(RH, 'voyage.detachement', { id: bresil.id, detachementLe: '09/10/2026' }), refus(/date invalide/));
  assert.throws(() => run(RH, 'voyage.detachement', { id: bresil.id }), refus(/Aucune formalité/));
  assert.throws(() => run(RH, 'voyage.detachement', { id: 999, detachementLe: '2026-10-09' }), refus(/introuvable/, 404));
  assert.throws(() => run(KARIM, 'voyage.detachement', { id: bresil.id, detachementLe: '2026-10-09' }), refus(/service RH/, 403));

  // Certificat obtenu : la réserve tombe, Keystone en est informé (codes seulement).
  const avant = envoyes().length;
  assert.match(String(run(RH, 'voyage.detachement', { id: bresil.id, detachementLe: '2026-10-09' })), /Formalités de détachement enregistrées — Nicolas Perrin, Brésil/);
  assert.equal(db.get<Voyage>('voyages', bresil.id)!.detachementLe, '2026-10-09');
  assert.ok(!motifs('K-2631', 22).some(m => m.startsWith('DETACHEMENT')));
  const v = envoyes().slice(avant).find(x => x.chantier === 'K-2631' && x.ressource.matricule === 'EMP-0022')!;
  assert.ok(!v.ressource.motifs.some((m: Corps) => m.code === 'DETACHEMENT'));
  // Date effacée (saisie erronée) : de nouveau à faire.
  run(RH, 'voyage.detachement', { id: bresil.id, detachementLe: '' });
  assert.equal(db.get<Voyage>('voyages', bresil.id)!.detachementLe, null);
  assert.deepEqual(motifs('K-2631', 22).filter(m => m.startsWith('DETACHEMENT')), ['DETACHEMENT:reserve']);
});

test('t065 : déplacement créé dans le délai indicatif de l’A1 — réserve (dossier « Urgent »), pas de No Go avant le départ', () => {
  const { db, run, motifs, motif, chantier, voyages } = fresh();
  db.insert('destinations', { code: 'DE', pays: 'Allemagne', visa: 'none', visaSub: 'espace Schengen', oblig: [], rec: [], passMois: 0 });
  // Romain Chevalier en Allemagne les 15 et 16 octobre (A1 : 7 jours indicatifs) ; aujourd'hui, 10 octobre.
  chantier('K-DE', { nom: 'Dépannage', lieu: 'Ludwigshafen', pays: 'DE', debut: '2026-10-15', fin: '2026-10-16' }, [[18, '2026-10-15', '2026-10-16']]);
  assert.deepEqual(motifs('K-DE', 18), ['DEPLACEMENT:reserve']);
  // Créer le déplacement n'aggrave pas le verdict : réserve, le temps de demander l'A1 en ligne.
  run(RH, 'voyage.creer', { empId: 18, dest: 'DE', depart: '2026-10-15', retour: '2026-10-16', motif: 'Dépannage — Ludwigshafen' });
  assert.deepEqual(motifs('K-DE', 18), ['DETACHEMENT:reserve']);
  assert.equal(motif('K-DE', 18, 'DETACHEMENT')!.detailed, 'Détachement à préparer d’urgence : Certificat A1');
  assert.equal(motif('K-DE', 18, 'DETACHEMENT', '2026-10-15')!.level, 'nogo');
  // A1 obtenu le jour même : Go.
  run(RH, 'voyage.detachement', { id: voyages(18).find(v => v.dest === 'DE')!.id, detachementLe: '2026-10-10' });
  assert.deepEqual(motifs('K-DE', 18), []);
});

test('t065 : mission de plus de 4 semaines en Europe — certificat A1 et information écrite avant le départ', () => {
  const { db, run, motifs, motif, chantier, domain, voyages } = fresh();
  db.insert('destinations', { code: 'DE', pays: 'Allemagne', visa: 'none', visaSub: 'espace Schengen', oblig: [], rec: [], passMois: 0 });
  // Sarah Cohen à Ludwigshafen du 1er février au 5 mars 2027 (33 jours), voyage de la veille au lendemain.
  chantier('K-T3', { nom: 'Mise en service réacteur', lieu: 'Ludwigshafen', pays: 'DE', debut: '2027-02-01', fin: '2027-03-05' }, [[23, '2027-02-01', '2027-03-05']]);
  run(RH, 'voyage.creer', { empId: 23, dest: 'DE', depart: '2027-01-31', retour: '2027-03-06', motif: 'Mise en service — Ludwigshafen' });
  const t = voyages(23).find(v => v.dest === 'DE')!;
  const items = () => { const d = domain(); return d.readiness(d.emp(23)!, d.ds.voyages.find(v => v.id === t.id)!).items.filter(i => i.k === 'detachement' || i.k === 'information'); };
  assert.deepEqual(items().map(i => [i.label, i.ok, i.lead]), [['Certificat A1', false, 7], ['Information écrite (mission de plus de 4 semaines)', false, 1]]);
  assert.match(items()[1].text, /^Mission de 35 jours : à remettre par le service RH avant le 31 janv\. 2027/);
  assert.equal(motif('K-T3', 23, 'DETACHEMENT')!.detailed, 'Détachement à préparer : Certificat A1, Information écrite (mission de plus de 4 semaines)');
  // Jour du départ sans rien : No Go.
  assert.equal(motif('K-T3', 23, 'DETACHEMENT', '2027-01-31')!.level, 'nogo');

  // A1 obtenu ; trois jours avant le départ, l'information reste à remettre (réserve), le jour même elle manque (No Go).
  run(RH, 'voyage.detachement', { id: t.id, detachementLe: '2026-10-10' });
  assert.equal(motif('K-T3', 23, 'DETACHEMENT', '2027-01-28')!.level, 'reserve');
  assert.equal(motif('K-T3', 23, 'DETACHEMENT', '2027-01-28')!.detailed, 'Détachement à préparer : Information écrite (mission de plus de 4 semaines)');
  assert.equal(motif('K-T3', 23, 'DETACHEMENT', '2027-01-31')!.level, 'nogo');
  // Information remise : dossier complet, Go.
  run(RH, 'voyage.detachement', { id: t.id, informationLe: '2026-10-10' });
  assert.deepEqual(items().map(i => i.ok), [true, true]);
  assert.deepEqual(motifs('K-T3', 23), []);
  assert.equal(domain().tripsAll().find(x => x.id === t.id)!.r.status, 'pret');
  // Mission courte : pas d'information écrite exigée.
  const d = domain();
  assert.ok(!d.readiness(d.emp(23)!, { dest: 'DE', depart: '2027-04-05', retour: '2027-05-02' }).items.some(i => i.k === 'information'), '28 jours');
  assert.ok(d.readiness(d.emp(23)!, { dest: 'DE', depart: '2027-04-05', retour: '2027-05-03' }).items.some(i => i.k === 'information'), '29 jours');
});

test('t065 : formalités de détachement de la démonstration et dossier vu par le manager', () => {
  const { domain } = fresh();
  const d = domain(), statut = (empId: number, dest: string) => d.tripsAll().find(t => t.empId === empId && t.dest === dest)!.r;
  // Certificats obtenus : Houston, Tanger, Abidjan, Tema ; à demander : Riyad (pays sans convention), São Paulo.
  assert.equal(statut(18, 'MA').status, 'pret');
  assert.equal(statut(9, 'SA').items.find(i => i.k === 'detachement')!.label, 'Maintien au régime français');
  assert.equal(statut(9, 'SA').items.find(i => i.k === 'detachement')!.ok, false);
  // Inès Dupont : congé validé le 4 décembre, pendant l'audit de Tema → No Go (motif ABSENCE).
  const ch = d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === 'K-2625')!;
  assert.equal(ch.res.find(r => r.e.id === 5)!.status, 'nogo');
  assert.ok(ch.res.find(r => r.e.id === 5)!.reasons.some(r => r.code === 'ABSENCE' && r.detailed === 'Absent le 4 déc. 2026'));
});

test('t065 : mise à jour d’une base antérieure — déplacements déjà partis réputés en règle (une fois, tracé), à venir en réserve', () => {
  const { db, motifs, voyages } = fresh();
  // Base antérieure au suivi du détachement (aucune formalité saisie), mise à jour le 1er novembre : Romain Chevalier est
  // à Tanger depuis le 27 octobre, Karim Haddad part pour Abidjan le 9 novembre.
  db.sql.exec('UPDATE voyages SET detachement_le = NULL, information_le = NULL');
  const jour = process.env.CURSUS_TODAY;
  process.env.CURSUS_TODAY = '2026-11-01';
  try {
    assert.ok(motifs('K-2614', 18).includes('DETACHEMENT:nogo'), 'sans reprise : No Go pour un salarié déjà sur place');
    migrate(db);
    assert.equal(voyages(18).find(v => v.dest === 'MA')!.detachementLe, '2026-10-27', 'réputé fait au départ');
    assert.ok(!motifs('K-2614', 18).some(m => m.startsWith('DETACHEMENT')));
    // Déplacement à venir : à compléter par le service RH, réserve jusqu'au départ.
    assert.equal(voyages(12).find(v => v.dest === 'CI')!.detachementLe, null);
    assert.ok(motifs('K-2611', 12).includes('DETACHEMENT:reserve'));
    const j = db.all<{ action: string; actor: string; message: string; payload: Corps }>('journal').filter(x => x.action === 'migration.detachement');
    assert.deepEqual(j.map(x => [x.actor, x.message]), [['Cursus', 'Reprise : formalités de détachement réputées faites au départ pour 1 déplacement en cours à la mise à jour']]);
    assert.deepEqual(j[0].payload.voyages.map((v: Corps) => [v.matricule, v.dest, v.depart]), [['EMP-0018', 'MA', '2026-10-27']]);
    assert.equal(db.getSetting(REPRISE_DETACHEMENT, null), '2026-11-01');
    // Une seule fois : un déplacement parti ensuite sans formalité reste bloquant.
    db.sql.exec(`UPDATE voyages SET detachement_le = NULL WHERE dest = 'MA'`);
    migrate(db);
    assert.ok(motifs('K-2614', 18).includes('DETACHEMENT:nogo'));
  } finally {
    process.env.CURSUS_TODAY = jour;
  }
});

// — Contrat de l'API : chaque code documenté —

test('codes de motif : chacun documenté dans le guide Keystone et dans la spécification OpenAPI', () => {
  const guide = readFileSync(join(ROOT, 'docs/API-KEYSTONE.md'), 'utf8');
  const spec = JSON.parse(readFileSync(join(ROOT, 'docs/keystone-openapi.json'), 'utf8'));
  for (const code of CODES_MOTIF) {
    assert.ok(guide.includes(`| \`${code}\` |`), `${code} dans docs/API-KEYSTONE.md`);
    assert.ok(spec.components.schemas.CodeMotif.description.includes(code), `${code} décrit dans la spécification`);
  }
});
