// Fenêtre des notes de frais dans l'instantané (lot 12, chantier C2, étape 1) : une note payée depuis plus de 13 mois sort
// de la lecture brute, avec ses dépenses et leurs justificatifs (`FENETRES` de server/src/lecture-brute.ts). Elle reste en
// base (conservation comptable de 10 ans, server/src/conservation.ts) et se lit à la demande par la route d'historique
// (server/src/frais-historique.ts). Les règles qui ont besoin de l'historique (indemnités kilométriques de l'année,
// doublons, notes à exporter, déductions d'avance) le lisent en base (server/src/frais-base.ts). Une note hors de la
// fenêtre est archivée : toute écriture qui la vise est refusée (409).
// Étape 2 (option des 2 mois, réponse du propriétaire du 1er novembre 2026, retenue sur la remesure) : les dépenses et
// leurs justificatifs n'entrent dans l'instantané que pour les notes en circuit et celles payées depuis moins de 2 mois
// (`detailEnLigne`) ; les autres notes de la fenêtre y gardent leur en-tête et un résumé calculé en base
// (`ResumeNoteFrais`), leur détail se lit par la route d'historique. `totauxVue` rend les totaux d'une note dans les deux cas.
import { addM } from '../dates.ts';
import type { CategorieFrais, LigneFrais, NoteFrais, ResumeNoteFrais } from '../types.ts';
import { r2, totauxEquipe, totauxNote, type TotauxNote } from './frais.ts';

/** Mois après le paiement pendant lesquels une note reste dans l'instantané (choix par défaut du lot 12). */
export const FENETRE_FRAIS_MOIS = 13;
/** Mois après le paiement pendant lesquels les dépenses d'une note restent dans l'instantané (option des 2 mois). */
export const DETAIL_FRAIS_MOIS = 2;
/** Notes par page de la route d'historique. */
export const HISTORIQUE_FRAIS_PAGE = 100;
/** Période d'une requête d'historique : 24 mois au plus. */
export const HISTORIQUE_FRAIS_MAX_MOIS = 24;

/** Borne de la fenêtre au jour `today` (jour de Paris, AAAA-MM-JJ) : une note payée avant cette date est archivée. */
export const borneFrais = (today: string): string => addM(today, -FENETRE_FRAIS_MOIS);

/** Note payée avant la borne du jour `today` : hors de l'instantané, consultée par l'historique seulement. */
export const noteArchivee = (n: Pick<NoteFrais, 'statut' | 'payeeLe'>, today: string): boolean =>
  n.statut === 'payee' && !!n.payeeLe && n.payeeLe < borneFrais(today);

/** Borne du détail au jour `today` : les dépenses d'une note payée avant cette date ne sont pas dans l'instantané. */
export const borneDetailFrais = (today: string): string => addM(today, -DETAIL_FRAIS_MOIS);

/** Dépenses de la note dans l'instantané au jour `today` : note en circuit, annulée, ou payée depuis moins de 2 mois. */
export const detailEnLigne = (n: Pick<NoteFrais, 'statut' | 'payeeLe'>, today: string): boolean =>
  !(n.statut === 'payee' && !!n.payeeLe && n.payeeLe < borneDetailFrais(today));

/** Résumés indexés par note, gardés pour chaque tableau reçu (l'instantané ne change pas sous l'écran). */
const index = new WeakMap<readonly ResumeNoteFrais[], ReadonlyMap<number, ResumeNoteFrais>>();
/** Résumé de la note `id`, s'il y en a un (note payée depuis plus de 2 mois, dépenses hors de l'instantané). */
export function resumeDe(resumes: readonly ResumeNoteFrais[] | undefined, id: number): ResumeNoteFrais | undefined {
  if (!resumes?.length) return undefined;
  let m = index.get(resumes);
  if (!m) index.set(resumes, m = new Map(resumes.map(r => [r.noteId, r])));
  return m.get(id);
}

/**
 * Totaux d'une note telle que la voit l'écran : calculés sur ses dépenses si elles sont dans l'instantané, sinon repris
 * de son résumé (`resumes`) ; `detail` : faux si le détail se lit à la demande.
 */
