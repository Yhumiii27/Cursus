// Banc d'oracle (lot 9, chantier 4) : suite d'écritures aléatoire et reproductible, tirée d'une graine, puis, après chaque
// pas, comparaison de tout ce que sert la lecture partagée avec la relecture complète (scripts/charge/verifier.ts) :
// - écritures : actions du registre ACTIONS (POST /api/actions/:nom, l'application montée sur une boucle locale) par des
//   comptes tirés au hasard, dans leurs espaces, avec des paramètres tirés des données du moment (salarié, semaine,
//   absence, session…) ; et du SQL direct, comme une reprise ou un outil (INSERT, UPDATE, DELETE, upsert ON CONFLICT,
//   instruction de plusieurs lignes) ;
// - avant chaque action : jeu remis à l'action (`donneesAction`) contre `loadFull` de son compte, dans une même
//   transaction ; après : instantané renvoyé contre l'instantané lu directement ;
// - après chaque pas (ou tous les `verifierTous` pas) : vue de chaque compte, espace et profil RH (PROFILS_RH), entrée du
//   cache et jeu d'action de chaque lecteur, contre la lecture cache coupé (CURSUS_CACHE_INSTANTANE=0).
// Il tourne sur le cache tel qu'il est (une entrée par révision) et rejouera, sans changement, le cache incrémental.
// Un appel refusé (4xx) fait partie du jeu : il ne doit rien changer. Une 5xx est une erreur du banc ou de Cursus.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { addD, mondayOf } from '../../shared/dates.ts';
import { ENT_TYPES, PROFILS_RH } from '../../shared/constants.ts';
import { contratFige } from '../../shared/rules/temps.ts';
import type { CurrentUser, Dataset } from '../../shared/types.ts';
import { ACTIONS } from '../../server/src/actions/index.ts';
import { createApp } from '../../server/src/app.ts';
import { empreinteSession, sign } from '../../server/src/auth.ts';
import { espacesDuCompte, type Compte } from '../../server/src/comptes.ts';
import { currentUser, loadFull } from '../../server/src/dataset.ts';
import type { Db } from '../../server/src/db.ts';
import { comptesDemo, seedDemo } from '../../server/src/seed.ts';
import { aleatoire, type Aleatoire } from '../../scripts/charge/commun.ts';
import { insererPortable, type JeuFabrique, peuplerJeu } from '../../scripts/charge/fabrique.ts';
import {
  cleLecteur, comparerJeuAction, comparerReponse, type Divergence, lecteursDe, verifierExactitude,
} from '../../scripts/charge/verifier.ts';

/** Compte connecté dans un espace : session ouverte en base, cookie signé comme par Cursus. */
interface Acteur { compteId: number; role: CurrentUser['role']; cookie: string; cle: string }

/**
 * Actions jamais tirées : la remise à zéro de la démonstration (efface les comptes et leurs sessions, la suite ne
 * pourrait plus écrire) ; l'activation des comptes et la réinitialisation des mots de passe (comptes du banc rendus
 * inutilisables) ; l'essai d'envoi et la messagerie (aucun effet sur les données lues).
 */
const EXCLUES = new Set(['demo.reinitialiser', 'compte.activer', 'compte.reinitialiser', 'messagerie.essai', 'messagerie.recapituler']);

/** Lecteur interne des tirages : tout le jeu, paie comprise (aucune réponse n'en sort). */
const TIRAGE: CurrentUser = { role: 'rh', empId: null, nom: 'Banc d’oracle', intitule: 'Tirages', profilRh: 'rh_admin' };

/** Paramètres d'une action tirés de l'état du moment `ds`, pour `acteur` (salarié de l'acteur favorisé). */
type Tirage = (x: { ds: Dataset; r: Aleatoire; empId: () => number; semaine: (empId: number, statut?: string) => string; date: (min: number, max: number) => string; user: CurrentUser }) => Record<string, unknown>;

