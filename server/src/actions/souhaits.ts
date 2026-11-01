// Souhaits de formation exprimés à l'entretien (lot 12, chantier C3, t194 ; règles : shared/rules/souhaits.ts) :
// - `entretien.souhait` : le salarié (son espace) ou l'évaluateur ajoute, modifie ou retire ses propres souhaits, tant
//   que l'entretien est planifié (un souhait se verse à la clôture) ; une modification par le salarié efface l'avis ;
// - `entretien.avisSouhait` : avis de l'évaluateur (favorable, défavorable, à discuter) ;
// - versement à la clôture (`entretien.clore`, server/src/actions/entretiens.ts) : chaque souhait favorable devient une
//   demande de formation au service RH (réponse du propriétaire du 1er novembre 2026), par le même contrôle des doublons
//   que `demande.formation` (server/src/actions/conformite.ts) ; jamais deux fois. Les autres restent dans le compte rendu.
// Journal : entretien et clé du souhait, avis, nombres ; jamais l'intitulé libre (server/src/journal.ts).
import { plural } from '../../../shared/format.ts';
import {
  AVIS_SOUHAIT_LABEL, estAvisSouhait, lireSouhait, motifVersement, nouvelleCle, refusTypeSouhaits, SOUHAITS_MAX, souhaitsAVerser, souhaitsDe, souhaitTraite,
} from '../../../shared/rules/souhaits.ts';
import type { AvisSouhait, Employe, Entretien, SouhaitFormation } from '../../../shared/types.ts';
import { creerDemandeFormation, doublonFormation } from './conformite.ts';
import { ActionError, type ActionHandler, type Ctx, getEmp, isValidatorOf, refuserSoiMeme, str } from './context.ts';

function entretienDe(ctx: Ctx, id: unknown): { x: Entretien; e: Employe } {
  const x = ctx.ds.entretiens.find(y => y.id === Number(id));
  if (!x) throw new ActionError('Entretien introuvable', 404);
  return { x, e: getEmp(ctx, x.empId) };
}

function exigerPlanifie(x: Entretien) {
  if (x.statut !== 'planifie') throw new ActionError('Entretien clos : ses souhaits de formation sont figés', 409);
}

/** Souhait `cle` de l'entretien, encore modifiable (ni versé, ni écarté au versement). */
function souhaitDe(x: Entretien, cle: unknown): SouhaitFormation {
  const s = souhaitsDe(x).find(y => y.cle === str(cle));
  if (!s) throw new ActionError('Souhait introuvable', 404);
  if (souhaitTraite(s)) throw new ActionError('Souhait déjà versé au service RH : il ne change plus', 409);
  return s;
}

const souhait: ActionHandler = async (ctx, p) => {
  const { x, e } = entretienDe(ctx, p.id);
  const salarie = ctx.user.role === 'collaborateur' && ctx.user.empId === e.id;
  if (!salarie) {
    refuserSoiMeme(ctx, e, 'Vous ne pouvez pas, comme évaluateur, rédiger votre propre entretien');
    if (!isValidatorOf(ctx, e, 'entretiens')) throw new ActionError('Souhaits saisis par le salarié ou par son évaluateur', 403);
  }
  exigerPlanifie(x);
  const refus = refusTypeSouhaits(x.type);
  if (refus) throw new ActionError(refus);
  const auteur = salarie ? 'sal' : 'mgr';
  const liste = souhaitsDe(x);
  const formation = (f: string) => ctx.d.fm(f) ?? undefined;
  const objectifDuSalarie = (id: number | null) => {
    if (id !== null && !(ctx.ds.objectifs ?? []).some(o => o.id === id && o.empId === e.id)) throw new ActionError('Objectif lié introuvable');
  };
  const op = str(p.op) || 'ajouter';
  if (op === 'ajouter') {
    if (liste.length >= SOUHAITS_MAX) throw new ActionError(`${SOUHAITS_MAX} souhaits au plus par entretien`);
    const s = lireSouhait(p, formation);
    if (typeof s === 'string') throw new ActionError(s);
    objectifDuSalarie(s.objectifId);
    const cle = nouvelleCle(liste);
    await ctx.db.update<Entretien>('entretiens', x.id, { souhaits: [...liste, { cle, ...s, auteur, avis: null, demandeId: null, verseLe: null, nonVerse: null }] });
    return { message: 'Souhait de formation ajouté', result: { cle } };
  }
  if (op !== 'modifier' && op !== 'retirer') throw new ActionError('Opération inconnue');
  const s = souhaitDe(x, p.cle);
  // Chacun modifie ou retire ses propres souhaits : l'évaluateur donne son avis sur ceux du salarié, sans les réécrire.
  if (s.auteur !== auteur) throw new ActionError(salarie ? 'Souhait saisi par votre évaluateur' : 'Souhait exprimé par le salarié : donnez votre avis, sans le réécrire', 403);
  if (op === 'retirer') {
    await ctx.db.update<Entretien>('entretiens', x.id, { souhaits: liste.filter(y => y.cle !== s.cle) });
    return { message: 'Souhait de formation retiré', result: { cle: s.cle } };
  }
  const m = lireSouhait(p, formation, s);
  if (typeof m === 'string') throw new ActionError(m);
  objectifDuSalarie(m.objectifId);
  // Souhait du salarié réécrit : l'avis donné sur l'ancienne version ne vaut plus.
  const change = m.f !== s.f || m.libelle !== s.libelle;
  await ctx.db.update<Entretien>('entretiens', x.id, { souhaits: liste.map(y => (y.cle === s.cle ? { ...y, ...m, ...(change && salarie ? { avis: null } : {}) } : y)) });
  return { message: 'Souhait de formation modifié', result: { cle: s.cle } };
};

