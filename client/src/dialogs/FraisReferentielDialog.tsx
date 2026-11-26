// lot 11 — notes de frais : référentiels saisis chaque année (Paramètres → Notes de frais, et taux à l'écran de contrôle).
// - Taux d'une devise pour un mois (`frais.taux.enregistrer`) : comptabilité ou service RH ; valeur en euros d'une unité.
// - Limite d'exonération d'un forfait pour une année (`frais.forfait.enregistrer`) : service RH, montants URSSAF de
//   l'année (vide ou 0 : retirée) ; pays pour une mission à l'étranger.
// - Barème kilométrique d'une année et d'un type de véhicule (`frais.bareme.enregistrer`) : administrateur RH, tranches
//   de puissance et de distance, formule d × a + b ; proposé d'après la dernière année saisie.
import { useState } from 'react';
import { TYPES_VEHICULE } from '../../../shared/rules/frais-km.ts';
import { FORFAITS_FRAIS } from '../../../shared/rules/frais-politique.ts';
import { estDevise } from '../../../shared/rules/frais.ts';
import type { BaremeKm, CodeForfaitFrais, TypeVehicule } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Btn, Fine } from '../components/ui.tsx';
import { nombreSaisi } from '../components/frais/saisie.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function FraisTauxDialog() {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [devise, setDevise] = useState('');
  const [mois, setMois] = useState(d.ti.slice(0, 7));
  const [taux, setTaux] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const dv = devise.trim().toUpperCase(), n = nombreSaisi(taux);
  const errDevise = !dv ? t('Enter the currency.') : !estDevise(dv) || dv === 'EUR' ? t('Three-letter code, other than the euro (USD, MAD…).') : null;
  const errMois = /^\d{4}-\d{2}$/.test(mois) ? null : t('Enter the month.');
  const errTaux = !taux.trim() ? t('Enter the rate.') : n === null || n <= 0 ? t('Value in euros of one unit of the currency, more than 0.') : null;
  const envoyer = async () => {
    if (busy || !v.verifier(errDevise, errMois, errTaux)) return;
    setBusy(true);
    const r = await run('frais.taux.enregistrer', { devise: dv, mois, taux: n });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={t('Rate of a currency')} width={480} onSubmit={envoyer} actions={<><CancelButton /><SubmitButton busy={busy}>{t('Save the rate')}</SubmitButton></>}>
      <div className="grid-2">
        <Field label={t('Currency')} htmlFor="frais-taux-devise" requis erreur={v.erreur(errDevise) || (devise ? errDevise : null)}>
          <input className="input" id="frais-taux-devise" maxLength={3} value={devise} onChange={ev => setDevise(ev.target.value.toUpperCase())} autoFocus />
        </Field>
        <Field label={t('Month')} htmlFor="frais-taux-mois" requis erreur={v.erreur(errMois)}>
          <input className="input" id="frais-taux-mois" type="month" value={mois} onChange={ev => setMois(ev.target.value)} />
        </Field>
      </div>
      <Field label={t('Value of one unit in euros')} htmlFor="frais-taux-valeur" requis erreur={v.erreur(errTaux) || (taux ? errTaux : null)}>
        <input className="input tnum" id="frais-taux-valeur" inputMode="decimal" value={taux} onChange={ev => setTaux(ev.target.value)} />
      </Field>
      <Fine>{t('The rate of the month is used for expenses in a currency entered without a rate or amount debited. A rate already entered for this month is replaced.')}</Fine>
    </Dialog>
  );
}

