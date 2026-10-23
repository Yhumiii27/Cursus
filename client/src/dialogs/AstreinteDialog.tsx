// Planifier ou modifier une astreinte (t049, lot 7, étape 2) : manager direct ou service RH, jamais pour soi-même. Les
// contrôles sont ceux du serveur (`controlerAstreinte`, shared/rules/astreintes.ts), affichés champ par champ à l'envoi :
// délai de prévenance réglé (15 jours par défaut, art. R3121-3) — en dessous, motif des circonstances exceptionnelles, et
// jamais moins d'un jour franc —, contrat, salarié mineur, autre astreinte, absence en vigueur. Une astreinte commencée ne
// change plus que de fin, avancée (une prolongation est une nouvelle astreinte). Le salarié reçoit un e-mail avec
// l'événement d'agenda, sauf quand la modification ne touche que le motif.
import { useState } from 'react';
import { fH } from '../../../shared/format.ts';
import {
  astreinteCommencee, bornesIntervention, controlerAstreinte, delaiCourtTexte, type EmployeAstreinte, heuresAstreinte, MOTIF_ASTREINTE_MAX, periodeAstreinteTexte, prevenance, reglagesAstreinte,
} from '../../../shared/rules/astreintes.ts';
import { ChoixCollaborateur } from '../components/ChoixCollaborateur.tsx';
import { Bloquant, CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { maintenant, salariesPlanifiables } from '../components/astreintes-etat.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Salarié des contrôles tant qu'aucun n'est choisi : seuls les dates, les heures et le délai sont contrôlés. */
const SANS_SALARIE: EmployeAstreinte = { id: 0, nom: '', entree: '0001-01-01', fin: null, typeContrat: 'cdi', naissance: 0 };

/** `id` : astreinte à modifier ; sinon planification, `empId` présélectionné (planning de l'écran Temps). */
export function AstreinteDialog({ empId, id }: { empId?: number | null; id?: number | null }) {
  const d = useDomain();
  const role = useRole();
  const { run, closeDialog } = useStore();
  const existante = id != null ? (d.ds.astreintes ?? []).find(a => a.id === id) ?? null : null;
  const choix = salariesPlanifiables(d, role);
  const [sel, setSel] = useState<number | null>(() => existante?.empId ?? empId ?? (choix.length === 1 ? choix[0].id : null));
  const [du, setDu] = useState(existante?.du ?? '');
  const [debut, setDebut] = useState(existante?.debut ?? '18:00');
  const [au, setAu] = useState(existante?.au ?? '');
  const [fin, setFin] = useState(existante?.fin ?? '08:00');
  const [motif, setMotif] = useState(existante?.motif ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (id != null && !existante) return null;

  const emp = sel != null ? d.emp(sel) : undefined;
  const s = d.ds.settings;
  const m = maintenant(d.ti);
  const commencee = !!existante && astreinteCommencee(existante, m);
  const ints = existante ? (d.ds.interventionsAstreinte ?? []).filter(x => x.astreinteId === existante.id) : [];
  const finInterventions = ints.length ? Math.max(...ints.map(x => bornesIntervention(x).fin)) : null;
  // Contrôles du serveur, sur la saisie telle qu'elle sera envoyée ; sans collaborateur choisi, ceux des dates et heures.
  const r = controlerAstreinte(d.ds, emp ?? SANS_SALARIE, { du, debut, au, fin, motif }, d.ti, s, existante, finInterventions, m);
  const e = emp ? r.erreurs : { ...r.erreurs, general: undefined };
  const empErr = !emp ? 'Choisissez le collaborateur d’astreinte.' : null;
  // Délai de prévenance de la saisie (à venir seulement) : le motif s'affiche dès qu'il est trop court.
  const pr = !commencee && /^\d{4}-\d{2}-\d{2}$/.test(du) ? prevenance(du, d.ti, s) : null;
  const motifVisible = !commencee && (!!pr?.court || !!motif.trim());
  const heures = r.valeurs ? heuresAstreinte(r.valeurs) : null;

  const pickDu = (x: string) => { setDu(x); if (!au || au < x) setAu(x); };
  const confirm = async () => {
    if (busy || !v.verifier(empErr, e.du, e.debut, e.au, e.fin, e.motif, e.general)) return;
    setBusy(true);
    const corps = { du, debut, au, fin, ...(motifVisible ? { motif: motif.trim() } : {}) };
    const res = existante ? await run('astreinte.modifier', { id: existante.id, ...corps }) : await run('astreinte.planifier', { empId: sel, ...corps });
    setBusy(false);
    if (res.ok) closeDialog();
  };

  return (
    <Dialog title={existante ? 'Modifier l’astreinte' : 'Planifier une astreinte'} width={560} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{existante ? 'Enregistrer' : 'Planifier l’astreinte'}</SubmitButton>
    </>}>
      <Field label="Collaborateur" htmlFor={existante || empId != null ? undefined : 'ast-emp'} requis={!existante && empId == null} erreur={v.erreur(empErr)}>
        {existante || empId != null
          ? <Static>{emp?.nom ?? '—'}</Static>
          : <ChoixCollaborateur id="ast-emp" emps={choix} valeur={sel} onChange={setSel} requis erreur={v.erreur(empErr)} />}
      </Field>
      {commencee && <Fine muted={false}>Astreinte commencée {periodeAstreinteTexte(existante!)} : seule sa fin peut être avancée (une prolongation se planifie comme une nouvelle astreinte).</Fine>}
      <div className="grid-2">
        <Field label="Premier jour" htmlFor="ast-du" requis erreur={v.erreur(e.du)}>
          <input className="input" id="ast-du" type="date" value={du} disabled={commencee} onChange={ev => pickDu(ev.target.value)} />
        </Field>
        <Field label="À partir de" htmlFor="ast-debut" requis erreur={v.erreur(e.debut)}>
          <input className="input" id="ast-debut" type="time" value={debut} disabled={commencee} onChange={ev => setDebut(ev.target.value)} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Dernier jour" htmlFor="ast-au" requis erreur={v.erreur(e.au)}>
          <input className="input" id="ast-au" type="date" value={au} min={du || undefined} onChange={ev => setAu(ev.target.value)} />
        </Field>
        <Field label="Jusqu’à" htmlFor="ast-fin" requis erreur={v.erreur(e.fin)}>
          <input className="input" id="ast-fin" type="time" value={fin} onChange={ev => setFin(ev.target.value)} />
        </Field>
      </div>
      {motifVisible && (
        <Field label={<>Circonstances exceptionnelles{!pr?.court && <span className="who"> · facultatif</span>}</>} htmlFor="ast-motif" requis={!!pr?.court} erreur={v.erreur(e.motif)}>
          <textarea className="input short" id="ast-motif" rows={2} maxLength={MOTIF_ASTREINTE_MAX + 20} value={motif} onChange={ev => setMotif(ev.target.value)}
            placeholder="Remplacement d’un salarié absent, panne d’un équipement critique…" style={{ resize: 'vertical' }} />
          <span className="text-muted sub">Communiqué au salarié dans l’e-mail ; visible de son manager et du service RH, jamais recopié au journal</span>
        </Field>
      )}
      {pr?.court && !pr.refus && <Fine muted={false}>{delaiCourtTexte(pr, s)}.</Fine>}
      {emp && <Controles msgs={r.avertissements.map(text => ({ text, bad: false }))} />}
      {v.tente && e.general && <Bloquant>{e.general}</Bloquant>}
      <Fine>
        {heures != null ? `${fH(heures)} d’astreinte. ` : ''}
        Programmation communiquée au salarié aujourd’hui, par e-mail avec l’événement pour son agenda, au moins {reglagesAstreinte(s).astreinteDelaiPrevenance} jours
        avant le début (art. R3121-3). Les interventions se déclarent ensuite sur sa feuille de temps : du travail effectif, suivi d’un repos de 11 heures.
      </Fine>
    </Dialog>
  );
}
