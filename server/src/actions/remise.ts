// Remise du compte rendu d'entretien au salarié, sans dépendre de sa signature électronique (shared/rules/remise.ts) :
// en main propre, après un refus de signer, ou par mise à disposition dans le portail ; premier téléchargement par le
// salarié depuis son espace. L'e-mail de mise à disposition ne porte qu'un lien vers Cursus : la file d'envoi conserve
// le contenu de chaque message, et aucun texte libre saisi dans Cursus n'y entre (docs/EMAILS.md).
import { ENT_TYPES } from '../../../shared/constants.ts';
import { fmtIso } from '../../../shared/format.ts';
import { controleRemise } from '../../../shared/rules/remise.ts';
import type { Employe, Entretien, ModeRemise } from '../../../shared/types.ts';
import { refusDuCompte, type Compte } from '../comptes.ts';
import type { Db } from '../db.ts';
import { envoyerEmail } from '../integrations/email.ts';
import { adresseSalarie, courriel, lireMessagerie, periodeLongue } from '../messagerie.ts';
import { ActionError, type ActionHandler, type Ctx, getEmp, isValidatorOf, refuserSoiMeme, str } from './context.ts';

function entretien(ctx: Ctx, id: unknown): Entretien {
  const x = ctx.ds.entretiens.find(y => y.id === Number(id));
  if (!x) throw new ActionError('Entretien introuvable', 404);
  return x;
}

/** Le salarié peut-il ouvrir son espace (compte actif, pas sorti) ? Sinon, le portail ne lui sert à rien. */
const ouvreSonEspace = async (db: Db, empId: number) => {
  for (const c of await db.where<Compte>('comptes', 'empId', empId)) if (!await refusDuCompte(db, c)) return true;
  return false;
};

/** E-mail de mise à disposition : le lien vers Cursus (pied commun), jamais le texte du compte rendu. Faux sans adresse. */
async function annoncerMiseADisposition(ctx: Ctx, emp: Employe, x: Entretien): Promise<boolean> {
  const d = await adresseSalarie(ctx.db, emp.id, ctx.ds.today);
  if (!d) return false;
  const nom = ENT_TYPES[x.type]?.nom ?? 'Entretien';
  await envoyerEmail(ctx.db, 'entretien.remise', courriel(ctx.ds.messagerie ?? await lireMessagerie(ctx.db), d.adresse, 'Compte rendu d’entretien disponible dans Cursus', [
    `Le compte rendu de votre ${nom.charAt(0).toLowerCase()}${nom.slice(1)} ${periodeLongue(x.date, x.date)} est à votre disposition dans Cursus (Mes entretiens) : vous pouvez le consulter, le télécharger et l’imprimer.`,
    '',
    'Pour des raisons de confidentialité, son contenu ne figure pas dans cet e-mail.',
  ].join('\n'), { nom: emp.nom }));
  return true;
}

/**
 * Remise de la copie du compte rendu clos : évaluateur (manager direct) ou service RH, jamais pour son propre entretien.
 * `mode` : main_propre, refus (date : jour de la remise, aujourd'hui par défaut) ou portail (daté du jour, salarié qui
 * ouvre son espace).
 */
const remettre: ActionHandler = async (ctx, p) => {
  const x = entretien(ctx, p.id);
  const e = getEmp(ctx, x.empId);
  refuserSoiMeme(ctx, e, 'Vous ne pouvez pas enregistrer la remise de votre propre compte rendu');
  if (!isValidatorOf(ctx, e, 'entretiens')) throw new ActionError('Remise réservée à l’évaluateur ou au service RH', 403);
  const mode = str(p.mode) as ModeRemise;
  const date = mode === 'portail' || !p.date ? ctx.d.ti : str(p.date);
  const err = controleRemise(x, mode, date, ctx.d.ti);
  if (err) throw new ActionError(err);
  if (mode === 'portail' && !await ouvreSonEspace(ctx.db, e.id)) {
    throw new ActionError(`${e.nom} n’a pas de compte Cursus actif : remettez-lui le compte rendu en main propre`);
  }
  await ctx.db.update<Entretien>('entretiens', x.id, { remiseLe: date, remiseMode: mode, remisePar: ctx.user.nom });
  if (mode === 'portail') {
    return `Compte rendu mis à disposition de ${e.nom} dans son espace — ${await annoncerMiseADisposition(ctx, e, x)
      ? 'e-mail envoyé avec le lien vers Cursus' : 'aucune adresse e-mail : prévenez-le'}`;
  }
  return mode === 'refus'
    ? `Refus de signer de ${e.nom} enregistré le ${fmtIso(date)} — copie du compte rendu remise`
    : `Compte rendu remis en main propre à ${e.nom} le ${fmtIso(date)}`;
};

/** Téléchargement du compte rendu clos par le salarié, depuis son espace : la date du premier est enregistrée. */
const telecharger: ActionHandler = async (ctx, p) => {
  const x = entretien(ctx, p.id);
  if (ctx.user.role !== 'collaborateur' || ctx.user.empId !== x.empId) throw new ActionError('Téléchargement enregistré pour le salarié seulement', 403);
  if (x.statut !== 'realise') throw new ActionError('Compte rendu pas encore clos');
  if (!x.telechargeLe) await ctx.db.update<Entretien>('entretiens', x.id, { telechargeLe: ctx.d.ti });
  return null;
};

export const remiseActions = {
  'entretien.remettre': remettre,
  'entretien.telecharger': telecharger,
} satisfies Record<string, ActionHandler>;
