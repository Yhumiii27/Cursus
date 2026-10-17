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

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { PROFIL_VIDE } = await import('../shared/rules/profil.ts');
const { SAMPLE_PLAN_CSV, SAMPLE_TRIPS_CSV } = await import('../shared/rules/imports.ts');
type Db = InstanceType<typeof Db>;
type User = NonNullable<ReturnType<typeof currentUser>>;
type Role = User['role'];

const db = new Db(':memory:');
seedDemo(db);

const compteDe = (empId: number | null) => db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
  .get(...(empId ? [empId] : [])) as { id: number };
function personne(empId: number | null, role: Role): User {
  const u = currentUser(db, { compteId: compteDe(empId).id, role, methode: 'demo' });
  assert.ok(u, `compte de démonstration ${empId} dans l’espace ${role}`);
  return u;
}
const PROFILS: [string, User][] = [
  ['admin', personne(null, 'rh')],
  ['gest', personne(14, 'rh')],
  ['mgr', personne(12, 'manager')],
  ['autM', personne(16, 'manager')],
  ['coll', personne(2, 'collaborateur')],
  ['autC', personne(6, 'collaborateur')],
  ['hse', personne(23, 'rh')],
  ['paie', personne(7, 'rh')],
  ['lect', personne(11, 'rh')],
];

const WEEK = '2026-10-12';
const H0 = [0, 0, 0, 0, 0, 0, 0], H7 = [7, 7, 7, 7, 7, 0, 0];
/** Feuille de Mehdi pour la semaine 42, dans l'état voulu. */
const feuille = (statut: string, h = H0) => db.insert('feuilles', {
  empId: 2, week: WEEK, statut, comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-MAINT', tache: 'Maintenance interne', ks: false, h }],
});
const demande = (h: string) => db.insert<{ id: number }>('demandesCollab', {
  empId: 2, type: 'habilitation', f: null, h, libelle: null, label: null, sessionId: null, motif: 'Chantier', date: '2026-10-06', statut: 'attente', reponse: null, parId: null,
}).id;
const titre = (h: string) => db.sql.prepare('SELECT id FROM hab_titres WHERE emp_id = 2 AND h = ?').get(h) as { id: number };
const cert = (f: string) => (db.sql.prepare('SELECT id FROM certifications WHERE emp_id = 2 AND f = ?').get(f) as { id: number }).id;
/** Poste du référentiel créé depuis les fiches de démonstration. */
const posteNomme = (nom: string) => (db.sql.prepare('SELECT id FROM postes WHERE nom = ?').get(nom) as { id: number }).id;
const ENTRETIEN = () => (db.sql.prepare(`SELECT id FROM entretiens WHERE emp_id = 2 AND statut = 'planifie'`).get() as { id: number }).id;

/** Absence de Mehdi le 15 décembre, dans l'état voulu (signalée par son manager, ou validée). */
const absence = (statut: string, type: string) => db.insert<{ id: number }>('absences', {
  empId: 2, type, du: '2026-12-15', au: '2026-12-15', statut, keystone: true, justificatif: false,
  ...(statut === 'signalee' ? { signaleLe: '2026-10-07', signalePar: 'Karim Haddad', signaleParInteresse: false } : {}),
}).id;
/** Passeport déclaré par Mehdi depuis son espace, en attente de validation par le service RH. */
const documentDeclare = () => db.insert<{ id: number }>('demandesCollab', {
  empId: 2, type: 'document', f: null, h: null, libelle: null, label: 'Passeport', sessionId: null, motif: null, date: '2026-10-06', statut: 'attente',
  reponse: null, parId: null, declaration: { kind: 'passeport', numero: '21XY12345', expire: '2032-01-01' },
}).id;
// Antoine Leroy, gestionnaire RH, est aussi salarié (14) ; il encadre l'Administration : son valideur est le service RH.
/** Demande de CP d'Antoine Leroy, en attente. */
const demandeAntoine = () => db.insert<{ id: number }>('absences', { empId: 14, type: 'CP', du: '2026-12-07', au: '2026-12-07', statut: 'demandee', keystone: false, justificatif: false }).id;
/** Lot de paie de simulation généré (import à confirmer), sans feuille. */
const lotGenere = () => db.insert<{ id: number }>('lotsPaie', {
  cle: 'essai-droits', mode: 'simulation', statut: 'genere', periode: '2026-10', periodes: ['2026-10'], rappels: [], creation: '2026-10-07T08:00:00.000Z', auteur: 'Essai',
  feuilles: [], resume: { lignes: 0, salaries: 0, rubriques: {} }, sansMatricule: [], contenu: { endpoint: '', dossier: 'X', envoye_le: '', lignes: [] }, telechargements: 0, historique: false,
}).id;
/** Feuille d'Antoine Leroy soumise pour la semaine 42. */
const feuilleAntoine = () => db.insert('feuilles', {
  empId: 14, week: WEEK, statut: 'soumise', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-ADM', tache: 'Fonctions support', ks: false, h: H7 }],
});
/** Déplacement de Mehdi à Tanger, sans formalité de détachement. */
const voyage = () => db.insert<{ id: number }>('voyages', {
  empId: 2, dest: 'MA', depart: '2026-11-02', retour: '2026-11-06', motif: 'Chantier Tanger', origine: 'cursus', ref: null, chantier: null,
}).id;
/** Envoi vers Keystone en échec définitif, à relancer ou classer. */
const envoiEnEchec = () => db.insert<{ id: number }>('envois', {
  cible: 'keystone', type: 'heures.validees', cle: 'essai-droits', contenu: {}, statut: 'echec', tentatives: 1, prochaine: null,
  erreur: 'HTTP 400', accuse: null, creation: '2026-10-07T08:00:00.000Z', tentative: '2026-10-07T08:00:00.000Z', envoi: null, classe: null,
}).id;
interface Ligne { action: string; variante?: string; droits: string; p: () => Record<string, unknown>; env?: Record<string, string> }

