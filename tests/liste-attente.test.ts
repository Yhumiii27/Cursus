// Tests : liste d'attente des sessions complètes (lot 7, chantier C, étape 1, t120 ; server/src/liste-attente.ts,
// shared/rules/liste-attente.ts). Demande acceptée sur une session complète (file, rang, réponse explicite, repli au plan),
// promotion à chaque libération de place (changement de session, désinscription, recyclage enregistré, places augmentées,
// sortie, réouverture d'une demande, retrait d'une personne proposée), confirmation par le service RH ou inscription
// automatique, salariés non admissibles passés avec un motif codé au journal, retrait, file close à l'annulation et à la
// clôture, filtrage de l'instantané par profil.
// Jeu de démonstration au 10 octobre 2026 : session 2 = SST du 18 novembre (12 places, Nadia Kaci inscrite en formation
// initiale). Les cas la réduisent à une place : elle est complète.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase, PG } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { Domain } = await import('../shared/domain.ts');
const { avecPositions, fileDe, nonAdmissible, placesAProposer, placeTexte, rangSuivant } = await import('../shared/rules/liste-attente.ts');
type User = Parameters<typeof buildSnapshot>[1];
type Attente = import('../shared/types.ts').AttenteSession;

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Responsable RH' };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: 'Manager · Maintenance' };
const HUGO: User = { role: 'manager', empId: 16, nom: 'Hugo Lambert', intitule: 'Manager · Logistique' };
const MEHDI: User = { role: 'collaborateur', empId: 2, nom: 'Mehdi Benali', intitule: 'Technicien' };
const HSE: User = { role: 'rh', empId: null, salarieId: 23, profilRh: 'referent_hse', nom: 'Sarah Cohen', intitule: 'Référente HSE' } as User;
const PAIE: User = { role: 'rh', empId: null, salarieId: 7, profilRh: 'paie', nom: 'Aïcha Diallo', intitule: 'Paie' } as User;

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  // Session SST du 18 novembre réduite à une place : complète (Nadia Kaci, formation initiale).
  await db.update('sessions', 2, { places: 1 });
  const run = async (user: User, name: string, payload: Record<string, unknown>) => {
    const out = await db.tx(async () => await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), payload));
    return typeof out === 'object' && out !== null ? out.message ?? '' : out ?? '';
  };
  const domain = async () => new Domain(await loadFull(db, RH));
  const attentes = async (): Promise<Attente[]> => (await loadFull(db, RH)).attentesSession ?? [];
  const attenteDe = async (empId: number, sessionId = 2) => (await attentes()).find(a => a.empId === empId && a.sessionId === sessionId)!;
  /** Demande de formation SST de `empId` pour la session 2, en attente de décision. */
  const demande = async (empId: number, sessionId = 2, f = 'sst') => (await db.insert<{ id: number }>('demandesCollab', {
    empId, type: 'formation', f, h: null, libelle: null, label: null, sessionId, motif: 'Recyclage', date: '2026-10-08', statut: 'attente', reponse: null, parId: null,
  })).id;
  const demandeDe = async (id: number) => (await loadFull(db, RH)).demandesCollab.find(r => r.id === id)!;
  /** Demande acceptée par le service RH sur la session complète : en liste d'attente. */
  const enAttente = async (empId: number, sessionId = 2) => { const id = await demande(empId, sessionId); await run(RH, 'demande.accepter', { id }); return id; };
  const emails = async (type: string) => (await db.query<{ contenu: unknown }>('SELECT contenu FROM envois WHERE cible = ? AND type = ? ORDER BY id', ['email', type]))
    .map(e => (typeof e.contenu === 'string' ? JSON.parse(e.contenu) : e.contenu) as { a: string[]; objet: string; texte: string });
  const journal = async (action: string) => (await db.query<{ payload: unknown; salaries: unknown }>('SELECT payload, salaries FROM journal WHERE action = ? ORDER BY id', [action]))
    .map(l => ({ payload: (typeof l.payload === 'string' ? JSON.parse(l.payload) : l.payload) as Record<string, unknown> }));
  const certSst = async (empId: number) => (await domain()).emp(empId)!.certs.find(c => c.f === 'sst')!;
  return { db, run, domain, attentes, attenteDe, demande, demandeDe, enAttente, emails, journal, certSst };
}

// — Règles pures —

