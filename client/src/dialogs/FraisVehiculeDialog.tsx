// lot 11 — notes de frais : véhicule personnel (`frais.vehicule.declarer`) pour les indemnités kilométriques : type,
// puissance fiscale (CV de la carte grise), énergie électrique (majoration de 20 %), date de début ; le précédent
// s'arrête la veille. Carte grise et attestation d'assurance « usage professionnel » jointes en pièces.
import { useState } from 'react';
import { CV_PLAFOND, TYPES_VEHICULE } from '../../../shared/rules/frais-km.ts';
import type { TypeVehicule } from '../../../shared/types.ts';
import { ChoixPiece, usePieceJointe } from '../components/PieceJointe.tsx';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { erreurDate, erreurEntier } from '../components/controles.ts';
import { Fine } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function FraisVehiculeDialog({ empId }: { empId?: number | null }) {
  const d = useDomain();
  const { me } = useRole();
  const { run, closeDialog } = useStore();
  const qui = empId ?? me;
  const [type, setType] = useState<TypeVehicule>('voiture');
  const [cv, setCv] = useState('');
  const [electrique, setElectrique] = useState(false);
  const [du, setDu] = useState(d.ti);
  const piece = usePieceJointe();
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const errCv = erreurEntier(cv, type === 'deux_roues' ? 0 : 1, 'Indiquez la puissance fiscale (CV).');
  const errDu = erreurDate(du, 'Indiquez la date de début.');

  const envoyer = async () => {
    if (busy || !v.verifier(errCv, errDu, piece.erreur)) return;
    setBusy(true);
    const jetons = await piece.envoyer();
    const r = jetons ? await run('frais.vehicule.declarer', { empId: qui, type, cv: Number(cv), electrique, du, jetons }) : null;
    setBusy(false);
    if (r?.ok) closeDialog();
  };

  return (
    <Dialog title="Déclarer un véhicule personnel" width={520} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Déclarer le véhicule</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label="Type" htmlFor="frais-veh-type">
          <select className="input" id="frais-veh-type" value={type} onChange={ev => setType(ev.target.value as TypeVehicule)}>
            {(Object.keys(TYPES_VEHICULE) as TypeVehicule[]).map(t => <option key={t} value={t}>{TYPES_VEHICULE[t]}</option>)}
          </select>
        </Field>
        <Field label="Puissance fiscale (CV)" htmlFor="frais-veh-cv" requis erreur={v.erreur(errCv) || (cv ? errCv : null)}>
          <input className="input tnum" id="frais-veh-cv" inputMode="numeric" value={cv} onChange={ev => setCv(ev.target.value)} />
        </Field>
      </div>
      <Field label="Utilisé depuis le" htmlFor="frais-veh-du" requis erreur={v.erreur(errDu)}>
        <input className="input" id="frais-veh-du" type="date" value={du} onChange={ev => setDu(ev.target.value)} />
      </Field>
      <label className="check-row" htmlFor="frais-veh-elec">
        <input id="frais-veh-elec" type="checkbox" checked={electrique} onChange={ev => setElectrique(ev.target.checked)} />
        <span>Véhicule électrique (barème majoré de 20 %)</span>
      </label>
      <ChoixPiece piece={piece} id="frais-veh-piece" label="Carte grise ou attestation d’assurance" aide="Assurance couvrant l’usage professionnel." />
      <Fine>{`Le barème plafonne la puissance à ${CV_PLAFOND} CV pour une voiture. Le véhicule déclaré avant s’arrête la veille.`}</Fine>
    </Dialog>
  );
}
