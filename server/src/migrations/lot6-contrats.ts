// Migrations nommées du chantier « contrats » (lot 6) : historique des contrats amorcé depuis les fiches (t074).
// Une base existante n'a qu'une date d'effet par fiche (`tempsDepuis`) : l'historique part de l'entrée, avec le régime
// de la fiche, ou, quand le régime a changé depuis l'entrée, avec les régimes figés des feuilles de temps antérieures au
// changement (garde-fou des lots 4 et 5), à défaut un régime inconnu. Un régime inconnu laisse chaque calcul comme avant
// l'historique (shared/rules/historique-contrat.ts) : un salarié qui n'a eu qu'un seul régime garde exactement les mêmes
// droits ; aucune période clôturée ni aucun compteur repris n'est recalculé (tests/contrats-historique.test.ts).
// Aussi utilisé par le jeu de démonstration (server/src/seed.ts), comme `postesDepuisFiches`.
import { plural } from '../../../shared/format.ts';
import type { ISODate } from '../../../shared/types.ts';
import { journaliser } from '../comptes.ts';
import { todayIso } from '../dataset.ts';
import type { Db } from '../db.ts';
import type { Migration } from './cadre.ts';

/** Fiches sans aucune ligne d'historique. */
const SANS_HISTORIQUE = 'FROM employes e WHERE NOT EXISTS (SELECT 1 FROM contrats_historique h WHERE h.emp_id = e.id)';
const sansHistorique = async (db: Db) => Number(((await db.one(`SELECT COUNT(*) AS n ${SANS_HISTORIQUE}`)) as { n: number }).n);

interface Fiche {
  id: number; statut: string; type_contrat: string; temps: string; heures: number | null; forfait_heures: number | null; forfait_jours: number | null;
  jour_off: string | null; temps_depuis: string | null; entree: string; fin: string | null; motif_sortie: string | null; fin_prevue: string | null;
  cdd_fin_initiale: string | null;
}

/** Régime d'une fiche, dans l'ordre des clés de `contratFige` (shared/rules/temps.ts), comme sur les feuilles figées. */
const regimeDe = (f: Fiche) => JSON.stringify({
  statut: f.statut, typeContrat: f.type_contrat, temps: f.temps, heures: f.heures, forfaitHeures: f.forfait_heures, forfaitJours: f.forfait_jours,
  jourOff: f.jour_off ? JSON.parse(f.jour_off) as number[] : [],
});

/**
 * Lignes d'historique des fiches qui n'en ont pas : embauche à l'entrée (terme prévu d'un contrat à durée déterminée),
 * puis, pour une fiche dont le régime a changé après l'entrée (`tempsDepuis`), les régimes figés des feuilles antérieures
 * au changement (un par suite de semaines, daté du lundi de la première), à défaut un régime inconnu à l'entrée, et
 * l'avenant à la date d'effet, au régime de la fiche. Les feuilles figées sur le régime actuel avant cette date (soumises
 * après le changement) sont écartées. Sortie enregistrée : sa date clôt la dernière ligne. SQL seulement, idempotente.
 */
export async function historiqueDepuisFiches(db: Db, le: ISODate = todayIso(), empId: number | null = null): Promise<{ salaries: number; lignes: number }> {
  // `empId` : une seule fiche (première ligne écrite par une action sur une fiche d'avant l'historique, server/src/avenants.ts).
  const fiches = (await db.query(`SELECT e.id, e.statut, e.type_contrat, e.temps, e.heures, e.forfait_heures, e.forfait_jours, e.jour_off, e.temps_depuis,
    e.entree, e.fin, e.motif_sortie, e.fin_prevue, e.cdd_fin_initiale ${SANS_HISTORIQUE} AND (? IS NULL OR e.id = ?) ORDER BY e.id`, [empId, empId])) as unknown as Fiche[];
  const inserer = async (...v: (string | number | null)[]) => (await db.insert<{ id: number }>('contratsHistorique', {
    empId: v[0], effet: v[1], nature: v[2], regime: v[3] == null ? null : JSON.parse(String(v[3])), jusquau: v[4], le: v[5], par: 'Cursus', applique: true, fin: null,
  })).id;
  const feuilles = async (empId: number, avant: string) => await db.query('SELECT week, contrat FROM feuilles WHERE emp_id = ? AND contrat IS NOT NULL AND week < ? ORDER BY week', [empId, avant]);
  let lignes = 0;
  for (const f of fiches) {
    const regime = regimeDe(f);
    // Terme prévu au contrat (CDD, mission, alternance), avant toute sortie enregistrée ; terme initial d'un CDD renouvelé.
    const terme = f.type_contrat === 'cdi' ? null : f.cdd_fin_initiale ?? (f.motif_sortie ? f.fin_prevue : f.fin);
    const suite: { effet: string; nature: string; regime: string | null }[] = [];
    if (!f.temps_depuis || f.temps_depuis <= f.entree) suite.push({ effet: f.entree, nature: 'embauche', regime });
    else {
      const figes = ((await feuilles(f.id, f.temps_depuis)) as { week: string; contrat: unknown }[]).map(x => ({ ...x, contrat: typeof x.contrat === 'string' ? x.contrat : JSON.stringify(x.contrat) }))
        .filter(x => x.contrat !== regime)
        .filter((x, i, l) => i === 0 || l[i - 1].contrat !== x.contrat);
      if (!figes.length) suite.push({ effet: f.entree, nature: 'embauche', regime: null });
      else figes.forEach((x, i) => suite.push({ effet: i === 0 ? f.entree : x.week, nature: i === 0 ? 'embauche' : 'avenant', regime: x.contrat }));
      suite.push({ effet: f.temps_depuis, nature: 'avenant', regime });
    }
    for (const [i, l] of suite.entries()) {
      const id = await inserer(f.id, l.effet, l.nature, l.regime, i === 0 ? terme : null, le);
      if (i === suite.length - 1 && f.motif_sortie) await db.run('UPDATE contrats_historique SET fin = ? WHERE id = ?', [f.fin, id]);
    }
    lignes += suite.length;
  }
  return { salaries: fiches.length, lignes };
}

/**
 * Historique des contrats amorcé depuis les fiches d'une base existante (t074). Tracé dans le journal : nombre de fiches
 * et de lignes (jamais de régime nominatif).
 */
export const CONTRATS_HISTORIQUE: Migration = {
  nom: 'lot6-contrats-historique',
  // Base neuve : exécutée, sans effet ; base existante : seulement s'il reste des fiches sans historique.
  necessaire: async db => db.neuve || (await sansHistorique(db)) > 0,
  executer: async db => {
    const r = await historiqueDepuisFiches(db);
    if (!r.salaries) return;
    const texte = `${plural(r.lignes, 'ligne', 'lignes')} pour ${plural(r.salaries, 'fiche', 'fiches')}`;
    await journaliser(db, {
      actor: 'Cursus', role: null, action: 'migration.contratsHistorique',
      message: `Reprise : historique des contrats amorcé depuis les fiches (${texte})`, payload: { salaries: r.salaries, lignes: r.lignes },
    });
    return texte;
  },
};
