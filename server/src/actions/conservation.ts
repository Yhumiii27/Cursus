// Conservation des dossiers des salariés sortis (t016, server/src/conservation.ts) : « Cursus propose, le RH confirme ».
//   employe.anonymiser  ids (1 à 100), motif (obligatoire, 500 caractères ; gardé avec l'effacement, jamais au journal),
//                       avantEcheance? (droit à l'effacement exercé avant l'échéance : un seul salarié, sorti ; seules
//                       les catégories sans obligation légale en cours, ou échues, sont effacées, l'identité, le titre de
//                       séjour, la santé et le temps restent jusqu'à leur échéance). Sans `avantEcheance`, seuls les
//                       dossiers proposés (durée échue, fonction
//                       activée avec la décision du DPO) sont effacés, catégorie par catégorie, et anonymisés quand la durée
//                       du dossier est échue. Administrateur RH (jamais son propre dossier). Irréversible : les sauvegardes
//                       gardent les données jusqu'à leur rotation.
import { fmtIso, plural } from '../../../shared/format.ts';
import { categoriesDroitEffacement, categoriesTexte, conservationActive } from '../../../shared/rules/conservation.ts';
import { sorti } from '../../../shared/rules/contrats.ts';
import type { CategorieConservation } from '../../../shared/types.ts';
import { aEffacer, dossiersEchus, effacer } from '../conservation.ts';
import { controlerSoldeSortie } from '../soldes-sortie.ts';
import { ActionError, getEmp, refuserSoiMeme, requireRhAdmin, str, type ActionHandler } from './context.ts';

/** Dossiers traités au plus par confirmation (lot). */
export const LOT_MAX = 100;

const anonymiser: ActionHandler = (ctx, p) => {
  requireRhAdmin(ctx);
  const ids = [...new Set((Array.isArray(p.ids) ? p.ids : [p.ids]).map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw new ActionError('Choisissez au moins un dossier');
  if (ids.length > LOT_MAX) throw new ActionError(`${LOT_MAX} dossiers au plus à la fois`);
  const motif = str(p.motif);
  if (!motif) throw new ActionError('Motif requis : il reste avec la trace de l’effacement (décision du DPO, demande du salarié…)');
  if (motif.length > 500) throw new ActionError('Motif trop long (500 caractères au plus)');
  const avantEcheance = p.avantEcheance === true;
  const emps = ids.map(id => getEmp(ctx, id));
  emps.forEach(e => refuserSoiMeme(ctx, e, 'Vous ne pouvez pas effacer votre propre dossier'));

  let plan: { id: number; categories: CategorieConservation[] }[];
  let gardees: CategorieConservation[] = [];
  if (avantEcheance) {
    // Droit à l'effacement (art. 17) : un salarié à la fois, parti de l'entreprise ; ce que la loi impose de garder reste
    // jusqu'à son échéance (art. 17-3-b : registre unique du personnel, santé au travail, temps de travail).
    if (emps.length > 1) throw new ActionError('Droit à l’effacement : un salarié à la fois');
    const e = emps[0];
    if (e.anonymiseLe) throw new ActionError('Dossier déjà anonymisé', 409);
    if (!e.fin || !sorti(e, ctx.d.ti)) throw new ActionError('Salarié encore présent : enregistrez d’abord sa sortie ; le dossier d’un salarié en poste ne s’efface pas', 409);
    const r = categoriesDroitEffacement(e, ctx.ds.settings, ctx.d.ti, c => aEffacer(ctx.db, e.id, c) > 0)!;
    gardees = r.gardees.map(g => g.categorie);
    if (!r.categories.length) {
      throw new ActionError(`Rien à effacer avant l’échéance : ${categoriesTexte(gardees)} restent tant que la loi impose de les garder (art. 17-3-b du RGPD)`, 409);
    }
    plan = [{ id: e.id, categories: r.categories }];
  } else {
    if (!conservationActive(ctx.ds.settings)) {
      throw new ActionError('Conservation des dossiers désactivée : l’administrateur RH l’active avec la référence de la décision du DPO (Paramètres → Conservation des dossiers)', 409);
    }
    const echus = new Map(dossiersEchus(ctx.db, ctx.ds.settings, ctx.d.ti).map(d => [d.empId, d]));
    const absents = emps.filter(e => !echus.has(e.id));
    // Aucun nom dans le refus : il peut viser un dossier déjà anonymisé.
    if (absents.length) throw new ActionError(`${plural(absents.length, 'dossier', 'dossiers')} sans donnée échue (n° ${absents.map(e => e.id).join(', ')}) : rechargez la liste`, 409);
    plan = emps.map(e => ({ id: e.id, categories: echus.get(e.id)!.categories }));
  }
  // Un solde de sortie dans un lot de paie à confirmer : le lot d'abord (le salarié y est nommé par son matricule).
  plan.filter(x => x.categories.includes('dossier')).forEach(x => controlerSoldeSortie(ctx.db, getEmp(ctx, x.id)));

  const cx = { ti: ctx.d.ti, le: new Date().toISOString(), par: ctx.user.nom };
  const bilan = plan.map(x => ({ ...x, elements: effacer(ctx.db, x.id, x.categories, cx, { motif, avantEcheance }) }));
  const anonymises = bilan.filter(x => x.categories.includes('dossier'));
  const partiels = bilan.filter(x => !x.categories.includes('dossier'));
  const elements = bilan.reduce((n, x) => n + x.elements, 0);
  // Message sans nom : il est recopié au journal et le dossier n'a plus d'identité.
  const morceaux = [
    anonymises.length ? `${plural(anonymises.length, 'dossier anonymisé', 'dossiers anonymisés')} (n° ${anonymises.map(x => x.id).join(', ')})` : '',
    ...partiels.map(x => `dossier n° ${x.id} : ${categoriesTexte(x.categories)} effacés`),
  ].filter(Boolean);
  return {
    message: `${avantEcheance ? 'Droit à l’effacement exercé' : 'Données échues effacées'} le ${fmtIso(ctx.d.ti)} — ${morceaux.join(' · ')} · ${plural(elements, 'élément effacé', 'éléments effacés')}`
      + `${gardees.length ? ` · gardés jusqu’à leur échéance (obligation légale) : ${categoriesTexte(gardees)}` : ''} ; les sauvegardes les gardent jusqu’à leur rotation`,
    result: { salaries: bilan.map(x => x.id), effacements: bilan.map(x => ({ empId: x.id, categories: x.categories, elements: x.elements })) },
  };
};

export const conservationActions: Record<string, ActionHandler> = {
  'employe.anonymiser': anonymiser,
};
