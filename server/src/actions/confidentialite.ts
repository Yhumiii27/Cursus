// Page Confidentialité : coordonnées du responsable du traitement et du DPO (administrateur RH). Un champ absent du
// paramètre reste tel quel ; vide, il est effacé (la page renvoie alors au service RH). Le journal ne recopie que le
// nom des champs modifiés, jamais leur texte (server/src/journal.ts).
import { controleContact, type ContactsConfidentialite } from '../../../shared/confidentialite.ts';
import { lireConfidentialite } from '../confidentialite.ts';
import { ActionError, requireRhAdmin, type ActionHandler } from './context.ts';

const LIBELLES: Record<keyof ContactsConfidentialite, string> = { responsable: 'Responsable du traitement', dpo: 'Délégué à la protection des données' };

const regler: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const next: ContactsConfidentialite = { ...await lireConfidentialite(ctx.db) };
  for (const champ of Object.keys(LIBELLES) as (keyof ContactsConfidentialite)[]) {
    if (p[champ] === undefined) continue;
    const c = controleContact(p[champ], LIBELLES[champ]);
    if ('erreur' in c) throw new ActionError(c.erreur);
    next[champ] = c.valeur;
  }
  await ctx.db.setSetting('confidentialite', next);
  const manque = !next.responsable && !next.dpo ? 'aucune coordonnée' : !next.dpo ? 'DPO non renseigné' : !next.responsable ? 'responsable non renseigné' : '';
  return `Coordonnées de la page Confidentialité enregistrées${manque ? ` — ${manque} : la page renvoie au service RH` : ''}`;
};

export const confidentialiteActions = {
  'confidentialite.regler': regler,
} satisfies Record<string, ActionHandler>;
