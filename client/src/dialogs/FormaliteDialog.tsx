// Enregistrer une formalité de voyage : passeport, visa ou vaccination.
import { useState } from 'react';
import { INFO_VACCINATIONS, VACCINS, VISA_RULES } from '../../../shared/constants.ts';
import type { FormaliteKind } from '../../../shared/domain.ts';
import { addMonths, isValidDate, parse } from '../../../shared/dates.ts';
import { fmt, validiteLabel } from '../../../shared/format.ts';
import { formaliteCle } from '../../../shared/rules/formalites.ts';
import { actif } from '../../../shared/rules/referentiels.ts';
import type { VaccinId } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { SectionLabel, Seg } from '../components/ui.tsx';
import { erreurDate, erreurTexte } from '../components/controles.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/**
 * Information de la personne (art. 13 du RGPD) avant la saisie d'une vaccination, donnée de santé réservée au service RH :
 * le salarié la lit avant de déclarer ; le service RH la porte à sa connaissance avant d'enregistrer.
 */
function InfoVaccinations({ rh }: { rh: boolean }) {
  return (
    <div className="boxed-lg" role="note" aria-label={INFO_VACCINATIONS.titre} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <SectionLabel>{INFO_VACCINATIONS.titre}</SectionLabel>
      {rh && <p className="text-muted fine">À porter à la connaissance du salarié avant d’enregistrer sa vaccination (art. 13 du RGPD).</p>}
      <ul className="rules">
        {INFO_VACCINATIONS.points.map(([k, v]) => <li key={k}><span style={{ color: 'var(--color-text)' }}>{k}</span> : {v}</li>)}
      </ul>
    </div>
  );
}

