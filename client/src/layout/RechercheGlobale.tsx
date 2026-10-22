// Recherche de l'en-tête (t152) : suggestions de collaborateurs au fil de la frappe, sans quitter l'écran. Entrée ou un
// clic sur une suggestion ouvre sa fiche ; « Voir tous les résultats » ouvre l'annuaire filtré par la recherche (le texte
// reste en mémoire, jamais dans l'adresse). Sur l'annuaire, la frappe filtre aussi la liste, comme avant.
// Ouverte au service RH et aux profils de l'espace RH qui ont l'annuaire (vuesDe), et au manager sur son équipe : le jeu de
// données est déjà limité par le serveur (server/src/dataset.ts), la recherche n'y ajoute rien.
// Raccourci : « / » hors d'un champ, Ctrl+K ou Cmd+K (components/recherche.ts), sauf pendant un dialogue.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import type { Dataset, Role } from '../../../shared/types.ts';
import { ListeSuggestions } from '../components/ChoixCollaborateur.tsx';
import { chercherCollaborateurs, deplacer, estRaccourciRecherche, perimetreRecherche } from '../components/recherche.ts';
import { useStore } from '../state/store.tsx';

const ID = 'recherche-globale';

/** Cible de saisie : un raccourci « / » y reste un caractère tapé. */
const dansUnChamp = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName));

export function RechercheGlobale({ data, role }: { data: Dataset; role: Role }) {
  const { ui, setUi, go, view, dialog } = useStore();
  const champ = useRef<HTMLInputElement>(null);
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(-1);
  const emps = useMemo(() => perimetreRecherche(data.employes, role, data.user.empId, data.today), [data, role]);
  const q = ui.search;
  const { suggestions, total } = useMemo(() => chercherCollaborateurs(emps, q), [emps, q]);
  // Dernière option : l'annuaire filtré (rang suggestions.length).
  const n = q.trim() ? suggestions.length + 1 : 0;
  const tous = suggestions.length;

  // Raccourci clavier, hors dialogue (le dialogue garde le focus dans sa fenêtre).
  const dialogueOuvert = !!dialog;
  useEffect(() => {
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (dialogueOuvert || !estRaccourciRecherche(ev, dansUnChamp(ev.target))) return;
      ev.preventDefault();
      champ.current?.focus();
      champ.current?.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dialogueOuvert]);

  const fermer = () => { setOuvert(false); setActif(-1); };
  const ouvrirFiche = (id: number) => { fermer(); go('collaborateurs', { selectedId: id, search: '' }); };
  const voirTout = () => { fermer(); if (view !== 'collaborateurs') go('collaborateurs', { selectedId: null }); else setUi({ selectedId: null }); };
  const valider = (i: number) => { if (i === tous) voirTout(); else if (suggestions[i]) ouvrirFiche(suggestions[i].id); };

  const onKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      setOuvert(true);
      setActif(a => deplacer(ouvert ? a : -1, n, ev.key === 'ArrowDown' ? 1 : -1));
    } else if (ev.key === 'Enter' && q.trim()) {
      ev.preventDefault();
      valider(ouvert && actif >= 0 ? actif : suggestions.length ? 0 : tous);
    } else if (ev.key === 'Escape') {
      if (ouvert) { ev.preventDefault(); fermer(); }
      else if (q) { ev.preventDefault(); setUi({ search: '' }); }
    }
  };

  return (
    <div className="search combo">
      <MagnifyingGlassIcon size={14} />
      <input ref={champ} id={ID} className="input" type="text" role="combobox" autoComplete="off" spellCheck={false}
        placeholder="Rechercher un collaborateur…" aria-label="Rechercher un collaborateur" aria-keyshortcuts="/ Control+K Meta+K"
        aria-expanded={ouvert && n > 0} aria-controls={`${ID}-liste`} aria-autocomplete="list"
        aria-activedescendant={ouvert && actif >= 0 ? `${ID}-liste-${actif}` : undefined}
        value={q} onKeyDown={onKey} onBlur={fermer}
        onChange={e => { setUi({ search: e.target.value }); setOuvert(true); setActif(e.target.value.trim() ? 0 : -1); }} />
      <ListeSuggestions id={`${ID}-liste`} ouvert={ouvert && n > 0} options={suggestions} actif={actif} reste={0} nomVide="Collaborateurs"
        choisir={e => e && ouvrirFiche(e.id)}
        fin={
          <li id={`${ID}-liste-${tous}`} role="option" aria-selected={actif === tous} className={`combo-option combo-tous${actif === tous ? ' actif' : ''}`}
            onMouseDown={ev => ev.preventDefault()} onClick={voirTout}>
            <span>{`Voir tous les résultats (${total})`}</span>
            <span className="text-muted sub">Annuaire filtré par la recherche</span>
          </li>
        } />
    </div>
  );
}
