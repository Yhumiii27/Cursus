// Horaire de poste du jour sur la feuille de temps (lot 6, shared/rules/horaires.ts) : une ligne « Horaire » au-dessus des
// projets dans la grille de la semaine (pages/Temps.tsx), un sélecteur sous le titre du jour dans la vue « un jour » des
// téléphones et tablettes (pages/SaisieJour.tsx). Un jour non choisi qui porte des heures affiche l'horaire par défaut de
// l'équipe, en retrait (« proposé ») ; le choisir, ou choisir « Aucun », l'inscrit sur la feuille (`temps.horaire`).
// Rien ne s'affiche tant que le référentiel n'a aucun horaire en vigueur et que la feuille n'en porte pas.
import type { CSSProperties } from 'react';
import { horaireDe, horairesDeLaFeuille, horairesEnVigueur, horaireTexte, type HoraireDuJour } from '../../../shared/rules/horaires.ts';
import { estWeekEnd } from '../../../shared/rules/semaine.ts';
import type { Employe, FeuilleTemps, ISODate } from '../../../shared/types.ts';
import { useDomain } from '../state/derived.ts';
import { Fine } from './ui.tsx';
import { useStore } from '../state/store.tsx';

export interface HorairesFeuille {
  /** Horaire de chaque jour (0 = lundi … 6 = dimanche). */
  jours: HoraireDuJour[];
  /** Horaires proposés au choix (en vigueur), plus ceux déjà portés par la feuille et archivés depuis. */
  options: { code: string; texte: string }[];
  editable: boolean;
  choisir: (di: number, code: string) => Promise<boolean>;
}

/** Horaires de la feuille affichée ; null quand il n'y a rien à montrer (aucun horaire au référentiel ni sur la feuille). */
export function useHorairesFeuille(emp: Employe, wk: ISODate, sh: FeuilleTemps | null, perDay: readonly number[], editable: boolean): HorairesFeuille | null {
  const d = useDomain();
  const { run } = useStore();
  const ref = d.ds.referentiels;
  const enVigueur = horairesEnVigueur(ref);
  if (!enVigueur.length && !sh?.horaires?.some(Boolean) && !sh?.horairesFiges?.some(Boolean)) return null;
  const jours = horairesDeLaFeuille(ref, emp.equipe, sh, perDay);
  const archives = [...new Set(jours.map(j => j.code).filter((c): c is string => !!c && !enVigueur.some(h => h.code === c)))];
  const options = [
    ...enVigueur.map(h => ({ code: h.code, texte: horaireTexte(h) })),
    ...archives.map(c => { const h = horaireDe(ref, c); return { code: c, texte: h ? `${horaireTexte(h)} (archivé)` : c }; }),
  ];
  const choisir = async (di: number, code: string) => (await run('temps.horaire', { empId: emp.id, week: wk, di, code }, { silent: true })).ok;
  return { jours, options, editable, choisir };
}

/** Sélecteur de l'horaire d'un jour ; `label` : nom pour un lecteur d'écran (« Horaire — lundi 12 octobre »). */
export function ChoixHoraire({ h, di, label, style }: { h: HorairesFeuille; di: number; label: string; style?: CSSProperties }) {
  const j = h.jours[di];
  return (
    <select className="input" aria-label={label} value={j.code ?? ''} disabled={!h.editable}
      title={j.propose ? 'Horaire par défaut de l’équipe, proposé : à confirmer ou à changer' : undefined}
      onChange={e => { void h.choisir(di, e.target.value); }}
      style={{ ...style, ...(j.propose ? { fontStyle: 'italic', color: 'var(--color-neutral-500)' } : {}) }}>
      <option value="">—</option>
      {h.options.map(o => <option key={o.code} value={o.code}>{o.code}</option>)}
    </select>
  );
}

/**
 * Ligne « Horaire » de la grille de la semaine : un sélecteur par colonne affichée ; week-end replié : les codes du samedi
 * et du dimanche. `colonnes` : jours affichés ; `long` : nom de chaque jour en toutes lettres.
 */
export function LigneHoraires({ h, colonnes, weekEndReplie, long }: { h: HorairesFeuille; colonnes: number[]; weekEndReplie: boolean; long: string[] }) {
  const replie = [5, 6].map(i => h.jours[i].code).filter(Boolean).join(' · ');
  return (
    <tr>
      <td style={{ minWidth: 180 }}>
        <div>Horaire du jour</div>
        <div className="text-muted sub">{h.jours.some(j => j.propose) ? 'en italique : proposé par l’équipe' : 'facultatif'}</div>
      </td>
      {colonnes.map(di => (
        <td key={di} className={`center${estWeekEnd(di) ? ' col-weekend' : ''}`}>
          <ChoixHoraire h={h} di={di} label={`Horaire — ${long[di]}`} style={{ width: 64, padding: '0 var(--space-2)' }} />
        </td>
      ))}
      {weekEndReplie && <td className="center col-weekend nowrap">{replie || '—'}</td>}
      <td></td><td></td>
    </tr>
  );
}

/**
 * Rappel sous la grille : plage de chaque horaire porté par la feuille (« J · 8 h – 16 h, pause 60 min »), avec les heures
 * retenues, celles figées à la soumission pour une feuille soumise (un code peut alors avoir deux plages dans la semaine).
 */
export function LegendeHoraires({ h }: { h: HorairesFeuille }) {
  const textes = [...new Set(h.jours.map(j => (j.horaire ? horaireTexte(j.horaire) : '')).filter(Boolean))];
  if (!textes.length) return null;
  return <Fine>Horaires : {textes.join(' ; ')}.</Fine>;
}
