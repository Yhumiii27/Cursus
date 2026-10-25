// Fabrique du jeu de charge (lot 9, chantier 4) : fiches, absences, feuilles et lots de paie d'un jeu réaliste, sur
// n'importe quelle base de Cursus (SQLite ou PostgreSQL, API Db commune). Le générateur de l'essai de charge
// (scripts/charge/generer.ts) l'appelle sur son schéma PostgreSQL jetable, avec ses insertions en masse par le pilote ;
// le banc d'oracle (tests/support/oracle.ts) l'appelle sur une base de test des deux moteurs, avec `insererPortable`.
// Même graine, mêmes tirages, dans le même ordre : le jeu d'un an des tests est celui de `npm run charge:generer --
// --ans 1` (hors journal, envois, relevés et jetons d'agenda, que seul le générateur ajoute).
import { addD, mondayOf } from '../../shared/dates.ts';
import { contratFige } from '../../shared/rules/temps.ts';
import type { CurrentUser, Employe } from '../../shared/types.ts';
import { ACTIONS } from '../../server/src/actions/index.ts';
import { makeCtx } from '../../server/src/actions/context.ts';
import { currentUser, loadFull } from '../../server/src/dataset.ts';
import type { Db } from '../../server/src/db.ts';
import type { Aleatoire } from './commun.ts';

type Messagerie = { agences: { nom: string; adresse: string; depuis?: string }[] } & Record<string, unknown>;

/** Projets des lignes de feuille : activités internes et projets Keystone de la démonstration. */
export const INTERNES = ['INT-PROD', 'INT-LOG', 'INT-MAINT', 'INT-HSE', 'INT-QUA', 'INT-ADM'];
export const KEYSTONE = ['K-2614', 'K-2620', 'K-2611', 'K-2625'];
export const AGENCES = [
  { nom: 'Proman Lyon', adresse: 'releves.lyon@agence-interim.example' },
  { nom: 'Adecco Villeurbanne', adresse: 'releves.villeurbanne@agence-interim.example' },
  { nom: 'Randstad Vénissieux', adresse: 'releves.venissieux@agence-interim.example' },
];
export const NOUVELLES_EQUIPES = ['Atelier Nord', 'Atelier Sud'];

/** Insertion de plusieurs lignes : colonnes (noms SQL), valeurs déjà converties (JSON en texte). */
export type InsererLignes = (table: string, colonnes: string[], lignes: unknown[][]) => Promise<void>;

/**
 * Insertion de plusieurs lignes par le SQL brut commun aux deux moteurs (`?`), par paquets de 500 (en deçà des limites
 * de paramètres de SQLite et de PostgreSQL) : chaque ligne passe par les déclencheurs comme une écriture ordinaire.
 */
export function insererPortable(db: Db): InsererLignes {
  return async (table, colonnes, lignes) => {
    for (let i = 0; i < lignes.length; i += 500) {
      const paquet = lignes.slice(i, i + 500);
      await db.run(`INSERT INTO ${table} (${colonnes.join(', ')}) VALUES ${paquet.map(l => `(${l.map(() => '?').join(', ')})`).join(', ')}`,
        paquet.flat() as never[]);
    }
  };
}

/** Jours ouvrés (lundi à vendredi) de `du` à `au` inclus. */
export function joursOuvres(du: string, au: string): string[] {
  const out: string[] = [];
  for (let j = du; j <= au; j = addD(j, 1)) { const w = new Date(`${j}T12:00:00Z`).getUTCDay(); if (w >= 1 && w <= 5) out.push(j); }
  return out;
}

/**
 * Absences d'un salarié sur une année : congés d'été (2 à 3 semaines), de fin d'année, quelques jours de CP et de RTT,
 * un ou deux arrêts maladie courts, parfois une absence pour enfant malade ; jamais deux le même jour, jamais dans les
 * six dernières semaines (les feuilles soumises de la fin de mois restent validables sans conflit).
 */
