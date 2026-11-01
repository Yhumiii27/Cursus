// lot 11 — dossiers OPCO : éléments partagés par l'onglet « Dossiers OPCO » de Plan & budget, le panneau de détail,
// les dialogues (dialogs/Opco*Dialog.tsx) et l'écran Échéances. Règles : shared/rules/opco.ts.
import type { Domain } from '../../../../shared/domain.ts';
import { STATUTS_OPCO } from '../../../../shared/rules/opco.ts';
import type { DossierOpco, PlanAction, StatutOpco } from '../../../../shared/types.ts';
import type { FiltreOpco } from '../../state/store.tsx';

/** Action du plan nommée à l'écran : formation du catalogue (nom) ou intitulé, équipe, trimestre et exercice. */
export function nomLigne(d: Domain, l: Pick<PlanAction, 'f' | 'libelle' | 'equipe' | 'periode' | 'exercice'>): string {
  const fm = l.f ? d.fm(l.f) : null;
  return `${fm ? fm.nom : l.libelle ?? '—'} — ${l.equipe}, ${l.periode} ${l.exercice}`;
}

/** Dossier nommé par son action du plan (ou son numéro, ligne introuvable). */
export function nomDossierOpco(d: Domain, x: Pick<DossierOpco, 'id' | 'planActionId'>): string {
  const l = d.ds.plan.find(p => p.id === x.planActionId);
  return l ? nomLigne(d, l) : `Dossier n° ${x.id}`;
}

/** Classe du tag d'état : accent pour ce qui attend une action, contour pour l'accordé, neutre pour un dossier clos. */
export const CLS_OPCO: Record<StatutOpco, string> = {
  a_deposer: 'tag-accent', depose: 'tag-outline', accorde: 'tag-outline', refuse: 'tag-neutral', facture: 'tag-outline', rembourse: 'tag-outline',
  solde: 'tag-neutral', abandonne: 'tag-neutral',
};

/** Le dossier passe-t-il le filtre d'état ? (`retards` : échéance dépassée, `enRetard` calculé par l'appelant ; `clos` : soldé, refusé ou abandonné.) */
export function passeFiltre(f: FiltreOpco, x: Pick<DossierOpco, 'statut'>, enRetard: boolean): boolean {
  if (f === 'tous') return true;
  if (f === 'retards') return enRetard;
  if (f === 'en_cours') return STATUTS_OPCO[x.statut].enCours;
  return !STATUTS_OPCO[x.statut].enCours;
}