test('règles : file par ordre d’arrivée, place de chacun, places à proposer, rang suivant', () => {
  const a = (id: number, rang: number, statut: Attente['statut'], sessionId = 1): Attente => ({
    id, sessionId, empId: id, demandeId: null, certId: null, inscriptionId: null, rang, le: '2026-10-01', par: null, statut,
    proposeeLe: null, issueLe: null, issuePar: null, issue: null,
  });
  const l = [a(1, 3, 'attente'), a(2, 1, 'retire'), a(3, 2, 'proposee'), a(4, 4, 'attente'), a(5, 1, 'attente', 2)];
  assert.deepEqual(fileDe(l, 1).map(x => x.id), [3, 1, 4], 'retirée hors de la file, ordre du rang');
  assert.deepEqual(avecPositions(l).map(x => x.position), [2, null, 1, 3, 1]);
  assert.equal(rangSuivant(l, 1), 5, 'après le plus grand rang, attentes closes comprises');
  assert.equal(rangSuivant(l, 9), 1);
  assert.equal(placesAProposer({ id: 1, places: 10, inscrits: 8 }, l), 1, 'deux places libres, une déjà proposée');
  assert.equal(placesAProposer({ id: 1, places: 10, inscrits: 10 }, l), 0);
  assert.equal(placeTexte(1), '1er en liste d’attente');
  assert.equal(placeTexte(3), '3e en liste d’attente');
});

// — Demande acceptée sur une session complète —

test('demande acceptée sur une session complète : liste d’attente, rang, réponse explicite et e-mail', async () => {
  const { run, attenteDe, demande, demandeDe, emails, certSst, enAttente } = await fresh();
  const id = await demande(2);
  const msg = await run(RH, 'demande.accepter', { id });
  assert.match(msg, /Mehdi Benali — session du 18 nov\. 2026 complète : 1er en liste d’attente/);
  const a = await attenteDe(2);
  assert.equal(a.statut, 'attente');
  assert.equal(a.rang, 1);
  assert.equal(a.position, 1);
  assert.equal(a.certId, (await certSst(2)).id, 'recyclage de la certification en vigueur');
  assert.equal(a.demandeId, id);
  const r = await demandeDe(id);
  assert.equal(r.statut, 'acceptee');
  assert.deepEqual(r.suite, { attenteId: a.id });
  assert.match(r.reponse!, /^Session du 18 nov\. 2026 complète — placé 1er en liste d’attente ce jour : vous serez inscrit si une place se libère$/);
  assert.equal((await certSst(2)).sessionId, null, 'pas inscrit');
  const mail = (await emails('attente.formation')).at(-1)!;
  assert.match(mail.objet, /^Liste d’attente : Sauveteur secouriste/);
  assert.match(mail.texte, /est complète : vous êtes 1er en liste d’attente/);
  // Un second arrive derrière lui ; une demande pour la même session, déjà en file : refusée.
  await enAttente(18);
  assert.equal((await attenteDe(18)).position, 2);
  await assert.rejects(async () => await run(RH, 'demande.accepter', { id: await demande(2) }), /déjà en liste d’attente/);
});

test('session complète : repli au plan de formation sur choix, ou liste d’attente désactivée, avec mention explicite', async () => {
  const { db, run, demande, demandeDe, attentes } = await fresh();
  const id = await demande(2);
  const msg = await run(RH, 'demande.accepter', { id, complete: 'plan' });
  assert.match(msg, /session du 18 nov\. 2026 complète, demande ajoutée au plan de formation 2026/);
  assert.match((await demandeDe(id)).reponse!, /^Session du 18 nov\. 2026 complète — ajoutée au plan de formation 2026 \(T4\) : le service RH vous inscrira/);
  assert.equal((await attentes()).length, 0);
  // Réglage désactivé : le plan, comme avant le lot 7.
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), formationsListeAttente: false });
  const id2 = await demande(18);
  await run(RH, 'demande.accepter', { id: id2 });
  assert.ok((await demandeDe(id2)).suite?.planId);
  assert.equal((await attentes()).length, 0);
});

test('session complète, salarié absent ce jour-là : refus comme pour une inscription, rien en file', async () => {
  const { db, run, demande, attentes } = await fresh();
  await db.insert('absences', { empId: 2, type: 'CP', du: '2026-11-16', au: '2026-11-20', statut: 'validee', keystone: false, justificatif: false });
  await assert.rejects(async () => await run(RH, 'demande.accepter', { id: await demande(2) }), (e: unknown) => e instanceof ActionError && /absence validée.*refusez la demande/.test(e.message));
  assert.equal((await attentes()).length, 0);
});

