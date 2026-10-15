// Clôture des périodes de congés (`conges.cloturer`, service RH) : congés payés au 31 mai, RTT et jours de repos au
// 31 décembre. Règles et propositions : shared/rules/clotures.ts. Chaque salarié concerné reçoit une ligne (solde
// photographié, décision) ; une ligne déjà enregistrée n'est jamais refaite : relancer la clôture est sans effet.
// CP : le service RH décide ligne par ligne (report plafonné au solde, ou perte ; jamais de perte d'office ni de perte
// d'un report imposé) ; une ligne sans décision attend une prochaine fois, une ligne sans solde est close d'emblée.
// Un membre du RH ne décide pas de ses propres congés (`refuserSoiMeme`).
import { isValidDate } from '../../../shared/dates.ts';
import { fJ, fmtIso, plural } from '../../../shared/format.ts';
import { echeanceMax, lignesClotureCp, lignesClotureRtt, type LigneClotureCp } from '../../../shared/rules/clotures.ts';
import { anneeCp, finPeriodeCp, periodeCp } from '../../../shared/rules/conges.ts';
import type { ClotureConges, ReportCp } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, type Ctx, refuserSoiMeme, requireRh, str } from './context.ts';

type Ligne = Omit<ClotureConges, 'id'>;

/** Décision reçue pour une ligne de la clôture des CP. */
interface Decision { empId: number; decision: unknown; jours: unknown; expire: unknown }

function decisions(p: Record<string, any>): Map<number, Decision> {
  const liste = Array.isArray(p.lignes) ? p.lignes.slice(0, 2000) : [];
  return new Map(liste.filter((x: unknown) => x && typeof x === 'object').map((x: Decision) => [Number(x.empId), x]));
}

/** Ligne décidée par le service RH : report (jours, échéance) ou perte, contrôlés contre la proposition de Cursus. */
function decider(ctx: Ctx, A: number, l: LigneClotureCp, x: Decision): Ligne {
  const nom = l.e.nom, base = { empId: l.e.id, type: 'CP' as const, periode: A, solde: l.solde, le: ctx.d.ti, par: ctx.user.nom, motif: l.impose };
  refuserSoiMeme(ctx, l.e, 'Vous ne pouvez pas décider du report de vos propres congés');
  if (x.decision === 'perdre') {
    if (l.impose) throw new ActionError(`${nom} : perte impossible, le solde est à reporter (report légal des congés non pris)`);
    return { ...base, decision: 'perdre', reportes: 0, perdus: l.solde, expire: null, reportId: null };
  }
  if (x.decision !== 'reporter') throw new ActionError(`${nom} : choisissez le report ou la perte du solde`);
  const j = Number(x.jours);
  // Tout le solde, ou une partie par demi-journée (un solde repris de l'ancien outil peut tomber entre deux).
  const toutLeSolde = Math.abs(j - l.solde) < 1e-9;
  if (!(j > 0) || (!toutLeSolde && ((j * 2) % 1 !== 0 || j > l.solde))) {
    throw new ActionError(`${nom} : nombre de jours à reporter invalide (${fJ(l.solde)} au plus, par demi-journée)`);
  }
  if (l.impose && !toutLeSolde) throw new ActionError(`${nom} : tout le solde est à reporter (report légal), soit ${fJ(l.solde)}`);
  const expire = str(x.expire) || l.proposition.expire;
  if (!isValidDate(expire) || expire < l.echeanceMin || expire > echeanceMax(A)) {
    throw new ActionError(`${nom} : échéance du report invalide (du ${fmtIso(l.echeanceMin)} au ${fmtIso(echeanceMax(A))})`);
  }
  // Report reçu sur la période suivante : il compte dans ses droits jusqu'à l'échéance (shared/rules/conges.ts).
  const r = ctx.db.insert<ReportCp>('reports', {
    empId: l.e.id, jours: j, motif: `Clôture de la période ${periodeCp(A)}`, par: ctx.user.nom, date: ctx.d.ti, sens: 'recu', periode: A + 1, expire,
  });
  return { ...base, decision: 'reporter', reportes: j, perdus: Math.round((l.solde - j) * 100) / 100, expire, reportId: r.id };
}

