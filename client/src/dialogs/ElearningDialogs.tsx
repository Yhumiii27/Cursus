// lot 12 — C4 (organismes de formation et e-learning) : dialogues des inscriptions aux modules d'e-learning (onglet
// E-learning de l'écran Formations) : inscription d'un ou plusieurs salariés, ou de l'équipe d'une ligne du plan (droit
// « formations ») ; fin validée par le service RH (formation suivie d'origine « elearning » et, module rattaché au
// catalogue et réussi, certification par le circuit existant) ; correction motivée d'une inscription ouverte. Le serveur
// vérifie droits et états (server/src/actions/elearning.ts) ; le motif reste au service RH, jamais au journal.
import { useState } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { erreurMotifCorrection, MOTIF_CORRECTION_MAX } from '../../../shared/rules/corrections.ts';
import { present } from '../../../shared/rules/contrats.ts';
import { avancementDe, heuresRetenues, inscriptionOuverteDe, STATUT_INSCRIPTION_LABEL } from '../../../shared/rules/elearning.ts';
import { dureeValide } from '../../../shared/rules/heures-formation.ts';
import { ChoixCollaborateur } from '../components/ChoixCollaborateur.tsx';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Btn, Chips, Fine, NoteAccent, Seg } from '../components/ui.tsx';
import { aideMotifCorrection } from '../state/confirmations-corrections.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

/** Inscription à un module : salariés choisis un à un, ou membres présents de l'équipe d'une ligne du plan. */
export function ElearningInscrireDialog({ moduleId, empId, planActionId }: { moduleId?: number | null; empId?: number | null; planActionId?: number | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const modules = (d.ds.modulesElearning ?? []).filter(m => !m.archive).sort((a, b) => a.code.localeCompare(b.code));
  const [module, setModule] = useState(moduleId != null ? String(moduleId) : modules.length === 1 ? String(modules[0].id) : '');
  const [mode, setMode] = useState<'salaries' | 'plan'>(planActionId != null ? 'plan' : 'salaries');
  const [choisis, setChoisis] = useState<number[]>(empId != null ? [empId] : []);
  const [courant, setCourant] = useState<number | null>(null);
  const [ligne, setLigne] = useState(planActionId != null ? String(planActionId) : '');
  const [echeance, setEcheance] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const presents = d.ds.employes.filter(e => present(e, d.ti));
  const exercice = Number(d.ti.slice(0, 4));
  const lignes = d.ds.plan.filter(l => l.exercice >= exercice - 1 && l.statut !== 'realise' && l.statut !== 'reporte');
  const l = lignes.find(x => x.id === Number(ligne)) ?? null;
  const m = modules.find(x => x.id === Number(module)) ?? null;
  const cibles = mode === 'plan' ? (l ? presents.filter(e => e.equipe === l.equipe).map(e => e.id) : []) : choisis;
  const deja = m ? cibles.filter(id => inscriptionOuverteDe(d.ds.inscriptionsElearning, id, m.id)).length : 0;
  const errModule = m ? null : t('Choose the module.');
  const errCibles = mode === 'plan' ? (!l ? t('Choose the plan line.') : !cibles.length ? t('No employee present in this team.') : null)
    : !choisis.length ? t('Add at least one employee.') : null;
  const errEcheance = echeance && echeance < d.ti ? t('The due date has passed.') : null;
  const ajouter = (id: number | null) => { if (id != null && !choisis.includes(id)) setChoisis([...choisis, id]); setCourant(null); };
  const envoyer = async () => {
    if (busy || !v.verifier(errModule, errCibles, errEcheance)) return;
    setBusy(true);
    const r = await run('elearning.inscrire', { moduleId: m!.id, ...(mode === 'plan' ? { planActionId: l!.id } : { empIds: choisis }), echeance });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  const nomLigne = (x: (typeof lignes)[number]) => `${x.f ? d.fm(x.f)?.court ?? x.f : x.libelle} — ${x.equipe} · ${x.periode} ${x.exercice}`;
  return (
    <Dialog title={t('Enrol in an e-learning module')} width={600} tall onSubmit={envoyer}
      actions={<><CancelButton /><SubmitButton busy={busy}>{cibles.length > 1 ? `${t('Enrol #verb')}${tn(cibles.length - deja, 'employee#salarie', 'employees#salarie')}` : t('Enrol')}</SubmitButton></>}>
      {modules.length === 0 ? <Bloquant>{t('No module in force: add some in Reference data → E-learning modules.')}</Bloquant> : <>
        <Field label={t('Module')} htmlFor="ei-module" requis erreur={v.erreur(errModule)}>
          <select className="input" id="ei-module" autoFocus value={module} onChange={e => setModule(e.target.value)}>
            <option value="">{t('Choose…')}</option>
            {modules.map(x => <option key={x.id} value={x.id}>{x.code} — {x.intitule}</option>)}
          </select>
        </Field>
        <Seg name="eiMode" label={t('Who to enrol')} value={mode} onChange={setMode} options={[['salaries', t('Employees#some')], ['plan', t('The team of a plan line')]]} style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }} />
        {mode === 'salaries' ? (
          <Field label={t('Employees#salarie')} htmlFor="ei-emp" requis erreur={v.erreur(errCibles)}>
            <ChoixCollaborateur id="ei-emp" emps={presents.filter(e => !choisis.includes(e.id))} valeur={courant} onChange={ajouter} placeholder={t('Add an employee…')} />
            {choisis.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                {choisis.map(id => (
                  <Btn key={id} small onClick={() => setChoisis(choisis.filter(x => x !== id))} title={t('Remove from the list')}>{d.emp(id)?.nom ?? id} ✕</Btn>
                ))}
              </div>
            )}
          </Field>
        ) : (
          <Field label={t('Plan line')} htmlFor="ei-plan" requis erreur={v.erreur(errCibles)}>
            <select className="input" id="ei-plan" value={ligne} onChange={e => setLigne(e.target.value)}>
              <option value="">{t('Choose…')}</option>
              {lignes.map(x => <option key={x.id} value={x.id}>{nomLigne(x)}</option>)}
            </select>
          </Field>
        )}
        {mode === 'plan' && l && <Chips items={cibles.map(id => ({ key: id, label: d.emp(id)?.nom ?? String(id), cls: 'tag-neutral' }))} />}
        <Field label={t('Due date (optional)')} htmlFor="ei-echeance" erreur={errEcheance}>
          <input className="input" id="ei-echeance" type="date" value={echeance} min={d.ti} onChange={e => setEcheance(e.target.value)} />
        </Field>
        {deja > 0 && <NoteAccent>{tn(deja, 'employee is already enrolled', 'employees are already enrolled')}{t(' in this module: ')}{t(deja > 1 ? 'they are skipped' : 'they are skipped#one')}.</NoteAccent>}
        <Fine>{t('The employee finds the module and its link in their space (My online modules). Tracking is limited to the status, the progress and the completion.')}</Fine>
      </>}
    </Dialog>
  );
}