// — Libération d'une place : un test par point —

test('changement de session : la place libérée est proposée au service RH, qui confirme ; convocation à ce moment-là', async () => {
  const { db, run, attenteDe, enAttente, demandeDe, emails, certSst, journal } = await fresh();
  const id = await enAttente(2);
  const autre = (await db.insert<{ id: number }>('sessions', { formation: 'sst', date: '2026-12-08', fin: '2026-12-08', jours: ['2026-12-08'], horaires: [], lieu: 'Lyon', places: 8, statut: 'Confirmée', planId: null, bilan: null })).id;
  const msg = await run(RH, 'plan.inscrire', { empId: 9, inscriptionId: 4, sessionId: autre, conv: 'later' });
  assert.match(msg, /liste d’attente : Mehdi Benali proposé au service RH \(place à confirmer\)/);
  const a = await attenteDe(2);
  assert.equal(a.statut, 'proposee');
  assert.equal(a.proposeeLe, '2026-10-10');
  assert.equal((await certSst(2)).sessionId, null, 'pas encore inscrit : le service RH confirme');
  const rh = (await emails('attente.proposition')).at(-1)!;
  assert.match(rh.objet, /^Place libérée — liste d’attente : SST du 18 nov\. 2026/);
  assert.match(rh.texte, /Mehdi Benali/);
  assert.equal((await journal('attente.proposee')).at(-1)!.payload.attenteId, a.id);
  const convocations = (await emails('convocation')).length;
  const ok = await run(RH, 'attente.confirmer', { id: a.id });
  assert.match(ok, /Mehdi Benali inscrit à la session SST du 18 nov\. 2026 depuis la liste d’attente/);
  const c = await certSst(2);
  assert.equal(c.sessionId, 2);
  assert.equal(c.convoc, 'now');
  assert.equal(c.convocLe, '2026-10-10');
  assert.equal((await emails('convocation')).length, convocations + 1, 'convocation envoyée à la confirmation');
  const apres = await attenteDe(2);
  assert.equal(apres.statut, 'inscrit');
  assert.equal(apres.issue, 'inscription');
  const r = await demandeDe(id);
  assert.deepEqual(r.suite, { sessionId: 2, certId: c.id, depuis: null, attenteId: a.id });
  assert.match(r.reponse!, /depuis la liste d’attente — convocation envoyée/);
  // Plus de place : une seconde confirmation est refusée.
  await assert.rejects(async () => await run(RH, 'attente.confirmer', { id: a.id }), /Plus en liste d’attente/);
});

test('désinscription : la place libérée est proposée ; le manager qui désinscrit voit le nombre, pas les noms', async () => {
  const { db, run, attenteDe, enAttente, certSst } = await fresh();
  await enAttente(2);
  const msg = await run(RH, 'plan.desinscrire', { empId: 9, sessionId: 2 });
  assert.match(msg, /place libérée · inscription en formation initiale retirée.* · liste d’attente : Mehdi Benali proposé au service RH \(place à confirmer\)$/);
  assert.equal((await attenteDe(2)).statut, 'proposee');
  // Romain Chevalier (Maintenance) inscrit, session de nouveau complète ; Julien Moreau (Production) attend. Karim désinscrit
  // Romain : la place est proposée, sans que le nom d'un salarié d'une autre équipe lui soit donné.
  await db.update('certifications', (await certSst(18)).id, { sessionId: 2, convoc: 'later' });
  await db.update('sessions', 2, { places: 1 });
  await run(RH, 'attente.retirer', { id: (await attenteDe(2)).id });
  await enAttente(8);
  const msg2 = await run(KARIM, 'plan.desinscrire', { empId: 18, sessionId: 2 });
  assert.match(msg2, /liste d’attente : 1 place proposée au service RH$/);
  assert.ok(!msg2.includes('Julien'));
  assert.equal((await attenteDe(8)).statut, 'proposee');
});