function cloturerCp(ctx: Ctx, A: number, p: Record<string, any>): string {
  if (A >= anneeCp(ctx.d.ti)) throw new ActionError(`La période ${periodeCp(A)} se termine le ${fmtIso(finPeriodeCp(A))} : sa clôture est proposée à partir du lendemain`);
  const lignes = lignesClotureCp(ctx.d, A), voulues = decisions(p);
  const inconnus = [...voulues.keys()].filter(id => !lignes.some(l => l.e.id === id));
  if (inconnus.length) throw new ActionError(`Salarié hors de la clôture des congés payés ${periodeCp(A)} (sorti, intérimaire ou période tenue par l’ancien outil)`);
  const n = { reporter: 0, perdre: 0, solde_nul: 0 };
  for (const l of lignes) {
    if (l.deja) continue;
    const x = voulues.get(l.e.id);
    const ligne: Ligne | null = l.solde <= 0
      ? { empId: l.e.id, type: 'CP', periode: A, solde: l.solde, decision: 'solde_nul', reportes: 0, perdus: 0, expire: null, reportId: null, motif: null, le: ctx.d.ti, par: ctx.user.nom }
      : x ? decider(ctx, A, l, x) : null;
    if (!ligne) continue;
    ctx.db.insert('clotures', ligne);
    n[ligne.decision]++;
  }
  const faites = n.reporter + n.perdre + n.solde_nul;
  const restants = lignes.filter(l => !l.deja).length - faites;
  if (!faites) return `Congés payés ${periodeCp(A)} : aucune ligne à clôturer${restants ? ` (${plural(restants, 'décision attendue', 'décisions attendues')})` : ' — période déjà clôturée'}`;
  return `Clôture des congés payés ${periodeCp(A)} : ${plural(n.reporter, 'report', 'reports')}, ${plural(n.perdre, 'perte', 'pertes')}, ${plural(n.solde_nul, 'salarié sans solde', 'salariés sans solde')}`
    + (restants ? ` · ${plural(restants, 'ligne reste', 'lignes restent')} à décider` : ' · période close');
}

function cloturerRtt(ctx: Ctx, Y: number): string {
  if (Y >= ctx.d.year) throw new ActionError(`Les RTT ${Y} se clôturent à partir du 1er janvier ${Y + 1}`);
  const lignes = lignesClotureRtt(ctx.d, Y).filter(l => !l.deja);
  // Non reportables (décision par défaut) : le solde non pris est perdu, le placement sur le CET a été rappelé avant.
  let perdus = 0;
  for (const l of lignes) {
    const solde = l.solde;
    ctx.db.insert('clotures', {
      empId: l.e.id, type: 'RTT', periode: Y, solde, decision: solde > 0 ? 'perdre' : 'solde_nul', reportes: 0, perdus: Math.max(0, solde),
      expire: null, reportId: null, motif: null, le: ctx.d.ti, par: ctx.user.nom,
    });
    perdus += Math.max(0, solde);
  }
  if (!lignes.length) return `RTT ${Y} : année déjà clôturée`;
  return `Clôture des RTT ${Y} : ${plural(lignes.length, 'salarié', 'salariés')}${perdus ? `, ${fJ(perdus)} non pris perdus (non reportables)` : ', aucun RTT perdu'}`;
}

/** Clôture d'une période : `type` CP (`periode` : année de prise, close au 31 mai suivant) ou RTT (`periode` : année). */
const cloturer: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const A = Number(p.periode);
  if (!Number.isInteger(A) || A < 2000 || A > 2200) throw new ActionError('Période à clôturer invalide');
  if (p.type === 'CP') return cloturerCp(ctx, A, p);
  if (p.type === 'RTT') return cloturerRtt(ctx, A);
  throw new ActionError('Type de congés à clôturer inconnu (CP ou RTT)');
};

export const cloturesActions: Record<string, ActionHandler> = {
  'conges.cloturer': cloturer,
};
