// Matrice des droits : chaque action exportée par server/src/actions × neuf profils, avec le résultat
// attendu (autorisé / refusé). Une action sans ligne fait échouer le test : toute nouvelle action
// doit déclarer ici qui peut l'exécuter. Chaque cas s'exécute dans une transaction annulée ensuite,
// sur le jeu de démonstration, avec les personnes construites depuis leurs comptes :
//   admin  Sandrine Vidal, administratrice RH        gest   Antoine Leroy, gestionnaire RH
//   mgr    Karim Haddad, manager de la Maintenance    autM   Hugo Lambert, manager de la Logistique
//   coll   Mehdi Benali (Maintenance), concerné       autC   Thomas Garnier (Maintenance), autre collaborateur
//   hse    Sarah Cohen, référente HSE / formation     paie   Aïcha Diallo, gestionnaire de paie
//   lect   Élodie Bernard, lecture seule (direction, DPO, auditeur)
// Les trois derniers agissent dans l'espace RH avec leur profil restreint (PROFILS_RH de shared/constants.ts).
// « O » : l'action aboutit ; « - » : refus 403. Les cas concernent Mehdi Benali, sauf mention.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-07';
process.env.CURSUS_DEMO = '1'; // demo.reinitialiser

const { nouvelleBase, horsContraintes } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { PROFIL_VIDE } = await import('../shared/rules/profil.ts');
const { SAMPLE_PLAN_CSV, SAMPLE_TRIPS_CSV } = await import('../shared/rules/imports.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Role = User['role'];

const db = await nouvelleBase();
await seedDemo(db);

const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number };
async function personne(empId: number | null, role: Role): Promise<User> {
  const u = await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' });
  assert.ok(u, `compte de démonstration ${empId} dans l’espace ${role}`);
  return u;
}
const PROFILS: [string, User][] = [
  ['admin', await personne(null, 'rh')],
  ['gest', await personne(14, 'rh')],
  ['mgr', await personne(12, 'manager')],
  ['autM', await personne(16, 'manager')],
  ['coll', await personne(2, 'collaborateur')],
  ['autC', await personne(6, 'collaborateur')],
  ['hse', await personne(23, 'rh')],
  ['paie', await personne(7, 'rh')],
  ['lect', await personne(11, 'rh')],
];

const WEEK = '2026-10-12';
const H0 = [0, 0, 0, 0, 0, 0, 0], H7 = [7, 7, 7, 7, 7, 0, 0];
/** Feuille de Mehdi pour la semaine 42, dans l'état voulu. */
const feuille = async (statut: string, h = H0) => await db.insert('feuilles', {
  empId: 2, week: WEEK, statut, comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-MAINT', tache: 'Maintenance interne', ks: false, h }],
});
const demande = async (h: string, o: { statut?: string; parId?: number | null } = {}) => (await db.insert<{ id: number }>('demandesCollab', {
  empId: 2, type: 'habilitation', f: null, h, libelle: null, label: null, sessionId: null, motif: 'Chantier', date: '2026-10-06', statut: o.statut ?? 'attente', reponse: null, parId: o.parId ?? null,
})).id;
/** Ligne prévue du plan, sans session rattachée (FCO de la Logistique). */
const lignePrevue = async () => ((await db.one(`SELECT id FROM plan_actions WHERE statut = 'prevu' AND f = 'fco'`)) as { id: number }).id;
const titre = async (h: string) => (await db.one('SELECT id FROM hab_titres WHERE emp_id = 2 AND h = ?', [h])) as { id: number };
/** Formation suivie hors catalogue de Mehdi (jeu de démonstration). */
const suivie = async () => ((await db.one('SELECT id FROM formations_suivies WHERE emp_id = 2')) as { id: number }).id;
const cert = async (f: string) => ((await db.one('SELECT id FROM certifications WHERE emp_id = 2 AND f = ?', [f])) as { id: number }).id;
/** Poste du référentiel créé depuis les fiches de démonstration. */
const posteNomme = async (nom: string) => ((await db.one('SELECT id FROM postes WHERE nom = ?', [nom])) as { id: number }).id;
/** Renonciation ouverte (référence de l'accord) dans les réglages, pour la transaction du cas ; rien à envoyer en plus. */
const rachatOuvert = async () => {
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), forfaitJoursRachat: true, forfaitJoursAccord: 'Accord d’entreprise du 1er mars 2026' });
  return {};
};
/** Avenant de renonciation 2026 de la fiche 9 (forfait jours), en vigueur. */
const avenantForfait = async () => (await db.insert<{ id: number }>('avenantsForfait', {
  empId: 9, annee: 2026, jours: 5, taux: 25, signeLe: '2026-10-01', reference: null, creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Sandrine Vidal',
  annuleLe: null, annulePar: null, annuleMotif: null, lotId: null, sage: false, horsFichier: false,
})).id;
/** Astreinte de Mehdi (Maintenance, ou d'un autre salarié), de 18 h le premier jour à 8 h le dernier, communiquée le 1er octobre. */
const astreinte = async (du: string, au: string, empId = 2) => (await db.insert<{ id: number }>('astreintes', {
  empId, equipe: 'Maintenance', du, debut: '18:00', au, fin: '08:00', communiqueLe: '2026-10-01', motif: null, creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Karim Haddad',
})).id;
/** Intervention de Mehdi déclarée le 5 octobre (feuille de la semaine 41 en brouillon, ligne INT-AST). */
const intervention = async () => {
  const astreinteId = await astreinte('2026-10-05', '2026-10-07');
  await db.insert('feuilles', { empId: 2, week: '2026-10-05', statut: 'brouillon', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-AST', tache: 'Intervention d’astreinte', ks: false, h: [1.5, 0, 0, 0, 0, 0, 0] }] });
  return (await db.insert<{ id: number }>('astreinteInterventions', { astreinteId, empId: 2, jour: '2026-10-05', debut: '22:00', fin: '23:30', heures: 1.5, declareLe: '2026-10-06T08:00:00.000Z', declarePar: 'Mehdi Benali' })).id;
};
const ENTRETIEN = async () => ((await db.one(`SELECT id FROM entretiens WHERE emp_id = 2 AND statut = 'planifie'`)) as { id: number }).id;

/** Absence de Mehdi le 15 décembre, dans l'état voulu (signalée par son manager, ou validée). */
const absence = async (statut: string, type: string) => (await db.insert<{ id: number }>('absences', {
  empId: 2, type, du: '2026-12-15', au: '2026-12-15', statut, keystone: true, justificatif: false,
  ...(statut === 'signalee' ? { signaleLe: '2026-10-07', signalePar: 'Karim Haddad', signaleParInteresse: false } : {}),
})).id;
/** Passeport déclaré par Mehdi depuis son espace, en attente de validation par le service RH. */
const documentDeclare = async () => (await db.insert<{ id: number }>('demandesCollab', {
  empId: 2, type: 'document', f: null, h: null, libelle: null, label: 'Passeport', sessionId: null, motif: null, date: '2026-10-06', statut: 'attente',
  reponse: null, parId: null, declaration: { kind: 'passeport', numero: '21XY12345', expire: '2032-01-01' },
})).id;
// Antoine Leroy, gestionnaire RH, est aussi salarié (14) ; il encadre l'Administration : son valideur est le service RH.
/** Demande de CP d'Antoine Leroy, en attente. */
const demandeAntoine = async () => (await db.insert<{ id: number }>('absences', { empId: 14, type: 'CP', du: '2026-12-07', au: '2026-12-07', statut: 'demandee', keystone: false, justificatif: false })).id;
/** Lot de paie de simulation généré (import à confirmer), sans feuille. */
const lotGenere = async () => (await db.insert<{ id: number }>('lotsPaie', {
  cle: 'essai-droits', mode: 'simulation', statut: 'genere', periode: '2026-10', periodes: ['2026-10'], rappels: [], creation: '2026-10-07T08:00:00.000Z', auteur: 'Essai',
  feuilles: [], resume: { lignes: 0, salaries: 0, rubriques: {} }, sansMatricule: [], contenu: { endpoint: '', dossier: 'X', envoye_le: '', lignes: [] }, telechargements: 0, historique: false,
})).id;
/** Feuille d'Antoine Leroy soumise pour la semaine 42. */
const feuilleAntoine = async () => await db.insert('feuilles', {
  empId: 14, week: WEEK, statut: 'soumise', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-ADM', tache: 'Fonctions support', ks: false, h: H7 }],
});
/** Déplacement de Mehdi à Tanger, sans formalité de détachement. */
const voyage = async () => (await db.insert<{ id: number }>('voyages', {
  empId: 2, dest: 'MA', depart: '2026-11-02', retour: '2026-11-06', motif: 'Chantier Tanger', origine: 'cursus', ref: null, chantier: null,
})).id;
/** Envoi vers Keystone en échec définitif, à relancer ou classer. */
const envoiEnEchec = async () => (await db.insert<{ id: number }>('envois', {
  cible: 'keystone', type: 'heures.validees', cle: 'essai-droits', contenu: {}, statut: 'echec', tentatives: 1, prochaine: null,
  erreur: 'HTTP 400', accuse: null, creation: '2026-10-07T08:00:00.000Z', tentative: '2026-10-07T08:00:00.000Z', envoi: null, classe: null,
})).id;
/**
 * Pièce justificative envoyée par le compte de la personne qui agit (le jeton ne vaut que pour lui), stockage local
 * activé pour l'essai ; renvoie son jeton.
 */
const pieceEnvoyee = async (u: User) => {
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), piecesStockage: 'local' });
  await db.insert('pieces', {
    jeton: `essai-${u.compteId}`, nom: 'attestation.pdf', type: 'application/pdf', taille: 5, empreinte: 'e', fichier: 'a'.repeat(32),
    deposeLe: '2026-10-07T08:00:00.000Z', deposePar: u.nom, deposeCompteId: u.compteId,
  });
  return `essai-${u.compteId}`;
};
/** Pièce déjà jointe à un objet du dossier de Mehdi. */
const pieceJointe = async (objet: string, objetId: number) => (await db.insert<{ id: number }>('pieces', {
  empId: 2, objet, objetId, nom: 'piece.pdf', type: 'application/pdf', taille: 5, empreinte: 'e', fichier: 'b'.repeat(32),
  deposeLe: '2026-10-07T08:00:00.000Z', deposePar: 'Essai', deposeCompteId: null,
})).id;
/** Mehdi en liste d'attente de la session SST du 18 novembre (lot 7, t120), proposé au service RH ou encore en file. */
const attente = async (statut = 'proposee') => (await db.insert<{ id: number }>('attentesSession', {
  sessionId: 2, empId: 2, demandeId: null, certId: await cert('sst'), inscriptionId: null, rang: 1, le: '2026-10-06', par: 'Sandrine Vidal',
  statut, proposeeLe: statut === 'proposee' ? '2026-10-07' : null, issueLe: null, issuePar: null, issue: null,
})).id;
/**
 * Participation présente de Mehdi à une session SST clôturée le 10 juin 2026 (lot 7, t121) : l'évaluation à froid (90 jours
 * après) est due depuis le 8 septembre ; renvoie la participation.
 */
