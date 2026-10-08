// Données dérivées mémorisées, partagées par les écrans.
import { useMemo } from 'react';
import { Domain, type EmpX, type TripX } from '../../../shared/domain.ts';
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

export function useRole() {
  const data = useData();
  const u = data.user;
  return { role: u.role, rh: u.role === 'rh', manager: u.role === 'manager', collab: u.role === 'collaborateur', me: u.empId, user: u };
}
