// Mes astreintes (t049, lot 7, étape 2), portail du salarié : astreintes en cours et à venir, et récapitulatif mensuel
// remis au salarié (art. R3121-2) — heures d'astreinte du mois, périodes, interventions (jour, heures, durée) et forme de la
// compensation réglée (Paramètres → Astreintes) —, à l'écran et imprimable (ou enregistré en PDF, impression tracée au
// journal). Mêmes nombres que la paie (shared/rules/astreintes.ts, `bilanMensuel` : heures d'horloge du mois, période
// comptée le mois où elle commence). Rien sans astreinte.
import { useState } from 'react';
import { PrinterIcon } from '@phosphor-icons/react';
import { parse } from '../../../shared/dates.ts';
import { cap, fH, fmtIso } from '../../../shared/format.ts';
import {
  astreinteActive, bilanMensuel, bilanTexte, COMPENSATION_LABEL, heuresAstreinte, heureTexte, periodeAstreinteTexte, reglagesAstreinte,
} from '../../../shared/rules/astreintes.ts';
import { periodeLabel } from '../../../shared/rules/paie.ts';
import type { Astreinte, Dataset, Employe, InterventionAstreinte } from '../../../shared/types.ts';
import { matriculesImprimes, printDocument, type PrintSection } from '../print.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { ETAT_ASTREINTE, etatAstreinte, maintenant } from './astreintes-etat.ts';
import { Btn, Fine, NoteAccent, Panel, Tag } from './ui.tsx';

/** Mois (« AAAA-MM ») où le salarié a eu au moins une heure d'astreinte, du plus récent au plus ancien, jusqu'au mois en cours. */
export function moisAstreintes(astreintes: readonly Astreinte[], empId: number, ti: string): string[] {
  const out = new Set<string>();
  for (const a of astreintes) {
    if (a.empId !== empId || !astreinteActive(a)) continue;
    for (let m = a.du.slice(0, 7); m <= a.au.slice(0, 7) && m <= ti.slice(0, 7); m = moisApres(m)) out.add(m);
  }
  return [...out].sort().reverse();
}
const moisApres = (m: string) => { const y = Number(m.slice(0, 4)), n = Number(m.slice(5, 7)); return n === 12 ? `${y + 1}-01` : `${y}-${String(n + 1).padStart(2, '0')}`; };

/** Forme de la compensation, telle que le récapitulatif l'indique (« Financière : montant sur le bulletin de paie »). */
export function compensationTexte(s: Partial<Dataset['settings']> | undefined): string {
  const r = reglagesAstreinte(s);
  return r.astreinteCompensation === 'repos' ? `${COMPENSATION_LABEL.repos} : durée fixée par l’accord sur les astreintes${r.astreinteAccord ? ` (${r.astreinteAccord})` : ''}` : COMPENSATION_LABEL.financiere;
}

/**
 * Sections du récapitulatif mensuel imprimé (art. R3121-2) : totaux du mois, astreintes, interventions, compensation.
 * Les astreintes à cheval sur deux mois y figurent avec leurs seules heures du mois.
 */
export function sectionsRecapitulatif(ds: Pick<Dataset, 'astreintes' | 'interventionsAstreinte' | 'settings'>, e: Pick<Employe, 'id'>, mois: string): PrintSection[] {
  const b = bilanMensuel(ds.astreintes, ds.interventionsAstreinte, e.id, mois);
  const astreintes = (ds.astreintes ?? []).filter(a => a.empId === e.id && astreinteActive(a) && a.du.slice(0, 7) <= mois && a.au.slice(0, 7) >= mois)
    .sort((x, y) => x.du.localeCompare(y.du) || x.debut.localeCompare(y.debut));
  const ints = interventionsDuMois(ds.interventionsAstreinte, e.id, mois);
  return [
    {
      title: 'Totaux du mois', rows: [
        ['Heures d’astreinte', fH(b.heures)],
        ['Périodes commencées dans le mois', String(b.periodes)],
        ['Interventions (travail effectif)', b.interventions ? `${b.interventions} · ${fH(b.heuresInterventions)}` : 'aucune'],
        ['Forme de la compensation', compensationTexte(ds.settings)],
      ],
    },
    {
      title: 'Périodes d’astreinte',
      table: { head: ['Période', 'Durée totale', 'Dont ce mois'], rows: astreintes.map(a => [cap(periodeAstreinteTexte(a)), fH(heuresAstreinte(a)), fH(bilanMensuel([a], [], e.id, mois).heures)]) },
    },
    ...(ints.length ? [{
      title: 'Interventions déclarées',
      table: { head: ['Jour', 'De', 'À', 'Durée'], rows: ints.map(x => [fmtIso(x.jour), heureTexte(x.debut), `${heureTexte(x.fin)}${x.fin <= x.debut ? ' (lendemain)' : ''}`, fH(x.heures)]) },
    }] : []),
    {
      title: 'À savoir',
      text: 'Récapitulatif remis chaque mois au salarié (art. R3121-2). Les interventions sont du travail effectif, payées avec les autres heures de la feuille de temps '
        + '(heures supplémentaires, de nuit et du dimanche comprises) ; le temps d’astreinte sans intervention compte comme repos.',
    },
  ];
}