const participationClose = async () => {
  const s = await db.insert<{ id: number }>('sessions', {
    formation: 'sst', date: '2026-06-10', fin: '2026-06-10', jours: ['2026-06-10'], horaires: [], lieu: 'Site de Lyon — salle B', places: 12,
    statut: 'Clôturée', planId: null, bilan: { le: '2026-06-10', par: 'Sandrine Vidal', note: null, commentaire: null, motif: null },
  });
  return (await db.insert<{ id: number }>('participations', { sessionId: s.id, empId: 2, parcours: 'recyclage', present: true, reussi: null, certId: null })).id;
};
/** Évaluation à froid donnée par Mehdi sur cette participation. */
const evaluationDonnee = async () => (await db.insert<{ id: number }>('evaluationsFormation', {
  empId: 2, participationId: await participationClose(), formationSuivieId: null, type: 'froid', repondant: 'salarie', note: null, efficacite: 'efficace',
  commentaire: 'Utile sur le terrain', le: '2026-10-01', auteur: 'Mehdi Benali', auteurId: 2,
})).id;
// lot 11 — dossiers OPCO
/** Dossier OPCO de la ligne prévue du plan (FCO de la Logistique), dans l'état voulu ; renvoie son identifiant. */
const dossierOpco = async (statut = 'a_deposer', champs: Record<string, unknown> = {}) => (await db.insert<{ id: number }>('dossiersOpco', {
  planActionId: await lignePrevue(), empId: null, exercice: 2026, opco: 'opco2i', dispositif: 'plan', statut, du: '2026-11-16', au: '2026-11-17', subrogation: false,
  organismeQualiopi: true, creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Sandrine Vidal',
  ...(statut === 'a_deposer' ? {} : { deposeLe: '2026-10-01' }), ...(['accorde', 'facture', 'rembourse'].includes(statut) ? { accordLe: '2026-10-02', montantAccorde: 1200 } : {}),
  ...(['facture', 'rembourse'].includes(statut) ? { factureLe: '2026-10-05', montantFacture: 1200 } : {}), ...champs,
})).id;
/** Versement de 600 € reçu le 6 octobre sur un dossier remboursé ; renvoie son identifiant. */
const versementOpco = async () => (await db.insert<{ id: number }>('versementsOpco', {
  dossierId: await dossierOpco('rembourse'), le: '2026-10-06', montant: 600, destinataire: 'entreprise', reference: null, saisiLe: '2026-10-06T08:00:00.000Z', saisiPar: 'Sandrine Vidal',
})).id;
/** Réglages modifiés pour l'essai (transaction annulée ensuite). */
const reglages = async (r: Record<string, unknown>) => await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), ...r });
/** Mehdi sorti à la date (démission), conservation des dossiers activée avec la décision du DPO ; renvoie son identifiant. */
const sortiLe = async (fin: string) => {
  await reglages({ conservationActive: true, conservationDecisionDpo: 'Décision DPO 2026-01' });
  await db.update('employes', 2, { fin, motifSortie: 'demission' });
  return 2;
};
// `p` reçoit la personne qui agit (pièce justificative envoyée par son compte) ; les autres lignes l'ignorent.
interface Ligne { action: string; variante?: string; droits: string; p: (u: User) => Record<string, unknown> | Promise<Record<string, unknown>>; env?: Record<string, string> }

