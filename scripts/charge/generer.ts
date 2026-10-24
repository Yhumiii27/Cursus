// npm run charge:generer -- --ans 5 --effectif 100 --interimaires 20 --seed 42 : jeu de données réaliste pour l'essai de
// charge sur PostgreSQL (lot 8, chantier E ; méthode : docs/ARCHITECTURE.md, « Performances »). Il travaille dans un
// schéma jetable `cursus_charge_<horodatage>` du serveur de test de CURSUS_TEST_DATABASE_URL et refuse le serveur
// commun EPC2I (scripts/charge/commun.ts) ; le schéma reste en place pour les essais (npm run charge), jusqu'à
// `npm run charge:generer -- --supprimer`, qui retire tous les schémas de l'essai de ce serveur.
//   - migrations de server/migrations-pg/, amorçages d'une base neuve et référentiel de la démonstration (seedDemo) ;
//   - fiches portées à l'effectif (dont les intérimaires de trois agences), deux équipes de plus (8 managers), un
//     compte par salarié ;
//   - feuilles hebdomadaires sur `--ans` années (2 à 4 lignes, 5 % de semaines à 39 h, quelques dimanches), absences
//     (une quinzaine par personne et par an), transmises mois par mois à la paie par le vrai traitement (temps.pushSage,
//     simulation : lots et contenus de taille réelle), dix lots annulés ; le mois précédent reste en attente de lot, les
//     quatre semaines d'avant la semaine en cours sont soumises (fin de mois), la semaine en cours est à saisir ;
//   - journal à l'état stable (≈ 300 000 lignes à 5 ans, dont un tiers d'actions de paie sur trois ans), envois
//     (≈ 40 000), relevés des intérimaires, jetons d'agenda.
// Insertions en masse (INSERT de 1 000 lignes, INSERT … SELECT generate_series), jamais ligne à ligne. Le jeu est décrit
// dans data/charge/jeu-<schéma>.json (comptes à simuler, semaines, période de paie), lu par l'exécuteur.
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import {
  aleatoire, type Aleatoire, connecterAdministration, ecrireJeu, entier, horodatage, type JeuCharge, lancer, lireArguments, PREFIXE_SCHEMA,
  RefusCharge, urlAdministration,
} from './commun.ts';
process.env.CURSUS_TODAY ??= '2026-10-10';
// Ni démonstration publiée ni envoi réel : le jeu est chargé hors de tout serveur.
delete process.env.DATABASE_URL;

const { ouvrirPostgres } = await import('../../server/src/db-pg.ts');
const { mettreAJourBase } = await import('../../server/src/demarrage.ts');
const { comptesDemo, seedDemo } = await import('../../server/src/seed.ts');
const { currentUser, loadFull } = await import('../../server/src/dataset.ts');
const { ACTIONS } = await import('../../server/src/actions/index.ts');
const { makeCtx } = await import('../../server/src/actions/context.ts');
const { TABLES, snake } = await import('../../server/src/db.ts');
const { addD, mondayOf } = await import('../../shared/dates.ts');
const { contratFige } = await import('../../shared/rules/temps.ts');
type Employe = Awaited<ReturnType<typeof loadFull>>['employes'][number];
type Messagerie = { agences: { nom: string; adresse: string; depuis?: string }[] } & Record<string, unknown>;

