// Remise de la copie du compte rendu d'entretien au salarié (`entretien.remettre`, shared/rules/remise.ts), par
// l'évaluateur ou le service RH, sans attendre sa signature dans Cursus : en main propre, après un refus de signer (date
// du jour de la remise), ou par mise à disposition dans son espace (e-mail avec un lien vers Cursus, jamais le texte).
// Le mode se choisit explicitement ; le compte rendu s'imprime d'ici pour être remis.
import { useState } from 'react';
import { ENT_TYPES } from '../../../shared/constants.ts';
import { fmtIso } from '../../../shared/format.ts';
import { controleRemise, debutRemise, MODES_REMISE, texteRemise } from '../../../shared/rules/remise.ts';
import type { ModeRemise } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { erreurDate } from '../components/controles.ts';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { imprimerCompteRendu } from './compteRendu.ts';
import { t } from '../i18n/langue.ts';

export function RemiseDialog({ entId }: { entId: number }) {
  const d = useDomain();
  const { run, openDialog, notify } = useStore();
  const x = d.ds.entretiens.find(y => y.id === entId);
  const e = x ? d.emp(x.empId) : undefined;
  const [mode, setMode] = useState<ModeRemise | ''>('');
  const [date, setDate] = useState(d.ti);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!x || !e) return null;

  // Déjà mis à disposition dans le portail : seule une remise sur papier la complète.
  const modes = (Object.keys(MODES_REMISE) as ModeRemise[])
    .filter(m => !(m === 'refus' && x.signSal) && !(m === 'portail' && x.remiseMode === 'portail'));
  const papier = mode === 'main_propre' || mode === 'refus';
  const modeErr = mode ? null : t('Choose the handover mode.');
  // Erreur de date : vide ou incomplète, sinon la règle partagée avec le serveur (aujourd'hui au plus tard, pas avant la clôture).
  const dateErr = !papier ? null : erreurDate(date, t('Enter the day of the handover.')) ?? (() => {
    const err = controleRemise(x, mode, date, d.ti);
    return err && err.startsWith('Date') ? `${err}.` : null;
  })();
  const precedente = texteRemise(x);

  const envoyer = async () => {
    if (busy || !v.verifier(modeErr, dateErr)) return;
    setBusy(true);
    const r = await run('entretien.remettre', { id: x.id, mode, ...(papier ? { date } : {}) });
    setBusy(false);
    // Retour au compte rendu, qui affiche la remise.
    if (r.ok) openDialog({ type: 'ent', entId: x.id });
  };
  const imprimer = () => {
    if (!imprimerCompteRendu(d, x)) notify(t('Allow pop-up windows to print the report'), true);
  };

  return (
    <Dialog title={t('Hand over the copy of the report')} width={560} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Record the handover')}</SubmitButton>
    </>}>
      <Field label={t('Report')}>
        <Static>
          {ENT_TYPES[x.type].nom}{t(' of #date')}{fmtIso(x.date)}
          <div className="text-muted sub">{e.nom} · {x.signSal ? `${t('signed by the employee on ')}${fmtIso(x.signSal)}` : t('not signed by the employee')}</div>
        </Static>
      </Field>
      {precedente && <Fine>{precedente}{t('. A handover on paper completes it.')}</Fine>}
      <Field label={t('Handover mode')} requis erreur={v.erreur(modeErr)}>
        <div role="radiogroup" aria-label={t('Handover mode')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {modes.map(m => (
            <label key={m} className="boxed" style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', cursor: 'pointer' }}>
              <input type="radio" name="remise-mode" value={m} checked={mode === m} onChange={() => setMode(m)}
                style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
              <span>
                <span style={{ fontSize: 14 }}>{MODES_REMISE[m].label}</span>
                <span className="text-muted sub" style={{ display: 'block' }}>{MODES_REMISE[m].aide}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>
      {papier && (
        <Field label={t(mode === 'refus' ? 'Day of the refusal and of the handover' : 'Day of the handover')} htmlFor="remise-date" requis erreur={v.erreur(dateErr) || (dateErr && date ? dateErr : null)}>
          <input className="input" id="remise-date" type="date" min={debutRemise(x)} max={d.ti} value={date} onChange={ev => setDate(ev.target.value)} />
        </Field>
      )}
      {mode === 'portail' && <Fine>{t('The employee must have an active Cursus account. Without an e-mail address on their sheet, inform them yourself.')}</Fine>}
      <div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={imprimer}>{t('Print the report')}</button>
      </div>
    </Dialog>
  );
}