//                                                        admin gest mgr autM coll autC  hse paie lect
const MATRICE: Ligne[] = [
  // Fiches et équipes
  { action: 'employe.creer', droits: '                       O    O    -    -    -    -    -    -    -', p: async () => ({ ...PROFIL_VIDE('Maintenance', '2026-10-07'), nom: 'Nouvel Embauché', poste: 'Technicien' }) },
  { action: 'employe.modifier', droits: '                    O    O    O    -    -    -    -    -    -', p: async () => ({ id: 2, poste: 'Technicien de maintenance confirmé' }) },
  // Sortie d'un salarié (date et motif) et son annulation : service RH.
  { action: 'employe.sortie', droits: '                      O    O    -    -    -    -    -    -    -', p: async () => ({ id: 2, date: '2026-12-31', motif: 'demission' }) },
  { action: 'employe.annulerSortie', droits: '               O    O    -    -    -    -    -    -    -', p: async () => {
    await db.update('employes', 2, { fin: '2026-12-31', motifSortie: 'demission', finPrevue: null });
    return { id: 2 };
  } },
  // Titre de séjour valant autorisation de travail (numéro au registre unique du personnel) : service RH.
  { action: 'employe.autorisationTravail', droits: '         O    O    -    -    -    -    -    -    -', p: () => ({ id: 2, requise: true, type: 'salarie', numero: 'AB1234567', expire: '2027-06-30', verifieLe: '2016-08-26' }) },
  // Historique des contrats (t074, t053) : renouvellement du CDD de Lucas Martin (4), annulation d'un avenant programmé : service RH.
  { action: 'employe.renouvelerCdd', droits: '              O    O    -    -    -    -    -    -    -', p: () => ({ id: 4, jusquau: '2027-07-30', signeLe: '2026-10-06', reference: 'Avenant n° 2' }) },
  { action: 'employe.annulerAvenant', droits: '             O    O    -    -    -    -    -    -    -', p: async () => ({
    id: (await db.insert<{ id: number }>('contratsHistorique', {
      empId: 2, effet: '2027-01-01', nature: 'avenant', regime: { statut: 'technicien', typeContrat: 'cdi', temps: '35h', heures: null, forfaitHeures: null, forfaitJours: null, jourOff: [] },
      le: '2026-10-07', par: 'Sandrine Vidal', parId: null, applique: false,
    })).id,
  }) },
  { action: 'equipe.creer', droits: '                        O    O    -    -    -    -    -    -    -', p: () => ({ nom: 'Méthodes' }) },
  { action: 'equipe.renommer', droits: '                     O    O    -    -    -    -    -    -    -', p: () => ({ nom: 'Commercial', nouveau: 'Ventes' }) },
  { action: 'equipe.manager', droits: '                      O    O    -    -    -    -    -    -    -', p: () => ({ nom: 'Commercial', managerId: 19 }) },
  { action: 'equipe.modifier', droits: '                     O    O    -    -    -    -    -    -    -', p: () => ({ nom: 'Commercial', nouveau: 'Ventes', managerId: 19 }) },
  { action: 'equipe.supprimer', droits: '                    O    -    -    -    -    -    -    -    -', p: async () => { await db.insert('equipes', { nom: 'Vide', managerId: null, ordre: 99 }); return { nom: 'Vide' }; } },
  // Équipe parente (t136) : le manager de la Maintenance aura pour valideur celui de la Production.
  { action: 'equipe.parente', droits: '                     O    O    -    -    -    -    -    -    -', p: () => ({ nom: 'Maintenance', parente: 'Production' }) },
  // Délégation des validations (t135) : le manager pour lui-même (Karim Haddad) et le service RH ; révocation de même.
  { action: 'equipe.delegation', droits: '                  O    O    O    -    -    -    -    -    -', p: () => ({ managerId: 12, suppleantId: 3, du: '2026-10-19', au: '2026-10-30', perimetre: ['absences', 'feuilles'] }) },
  { action: 'equipe.revoquerDelegation', droits: '          O    O    O    -    -    -    -    -    -', p: async () => ({
    id: (await db.insert<{ id: number }>('delegations', { managerId: 12, suppleantId: 3, du: '2026-10-19', au: '2026-10-30', perimetre: ['absences'], creeLe: '2026-10-07T08:00:00.000Z', creePar: 'Karim Haddad' })).id,
  }) },
  { action: 'equipe.affecter', variante: 'retrait', droits: 'O    O    O    -    -    -    -    -    -', p: () => ({ empId: 2, equipe: null }) },
  // Le manager n'accueille qu'un salarié « à affecter » (libéré par son manager) ; une mutation directe relève du RH.
  { action: 'equipe.affecter', variante: 'salarié à affecter', droits: 'O    O    O    -    -    -    -    -    -', p: async () => {
    await db.update('employes', 20, { equipe: null });
    return { empId: 20, equipe: 'Maintenance' };
  } },
  { action: 'equipe.affecter', variante: 'membre d’une autre équipe', droits: 'O    O    -    -    -    -    -    -    -', p: async () => ({ empId: 20, equipe: 'Maintenance' }) },
  // Formations, certifications, habilitations
  { action: 'plan.inscrire', droits: '                       O    O    O    -    -    -    O    -    -', p: async () => ({ empId: 2, certId: await cert('sst'), sessionId: 2, conv: 'now' }) },
  // Convocations (e-mail avec .ics) et désinscription : service RH, référent HSE / formation ou manager direct.
  { action: 'convocation.envoyer', droits: '                 O    O    O    -    -    -    O    -    -', p: async () => {
    await db.update('certifications', await cert('sst'), { sessionId: 2, convoc: 'later' });
    return { sessionId: 2, empIds: [2] };
  } },
  { action: 'plan.desinscrire', droits: '                    O    O    O    -    -    -    O    -    -', p: async () => {
    await db.update('certifications', await cert('sst'), { sessionId: 2, convoc: 'now' });
    return { empId: 2, sessionId: 2 };
  } },
  { action: 'cert.ajouter', droits: '                        O    O    -    -    -    -    O    -    -', p: async () => ({ empId: 2, f: 'sst', date: '2026-10-01' }) },
  // Corrections d'une saisie erronée : modification (service RH, référent HSE), suppression (administrateur RH), motif exigé.
  { action: 'cert.modifier', droits: '                       O    O    -    -    -    -    O    -    -', p: async () => ({ id: await cert('sst'), date: '2025-05-05', motif: 'Date mal saisie' }) },
  { action: 'cert.annuler', droits: '                        O    -    -    -    -    -    -    -    -', p: async () => ({ id: await cert('sst'), motif: 'Saisie sur la mauvaise fiche' }) },
  // Formations suivies (t116) : saisie et correction par le service RH et le référent HSE, suppression par l'administrateur RH.
  { action: 'formationSuivie.enregistrer', droits: '         O    O    -    -    -    -    O    -    -', p: () => ({ empId: 2, libelle: 'Anglais technique', du: '2026-09-14', au: '2026-09-16', duree: 21 }) },
  { action: 'formationSuivie.modifier', droits: '            O    O    -    -    -    -    O    -    -', p: async () => ({ id: await suivie(), duree: 15, motif: 'Durée mal saisie' }) },
  { action: 'formationSuivie.annuler', droits: '             O    -    -    -    -    -    -    -    -', p: async () => ({ id: await suivie(), motif: 'Saisie sur la mauvaise fiche' }) },
  { action: 'session.creer', droits: '                       O    O    -    -    -    -    O    -    -', p: () => ({ f: 'sst', date: '2026-12-01', lieu: 'Site de Lyon', places: 8 }) },
  // Sessions : cycle de vie et clôture par le service RH (session 2 : SST du 18 novembre, à confirmer).
  { action: 'session.confirmer', droits: '                   O    O    -    -    -    -    O    -    -', p: async () => ({ id: 2 }) },
  { action: 'session.modifier', droits: '                    O    O    -    -    -    -    O    -    -', p: async () => ({ id: 2, lieu: 'Site de Lyon — salle C' }) },
  { action: 'session.annuler', droits: '                     O    O    -    -    -    -    O    -    -', p: async () => ({ id: 2, motif: 'Organisme indisponible' }) },
  { action: 'session.cloturer', droits: '                    O    O    -    -    -    -    O    -    -', p: async () => ({
    id: (await db.insert<{ id: number }>('sessions', { formation: 'sst', date: '2026-10-01', lieu: 'Site de Lyon', places: 8, statut: 'Confirmée', planId: null, bilan: null })).id,
    participants: [],
  }) },
  { action: 'hab.delivrer', droits: '                        O    O    -    -    -    -    O    -    -', p: async () => ({ empId: 2, h: 'hauteur', date: '2026-10-07', par: 'Sarah Cohen', mode: 'renew' }) },
  { action: 'hab.suspendre', droits: '                       O    O    O    -    -    -    O    -    -', p: async () => ({ empId: 2, h: 'hauteur', motif: 'Incident sur passerelle' }) },
  { action: 'hab.lever', droits: '                           O    O    -    -    -    -    O    -    -', p: async () => {
    await db.update('habTitres', (await titre('hauteur')).id, { mesure: 'suspension', mesureDate: '2026-10-05', mesureMotif: 'Incident', mesurePar: 'Karim Haddad' });
    return { empId: 2, h: 'hauteur' };
  } },
  { action: 'hab.retirer', droits: '                         O    O    -    -    -    -    O    -    -', p: async () => ({ empId: 2, h: 'hauteur', motif: 'Restriction médicale' }) },
  // Santé au travail : demandes de visite et avis du médecin du travail, données de santé réservées au service RH.
  { action: 'medical.demander', droits: '                    O    O    -    -    -    -    -    -    -', p: async () => ({ empId: 2 }) },
  { action: 'medical.annuler', droits: '                     O    O    -    -    -    -    -    -    -', p: async () => ({
    id: (await db.insert<{ id: number }>('demandesVisite', { empId: 2, motif: 'periodique', le: '2026-10-05', par: 'Sandrine Vidal', statut: 'demandee', closeLe: null, closePar: null })).id,
  }) },
  { action: 'medical.avis', droits: '                        O    O    -    -    -    -    -    -    -', p: async () => ({
    empId: 2, date: '2026-10-06', avis: 'restrictions', restrictions: [{ texte: 'Pas de travail en hauteur', jusquau: '2026-12-31' }], suspendre: ['hauteur'],
  }) },
  // Type de suivi médical saisi sur la fiche (VIP, VIP adaptée, suivi renforcé) : service RH seulement.
  { action: 'medical.suivi', droits: '                       O    O    -    -    -    -    -    -    -', p: async () => ({ empId: 2, suivi: 'vip_adapte' }) },
  { action: 'demande.accepter', droits: '                    O    O    -    -    -    -    O    -    -', p: async () => ({ id: await demande('aipr') }) },
  // Liste d'attente des sessions complètes (lot 7, t120) : confirmation de l'inscription d'une personne proposée (service RH,
  // référent HSE) ; retrait de la file par le salarié lui-même, son manager direct, le service RH ou le référent HSE.
  { action: 'attente.confirmer', droits: '                   O    O    -    -    -    -    O    -    -', p: async () => ({ id: await attente() }) },
  { action: 'attente.retirer', droits: '                     O    O    O    -    O    -    O    -    -', p: async () => ({ id: await attente('attente') }) },
  // Évaluation des formations (lot 7, t121) : le salarié pour lui-même, son manager direct (son avis de manager), le service RH
  // (avis recueilli) ; ni le référent HSE, ni la paie, ni la lecture seule (indicateurs agrégés seulement). Retrait : l'auteur
  // de l'avis (ici le salarié) et le service RH.
  { action: 'evaluation.enregistrer', droits: '              O    O    O    -    O    -    -    -    -', p: async () => ({ participationId: await participationClose(), type: 'froid', efficacite: 'efficace', repondant: 'salarie' }) },
  { action: 'evaluation.retirer', droits: '                  O    O    -    -    O    -    -    -    -', p: async () => ({ id: await evaluationDonnee() }) },
  // lot 11 — dossiers OPCO : service RH ; retour d'un cran, annulation d'un versement et suppression, administrateur RH ;
  // ni le manager, ni le collaborateur, ni les profils restreints (lecture seule : consultation sans action).
  { action: 'opco.creer', droits: '                        O    O    -    -    -    -    -    -    -', p: async () => ({ planActionId: await lignePrevue(), dispositif: 'plan', du: '2026-11-16', au: '2026-11-17' }) },
  { action: 'opco.modifier', droits: '                     O    O    -    -    -    -    -    -    -', p: async () => ({ id: await dossierOpco(), heures: 14 }) },
  { action: 'opco.deposer', droits: '                      O    O    -    -    -    -    -    -    -', p: async () => ({ id: await dossierOpco(), de: 'a_deposer', reference: 'OPCO2I-2026-001' }) },
  { action: 'opco.accorder', droits: '                     O    O    -    -    -    -    -    -    -', p: async () => ({ id: await dossierOpco('depose'), de: 'depose', montantAccorde: 1200 }) },
  { action: 'opco.refuser', droits: '                      O    O    -    -    -    -    -    -    -', p: async () => ({ id: await dossierOpco('depose'), de: 'depose', motif: 'budget_epuise' }) },
  { action: 'opco.facturer', droits: '                     O    O    -    -    -    -    -    -    -', p: async () => ({ id: await dossierOpco('accorde'), de: 'accorde', montantFacture: 1200 }) },
  { action: 'opco.versement', droits: '                    O    O    -    -    -    -    -    -    -', p: async () => ({ id: await dossierOpco('facture'), montant: 1200, le: '2026-10-06' }) },
  { action: 'opco.annulerVersement', droits: '            O    -    -    -    -    -    -    -    -', p: async () => ({ id: await versementOpco(), motif: 'Versement saisi deux fois' }) },
  { action: 'opco.solder', droits: '                       O    O    -    -    -    -    -    -    -', p: async () => ({ id: await dossierOpco('facture'), de: 'facture', nature: 'perte' }) },
  { action: 'opco.abandonner', droits: '                   O    O    -    -    -    -    -    -    -', p: async () => ({ id: await dossierOpco(), de: 'a_deposer', motif: 'formation_annulee' }) },
  { action: 'opco.rouvrir', droits: '                      O    -    -    -    -    -    -    -    -', p: async () => ({ id: await dossierOpco('depose'), de: 'depose', motif: 'Dépôt enregistré par erreur' }) },
  { action: 'opco.supprimer', droits: '                    O    -    -    -    -    -    -    -    -', p: async () => ({ id: await dossierOpco(), motif: 'Dossier créé deux fois' }) },
  // Pièce d'un dossier OPCO (lot 11), sans salarié : service RH seulement.
  { action: 'piece.joindre', variante: 'dossier OPCO', droits: '  O    O    -    -    -    -    -    -    -', p: async u => await ({ jetons: [await pieceEnvoyee(u)], objet: 'dossierOpco', objetId: await dossierOpco(), nature: 'convention' }) },
  { action: 'demande.refuser', droits: '                     O    O    -    -    -    -    O    -    -', p: async () => ({ id: await demande('aipr') }) },
  // Demande retirée par son auteur seul (Mehdi pour la sienne, Karim pour celle qu'il a faite pour Mehdi), tant qu'elle
  // attend ; rouverte par le service RH ou le référent HSE.
  { action: 'demande.annuler', variante: 'collaborateur', droits: '-    -    -    -    O    -    -    -    -', p: async () => ({ id: await demande('aipr') }) },
  { action: 'demande.annuler', variante: 'manager', droits: '      -    -    O    -    -    -    -    -    -', p: async () => ({ id: await demande('aipr', { parId: 12 }) }) },
  { action: 'demande.reouvrir', droits: '                    O    O    -    -    -    -    O    -    -', p: async () => ({ id: await demande('aipr', { statut: 'refusee' }), motif: 'Refus par erreur' }) },
  // Document déclaré (passeport, visa, vaccination) : service RH seulement.
  { action: 'demande.accepter', variante: 'document', droits: 'O    O    -    -    -    -    -    -    -', p: async () => ({ id: await documentDeclare() }) },
  { action: 'demande.refuser', variante: 'document', droits: ' O    O    -    -    -    -    -    -    -', p: async () => ({ id: await documentDeclare() }) },
  // Le collaborateur demande pour lui-même (l'autre collaborateur aussi, pour lui) ; le manager pour un membre de son équipe.
  { action: 'demande.formation', droits: '                   -    -    O    -    O    O    -    -    -', p: async () => ({ f: 'autre', libelle: 'Lean management', motif: 'Évolution', empId: 2 }) },
  { action: 'demande.habilitation', droits: '                -    -    O    -    O    O    -    -    -', p: async () => ({ h: 'aipr', motif: 'Chantier réseaux', empId: 2 }) },
  // Référentiels : formations et habilitations (service RH, référent HSE / formation), destinations (service RH).
  { action: 'referentiel.formation.enregistrer', droits: '   O    O    -    -    -    -    O    -    -', p: async () => ({
    id: 'sst', nom: 'Sauveteur secouriste du travail (SST)', court: 'SST', type: 'Réglementaire', validite: 24, duree: '7 h (MAC)', organisme: 'Croix-Rouge française', cout: 190, validation: 'evaluation',
  }) },
  { action: 'referentiel.formation.enregistrer', variante: 'création', droits: 'O    O    -    -    -    -    O    -    -', p: async () => ({
    code: 'caces485', nom: 'CACES R485 — Gerbeurs à conducteur accompagnant', court: 'CACES R485', type: 'Réglementaire', validite: 60, duree: '14 h', organisme: 'AFTRAL', cout: 450, validation: 'evaluation',
  }) },
  // Formation AIPR : prérequis de l'habilitation AIPR, archivée d'abord.
  { action: 'referentiel.formation.archiver', droits: '      O    O    -    -    -    -    O    -    -', p: async () => {
    await db.update('habilitations', 'aipr', { archive: '2026-10-07' });
    return { id: 'aipr' };
  } },
  { action: 'referentiel.habilitation.enregistrer', droits: 'O    O    -    -    -    -    O    -    -', p: async () => ({
    id: 'aipr', nom: 'Autorisation AIPR', detail: 'Intervention à proximité des réseaux', prereqs: ['aipr'], medical: false, validite: 60, signataire: 'Karim Haddad',
  }) },
  { action: 'referentiel.habilitation.archiver', droits: '   O    O    -    -    -    -    O    -    -', p: async () => ({ id: 'aipr' }) },
  { action: 'referentiel.destination.enregistrer', droits: ' O    O    -    -    -    -    -    -    -', p: async () => ({
    id: 'MA', pays: 'Maroc', visa: 'none', visaSub: 'séjour ≤ 90 jours', oblig: [], rec: ['hepA', 'typhoide'], passMois: 3, secu: 'convention',
  }) },
  { action: 'referentiel.destination.archiver', droits: '    O    O    -    -    -    -    -    -    -', p: async () => ({ id: 'VN' }) },
  // Référentiel type : dans un référentiel vide seulement (vidé pour l'essai, transaction annulée).
  { action: 'referentiel.charger', variante: 'formations', droits: 'O    O    -    -    -    -    O    -    -', p: async () => {
    await horsContraintes(db, async () => { await db.exec('DELETE FROM formations'); });
    return { referentiel: 'formations' };
  } },
  { action: 'referentiel.charger', variante: 'habilitations', droits: 'O    O    -    -    -    -    O    -    -', p: async () => {
    await horsContraintes(db, async () => { await db.exec('DELETE FROM habilitations'); });
    return { referentiel: 'habilitations' };
  } },
  { action: 'referentiel.charger', variante: 'destinations', droits: 'O    O    -    -    -    -    -    -    -', p: async () => {
    await horsContraintes(db, async () => { await db.exec('DELETE FROM destinations'); });
    return { referentiel: 'destinations' };
  } },
  // Postes et exigences (t055) : service RH ; habilitation exigée demandée : service RH et référent HSE.
  { action: 'referentiel.poste.enregistrer', droits: '     O    O    -    -    -    -    -    -    -', p: async () => ({
    id: await posteNomme('Technicien de maintenance'), nom: 'Technicien de maintenance', formations: ['elec', 'sst'], habilitations: ['he'],
  }) },
  { action: 'referentiel.poste.enregistrer', variante: 'création', droits: 'O    O    -    -    -    -    -    -    -', p: async () => ({ nom: 'Soudeur', formations: [], habilitations: [] }) },
  { action: 'referentiel.poste.archiver', droits: '        O    O    -    -    -    -    -    -    -', p: async () => ({
    id: (await db.insert<{ id: number }>('postes', { nom: 'Poste inoccupé', formations: [], habilitations: [], archive: null })).id,
  }) },
  { action: 'referentiel.equipe.exigences', droits: '      O    O    -    -    -    -    -    -    -', p: async () => ({ nom: 'Maintenance', formations: ['sst'], habilitations: [] }) },
  { action: 'hab.demander', droits: '                      O    O    -    -    -    -    O    -    -', p: async () => ({ empId: 2, h: 'atex' }) },
  // Déplacements
  { action: 'voyage.creer', droits: '                        O    O    -    -    -    -    -    -    -', p: async () => ({ empId: 2, dest: 'MA', depart: '2026-11-02', retour: '2026-11-06', motif: 'Chantier Tanger' }) },
  // Formalités de détachement (certificat de sécurité sociale, information écrite) : démarches du service RH.
  { action: 'voyage.detachement', droits: '                  O    O    -    -    -    -    -    -    -', p: async () => ({ id: await voyage(), detachementLe: '2026-10-06' }) },
  // Modification et annulation d'un déplacement : service RH (Keystone prévenu pour un déplacement venu de Keystone).
  { action: 'voyage.modifier', droits: '                 O    O    -    -    -    -    -    -    -', p: async () => ({ id: await voyage(), depart: '2026-11-03', retour: '2026-11-06' }) },
  // Déplacements dans la paie (t031) : qualification « grand déplacement » d'un chantier en France, service RH.
  { action: 'chantier.grandDeplacement', droits: '       O    O    -    -    -    -    -    -    -', p: () => ({ id: 'K-2620', grandDeplacement: true }) },
  // Contact d'urgence (t068) : le salarié pour lui-même (portail) ou le service RH ; ni le manager, ni les profils restreints.
  { action: 'employe.contactUrgence', droits: '          O    O    -    -    O    -    -    -    -', p: () => ({ empId: 2, nom: 'Nadia Benali (sœur)', telephone: '06 12 34 56 78' }) },
  { action: 'voyage.annuler', droits: '                  O    O    -    -    -    -    -    -    -', p: async () => ({ id: await voyage(), motif: 'Chantier reporté' }) },
  // Forfait jours (t043) : avenant de renonciation d'un cadre au forfait (fiche 9), service RH, une fois l'accord référencé.
  { action: 'forfait.avenant', droits: '                 O    O    -    -    -    -    -    -    -', p: async () => ({ ...await rachatOuvert(), empId: 9, annee: 2026, jours: 2, taux: 25, signeLe: '2026-10-01', reference: 'AV-FJ-2026-01' }) },
  { action: 'forfait.annulerAvenant', droits: '          O    O    -    -    -    -    -    -    -', p: async () => ({ id: await avenantForfait(), motif: 'Avenant saisi par erreur' }) },
  { action: 'formalite.enregistrer', droits: '               O    O    -    -    O    -    -    -    -', p: async () => ({ empId: 2, kind: 'passeport', numero: '21XY12345', expire: '2032-01-01' }) },
  { action: 'voyages.importer', droits: '                    O    O    -    -    -    -    -    -    -', p: async () => ({ texte: SAMPLE_TRIPS_CSV }) },
  { action: 'keystone.accepter', droits: '                   O    O    -    -    -    -    -    -    -', p: async () => ({ id: 1 }) },
  { action: 'keystone.refuser', droits: '                    O    O    -    -    -    -    -    -    -', p: async () => ({ id: 1 }) },
  // Plan et budget : remplacer les lignes prévues les supprime (administrateur RH).
  { action: 'plan.importer', variante: 'compléter', droits: 'O    O    -    -    -    -    -    -    -', p: async () => ({ texte: SAMPLE_PLAN_CSV, exercice: 2027, mode: 'add' }) },
  { action: 'plan.importer', variante: 'remplacer', droits: 'O    -    -    -    -    -    -    -    -', p: async () => ({ texte: SAMPLE_PLAN_CSV, exercice: 2026, mode: 'replace' }) },
  { action: 'budget.enveloppes', droits: '                   O    O    -    -    -    -    -    -    -', p: async () => ({ exercice: 2027, enveloppes: { Maintenance: 5000 } }) },
  // Ligne du plan saisie par erreur : correction (service RH), suppression (administrateur RH).
  { action: 'plan.modifier', droits: '                       O    O    -    -    -    -    -    -    -', p: async () => ({ id: await lignePrevue(), periode: 'T3', motif: 'Trimestre erroné' }) },
  { action: 'plan.supprimer', droits: '                      O    -    -    -    -    -    -    -    -', p: async () => ({ id: await lignePrevue(), motif: 'Doublon de l’import' }) },
  { action: 'plan.avancer', droits: '                        O    O    -    -    -    -    -    -    -', p: async () => ({ id: ((await db.one(`SELECT id FROM plan_actions WHERE statut <> 'realise' LIMIT 1`)) as { id: number }).id, coutReel: 1000 }) },
  // Clôture de l'exercice 2026 (administrateur RH), une fois passé, avec le report d'une action engagée sur 2027.
  { action: 'plan.cloturerExercice', droits: '               O    -    -    -    -    -    -    -    -', env: { CURSUS_TODAY: '2027-01-05' }, p: async () => ({ exercice: 2026, reporter: [((await db.one(`SELECT id FROM plan_actions WHERE statut = 'engage' LIMIT 1`)) as { id: number }).id] }) },
  // Feuilles de temps : saisie par le salarié, son manager ou le RH ; validation par le manager ou le RH ; paie : administrateur RH.
  { action: 'temps.setCell', droits: '                       O    O    O    -    O    -    -    -    -', p: async () => { await feuille('brouillon'); return { empId: 2, week: WEEK, li: 0, di: 0, value: '7' }; } },
  // Horaire du jour (lot 6) : mêmes droits que la saisie des heures.
  { action: 'temps.horaire', droits: '                       O    O    O    -    O    -    -    -    -', p: async () => { await feuille('brouillon'); return { empId: 2, week: WEEK, di: 0, code: 'J' }; } },
  { action: 'temps.addLine', droits: '                       O    O    O    -    O    -    -    -    -', p: () => ({ empId: 2, week: WEEK, projet: 'INT-MAINT' }) },
  { action: 'temps.removeLine', droits: '                    O    O    O    -    O    -    -    -    -', p: async () => { await feuille('brouillon'); return { empId: 2, week: WEEK, li: 0 }; } },
  { action: 'temps.suggest', droits: '                       O    O    O    -    O    -    -    -    -', p: async () => ({ empId: 2, week: WEEK }) },
  { action: 'temps.submit', droits: '                        O    O    O    -    O    -    -    -    -', p: async () => { await feuille('brouillon', H7); return { empId: 2, week: WEEK }; } },
  { action: 'temps.validate', droits: '                      O    O    O    -    -    -    -    -    -', p: async () => { await feuille('soumise', H7); return { empId: 2, week: WEEK }; } },
  { action: 'temps.reject', droits: '                        O    O    O    -    -    -    -    -    -', p: async () => { await feuille('soumise', H7); return { empId: 2, week: WEEK, comment: 'Projet à corriger' }; } },
  { action: 'temps.pushSage', droits: '                      O    -    -    -    -    -    -    O    -', p: async () => ({}) },
  // Réouverture d'une feuille validée (t131) : administrateur RH seul, motif obligatoire (réponse du 17 octobre 2026).
  { action: 'temps.rouvrir', droits: '                       O    -    -    -    -    -    -    -    -', p: async () => { await feuille('validee', H7); return { empId: 2, week: WEEK, motif: 'Heures du mardi imputées au mauvais projet' }; } },
  // Correspondance des rubriques avec le plan de paie Sage : administrateur RH et gestionnaire de paie (écran Temps).
  { action: 'paie.rubrique', droits: '                       O    -    -    -    -    -    -    O    -', p: async () => ({ code: 'HS25', codeSage: '3010', confirmer: true }) },
  // Lots de paie (écran Temps) : génération, confirmation de l'import, annulation, format du fichier d'import.
  { action: 'paie.lotGenerer', droits: '                     O    -    -    -    -    -    -    O    -', p: async () => ({ periode: '2026-10' }) },
  { action: 'paie.lotConfirmer', droits: '                   O    -    -    -    -    -    -    O    -', p: async () => ({ id: await lotGenere() }) },
  { action: 'paie.lotAnnuler', droits: '                     O    -    -    -    -    -    -    O    -', p: async () => ({ id: await lotGenere() }) },
  { action: 'paie.formatFichier', droits: '                  O    -    -    -    -    -    -    O    -', p: async () => ({ separateur: ',', decimale: '.' }) },
  // Suivi des feuilles : relance et validation groupée par le manager direct ou le service RH (jamais les profils restreints).
  { action: 'temps.relancer', droits: '                      O    O    O    -    -    -    -    -    -', p: async () => {
    // Feuille de la semaine 40 renvoyée pour correction, échéance passée : en retard.
    await db.exec(`UPDATE feuilles SET statut = 'rejetee' WHERE emp_id = 2 AND week = '2026-09-28'`);
    return { empId: 2 };
  } },
  { action: 'temps.validerLot', droits: '                    O    O    O    -    -    -    -    -    -', p: async () => { await feuille('soumise', H7); return { feuilles: [{ empId: 2, week: WEEK }] }; } },
  // Semaine à 7 jours : dérogation au repos dominical d'une équipe, réglée par l'administrateur RH (Paramètres).
  { action: 'temps.derogationDominicale', droits: '          O    -    -    -    -    -    -    -    -', p: async () => ({ equipe: 'Maintenance', type: 'feu_continu', reference: 'Accord du 12 mars 2024' }) },
  // Activités internes (écran Référentiels) et mandats au CSE (fiche) : service RH.
  { action: 'referentiel.activite.enregistrer', droits: '    O    O    -    -    -    -    -    -    -', p: () => ({ code: 'INT-ACCUEIL', nom: 'Accueil des visiteurs' }) },
  { action: 'referentiel.activite.archiver', droits: '      O    O    -    -    -    -    -    -    -', p: () => ({ id: 'INT-COM' }) },
  // Horaires de poste (lot 6) : service RH ; la lecture seule consulte.
  { action: 'referentiel.horaire.enregistrer', droits: '     O    O    -    -    -    -    -    -    -', p: () => ({ code: 'S', nom: 'Samedi matin', debut: '06:00', fin: '12:00', pause: 0 }) },
  { action: 'referentiel.horaire.archiver', droits: '       O    O    -    -    -    -    -    -    -', p: () => ({ id: 'AM' }) },
  // Compte professionnel de prévention (lot 7, t052) : facteurs du poste et qualification des horaires, service RH et
  // référent HSE ; la lecture seule consulte la synthèse.
  { action: 'referentiel.poste.expositions', droits: '           O    O    -    -    -    -    O    -    -', p: async () => ({ id: await posteNomme('Cariste'), facteurs: ['bruit'] }) },
  { action: 'referentiel.horaire.alternant', droits: '   O    O    -    -    -    -    O    -    -', p: () => ({ id: 'N', alternant: true }) },
  // Passeport de prévention (lot 7, t066) : lignes marquées déclarées et marque retirée, service RH et référent HSE ; la
  // lecture seule consulte l'écran Formations.
  { action: 'passeport.declarer', droits: '            O    O    -    -    -    -    O    -    -', p: async () => ({ cles: [`cert:${await cert('sst')}`], le: '2026-10-07' }) },
  { action: 'passeport.retirer', droits: '             O    O    -    -    -    -    O    -    -', p: async () => {
    const certId = await cert('sst');
    await db.insert('declarationsPasseport', { empId: 2, certId, suivieId: null, declareLe: '2026-10-01', le: '2026-10-01', auteur: 'Sarah Cohen', auteurId: 23 });
    return { cle: `cert:${certId}` };
  } },
  // Jours fériés et journée de solidarité d'une année (lot 6) : administrateur RH.
  { action: 'parametres.feries', droits: '                  O    -    -    -    -    -    -    -    -', p: () => ({ annee: 2027, solidarite: 'pentecote_travaillee', nonChomes: [] }) },
  { action: 'mandat.enregistrer', droits: '                  O    O    -    -    -    -    -    -    -', p: () => ({ empId: 2, role: 'titulaire', du: '2026-11-01', credit: 21 }) },
  { action: 'mandat.supprimer', droits: '                    O    O    -    -    -    -    -    -    -', p: async () => ({ id: (await db.insert<{ id: number }>('mandats', { empId: 2, role: 'suppleant', du: '2026-01-01', au: null, credit: 0 })).id }) },
  // Un membre du RH élu ne saisit ni ne retire son propre mandat (crédit d'heures) : un autre membre du RH le fait.
  { action: 'mandat.enregistrer', variante: 'mandat du gestionnaire RH', droits: 'O    -    -    -    -    -    -    -    -', p: async () => ({ empId: 14, role: 'titulaire', du: '2026-11-01', credit: 21 }) },
  { action: 'mandat.supprimer', variante: 'mandat du gestionnaire RH', droits: 'O    -    -    -    -    -    -    -    -', p: async () => ({ id: (await db.insert<{ id: number }>('mandats', { empId: 14, role: 'suppleant', du: '2026-01-01', au: null, credit: 0 })).id }) },
  // Un membre du RH ne valide pas sa propre feuille : son valideur (ici le service RH) le fait.
  { action: 'temps.validate', variante: 'feuille du gestionnaire RH', droits: 'O    -    -    -    -    -    -    -    -', p: async () => { await feuilleAntoine(); return { empId: 14, week: WEEK }; } },
  // Relevé d'heures des intérimaires (Léa Girard, agence Proman Lyon) : service RH ou gestionnaire de paie.
  { action: 'releve.envoyer', droits: '                      O    O    -    -    -    -    -    O    -', p: async () => ({ agence: 'Proman Lyon', semaine: '2026-09-21' }) },
  // Congés
  { action: 'absence.demander', droits: '                    O    O    O    -    O    -    -    -    -', p: () => ({ empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' }) },
  { action: 'absence.decider', droits: '                     O    O    O    -    -    -    -    -    -', p: async () => ({ id: ((await db.one(`SELECT id FROM absences WHERE emp_id = 2 AND statut = 'demandee'`)) as { id: number }).id, ok: true }) },
  { action: 'absence.decider', variante: 'demande du gestionnaire RH', droits: 'O    -    -    -    -    -    -    -    -', p: async () => ({ id: await demandeAntoine(), ok: true }) },
  { action: 'cet.placer', droits: '                          O    O    -    -    O    -    -    -    -', p: async () => ({ empId: 2, kind: 'RTT', jours: 1 }) },
  { action: 'report.accorder', droits: '                     O    O    -    -    -    -    -    -    -', p: async () => ({ empId: 2, jours: 1, motif: 'Arrêt maladie' }) },
  // Clôture d'une période de congés : service RH (RTT 2025 de Mehdi, compteurs repris arrêtés en 2025 pour l'essai).
  { action: 'conges.cloturer', droits: '                     O    O    -    -    -    -    -    -    -', p: async () => {
    await db.update('soldesReprise', 2, { arreteLe: '2025-09-01' });
    return { type: 'RTT', periode: 2025 };
  } },
  // Jours de fractionnement (t046) : service RH (période 2025 de Mehdi, compteurs repris arrêtés avant sa fenêtre pour l'essai).
  { action: 'conges.fractionnement', droits: '               O    O    -    -    -    -    -    -    -', p: async () => {
    await db.update('soldesReprise', 2, { arreteLe: '2025-01-01' });
    return { periode: 2025, lignes: [{ empId: 2, decision: 'renoncer' }] };
  } },
  // Information au retour d'un arrêt (art. L3141-19-3) : service RH, jamais pour lui-même (arrêt de Mehdi terminé le 2 octobre).
  { action: 'conges.informer', droits: '                     O    O    -    -    -    -    -    -    -', p: async () => ({
    id: (await db.insert<{ id: number }>('absences', { empId: 2, type: 'MALADIE', du: '2026-09-28', au: '2026-10-02', statut: 'validee', keystone: true, justificatif: true, justificatifLe: '2026-09-28' })).id,
  }) },
  // Absences hors congés : le salarié ou son manager signale, le RH qualifie ou saisit ; annulation selon le statut.
  { action: 'absence.signaler', droits: '                    O    O    O    -    O    -    -    -    -', p: async () => ({ empId: 2, du: '2026-12-15', au: '2026-12-15' }) },
  { action: 'absence.saisir', droits: '                      O    O    -    -    -    -    -    -    -', p: async () => ({ empId: 2, nature: 'MARIAGE', du: '2026-12-15', au: '2026-12-16' }) },
  { action: 'absence.qualifier', droits: '                   O    O    -    -    -    -    -    -    -', p: async () => ({ id: await absence('signalee', 'ABSENCE'), nature: 'MALADIE' }) },
  { action: 'absence.prolonger', droits: '                   O    O    O    -    O    -    -    -    -', p: async () => ({ id: await absence('validee', 'MALADIE'), au: '2026-12-16' }) },
  { action: 'absence.annuler', droits: '                     O    O    O    -    -    -    -    -    -', p: async () => ({ id: await absence('validee', 'CP') }) },
  // Entretiens : l'évaluateur (manager direct ou RH) et le salarié pour ses sections et sa signature.
  // Mehdi a déjà un entretien annuel planifié (le 20 octobre) : un entretien de parcours professionnel.
  { action: 'entretien.planifier', droits: '                 O    O    O    -    -    -    -    -    -', p: async () => ({ empId: 2, kind: 'epp', date: '2026-11-16' }) },
  // Annulation d'un entretien planifié : l'évaluateur (manager direct) ou le RH ; compte rendu commencé : sur confirmation.
  { action: 'entretien.annuler', droits: '                  O    O    O    -    -    -    -    -    -', p: async () => ({ id: await ENTRETIEN(), confirmer: true }) },
  { action: 'entretien.modifier', droits: '                  O    O    O    -    O    -    -    -    -', p: async () => ({ id: await ENTRETIEN(), section: 'avis', value: 'Année riche en chantiers' }) },
  // Entretien prévu le 20 octobre, tenu plus tôt : la clôture porte la date à laquelle il a eu lieu.
  { action: 'entretien.clore', droits: '                     O    O    O    -    -    -    -    -    -', p: async () => ({ id: await ENTRETIEN(), date: '2026-10-06' }) },
  { action: 'entretien.signer', droits: '                    -    -    -    -    O    -    -    -    -', p: async () => {
    const id = await ENTRETIEN();
    await db.update('entretiens', id, { statut: 'realise', signMgr: '2026-10-07' });
    return { id };
  } },
  // Remise de la copie du compte rendu clos (évaluateur ou RH) ; téléchargement enregistré pour le salarié seul.
  { action: 'entretien.remettre', droits: '                  O    O    O    -    -    -    -    -    -', p: async () => {
    const id = await ENTRETIEN();
    await db.update('entretiens', id, { statut: 'realise', signMgr: '2026-10-07' });
    return { id, mode: 'main_propre', date: '2026-10-07' };
  } },
  { action: 'entretien.telecharger', droits: '               -    -    -    -    O    -    -    -    -', p: async () => {
    const id = await ENTRETIEN();
    await db.update('entretiens', id, { statut: 'realise', signMgr: '2026-10-07' });
    return { id };
  } },
  // Administration : administrateur RH.
  { action: 'parametres.maj', droits: '                      O    -    -    -    -    -    -    -    -', p: async () => ({ horizonAlerte: 60 }) },
  { action: 'demo.reinitialiser', droits: '                  O    -    -    -    -    -    -    -    -', p: async () => ({}) },
  // Mise en service (reprise depuis Lucca) : administrateur RH seul, quel que soit l'import.
  { action: 'reprise.importer', droits: '                    O    -    -    -    -    -    -    -    -', p: async () => ({
    type: 'soldes', texte: 'Nom;CP N-1\nMehdi Benali;10', colonnes: ['nom', 'cpN1'], dateReprise: '2026-10-01',
  }) },
  { action: 'compte.creer', droits: '                        O    -    -    -    -    -    -    -    -', p: () => ({ type: 'microsoft', identifiant: 'paie@cabinet.example', nom: 'Cabinet Paie', profilRh: 'rh_gestionnaire' }) },
  { action: 'compte.profil', droits: '                       O    -    -    -    -    -    -    -    -', p: async () => ({ id: (await compteDe(2)).id, profilRh: 'rh_gestionnaire' }) },
  // Compte externe de Sandrine Vidal rattaché à une fiche sans compte (celui d'Inès Dupont, retiré pour l'essai).
  { action: 'compte.rattacher', droits: '                    O    -    -    -    -    -    -    -    -', p: async () => {
    (await db.run('DELETE FROM comptes WHERE emp_id = 5'));
    return { id: (await compteDe(null)).id, empId: 5 };
  } },
  { action: 'compte.activer', droits: '                      O    -    -    -    -    -    -    -    -', p: async () => ({ id: (await compteDe(1)).id, actif: false }) },
  { action: 'compte.reinitialiser', droits: '                O    -    -    -    -    -    -    -    -', p: async () => ({ id: (await compteDe(1)).id }) },
  // Messagerie : adresses et e-mail d'essai (administrateur RH), récapitulatif sans attendre (RH) ;
  // réglage des notifications : la personne elle-même ou le service RH.
  { action: 'messagerie.regler', droits: '                   O    -    -    -    -    -    -    -    -', p: async () => ({ rh: 'drh@entreprise.example' }) },
  { action: 'messagerie.essai', droits: '                    O    -    -    -    -    -    -    -    -', p: async () => ({ adresse: 'it@entreprise.example' }) },
  { action: 'messagerie.recapituler', droits: '              O    O    -    -    -    -    -    -    -', p: async () => {
    await db.insert('notifications', { empId: 12, adresse: 'karim.haddad@entreprise.example', type: 'temps.soumise', objet: 'Feuille à valider', texte: '—', creation: '2026-10-07T06:00:00.000Z', envoiId: null });
    return {};
  } },
  // Page Confidentialité : coordonnées du responsable et du DPO (administrateur RH).
  { action: 'confidentialite.regler', droits: '              O    -    -    -    -    -    -    -    -', p: async () => ({ responsable: 'Entreprise, 1 rue du Site, Feyzin', dpo: 'dpo@entreprise.example' }) },
  { action: 'notification.regler', droits: '                 O    O    -    -    O    -    -    -    -', p: async () => ({ empId: 2, mode: 'quotidien' }) },
  // Envois sortants (Paramètres → Envois) : le service RH suit, relance (intégration configurée) ou classe un échec.
  { action: 'envoi.relancer', droits: '                      O    O    -    -    -    -    -    -    -', p: async () => ({ id: await envoiEnEchec() }), env: { KEYSTONE_URL: 'http://keystone.essai', KEYSTONE_TOKEN: 'jeton' } },
  { action: 'envoi.classer', droits: '                       O    O    -    -    -    -    -    -    -', p: async () => ({ id: await envoiEnEchec() }) },
  // Pièces justificatives (t133) : attestation et titre signé, service RH et référent HSE ; justificatif d'absence et document
  // déclaré, l'intéressé et le service RH, jamais le manager (santé, passeport) ; déplacement, service RH.
  { action: 'piece.joindre', variante: 'certification', droits: '  O    O    -    -    -    -    O    -    -', p: async u => await ({ jetons: [await pieceEnvoyee(u)], objet: 'certification', objetId: await cert('sst') }) },
  { action: 'piece.joindre', variante: 'titre d’habilitation', droits: 'O    O    -    -    -    -    O    -    -', p: async u => await ({ jeton: await pieceEnvoyee(u), objet: 'habTitre', objetId: (await titre('hauteur')).id }) },
  { action: 'piece.joindre', variante: 'absence', droits: '        O    O    -    -    O    -    -    -    -', p: async u => await ({ jetons: [await pieceEnvoyee(u)], objet: 'absence', objetId: await absence('signalee', 'ABSENCE') }) },
  { action: 'piece.joindre', variante: 'document déclaré', droits: 'O    O    -    -    O    -    -    -    -', p: async u => await ({ jetons: [await pieceEnvoyee(u)], objet: 'declaration', objetId: await documentDeclare() }) },
  { action: 'piece.joindre', variante: 'déplacement', droits: '    O    O    -    -    -    -    -    -    -', p: async u => await ({ jetons: [await pieceEnvoyee(u)], objet: 'voyage', objetId: await voyage() }) },
  { action: 'piece.retirer', variante: 'certification', droits: '  O    O    -    -    -    -    O    -    -', p: async () => ({ id: await pieceJointe('certification', await cert('sst')), motif: 'Mauvais document' }) },
  { action: 'piece.retirer', variante: 'absence', droits: '        O    O    -    -    -    -    -    -    -', p: async () => ({ id: await pieceJointe('absence', await absence('signalee', 'ABSENCE')), motif: 'Mauvais document' }) },
  // Conservation des dossiers (t016) : effacement irréversible, administrateur RH seul ; Mehdi sorti il y a longtemps (dossier
  // échu, fonction activée avec la décision du DPO) ou récemment (droit à l'effacement exercé avant l'échéance).
  { action: 'employe.anonymiser', variante: 'dossier échu', droits: '   O    -    -    -    -    -    -    -    -', p: async () => ({ ids: [await sortiLe('2019-01-31')], motif: 'Durées validées par le DPO' }) },
  { action: 'employe.anonymiser', variante: 'avant l’échéance', droits: 'O    -    -    -    -    -    -    -    -', p: async () => ({ ids: [await sortiLe('2026-01-31')], motif: 'Demande du salarié', avantEcheance: true }) },
  // Agenda personnel (t036) : le salarié pour lui-même, depuis son espace (collaborateur ou manager) ; révocation de tous
  // les abonnements, administrateur RH.
  { action: 'agenda.creerJeton', droits: '                       -    -    O    O    O    O    -    -    -', p: async () => { await reglages({ agendaFluxActif: true }); return {}; } },
  { action: 'agenda.revoquerJeton', droits: '                    -    -    O    O    O    O    -    -    -', p: () => ({}) },
  { action: 'agenda.revoquerTout', droits: '                     O    -    -    -    -    -    -    -    -', p: () => ({}) },
  // Astreintes (t049, lot 7) : planning par le manager direct ou le service RH (jamais pour soi-même) ; interventions
  // déclarées sur la feuille de temps comme la saisie d'heures (salarié, manager direct, service RH).
  { action: 'astreinte.planifier', droits: '              O    O    O    -    -    -    -    -    -', p: () => ({ empId: 2, du: '2026-11-06', debut: '18:00', au: '2026-11-13', fin: '08:00' }) },
  { action: 'astreinte.planifier', variante: 'astreinte du gestionnaire RH', droits: 'O    -    -    -    -    -    -    -    -', p: () => ({ empId: 14, du: '2026-11-06', debut: '18:00', au: '2026-11-13', fin: '08:00' }) },
  { action: 'astreinte.modifier', droits: '               O    O    O    -    -    -    -    -    -', p: async () => ({ id: await astreinte('2026-11-06', '2026-11-13'), au: '2026-11-12' }) },
  { action: 'astreinte.annuler', droits: '                O    O    O    -    -    -    -    -    -', p: async () => ({ id: await astreinte('2026-11-06', '2026-11-13'), motif: 'Arrêt technique reporté' }) },
  { action: 'astreinte.intervention', droits: '           O    O    O    -    O    -    -    -    -', p: async () => ({ astreinteId: await astreinte('2026-10-05', '2026-10-07'), jour: '2026-10-05', debut: '22:00', fin: '23:30' }) },
  // Astreinte d'un autre salarié (Thomas) : Mehdi reçoit le même refus qu'un identifiant inconnu, avant tout contrôle.
  { action: 'astreinte.intervention', variante: 'astreinte de Thomas', droits: 'O    O    O    -    -    O    -    -    -', p: async () => ({ astreinteId: await astreinte('2026-10-05', '2026-10-07', 6), jour: '2026-10-05', debut: '22:00', fin: '23:30' }) },
  { action: 'astreinte.retirerIntervention', droits: '    O    O    O    -    O    -    -    -    -', p: async () => ({ id: await intervention() }) },
];

const ANNULER = Symbol('annuler');
/** Exécute l'action dans une transaction toujours annulée : « O », « - » (refus 403), ou l'erreur inattendue. */
async function essai(user: User, l: Ligne): Promise<string> {
  let issue = '';
  const avant = Object.fromEntries(Object.keys(l.env ?? {}).map(k => [k, process.env[k]]));
  Object.assign(process.env, l.env ?? {});
  try {
    await db.tx(async () => {
      const payload = await l.p(user);
      try {
        await ACTIONS[l.action](makeCtx(db, user, await loadFull(db, user)), payload);
        issue = 'O';
      } catch (e) {
        issue = e instanceof ActionError && e.status === 403 ? '-' : `erreur : ${e instanceof Error ? e.message : e}`;
      }
      throw ANNULER;
    });
  } catch (e) {
    if (e !== ANNULER) throw e;
  } finally {
    // Variables d'environnement propres à la ligne : remises dans leur état d'origine.
    for (const [k, v] of Object.entries(avant)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  return issue;
}

test('matrice des droits : chaque action exportée a sa ligne', () => {
  const couvertes = new Set(MATRICE.map(l => l.action));
  const sansLigne = Object.keys(ACTIONS).filter(a => !couvertes.has(a));
  assert.deepEqual(sansLigne, [], 'action sans ligne dans la matrice des droits (tests/droits.test.ts)');
  const inconnues = [...couvertes].filter(a => !ACTIONS[a]);
  assert.deepEqual(inconnues, [], 'ligne pour une action qui n’existe plus');
  for (const l of MATRICE) assert.equal(l.droits.trim().split(/\s+/).length, PROFILS.length, `${l.action} : un résultat par profil`);
});

test('matrice des droits : action × profil', async () => {
  const ecarts: string[] = [];
  for (const l of MATRICE) {
    const attendus = l.droits.trim().split(/\s+/);
    for (const [i, [nom, user]] of PROFILS.entries()) {
      const obtenu = await essai(user, l);
      if (obtenu !== attendus[i]) ecarts.push(`${l.action}${l.variante ? ` (${l.variante})` : ''} × ${nom} : attendu ${attendus[i]}, obtenu ${obtenu}`);
    }
  }
  assert.deepEqual(ecarts, []);
});