/** Projets des lignes de feuille : activités internes et projets Keystone de la démonstration. */
const INTERNES = ['INT-PROD', 'INT-LOG', 'INT-MAINT', 'INT-HSE', 'INT-QUA', 'INT-ADM'];
const KEYSTONE = ['K-2614', 'K-2620', 'K-2611', 'K-2625'];
const AGENCES = [
  { nom: 'Proman Lyon', adresse: 'releves.lyon@agence-interim.example' },
  { nom: 'Adecco Villeurbanne', adresse: 'releves.villeurbanne@agence-interim.example' },
  { nom: 'Randstad Vénissieux', adresse: 'releves.venissieux@agence-interim.example' },
];
const NOUVELLES_EQUIPES = ['Atelier Nord', 'Atelier Sud'];
/** Actions des lignes de journal générées (hors paie, puis paie), dans la proportion d'une année ordinaire. */
const ACTIONS_JOURNAL = ['temps.setCell', 'temps.setCell', 'temps.setCell', 'temps.setCell', 'connexion', 'connexion', 'temps.submit', 'keystone.appel', 'absence.demander', 'export'];
const ACTIONS_PAIE = ['temps.validate', 'absence.decider', 'sage.fichier', 'temps.validerLot', 'sage.variables'];

/** INSERT de plusieurs lignes, par paquets de 1 000 : colonnes (noms SQL), valeurs déjà converties (JSON en texte). */
async function inserer(client: pg.Client, table: string, colonnes: string[], lignes: unknown[][]): Promise<void> {
  for (let i = 0; i < lignes.length; i += 1000) {
    const paquet = lignes.slice(i, i + 1000);
    const valeurs: unknown[] = [];
    const tuples = paquet.map(l => `(${l.map(v => { valeurs.push(v); return `$${valeurs.length}`; }).join(', ')})`);
    await client.query(`INSERT INTO ${table} (${colonnes.join(', ')}) VALUES ${tuples.join(', ')}`, valeurs);
  }
}

/** Jours ouvrés (lundi à vendredi) de `du` à `au` inclus. */
function joursOuvres(du: string, au: string): string[] {
  const out: string[] = [];
  for (let j = du; j <= au; j = addD(j, 1)) { const w = new Date(`${j}T12:00:00Z`).getUTCDay(); if (w >= 1 && w <= 5) out.push(j); }
  return out;
}

/**
 * Absences d'un salarié sur une année : congés d'été (2 à 3 semaines), de fin d'année, quelques jours de CP et de RTT,
 * un ou deux arrêts maladie courts, parfois une absence pour enfant malade ; jamais deux le même jour, jamais dans les
 * six dernières semaines (les feuilles soumises de la fin de mois restent validables sans conflit).
 */
