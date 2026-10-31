// Tests : dossiers OPCO sur la base (lot 11, chantier C4, étape 1 ; server/src/actions/opco.ts, shared/rules/opco.ts).
// Cycle complet d'un dossier (création préremplie des réglages, dépôt, accord, justificatifs, versements, solde), double
// clic (`de`, nombre de versements affichés), retour d'un cran et annulations réservés à l'administrateur RH, exercice clos
// sans effet, ligne du plan retenue par un dossier actif (suppression, réouverture d'une demande) et dossiers suivant le
// report à la clôture, pièces sans salarié (nature, conservation de 10 ans, pièces exigées pour la demande de
// remboursement) et non-régression des droits des pièces existantes, journal (montants des seuls dossiers non nominatifs,
// jamais de motif ni de nom de pièce), instantané par profil, relances à la seule boîte du service RH, intégrité, et banc
// d'oracle du cache incrémental avec les actions OPCO en renfort.
// Jeu de démonstration au 10 octobre 2026 : ligne 11 du plan (FCO, Logistique, prévue, 1 800 €), ligne 12 (CACES R486,
// Maintenance, prévue) ; Hugo Lambert (16) encadre la Logistique, Karim Haddad (12) la Maintenance.
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
const { journaliserAction, MENTION_MONTANT, preparerTrace } = await import('../server/src/journal.ts');
const { recapitulatifEcheances } = await import('../server/src/relances.ts');
const { controlerOrphelins } = await import('../server/src/integrite.ts');
const { piecesDe: piecesDecrites, piecesVisibles } = await import('../server/src/pieces.ts');
const { voitPiece } = await import('../shared/rules/pieces.ts');
const { baseDemo, rejouer, resumeRapport } = await import('./support/oracle.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Compte = import('../server/src/comptes.ts').Compte;
type DossierOpco = import('../shared/types.ts').DossierOpco;
type PieceEnregistree = import('../server/src/pieces.ts').PieceEnregistree;

const FCO = 11, CACES = 12;

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one<Compte>(empId ? 'SELECT * FROM comptes WHERE emp_id = ?' : 'SELECT * FROM comptes WHERE emp_id IS NULL', empId ? [empId] : []))!;
  const personne = async (empId: number | null, role: User['role'] = 'rh') => (await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' }))!;
  const u = {
    admin: await personne(null), gest: await personne(14), lecture: await personne(11), hse: await personne(23), paie: await personne(7),
    hugo: await personne(16, 'manager'), mehdi: await personne(2, 'collaborateur'),
  };
  // Action exécutée comme par POST /api/actions/:nom : journal compris, signé du compte de la personne.
  const run = async (user: User, name: string, payload: Record<string, unknown>) => {
    const compte = await compteDe(user.empId ?? user.salarieId ?? null);
    const out = await db.tx(async () => {
      const t = await preparerTrace(db, name, payload);
      const r = await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), payload);
      const o = typeof r === 'object' && r !== null ? r : { message: r, result: undefined };
      await journaliserAction(db, t, { user, compte, message: o.message ?? null, result: o.result });
      return o;
    });
    // Montants : espaces insécables de fmtEur remplacés, pour comparer à un texte saisi.
    return { ...out, message: out.message?.replace(/[\u202f\u00a0]/g, ' ') ?? null } as { message: string | null; result?: any };
  };
  const msg = async (user: User, name: string, payload: Record<string, unknown>) => (await run(user, name, payload)).message ?? '';
  const refus = async (user: User, name: string, payload: Record<string, unknown>, motif: RegExp, statut = 400) => {
    await assert.rejects(async () => await run(user, name, payload), (e: unknown) => {
      assert.ok(e instanceof ActionError, String(e));
      assert.equal(e.status, statut, e.message);
      assert.match(e.message, motif);
      return true;
    });
  };
  const dossier = async (id: number) => (await db.get<DossierOpco>('dossiersOpco', id))!;
  const journal = async (action: string) => (await db.query<{ payload: unknown; message: string }>('SELECT payload, message FROM journal WHERE action = ? ORDER BY id', [action]))
    .map(l => ({ payload: (typeof l.payload === 'string' ? JSON.parse(l.payload) : l.payload) as Record<string, any>, message: l.message }));
  const reglages = async (r: Record<string, unknown>) => await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), ...r });
  /** Dossier créé sur la ligne `planActionId` par le gestionnaire RH ; renvoie son identifiant. */
  const creer = async (p: Record<string, unknown> = {}) => (await run(u.gest, 'opco.creer', { planActionId: FCO, du: '2026-11-16', au: '2026-11-17', montantDemande: 1500, ...p })).result.id as number;
  /** Pièce envoyée par le compte de `user` (en attente), stockage local activé ; renvoie son jeton. */
  const pieceEnvoyee = async (user: User, n = 1) => {
    await reglages({ piecesStockage: 'local' });
    const compte = await compteDe(user.empId ?? user.salarieId ?? null);
    const jeton = `essai-${compte.id}-${n}-${randomBytes(4).toString('hex')}`;
    await db.insert('pieces', {
      jeton, nom: `piece-${n}.pdf`, type: 'application/pdf', taille: 5, empreinte: 'e', fichier: randomBytes(16).toString('hex'), deposeLe: '2026-10-09T08:00:00.000Z',
      deposePar: user.nom, deposeCompteId: compte.id,
    });
    return jeton;
  };
  return { db, u, run, msg, refus, dossier, journal, reglages, creer, pieceEnvoyee };
}

