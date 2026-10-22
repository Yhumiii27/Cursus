// Migrations nommées du chantier « référentiels » : postes du référentiel créés depuis les intitulés déjà saisis sur les
// fiches (t055). Le poste se choisit ensuite dans une liste ; le libellé de la fiche est conservé.
// Le rattachement ne dépend pas de cette migration, faite une fois : `rattacherFiches` le rejoue à chaque démarrage
// (server/src/migrate.ts) et après un import qui écrit les fiches directement (reprise depuis Lucca, chantier 2), et le
// statut applique entre-temps les exigences du poste de même intitulé (`posteDe` de shared/rules/exigences.ts).
import { key, plural } from '../../../shared/format.ts';
import { journaliser } from '../comptes.ts';
import type { Db } from '../db.ts';
import type { Migration } from './cadre.ts';

/** Fiches dont l'intitulé de poste n'est rattaché à aucun poste du référentiel. */
const SANS_POSTE = `FROM employes WHERE poste_id IS NULL AND TRIM(COALESCE(poste, '')) <> ''`;

/**
 * Rattache chaque fiche sans poste au poste du référentiel de même intitulé (casse, accents et ponctuation ignorés), créé
 * au besoin sans aucune exigence : le statut des salariés ne change pas tant que le service RH n'en déclare pas. Les
 * variantes d'un même intitulé donnent un seul poste, nommé d'après la plus fréquente (à égalité, une forme qui n'est
 * pas tout en capitales, puis la première saisie) ; l'intitulé saisi sur chaque fiche est gardé tel quel. Idempotente :
 * seules les fiches sans poste sont lues. Aussi utilisé par le jeu de démonstration (server/src/seed.ts).
 */
export async function postesDepuisFiches(db: Db): Promise<{ postes: { id: number; fiches: number }[]; fiches: number }> {
  const fiches = await db.query(`SELECT id, TRIM(poste) AS poste ${SANS_POSTE} ORDER BY id`) as { id: number; poste: string }[];
  const existants = await db.query('SELECT id, nom FROM postes WHERE archive IS NULL ORDER BY id') as { id: number; nom: string }[];
  const groupes = new Map<string, { id: number; poste: string }[]>();
  for (const f of fiches) {
    const k = key(f.poste);
    if (k) groupes.set(k, [...(groupes.get(k) ?? []), f]);
  }
  const postes: { id: number; fiches: number }[] = [];
  for (const [k, liste] of groupes) {
    let poste = existants.find(p => key(p.nom) === k) ?? null;
    if (!poste) {
      // Intitulé le plus fréquent parmi les variantes ; à égalité, pas tout en capitales, puis le premier saisi (tri stable).
      const compte = new Map<string, number>();
      liste.forEach(f => compte.set(f.poste.replace(/\s+/g, ' '), (compte.get(f.poste.replace(/\s+/g, ' ')) ?? 0) + 1));
      const capitales = (t: string) => Number(t === t.toUpperCase() && t !== t.toLowerCase());
      const nom = [...compte].sort((a, b) => b[1] - a[1] || capitales(a[0]) - capitales(b[0]))[0][0].slice(0, 80);
      const id = Number((await db.run(`INSERT INTO postes (nom, formations, habilitations, archive) VALUES (?, '[]', '[]', NULL)`, [nom])).lastInsertRowid);
      poste = { id, nom };
    }
    for (const f of liste) await db.run('UPDATE employes SET poste_id = ? WHERE id = ?', [poste.id, f.id]);
    postes.push({ id: poste.id, fiches: liste.length });
  }
  return { postes, fiches: fiches.length };
}

/** Nombre de fiches qui ont un intitulé sans poste du référentiel. */
const sansPoste = async (db: Db) => Number((await db.one(`SELECT COUNT(*) AS n ${SANS_POSTE}`) as { n: number }).n);

/** Rattachement des fiches sans poste, tracé au journal (`migration.postes`) ; compte rendu, ou rien s'il n'y en avait pas. */
async function rattacherTrace(db: Db): Promise<string | void> {
  const r = await postesDepuisFiches(db);
  if (!r.fiches) return;
  const texte = `${plural(r.postes.length, 'poste', 'postes')} pour ${plural(r.fiches, 'fiche', 'fiches')}`;
  await journaliser(db, {
    actor: 'Cursus', role: null, action: 'migration.postes',
    message: `Reprise : ${texte} — exigences à saisir (Référentiels → Postes)`, payload: { postes: r.postes },
  });
  return texte;
}

/**
 * Fiches écrites sans poste du référentiel par un autre chemin que la fiche (`employe.creer`, `employe.modifier`) :
 * import ou reprise des salariés, base antérieure. Rattachées au poste de même intitulé, créé au besoin sans exigence,
 * et tracées au journal. Rejoué à chaque démarrage (server/src/migrate.ts ; `avant` : copie de la base) ; un import qui
 * écrit les fiches directement l'appelle aussi à la fin de son écriture, dans sa transaction (`db.tx` s'y imbrique), et
 * ne remet pas `posteId` à null sur une fiche qui en a un. Sans fiche à rattacher : rien n'est fait.
 */
export async function rattacherFiches(db: Db, avant = () => {}): Promise<string | void> {
  if (!await sansPoste(db)) return;
  avant();
  const texte = await db.tx(async () => await rattacherTrace(db));
  if (texte) console.log(`Migration : fiches rattachées au référentiel des postes (${texte}).`);
  return texte;
}

/**
 * Postes créés depuis les intitulés des fiches d'une base existante. Tracé dans le journal : identifiants des postes et
 * nombre de fiches rattachées (jamais d'intitulé, saisi librement à l'origine).
 */
export const POSTES = {
  nom: 'lot4-referentiels-postes',
  // Base neuve : exécutée, sans effet (cadre commun) ; base existante : seulement s'il reste des fiches à rattacher.
  // Au démarrage du serveur, `rattacherFiches` (server/src/migrate.ts) passe avant et la laisse le plus souvent sans objet.
  necessaire: async (db: Db) => db.neuve || await sansPoste(db) > 0,
  executer: async (db: Db) => await rattacherTrace(db),
} satisfies Migration;
