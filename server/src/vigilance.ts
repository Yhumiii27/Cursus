// Vigilance des pays (t068), côté serveur : alerte quand le service RH passe une destination à l'orange ou au rouge
// (`referentiel.destination.enregistrer`) — déplacements à venir ou en cours vers ce pays listés dans le message de
// l'action et au journal (salariés concernés), notification au manager de chaque voyageur (aussitôt ou dans son
// récapitulatif quotidien, selon son réglage) et à la boîte du service RH avec la liste entière. Seul le service RH
// modifie une destination : sa boîte est prévenue malgré tout (exception à la règle « jamais la personne qui agit » de
// `notifier`), pour que les collègues qui suivent les déplacements le sachent sans ouvrir le Go / No Go.
// Règles : shared/rules/vigilance.ts.
import { fmtShort, fmt, plural } from '../../shared/format.ts';
import { parse } from '../../shared/dates.ts';
import { VIGILANCES, voyagesVers } from '../../shared/rules/vigilance.ts';
import type { Destination, Voyage } from '../../shared/types.ts';
import type { Ctx } from './actions/context.ts';
import { notifier } from './notifications.ts';

/** « Paul Martin du 27 oct. au 6 nov. 2026 » : un déplacement, dans un message ou un e-mail. */
const ligne = (ctx: Ctx, v: Voyage) => `${ctx.d.personName(v.empId)} du ${fmtShort(parse(v.depart))} au ${fmt(parse(v.retour))}`;

/**
 * Alerte d'une destination passée à l'orange ou au rouge : notifications et suite du message de l'action. Renvoie aussi
 * les salariés concernés (journal). Aucun déplacement prévu : rien n'est envoyé.
 */
export async function alerterVigilance(ctx: Ctx, d: Destination): Promise<{ texte: string; salaries: number[] }> {
  const voyages = voyagesVers(ctx.ds.voyages, d.code, ctx.d.ti);
  const niveau = `${d.vigilance} (France Diplomatie : ${VIGILANCES[d.vigilance!].label.toLowerCase()})`;
  if (!voyages.length) return { texte: ` · vigilance ${niveau} : aucun déplacement prévu vers ce pays`, salaries: [] };
  const suite = d.vigilance === 'rouge'
    ? 'Zone rouge : le Go / No Go des chantiers concernés prend une réserve. Le service RH revoit chacun avec vous et le voyageur.'
    : 'Le service RH revoit chacun avec vous et le voyageur (raison impérative, consignes de sécurité, inscription sur Ariane).';
  // Managers : chacun pour les membres de son équipe seulement.
  const parManager = new Map<number, Voyage[]>();
  for (const v of voyages) {
    const e = ctx.d.emp(v.empId), m = e ? ctx.d.mgrOf(e) : null;
    if (m) parManager.set(m, [...(parManager.get(m) ?? []), v]);
  }
  for (const [m, l] of parManager) {
    await notifier(ctx, m, {
      type: 'voyage.vigilance', objet: `Vigilance ${d.vigilance} — ${d.pays} : ${plural(l.length, 'déplacement de votre équipe', 'déplacements de votre équipe')}`,
      texte: `La destination ${d.pays} passe en vigilance ${niveau}. Déplacements prévus dans votre équipe :\n${l.map(v => `- ${ligne(ctx, v)}`).join('\n')}\n${suite}`,
    });
  }
  // Service RH : la liste entière, dans sa boîte partagée (Paramètres → Messagerie), même si l'auteur en fait partie.
  const rh = notifier(ctx, 0, {
    type: 'voyage.vigilance', objet: `Vigilance ${d.vigilance} — ${d.pays} : ${plural(voyages.length, 'déplacement prévu', 'déplacements prévus')}`,
    texte: `La destination ${d.pays} passe en vigilance ${niveau} (modification par ${ctx.user.nom}). Déplacements à venir ou en cours :\n${voyages.map(v => `- ${ligne(ctx, v)}`).join('\n')}\n${d.vigilance === 'rouge'
      ? 'Zone rouge : le Go / No Go des chantiers concernés prend une réserve. À revoir avec chaque manager et voyageur.'
      : 'À revoir avec chaque manager et voyageur (raison impérative, consignes de sécurité, inscription sur Ariane).'}`,
  }, true);
  return {
    texte: ` · vigilance ${niveau} : ${plural(voyages.length, 'déplacement prévu', 'déplacements prévus')} vers ce pays (${voyages.map(v => ligne(ctx, v)).join(', ')}), ${await rh ? 'service RH et managers prévenus' : 'managers prévenus'}${d.vigilance === 'rouge' ? ' ; réserve au Go / No Go' : ''}`,
    salaries: [...new Set(voyages.map(v => v.empId))],
  };
}
