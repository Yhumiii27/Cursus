// Planning d'équipe (lot 12, chantier C5, étape 2) : dialogues de l'onglet Planning d'équipe de Temps de travail et de
// « Mon planning ». Le serveur refait chaque contrôle (server/src/actions/planning.ts) : l'écran montre ce qu'il va
// décider (aperçu sur l'instantané : shared/rules/planning-apercu.ts), le bouton principal n'est jamais grisé et la saisie
// incomplète se signale à l'envoi.
// - Générer : période (12 semaines au plus, à partir d'aujourd'hui) ; brouillons d'après les affectations au roulement.
// - Publier : brouillons de la période, refus (habilitation absente, retirée ou suspendue ; nuit d'un mineur ; semaine
//   validée), alertes à motiver (repos, durées, habilitation qui expire, formation, réserve d'aptitude neutre), créneaux
//   communiqués sous le délai de prévenance (motif des circonstances exceptionnelles, communiqué au salarié, jamais
//   journalisé) ; informations sans motif (étape 3 : conflits avec une mission ou une tâche Keystone, une session, une
//   astreinte ; postes sous la couverture minimale de l'équipe).
// - Créneau : ajout (poste nominatif ou à pourvoir), modification de l'horaire (repos compris), retrait d'un brouillon,
//   annulation d'un poste publié (motif communiqué au salarié).
// - Roulement : affectation d'un salarié à un cycle (groupe, période), fin d'une affectation (motif jamais journalisé).
// - Échange : le salarié propose à un collègue de son équipe de lui céder son poste, ou de l'échanger contre un poste publié
//   du collègue (visible seulement si le réglage `planningCollegues` l'ouvre) ; le valideur le valide, contrôles recalculés.
// - Reprise : équipes par quart reprises en groupes d'un cycle (shared/rules/planning-reprise.ts).
import { useMemo, useState } from 'react';
import { addD, mondayOf } from '../../../shared/dates.ts';
import { fmtIso } from '../../../shared/format.ts';
import { cycleDe, cyclesEnVigueur, horaireDuCycle } from '../../../shared/rules/cycles.ts';
import { horairesEnVigueur, horaireTexte } from '../../../shared/rules/horaires.ts';
import { apercuEchange, apercuPublication } from '../../../shared/rules/planning-apercu.ts';
import { creneauCouvertureTexte } from '../../../shared/rules/couverture-creneaux.ts';
import { controlerRoulement, debutCreneau, fenetrePlanning, MOTIF_PLANNING_MAX, refusHorizon, refusPeriode, SEMAINES_A_VENIR, SEMAINES_MAX } from '../../../shared/rules/planning.ts';
import { type AlertePlanning, instantParis } from '../../../shared/rules/planning-controles.ts';
import { equipesParQuart, proposerReprise } from '../../../shared/rules/planning-reprise.ts';
import type { ISODate } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { jourCourt, jourLong, posteTexte } from '../components/planning/planning-vue.ts';
import type { Confirmation } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Texte d'une alerte, avec le salarié. */
const ligneAlerte = (nom: (id: number) => string, a: AlertePlanning) => `${nom(a.empId)} — ${a.texte}`;

/** Zone de motif (circonstances exceptionnelles, alertes, annulation). */
function Motif({ id, label, valeur, onChange, requis, erreur, aide, placeholder }: {
  id: string; label: string; valeur: string; onChange: (v: string) => void; requis: boolean; erreur: string | null; aide: string; placeholder: string;
}) {
  return (
    <Field label={<>{label}{!requis && <span className="who">{t(' · optional')}</span>}</>} htmlFor={id} requis={requis} erreur={erreur}>
      <textarea className="input short" id={id} rows={2} maxLength={MOTIF_PLANNING_MAX + 20} value={valeur} placeholder={placeholder} onChange={e => onChange(e.target.value)} style={{ resize: 'vertical' }} />
      <span className="text-muted sub">{aide}</span>
    </Field>
  );
}

/** Erreur d'un motif saisi : vide alors qu'il est exigé, ou trop long. */
const erreurMotif = (v: string, requis: boolean, vide: string) => (requis && !v.trim() ? vide : v.trim().length > MOTIF_PLANNING_MAX ? t(`${MOTIF_PLANNING_MAX} characters at most.`) : null);

/** Refus du serveur qui exige le motif des circonstances exceptionnelles (délai de prévenance). */
export const motifExige = (erreur: string | null | undefined) => !!erreur && /délai de prévenance/.test(erreur) && /circonstances exceptionnelles/.test(erreur);
/** Refus du serveur qui exige le motif des alertes acceptées. */
export const alertesExigees = (erreur: string | null | undefined) => !!erreur && /alertes à motiver/.test(erreur);

// — Générer —

