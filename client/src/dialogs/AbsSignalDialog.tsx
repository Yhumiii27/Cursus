// Signaler une absence imprévue (arrêt de travail, accident, absence inattendue) : le salarié pour lui-même,
// le manager pour son équipe. L'absence compte aussitôt (aucune heure ces jours-là, indisponibilité transmise
// à Keystone) ; le service RH en précise la nature à réception du justificatif, sans la révéler pour un arrêt.
import { useState } from 'react';
import { checkNature } from '../../../shared/rules/conges.ts';
import { erreursPeriode } from '../components/controles.ts';
import { CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { ChoixPiece, usePieceJointe } from '../components/PieceJointe.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { decideur } from '../state/delegues.ts';

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
  const empErr = !emp ? 'Choisissez le collaborateur absent.' : null;
  const periode = erreursPeriode(du, au, { du: 'Indiquez le premier jour d’absence.', au: 'Indiquez le dernier jour prévu.' });

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
    <Dialog title="Signaler une absence" width={540} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Signaler l’absence</SubmitButton>
    </>}>
      <Field label="Collaborateur" htmlFor={empId != null || choix.length <= 1 ? undefined : 'as-emp'} erreur={v.erreur(empErr)}>
        {empId != null || choix.length <= 1
          ? <Static>{emp?.nom ?? '—'}</Static>
          : (
            <select className="input" id="as-emp" value={String(sel ?? '')} onChange={ev => setSel(Number(ev.target.value))}>
              {choix.map(e => <option key={e.id} value={e.id}>{e.nom}{e.id === me ? ' (moi)' : ''}</option>)}
            </select>
          )}
      </Field>
      <div className="grid-2">
        <Field label="Absent depuis le" htmlFor="as-du" requis erreur={v.erreur(periode.du)}><input className="input" id="as-du" type="date" value={du} onChange={ev => pickDu(ev.target.value)} /></Field>
        <Field label="Jusqu’au (inclus, prévu)" htmlFor="as-au" requis erreur={v.erreur(periode.au)}><input className="input" id="as-au" type="date" value={au} min={du || undefined} onChange={ev => setAu(ev.target.value)} /></Field>
      </div>
      {chk && <Controles msgs={chk.msgs} />}
      {joindre && <ChoixPiece piece={piece} id="as-piece" label="Justificatif (facultatif)" aide="Visible du service RH et de l’intéressé seulement, jamais du manager." />}
      <Fine>
        L’absence compte dès son signalement : aucune heure ne peut être saisie ces jours-là et Keystone reçoit l’indisponibilité.
        Le service RH précise ensuite sa nature (arrêt de travail, accident, événement familial…) ; un arrêt de travail ou la santé d’un enfant n’est communiqué ni au manager ni à Keystone.
        Si l’absence dure plus longtemps, prolongez-la depuis la liste.
      </Fine>
      {sel === me && !rh && !piece.fichier && <Fine muted={false}>Transmettez votre justificatif (avis d’arrêt de travail…) au service RH sous 48 heures{piece.actif ? ', ici ou plus tard depuis la liste de vos absences' : ''}.</Fine>}
    </Dialog>
  );
}
