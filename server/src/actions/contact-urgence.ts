// Contact d'urgence (t068) : personne à prévenir et son téléphone, champ de la fiche salarié plutôt que du déplacement.
// Le salarié le saisit depuis son portail (espace collaborateur ou manager, pour lui-même) ; le service RH peut le saisir
// pour lui. Réservé au service RH et à l'intéressé : jamais transmis au manager ni aux profils restreints
// (server/src/dataset.ts), mentionné dans la page Confidentialité et compris dans la copie des données (fiche). Le journal
// ne garde que le salarié et le fait que le contact soit renseigné, jamais le nom ni le téléphone.
import { controlerContactUrgence } from '../../../shared/rules/vigilance.ts';
import type { Employe } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, getEmp, isRh, isSelf } from './context.ts';

const enregistrer: ActionHandler = (ctx, p) => {
  const emp = getEmp(ctx, p.empId);
  if (!isRh(ctx) && !isSelf(ctx, emp.id)) throw new ActionError('Contact d’urgence : saisi par le salarié lui-même ou par le service RH', 403);
  const c = controlerContactUrgence(p.nom, p.telephone);
  const erreur = c.erreurs.nom ?? c.erreurs.tel;
  if (erreur) throw new ActionError(erreur);
  if (c.nom === (emp.urgenceNom ?? null) && c.tel === (emp.urgenceTel ?? null)) return 'Contact d’urgence inchangé';
  ctx.db.update<Employe>('employes', emp.id, { urgenceNom: c.nom, urgenceTel: c.tel });
  const soi = isSelf(ctx, emp.id);
  if (!c.nom) return soi ? 'Contact d’urgence retiré' : `Contact d’urgence de ${emp.nom} retiré`;
  return soi ? 'Contact d’urgence enregistré — visible du service RH seulement' : `Contact d’urgence de ${emp.nom} enregistré — visible du service RH et de l’intéressé seulement`;
};

export const contactUrgenceActions = {
  'employe.contactUrgence': enregistrer,
} satisfies Record<string, ActionHandler>;