test('cycle complet : création préremplie des réglages, dépôt, accord, justificatifs, versements, solde', async () => {
  const { u, msg, run, refus, dossier, reglages, creer, db } = await fresh();
  await reglages({ opcoDefaut: 'akto', opcoSubrogation: false });
  const r = await run(u.gest, 'opco.creer', { planActionId: FCO, dispositif: 'plan', du: '2026-11-16', au: '2026-11-17', heures: '14', effectif: 6, montantDemande: '1 500,00', organismeSiret: '732 829 320 00074' });
  assert.equal(r.message, 'Dossier OPCO créé — FCO — Logistique (2026) : Plan de développement des compétences, Akto, 1 500 € demandés');
  const id = r.result.id as number;
  assert.deepEqual((({ statut, opco, exercice, planActionId, empId, heures, montantDemande, organismeSiret, subrogation, creePar }) => ({ statut, opco, exercice, planActionId, empId, heures, montantDemande, organismeSiret, subrogation, creePar }))(await dossier(id)),
    { statut: 'a_deposer', opco: 'akto', exercice: 2026, planActionId: FCO, empId: null, heures: 14, montantDemande: 1500, organismeSiret: '73282932000074', subrogation: false, creePar: 'Antoine Leroy' });
  // Saisie refusée : première erreur ; action introuvable ou reportée.
  await refus(u.gest, 'opco.creer', { planActionId: FCO, dispositif: 'plan', organismeSiret: '123' }, /SIRET de l’organisme/);
  await refus(u.gest, 'opco.creer', { planActionId: 999 }, /Action du plan introuvable/, 404);
  // Modifiable sans motif tant qu'il est à déposer ; rien à modifier.
  assert.equal(await msg(u.gest, 'opco.modifier', { id, heures: 14 }), 'Aucune modification');
  assert.equal(await msg(u.gest, 'opco.modifier', { id, heures: 21, reference: 'AK-2026-7' }), 'Dossier OPCO FCO — Logistique (2026) modifié (2 champs)');
  assert.equal((await dossier(id)).corrigeLe, null);
  // Dépôt : date future refusée, puis double clic sans effet.
  await refus(u.gest, 'opco.deposer', { id, de: 'a_deposer', deposeLe: '2026-10-11' }, /dans le futur/);
  await refus(u.gest, 'opco.deposer', { id, de: 'a_deposer', deposeLe: '2026-13-01' }, /date invalide/);
  await refus(u.gest, 'opco.deposer', { id, de: 'a_deposer', reference: 'avec espace' }, /Numéro de dossier/);
  assert.equal(await msg(u.gest, 'opco.deposer', { id, de: 'a_deposer', deposeLe: '2026-09-15' }), 'Dossier OPCO FCO — Logistique (2026) · déposé le 15 sept. 2026 (dossier AK-2026-7)');
  assert.equal(await msg(u.gest, 'opco.deposer', { id, de: 'a_deposer' }), 'Dossier OPCO FCO — Logistique (2026) · déjà déposé');
  // Une fois déposé, une modification est une correction motivée.
  await refus(u.gest, 'opco.modifier', { id, effectif: 5 }, /Motif de la correction obligatoire/);
  assert.match(await msg(u.gest, 'opco.modifier', { id, effectif: 5, motif: 'Une inscription en moins' }), /corrigé \(1 champ\)/);
  assert.deepEqual([(await dossier(id)).corrigePar, (await dossier(id)).corrigeMotif], ['Antoine Leroy', 'Une inscription en moins']);
  // Accord : montant exigé, pas avant le dépôt, plafond horaire contrôlé.
  await refus(u.gest, 'opco.accorder', { id, de: 'depose' }, /Montant accordé : montant en euros/);
  await refus(u.gest, 'opco.accorder', { id, de: 'depose', montantAccorde: 1200, accordLe: '2026-09-01' }, /précède celle de l’étape précédente \(15 sept. 2026\)/);
  await refus(u.gest, 'opco.accorder', { id, de: 'depose', montantAccorde: 1200, plafondHoraire: 'x' }, /Plafond horaire/);
  await refus(u.gest, 'opco.facturer', { id, de: 'accorde', montantFacture: 1200 }, /le dossier est maintenant « Déposé »/);
  assert.match(await msg(u.gest, 'opco.accorder', { id, de: 'depose', montantAccorde: 1200, accordLe: '2026-09-25', accordReference: 'ACC-77', plafondHoraire: '15' }), /accordé le 25 sept. 2026 \(1 200 €\)$/);
  const d1 = await dossier(id);
  assert.deepEqual([d1.statut, d1.montantAccorde, d1.accordReference, d1.plafondHoraire], ['accorde', 1200, 'ACC-77', 15]);
  // Un acompte peut suivre l'accord ; le nombre de versements affichés évite le double enregistrement.
  await refus(u.gest, 'opco.versement', { id, montant: 0 }, /plus de 0/);
  await refus(u.gest, 'opco.versement', { id, montant: 10, destinataire: 'banque' }, /Destinataire du versement/);
  assert.match(await msg(u.gest, 'opco.versement', { id, montant: 400, le: '2026-10-01', reference: 'VIR-1', versements: 0 }), /versement du 1 oct. 2026 \(400 €\) reçu par l’entreprise$/);
  assert.match(await msg(u.gest, 'opco.versement', { id, montant: 400, versements: 0 }), /versement déjà enregistré$/);
  assert.equal((await dossier(id)).statut, 'rembourse');
  // Justificatifs : seulement depuis « accordé » ; le dossier remboursé par acompte se solde directement.
  await refus(u.gest, 'opco.facturer', { id, de: 'rembourse', montantFacture: 1200 }, /impossible depuis l’état « Remboursé »/);
  // Solde : écart de 800 € figé, qualifié (proposé : partiel ; « aucun » refusé).
  await refus(u.gest, 'opco.solder', { id, de: 'rembourse', nature: 'aucun' }, /perte ou prise en charge partielle/);
  assert.match(await msg(u.gest, 'opco.solder', { id, de: 'rembourse' }), /soldé le 10 oct. 2026 — écart \(800 €\) : prise en charge partielle$/);
  assert.deepEqual([(await dossier(id)).soldeEcart, (await dossier(id)).soldeNature], [800, 'partiel']);
  await refus(u.gest, 'opco.modifier', { id, heures: 7 }, /dossier soldé, rouvrez-le d’abord/);
  await refus(u.gest, 'opco.versement', { id, montant: 10 }, /aucun versement attendu à l’état « Soldé »/);
  // Second dossier : justificatifs puis versement complet, solde sans écart ; qualification « perte » choisie ailleurs.
  const id2 = await creer({ dispositif: 'tutorat' });
  await run(u.gest, 'opco.deposer', { id: id2, de: 'a_deposer', deposeLe: '2026-09-01' });
  await run(u.gest, 'opco.accorder', { id: id2, de: 'depose', montantAccorde: 300, accordLe: '2026-09-10' });
  assert.match(await msg(u.gest, 'opco.facturer', { id: id2, de: 'accorde', montantFacture: 300, factureLe: '2026-10-05' }), /justificatifs envoyés le 5 oct. 2026 \(300 €\)$/);
  await run(u.gest, 'opco.versement', { id: id2, montant: 300 });
  assert.match(await msg(u.gest, 'opco.solder', { id: id2, de: 'rembourse' }), /sans écart$/);
  assert.deepEqual([(await dossier(id2)).soldeNature, (await dossier(id2)).soldeEcart], ['aucun', 0]);
  const id3 = await creer();
  await run(u.gest, 'opco.deposer', { id: id3, de: 'a_deposer' });
  await run(u.gest, 'opco.accorder', { id: id3, de: 'depose', montantAccorde: 500 });
  await run(u.gest, 'opco.facturer', { id: id3, de: 'accorde', montantFacture: 500 });
  await refus(u.gest, 'opco.solder', { id: id3, de: 'facture', nature: 'inconnue' }, /perte ou prise en charge partielle/);
  assert.match(await msg(u.gest, 'opco.solder', { id: id3, de: 'facture', nature: 'perte' }), /écart \(500 €\) : perte$/);
  // Refus et abandon : motifs codés seulement.
  const id4 = await creer();
  await run(u.gest, 'opco.deposer', { id: id4, de: 'a_deposer' });
  await refus(u.gest, 'opco.refuser', { id: id4, de: 'depose', motif: 'Budget épuisé chez l’OPCO' }, /Motif du refus à choisir/);
  assert.match(await msg(u.gest, 'opco.refuser', { id: id4, de: 'depose', motif: 'budget_epuise' }), /refusé le 10 oct. 2026$/, 'motif gardé sur le dossier, jamais dans le message');
  assert.equal((await dossier(id4)).refusMotif, 'budget_epuise');
  const id5 = await creer();
  await refus(u.gest, 'opco.abandonner', { id: id5, de: 'a_deposer', motif: 'texte' }, /Motif de l’abandon/);
  assert.match(await msg(u.gest, 'opco.abandonner', { id: id5, de: 'a_deposer', motif: 'formation_annulee' }), /abandonné$/);
  assert.equal((await dossier(id5)).abandonMotif, 'formation_annulee');
  assert.match(await msg(u.gest, 'opco.abandonner', { id: id5, de: 'a_deposer', motif: 'formation_annulee' }), /déjà abandonné$/);
  // Dossier inconnu.
  await refus(u.gest, 'opco.deposer', { id: 999 }, /Dossier OPCO introuvable/, 404);
  assert.equal(await db.count('versementsOpco'), 2, 'le double clic n’a rien enregistré');
});

