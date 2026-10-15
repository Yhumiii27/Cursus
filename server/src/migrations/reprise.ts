// Migrations nommées du chantier « reprise depuis Lucca et compteurs datés ».
import { journaliser } from '../comptes.ts';
import { todayIso } from '../dataset.ts';
import type { Db } from '../db.ts';
import type { Migration } from './cadre.ts';

/** Année de prise de la période CP d'une date ISO (colonne SQL) : celle du 1er juin qui la précède (anneeCp de shared/rules/conges.ts). */
const anneeCpSql = (col: string) => `(CAST(substr(${col}, 1, 4) AS INTEGER) - (CASE WHEN substr(${col}, 6) < '06-01' THEN 1 ELSE 0 END))`;

const aDater = (db: Db) => {
  const n = (sql: string) => Number((db.sql.prepare(sql).get() as { n: number }).n);
  return { soldes: n('SELECT COUNT(*) AS n FROM soldes_reprise WHERE arrete_le IS NULL'), reports: n('SELECT COUNT(*) AS n FROM reports WHERE periode IS NULL OR expire IS NULL') };
};

/**
 * Compteurs repris et reports de CP datés. Une base existante n'avait ni date d'arrêté des compteurs repris (déduits à vie
 * de la période en cours : RTT faux au 1er janvier, CP au 1er juin) ni période des reports (reçus jamais échus, accordés
 * jamais appliqués). Les compteurs reçoivent la date de mise en service de cette version (date du jour de la migration) :
 * ils valaient pour les périodes en cours. Les reports sont rattachés à la période de leur date (reçus) ou à la suivante
 * (accordés), avec pour échéance la fin de cette période. Tracé dans le journal (comptes seulement). Base neuve : sans effet.
 */
export const SOLDES_DATES: Migration = {
  nom: 'lot4-reprise-soldes-dates',
  necessaire: db => {
    const x = aDater(db);
    return db.neuve || x.soldes > 0 || x.reports > 0;
  },
  executer: db => {
    const x = aDater(db);
    if (!x.soldes && !x.reports) return;
    const jour = todayIso();
    db.sql.prepare('UPDATE soldes_reprise SET arrete_le = ? WHERE arrete_le IS NULL').run(jour);
    db.sql.exec(`UPDATE reports SET periode = ${anneeCpSql('date')} + (CASE WHEN sens = 'recu' THEN 0 ELSE 1 END) WHERE periode IS NULL`);
    db.sql.exec(`UPDATE reports SET expire = CAST(periode + 1 AS TEXT) || '-05-31' WHERE expire IS NULL`);
    journaliser(db, {
      actor: 'Cursus', role: null, action: 'migration.soldes',
      message: `Reprise : compteurs repris datés du ${jour} (${x.soldes} salariés), ${x.reports} reports de CP rattachés à leur période`,
      payload: { arreteLe: jour, soldes: x.soldes, reports: x.reports },
    });
    return `${x.soldes} compteurs repris datés du ${jour}, ${x.reports} reports rattachés à leur période`;
  },
};