/** Fin d'un module validée par le service RH : date, heures retenues, réussite. */
export function ElearningTerminerDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [i] = useState(() => (d.ds.inscriptionsElearning ?? []).find(x => x.id === id && !x.annuleLe) ?? null);
  const m = i ? (d.ds.modulesElearning ?? []).find(x => x.id === i.moduleId) ?? null : null;
  const [le, setLe] = useState(i?.avancementLe && i.avancement === 100 ? i.avancementLe : i?.declareLe ?? d.ti);
  const h = i && m ? heuresRetenues(i, m) : null;
  const [heures, setHeures] = useState(h != null ? String(h) : '');
  const [reussi, setReussi] = useState<'oui' | 'non' | 'so'>(i?.reussi === false ? 'non' : i?.reussi === true || m?.formation ? 'oui' : 'so');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const fm = m?.formation ? d.fm(m.formation) : null;
  const n = heures.trim() ? Number(heures.replace(',', '.')) : null;
  const errLe = !le ? t('Enter the end date.') : le > d.ti ? t('The date cannot be in the future.') : i && le < i.inscritLe ? `${t('The date is before the enrolment (')}${fmtIso(i.inscritLe)}).` : null;
  const errHeures = n !== null && !dureeValide(n) ? t('Number from 0.25 to 2,000.') : null;
  const envoyer = async () => {
    if (busy || !v.verifier(errLe, errHeures, !i)) return;
    setBusy(true);
    const r = await run('elearning.terminer', { id, de: i!.statut, termineLe: le, heures: heures.trim(), reussi: reussi === 'oui' ? true : reussi === 'non' ? false : null });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={t('Approve the completion of the module')} width={520} onSubmit={envoyer}
      actions={!i ? <CancelButton label={t('Close')} /> : <><CancelButton /><SubmitButton busy={busy}>{t('Approve the completion')}</SubmitButton></>}>
      {!i || !m ? <Bloquant>{t('This enrolment no longer exists.')}</Bloquant> : <>
        <Field label={t('Enrolment')}><Static pad>{d.emp(i.empId)?.nom ?? '—'} · {m.code} — {m.intitule}</Static></Field>
        {i.declareLe && <p className="text-muted sub" style={{ margin: 0 }}>{t('Completion declared by the employee on ')}{fmtIso(i.declareLe)}.</p>}
        {i.avancement != null && <p className="text-muted sub" style={{ margin: 0 }}>{t('Progress ')}{i.avancement} %{i.avancementLe ? `${t(' on #au')}${fmtIso(i.avancementLe)}` : ''}{i.avancementSource === 'import' ? ' (import)' : ''}.</p>}
        <div className="grid-2">
          <Field label={t('Completed on')} htmlFor="et-le" requis erreur={le ? errLe : v.erreur(errLe)}>
            <input className="input" id="et-le" type="date" value={le} max={d.ti} onChange={e => setLe(e.target.value)} />
          </Field>
          <Field label={t('Hours retained')} htmlFor="et-heures" erreur={errHeures}>
            <input className="input tnum" id="et-heures" inputMode="decimal" value={heures} placeholder={m.dureeHeures != null ? String(m.dureeHeures) : t('unknown#fem-plural')} onChange={e => setHeures(e.target.value)} />
          </Field>
        </div>
        <Seg name="etReussi" label={t('Success')} value={reussi} onChange={setReussi} options={[['oui', t('Passed')], ['non', t('Not passed')], ['so', t('Not applicable')]]} style={{ alignSelf: 'flex-start' }} />
        {m.attestationRequise && <NoteAccent>{t('Certificate required: attach it to the attended training course or to the certification created (supporting documents).')}</NoteAccent>}
        <Fine>
          {t('An attended training course of origin “e-learning” is created')}{fm ? `${t(', and the certification ')}${fm.court}${t(' if the module is passed')}` : ''}{t('. The hours count only once in the plan and the indicators.')}
        </Fine>
      </>}
    </Dialog>
  );
}

