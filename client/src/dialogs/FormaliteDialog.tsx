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
import { ChoixPiece, usePieceJointe } from '../components/PieceJointe.tsx';
import { SectionLabel, Seg } from '../components/ui.tsx';
import { erreurDate, erreurTexte } from '../components/controles.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

/**
 * Information de la personne (art. 13 du RGPD) avant la saisie d'une vaccination, donnée de santé réservée au service RH :
 * le salarié la lit avant de déclarer ; le service RH la porte à sa connaissance avant d'enregistrer.
 */
function InfoVaccinations({ rh }: { rh: boolean }) {
  return (
    <div className="boxed-lg" role="note" aria-label={INFO_VACCINATIONS.titre} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <SectionLabel>{INFO_VACCINATIONS.titre}</SectionLabel>
      {rh && <p className="text-muted fine">{t('To bring to the employee’s attention before recording their vaccination (art. 13 of the GDPR).')}</p>}
      <ul className="rules">
        {INFO_VACCINATIONS.points.map(([k, v]) => <li key={k}><span style={{ color: 'var(--color-text)' }}>{k}</span>{t(': ')}{v}</li>)}
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
  // Copie du document jointe à la déclaration du collaborateur (pièce justificative), lue par le service RH avant validation.
  const piece = usePieceJointe();

  const setDest = (code: string) => { setDestState(code); setVisaType(ruleLabel(code)); };
  const vm = VACCINS[v];
  const vacHint = `${vm.validite == null ? t('Certificate valid for life') : t('Validity ') + validiteLabel(vm.validite)}${isValidDate(date) && vm.validite ? t(' · booster on ') + fmt(addMonths(parse(date), vm.validite)) : ''}`;
  // Champs obligatoires du type choisi ; la date d'obtention d'un visa est facultative.
  const erreurs = {
    numero: kind === 'passeport' ? erreurTexte(numero, t('Enter the passport number.')) : null,
    expire: kind === 'vaccin' ? null : erreurDate(expire, kind === 'passeport' ? t('Enter the expiry date.') : t('Enter the end of validity of the visa.')),
    obtenu: kind === 'visa' && obtenu && !isValidDate(obtenu) ? t('Invalid date.') : null,
    date: kind === 'vaccin' ? erreurDate(date, t('Enter the injection date.')) : null,
  };
  // Le collaborateur déclare : son dossier n'est mis à jour qu'après validation par le service RH.
  const cle = formaliteCle({ kind, dest, v });
  const dejaDeclare = collab && d.ds.demandesCollab.some(r => r.empId === empId && r.statut === 'attente'
    && r.declaration && !r.declaration.dejaAuDossier && formaliteCle(r.declaration) === cle);

  const confirm = async () => {
    if (busy || !verif.verifier(...Object.values(erreurs), collab && piece.erreur)) return;
    setBusy(true);
    const pieces = collab ? await piece.envoyer() : [];
    if (!pieces) { setBusy(false); return; }
    const r = await run('formalite.enregistrer', { empId, kind, numero, expire, dest, visaType, obtenu, v, date, ...(pieces.length ? { pieces } : {}) });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={collab ? t('Declare a formality') : t('Record a formality')} width={520} tall={kind === 'vaccin'} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{collab ? t('Send to HR') : t('Save')}</SubmitButton>
    </>}>
      <Field label={t('Employee')} htmlFor="fo-emp">
        <select className="input" id="fo-emp" value={empId} disabled={lockEmp} onChange={e => setEmpId(Number(e.target.value))}>
          {empOptions.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
        </select>
      </Field>
      <Seg name="foKind" label={t('Type of formality')} value={kind} onChange={setKind}
        options={[['passeport', t('Passport')], ['visa', t('Visa')], ['vaccin', t('Vaccination')]]} />
      {kind === 'passeport' && (
        <div className="grid-2">
          <Field label={t('Number#numero')} htmlFor="fo-num" requis erreur={verif.erreur(erreurs.numero)}><input className="input" id="fo-num" type="text" placeholder="22AB12345" value={numero} onChange={e => setNumero(e.target.value)} /></Field>
          <Field label={t('Expiry date')} htmlFor="fo-pexp" requis erreur={verif.erreur(erreurs.expire)}><input className="input" id="fo-pexp" type="date" value={expire} onChange={e => setExpire(e.target.value)} /></Field>
        </div>
      )}
      {kind === 'visa' && (
        <div className="grid-2">
          <Field label={t('Country')} htmlFor="fo-dest">
            <select className="input" id="fo-dest" value={dest} onChange={e => setDest(e.target.value)}>
              {visaDests.map(o => <option key={o.code} value={o.code}>{o.pays}</option>)}
            </select>
          </Field>
          <Field label={t('Type')} htmlFor="fo-vt"><input className="input" id="fo-vt" type="text" value={visaType} onChange={e => setVisaType(e.target.value)} /></Field>
          <Field label={t('Date obtained')} htmlFor="fo-vob" erreur={verif.erreur(erreurs.obtenu)}><input className="input" id="fo-vob" type="date" value={obtenu} onChange={e => setObtenu(e.target.value)} /></Field>
          <Field label={t('Valid until')} htmlFor="fo-vexp" requis erreur={verif.erreur(erreurs.expire)}><input className="input" id="fo-vexp" type="date" value={expire} onChange={e => setExpire(e.target.value)} /></Field>
        </div>
      )}
      {kind === 'vaccin' && <>
        <InfoVaccinations rh={!collab} />
        <div className="grid-2">
          <Field label={t('Vaccine')} htmlFor="fo-v">
            <select className="input" id="fo-v" value={v} onChange={e => setV(e.target.value as VaccinId)}>
              {(Object.keys(VACCINS) as VaccinId[]).map(id => <option key={id} value={id}>{VACCINS[id].nom}</option>)}
            </select>
          </Field>
          <Field label={t('Injection date')} htmlFor="fo-vd" requis erreur={verif.erreur(erreurs.date)}><input className="input" id="fo-vd" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>
        <p className="text-muted fine">{vacHint}</p>
      </>}
      {collab && <ChoixPiece piece={piece} id="fo-piece" label={kind === 'vaccin' ? t('Copy of the vaccination record (optional)') : t('Copy of the document (optional)')}
        aide={t('Read by HR only, before approving.')} />}
      {collab && (
        <p className="text-muted fine">
          {dejaDeclare
            ? t('A declaration of this document is already waiting for HR approval: this one will replace it.')
            : t('Your declaration is sent to HR: your file is updated after its approval.')}
        </p>
      )}
    </Dialog>
  );
}
