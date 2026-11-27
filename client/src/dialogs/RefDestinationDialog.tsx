// Écran Référentiels (service RH) : nouvelle destination, ou modification d'une destination (son code pays ne change
// plus) : formalité d'entrée, vaccins obligatoires ou recommandés, validité du passeport exigée après l'entrée,
// formalité de sécurité sociale du détachement. Les règles de visa et les vaccins restent ceux de Cursus
// (shared/constants.ts). Les dossiers voyage sont recalculés à l'affichage : les déplacements prévus suivent la règle.
// Vigilance de France Diplomatie (t068, shared/rules/vigilance.ts) : couleur et jour de la vérification, saisis à la main
// (pas d'API) ; passer à l'orange ou au rouge prévient les managers des voyageurs.
import { useState } from 'react';
import { SECU_RULES, VACCINS, VISA_RULES, secuDe } from '../../../shared/constants.ts';
import { controlerDestination, PASSEPORT_MOIS_MAX, VACCIN_TOUJOURS_RECOMMANDE, type ChampDestination } from '../../../shared/rules/referentiels.ts';
import { devientDeconseillee, VIGILANCES, voyagesVers } from '../../../shared/rules/vigilance.ts';
import type { SecuDetachement, VaccinId, Vigilance, VisaKind } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

type Exigence = '' | 'rec' | 'oblig';
/** Vaccins à choisir : tous, sauf le DTP, toujours recommandé. */
const CHOIX_VACCINS = (Object.keys(VACCINS) as VaccinId[]).filter(x => x !== VACCIN_TOUJOURS_RECOMMANDE);