test('recyclage enregistré avant la session : place libérée et proposée ; ses propres attentes sortent de la file', async () => {
  const { db, run, attenteDe, enAttente, certSst } = await fresh();
  // Léa Girard (15) inscrite au recyclage de la session 2, qui passe à deux places, complète.
  await db.update('certifications', (await certSst(15)).id, { sessionId: 2, convoc: 'now', convocLe: '2026-10-01' });
  await db.update('sessions', 2, { places: 2 });
  await enAttente(2);
  await enAttente(18);
  const msg = await run(RH, 'cert.ajouter', { empId: 15, f: 'sst', date: '2026-10-05' });
  assert.match(msg, /inscription à la session du 18 nov\. 2026 annulée.*liste d’attente : Mehdi Benali proposé/);
  assert.equal((await attenteDe(2)).statut, 'proposee');
  assert.equal((await attenteDe(18)).statut, 'attente', 'une seule place');
  // Mehdi obtient son recyclage ailleurs : il sort de la file (motif codé), sa place proposée va au suivant.
  const msg2 = await run(RH, 'cert.ajouter', { empId: 2, f: 'sst', date: '2026-10-09' });
  assert.match(msg2, /retiré de la liste d’attente · liste d’attente : Romain Chevalier proposé/);
  const a = await attenteDe(2);
  assert.equal(a.statut, 'retire');
  assert.equal(a.issue, 'deja_certifie');
  assert.equal((await attenteDe(18)).statut, 'proposee');
});

test('places augmentées : autant de propositions que de places ; mode automatique : inscrit et convoqué aussitôt', async () => {
  const { db, run, attenteDe, enAttente, demandeDe, emails, journal } = await fresh();
  await enAttente(2);
  await enAttente(18);
  const id3 = await enAttente(24);
  const msg = await run(RH, 'session.modifier', { id: 2, places: 3 });
  assert.match(msg, /liste d’attente : Mehdi Benali, Romain Chevalier proposés au service RH/);
  assert.equal((await attenteDe(24)).statut, 'attente');
  // Mode automatique : la place suivante inscrit et convoque, sans confirmation.
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), formationsAttenteMode: 'automatique' });
  const avant = (await emails('convocation')).length;
  const msg2 = await run(RH, 'session.modifier', { id: 2, places: 4 });
  assert.match(msg2, /liste d’attente : Bastien Morel inscrit et convoqué/);
  assert.equal((await attenteDe(24)).statut, 'inscrit');
  assert.equal((await emails('convocation')).length, avant + 1);
  assert.match((await demandeDe(id3)).reponse!, /depuis la liste d’attente/);
  assert.equal((await journal('attente.inscrite')).length, 1);
});

test('sortie : ses inscriptions libèrent leur place (proposée) ; ses propres attentes sont retirées', async () => {
  const { db, run, attenteDe, enAttente, certSst } = await fresh();
  // Léa Girard (15) inscrite au recyclage de la session 2, qui passe à deux places, complète.
  await db.update('certifications', (await certSst(15)).id, { sessionId: 2, convoc: 'now', convocLe: '2026-10-01' });
  await db.update('sessions', 2, { places: 2 });
  await enAttente(2);
  // Léa Girard quitte l'entreprise avant la session : sa place est proposée à Mehdi.
  const msg = await run(RH, 'employe.sortie', { id: 15, date: '2026-10-31', motif: 'demission' });
  assert.match(msg, /liste d’attente : Mehdi Benali proposé/);
  assert.equal((await attenteDe(2)).statut, 'proposee');
  // Mehdi sort à son tour avant la session : il quitte la file.
  const msg2 = await run(RH, 'employe.sortie', { id: 2, date: '2026-11-13', motif: 'demission' });
  assert.match(msg2, /retiré de la liste d’attente/);
  const a = await attenteDe(2);
  assert.equal(a.statut, 'retire');
  assert.equal(a.issue, 'hors_contrat');
});

test('réouverture d’une demande : l’inscription défaite libère la place ; une attente en file sort de la liste', async () => {
  const { db, run, attenteDe, demande, demandeDe, enAttente } = await fresh();
  // Session 2 à deux places : Léa Girard y entre par sa demande (place libre), Mehdi attend.
  await db.update('sessions', 2, { places: 2 });
  const lea = await demande(15);
  await run(RH, 'demande.accepter', { id: lea });
  const mehdi = await enAttente(2);
  const msg = await run(RH, 'demande.reouvrir', { id: lea, motif: 'Acceptée par erreur' });
  assert.match(msg, /retiré de la session du 18 nov\. 2026.*liste d’attente : Mehdi Benali proposé/);
  assert.equal((await attenteDe(2)).statut, 'proposee');
  // La demande de Mehdi, rouverte avant la confirmation : il sort de la file, sa demande est de nouveau à décider.
  const msg2 = await run(RH, 'demande.reouvrir', { id: mehdi, motif: 'Session à revoir' });
  assert.match(msg2, /retiré de la liste d’attente de la session du 18 nov\. 2026/);
  const a = await attenteDe(2);
  assert.equal(a.statut, 'retire');
  assert.equal(a.issue, 'demande_rouverte');
  assert.equal((await demandeDe(mehdi)).statut, 'attente');
});

