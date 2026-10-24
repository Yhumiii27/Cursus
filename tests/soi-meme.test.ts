// Tests : décisions refusées sur soi-même (lot 8, chantier C, S1 et S2). Un compte RH rattaché à sa propre fiche ne se
// délivre ni titre ni certification, ne lève ni ne retire sa propre habilitation, ne décide pas de sa propre demande et ne
// demande pas d'habilitation pour lui-même ; il ne modifie sur sa fiche que l'adresse e-mail et les jours non travaillés, ne
// change pas sa propre affectation ni son valideur (manager de son équipe ou d'une équipe parente) et ne tient pas son
// propre suivi médical. Se suspendre soi-même reste permis (cela restreint). Chaque refus est contrôlé avec la même saisie
// par un autre membre habilité, qui aboutit.
// Réponse de l'entreprise du 24 octobre 2026 : aucune exception, même pour la seule personne habilitée ; un autre
// administrateur RH, sinon la direction par un compte RH dédié.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { champsAEnvoyer } = await import('../shared/rules/fiche-concurrente.ts');
const { normaliserProfil, profilOf } = await import('../shared/rules/profil.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

// Sarah Cohen (fiche 23) : référente HSE / formation, habilitation travail en hauteur délivrée. Antoine Leroy (fiche 14) :
// gestionnaire RH. Le compte d'administrateur RH du jeu de démonstration n'est rattaché à aucune fiche.
const SARAH = 23, ANTOINE = 14;
/** Refus « soi-même » : la décision revient à un autre membre habilité, à défaut à la direction (jamais au manager). */
const AUTRE = /: la décision revient à un autre membre du service RH.* à défaut, à la direction, par un compte RH dédié$/;

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number };
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' }))!;
  /** Chemin de POST /api/actions/:nom : état lu avant l'action, trace au journal après. */
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return o as { message: string; result?: any };
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>, re: RegExp) => await assert.rejects(async () => await run(u, name, p),
    (e: unknown) => e instanceof ActionError && e.status === 403 && re.test(e.message) && AUTRE.test(e.message), `${name} : refus « soi-même » attendu ${re}`);
  const emp = async (id: number) => (await loadFull(db, await user(null, 'rh'))).employes.find(e => e.id === id)!;
  const ADMIN = await user(null, 'rh'), GEST = await user(ANTOINE, 'rh'), HSE = await user(SARAH, 'rh');
  assert.deepEqual([HSE.profilRh, HSE.salarieId, GEST.profilRh, GEST.salarieId], ['referent_hse', SARAH, 'rh_gestionnaire', ANTOINE], 'comptes rattachés à leur fiche');
  return { db, user, run, refus, emp, ADMIN, GEST, HSE };
}

// — S1 : titres, habilitations et demandes —

test('cert.ajouter : le référent HSE n’ajoute pas de certification à son propre dossier ; un autre membre habilité le fait', async () => {
  const { run, refus, emp, HSE, GEST } = await fresh();
  const saisie = { empId: SARAH, f: 'sst', date: '2026-10-01' };
  await refus(HSE, 'cert.ajouter', saisie, /^Vous ne pouvez pas ajouter une certification à votre propre dossier/);
  assert.equal((await emp(SARAH)).certs.filter(c => c.f === 'sst').length, 1, 'rien n’est écrit');
  assert.match((await run(GEST, 'cert.ajouter', saisie)).message, /ajoutée au dossier de Sarah Cohen/);
  // Le référent HSE garde ce droit pour les autres salariés.
  assert.match((await run(HSE, 'cert.ajouter', { empId: ANTOINE, f: 'sst', date: '2026-10-01' })).message, /ajoutée au dossier de Antoine Leroy/);
});

test('hab.delivrer : le référent HSE ne se délivre pas d’habilitation ; un autre membre habilité la renouvelle', async () => {
  const { run, refus, emp, HSE, GEST } = await fresh();
  const saisie = { empId: SARAH, h: 'hauteur', date: '2026-10-01', par: 'Philippe Aubert', mode: 'renew' };
  await refus(HSE, 'hab.delivrer', saisie, /^Vous ne pouvez pas vous délivrer une habilitation/);
  assert.equal((await emp(SARAH)).habs.find(h => h.h === 'hauteur')!.delivree, '2025-05-05', 'titre inchangé');
  assert.match((await run(GEST, 'hab.delivrer', saisie)).message, /renouvelée — Sarah Cohen/);
  assert.equal((await emp(SARAH)).habs.find(h => h.h === 'hauteur')!.delivree, '2026-10-01');
});

