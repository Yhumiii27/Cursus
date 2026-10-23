// Choix d'un collaborateur dans une liste de suggestions (t152) : combobox ARIA 1.2 (champ role=combobox, liste
// role=listbox, option active désignée par aria-activedescendant), à la place des listes déroulantes de salariés des
// dialogues et des filtres. La saisie cherche dans le nom, le poste, l'équipe et les matricules (components/recherche.ts) ;
// chaque suggestion montre nom, poste, équipe et matricule, 8 au plus.
// Clavier : flèches (la liste s'ouvre), Entrée choisit l'option active, Échap referme la liste (puis, au second appui, le
// dialogue), Tab quitte le champ. Le focus reste dans le champ. Le nom complet tapé ou restauré par le brouillon de
// reconnexion (state/brouillon.ts) choisit la personne, et la liste reste filtrée sur elle. En quittant le champ sans
// choisir (components/combobox.ts) : un champ obligatoire passe à « aucun » (le formulaire le signale, jamais d'envoi pour
// la personne choisie avant) ; un filtre revient au collaborateur choisi ; un champ vidé revient à « aucun » si la liste
// le permet (`vide`).
import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { equipeLabel, matricule } from '../../../shared/format.ts';
import type { Employe } from '../../../shared/types.ts';
import { actifApresSaisie, designePar, enQuittant } from './combobox.ts';
import { chercherCollaborateurs, deplacer } from './recherche.ts';

/** Ce qu'une suggestion montre d'un collaborateur, et ce que la recherche lit. */
export type Suggere = Pick<Employe, 'id' | 'nom' | 'poste' | 'equipe' | 'matriculePaie'>;

/** Précision d'une suggestion : poste, équipe, matricule de paie (sinon le matricule Cursus). */
export const detailCollaborateur = (e: Suggere) => `${e.poste} · ${equipeLabel(e)} · ${e.matriculePaie || matricule(e.id)}`;

/**
 * Liste des suggestions sous un champ combobox : options (null : l'option « aucun » de la liste), option active,
 * collaborateurs non montrés. Un clic choisit sans retirer le focus du champ.
 */
export function ListeSuggestions<T extends Suggere>({ id, ouvert, options, actif, choisi, reste, vide, nomVide, suffixe, choisir, fin }: {
  id: string; ouvert: boolean; options: (T | null)[]; actif: number; choisi?: number | null; reste: number; vide?: string;
  nomVide?: string; suffixe?: (e: T) => string; choisir: (e: T | null) => void; fin?: ReactNode;
}) {
  return (
    <ul id={id} role="listbox" aria-label={nomVide ?? 'Suggestions'} className="combo-liste" hidden={!ouvert}>
      {options.map((e, i) => (
        <li key={e ? e.id : 'vide'} id={`${id}-${i}`} role="option" aria-selected={i === actif}
          className={`combo-option${i === actif ? ' actif' : ''}${e && e.id === choisi ? ' choisi' : ''}`}
          onMouseDown={ev => ev.preventDefault()} onClick={() => choisir(e)}>
          {e ? <><span>{e.nom}{suffixe?.(e) ?? ''}</span><span className="text-muted sub">{detailCollaborateur(e)}</span></> : <span>{vide}</span>}
        </li>
      ))}
      {fin}
      {options.length === 0 && <li role="presentation" className="combo-note text-muted">Aucun collaborateur ne correspond à cette recherche.</li>}
      {reste > 0 && <li role="presentation" className="combo-note text-muted">{`${reste} autre${reste > 1 ? 's' : ''} : précisez la recherche (nom, poste, équipe ou matricule).`}</li>}
    </ul>
  );
}

