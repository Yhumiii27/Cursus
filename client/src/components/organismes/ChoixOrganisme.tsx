// lot 12 — C4 (organismes de formation et e-learning) : sélecteur d'organisme des dialogues (formation du catalogue,
// session, ligne du plan, formation suivie, dossier OPCO, module d'e-learning), à la place du texte libre. Fiches en
// vigueur seulement, plus celle que l'objet désigne déjà (archivée ou fusionnée : gardée, suivie jusqu'à celle qui l'a
// absorbée par le serveur). Fiches complètes (espace RH) ou résumé des référentiels. `le` : avertissements Qualiopi et
// déclaration d'activité de la fiche choisie à cette date (jamais un blocage).
import { avertissementsOrganisme, organismeActif } from '../../../../shared/rules/organismes.ts';
import { Field } from '../Dialog.tsx';
import { NoteAccent } from '../ui.tsx';
import { useDomain } from '../../state/derived.ts';

interface Proprietes {
  id: string;
  /** Identifiant choisi (texte du <select>) ; '' : l'option vide. */
  valeur: string;
  onChange: (v: string) => void;
  /** Fiche déjà désignée par l'objet modifié : gardée dans la liste même archivée. */
  actuel?: number | null;
  /** Libellé de l'option vide (« Celui du catalogue (…) », « Aucun »…). */
  vide: string;
  label?: string;
  erreur?: string | null;
  /** Date de la formation : avertissements de la fiche choisie. */
  le?: string | null;
  aide?: string;
}

export function ChoixOrganisme({ id, valeur, onChange, actuel = null, vide, label = 'Organisme de formation', erreur, le, aide }: Proprietes) {
  const d = useDomain();
  const fiches = d.ds.organismes;
  const enVigueur = fiches ? fiches.filter(organismeActif) : (d.ds.referentiels.organismes ?? []).filter(o => !o.archive);
  const garde = (fiches ?? d.ds.referentiels.organismes ?? []).find(o => o.id === actuel && !enVigueur.some(x => x.id === o.id));
  const liste = [...enVigueur, ...(garde ? [garde] : [])]
    .sort((a, b) => a.nomUsuel.localeCompare(b.nomUsuel, 'fr'));
  const choisie = fiches?.find(o => o.id === Number(valeur)) ?? null;
  const avert = choisie && le ? avertissementsOrganisme(choisie, le) : [];
  return (
    <>
      <Field label={label} htmlFor={id} erreur={erreur}>
        <select className="input" id={id} value={valeur} onChange={e => onChange(e.target.value)}>
          <option value="">{vide}</option>
          {liste.map(o => <option key={o.id} value={o.id}>{o.nomUsuel}{o.archive ? ' (archivé)' : ''}</option>)}
        </select>
      </Field>
      {aide && <span className="text-muted sub" style={{ marginTop: 'calc(-1 * var(--space-2))' }}>{aide}</span>}
      {avert.length > 0 && <NoteAccent>{avert.join(' · ')}</NoteAccent>}
    </>
  );
}
