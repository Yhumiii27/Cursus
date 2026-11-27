// Paramètres → Règles de suivi : seuil d'alerte par défaut, formations réglementaires seules, seuil de tension
// budgétaire (réglages de l'administrateur RH ; les autres profils les consultent).
import { useRef, useState } from 'react';
import type { Settings } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

const HORIZONS = (): [number, string][] => [30, 60, 90, 120, 150, 180].map(n => [n, `${n}${t(' d#days')}`]);

export function Suivi({ s }: SectionProps) {
  const { setUi } = useStore();
  const { admin } = useRole();
  const enregistrer = useEnregistrerReglages();
  const save = async (patch: Partial<Settings>) => {
    const r = await enregistrer(patch);
    // Le tableau de bord reprend le nouveau seuil par défaut (son ajustement ponctuel est oublié).
    if (r.ok && patch.horizonAlerte !== undefined) setUi({ horizon: null });
    return r;
  };

  // Seuil budgétaire : valeur en cours de glissement, enregistrée au relâchement.
  const [seuilDraft, setSeuilDraft] = useState<number | null>(null);
  const seuil = seuilDraft ?? s.seuilBudget;
  const savingSeuil = useRef(false);
  const commitSeuil = async () => {
    const value = seuilDraft;
    if (value == null || savingSeuil.current) return;
    savingSeuil.current = true;
    try {
      if (value !== s.seuilBudget) await save({ seuilBudget: value });
    } finally {
      savingSeuil.current = false;
      setSeuilDraft(cur => (cur === value ? null : cur));
    }
  };

  return (
    <Panel title={t('Follow-up rules')} style={{ gap: 'var(--space-4)' }}>
      <Field label={t('Default alert threshold')}>
        <Seg name="param-horizon" label={t('Default alert threshold')} value={s.horizonAlerte} options={HORIZONS()} disabled={!admin}
          onChange={v => save({ horizonAlerte: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Fine>{t('A certification, an authorisation or a travel document becomes “To renew” when it expires within this time limit. The dashboard allows adjusting it occasionally.')}</Fine>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.uniquementReglementaire} disabled={!admin} onChange={e => save({ uniquementReglementaire: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          {t('Follow only the regulatory training courses')}
          <span className="text-muted sub" style={{ display: 'block' }}>{t('The recommended and internal training courses leave the compliance statuses, the due dates and the catalogue offered to the employees.')}</span>
        </span>
      </label>

      <Field label={t('Budget tension threshold')} htmlFor="param-seuil">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <input id="param-seuil" type="range" min={60} max={100} step={5} value={seuil} disabled={!admin}
            onChange={e => setSeuilDraft(Number(e.target.value))} onPointerUp={commitSeuil} onKeyUp={commitSeuil} onBlur={commitSeuil}
            style={{ flex: 1, maxWidth: 320, accentColor: 'var(--color-accent)' }} />
          <span className="tnum" style={{ fontSize: 14, minWidth: '4ch' }}>{seuil} %</span>
        </div>
      </Field>
      <Fine>{t('A team envelope is flagged “Tension” when the actual and committed reach this percentage of the allocated budget.')}</Fine>
    </Panel>
  );
}
