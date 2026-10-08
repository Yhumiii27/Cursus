// Feuilles de temps : décompte des heures, majorations, variables de paie.
import { isFerie, isoWeek, parse, wDays } from '../dates.ts';
import { matricule, num, r1 } from '../format.ts';
import type { Domain } from '../domain.ts';
import type { ContratFige, Employe, FeuilleTemps, ISODate, LigneTemps, SagePush } from '../types.ts';

/** Régime de temps de travail en vigueur d'une fiche, à figer sur une feuille soumise. */
export function contratFige(e: Employe): ContratFige {
  return { statut: e.statut, typeContrat: e.typeContrat, temps: e.temps, heures: e.heures, forfaitHeures: e.forfaitHeures, forfaitJours: e.forfaitJours, jourOff: [...(e.jourOff ?? [])] };
}
/** Le collaborateur tel qu'il était la semaine de la feuille (régime figé s'il existe). */
export function employeDeLaFeuille(e: Employe, sh: { contrat?: ContratFige | null } | null): Employe {
  return sh?.contrat ? { ...e, ...sh.contrat } : e;
}

export interface SheetCalc {
  perDay: number[]; total: number; warn: string[];
  /** Heures payées au taux normal (dans la limite de 35 h). */
  normal: number;
  /** Heures supplémentaires structurelles incluses dans un forfait hebdomadaire (total, dont +25 % et +50 %). */
  incluses: number; incluses25: number; incluses50: number;
  sup25: number; sup50: number; hc10: number; hc25: number; recup: number; jours: number;
  c: ReturnType<Domain['contratOf']>;
}

/**
 * Décompte hebdomadaire selon l'organisation du temps de travail en vigueur la semaine de la feuille
 * (régime figé à la soumission, sinon celui de la fiche) :
 * - 35 h, 39 h + RTT, forfait hebdomadaire : heures supplémentaires au-delà du seuil
 *   (+25 % de la 36e à la 43e heure, +50 % au-delà), converties en repos compensateur ;
 * - temps partiel : heures complémentaires (+10 % jusqu'au dixième de la durée, +25 % au-delà) ;
 * - forfait jours et cadre dirigeant : décompte en jours, pas d'heures supplémentaires ;
 * - forfait annuel en heures : pas de décompte hebdomadaire (cumul annuel, voir `cumulAnnuel`).
 */
export function calcSheet(d: Domain, e: Employe, sh: (Pick<FeuilleTemps, 'lignes'> & { contrat?: ContratFige | null }) | null): SheetCalc {
  const c = d.contratOf(employeDeLaFeuille(e, sh));
  const perDay = [0, 1, 2, 3, 4].map(i => (sh ? sh.lignes : []).reduce((n, l) => n + num(l.h[i]), 0));
  const total = perDay.reduce((a, b) => a + b, 0);
  const warn: string[] = [];
  if (c.forfait) {
    // Forfait jours : durées maximales exclues (art. L3121-62) ; seuls les repos quotidien et hebdomadaire s'appliquent.
    if (perDay.some(h => h > 13)) warn.push('Plus de 13 h sur une journée : repos quotidien de 11 h non respecté (art. L3131-1)');
  } else if (!c.dirigeant) {
    if (perDay.some(h => h > 10)) warn.push('Plus de 10 h sur une journée (art. L3121-18)');
    if (total > 48) warn.push('Plus de 48 h dans la semaine (art. L3121-20)');
  }
  const r: SheetCalc = { perDay, total, c, warn, normal: total, incluses: 0, incluses25: 0, incluses50: 0, sup25: 0, sup50: 0, hc10: 0, hc25: 0, recup: 0, jours: 0 };
  const jours = perDay.reduce((n, h) => n + (h === 0 ? 0 : h <= 4 ? 0.5 : 1), 0);
  if (c.forfait || c.dirigeant || c.annuel) r.jours = jours;
  else if (c.partiel) {
    const hc = Math.max(0, total - c.base);
    r.hc10 = Math.min(hc, c.base / 10);
    r.hc25 = hc - r.hc10;
    r.normal = total - hc;
    if (hc > c.base / 3) warn.push('Heures complémentaires au-delà du tiers de la durée contractuelle');
    if (total >= 35) warn.push('Temps partiel porté à 35 h ou plus');
  } else {
    const seuil = c.seuil ?? 35;
    const sup = Math.max(0, total - seuil);
    // Les taux dépendent du rang de l'heure dans la semaine : +25 % jusqu'à 43 h, +50 % au-delà.
    r.sup25 = Math.max(0, Math.min(total, 43) - Math.max(seuil, 35));
    r.sup25 = Math.min(sup, r.sup25);
    r.sup50 = sup - r.sup25;
    if (c.hebdo) {
      r.normal = Math.min(total, 35);
      r.incluses25 = Math.max(0, Math.min(total, seuil, 43) - 35);
      r.incluses50 = Math.max(0, Math.min(total, seuil) - 43);
      r.incluses = r.incluses25 + r.incluses50;
    } else r.normal = total - sup;
    r.recup = c.interim ? 0 : r.sup25 * 1.25 + r.sup50 * 1.5;
  }
  return r;
}