export function ChoixCollaborateur<T extends Suggere>({ id, emps, valeur, onChange, vide, placeholder, suffixe, requis, erreur, label, style }: {
  /** Identifiant du champ (le `htmlFor` du Field qui le nomme). */
  id: string;
  /** Collaborateurs proposés, dans le périmètre de l'utilisateur. */
  emps: readonly T[];
  valeur: number | null;
  onChange: (id: number | null) => void;
  /** Libellé de l'option « aucun » (« Tous les salariés ») : la liste admet de ne choisir personne. */
  vide?: string;
  placeholder?: string;
  /** Complément du nom (« (moi) », « (lecture seule) »). */
  suffixe?: (e: T) => string;
  /** Hors d'un Field (filtre d'en-tête) : nom du champ pour le lecteur d'écran. */
  label?: string;
  /** Champ obligatoire, message d'erreur du Field (décrit le champ, qui passe aria-invalid et prend le focus à l'envoi). */
  requis?: boolean;
  erreur?: string | null | false;
  style?: CSSProperties;
}) {
  const liste = `${id}-liste${useId().replace(/:/g, '')}`;
  const libelle = (e: T) => `${e.nom}${suffixe?.(e) ?? ''}`;
  const choisi = valeur != null ? emps.find(e => e.id === valeur) : undefined;
  const [texte, setTexte] = useState(choisi ? libelle(choisi) : '');
  const [saisi, setSaisi] = useState(false);
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(-1);
  // Choix changé hors du champ (autre écran, valeur par défaut posée par le dialogue) : le texte le suit. Un choix fait
  // par le champ lui-même (`emettre`) est noté d'avance : la frappe en cours et la liste filtrée restent.
  const [prec, setPrec] = useState<number | null>(valeur);
  if (prec !== valeur) { setPrec(valeur); setTexte(choisi ? libelle(choisi) : ''); setSaisi(false); }
  const emettre = (id: number | null) => { setPrec(id); if (id !== valeur) onChange(id); };

  // Sans frappe, la liste montre tout le monde (dans l'ordre alphabétique) ; après, ce qui correspond.
  const q = saisi ? texte : '';
  const { suggestions, total } = useMemo(() => chercherCollaborateurs(emps, q), [emps, q]);
  const options: (T | null)[] = vide && !q.trim() ? [null, ...suggestions] : suggestions;

  const choisir = (e: T | null) => {
    setTexte(e ? libelle(e) : '');
    setSaisi(false);
    setOuvert(false);
    setActif(-1);
    emettre(e?.id ?? null);
  };
  const ouvrir = (a: number) => { setOuvert(true); setActif(a); };
  const rang = () => Math.max(0, options.findIndex(e => (e?.id ?? null) === valeur));

  const onKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const pas = ev.key === 'ArrowDown' ? 1 : -1;
      if (!ouvert) ouvrir(saisi ? deplacer(-1, options.length, pas) : rang());
      else setActif(deplacer(actif, options.length, pas));
    } else if (ev.key === 'Enter' && ouvert) {
      // Liste ouverte : Entrée choisit, elle n'envoie pas le formulaire.
      ev.preventDefault();
      if (actif >= 0 && actif < options.length) choisir(options[actif]);
      else if (options.length === 1) choisir(options[0]);
    } else if (ev.key === 'Escape' && (ouvert || saisi)) {
      // Premier Échap : referme la liste (et rend le texte du choix) ; le dialogue reste ouvert.
      ev.preventDefault();
      ev.stopPropagation();
      setOuvert(false);
      setActif(-1);
      if (saisi) { setTexte(choisi ? libelle(choisi) : ''); setSaisi(false); }
    }
  };
  const onSaisie = (v: string) => {
    setTexte(v);
    setSaisi(true);
    // Nom complet tapé (ou restauré par le brouillon) : la personne est choisie, et l'option active est la sienne.
    const d = designePar(emps, libelle, v);
    if (d) emettre(d.id);
    const r = chercherCollaborateurs(emps, v);
    const opts = vide && !v.trim() ? [null, ...r.suggestions] : r.suggestions;
    ouvrir(actifApresSaisie(opts, d?.id ?? null, v, !!vide));
  };
  const onQuitter = () => {
    setOuvert(false);
    setActif(-1);
    const s = enQuittant({ saisi, texte, designe: designePar(emps, libelle, texte)?.id ?? null, vide: !!vide, requis: !!requis });
    if (s.type === 'choisir') choisir(s.id == null ? null : emps.find(e => e.id === s.id) ?? null);
    else if (s.type === 'invalider') emettre(null);
    else if (s.type === 'restaurer') { setTexte(choisi ? libelle(choisi) : ''); setSaisi(false); }
  };

  return (
    <div className="combo" style={style}>
      <input id={id} className="input" type="text" role="combobox" autoComplete="off" spellCheck={false}
        aria-label={label} aria-expanded={ouvert} aria-controls={liste} aria-autocomplete="list"
        aria-activedescendant={ouvert && actif >= 0 ? `${liste}-${actif}` : undefined}
        aria-required={requis || undefined} aria-invalid={erreur ? true : undefined} aria-describedby={erreur ? `${id}-erreur` : undefined}
        placeholder={placeholder ?? (vide ? vide : 'Nom, poste, équipe ou matricule')} value={texte}
        onChange={ev => onSaisie(ev.target.value)} onKeyDown={onKey} onBlur={onQuitter}
        onClick={() => { if (!ouvert) ouvrir(saisi ? 0 : rang()); }} />
      <ListeSuggestions id={liste} ouvert={ouvert} options={options} actif={actif} choisi={valeur}
        reste={total - suggestions.length} vide={vide} suffixe={suffixe} choisir={choisir} />
    </div>
  );
}