const KINDS = ['CP', 'RTT', 'RECUP'];
const NATURES = ['MALADIE', 'ENFANT_MALADE', 'SANS_SOLDE', 'AT', 'MARIAGE'];
/** Feuille soumise au hasard (validation, rejet), ou null. */
const soumise = (ds: Dataset, r: Aleatoire) => {
  const l = ds.feuilles.filter(f => f.statut === 'soumise');
  if (!l.length) return null;
  const f = r.choix(l);
  return { empId: f.empId, week: f.week };
};
/** Fiche du salarié `empId`, ou une autre si elle n'existe plus (anonymisée, retirée par un essai). */
const fiche = (ds: Dataset, r: Aleatoire, empId: number) => ds.employes.find(x => x.id === empId) ?? r.choix(ds.employes);
const id = <T extends { id: number }>(r: Aleatoire, l: readonly T[] | undefined, filtre: (x: T) => boolean = () => true) => {
  const c = (l ?? []).filter(filtre);
  return c.length ? r.choix(c).id : r.entre(1, 50);
};

/**
 * Tirages ciblés des actions les plus fréquentes (saisie, absences, compteurs, fiches, sessions) : les autres actions du
 * registre reçoivent des paramètres tirés d'après les noms qu'elles lisent (`tirageGenerique`).
 */