export function totauxVue(n: Pick<NoteFrais, 'id'>, lignes: readonly LigneFrais[] | undefined, resumes: readonly ResumeNoteFrais[] | undefined): TotauxNote & { detail: boolean } {
  const r = resumeDe(resumes, n.id);
  if (r) return { lignes: r.depenses, refusees: r.refusees, demande: r.demande, retenu: r.retenu, detail: false };
  return { ...totauxNote((lignes ?? []).filter(l => l.noteId === n.id)), detail: true };
}

/**
 * Totaux montrés au manager (équipe) : notes non médicales et non annulées, dépenses de l'instantané et résumés
 * (`totauxEquipe` de shared/rules/frais.ts, étendu aux notes sans leurs dépenses).
 */
export function totauxEquipeVue(notes: readonly Pick<NoteFrais, 'id' | 'medicale' | 'statut'>[], lignes: readonly LigneFrais[], resumes: readonly ResumeNoteFrais[] | undefined) {
  const retenues = notes.filter(n => !n.medicale && n.statut !== 'annulee');
  const t = totauxEquipe(retenues.filter(n => !resumeDe(resumes, n.id)), lignes);
  let demande = t.demande, retenu = t.retenu, nb = t.lignes, refusees = t.refusees;
  for (const n of retenues) {
    const r = resumeDe(resumes, n.id);
    if (!r) continue;
    demande += r.demande; retenu += r.retenu; nb += r.depenses; refusees += r.refusees;
  }
  return { notes: retenues.length, lignes: nb, refusees, demande: r2(demande), retenu: r2(retenu) };
}

/** Montants retenus par catégorie des notes `ids` : dépenses de l'instantané et résumés des notes sans détail. */
export function retenuParCategorie(ids: ReadonlySet<number>, lignes: readonly LigneFrais[], resumes: readonly ResumeNoteFrais[]): Map<CategorieFrais, number> {
  const out = new Map<CategorieFrais, number>();
  const ajouter = (c: CategorieFrais, v: number) => out.set(c, (out.get(c) ?? 0) + v);
  for (const l of lignes) if (ids.has(l.noteId) && !l.refuseeLe) ajouter(l.categorie, l.montantRetenu ?? l.montantEur);
  for (const r of resumes) if (ids.has(r.noteId)) for (const [c, v] of Object.entries(r.parCategorie) as [CategorieFrais, number][]) ajouter(c, v);
  return out;
}

/** Message du refus d'une écriture sur une note archivée. */
export const refusNoteArchivee = (id: number) =>
  `Note de frais n° ${id} archivée (payée depuis plus de ${FENETRE_FRAIS_MOIS} mois) : elle se consulte dans l’historique, sans modification`;

/** Mois AAAA-MM d'un paramètre (AAAA-MM ou AAAA-MM-JJ), ou null. */
export function moisDe(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-(\d{2}))?$/.exec(v);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** Nombre de mois de `du` à `au` inclus (AAAA-MM). */
export const moisEntre = (du: string, au: string) => (Number(au.slice(0, 4)) * 12 + Number(au.slice(5, 7))) - (Number(du.slice(0, 4)) * 12 + Number(du.slice(5, 7))) + 1;

/**
 * Période d'une recherche dans l'historique (mois des dépenses de la note, `periode`) : `du` et `au` en AAAA-MM ou
 * AAAA-MM-JJ (le mois seul compte) ; par défaut les 24 derniers mois jusqu'au mois de `today`. Erreur en clair si la
 * période est invalide, à l'envers ou dépasse 24 mois.
 */
export function periodeHistorique(q: { du?: unknown; au?: unknown }, today: string): { du: string; au: string } | { erreur: string } {
  const vide = (v: unknown) => v === undefined || v === null || v === '';
  const au = vide(q.au) ? today.slice(0, 7) : moisDe(q.au);
  if (!au) return { erreur: 'Fin de période invalide (AAAA-MM)' };
  const du = vide(q.du) ? addM(`${au}-01`, -(HISTORIQUE_FRAIS_MAX_MOIS - 1)).slice(0, 7) : moisDe(q.du);
  if (!du) return { erreur: 'Début de période invalide (AAAA-MM)' };
  if (du > au) return { erreur: 'Période à l’envers : le début suit la fin' };
  if (moisEntre(du, au) > HISTORIQUE_FRAIS_MAX_MOIS) return { erreur: `Période de ${HISTORIQUE_FRAIS_MAX_MOIS} mois au plus par recherche` };
  return { du, au };
}
