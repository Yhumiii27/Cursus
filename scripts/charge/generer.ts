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
  aleatoire, connecterAdministration, ecrireJeu, entier, horodatage, type JeuCharge, lancer, lireArguments, PREFIXE_SCHEMA,
  RefusCharge, urlAdministration,
} from './commun.ts';
process.env.CURSUS_TODAY ??= '2026-10-10';
// Ni démonstration publiée ni envoi réel : le jeu est chargé hors de tout serveur.
delete process.env.DATABASE_URL;

const { ouvrirPostgres } = await import('../../server/src/db-pg.ts');
const { mettreAJourBase } = await import('../../server/src/demarrage.ts');
const { comptesDemo, seedDemo } = await import('../../server/src/seed.ts');
const { TABLES, snake } = await import('../../server/src/db.ts');
const { addD, mondayOf } = await import('../../shared/dates.ts');
// Fiches, absences, feuilles et lots de paie : fabrique commune avec le banc d'oracle des tests (scripts/charge/fabrique.ts).
const { AGENCES, peuplerJeu } = await import('./fabrique.ts');

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

    // Fiches, absences, feuilles et lots de paie (scripts/charge/fabrique.ts), feuilles et absences insérées en masse.
    const { today, debut, soumises, semaineCourante, periodePaie, employes } = await peuplerJeu(db, r, { ans: ANS, effectif: EFFECTIF, interimaires: INTERIM },
      async (table, colonnes, lignes) => await inserer(client, table, colonnes, lignes), etape);

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
