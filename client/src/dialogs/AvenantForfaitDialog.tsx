// Avenant de renonciation à des jours de repos d'un forfait jours (service RH, t043, art. L3121-59) : année, jours rachetés,
// taux de majoration, date de signature et référence. Ouvert seulement quand l'accord collectif est référencé dans
// Paramètres → Forfait jours. Les contrôles (plafond réglé, majoration minimale, signature) sont ceux du serveur
// (`erreursAvenant`, shared/rules/forfait-jours.ts), affichés champ par champ à l'envoi.
import { useState } from 'react';
import { fJ } from '../../../shared/format.ts';
import { isValidDate } from '../../../shared/dates.ts';
import {
  avenantsDe, cumulForfaitJours, erreursAvenant, MAJORATION_MINIMALE, periodeRachat, PLAFOND_SUPPLETIF, rachatOuvert, REFERENCE_AVENANT_MAX,
} from '../../../shared/rules/forfait-jours.ts';
import { periodeLabel } from '../../../shared/rules/paie.ts';
import { erreurDate } from '../components/controles.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function AvenantForfaitDialog({ empId }: { empId: number }) {
  const d = useDomain();
  const { rh } = useRole();
  const { run, closeDialog } = useStore();
  const emp = d.emp(empId);
  const s = d.ds.settings;
  const [annee, setAnnee] = useState(String(d.year));
  const [jours, setJours] = useState('');
  const [taux, setTaux] = useState(String(Math.max(s.forfaitJoursMajorationMin ?? MAJORATION_MINIMALE, 25)));
  const [signeLe, setSigneLe] = useState(d.ti);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!emp || !rh) return null;

  const c = d.contratOf(emp);
  const an = Number(annee), n = Number(jours.replace(',', '.')), tx = Number(taux);
  const deja = avenantsDe(d.ds.avenantsForfait, emp.id, an).reduce((x, a) => x + a.jours, 0);
  const plafond = s.forfaitJoursPlafond ?? PLAFOND_SUPPLETIF, max = plafond - c.joursForfait - deja;
  const k = cumulForfaitJours(d, emp, an);
  // Erreurs du serveur, rattachées à leur champ (l'ordre suit `erreursAvenant`).
  const erreurs = erreursAvenant(d, emp, { annee: an, jours: n, taux: tx, signeLe, reference: reference.trim() });
  const de = (motif: RegExp) => erreurs.find(x => motif.test(x)) ?? null;
  const errJours = jours.trim() ? de(/^Jours rachetés/) : t('Enter the number of days bought back.');
  const errTaux = de(/^Majoration/);
  const errSigne = erreurDate(signeLe, t('Enter the signature date of the amendment.')) ?? de(/signature|signé/i);
  const errAnnee = de(/^Année/);
  const errRef = de(/^Référence/);
  const errAutre = erreurs.filter(x => ![errJours, errTaux, errSigne, errAnnee, errRef].includes(x));

  const confirm = async () => {
    if (busy || !v.verifier(errJours, errTaux, errSigne, errAnnee, errRef, errAutre.length)) return;
    setBusy(true);
    const r = await run('forfait.avenant', { empId: emp.id, annee: an, jours: n, taux: tx, signeLe, reference: reference.trim() || null });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t('Amendment waiving rest days')} width={560} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Save the amendment')}</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label={t('Employee')}><Static>{emp.nom}</Static></Field>
        <Field label={t('Package')}>
          <Static>{c.joursForfait}{t(' days')}<div className="text-muted sub">{k ? `${fJ(k.done)}${t(' worked in ')}${k.annee}` : t('no approved timesheet that year')}{deja ? ` · ${fJ(deja)}${t(' already bought back')}` : ''}</div></Static>
        </Field>
      </div>
      <div className="grid-2">
        <Field label={t('Year')} htmlFor="af-annee" requis erreur={v.erreur(errAnnee)}>
          <select className="input" id="af-annee" value={annee} onChange={ev => setAnnee(ev.target.value)}>
            {[d.year - 1, d.year, d.year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        <Field label={t('Days bought back')} htmlFor="af-jours" requis erreur={v.erreur(errJours)}>
          <input className="input tnum" id="af-jours" inputMode="decimal" placeholder={max > 0 ? `${fJ(max)}${t(' at most')}` : ''} value={jours} onChange={ev => setJours(ev.target.value)} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label={t('Increase (%)')} htmlFor="af-taux" requis erreur={v.erreur(errTaux)}>
          <input className="input tnum" id="af-taux" inputMode="numeric" value={taux} onChange={ev => setTaux(ev.target.value)} />
        </Field>
        <Field label={t('Amendment signed on')} htmlFor="af-signe" requis erreur={v.erreur(errSigne)}>
          <input className="input" id="af-signe" type="date" min={emp.entree} max={d.ti} value={signeLe} onChange={ev => setSigneLe(ev.target.value)} />
        </Field>
      </div>
      <Field label={<>{t('Reference of the amendment')} <span className="who">{t('· optional')}</span></>} htmlFor="af-ref" erreur={v.erreur(errRef)}>
        <input className="input" id="af-ref" type="text" maxLength={REFERENCE_AVENANT_MAX + 20} placeholder={t('Annual days package amendment of …')} value={reference} onChange={ev => setReference(ev.target.value)} />
        <span className="text-muted sub">{t('Kept on the amendment (HR, payroll); never copied into the log')}</span>
      </Field>
      {v.tente && errAutre.map(x => <Bloquant key={x}>{x}</Bloquant>)}
      <Fine>
        {t('Written amendment, valid for the year (art. L3121-59): the employee waives rest days in exchange for an increase of at least')}
        {` ${s.forfaitJoursMajorationMin ?? MAJORATION_MINIMALE} %`}{t('. The ceiling of the year becomes the package plus the days bought back, ')}{plafond}{t(' days worked at most')}{rachatOuvert(s) ? `${t(' (agreement: ')}${s.forfaitJoursAccord})` : ''}{t('. Payroll: JREN item, quantity in days')}{isValidDate(signeLe) ? `${t(', payroll ')}${t(/^[aeiou]/.test(periodeLabel(periodeRachat({ annee: an, signeLe }, s, d.ti))) ? 'of #elided' : 'of #de')}${periodeLabel(periodeRachat({ annee: an, signeLe }, s, d.ti))}` : ''}{t('; Sage calculates the amount.')}
      </Fine>
    </Dialog>
  );
}
