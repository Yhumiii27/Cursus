// Paramètres → Décompte des heures (pages/parametres/DecompteHeures.tsx), bloc « Forfait annuel en heures » (lot 12, chantier
// C1, étape 2 ; shared/rules/forfait-heures.ts) : début de la période de référence, début du suivi dans Cursus (mise en
// service), référence de l'accord, seuil de la tranche à 25 % (heures par semaine travaillée sous forfait), natures d'absence
// déduites de la cible, durée déduite par jour d'absence (calculée par défaut : forfait divisé par les jours ouvrés
// théoriques), mois d'émission des heures et imputation sur le contingent (désactivée tant que la paie ne l'a pas confirmée).
// S'écarter du défaut pour la période, le seuil, les absences ou la durée journalière exige la référence de l'accord
// (COHERENCE de shared/reglages.ts, art. L3121-63 et L3121-64). Champs enregistrés ensemble ; une ligne déjà confirmée n'est
// jamais recalculée (la rouvrir). Les lignes étant repérées par leur début de plage, déplacer le début du suivi ou de la
// période une fois une clôture enregistrée passe par une confirmation avec avertissement (state/confirmations-forfait-heures.ts),
// que le serveur exige aussi (`refusChangementDebutForfait`, parametres.maj). Réglages de l'administrateur RH ; les autres
// profils consultent.
import { type FormEvent, useEffect, useState } from 'react';
import { ABS_LABEL } from '../../../../shared/constants.ts';
import { isValidDate } from '../../../../shared/dates.ts';
import { fmtIso } from '../../../../shared/format.ts';
import {
  ABSENCES_DEDUCTIBLES, DEBUT_SUIVI_DEFAUT, forfaitHeuresHorsDefaut, heuresParJour, periodeReference, SEUIL_25_DEFAUT,
} from '../../../../shared/rules/forfait-heures.ts';
import type { AbsenceType, EmissionForfaitHeures, Settings } from '../../../../shared/types.ts';
import { Field } from '../Dialog.tsx';
import { Btn, Fine, NoteAccent, Seg } from '../ui.tsx';
import { useDomain, useRole } from '../../state/derived.ts';
import { changementDebutForfait } from '../../state/confirmations-forfait-heures.ts';
import { useStore } from '../../state/store.tsx';
import { type SectionProps, useEnregistrerReglages } from '../../pages/parametres/commun.ts';
import { JourMois } from '../../pages/parametres/Entretiens.tsx';
import { periodeTexte } from './forfait-heures-vue.ts';
import { t } from '../../i18n/langue.ts';