/**
 * Forfait annuel en heures : cumul des feuilles validées de l'année, cible proratisée selon la présence
 * (entrée, fin de contrat) et part de la cible correspondant à la période déjà écoulée.
 */
export function cumulAnnuel(d: Domain, e: Employe, year = d.year) {
  const c = d.contratOf(e);
  const done = d.ds.feuilles
    .filter(sh => sh.empId === e.id && sh.statut === 'validee' && sh.week.startsWith(String(year)))
    .reduce((n, sh) => n + calcSheet(d, e, sh).total, 0);
  const start = new Date(year, 0, 1).getTime(), end = new Date(year + 1, 0, 1).getTime();
  const debut = Math.max(start, parse(e.entree).getTime());
  const fin = e.fin ? Math.min(end, parse(e.fin).getTime() + 864e5) : end;
  const presence = Math.max(0, fin - debut) / (end - start);
  const cible = Math.round(c.heuresAnnuelles * presence);
  const ecoule = fin > debut ? Math.min(1, Math.max(0, (d.today.getTime() - debut) / (fin - debut))) : 1;
  return { done, cible, prorata: cible * ecoule, depasse: done > cible, annee: year };
}

/** Lignes proposées à partir des tâches Keystone (fériés, absences et jours non travaillés à zéro). */
export function suggestLines(d: Domain, e: Employe, w: ISODate): LigneTemps[] {
  const wd = wDays(w), off = d.contratOf(e).jourOff;
  return d.ds.taches.filter(t => t.empId === e.id).map(t => ({
    projet: t.projet, tache: t.tache, ks: true,
    h: t.heures.map((v, i) => isFerie(wd[i]) || d.absOn(e.id, wd[i]) || off.includes(i) ? 0 : v),
  }));
}

export function sageRubriques(d: Domain, e: Employe, sh: FeuilleTemps): Record<string, number> {
  const c = calcSheet(d, e, sh);
  if (c.c.forfait) return { JTRAV: c.jours };
  if (c.c.annuel) return { HN: r1(c.total) };
  return {
    HN: r1(c.normal),
    ...(c.incluses25 ? { HSF25: r1(c.incluses25) } : {}),
    ...(c.incluses50 ? { HSF50: r1(c.incluses50) } : {}),
    ...(c.sup25 ? { HS25: r1(c.sup25) } : {}),
    ...(c.sup50 ? { HS50: r1(c.sup50) } : {}),
    ...(c.hc10 ? { HC10: r1(c.hc10) } : {}),
    ...(c.hc25 ? { HC25: r1(c.hc25) } : {}),
    ...(c.recup ? { RCR_ACQUIS: r1(c.recup) } : {}),
  };
}

/** Feuilles validées, non encore transmises, hors intérimaires (relevé envoyé à l'agence) et cadres dirigeants. */
export function sagePending(d: Domain): FeuilleTemps[] {
  return d.ds.feuilles.filter(sh => {
    const e = d.emp(sh.empId);
    if (!e || sh.statut !== 'validee' || sh.sage) return false;
    const c = d.contratOf(employeDeLaFeuille(e, sh));
    return !c.interim && !c.dirigeant;
  });
}

export function buildSagePayload(d: Domain, sheets: FeuilleTemps[], dossier: string): SagePush {
  const today = d.ti;
  return {
    endpoint: 'POST /sage-paie/v1/variables',
    dossier,
    periode_paie: today.slice(0, 7),
    envoye_le: `${today}T09:00:00+02:00`,
    lignes: sheets.map(sh => ({
      matricule: matricule(sh.empId),
      semaine: `${parse(sh.week).getFullYear()}-S${String(isoWeek(sh.week)).padStart(2, '0')}`,
      rubriques: sageRubriques(d, d.emp(sh.empId)!, sh),
    })),
  };
}