test('non admissible : passé avec un motif codé au journal, le suivant est proposé ; motif définitif : sorti de la file', async () => {
  const { db, run, attenteDe, enAttente, journal, certSst } = await fresh();
  await enAttente(2);
  await enAttente(18);
  await enAttente(24);
  // Mehdi pose un congé sur la session après sa mise en file ; la certification de Romain est corrigée sur une autre
  // formation (plus de recyclage SST à faire).
  await db.insert('absences', { empId: 2, type: 'CP', du: '2026-11-16', au: '2026-11-20', statut: 'validee', keystone: false, justificatif: false });
  await db.update('certifications', (await certSst(18)).id, { annuleLe: '2026-10-09', annulePar: 'Essai', annuleMotif: 'Erreur' });
  const msg = await run(RH, 'plan.desinscrire', { empId: 9, sessionId: 2 });
  assert.match(msg, /Bastien Morel proposé.*passés dans la file : Mehdi Benali \(indisponible un jour de la session\), Romain Chevalier \(certification remplacée ou supprimée depuis\)/);
  assert.equal((await attenteDe(2)).statut, 'attente', 'passé cette fois, toujours en file');
  assert.equal((await attenteDe(18)).statut, 'retire');
  assert.equal((await attenteDe(18)).issue, 'certification_remplacee');
  assert.equal((await attenteDe(24)).statut, 'proposee');
  const sautees = (await journal('attente.sautee')).map(l => l.payload);
  assert.deepEqual(sautees.map(p => [p.empId, p.motif, p.retire]), [[2, 'conflit', false], [18, 'certification_remplacee', true]]);
  // Le journal ne garde que des codes : ni la nature de l'absence, ni ses dates.
  assert.ok(!JSON.stringify(sautees).includes('Absence'));
  // Confirmation de Mehdi, encore en file, refusée : la place libre est proposée à un autre.
  await assert.rejects(async () => await run(RH, 'attente.confirmer', { id: (await attenteDe(2)).id }), /absence validée|déjà proposées/);
});

test('retrait de la file : le salarié, son manager, le service RH ; une place proposée passe au suivant', async () => {
  const { run, attenteDe, enAttente, demandeDe, emails } = await fresh();
  const id = await enAttente(2);
  await enAttente(18);
  await enAttente(24);
  await assert.rejects(async () => await run(HUGO, 'attente.retirer', { id: (await attenteDe(2)).id }), (e: unknown) => e instanceof ActionError && e.status === 403);
  await run(MEHDI, 'attente.retirer', { id: (await attenteDe(2)).id });
  assert.equal((await attenteDe(2)).issue, 'salarie');
  assert.match((await demandeDe(id)).reponse!, /^Retiré de la liste d’attente de la session du 18 nov\. 2026 \(retrait par le salarié\)$/);
  await run(KARIM, 'attente.retirer', { id: (await attenteDe(18)).id });
  assert.equal((await attenteDe(18)).issue, 'manager');
  assert.match((await emails('attente.formation')).at(-1)!.texte, /retrait par le manager/);
  // Bastien proposé (place libérée), puis retiré par le service RH : personne derrière lui, rien à proposer.
  await run(RH, 'plan.desinscrire', { empId: 9, sessionId: 2 });
  assert.equal((await attenteDe(24)).statut, 'proposee');
  await run(RH, 'attente.retirer', { id: (await attenteDe(24)).id });
  assert.equal((await attenteDe(24)).issue, 'rh');
  await assert.rejects(async () => await run(RH, 'attente.retirer', { id: (await attenteDe(24)).id }), /Plus en liste d’attente/);
});

