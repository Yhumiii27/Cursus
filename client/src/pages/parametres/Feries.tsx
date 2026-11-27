// Paramètres → Jours fériés (t051, shared/rules/feries.ts) : journée de solidarité et fériés chômés, réglés année par année
// à partir de 2027, jamais pour une année passée. Par défaut : lundi de Pentecôte chômé, tous les fériés chômés. Le 1er mai
// reste toujours chômé. Avant d'enregistrer, l'écran nomme les absences dont le décompte change ; une année déjà engagée
// (absences transmises à la paie, congés clôturés) ne se modifie qu'avec un motif (dialogue « confirmer »). Réglage de
// l'administrateur RH (`parametres.feries`) ; les autres profils consultent.
import { useEffect, useMemo, useState } from 'react';
import { feriesLegaux, parse } from '../../../../shared/dates.ts';
import { fmtIso, fmtShort } from '../../../../shared/format.ts';
import {
  absencesRecalculees, anneeEngagee, anneesReglables, controlerFeries, estEngagee, feriesDeLAnnee, ferieDuWeekEnd, FERIES_LABEL, memeReglage, MODALITES_SOLIDARITE, MOTIF_FERIES_MAX,
  reglageAnnee, SOLIDARITE_PAIE,
} from '../../../../shared/rules/feries.ts';
import type { CodeFerie, ModaliteSolidarite } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, Panel, Seg } from '../../components/ui.tsx';
import { useDomain, useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import type { Confirmation } from '../../state/confirmations.ts';
import type { SectionProps } from './commun.ts';
import { t, tn } from '../../i18n/langue.ts';

const MODALITES = Object.entries(MODALITES_SOLIDARITE) as [ModaliteSolidarite, { label: string; aide: string }][];

export function Feries(_: SectionProps) {
  const d = useDomain();
  const { admin, espaceRh } = useRole();
  const { run, openDialog } = useStore();
  const annees = anneesReglables(d.ti);
  const [annee, setAnnee] = useState(annees[0]);
  const enVigueur = reglageAnnee(d.ds.calendrierFeries, annee);
  const [solidarite, setSolidarite] = useState<ModaliteSolidarite>(enVigueur.solidarite);
  const [ferie, setFerie] = useState<CodeFerie | ''>(enVigueur.solidariteFerie ?? '');
  const [nonChomes, setNonChomes] = useState<CodeFerie[]>(enVigueur.nonChomes);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  const cle = JSON.stringify(enVigueur);
  useEffect(() => {
    const r = JSON.parse(cle) as typeof enVigueur;
    setSolidarite(r.solidarite); setFerie(r.solidariteFerie ?? ''); setNonChomes(r.nonChomes); setTente(false);
  }, [cle]);

  const saisi = { solidarite, solidariteFerie: solidarite === 'autre_ferie' ? (ferie || null) : null, nonChomes };
  // Contrôle partagé avec l'action : férié manquant, ou qui tombe un samedi ou un dimanche de l'année.
  const erreurFerie = solidarite === 'autre_ferie' ? controlerFeries({ annee, ...saisi }, d.ti).erreurs.solidariteFerie ?? null : null;
  const modifie = !memeReglage(enVigueur, saisi);
  const engagee = anneeEngagee(d.ds, annee);
  const cleSaisie = JSON.stringify(saisi);
  // Absences de l'année dont le décompte change (jours ouvrés) : nommées avant l'enregistrement.
  const recalculees = useMemo(() => (modifie && !erreurFerie ? absencesRecalculees(d, annee, JSON.parse(cleSaisie)) : []), [d, annee, cleSaisie, modifie, erreurFerie]);
  if (!espaceRh || !annees.length) return null;

  const legaux = feriesLegaux(annee);
  const sorts = feriesDeLAnnee(annee, { ...saisi, solidariteFerie: saisi.solidariteFerie as CodeFerie | null });
  const basculer = (c: CodeFerie, chome: boolean) => setNonChomes(chome ? nonChomes.filter(x => x !== c) : [...nonChomes, c]);
  const payload = { annee, ...saisi };
  const enregistrer = async () => {
    if (erreurFerie) { setTente(true); document.getElementById('feries-ferie')?.focus(); return; }
    if (estEngagee(engagee)) { openDialog({ type: 'confirmer', c: modificationEngagee(annee, engagee, recalculees.length, payload) }); return; }
    setBusy(true);
    await run('parametres.feries', payload);
    setBusy(false);
  };

  return (
    <Panel title={t('Public holidays and solidarity day')} style={{ gap: 'var(--space-4)' }}>
      <Field label={t('Year')}>
        <Seg name="feries-annee" label={t('Year')} value={annee} options={annees.map(a => [a, String(a)] as [number, string])} onChange={setAnnee} />
      </Field>
      <Field label={t('Solidarity day')} htmlFor="feries-solidarite">
        <select className="input" id="feries-solidarite" value={solidarite} disabled={!admin} onChange={e => { setSolidarite(e.target.value as ModaliteSolidarite); setTente(false); }} style={{ maxWidth: 360 }}>
          {MODALITES.map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
        </select>
      </Field>
      {solidarite === 'autre_ferie' && (
        <Field label={t('Public holiday worked')} htmlFor="feries-ferie" requis erreur={(tente || !!ferie) && erreurFerie}>
          <select className="input" id="feries-ferie" value={ferie} disabled={!admin} onChange={e => setFerie(e.target.value as CodeFerie)} style={{ maxWidth: 360 }}>
            <option value="">{t('Choose…')}</option>
            {/* Férié du week-end : grisé, il ne ferait travailler aucun jour ouvré. */}
            {legaux.filter(f => f.code !== '1er_mai' && f.code !== 'pentecote').map(f => {
              const we = ferieDuWeekEnd(annee, f.code);
              return <option key={f.code} value={f.code} disabled={!!we && f.code !== ferie}>{FERIES_LABEL[f.code]} — {fmtIso(f.jour)}{we ? ` (${we})` : ''}</option>;
            })}
          </select>
        </Field>
      )}
      <Fine>{MODALITES_SOLIDARITE[solidarite].aide}</Fine>

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <legend style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>{t('Public holidays off in ')}{annee}</legend>
        {sorts.map(f => (
          <label key={f.code} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 14, cursor: admin ? 'pointer' : undefined }}>
            <input type="checkbox" checked={f.sort === 'chome'} disabled={!admin || f.code === '1er_mai' || f.sort === 'solidarite'}
              onChange={e => basculer(f.code, e.target.checked)} style={{ accentColor: 'var(--color-accent)', flex: 'none' }} />
            <span>
              {FERIES_LABEL[f.code]} <span className="text-muted">· {fmtShort(parse(f.jour))}</span>
              {f.code === '1er_mai' && <span className="text-muted sub">{t(' — always off and paid (art. L3133-4)')}</span>}
              {f.sort === 'solidarite' && <span className="text-muted sub">{t(' — solidarity day, worked')}</span>}
              {f.sort === 'travaille' && <span className="text-muted sub">{t(' — worked like an ordinary day')}</span>}
            </span>
          </label>
        ))}
      </fieldset>

      {enVigueur.le && <Fine>{t('Setting ')}{annee}{t(' saved on ')}{fmtIso(enVigueur.le.slice(0, 10))}{t(' by ')}{enVigueur.par}{enVigueur.motif ? `${t(' — reason: ')}${enVigueur.motif}` : ''}.</Fine>}
      {modifie && recalculees.length > 0 && (
        <div className="note-accent">
          {tn(recalculees.length, 'absence recalculated', 'absences recalculated')}{t(':#colon')}{' '}
          {recalculees.slice(0, 8).map(x => `${d.personName(x.absence.empId)}${t(' from #date')}${fmtShort(parse(x.absence.du))} (${x.avant} → ${x.apres}${t(' d#days')})`).join(', ')}
          {recalculees.length > 8 ? '…' : ''}
        </div>
      )}
      {estEngagee(engagee) && (
        <div className="note-accent">
          {t('Year ')}{annee}{t(' already committed (')}{engageeTexte(engagee)}{t('): a change requires a reason, kept for HR.')}
        </div>
      )}
      {admin && modifie && <div className="actions-end"><Btn variant="primary" disabled={busy} onClick={enregistrer}>{`${t('Save ')}${annee}`}</Btn></div>}
      <Fine>
        {t('A public holiday not taken off, like the solidarity day worked, becomes an ordinary day: counted in leave, hours offered, working day of the fixed-days arrangement. ')}{SOLIDARITE_PAIE}{t(' The setting of a year changes neither the previous years nor the counts from before going live.')}
      </Fine>
    </Panel>
  );
}

