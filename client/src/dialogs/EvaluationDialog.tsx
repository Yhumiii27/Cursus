// Évaluation d'une formation (lot 7, chantier C, t121 ; shared/rules/evaluation-formation.ts) : avis à chaud du salarié
// (note de 1 à 5) ou efficacité à froid (efficace, partiellement, pas efficace), avec un commentaire facultatif. Ouvert par
// le salarié (Mon espace), son manager (Formations, avis de manager à froid) ou le service RH (détail de la session : avis
// recueilli au nom du salarié). Une nouvelle saisie remplace la précédente ; l'auteur de l'avis peut le retirer, après
// confirmation. Fenêtres de saisie et formations concernées : `refusEvaluation`, commun avec le serveur.
import { useState } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import {
  ciblesEvaluation, COMMENTAIRE_EVALUATION_MAX, EFFICACITE_LABEL, evaluationDe, NOTE_MAX, NOTE_MIN, refusEvaluation, TYPE_EVALUATION_LABEL,
} from '../../../shared/rules/evaluation-formation.ts';
import type { EfficaciteFormation, RepondantEvaluation, TypeEvaluation } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Btn, Fine, Seg } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

const NOTES: [string, string][] = Array.from({ length: NOTE_MAX - NOTE_MIN + 1 }, (_, i) => String(NOTE_MIN + i)).map(n => [n, n]);
const EFFICACITES = Object.entries(EFFICACITE_LABEL) as [EfficaciteFormation, string][];
/** Libellé de la note : 1 « pas du tout satisfait » … 5 « très satisfait ». */
const ECHELLE = '1 : pas du tout satisfait · 5 : très satisfait';

export function EvaluationDialog({ cle, quand, repondant: demande }: { cle: string; quand: TypeEvaluation; repondant?: RepondantEvaluation }) {
  const d = useDomain();
  const { rh, manager, me, soi } = useRole();
  const { run, closeDialog } = useStore();
  const c = ciblesEvaluation(d).find(x => x.cle === cle);
  // De qui est l'avis : le sien ; celui du manager sur son équipe ; sinon recueilli par le service RH.
  const sienne = !!c && c.empId === soi && !(rh && demande === 'manager');
  const repondant: RepondantEvaluation = sienne ? 'salarie' : manager && c?.empId !== me ? 'manager' : demande ?? 'salarie';
  const avant = c ? evaluationDe(d.ds.evaluationsFormation, c, quand, repondant) : null;
  const [note, setNote] = useState(avant?.note != null ? String(avant.note) : '');
  const [efficacite, setEfficacite] = useState<EfficaciteFormation | ''>(avant?.efficacite ?? '');
  const [commentaire, setCommentaire] = useState(avant?.commentaire ?? '');
  const [busy, setBusy] = useState(false);
  const [retirer, setRetirer] = useState(false);
  const v = useVerification();
  if (!c) {
    return (
      <Dialog title="Évaluer une formation" actions={<CancelButton label="Fermer" />}>
        <Bloquant>Cette formation n’est plus évaluable (session rouverte, formation suivie annulée).</Bloquant>
      </Dialog>
    );
  }
  const refus = refusEvaluation(d.ds.settings, d.ti, c, quand, repondant, rh && !sienne);
  const erreurNote = quand === 'chaud' && !note ? 'Choisissez une note de 1 à 5' : null;
  const erreurEfficacite = quand === 'froid' && !efficacite ? 'Choisissez une réponse' : null;
  const qui = sienne ? '' : repondant === 'manager' && !manager ? ' — avis du manager' : ` — ${d.personName(c.empId)}`;

  const envoyer = async () => {
    if (busy || !v.verifier(refus, erreurNote, erreurEfficacite)) return;
    setBusy(true);
    const r = await run('evaluation.enregistrer', {
      participationId: c.participationId, formationSuivieId: c.formationSuivieId, type: quand, repondant,
      ...(quand === 'chaud' ? { note: Number(note) } : { efficacite }), commentaire: commentaire.trim(),
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  const supprimer = async () => {
    setBusy(true);
    const r = await run('evaluation.retirer', { id: avant!.id });
    setBusy(false);
    if (r.ok) closeDialog();
    else setRetirer(false);
  };

  return (
    <Dialog title={`Évaluation ${TYPE_EVALUATION_LABEL[quand].toLowerCase()}${qui}`} width={560} onSubmit={envoyer}
      confirmation={retirer ? {
        texte: 'Retirer cet avis ? Il ne comptera plus dans les indicateurs de la formation ; il pourra être donné de nouveau tant que l’évaluation est ouverte.',
        bouton: 'Retirer l’avis', occupe: busy, confirmer: supprimer, annuler: () => setRetirer(false),
      } : null}
      actions={<>
        {avant && <Btn onClick={() => setRetirer(true)} disabled={busy}>Retirer l’avis</Btn>}
        <CancelButton />
        <SubmitButton busy={busy}>{avant ? 'Modifier l’avis' : 'Enregistrer l’avis'}</SubmitButton>
      </>}>
      <div className="grid-2">
        <Field label="Formation"><Static>{c.intitule}<div className="text-muted sub">{c.organisme}</div></Static></Field>
        <Field label={c.fin === c.debut ? 'Date' : 'Dates'}><Static>{c.fin === c.debut ? fmtIso(c.fin) : `du ${fmtIso(c.debut)} au ${fmtIso(c.fin)}`}</Static></Field>
      </div>
      {refus && <Bloquant>{refus}.</Bloquant>}
      {quand === 'chaud' ? (
        <Field label={sienne ? 'Votre satisfaction' : 'Satisfaction du salarié'} requis erreur={v.erreur(erreurNote)}>
          <Seg name="eval-note" label="Note de 1 à 5" value={note} options={NOTES} onChange={setNote} style={{ alignSelf: 'flex-start' }} />
          <span className="text-muted sub">{ECHELLE}</span>
        </Field>
      ) : (
        <Field label={repondant === 'manager' ? 'La formation a-t-elle été efficace pour ce salarié ?' : 'La formation vous a-t-elle été utile dans votre travail ?'} requis erreur={v.erreur(erreurEfficacite)}>
          <Seg name="eval-efficacite" label="Efficacité de la formation" value={efficacite} options={EFFICACITES} onChange={setEfficacite} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }} />
        </Field>
      )}
      <Field label="Commentaire (facultatif)" htmlFor="eval-comm">
        <textarea className="input short" id="eval-comm" rows={3} maxLength={COMMENTAIRE_EVALUATION_MAX} value={commentaire} onChange={e => setCommentaire(e.target.value)}
          placeholder={quand === 'chaud' ? 'Contenu, animation, organisation, ce qui vous servira…' : 'Ce qui a changé dans le travail, ce qui manque encore…'} />
      </Field>
      <Fine>
        {repondant === 'manager'
          ? 'Seul le service RH lit votre commentaire ; le salarié ne voit pas votre avis. Les réponses alimentent les indicateurs par organisme et par formation.'
          : sienne
            ? 'Seul le service RH lit votre commentaire ; votre manager ne voit pas votre avis. Les réponses alimentent, sans votre nom, les indicateurs par organisme et par formation.'
            : 'Avis recueilli par le service RH au nom du salarié (formulaire papier, échange) : le salarié pourra le modifier dans son espace tant que l’évaluation est ouverte.'}
      </Fine>
    </Dialog>
  );
}
