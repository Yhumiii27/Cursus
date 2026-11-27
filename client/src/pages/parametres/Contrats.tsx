// Paramètres → Contrats : alertes avant l'expiration d'un titre de séjour valant autorisation de travail (première alerte,
// dans la fenêtre de la demande de renouvellement en préfecture, puis relance) ; CDD : renouvellements admis et durée
// maximale, à défaut d'accord de branche ceux de la loi (shared/rules/cdd.ts), avec la référence de l'accord qui y déroge.
// Réglages de l'administrateur RH ; les autres profils de l'espace RH les consultent. Les fins d'essai et de contrat
// suivent le seuil d'alerte (Règles de suivi).
import { useEffect, useState } from 'react';
import { CDD_RENOUVELLEMENTS_LEGAL } from '../../../../shared/rules/cdd.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

const jours = (valeurs: number[]) => (): [number, string][] => valeurs.map(n => [n, `${n}${t(' d#days')}`]);
const ALERTES = jours([90, 120, 150, 180]);
const RELANCES = jours([30, 45, 60, 90]);
/** Renouvellements d'un CDD : 2 selon la loi (art. L1243-13-1), de 0 à 6 avec un accord de branche (contrôle de shared/reglages.ts). */
const RENOUVELLEMENTS = (): [number, string][] => [0, 1, 2, 3, 4, 5, 6].map(n => [n, n === CDD_RENOUVELLEMENTS_LEGAL ? `${n}${t(' (law)')}` : String(n)]);
/** Durée maximale d'un CDD, renouvellements compris : 0 = selon le motif (art. L1242-8-1). */
const DUREES = (): [number, string][] => [[0, t('According to the reason (law)')], ...[12, 18, 24, 36].map(n => [n, `${n}${t(' months#count')}`] as [number, string])];

/**
 * CDD : renouvellements et durée maximale, enregistrés ensemble avec la référence de l'accord de branche, exigée dès qu'une
 * valeur diffère de la loi (contrôle COHERENCE du serveur).
 */
function ReglagesCdd({ s, admin }: SectionProps & { admin: boolean }) {
  const save = useEnregistrerReglages();
  const [ren, setRen] = useState(s.cddRenouvellementsMax);
  const [duree, setDuree] = useState(s.cddDureeMaxMois);
  const [accord, setAccord] = useState(s.cddAccordBranche);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRen(s.cddRenouvellementsMax); setDuree(s.cddDureeMaxMois); setAccord(s.cddAccordBranche); setTente(false); }, [s.cddRenouvellementsMax, s.cddDureeMaxMois, s.cddAccordBranche]);
  const derogation = ren !== CDD_RENOUVELLEMENTS_LEGAL || duree > 0;
  const erreurAccord = derogation && !accord.trim() ? t('Enter the reference of the extended branch agreement that sets these values (art. L1242-8 and L1243-13).') : null;
  const modifie = ren !== s.cddRenouvellementsMax || duree !== s.cddDureeMaxMois || accord.trim() !== s.cddAccordBranche;
  const enregistrer = async () => {
    if (erreurAccord) { setTente(true); document.getElementById('param-cdd-accord')?.focus(); return; }
    setBusy(true);
    await save({ cddRenouvellementsMax: ren, cddDureeMaxMois: duree, cddAccordBranche: accord });
    setBusy(false);
  };
  return (
    <>
      <Field label={t('Fixed-term contract: renewals allowed')}>
        <Seg name="param-cdd-renouvellements" label={t('Fixed-term contract: renewals allowed')} value={ren} options={RENOUVELLEMENTS()} disabled={!admin}
          onChange={v => setRen(v)} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Field label={t('Fixed-term contract: maximum duration, renewals included')} htmlFor="param-cdd-duree">
        <select className="input" id="param-cdd-duree" value={duree} disabled={!admin} onChange={e => setDuree(Number(e.target.value))} style={{ maxWidth: 240 }}>
          {DUREES().map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label={t('Reference of the branch agreement')} htmlFor="param-cdd-accord" requis={derogation} erreur={tente && erreurAccord}>
        <input className="input" id="param-cdd-accord" maxLength={120} placeholder={t('Branch agreement of the chemical industries of …')} value={accord} disabled={!admin}
          onChange={e => setAccord(e.target.value)} />
      </Field>
      {admin && modifie && (
        <div className="actions-end">
          <Btn variant="primary" disabled={busy} onClick={enregistrer}>{t('Save the rules of fixed-term contracts')}</Btn>
        </div>
      )}
      <Fine>
        {t('Failing an extended branch agreement, the law allows 2 renewals (art. L1243-13-1) and a maximum duration according to the reason: 18 months in general, 9 months pending an employee recruited on a permanent contract or for urgent works, 24 months for an exceptional export order or a departure before the job is abolished, 36 months for a senior fixed-term contract (art. L1242-8-1). A branch agreement may derogate from it (art. L1242-8 and L1243-13): to be checked for the CCN of the chemical industries. The overruns are flagged on the sheet and at renewal, without blocking anything; the waiting period between two contracts on the same job is recalled when the sheet is created (art. L1244-3).')}
      </Fine>
    </>
  );
}

export function Contrats({ s, envois }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const save = useEnregistrerReglages();
  if (!espaceRh) return null;
  return (
    <Panel title={t('Contracts')} style={{ gap: 'var(--space-4)' }}>
      <Field label={t('Residence permit: first alert')}>
        <Seg name="param-titre-alerte" label={t('Residence permit: first alert')} value={s.titreSejourAlerte} options={ALERTES()} disabled={!admin}
          onChange={v => save({ titreSejourAlerte: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Field label={t('Residence permit: reminder')}>
        <Seg name="param-titre-relance" label={t('Residence permit: reminder')} value={s.titreSejourRelance} options={RELANCES()} disabled={!admin}
          onChange={v => save({ titreSejourRelance: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Fine>
        {t('The renewal of a residence permit is requested at the prefecture in the four months before its expiry: the due date becomes “Renewal to request” at the first alert, “Reminder” afterwards. Expired, the permit makes the employee non-compliant and puts them “No Go” on the worksites (art. L5221-8). The ends of trial period, dated the last day to notify a termination within the notice period, and the ends of contract follow the alert threshold of the follow-up rules.')}
      </Fine>
      <ReglagesCdd s={s} envois={envois} admin={admin} />
    </Panel>
  );
}
