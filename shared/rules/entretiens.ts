// Entretiens obligatoires (art. L6315-1, L3121-64) et campagne annuelle.
import { addD, addM, parse } from '../dates.ts';
import { fmt } from '../format.ts';
import type { Domain } from '../domain.ts';
import type { Employe, Entretien, EntretienType, ISODate } from '../types.ts';

export type ObligStatus = 'late' | 'soon' | 'planifie' | 'todo' | 'ok';
export interface Obligation { id: number; e: Employe; kind: EntretienType; due: ISODate; detail: string; pl?: Entretien; st: ObligStatus; risk?: boolean }

export const ENT_ST: Record<ObligStatus, [string, string]> = {
  late: ['En retard', 'tag-accent'], soon: ['À échéance', 'tag-outline'], planifie: ['Planifié', 'tag-neutral'], todo: ['À planifier', 'tag-outline'], ok: ['À jour', 'tag-neutral'],
};

export function obligations(d: Domain, scopeIds: number[]): Obligation[] {
  const Ti = d.ti, in90 = addD(Ti, 90), Y = d.year;
  const out: Obligation[] = [];
  scopeIds.forEach(id => {
    const e = d.emp(id);
    if (!e) return;
    const c = d.contratOf(e);
    if (c.interim) return;
    const list = d.ds.entretiens.filter(x => x.empId === id);
    const done = (t: EntretienType[]) => list.filter(x => t.includes(x.type) && x.statut === 'realise').sort((a, b) => b.date.localeCompare(a.date));
    const push = (kind: EntretienType, due: ISODate, detail: string, extra?: Partial<Obligation>) => {
      const pl = list.find(x => x.type === kind && x.statut === 'planifie');
      out.push({ id, e, kind, due, detail, pl, st: pl ? 'planifie' : due < Ti ? 'late' : due <= in90 ? 'soon' : 'ok', ...(extra || {}) });
    };
    const lastE = done(['epp', 'reprise'])[0];
    push('epp', lastE ? addM(lastE.date, 48) : addM(e.entree, 12),
      lastE ? `Dernier le ${fmt(parse(lastE.date))} · périodicité 4 ans` : `Embauche le ${fmt(parse(e.entree))} — premier entretien dans l’année`);
    if (e.repriseDate && !(lastE && lastE.date >= e.repriseDate)) {
      push('reprise', e.repriseDate, `Retour de ${e.repriseMotif ?? 'congé'} le ${fmt(parse(e.repriseDate))} — à proposer systématiquement`);
    }
    let anniv = addM(e.entree, 96);
    while (anniv < addM(Ti, -12)) anniv = addM(anniv, 96);
    if (anniv <= addM(Ti, 12) && !done(['bilan']).some(x => x.date >= addM(anniv, -12))) {
      const from = addM(anniv, -96);
      const nE = list.filter(x => ['epp', 'reprise'].includes(x.type) && x.statut === 'realise' && x.date >= from).length;
      const fno = e.certs.some(cc => d.fm(cc.f).type !== 'Réglementaire' && cc.obtenue >= from);
      push('bilan', anniv, `${nE} entretien${nE > 1 ? 's' : ''} de parcours sur 8 ans (2 attendus) · ${fno ? 'formation non obligatoire suivie' : 'aucune formation non obligatoire'}`, { risk: nE < 2 || !fno });
    }
    if (c.forfait) {
      // Premier entretien dans l'année suivant l'entrée dans la convention de forfait.
      const debut = [e.entree, e.tempsDepuis ?? ''].sort().at(-1)!;
      const lf = done(['forfait']).filter(x => x.date >= debut)[0];
      push('forfait', lf ? addM(lf.date, 12) : addM(debut, 12), lf ? `Dernier le ${fmt(parse(lf.date))} · chaque année` : debut > e.entree ? `Forfait jours depuis le ${fmt(parse(debut))} — premier entretien dans l’année` : 'Aucun entretien enregistré');
    }
    if (!list.some(x => x.type === 'annuel' && x.date >= `${Y}-01-01`)) {
      out.push({ id, e, kind: 'annuel', due: `${Y}-12-15`, st: 'todo', detail: `Campagne ${Y} — du 1er octobre au 15 décembre` });
    }
  });
  return out;
}

/** Sections supplémentaires « fin de carrière » à partir de 58 ans. */
export function needsFinCarriere(d: Domain, e: Employe, type: EntretienType): boolean {
  return ['epp', 'reprise'].includes(type) && d.year - e.naissance >= 58;
}