test('administrateur RH : retour d’un cran, annulation d’un versement, suppression d’un dossier saisi par erreur', async () => {
  const { u, msg, run, refus, dossier, creer, pieceEnvoyee } = await fresh();
  const id = await creer();
  await refus(u.admin, 'opco.rouvrir', { id, motif: 'Essai' }, /rien à rouvrir/);
  await run(u.gest, 'opco.deposer', { id, de: 'a_deposer', deposeLe: '2026-09-01' });
  await run(u.gest, 'opco.accorder', { id, de: 'depose', montantAccorde: 900, accordLe: '2026-09-10', accordReference: 'A-1' });
  await refus(u.gest, 'opco.rouvrir', { id, de: 'accorde', motif: 'Accord saisi par erreur' }, /réservée à l’administrateur RH/, 403);
  await refus(u.admin, 'opco.rouvrir', { id, de: 'accorde' }, /Motif de la correction obligatoire/);
  await refus(u.admin, 'opco.rouvrir', { id, de: 'refuse', motif: 'Essai' }, /le dossier est maintenant « Accordé »/);
  await refus(u.admin, 'opco.rouvrir', { id, de: 'xyz', motif: 'Essai' }, /le dossier est maintenant « Accordé »/);
  assert.match(await msg(u.admin, 'opco.rouvrir', { id, de: 'accorde', motif: 'Accord saisi par erreur' }), /de nouveau « Déposé »$/);
  assert.match(await msg(u.admin, 'opco.rouvrir', { id, de: 'accorde', motif: 'Accord saisi par erreur' }), /déjà rouvert$/, 'double clic');
  const d = await dossier(id);
  assert.deepEqual([d.statut, d.accordLe, d.montantAccorde, d.accordReference, d.deposeLe, d.corrigeMotif], ['depose', null, null, null, '2026-09-01', 'Accord saisi par erreur']);
  // Versement annulé : le dossier revient à l'état d'avant (accordé, ou justificatifs envoyés).
  await run(u.gest, 'opco.accorder', { id, de: 'depose', montantAccorde: 900 });
  const v1 = (await run(u.gest, 'opco.versement', { id, montant: 300 })).result.id;
  const v2 = (await run(u.gest, 'opco.versement', { id, montant: 200 })).result.id;
  await refus(u.admin, 'opco.rouvrir', { id, motif: 'Essai' }, /annulez d’abord le versement/);
  await refus(u.gest, 'opco.annulerVersement', { id: v1, motif: 'Doublon' }, /réservée à l’administrateur RH/, 403);
  await refus(u.admin, 'opco.annulerVersement', { id: v1 }, /Motif de la correction obligatoire/);
  assert.match(await msg(u.admin, 'opco.annulerVersement', { id: v1, motif: 'Doublon' }), /versement du 10 oct. 2026 annulé$/);
  await refus(u.admin, 'opco.annulerVersement', { id: v1, motif: 'Doublon' }, /Versement introuvable ou déjà annulé/, 404);
  assert.equal((await dossier(id)).statut, 'rembourse', 'un versement reste');
  assert.match(await msg(u.admin, 'opco.annulerVersement', { id: v2, motif: 'Doublon' }), /dossier de nouveau « Accordé »$/);
  // Avec justificatifs envoyés : retour à « justificatifs envoyés » ; un dossier soldé se rouvre d'abord.
  await run(u.gest, 'opco.facturer', { id, de: 'accorde', montantFacture: 900 });
  const v3 = (await run(u.gest, 'opco.versement', { id, montant: 900 })).result.id;
  await run(u.gest, 'opco.solder', { id, de: 'rembourse' });
  await refus(u.admin, 'opco.annulerVersement', { id: v3, motif: 'Erreur' }, /dossier soldé, rouvrez-le d’abord/);
  assert.match(await msg(u.admin, 'opco.rouvrir', { id, de: 'solde', motif: 'Solde prématuré' }), /de nouveau « Remboursé »$/);
  assert.deepEqual([(await dossier(id)).soldeLe, (await dossier(id)).soldeNature], [null, null]);
  assert.match(await msg(u.admin, 'opco.annulerVersement', { id: v3, motif: 'Erreur' }), /dossier de nouveau « Justificatifs envoyés »$/);
  // Abandon défait d'après les dates renseignées.
  await run(u.gest, 'opco.abandonner', { id, de: 'facture', motif: 'renonciation' });
  assert.match(await msg(u.admin, 'opco.rouvrir', { id, de: 'abandonne', motif: 'Abandon par erreur' }), /de nouveau « Justificatifs envoyés »$/);
  assert.deepEqual([(await dossier(id)).abandonLe, (await dossier(id)).abandonMotif], [null, null]);
  // Suppression : pas avec des versements ni des pièces en vigueur ; gardé en base, hors de l'instantané.
  await run(u.gest, 'opco.versement', { id, montant: 100 });
  await refus(u.admin, 'opco.supprimer', { id, motif: 'Doublon' }, /annulez d’abord ses versements/);
  await refus(u.gest, 'opco.supprimer', { id: await creer(), motif: 'Doublon' }, /réservée à l’administrateur RH/, 403);
  const id2 = await creer();
  await run(u.gest, 'piece.joindre', { jetons: [await pieceEnvoyee(u.gest)], objet: 'dossierOpco', objetId: id2, nature: 'convention' });
  await refus(u.admin, 'opco.supprimer', { id: id2, motif: 'Doublon' }, /retirez d’abord ses pièces \(1 pièce jointe\)/);
  const id3 = await creer();
  await refus(u.admin, 'opco.supprimer', { id: id3 }, /Motif de la correction obligatoire/);
  assert.match(await msg(u.admin, 'opco.supprimer', { id: id3, motif: 'Créé deux fois' }), /supprimé$/);
  assert.deepEqual([(await dossier(id3)).annuleLe, (await dossier(id3)).annuleMotif], ['2026-10-10', 'Créé deux fois']);
  await refus(u.gest, 'opco.modifier', { id: id3, heures: 3 }, /introuvable ou supprimé/, 404);
});

