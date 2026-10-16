// Titre de séjour valant autorisation de travail (art. L5221-8 : l'employeur ne peut pas employer un étranger dont
// l'autorisation a expiré). Le service RH enregistre le type, le numéro (registre unique du personnel), l'expiration et la
// date de vérification auprès de la préfecture (art. R5221-41), sans copie du document, qui ira dans la GED. Le numéro
// n'est transmis qu'au service RH et à l'intéressé, jamais au journal (masqué, server/src/journal.ts) ; le manager, le
// référent HSE, la paie et Keystone ne voient qu'un verdict (server/src/dataset.ts, shared/domain.ts). Un titre expiré
// rend le salarié non conforme et le passe en « No Go CONTRAT » (verdicts recalculés après l'action).
import { fmtIso } from '../../../shared/format.ts';
import { sorti, TYPES_TITRE_SEJOUR, validerAutorisation } from '../../../shared/rules/contrats.ts';
import type { Employe } from '../../../shared/types.ts';
import { ActionError, getEmp, refuserSoiMeme, requireRh, type ActionHandler } from './context.ts';

/**
 * `id`, `requise` (faux : ressortissant français, de l'UE, de l'EEE ou de la Suisse ; le titre est effacé), `type`
 * (TYPES_TITRE_SEJOUR), `numero`, `expire`, `verifieLe`. Les avertissements (titre expiré, vérification non tracée ou
 * tardive) accompagnent le message, sans bloquer.
 */
const autorisation: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.id);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas enregistrer votre propre titre de séjour');
  if (sorti(emp, ctx.d.ti)) throw new ActionError(`${emp.nom} a quitté l’entreprise le ${fmtIso(emp.fin!)} : son titre de séjour n’est plus suivi`);
  const v = validerAutorisation({ requise: p.requise === true, type: p.type, numero: p.numero, expire: p.expire, verifieLe: p.verifieLe }, { entree: emp.entree, ti: ctx.d.ti });
  if (v.errors.length) throw new ActionError(v.errors.join(' '));
  ctx.db.update<Employe>('employes', emp.id, { autorisationTravail: v.valeur });
  const t = v.valeur;
  const quoi = !t ? 'aucune autorisation de travail requise' : `${TYPES_TITRE_SEJOUR[t.type].court}${t.expire ? ` valable jusqu’au ${fmtIso(t.expire)}` : ''}`;
  return `Titre de séjour de ${emp.nom} enregistré — ${quoi}${v.warnings.map(w => ` · ${w.replace(/\.$/, '')}`).join('')}`;
};

export const contratsActions: Record<string, ActionHandler> = {
  'employe.autorisationTravail': autorisation,
};
