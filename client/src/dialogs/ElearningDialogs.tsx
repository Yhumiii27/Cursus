// lot 12 — C4 (organismes de formation et e-learning) : dialogues des inscriptions aux modules d'e-learning (onglet
// E-learning de l'écran Formations) : inscription d'un ou plusieurs salariés, ou de l'équipe d'une ligne du plan (droit
// « formations ») ; fin validée par le service RH (formation suivie d'origine « elearning » et, module rattaché au
// catalogue et réussi, certification par le circuit existant) ; correction motivée d'une inscription ouverte. Le serveur
// vérifie droits et états (server/src/actions/elearning.ts) ; le motif reste au service RH, jamais au journal.
import { useState } from 'react';
import { fmtIso, plural } from '../../../shared/format.ts';
import { erreurMotifCorrection, MOTIF_CORRECTION_MAX } from '../../../shared/rules/corrections.ts';
import { present } from '../../../shared/rules/contrats.ts';
import { avancementDe, heuresRetenues, inscriptionOuverteDe, STATUT_INSCRIPTION_LABEL } from '../../../shared/rules/elearning.ts';
import { dureeValide } from '../../../shared/rules/heures-formation.ts';
import { ChoixCollaborateur } from '../components/ChoixCollaborateur.tsx';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Btn, Chips, Fine, NoteAccent, Seg } from '../components/ui.tsx';
import { AIDE_MOTIF_CORRECTION } from '../state/confirmations-corrections.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Inscription à un module : salariés choisis un à un, ou membres présents de l'équipe d'une ligne du plan. */
export function ElearningInscrireDialog({ moduleId, empId, planActionId }: { moduleId?: number | null; empId?: number | null; planActionId?: number | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const modules = (d.ds.modulesElearning ?? []).filter(m => !m.archive).sort((a, b) => a.code.localeCompare(b.code));
  const [module, setModule] = useState(moduleId != null ? String(moduleId) : modules.length === 1 ? String(modules[0].id) : '');
  const [mode, setMode] = useState<'salaries' | 'plan'>(planActionId != null ? 'plan' : 'salaries');
  const [choisis, setChoisis] = useState<number[]>(empId != null ? [empId] : []);
  const [courant, setCourant] = useState<number | null>(null);
  const [ligne, setLigne] = useState(planActionId != null ? String(planActionId) : '');
  const [echeance, setEcheance] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const presents = d.ds.employes.filter(e => present(e, d.ti));
  const exercice = Number(d.ti.slice(0, 4));
  const lignes = d.ds.plan.filter(l => l.exercice >= exercice - 1 && l.statut !== 'realise' && l.statut !== 'reporte');
  const l = lignes.find(x => x.id === Number(ligne)) ?? null;
  const m = modules.find(x => x.id === Number(module)) ?? null;
  const cibles = mode === 'plan' ? (l ? presents.filter(e => e.equipe === l.equipe).map(e => e.id) : []) : choisis;
  const deja = m ? cibles.filter(id => inscriptionOuverteDe(d.ds.inscriptionsElearning, id, m.id)).length : 0;
  const errModule = m ? null : 'Choisissez le module.';
  const errCibles = mode === 'plan' ? (!l ? 'Choisissez la ligne du plan.' : !cibles.length ? 'Aucun salarié présent dans cette équipe.' : null)
    : !choisis.length ? 'Ajoutez au moins un salarié.' : null;
  const errEcheance = echeance && echeance < d.ti ? 'L’échéance est passée.' : null;
  const ajouter = (id: number | null) => { if (id != null && !choisis.includes(id)) setChoisis([...choisis, id]); setCourant(null); };
  const envoyer = async () => {
    if (busy || !v.verifier(errModule, errCibles, errEcheance)) return;
    setBusy(true);
    const r = await run('elearning.inscrire', { moduleId: m!.id, ...(mode === 'plan' ? { planActionId: l!.id } : { empIds: choisis }), echeance });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  const nomLigne = (x: (typeof lignes)[number]) => `${x.f ? d.fm(x.f)?.court ?? x.f : x.libelle} — ${x.equipe} · ${x.periode} ${x.exercice}`;
  return (
    <Dialog title="Inscrire à un module d’e-learning" width={600} tall onSubmit={envoyer}
      actions={<><CancelButton /><SubmitButton busy={busy}>{cibles.length > 1 ? `Inscrire ${plural(cibles.length - deja, 'salarié', 'salariés')}` : 'Inscrire'}</SubmitButton></>}>
      {modules.length === 0 ? <Bloquant>Aucun module en vigueur : ajoutez-en dans Référentiels → Modules e-learning.</Bloquant> : <>
        <Field label="Module" htmlFor="ei-module" requis erreur={v.erreur(errModule)}>
          <select className="input" id="ei-module" autoFocus value={module} onChange={e => setModule(e.target.value)}>
            <option value="">Choisir…</option>
            {modules.map(x => <option key={x.id} value={x.id}>{x.code} — {x.intitule}</option>)}
          </select>
        </Field>
        <Seg name="eiMode" label="Qui inscrire" value={mode} onChange={setMode} options={[['salaries', 'Des salariés'], ['plan', 'L’équipe d’une ligne du plan']]} style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }} />
        {mode === 'salaries' ? (
          <Field label="Salariés" htmlFor="ei-emp" requis erreur={v.erreur(errCibles)}>
            <ChoixCollaborateur id="ei-emp" emps={presents.filter(e => !choisis.includes(e.id))} valeur={courant} onChange={ajouter} placeholder="Ajouter un salarié…" />
            {choisis.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                {choisis.map(id => (
                  <Btn key={id} small onClick={() => setChoisis(choisis.filter(x => x !== id))} title="Retirer de la liste">{d.emp(id)?.nom ?? id} ✕</Btn>
                ))}
              </div>
            )}
          </Field>
        ) : (
          <Field label="Ligne du plan" htmlFor="ei-plan" requis erreur={v.erreur(errCibles)}>
            <select className="input" id="ei-plan" value={ligne} onChange={e => setLigne(e.target.value)}>
              <option value="">Choisir…</option>
              {lignes.map(x => <option key={x.id} value={x.id}>{nomLigne(x)}</option>)}
            </select>
          </Field>
        )}
        {mode === 'plan' && l && <Chips items={cibles.map(id => ({ key: id, label: d.emp(id)?.nom ?? String(id), cls: 'tag-neutral' }))} />}
        <Field label="Échéance (facultative)" htmlFor="ei-echeance" erreur={errEcheance}>
          <input className="input" id="ei-echeance" type="date" value={echeance} min={d.ti} onChange={e => setEcheance(e.target.value)} />
        </Field>
        {deja > 0 && <NoteAccent>{plural(deja, 'salarié est déjà inscrit', 'salariés sont déjà inscrits')} à ce module : {deja > 1 ? 'ils sont passés' : 'il est passé'}.</NoteAccent>}
        <Fine>Le salarié retrouve le module et son lien dans son espace (Mes modules en ligne). Le suivi se limite au statut, à l’avancement et à la fin.</Fine>
      </>}
    </Dialog>
  );
}

