// lot 11 — notes de frais : nouvelle note (`frais.note.creer`) : mois des dépenses, rattachement facultatif à un
// déplacement ou une mission du salarié, ou à un code de projet ou de chantier ; note de frais médicaux à part (vaccin,
// pharmacie, consultation en mission), contrôlée sans passer par le manager. Le service RH la crée pour un salarié.
import { useState } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { estPeriodeFrais } from '../../../shared/rules/frais.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { ChoixCollaborateur } from '../components/ChoixCollaborateur.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function FraisNoteDialog({ empId: empInitial, voyageId: v0, missionId: m0 }: { empId?: number | null; voyageId?: number | null; missionId?: number | null }) {
  const d = useDomain();
  const { me, rh } = useRole();
  const { run, closeDialog, setUi } = useStore();
  const [empId, setEmpId] = useState<number | null>(empInitial ?? (rh ? null : me));
  const [periode, setPeriode] = useState(d.ti.slice(0, 7));
  const [medicale, setMedicale] = useState(false);
  const [rattache, setRattache] = useState(v0 ? `v${v0}` : m0 ? `m${m0}` : '');
  const [projet, setProjet] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const voyages = d.ds.voyages.filter(x => x.empId === empId && !x.annuleLe);
  const missions = d.ds.missions.filter(x => x.empId === empId);
  const errEmp = empId ? null : t('Choose the employee.#salarie');
  const errPeriode = estPeriodeFrais(periode) ? (periode > d.ti.slice(0, 7) ? t('Month to come: expenses are entered once made.') : null) : t('Enter the month of the expenses.');

  const envoyer = async () => {
    if (busy || !v.verifier(errEmp, errPeriode)) return;
    setBusy(true);
    const r = await run('frais.note.creer', {
      empId, periode, medicale, projet: medicale ? '' : projet.trim(),
      voyageId: !medicale && rattache.startsWith('v') ? Number(rattache.slice(1)) : null, missionId: !medicale && rattache.startsWith('m') ? Number(rattache.slice(1)) : null,
    });
    setBusy(false);
    if (r.ok) {
      closeDialog();
      const note = (r.result as { note?: number } | undefined)?.note;
      if (note) setUi({ fraisNote: note });
    }
  };

  return (
    <Dialog title={t('New expense report')} width={520} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Create the note')}</SubmitButton>
    </>}>
      {rh && (
        <Field label={t('Employee#salarie')} htmlFor="frais-note-emp" requis erreur={v.erreur(errEmp)}>
          <ChoixCollaborateur id="frais-note-emp" emps={d.ds.employes} valeur={empId} onChange={setEmpId} requis erreur={v.erreur(errEmp)} />
        </Field>
      )}
      <Field label={t('Month of the expenses')} htmlFor="frais-note-mois" requis erreur={v.erreur(errPeriode) || (periode ? errPeriode : null)}>
        <input className="input" id="frais-note-mois" type="month" max={d.ti.slice(0, 7)} value={periode} onChange={ev => setPeriode(ev.target.value)} />
      </Field>
      <label className="check-row" htmlFor="frais-note-medicale">
        <input id="frais-note-medicale" type="checkbox" checked={medicale} onChange={ev => setMedicale(ev.target.checked)} />
        <span>{t('Medical expenses on assignment (vaccine, pharmacy, consultation)')}</span>
      </label>
      {medicale
        ? <Fine>{t('Separate note, checked directly by accounting or HR: your manager sees neither it nor its amounts.')}</Fine>
        : <>
          <Field label={t('Trip or assignment (optional)')} htmlFor="frais-note-rattache">
            <select className="input" id="frais-note-rattache" value={rattache} onChange={ev => setRattache(ev.target.value)}>
              <option value="">{t('None')}</option>
              {voyages.map(x => <option key={`v${x.id}`} value={`v${x.id}`}>{t('Trip: ')}{d.destOf(x.dest)?.pays ?? x.dest}, {fmtIso(x.depart)} → {fmtIso(x.retour)}</option>)}
              {missions.map(x => <option key={`m${x.id}`} value={`m${x.id}`}>{t('Assignment: ')}{x.projet} · {x.lieu}, {fmtIso(x.du)} → {fmtIso(x.au)}</option>)}
            </select>
          </Field>
          <Field label={t('Project or worksite (optional)')} htmlFor="frais-note-projet">
            <input className="input" id="frais-note-projet" value={projet} maxLength={300} onChange={ev => setProjet(ev.target.value)} placeholder={t('Code of the project or worksite')} />
          </Field>
        </>}
    </Dialog>
  );
}
