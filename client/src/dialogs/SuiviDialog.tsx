// Type de suivi médical d'un collaborateur (service RH) : VIP, VIP adaptée (travail de nuit, handicap, invalidité) ou
// suivi individuel renforcé, ou rien (VIP par défaut). Une habilitation ou un poste marqués « SIR » au référentiel placent
// le salarié en suivi renforcé quel que soit le type saisi (shared/rules/suivi-medical.ts). Réservé au service RH et à
// l'intéressé : le manager ne voit que le verdict d'aptitude. Case « exposé à des risques particuliers » (ou celle du poste,
// Référentiels) : visite post-exposition ou de fin de carrière proposée à la sortie (shared/rules/visites-dues.ts).
import { useState } from 'react';
import { posteDe } from '../../../shared/rules/exigences.ts';
import { periodicite, SUIVIS_MEDICAUX } from '../../../shared/rules/suivi-medical.ts';
import type { SuiviMedical } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton } from '../components/Dialog.tsx';
import { Fine, NoteAccent } from '../components/ui.tsx';
import { useEnriched, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Choix proposés : un des types, ou aucun (VIP par défaut). */
type Choix = SuiviMedical | '';

export function SuiviDialog({ empId }: { empId: number }) {
  const { d, emps } = useEnriched();
  const { rh } = useRole();
  const { run, closeDialog } = useStore();
  const emp = emps.find(e => e.id === empId);
  const [choix, setChoix] = useState<Choix>(() => emp?.suivi ?? '');
  const [expose, setExpose] = useState(() => !!emp?.expose);
  const [busy, setBusy] = useState(false);
  if (!emp || !rh) return null;
  const suivi = emp.med.suivi;
  const s = d.ds.settings;
  const rythme = (t: SuiviMedical) => (t === 'sir'
    ? `visite intermédiaire à ${periodicite('sir', s)} mois, examen d’aptitude à ${s.santeSirAptitudeMois ?? 48} mois`
    : `visite tous les ${periodicite(t, s)} mois`);

  const enregistrer = async () => {
    if (busy) return;
    setBusy(true);
    const r = await run('medical.suivi', { empId, suivi: choix || null, expose });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  const options: [Choix, string, string][] = [
    ['', 'Non précisé', `VIP par défaut — ${rythme('vip')}`],
    ...(Object.keys(SUIVIS_MEDICAUX) as SuiviMedical[]).map((k): [Choix, string, string] => [k, SUIVIS_MEDICAUX[k].label, `${SUIVIS_MEDICAUX[k].article} — ${rythme(k)}`]),
  ];
  return (
    <Dialog title="Type de suivi médical" width={560} onSubmit={enregistrer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer</SubmitButton>
    </>}>
      <Field label="Collaborateur"><Static>{emp.nom} · {emp.poste}</Static></Field>
      {suivi?.deduit && (
        <NoteAccent>
          Suivi individuel renforcé déduit du référentiel ({suivi.origines.join(', ')}) : il s’applique quel que soit le type choisi ici.
        </NoteAccent>
      )}
      <Field label="Type de suivi">
        <div role="radiogroup" aria-label="Type de suivi" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {options.map(([k, label, sub]) => (
            <label key={k || 'aucun'} className={`radio radio-opt${choix === k ? ' checked' : ''}`}>
              <input type="radio" name="su-type" checked={choix === k} onChange={() => setChoix(k)} />
              <span className="dot" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14 }}>{label}</div>
                <div className="text-muted sub">{sub}</div>
              </div>
            </label>
          ))}
        </div>
      </Field>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
        <input type="checkbox" checked={expose} onChange={e => setExpose(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
        Exposé à des risques particuliers (agents chimiques dangereux, CMR, ATEX…) : visite post-exposition à sa sortie (art. L4624-2-1)
      </label>
      {posteDe(d.ds, emp)?.expose && <Fine>Le poste {emp.poste} est coché « exposé à des risques particuliers » au référentiel : la visite est proposée à la sortie quelle que soit cette case.</Fine>}
      <Fine>
        La date de la prochaine visite fixée par le médecin du travail, saisie avec son avis, prime toujours sur ces périodicités
        (Paramètres → Santé). Le manager ne voit ni le type de suivi, ni l’exposition, ni la date de la prochaine visite.
      </Fine>
    </Dialog>
  );
}