/** Fin d'un module validée par le service RH : date, heures retenues, réussite. */
export function ElearningTerminerDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [i] = useState(() => (d.ds.inscriptionsElearning ?? []).find(x => x.id === id && !x.annuleLe) ?? null);
  const m = i ? (d.ds.modulesElearning ?? []).find(x => x.id === i.moduleId) ?? null : null;
  const [le, setLe] = useState(i?.avancementLe && i.avancement === 100 ? i.avancementLe : i?.declareLe ?? d.ti);
  const h = i && m ? heuresRetenues(i, m) : null;
  const [heures, setHeures] = useState(h != null ? String(h) : '');
  const [reussi, setReussi] = useState<'oui' | 'non' | 'so'>(i?.reussi === false ? 'non' : i?.reussi === true || m?.formation ? 'oui' : 'so');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const fm = m?.formation ? d.fm(m.formation) : null;
  const n = heures.trim() ? Number(heures.replace(',', '.')) : null;
  const errLe = !le ? 'Indiquez la date de fin.' : le > d.ti ? 'La date ne peut pas être dans le futur.' : i && le < i.inscritLe ? `La date précède l’inscription (${fmtIso(i.inscritLe)}).` : null;
  const errHeures = n !== null && !dureeValide(n) ? 'Nombre de 0,25 à 2 000.' : null;
  const envoyer = async () => {
    if (busy || !v.verifier(errLe, errHeures, !i)) return;
    setBusy(true);
    const r = await run('elearning.terminer', { id, de: i!.statut, termineLe: le, heures: heures.trim(), reussi: reussi === 'oui' ? true : reussi === 'non' ? false : null });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title="Valider la fin du module" width={520} onSubmit={envoyer}
      actions={!i ? <CancelButton label="Fermer" /> : <><CancelButton /><SubmitButton busy={busy}>Valider la fin</SubmitButton></>}>
      {!i || !m ? <Bloquant>Cette inscription n’existe plus.</Bloquant> : <>
        <Field label="Inscription"><Static pad>{d.emp(i.empId)?.nom ?? '—'} · {m.code} — {m.intitule}</Static></Field>
        {i.declareLe && <p className="text-muted sub" style={{ margin: 0 }}>Fin déclarée par le salarié le {fmtIso(i.declareLe)}.</p>}
        {i.avancement != null && <p className="text-muted sub" style={{ margin: 0 }}>Avancement {i.avancement} %{i.avancementLe ? ` au ${fmtIso(i.avancementLe)}` : ''}{i.avancementSource === 'import' ? ' (import)' : ''}.</p>}
        <div className="grid-2">
          <Field label="Terminé le" htmlFor="et-le" requis erreur={le ? errLe : v.erreur(errLe)}>
            <input className="input" id="et-le" type="date" value={le} max={d.ti} onChange={e => setLe(e.target.value)} />
          </Field>
          <Field label="Heures retenues" htmlFor="et-heures" erreur={errHeures}>
            <input className="input tnum" id="et-heures" inputMode="decimal" value={heures} placeholder={m.dureeHeures != null ? String(m.dureeHeures) : 'inconnues'} onChange={e => setHeures(e.target.value)} />
          </Field>
        </div>
        <Seg name="etReussi" label="Réussite" value={reussi} onChange={setReussi} options={[['oui', 'Réussi'], ['non', 'Non réussi'], ['so', 'Sans objet']]} style={{ alignSelf: 'flex-start' }} />
        {m.attestationRequise && <NoteAccent>Attestation exigée : joignez-la à la formation suivie ou à la certification créée (pièces justificatives).</NoteAccent>}
        <Fine>
          Une formation suivie d’origine « e-learning » est créée{fm ? `, et la certification ${fm.court} si le module est réussi` : ''}. Les heures comptent une
          seule fois dans le plan et les indicateurs.
        </Fine>
      </>}
    </Dialog>
  );
}

