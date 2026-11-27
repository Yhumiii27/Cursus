// Objectif d'un entretien suivi (lot 12, chantier C3, t194 ; règles : shared/rules/objectifs.ts, actions :
// server/src/actions/objectifs.ts) : fixé par l'évaluateur à l'entretien annuel planifié (`objectif.ajouter`), proposé par
// le salarié depuis son espace (`objectif.proposer`), modifié ou validé tant que l'entretien est planifié
// (`objectif.modifier`, une proposition passe alors « en cours »), ou ajusté en cours d'année avec un motif
// (`objectif.ajuster`, daté, le libellé d'origine conservé). Retrait (`objectif.retirer`) confirmé à la place des boutons.
// Ouvert depuis le compte rendu (`retour` : l'entretien, rouvert après l'envoi ou l'abandon) ou depuis l'onglet Objectifs
// et « Mes objectifs ». Aide de saisie : ni donnée de santé ni appréciation de la personne dans un objectif.
import { useState } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import {
  CATEGORIE_OBJECTIF_LABEL, CATEGORIES_OBJECTIF, LIBELLE_OBJECTIF_MAX, lireObjectif, MESURE_MAX, MOTIF_AJUSTEMENT_MAX, objectifsFixesA,
} from '../../../shared/rules/objectifs.ts';
import type { CategorieObjectif } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { erreurDate } from '../components/controles.ts';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export type ModeObjectif = 'ajouter' | 'proposer' | 'modifier' | 'ajuster';

const TITRES: Record<ModeObjectif, string> = {
  ajouter: 'Set an objective', proposer: 'Propose an objective', modifier: 'Edit the objective', ajuster: 'Adjust the objective during the year',
};

/** Aide de saisie commune : ce qu'un objectif contient, et ce qu'il ne contient jamais. */
export const AIDE_OBJECTIF = 'An objective describes a measurable work result. Put in it no health data and no appraisal of the person: it appears in the report and stays readable for the whole retention period of the reviews.';

