// Paramètres → Paie : heures supplémentaires payées avec majoration ou remplacées par un repos (seulement avec la
// référence de l'accord collectif qui le prévoit, art. L3121-33, ou, sans délégué syndical,
// de la décision de l'employeur non contestée par le CSE, art. L3121-37), rattachement d'une semaine à cheval sur deux mois et
// jour de clôture des variables (shared/rules/paie.ts). Réglages de l'administrateur RH ; les autres profils consultent.
// Le mode des heures supplémentaires est figé sur chaque feuille à sa validation : le changer ne recalcule rien.
import { useEffect, useState } from 'react';
import { MODES_HEURES_SUP, RATTACHEMENTS } from '../../../../shared/rules/paie.ts';
import type { ModeHeuresSup, RattachementPeriode } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

const MODES: [ModeHeuresSup, string][] = [['paiement', 'Payées avec majoration'], ['repos', 'Remplacées par un repos']];
const RATTACHEMENT_OPTIONS = Object.entries(RATTACHEMENTS).map(([v, r]) => [v, r.label]) as [RattachementPeriode, string][];
const CLOTURES: [number, string][] = [[0, 'Dernier jour du mois'], ...Array.from({ length: 28 }, (_, i): [number, string] => [i + 1, `Le ${i === 0 ? '1er' : i + 1} du mois`])];

export function ReglagesPaie({ s }: SectionProps) {
  const { admin } = useRole();
  const save = useEnregistrerReglages();
  // Repos de remplacement : le mode ne s'enregistre qu'avec la référence de l'accord (contrôle COHERENCE du serveur).
  const [mode, setMode] = useState<ModeHeuresSup>(s.heuresSupMode);
  const [accord, setAccord] = useState(s.heuresSupAccord);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setMode(s.heuresSupMode); setAccord(s.heuresSupAccord); setTente(false); }, [s.heuresSupMode, s.heuresSupAccord]);
  const erreurAccord = mode === 'repos' && !accord.trim() ? 'Indiquez la référence de l’accord collectif qui prévoit le repos de remplacement.' : null;
  const modifie = mode !== s.heuresSupMode || (mode === 'repos' && accord.trim() !== s.heuresSupAccord);

  const choisir = (v: ModeHeuresSup) => {
    setMode(v);
    setTente(false);
    // Retour au paiement : enregistré aussitôt, la référence de l'accord est gardée pour mémoire.
    if (v === 'paiement' && s.heuresSupMode !== 'paiement') void save({ heuresSupMode: 'paiement' });
  };
  const enregistrer = async () => {
    if (erreurAccord) { setTente(true); document.getElementById('paie-accord')?.focus(); return; }
    setBusy(true);
    await save({ heuresSupMode: mode, heuresSupAccord: accord });
    setBusy(false);
  };

  return (
    <Panel title="Paie" style={{ gap: 'var(--space-4)' }}>
      <Field label="Heures supplémentaires">
        <Seg name="paie-hs" label="Heures supplémentaires" value={mode} options={MODES} disabled={!admin} onChange={choisir} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Fine>{MODES_HEURES_SUP[mode].aide} Les heures incluses à un forfait hebdomadaire (HSF25, HSF50) restent payées. Le mode est figé sur chaque feuille à sa validation : le changer ne recalcule pas les semaines déjà validées.</Fine>
      {mode === 'repos' && (
        <>
          <Field label="Référence de l’accord collectif" htmlFor="paie-accord" requis erreur={tente && erreurAccord}>
            <input className="input" id="paie-accord" maxLength={120} placeholder="Accord d’entreprise sur le temps de travail du …" value={accord} disabled={!admin}
              onChange={e => setAccord(e.target.value)} />
          </Field>
          {admin && modifie && (
            <div className="actions-end">
              <Btn variant="primary" disabled={busy} onClick={enregistrer}>Enregistrer le repos de remplacement</Btn>
            </div>
          )}
        </>
      )}

      <Field label="Semaine à cheval sur deux mois">
        <Seg name="paie-rattachement" label="Semaine à cheval sur deux mois" value={s.periodeRattachement} options={RATTACHEMENT_OPTIONS} disabled={!admin}
          onChange={v => save({ periodeRattachement: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Fine>{RATTACHEMENTS[s.periodeRattachement].aide}</Fine>
      <Field label="Clôture des variables de paie" htmlFor="paie-cloture">
        <select className="input" id="paie-cloture" value={s.clotureJour} disabled={!admin} onChange={e => save({ clotureJour: Number(e.target.value) })} style={{ maxWidth: 240 }}>
          {CLOTURES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Fine>Une fois la clôture passée, la période est close : une semaine qui lui revient part en rappel sur la période suivante, signalé à la transmission.</Fine>
    </Panel>
  );
}
