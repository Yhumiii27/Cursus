// Répondants d'un feedback 360° (lot 12, chantier C3, étape 3 ; `feedback360.solliciter`, règles :
// shared/rules/feedback360.ts). Le salarié propose des collègues, son N+2 ou des collaborateurs qu'il encadre (internes
// seulement) ; l'évaluateur valide ces propositions (cochées) et peut en ajouter : la sollicitation part alors à chacun,
// la fenêtre de réponse s'ouvre. 3 répondants au moins (seuil de restitution), 8 au plus. La relation à l'évalué est
// déduite de l'organisation par le serveur. Ouvert depuis le compte rendu, qu'il rouvre ensuite.
import { useState } from 'react';
import { plural } from '../../../shared/format.ts';
import { collecte360, SOLLICITATIONS_MAX } from '../../../shared/rules/feedback360.ts';
import { ChoixCollaborateur, type Suggere } from '../components/ChoixCollaborateur.tsx';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { useEvaluateur } from '../components/EntretienSuivi.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function Feedback360SolliciterDialog({ entretienId, retour }: { entretienId: number; retour?: number }) {
  const d = useDomain();
  const { me } = useRole();
  const { run, openDialog, closeDialog } = useStore();
  const x = d.ds.entretiens.find(y => y.id === entretienId);
  const e = x ? d.emp(x.empId) : undefined;
  const evaluateur = useEvaluateur(e);
  const actives = (d.ds.feedbackSollicitations ?? []).filter(s => s.entretienId === entretienId && s.statut !== 'annulee');
  const proposees = actives.filter(s => s.statut === 'proposee');
  const [coches, setCoches] = useState<number[]>(() => proposees.map(s => s.repondantEmpId));
  const [ajoutes, setAjoutes] = useState<number[]>([]);
  const [choix, setChoix] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!x || !e) return null;
  const revenir = () => (retour ? openDialog({ type: 'ent', entId: retour }) : closeDialog());
  const nom = (id: number) => d.ds.annuaire.find(p => p.id === id)?.nom ?? d.emp(id)?.nom ?? 'Salarié';
  const deja = new Set(actives.map(s => s.repondantEmpId));
  // Personnes proposables : l'annuaire, hors l'évalué, son évaluateur (manager valideur), soi-même et ceux déjà sollicités.
  const mgr = d.mgrOf(e);
  const candidats: Suggere[] = d.ds.annuaire
    .filter(p => p.id !== e.id && p.id !== mgr && p.id !== me && !deja.has(p.id) && !ajoutes.includes(p.id))
    .map(p => ({ ...p, matriculePaie: '' }));
  const envoyees = collecte360(d.ds.feedbackSollicitations ?? [], entretienId).envoyees;
  const choisis = [...(evaluateur ? coches : []), ...ajoutes];
  const seuil = d.ds.settings.feedback360Seuil;
  const totalActives = actives.length + ajoutes.length;
  const choixErr = !choisis.length ? (evaluateur ? 'Cochez ou ajoutez au moins un répondant.' : 'Ajoutez au moins un répondant.')
    : evaluateur && envoyees + choisis.length < seuil ? `Sollicitez au moins ${seuil} répondants en tout : en dessous, rien ne pourrait être restitué.`
      : totalActives > SOLLICITATIONS_MAX ? `${SOLLICITATIONS_MAX} répondants au plus par entretien.` : null;

  const ajouter = () => {
    if (choix == null) return;
    setAjoutes(a => [...a, choix]);
    setChoix(null);
  };
  const envoyer = async () => {
    if (busy || !v.verifier(choixErr)) return;
    setBusy(true);
    const r = await run('feedback360.solliciter', { entretienId, repondantIds: choisis });
    setBusy(false);
    if (r.ok) revenir();
  };

  return (
    <Dialog title={`${evaluateur ? 'Solliciter des répondants' : 'Proposer des répondants'} — feedback 360°`} width={560} onSubmit={envoyer} fermer={retour ? revenir : undefined} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{evaluateur ? 'Envoyer les sollicitations' : 'Proposer'}</SubmitButton>
    </>}>
      <div className="text-muted sub">{e.nom} · {plural(envoyees, 'répondant déjà sollicité', 'répondants déjà sollicités')}{proposees.length ? ` · ${plural(proposees.length, 'proposé', 'proposés')}` : ''}</div>
      {evaluateur && proposees.length > 0 && (
        <Field label="Répondants proposés par le salarié">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {proposees.map(s => (
              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
                <input type="checkbox" checked={coches.includes(s.repondantEmpId)} style={{ accentColor: 'var(--color-accent)' }}
                  onChange={ev => setCoches(c => (ev.target.checked ? [...c, s.repondantEmpId] : c.filter(y => y !== s.repondantEmpId)))} />
                {nom(s.repondantEmpId)}
              </label>
            ))}
          </div>
        </Field>
      )}
      <Field label="Ajouter un répondant" htmlFor="f360-repondant" erreur={v.erreur(choixErr)}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <ChoixCollaborateur id="f360-repondant" emps={candidats} valeur={choix} onChange={setChoix} placeholder="Nom d’un collègue" style={{ flex: '1 1 220px' }} />
          <button type="button" className="btn btn-secondary" disabled={choix == null} onClick={ajouter}>Ajouter</button>
        </div>
      </Field>
      {ajoutes.length > 0 && (
        <div className="list">
          {ajoutes.map(id => (
            <div key={id} className="list-row">
              <div className="grow" style={{ fontSize: 14 }}>{nom(id)}</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAjoutes(a => a.filter(y => y !== id))}>Retirer</button>
            </div>
          ))}
        </div>
      )}
      <Fine>
        Collègues, responsable N+2 ou collaborateurs encadrés, jamais de personne extérieure ; {seuil} au moins, {SOLLICITATIONS_MAX} au plus.
        {evaluateur ? ' Chacun reçoit un message sans le nom de la personne évaluée et répond dans « Avis demandés » ; il peut décliner.' : ' Votre évaluateur valide vos propositions avant de les solliciter.'}
      </Fine>
    </Dialog>
  );
}