export function FraisForfaitDialog({ annee }: { annee: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [code, setCode] = useState<CodeForfaitFrais>('repas_restaurant');
  const [pays, setPays] = useState('');
  const actuel = (d.ds.referentiels.forfaitsFrais ?? []).find(f => f.annee === annee && f.code === code && (f.pays ?? '') === (code === 'etranger' ? pays : ''));
  const [montant, setMontant] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const n = nombreSaisi(montant);
  const errPays = code === 'etranger' && !pays ? t('Choose the country.') : null;
  const errMontant = montant.trim() && (n === null || n < 0 || n > 10000) ? t('Amount in euros, from 0 to 10,000.') : null;
  const envoyer = async () => {
    if (busy || !v.verifier(errPays, errMontant)) return;
    setBusy(true);
    const r = await run('frais.forfait.enregistrer', { annee, code, pays: code === 'etranger' ? pays : '', montant: n ?? 0 });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={`${t('Exemption limit ')}${annee}`} width={520} onSubmit={envoyer} actions={<><CancelButton /><SubmitButton busy={busy}>{t('Save')}</SubmitButton></>}>
      <Field label={t('Flat rate')} htmlFor="frais-forfait-code">
        <select className="input" id="frais-forfait-code" value={code} onChange={ev => setCode(ev.target.value as CodeForfaitFrais)}>
          {(Object.keys(FORFAITS_FRAIS) as CodeForfaitFrais[]).map(k => <option key={k} value={k}>{FORFAITS_FRAIS[k]}</option>)}
        </select>
      </Field>
      {code === 'etranger' && (
        <Field label={t('Country')} htmlFor="frais-forfait-pays" requis erreur={v.erreur(errPays)}>
          <select className="input" id="frais-forfait-pays" value={pays} onChange={ev => setPays(ev.target.value)}>
            <option value="">{t('Choose…')}</option>
            {d.ds.referentiels.destinations.map(x => <option key={x.code} value={x.code}>{x.pays}</option>)}
          </select>
        </Field>
      )}
      <Field label={`${t('Amount (€)')}${actuel ? `${t(', in force: ')}${String(actuel.montant).replace('.', ',')}` : ''}${t('; empty or 0: withdrawn')}`} htmlFor="frais-forfait-montant" erreur={v.erreur(errMontant) || errMontant}>
        <input className="input tnum" id="frais-forfait-montant" inputMode="decimal" value={montant} onChange={ev => setMontant(ev.target.value)} autoFocus />
      </Field>
      <Fine>{t('Amounts published by URSSAF for the year (assignment allowances of State officials for abroad), to check every 1 January.')}</Fine>
    </Dialog>
  );
}

interface TrancheSaisie { cvMin: string; cvMax: string; kmMin: string; kmMax: string; a: string; b: string }
const texte = (n: number | null) => (n == null ? '' : String(n).replace('.', ','));

export function FraisBaremeDialog({ annee, vehicule }: { annee: number; vehicule: TypeVehicule }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const baremes = d.ds.referentiels.baremesKm ?? [];
  // Proposé : le barème de l'année, sinon celui de la dernière année saisie pour ce type.
  const source = (() => {
    const duType = baremes.filter(b => b.type === vehicule);
    const de = duType.some(b => b.annee === annee) ? annee : Math.max(0, ...duType.map(b => b.annee));
    return duType.filter(b => b.annee === de).sort((x, y) => x.cvMin - y.cvMin || x.kmMin - y.kmMin);
  })();
  const [tranches, setTranches] = useState<TrancheSaisie[]>(() => (source.length ? source : [{ cvMin: 0, cvMax: null, kmMin: 0, kmMax: null, a: 0, b: 0 } as BaremeKm])
    .map(t => ({ cvMin: texte(t.cvMin), cvMax: texte(t.cvMax), kmMin: texte(t.kmMin), kmMax: texte(t.kmMax), a: source.length ? texte(t.a) : '', b: texte(t.b) })));
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const maj = (i: number, patch: Partial<TrancheSaisie>) => setTranches(ts => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const erreur = tranches.some(t => { const a = nombreSaisi(t.a); return a === null || a <= 0 || a > 10 || nombreSaisi(t.cvMin) === null || nombreSaisi(t.kmMin) === null; })
    ? t('Each bracket: minimum horsepower and distance, coefficient a from 0 to 10.') : null;
  const envoyer = async () => {
    if (busy || !v.verifier(erreur)) return;
    setBusy(true);
    const r = await run('frais.bareme.enregistrer', {
      annee, type: vehicule,
      tranches: tranches.map(t => ({ cvMin: nombreSaisi(t.cvMin), cvMax: nombreSaisi(t.cvMax), kmMin: nombreSaisi(t.kmMin), kmMax: nombreSaisi(t.kmMax), a: nombreSaisi(t.a), b: nombreSaisi(t.b) ?? 0 })),
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  const champ = (i: number, k: keyof TrancheSaisie, label: string) => (
    <td><input className="input tnum" aria-label={`${label}${t(', bracket ')}${i + 1}`} inputMode="decimal" value={tranches[i][k]} onChange={ev => maj(i, { [k]: ev.target.value })} style={{ minWidth: 64 }} /></td>
  );
  return (
    <Dialog title={`${t('Mileage scale ')}${annee} — ${TYPES_VEHICULE[vehicule].toLowerCase()}`} width={720} onSubmit={envoyer} actions={<><CancelButton /><SubmitButton busy={busy}>{t('Publish the scale')}</SubmitButton></>}>
      <Field label={t('Brackets (annual amount = distance × a + b)')} erreur={v.erreur(erreur)}>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>{t('CV from')}</th><th>{t('to#bracket')}</th><th>{t('km from')}</th><th>{t('to#bracket')}</th><th>a</th><th>b</th><th><span className="sr-only">{t('Remove')}</span></th></tr></thead>
            <tbody>
              {tranches.map((_, i) => (
                <tr key={i}>
                  {champ(i, 'cvMin', t('CV from'))}{champ(i, 'cvMax', t('CV up to'))}{champ(i, 'kmMin', t('km from'))}{champ(i, 'kmMax', t('km up to'))}{champ(i, 'a', t('Coefficient a'))}{champ(i, 'b', t('Constant b'))}
                  <td>{tranches.length > 1 && <Btn small onClick={() => setTranches(ts => ts.filter((__, j) => j !== i))}>{t('Remove')}</Btn>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Field>
      <div><Btn small onClick={() => setTranches(ts => [...ts, { cvMin: '', cvMax: '', kmMin: '', kmMax: '', a: '', b: '0' }])}>{t('Add a bracket')}</Btn></div>
      <Static>{source.length && source[0].annee !== annee ? `${t('Proposed from the scale ')}${source[0].annee}${t(': enter the coefficients published for ')}${annee}.` : ''}</Static>
      <Fine>{t('Tax scale published every year (BOFiP BOI-BAREME-000001). “to” empty: no limit. The allowances of the year not yet paid are recalculated at publication.')}</Fine>
    </Dialog>
  );
}