//                                                        admin gest mgr autM coll autC  hse paie lect
const MATRICE: Ligne[] = [
  // Fiches et équipes
  { action: 'employe.creer', droits: '                       O    O    -    -    -    -    -    -    -', p: () => ({ ...PROFIL_VIDE('Maintenance', '2026-10-07'), nom: 'Nouvel Embauché', poste: 'Technicien' }) },
  { action: 'employe.modifier', droits: '                    O    O    O    -    -    -    -    -    -', p: () => ({ id: 2, poste: 'Technicien de maintenance confirmé' }) },
  // Sortie d'un salarié (date et motif) et son annulation : service RH.
  { action: 'employe.sortie', droits: '                      O    O    -    -    -    -    -    -    -', p: () => ({ id: 2, date: '2026-12-31', motif: 'demission' }) },
  { action: 'employe.annulerSortie', droits: '               O    O    -    -    -    -    -    -    -', p: () => {
    db.update('employes', 2, { fin: '2026-12-31', motifSortie: 'demission', finPrevue: null });
    return { id: 2 };
  } },
  // Titre de séjour valant autorisation de travail (numéro au registre unique du personnel) : service RH.
  { action: 'employe.autorisationTravail', droits: '         O    O    -    -    -    -    -    -    -', p: () => ({ id: 2, requise: true, type: 'salarie', numero: 'AB1234567', expire: '2027-06-30', verifieLe: '2016-08-26' }) },
  { action: 'equipe.creer', droits: '                        O    O    -    -    -    -    -    -    -', p: () => ({ nom: 'Méthodes' }) },
  { action: 'equipe.renommer', droits: '                     O    O    -    -    -    -    -    -    -', p: () => ({ nom: 'Commercial', nouveau: 'Ventes' }) },
  { action: 'equipe.manager', droits: '                      O    O    -    -    -    -    -    -    -', p: () => ({ nom: 'Commercial', managerId: 19 }) },
  { action: 'equipe.supprimer', droits: '                    O    -    -    -    -    -    -    -    -', p: () => { db.insert('equipes', { nom: 'Vide', managerId: null, ordre: 99 }); return { nom: 'Vide' }; } },
  { action: 'equipe.affecter', variante: 'retrait', droits: 'O    O    O    -    -    -    -    -    -', p: () => ({ empId: 2, equipe: null }) },
  // Le manager n'accueille qu'un salarié « à affecter » (libéré par son manager) ; une mutation directe relève du RH.
  { action: 'equipe.affecter', variante: 'salarié à affecter', droits: 'O    O    O    -    -    -    -    -    -', p: () => {
    db.update('employes', 20, { equipe: null });
    return { empId: 20, equipe: 'Maintenance' };
  } },
  { action: 'equipe.affecter', variante: 'membre d’une autre équipe', droits: 'O    O    -    -    -    -    -    -    -', p: () => ({ empId: 20, equipe: 'Maintenance' }) },
  // Formations, certifications, habilitations
  { action: 'plan.inscrire', droits: '                       O    O    O    -    -    -    O    -    -', p: () => ({ empId: 2, certId: cert('sst'), sessionId: 2, conv: 'now' }) },
  // Convocations (e-mail avec .ics) et désinscription : service RH, référent HSE / formation ou manager direct.
  { action: 'convocation.envoyer', droits: '                 O    O    O    -    -    -    O    -    -', p: () => {
    db.update('certifications', cert('sst'), { sessionId: 2, convoc: 'later' });
    return { sessionId: 2, empIds: [2] };
  } },
  { action: 'plan.desinscrire', droits: '                    O    O    O    -    -    -    O    -    -', p: () => {
    db.update('certifications', cert('sst'), { sessionId: 2, convoc: 'now' });
    return { empId: 2, sessionId: 2 };
  } },
  { action: 'cert.ajouter', droits: '                        O    O    -    -    -    -    O    -    -', p: () => ({ empId: 2, f: 'sst', date: '2026-10-01' }) },
  { action: 'session.creer', droits: '                       O    O    -    -    -    -    O    -    -', p: () => ({ f: 'sst', date: '2026-12-01', lieu: 'Site de Lyon', places: 8 }) },
  // Sessions : cycle de vie et clôture par le service RH (session 2 : SST du 18 novembre, à confirmer).
  { action: 'session.confirmer', droits: '                   O    O    -    -    -    -    O    -    -', p: () => ({ id: 2 }) },
  { action: 'session.modifier', droits: '                    O    O    -    -    -    -    O    -    -', p: () => ({ id: 2, lieu: 'Site de Lyon — salle C' }) },
  { action: 'session.annuler', droits: '                     O    O    -    -    -    -    O    -    -', p: () => ({ id: 2, motif: 'Organisme indisponible' }) },
  { action: 'session.cloturer', droits: '                    O    O    -    -    -    -    O    -    -', p: () => ({
    id: db.insert<{ id: number }>('sessions', { formation: 'sst', date: '2026-10-01', lieu: 'Site de Lyon', places: 8, statut: 'Confirmée', planId: null, bilan: null }).id,
    participants: [],
  }) },
  { action: 'hab.delivrer', droits: '                        O    O    -    -    -    -    O    -    -', p: () => ({ empId: 2, h: 'hauteur', date: '2026-10-07', par: 'Sarah Cohen', mode: 'renew' }) },
  { action: 'hab.suspendre', droits: '                       O    O    O    -    -    -    O    -    -', p: () => ({ empId: 2, h: 'hauteur', motif: 'Incident sur passerelle' }) },
  { action: 'hab.lever', droits: '                           O    O    -    -    -    -    O    -    -', p: () => {
    db.update('habTitres', titre('hauteur').id, { mesure: 'suspension', mesureDate: '2026-10-05', mesureMotif: 'Incident', mesurePar: 'Karim Haddad' });
    return { empId: 2, h: 'hauteur' };
  } },
  { action: 'hab.retirer', droits: '                         O    O    -    -    -    -    O    -    -', p: () => ({ empId: 2, h: 'hauteur', motif: 'Restriction médicale' }) },
  // Santé au travail : demandes de visite et avis du médecin du travail, données de santé réservées au service RH.
  { action: 'medical.demander', droits: '                    O    O    -    -    -    -    -    -    -', p: () => ({ empId: 2 }) },
  { action: 'medical.annuler', droits: '                     O    O    -    -    -    -    -    -    -', p: () => ({
    id: db.insert<{ id: number }>('demandesVisite', { empId: 2, motif: 'periodique', le: '2026-10-05', par: 'Sandrine Vidal', statut: 'demandee', closeLe: null, closePar: null }).id,
  }) },
  { action: 'medical.avis', droits: '                        O    O    -    -    -    -    -    -    -', p: () => ({
    empId: 2, date: '2026-10-06', avis: 'restrictions', restrictions: [{ texte: 'Pas de travail en hauteur', jusquau: '2026-12-31' }], suspendre: ['hauteur'],
  }) },
  { action: 'demande.accepter', droits: '                    O    O    -    -    -    -    O    -    -', p: () => ({ id: demande('aipr') }) },
  { action: 'demande.refuser', droits: '                     O    O    -    -    -    -    O    -    -', p: () => ({ id: demande('aipr') }) },
  // Document déclaré (passeport, visa, vaccination) : service RH seulement.
  { action: 'demande.accepter', variante: 'document', droits: 'O    O    -    -    -    -    -    -    -', p: () => ({ id: documentDeclare() }) },
  { action: 'demande.refuser', variante: 'document', droits: ' O    O    -    -    -    -    -    -    -', p: () => ({ id: documentDeclare() }) },
  // Le collaborateur demande pour lui-même (l'autre collaborateur aussi, pour lui) ; le manager pour un membre de son équipe.
  { action: 'demande.formation', droits: '                   -    -    O    -    O    O    -    -    -', p: () => ({ f: 'autre', libelle: 'Lean management', motif: 'Évolution', empId: 2 }) },
  { action: 'demande.habilitation', droits: '                -    -    O    -    O    O    -    -    -', p: () => ({ h: 'aipr', motif: 'Chantier réseaux', empId: 2 }) },
  // Référentiels : formations et habilitations (service RH, référent HSE / formation), destinations (service RH).
  { action: 'referentiel.formation.enregistrer', droits: '   O    O    -    -    -    -    O    -    -', p: () => ({
    id: 'sst', nom: 'Sauveteur secouriste du travail (SST)', court: 'SST', type: 'Réglementaire', validite: 24, duree: '7 h (MAC)', organisme: 'Croix-Rouge française', cout: 190, validation: 'evaluation',
  }) },
  { action: 'referentiel.formation.enregistrer', variante: 'création', droits: 'O    O    -    -    -    -    O    -    -', p: () => ({
    code: 'caces485', nom: 'CACES R485 — Gerbeurs à conducteur accompagnant', court: 'CACES R485', type: 'Réglementaire', validite: 60, duree: '14 h', organisme: 'AFTRAL', cout: 450, validation: 'evaluation',
  }) },
  // Formation AIPR : prérequis de l'habilitation AIPR, archivée d'abord.
  { action: 'referentiel.formation.archiver', droits: '      O    O    -    -    -    -    O    -    -', p: () => {
    db.update('habilitations', 'aipr', { archive: '2026-10-07' });
    return { id: 'aipr' };
  } },
  { action: 'referentiel.habilitation.enregistrer', droits: 'O    O    -    -    -    -    O    -    -', p: () => ({
    id: 'aipr', nom: 'Autorisation AIPR', detail: 'Intervention à proximité des réseaux', prereqs: ['aipr'], medical: false, validite: 60, signataire: 'Karim Haddad',
  }) },
  { action: 'referentiel.habilitation.archiver', droits: '   O    O    -    -    -    -    O    -    -', p: () => ({ id: 'aipr' }) },
  { action: 'referentiel.destination.enregistrer', droits: ' O    O    -    -    -    -    -    -    -', p: () => ({
    id: 'MA', pays: 'Maroc', visa: 'none', visaSub: 'séjour ≤ 90 jours', oblig: [], rec: ['hepA', 'typhoide'], passMois: 3, secu: 'convention',
  }) },
  { action: 'referentiel.destination.archiver', droits: '    O    O    -    -    -    -    -    -    -', p: () => ({ id: 'VN' }) },
  // Référentiel type : dans un référentiel vide seulement (vidé pour l'essai, transaction annulée).
  { action: 'referentiel.charger', variante: 'formations', droits: 'O    O    -    -    -    -    O    -    -', p: () => {
    db.sql.exec('DELETE FROM formations');
    return { referentiel: 'formations' };
  } },
  { action: 'referentiel.charger', variante: 'habilitations', droits: 'O    O    -    -    -    -    O    -    -', p: () => {
    db.sql.exec('DELETE FROM habilitations');
    return { referentiel: 'habilitations' };
  } },
  { action: 'referentiel.charger', variante: 'destinations', droits: 'O    O    -    -    -    -    -    -    -', p: () => {
    db.sql.exec('DELETE FROM destinations');
    return { referentiel: 'destinations' };
  } },
  // Postes et exigences (t055) : service RH ; habilitation exigée demandée : service RH et référent HSE.
  { action: 'referentiel.poste.enregistrer', droits: '     O    O    -    -    -    -    -    -    -', p: () => ({
    id: posteNomme('Technicien de maintenance'), nom: 'Technicien de maintenance', formations: ['elec', 'sst'], habilitations: ['he'],
  }) },
  { action: 'referentiel.poste.enregistrer', variante: 'création', droits: 'O    O    -    -    -    -    -    -    -', p: () => ({ nom: 'Soudeur', formations: [], habilitations: [] }) },
  { action: 'referentiel.poste.archiver', droits: '        O    O    -    -    -    -    -    -    -', p: () => ({
    id: db.insert<{ id: number }>('postes', { nom: 'Poste inoccupé', formations: [], habilitations: [], archive: null }).id,
  }) },
  { action: 'referentiel.equipe.exigences', droits: '      O    O    -    -    -    -    -    -    -', p: () => ({ nom: 'Maintenance', formations: ['sst'], habilitations: [] }) },
  { action: 'hab.demander', droits: '                      O    O    -    -    -    -    O    -    -', p: () => ({ empId: 2, h: 'atex' }) },
  // Déplacements
  { action: 'voyage.creer', droits: '                        O    O    -    -    -    -    -    -    -', p: () => ({ empId: 2, dest: 'MA', depart: '2026-11-02', retour: '2026-11-06', motif: 'Chantier Tanger' }) },
  // Formalités de détachement (certificat de sécurité sociale, information écrite) : démarches du service RH.
  { action: 'voyage.detachement', droits: '                  O    O    -    -    -    -    -    -    -', p: () => ({ id: voyage(), detachementLe: '2026-10-06' }) },
  // Modification et annulation d'un déplacement : service RH (Keystone prévenu pour un déplacement venu de Keystone).
  { action: 'voyage.modifier', droits: '                 O    O    -    -    -    -    -    -    -', p: () => ({ id: voyage(), depart: '2026-11-03', retour: '2026-11-06' }) },
  { action: 'voyage.annuler', droits: '                  O    O    -    -    -    -    -    -    -', p: () => ({ id: voyage(), motif: 'Chantier reporté' }) },
  { action: 'formalite.enregistrer', droits: '               O    O    -    -    O    -    -    -    -', p: () => ({ empId: 2, kind: 'passeport', numero: '21XY12345', expire: '2032-01-01' }) },
  { action: 'voyages.importer', droits: '                    O    O    -    -    -    -    -    -    -', p: () => ({ texte: SAMPLE_TRIPS_CSV }) },
  { action: 'keystone.accepter', droits: '                   O    O    -    -    -    -    -    -    -', p: () => ({ id: 1 }) },
  { action: 'keystone.refuser', droits: '                    O    O    -    -    -    -    -    -    -', p: () => ({ id: 1 }) },
  // Plan et budget : remplacer les lignes prévues les supprime (administrateur RH).
  { action: 'plan.importer', variante: 'compléter', droits: 'O    O    -    -    -    -    -    -    -', p: () => ({ texte: SAMPLE_PLAN_CSV, exercice: 2027, mode: 'add' }) },
  { action: 'plan.importer', variante: 'remplacer', droits: 'O    -    -    -    -    -    -    -    -', p: () => ({ texte: SAMPLE_PLAN_CSV, exercice: 2026, mode: 'replace' }) },
  { action: 'budget.enveloppes', droits: '                   O    O    -    -    -    -    -    -    -', p: () => ({ exercice: 2027, enveloppes: { Maintenance: 5000 } }) },
  { action: 'plan.avancer', droits: '                        O    O    -    -    -    -    -    -    -', p: () => ({ id: (db.sql.prepare(`SELECT id FROM plan_actions WHERE statut <> 'realise' LIMIT 1`).get() as { id: number }).id, coutReel: 1000 }) },
  // Clôture de l'exercice 2026 (administrateur RH), une fois passé, avec le report d'une action engagée sur 2027.
  { action: 'plan.cloturerExercice', droits: '               O    -    -    -    -    -    -    -    -', env: { CURSUS_TODAY: '2027-01-05' }, p: () => ({ exercice: 2026, reporter: [(db.sql.prepare(`SELECT id FROM plan_actions WHERE statut = 'engage' LIMIT 1`).get() as { id: number }).id] }) },
  // Feuilles de temps : saisie par le salarié, son manager ou le RH ; validation par le manager ou le RH ; paie : administrateur RH.
  { action: 'temps.setCell', droits: '                       O    O    O    -    O    -    -    -    -', p: () => { feuille('brouillon'); return { empId: 2, week: WEEK, li: 0, di: 0, value: '7' }; } },
  { action: 'temps.addLine', droits: '                       O    O    O    -    O    -    -    -    -', p: () => ({ empId: 2, week: WEEK, projet: 'INT-MAINT' }) },
  { action: 'temps.removeLine', droits: '                    O    O    O    -    O    -    -    -    -', p: () => { feuille('brouillon'); return { empId: 2, week: WEEK, li: 0 }; } },
  { action: 'temps.suggest', droits: '                       O    O    O    -    O    -    -    -    -', p: () => ({ empId: 2, week: WEEK }) },
  { action: 'temps.submit', droits: '                        O    O    O    -    O    -    -    -    -', p: () => { feuille('brouillon', H7); return { empId: 2, week: WEEK }; } },
  { action: 'temps.validate', droits: '                      O    O    O    -    -    -    -    -    -', p: () => { feuille('soumise', H7); return { empId: 2, week: WEEK }; } },
  { action: 'temps.reject', droits: '                        O    O    O    -    -    -    -    -    -', p: () => { feuille('soumise', H7); return { empId: 2, week: WEEK, comment: 'Projet à corriger' }; } },
  { action: 'temps.pushSage', droits: '                      O    -    -    -    -    -    -    O    -', p: () => ({}) },
  // Correspondance des rubriques avec le plan de paie Sage : administrateur RH et gestionnaire de paie (écran Temps).
  { action: 'paie.rubrique', droits: '                       O    -    -    -    -    -    -    O    -', p: () => ({ code: 'HS25', codeSage: '3010', confirmer: true }) },
  // Lots de paie (écran Temps) : génération, confirmation de l'import, annulation, format du fichier d'import.
  { action: 'paie.lotGenerer', droits: '                     O    -    -    -    -    -    -    O    -', p: () => ({ periode: '2026-10' }) },
  { action: 'paie.lotConfirmer', droits: '                   O    -    -    -    -    -    -    O    -', p: () => ({ id: lotGenere() }) },
  { action: 'paie.lotAnnuler', droits: '                     O    -    -    -    -    -    -    O    -', p: () => ({ id: lotGenere() }) },
  { action: 'paie.formatFichier', droits: '                  O    -    -    -    -    -    -    O    -', p: () => ({ separateur: ',', decimale: '.' }) },
  // Suivi des feuilles : relance et validation groupée par le manager direct ou le service RH (jamais les profils restreints).
  { action: 'temps.relancer', droits: '                      O    O    O    -    -    -    -    -    -', p: () => {
    // Feuille de la semaine 40 renvoyée pour correction, échéance passée : en retard.
    db.sql.exec(`UPDATE feuilles SET statut = 'rejetee' WHERE emp_id = 2 AND week = '2026-09-28'`);
    return { empId: 2 };
  } },
  { action: 'temps.validerLot', droits: '                    O    O    O    -    -    -    -    -    -', p: () => { feuille('soumise', H7); return { feuilles: [{ empId: 2, week: WEEK }] }; } },
  // Semaine à 7 jours : dérogation au repos dominical d'une équipe, réglée par l'administrateur RH (Paramètres).
  { action: 'temps.derogationDominicale', droits: '          O    -    -    -    -    -    -    -    -', p: () => ({ equipe: 'Maintenance', type: 'feu_continu', reference: 'Accord du 12 mars 2024' }) },
  // Activités internes (écran Référentiels) et mandats au CSE (fiche) : service RH.
  { action: 'referentiel.activite.enregistrer', droits: '    O    O    -    -    -    -    -    -    -', p: () => ({ code: 'INT-FORM', nom: 'Formation interne' }) },
  { action: 'referentiel.activite.archiver', droits: '      O    O    -    -    -    -    -    -    -', p: () => ({ id: 'INT-COM' }) },
  { action: 'mandat.enregistrer', droits: '                  O    O    -    -    -    -    -    -    -', p: () => ({ empId: 2, role: 'titulaire', du: '2026-11-01', credit: 21 }) },
  { action: 'mandat.supprimer', droits: '                    O    O    -    -    -    -    -    -    -', p: () => ({ id: db.insert<{ id: number }>('mandats', { empId: 2, role: 'suppleant', du: '2026-01-01', au: null, credit: 0 }).id }) },
  // Un membre du RH ne valide pas sa propre feuille : son valideur (ici le service RH) le fait.
  { action: 'temps.validate', variante: 'feuille du gestionnaire RH', droits: 'O    -    -    -    -    -    -    -    -', p: () => { feuilleAntoine(); return { empId: 14, week: WEEK }; } },
  // Relevé d'heures des intérimaires (Léa Girard, agence Proman Lyon) : service RH ou gestionnaire de paie.
  { action: 'releve.envoyer', droits: '                      O    O    -    -    -    -    -    O    -', p: () => ({ agence: 'Proman Lyon', semaine: '2026-09-21' }) },
  // Congés
  { action: 'absence.demander', droits: '                    O    O    O    -    O    -    -    -    -', p: () => ({ empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' }) },
  { action: 'absence.decider', droits: '                     O    O    O    -    -    -    -    -    -', p: () => ({ id: (db.sql.prepare(`SELECT id FROM absences WHERE emp_id = 2 AND statut = 'demandee'`).get() as { id: number }).id, ok: true }) },
  { action: 'absence.decider', variante: 'demande du gestionnaire RH', droits: 'O    -    -    -    -    -    -    -    -', p: () => ({ id: demandeAntoine(), ok: true }) },
  { action: 'cet.placer', droits: '                          O    O    -    -    O    -    -    -    -', p: () => ({ empId: 2, kind: 'RTT', jours: 1 }) },
  { action: 'report.accorder', droits: '                     O    O    -    -    -    -    -    -    -', p: () => ({ empId: 2, jours: 1, motif: 'Arrêt maladie' }) },
  // Clôture d'une période de congés : service RH (RTT 2025 de Mehdi, compteurs repris arrêtés en 2025 pour l'essai).
  { action: 'conges.cloturer', droits: '                     O    O    -    -    -    -    -    -    -', p: () => {
    db.update('soldesReprise', 2, { arreteLe: '2025-09-01' });
    return { type: 'RTT', periode: 2025 };
  } },
  // Absences hors congés : le salarié ou son manager signale, le RH qualifie ou saisit ; annulation selon le statut.
  { action: 'absence.signaler', droits: '                    O    O    O    -    O    -    -    -    -', p: () => ({ empId: 2, du: '2026-12-15', au: '2026-12-15' }) },
  { action: 'absence.saisir', droits: '                      O    O    -    -    -    -    -    -    -', p: () => ({ empId: 2, nature: 'MARIAGE', du: '2026-12-15', au: '2026-12-16' }) },
  { action: 'absence.qualifier', droits: '                   O    O    -    -    -    -    -    -    -', p: () => ({ id: absence('signalee', 'ABSENCE'), nature: 'MALADIE' }) },
  { action: 'absence.prolonger', droits: '                   O    O    O    -    O    -    -    -    -', p: () => ({ id: absence('validee', 'MALADIE'), au: '2026-12-16' }) },
  { action: 'absence.annuler', droits: '                     O    O    O    -    -    -    -    -    -', p: () => ({ id: absence('validee', 'CP') }) },
  // Entretiens : l'évaluateur (manager direct ou RH) et le salarié pour ses sections et sa signature.
  // Mehdi a déjà un entretien annuel planifié (le 20 octobre) : un entretien de parcours professionnel.
  { action: 'entretien.planifier', droits: '                 O    O    O    -    -    -    -    -    -', p: () => ({ empId: 2, kind: 'epp', date: '2026-11-16' }) },
  // Annulation d'un entretien planifié : l'évaluateur (manager direct) ou le RH ; compte rendu commencé : sur confirmation.
  { action: 'entretien.annuler', droits: '                  O    O    O    -    -    -    -    -    -', p: () => ({ id: ENTRETIEN(), confirmer: true }) },
  { action: 'entretien.modifier', droits: '                  O    O    O    -    O    -    -    -    -', p: () => ({ id: ENTRETIEN(), section: 'avis', value: 'Année riche en chantiers' }) },
  // Entretien prévu le 20 octobre, tenu plus tôt : la clôture porte la date à laquelle il a eu lieu.
  { action: 'entretien.clore', droits: '                     O    O    O    -    -    -    -    -    -', p: () => ({ id: ENTRETIEN(), date: '2026-10-06' }) },
  { action: 'entretien.signer', droits: '                    -    -    -    -    O    -    -    -    -', p: () => {
    const id = ENTRETIEN();
    db.update('entretiens', id, { statut: 'realise', signMgr: '2026-10-07' });
    return { id };
  } },
  // Remise de la copie du compte rendu clos (évaluateur ou RH) ; téléchargement enregistré pour le salarié seul.
  { action: 'entretien.remettre', droits: '                  O    O    O    -    -    -    -    -    -', p: () => {
    const id = ENTRETIEN();
    db.update('entretiens', id, { statut: 'realise', signMgr: '2026-10-07' });
    return { id, mode: 'main_propre', date: '2026-10-07' };
  } },
  { action: 'entretien.telecharger', droits: '               -    -    -    -    O    -    -    -    -', p: () => {
    const id = ENTRETIEN();
    db.update('entretiens', id, { statut: 'realise', signMgr: '2026-10-07' });
    return { id };
  } },
  // Administration : administrateur RH.
  { action: 'parametres.maj', droits: '                      O    -    -    -    -    -    -    -    -', p: () => ({ horizonAlerte: 60 }) },
  { action: 'demo.reinitialiser', droits: '                  O    -    -    -    -    -    -    -    -', p: () => ({}) },
  // Mise en service (reprise depuis Lucca) : administrateur RH seul, quel que soit l'import.
  { action: 'reprise.importer', droits: '                    O    -    -    -    -    -    -    -    -', p: () => ({
    type: 'soldes', texte: 'Nom;CP N-1\nMehdi Benali;10', colonnes: ['nom', 'cpN1'], dateReprise: '2026-10-01',
  }) },
  { action: 'compte.creer', droits: '                        O    -    -    -    -    -    -    -    -', p: () => ({ type: 'microsoft', identifiant: 'paie@cabinet.example', nom: 'Cabinet Paie', profilRh: 'rh_gestionnaire' }) },
  { action: 'compte.profil', droits: '                       O    -    -    -    -    -    -    -    -', p: () => ({ id: compteDe(2).id, profilRh: 'rh_gestionnaire' }) },
  // Compte externe de Sandrine Vidal rattaché à une fiche sans compte (celui d'Inès Dupont, retiré pour l'essai).
  { action: 'compte.rattacher', droits: '                    O    -    -    -    -    -    -    -    -', p: () => {
    db.sql.prepare('DELETE FROM comptes WHERE emp_id = 5').run();
    return { id: compteDe(null).id, empId: 5 };
  } },
  { action: 'compte.activer', droits: '                      O    -    -    -    -    -    -    -    -', p: () => ({ id: compteDe(1).id, actif: false }) },
  { action: 'compte.reinitialiser', droits: '                O    -    -    -    -    -    -    -    -', p: () => ({ id: compteDe(1).id }) },
  // Messagerie : adresses et e-mail d'essai (administrateur RH), récapitulatif sans attendre (RH) ;
  // réglage des notifications : la personne elle-même ou le service RH.
  { action: 'messagerie.regler', droits: '                   O    -    -    -    -    -    -    -    -', p: () => ({ rh: 'drh@entreprise.example' }) },
  { action: 'messagerie.essai', droits: '                    O    -    -    -    -    -    -    -    -', p: () => ({ adresse: 'it@entreprise.example' }) },
  { action: 'messagerie.recapituler', droits: '              O    O    -    -    -    -    -    -    -', p: () => {
    db.insert('notifications', { empId: 12, adresse: 'karim.haddad@entreprise.example', type: 'temps.soumise', objet: 'Feuille à valider', texte: '—', creation: '2026-10-07T06:00:00.000Z', envoiId: null });
    return {};
  } },
  // Page Confidentialité : coordonnées du responsable et du DPO (administrateur RH).
  { action: 'confidentialite.regler', droits: '              O    -    -    -    -    -    -    -    -', p: () => ({ responsable: 'Entreprise, 1 rue du Site, Feyzin', dpo: 'dpo@entreprise.example' }) },
  { action: 'notification.regler', droits: '                 O    O    -    -    O    -    -    -    -', p: () => ({ empId: 2, mode: 'quotidien' }) },
  // Envois sortants (Paramètres → Envois) : le service RH suit, relance (intégration configurée) ou classe un échec.
  { action: 'envoi.relancer', droits: '                      O    O    -    -    -    -    -    -    -', p: () => ({ id: envoiEnEchec() }), env: { KEYSTONE_URL: 'http://keystone.essai', KEYSTONE_TOKEN: 'jeton' } },
  { action: 'envoi.classer', droits: '                       O    O    -    -    -    -    -    -    -', p: () => ({ id: envoiEnEchec() }) },
];

const ANNULER = Symbol('annuler');
/** Exécute l'action dans une transaction toujours annulée : « O », « - » (refus 403), ou l'erreur inattendue. */
function essai(user: User, l: Ligne): string {
  let issue = '';
  const avant = Object.fromEntries(Object.keys(l.env ?? {}).map(k => [k, process.env[k]]));
  Object.assign(process.env, l.env ?? {});
  try {
    db.tx(() => {
      const payload = l.p();
      try {
        ACTIONS[l.action](makeCtx(db, user, loadFull(db, user)), payload);
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

test('matrice des droits : action × profil', () => {
  const ecarts: string[] = [];
  for (const l of MATRICE) {
    const attendus = l.droits.trim().split(/\s+/);
    PROFILS.forEach(([nom, user], i) => {
      const obtenu = essai(user, l);
      if (obtenu !== attendus[i]) ecarts.push(`${l.action}${l.variante ? ` (${l.variante})` : ''} × ${nom} : attendu ${attendus[i]}, obtenu ${obtenu}`);
    });
  }
  assert.deepEqual(ecarts, []);
});