test('exercice clos sans effet ; ligne du plan retenue par un dossier actif ; dossiers actifs transférés au report', async () => {
  const { db, u, msg, run, refus, dossier, creer } = await fresh();
  // Ligne 2025 engagée, exercice clos ensuite par l'administrateur RH avec le report de la ligne.
  const l25 = (await db.insert<{ id: number }>('planActions', { exercice: 2025, f: 'sst', libelle: null, equipe: 'Maintenance', periode: 'T4', effectif: 3, cout: 900, statut: 'engage', origine: 'import' })).id;
  const actif = await creer({ planActionId: l25 });
  const abandonne = await creer({ planActionId: l25 });
  await run(u.gest, 'opco.abandonner', { id: abandonne, de: 'a_deposer', motif: 'non_eligible' });
  assert.equal((await dossier(actif)).exercice, 2025);
  // Suppression de la ligne refusée tant qu'un dossier est actif (abandonné : ne compte pas).
  await refus(u.admin, 'plan.supprimer', { id: l25, motif: 'Doublon' }, /1 dossier OPCO en cours sur cette ligne : abandonnez-le ou supprimez-le d’abord/);
  const m = await msg(u.admin, 'plan.cloturerExercice', { exercice: 2025, reporter: [l25] });
  assert.match(m, /1 dossier OPCO transféré avec les actions reportées$/);
  const nouvelle = (await db.one<{ id: number }>('SELECT id FROM plan_actions WHERE report_de = ?', [l25]))!.id;
  assert.deepEqual([(await dossier(actif)).planActionId, (await dossier(actif)).exercice], [nouvelle, 2026]);
  assert.deepEqual([(await dossier(abandonne)).planActionId, (await dossier(abandonne)).exercice], [l25, 2025], 'abandonné : reste sur l’ancienne ligne');
  // La ligne reportée ne reçoit plus de dossier ; un exercice clos ne bloque rien sur un dossier existant.
  await refus(u.gest, 'opco.creer', { planActionId: l25 }, /action reportée sur l’exercice 2026, créez le dossier sur sa nouvelle ligne/);
  const l24 = (await db.insert<{ id: number }>('planActions', { exercice: 2024, f: 'sst', libelle: null, equipe: 'Maintenance', periode: 'T4', effectif: 3, cout: 900, statut: 'realise', coutReel: 900, origine: 'import' })).id;
  await db.insert('exercicesClos', { exercice: 2024, le: '2025-01-10', par: 'Sandrine Vidal' });
  const ancien = await creer({ planActionId: l24, du: '2024-11-04', au: '2024-11-05' });
  await run(u.gest, 'opco.deposer', { id: ancien, de: 'a_deposer', deposeLe: '2024-10-01' });
  await run(u.gest, 'opco.accorder', { id: ancien, de: 'depose', montantAccorde: 600, accordLe: '2024-10-20' });
  await run(u.gest, 'opco.facturer', { id: ancien, de: 'accorde', montantFacture: 600, factureLe: '2024-12-01' });
  assert.match(await msg(u.gest, 'opco.versement', { id: ancien, montant: 600, le: '2026-10-09' }), /versement du 9 oct. 2026 \(600 €\)/, 'remboursement après la clôture');
  // Ligne d'un exercice ouvert : supprimée une fois le dossier abandonné.
  const id = await creer({ planActionId: CACES });
  await refus(u.admin, 'plan.supprimer', { id: CACES, motif: 'Doublon' }, /dossier OPCO en cours/);
  await run(u.gest, 'opco.abandonner', { id, de: 'a_deposer', motif: 'autre' });
  assert.match(await msg(u.admin, 'plan.supprimer', { id: CACES, motif: 'Doublon' }), /supprimée du plan 2026/);
});

