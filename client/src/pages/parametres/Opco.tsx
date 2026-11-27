// lot 11 — Paramètres → Dossiers OPCO (chantier C4, shared/rules/opco.ts) : OPCO et subrogation proposés à la création d'un
// dossier (enregistrés aussitôt), délais des échéances en jours (dépôt avant le début de la formation, justificatifs après
// la fin, relance d'un remboursement attendu après l'envoi des justificatifs ; enregistrés au bouton). Valeurs par défaut
// (OPCO 2i, 30, 90 et 60 jours) à confirmer avec le service RH d'après les conditions de l'OPCO de l'année. Réglages de
// l'administrateur RH ; les autres profils de l'espace RH consultent.
import { useEffect, useState } from 'react';
import { CODES_OPCO, DELAI_ACCORD_JOURS, OPCOS } from '../../../../shared/rules/opco.ts';
import type { CodeOpco } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

/** Bornes des délais, les mêmes que les contrôles de shared/reglages.ts (tests/client-opco.test.ts les compare). */
export const BORNES_DELAIS_OPCO = {
  opcoDelaiDepot: [0, 180], opcoDelaiJustificatifs: [15, 365], opcoDelaiRemboursement: [15, 365],
} as const;
type Delai = keyof typeof BORNES_DELAIS_OPCO;
/** Délais : libellés en sources anglaises, traduits au rendu. */
const CHAMPS: [Delai, string, string][] = [
  ['opcoDelaiDepot', 'Filing before the start of the training (days)', 'opco-delai-depot'],
  ['opcoDelaiJustificatifs', 'Supporting documents after the end (days)', 'opco-delai-justificatifs'],
  ['opcoDelaiRemboursement', 'Reminder of the reimbursement after sending (days)', 'opco-delai-remboursement'],
];

/** Message sous un délai mal saisi, ou null. */
export function erreurDelaiOpco(k: Delai, v: string): string | null {
  const [min, max] = BORNES_DELAIS_OPCO[k];
  const n = Number(v.trim());
  return /^\d{1,3}$/.test(v.trim()) && n >= min && n <= max ? null : `${t('Whole number of days, from ')}${min}${t(' to #nombre')}${max}.`;
}

export function Opco({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const save = useEnregistrerReglages();
  const [delais, setDelais] = useState<Record<Delai, string>>(() => ({
    opcoDelaiDepot: String(s.opcoDelaiDepot), opcoDelaiJustificatifs: String(s.opcoDelaiJustificatifs), opcoDelaiRemboursement: String(s.opcoDelaiRemboursement),
  }));
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  // Réglages relus du serveur (enregistrés ici ou ailleurs) : la saisie suit les valeurs en vigueur.
  useEffect(() => {
    setDelais({ opcoDelaiDepot: String(s.opcoDelaiDepot), opcoDelaiJustificatifs: String(s.opcoDelaiJustificatifs), opcoDelaiRemboursement: String(s.opcoDelaiRemboursement) });
    setTente(false);
  }, [s.opcoDelaiDepot, s.opcoDelaiJustificatifs, s.opcoDelaiRemboursement]);
  if (!espaceRh) return null;

  const erreurs = Object.fromEntries(CHAMPS.map(([k]) => [k, erreurDelaiOpco(k, delais[k])])) as Record<Delai, string | null>;
  const modifie = CHAMPS.some(([k]) => Number(delais[k]) !== s[k]);
  const enregistrer = async () => {
    const premier = CHAMPS.find(([k]) => erreurs[k]);
    if (premier) { setTente(true); document.getElementById(premier[2])?.focus(); return; }
    setBusy(true);
    await save(Object.fromEntries(CHAMPS.map(([k]) => [k, Number(delais[k])])));
    setBusy(false);
  };

  return (
    <Panel title={t('OPCO files')} style={{ gap: 'var(--space-4)' }}>
      <Field label={t('OPCO offered when a file is created')} htmlFor="opco-defaut">
        <select className="input" id="opco-defaut" value={s.opcoDefaut} disabled={!admin} onChange={e => save({ opcoDefaut: e.target.value as CodeOpco })} style={{ maxWidth: 260 }}>
          {CODES_OPCO.map(c => <option key={c} value={c}>{OPCOS[c]}</option>)}
        </select>
      </Field>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.opcoSubrogation} disabled={!admin} onChange={e => save({ opcoSubrogation: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>{t('Offer the subrogation (direct payment of the provider by the OPCO)')}</span>
      </label>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        {CHAMPS.map(([k, label, id]) => (
          <Field key={k} label={t(label)} htmlFor={id} requis erreur={tente && erreurs[k]}>
            <input className="input tnum" id={id} inputMode="numeric" value={delais[k]} disabled={!admin} onChange={e => setDelais(x => ({ ...x, [k]: e.target.value }))} style={{ maxWidth: 120 }} />
          </Field>
        ))}
      </div>
      {admin && modifie && <div><Btn variant="secondary" disabled={busy} onClick={enregistrer}>{t('Save the time limits')}</Btn></div>}
      <Fine>
        {t('Due dates of a current file (Due dates screen, OPCO files tab of Plan & budget, HR summary without amount nor name): filing before the start of the training, agreement expected ')}{DELAI_ACCORD_JOURS}{t(' days before the start, supporting documents after the end, then reminder of the reimbursement after they are sent. Values offered (30, 90 and 60 days) to be confirmed from the OPCO’s funding conditions of the year. A closed financial year never blocks a file: the reimbursements often arrive after the closing.')}
      </Fine>
    </Panel>
  );
}
