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
  const droit = droitAnnulation(a, d.ti, { rh: rh && !propre, self: propre || (!rh && emp.id === me), manager: manager && emp.id !== me && d.mgrOf(emp) === me });
  const n = estConge(a.type) ? d.countDays(emp, a.du, a.au, a.type, a) : 0;
  // Feuille soumise sans heure que l'absence couvrait seule : le serveur la renvoie au salarié.
  const sans = a.statut === 'demandee' ? null : new Domain({ ...d.ds, absences: d.ds.absences.filter(x => x.id !== a.id) });
  const renvoi = !!sans && d.ds.feuilles.some(sh => sh.empId === emp.id && sh.statut === 'soumise' && sh.week <= a.au && addD(sh.week, 4) >= a.du
    && !sh.lignes.some(l => l.h.some(h => num(h) > 0)) && !semaineCouverte(sans, emp, sh.week, sh));
  const suites = [
    n ? `${a.type === 'RECUP' ? fH(n * d.dayH(emp)) + ' de récupération' : `${fJ(n)} de ${a.type}`} de nouveau disponible${n > 1 ? 's' : ''} sur le solde.` : '',
    a.keystone ? 'Keystone est prévenu : la période redevient disponible pour la planification.' : '',
    d.ds.feuilles.some(sh => sh.empId === emp.id && sh.statut === 'validee' && sh.week <= a.au && addD(sh.week, 4) >= a.du)
      ? 'Les feuilles de temps déjà validées ne sont pas modifiées : des heures travaillées ces jours-là restent à régulariser.' : '',
    renvoi ? 'La feuille de temps soumise sans heure pour ces jours est renvoyée au salarié pour saisie des heures.' : '',
    rh && natureDef(a.type)?.reprise && emp.repriseDate ? 'La date de reprise inscrite sur la fiche est recalculée.' : '',
  ].filter(Boolean);

  const confirm = async () => {
    if (busy || !droit.ok) return;
    setBusy(true);
    const r = await run('absence.annuler', { id });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={a.statut === 'demandee' ? 'Retirer une demande' : 'Annuler une absence'} width={520} onSubmit={confirm} actions={<>
      <CancelButton label="Fermer" />
      {/* Annulation hors droits : la raison s'affiche, sans bouton qui ne mènerait à rien. */}
      {droit.ok && <SubmitButton busy={busy}>{droit.libelle}</SubmitButton>}
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{emp.nom}</Static></Field>
        <Field label="Absence"><Static>{ABS_LABEL[a.type]} · {statutAbsence(a).toLowerCase()}</Static></Field>
      </div>
      <div className="boxed text-muted sub">{periodeDemiTexte(a)}{a.signalePar ? ` · signalée le ${fmtIso(a.signaleLe!)} par ${a.signalePar}` : ''}</div>
      {!droit.ok && <NoteAccent>{droit.raison}</NoteAccent>}
      {droit.ok && suites.map(s => <Fine key={s} muted={false}>{s}</Fine>)}
      <Fine>L’absence reste visible comme annulée, avec la date et l’auteur de l’annulation.</Fine>
    </Dialog>
  );
}
