// Fenêtre des notes de frais dans l'instantané (lot 12, chantier C2, étape 1) : une note payée depuis plus de 13 mois sort
// de la lecture brute, avec ses dépenses et leurs justificatifs (`FENETRES` de server/src/lecture-brute.ts). Elle reste en
// base (conservation comptable de 10 ans, server/src/conservation.ts) et se lit à la demande par la route d'historique
// (server/src/frais-historique.ts). Les règles qui ont besoin de l'historique (indemnités kilométriques de l'année,
// doublons, notes à exporter, déductions d'avance) le lisent en base (server/src/frais-base.ts). Une note hors de la
// fenêtre est archivée : toute écriture qui la vise est refusée (409).
// Étape 2 (option des 2 mois, réponse du propriétaire du 1er novembre 2026, retenue sur la remesure) : les vues du service
// RH et de la comptabilité — elles seules, comme le dit la réponse — ne reçoivent les dépenses et leurs justificatifs que
// des notes en circuit et de celles payées depuis moins de 2 mois (`detailEnLigne`, appliquée par server/src/frais-vues.ts
// à l'instantané complet) ; les autres notes de la fenêtre y gardent leur en-tête et un résumé calculé par le serveur
// (`resumesDesLignes`), leur détail se lit par la route d'historique. Le manager et le collaborateur gardent le détail des
// 13 mois. `totauxVue` rend les totaux d'une note dans les deux cas ; la part réintégrable de chaque note est calculée par
// le serveur sur l'instantané complet (`reintegrableDesNotes`), cumul kilométrique de l'année compris.
import { addM } from '../dates.ts';
import type { CategorieFrais, LigneFrais, NoteFrais, ResumeNoteFrais } from '../types.ts';
import type { Domain } from '../domain.ts';
import { r2, totauxEquipe, totauxNote, type TotauxNote } from './frais.ts';
import { limitesIk } from './frais-paie.ts';
import { reintegrable } from './frais-politique.ts';

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

/**
 * Dépenses de la note dans les vues du service RH et de la comptabilité au jour `today` : note en circuit, annulée, ou
 * payée depuis moins de 2 mois (une note payée sans date de paiement est gardée détaillée). Seule définition de la règle.
 */
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

/**
 * Résumés des notes `notes` d'après leurs dépenses `lignes` (dépenses du salarié de la note seulement, comme
 * `lignesDesNotes`) : nombre de dépenses en vigueur et refusées, montants demandé et retenu, retenu par catégorie (ordre
 * alphabétique), arrondis au centime ; une note sans dépense a un résumé nul.
 */
export function resumesDesLignes(notes: readonly Pick<NoteFrais, 'id' | 'empId'>[], lignes: readonly LigneFrais[]): ResumeNoteFrais[] {
  const parNote = new Map<number, LigneFrais[]>(notes.map(n => [n.id, []]));
  const empDe = new Map(notes.map(n => [n.id, n.empId]));
  for (const l of lignes) if (empDe.get(l.noteId) === l.empId) parNote.get(l.noteId)!.push(l);
  return notes.map(n => {
    const ls = parNote.get(n.id)!, t = totauxNote(ls);
    const cat = new Map<string, number>();
    for (const l of ls) if (!l.refuseeLe) cat.set(l.categorie, (cat.get(l.categorie) ?? 0) + (l.montantRetenu ?? l.montantEur));
    return {
      noteId: n.id, empId: n.empId, depenses: t.lignes, refusees: t.refusees, demande: t.demande, retenu: t.retenu,
      parCategorie: Object.fromEntries([...cat].sort(([a], [b]) => a.localeCompare(b)).map(([c, v]) => [c, r2(v)])),
    };
  });
}

/**
 * Part réintégrable de chaque note `notes` (allocations forfaitaires et indemnités kilométriques au-delà des limites
 * d'exonération, comme `totalReintegrable` des alertes), calculée sur l'instantané `d` — complet côté serveur : cumul
 * kilométrique de toute l'année ; limites manquantes non comptées. Notes sans part réintégrable absentes.
 */
export function reintegrableDesNotes(d: Pick<Domain, 'ds'>, notes: readonly Pick<NoteFrais, 'id' | 'empId'>[]): Record<number, number> {
  const ids = new Map(notes.map(n => [n.id, n.empId]));
  // Limites kilométriques sur les seules indemnités (`limitesIk` relit, pour chaque salarié et chaque année, les dépenses
  // qu'on lui donne) : même résultat, sans parcourir toutes les dépenses à chaque salarié.
  const ik = (d.ds.lignesFrais ?? []).filter(l => l.categorie === 'ik');
  const limites = limitesIk({ ds: { ...d.ds, lignesFrais: ik } }), forfaits = d.ds.referentiels.forfaitsFrais;
  const parNote = new Map<number, number>();
  for (const l of d.ds.lignesFrais ?? []) {
    if (ids.get(l.noteId) !== l.empId || (l.categorie !== 'ik' && l.categorie !== 'forfait')) continue;
    const r = reintegrable(l, { forfaits, limiteIk: l.categorie === 'ik' ? limites(l) : undefined });
    if (r) parNote.set(l.noteId, (parNote.get(l.noteId) ?? 0) + r);
  }
  return Object.fromEntries([...parNote].filter(([, v]) => v > 0).map(([id, v]) => [id, r2(v)]));
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
