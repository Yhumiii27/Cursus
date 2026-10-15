// Données dérivées mémorisées, partagées par les écrans.
import { useMemo } from 'react';
import { droitsRh } from '../../../shared/constants.ts';
import { Domain, type EmpX, type TripX, type UiIntent } from '../../../shared/domain.ts';
import type { Formation, Session } from '../../../shared/types.ts';
import { useData, useStore } from './store.tsx';

export function useDomain(): Domain {
  const data = useData();
  return useMemo(() => new Domain(data), [data]);
}

export interface Enriched {
  d: Domain;
  emps: EmpX[];
  forms: Formation[];
  formIds: Set<string>;
  upcoming: Session[];
  horizon: number;
  onlyReg: boolean;
}

/** Collaborateurs enrichis (statuts de conformité) selon le seuil d'alerte courant. */
export function useEnriched(): Enriched {
  const d = useDomain();
  const { ui } = useStore();
  const horizon = ui.horizon ?? d.ds.settings.horizonAlerte;
  const onlyReg = d.ds.settings.uniquementReglementaire;
  return useMemo(() => {
    const forms = d.forms(onlyReg);
    const formIds = new Set(forms.map(f => f.id));
    return { d, emps: d.enrich(horizon, onlyReg), forms, formIds, upcoming: d.upcoming(formIds), horizon, onlyReg };
  }, [d, horizon, onlyReg]);
}

/** Déplacements à venir avec l'état de préparation du dossier. */
export function useTrips(): TripX[] {
  const d = useDomain();
  return useMemo(() => d.tripsAll(), [d]);
}

/** Collaborateurs visibles par l'utilisateur (déjà restreints par le serveur). */
export function useScopeIds(): number[] {
  const data = useData();
  return useMemo(() => data.employes.map(e => e.id), [data]);
}

/**
 * Rôle et droits de la personne connectée (le serveur les vérifie de toute façon) :
 * - `espaceRh` : espace RH, vues d'ensemble de tout le site (service RH et profils restreints) ;
 * - `rh` : gestion courante du service RH ; `admin` : administrateur RH (paramètres, suppressions, comptes) ;
 * - `formations` : sessions, certifications, habilitations (service RH, référent HSE) ; `paie` : transmission à Sage ;
 * - `consultation` : lecture de tout l'espace et du journal (service RH, lecture seule) ;
 * - `soi` : salarié rattaché au compte, dans tous les espaces — un membre du RH ne décide pas de ses propres demandes.
 */
export function useRole() {
  const data = useData();
  const u = data.user;
  const droits = droitsRh(u);
  return {
    role: u.role, espaceRh: u.role === 'rh', rh: droits.includes('rh'), admin: droits.includes('admin'), formations: droits.includes('formations'),
    paie: droits.includes('paie'), consultation: droits.includes('consultation'), manager: u.role === 'manager', collab: u.role === 'collaborateur',
    me: u.empId, soi: u.salarieId ?? u.empId, user: u,
  };
}

/**
 * Proposition d'action calculée par le domaine (échéance, habilitation) que la personne peut lancer depuis l'espace
 * RH : planifier, délivrer, clôturer pour les formations ; visite médicale et formalités de voyage pour le service RH.
 */
export function useIntentPermis(): (it: UiIntent) => boolean {
  const { rh, formations } = useRole();
  return useMemo(() => (it: UiIntent) => it.type === 'medical' || it.type === 'openFormalite' ? rh : formations, [rh, formations]);
}