/** Correction motivée d'une inscription ouverte : échéance, avancement saisi par le service RH. */
export function ElearningCorrigerDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [i] = useState(() => (d.ds.inscriptionsElearning ?? []).find(x => x.id === id && !x.annuleLe) ?? null);
  const m = i ? (d.ds.modulesElearning ?? []).find(x => x.id === i.moduleId) ?? null : null;
  const [echeance, setEcheance] = useState(i?.echeance ?? '');
  const [avancement, setAvancement] = useState(i?.avancement != null ? String(i.avancement) : '');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const a = avancementDe(avancement);
  const errAvancement = Number.isNaN(a) ? 'Nombre de 0 à 100.' : null;
  const errEcheance = echeance && i && echeance < i.inscritLe ? `La date précède l’inscription (${fmtIso(i.inscritLe)}).` : null;
  // Seuls les champs changés partent : un avancement inchangé garde sa source (import, service RH) et sa date.
  const echeanceChangee = !!i && (echeance || null) !== i.echeance, avancementChange = !!i && (Number.isNaN(a) || a !== i.avancement);
  const change = echeanceChangee || avancementChange;
  const errChange = change ? null : 'Aucune modification.';
  const errMotif = erreurMotifCorrection(motif);
  const envoyer = async () => {
    if (busy || !v.verifier(errAvancement, errEcheance, errChange, errMotif, !i)) return;
    setBusy(true);
    const r = await run('elearning.corriger', { id, ...(echeanceChangee ? { echeance } : {}), ...(avancementChange ? { avancement } : {}), motif });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title="Corriger l’inscription" width={520} onSubmit={envoyer}
      actions={!i ? <CancelButton label="Fermer" /> : <><CancelButton /><SubmitButton busy={busy}>Enregistrer</SubmitButton></>}>
      {!i || !m ? <Bloquant>Cette inscription n’existe plus.</Bloquant> : <>
        <Field label="Inscription"><Static pad>{d.emp(i.empId)?.nom ?? '—'} · {m.code} · {STATUT_INSCRIPTION_LABEL[i.statut]}</Static></Field>
        <div className="grid-2">
          <Field label="Échéance" htmlFor="ec-echeance" erreur={errEcheance}>
            <input className="input" id="ec-echeance" type="date" value={echeance} onChange={e => setEcheance(e.target.value)} />
          </Field>
          <Field label="Avancement (%)" htmlFor="ec-avancement" erreur={errAvancement}>
            <input className="input tnum" id="ec-avancement" inputMode="numeric" value={avancement} placeholder="0 à 100" onChange={e => setAvancement(e.target.value)} />
          </Field>
        </div>
        {v.erreur(errChange) && <Bloquant>{errChange}</Bloquant>}
        <Field label="Motif de la correction" htmlFor="ec-motif" requis erreur={motif.trim() ? errMotif : v.erreur(errMotif)}>
          <textarea className="input" id="ec-motif" rows={2} value={motif} maxLength={MOTIF_CORRECTION_MAX} placeholder="Échéance repoussée, avancement relevé sur la plateforme…" onChange={e => setMotif(e.target.value)} />
        </Field>
        <Fine>{AIDE_MOTIF_CORRECTION}</Fine>
      </>}
    </Dialog>
  );
}