/** Avis de l'évaluateur sur un souhait (null : retiré) ; seul l'avis favorable le versera au service RH à la clôture. */
const avisSouhait: ActionHandler = async (ctx, p) => {
  const { x, e } = entretienDe(ctx, p.id);
  refuserSoiMeme(ctx, e, 'Vous ne pouvez pas donner votre avis sur vos propres souhaits');
  if (!isValidatorOf(ctx, e, 'entretiens')) throw new ActionError('Avis donné par l’évaluateur (manager ou service RH)', 403);
  exigerPlanifie(x);
  const s = souhaitDe(x, p.cle);
  if (p.avis !== null && p.avis !== '' && !estAvisSouhait(p.avis)) throw new ActionError('Avis inconnu : favorable, défavorable ou à discuter');
  const avis: AvisSouhait | null = estAvisSouhait(p.avis) ? p.avis : null;
  await ctx.db.update<Entretien>('entretiens', x.id, { souhaits: souhaitsDe(x).map(y => (y.cle === s.cle ? { ...y, avis } : y)) });
  return { message: avis ? `Avis ${AVIS_SOUHAIT_LABEL[avis].toLowerCase()} — ${e.nom}` : `Avis retiré — ${e.nom}`, result: { cle: s.cle } };
};

/** Bilan d'un versement : demandes créées, et souhaits favorables écartés (doublon, déjà inscrit, formation archivée). */
export interface Versement { versees: number[]; ecartes: number }

/**
 * Versement des souhaits favorables de l'entretien `x`, à sa clôture (dans la transaction de `entretien.clore`) : une
 * demande de formation par souhait, au nom de l'évaluateur (manager : `parId`), motif fixe « Souhait exprimé à
 * l'entretien du … », rattachée à l'entretien. Doublon (demande identique en attente, inscription à venir, souhait
 * identique déjà versé ici) ou formation archivée : le souhait est marqué, sans nouvelle demande. Jamais deux fois.
 */
export async function verserSouhaits(ctx: Ctx, e: Employe, x: Entretien): Promise<Versement> {
  const aVerser = souhaitsAVerser(x);
  if (!aVerser.length) return { versees: [], ecartes: 0 };
  const parId = ctx.user.role === 'manager' && ctx.user.empId && ctx.user.empId !== e.id ? ctx.user.empId : null;
  const faites = new Map<string, number>();
  const versees: number[] = [];
  let ecartes = 0;
  const maj = new Map<string, Partial<SouhaitFormation>>();
  for (const s of aVerser) {
    const cle = s.f ? `f:${s.f}` : `l:${(s.libelle ?? '').toLowerCase()}`;
    const deja = faites.get(cle);
    const doublon = deja ? { code: 'deja_demande' as const, demandeId: deja } : doublonFormation(ctx, e, s.f, s.libelle);
    if (s.f && ctx.d.fm(s.f)?.archive) {
      maj.set(s.cle, { nonVerse: 'archivee', verseLe: ctx.d.ti });
      ecartes++;
    } else if (doublon) {
      maj.set(s.cle, { nonVerse: doublon.code, demandeId: doublon.demandeId ?? null, verseLe: ctx.d.ti });
      ecartes++;
    } else {
      const r = await creerDemandeFormation(ctx, e, { f: s.f, libelle: s.libelle, sessionId: null, motif: motifVersement(x.date), parId, entretienId: x.id });
      faites.set(cle, r.id);
      versees.push(r.id);
      maj.set(s.cle, { demandeId: r.id, verseLe: ctx.d.ti });
    }
  }
  await ctx.db.update<Entretien>('entretiens', x.id, { souhaits: souhaitsDe(x).map(y => (maj.has(y.cle) ? { ...y, ...maj.get(y.cle) } : y)) });
  return { versees, ecartes };
}

/** Complément du message de la clôture : demandes versées, souhaits écartés. */
export const texteVersement = (v: Versement) => [
  v.versees.length ? ` · ${plural(v.versees.length, 'souhait de formation versé', 'souhaits de formation versés')} au service RH` : '',
  v.ecartes ? ` · ${plural(v.ecartes, 'souhait déjà demandé ou sans suite', 'souhaits déjà demandés ou sans suite')}` : '',
].join('');

export const souhaitsActions = {
  'entretien.souhait': souhait,
  'entretien.avisSouhait': avisSouhait,
} satisfies Record<string, ActionHandler>;
