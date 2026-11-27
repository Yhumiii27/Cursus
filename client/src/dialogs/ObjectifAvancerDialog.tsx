// Avancement d'un objectif en cours (lot 12, chantier C3 ; `objectif.avancer`) : de 0 à 100 %, par le salarié (avec un
// court commentaire, le sien) ou par son évaluateur. L'historique des avancements n'est pas gardé : seule la dernière
// valeur, datée ; le journal note le pourcentage, jamais le commentaire. Pas de saisie hors ligne au premier temps.
import { useState } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { COMMENTAIRE_SAL_MAX } from '../../../shared/rules/objectifs.ts';
import { derniereMiseAJour } from '../../../shared/rules/objectifs-suivi.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Bar, Fine } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function ObjectifAvancerDialog({ id, retour }: { id: number; retour?: number }) {
  const d = useDomain();
  const { collab, me } = useRole();
  const { run, openDialog, closeDialog } = useStore();
  const o = (d.ds.objectifs ?? []).find(y => y.id === id);
  const [avancement, setAvancement] = useState(String(o?.avancement ?? 0));
  const [commentaire, setCommentaire] = useState(o?.commentaireSal ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const e = o ? d.emp(o.empId) : undefined;
  if (!o || !e) return null;
  // Le commentaire est celui du salarié : l'évaluateur s'exprime à l'évaluation (refus du serveur sinon).
  const salarie = collab && o.empId === me;
  const n = Number(avancement);
  const avancementErr = !avancement.trim() ? t('Enter the progress.') : !Number.isInteger(n) || n < 0 || n > 100 ? t('A whole number from 0 to 100.') : null;
  const commentaireErr = commentaire.trim().length > COMMENTAIRE_SAL_MAX ? t(`${COMMENTAIRE_SAL_MAX} characters at most.`) : null;
  const revenir = () => (retour ? openDialog({ type: 'ent', entId: retour }) : closeDialog());

  const envoyer = async () => {
    if (busy || !v.verifier(avancementErr, commentaireErr)) return;
    setBusy(true);
    const r = await run('objectif.avancer', { id: o.id, avancement: n, ...(salarie ? { commentaire } : {}) });
    setBusy(false);
    if (r.ok) revenir();
  };

  return (
    <Dialog title={`${t('Progress')} — ${salarie ? t('my objective') : e.nom}`} width={520} onSubmit={envoyer} fermer={retour ? revenir : undefined} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Save the progress')}</SubmitButton>
    </>}>
      <div>
        <div style={{ fontSize: 14 }}>{o.libelle}</div>
        <div className="text-muted sub">{o.echeance ? `${t('Due on ')}${fmtIso(o.echeance)} · ` : ''}{t('last update on ')}{fmtIso(derniereMiseAJour(o))}</div>
      </div>
      <Field label={t('Progress (%)')} htmlFor="obj-avancement" requis erreur={v.erreur(avancementErr)}>
        <input className="input" id="obj-avancement" type="number" min={0} max={100} step={5} value={avancement} onChange={ev => setAvancement(ev.target.value)} style={{ maxWidth: 120 }} />
      </Field>
      {!avancementErr && <Bar pct={n} />}
      {salarie && (
        <Field label={t('Comment (optional)')} htmlFor="obj-commentaire" erreur={v.erreur(commentaireErr)}>
          <textarea className="input mid" id="obj-commentaire" rows={2} value={commentaire} maxLength={COMMENTAIRE_SAL_MAX} onChange={ev => setCommentaire(ev.target.value)} />
        </Field>
      )}
      <Fine>{t(salarie ? 'Your reviewer sees the progress and your comment; the action log keeps only the percentage.' : 'The employee sees the progress in “My objectives”.')}</Fine>
    </Dialog>
  );
}