/** Choix : sources anglaises, traduites au rendu. */
const EMISSIONS: [EmissionForfaitHeures, string][] = [['cloture', 'Month of the confirmation'], ['periode', 'Last month of the range']];
/** Heures à deux décimales : « 7,02 h ». */
const heures2 = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString('fr-FR')} h`;
const saisie = (n: number) => (n ? String(n).replace('.', ',') : '');

/** Erreurs des champs saisis (null : valide). */
export function erreursForfaitHeures(v: { suivi: string; seuil: string; jour: string; accord: string; horsDefaut: boolean }) {
  const seuil = v.seuil.trim(), jour = v.jour.trim().replace(',', '.');
  return {
    suivi: isValidDate(v.suivi) ? null : t('Enter the date of the start of the follow-up.'),
    seuil: /^\d{1,2}$/.test(seuil) && Number(seuil) <= 48 ? null : t('Enter a whole number of hours, from 0 to 48.'),
    jour: !jour || (/^\d{1,2}(\.\d{1,2})?$/.test(jour) && Number(jour) <= 12) ? null : t('Enter a duration from 0 to 12 h (empty: calculated), two decimals at most.'),
    accord: v.horsDefaut && !v.accord.trim() ? t('Enter the reference of the collective agreement that sets these rules.') : null,
  };
}

export function ReglagesForfaitHeures({ s }: Pick<SectionProps, 's'>) {
  const d = useDomain();
  const { admin } = useRole();
  const save = useEnregistrerReglages();
  const { openDialog } = useStore();
  // Clôtures enregistrées (non annulées) : repérées par leur début de plage, que déplace un autre début du suivi ou de la période.
  const enregistrees = (d.ds.cloturesForfaitHeures ?? []).filter(l => l.statut !== 'annulee').length;
  const [periode, setPeriode] = useState(s.forfaitHeuresDebutPeriode);
  const [suivi, setSuivi] = useState(s.forfaitHeuresDebutSuivi);
  const [accord, setAccord] = useState(s.forfaitHeuresAccord);
  const [seuil, setSeuil] = useState(String(s.forfaitHeuresSeuil25));
  const [absences, setAbsences] = useState<AbsenceType[]>(s.forfaitHeuresAbsencesDeduites);
  const [jour, setJour] = useState(saisie(s.forfaitHeuresJour));
  const [emission, setEmission] = useState<EmissionForfaitHeures>(s.forfaitHeuresEmission);
  const [contingent, setContingent] = useState(s.forfaitHeuresContingent);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPeriode(s.forfaitHeuresDebutPeriode); setSuivi(s.forfaitHeuresDebutSuivi); setAccord(s.forfaitHeuresAccord); setSeuil(String(s.forfaitHeuresSeuil25));
    setAbsences(s.forfaitHeuresAbsencesDeduites); setJour(saisie(s.forfaitHeuresJour)); setEmission(s.forfaitHeuresEmission); setContingent(s.forfaitHeuresContingent);
    setTente(false);
  }, [s.forfaitHeuresDebutPeriode, s.forfaitHeuresDebutSuivi, s.forfaitHeuresAccord, s.forfaitHeuresSeuil25, s.forfaitHeuresAbsencesDeduites, s.forfaitHeuresJour,
    s.forfaitHeuresEmission, s.forfaitHeuresContingent]);

  const n = Number(seuil.trim()), j = Number(jour.trim().replace(',', '.') || 0);
  const candidat = { forfaitHeuresDebutPeriode: periode, forfaitHeuresSeuil25: Number.isFinite(n) ? n : SEUIL_25_DEFAUT, forfaitHeuresAbsencesDeduites: absences, forfaitHeuresJour: Number.isFinite(j) ? j : 0 };
  const erreurs = erreursForfaitHeures({ suivi, seuil, jour, accord, horsDefaut: forfaitHeuresHorsDefaut(candidat) });
  const modifie = periode !== s.forfaitHeuresDebutPeriode || suivi !== s.forfaitHeuresDebutSuivi || accord.trim() !== s.forfaitHeuresAccord || seuil.trim() !== String(s.forfaitHeuresSeuil25)
    || absences.length !== s.forfaitHeuresAbsencesDeduites.length || absences.some(x => !s.forfaitHeuresAbsencesDeduites.includes(x)) || j !== s.forfaitHeuresJour
    || emission !== s.forfaitHeuresEmission || contingent !== s.forfaitHeuresContingent;
  const debutModifie = periode !== s.forfaitHeuresDebutPeriode || suivi !== s.forfaitHeuresDebutSuivi;
  const basculer = (ty: AbsenceType, oui: boolean) => setAbsences(l => (oui ? [...new Set([...l, ty])] : l.filter(x => x !== ty)));
  const ref = periodeReference({ forfaitHeuresDebutPeriode: periode }, d.ti);

  const enregistrer = async (ev: FormEvent) => {
    ev.preventDefault();
    const champ = erreurs.suivi ? 'fh-suivi' : erreurs.seuil ? 'fh-seuil' : erreurs.jour ? 'fh-jour' : erreurs.accord ? 'fh-accord' : null;
    if (champ) { setTente(true); document.getElementById(champ)?.focus(); return; }
    const patch = {
      forfaitHeuresDebutPeriode: periode, forfaitHeuresDebutSuivi: suivi, forfaitHeuresAccord: accord, forfaitHeuresSeuil25: n, forfaitHeuresAbsencesDeduites: absences,
      forfaitHeuresJour: j, forfaitHeuresEmission: emission, forfaitHeuresContingent: contingent,
    } satisfies Partial<Settings>;
    // Début déplacé alors que des clôtures sont enregistrées : confirmation avec avertissement (exigée aussi par le serveur).
    if (debutModifie && enregistrees) { openDialog({ type: 'confirmer', c: changementDebutForfait(patch, enregistrees) }); return; }
    setBusy(true);
    await save(patch);
    setBusy(false);
  };

  return (
    <form onSubmit={enregistrer} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }} noValidate>
      <div className="text-muted sub" style={{ fontWeight: 600 }}>{t('Annual fixed hours')}</div>
      <div className="grid-2">
        <JourMois id="fh-periode" label={t('Start of the reference period')} value={periode} onChange={setPeriode} disabled={!admin} />
        <Field label={t('Start of the follow-up in Cursus')} htmlFor="fh-suivi" requis erreur={tente && erreurs.suivi}>
          <input className="input" id="fh-suivi" type="date" value={suivi} disabled={!admin} onChange={e => setSuivi(e.target.value)} />
        </Field>
      </div>
      {admin && enregistrees > 0 && (
        <NoteAccent>
          {enregistrees > 1 ? `${enregistrees}${t(' closings are recorded')}` : t('A closing is recorded')}{t(', identified by the start of their range: changing the start of the follow-up or of the reference period makes them “to review”, and the ranges that overlap them stay blocked (never paid twice). Confirmation requested.')}
        </NoteAccent>
      )}
      <Fine>
        {t('Current period: ')}{periodeTexte(ref)}{t('. The actual from before the start of the follow-up is not in Cursus (by default, the go-live of ')}{fmtIso(DEBUT_SUIVI_DEFAUT)}{t('; the 2026 fixed hours are closed by hand in Sage): a period started before is closed “partial”, its start to complete in Sage.')}
      </Fine>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label={t('Hours at 25 % per week worked')} htmlFor="fh-seuil" requis erreur={tente && erreurs.seuil}>
          <input className="input tnum" id="fh-seuil" inputMode="numeric" value={seuil} disabled={!admin} onChange={e => setSeuil(e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
        <Field label={t('Hours deducted per day of absence')} htmlFor="fh-jour" erreur={tente && erreurs.jour}>
          <input className="input tnum" id="fh-jour" inputMode="decimal" placeholder={t('Calculated#fem')} value={jour} disabled={!admin} onChange={e => setJour(e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
      </div>
      <Fine>
        {t('Beyond the net target, the hours of each week worked under the fixed hours up to this threshold are increased by 25 % (HFA25), the rest by 50 % (HFA50):')}
        {' '}{SEUIL_25_DEFAUT}{t(' h by default, from the 36th to the 43rd hour (art. L3121-36; split of the agreement). Duration deducted per working day of absence: empty, the fixed hours divided by the theoretical working days of the period (i.e. ')}{heures2(heuresParJour(undefined, 1607, ref))}{t(' for 1,607 h in ')}{ref.debut.slice(0, 4)}{t('); otherwise the duration set by the agreement.')}
      </Fine>
      <Field label={t('Absences deducted from the target')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-1) var(--space-3)' }}>
          {ABSENCES_DEDUCTIBLES.map(ty => (
            <label key={ty} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13 }}>
              <input type="checkbox" checked={absences.includes(ty)} disabled={!admin} onChange={e => basculer(ty, e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
              {ABS_LABEL[ty]}
            </label>
          ))}
        </div>
      </Field>
      <Fine>
        {t('By default, all absences except paid leave: the 1,607 h already include the legal CP, the public holidays off and the solidarity day (art. L3121-41), never deducted. Only the total of the hours deducted is kept on the closing, never the nature of an absence.')}
      </Fine>
      <Field label={t('Reference of the collective agreement')} htmlFor="fh-accord" requis={forfaitHeuresHorsDefaut(candidat)} erreur={tente && erreurs.accord}>
        <input className="input" id="fh-accord" maxLength={120} placeholder={t('CCN Chemical industries, company agreement on working time of …')} value={accord} disabled={!admin}
          onChange={e => setAccord(e.target.value)} />
      </Field>
      <Field label={t('Hours of the closing in payroll')}>
        <Seg name="fh-emission" label={t('Hours of the closing in payroll')} value={emission} options={EMISSIONS.map(([k, l]) => [k, t(l)])} disabled={!admin} onChange={setEmission} style={{ flexWrap: 'wrap' }} />
      </Field>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={contingent} disabled={!admin} onChange={e => setContingent(e.target.checked)}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          {t('Charge the hours beyond the fixed hours to the annual quota')}
          <span className="text-muted sub" style={{ display: 'block' }}>{t('And the mandatory compensatory rest beyond; to tick once the charging is confirmed by payroll.')}</span>
        </span>
      </label>
      {admin && modifie && <div className="actions-end"><Btn variant="primary" type="submit" disabled={busy}>{t('Save the annual fixed hours')}</Btn></div>}
      {!s.forfaitHeuresAccord && <NoteAccent>{t('Agreement on the annual fixed hours not referenced: default rules (calendar year, 8 h at 25 % per week, all absences except CP).')}</NoteAccent>}
      <Fine>
        {t('Items HFA25, HFA50, HCA10 and HCA25 deactivated as long as payroll has not given their codes (Working time → Transmission to Sage Paie → Items): the hours are then listed “to be entered in Sage”. Month of the confirmation by default; a range closed by the departure goes with the leaving balance.')}
      </Fine>
    </form>
  );
}
