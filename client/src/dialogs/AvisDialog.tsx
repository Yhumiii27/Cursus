// Avis du médecin du travail (service RH) : date de la visite, avis (apte, apte avec restrictions, inapte),
// restrictions recopiées telles qu'écrites et datées, habilitations incompatibles à suspendre, suspensions d'un
// avis précédent à lever. La visite clôt la demande en cours ; le manager ne voit que le verdict et les restrictions.
// Suivi médical (shared/rules/suivi-medical.ts) : date de la prochaine visite fixée par le médecin, qui prime sur la
// périodicité, et examen médical d'aptitude du suivi individuel renforcé. Motif de la visite (facultatif) : une visite de
// mi-carrière ou de fin de carrière passée sans demande dans Cursus clôt la visite due à sa vraie date.
import { useState } from 'react';
import { HAB_CLS, HAB_LABEL, MOTIFS_VISITE } from '../../../shared/constants.ts';
import { fmtIso } from '../../../shared/format.ts';
import { controlerAvis, RESTRICTION_MAX, RESTRICTIONS_MAX, suspendueParAvis } from '../../../shared/rules/sante.ts';
import { examenAttendu, periodicite, SUIVIS_MEDICAUX } from '../../../shared/rules/suivi-medical.ts';
import type { AvisMedical, MotifVisite } from '../../../shared/types.ts';
import { CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, SectionLabel, Seg, Tag } from '../components/ui.tsx';
import { useEnriched, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

interface Ligne { texte: string; jusquau: string }
const LIGNE_VIDE: Ligne = { texte: '', jusquau: '' };

export function AvisDialog({ empId }: { empId: number }) {
  const { d, emps } = useEnriched();
  const { rh } = useRole();
  const { run, closeDialog } = useStore();
  const emp = emps.find(e => e.id === empId);
  const titres = emp ? emp.habs.filter(h => h.delivree && h.mesure !== 'retrait') : [];
  const [date, setDate] = useState(d.ti);
  const [avis, setAvisState] = useState<AvisMedical>('apte');
  const [lignes, setLignes] = useState<Ligne[]>([LIGNE_VIDE]);
  const [prochaine, setProchaine] = useState('');
  // Motif : celui de la demande en cours, sinon non précisé.
  const [motif, setMotif] = useState<MotifVisite | ''>(() => emp?.med.demande?.motif ?? '');
  // Suivi renforcé : cochée quand l'examen médical d'aptitude est attendu (jamais enregistré, renouvellement), décochée
  // pour une visite intermédiaire (examenAttendu).
  const [examen, setExamen] = useState(() => !!emp && examenAttendu(emp.med));
  const [suspendre, setSuspendre] = useState<string[]>([]);
  // Avis apte : les suspensions décidées à un avis précédent sont levées par défaut.
  const [lever, setLever] = useState<string[]>(() => titres.filter(suspendueParAvis).map(h => h.h));
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!emp || !rh) return null;

  const setAvis = (a: AvisMedical) => {
    setAvisState(a);
    setSuspendre([]);
    setLever(a === 'apte' ? titres.filter(suspendueParAvis).map(h => h.h) : []);
  };
  const setLigne = (i: number, patch: Partial<Ligne>) => setLignes(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l));
  const bascule = (liste: string[], set: (v: string[]) => void, h: string, on: boolean) => set(on ? [...liste, h] : liste.filter(x => x !== h));

  const { errors } = controlerAvis({ date, avis, restrictions: lignes, prochaineVisite: prochaine, examen }, d.ti);
  const suivi = emp.med.suivi;
  const demande = emp.med.demande;
  const infos = [
    ...(emp.visite && date && date < emp.visite ? [`${t('Visit earlier than the last recorded one (')}${fmtIso(emp.visite)}${t('): this opinion replaces it.')}`] : []),
    ...(demande ? [date >= demande.le || motif === demande.motif ? `${t('The visit request of ')}${fmtIso(demande.le)}${t(' will be closed.')}` : `${t('The visit request of ')}${fmtIso(demande.le)}${t(' stays open (visit earlier than the request, for another reason).')}`] : []),
    // Mi-carrière, fin de carrière : closes par une visite de leur motif (les autres, par la date de la visite).
    ...(emp.med.dues ?? []).filter(x => x.motif === motif && (motif === 'mi_carriere' || motif === 'fin_carriere')).map(x => `${x.label}${t(': closed by this visit.')}`),
  ];
  // Erreurs affichées après la première tentative d'envoi ; les informations, en direct.
  const msgs = [...(v.tente ? errors : []).map(text => ({ text, bad: true })), ...infos.map(text => ({ text, bad: false }))];

  const confirm = async () => {
    if (busy || !v.verifier(...errors)) return;
    setBusy(true);
    const r = await run('medical.avis', {
      empId, date, avis, motif: motif || null, restrictions: avis === 'restrictions' ? lignes : [],
      prochaineVisite: avis === 'inapte' ? null : prochaine || null, examen,
      suspendre: avis === 'apte' ? [] : suspendre, lever: avis === 'inapte' ? [] : lever,
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t('Occupational physician’s opinion')} width={640} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Save the opinion')}</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label={t('Employee')}><Static>{emp.nom} · {emp.poste}</Static></Field>
        <Field label={t('Date of the visit')} htmlFor="av-date">
          <input className="input" id="av-date" type="date" max={d.ti} value={date} onChange={ev => setDate(ev.target.value)} />
        </Field>
      </div>
      <div className="boxed text-muted sub">{t('Currently: ')}{emp.med.text}</div>
      <Field label={t('Reason for the visit (optional)')} htmlFor="av-motif">
        <select className="input" id="av-motif" value={motif} onChange={ev => setMotif(ev.target.value as MotifVisite | '')}>
          <option value="">{t('Not specified')}</option>
          {(Object.keys(MOTIFS_VISITE) as MotifVisite[]).map(k => <option key={k} value={k}>{MOTIFS_VISITE[k].label}</option>)}
        </select>
      </Field>
      <Field label={t('Opinion')}>
        <Seg name="av-avis" label={t('Occupational physician’s opinion')} value={avis} onChange={setAvis} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
          options={[['apte', t('Fit')], ['restrictions', t('Fit with restrictions')], ['inapte', t('Unfit')]]} />
      </Field>

      <div className="grid-2">
        {avis !== 'inapte' && (
          <Field label={t('Next visit set by the physician (optional)')} htmlFor="av-prochaine">
            <input className="input" id="av-prochaine" type="date" min={date || undefined} value={prochaine} onChange={ev => setProchaine(ev.target.value)} />
          </Field>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, alignSelf: 'end', minHeight: 40 }}>
          <input type="checkbox" checked={examen} onChange={ev => setExamen(ev.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
          {t('Medical fitness examination (reinforced individual monitoring)')}
        </label>
      </div>
      {suivi && (
        <Fine>
          {t('Monitoring: ')}{SUIVIS_MEDICAUX[suivi.type].court}{suivi.deduit ? ` (${suivi.origines.join(', ')})` : ''}{t('. Without a date set by the physician, the next visit follows the periodicity of Settings → Health (')}
          {suivi.type === 'sir'
            ? `${t('intermediate visit at ')}${periodicite('sir', d.ds.settings)}${t(' months, fitness examination at ')}${d.ds.settings.santeSirAptitudeMois ?? 48}${t(' months#unit')}`
            : `${periodicite(suivi.type, d.ds.settings)}${t(' months#unit')}`}).
        </Fine>
      )}

      {avis === 'restrictions' && <>
        <SectionLabel>{t('Job restrictions and adjustments')}</SectionLabel>
        {lignes.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <Field label={`${t('Restriction ')}${i + 1}${t(', as written on the opinion')}`} htmlFor={`av-r${i}`}>
                <input className="input" id={`av-r${i}`} type="text" maxLength={RESTRICTION_MAX} placeholder={t('No carrying of loads over 15 kg')}
                  value={l.texte} onChange={ev => setLigne(i, { texte: ev.target.value })} />
              </Field>
            </div>
            <div style={{ flex: '0 1 170px' }}>
              <Field label={t('Until (optional)')} htmlFor={`av-j${i}`}>
                <input className="input" id={`av-j${i}`} type="date" min={date || undefined} value={l.jusquau} onChange={ev => setLigne(i, { jusquau: ev.target.value })} />
              </Field>
            </div>
            {lignes.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLignes(ls => ls.filter((_, j) => j !== i))}>{t('Remove')}</button>}
          </div>
        ))}
        {lignes.length < RESTRICTIONS_MAX && (
          <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setLignes(ls => [...ls, LIGNE_VIDE])}>{t('Add a restriction')}</button></div>
        )}
        <Fine>{t('Copy each restriction as written, without diagnosis or medical reason: the manager sees it, with its end date. The opinion itself is not kept in Cursus.')}</Fine>
      </>}

      {titres.length > 0 && <>
        <SectionLabel>{t('Authorisations')}</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {titres.map(h => {
            const parAvis = suspendueParAvis(h);
            // Inapte : les titres qui exigent l'aptitude deviennent non valides d'office (prérequis).
            const doffice = avis === 'inapte' && h.hm.medical && !h.mesure;
            const choix = parAvis
              ? (avis !== 'inapte' && { label: t('Lift the suspension'), on: lever.includes(h.h), set: (on: boolean) => bascule(lever, setLever, h.h, on) })
              : (!h.mesure && avis !== 'apte' && !doffice && { label: t('Suspend (incompatible)'), on: suspendre.includes(h.h), set: (on: boolean) => bascule(suspendre, setSuspendre, h.h, on) });
            return (
              <div key={h.h} className="boxed" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14 }}>{h.hm.nom}</div>
                  <div className="text-muted sub">
                    {doffice ? t('Automatically not valid: requires medical fitness') : h.mesure ? h.note : t(h.hm.medical ? 'Requires medical fitness' : 'No fitness condition')}
                  </div>
                </div>
                {choix
                  ? (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, cursor: 'pointer', flex: 'none' }}>
                      <input type="checkbox" checked={choix.on} onChange={ev => choix.set(ev.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
                      {choix.label}
                    </label>
                  )
                  : <Tag cls={HAB_CLS[h.key]} style={{ flex: 'none' }}>{HAB_LABEL[h.key]}</Tag>}
              </div>
            );
          })}
        </div>
        <Fine>
          {t('A suspended authorisation carries the reason “Fitness restriction”, without any other detail; the worksites that require it go No Go.')}
          {avis === 'apte' ? t(' Fit opinion: the suspensions decided at a previous opinion can be lifted.') : ''}
        </Fine>
      </>}

      <Controles msgs={msgs} />
      <Fine>{t('Keystone only receives the verdict (code APTITUDE): No Go for an unfitness opinion, reservation during restrictions in force or an overdue visit.')}</Fine>
    </Dialog>
  );
}