test('réouverture d’une demande : la ligne du plan qu’elle a créée n’est pas retirée tant qu’un dossier y est actif', async () => {
  const { db, u, refus, run, creer } = await fresh();
  const l = (await db.insert<{ id: number }>('planActions', { exercice: 2026, f: 'fco', libelle: null, equipe: 'Maintenance', periode: 'T4', effectif: 1, cout: 900, statut: 'prevu', origine: 'demande' })).id;
  const demande = (await db.insert<{ id: number }>('demandesCollab', {
    empId: 2, type: 'formation', f: 'fco', h: null, libelle: null, label: null, sessionId: null, motif: 'Recyclage', date: '2026-10-01', statut: 'acceptee', reponse: 'Ajoutée au plan', parId: null,
    suite: { planId: l },
  })).id;
  const id = await creer({ planActionId: l });
  await refus(u.admin, 'demande.reouvrir', { id: demande, motif: 'Acceptée par erreur' }, /porte un dossier OPCO : 1 dossier OPCO en cours/);
  await run(u.admin, 'opco.supprimer', { id, motif: 'Lié à une demande rouverte' });
  await run(u.admin, 'demande.reouvrir', { id: demande, motif: 'Acceptée par erreur' });
  assert.ok((await db.get<{ annuleLe: string | null }>('planActions', l))!.annuleLe);
});

test('pièces sans salarié : nature exigée, 10 ans pour la facture et l’accord, pièces exigées pour la demande de remboursement', async () => {
  const { db, u, msg, run, refus, dossier, creer, pieceEnvoyee } = await fresh();
  const id = await creer();
  await refus(u.gest, 'piece.joindre', { jetons: [await pieceEnvoyee(u.gest, 1)], objet: 'dossierOpco', objetId: id }, /Nature de la pièce à choisir/);
  await refus(u.gest, 'piece.joindre', { jetons: [await pieceEnvoyee(u.gest, 2)], objet: 'dossierOpco', objetId: 999, nature: 'facture' }, /Pièce d’un dossier OPCO : objet introuvable/, 404);
  await refus(u.hse, 'piece.joindre', { jetons: [await pieceEnvoyee(u.hse, 3)], objet: 'dossierOpco', objetId: id, nature: 'facture' }, /réservée au service RH/, 403);
  assert.equal(await msg(u.gest, 'piece.joindre', { jetons: [await pieceEnvoyee(u.gest, 4)], objet: 'dossierOpco', objetId: id, nature: 'convention' }),
    'Pièce d’un dossier OPCO (convention ou contrat de formation) — 1 pièce jointe');
  await run(u.gest, 'opco.deposer', { id, de: 'a_deposer', deposeLe: '2026-09-01' });
  await run(u.gest, 'opco.accorder', { id, de: 'depose', montantAccorde: 1000, accordLe: '2026-09-15' });
  await run(u.gest, 'piece.joindre', { jetons: [await pieceEnvoyee(u.gest, 5)], objet: 'dossierOpco', objetId: id, nature: 'accord' });
  // Pièces activées : la demande de remboursement attend la facture et le certificat de réalisation (ou l'émargement).
  await refus(u.gest, 'opco.facturer', { id, de: 'accorde', montantFacture: 1000 }, /pièces à joindre avant la demande de remboursement — facture, certificat de réalisation ou attestation d’assiduité$/);
  await run(u.gest, 'piece.joindre', { jetons: [await pieceEnvoyee(u.gest, 6)], objet: 'dossierOpco', objetId: id, nature: 'facture' });
  await refus(u.gest, 'opco.facturer', { id, de: 'accorde', montantFacture: 1000 }, /— certificat de réalisation ou attestation d’assiduité$/);
  await run(u.gest, 'piece.joindre', { jetons: [await pieceEnvoyee(u.gest, 7)], objet: 'dossierOpco', objetId: id, nature: 'emargement' });
  await run(u.gest, 'opco.facturer', { id, de: 'accorde', montantFacture: 1000 });
  assert.equal((await dossier(id)).statut, 'facture');
  const pieces = (await db.all<PieceEnregistree>('pieces')).filter(p => p.objet === 'dossierOpco');
  assert.deepEqual(pieces.map(p => [p.nature, p.empId, p.conserverJusquau]), [
    ['convention', null, null], ['accord', null, '2036-12-31'], ['facture', null, '2036-12-31'], ['emargement', null, null],
  ]);
  // Description : nature ajoutée aux seules pièces de dossier ; pièces de dossier gardées malgré l'absence de salarié.
  const decrites = piecesDecrites(pieces);
  assert.deepEqual(decrites.map(p => [p.objet, p.empId, p.nature]), pieces.map(p => ['dossierOpco', null, p.nature]));
  // Pièces désactivées : la demande de remboursement n'est plus bloquée (rien à vérifier).
  const id2 = await creer();
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), piecesStockage: 'desactive' });
  await run(u.gest, 'opco.deposer', { id: id2, de: 'a_deposer' });
  await run(u.gest, 'opco.accorder', { id: id2, de: 'depose', montantAccorde: 100 });
  await run(u.gest, 'opco.facturer', { id: id2, de: 'accorde', montantFacture: 100 });
  // Dossier nominatif (alternance, plus tard) : ses pièces ne sont pas encore prises en charge.
  await db.update('dossiersOpco', id2, { empId: 2 });
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), piecesStockage: 'local' });
  await refus(u.gest, 'piece.joindre', { jetons: [await pieceEnvoyee(u.gest, 8)], objet: 'dossierOpco', objetId: id2, nature: 'facture' }, /Dossier OPCO nominatif/);
});

