// Contexte des projections par espace et par profil des chantiers du lot 12 (socle), passé par server/src/dataset.ts à
// chaque fichier server/src/vues-<module>.ts (vues-forfait-heures, vues-entretiens-suivis, vues-organismes, vues-planning,
// vues-pointage ; les notes de frais gardent server/src/frais-vues.ts). Chaque chantier écrit la projection de ses champs
// dans son propre fichier, appelée par une seule ligne de dataset.ts posée par le socle : aucune fusion à la main de
// dataset.ts entre chantiers. Une projection ne lit pas la base (calcul pur sur l'instantané complet) ; elle rend les
// champs de l'instantané qu'elle remplace (`Partial<Dataset>`, posés après tous les autres), rien si la vue n'en a pas.
// Tout champ nouveau d'un chantier qu'une projection n'écrase pas part tel quel vers le manager et le collaborateur
// (`...full` en tête de leur vue) : le chantier le filtre ici, ou le vide.
import type { Domain } from '../../shared/domain.ts';
import type { DroitRh } from '../../shared/constants.ts';
import type { CurrentUser, Dataset } from '../../shared/types.ts';

/** Vue d'un manager ou d'un collaborateur (`vueDe`, server/src/dataset.ts). */
export interface ContexteVueSalarie {
  /** Instantané complet (lecture partagée), jamais modifié. */
  full: Dataset;
  /** Domaine de l'instantané complet. */
  d: Domain;
  user: CurrentUser;
  /** Salariés du périmètre de la vue (`scopeIds` : équipe, délégués, consultation N+2 ; lui-même). */
  ids: ReadonlySet<number>;
  /** Lignes des salariés du périmètre, dans l'ordre de la table (index par salarié : server/src/vues-cache.ts). */
  mine: <T extends { empId: number }>(list: readonly T[]) => T[];
  /** Salariés vus en consultation seule (N+2, hors délégation) : ni entretiens, ni demandes au service RH. */
  lecture: ReadonlySet<number>;
}

/** Vue d'un profil restreint de l'espace RH (`vueProfil`), comptabilité exceptée (liste blanche propre). */
export interface ContexteVueProfil {
  full: Dataset;
  d: Domain;
  droits: readonly DroitRh[];
}

/** Projection d'un chantier : champs de l'instantané qu'elle remplace dans la vue. */
export type Projection = Partial<Dataset>;
