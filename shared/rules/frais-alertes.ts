// Alertes des lignes d'une note de frais (lot 11, chantier C5) dans le contexte du salarié : justificatifs joints, cumul
// avec les forfaits de grand déplacement et de mission à l'étranger qu'il reçoit déjà de la paie, jours d'absence, barème
// et limites de l'année, doublons. Partagé par les actions (server/src/actions/frais.ts : soumission et contrôle refusés sur
// une alerte bloquante) et les écrans de l'étape 2 (Mes frais, validation du manager, contrôle) : le salarié, le valideur
// et le contrôleur voient les mêmes alertes que celles que le serveur applique : hors du service RH, l'instantané filtré
// n'a pas tout ce qu'elles lisent, et le serveur les y joint toutes calculées (`alertesDesNotes`, `Dataset.alertesFrais`).
// Calculées, jamais stockées (shared/rules/frais-politique.ts pour chaque alerte).
import type { Domain } from '../domain.ts';
import type { LigneFrais, NoteFrais } from '../types.ts';
import { sejoursPaie } from './deplacements-paie.ts';
import { doublonsEmpreinte, indexDoublons, lignesDe } from './frais.ts';
import { cumulsForfait, joursForfait, joursSejour } from './frais-cumul.ts';
import { limitesIk } from './frais-paie.ts';
import { type AlerteFrais, alertesLigne } from './frais-politique.ts';

/** Ce que les alertes lisent de tout l'instantané, préparé une fois pour plusieurs notes. */
interface Preparation {
  sejours: ReturnType<typeof sejoursPaie>;
  /** Justificatifs en vigueur par ligne (lot 12 — C2 : comptés une fois, plutôt qu'un parcours de toutes les pièces par ligne). */
  justificatifs: Map<number, number>;
  parEmpreinte: number[][];
  limites: ReturnType<typeof limitesIk>;
  /** Doublons par clé (salarié, date, montant, commerçant), indexés une fois (lot 12 — C2). */
  doublons: ReturnType<typeof indexDoublons>;
}

/** Nombre de justificatifs de chaque ligne. */
function compterParLigne(pieces: readonly { objetId: number }[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const x of pieces) m.set(x.objetId, (m.get(x.objetId) ?? 0) + 1);
  return m;
}

function preparer(d: Domain): Preparation {
  const pieces = (d.ds.pieces ?? []).filter(x => (x.objet === 'ligneFrais' || x.objet === 'ligneFraisSante') && !x.retireeLe);
  return {
    sejours: sejoursPaie(d), justificatifs: compterParLigne(pieces), parEmpreinte: doublonsEmpreinte(pieces.map(x => ({ ligneId: x.objetId, empreinte: x.empreinte }))), limites: limitesIk(d),
    doublons: indexDoublons(d.ds.lignesFrais ?? [], d.ds.notesFrais ?? []),
  };
}

function alertesAvec(d: Domain, p: Preparation, n: Pick<NoteFrais, 'id' | 'empId'>, lignes: readonly LigneFrais[]): Map<number, AlerteFrais[]> {
  const e = d.emp(n.empId);
  const absent = (j: string) => !!d.absOn(n.empId, j);
  const jours = joursForfait(p.sejours.filter(s => s.empId === n.empId).map(s => joursSejour(s, absent, e?.fin ?? null)));
  const cumuls = new Map(cumulsForfait(lignes, jours).map(c => [c.ligneId, c]));
  const out = new Map<number, AlerteFrais[]>();
  for (const l of lignes) {
    // Limite d'exonération d'après le cumul ordonné de l'année (recalculé : saisie dans le désordre, refus, barème).
    const limiteIk = l.categorie === 'ik' ? p.limites(l) : undefined;
    const doublons = [...new Set([...p.doublons(l), ...p.parEmpreinte.filter(g => g.includes(l.id)).flat().filter(id => id !== l.id)])];
    out.set(l.id, alertesLigne(l, {
      settings: d.ds.settings, today: d.ti, justificatifs: p.justificatifs.get(l.id) ?? 0, forfaits: d.ds.referentiels.forfaitsFrais,
      limiteIk, absent: absent(l.date), cumul: cumuls.get(l.id) ?? null, doublons,
    }));
  }
  return out;
}

/** Alertes de chaque ligne en vigueur d'une note, d'après l'instantané `d` (justificatifs vus par la personne). */
export function alertesDeNote(d: Domain, n: Pick<NoteFrais, 'id' | 'empId'>, lignes: readonly LigneFrais[] = lignesDe(d.ds.lignesFrais, n.id)): Map<number, AlerteFrais[]> {
  return alertesAvec(d, preparer(d), n, lignes);
}

/**
 * Notes dont les alertes décident encore d'une action (soumission, validation, contrôle) : en saisie, soumises ou
 * validées. Les autres (contrôlées, en paiement, payées, annulées) ne changent plus.
 */
export const noteEnCircuit = (n: Pick<NoteFrais, 'statut'>) => n.statut === 'brouillon' || n.statut === 'a_corriger' || n.statut === 'soumise' || n.statut === 'validee';

/**
 * Alertes calculées par le serveur sur l'instantané complet `d` (relecture de l'étape 2) pour les notes en circuit de
 * `notes` et leurs lignes reçues par la vue (`lignesVues`), par identifiant de ligne (tableau vide : aucune alerte) : la
 * vue d'un manager, d'un collaborateur ou de la comptabilité n'a pas tout ce qu'il faut pour les recalculer (chantiers en grand déplacement, absences, empreintes des
 * justificatifs, séjours d'autres salariés). L'écran les affiche telles quelles (`Dataset.alertesFrais`) : ce sont celles
 * que le serveur applique à la soumission et au contrôle.
 */
export function alertesDesNotes(d: Domain, notes: readonly Pick<NoteFrais, 'id' | 'empId' | 'statut'>[], lignesVues: readonly LigneFrais[]): Record<number, AlerteFrais[]> {
  const enCircuit = notes.filter(noteEnCircuit);
  const out: Record<number, AlerteFrais[]> = {};
  if (!enCircuit.length) return out;
  const p = preparer(d);
  const parNote = new Map<number, LigneFrais[]>();
  for (const l of lignesVues) {
    const g = parNote.get(l.noteId);
    if (g) g.push(l);
    else parNote.set(l.noteId, [l]);
  }
  for (const n of enCircuit) {
    const lignes = parNote.get(n.id) ?? [];
    for (const [id, a] of alertesAvec(d, p, n, lignes)) out[id] = a;
  }
  return out;
}
