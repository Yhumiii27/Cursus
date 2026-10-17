// Clôture des périodes de congés (`conges.cloturer`, service RH) : congés payés au 31 mai, RTT et jours de repos au
// 31 décembre. Règles et propositions : shared/rules/clotures.ts. Chaque salarié concerné reçoit une ligne (solde
// photographié, décision) ; une ligne déjà enregistrée n'est jamais refaite : relancer la clôture est sans effet.
// CP : le service RH décide ligne par ligne (report plafonné au solde jusqu'au 31 mai suivant, ou perte ; jamais de perte
// d'office ni de perte des jours d'un report imposé) ; une ligne sans décision attend une prochaine fois, une ligne sans
// solde est close d'emblée. Une ligne dont une demande de CP de la période attend une décision n'est jamais close.
// Un membre du RH ne décide pas de ses propres congés (`refuserSoiMeme`).
// Jours rendus plus tard à une période close (refus, annulation) : reportés sur la période suivante
// (`recrediterPeriodesCloses`).
import { Domain } from '../../../shared/domain.ts';
import { fJ, fmtIso, plural } from '../../../shared/format.ts';
import { periodeDemiTexte } from '../../../shared/rules/demi-journees.ts';
import { echeanceReport, lignesClotureCp, lignesClotureRtt, type LigneClotureCp } from '../../../shared/rules/clotures.ts';
import { anneeCp, finPeriodeCp, periodeCp, soldePeriode } from '../../../shared/rules/conges.ts';
import type { Absence, ClotureConges, Employe, ReportCp } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, type Ctx, refuserSoiMeme, requireRh } from './context.ts';

type Ligne = Omit<ClotureConges, 'id'>;

/** Décision reçue pour une ligne de la clôture des CP. */
interface Decision { empId: number; decision: unknown; jours: unknown }

function decisions(p: Record<string, any>): Map<number, Decision> {
  const liste = Array.isArray(p.lignes) ? p.lignes.slice(0, 2000) : [];
  return new Map(liste.filter((x: unknown) => x && typeof x === 'object').map((x: Decision) => [Number(x.empId), x]));
}

/** Demandes en attente nommées dans un message : « du 24 mai au 28 mai 2027, le 2 juin 2027 ». */
export const demandesTexte = (attente: Pick<Absence, 'du' | 'au' | 'debutDemi' | 'finDemi'>[]) => attente.map(periodeDemiTexte).join(', ');

const egal = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/**
 * Ligne décidée par le service RH : report (jours en tout, report imposé compris) ou perte, contrôlés contre la proposition
 * de Cursus. Les jours d'un report imposé suivent leur échéance (15 mois, ou celle du report légal en cours) ; le reste
 * reporté court jusqu'au 31 mai suivant.
 */
function decider(ctx: Ctx, A: number, l: LigneClotureCp, x: Decision): Ligne {
  const nom = l.e.nom, base = { empId: l.e.id, type: 'CP' as const, periode: A, solde: l.solde, le: ctx.d.ti, par: ctx.user.nom, motif: l.impose };
  refuserSoiMeme(ctx, l.e, 'Vous ne pouvez pas décider du report de vos propres congés');
  if (l.attente.length) {
    throw new ActionError(`${nom} : demande de congés payés en attente (${demandesTexte(l.attente)}) — à valider ou refuser avant de clôturer son solde`);
  }
  if (x.decision === 'perdre') {
    if (l.legal > 0) throw new ActionError(`${nom} : perte impossible, ${fJ(l.legal)} sont à reporter (report légal des congés non pris)`);
    return { ...base, decision: 'perdre', reportes: 0, perdus: l.solde, expire: null, reportId: null };
  }
  if (x.decision !== 'reporter') throw new ActionError(`${nom} : choisissez le report ou la perte du solde`);
  const j = Number(x.jours);
  // Tout le solde, le seul report imposé, ou une partie par demi-journée (un solde repris de l'ancien outil peut tomber entre deux).
  const borne = egal(j, l.solde) || egal(j, l.legal);
  if (!(j > 0) || (!borne && ((j * 2) % 1 !== 0 || j > l.solde))) {
    throw new ActionError(`${nom} : nombre de jours à reporter invalide (${fJ(l.solde)} au plus, par demi-journée)`);
  }
  if (j < l.legal - 1e-9) throw new ActionError(`${nom} : ${fJ(l.legal)} au moins sont à reporter (report légal), jusqu’au ${fmtIso(l.expireLegal!)}`);
  const recu = (jours: number, expire: string, motif: string) => ctx.db.insert<ReportCp>('reports', {
    empId: l.e.id, jours, motif, par: ctx.user.nom, date: ctx.d.ti, sens: 'recu', periode: A + 1, expire,
  });
  // Reports reçus sur la période suivante : ils comptent dans ses droits jusqu'à leur échéance (shared/rules/conges.ts).
  const legal = l.legal > 0 ? recu(l.legal, l.expireLegal!, `Clôture de la période ${periodeCp(A)} — report légal`) : null;
  const libre = Math.round((j - l.legal) * 100) / 100;
  const choisi = libre > 0 ? recu(libre, echeanceReport(A), `Clôture de la période ${periodeCp(A)}`) : null;
  return {
    ...base, decision: 'reporter', reportes: j, perdus: Math.round((l.solde - j) * 100) / 100,
    expire: choisi ? echeanceReport(A) : l.expireLegal, reportId: (choisi ?? legal)!.id,
  };
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
    // Demande de CP en attente : rien n'est clos, même à solde nul (un refus rendrait des jours à la période).
    const ligne: Ligne | null = l.solde <= 0 && !l.attente.length
      ? { empId: l.e.id, type: 'CP', periode: A, solde: l.solde, decision: 'solde_nul', reportes: 0, perdus: 0, expire: null, reportId: null, motif: null, le: ctx.d.ti, par: ctx.user.nom }
      : x ? decider(ctx, A, l, x) : null;
    if (!ligne) continue;
    ctx.db.insert('clotures', ligne);
    n[ligne.decision]++;
  }
  const faites = n.reporter + n.perdre + n.solde_nul;
  const restants = lignes.filter(l => !l.deja).length - faites;
  const attente = lignes.filter(l => !l.deja && l.attente.length).map(l => l.e.nom);
  const enAttente = attente.length ? ` (demandes de CP en attente de décision : ${attente.join(', ')})` : '';
  if (!faites) return `Congés payés ${periodeCp(A)} : aucune ligne à clôturer${restants ? ` (${plural(restants, 'décision attendue', 'décisions attendues')})${enAttente}` : ' — période déjà clôturée'}`;
  return `Clôture des congés payés ${periodeCp(A)} : ${plural(n.reporter, 'report', 'reports')}, ${plural(n.perdre, 'perte', 'pertes')}, ${plural(n.solde_nul, 'salarié sans solde', 'salariés sans solde')}`
    + (restants ? ` · ${plural(restants, 'ligne reste', 'lignes restent')} à décider${enAttente}` : ' · période close');
}