test('droits des pièces : un dossier OPCO au service RH seul ; les pièces existantes inchangées (non-régression)', async () => {
  const { u } = await fresh();
  const piece = (objet: string, empId: number | null) => ({ empId, objet }) as Parameters<typeof voitPiece>[1];
  const equipeHugo = (e: number) => e === 20;
  const externe = { role: 'collaborateur', empId: null, nom: 'Externe', intitule: '' } as unknown as User;
  // Dossier OPCO : service RH (gestionnaire, administrateur) ; jamais la lecture seule, le référent HSE, la paie, un manager,
  // un salarié ni un compte sans fiche (deux identifiants absents ne sont pas égaux).
  assert.deepEqual([u.admin, u.gest, u.lecture, u.hse, u.paie, u.hugo, u.mehdi, externe].map(x => voitPiece(x, piece('dossierOpco', null), equipeHugo)),
    [true, true, false, false, false, false, false, false]);
  // Pièces d'un salarié : règles d'avant le lot 11.
  const attendu: [string, number, boolean[]][] = [
    // objet, salarié : admin, gest, lecture, hse, paie, hugo (manager de Yanis, 20), mehdi (2)
    ['certification', 20, [true, true, false, true, false, true, false]],
    ['habTitre', 2, [true, true, false, true, false, false, true]],
    ['absence', 20, [true, true, false, false, false, false, false]],
    ['absence', 2, [true, true, false, false, false, false, true]],
    ['declaration', 20, [true, true, false, false, false, false, false]],
    ['voyage', 2, [true, true, false, false, false, false, true]],
  ];
  for (const [objet, empId, droits] of attendu) {
    assert.deepEqual([u.admin, u.gest, u.lecture, u.hse, u.paie, u.hugo, u.mehdi].map(x => voitPiece(x, piece(objet, empId), equipeHugo)), droits, `${objet} de ${empId}`);
  }
  assert.equal(voitPiece(externe, piece('absence', null), equipeHugo), false, 'pièce sans salarié d’un autre objet : personne hors du service RH');
  // Instantané : le service RH reçoit les pièces de dossier, personne d'autre.
  const pieces = [
    { id: 1, empId: null, objet: 'dossierOpco', objetId: 1, nom: 'facture.pdf', type: 'application/pdf', taille: 5, empreinte: 'e', deposeLe: 'x', deposePar: 'x', conserverJusquau: '2036-12-31', retireeLe: null, retireePar: null, nature: 'facture' },
    { id: 2, empId: 20, objet: 'certification', objetId: 1, nom: 'sst.pdf', type: 'application/pdf', taille: 5, empreinte: 'e', deposeLe: 'x', deposePar: 'x', conserverJusquau: null, retireeLe: null, retireePar: null },
  ] as Parameters<typeof piecesVisibles>[0] & object;
  assert.deepEqual(piecesVisibles(pieces, u.gest).map(p => p.id), [1, 2]);
  assert.deepEqual(piecesVisibles(pieces, u.lecture).map(p => p.id), []);
  assert.deepEqual(piecesVisibles(pieces, u.hse).map(p => p.id), [2]);
  assert.deepEqual(piecesVisibles(pieces, u.hugo, new Set([20])).map(p => p.id), [2]);
  // Description : une pièce sans salarié d'un objet nominatif reste écartée, comme avant.
  const ligne = (objet: string, empId: number | null) => ({ ...pieces[0], objet, empId, jeton: null, fichier: null, deposeCompteId: null, retireeMotif: null }) as PieceEnregistree;
  assert.deepEqual(piecesDecrites([ligne('absence', null), ligne('dossierOpco', null), ligne('absence', 3)]).map(p => [p.objet, p.empId]), [['dossierOpco', null], ['absence', 3]]);
  assert.equal('nature' in piecesDecrites([{ ...ligne('absence', 3), nature: null }])[0], false, 'pièce d’un autre objet : décrite comme avant');
});