export function ObjectifDialog({ mode, entretienId, id, retour }: { mode: ModeObjectif; entretienId?: number; id?: number; retour?: number }) {
  const d = useDomain();
  const { run, openDialog, closeDialog } = useStore();
  const o = id != null ? (d.ds.objectifs ?? []).find(y => y.id === id) : undefined;
  const xId = o?.entretienId ?? entretienId;
  const x = d.ds.entretiens.find(y => y.id === xId);
  const e = x ? d.emp(x.empId) : undefined;
  const [libelle, setLibelle] = useState(o?.libelle ?? '');
  const [mesure, setMesure] = useState(o?.mesure ?? '');
  const [categorie, setCategorie] = useState<CategorieObjectif>(o?.categorie ?? 'individuel');
  const [poids, setPoids] = useState(o?.poids != null ? String(o.poids) : '');
  const [echeance, setEcheance] = useState(o?.echeance ?? '');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const [retirer, setRetirer] = useState(false);
  const v = useVerification();
  if (!x || !e || (id != null && !o)) return null;

  const revenir = () => (retour ? openDialog({ type: 'ent', entId: retour }) : closeDialog());
  const saisie = { libelle, mesure, categorie, poids: poids.trim() === '' ? null : poids.trim(), echeance: echeance || null };
  // Contrôles champ par champ (les mêmes que le serveur, shared/rules/objectifs.ts).
  const libelleErr = !libelle.trim() ? t('Enter the objective.') : libelle.trim().length > LIBELLE_OBJECTIF_MAX ? t(`${LIBELLE_OBJECTIF_MAX} characters at most.`) : null;
  const mesureErr = mesure.trim().length > MESURE_MAX ? t(`${MESURE_MAX} characters at most.`) : null;
  const n = Number(poids);
  const poidsErr = poids.trim() === '' ? null : !Number.isInteger(n) || n < 0 || n > 100 ? t('A whole number from 0 to 100.') : null;
  // Poids total des objectifs fixés au même entretien : 100 % au plus.
  const autres = objectifsFixesA(d.ds.objectifs ?? [], x.id).filter(y => y.id !== o?.id).reduce((s, y) => s + (y.poids ?? 0), 0);
  const totalErr = !poidsErr && poids.trim() !== '' && autres + n > 100 ? `${t('Total weight of the review’s objectives: ')}${autres + n}${t(' %, 100 % at most (')}${autres}${t(' % already shared).')}` : null;
  const echeanceErr = echeance ? erreurDate(echeance, '') : null;
  const motifErr = mode !== 'ajuster' ? null : !motif.trim() ? t('Enter the reason for the adjustment.') : motif.trim().length > MOTIF_AJUSTEMENT_MAX ? t(`${MOTIF_AJUSTEMENT_MAX} characters at most.`) : null;
  const lu = lireObjectif(saisie, o ?? undefined);
  const inchange = mode === 'ajuster' && o && typeof lu !== 'string'
    && lu.libelle === o.libelle && lu.mesure === o.mesure && lu.categorie === o.categorie && lu.poids === o.poids && lu.echeance === o.echeance
    ? t('No change: change at least one field, or close.') : null;

  const envoyer = async () => {
    if (busy || !v.verifier(libelleErr, mesureErr, poidsErr, totalErr, echeanceErr, motifErr, inchange)) return;
    setBusy(true);
    const r = mode === 'ajouter' ? await run('objectif.ajouter', { entretienId: x.id, ...saisie })
      : mode === 'proposer' ? await run('objectif.proposer', { entretienId: x.id, ...saisie })
      : mode === 'ajuster' ? await run('objectif.ajuster', { id: o!.id, ...saisie, motif })
      : await run('objectif.modifier', { id: o!.id, ...saisie });
    setBusy(false);
    if (r.ok) revenir();
  };
  const confirmerRetrait = async () => {
    setBusy(true);
    const r = await run('objectif.retirer', { id: o!.id });
    setBusy(false);
    if (r.ok) revenir();
    else setRetirer(false);
  };
  // Retrait : l'évaluateur tant que l'entretien est planifié (sauf une ligne reconduite), le salarié pour sa proposition.
  const retirable = mode === 'modifier' && !!o && !o.reconduitDe && x.statut === 'planifie';
  const validation = mode === 'modifier' && o?.statut === 'propose';

  return (
    <Dialog title={`${t(validation ? 'Approve the proposal' : TITRES[mode])} — ${e.nom}`} width={560} onSubmit={envoyer} fermer={retour ? revenir : undefined}
      confirmation={retirer ? {
        texte: `${t('Remove this objective from the review?')} ${t(o?.statut === 'propose' ? 'The employee’s proposal is deleted.' : 'It will no longer appear in the report.')}`,
        bouton: t('Remove'), occupe: busy, confirmer: confirmerRetrait, annuler: () => setRetirer(false),
      } : null}
      actions={<>
        <CancelButton />
        {retirable && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRetirer(true)}>{t('Remove')}</button>}
        <SubmitButton busy={busy}>{t(mode === 'ajouter' ? 'Set the objective' : mode === 'proposer' ? 'Propose' : mode === 'ajuster' ? 'Adjust' : validation ? 'Approve' : 'Save')}</SubmitButton>
      </>}>
      <Fine>{t(AIDE_OBJECTIF)}</Fine>
      {o?.libelleInitial && <Fine>{t('Label set at the review: “')}{o.libelleInitial}{t('”#close')}{o.ajusteLe ? ` — ${t('adjusted on ')}${fmtIso(o.ajusteLe)}` : ''}.</Fine>}
      <Field label={t('Objective')} htmlFor="obj-libelle" requis erreur={v.erreur(libelleErr)}>
        <input className="input" id="obj-libelle" value={libelle} maxLength={LIBELLE_OBJECTIF_MAX} onChange={ev => setLibelle(ev.target.value)} />
      </Field>
      <Field label={t('Indicator or measurement criterion')} htmlFor="obj-mesure" erreur={v.erreur(mesureErr)}>
        <textarea className="input mid" id="obj-mesure" rows={2} value={mesure} maxLength={MESURE_MAX} onChange={ev => setMesure(ev.target.value)} />
      </Field>
      <div className="grid-2">
        <Field label={t('Category')} htmlFor="obj-categorie">
          <select className="input" id="obj-categorie" value={categorie} onChange={ev => setCategorie(ev.target.value as CategorieObjectif)}>
            {CATEGORIES_OBJECTIF.map(c => <option key={c} value={c}>{CATEGORIE_OBJECTIF_LABEL[c]}</option>)}
          </select>
        </Field>
        <Field label={t('Due date')} htmlFor="obj-echeance" erreur={v.erreur(echeanceErr)}>
          <input className="input" id="obj-echeance" type="date" value={echeance} onChange={ev => setEcheance(ev.target.value)} />
        </Field>
      </div>
      <Field label={t('Weight (%, optional)')} htmlFor="obj-poids" erreur={v.erreur(poidsErr ?? totalErr)}>
        <input className="input" id="obj-poids" inputMode="numeric" value={poids} onChange={ev => setPoids(ev.target.value)} style={{ maxWidth: 120 }} />
      </Field>
      {mode === 'ajuster' && (
        <Field label={t('Reason for the adjustment')} htmlFor="obj-motif" requis erreur={v.erreur(motifErr ?? inchange)}>
          <textarea className="input mid" id="obj-motif" rows={2} value={motif} maxLength={MOTIF_AJUSTEMENT_MAX} onChange={ev => setMotif(ev.target.value)} />
        </Field>
      )}
      {mode === 'proposer' && <Fine>{t('Your reviewer approves or rephrases the proposal before the closing of the review.')}</Fine>}
      {mode === 'ajuster' && <Fine>{t('The adjustment is dated and traced; the label set at the review stays in the report.')}</Fine>}
    </Dialog>
  );
}
