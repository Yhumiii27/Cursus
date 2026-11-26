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
import { t } from '../i18n/langue.ts';

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
  const justErr = !just ? null : !justLe ? t('Enter the date of receipt of the supporting document.')
    : !isValidDate(justLe) || justLe > d.ti ? t('Invalid date of receipt: today at the latest.') : null;
  const periode = erreursPeriode(du, au, { du: t('Enter the first day of absence.'), au: t('Enter the last day of absence.') });
  const empErr = !emp ? t('Choose the employee.') : null;
  const natureErr = !nature ? t('Choose the nature of the absence.') : null;
  // Reprise inscrite sur la fiche, ou conservée si une reprise antérieure attend encore son entretien.
  const maj = emp && nature && chk?.valid
    ? repriseAInscrire(emp, [...d.ds.absences.filter(x => x.id !== a?.id), { empId: emp.id, type: nature, du, au, statut: 'validee' }], d.ds.entretiens, a ?? null, nature)
    : {};
  const title = t(!a ? 'Enter an absence' : a.statut === 'signalee' ? 'Qualify an absence' : 'Edit an absence');

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
      <SubmitButton busy={busy}>{t(a ? 'Qualify the absence' : 'Record the absence')}</SubmitButton>
    </>}>
      <Field label={t('Employee')} htmlFor={a || empId != null ? undefined : 'an-emp'} requis={!a && empId == null} erreur={v.erreur(empErr)}>
        {a || empId != null
          ? <Static>{emp?.nom ?? '—'}</Static>
          : (
            <ChoixCollaborateur id="an-emp" emps={choix} valeur={sel} onChange={setSel} requis erreur={v.erreur(empErr)} placeholder={t('Choose an employee…')} />
          )}
      </Field>
      {a && (
        <div className="boxed text-muted sub">
          {a.signaleLe ? `${t('Reported on #fem')}${fmtIso(a.signaleLe)}${a.signalePar ? `${t(' by ')}${a.signalePar}` : ''} · ` : ''}
          {periodeTexte(a.du, a.au)}
          {a.finInitiale ? `${t(' · extended, initial end on ')}${fmtIso(a.finInitiale)}` : ''}
        </div>
      )}
      <Field label={t('Nature')} htmlFor="an-nat" requis erreur={v.erreur(natureErr)}>
        <select className="input" id="an-nat" value={nature} onChange={ev => setNature(ev.target.value as NatureAbsence)}>
          <option value="" disabled>{t('Choose the nature…')}</option>
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
            {t('Count in days ')}{uniteDecompte(nature as NatureAbsence)}
            {def.duree ? `${t(' · legal duration ')}${fJ(def.duree)}${def.parAn ? t(' a year') : ''}` : ''}
            {def.dureeNote ? ` · ${def.dureeNote}` : ''}
            {def.article ? ` (${def.article})` : ''}
          </div>
          <div className="text-muted">{t('Supporting document: ')}{def.justificatif ?? t('none')}</div>
          <div className="text-muted">{t('Accrual of paid leave: ')}{def.cp}</div>
          {def.medicale && <div className="note-accent">{t('Health data: the manager and Keystone only see an absence, without its nature.')}</div>}
        </div>
      )}
      <div className="grid-2">
        <Field label={t('From#date')} htmlFor="an-du" requis erreur={v.erreur(periode.du)}><input className="input" id="an-du" type="date" value={du} onChange={ev => pickDu(ev.target.value)} /></Field>
        <Field label={t('To (inclusive)')} htmlFor="an-au" requis erreur={v.erreur(periode.au)}><input className="input" id="an-au" type="date" value={au} min={du || undefined} onChange={ev => setAu(ev.target.value)} /></Field>
      </div>
      <PiecesJointes objet="absence" objetId={a?.id} label={t('Supporting documents received')} />
      <ChoixPiece piece={piece} id="an-piece" label={t('Attach the supporting document')} aide={t('Visible to HR and the employee only.')}
        onChoix={f => { if (f) { setJust(true); if (!justLe) setJustLe(d.ti); } }} />
      <div className="grid-2">
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, alignSelf: 'end', paddingBottom: 'var(--space-2)' }}>
          <input type="checkbox" checked={just} onChange={ev => setJust(ev.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
          {t('Supporting document received')}
        </label>
        <Field label={t('Received on')} htmlFor="an-jle" requis={just} erreur={just && justLe && justErr ? justErr : v.erreur(justErr)}>
          <input className="input" id="an-jle" type="date" max={d.ti} value={justLe} disabled={!just} onChange={ev => setJustLe(ev.target.value)} />
        </Field>
      </div>
      {chk && <Controles msgs={chk.msgs} />}
      {maj.reprise && <Fine muted={false}>{t('Return on ')}{fmtIso(maj.reprise.date)}{t(' entered on the sheet: return career review to offer (art. L6315-1).')}</Fine>}
      {maj.differee && emp?.repriseDate && (
        <Fine muted={false}>
          {t('Return of ')}{fmtIso(emp.repriseDate)}{t(' kept on the sheet: its review has not been held. That of ')}{fmtIso(maj.differee.date)}{t(' will be entered afterwards (art. L6315-1).')}
        </Fine>
      )}
      <Fine>
        {t(a ? 'Qualifying approves the absence. ' : 'The absence is recorded as approved. ')}
        {t('No leave balance is debited; Keystone only receives an unavailability (dates and generic code).')}
      </Fine>
    </Dialog>
  );
}
