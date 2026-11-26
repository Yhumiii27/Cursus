// Signaler une absence imprévue (arrêt de travail, accident, absence inattendue) : le salarié pour lui-même,
// le manager pour son équipe. L'absence compte aussitôt (aucune heure ces jours-là, indisponibilité transmise
// à Keystone) ; le service RH en précise la nature à réception du justificatif, sans la révéler pour un arrêt.
import { useState } from 'react';
import { checkNature } from '../../../shared/rules/conges.ts';
import { erreursPeriode } from '../components/controles.ts';
import { CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { ChoixCollaborateur } from '../components/ChoixCollaborateur.tsx';
import { ChoixPiece, usePieceJointe } from '../components/PieceJointe.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { decideur } from '../state/delegues.ts';
import { t } from '../i18n/langue.ts';

export function AbsSignalDialog({ empId }: { empId?: number | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const { rh, manager, me } = useRole();
  // Soi-même, son équipe (manager) ou tout le monde (RH).
  const choix = d.ds.employes.filter(e => rh || e.id === me || (manager && decideur(d, e, me, 'absences'))).sort((a, b) => a.nom.localeCompare(b.nom));
  const [sel, setSel] = useState<number | null>(() => empId ?? (manager ? choix.find(e => e.id !== me)?.id : me) ?? choix[0]?.id ?? null);
  const [du, setDu] = useState(d.ti);
  const [au, setAu] = useState(d.ti);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const emp = sel != null ? d.emp(sel) : undefined;
  // Justificatif joint par l'intéressé ou le service RH, jamais par le manager pour un membre (donnée de santé).
  const piece = usePieceJointe();
  const joindre = piece.actif && (rh || sel === me);
  const chk = emp ? checkNature(d, emp, 'ABSENCE', du, au, { quand: 'avant de signaler l’absence' }) : null;
  const empErr = !emp ? t('Choose the absent employee.') : null;
  const periode = erreursPeriode(du, au, { du: t('Enter the first day of absence.'), au: t('Enter the last day planned.') });

  const pickDu = (x: string) => { setDu(x); if (!au || au < x) setAu(x); };
  const confirm = async () => {
    if (busy || !v.verifier(empErr, periode.du, periode.au, chk?.cant, joindre && piece.erreur)) return;
    setBusy(true);
    const pieces = joindre ? await piece.envoyer() : [];
    if (!pieces) { setBusy(false); return; }
    const r = await run('absence.signaler', { empId: sel, du, au, ...(pieces.length ? { pieces } : {}) });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t('Report an absence')} width={540} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Report the absence')}</SubmitButton>
    </>}>
      <Field label={t('Employee')} htmlFor={empId != null || choix.length <= 1 ? undefined : 'as-emp'} requis={empId == null && choix.length > 1} erreur={v.erreur(empErr)}>
        {empId != null || choix.length <= 1
          ? <Static>{emp?.nom ?? '—'}</Static>
          : (
            <ChoixCollaborateur id="as-emp" emps={choix} valeur={sel} onChange={setSel} requis erreur={v.erreur(empErr)}
              suffixe={e => e.id === me ? t(' (me)') : ''} />
          )}
      </Field>
      <div className="grid-2">
        <Field label={t('Absent since')} htmlFor="as-du" requis erreur={v.erreur(periode.du)}><input className="input" id="as-du" type="date" value={du} onChange={ev => pickDu(ev.target.value)} /></Field>
        <Field label={t('Until (inclusive, planned)')} htmlFor="as-au" requis erreur={v.erreur(periode.au)}><input className="input" id="as-au" type="date" value={au} min={du || undefined} onChange={ev => setAu(ev.target.value)} /></Field>
      </div>
      {chk && <Controles msgs={chk.msgs} />}
      {joindre && <ChoixPiece piece={piece} id="as-piece" label={t('Supporting document (optional)')} aide={t('Visible to HR and the person concerned only, never to the manager.')} />}
      <Fine>
        {t('The absence counts as soon as it is reported: no hours can be entered those days and Keystone receives the unavailability. HR then specifies its nature (sick leave, accident, family event…); a sick leave or the health of a child is communicated neither to the manager nor to Keystone. If the absence lasts longer, extend it from the list.')}
      </Fine>
      {sel === me && !rh && !piece.fichier && <Fine muted={false}>{t('Send your supporting document (sick note…) to HR within 48 hours')}{piece.actif ? t(', here or later from the list of your absences') : ''}.</Fine>}
    </Dialog>
  );
}