test('session annulée ou clôturée : file close, demandes au plan de formation, à replanifier', async () => {
  const { db, run, attenteDe, enAttente, demandeDe, journal } = await fresh();
  const id = await enAttente(2);
  const msg = await run(RH, 'session.annuler', { id: 2, motif: 'Organisme indisponible' });
  assert.match(msg, /liste d’attente close : 1 personne à replanifier \(une demande au plan de formation\)/);
  const a = await attenteDe(2);
  assert.equal(a.statut, 'retire');
  assert.equal(a.issue, 'session_annulee');
  const r = await demandeDe(id);
  assert.ok(r.suite?.planId);
  assert.equal(r.suite?.attenteId, a.id);
  assert.match(r.reponse!, /^Session du 18 nov\. 2026 annulée — liste d’attente close, ajoutée au plan de formation 2026 \(T4\)/);
  assert.deepEqual((await journal('attente.purgee')).at(-1)!.payload, { sessionId: 2, issue: 'session_annulee', attentes: [a.id] });
  // Clôture d'une session passée avec une file : close de même.
  const s = (await db.insert<{ id: number }>('sessions', { formation: 'sst', date: '2026-10-08', fin: '2026-10-08', jours: ['2026-10-08'], horaires: [], lieu: 'Lyon', places: 1, statut: 'Confirmée', planId: null, bilan: null })).id;
  await db.insert('attentesSession', { sessionId: s, empId: 18, demandeId: null, certId: null, inscriptionId: null, rang: 1, le: '2026-10-01', par: 'Essai', statut: 'attente' });
  await run(RH, 'session.cloturer', { id: s, participants: [] });
  assert.equal((await attenteDe(18, s)).issue, 'session_cloturee');
});

test('instantané : file entière au service RH et au référent HSE, périmètre du manager, la sienne au salarié, sans auteurs', async () => {
  const { db, enAttente } = await fresh();
  await enAttente(2);
  await enAttente(8);
  const vue = async (u: User) => (await buildSnapshot(db, u)).attentesSession ?? [];
  assert.equal((await vue(RH)).length, 2);
  assert.equal((await vue(RH))[0].par, 'Sandrine Vidal');
  const hse = await vue(HSE);
  assert.equal(hse.length, 2);
  assert.ok(hse.every(a => a.par === null && a.issuePar === null));
  assert.equal((await vue(PAIE)).length, 0);
  // Karim (Maintenance) : Mehdi seulement, avec sa place ; Julien Moreau (Production), 2e, reste hors de sa vue.
  assert.deepEqual((await vue(KARIM)).map(a => [a.empId, a.position, a.par]), [[2, 1, null]]);
  assert.deepEqual((await vue(HUGO)), []);
  const julien = await vue({ role: 'collaborateur', empId: 8, nom: 'Julien Moreau', intitule: '' });
  assert.deepEqual(julien.map(a => [a.empId, a.position]), [[8, 2]]);
});

test('admissibilité : session commencée ou formation initiale certifiée depuis, l’attente n’a plus d’objet', async () => {
  const { domain } = await fresh();
  const d = await domain();
  assert.equal(nonAdmissible(d, { sessionId: 6, empId: 2, certId: null, le: '2026-10-01' })?.motif, 'session_commencee');
  // Clara Roussel n'a pas de SST, mais elle est absente (congé) ces jours-là : passée cette fois, pas sortie de la file ;
  // Julien Moreau, recyclage de sa certification en vigueur : admissible ; Nadia est déjà inscrite à la session.
  const clara = nonAdmissible(d, { sessionId: 2, empId: 19, certId: null, le: '2026-10-01' });
  assert.deepEqual([clara?.motif, clara?.definitif, clara?.texte], ['conflit', false, 'indisponible un jour de la session']);
  assert.equal(nonAdmissible(d, { sessionId: 2, empId: 8, certId: d.emp(8)!.certs.find(c => c.f === 'sst')!.id, le: '2026-10-01' }), null);
  assert.equal(nonAdmissible(d, { sessionId: 2, empId: 9, certId: null, le: '2026-10-01' })?.motif, 'deja_inscrit');
  // Initiale, mais une certification obtenue depuis la mise en file.
  assert.equal(nonAdmissible(d, { sessionId: 2, empId: 17, certId: null, le: '2026-03-01' })?.motif, 'deja_certifie');
});

test('migration nommée lot7-formations-index-attentes : index par salarié créé une fois, sans effet ensuite', { skip: PG && 'SQL propre à SQLite (PostgreSQL : 0007_formations.sql)' }, async () => {
  const { SqliteDb } = await import('../server/src/db.ts');
  const { INDEX_ATTENTES } = await import('../server/src/migrations/lot7-formations.ts');
  const { indexExiste } = await import('../server/src/migrations/outils.ts');
  const db = new SqliteDb(':memory:');
  assert.equal(await INDEX_ATTENTES.necessaire!(db), true);
  assert.equal(await INDEX_ATTENTES.executer(db), 'index attentes_session_emp');
  assert.equal(indexExiste(db, 'attentes_session_emp'), true);
  assert.equal(await INDEX_ATTENTES.necessaire!(db), false);
});
