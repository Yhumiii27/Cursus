// Paramètres → Règles de suivi : seuil d'alerte par défaut, formations réglementaires seules, seuil de tension
// budgétaire (réglages de l'administrateur RH ; les autres profils les consultent).
import { useRef, useState } from 'react';
import type { Settings } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

const HORIZONS: [number, string][] = [[30, '30 j'], [60, '60 j'], [90, '90 j'], [120, '120 j'], [150, '150 j'], [180, '180 j']];

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
    <Panel title="Règles de suivi" style={{ gap: 'var(--space-4)' }}>
      <Field label="Seuil d’alerte par défaut">
        <Seg name="param-horizon" label="Seuil d’alerte par défaut" value={s.horizonAlerte} options={HORIZONS} disabled={!admin}
          onChange={v => save({ horizonAlerte: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Fine>Une certification, une habilitation ou un document de voyage passe « À renouveler » lorsqu’il expire dans ce délai. Le tableau de bord permet de l’ajuster ponctuellement.</Fine>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.uniquementReglementaire} disabled={!admin} onChange={e => save({ uniquementReglementaire: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          Suivre uniquement les formations réglementaires
          <span className="text-muted sub" style={{ display: 'block' }}>Les formations recommandées et internes sortent des statuts de conformité, des échéances et du catalogue proposé aux collaborateurs.</span>
        </span>
      </label>

      <Field label="Seuil de tension budgétaire" htmlFor="param-seuil">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <input id="param-seuil" type="range" min={60} max={100} step={5} value={seuil} disabled={!admin}
            onChange={e => setSeuilDraft(Number(e.target.value))} onPointerUp={commitSeuil} onKeyUp={commitSeuil} onBlur={commitSeuil}
            style={{ flex: 1, maxWidth: 320, accentColor: 'var(--color-accent)' }} />
          <span className="tnum" style={{ fontSize: 14, minWidth: '4ch' }}>{seuil} %</span>
        </div>
      </Field>
      <Fine>Une enveloppe d’équipe est signalée « Tension » lorsque le réalisé et l’engagé atteignent ce pourcentage du budget alloué.</Fine>
    </Panel>
  );
}
