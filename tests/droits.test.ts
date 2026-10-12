// Matrice des droits : chaque action exportée par server/src/actions × six profils, avec le résultat
// attendu (autorisé / refusé). Une action sans ligne fait échouer le test : toute nouvelle action
// doit déclarer ici qui peut l'exécuter. Chaque cas s'exécute dans une transaction annulée ensuite,
// sur le jeu de démonstration, avec les personnes construites depuis leurs comptes :
//   admin  Sandrine Vidal, administratrice RH        gest   Antoine Leroy, gestionnaire RH
//   mgr    Karim Haddad, manager de la Maintenance    autM   Hugo Lambert, manager de la Logistique
//   coll   Mehdi Benali (Maintenance), concerné       autC   Thomas Garnier (Maintenance), autre collaborateur
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
];

const WEEK = '2026-10-12';
const H0 = [0, 0, 0, 0, 0], H7 = [7, 7, 7, 7, 7];
/** Feuille de Mehdi pour la semaine 42, dans l'état voulu. */
const feuille = (statut: string, h = H0) => db.insert('feuilles', {
  empId: 2, week: WEEK, statut, comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-MAINT', tache: 'Maintenance interne', ks: false, h }],
});
const demande = (h: string) => db.insert<{ id: number }>('demandesCollab', {
  empId: 2, type: 'habilitation', f: null, h, libelle: null, label: null, sessionId: null, motif: 'Chantier', date: '2026-10-06', statut: 'attente', reponse: null, parId: null,
}).id;
const titre = (h: string) => db.sql.prepare('SELECT id FROM hab_titres WHERE emp_id = 2 AND h = ?').get(h) as { id: number };
const cert = (f: string) => (db.sql.prepare('SELECT id FROM certifications WHERE emp_id = 2 AND f = ?').get(f) as { id: number }).id;
const ENTRETIEN = () => (db.sql.prepare(`SELECT id FROM entretiens WHERE emp_id = 2 AND statut = 'planifie'`).get() as { id: number }).id;

/** Envoi vers Keystone en échec définitif, à relancer ou classer. */
const envoiEnEchec = () => db.insert<{ id: number }>('envois', {
  cible: 'keystone', type: 'heures.validees', cle: 'essai-droits', contenu: {}, statut: 'echec', tentatives: 1, prochaine: null,
  erreur: 'HTTP 400', accuse: null, creation: '2026-10-07T08:00:00.000Z', tentative: '2026-10-07T08:00:00.000Z', envoi: null, classe: null,
}).id;
interface Ligne { action: string; variante?: string; droits: string; p: () => Record<string, unknown>; env?: Record<string, string> }

