// Sortie d'un salarié (service RH), pour tous les contrats, CDI compris : dernier jour du contrat et motif en liste
// fermée. Les contrôles et les effets sont ceux du serveur (`controleSortie` de shared/rules/contrats.ts) : ce qui bloque
// la sortie, ce qu'elle annule ou retire, ce qu'il reste à voir. Une sortie déjà enregistrée se modifie ici et s'annule
// depuis la fiche (« Annuler la sortie »). Solde de sortie (t128) : compteurs à la date, montrés avant la confirmation et
// photographiés à l'enregistrement pour la paie (shared/rules/solde-sortie.ts).
import { useState } from 'react';
import { ENT_TYPES } from '../../../shared/constants.ts';
import { isoWeek } from '../../../shared/dates.ts';
import { fmtIso } from '../../../shared/format.ts';
import { periodeTexte } from '../../../shared/rules/absences.ts';
import { controleSortie, finContrat, MOTIFS_SORTIE } from '../../../shared/rules/contrats.ts';
import { etatSortie, soldeCourant, transmisTexte } from '../../../shared/rules/solde-sortie.ts';
import { texteVisiteSortie } from '../../../shared/rules/visites-dues.ts';
import type { MotifSortie } from '../../../shared/types.ts';
import { erreurDate } from '../components/controles.ts';
import { EtatSortieTableau } from '../components/SoldeSortie.tsx';
import { CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, NoteAccent } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function SortieDialog({ empId }: { empId: number }) {
  const d = useDomain();
  const { rh } = useRole();
  const { run, closeDialog } = useStore();
  const emp = d.emp(empId);
  const prevue = emp ? finContrat(emp) : null;
  // Sortie déjà enregistrée : reprise telle quelle ; sinon la fin prévue au contrat et le motif qui la suit d'ordinaire.
  const [date, setDate] = useState(emp?.fin ?? '');
  const [motif, setMotif] = useState<MotifSortie | ''>(() => emp?.motifSortie
    ?? (emp?.typeContrat === 'cdd' ? 'fin_cdd' : emp?.typeContrat === 'interim' ? 'fin_mission' : ''));
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!emp || !rh) return null;

  const dateErr = erreurDate(date, t('Enter the last day of the contract.'));
  const motifErr = motif ? null : t('Choose the reason for departure.');
  const c = dateErr ? null : controleSortie(d, emp, date);
  // Effets, en détail : ce que la sortie annule ou retire (jamais la nature d'une absence).
  const sessionTexte = (id: number | null) => { const s = d.session(id); return s ? `${t('Session ')}${d.fm(s.formation)?.court ?? s.formation}${t(' of #du')}${fmtIso(s.date)}` : t('Session'); };
  const effets = !c ? [] : [
    ...c.absences.map(a => `${t(a.statut === 'demandee' ? 'Absence request' : 'Absence')} ${periodeTexte(a.du, a.au)}${t(': cancelled#fem')}${a.keystone ? t(', Keystone notified') : ''}`),
    ...c.certs.map(x => `${sessionTexte(x.sessionId)}${t(' (refresher): enrolment withdrawn, notice cancelled by e-mail if it was sent')}`),
    ...c.inscriptions.map(i => `${sessionTexte(i.sessionId)}${t(' (initial training): enrolment withdrawn, notice cancelled by e-mail if it was sent')}`),
    ...c.entretiens.map(x => `${ENT_TYPES[x.type].nom}${t(' of #du')}${fmtIso(x.date)}${t(': withdrawn#masc')}`),
    ...c.visites.map(x => `${t('Medical visit request of ')}${fmtIso(x.le)}${t(': cancelled (occupational health service to notify)')}`),
    ...(c.feuilles.length ? [`${t('Empty timesheets of the weeks ')}${c.feuilles.map(f => isoWeek(f.week)).join(', ')}${t(': withdrawn#fem-plural')}`] : []),
  ];
  const passee = !dateErr && date < d.ti;
  // Suivi renforcé ou exposition à des risques particuliers : visite de fin de carrière ou post-exposition, ou rappel.
  const visite = c && !c.bloquants.length ? texteVisiteSortie(d, emp, date, motif) : null;
  // Solde des compteurs à la date (sortie possible seulement) ; un solde déjà transmis à la paie n'est plus refait à la
  // même date, et il est remplacé à une autre date (écart à régulariser dans Sage).
  const etat = c && !c.bloquants.length ? etatSortie(d, emp, date) : null;
  const courant = soldeCourant(d.ds.soldesSortie, emp.id), transmis = courant?.sage ? courant : null;

  const confirm = async () => {
    if (busy || !v.verifier(dateErr, motifErr, c?.bloquants.length)) return;
    setBusy(true);
    const r = await run('employe.sortie', { id: emp.id, date, motif });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={`${t(emp.motifSortie ? 'Edit the departure' : 'Record the departure')} — ${emp.nom}`} width={600} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t(emp.motifSortie ? 'Save the change' : 'Record the departure')}</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label={t('Employee')}><Static>{emp.nom} · {emp.poste}</Static></Field>
        <Field label={t('Contract')}>
          <Static>{d.contratOf(emp).libelle}<div className="text-muted sub">{t('Started on ')}{fmtIso(emp.entree)}{prevue ? `${t(' · planned end on ')}${fmtIso(prevue)}` : ''}</div></Static>
        </Field>
        <Field label={t('Last day of the contract')} htmlFor="so-date" requis erreur={date ? dateErr : v.erreur(dateErr)}>
          <input className="input" id="so-date" type="date" autoFocus min={emp.entree} max={prevue ?? undefined} value={date} onChange={ev => setDate(ev.target.value)} />
          <span className="text-muted sub">{t('Notice included: end date of the employment contract')}</span>
        </Field>
        <Field label={t('Reason for departure')} htmlFor="so-motif" requis erreur={v.erreur(motifErr)}>
          {/* Liste fermée, sans texte libre. */}
          <select className="input" id="so-motif" value={motif} onChange={ev => setMotif(ev.target.value as MotifSortie | '')}>
            <option value="">{t('Choose…')}</option>
            {(Object.keys(MOTIFS_SORTIE) as MotifSortie[]).map(k => <option key={k} value={k}>{MOTIFS_SORTIE[k]}</option>)}
          </select>
        </Field>
      </div>
      {c && <Controles msgs={c.bloquants.map(text => ({ text, bad: true }))} />}
      {effets.length > 0 && <>
        <Fine>{t('Cancelled or withdrawn by the departure:')}</Fine>
        <Controles msgs={effets.map(text => ({ text, bad: false }))} />
      </>}
      {c?.avertissements.map(a => <NoteAccent key={a}>{a}</NoteAccent>)}
      {etat && <>
        <Fine>{t('Balance of the counters on ')}{fmtIso(date)}{t(', captured when recorded for payroll (the amount of the allowance is calculated by Sage):')}</Fine>
        <EtatSortieTableau etat={etat} />
        {etat.avertissements.map(a => <NoteAccent key={a}>{a}</NoteAccent>)}
        {transmis && (transmis.date === date
          ? <NoteAccent>{t('Departure balance already ')}{transmisTexte(transmis)}{t(': it is kept as is, a difference is corrected in Sage.')}</NoteAccent>
          : <NoteAccent>{t('Departure balance on ')}{fmtIso(transmis.date)}{t(' already ')}{transmisTexte(transmis)}{t(': it will be replaced by this new balance, and the old one is to regularise in Sage.')}</NoteAccent>)}
      </>}
      {visite && <NoteAccent>{visite}</NoteAccent>}
      <Fine>
        {t('After this date, ')}{emp.nom}{t(' no longer signs in to Cursus, no longer receives notifications and no longer has any timesheet or absence; ')}{emp.nom}{t(' leaves compliance, due dates and dashboards, and stays viewable with the “Left” filter of Employees. On the worksites where ')}{emp.nom}{t(' is assigned, Keystone receives “No Go CONTRAT”.')}
        {passee ? t(' Date in the past: the open sign-in sessions are closed at once.') : ''}
      </Fine>
      <Fine>
        {t('A departure entered by mistake is cancelled from the sheet')}{prevue ? `${t(': the end planned in the contract (')}${fmtIso(prevue)}${t(') is then restored')}` : ''}{t('. What the departure cancelled is not restored. The reason is passed only to HR (read-only included), to payroll and to the person concerned: the manager only sees the date.')}
      </Fine>
    </Dialog>
  );
}
