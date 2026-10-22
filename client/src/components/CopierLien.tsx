// « Copier le lien » d'une fiche ou d'une feuille de temps (t154) : l'adresse de la page, qui porte la sélection et les
// filtres (state/url.ts), copiée dans le presse-papiers. Le lien ne contient qu'un identifiant numérique : la personne
// qui l'ouvre ne voit que ce que son rôle lui ouvre (un identifiant hors de son périmètre est ignoré).
// Presse-papiers refusé (adresse en http, navigateur ancien) : un message invite à copier l'adresse du navigateur.
import { LinkIcon } from '@phosphor-icons/react';
import { useStore } from '../state/store.tsx';

export function CopierLien({ chemin, small = true }: {
  /** Chemin et paramètres à copier (par défaut l'adresse affichée), ex. « /temps?salarie=12&semaine=2027-01-04 ». */
  chemin?: string; small?: boolean;
}) {
  const { notify } = useStore();
  const copier = async () => {
    const lien = new URL(chemin ?? location.pathname + location.search, location.origin).href;
    try {
      await navigator.clipboard.writeText(lien);
      notify('Lien copié : il ouvre cette page à qui y a accès.');
    } catch {
      notify('Copie impossible dans ce navigateur : copiez l’adresse affichée dans la barre du navigateur.', true);
    }
  };
  return (
    <button type="button" className={`btn btn-ghost${small ? ' btn-sm' : ''}`} onClick={copier} title="Copier l’adresse de cette page">
      <LinkIcon size={14} /><span>Copier le lien</span>
    </button>
  );
}