export function RefDestinationDialog({ code: code0 }: { code?: string | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const liste = d.ds.referentiels.destinations;
  const [avant] = useState(() => (code0 ? liste.find(x => x.code === code0) ?? null : null));
  const [pays, setPays] = useState(avant?.pays ?? '');
  const [code, setCode] = useState('');
  const [visa, setVisa] = useState<VisaKind>(avant?.visa ?? 'none');
  const [visaSub, setVisaSub] = useState(avant?.visaSub ?? '');
  const [vaccins, setVaccins] = useState<Record<string, Exigence>>(() => Object.fromEntries(CHOIX_VACCINS.map(x => [
    x, avant?.oblig.includes(x) ? 'oblig' : avant?.rec.includes(x) ? 'rec' : '',
  ])));
  const [passMois, setPassMois] = useState(avant ? String(avant.passMois) : '');
  const [secu, setSecu] = useState<string>(avant?.secu ?? '');
  const [vigilance, setVigilance] = useState<string>(avant?.vigilance ?? '');
  const [vigilanceLe, setVigilanceLe] = useState(avant?.vigilanceLe ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const disparue = !!code0 && !avant;

  const codePays = avant?.code ?? code.trim().toUpperCase();
  const champs = {
    pays, visa, visaSub, passMois, secu, vigilance, vigilanceLe,
    oblig: CHOIX_VACCINS.filter(x => vaccins[x] === 'oblig'), rec: CHOIX_VACCINS.filter(x => vaccins[x] === 'rec'),
  };
  const { erreurs, destination } = controlerDestination({ ...champs, code: codePays }, liste, avant?.code ?? null, d.ti);
  // Passage à l'orange ou au rouge : déplacements prévus vers ce pays, signalés avant d'enregistrer.
  const alerte = devientDeconseillee(avant?.vigilance, (vigilance || null) as Vigilance | null) ? voyagesVers(d.ds.voyages, codePays, d.ti).length : null;
  const erreur = (k: ChampDestination, saisi: string) => (saisi.trim() ? erreurs[k] ?? null : v.erreur(erreurs[k]));
  // Sécurité sociale déduite du code pays, tant qu'aucune n'est choisie.
  const deduite = SECU_RULES[secuDe({ code: codePays, secu: null })].label;
  const prevus = avant ? d.ds.voyages.filter(x => x.dest === avant.code && x.retour >= d.ti && !x.annuleLe).length : 0;

  const confirm = async () => {
    if (busy || !v.verifier(...Object.values(erreurs), disparue)) return;
    setBusy(true);
    const r = await run('referentiel.destination.enregistrer', avant ? { id: avant.code, ...champs } : { code: codePays, ...champs });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={avant ? `${t('Destination ')}${avant.pays}` : t('New destination')} width={620} onSubmit={confirm}
      actions={disparue ? <CancelButton label={t('Close')} /> : <>
        <CancelButton />
        <SubmitButton busy={busy}>{avant ? t('Save') : t('Add to the reference data')}</SubmitButton>
      </>}>
      {disparue ? <Bloquant>{t('This destination no longer exists.')}</Bloquant> : <>
        <div className="grid-2">
          <Field label={t('Country')} htmlFor="rd-pays" requis erreur={erreur('pays', pays)}>
            <input className="input" id="rd-pays" type="text" autoFocus value={pays} maxLength={60} placeholder={t('Morocco')} onChange={e => setPays(e.target.value)} />
          </Field>
          {avant
            ? <Field label={t('Country code')}><Static pad>{avant.code}</Static></Field>
            : (
              <Field label={t('Country code (ISO 3166)')} htmlFor="rd-code" requis erreur={erreur('code', code)}>
                <input className="input" id="rd-code" type="text" value={code} maxLength={2} placeholder={t('MA')} autoCapitalize="characters" onChange={e => setCode(e.target.value)} />
              </Field>
            )}
        </div>
        <div className="grid-2">
          <Field label={t('Entry into the country')} htmlFor="rd-visa" requis erreur={v.erreur(erreurs.visa)}>
            <select className="input" id="rd-visa" value={visa} onChange={e => setVisa(e.target.value as VisaKind)}>
              {(Object.keys(VISA_RULES) as VisaKind[]).map(k => <option key={k} value={k}>{`${VISA_RULES[k].label}${VISA_RULES[k].sub ? ` — ${VISA_RULES[k].sub}` : ''}`}</option>)}
            </select>
          </Field>
          <Field label={t('Detail#precision')} htmlFor="rd-visasub" erreur={erreur('visaSub', visaSub)}>
            <input className="input" id="rd-visasub" type="text" value={visaSub} maxLength={80} placeholder={t('stay ≤ 90 days')} onChange={e => setVisaSub(e.target.value)} />
          </Field>
        </div>
        <Field label={t('Vaccines')} erreur={v.erreur(erreurs.oblig ?? erreurs.rec)}>
          <div className="grid-2">
            {CHOIX_VACCINS.map(x => (
              <label key={x} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', fontSize: 13 }}>
                {VACCINS[x].nom}
                <select className="input" value={vaccins[x]} onChange={e => setVaccins(o => ({ ...o, [x]: e.target.value as Exigence }))}>
                  <option value="">{t('Not required')}</option>
                  <option value="rec">{t('Recommended')}</option>
                  <option value="oblig">{t('Mandatory on entry')}</option>
                </select>
              </label>
            ))}
          </div>
        </Field>
        <Fine>{VACCINS[VACCIN_TOUJOURS_RECOMMANDE].nom}{t(': always recommended (booster), whatever the destination.')}</Fine>
        <div className="grid-2">
          <Field label={t('Passport valid after entry (months)')} htmlFor="rd-pass" erreur={erreur('passMois', passMois)}>
            <input className="input" id="rd-pass" type="number" inputMode="numeric" min={0} max={PASSEPORT_MOIS_MAX} step={1} value={passMois} placeholder={t('0: during the stay')} onChange={e => setPassMois(e.target.value)} />
          </Field>
          <Field label={t('Social security of the posting')} htmlFor="rd-secu" erreur={v.erreur(erreurs.secu)}>
            <select className="input" id="rd-secu" value={secu} onChange={e => setSecu(e.target.value)}>
              <option value="">{`${t('According to the country code — ')}${deduite}`}</option>
              {(Object.keys(SECU_RULES) as SecuDetachement[]).map(k => <option key={k} value={k}>{`${SECU_RULES[k].label} — ${SECU_RULES[k].portee}`}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid-2">
          <Field label={t('Vigilance (France Diplomatie)')} htmlFor="rd-vigilance" erreur={v.erreur(erreurs.vigilance)}>
            <select className="input" id="rd-vigilance" value={vigilance} onChange={e => setVigilance(e.target.value)}>
              <option value="">{t('Not filled in#fem')}</option>
              {(Object.keys(VIGILANCES) as Vigilance[]).map(k => <option key={k} value={k}>{`${k.charAt(0).toUpperCase()}${k.slice(1)} — ${VIGILANCES[k].label}`}</option>)}
            </select>
          </Field>
          <Field label={t('Checked on#fem')} htmlFor="rd-vigilance-le" erreur={vigilanceLe ? erreurs.vigilanceLe ?? null : v.erreur(erreurs.vigilanceLe)}>
            <input className="input" id="rd-vigilance-le" type="date" max={d.ti} value={vigilanceLe} onChange={e => setVigilanceLe(e.target.value)} />
          </Field>
        </div>
        {alerte != null && (
          <Fine>
            {alerte ? `${tn(alerte, 'upcoming or current trip', 'upcoming or current trips')}${t(' to this country: the travellers’ managers will be notified on saving.')}` : t('No trip planned to this country.')}
            {vigilance === 'rouge' ? t(' Red zone: the Go / No Go of the worksites concerned takes a reservation.') : ''}
          </Fine>
        )}
        {destination && <p className="text-muted fine">{d.destSummary(destination)}</p>}
        <Fine>
          {t('Indicative data to be checked on France Diplomatie, with an international vaccination centre and, for social security, on cleiss.fr.')}
          {prevus ? ` ${tn(prevus, 'planned trip follows', 'planned trips follow')}${t(' the new rule.')}` : ''}
        </Fine>
      </>}
    </Dialog>
  );
}