const TIRAGES: Record<string, Tirage> = {
  'temps.setCell': ({ r, empId, semaine, ds }) => {
    const e = empId(), week = r.si(0.5) ? mondayOf(ds.today) : semaine(e, 'brouillon');
    const sh = ds.feuilles.find(f => f.empId === e && f.week === week);
    return { empId: e, week, li: r.entre(0, Math.max(0, (sh?.lignes.length ?? 1) - 1)), di: r.entre(0, 4), value: String(r.entre(0, 9)) };
  },
  'temps.addLine': ({ r, empId, semaine, ds }) => { const e = empId(); return { empId: e, week: r.si(0.5) ? mondayOf(ds.today) : semaine(e, 'brouillon'), projet: r.choix(ds.referentiels.projets).code }; },
  'temps.removeLine': ({ r, empId, semaine }) => { const e = empId(); return { empId: e, week: semaine(e), li: r.entre(0, 2) }; },
  'temps.submit': ({ empId, semaine }) => { const e = empId(); return { empId: e, week: semaine(e, 'brouillon') }; },
  'temps.validate': ({ r, ds, empId, semaine }) => soumise(ds, r) ?? { empId: empId(), week: semaine(empId(), 'soumise') },
  'temps.reject': ({ r, ds, empId, semaine }) => ({ ...soumise(ds, r) ?? { empId: empId(), week: semaine(empId(), 'soumise') }, comment: 'Merci de vérifier' }),
  'temps.rouvrir': ({ empId, semaine }) => { const e = empId(); return { empId: e, week: semaine(e, 'validee'), motif: 'Correction des heures (banc d’oracle)' }; },
  'temps.validerLot': ({ r, ds }) => {
    const soumises = ds.feuilles.filter(f => f.statut === 'soumise');
    const lot = Array.from({ length: Math.min(soumises.length, r.entre(1, 4)) }, () => r.choix(soumises));
    return { feuilles: [...new Map(lot.map(f => [f.id, { empId: f.empId, week: f.week }])).values()] };
  },
  'absence.demander': ({ r, empId, date }) => { const du = date(1, 60); return { empId: empId(), kind: r.choix(KINDS), du, au: addD(du, r.entre(0, 3)) }; },
  'absence.decider': ({ r, ds }) => ({ id: id(r, ds.absences, a => a.statut === 'demandee'), ok: r.si(0.7), motif: 'Effectif insuffisant' }),
  'absence.annuler': ({ r, ds }) => ({ id: id(r, ds.absences) }),
  'absence.signaler': ({ empId, date }) => { const du = date(-3, 2); return { empId: empId(), du, au: du }; },
  'absence.saisir': ({ r, empId, date }) => { const du = date(-20, 20); return { empId: empId(), nature: r.choix(NATURES), du, au: addD(du, r.entre(0, 2)) }; },
  'absence.qualifier': ({ r, ds }) => ({ id: id(r, ds.absences, a => a.statut === 'signalee'), nature: r.choix(NATURES) }),
  'absence.prolonger': ({ r, ds, date }) => ({ id: id(r, ds.absences), au: date(0, 15) }),
  'cet.placer': ({ r, empId }) => ({ empId: empId(), kind: r.choix(['CP', 'RTT']), jours: r.entre(1, 2) }),
  'report.accorder': ({ r, empId }) => ({ empId: empId(), jours: r.entre(1, 2), motif: 'Report accordé (banc d’oracle)' }),
  'equipe.affecter': ({ r, empId, ds }) => ({ empId: empId(), equipe: r.choix(ds.referentiels.equipes).nom }),
  'employe.modifier': ({ r, empId, ds }) => {
    const e = fiche(ds, r, empId());
    return r.si(0.5) ? { id: e.id, email: `${e.id}.${r.entre(1, 99)}@essai.example`, avant: { email: e.email } } : { id: e.id, poste: r.choix(ds.employes).poste, avant: { poste: e.poste } };
  },
  'employe.contactUrgence': ({ r, empId }) => ({ empId: empId(), nom: `Contact ${r.entre(1, 99)}`, telephone: `06 00 00 00 ${String(r.entre(10, 99))}` }),
  'parametres.maj': ({ r }) => (r.si(0.5) ? { relancesActives: r.si(0.5) } : { horizonAlerte: r.entre(30, 90) }),
  'entretien.planifier': ({ r, empId, date }) => ({ empId: empId(), kind: r.choix(Object.keys(ENT_TYPES)), date: date(3, 60) }),
  'session.creer': ({ r, ds, date }) => ({ f: r.choix(ds.referentiels.formations).id, date: date(10, 90), lieu: 'Salle B', places: r.entre(4, 12) }),
  'plan.inscrire': ({ r, empId, ds }) => {
    const e = fiche(ds, r, empId());
    return { empId: e.id, sessionId: id(r, ds.sessions), certId: e.certs.length ? r.choix(e.certs).id : undefined, conv: 'later' };
  },
  'cert.ajouter': ({ r, empId, ds, date }) => ({ empId: empId(), f: r.choix(ds.referentiels.formations).id, date: date(-300, -1) }),
  'hab.delivrer': ({ r, empId, ds, date }) => ({ empId: empId(), h: r.choix(ds.referentiels.habilitations).id, date: date(-30, 0), par: 'Direction' }),
  'medical.demander': ({ empId }) => ({ empId: empId(), motif: 'Visite à la demande' }),
  'voyage.creer': ({ r, empId, ds, date }) => { const d = date(10, 60); return { empId: empId(), dest: r.choix(ds.referentiels.destinations).code, motif: 'Mission', depart: d, retour: addD(d, r.entre(1, 5)) }; },
  'demande.formation': ({ r, ds }) => ({ f: r.choix(ds.referentiels.formations).id, motif: 'Montée en compétence' }),
  'mandat.enregistrer': ({ r, empId, date }) => ({ empId: empId(), role: r.choix(['titulaire', 'suppleant']), du: date(-100, 0), credit: r.entre(5, 20) }),
  'astreinte.planifier': ({ empId, date }) => { const du = date(8, 40); return { empId: empId(), du, au: addD(du, 6), debut: '18:00', fin: '08:00' }; },
};