export function FormaliteDialog({ empId: empId0, kind: kind0, dest: dest0, v: v0 }: { empId?: number | null; kind?: FormaliteKind; dest?: string; v?: VaccinId }) {
  const d = useDomain();
  const { collab, me } = useRole();
  const { run, closeDialog } = useStore();
  const employes = d.ds.employes;
  const empOptions = [...employes].sort((a, b) => a.nom.localeCompare(b.nom));
  // Destinations en vigueur, et celle du visa à mettre à jour même archivée depuis.
  const visaDests = d.ds.referentiels.destinations.filter(x => x.visa !== 'none' && (actif(x) || x.code === dest0));
  const lockEmp = collab || !!empId0;
  const ruleLabel = (code: string) => { const x = d.destOf(code); return x ? VISA_RULES[x.visa].label : ''; };

  const [empId, setEmpId] = useState(collab ? me! : empId0 || ((employes.find(e => e.passeport) ?? employes[0])?.id ?? 0));
  const [kind, setKind] = useState<FormaliteKind>(kind0 ?? 'passeport');
  const [numero, setNumero] = useState('');
  const [expire, setExpire] = useState('');
  const [dest, setDestState] = useState(dest0 ?? visaDests[0]?.code ?? '');
  const [visaType, setVisaType] = useState(ruleLabel(dest0 ?? visaDests[0]?.code ?? ''));
  const [obtenu, setObtenu] = useState('');
  const [v, setV] = useState<VaccinId>(v0 ?? 'fj');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const verif = useVerification();

  const setDest = (code: string) => { setDestState(code); setVisaType(ruleLabel(code)); };
  const vm = VACCINS[v];
  const vacHint = `${vm.validite == null ? 'Certificat valable à vie' : 'Validité ' + validiteLabel(vm.validite)}${isValidDate(date) && vm.validite ? ' · rappel le ' + fmt(addMonths(parse(date), vm.validite)) : ''}`;
  // Champs obligatoires du type choisi ; la date d'obtention d'un visa est facultative.
  const erreurs = {
    numero: kind === 'passeport' ? erreurTexte(numero, 'Indiquez le numéro du passeport.') : null,
    expire: kind === 'vaccin' ? null : erreurDate(expire, kind === 'passeport' ? 'Indiquez la date d’expiration.' : 'Indiquez la fin de validité du visa.'),
    obtenu: kind === 'visa' && obtenu && !isValidDate(obtenu) ? 'Date invalide.' : null,
    date: kind === 'vaccin' ? erreurDate(date, 'Indiquez la date d’injection.') : null,
  };
  // Le collaborateur déclare : son dossier n'est mis à jour qu'après validation par le service RH.
  const cle = formaliteCle({ kind, dest, v });
  const dejaDeclare = collab && d.ds.demandesCollab.some(r => r.empId === empId && r.statut === 'attente'
    && r.declaration && !r.declaration.dejaAuDossier && formaliteCle(r.declaration) === cle);

  const confirm = async () => {
    if (busy || !verif.verifier(...Object.values(erreurs))) return;
    setBusy(true);
    const r = await run('formalite.enregistrer', { empId, kind, numero, expire, dest, visaType, obtenu, v, date });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={collab ? 'Déclarer une formalité' : 'Enregistrer une formalité'} width={520} tall={kind === 'vaccin'} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{collab ? 'Envoyer au service RH' : 'Enregistrer'}</SubmitButton>
    </>}>
      <Field label="Collaborateur" htmlFor="fo-emp">
        <select className="input" id="fo-emp" value={empId} disabled={lockEmp} onChange={e => setEmpId(Number(e.target.value))}>
          {empOptions.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
        </select>
      </Field>
      <Seg name="foKind" label="Type de formalité" value={kind} onChange={setKind}
        options={[['passeport', 'Passeport'], ['visa', 'Visa'], ['vaccin', 'Vaccination']]} />
      {kind === 'passeport' && (
        <div className="grid-2">
          <Field label="Numéro" htmlFor="fo-num" requis erreur={verif.erreur(erreurs.numero)}><input className="input" id="fo-num" type="text" placeholder="22AB12345" value={numero} onChange={e => setNumero(e.target.value)} /></Field>
          <Field label="Date d’expiration" htmlFor="fo-pexp" requis erreur={verif.erreur(erreurs.expire)}><input className="input" id="fo-pexp" type="date" value={expire} onChange={e => setExpire(e.target.value)} /></Field>
        </div>
      )}
      {kind === 'visa' && (
        <div className="grid-2">
          <Field label="Pays" htmlFor="fo-dest">
            <select className="input" id="fo-dest" value={dest} onChange={e => setDest(e.target.value)}>
              {visaDests.map(o => <option key={o.code} value={o.code}>{o.pays}</option>)}
            </select>
          </Field>
          <Field label="Type" htmlFor="fo-vt"><input className="input" id="fo-vt" type="text" value={visaType} onChange={e => setVisaType(e.target.value)} /></Field>
          <Field label="Date d’obtention" htmlFor="fo-vob" erreur={verif.erreur(erreurs.obtenu)}><input className="input" id="fo-vob" type="date" value={obtenu} onChange={e => setObtenu(e.target.value)} /></Field>
          <Field label="Valable jusqu’au" htmlFor="fo-vexp" requis erreur={verif.erreur(erreurs.expire)}><input className="input" id="fo-vexp" type="date" value={expire} onChange={e => setExpire(e.target.value)} /></Field>
        </div>
      )}
      {kind === 'vaccin' && <>
        <InfoVaccinations rh={!collab} />
        <div className="grid-2">
          <Field label="Vaccin" htmlFor="fo-v">
            <select className="input" id="fo-v" value={v} onChange={e => setV(e.target.value as VaccinId)}>
              {(Object.keys(VACCINS) as VaccinId[]).map(id => <option key={id} value={id}>{VACCINS[id].nom}</option>)}
            </select>
          </Field>
          <Field label="Date d’injection" htmlFor="fo-vd" requis erreur={verif.erreur(erreurs.date)}><input className="input" id="fo-vd" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>
        <p className="text-muted fine">{vacHint}</p>
      </>}
      {collab && (
        <p className="text-muted fine">
          {dejaDeclare
            ? 'Une déclaration de ce document attend déjà la validation du service RH : celle-ci la remplacera.'
            : 'Votre déclaration est transmise au service RH : votre dossier est mis à jour après sa validation.'}
        </p>
      )}
    </Dialog>
  );
}
