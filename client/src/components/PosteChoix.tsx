// Poste d'une fiche collaborateur (dialogs/EmployeDialog.tsx) : choisi dans la liste des postes en vigueur du référentiel,
// dont les exigences s'appliquent (shared/rules/exigences.ts) ; l'intitulé de la fiche suit le poste choisi. Le service RH
// peut saisir un nouveau poste (`nouveau`), ajouté au référentiel sans exigence à l'enregistrement de la fiche. Le manager
// n'en précise que l'intitulé (`PosteLibelle`).
import { useMemo } from 'react';
import { nombreExigences, posteDe } from '../../../shared/rules/exigences.ts';
import type { Employe } from '../../../shared/types.ts';
import { actif } from '../../../shared/rules/referentiels.ts';
import { Field } from './Dialog.tsx';
import { useDomain } from '../state/derived.ts';

/** Valeur de la liste pour un poste saisi, pas encore au référentiel. */
export const NOUVEAU_POSTE = 'nouveau';

export function PosteChoix({ posteId, poste, actuel, erreur, onChange, nouveau }: {
  posteId: string; poste: string; actuel: number | null; erreur: string | null; onChange: (posteId: string, poste: string) => void;
  /** Service RH : « Nouveau poste… » proposé. */
  nouveau?: boolean;
}) {
  const d = useDomain();
  // Postes en vigueur, et le poste actuel de la fiche même archivé depuis.
  const postes = useMemo(() => d.ds.referentiels.postes.filter(p => actif(p) || p.id === actuel).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')), [d, actuel]);
  // Référentiel vide : le premier poste se saisit directement.
  const saisie = posteId === NOUVEAU_POSTE || (!!nouveau && !postes.length);
  const choisi = postes.find(p => String(p.id) === posteId) ?? null;
  const exigences = choisi ? [...choisi.formations.map(f => d.fm(f)), ...choisi.habilitations.map(h => d.hm(h))].filter(actif).map(x => 'court' in x ? x.court : x.nom) : [];
  const choisir = (v: string) => {
    if (v === NOUVEAU_POSTE) onChange(NOUVEAU_POSTE, '');
    else if (v === '') onChange('', posteId === '' ? poste : '');
    else onChange(v, postes.find(p => String(p.id) === v)?.nom ?? '');
  };
  return (
    <Field label="Poste" htmlFor={saisie && !postes.length ? 'emp-poste-nouveau' : 'emp-poste'} requis erreur={erreur}>
      {postes.length > 0 && (
        <select className="input" id="emp-poste" value={saisie ? NOUVEAU_POSTE : posteId} onChange={ev => choisir(ev.target.value)}>
          {(posteId === '' || !choisi) && !saisie && <option value="">{poste ? `${poste} (hors référentiel)` : 'Choisir un poste…'}</option>}
          {postes.map(p => <option key={p.id} value={String(p.id)}>{p.nom}{actif(p) ? '' : ' · archivé'}</option>)}
          {nouveau && <option value={NOUVEAU_POSTE}>Nouveau poste…</option>}
        </select>
      )}
      {saisie && (
        <input className="input" id="emp-poste-nouveau" type="text" maxLength={80} aria-label="Intitulé du nouveau poste" placeholder="Technicien de maintenance…"
          value={poste} onChange={ev => onChange(NOUVEAU_POSTE, ev.target.value)} />
      )}
      <span className="text-muted sub">
        {saisie ? 'Ajouté au référentiel des postes, sans exigence (Référentiels → Postes).'
          : choisi ? (nombreExigences(choisi) && exigences.length ? `Exige : ${exigences.join(', ')}` : 'Aucune exigence déclarée pour ce poste')
          : 'Les exigences du poste (formations, habilitations) s’appliquent au collaborateur.'}
      </span>
    </Field>
  );
}

/**
 * Manager : intitulé du poste d'un membre de son équipe, à préciser (« Cariste confirmé ») ; le poste du référentiel, dont
 * les exigences décident de la conformité, reste celui que le service RH a choisi.
 */
export function PosteLibelle({ emp, poste, erreur, onChange }: {
  emp: Pick<Employe, 'posteId' | 'poste'>; poste: string; erreur: string | null; onChange: (poste: string) => void;
}) {
  const d = useDomain();
  const x = posteDe(d.ds, emp);
  return (
    <Field label="Intitulé du poste" htmlFor="emp-poste" requis erreur={erreur}>
      <input className="input" id="emp-poste" type="text" maxLength={80} value={poste} onChange={ev => onChange(ev.target.value)} />
      <span className="text-muted sub">
        {x ? `Poste du référentiel : ${x.nom} — changé par le service RH seulement.` : 'Hors référentiel des postes : le service RH l’y rattache.'}
      </span>
    </Field>
  );
}
