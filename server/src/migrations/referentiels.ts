// Migrations nommées du chantier « référentiels » : postes du référentiel créés depuis les intitulés déjà saisis sur les
// fiches (t055). Le poste se choisit ensuite dans une liste ; le libellé de la fiche est conservé.
import { key, plural } from '../../../shared/format.ts';
import { journaliser } from '../comptes.ts';
import type { Db } from '../db.ts';
import type { Migration } from './cadre.ts';

/** Fiches dont l'intitulé de poste n'est rattaché à aucun poste du référentiel. */
const SANS_POSTE = `FROM employes WHERE poste_id IS NULL AND TRIM(COALESCE(poste, '')) <> ''`;

/**
 * Rattache chaque fiche sans poste au poste du référentiel de même intitulé (casse, accents et ponctuation ignorés), créé
 * au besoin sans aucune exigence : le statut des salariés ne change pas tant que le service RH n'en déclare pas. Les
 * variantes d'un même intitulé donnent un seul poste, nommé d'après la plus fréquente. Aussi utilisé par le jeu de
 * démonstration (server/src/seed.ts).
 */
export function postesDepuisFiches(db: Db): { postes: { id: number; fiches: number }[]; fiches: number } {
  const fiches = db.sql.prepare(`SELECT id, TRIM(poste) AS poste ${SANS_POSTE} ORDER BY id`).all() as { id: number; poste: string }[];
  const existants = db.sql.prepare('SELECT id, nom FROM postes WHERE archive IS NULL ORDER BY id').all() as { id: number; nom: string }[];
  const groupes = new Map<string, { id: number; poste: string }[]>();
  for (const f of fiches) {
    const k = key(f.poste);
    if (k) groupes.set(k, [...(groupes.get(k) ?? []), f]);
  }
  const postes: { id: number; fiches: number }[] = [];
  const rattacher = db.sql.prepare('UPDATE employes SET poste_id = ?, poste = ? WHERE id = ?');
  for (const [k, liste] of groupes) {
    let poste = existants.find(p => key(p.nom) === k) ?? null;
    if (!poste) {
      // Intitulé le plus fréquent parmi les variantes, le premier saisi à égalité.
      const compte = new Map<string, number>();
      liste.forEach(f => compte.set(f.poste.replace(/\s+/g, ' '), (compte.get(f.poste.replace(/\s+/g, ' ')) ?? 0) + 1));
      const nom = [...compte].sort((a, b) => b[1] - a[1])[0][0].slice(0, 80);
      const id = Number(db.sql.prepare(`INSERT INTO postes (nom, formations, habilitations, archive) VALUES (?, '[]', '[]', NULL)`).run(nom).lastInsertRowid);
      poste = { id, nom };
    }
    liste.forEach(f => rattacher.run(poste.id, poste.nom, f.id));
    postes.push({ id: poste.id, fiches: liste.length });
  }
  return { postes, fiches: fiches.length };
}

/**
 * Postes créés depuis les intitulés des fiches d'une base existante. Tracé dans le journal : identifiants des postes et
 * nombre de fiches rattachées (jamais d'intitulé, saisi librement à l'origine).
 */
export const POSTES = {
  nom: 'lot4-referentiels-postes',
  // Base neuve : exécutée, sans effet (cadre commun) ; base existante : seulement s'il reste des fiches à rattacher.
  necessaire: (db: Db) => db.neuve || Number((db.sql.prepare(`SELECT COUNT(*) AS n ${SANS_POSTE}`).get() as { n: number }).n) > 0,
  executer: (db: Db) => {
    const r = postesDepuisFiches(db);
    if (!r.fiches) return;
    const texte = `${plural(r.postes.length, 'poste', 'postes')} pour ${plural(r.fiches, 'fiche', 'fiches')}`;
    journaliser(db, {
      actor: 'Cursus', role: null, action: 'migration.postes',
      message: `Reprise : ${texte} — exigences à saisir (Référentiels → Postes)`, payload: { postes: r.postes },
    });
    return texte;
  },
} satisfies Migration;
