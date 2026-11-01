// Planning d'équipe du jeu de charge (lot 12, chantier C5, étape 1) : critère de l'étape — mesurer l'instantané avec trois
// ans de créneaux avant d'activer le module (réglage `planningActif`). Chaque salarié affecté au cycle 3x8 (groupes A, B,
// C tournants), un créneau par jour (repos compris : environ 36 500 lignes par an pour 100 salariés), publiés jusqu'à la
// semaine qui suit, en brouillon les 11 semaines suivantes ; une publication par équipe et par semaine ; quelques
// modifications remplacées et quelques échanges validés. Insertions en masse (`inserer`, comme les feuilles de la
// fabrique). Mesure : npm run charge:planning (scripts/charge/mesure-planning.ts).
import { addD, mondayOf } from '../../shared/dates.ts';
import { CYCLES_MODELES, horaireDuCycle } from '../../shared/rules/cycles.ts';
import { HORAIRES_EXEMPLES } from '../../shared/rules/horaires.ts';
import type { Employe } from '../../shared/types.ts';
import type { Db } from '../../server/src/db.ts';
import type { Aleatoire } from './commun.ts';
import type { InsererLignes } from './fabrique.ts';

export interface OptionsPlanning { ans: number; semainesAVenir: number }
/** Ce que la fabrique du planning a posé. */
export interface JeuPlanning { roulements: number; creneaux: number; publications: number; echanges: number }

/**
 * Peuple le planning de `ans` années (et `semainesAVenir` semaines au-delà de `today`) pour les salariés `employes` ;
 * identifiants consécutifs attribués à partir du plus grand de chaque table.
 */
export async function peuplerPlanning(db: Db, r: Aleatoire, employes: readonly Pick<Employe, 'id' | 'equipe'>[], today: string, o: OptionsPlanning, inserer: InsererLignes): Promise<JeuPlanning> {
  const suivant = async (table: string) => Number((await db.one<{ n: number }>(`SELECT COALESCE(MAX(id), 0) AS n FROM ${table}`))?.n ?? 0) + 1;
  const cycle = CYCLES_MODELES.find(c => c.code === '3X8')!;
  const horaires = new Map(HORAIRES_EXEMPLES.map(h => [h.code, h]));
  const debut = mondayOf(addD(today, -365 * o.ans)), fin = addD(mondayOf(today), 7 * o.semainesAVenir - 1), publieJusqua = addD(mondayOf(today), 13);
  const roulements: unknown[][] = [];
  const groupe = new Map<number, string>();
  for (const [i, e] of employes.entries()) {
    const g = cycle.groupes[i % cycle.groupes.length].code;
    groupe.set(e.id, g);
    roulements.push([e.id, cycle.code, g, debut, null, e.equipe, `${debut}T08:00:00.000Z`, 'Essai de charge']);
  }
  await inserer('roulements', ['emp_id', 'cycle', 'groupe', 'du', 'au', 'equipe', 'cree_le', 'cree_par'], roulements);
  let id = await suivant('creneaux'), creneaux = 0, echanges = 0;
  const publications: unknown[][] = [];
  const versions = new Map<string, number>();
  for (let w = debut; w <= fin; w = addD(w, 7)) {
    const lignes: unknown[][] = [], echangesSemaine: unknown[][] = [];
    const publiee = w <= publieJusqua;
    const equipes = new Set<string>();
    for (const e of employes) {
      for (let k = 0; k < 7; k++) {
        const jour = addD(w, k), code = horaireDuCycle(cycle, groupe.get(e.id)!, jour), h = code ? horaires.get(code)! : null;
        const base = [e.id, jour, e.equipe, h?.code ?? null, h?.debut ?? null, h?.fin ?? null, h?.pause ?? 0, 'cycle'];
        if (publiee && h && r.si(0.01)) {
          // Modification publiée : l'ancienne version remplacée, gardée.
          lignes.push([id, ...base, 'remplace', null, 1, `${w}T08:00:00.000Z`, 'Essai de charge', addD(w, -10), false, null, null, null, `${w}T08:00:00.000Z`, 'Essai de charge']);
          lignes.push([id + 1, ...base.slice(0, 7), 'manuel', 'publie', id, 2, `${w}T09:00:00.000Z`, 'Essai de charge', addD(w, -3), true, 'Circonstances exceptionnelles (essai)', null, null, `${w}T09:00:00.000Z`, 'Essai de charge']);
          id += 2;
          creneaux += 2;
          continue;
        }
        if (publiee && h && r.si(0.002)) echangesSemaine.push([e.id, employes[(employes.indexOf(e) + 1) % employes.length].id, id, null, 'valide', `${w}T08:00:00.000Z`, `${w}T09:00:00.000Z`, `${w}T10:00:00.000Z`, 'Essai de charge']);
        lignes.push([id++, ...base, publiee ? 'publie' : 'brouillon', null, publiee ? 1 : null, publiee ? `${w}T08:00:00.000Z` : null, publiee ? 'Essai de charge' : null,
          publiee ? addD(w, -10) : null, false, null, null, null, `${w}T08:00:00.000Z`, 'Essai de charge']);
        creneaux++;
        if (e.equipe) equipes.add(e.equipe);
      }
    }
    await inserer('creneaux', ['id', 'emp_id', 'jour', 'equipe', 'horaire', 'debut', 'fin', 'pause', 'source', 'statut', 'remplace_id', 'version', 'publie_le', 'publie_par',
      'communique_le', 'hors_delai', 'motif', 'motif_alertes', 'alertes_acceptees', 'cree_le', 'cree_par'], lignes);
    await inserer('echanges_poste', ['demandeur_id', 'partenaire_id', 'creneau_demandeur', 'creneau_partenaire', 'statut', 'cree_le', 'accepte_le', 'decide_le', 'decide_par'], echangesSemaine);
    echanges += echangesSemaine.length;
    if (publiee) {
      for (const q of equipes) {
        const v = (versions.get(q) ?? 0) + 1;
        versions.set(q, v);
        publications.push([q, w, addD(w, 6), v, `${w}T08:00:00.000Z`, 'Essai de charge', addD(w, -10), employes.filter(e => e.equipe === q).length * 7, 0]);
      }
    }
  }
  await inserer('publications_planning', ['equipe', 'du', 'au', 'version', 'publie_le', 'publie_par', 'communique_le', 'creneaux', 'hors_delai'], publications);
  return { roulements: roulements.length, creneaux, publications: publications.length, echanges };
}