function absencesDeLAnnee(r: Aleatoire, annee: number, entree: string, limite: string, pris: Set<string>): { type: string; du: string; au: string }[] {
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
function lignesFeuille(r: Aleatoire, e: Employe, semaine: string, absent: Set<string>, ancienne: boolean, projetsNom: Map<string, string>) {
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

async function supprimerSchemas(): Promise<void> {
  const admin = await connecterAdministration();
  try {
    const { rows } = await admin.query<{ s: string }>('SELECT nspname AS s FROM pg_namespace WHERE nspname LIKE $1 ORDER BY 1', [`${PREFIXE_SCHEMA}%`]);
    for (const { s } of rows) await admin.query(`DROP SCHEMA ${s} CASCADE`);
    console.log(rows.length ? `Schémas de l’essai supprimés : ${rows.map(x => x.s).join(', ')}` : 'Aucun schéma de l’essai sur ce serveur.');
  } finally {
    await admin.end();
  }
}

async function generer(): Promise<void> {
  const args = lireArguments();
  if (args.has('supprimer')) return await supprimerSchemas();
  const ANS = entier(args, 'ans', 5), EFFECTIF = entier(args, 'effectif', 100), INTERIM = entier(args, 'interimaires', 20), GRAINE = entier(args, 'seed', 42);
  if (EFFECTIF > 2000 || ANS > 15) throw new RefusCharge('--effectif 2000 et --ans 15 au plus');
  const r = aleatoire(GRAINE);
  const debutChrono = performance.now();
  const etape = (texte: string) => console.log(`  ${((performance.now() - debutChrono) / 1000).toFixed(1).padStart(6)} s  ${texte}`);

  const url = urlAdministration();
  const admin = await connecterAdministration(url);
  const schema = `${PREFIXE_SCHEMA}${horodatage()}`;
  const base = (await admin.query<{ b: string }>('SELECT current_database() AS b')).rows[0].b;
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  console.log(`Jeu de charge : ${ANS} an${ANS > 1 ? 's' : ''}, ${EFFECTIF} salariés permanents et ${INTERIM} intérimaires, graine ${GRAINE} — schéma ${schema} (base ${base})`);

  const db = await ouvrirPostgres(url, { schema, env: { CURSUS_PG_POOL: '4' } });
  const client = new pg.Client({ connectionString: url, application_name: 'cursus-charge', options: `-c search_path=${schema}` });
  await client.connect();
  try {
    await mettreAJourBase(db);
    await seedDemo(db);
    await db.tx(async () => await comptesDemo(db));
    etape('migrations et référentiel de la démonstration');

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
      // `--effectif` salariés permanents et `--interimaires` intérimaires, fiches de la démonstration comprises.
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
      await inserer(client, 'feuilles', colsFeuille, feuilles);
      await inserer(client, 'absences', ['emp_id', 'type', 'du', 'au', 'statut', 'keystone', 'justificatif'], absences);
      // Les feuilles du mois en attente de lot n'y partent pas.
      if (m >= enAttente) continue;
      // Lot du mois généré au début du mois suivant, à sa date : chaque lot porte sa propre période de paie.
      const suivant = m.endsWith('-12') ? `${Number(m.slice(0, 4)) + 1}-01` : `${m.slice(0, 5)}${String(Number(m.slice(5)) + 1).padStart(2, '0')}`;
      process.env.CURSUS_TODAY = `${suivant}-05`;
      await db.tx(async () => {
        try {
          await ACTIONS['temps.pushSage'](makeCtx(db, RH, await loadFull(db, RH)), {});
          lots++;
        } catch (err) {
          if (!(err instanceof Error && /Aucune feuille/.test(err.message))) throw err;
        }
      });
      process.env.CURSUS_TODAY = today;
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
    await inserer(client, 'feuilles', colsFeuille, recentes);
    // Lots annulés (générés puis annulés avant leur import) : copies de dix lots, contenu compris.
    await client.query(`INSERT INTO lots_paie (cle, mode, statut, periode, periodes, rappels, creation, auteur, feuilles, resume, sans_matricule, contenu, annule_le, annule_par, historique, absences)
      SELECT cle || '-annule', mode, 'annule', periode, periodes, rappels, creation, auteur, feuilles, resume, sans_matricule, contenu, creation, 'Essai de charge', historique, absences
      FROM lots_paie WHERE contenu IS NOT NULL ORDER BY id DESC LIMIT 10`);
    etape(`feuilles, absences et ${lots} lots de paie (+ 10 annulés)`);

    // — Journal à l'état stable, envois, relevés, jetons d'agenda —
    const comptes = (await client.query<{ id: number; emp: number | null }>('SELECT id, emp_id AS emp FROM comptes ORDER BY id')).rows;
    const ids = comptes.map(c => c.id), emps = comptes.map(c => c.emp ?? 0);
    // État stable (conservation d'un an, trois pour l'archive paie) : 300 000 lignes à 3 ans et plus ; jeu réduit des PR
    // (1 an) : 30 000. `--journal N` : autre volume.
    const lignesJournal = entier(args, 'journal', Math.round((ANS >= 3 ? 300_000 : 30_000 * ANS) * EFFECTIF / 100));
    const horsPaie = Math.round(lignesJournal * 2 / 3), paie = lignesJournal - horsPaie;
    const decalage = r.entre(0, 9999);
    await client.query(`INSERT INTO journal (at, actor, role, action, message, payload, compte_id, salaries, paie)
      SELECT now() - make_interval(secs => ((g::bigint * 7919 + $3) % (365 * 86400))::double precision), 'Essai de charge', 'collaborateur',
        ($4::text[])[1 + (g % array_length($4::text[], 1))], 'Ligne d’essai de charge', json_build_object('empId', ($2::int[])[1 + (g % array_length($2::int[], 1))]),
        ($1::int[])[1 + (g % array_length($1::int[], 1))], json_build_array(($2::int[])[1 + (g % array_length($2::int[], 1))]), FALSE
      FROM generate_series(1, $5::int) g`, [ids, emps, decalage, ACTIONS_JOURNAL, horsPaie]);
    // Archive paie : trois ans au plus ; au-delà d'un an, la ligne est archivée (server/src/journal.ts, conservation).
    await client.query(`INSERT INTO journal (at, actor, role, action, message, payload, compte_id, salaries, paie, archivee)
      SELECT t, 'Essai de charge', 'manager', ($4::text[])[1 + (g % array_length($4::text[], 1))], 'Ligne d’essai de charge (paie)',
        json_build_object('empId', ($2::int[])[1 + (g % array_length($2::int[], 1))]), ($1::int[])[1 + (g % array_length($1::int[], 1))],
        json_build_array(($2::int[])[1 + (g % array_length($2::int[], 1))]), TRUE, CASE WHEN t < now() - interval '1 year' THEN t + interval '1 year' END
      FROM generate_series(1, $5::int) g, LATERAL (SELECT now() - make_interval(secs => ((g::bigint * 104729 + $3) % ($6::int * 365 * 86400))::double precision) AS t) x`,
    [ids, emps, decalage, ACTIONS_PAIE, paie, Math.min(ANS, 3)]);
    const envois = Math.round(40_000 * Math.min(ANS, 1) * EFFECTIF / 100);
    await client.query(`INSERT INTO envois (cible, type, cle, contenu, statut, tentatives, creation, tentative, envoi)
      SELECT CASE WHEN g % 10 < 7 THEN 'email' ELSE 'keystone' END, CASE WHEN g % 10 < 7 THEN 'notification' ELSE 'heures.validees' END, 'charge-' || g,
        json_build_object('a', 'essai-' || (g % 997) || '@essai.example', 'objet', 'Message d’essai de charge n° ' || g, 'texte', repeat('Texte d’essai. ', 12)),
        'envoye', 1, c, c, c
      FROM generate_series(1, $1::int) g, LATERAL (SELECT now() - make_interval(secs => ((g::bigint * 7907) % (365 * 86400))::double precision) AS c) x`, [envois]);
    // Relevés des intérimaires : un par agence et par semaine où elle avait des intérimaires, avec son e-mail.
    const releves: unknown[][] = [];
    const envoisReleves: unknown[][] = [];
    for (const a of AGENCES) {
      const leurs = employes.filter(e => e.agence === a.nom);
      for (let w = debut; w < soumises[0]; w = addD(w, 7)) {
        const n = leurs.filter(e => mondayOf(e.entree) <= w).length;
        if (!n) continue;
        const cle = `releve-${a.nom}-${w}`;
        envoisReleves.push(['email', 'releve.interim', cle, JSON.stringify({ a: a.adresse, objet: `Relevé ${a.nom} ${w}` }), 'envoye', 1, `${addD(w, 8)}T09:00:00.000Z`]);
        releves.push([a.nom, w, a.adresse, `${addD(w, 8)}T09:00:00.000Z`, 'Cursus', cle, n, n * 35, 0]);
      }
    }
    await inserer(client, 'envois', ['cible', 'type', 'cle', 'contenu', 'statut', 'tentatives', 'creation'], envoisReleves);
    for (let i = 0; i < releves.length; i += 1000) {
      const paquet = releves.slice(i, i + 1000);
      const valeurs: unknown[] = [];
      const tuples = paquet.map(l => `(${l.map(v => { valeurs.push(v); return `$${valeurs.length}`; }).join(', ')})`);
      await client.query(`INSERT INTO releves (agence, semaine, adresse, creation, par, envoi_id, interimaires, heures, en_attente)
        SELECT x.agence, x.semaine::date, x.adresse, x.creation::timestamptz, x.par, e.id, x.n::int, x.h::numeric, x.att::int
        FROM (VALUES ${tuples.join(', ')}) AS x(agence, semaine, adresse, creation, par, cle, n, h, att) JOIN envois e ON e.cle = x.cle`, valeurs);
    }
    // Jetons d'agenda (flux ICS) de 50 salariés : valeurs tirées de la graine, sans usage hors du schéma jetable.
    const jetonsAgenda: string[] = [];
    const jetons: unknown[][] = [];
    for (const e of employes.slice(0, 50)) {
      const jeton = Buffer.from(Array.from({ length: 32 }, () => r.entre(0, 255))).toString('base64url');
      jetonsAgenda.push(jeton);
      jetons.push([e.id, createHash('sha256').update(jeton).digest('hex'), new Date().toISOString()]);
    }
    await inserer(client, 'jetons_agenda', ['emp_id', 'empreinte', 'cree_le'], jetons);
    await db.resyncIds();
    await client.query('ANALYZE');
    etape('journal, envois, relevés, jetons d’agenda');

    // — Description du jeu —
    const lignesComptes = (await client.query<{ id: number; emp: number | null; profil: string }>('SELECT id, emp_id AS emp, profil_rh AS profil FROM comptes WHERE actif ORDER BY id')).rows;
    const equipesMgr = (await client.query<{ nom: string; mgr: number }>('SELECT nom, manager_id AS mgr FROM equipes WHERE manager_id IS NOT NULL ORDER BY ordre')).rows;
    const presents = new Set(employes.map(e => e.id));
    const managers = equipesMgr.flatMap(q => {
      const c = lignesComptes.find(x => x.emp === q.mgr);
      return c && presents.has(q.mgr) ? [{ compteId: c.id, empId: q.mgr, equipe: q.nom }] : [];
    });
    const volumes: JeuCharge['volumes'] = {};
    for (const t of Object.keys(TABLES)) {
      const nom = snake(t as keyof typeof TABLES);
      const { rows: [v] } = await client.query<{ n: number; o: string }>(`SELECT COUNT(*)::int AS n, pg_total_relation_size('${nom}') AS o FROM ${nom}`);
      volumes[nom] = { lignes: v.n, octets: Number(v.o) };
    }
    const jeu: JeuCharge = {
      schema, base, aujourdhui: today, graine: GRAINE, ans: ANS,
      collaborateurs: lignesComptes.filter(c => c.emp && presents.has(c.emp) && !managers.some(m => m.empId === c.emp)).map(c => ({ compteId: c.id, empId: c.emp! })),
      managers,
      rh: lignesComptes.filter(c => c.profil === 'rh_admin' || c.profil === 'rh_gestionnaire').map(c => c.id),
      paie: lignesComptes.filter(c => c.profil === 'paie').map(c => c.id),
      jetonsAgenda, soumises, semaineCourante, periodePaie, chantier: 'K-2620', volumes,
    };
    const fichier = ecrireJeu(jeu);
    const principales = Object.entries(volumes).filter(([, v]) => v.lignes >= 100).sort((a, b) => b[1].octets - a[1].octets);
    console.log('Tables (lignes, taille sur le serveur, index compris) :');
    for (const [t, v] of principales) console.log(`  ${t.padEnd(28)} ${String(v.lignes).padStart(9)}  ${(v.octets / 1048576).toFixed(1).padStart(7)} Mo`);
    const total = Object.values(volumes).reduce((n, v) => n + v.octets, 0);
    console.log(`Total : ${(total / 1048576).toFixed(1)} Mo. Jeu décrit dans ${fichier}`);
    console.log(`Essai : npm run charge -- --scenario S3 --duree 120 --jeu ${schema}`);
  } finally {
    await client.end();
    await db.fermer();
  }
}

lancer('npm run charge:generer', generer);
