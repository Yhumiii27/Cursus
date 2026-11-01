// Entretien planifié retiré (lot 12, chantier C3) : annulation par l'évaluateur ou le service RH (`entretien.annuler`,
// server/src/actions/annulation-entretien.ts), ou à la sortie du salarié (server/src/actions/sorties.ts). Avant que la
// ligne ne parte, ce qui la désigne est défait, les deux moteurs se comportant de même (clés étrangères restrict en
// PostgreSQL, aucune en SQLite) :
// - objectifs fixés (ou proposés, ou reconduits) à cet entretien : supprimés, l'entretien n'ayant pas eu lieu ;
// - objectifs évalués à cet entretien : évaluation retirée, ils redeviennent en cours (repris à l'entretien suivant) ;
// - demandes de formation versées depuis ses souhaits : gardées, détachées de l'entretien (elles suivent leur circuit) ;
//   le service RH en est averti par le message de l'action et le journal (nombre de demandes détachées) ;
// - feedback 360° de l'entretien (étape 3) : sollicitations, réponses en attente et réponses versées supprimées.
import type { Entretien, Objectif } from '../../shared/types.ts';
import type { Ctx } from './actions/context.ts';

export interface EntretienDetache { objectifsRetires: number; objectifsRouverts: number; demandesDetachees: number }

export async function detacherEntretien(ctx: Ctx, x: Pick<Entretien, 'id'>): Promise<EntretienDetache> {
  const objectifs = ctx.ds.objectifs ?? [];
  let objectifsRouverts = 0, objectifsRetires = 0;
  for (const o of objectifs.filter(y => y.evalueEntretienId === x.id)) {
    await ctx.db.update<Objectif>('objectifs', o.id, { statut: 'ouvert', evaluation: null, evalueEntretienId: null });
    objectifsRouverts++;
  }
  // Lignes reconduites d'abord (elles désignent leur objectif d'origine), puis les autres.
  const fixes = objectifs.filter(y => y.entretienId === x.id).sort((a, b) => Number(!!b.reconduitDe) - Number(!!a.reconduitDe));
  for (const o of fixes) {
    await ctx.db.remove('objectifs', o.id);
    objectifsRetires++;
  }
  const demandes = ctx.ds.demandesCollab.filter(r => r.entretienId === x.id);
  for (const r of demandes) await ctx.db.update('demandesCollab', r.id, { entretienId: null });
  await ctx.db.run('DELETE FROM feedback_tampon WHERE sollicitation_id IN (SELECT id FROM feedback_sollicitations WHERE entretien_id = ?)', [x.id]);
  await ctx.db.run('DELETE FROM feedback_sollicitations WHERE entretien_id = ?', [x.id]);
  await ctx.db.run('DELETE FROM feedback_reponses WHERE entretien_id = ?', [x.id]);
  return { objectifsRetires, objectifsRouverts, demandesDetachees: demandes.length };
}

/** Compléments du message d'une annulation : objectifs défaits, demandes versées gardées (le service RH en est averti). */
export function texteDetache(r: EntretienDetache): string {
  const parts: string[] = [];
  if (r.objectifsRetires) parts.push(r.objectifsRetires > 1 ? `${r.objectifsRetires} objectifs fixés retirés` : '1 objectif fixé retiré');
  if (r.objectifsRouverts) parts.push(r.objectifsRouverts > 1 ? `${r.objectifsRouverts} objectifs évalués de nouveau en cours` : '1 objectif évalué de nouveau en cours');
  if (r.demandesDetachees) parts.push(`${r.demandesDetachees > 1 ? `${r.demandesDetachees} demandes de formation versées gardées` : '1 demande de formation versée gardée'} (service RH averti)`);
  return parts.map(t => ` · ${t}`).join('');
}
