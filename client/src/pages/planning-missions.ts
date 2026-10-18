// Planning des missions (écran Missions, t148) : 4 semaines de jours ouvrés, une ligne par salarié en mission ou absent
// (toute l'équipe pour un manager). Chaque case porte, en plus de sa couleur, une lettre (M mission, A absence validée ou
// signalée, D absence demandée, F férié) et un texte complet lu au lecteur d'écran et affiché au toucher ou au focus ;
// chaque ligne a un résumé textuel (« 3 j de mission · 2 j d'absence »). Calcul sans React, testé dans
// tests/ergonomie-liens.test.ts.
import { ABS_LABEL } from '../../../shared/constants.ts';
import { addD, isFerie, mondayOf, parse, weekday } from '../../../shared/dates.ts';
import type { Domain } from '../../../shared/domain.ts';
import { plural } from '../../../shared/format.ts';
import { absenceActive, absenceBloque, statutAbsence } from '../../../shared/rules/absences.ts';
import type { ISODate } from '../../../shared/types.ts';

/** Nature d'une case : la couleur, la lettre et la légende en découlent. */
export type NatureCase = 'mission' | 'absence' | 'demande' | 'ferie' | 'present';

/** Lettre de chaque nature (vide : présent). */
export const MARQUE: Record<NatureCase, string> = { mission: 'M', absence: 'A', demande: 'D', ferie: 'F', present: '' };

export interface CasePlanning {
  s: ISODate;
  nature: NatureCase;
  /** Date complète et contenu du jour : « lundi 12 octobre 2026 — Férié ». */
  texte: string;
}
export interface LignePlanning { id: number; nom: string; cases: CasePlanning[]; resume: string }

/** Date complète d'un jour du planning (en-tête de colonne, texte des cases). */
export const jourComplet = (s: ISODate) => parse(s).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Résumé d'une ligne : jours de mission, d'absence et demandés ; « Présent » sinon. Les fériés, communs à tous, n'y figurent pas. */
export function resumeLigne(cases: Pick<CasePlanning, 'nature'>[]): string {
  const n = (x: NatureCase) => cases.filter(c => c.nature === x).length;
  const parts = [
    n('mission') && `${n('mission')} j de mission`,
    n('absence') && `${n('absence')} j d’absence`,
    n('demande') && `${plural(n('demande'), 'j demandé', 'j demandés')}`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Présent';
}

/** Les 20 jours ouvrés à partir du lundi de la semaine en cours, et une ligne par salarié concerné. */
export function planningMissions(d: Domain, manager: boolean): { days: ISODate[]; lignes: LignePlanning[] } {
  const data = d.ds, ti = data.today;
  const days: ISODate[] = [];
  for (let s = mondayOf(ti); days.length < 20; s = addD(s, 1)) if (weekday(s) < 5) days.push(s);
  const first = days[0], last = days[days.length - 1];
  const ids = data.employes.map(e => e.id).filter(id => manager
    || data.missions.some(m => m.empId === id && m.du <= last && m.au >= first)
    || data.absences.some(a => a.empId === id && absenceActive(a) && a.du <= last && a.au >= first));
  const lignes = ids.map(id => {
    const cases = days.map((s): CasePlanning => {
      const m = data.missions.find(x => x.empId === id && x.du <= s && x.au >= s), a = d.absOn(id, s, true), fer = isFerie(s);
      const nature: NatureCase = fer ? 'ferie' : m ? 'mission' : a ? (absenceBloque(a) ? 'absence' : 'demande') : 'present';
      const quoi = fer ? 'Férié' : m ? `Mission ${m.projet} · ${m.lieu}` : a ? `${ABS_LABEL[a.type]} (${statutAbsence(a).toLowerCase()})` : 'Présent';
      return { s, nature, texte: `${jourComplet(s)} — ${quoi}` };
    });
    return { id, nom: d.personName(id), cases, resume: resumeLigne(cases) };
  });
  return { days, lignes };
}