test('journal : états, dates, codes et montants des dossiers non nominatifs ; jamais de motif ni de nom de pièce', async () => {
  const { db, u, run, journal, creer, pieceEnvoyee } = await fresh();
  const id = await creer({ reference: 'OPCO-12', organismeNda: '11755555575' });
  const [c] = await journal('opco.creer');
  assert.deepEqual(c.payload, {
    planActionId: FCO, dossier: id, statut: 'a_deposer', opco: 'opco2i', dispositif: 'plan', du: '2026-11-16', au: '2026-11-17', heures: null, effectif: null, subrogation: false,
    reference: 'OPCO-12', montantDemande: 1500, montantDemandeAnnexes: null,
  });
  await run(u.gest, 'opco.deposer', { id, de: 'a_deposer', deposeLe: '2026-09-01' });
  await run(u.gest, 'opco.modifier', { id, heures: 14, motif: 'Durée confirmée par l’organisme Dupont' });
  await run(u.gest, 'opco.accorder', { id, de: 'depose', montantAccorde: 1200, accordLe: '2026-09-10' });
  await run(u.gest, 'piece.joindre', { jetons: [await pieceEnvoyee(u.gest)], objet: 'dossierOpco', objetId: id, nature: 'accord' });
  const v = (await run(u.gest, 'opco.versement', { id, montant: 700, reference: 'VIR-9' })).result.id;
  await run(u.admin, 'opco.annulerVersement', { id: v, motif: 'Virement de la société Martin, pas de l’OPCO' });
  await run(u.admin, 'opco.rouvrir', { id, de: 'accorde', motif: 'Accord du mauvais dossier (M. Durand)' });
  await run(u.gest, 'opco.refuser', { id, de: 'depose', motif: 'organisme_non_certifie' });
  const avantApres = async (a: string) => (await journal(a)).map(x => [x.payload.avant, x.payload.apres]);
  assert.deepEqual(await avantApres('opco.deposer'), [[{ statut: 'a_deposer', deposeLe: null }, { statut: 'depose', deposeLe: '2026-09-01' }]]);
  assert.deepEqual(await avantApres('opco.modifier'), [[{ heures: null, corrigeLe: null }, { heures: 14, corrigeLe: '2026-10-10' }]]);
  assert.deepEqual(await avantApres('opco.accorder'), [[{ statut: 'depose', accordLe: null, montantAccorde: null }, { statut: 'accorde', accordLe: '2026-09-10', montantAccorde: 1200 }]]);
  assert.deepEqual((await journal('opco.versement'))[0].payload, {
    id, dossier: id, planActionId: FCO, exercice: 2026, versement: v, le: '2026-10-10', destinataire: 'entreprise', reference: 'VIR-9', montant: 700,
    avant: { statut: 'accorde' }, apres: { statut: 'rembourse' },
  });
  assert.deepEqual((await journal('opco.annulerVersement'))[0].payload.montant, 700);
  assert.deepEqual((await journal('opco.rouvrir'))[0].payload.apres, { statut: 'depose', accordLe: null, montantAccorde: null });
  assert.deepEqual(await avantApres('opco.refuser'), [[{ statut: 'depose', refusLe: null }, { statut: 'refuse', refusLe: '2026-10-10' }]]);
  assert.deepEqual((await journal('piece.joindre'))[0].payload, { objet: 'dossierOpco', objetId: id, pieces: 1, nature: 'accord' });
  // Ni motif (texte libre ou code de refus), ni nom de pièce, ni salarié : jamais dans le journal.
  const tout = JSON.stringify(await db.query("SELECT action, message, payload, salaries FROM journal WHERE action LIKE 'opco.%' OR action = 'piece.joindre'"));
  for (const interdit of ['Dupont', 'Martin', 'Durand', 'organisme_non_certifie', 'non certifié', 'piece-1', 'corrigeMotif', 'annuleMotif', 'refusMotif']) assert.doesNotMatch(tout, new RegExp(interdit), interdit);
  assert.doesNotMatch(tout, /"salaries":"\[\d/);
  // Familles et libellés ; hors des actions liées à la paie (gardées 1 an).
  const { familleAction, estActionPaie, JOURNAL_LABEL } = await import('../shared/journal.ts');
  for (const a of Object.keys(ACTIONS).filter(n => n.startsWith('opco.'))) {
    assert.equal(familleAction(a)!.id, 'formations', a);
    assert.ok(JOURNAL_LABEL[a], a);
    assert.equal(estActionPaie(a), false, a);
  }
  // Dossier nominatif (alternance, plus tard) : montants masqués.
  await db.update('dossiersOpco', id, { empId: 2, statut: 'depose', refusLe: null, refusMotif: null });
  await run(u.gest, 'opco.accorder', { id, de: 'depose', montantAccorde: 999 });
  const nominatif = (await journal('opco.accorder'))[1].payload;
  assert.deepEqual([nominatif.avant.montantAccorde, nominatif.apres.montantAccorde, nominatif.apres.statut], [MENTION_MONTANT, MENTION_MONTANT, 'accorde']);
  const vn = (await run(u.gest, 'opco.versement', { id, montant: 50 })).result.id;
  assert.equal('montant' in (await journal('opco.versement'))[1].payload, false);
  await run(u.admin, 'opco.annulerVersement', { id: vn, motif: 'Erreur' });
  assert.equal('montant' in (await journal('opco.annulerVersement'))[1].payload, false);
  await db.update('dossiersOpco', id, { empId: null });
  const id2 = await creer();
  await db.update('dossiersOpco', id2, { empId: 2 });
  await run(u.gest, 'opco.modifier', { id: id2, montantDemande: 1700 });
  assert.deepEqual((await journal('opco.modifier'))[1].payload.apres, { montantDemande: MENTION_MONTANT });
  const id3 = (await run(u.gest, 'opco.creer', { planActionId: FCO })).result.id;
  await db.update('dossiersOpco', id3, { empId: 2 });
  assert.equal('montantDemande' in (await journal('opco.creer'))[2].payload, true, 'créé non nominatif : montant tracé');
});

test('instantané : complet pour le service RH, sans motifs pour la lecture seule, rien ailleurs ; dossier supprimé écarté avec ses versements', async () => {
  const { db, u, run, creer } = await fresh();
  const id = await creer();
  await run(u.gest, 'opco.deposer', { id, de: 'a_deposer', deposeLe: '2026-09-01' });
  await run(u.gest, 'opco.modifier', { id, heures: 7, motif: 'Correction de la durée' });
  await run(u.gest, 'opco.accorder', { id, de: 'depose', montantAccorde: 800 });
  const v = (await run(u.gest, 'opco.versement', { id, montant: 300 })).result.id;
  await run(u.gest, 'opco.versement', { id, montant: 100 });
  await run(u.admin, 'opco.annulerVersement', { id: v, motif: 'Doublon' });
  const refuse = await creer();
  await run(u.gest, 'opco.deposer', { id: refuse, de: 'a_deposer' });
  await run(u.gest, 'opco.refuser', { id: refuse, de: 'depose', motif: 'hors_criteres' });
  const supprime = await creer();
  await db.insert('versementsOpco', { dossierId: supprime, le: '2026-10-01', montant: 10, destinataire: 'entreprise', saisiLe: '2026-10-01T08:00:00.000Z', saisiPar: 'Reprise', annuleLe: '2026-10-02T08:00:00.000Z', annulePar: 'Reprise', annuleMotif: 'Erreur' });
  await run(u.admin, 'opco.supprimer', { id: supprime, motif: 'Doublon' });
  const rh = await buildSnapshot(db, u.gest);
  assert.deepEqual(rh.dossiersOpco!.map(d => d.id), [id, refuse]);
  assert.deepEqual([rh.dossiersOpco![0].corrigeMotif, rh.dossiersOpco![1].refusMotif], ['Correction de la durée', 'hors_criteres']);
  assert.deepEqual(rh.versementsOpco!.map(x => [x.dossierId, x.montant, x.annuleMotif ?? null]), [[id, 300, 'Doublon'], [id, 100, null]]);
  const lecture = await buildSnapshot(db, u.lecture);
  assert.deepEqual(lecture.dossiersOpco!.map(d => [d.id, d.corrigeMotif, d.refusMotif, d.statut, d.montantAccorde]), [[id, null, null, 'rembourse', 800], [refuse, null, null, 'refuse', null]]);
  assert.deepEqual(lecture.versementsOpco!.map(x => [x.montant, x.annuleLe != null, x.annuleMotif]), [[300, true, null], [100, false, null]]);
  for (const x of [u.hse, u.paie, u.hugo, u.mehdi]) {
    const s = await buildSnapshot(db, x);
    assert.deepEqual([s.dossiersOpco, s.versementsOpco], [[], []], `${x.role} ${x.profilRh ?? ''}`);
  }
  // Intégrité : aucune référence orpheline (ligne du plan, dossier de chaque versement).
  const orph = await controlerOrphelins(db);
  assert.deepEqual(Object.keys(orph.parReference).filter(k => /opco/.test(k)), []);
});

test('relances : boîte du service RH seulement, action du plan et échéance, ni montant ni nom ; une fois par palier', async () => {
  const { db, u, run, creer } = await fresh();
  await run(u.admin, 'messagerie.regler', { rh: 'rh@entreprise.example' });
  // Dépôt dû le 20 septembre (début le 20 octobre, 30 jours avant) : échu ; dossier de la Maintenance dû le 1er novembre.
  const id = await creer({ du: '2026-10-20', au: '2026-10-21', montantDemande: 4321 });
  await creer({ planActionId: CACES, du: '2026-12-01', au: '2026-12-02' });
  const passer = async () => await db.tx(async () => await recapitulatifEcheances(db));
  await passer();
  const recaps = async () => (await db.query<{ contenu: unknown }>("SELECT contenu FROM envois WHERE type = 'echeances.recapitulatif' ORDER BY id"))
    .map(e => (typeof e.contenu === 'string' ? JSON.parse(e.contenu) : e.contenu) as { a: string[]; texte: string });
  const premiers = await recaps();
  const rh = premiers.find(e => e.a[0] === 'rh@entreprise.example')!;
  assert.match(rh.texte, new RegExp(`• Dossier OPCO — FCO — Logistique \\(2026\\) : dossier à déposer avant le début de la formation : dépassée depuis le 20 sept. 2026`));
  assert.match(rh.texte, /• Dossier OPCO — CACES R486 — Maintenance \(2026\) : dossier à déposer avant le début de la formation : échéance le 1 nov. 2026/);
  assert.doesNotMatch(rh.texte, /4 321|€/);
  for (const e of premiers.filter(x => x.a[0] !== 'rh@entreprise.example')) assert.doesNotMatch(e.texte, /OPCO/, `pas chez ${e.a[0]}`);
  const cles = (await db.query<{ cle: string; palier: string }>("SELECT cle, palier FROM relances WHERE cle LIKE 'opco:%' ORDER BY cle")).map(r => `${r.cle}|${r.palier}`);
  assert.deepEqual(cles, [`opco:${id}:depot|echu`, `opco:${id + 1}:depot|30`]);
  // Passage suivant : rien de nouveau ; dossier déposé : nouvelle étape (accord attendu le 13 octobre).
  await passer();
  assert.equal((await recaps()).length, premiers.length);
  await run(u.gest, 'opco.deposer', { id, de: 'a_deposer' });
  await passer();
  assert.match((await recaps()).at(-1)!.texte, /accord de l’OPCO attendu avant le début de la formation : échéance le 13 oct. 2026/);
});

test('banc d’oracle : actions OPCO en renfort, cache incrémental exact après chaque pas', async () => {
  const db = await baseDemo(nouvelleBase);
  const opco = Object.keys(ACTIONS).filter(n => n.startsWith('opco.'));
  const renfort = [...opco, ...opco, ...Array<string>(8).fill('opco.creer'), 'opco.deposer', 'opco.accorder', 'opco.versement', 'opco.facturer'];
  const x = await rejouer(db, { graine: 20261031, pas: 60, verifierTous: 4, jeux: 0, sql: 0.1, renfort });
  const resume = resumeRapport(x);
  assert.deepEqual(x.divergences, [], resume);
  assert.deepEqual(x.erreurs, [], resume);
  const validees = Object.entries(x.actions).filter(([n, s]) => n.startsWith('opco.') && s.ok).map(([n]) => n);
  assert.ok(validees.includes('opco.creer'), resume);
  assert.ok(validees.length >= 3, resume);
});
