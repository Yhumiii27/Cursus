// Service RH : saisir une absence hors congés (prévisible ou non), qualifier une absence signalée ou corriger
// une absence qualifiée — nature, dates, justificatif. Repères de la nature choisie : rémunération, décompte,
// durée légale (Code du travail ; la CCN peut être plus favorable), justificatif attendu, effet sur les CP
// (pour mémoire) et date de reprise inscrite sur la fiche après une absence longue.
import { useState } from 'react';
import { CATEGORIES_ABSENCE, NATURES_ABSENCE, PAIE_ABSENCE, type CategorieAbsence } from '../../../shared/constants.ts';
import { isValidDate } from '../../../shared/dates.ts';
import { fJ, fmtIso } from '../../../shared/format.ts';
import { estNature, lendemainOuvre, periodeTexte, uniteDecompte } from '../../../shared/rules/absences.ts';
import { checkNature } from '../../../shared/rules/conges.ts';
import type { NatureAbsence } from '../../../shared/types.ts';
import { CancelButton, Controles, Dialog, Field, Static } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

const NATURES = Object.entries(NATURES_ABSENCE) as [NatureAbsence, (typeof NATURES_ABSENCE)[NatureAbsence]][];

export function AbsNatureDialog({ empId, id }: { empId?: number | null; id?: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const a = id != null ? d.ds.absences.find(x => x.id === id) : undefined;
  const choix = [...d.ds.employes].sort((x, y) => x.nom.localeCompare(y.nom));
  const [sel, setSel] = useState<number | null>(a?.empId ?? empId ?? null);
  const [nature, setNature] = useState<NatureAbsence | ''>(a && estNature(a.type) ? a.type : '');
  const [du, setDu] = useState(a?.du ?? '');
  const [au, setAu] = useState(a?.au ?? '');
  const [just, setJust] = useState(a?.justificatif ?? false);
  const [justLe, setJustLe] = useState(a?.justificatifLe ?? d.ti);
  const [busy, setBusy] = useState(false);
  if (id != null && !a) return null;

  const emp = sel != null ? d.emp(sel) : undefined;
  const def = nature ? NATURES_ABSENCE[nature] : null;
  const chk = emp && nature ? checkNature(d, emp, nature, du, au, { exclure: a?.id, quand: a ? 'avant de qualifier l’absence' : 'avant d’enregistrer l’absence' }) : null;
  const justErr = just && (!isValidDate(justLe) || justLe > d.ti) ? 'Date de réception invalide : aujourd’hui au plus tard.' : '';
  const reprise = def?.reprise && isValidDate(au) ? lendemainOuvre(au) : null;
  const title = !a ? 'Saisir une absence' : a.statut === 'signalee' ? 'Qualifier une absence' : 'Modifier une absence';

  const pickDu = (v: string) => { setDu(v); if (!au || au < v) setAu(v); };
  const confirm = async () => {
    setBusy(true);
    const payload = { nature, du, au, justificatif: just, justificatifLe: just ? justLe : null };
    const r = await run(a ? 'absence.qualifier' : 'absence.saisir', a ? { id: a.id, ...payload } : { empId: sel, ...payload });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={title} width={600} tall actions={<>
      <CancelButton />
      <button type="button" className="btn btn-primary" disabled={!chk || chk.cant || !!justErr || busy} onClick={confirm}>
        {a ? 'Qualifier l’absence' : 'Enregistrer l’absence'}
      </button>
    </>}>
      <Field label="Collaborateur" htmlFor="an-emp">
        {a || empId != null
          ? <Static>{emp?.nom ?? '—'}</Static>
          : (
            <select className="input" id="an-emp" value={String(sel ?? '')} onChange={ev => setSel(Number(ev.target.value))}>
              <option value="" disabled>Choisir un collaborateur…</option>
              {choix.map(e => <option key={e.id} value={e.id}>{e.nom}</option>)}
            </select>
          )}
      </Field>
      {a && (
        <div className="boxed text-muted sub">
          {a.signaleLe ? `Signalée le ${fmtIso(a.signaleLe)}${a.signalePar ? ` par ${a.signalePar}` : ''} · ` : ''}
          {periodeTexte(a.du, a.au)}
          {a.finInitiale ? ` · prolongée, fin initiale le ${fmtIso(a.finInitiale)}` : ''}
        </div>
      )}
      <Field label="Nature" htmlFor="an-nat">
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
          <div className="text-muted">Congés payés, pour mémoire : {def.cp}</div>
          {def.medicale && <div className="note-accent">Donnée de santé : le manager et Keystone ne voient qu’une absence, sans sa nature.</div>}
        </div>
      )}
      <div className="grid-2">
        <Field label="Du" htmlFor="an-du"><input className="input" id="an-du" type="date" value={du} onChange={ev => pickDu(ev.target.value)} /></Field>
        <Field label="Au (inclus)" htmlFor="an-au"><input className="input" id="an-au" type="date" value={au} min={du || undefined} onChange={ev => setAu(ev.target.value)} /></Field>
      </div>
      <div className="grid-2">
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, alignSelf: 'end', paddingBottom: 'var(--space-2)' }}>
          <input type="checkbox" checked={just} onChange={ev => setJust(ev.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
          Justificatif reçu
        </label>
        <Field label="Reçu le" htmlFor="an-jle">
          <input className="input" id="an-jle" type="date" max={d.ti} value={justLe} disabled={!just} onChange={ev => setJustLe(ev.target.value)} />
        </Field>
      </div>
      {justErr && <p className="form-error">{justErr}</p>}
      {chk && <Controles msgs={chk.msgs} />}
      {reprise && <Fine muted={false}>Reprise le {fmtIso(reprise)} inscrite sur la fiche : entretien de parcours professionnel de reprise à proposer (art. L6315-1).</Fine>}
      <Fine>
        {a ? 'La qualification valide l’absence. ' : 'L’absence est enregistrée validée. '}
        Aucun solde de congés n’est débité ; Keystone ne reçoit qu’une indisponibilité (dates et code générique).
      </Fine>
    </Dialog>
  );
}