/** Valeur d'un paramètre d'après son nom, pour les actions sans tirage ciblé. */
function valeur(nom: string, action: string, x: Parameters<Tirage>[0]): unknown {
  const { r, ds, empId, semaine, date } = x;
  const famille = action.split('.')[0];
  // Lignes désignées par `id`, d'après la famille de l'action (absence.*, session.*…) ; inconnue : un entier au hasard.
  const tables: Record<string, string> = {
    absence: 'absences', session: 'sessions', entretien: 'entretiens', voyage: 'voyages', demande: 'demandesCollab', plan: 'plan', employe: 'employes',
    mandat: 'mandats', astreinte: 'astreintes', medical: 'demandesVisite', formationSuivie: 'formationsSuivies', forfait: 'avenantsForfait',
    equipe: 'delegations', conges: 'informationsCp', keystone: 'demandesKeystone', attente: 'attentesSession', evaluation: 'evaluationsFormation',
  };
  const lignes = (nomListe: string | undefined) => (nomListe ? (ds as unknown as Record<string, { id: number }[] | undefined>)[nomListe] : undefined);
  const parFamille = (f: string) => (f === 'cert' ? ds.employes.flatMap(e => e.certs) : lignes(tables[f]));
  switch (nom) {
    case 'empId': case 'managerId': case 'suppleantId': return empId();
    case 'id': return id(r, parFamille(famille));
    case 'week': case 'semaine': return semaine(empId());
    case 'li': return r.entre(0, 2);
    case 'di': return r.entre(0, 6);
    case 'value': return String(r.entre(0, 9));
    case 'du': case 'date': case 'depart': case 'le': case 'signeLe': case 'demandeLe': case 'verifieLe': return date(-15, 45);
    case 'au': case 'fin': case 'retour': case 'expire': case 'jusquau': return date(46, 120);
    case 'kind': return r.choix(KINDS);
    case 'nature': return r.choix(NATURES);
    case 'f': return r.choix(ds.referentiels.formations).id;
    case 'h': return r.choix(ds.referentiels.habilitations).id;
    case 'dest': return r.choix(ds.referentiels.destinations).code;
    case 'projet': return r.choix(ds.referentiels.projets).code;
    case 'equipe': case 'nom': case 'parente': return r.choix(ds.referentiels.equipes).nom;
    case 'sessionId': return id(r, ds.sessions);
    case 'certId': return id(r, ds.employes.flatMap(e => e.certs));
    case 'inscriptionId': return id(r, ds.inscriptions);
    case 'planId': return id(r, ds.plan);
    case 'demandeId': return id(r, ds.demandesCollab);
    case 'astreinteId': return id(r, lignes('astreintes'));
    case 'jours': case 'places': case 'effectif': case 'effectifReel': case 'note': case 'efficacite': return r.entre(1, 5);
    case 'cout': case 'coutReel': return r.entre(100, 900);
    case 'annee': case 'exercice': return Number(ds.today.slice(0, 4)) - r.entre(0, 1);
    case 'periode': return ds.today.slice(0, 7);
    case 'ok': case 'actif': case 'archive': case 'requise': case 'suspendre': case 'lever': case 'grandDeplacement': case 'alternant': case 'confirmer': case 'nonTenu': case 'renvoyer': return r.si(0.5);
    case 'profilRh': return r.choix(Object.keys(PROFILS_RH).filter(p => p !== 'rh_admin'));
    case 'perimetre': return ['feuilles', 'absences'];
    case 'motif': case 'comment': case 'commentaire': case 'reponse': case 'libelle': case 'texte': case 'lieu': case 'par': case 'reference': case 'numero': case 'telephone': case 'info': return `Banc d’oracle ${r.entre(1, 999)}`;
    default: return undefined;
  }
}

/** Noms des paramètres lus par une action (`p.nom` dans son code, plus le salarié et la semaine des actions de temps). */
const nomsLus = new Map<string, string[]>();
function parametresLus(action: string): string[] {
  let n = nomsLus.get(action);
  if (!n) {
    const code = ACTIONS[action].toString();
    n = [...new Set([...code.matchAll(/\bp\.([a-zA-Z_]+)/g)].map(m => m[1]))];
    if (action.startsWith('temps.')) n.push('empId', 'week');
    nomsLus.set(action, n = [...new Set(n)]);
  }
  return n;
}