//                                                        admin gest mgr autM coll autC
const MATRICE: Ligne[] = [
  // Fiches et équipes
  { action: 'employe.creer', droits: '                       O    O    -    -    -    -', p: () => ({ ...PROFIL_VIDE('Maintenance', '2026-10-07'), nom: 'Nouvel Embauché', poste: 'Technicien' }) },
  { action: 'employe.modifier', droits: '                    O    O    O    -    -    -', p: () => ({ id: 2, poste: 'Technicien de maintenance confirmé' }) },
  { action: 'equipe.creer', droits: '                        O    O    -    -    -    -', p: () => ({ nom: 'Méthodes' }) },
  { action: 'equipe.renommer', droits: '                     O    O    -    -    -    -', p: () => ({ nom: 'Commercial', nouveau: 'Ventes' }) },
  { action: 'equipe.manager', droits: '                      O    O    -    -    -    -', p: () => ({ nom: 'Commercial', managerId: 19 }) },
  { action: 'equipe.supprimer', droits: '                    O    -    -    -    -    -', p: () => { db.insert('equipes', { nom: 'Vide', managerId: null, ordre: 99 }); return { nom: 'Vide' }; } },
  { action: 'equipe.affecter', variante: 'retrait', droits: 'O    O    O    -    -    -', p: () => ({ empId: 2, equipe: null }) },
  // Formations, certifications, habilitations
  { action: 'plan.inscrire', droits: '                       O    O    O    -    -    -', p: () => ({ empId: 2, certId: cert('sst'), sessionId: 2, conv: 'now' }) },
  { action: 'cert.ajouter', droits: '                        O    O    -    -    -    -', p: () => ({ empId: 2, f: 'sst', date: '2026-10-01' }) },
  { action: 'session.creer', droits: '                       O    O    -    -    -    -', p: () => ({ f: 'sst', date: '2026-12-01', lieu: 'Site de Lyon', places: 8 }) },
  { action: 'hab.delivrer', droits: '                        O    O    -    -    -    -', p: () => ({ empId: 2, h: 'hauteur', date: '2026-10-07', par: 'Sarah Cohen', mode: 'renew' }) },
  { action: 'hab.suspendre', droits: '                       O    O    O    -    -    -', p: () => ({ empId: 2, h: 'hauteur', motif: 'Incident sur passerelle' }) },
  { action: 'hab.lever', droits: '                           O    O    -    -    -    -', p: () => {
    db.update('habTitres', titre('hauteur').id, { mesure: 'suspension', mesureDate: '2026-10-05', mesureMotif: 'Incident', mesurePar: 'Karim Haddad' });
    return { empId: 2, h: 'hauteur' };
  } },
  { action: 'hab.retirer', droits: '                         O    O    -    -    -    -', p: () => ({ empId: 2, h: 'hauteur', motif: 'Restriction médicale' }) },
  { action: 'medical.demander', droits: '                    O    O    -    -    -    -', p: () => ({ empId: 2 }) },
  { action: 'demande.accepter', droits: '                    O    O    -    -    -    -', p: () => ({ id: demande('aipr') }) },
  { action: 'demande.refuser', droits: '                     O    O    -    -    -    -', p: () => ({ id: demande('aipr') }) },
  // Le collaborateur demande pour lui-même (l'autre collaborateur aussi, pour lui) ; le manager pour un membre de son équipe.
  { action: 'demande.formation', droits: '                   -    -    O    -    O    O', p: () => ({ f: 'autre', libelle: 'Lean management', motif: 'Évolution', empId: 2 }) },
  { action: 'demande.habilitation', droits: '                -    -    O    -    O    O', p: () => ({ h: 'aipr', motif: 'Chantier réseaux', empId: 2 }) },
  // Déplacements
  { action: 'voyage.creer', droits: '                        O    O    -    -    -    -', p: () => ({ empId: 2, dest: 'MA', depart: '2026-11-02', retour: '2026-11-06', motif: 'Chantier Tanger' }) },
  { action: 'formalite.enregistrer', droits: '               O    O    -    -    O    -', p: () => ({ empId: 2, kind: 'passeport', numero: '21XY12345', expire: '2032-01-01' }) },
  { action: 'voyages.importer', droits: '                    O    O    -    -    -    -', p: () => ({ texte: SAMPLE_TRIPS_CSV }) },
  { action: 'keystone.accepter', droits: '                   O    O    -    -    -    -', p: () => ({ id: 1 }) },
  { action: 'keystone.refuser', droits: '                    O    O    -    -    -    -', p: () => ({ id: 1 }) },
  // Plan et budget : remplacer les lignes prévues les supprime (administrateur RH).
  { action: 'plan.importer', variante: 'compléter', droits: 'O    O    -    -    -    -', p: () => ({ texte: SAMPLE_PLAN_CSV, exercice: 2027, mode: 'add' }) },
  { action: 'plan.importer', variante: 'remplacer', droits: 'O    -    -    -    -    -', p: () => ({ texte: SAMPLE_PLAN_CSV, exercice: 2026, mode: 'replace' }) },
  { action: 'budget.enveloppes', droits: '                   O    O    -    -    -    -', p: () => ({ exercice: 2027, enveloppes: { Maintenance: 5000 } }) },
  { action: 'plan.avancer', droits: '                        O    O    -    -    -    -', p: () => ({ id: (db.sql.prepare(`SELECT id FROM plan_actions WHERE statut <> 'realise' LIMIT 1`).get() as { id: number }).id }) },
  // Feuilles de temps : saisie par le salarié, son manager ou le RH ; validation par le manager ou le RH ; paie : administrateur RH.
  { action: 'temps.setCell', droits: '                       O    O    O    -    O    -', p: () => { feuille('brouillon'); return { empId: 2, week: WEEK, li: 0, di: 0, value: '7' }; } },
  { action: 'temps.addLine', droits: '                       O    O    O    -    O    -', p: () => ({ empId: 2, week: WEEK, projet: 'INT-MAINT' }) },
  { action: 'temps.removeLine', droits: '                    O    O    O    -    O    -', p: () => { feuille('brouillon'); return { empId: 2, week: WEEK, li: 0 }; } },
  { action: 'temps.suggest', droits: '                       O    O    O    -    O    -', p: () => ({ empId: 2, week: WEEK }) },
  { action: 'temps.submit', droits: '                        O    O    O    -    O    -', p: () => { feuille('brouillon', H7); return { empId: 2, week: WEEK }; } },
  { action: 'temps.validate', droits: '                      O    O    O    -    -    -', p: () => { feuille('soumise', H7); return { empId: 2, week: WEEK }; } },
  { action: 'temps.reject', droits: '                        O    O    O    -    -    -', p: () => { feuille('soumise', H7); return { empId: 2, week: WEEK, comment: 'Projet à corriger' }; } },
  { action: 'temps.pushSage', droits: '                      O    -    -    -    -    -', p: () => ({}) },
  // Congés
  { action: 'absence.demander', droits: '                    O    O    O    -    O    -', p: () => ({ empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' }) },
  { action: 'absence.decider', droits: '                     O    O    O    -    -    -', p: () => ({ id: (db.sql.prepare(`SELECT id FROM absences WHERE emp_id = 2 AND statut = 'demandee'`).get() as { id: number }).id, ok: true }) },
  { action: 'cet.placer', droits: '                          O    O    -    -    O    -', p: () => ({ empId: 2, kind: 'RTT', jours: 1 }) },
  { action: 'report.accorder', droits: '                     O    O    -    -    -    -', p: () => ({ empId: 2, jours: 1, motif: 'Arrêt maladie' }) },
  // Entretiens : l'évaluateur (manager direct ou RH) et le salarié pour ses sections et sa signature.
  { action: 'entretien.planifier', droits: '                 O    O    O    -    -    -', p: () => ({ empId: 2, kind: 'annuel', date: '2026-11-15' }) },
  { action: 'entretien.modifier', droits: '                  O    O    O    -    O    -', p: () => ({ id: ENTRETIEN(), section: 'avis', value: 'Année riche en chantiers' }) },
  { action: 'entretien.clore', droits: '                     O    O    O    -    -    -', p: () => ({ id: ENTRETIEN() }) },
  { action: 'entretien.signer', droits: '                    -    -    -    -    O    -', p: () => {
    const id = ENTRETIEN();
    db.update('entretiens', id, { statut: 'realise', signMgr: '2026-10-07' });
    return { id };
  } },
  // Administration : administrateur RH.
  { action: 'parametres.maj', droits: '                      O    -    -    -    -    -', p: () => ({ horizonAlerte: 60 }) },
  { action: 'demo.reinitialiser', droits: '                  O    -    -    -    -    -', p: () => ({}) },
  { action: 'compte.creer', droits: '                        O    -    -    -    -    -', p: () => ({ type: 'microsoft', identifiant: 'paie@cabinet.example', nom: 'Cabinet Paie', profilRh: 'rh_gestionnaire' }) },
  { action: 'compte.profil', droits: '                       O    -    -    -    -    -', p: () => ({ id: compteDe(2).id, profilRh: 'rh_gestionnaire' }) },
  { action: 'compte.activer', droits: '                      O    -    -    -    -    -', p: () => ({ id: compteDe(1).id, actif: false }) },
  { action: 'compte.reinitialiser', droits: '                O    -    -    -    -    -', p: () => ({ id: compteDe(1).id }) },
  // Envois sortants (Paramètres → Envois) : le service RH suit, relance (intégration configurée) ou classe un échec.
  { action: 'envoi.relancer', droits: '                      O    O    -    -    -    -', p: () => ({ id: envoiEnEchec() }), env: { KEYSTONE_URL: 'http://keystone.essai', KEYSTONE_TOKEN: 'jeton' } },
  { action: 'envoi.classer', droits: '                       O    O    -    -    -    -', p: () => ({ id: envoiEnEchec() }) },
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
