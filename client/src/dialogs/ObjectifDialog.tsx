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

export type ModeObjectif = 'ajouter' | 'proposer' | 'modifier' | 'ajuster';

const TITRES: Record<ModeObjectif, string> = {
  ajouter: 'Fixer un objectif', proposer: 'Proposer un objectif', modifier: 'Modifier l’objectif', ajuster: 'Ajuster l’objectif en cours d’année',
};

/** Aide de saisie commune : ce qu'un objectif contient, et ce qu'il ne contient jamais. */
export const AIDE_OBJECTIF = 'Un objectif décrit un résultat de travail mesurable. N’y mettez ni donnée de santé, ni appréciation de la personne : il figure au compte rendu et reste consultable pendant toute la durée de conservation des entretiens.';

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
  const libelleErr = !libelle.trim() ? 'Indiquez l’objectif.' : libelle.trim().length > LIBELLE_OBJECTIF_MAX ? `${LIBELLE_OBJECTIF_MAX} caractères au plus.` : null;
  const mesureErr = mesure.trim().length > MESURE_MAX ? `${MESURE_MAX} caractères au plus.` : null;
  const n = Number(poids);
  const poidsErr = poids.trim() === '' ? null : !Number.isInteger(n) || n < 0 || n > 100 ? 'Un nombre entier de 0 à 100.' : null;
  // Poids total des objectifs fixés au même entretien : 100 % au plus.
  const autres = objectifsFixesA(d.ds.objectifs ?? [], x.id).filter(y => y.id !== o?.id).reduce((t, y) => t + (y.poids ?? 0), 0);
  const totalErr = !poidsErr && poids.trim() !== '' && autres + n > 100 ? `Poids total des objectifs de l’entretien : ${autres + n} %, 100 % au plus (${autres} % déjà réparti).` : null;
  const echeanceErr = echeance ? erreurDate(echeance, '') : null;
  const motifErr = mode !== 'ajuster' ? null : !motif.trim() ? 'Indiquez le motif de l’ajustement.' : motif.trim().length > MOTIF_AJUSTEMENT_MAX ? `${MOTIF_AJUSTEMENT_MAX} caractères au plus.` : null;
  const lu = lireObjectif(saisie, o ?? undefined);
  const inchange = mode === 'ajuster' && o && typeof lu !== 'string'
    && lu.libelle === o.libelle && lu.mesure === o.mesure && lu.categorie === o.categorie && lu.poids === o.poids && lu.echeance === o.echeance
    ? 'Aucun changement : modifiez au moins un champ, ou fermez.' : null;

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
    <Dialog title={`${validation ? 'Valider la proposition' : TITRES[mode]} — ${e.nom}`} width={560} onSubmit={envoyer} fermer={retour ? revenir : undefined}
      confirmation={retirer ? {
        texte: `Retirer cet objectif de l’entretien ? ${o?.statut === 'propose' ? 'La proposition du salarié est supprimée.' : 'Il n’apparaîtra plus au compte rendu.'}`,
        bouton: 'Retirer', occupe: busy, confirmer: confirmerRetrait, annuler: () => setRetirer(false),
      } : null}
      actions={<>
        <CancelButton />
        {retirable && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRetirer(true)}>Retirer</button>}
        <SubmitButton busy={busy}>{mode === 'ajouter' ? 'Fixer l’objectif' : mode === 'proposer' ? 'Proposer' : mode === 'ajuster' ? 'Ajuster' : validation ? 'Valider' : 'Enregistrer'}</SubmitButton>
      </>}>
      <Fine>{AIDE_OBJECTIF}</Fine>
      {o?.libelleInitial && <Fine>Libellé fixé à l’entretien : « {o.libelleInitial} »{o.ajusteLe ? ` — ajusté le ${fmtIso(o.ajusteLe)}` : ''}.</Fine>}
      <Field label="Objectif" htmlFor="obj-libelle" requis erreur={v.erreur(libelleErr)}>
        <input className="input" id="obj-libelle" value={libelle} maxLength={LIBELLE_OBJECTIF_MAX} onChange={ev => setLibelle(ev.target.value)} />
      </Field>
      <Field label="Indicateur ou critère de mesure" htmlFor="obj-mesure" erreur={v.erreur(mesureErr)}>
        <textarea className="input mid" id="obj-mesure" rows={2} value={mesure} maxLength={MESURE_MAX} onChange={ev => setMesure(ev.target.value)} />
      </Field>
      <div className="grid-2">
        <Field label="Catégorie" htmlFor="obj-categorie">
          <select className="input" id="obj-categorie" value={categorie} onChange={ev => setCategorie(ev.target.value as CategorieObjectif)}>
            {CATEGORIES_OBJECTIF.map(c => <option key={c} value={c}>{CATEGORIE_OBJECTIF_LABEL[c]}</option>)}
          </select>
        </Field>
        <Field label="Échéance" htmlFor="obj-echeance" erreur={v.erreur(echeanceErr)}>
          <input className="input" id="obj-echeance" type="date" value={echeance} onChange={ev => setEcheance(ev.target.value)} />
        </Field>
      </div>
      <Field label="Poids (%, facultatif)" htmlFor="obj-poids" erreur={v.erreur(poidsErr ?? totalErr)}>
        <input className="input" id="obj-poids" inputMode="numeric" value={poids} onChange={ev => setPoids(ev.target.value)} style={{ maxWidth: 120 }} />
      </Field>
      {mode === 'ajuster' && (
        <Field label="Motif de l’ajustement" htmlFor="obj-motif" requis erreur={v.erreur(motifErr ?? inchange)}>
          <textarea className="input mid" id="obj-motif" rows={2} value={motif} maxLength={MOTIF_AJUSTEMENT_MAX} onChange={ev => setMotif(ev.target.value)} />
        </Field>
      )}
      {mode === 'proposer' && <Fine>Votre évaluateur valide ou reformule la proposition avant la clôture de l’entretien.</Fine>}
      {mode === 'ajuster' && <Fine>L’ajustement est daté et tracé ; le libellé fixé à l’entretien reste au compte rendu.</Fine>}
    </Dialog>
  );
}
