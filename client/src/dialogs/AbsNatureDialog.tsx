// Service RH : saisir une absence hors congés (prévisible ou non), qualifier une absence signalée ou corriger
// une absence qualifiée — nature, dates, justificatif. Repères de la nature choisie : rémunération, décompte,
// durée légale (Code du travail ; la CCN peut être plus favorable), justificatif attendu, effet sur les CP
// (pour mémoire) et date de reprise inscrite sur la fiche après une absence longue (`repriseAInscrire`, comme le serveur).
import { useState } from 'react';
import { CATEGORIES_ABSENCE, NATURES_ABSENCE, PAIE_ABSENCE, type CategorieAbsence } from '../../../shared/constants.ts';
import { isoParis, isValidDate } from '../../../shared/dates.ts';
import { fJ, fmtIso } from '../../../shared/format.ts';
import { estNature, periodeTexte, repriseAInscrire, uniteDecompte } from '../../../shared/rules/absences.ts';
import { checkNature } from '../../../shared/rules/conges.ts';
import { piecesDe } from '../../../shared/rules/pieces.ts';
import type { NatureAbsence } from '../../../shared/types.ts';
import { erreursPeriode } from '../components/controles.ts';
import { CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { ChoixCollaborateur } from '../components/ChoixCollaborateur.tsx';
import { ChoixPiece, PiecesJointes, usePieceJointe } from '../components/PieceJointe.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

const NATURES = Object.entries(NATURES_ABSENCE) as [NatureAbsence, (typeof NATURES_ABSENCE)[NatureAbsence]][];

export function AbsNatureDialog({ empId, id }: { empId?: number | null; id?: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const a = id != null ? d.ds.absences.find(x => x.id === id) : undefined;
  const { soi } = useRole();
  // Ses propres absences, un membre du RH les signale : un autre membre du service RH les qualifie.
  const choix = d.ds.employes.filter(e => e.id !== soi).sort((x, y) => x.nom.localeCompare(y.nom));
  const [sel, setSel] = useState<number | null>(a?.empId ?? empId ?? null);
  const [nature, setNature] = useState<NatureAbsence | ''>(a && estNature(a.type) ? a.type : '');
  const [du, setDu] = useState(a?.du ?? '');
  const [au, setAu] = useState(a?.au ?? '');
  // Pièces déjà jointes (souvent envoyées par l'intéressé) : « Justificatif reçu » coché d'emblée, reçu le jour du premier
  // envoi ; le service RH les ouvre avant de valider, et décoche si la pièce ne convient pas.
  const jointes = a ? piecesDe(d.ds.pieces, 'absence', a.id) : [];
  const [just, setJust] = useState(a?.justificatif || jointes.length > 0);
  const premierEnvoi = jointes.map(p => isoParis(new Date(p.deposeLe))).sort()[0];
  const [justLe, setJustLe] = useState(a?.justificatifLe ?? (premierEnvoi && premierEnvoi < d.ti ? premierEnvoi : d.ti));
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  // Justificatif joint (pièce justificative, components/PieceJointe.tsx) : coche « Justificatif reçu » aujourd'hui.
  const piece = usePieceJointe();
  if (id != null && !a) return null;

  const emp = sel != null ? d.emp(sel) : undefined;
  const def = nature ? NATURES_ABSENCE[nature] : null;
  const chk = emp && nature ? checkNature(d, emp, nature, du, au, { exclure: a?.id, quand: a ? 'avant de qualifier l’absence' : 'avant d’enregistrer l’absence' }) : null;
  const justErr = !just ? null : !justLe ? 'Indiquez la date de réception du justificatif.'
    : !isValidDate(justLe) || justLe > d.ti ? 'Date de réception invalide : aujourd’hui au plus tard.' : null;
  const periode = erreursPeriode(du, au, { du: 'Indiquez le premier jour d’absence.', au: 'Indiquez le dernier jour d’absence.' });
  const empErr = !emp ? 'Choisissez le collaborateur.' : null;
  const natureErr = !nature ? 'Choisissez la nature de l’absence.' : null;
  // Reprise inscrite sur la fiche, ou conservée si une reprise antérieure attend encore son entretien.
  const maj = emp && nature && chk?.valid
    ? repriseAInscrire(emp, [...d.ds.absences.filter(x => x.id !== a?.id), { empId: emp.id, type: nature, du, au, statut: 'validee' }], d.ds.entretiens, a ?? null, nature)
    : {};
  const title = !a ? 'Saisir une absence' : a.statut === 'signalee' ? 'Qualifier une absence' : 'Modifier une absence';

  const pickDu = (x: string) => { setDu(x); if (!au || au < x) setAu(x); };
  const confirm = async () => {
    if (busy || !v.verifier(empErr, natureErr, periode.du, periode.au, justErr, chk?.cant, piece.erreur)) return;
    setBusy(true);
    const pieces = await piece.envoyer();
    if (!pieces) { setBusy(false); return; }
    const payload = { nature, du, au, justificatif: just, justificatifLe: just ? justLe : null, ...(pieces.length ? { pieces } : {}) };
    const r = await run(a ? 'absence.qualifier' : 'absence.saisir', a ? { id: a.id, ...payload } : { empId: sel, ...payload });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={title} width={600} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{a ? 'Qualifier l’absence' : 'Enregistrer l’absence'}</SubmitButton>
    </>}>
      <Field label="Collaborateur" htmlFor={a || empId != null ? undefined : 'an-emp'} requis={!a && empId == null} erreur={v.erreur(empErr)}>
        {a || empId != null
          ? <Static>{emp?.nom ?? '—'}</Static>
          : (
            <ChoixCollaborateur id="an-emp" emps={choix} valeur={sel} onChange={setSel} requis erreur={v.erreur(empErr)} placeholder="Choisir un collaborateur…" />
          )}
      </Field>
      {a && (
        <div className="boxed text-muted sub">
          {a.signaleLe ? `Signalée le ${fmtIso(a.signaleLe)}${a.signalePar ? ` par ${a.signalePar}` : ''} · ` : ''}
          {periodeTexte(a.du, a.au)}
          {a.finInitiale ? ` · prolongée, fin initiale le ${fmtIso(a.finInitiale)}` : ''}
        </div>
      )}
      <Field label="Nature" htmlFor="an-nat" requis erreur={v.erreur(natureErr)}>
        <select className="input" id="an-nat" value={nature} onChange={ev => setNature(ev.target.value as NatureAbsence)}>
          <option value="" disabled>Choisir la nature…</option>
          {(Object.keys(CATEGORIES_ABSENCE) as CategorieAbsence[]).map(c => (
            <optgroup key={c} label={CATEGORIES_ABSENCE[c]}>
              {NATURES.filter(([, n]) => n.categorie === c).map(([k, n]) => <option key={k} value={k}>{n.label}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>
      {def && (
        <div className="boxed" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', fontSize: 13 }}>
          <div>{PAIE_ABSENCE[def.paie]}</div>
          <div className="text-muted">
            Décompte en jours {uniteDecompte(nature as NatureAbsence)}
            {def.duree ? ` · durée légale ${fJ(def.duree)}${def.parAn ? ' par an' : ''}` : ''}
            {def.dureeNote ? ` · ${def.dureeNote}` : ''}
            {def.article ? ` (${def.article})` : ''}
          </div>
          <div className="text-muted">Justificatif : {def.justificatif ?? 'aucun'}</div>
          <div className="text-muted">Acquisition des congés payés : {def.cp}</div>
          {def.medicale && <div className="note-accent">Donnée de santé : le manager et Keystone ne voient qu’une absence, sans sa nature.</div>}
        </div>
      )}
      <div className="grid-2">
        <Field label="Du" htmlFor="an-du" requis erreur={v.erreur(periode.du)}><input className="input" id="an-du" type="date" value={du} onChange={ev => pickDu(ev.target.value)} /></Field>
        <Field label="Au (inclus)" htmlFor="an-au" requis erreur={v.erreur(periode.au)}><input className="input" id="an-au" type="date" value={au} min={du || undefined} onChange={ev => setAu(ev.target.value)} /></Field>
      </div>
      <PiecesJointes objet="absence" objetId={a?.id} label="Justificatifs reçus" />
      <ChoixPiece piece={piece} id="an-piece" label="Joindre le justificatif" aide="Visible du service RH et du salarié seulement."
        onChoix={f => { if (f) { setJust(true); if (!justLe) setJustLe(d.ti); } }} />
      <div className="grid-2">
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, alignSelf: 'end', paddingBottom: 'var(--space-2)' }}>
          <input type="checkbox" checked={just} onChange={ev => setJust(ev.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
          Justificatif reçu
        </label>
        <Field label="Reçu le" htmlFor="an-jle" requis={just} erreur={just && justLe && justErr ? justErr : v.erreur(justErr)}>
          <input className="input" id="an-jle" type="date" max={d.ti} value={justLe} disabled={!just} onChange={ev => setJustLe(ev.target.value)} />
        </Field>
      </div>
      {chk && <Controles msgs={chk.msgs} />}
      {maj.reprise && <Fine muted={false}>Reprise le {fmtIso(maj.reprise.date)} inscrite sur la fiche : entretien de parcours professionnel de reprise à proposer (art. L6315-1).</Fine>}
      {maj.differee && emp?.repriseDate && (
        <Fine muted={false}>
          Reprise du {fmtIso(emp.repriseDate)} conservée sur la fiche : son entretien n’est pas réalisé. Celle du {fmtIso(maj.differee.date)} sera à inscrire ensuite (art. L6315-1).
        </Fine>
      )}
      <Fine>
        {a ? 'La qualification valide l’absence. ' : 'L’absence est enregistrée validée. '}
        Aucun solde de congés n’est débité ; Keystone ne reçoit qu’une indisponibilité (dates et code générique).
      </Fine>
    </Dialog>
  );
}