/** Interventions d'un salarié qui commencent dans le mois, dans l'ordre. */
const interventionsDuMois = (list: readonly InterventionAstreinte[] | undefined, empId: number, mois: string) =>
  (list ?? []).filter(x => x.empId === empId && x.jour.slice(0, 7) === mois).sort((a, b) => a.jour.localeCompare(b.jour) || a.debut.localeCompare(b.debut));

/** Bloc « Mes astreintes » du portail : prochaines astreintes et récapitulatif mensuel. */
export function AstreintesPortail({ e }: { e: Employe }) {
  const d = useDomain();
  const { notify } = useStore();
  const tous = moisAstreintes(d.ds.astreintes ?? [], e.id, d.ti);
  const [choix, setChoix] = useState<string | null>(null);
  const m = maintenant(d.ti);
  const prochaines = (d.ds.astreintes ?? []).filter(a => a.empId === e.id && ['avenir', 'encours'].includes(etatAstreinte(a, m)))
    .sort((a, b) => a.du.localeCompare(b.du) || a.debut.localeCompare(b.debut));
  if (!tous.length && !prochaines.length) return null;
  // Mois du récapitulatif : le plus récent par défaut (aucun tant que la première astreinte n'a pas commencé).
  const mois = choix && tous.includes(choix) ? choix : tous[0] ?? null;
  const b = mois ? bilanMensuel(d.ds.astreintes, d.ds.interventionsAstreinte, e.id, mois) : null;
  const ints = mois ? interventionsDuMois(d.ds.interventionsAstreinte, e.id, mois) : [];
  const imprimer = () => {
    if (!mois) return;
    if (!printDocument(`Récapitulatif des astreintes — ${periodeLabel(mois)}`, `${e.nom} · ${e.poste}`, sectionsRecapitulatif(d.ds, e, mois), e.id, matriculesImprimes(e))) {
      notify('Autorisez les fenêtres surgissantes pour imprimer le récapitulatif', true);
    }
  };

  return (
    <Panel title="Mes astreintes" aside={mois && <Btn small icon={<PrinterIcon size={14} />} onClick={imprimer}>Imprimer le récapitulatif</Btn>} style={{ gap: 'var(--space-3)' }}>
      {prochaines.map(a => (
        <div key={a.id} className="item-head">
          <div><div style={{ fontSize: 14 }}>{cap(periodeAstreinteTexte(a))}</div><div className="text-muted sub">{fH(heuresAstreinte(a))} · communiquée le {fmtIso(a.communiqueLe)}</div></div>
          <Tag cls={ETAT_ASTREINTE[etatAstreinte(a, m)].cls} style={{ flex: 'none' }}>{ETAT_ASTREINTE[etatAstreinte(a, m)].label}</Tag>
        </div>
      ))}
      {mois && b && (<>
        <div className="field">
          <label htmlFor="ast-recap-mois">Récapitulatif du mois</label>
          <select className="input" id="ast-recap-mois" value={mois} onChange={ev => setChoix(ev.target.value)} style={{ maxWidth: 240 }}>
            {tous.map(x => <option key={x} value={x}>{cap(periodeLabel(x))}</option>)}
          </select>
        </div>
        <NoteAccent>{cap(bilanTexte(b))}</NoteAccent>
        {ints.map(x => (
          <div key={x.id} className="sub">{cap(parse(x.jour).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))} : intervention de {heureTexte(x.debut)} à {heureTexte(x.fin)} ({fH(x.heures)})</div>
        ))}
      </>)}
      <div className="sub">Compensation : {compensationTexte(d.ds.settings)}</div>
      <Fine>
        Récapitulatif des heures d’astreinte et de leur compensation remis chaque mois (art. R3121-2). Vos interventions sont du travail effectif, sur votre feuille
        de temps ; après chacune, 11 heures de repos consécutives sont dues.
      </Fine>
    </Panel>
  );
}
