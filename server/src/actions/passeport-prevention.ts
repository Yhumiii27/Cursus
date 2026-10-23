// Passeport de prévention (lot 7, chantier B, t066 ; shared/rules/passeport-prevention.ts) : suivi de ce qui a déjà été
// déclaré sur la plateforme, pour ne pas déclarer deux fois. Service RH et référent HSE (droit `formations`).
// - `passeport.declarer` : lignes (certifications ou formations suivies des formations marquées) notées déclarées tel
//   jour ; une ligne déjà déclarée, inconnue, annulée ou d'une formation qui n'est plus marquée est refusée (l'écran est en
//   retard : rien n'est écrit). Le jour ne peut être ni à venir ni antérieur au dernier jour de la formation.
// - `passeport.retirer` : marque posée par erreur retirée ; la ligne est de nouveau proposée à l'export.
// L'export lui-même est produit et tracé par server/src/passeport-prevention.ts. Journal : nombre de lignes, jour, clés
// (identifiants), salariés concernés ; jamais d'intitulé ni de nom.
import { fmtIso, plural } from '../../../shared/format.ts';
import { cleLigne, clesValides, declarationDe, erreurDateDeclaration, lignesPasseport } from '../../../shared/rules/passeport-prevention.ts';
import type { DeclarationPasseport } from '../../../shared/types.ts';
import { auteurDe } from '../delivrances.ts';
import { ActionError, type ActionHandler, requireFormations } from './context.ts';

/** Nombre maximal de lignes marquées en une fois. */
const MAX_LIGNES = 2000;

/** Lignes notées déclarées : cles (« cert:12 », « suivie:4 »), le (jour de la déclaration sur la plateforme). */
const declarer: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const cles = clesValides(p.cles, MAX_LIGNES);
  if (!cles) throw new ActionError('Lignes à marquer invalides');
  const erreur = erreurDateDeclaration(p.le, ctx.d.ti);
  if (erreur) throw new ActionError(erreur);
  const le = p.le as string;
  // Toutes les lignes connues jusqu'à aujourd'hui, déjà déclarées comprises : une clé absente n'est pas (ou plus) à déclarer.
  const lignes = new Map(lignesPasseport(ctx.d, { du: '1900-01-01', au: ctx.d.ti, declarees: true }).map(l => [l.cle, l]));
  const voulues = [...cles.certs.map(id => cleLigne({ certId: id })), ...cles.suivies.map(id => cleLigne({ suivieId: id }))];
  const inconnues = voulues.filter(c => !lignes.has(c));
  if (inconnues.length) throw new ActionError(`${plural(inconnues.length, 'ligne n’est plus à déclarer', 'lignes ne sont plus à déclarer')} (formation annulée, ou qui n’est plus marquée « Passeport de prévention ») : rechargez l’écran`);
  const deja = voulues.map(c => lignes.get(c)!).filter(l => l.declareLe);
  if (deja.length) throw new ActionError(`${plural(deja.length, 'ligne déjà déclarée', 'lignes déjà déclarées')} (le ${fmtIso(deja[0].declareLe!)}) : rechargez l’écran`);
  const avant = voulues.map(c => lignes.get(c)!).filter(l => le < l.au);
  if (avant.length) throw new ActionError(`La déclaration ne peut pas précéder le dernier jour de la formation (${fmtIso(avant[0].au)}) : vérifiez la date`);
  const auteur = auteurDe(ctx.user, ctx.d.ti);
  for (const c of voulues) {
    const l = lignes.get(c)!;
    await ctx.db.insert<DeclarationPasseport>('declarationsPasseport', { empId: l.empId, certId: l.certId, suivieId: l.suivieId, declareLe: le, ...auteur });
  }
  const salaries = [...new Set(voulues.map(c => lignes.get(c)!.empId))];
  return {
    message: `Passeport de prévention : ${plural(voulues.length, 'ligne marquée déclarée', 'lignes marquées déclarées')} le ${fmtIso(le)} (${plural(salaries.length, 'salarié', 'salariés')}) — plus proposées à l’export`,
    result: { salaries, lignes: voulues.length },
  };
};

/** Marque retirée (déclaration notée par erreur) : cle de la ligne. */
const retirer: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const cles = clesValides([p.cle], 1);
  if (!cles) throw new ActionError('Ligne invalide');
  const x = declarationDe(ctx.ds, String(p.cle));
  if (!x) throw new ActionError('Cette ligne n’est pas marquée déclarée', 404);
  await ctx.db.remove('declarationsPasseport', x.id);
  const e = ctx.d.emp(x.empId);
  return {
    message: `Passeport de prévention : marque du ${fmtIso(x.declareLe)} retirée${e ? ` (${e.nom})` : ''} — la ligne est de nouveau proposée à l’export`,
    result: { salaries: [x.empId] },
  };
};

export const passeportPreventionActions = {
  'passeport.declarer': declarer,
  'passeport.retirer': retirer,
} satisfies Record<string, ActionHandler>;