export function PlanningGenererDialog({ equipe, du: duPropose }: { equipe: string; du?: ISODate | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const lundi = mondayOf(addD(d.ti, 7));
  const [du, setDu] = useState(duPropose && duPropose >= d.ti ? duPropose : lundi);
  const [au, setAu] = useState(addD(duPropose && duPropose >= d.ti ? duPropose : lundi, 27));
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const refus = DATE.test(du) && DATE.test(au) ? refusPeriode(du, au) ?? refusHorizon(au, d.ti) : t('Enter the first and the last day.');
  const passe = !refus && au < d.ti ? t('Past period: a past day is corrected on the timesheet.') : null;
  const max = fenetrePlanning(d.ti).au;
  const affectes = (d.ds.roulements ?? []).filter(r => r.equipe === equipe && r.du <= au && (!r.au || r.au >= du) && !(r.au && r.au < r.du));
  const envoyer = async () => {
    if (busy || !v.verifier(refus, passe)) return;
    setBusy(true);
    const r = await run('planning.generer', { equipe, du, au });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={`${t('Generate the schedule — ')}${equipe}`} width={520} onSubmit={envoyer} actions={<><CancelButton /><SubmitButton busy={busy}>{t('Generate as draft')}</SubmitButton></>}>
      <div className="grid-2">
        <Field label={t('First day')} htmlFor="gen-du" requis erreur={v.erreur(refus && !DATE.test(du) ? refus : null)}>
          <input className="input" id="gen-du" type="date" value={du} min={d.ti} max={max} onChange={e => setDu(e.target.value)} />
        </Field>
        <Field label={t('Last day')} htmlFor="gen-au" requis erreur={v.erreur((DATE.test(du) && refus) || passe)}>
          <input className="input" id="gen-au" type="date" value={au} min={du || undefined} max={max} onChange={e => setAu(e.target.value)} />
        </Field>
      </div>
      <Fine muted={false}>
        {affectes.length
          ? `${tn(new Set(affectes.map(r => r.empId)).size, 'employee assigned', 'employees assigned')}${t(' to the rotation of the team over the period.')}`
          : t('No employee of the team is assigned to a cycle over this period: assign them first (Rotation assignments).')}
      </Fine>
      <Fine>
        {SEMAINES_MAX}{t(' weeks at most, from today and until ')}{fmtIso(max)} ({SEMAINES_A_VENIR}{t(' weeks to come). The slots are created as drafts, from the cycle and the group of each one; a public holiday not worked becomes a rest day, unless the team has a derogation from Sunday rest. A slot published or corrected by hand is never replaced. Nothing is communicated before the publication.')}
      </Fine>
    </Dialog>
  );
}

// — Publier —

export function PlanningPublierDialog({ equipe, du, au }: { equipe: string; du: ISODate; au: ISODate }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [debut, setDebut] = useState(du < d.ti ? d.ti : du);
  const [fin, setFin] = useState(au);
  const [motif, setMotif] = useState('');
  const [motifAlertes, setMotifAlertes] = useState('');
  // Motifs exigés par le serveur alors que l'aperçu ne voit ni alerte ni délai court (instantané en retard sur la base) :
  // le champ s'affiche quand même, pour que le planificateur puisse le saisir.
  const [exiges, setExiges] = useState({ motif: false, alertes: false });
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const refus = DATE.test(debut) && DATE.test(fin) ? refusPeriode(debut, fin) ?? refusHorizon(fin, d.ti) : t('Enter the first and the last day.');
  const a = useMemo(() => (refus ? null : apercuPublication(d, equipe, debut, fin)), [d, equipe, debut, fin, refus]);
  const nom = (id: number) => d.personName(id);
  const vide = !!a && !a.brouillons.length ? t('No draft to publish over this period: generate the schedule or edit a slot first.') : null;
  const bloque = a && (a.verrou.length || a.alertes.refus.length) ? t('Publication impossible: first correct the refusals above.') : null;
  const avecMotif = !!a && (a.horsDelai.length > 0 || exiges.motif), avecAlertes = !!a && (a.alertes.alertes.length > 0 || exiges.alertes);
  const eMotif = a ? erreurMotif(motif, avecMotif, t('Enter the exceptional circumstances that justify the short notice.')) : null;
  const eAlertes = a ? erreurMotif(motifAlertes, avecAlertes, t('Enter why the schedule is published despite the alerts.')) : null;
  const envoyer = async () => {
    if (busy || !v.verifier(refus, vide, bloque, eMotif, eAlertes)) return;
    setBusy(true);
    const r = await run('planning.publier', { equipe, du: debut, au: fin, motif: motif.trim(), motifAlertes: motifAlertes.trim() });
    setBusy(false);
    if (r.ok) closeDialog();
    else setExiges(x => ({ motif: x.motif || motifExige(r.error), alertes: x.alertes || alertesExigees(r.error) }));
  };
  return (
    <Dialog title={`${t('Publish the schedule — ')}${equipe}`} width={640} tall onSubmit={envoyer} actions={<><CancelButton /><SubmitButton busy={busy}>{t('Publish')}</SubmitButton></>}>
      <div className="grid-2">
        <Field label={t('First day')} htmlFor="pub-du" requis erreur={v.erreur(!DATE.test(debut) ? refus : null)}>
          <input className="input" id="pub-du" type="date" value={debut} min={d.ti} onChange={e => setDebut(e.target.value)} />
        </Field>
        <Field label={t('Last day')} htmlFor="pub-au" requis erreur={v.erreur(DATE.test(debut) ? refus : null)}>
          <input className="input" id="pub-au" type="date" value={fin} min={debut || undefined} onChange={e => setFin(e.target.value)} />
        </Field>
      </div>
      {a && <>
        <Fine muted={false}>
          {a.brouillons.length
            ? `${tn(a.brouillons.length, 'slot to publish', 'slots to publish')}${t(' for ')}${tn(a.salaries.length, 'employee#salarie', 'employees#salarie')}${a.brouillons.some(c => c.empId == null) ? t(' (shifts to fill included)') : ''}${t(': each one receives an e-mail at once, and a notification if they chose it.')}`
            : t('No draft over this period.')}
        </Fine>
        {(a.verrou.length > 0 || a.alertes.refus.length > 0) && (
          <div role="group" aria-label={t('Refusals')}>
            <Controles msgs={[...a.verrou, ...a.alertes.refus.map(x => ligneAlerte(nom, x))].map(text => ({ text, bad: true }))} />
          </div>
        )}
        {avecMotif && <>
          {a.horsDelai.length > 0 && (
            <Fine muted={false}>
              {tn(a.horsDelai.length, 'slot communicated', 'slots communicated')}{t(' less than ')}{a.delai}{t(' days before their date (from ')}{fmtIso(a.horsDelai[0].jour)}{t('): notice period not met.')}
            </Fine>
          )}
          <Motif id="pub-motif" label={t('Exceptional circumstances')} valeur={motif} onChange={setMotif} requis erreur={v.erreur(eMotif)}
            aide={t('Communicated to the employees concerned in the e-mail; kept on the slot, never copied to the log. Do not enter any medical information.')}
            placeholder={t('Replacement of an absent employee, breakdown of a line…')} />
        </>}
        {avecAlertes && <>
          <div role="group" aria-label={t('Alerts to justify')}>
            <Controles msgs={a.alertes.alertes.slice(0, 12).map(x => ({ text: ligneAlerte(nom, x), bad: false }))} />
            {a.alertes.alertes.length > 12 && <Fine>{t('And ')}{tn(a.alertes.alertes.length - 12, 'other', 'others')}.</Fine>}
          </div>
          <Motif id="pub-alertes" label={t('Reason for the accepted alerts')} valeur={motifAlertes} onChange={setMotifAlertes} requis erreur={v.erreur(eAlertes)}
            aide={t('Kept on the slots concerned, seen by the planner and HR only; never copied to the log (only the number of alerts is).')}
            placeholder={t('Compensatory rest granted, refresher planned next week…')} />
        </>}
        {a.alertes.infos.length > 0 && <Controles msgs={a.alertes.infos.slice(0, 12).map(x => ({ text: ligneAlerte(nom, x), bad: false }))} />}
        {a.alertes.infos.length > 12 && <Fine>{t('And ')}{tn(a.alertes.infos.length - 12, 'other piece of information', 'other pieces of information')}.</Fine>}
        {/* lot 12 — C5 étape 3 : couverture minimale par créneau après la publication, en information. */}
        {a.couverture.length > 0 && (
          <div role="group" aria-label={t('Minimum cover by shift')}>
            <Controles msgs={a.couverture.slice(0, 8).map(x => ({ text: `${t('Cover ')}${jourCourt(x.jour)} — ${creneauCouvertureTexte(x, f => d.fm(f)?.court ?? f)}${t(': under the minimum')}`, bad: false }))} />
            {a.couverture.length > 8 && <Fine>{t('And ')}{tn(a.couverture.length - 8, 'other shift', 'other shifts')}{t(' under the minimum.')}</Fine>}
          </div>
        )}
        {v.tente && (vide || bloque) && <Bloquant>{vide ?? bloque}</Bloquant>}
      </>}
      <Fine>
        {t('Notice period of ')}{a?.delai ?? 7}{t(' days, counted from the e-mail sent today (never from the notification on the phone, delayed at night and at the weekend). A week whose timesheet is approved is never published. Preview calculated on your screen: Cursus does every check again on sending.')}
      </Fine>
    </Dialog>
  );
}

// — Créneau —

/** Annulation d'un poste publié : motif communiqué au salarié, jamais journalisé. */
export const annulationCreneau = (id: number, qui: string, jour: ISODate): Confirmation => ({
  titre: t('Cancel the shift'), question: `${t('Cancel the shift of ')}${fmtIso(jour)} (${qui})${t('?#question')}`, bouton: t('Cancel the shift'), action: 'planning.creneau.annuler', payload: { id },
  suites: [t('The employee is told at once by e-mail, with the reason.'), t('The shift stays in the register of published versions (labour inspection).')],
  motif: { label: t('Reason for the cancellation'), requis: true, aide: `${t('Communicated to ')}${qui}${t('; never copied to the log. Do not enter any medical information.')}`, placeholder: t('Line stopped, reorganisation…') },
});

export function PlanningCreneauDialog({ equipe, jour, empId, id }: { equipe: string; jour: ISODate; empId: number | null; id?: number | null }) {
  const d = useDomain();
  const { run, closeDialog, openDialog } = useStore();
  const tous = [...d.ds.creneaux ?? [], ...d.ds.creneauxAPourvoir ?? []];
  const [c] = useState(() => (id != null ? tous.find(x => x.id === id) ?? null : null));
  // Créneau publié qui a déjà une modification en brouillon : c'est elle qu'on corrige.
  const enCours = c && c.statut === 'publie' ? tous.find(x => x.remplaceId === c.id && x.statut === 'brouillon') ?? null : null;
  const [horaire, setHoraire] = useState((enCours ?? c)?.horaire ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const qui = empId != null ? d.personName(empId) : t('shift to fill');
  const horaires = horairesEnVigueur(d.ds.referentiels);
  const disparu = id != null && !c;
  const passe = jour < d.ti;
  // Jour au-delà des 12 semaines à venir : aucun poste ne s'y ajoute (le serveur le refuse aussi).
  const loin = !c && !passe ? refusHorizon(jour, d.ti) : null;
  const eHoraire = !horaire && (empId == null || !c) ? t('Choose the schedule of the shift.') : null;
  const envoyer = async () => {
    if (busy || !v.verifier(eHoraire, disparu, passe ? t('Past day: it is corrected on the timesheet.') : null, loin)) return;
    setBusy(true);
    const r = c ? await run('planning.creneau.modifier', { id: c.id, horaire }) : await run('planning.creneau.ajouter', { equipe, jour, horaire, ...(empId != null ? { empId } : {}) });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  const retirer = async () => {
    if (!c || busy) return;
    setBusy(true);
    const r = await run('planning.creneau.annuler', { id: c.id });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={c ? `${t('Shift of ')}${jourCourt(jour)} — ${qui}` : `${t('Add a shift — ')}${qui}`} width={520} onSubmit={envoyer}
      actions={disparu || passe || loin ? <CancelButton label={t('Close')} /> : <><CancelButton /><SubmitButton busy={busy}>{t(c ? 'Save' : 'Add as draft')}</SubmitButton></>}>
      {disparu ? <Bloquant>{t('This slot no longer exists.')}</Bloquant> : <>
        <Static>{jourLong(jour)} · {t('team ')}{equipe}</Static>
        {c && <Fine muted={false}>{c.statut === 'publie' ? `${t('Published (version ')}${c.version ?? 1})${t(': ')}${posteTexte(c)}.` : `${t('Draft: ')}${posteTexte(c)}.`}{enCours ? `${t(' Change to publish: ')}${posteTexte(enCours)}.` : ''}</Fine>}
        {passe ? <Fine muted={false}>{t('Past day: the shift actually held is declared and corrected on the timesheet.')}</Fine> : loin ? <Fine muted={false}>{loin}.</Fine> : <>
          <Field label={t('Schedule#shift')} htmlFor="cren-horaire" requis={empId == null || !c} erreur={v.erreur(eHoraire)}>
            <select className="input" id="cren-horaire" value={horaire} onChange={e => setHoraire(e.target.value)} autoFocus>
              <option value="">{t(empId != null && c ? 'Rest' : 'Choose…')}</option>
              {horaires.map(h => <option key={h.code} value={h.code}>{horaireTexte(h)}</option>)}
            </select>
          </Field>
          {c?.statut === 'publie' && <Fine>{t('A published shift does not change at once: the new version is a draft, communicated at its publication (notice period, or reason).')}</Fine>}
          {c && (
            <div className="actions-end">
              {c.statut === 'brouillon'
                ? <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { void retirer(); }}>{t('Withdraw the draft')}</button>
                : <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => openDialog({ type: 'confirmer', c: annulationCreneau(c.id, qui, jour) })}>{t('Cancel the published shift…')}</button>}
            </div>
          )}
        </>}
      </>}
    </Dialog>
  );
}

// — Roulement —

export function PlanningRoulementDialog({ equipe, empId, id }: { equipe: string; empId?: number | null; id?: number | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const existant = id != null ? (d.ds.roulements ?? []).find(r => r.id === id) ?? null : null;
  const membres = d.ds.employes.filter(e => e.equipe === equipe && (!e.fin || e.fin >= d.ti)).sort((a, b) => a.nom.localeCompare(b.nom));
  const [sel, setSel] = useState<number | null>(existant?.empId ?? empId ?? null);
  const cycles = cyclesEnVigueur(d.ds.cycles);
  const [cycle, setCycle] = useState(existant?.cycle ?? cycles[0]?.code ?? '');
  const [groupe, setGroupe] = useState(existant?.groupe ?? cycleDe(d.ds.cycles, cycles[0]?.code)?.groupes[0]?.code ?? '');
  const [du, setDu] = useState(existant?.du ?? mondayOf(addD(d.ti, 7)));
  const [au, setAu] = useState(existant?.au ?? '');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (id != null && !existant) return <Dialog title={t('Rotation assignment')} width={460} actions={<CancelButton label={t('Close')} />}><Bloquant>{t('This assignment no longer exists.')}</Bloquant></Dialog>;
  const emp = sel != null ? d.emp(sel) : undefined;
  const c = cycleDe(d.ds.cycles, cycle);
  if (existant) {
    const eAu = !DATE.test(au) ? t('Enter the last day of the assignment.') : au < addD(existant.du, -1) ? t('At the earliest the day before the start (assignment cancelled).') : existant.au && au > existant.au ? `${t('The assignment already ends on ')}${fmtIso(existant.au)}.` : null;
    const terminer = async () => {
      if (busy || !v.verifier(eAu, erreurMotif(motif, false, ''))) return;
      setBusy(true);
      const r = await run('planning.roulement.terminer', { id: existant.id, au, motif: motif.trim() });
      setBusy(false);
      if (r.ok) closeDialog();
    };
    return (
      <Dialog title={`${t('End the assignment — ')}${d.personName(existant.empId)}`} width={520} onSubmit={terminer} actions={<><CancelButton /><SubmitButton busy={busy}>{t('End the assignment')}</SubmitButton></>}>
        <Static>{t('Cycle ')}{existant.cycle}{t(', group ')}{existant.groupe}{t(', since ')}{fmtIso(existant.du)}{existant.au ? `${t(' until ')}${fmtIso(existant.au)}` : ''}</Static>
        <Field label={t('Last day')} htmlFor="rou-fin" requis erreur={v.erreur(eAu)}>
          <input className="input" id="rou-fin" type="date" value={au} onChange={e => setAu(e.target.value)} autoFocus />
        </Field>
        <Motif id="rou-motif" label={t('Reason')} valeur={motif} onChange={setMotif} requis={false} erreur={v.erreur(erreurMotif(motif, false, ''))}
          aide={t('Seen by the planner and HR; never copied to the log.')} placeholder={t('Change of job, move to day work…')} />
        <Fine>{t('The slots already generated after this date remain to be corrected on the grid.')}</Fine>
      </Dialog>
    );
  }
  const r = emp ? controlerRoulement({ cycle, groupe, du, au }, emp, d.ds.cycles ?? [], d.ds.roulements ?? []) : null;
  const eEmp = !emp ? t('Choose the employee.#salarie') : null;
  const e = r?.erreurs ?? {};
  const envoyer = async () => {
    if (busy || !v.verifier(eEmp, e.cycle, e.groupe, e.du, e.au, e.general)) return;
    setBusy(true);
    const x = await run('planning.roulement.affecter', { empId: sel, cycle, groupe, du, au: au || null });
    setBusy(false);
    if (x.ok) closeDialog();
  };
  const apercu = c && groupe && DATE.test(du) ? Array.from({ length: 7 }, (_, i) => addD(du, i)).map(j => `${jourCourt(j)} ${horaireDuCycle(c, groupe, j) ?? t('rest#lower')}`).join(' · ') : null;
  return (
    <Dialog title={`${t('Assign to the rotation — ')}${equipe}`} width={560} onSubmit={envoyer} actions={<><CancelButton /><SubmitButton busy={busy}>{t('Assign')}</SubmitButton></>}>
      <Field label={t('Employee#salarie')} htmlFor="rou-emp" requis erreur={v.erreur(eEmp)}>
        <select className="input" id="rou-emp" value={sel ?? ''} onChange={x => setSel(x.target.value ? Number(x.target.value) : null)} autoFocus>
          <option value="">{t('Choose…')}</option>
          {membres.map(m => <option key={m.id} value={m.id}>{m.nom}</option>)}
        </select>
      </Field>
      <div className="grid-2">
        <Field label={t('Cycle')} htmlFor="rou-cycle" requis erreur={v.erreur(e.cycle)}>
          <select className="input" id="rou-cycle" value={cycle} onChange={x => { setCycle(x.target.value); setGroupe(cycleDe(d.ds.cycles, x.target.value)?.groupes[0]?.code ?? ''); }}>
            {cycles.map(y => <option key={y.code} value={y.code}>{y.code} · {y.nom}</option>)}
          </select>
        </Field>
        <Field label={t('Group')} htmlFor="rou-groupe" requis erreur={v.erreur(e.groupe)}>
          <select className="input" id="rou-groupe" value={groupe} onChange={x => setGroupe(x.target.value)}>
            {(c?.groupes ?? []).map(g => <option key={g.code} value={g.code}>{g.code}{t(' (offset ')}{g.decalage}{t(' d)')}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid-2">
        <Field label={t('From#starting')} htmlFor="rou-du" requis erreur={v.erreur(e.du)}>
          <input className="input" id="rou-du" type="date" value={du} onChange={x => setDu(x.target.value)} />
        </Field>
        <Field label={<>{t('Until')}<span className="who">{t(' · optional')}</span></>} htmlFor="rou-au" erreur={v.erreur(e.au)}>
          <input className="input" id="rou-au" type="date" value={au} min={du || undefined} onChange={x => setAu(x.target.value)} />
        </Field>
      </div>
      {apercu && <Fine muted={false}>{t('First week: ')}{apercu}.</Fine>}
      {v.tente && e.general && <Bloquant>{e.general}</Bloquant>}
      <Fine>{t('The line team does not change. The slots are then generated as drafts (Generate), then published.')}</Fine>
    </Dialog>
  );
}

// — Échanges —

/** Instant présent, en minutes réelles à l'heure de Paris (expiration d'un échange ; « Échanger… » de Mon planning). */
export const maintenant = (ti: ISODate) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return instantParis(ti, `${p.hour}:${p.minute}`);
};

export function PlanningEchangeDialog({ creneauId }: { creneauId: number }) {
  const d = useDomain();
  const { me } = useRole();
  const { run, closeDialog } = useStore();
  const a = (d.ds.creneaux ?? []).find(c => c.id === creneauId && c.empId === me && c.statut === 'publie') ?? null;
  const collegues = d.ds.annuaire.filter(p => a && p.equipe === a.equipe && p.id !== me).sort((x, y) => x.nom.localeCompare(y.nom));
  const [partenaire, setPartenaire] = useState<number | null>(null);
  const [contre, setContre] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const leurs = (d.ds.creneaux ?? []).filter(c => c.empId === partenaire && c.statut === 'publie' && c.horaire && c.jour >= d.ti).sort((x, y) => x.jour.localeCompare(y.jour));
  const commence = a ? debutCreneau(a) <= maintenant(d.ti) : false;
  const ePartenaire = !partenaire ? t('Choose the colleague.') : null;
  const envoyer = async () => {
    if (busy || !v.verifier(!a ? t('Shift not found.') : null, commence ? t('Shift started or past: it can no longer be swapped.') : null, ePartenaire)) return;
    setBusy(true);
    const r = await run('planning.echange.proposer', { creneauId, partenaireId: partenaire, ...(contre ? { creneauPartenaire: contre } : {}) });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={t('Propose a shift swap')} width={520} onSubmit={envoyer}
      actions={!a || commence ? <CancelButton label={t('Close')} /> : <><CancelButton /><SubmitButton busy={busy}>{t('Propose the swap')}</SubmitButton></>}>
      {!a ? <Bloquant>{t('This shift is no longer published.')}</Bloquant> : commence ? <Bloquant>{t('Shift started or past: it can no longer be swapped.')}</Bloquant> : <>
        <Static>{t('Your shift of ')}{jourLong(a.jour)}{t(': ')}{posteTexte(a)}</Static>
        <Field label={t('Colleague')} htmlFor="ech-collegue" requis erreur={v.erreur(ePartenaire)}>
          <select className="input" id="ech-collegue" value={partenaire ?? ''} onChange={e => { setPartenaire(e.target.value ? Number(e.target.value) : null); setContre(null); }} autoFocus>
            <option value="">{t('Choose…')}</option>
            {collegues.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
          </select>
        </Field>
        {partenaire != null && (leurs.length
          ? (
            <Field label={t('In exchange for')} htmlFor="ech-contre">
              <select className="input" id="ech-contre" value={contre ?? ''} onChange={e => setContre(e.target.value ? Number(e.target.value) : null)}>
                <option value="">{t('Nothing: I give them my shift')}</option>
                {leurs.map(c => <option key={c.id} value={c.id}>{jourCourt(c.jour)} · {posteTexte(c)}</option>)}
              </select>
            </Field>
          )
          : <Fine muted={false}>{t('You offer them to take over your shift (handover). For a swap against one of their shifts, see it with them: they can propose it to you in turn.')}</Fine>)}
        <Fine>{t('Your colleague accepts or refuses, then your manager approves: the rest and the authorisations of each one are checked at the approval. The swap expires if one of the shifts starts before.')}</Fine>
      </>}
    </Dialog>
  );
}

/** Refus d'un échange : motif facultatif, montré aux deux salariés. */
export const refusEchange = (id: number, noms: string): Confirmation => ({
  titre: t('Refuse the swap'), question: `${t('Refuse the shift swap (')}${noms})${t('?#question')}`, bouton: t('Refuse'), action: 'planning.echange.refuser', payload: { id },
  suites: [t('Each one is told; the shifts stay as published.')],
  motif: { label: t('Reason'), requis: false, aide: t('Shown to the employees concerned; never copied to the log. Do not enter any medical information.'), placeholder: t('Headcount of the night shift insufficient…') },
});

export function PlanningEchangeValiderDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog, openDialog } = useStore();
  const e = (d.ds.echangesPoste ?? []).find(x => x.id === id) ?? null;
  const a = useMemo(() => (e ? apercuEchange(d, e) : null), [d, e]);
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!e || e.statut !== 'accepte') return <Dialog title={t('Shift swap')} width={460} actions={<CancelButton label={t('Close')} />}><Bloquant>{t('This swap is no longer to approve.')}</Bloquant></Dialog>;
  const nom = (i: number) => d.personName(i);
  const creneaux = d.ds.creneaux ?? [];
  const ca = creneaux.find(c => c.id === e.creneauDemandeur), cb = e.creneauPartenaire ? creneaux.find(c => c.id === e.creneauPartenaire) : null;
  const eMotif = a ? erreurMotif(motif, a.alertes.alertes.length > 0, t('Enter why the swap is approved despite the alerts.')) : null;
  // Poste modifié ou annulé depuis : le serveur annule l'échange (envoi permis) ; tout autre refus bloque.
  const bloque = a?.alertes.refus.length ? t('Approval impossible: one of the employees falls into a refusal.')
    : a?.refus && !/modifié ou annulé/.test(a.refus) ? `${t('Approval impossible: ')}${a.refus}.` : null;
  const envoyer = async () => {
    if (busy || !v.verifier(eMotif, bloque)) return;
    setBusy(true);
    const r = await run('planning.echange.valider', { id, motifAlertes: motif.trim() });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={t('Approve the shift swap')} width={600} onSubmit={envoyer} actions={<>
      <button type="button" className="btn btn-secondary" onClick={() => openDialog({ type: 'confirmer', c: refusEchange(id, `${nom(e.demandeurId)}${t(' and #et')}${nom(e.partenaireId)}`) })}>{t('Refuse…')}</button>
      <SubmitButton busy={busy}>{t('Approve the swap')}</SubmitButton>
    </>}>
      <Static>
        {nom(e.demandeurId)} {cb ? `${t('swaps their shift of ')}${ca ? `${jourCourt(ca.jour)} (${posteTexte(ca)})` : '?'}${t(' for that of ')}${nom(e.partenaireId)}${t(' of #date')}${jourCourt(cb.jour)} (${posteTexte(cb)})`
          : `${t('gives their shift of ')}${ca ? `${jourCourt(ca.jour)} (${posteTexte(ca)})` : '?'}${t(' to#person')}${nom(e.partenaireId)}`}{t('; accepted by ')}{nom(e.partenaireId)}.
      </Static>
      {a?.refus && <Fine muted={false}>{a.refus}</Fine>}
      {a && a.alertes.refus.length > 0 && <Controles msgs={a.alertes.refus.map(x => ({ text: ligneAlerte(nom, x), bad: true }))} />}
      {a && a.alertes.alertes.length > 0 && <>
        <Controles msgs={a.alertes.alertes.map(x => ({ text: ligneAlerte(nom, x), bad: false }))} />
        <Motif id="val-motif" label={t('Reason for the accepted alerts')} valeur={motif} onChange={setMotif} requis erreur={v.erreur(eMotif)}
          aide={t('Kept on the new slots, seen by the planner and HR only; never copied to the log.')} placeholder={t('Compensatory rest granted…')} />
      </>}
      {a && !a.refus && !a.alertes.refus.length && !a.alertes.alertes.length && <Fine muted={false}>{t('No alert: rest, durations and authorisations respected for both employees.')}</Fine>}
      {/* lot 12 — C5 étape 3 : informations (conflits avec une mission, une session, une astreinte ; moyennes), sans motif,
          plafonnées comme dans Publier pour garder le motif et les boutons à portée sur téléphone. */}
      {a && !a.refus && a.alertes.infos.length > 0 && <Controles msgs={a.alertes.infos.slice(0, 12).map(x => ({ text: ligneAlerte(nom, x), bad: false }))} />}
      {a && !a.refus && a.alertes.infos.length > 12 && <Fine>{t('And ')}{tn(a.alertes.infos.length - 12, 'other piece of information', 'other pieces of information')}.</Fine>}
      {v.tente && bloque && <Bloquant>{bloque}</Bloquant>}
      <Fine>{t('No new notice period: the swap comes from those concerned. Each one is told about the decision.')}</Fine>
    </Dialog>
  );
}

// — Reprise des équipes par quart —

export function PlanningRepriseDialog() {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const { soi } = useRole();
  const detectees = equipesParQuart(d.ds.referentiels.equipes);
  const cycles = cyclesEnVigueur(d.ds.cycles);
  const [noms, setNoms] = useState<string[]>(detectees[0]?.equipes ?? []);
  const [cycle, setCycle] = useState(cycles.find(c => c.groupes.length >= (detectees[0]?.equipes.length ?? 1))?.code ?? cycles[0]?.code ?? '');
  const [du, setDu] = useState(mondayOf(addD(d.ti, 7)));
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const r = DATE.test(du) ? proposerReprise({
    code: cycle, du, noms, equipes: d.ds.referentiels.equipes, cycles: d.ds.cycles ?? [], roulements: d.ds.roulements ?? [], employes: d.ds.employes, exclus: new Set(soi ? [soi] : []),
  }) : null;
  const eDu = !DATE.test(du) ? t('Enter the first day.') : null;
  const envoyer = async () => {
    if (busy || !v.verifier(eDu, r?.erreur, r && !r.lignes.length ? t('No employee to assign.') : null)) return;
    setBusy(true);
    const x = await run('planning.reprise', { cycle, du, equipes: noms });
    setBusy(false);
    if (x.ok) closeDialog();
  };
  const c = cycleDe(d.ds.cycles, cycle);
  return (
    <Dialog title={t('Take over the teams by shift')} width={600} onSubmit={envoyer} actions={<><CancelButton /><SubmitButton busy={busy}>{t('Assign to the cycle')}</SubmitButton></>}>
      <Fine muted={false}>
        {detectees.length
          ? `${t('Teams by shift found (under the same team, each with its schedule): ')}${detectees.map(x => `${x.parente} (${x.equipes.join(', ')})`).join(t('; '))}.`
          : t('No team by shift found (sister teams each with a default schedule): choose the teams to take over.')}
      </Fine>
      <Field label={t('Teams, in the order of the groups')} requis erreur={v.erreur(r?.erreur && /équipe/i.test(r.erreur) ? r.erreur : null)}>
        <div className="chips" role="group" aria-label={t('Teams to take over')} style={{ gap: 'var(--space-2) var(--space-4)' }}>
          {d.ds.referentiels.equipes.map(q => (
            <label key={q.nom} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={noms.includes(q.nom)} onChange={e => setNoms(e.target.checked ? [...noms, q.nom] : noms.filter(n => n !== q.nom))} style={{ accentColor: 'var(--color-accent)' }} />
              {q.nom}{q.horaire ? <span className="text-muted"> · {q.horaire}</span> : null}
            </label>
          ))}
        </div>
      </Field>
      <div className="grid-2">
        <Field label={t('Cycle')} htmlFor="rep-cycle" requis erreur={v.erreur(r?.erreur && /cycle/i.test(r.erreur) ? r.erreur : null)}>
          <select className="input" id="rep-cycle" value={cycle} onChange={e => setCycle(e.target.value)}>
            {cycles.map(y => <option key={y.code} value={y.code}>{y.code} · {y.nom} ({tn(y.groupes.length, 'group', 'groups')})</option>)}
          </select>
        </Field>
        <Field label={t('From#starting')} htmlFor="rep-du" requis erreur={v.erreur(eDu)}>
          <input className="input" id="rep-du" type="date" value={du} onChange={e => setDu(e.target.value)} />
        </Field>
      </div>
      {r && !r.erreur && c && (
        <Fine muted={false}>
          {d.ds.referentiels.equipes.filter(q => noms.includes(q.nom)).sort((a, b) => a.ordre - b.ordre).map((q, i) => `${q.nom} → ${t('group ')}${c.groupes[i]?.code}`).join(' · ')}.
          {' '}{tn(r.lignes.length, 'employee to assign#salarie', 'employees to assign#salarie')}{r.ignores.length ? `, ${tn(r.ignores.length, 'left aside', 'left aside#plural')} (${r.ignores.map(x => `${d.personName(x.empId)}${t(': ')}${x.raison}`).join(t('; '))})` : ''}.
        </Fine>
      )}
      {v.tente && r && !r.erreur && !r.lignes.length && <Bloquant>{t('No employee to assign.')}</Bloquant>}
      <Fine>
        {t('The first team (in the order of the teams) takes the first group of the cycle, the second the second, and so on. The line team does not change. A takeover can be run again without duplicates: an employee already assigned over the period is left aside.')}
      </Fine>
    </Dialog>
  );
}
