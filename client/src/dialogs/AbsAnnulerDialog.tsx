// Retirer une demande ou annuler une absence, selon le statut et le rôle (`droitAnnulation`) :
// conséquences annoncées avant confirmation — solde recrédité, Keystone prévenu, feuilles validées inchangées,
// feuille soumise sans heure renvoyée si la semaine n'est plus couverte.
import { useState } from 'react';
import { ABS_LABEL } from '../../../shared/constants.ts';
import { addD } from '../../../shared/dates.ts';
import { Domain } from '../../../shared/domain.ts';
import { fH, fJ, fmtIso, num } from '../../../shared/format.ts';
import { droitAnnulation, estConge, natureDef, statutAbsence } from '../../../shared/rules/absences.ts';
import { periodeDemiTexte } from '../../../shared/rules/demi-journees.ts';
import { semaineCouverte } from '../../../shared/rules/temps.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton } from '../components/Dialog.tsx';
import { Fine, NoteAccent } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { decideur } from '../state/delegues.ts';
import { t } from '../i18n/langue.ts';

export function AbsAnnulerDialog({ id }: { id: number }) {
  const d = useDomain();
  const { rh, manager, me, soi } = useRole();
  const { run, closeDialog } = useStore();
  const [busy, setBusy] = useState(false);
  const a = d.ds.absences.find(x => x.id === id);
  const emp = a ? d.emp(a.empId) : undefined;
  if (!a || !emp) return null;

  // Un membre du RH annule ses propres absences comme intéressé (même règle que le serveur).
  const propre = rh && emp.id === soi;
  const droit = droitAnnulation(a, d.ti, { rh: rh && !propre, self: propre || (!rh && emp.id === me), manager: manager && decideur(d, emp, me, 'absences') });
  const n = estConge(a.type) ? d.countDays(emp, a.du, a.au, a.type, a) : 0;
  // Feuille soumise sans heure que l'absence couvrait seule : le serveur la renvoie au salarié.
  const sans = a.statut === 'demandee' ? null : new Domain({ ...d.ds, absences: d.ds.absences.filter(x => x.id !== a.id) });
  const renvoi = !!sans && d.ds.feuilles.some(sh => sh.empId === emp.id && sh.statut === 'soumise' && sh.week <= a.au && addD(sh.week, 4) >= a.du
    && !sh.lignes.some(l => l.h.some(h => num(h) > 0)) && !semaineCouverte(sans, emp, sh.week, sh));
  const suites = [
    n ? `${a.type === 'RECUP' ? fH(n * d.dayH(emp)) + t(' of time off in lieu') : `${fJ(n)}${t(' of #de')}${a.type}`}${t(n > 1 ? ' available again#plural' : ' available again')}${t(' on the balance.')}` : '',
    a.keystone ? t('Keystone is told: the period becomes available again for planning.') : '',
    d.ds.feuilles.some(sh => sh.empId === emp.id && sh.statut === 'validee' && sh.week <= a.au && addD(sh.week, 6) >= a.du)
      ? t('The timesheets already approved are not changed: hours worked those days remain to be adjusted.') : '',
    renvoi ? t('The timesheet submitted without hours for these days is sent back to the employee to enter the hours.') : '',
    rh && natureDef(a.type)?.reprise && emp.repriseDate ? t('The return date entered on the sheet is recalculated.') : '',
  ].filter(Boolean);

  const confirm = async () => {
    if (busy || !droit.ok) return;
    setBusy(true);
    const r = await run('absence.annuler', { id });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t(a.statut === 'demandee' ? 'Withdraw a request' : 'Cancel an absence')} width={520} onSubmit={confirm} actions={<>
      <CancelButton label={t('Close')} />
      {/* Annulation hors droits : la raison s'affiche, sans bouton qui ne mènerait à rien. */}
      {droit.ok && <SubmitButton busy={busy}>{droit.libelle}</SubmitButton>}
    </>}>
      <div className="grid-2">
        <Field label={t('Employee')}><Static>{emp.nom}</Static></Field>
        <Field label={t('Absence')}><Static>{ABS_LABEL[a.type]} · {statutAbsence(a).toLowerCase()}</Static></Field>
      </div>
      <div className="boxed text-muted sub">{periodeDemiTexte(a)}{a.signalePar ? `${t(' · reported on #fem')}${fmtIso(a.signaleLe!)}${t(' by ')}${a.signalePar}` : ''}</div>
      {!droit.ok && <NoteAccent>{droit.raison}</NoteAccent>}
      {droit.ok && suites.map(s => <Fine key={s} muted={false}>{s}</Fine>)}
      <Fine>{t('The absence stays visible as cancelled, with the date and the author of the cancellation.')}</Fine>
    </Dialog>
  );
}
