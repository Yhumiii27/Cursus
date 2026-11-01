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

export function FraisTauxDialog() {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [devise, setDevise] = useState('');
  const [mois, setMois] = useState(d.ti.slice(0, 7));
  const [taux, setTaux] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const dv = devise.trim().toUpperCase(), n = nombreSaisi(taux);
  const errDevise = !dv ? 'Indiquez la devise.' : !estDevise(dv) || dv === 'EUR' ? 'Code à trois lettres, autre que l’euro (USD, MAD…).' : null;
  const errMois = /^\d{4}-\d{2}$/.test(mois) ? null : 'Indiquez le mois.';
  const errTaux = !taux.trim() ? 'Indiquez le taux.' : n === null || n <= 0 ? 'Valeur en euros d’une unité de la devise, plus de 0.' : null;
  const envoyer = async () => {
    if (busy || !v.verifier(errDevise, errMois, errTaux)) return;
    setBusy(true);
    const r = await run('frais.taux.enregistrer', { devise: dv, mois, taux: n });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title="Taux d’une devise" width={480} onSubmit={envoyer} actions={<><CancelButton /><SubmitButton busy={busy}>Enregistrer le taux</SubmitButton></>}>
      <div className="grid-2">
        <Field label="Devise" htmlFor="frais-taux-devise" requis erreur={v.erreur(errDevise) || (devise ? errDevise : null)}>
          <input className="input" id="frais-taux-devise" maxLength={3} value={devise} onChange={ev => setDevise(ev.target.value.toUpperCase())} autoFocus />
        </Field>
        <Field label="Mois" htmlFor="frais-taux-mois" requis erreur={v.erreur(errMois)}>
          <input className="input" id="frais-taux-mois" type="month" value={mois} onChange={ev => setMois(ev.target.value)} />
        </Field>
      </div>
      <Field label="Valeur d’une unité en euros" htmlFor="frais-taux-valeur" requis erreur={v.erreur(errTaux) || (taux ? errTaux : null)}>
        <input className="input tnum" id="frais-taux-valeur" inputMode="decimal" value={taux} onChange={ev => setTaux(ev.target.value)} />
      </Field>
      <Fine>Le taux du mois sert aux dépenses en devise saisies sans taux ni montant débité. Un taux déjà saisi pour ce mois est remplacé.</Fine>
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
  const errPays = code === 'etranger' && !pays ? 'Choisissez le pays.' : null;
  const errMontant = montant.trim() && (n === null || n < 0 || n > 10000) ? 'Montant en euros, de 0 à 10 000.' : null;
  const envoyer = async () => {
    if (busy || !v.verifier(errPays, errMontant)) return;
    setBusy(true);
    const r = await run('frais.forfait.enregistrer', { annee, code, pays: code === 'etranger' ? pays : '', montant: n ?? 0 });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={`Limite d’exonération ${annee}`} width={520} onSubmit={envoyer} actions={<><CancelButton /><SubmitButton busy={busy}>Enregistrer</SubmitButton></>}>
      <Field label="Forfait" htmlFor="frais-forfait-code">
        <select className="input" id="frais-forfait-code" value={code} onChange={ev => setCode(ev.target.value as CodeForfaitFrais)}>
          {(Object.keys(FORFAITS_FRAIS) as CodeForfaitFrais[]).map(k => <option key={k} value={k}>{FORFAITS_FRAIS[k]}</option>)}
        </select>
      </Field>
      {code === 'etranger' && (
        <Field label="Pays" htmlFor="frais-forfait-pays" requis erreur={v.erreur(errPays)}>
          <select className="input" id="frais-forfait-pays" value={pays} onChange={ev => setPays(ev.target.value)}>
            <option value="">Choisir…</option>
            {d.ds.referentiels.destinations.map(x => <option key={x.code} value={x.code}>{x.pays}</option>)}
          </select>
        </Field>
      )}
      <Field label={`Montant (€)${actuel ? `, en vigueur : ${String(actuel.montant).replace('.', ',')}` : ''} ; vide ou 0 : retirée`} htmlFor="frais-forfait-montant" erreur={v.erreur(errMontant) || errMontant}>
        <input className="input tnum" id="frais-forfait-montant" inputMode="decimal" value={montant} onChange={ev => setMontant(ev.target.value)} autoFocus />
      </Field>
      <Fine>Montants publiés par l’URSSAF pour l’année (indemnités de mission des agents de l’État pour l’étranger), à vérifier chaque 1er janvier.</Fine>
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
    ? 'Chaque tranche : puissance et distance minimales, coefficient a de 0 à 10.' : null;
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
    <td><input className="input tnum" aria-label={`${label}, tranche ${i + 1}`} inputMode="decimal" value={tranches[i][k]} onChange={ev => maj(i, { [k]: ev.target.value })} style={{ minWidth: 64 }} /></td>
  );
  return (
    <Dialog title={`Barème kilométrique ${annee} — ${TYPES_VEHICULE[vehicule].toLowerCase()}`} width={720} onSubmit={envoyer} actions={<><CancelButton /><SubmitButton busy={busy}>Publier le barème</SubmitButton></>}>
      <Field label="Tranches (montant annuel = distance × a + b)" erreur={v.erreur(erreur)}>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>CV de</th><th>à</th><th>km de</th><th>à</th><th>a</th><th>b</th><th><span className="sr-only">Retirer</span></th></tr></thead>
            <tbody>
              {tranches.map((_, i) => (
                <tr key={i}>
                  {champ(i, 'cvMin', 'CV de')}{champ(i, 'cvMax', 'CV jusqu’à')}{champ(i, 'kmMin', 'km de')}{champ(i, 'kmMax', 'km jusqu’à')}{champ(i, 'a', 'Coefficient a')}{champ(i, 'b', 'Constante b')}
                  <td>{tranches.length > 1 && <Btn small onClick={() => setTranches(ts => ts.filter((__, j) => j !== i))}>Retirer</Btn>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Field>
      <div><Btn small onClick={() => setTranches(ts => [...ts, { cvMin: '', cvMax: '', kmMin: '', kmMax: '', a: '', b: '0' }])}>Ajouter une tranche</Btn></div>
      <Static>{source.length && source[0].annee !== annee ? `Proposé d’après le barème ${source[0].annee} : saisissez les coefficients publiés pour ${annee}.` : ''}</Static>
      <Fine>Barème fiscal publié chaque année (BOFiP BOI-BAREME-000001). « à » vide : sans limite. Les indemnités de l’année non encore payées sont recalculées à la publication.</Fine>
    </Dialog>
  );
}
