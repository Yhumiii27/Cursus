// Dépenses des notes de frais médicaux à part (lot 12, chantier C2, étape 2 : scission, choix par défaut du chantier) :
// une note médicale range ses dépenses dans `lignes_frais_sante`, fermée en entier à Matrix et inscrite au journal des
// changements par le seul marqueur « toute la table » ; les autres dépenses restent dans `lignes_frais`, inscrites par
// clé, que le delta d'une dépense relit ligne à ligne (server/src/delta.ts). Les deux tables partagent leurs
// identifiants : l'instantané les réunit dans `lignesFrais` (server/src/lecture-brute.ts), une dépense, ses justificatifs
// (`objet_id`) et ses alertes se désignent par ce seul identifiant. Une note ne change jamais de nature (`medicale` est
// fixé à la création), ses dépenses jamais de table.
import type { LigneFrais, NoteFrais } from '../../shared/types.ts';
import type { Db } from './db.ts';

/** Table des dépenses d'une note : frais médicaux à part. */
export const tableLignesFrais = (n: Pick<NoteFrais, 'medicale'>): 'lignesFrais' | 'lignesFraisSante' => (n.medicale ? 'lignesFraisSante' : 'lignesFrais');

/** Dernier identifiant donné par la séquence de `lignes_frais` (0 : aucun). */
async function sequenceLignes(db: Db): Promise<number> {
  const r = db.moteur === 'pg'
    ? await db.one<{ n: number | null }>(`SELECT pg_sequence_last_value(pg_get_serial_sequence('lignes_frais', 'id')) AS n`)
    : await db.one<{ n: number | null }>(`SELECT seq AS n FROM sqlite_sequence WHERE name = 'lignes_frais'`);
  return Number(r?.n ?? 0);
}

/**
 * Identifiant de la prochaine dépense, commun aux deux tables : au-delà de tout identifiant déjà donné (plus grand des deux
 * tables et séquence de `lignes_frais`, jamais réutilisé). Écritures sérialisées (transaction des actions) : deux
 * insertions ne prennent jamais le même.
 */
async function prochainIdLigne(db: Db): Promise<number> {
  const max = await db.one<{ n: number | null }>('SELECT MAX(n) AS n FROM (SELECT MAX(id) AS n FROM lignes_frais UNION ALL SELECT MAX(id) FROM lignes_frais_sante) t');
  return Math.max(Number(max?.n ?? 0), await sequenceLignes(db)) + 1;
}

/** Séquence de `lignes_frais` portée au moins à `id` : une insertion qui la suit (démonstration, essais) ne le reprend pas. */
async function avancerSequence(db: Db, id: number): Promise<void> {
  if (db.moteur === 'pg') {
    await db.query(`SELECT setval(pg_get_serial_sequence('lignes_frais', 'id'), ?) WHERE COALESCE(pg_sequence_last_value(pg_get_serial_sequence('lignes_frais', 'id')), 0) < ?`, [id, id]);
    return;
  }
  const r = await db.run(`UPDATE sqlite_sequence SET seq = ? WHERE name = 'lignes_frais' AND seq < ?`, [id, id]);
  if (!r.changes && !await db.one(`SELECT 1 AS x FROM sqlite_sequence WHERE name = 'lignes_frais'`)) await db.run(`INSERT INTO sqlite_sequence (name, seq) VALUES ('lignes_frais', ?)`, [id]);
}

/** Dépense ajoutée à la note `n`, dans la table de sa nature, avec un identifiant commun aux deux tables. */
export async function insererLigneFrais(db: Db, n: Pick<NoteFrais, 'medicale'>, champs: Partial<LigneFrais>): Promise<LigneFrais> {
  const id = await prochainIdLigne(db);
  const l = await db.insert<LigneFrais>(tableLignesFrais(n), { ...champs, id });
  if (n.medicale) await avancerSequence(db, id);
  return l;
}

/** Dépense désignée par son identifiant, dans l'une ou l'autre table, et sa table ; undefined si elle n'existe pas. */
export async function ligneFraisParId(db: Db, id: number): Promise<{ l: LigneFrais; table: 'lignesFrais' | 'lignesFraisSante' } | undefined> {
  const l = await db.get<LigneFrais>('lignesFrais', id);
  if (l) return { l, table: 'lignesFrais' };
  const s = await db.get<LigneFrais>('lignesFraisSante', id);
  return s ? { l: s, table: 'lignesFraisSante' } : undefined;
}