export function absencesDeLAnnee(r: Aleatoire, annee: number, entree: string, limite: string, pris: Set<string>): { type: string; du: string; au: string }[] {
  const out: { type: string; du: string; au: string }[] = [];
  const poser = (type: string, du: string, jours: number) => {
    const au = addD(du, jours - 1);
    if (du < entree || au > limite) return;
    const ouvres = joursOuvres(du, au);
    if (!ouvres.length || ouvres.some(j => pris.has(j))) return;
    for (const j of ouvres) pris.add(j);
    out.push({ type, du, au });
  };
  poser('CP', mondayOf(`${annee}-${r.si(0.5) ? '07' : '08'}-${String(r.entre(1, 20)).padStart(2, '0')}`), r.si(0.5) ? 19 : 12);
  poser('CP', mondayOf(`${annee}-12-${String(r.entre(15, 22)).padStart(2, '0')}`), 5);
  const jour = () => `${annee}-${String(r.entre(1, 11)).padStart(2, '0')}-${String(r.entre(1, 28)).padStart(2, '0')}`;
  for (let i = 0; i < 7; i++) poser('CP', jour(), r.entre(1, 3));
  for (let i = 0; i < 9; i++) poser('RTT', jour(), 1);
  for (let i = 0, n = r.entre(1, 2); i < n; i++) poser('MALADIE', jour(), r.entre(1, 5));
  if (r.si(0.3)) poser('ENFANT_MALADE', jour(), 1);
  if (r.si(0.1)) poser('SANS_SOLDE', jour(), 1);
  return out;
}

/**
 * Lignes d'une feuille : 2 à 4 projets, la durée du contrat répartie sur les jours ouvrés (7 h ; temps partiel : sa
 * durée hebdomadaire, en heures entières), 39 h pour 5 % des semaines d'un temps plein, jours d'absence à 0.
 */
export function lignesFeuille(r: Aleatoire, e: Employe, semaine: string, absent: Set<string>, ancienne: boolean, projetsNom: Map<string, string>) {
  const partiel = e.temps === 'partiel' && e.heures ? e.heures : null;
  const jours = partiel ? Math.floor(partiel / 5) : 7, reste = partiel ? partiel - jours * 5 : 0;
  const n = r.entre(2, 4);
  const projets = [...new Set(Array.from({ length: n }, (_, i) => (i === 0 || !r.si(0.4) ? r.choix(INTERNES) : r.choix(KEYSTONE))))];
  const sup = !partiel && r.si(0.05);
  const dimanche = ancienne && r.si(0.02);
  const lignes = projets.map(projet => ({ projet, tache: projetsNom.get(projet) ?? projet, ks: false, h: [0, 0, 0, 0, 0, 0, 0] as number[] }));
  for (let d = 0; d < 7; d++) {
    const jour = addD(semaine, d);
    if (absent.has(jour)) continue;
    let heures = d < 5 ? (sup && d < 4 ? 8 : jours + (d === 0 ? reste : 0)) : d === 6 && dimanche && !partiel ? 4 : 0;
    for (let i = 0; heures > 0; i = (i + 1) % lignes.length) {
      const h = i === lignes.length - 1 ? heures : Math.min(heures, r.entre(1, 4));
      lignes[i].h[d] += h; heures -= h;
    }
  }
  return lignes;
}

/** Paramètres du jeu : années d'historique, salariés permanents et intérimaires (fiches de la démonstration comprises). */
export interface OptionsJeu { ans: number; effectif: number; interimaires: number }

/** Ce que la fabrique a posé : semaines du scénario, fiches présentes, lots transmis. */
export interface JeuFabrique {
  today: string;
  debut: string;
  semaineCourante: string;
  soumises: string[];
  periodePaie: string;
  employes: Employe[];
  lots: number;
  /** Lecteur de l'administrateur RH (compte de la démonstration). */
  rh: CurrentUser;
}

/**
 * Peuple une base où le référentiel et les comptes de la démonstration sont chargés (`seedDemo`, `comptesDemo`) :
 *   - fiches portées à l'effectif (dont les intérimaires de trois agences), deux équipes de plus (8 managers), un
 *     compte par salarié ;
 *   - feuilles hebdomadaires sur `ans` années (2 à 4 lignes, 5 % de semaines à 39 h, quelques dimanches), absences
 *     (une quinzaine par personne et par an), transmises mois par mois à la paie par le vrai traitement (temps.pushSage),
 *     dix lots annulés ; le mois précédent reste en attente de lot, les quatre semaines d'avant la semaine en cours sont
 *     soumises (fin de mois), la semaine en cours est à saisir.
 * `inserer` écrit les feuilles et les absences en masse ; `etape` rend compte de l'avancement.
 */