/** Correction motivée d'une inscription ouverte : échéance, avancement saisi par le service RH. */
export function ElearningCorrigerDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [i] = useState(() => (d.ds.inscriptionsElearning ?? []).find(x => x.id === id && !x.annuleLe) ?? null);
  const m = i ? (d.ds.modulesElearning ?? []).find(x => x.id === i.moduleId) ?? null : null;
  const [echeance, setEcheance] = useState(i?.echeance ?? '');
  const [avancement, setAvancement] = useState(i?.avancement != null ? String(i.avancement) : '');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const a = avancementDe(avancement);
  const errAvancement = Number.isNaN(a) ? t('Number from 0 to 100.') : null;
  const errEcheance = echeance && i && echeance < i.inscritLe ? `${t('The date is before the enrolment (')}${fmtIso(i.inscritLe)}).` : null;
  // Seuls les champs changés partent : un avancement inchangé garde sa source (import, service RH) et sa date.
  const echeanceChangee = !!i && (echeance || null) !== i.echeance, avancementChange = !!i && (Number.isNaN(a) || a !== i.avancement);
  const change = echeanceChangee || avancementChange;
  const errChange = change ? null : t('No change.');
  const errMotif = erreurMotifCorrection(motif);
  const envoyer = async () => {
    if (busy || !v.verifier(errAvancement, errEcheance, errChange, errMotif, !i)) return;
    setBusy(true);
    const r = await run('elearning.corriger', { id, ...(echeanceChangee ? { echeance } : {}), ...(avancementChange ? { avancement } : {}), motif });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={t('Correct the enrolment')} width={520} onSubmit={envoyer}
      actions={!i ? <CancelButton label={t('Close')} /> : <><CancelButton /><SubmitButton busy={busy}>{t('Save')}</SubmitButton></>}>
      {!i || !m ? <Bloquant>{t('This enrolment no longer exists.')}</Bloquant> : <>
        <Field label={t('Enrolment')}><Static pad>{d.emp(i.empId)?.nom ?? '—'} · {m.code} · {STATUT_INSCRIPTION_LABEL[i.statut]}</Static></Field>
        <div className="grid-2">
          <Field label={t('Due date')} htmlFor="ec-echeance" erreur={errEcheance}>
            <input className="input" id="ec-echeance" type="date" value={echeance} onChange={e => setEcheance(e.target.value)} />
          </Field>
          <Field label={t('Progress (%)')} htmlFor="ec-avancement" erreur={errAvancement}>
            <input className="input tnum" id="ec-avancement" inputMode="numeric" value={avancement} placeholder={t('0 to 100')} onChange={e => setAvancement(e.target.value)} />
          </Field>
        </div>
        {v.erreur(errChange) && <Bloquant>{errChange}</Bloquant>}
        <Field label={t('Reason for the correction')} htmlFor="ec-motif" requis erreur={motif.trim() ? errMotif : v.erreur(errMotif)}>
          <textarea className="input" id="ec-motif" rows={2} value={motif} maxLength={MOTIF_CORRECTION_MAX} placeholder={t('Due date postponed, progress read on the platform…')} onChange={e => setMotif(e.target.value)} />
        </Field>
        <Fine>{aideMotifCorrection()}</Fine>
      </>}
    </Dialog>
  );
}