function tirageGenerique(action: string, x: Parameters<Tirage>[0]): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const nom of parametresLus(action)) {
    const v = valeur(nom, action, x);
    if (v !== undefined) p[nom] = v;
  }
  return p;
}

export interface OptionsOracle {
  graine: number;
  /** Nombre de pas (écritures tentées). */
  pas: number;
  /** Part des pas en SQL direct (0 à 1). */
  sql?: number;
  /** Comparaison complète tous les `verifierTous` pas (1 : après chaque pas), et toujours après le dernier. */
  verifierTous?: number;
  /** Lecteurs comparés à chaque vérification (par défaut : tous). */
  lecteurs?: (tous: CurrentUser[], r: Aleatoire) => CurrentUser[];
  /** Lecteurs comparés à la dernière vérification (par défaut : tous). */
  lecteursFinaux?: (tous: CurrentUser[]) => CurrentUser[];
  /**
   * Jeu d'action de chaque lecteur comparé tous les `jeux` pas et au dernier (0 : au dernier seulement) ; celui de l'acteur
   * l'est toujours, avant chaque action.
   */
  jeux?: number;
  /** Faux : écritures seules, sans aucune comparaison (reproductibilité du tirage, préparation d'un état). */
  verifier?: boolean;
}

export interface RapportOracle {
  /** Écritures tentées par action (et SQL direct par forme), avec leur issue. */
  actions: Record<string, { ok: number; refus: number }>;
  sql: Record<string, number>;
  /** Motifs des refus (action et début du message), pour régler les tirages. */
  motifs: Record<string, number>;
  /** Pas qui ont changé la révision de la base. */
  ecritures: number;
  comparaisons: number;
  verifications: number;
  divergences: Divergence[];
  /** Réponses 5xx (erreur de Cursus ou du banc). */
  erreurs: string[];
}

/** Écritures SQL directes, portables (SQLite et PostgreSQL), comme une reprise ou un outil hors de Cursus. */
const SQL_DIRECT: Record<string, (db: Db, ds: Dataset, r: Aleatoire) => Promise<void>> = {
  'UPDATE employes': async (db, ds, r) => { const e = r.choix(ds.employes); await db.run('UPDATE employes SET nom = ? WHERE id = ?', [`${e.nom.replace(/ \(\d+\)$/, '')} (${r.entre(1, 99)})`, e.id]); },
  'UPDATE feuilles (plusieurs lignes)': async (db, ds, r) => { await db.run('UPDATE feuilles SET comment = ? WHERE emp_id = ?', [`Reprise ${r.entre(1, 99)}`, r.choix(ds.employes).id]); },
  'INSERT absences': async (db, ds, r) => {
    const du = addD(ds.today, r.entre(-40, 40));
    await db.run('INSERT INTO absences (emp_id, type, du, au, statut, keystone, justificatif) VALUES (?, ?, ?, ?, ?, FALSE, FALSE)', [r.choix(ds.employes).id, r.choix(KINDS), du, addD(du, r.entre(0, 2)), r.choix(['validee', 'demandee'])]);
  },
  'DELETE absences': async (db, ds, r) => { if (ds.absences.length) await db.run('DELETE FROM absences WHERE id = ?', [r.choix(ds.absences).id]); },
  'INSERT cet': async (db, ds, r) => { await db.run('INSERT INTO cet (emp_id, type, jours, date, periode) VALUES (?, ?, ?, ?, ?)', [r.choix(ds.employes).id, 'RTT', 1, ds.today, ds.today.slice(0, 4)]); },
  'DELETE cet': async (db, ds, r) => { if (ds.cet.length) await db.run('DELETE FROM cet WHERE id = ?', [r.choix(ds.cet).id]); },
  'upsert feuilles': async (db, ds, r) => {
    const e = r.choix(ds.employes), week = addD(mondayOf(ds.today), -7 * r.entre(0, 6));
    await db.run(`INSERT INTO feuilles (emp_id, week, statut, comment, sage, keystone, lignes, contrat, heures_sup) VALUES (?, ?, 'brouillon', ?, FALSE, FALSE, '[]', ?, 'paiement')
      ON CONFLICT (emp_id, week) DO UPDATE SET comment = excluded.comment`, [e.id, week, `Upsert ${r.entre(1, 99)}`, JSON.stringify(contratFige(e))]);
  },
  'upsert projets': async (db, ds, r) => {
    const code = r.si(0.5) ? r.choix(ds.referentiels.projets).code : `ORA-${r.entre(1, 20)}`;
    await db.run(`INSERT INTO projets (code, nom, statut) VALUES (?, ?, 'actif') ON CONFLICT (code) DO UPDATE SET nom = excluded.nom`, [code, `Projet ${r.entre(1, 99)}`]);
  },
  'upsert equipes': async (db, ds, r) => {
    await db.run('INSERT INTO equipes (nom, manager_id, ordre) VALUES (?, NULL, ?) ON CONFLICT (nom) DO UPDATE SET ordre = excluded.ordre', [r.si(0.7) ? r.choix(ds.referentiels.equipes).nom : `Équipe oracle ${r.entre(1, 5)}`, r.entre(0, 20)]);
  },
  'upsert settings': async (db, _ds, r) => {
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', ['calendrierFeries', JSON.stringify(r.si(0.5) ? {} : { 2026: { solidarite: 'pentecote_travaillee', solidariteFerie: null, nonChomes: r.si(0.5) ? ['11_novembre'] : [], le: '2026-01-05T08:00:00.000Z', par: 'Banc d’oracle' } })]);
  },
};