export async function peuplerJeu(db: Db, r: Aleatoire, { ans: ANS, effectif: EFFECTIF, interimaires: INTERIM }: OptionsJeu, inserer: InsererLignes, etape: (texte: string) => void = () => {}): Promise<JeuFabrique> {
  const today = process.env.CURSUS_TODAY!;
  const semaineCourante = mondayOf(today);
  const soumises = [4, 3, 2, 1].map(n => addD(semaineCourante, -7 * n));
  const debut = mondayOf(addD(today, -365 * ANS));
  // Mois dont les feuilles partent à la paie pendant la génération : jusqu'à la période de paie ouverte, qui reste en
  // attente de lot (scénario « paie »).
  const moisCourant = today.slice(0, 7);
  const moisPrecedent = (m: string) => { const [a, mm] = m.split('-').map(Number); return mm === 1 ? `${a - 1}-12` : `${a}-${String(mm - 1).padStart(2, '0')}`; };
  // Le mois en cours et le précédent portent les semaines soumises : les feuilles du mois d'avant restent en attente
  // de lot ; elles partent dans le lot de la période ouverte, celle du mois en cours (feuilles en retard).
  const dernierMois = moisPrecedent(moisCourant), enAttente = moisPrecedent(dernierMois), periodePaie = moisCourant;
  const limiteAbsences = addD(soumises[0], -14);
  const RH = (await currentUser(db, { compteId: ((await db.one('SELECT id FROM comptes WHERE emp_id IS NULL AND profil_rh = ?', ['rh_admin'])) as { id: number }).id, role: 'rh', methode: 'demo' }))!;
  const projetsNom = new Map((await db.all<{ code: string; nom: string }>('projets', 'rowid')).map(p => [p.code, p.nom]));

  // — Fiches : équipes de plus, clones des fiches de la démonstration jusqu'à l'effectif, intérimaires —
  const modeles = (await loadFull(db, RH)).employes;
  const permanents = modeles.filter(e => e.typeContrat !== 'interim' && !e.fin);
  const interimModele = modeles.find(e => e.typeContrat === 'interim')!;
  const equipesDemo = (await db.all<{ nom: string; managerId: number | null }>('equipes')).filter(q => q.managerId).map(q => q.nom);
  const equipes = [...equipesDemo, ...NOUVELLES_EQUIPES];
  const nouveaux: number[] = [];
  await db.tx(async () => {
    // Deux équipes de plus (managers posés ensuite, parmi les nouveaux permanents) : 8 managers.
    for (const [k, nom] of NOUVELLES_EQUIPES.entries()) await db.insert('equipes', { nom, managerId: null, ordre: 10 + k });
    // `effectif` salariés permanents et `interimaires` intérimaires, fiches de la démonstration comprises.
    const aCreer = [
      ...Array.from({ length: Math.max(0, EFFECTIF - modeles.filter(e => e.typeContrat !== 'interim').length) }, () => false),
      ...Array.from({ length: Math.max(0, INTERIM - modeles.filter(e => e.typeContrat === 'interim').length) }, () => true),
    ];
    for (const [k, interim] of aCreer.entries()) {
      const i = modeles.length + k;
      const m = interim ? interimModele : permanents[i % permanents.length];
      const { id: _id, certs, habs, visas: _v, vaccins: _va, passeport: _p, ...fiche } = m;
      const entree = interim ? addD(debut, r.entre(0, Math.max(0, 365 * ANS - 120))) : (m.entree < debut ? m.entree : debut);
      const equipe = interim ? r.choix(['Production', 'Logistique', ...NOUVELLES_EQUIPES]) : equipes[i % equipes.length];
      const e = await db.insert<Employe>('employes', {
        ...fiche, nom: `${m.nom.split(' ')[0]} Essai-${i}`, equipe, email: null, matriculePaie: interim ? null : String(5000 + i).padStart(6, '0'), entree, fin: null,
        agence: interim ? AGENCES[i % AGENCES.length].nom : null,
      });
      nouveaux.push(e.id);
      for (const { id: _c, ...c } of certs) await db.insert('certifications', { ...c, empId: e.id });
      for (const { id: _h, ...h } of habs) await db.insert('habTitres', { ...h, empId: e.id });
    }
    for (const [k, nom] of NOUVELLES_EQUIPES.entries()) await db.update('equipes', nom, { managerId: nouveaux[k] });
    const messagerie = await db.getSetting<Messagerie>('messagerie', { agences: [] });
    await db.setSetting('messagerie', { ...messagerie, agences: AGENCES.map(a => ({ ...a, depuis: debut })) });
    // Flux d'agenda ouvert (scénario « exports »).
    await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), agendaFluxActif: true });
    for (const id of nouveaux) {
      await db.insert('comptes', {
        empId: id, nom: null, adresse: null, identifiant: `charge.${id}@essai.example`, type: 'local', oid: null, profilRh: 'aucun', actif: true,
        motDePasse: null, changerMotDePasse: false, echecs: 0, blocageFin: null, creation: new Date().toISOString(), creePar: 'Essai de charge', derniereConnexion: null,
      });
    }
  });
  const employes = (await loadFull(db, RH)).employes.filter(e => !e.fin || e.fin >= today);
  etape(`${employes.length} fiches, ${equipes.length} équipes`);

  // — Absences puis feuilles, mois par mois, transmises à la paie au fil des mois (vrai traitement temps.pushSage) —
  const existantes = new Set((await db.all<{ empId: number; week: string }>('feuilles')).map(f => `${f.empId}|${f.week}`));
  const absencesParEmp = new Map<number, { type: string; du: string; au: string }[]>();
  const absentLe = new Map<number, Set<string>>();
  for (const e of employes) {
    const pris = new Set<string>();
    const liste: { type: string; du: string; au: string }[] = [];
    for (let a = Number(debut.slice(0, 4)); a <= Number(today.slice(0, 4)); a++) liste.push(...absencesDeLAnnee(r, a, e.entree, limiteAbsences, pris));
    absencesParEmp.set(e.id, liste.filter(x => x.du >= debut));
    absentLe.set(e.id, pris);
  }
  const colsFeuille = ['emp_id', 'week', 'statut', 'comment', 'sage', 'keystone', 'lignes', 'contrat', 'heures_sup', 'maj_dimanche', 'maj_ferie'];
  const ligneFeuille = (e: Employe, w: string, statut: string) => [e.id, w, statut, null, false, false,
    JSON.stringify(lignesFeuille(r, e, w, absentLe.get(e.id)!, statut === 'validee', projetsNom)), JSON.stringify(contratFige(e)), 'paiement', 0, null];
  const mois: string[] = [];
  for (let m = debut.slice(0, 7); m <= dernierMois; m = (() => { const [a, mm] = m.split('-').map(Number); return mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, '0')}`; })()) mois.push(m);
  let lots = 0;
  for (const m of mois) {
    const feuilles: unknown[][] = [], absences: unknown[][] = [];
    for (const e of employes) {
      for (let w = mondayOf(`${m}-01`); w.slice(0, 7) <= m; w = addD(w, 7)) {
        if (w.slice(0, 7) !== m || w < debut || w < mondayOf(e.entree) || w >= soumises[0] || existantes.has(`${e.id}|${w}`)) continue;
        feuilles.push(ligneFeuille(e, w, 'validee'));
        existantes.add(`${e.id}|${w}`);
      }
      for (const a of absencesParEmp.get(e.id)!) if (a.du.slice(0, 7) === m) absences.push([e.id, a.type, a.du, a.au, 'validee', false, false]);
    }
    await inserer('feuilles', colsFeuille, feuilles);
    await inserer('absences', ['emp_id', 'type', 'du', 'au', 'statut', 'keystone', 'justificatif'], absences);
    // Les feuilles du mois en attente de lot n'y partent pas.
    if (m >= enAttente) continue;
    // Lot du mois généré au début du mois suivant, à sa date : chaque lot porte sa propre période de paie.
    const suivant = m.endsWith('-12') ? `${Number(m.slice(0, 4)) + 1}-01` : `${m.slice(0, 5)}${String(Number(m.slice(5)) + 1).padStart(2, '0')}`;
    process.env.CURSUS_TODAY = `${suivant}-05`;
    try {
      await db.tx(async () => {
        try {
          await ACTIONS['temps.pushSage'](makeCtx(db, RH, await loadFull(db, RH)), {});
          lots++;
        } catch (err) {
          if (!(err instanceof Error && /Aucune feuille/.test(err.message))) throw err;
        }
      });
    } finally {
      process.env.CURSUS_TODAY = today;
    }
    if (lots % 12 === 0) etape(`paie transmise jusqu’à ${m} (${lots} lots)`);
  }
  // Fin de mois : quatre semaines soumises ; semaine en cours en brouillon (saisie du vendredi).
  const recentes: unknown[][] = [];
  for (const e of employes) {
    for (const w of [...soumises, semaineCourante]) {
      if (w < mondayOf(e.entree) || existantes.has(`${e.id}|${w}`)) continue;
      recentes.push(ligneFeuille(e, w, w === semaineCourante ? 'brouillon' : 'soumise'));
    }
  }
  await inserer('feuilles', colsFeuille, recentes);
  // Lots annulés (générés puis annulés avant leur import) : copies de dix lots, contenu compris.
  await db.run(`INSERT INTO lots_paie (cle, mode, statut, periode, periodes, rappels, creation, auteur, feuilles, resume, sans_matricule, contenu, annule_le, annule_par, historique, absences)
    SELECT cle || '-annule', mode, 'annule', periode, periodes, rappels, creation, auteur, feuilles, resume, sans_matricule, contenu, creation, 'Essai de charge', historique, absences
    FROM lots_paie WHERE contenu IS NOT NULL ORDER BY id DESC LIMIT 10`);
  etape(`feuilles, absences et ${lots} lots de paie (+ 10 annulés)`);
  return { today, debut, semaineCourante, soumises, periodePaie, employes, lots, rh: RH };
}
