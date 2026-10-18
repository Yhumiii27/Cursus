// Dérogation au repos dominical d'une équipe (shared/rules/semaine.ts) : aucune par défaut (heures du dimanche signalées
// au service RH sur la feuille), travail en continu (art. L3132-12, R3132-5) ou équipe de suppléance (art. L3132-16),
// avec la référence obligatoire de l'accord ou de la décision. Réglée par l'administrateur RH (Paramètres → Repos
// hebdomadaire), clé `derogationsDominicales` de la table settings ; la référence n'est transmise qu'au service RH et
// n'est jamais recopiée au journal (seul le fait qu'elle soit renseignée).
import { DEROGATIONS_DOMINICALES, estTypeDerogation } from '../../../shared/rules/semaine.ts';
import type { DerogationDominicale } from '../../../shared/types.ts';
import type { Db } from '../db.ts';
import { ActionError, type ActionHandler, requireRhAdmin, str } from './context.ts';

const CLE = 'derogationsDominicales';
export const REFERENCE_MAX = 120;
const lire = async (db: Db) => await db.getSetting<DerogationDominicale[]>(CLE, []);

/** Équipe renommée (`equipe.renommer`) : sa dérogation la suit. */
export async function renommerDerogation(db: Db, avant: string, apres: string) {
  const liste = await lire(db);
  if (liste.some(x => x.equipe === avant)) await db.setSetting(CLE, liste.map(x => (x.equipe === avant ? { ...x, equipe: apres } : x)));
}

/** Équipe supprimée (`equipe.supprimer`) : sa dérogation disparaît avec elle (une équipe recréée sous ce nom n'en hérite pas). */
export async function retirerDerogation(db: Db, nom: string) {
  const liste = await lire(db);
  if (liste.some(x => x.equipe === nom)) await db.setSetting(CLE, liste.filter(x => x.equipe !== nom));
}

/** equipe, type (`aucune` / `feu_continu` / `suppleance`), reference (exigée hors « aucune », 120 caractères au plus). */
const regler: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const equipe = ctx.ds.referentiels.equipes.find(q => q.nom === p.equipe);
  if (!equipe) throw new ActionError('Équipe introuvable', 404);
  if (!estTypeDerogation(p.type)) throw new ActionError('Dérogation inconnue');
  const reference = str(p.reference).replace(/\s+/g, ' ');
  if (p.type !== 'aucune' && !reference) throw new ActionError(`${DEROGATIONS_DOMINICALES[p.type].label} : indiquez la référence de l’accord, de la convention ou de l’autorisation qui la prévoit`);
  if (reference.length > REFERENCE_MAX) throw new ActionError(`Référence : ${REFERENCE_MAX} caractères au plus`);
  const autres = (await lire(ctx.db)).filter(x => x.equipe !== equipe.nom);
  await ctx.db.setSetting(CLE, p.type === 'aucune' ? autres
    : [...autres, { equipe: equipe.nom, type: p.type, reference, le: ctx.d.ti, par: ctx.user.nom }]);
  return p.type === 'aucune'
    ? `Équipe ${equipe.nom} : aucune dérogation au repos dominical — les heures du dimanche seront signalées au service RH`
    : `Équipe ${equipe.nom} : ${DEROGATIONS_DOMINICALES[p.type].label.toLowerCase()} — heures du dimanche attendues, sans alerte`;
};

export const reposDominicalActions: Record<string, ActionHandler> = {
  'temps.derogationDominicale': regler,
};
