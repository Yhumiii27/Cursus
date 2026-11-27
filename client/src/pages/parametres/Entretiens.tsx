// Paramètres → Campagne d'entretiens annuels : ouverture et clôture, ancienneté minimale, contrats exclus, affichage de
// l'échéance avant l'ouverture (réglages de l'administrateur RH, shared/rules/campagne.ts ; les autres profils les
// consultent). Par défaut, le fonctionnement d'origine : du 1er octobre au 15 décembre, sans ancienneté minimale, seul
// l'intérim exclu, échéance affichée toute l'année. Les dates s'enregistrent ensemble (« Enregistrer les dates ») : le
// serveur refuse une ouverture postérieure à la clôture.
import { useState } from 'react';
import { TYPES_CONTRAT } from '../../../../shared/constants.ts';
import { ANCIENNETES, CONTRATS_EXCLUABLES, campagne, PREAVIS, PREAVIS_TOUTE_ANNEE } from '../../../../shared/rules/campagne.ts';
import type { TypeContrat } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, Panel } from '../../components/ui.tsx';
import { useDomain, useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t, tn } from '../../i18n/langue.ts';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** Jours de chaque mois d'une année ordinaire (le 29 février n'existe pas chaque année). */
const JOURS_MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const pad = (n: number) => String(n).padStart(2, '0');

/** Jour et mois d'un réglage « MM-JJ » : deux listes ; un jour au-delà de la fin du mois est ramené à son dernier jour. */
export function JourMois({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  const [m, j] = value.split('-').map(Number);
  const changer = (mois: number, jour: number) => onChange(`${pad(mois)}-${pad(Math.min(jour, JOURS_MOIS[mois - 1]))}`);
  return (
    <Field label={label} htmlFor={`${id}-jour`}>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <select className="input" id={`${id}-jour`} aria-label={`${label}${t(': day')}`} value={j} disabled={disabled} onChange={e => changer(m, Number(e.target.value))} style={{ width: 80 }}>
          {Array.from({ length: JOURS_MOIS[m - 1] }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n === 1 ? '1er' : n}</option>)}
        </select>
        <select className="input" aria-label={`${label}${t(': month')}`} value={m} disabled={disabled} onChange={e => changer(Number(e.target.value), j)} style={{ flex: 1 }}>
          {MOIS.map((nom, i) => <option key={nom} value={i + 1}>{nom}</option>)}
        </select>
      </div>
    </Field>
  );
}

export function Entretiens({ s }: SectionProps) {
  const d = useDomain();
  const { admin } = useRole();
  const enregistrer = useEnregistrerReglages();
  // Dates en cours de saisie : enregistrées ensemble, au bouton.
  const [debut, setDebut] = useState<string | null>(null);
  const [fin, setFin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dDebut = debut ?? s.campagneDebut, dFin = fin ?? s.campagneFin;
  const modifiees = dDebut !== s.campagneDebut || dFin !== s.campagneFin;
  const ordre = dDebut > dFin ? t('The opening must precede the closing, in the same year.') : null;
  const c = campagne({ ...s, campagneDebut: dDebut, campagneFin: dFin }, d.year);

  const enregistrerDates = async () => {
    if (busy || ordre) return;
    setBusy(true);
    const r = await enregistrer({ campagneDebut: dDebut, campagneFin: dFin });
    setBusy(false);
    if (r.ok) { setDebut(null); setFin(null); }
  };
  const exclure = (ty: TypeContrat, oui: boolean) =>
    enregistrer({ campagneExclus: CONTRATS_EXCLUABLES.filter(x => (x === ty ? oui : s.campagneExclus.includes(x))) });

  return (
    <Panel title={t('Annual review campaign')} style={{ gap: 'var(--space-4)' }}>
      <div className="grid-2">
        <JourMois id="camp-debut" label={t('Opening')} value={dDebut} onChange={setDebut} disabled={!admin} />
        <JourMois id="camp-fin" label={t('Closing (due date)')} value={dFin} onChange={setFin} disabled={!admin} />
      </div>
      {ordre && <p className="form-error">{ordre}</p>}
      {admin && modifiees && (
        <div className="actions-end">
          <Btn variant="secondary" disabled={busy} onClick={() => { setDebut(null); setFin(null); }}>{t('Cancel')}</Btn>
          <Btn variant="primary" disabled={busy} onClick={enregistrerDates}>{t('Save the dates')}</Btn>
        </div>
      )}
      <Fine>{c.libelle}{t('. The annual appraisal review, distinct from the professional career review, is expected from each employee concerned before the closing.')}</Fine>

      <Field label={t('Minimum seniority at the opening')} htmlFor="camp-anciennete">
        <select className="input" id="camp-anciennete" value={s.campagneAncienneteMois} disabled={!admin}
          onChange={e => enregistrer({ campagneAncienneteMois: Number(e.target.value) })}>
          {[...new Set([...ANCIENNETES, s.campagneAncienneteMois])].sort((a, z) => a - z)
            .map(n => <option key={n} value={n}>{n ? tn(n, 'month#count', 'months#count') : t('None#fem')}</option>)}
        </select>
      </Field>

      <Field label={t('Contracts concerned')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {CONTRATS_EXCLUABLES.map(ty => (
            <label key={ty} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
              <input type="checkbox" checked={!s.campagneExclus.includes(ty)} disabled={!admin} onChange={e => exclure(ty, !e.target.checked)}
                style={{ accentColor: 'var(--color-accent)' }} />
              {TYPES_CONTRAT[ty].label}
            </label>
          ))}
          <span className="text-muted sub">{t('Permanent contracts: always concerned · temp work: never (the temp worker comes under their agency).')}</span>
        </div>
      </Field>

      <Field label={t('Due date shown in Reviews')} htmlFor="camp-preavis">
        <select className="input" id="camp-preavis" value={s.campagnePreavisJours} disabled={!admin}
          onChange={e => enregistrer({ campagnePreavisJours: Number(e.target.value) })}>
          {[...new Set([...PREAVIS, s.campagnePreavisJours])].sort((a, z) => z - a).map(n => (
            <option key={n} value={n}>{n >= PREAVIS_TOUTE_ANNEE ? t('All year') : n ? `${n}${t(' days before the opening')}` : t('At the opening')}</option>
          ))}
        </select>
      </Field>
      <Fine>{t('The annual review appears “To plan” in the due dates to handle from that moment, for each employee concerned who has not had one in the year; it is planned from this line.')}</Fine>
    </Panel>
  );
}
