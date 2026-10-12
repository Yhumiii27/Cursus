// Retirer une demande ou annuler une absence, selon le statut et le rôle (`droitAnnulation`) :
// conséquences annoncées avant confirmation — solde recrédité, Keystone prévenu, feuilles validées inchangées.
import { useState } from 'react';
import { ABS_LABEL } from '../../../shared/constants.ts';
import { addD } from '../../../shared/dates.ts';
import { fH, fJ, fmtIso } from '../../../shared/format.ts';
import { droitAnnulation, estConge, natureDef, periodeTexte, statutAbsence } from '../../../shared/rules/absences.ts';
import { CancelButton, Dialog, Field, Static } from '../components/Dialog.tsx';
import { Fine, NoteAccent } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function AbsAnnulerDialog({ id }: { id: number }) {
  const d = useDomain();
  const { rh, manager, me } = useRole();
  const { run, closeDialog } = useStore();
  const [busy, setBusy] = useState(false);
  const a = d.ds.absences.find(x => x.id === id);
  const emp = a ? d.emp(a.empId) : undefined;
  if (!a || !emp) return null;

  const droit = droitAnnulation(a, d.ti, { rh, self: !rh && emp.id === me, manager: manager && emp.id !== me && d.mgrOf(emp) === me });
  const n = estConge(a.type) ? d.countDays(emp, a.du, a.au, a.type) : 0;
  const suites = [
    n ? `${a.type === 'RECUP' ? fH(n * d.dayH(emp)) + ' de récupération' : `${fJ(n)} de ${a.type}`} de nouveau disponible${n > 1 ? 's' : ''} sur le solde.` : '',
    a.keystone ? 'Keystone est prévenu : la période redevient disponible pour la planification.' : '',
    d.ds.feuilles.some(sh => sh.empId === emp.id && sh.statut === 'validee' && sh.week <= a.au && addD(sh.week, 4) >= a.du)
      ? 'Les feuilles de temps déjà validées ne sont pas modifiées : des heures travaillées ces jours-là restent à régulariser.' : '',
    rh && natureDef(a.type)?.reprise && emp.repriseDate ? 'La date de reprise inscrite sur la fiche est recalculée.' : '',
  ].filter(Boolean);

  const confirm = async () => {
    setBusy(true);
    const r = await run('absence.annuler', { id });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={a.statut === 'demandee' ? 'Retirer une demande' : 'Annuler une absence'} width={520} actions={<>
      <CancelButton label="Fermer" />
      <button type="button" className="btn btn-primary" disabled={!droit.ok || busy} onClick={confirm}>{droit.ok ? droit.libelle : 'Annuler'}</button>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{emp.nom}</Static></Field>
        <Field label="Absence"><Static>{ABS_LABEL[a.type]} · {statutAbsence(a).toLowerCase()}</Static></Field>
      </div>
      <div className="boxed text-muted sub">{periodeTexte(a.du, a.au)}{a.signalePar ? ` · signalée le ${fmtIso(a.signaleLe!)} par ${a.signalePar}` : ''}</div>
      {!droit.ok && <NoteAccent>{droit.raison}</NoteAccent>}
      {droit.ok && suites.map(s => <Fine key={s} muted={false}>{s}</Fine>)}
      <Fine>L’absence reste visible comme annulée, avec la date et l’auteur de l’annulation.</Fine>
    </Dialog>
  );
}