/**
 * Jours rendus à une période de CP close (`avant` : le domaine lu avant l'action — refus d'une demande, annulation d'un
 * congé) : la ligne de clôture n'est jamais refaite ; le solde regagné est reporté sur la première période suivante encore
 * ouverte (report reçu, jusqu'à sa fin, ou jusqu'à l'échéance du report imposé de la ligne), tracé au journal par l'action
 * (`bilan`). Aucun jour ne disparaît sans décision. Texte pour le message, vide si rien n'est rendu.
 */
export function recrediterPeriodesCloses(ctx: Ctx, emp: Employe, avant: Domain): string {
  const closes = ctx.ds.clotures.filter(c => c.empId === emp.id && c.type === 'CP');
  if (!closes.length) return '';
  const apres = new Domain({ ...ctx.ds, absences: ctx.db.all<Absence>('absences') });
  const textes: string[] = [];
  for (const c of closes.sort((a, b) => a.periode - b.periode)) {
    const jours = Math.round((soldePeriode(apres, emp, c.periode) - soldePeriode(avant, emp, c.periode)) * 100) / 100;
    if (!(jours > 0)) continue;
    // Première période suivante encore ouverte ; échéance du report imposé de la ligne s'il court plus loin.
    let P = c.periode + 1;
    while (closes.some(x => x.periode === P)) P++;
    const expire = c.motif && c.expire && c.expire > finPeriodeCp(P) ? c.expire : finPeriodeCp(P);
    ctx.db.insert<ReportCp>('reports', {
      empId: emp.id, jours, motif: `Jours rendus après la clôture de la période ${periodeCp(c.periode)}`, par: ctx.user.nom, date: ctx.d.ti,
      sens: 'recu', periode: P, expire,
    });
    textes.push(`${fJ(jours)} de la période close ${periodeCp(c.periode)} reportés sur ${periodeCp(P)} (jusqu’au ${fmtIso(expire)})`);
  }
  return textes.join(', ');
}

function cloturerRtt(ctx: Ctx, Y: number): string {
  if (Y >= ctx.d.year) throw new ActionError(`Les RTT ${Y} se clôturent à partir du 1er janvier ${Y + 1}`);
  // Demande de RTT de l'année en attente : le salarié n'est pas clôturé (un refus rendrait des jours à l'année close).
  const ouvertes = lignesClotureRtt(ctx.d, Y).filter(l => !l.deja), lignes = ouvertes.filter(l => !l.attente.length);
  const attente = ouvertes.filter(l => l.attente.length).map(l => l.e.nom);
  const reste = attente.length ? ` · ${plural(attente.length, 'salarié non clôturé', 'salariés non clôturés')}, demande de RTT en attente de décision : ${attente.join(', ')}` : '';
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
  if (!lignes.length) return attente.length ? `RTT ${Y} : aucun salarié clôturé${reste}` : `RTT ${Y} : année déjà clôturée`;
  return `Clôture des RTT ${Y} : ${plural(lignes.length, 'salarié', 'salariés')}${perdus ? `, ${fJ(perdus)} non pris perdus (non reportables)` : ', aucun RTT perdu'}${reste}`;
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