/**
 * Banc ouvert sur `db` : l'application montée sur une boucle locale, une session par compte actif et par espace.
 * `fermer` arrête le serveur.
 */
export async function ouvrirBanc(db: Db): Promise<{ base: string; acteurs: Acteur[]; fermer: () => void }> {
  const app = createApp(db, { production: false, journalRequetes: false, compression: false });
  const serveur = await new Promise<Server>(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  // Connexions gardées plus longtemps qu'une vérification (plusieurs secondes sur le jeu d'un an) : sinon le serveur
  // ferme une connexion au repos au moment où le pas suivant la reprend (« fetch failed »).
  serveur.keepAliveTimeout = 600_000;
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  const acteurs: Acteur[] = [];
  for (const c of await db.all<Compte>('comptes')) {
    for (const role of await espacesDuCompte(db, c)) {
      const sid = randomBytes(32).toString('base64url');
      await db.insert('connexions', { id: empreinteSession(sid), compteId: c.id, role, methode: 'local', demoComptes: {}, creation: new Date().toISOString(), expiration: new Date(Date.now() + 12 * 3600_000).toISOString(), activite: null });
      acteurs.push({ compteId: c.id, role, cookie: `cursus_session=${sid}.${await sign(db, sid)}`, cle: `${role}|compte ${c.id}` });
    }
  }
  return { base, acteurs, fermer: () => { serveur.close(); serveur.closeAllConnections(); } };
}

/** Suite d'écritures de la graine `graine`, comparée à l'oracle (voir l'en-tête). */
export async function rejouer(db: Db, o: OptionsOracle): Promise<RapportOracle> {
  const r = aleatoire(o.graine);
  const banc = await ouvrirBanc(db);
  const rapport: RapportOracle = { actions: {}, sql: {}, motifs: {}, ecritures: 0, comparaisons: 0, verifications: 0, divergences: [], erreurs: [] };
  const noms = Object.keys(ACTIONS).filter(n => !EXCLUES.has(n));
  // Saisie et absences plus souvent que le reste, comme dans la journée de travail.
  const cibles = [...Object.keys(TIRAGES), 'temps.setCell', 'temps.setCell', 'temps.addLine', 'temps.submit', 'absence.demander', 'absence.decider'];
  const verifier = o.verifier ?? true;
  const noter = (divergences: Divergence[]) => { rapport.divergences.push(...divergences); };
  /**
   * Une action tirée au hasard, faite par `acteur` (compte et espace) connecté comme `user`, paramètres tirés de l'état
   * `ds` (révision `avant`), comparée avant et après.
   */
  const agir = async (acteur: Acteur, user: CurrentUser, ds: Dataset, avant: number) => {
    // Action ciblée sept fois sur dix, sinon n'importe quelle action du registre.
    const nom = r.si(0.7) ? r.choix(cibles) : r.choix(noms);
    const equipesGerees = new Set(ds.referentiels.equipes.filter(q => q.managerId === user.empId).map(q => q.nom));
    const equipiers = ds.employes.filter(e => e.equipe && equipesGerees.has(e.equipe)).map(e => e.id);
    const x: Parameters<Tirage>[0] = {
      ds, r, user,
      empId: () => (user.empId && r.si(0.6) ? user.empId : equipiers.length && r.si(0.6) ? r.choix(equipiers) : r.choix(ds.employes).id),
      semaine: (empId, statut) => {
        const siennes = ds.feuilles.filter(f => f.empId === empId && (!statut || f.statut === statut)).sort((a, b) => b.week.localeCompare(a.week)).slice(0, 6);
        return siennes.length && r.si(0.8) ? r.choix(siennes).week : addD(mondayOf(ds.today), -7 * r.entre(-1, 5));
      },
      date: (min, max) => addD(ds.today, r.entre(min, max)),
    };
    const p = (TIRAGES[nom] ?? ((y: Parameters<Tirage>[0]) => tirageGenerique(nom, y)))(x);
    // Jeu remis à l'action : celui que sa transaction lirait (aucune autre écriture ne s'intercale ici).
    const ecartJeu = verifier ? await comparerJeuAction(db, user, false) : null;
    if (verifier) rapport.comparaisons++;
    if (ecartJeu) noter([{ objet: 'action', cle: `${cleLecteur(user)} avant ${nom}`, revision: avant, ecart: ecartJeu }]);
    const res = await fetch(`${banc.base}/api/actions/${nom}`, {
      method: 'POST', headers: { cookie: acteur.cookie, 'x-cursus-espace': acteur.role, 'content-type': 'application/json' }, body: JSON.stringify(p),
    });
    const corps = await res.json() as { data?: Dataset; error?: string };
    const stat = rapport.actions[nom] ??= { ok: 0, refus: 0 };
    if (res.status === 200) stat.ok++;
    else {
      stat.refus++;
      const motif = `${nom} : ${String(corps.error ?? res.status).slice(0, 70)}`;
      rapport.motifs[motif] = (rapport.motifs[motif] ?? 0) + 1;
    }
    if (res.status >= 500) rapport.erreurs.push(`${nom} ${JSON.stringify(p)} → ${res.status} ${corps.error ?? ''}`);
    // Instantané renvoyé après l'action (lu par le cache, après la validation) contre la lecture directe.
    if (verifier && res.status === 200 && corps.data) {
      const apres = await currentUser(db, { id: 'oracle', compteId: acteur.compteId, role: acteur.role, methode: 'local' } as never);
      if (apres) {
        const e = await comparerReponse(db, apres, corps.data);
        rapport.comparaisons++;
        if (e) noter([{ objet: 'réponse', cle: `${cleLecteur(apres)} après ${nom}`, revision: await db.revisionBase(), ecart: e }]);
      }
    }
  };
  try {
    for (let pas = 1; pas <= o.pas; pas++) {
      const ds = await loadFull(db, TIRAGE);
      const avant = await db.revisionBase();
      if (r.si(o.sql ?? 0.2)) {
        const forme = r.choix(Object.keys(SQL_DIRECT));
        // Contrainte refusée (clé étrangère, unicité) : l'écriture est annulée par la base, comme pour un outil.
        try { await SQL_DIRECT[forme](db, ds, r); } catch { /* refusée par la base */ }
        rapport.sql[forme] = (rapport.sql[forme] ?? 0) + 1;
      } else {
        // Acteur : service RH (tous profils) deux fois sur cinq, manager une fois sur quatre, sinon un collaborateur ; les
        // actions réservées sont ainsi souvent faites par qui en a le droit, et parfois refusées.
        const espace = r.si(0.4) ? 'rh' : r.si(0.4) ? 'manager' : 'collaborateur';
        const acteurs = banc.acteurs.filter(a => a.role === espace);
        const acteur = r.choix(acteurs.length ? acteurs : banc.acteurs);
        const user = await currentUser(db, { id: 'oracle', compteId: acteur.compteId, role: acteur.role, methode: 'local' } as never);
        // Compte qui n'ouvre plus cet espace (profil retiré, équipe confiée à un autre par un pas précédent) : pas sans écriture.
        if (user) await agir(acteur, user, ds, avant);
      }
      if (await db.revisionBase() !== avant) rapport.ecritures++;
      const dernier = pas === o.pas;
      if (verifier && (dernier || pas % (o.verifierTous ?? 1) === 0)) {
        const tous = await lecteursDe(db);
        const lecteurs = dernier ? o.lecteursFinaux?.(tous) ?? tous : o.lecteurs?.(tous, r) ?? tous;
        const jeux = o.jeux ?? 1;
        const b = await verifierExactitude(db, lecteurs, { jeux: dernier || (jeux > 0 && pas % jeux === 0) });
        rapport.verifications++;
        rapport.comparaisons += b.comparaisons;
        noter(b.divergences.map(d => ({ ...d, cle: `${d.cle} (pas ${pas})` })));
      }
    }
  } finally {
    banc.fermer();
  }
  return rapport;
}

/** Base de démonstration (référentiel, jeu de démonstration et comptes), sur le moteur des tests. */
export async function baseDemo(nouvelle: () => Promise<Db>): Promise<Db> {
  const db = await nouvelle();
  await seedDemo(db);
  await db.tx(async () => await comptesDemo(db));
  return db;
}

/**
 * Jeu de charge d'un an (`npm run charge:generer -- --ans 1 --effectif 100 --interimaires 20 --seed 42`, hors journal,
 * envois, relevés et jetons d'agenda : scripts/charge/fabrique.ts) sur le moteur des tests : 120 fiches, ≈ 6 000
 * feuilles, ≈ 1 500 absences, 10 lots de paie transmis et 10 annulés.
 */
export async function baseUnAn(nouvelle: () => Promise<Db>): Promise<{ db: Db; jeu: JeuFabrique }> {
  const db = await baseDemo(nouvelle);
  const jeu = await peuplerJeu(db, aleatoire(42), { ans: 1, effectif: 100, interimaires: 20 }, insererPortable(db));
  return { db, jeu };
}

/** Résumé d'un rapport (message d'un test en échec). */
export function resumeRapport(x: RapportOracle): string {
  const ok = Object.values(x.actions).reduce((n, s) => n + s.ok, 0), refus = Object.values(x.actions).reduce((n, s) => n + s.refus, 0);
  return [
    `${x.ecritures} pas écrivants ; actions : ${ok} validées, ${refus} refusées ; SQL direct : ${Object.values(x.sql).reduce((n, v) => n + v, 0)} ; ${x.verifications} vérifications, ${x.comparaisons} comparaisons`,
    ...x.erreurs.slice(0, 5).map(e => `5xx : ${e}`),
    ...x.divergences.slice(0, 10).map(d => `divergence ${d.objet} ${d.cle} (révision ${d.revision}) : ${d.ecart}`),
  ].join('\n');
}
