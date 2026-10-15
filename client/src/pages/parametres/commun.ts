// Écran Paramètres : ce que la page (pages/Parametres.tsx) donne à chaque section, et les petits éléments partagés.
// Une section par fichier de ce dossier, dans l'ordre de sections.tsx ; mode d'emploi : docs/ARCHITECTURE.md,
// « Cadre commun du lot 4 ».
import { fmt } from '../../../../shared/format.ts';
import type { CibleEnvoi, Settings, StatutEnvoi } from '../../../../shared/types.ts';
import type { EnvoisState } from '../../api.ts';
import { useStore } from '../../state/store.tsx';

export type FiltreEnvoi = StatutEnvoi | 'tous';
export type FiltreCible = CibleEnvoi | 'toutes';

/** Envois sortants : état des intégrations (Keystone, e-mails) et derniers messages, chargés une fois par la page. */
export interface SuiviEnvois {
  etat: EnvoisState | null;
  erreur: string | null;
  filtre: FiltreEnvoi;
  setFiltre: (f: FiltreEnvoi) => void;
  cible: FiltreCible;
  setCible: (c: FiltreCible) => void;
  recharger: () => void;
}

/**
 * Ce que reçoit chaque section. Le reste se lit dans le store : `useRole()` (une section se masque en renvoyant null,
 * les réglages sont modifiables par l'administrateur RH seul : `admin`), `useStore()` (session, dialogues), `useData()`.
 */
export interface SectionProps {
  /** Réglages en vigueur (instantané). */
  s: Settings;
  envois: SuiviEnvois;
}

/** Enregistre des réglages (`parametres.maj`, administrateur RH) : champs de la table REGLAGES de shared/reglages.ts. */
export function useEnregistrerReglages() {
  const { run } = useStore();
  return (patch: Partial<Settings>) => run('parametres.maj', patch);
}

/** Police à chasse fixe pour les codes (pas de classe dédiée dans app.css). */
export const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 };

/** Date et heure locales d'un horodatage ISO : « 10 oct. 2026 à 09:12 ». */
export const quand = (at: string) => {
  const d = new Date(at);
  return `${fmt(d)} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};
