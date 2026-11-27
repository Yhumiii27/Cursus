// Répondants d'un feedback 360° (lot 12, chantier C3, étape 3 ; `feedback360.solliciter`, règles :
// shared/rules/feedback360.ts). Le salarié propose des collègues, son N+2 ou des collaborateurs qu'il encadre (internes
// seulement) ; l'évaluateur valide ces propositions (cochées) et peut en ajouter : la sollicitation part alors à chacun,
// la fenêtre de réponse s'ouvre. 3 répondants au moins (seuil de restitution), 8 au plus. La relation à l'évalué est
// déduite de l'organisation par le serveur. Ouvert depuis le compte rendu, qu'il rouvre ensuite.
import { useState } from 'react';
import { collecte360, SOLLICITATIONS_MAX } from '../../../shared/rules/feedback360.ts';
import { ChoixCollaborateur, type Suggere } from '../components/ChoixCollaborateur.tsx';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { useEvaluateur } from '../components/EntretienSuivi.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

export function Feedback360SolliciterDialog({ entretienId, retour }: { entretienId: number; retour?: number }) {
  const d = useDomain();
  const { me, soi } = useRole();
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
  const nom = (id: number) => d.ds.annuaire.find(p => p.id === id)?.nom ?? d.emp(id)?.nom ?? t('Employee#salarie');
  const deja = new Set(actives.map(s => s.repondantEmpId));
  // Personnes proposables : l'annuaire, hors l'évalué, son évaluateur (manager valideur), soi-même et ceux déjà sollicités.
  const mgr = d.mgrOf(e);
  const candidats: Suggere[] = d.ds.annuaire
    .filter(p => p.id !== e.id && p.id !== mgr && p.id !== me && p.id !== soi && !deja.has(p.id) && !ajoutes.includes(p.id))
    .map(p => ({ ...p, matriculePaie: '' }));
  const envoyees = collecte360(d.ds.feedbackSollicitations ?? [], entretienId).envoyees;
  const choisis = [...(evaluateur ? coches : []), ...ajoutes];
  const seuil = d.ds.settings.feedback360Seuil;
  const totalActives = actives.length + ajoutes.length;
  const choixErr = !choisis.length ? t(evaluateur ? 'Tick or add at least one respondent.' : 'Add at least one respondent.')
    : evaluateur && envoyees + choisis.length < seuil ? `${t('Ask at least ')}${seuil}${t(' respondents in all: below, nothing could be passed on.')}`
      : totalActives > SOLLICITATIONS_MAX ? `${SOLLICITATIONS_MAX}${t(' respondents at most per review.')}` : null;

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
    <Dialog title={`${t(evaluateur ? 'Ask respondents' : 'Propose respondents')} — ${t('360° feedback#lower')}`} width={560} onSubmit={envoyer} fermer={retour ? revenir : undefined} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t(evaluateur ? 'Send the requests' : 'Propose')}</SubmitButton>
    </>}>
      <div className="text-muted sub">{e.nom} · {tn(envoyees, 'respondent already asked', 'respondents already asked')}{proposees.length ? ` · ${tn(proposees.length, 'proposed', 'proposed#plural')}` : ''}</div>
      {evaluateur && proposees.length > 0 && (
        <Field label={t('Respondents proposed by the employee')}>
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
      <Field label={t('Add a respondent')} htmlFor="f360-repondant" erreur={v.erreur(choixErr)}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <ChoixCollaborateur id="f360-repondant" emps={candidats} valeur={choix} onChange={setChoix} placeholder={t('Name of a colleague')} style={{ flex: '1 1 220px' }} />
          <button type="button" className="btn btn-secondary" disabled={choix == null} onClick={ajouter}>{t('Add')}</button>
        </div>
      </Field>
      {ajoutes.length > 0 && (
        <div className="list">
          {ajoutes.map(id => (
            <div key={id} className="list-row">
              <div className="grow" style={{ fontSize: 14 }}>{nom(id)}</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAjoutes(a => a.filter(y => y !== id))}>{t('Remove')}</button>
            </div>
          ))}
        </div>
      )}
      <Fine>
        {t('Colleagues, N+2 manager or managed employees, never an outside person; ')}{seuil}{t(' at least, ')}{SOLLICITATIONS_MAX}{t(' at most.')}
        {t(evaluateur ? ' Each one receives a message without the name of the person reviewed and answers in “Feedback requested”; they may decline.' : ' Your reviewer approves your proposals before asking them.')}
      </Fine>
    </Dialog>
  );
}