const engageeTexte = (x: { absences: number; clotures: number }) => [
  x.absences ? tn(x.absences, 'absence transmitted to payroll', 'absences transmitted to payroll') : '',
  x.clotures ? tn(x.clotures, 'leave closing', 'leave closings') : '',
].filter(Boolean).join(t(' and #et'));

/** Modification d'une année déjà engagée : motif obligatoire, absences recalculées annoncées. */
function modificationEngagee(annee: number, engagee: { absences: number; clotures: number }, recalculees: number, payload: Record<string, unknown>): Confirmation {
  return {
    titre: `${t('Edit the public holidays ')}${annee}`,
    question: `${t('Edit the public holidays of ')}${annee}${t(', year already committed (')}${engageeTexte(engagee)})${t('?#question')}`,
    suites: [
      recalculees ? `${tn(recalculees, 'absence is recalculated', 'absences are recalculated')}${t(': ')}${recalculees > 1 ? t('their counted days change') : t('its counted days change')}${t('; an absence already transmitted goes as an adjustment in the next batch.')}`
        : t('No absence of the year changes its count.'),
      t('The leave already closed is not redone.'),
    ],
    bouton: t('Save'),
    action: 'parametres.feries',
    payload,
    motif: { label: t('Reason for the change'), requis: true, aide: `${t('Kept with the setting, read by HR (')}${MOTIF_FERIES_MAX}${t(' characters at most); never copied into the log.')}`, placeholder: t('Decision after the CSE’s opinion of …') },
  };
}
