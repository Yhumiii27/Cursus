// Alertes des lignes d'une note de frais (lot 11, chantier C5) dans le contexte du salarié : justificatifs joints, cumul
// avec les forfaits de grand déplacement et de mission à l'étranger qu'il reçoit déjà de la paie, jours d'absence, barème
// et limites de l'année, doublons. Partagé par les actions (server/src/actions/frais.ts : soumission et contrôle refusés sur
// une alerte bloquante) et les écrans de l'étape 2 (Mes frais, validation du manager, contrôle) : le salarié, le valideur
// et le contrôleur voient les mêmes alertes que celles que le serveur applique. Calculées, jamais stockées
// (shared/rules/frais-politique.ts pour chaque alerte).
import type { Domain } from '../domain.ts';
import type { LigneFrais, NoteFrais } from '../types.ts';
import { sejoursPaie } from './deplacements-paie.ts';
import { doublonsDe, doublonsEmpreinte, lignesDe } from './frais.ts';
import { cumulsForfait, joursForfait, joursSejour } from './frais-cumul.ts';
import { limitesIk } from './frais-paie.ts';
import { type AlerteFrais, alertesLigne } from './frais-politique.ts';

/** Alertes de chaque ligne en vigueur d'une note, d'après l'instantané `d` (justificatifs vus par la personne). */
export function alertesDeNote(d: Domain, n: Pick<NoteFrais, 'id' | 'empId'>, lignes: readonly LigneFrais[] = lignesDe(d.ds.lignesFrais, n.id)): Map<number, AlerteFrais[]> {
  const e = d.emp(n.empId);
  const absent = (j: string) => !!d.absOn(n.empId, j);
  const jours = joursForfait(sejoursPaie(d).filter(s => s.empId === n.empId).map(s => joursSejour(s, absent, e?.fin ?? null)));
  const cumuls = new Map(cumulsForfait(lignes, jours).map(c => [c.ligneId, c]));
  const pieces = (d.ds.pieces ?? []).filter(x => (x.objet === 'ligneFrais' || x.objet === 'ligneFraisSante') && !x.retireeLe);
  const parEmpreinte = doublonsEmpreinte(pieces.map(x => ({ ligneId: x.objetId, empreinte: x.empreinte })));
  const out = new Map<number, AlerteFrais[]>();
  const limites = limitesIk(d);
  for (const l of lignes) {
    // Limite d'exonération d'après le cumul ordonné de l'année (recalculé : saisie dans le désordre, refus, barème).
    const limiteIk = l.categorie === 'ik' ? limites(l) : undefined;
    const doublons = [...new Set([...doublonsDe(l, d.ds.lignesFrais ?? [], d.ds.notesFrais ?? []), ...parEmpreinte.filter(g => g.includes(l.id)).flat().filter(id => id !== l.id)])];
    out.set(l.id, alertesLigne(l, {
      settings: d.ds.settings, today: d.ti, justificatifs: pieces.filter(x => x.objetId === l.id).length, forfaits: d.ds.referentiels.forfaitsFrais,
      limiteIk, absent: absent(l.date), cumul: cumuls.get(l.id) ?? null, doublons,
    }));
  }
  return out;
}