test('hab.suspendre reste permis sur soi-même ; hab.lever et hab.retirer sont refusés et reviennent à un autre membre habilité', async () => {
  const { run, refus, emp, HSE, GEST } = await fresh();
  // Se suspendre soi-même restreint ses propres droits : permis.
  assert.match((await run(HSE, 'hab.suspendre', { empId: SARAH, h: 'hauteur', motif: 'Vertiges à la reprise' })).message, /suspendue — Sarah Cohen/);
  await refus(HSE, 'hab.lever', { empId: SARAH, h: 'hauteur' }, /^Vous ne pouvez pas lever la suspension de votre propre habilitation/);
  assert.equal((await emp(SARAH)).habs.find(h => h.h === 'hauteur')!.mesure, 'suspension', 'suspension maintenue');
  await refus(HSE, 'hab.retirer', { empId: SARAH, h: 'hauteur', motif: 'Fin de mission' }, /^Vous ne pouvez pas retirer votre propre habilitation/);
  assert.equal((await emp(SARAH)).habs.find(h => h.h === 'hauteur')!.mesure, 'suspension', 'le retrait ne masque pas la suspension');
  assert.match((await run(GEST, 'hab.lever', { empId: SARAH, h: 'hauteur' })).message, /^Suspension levée — .* · Sarah Cohen/);
  assert.equal((await emp(SARAH)).habs.find(h => h.h === 'hauteur')!.mesure, null);
  assert.match((await run(GEST, 'hab.retirer', { empId: SARAH, h: 'hauteur', motif: 'Fin de mission' })).message, /retirée — Sarah Cohen/);
});

test('demande.accepter et demande.refuser : personne ne décide de sa propre demande, quel que soit son type', async () => {
  const { db, run, refus, user, HSE, GEST, ADMIN } = await fresh();
  // Sarah, depuis son espace collaborateur, demande une habilitation et une formation.
  const SARAH_C = await user(SARAH, 'collaborateur');
  await run(SARAH_C, 'demande.habilitation', { h: 'he', motif: 'Consignations sur la ligne 2' });
  await run(SARAH_C, 'demande.formation', { f: 'autre', libelle: 'Animation d’un quart d’heure sécurité', motif: 'Prise de poste' });
  const demandes = await db.all<{ id: number; empId: number; type: string; statut: string }>('demandesCollab');
  const hab = demandes.find(r => r.empId === SARAH && r.type === 'habilitation')!, frm = demandes.find(r => r.empId === SARAH && r.type === 'formation')!;
  await refus(HSE, 'demande.accepter', { id: hab.id }, /^Vous ne pouvez pas décider de votre propre demande/);
  await refus(HSE, 'demande.refuser', { id: frm.id, motif: 'Hors plan' }, /^Vous ne pouvez pas décider de votre propre demande/);
  assert.deepEqual((await db.all<{ id: number; statut: string }>('demandesCollab')).filter(r => r.id === hab.id || r.id === frm.id).map(r => r.statut), ['attente', 'attente']);
  assert.match((await run(GEST, 'demande.accepter', { id: hab.id })).message, /Sarah Cohen — .* en attente de délivrance/);
  assert.match((await run(GEST, 'demande.refuser', { id: frm.id, motif: 'Hors plan' })).message, /^Demande refusée — Sarah Cohen/);
  // Document déclaré (service RH seul) : le gestionnaire RH ne valide pas sa propre déclaration ; l'administrateur RH le fait.
  const doc = await db.insert<{ id: number }>('demandesCollab', {
    empId: ANTOINE, type: 'document', f: null, h: null, libelle: null, label: 'Passeport', sessionId: null, motif: 'Déplacement', date: '2026-10-09', statut: 'attente', reponse: null, parId: null,
  });
  await refus(GEST, 'demande.refuser', { id: doc.id, motif: 'Copie illisible' }, /^Vous ne pouvez pas décider de votre propre demande : la décision revient à un autre membre du service RH —/);
  assert.match((await run(ADMIN, 'demande.refuser', { id: doc.id, motif: 'Copie illisible' })).message, /^Demande refusée — Antoine Leroy/);
});

test('hab.demander : le service RH ne demande pas d’habilitation pour son propre compte ; il le fait pour autrui', async () => {
  const { db, run, refus, HSE } = await fresh();
  await refus(HSE, 'hab.demander', { empId: SARAH, h: 'he' }, /^Vous ne pouvez pas demander une habilitation pour vous-même/);
  assert.ok(!(await db.all<{ empId: number; h: string }>('habTitres')).some(t => t.empId === SARAH && t.h === 'he'), 'aucun titre en attente');
  assert.match((await run(HSE, 'hab.demander', { empId: ANTOINE, h: 'he' })).message, /demandée pour Antoine Leroy/);
});

// — S2 : fiche, affectation et suivi médical —

test('employe.modifier : sur sa propre fiche, seuls l’adresse e-mail et les jours non travaillés ; le reste revient à un autre membre du service RH', async () => {
  const { run, refus, emp, GEST, ADMIN } = await fresh();
  const avant = await emp(ANTOINE);
  const champs: [string, unknown, RegExp][] = [
    ['heures', 39, /Heures/], ['temps', 'complet', /Organisation du temps/], ['typeContrat', 'cdd', /Nature du contrat/],
    ['matriculePaie', 'SAGE9001', /Matricule de paie/], ['essaiFin', '2026-12-31', /Fin de la période d’essai/], ['equipe', 'Qualité & HSE', /Équipe/],
  ];
  for (const [k, v, re] of champs) {
    await refus(GEST, 'employe.modifier', { id: ANTOINE, [k]: v }, new RegExp(`^Vous ne pouvez pas modifier sur votre propre fiche : ${re.source} \\(seuls l’adresse e-mail et les jours non travaillés le sont\\)`));
  }
  // Un champ refusé parmi des champs permis : rien n'est enregistré.
  await refus(GEST, 'employe.modifier', { id: ANTOINE, email: 'a.leroy@entreprise.example', heures: 39 }, /^Vous ne pouvez pas modifier sur votre propre fiche : Heures \(/);
  const inchangee = await emp(ANTOINE);
  assert.deepEqual([inchangee.email, inchangee.heures, inchangee.matriculePaie, inchangee.equipe], [avant.email, avant.heures, avant.matriculePaie, avant.equipe]);
  // Champs de confort : permis.
  assert.match((await run(GEST, 'employe.modifier', { id: ANTOINE, email: 'a.leroy@entreprise.example', avant: { email: avant.email } })).message, /Antoine Leroy/);
  assert.equal((await emp(ANTOINE)).email, 'a.leroy@entreprise.example');
  await run(GEST, 'employe.modifier', { id: ANTOINE, jourOff: [] });
  // Un autre membre du service RH modifie le matricule de paie de la fiche.
  await run(ADMIN, 'employe.modifier', { id: ANTOINE, matriculePaie: 'SAGE9001' });
  assert.equal((await emp(ANTOINE)).matriculePaie, 'SAGE9001');
});

test('employe.modifier : la saisie du dialogue pour les seuls jours non travaillés passe, champs liés compris ; une heure changée est refusée', async () => {
  const { run, refus, emp, GEST, ADMIN } = await fresh();
  // L'administrateur RH passe Antoine à temps partiel, 28 h, jour off le mercredi.
  await run(ADMIN, 'employe.modifier', { id: ANTOINE, temps: 'partiel', heures: 28, jourOff: [2], confirmerRtt: true });
  /** Envoi du dialogue de fiche (client/src/dialogs/EmployeDialog.tsx) : champs modifiés et leur groupe, valeurs d'origine. */
  const envoi = async (modif: Record<string, unknown>) => {
    const origine = normaliserProfil(profilOf(await emp(ANTOINE)));
    const saisie = normaliserProfil({ ...origine, ...modif });
    // Changement des seuls jours non travaillés : pas de nouveau régime, la date d'effet ne part pas.
    const champs = champsAEnvoyer(origine, saisie).filter(k => k !== 'tempsDepuis');
    return { id: ANTOINE, ...Object.fromEntries(champs.map(k => [k, saisie[k]])), avant: Object.fromEntries(champs.map(k => [k, origine[k] ?? null])) };
  };
  const vendredi = await envoi({ jourOff: [4] });
  assert.deepEqual(Object.keys(vendredi).filter(k => k !== 'id' && k !== 'avant'), ['temps', 'heures', 'forfaitHeures', 'forfaitJours', 'jourOff'], 'champs liés envoyés ensemble');
  await run(GEST, 'employe.modifier', vendredi);
  assert.deepEqual((await emp(ANTOINE)).jourOff, [4]);
  // Dans le même envoi, une heure changée reste refusée, et seule elle est nommée.
  await refus(GEST, 'employe.modifier', await envoi({ jourOff: [0], heures: 32 }), /^Vous ne pouvez pas modifier sur votre propre fiche : Heures \(seuls/);
  const a = await emp(ANTOINE);
  assert.deepEqual([a.heures, a.jourOff], [28, [4]], 'rien n’est écrit');
});

test('equipe.affecter : le service RH ne change pas sa propre affectation ; un autre membre du service RH le fait', async () => {
  const { run, refus, emp, GEST, ADMIN } = await fresh();
  await refus(GEST, 'equipe.affecter', { empId: ANTOINE, equipe: 'Qualité & HSE' }, /^Vous ne pouvez pas modifier votre propre affectation/);
  await refus(GEST, 'equipe.affecter', { empId: ANTOINE, equipe: null }, /^Vous ne pouvez pas modifier votre propre affectation/);
  assert.equal((await emp(ANTOINE)).equipe, 'Administration');
  await run(ADMIN, 'equipe.affecter', { empId: ANTOINE, equipe: 'Qualité & HSE' });
  assert.equal((await emp(ANTOINE)).equipe, 'Qualité & HSE');
});

test('equipe.manager, equipe.modifier et equipe.parente : le service RH ne change pas son propre valideur ; les autres équipes restent modifiables', async () => {
  const { db, run, refus, GEST, ADMIN } = await fresh();
  const manager = async (nom: string) => ((await db.all<{ nom: string; managerId: number | null; parente: string | null }>('equipes')).find(q => q.nom === nom))!;
  // Antoine encadre l'équipe Administration, dont il est membre : son valideur est le service RH.
  assert.equal((await manager('Administration')).managerId, ANTOINE);
  const AICHA = 7;
  await refus(GEST, 'equipe.manager', { nom: 'Administration', managerId: AICHA }, /^Vous ne pouvez pas changer votre propre valideur/);
  await refus(GEST, 'equipe.modifier', { nom: 'Administration', managerId: AICHA }, /^Vous ne pouvez pas changer votre propre valideur/);
  // Rattacher son équipe à une autre donne pour valideur le manager de celle-ci.
  await refus(GEST, 'equipe.parente', { nom: 'Administration', parente: 'Production' }, /^Vous ne pouvez pas changer votre propre valideur/);
  const adm = await manager('Administration');
  assert.deepEqual([adm.managerId, adm.parente ?? null], [ANTOINE, null], 'rien n’est écrit');
  // Une équipe dont il ne relève pas : permis.
  assert.match((await run(GEST, 'equipe.parente', { nom: 'Logistique', parente: 'Production' })).message, /rattachée à l’équipe Production/);
  // Un autre membre du service RH le fait.
  assert.match((await run(ADMIN, 'equipe.parente', { nom: 'Administration', parente: 'Production' })).message, /rattachée à l’équipe Production/);
  // Équipe parente dont le manager valide Antoine : son manager ne change pas non plus par lui.
  await refus(GEST, 'equipe.manager', { nom: 'Production', managerId: AICHA }, /^Vous ne pouvez pas changer votre propre valideur/);
  assert.equal((await manager('Production')).managerId, 3);
});

test('suivi médical : ni demande, ni annulation, ni avis, ni type de suivi pour soi-même ; un autre membre du service RH les enregistre', async () => {
  const { db, run, refus, emp, GEST, ADMIN } = await fresh();
  await refus(GEST, 'medical.demander', { empId: ANTOINE, motif: 'periodique' }, /^Vous ne pouvez pas demander votre propre visite médicale/);
  assert.equal((await db.all<{ empId: number }>('demandesVisite')).filter(v => v.empId === ANTOINE).length, 0);
  const { result } = await run(ADMIN, 'medical.demander', { empId: ANTOINE });
  await refus(GEST, 'medical.annuler', { id: result.id }, /^Vous ne pouvez pas annuler votre propre demande de visite médicale/);
  await refus(GEST, 'medical.avis', { empId: ANTOINE, date: '2026-10-08', avis: 'apte' }, /^Vous ne pouvez pas enregistrer l’avis du médecin du travail vous concernant/);
  await refus(GEST, 'medical.suivi', { empId: ANTOINE, suivi: 'sir', expose: true }, /^Vous ne pouvez pas modifier votre propre type de suivi médical/);
  const a = await emp(ANTOINE);
  assert.deepEqual([a.visite === '2026-10-08', a.suivi ?? null, !!a.expose], [false, null, false], 'rien n’est écrit');
  assert.match((await run(ADMIN, 'medical.avis', { empId: ANTOINE, date: '2026-10-08', avis: 'apte' })).message, /^Avis du médecin du travail enregistré — Antoine Leroy/);
  assert.match((await run(ADMIN, 'medical.suivi', { empId: ANTOINE, suivi: 'sir' })).message, /^Type de suivi médical enregistré — Antoine Leroy/);
  // Le gestionnaire RH garde ces droits pour les autres salariés.
  assert.match((await run(GEST, 'medical.demander', { empId: SARAH })).message, /^Visite médicale demandée — Sarah Cohen/);
});

test('refus « soi-même » : la transaction est annulée, aucune ligne d’action aboutie n’est écrite au journal', async () => {
  // Le refus 403 lui-même est tracé hors de la transaction par le chemin HTTP (app.ts, tracerRefus).
  const { db, refus, HSE } = await fresh();
  const avant = (await db.all<{ action: string }>('journal')).length;
  await refus(HSE, 'hab.lever', { empId: SARAH, h: 'hauteur' }, /^Vous ne pouvez pas lever/);
  assert.equal((await db.all<{ action: string }>('journal')).length, avant, 'aucune ligne écrite par la transaction annulée');
});
