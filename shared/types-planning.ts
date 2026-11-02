// Planning d'équipe (lot 12, chantier C5, t192) : modèle de données des cycles de roulement, des affectations, des besoins
// par poste, des créneaux planifiés, des publications et des échanges de poste. Règles : shared/rules/cycles.ts,
// shared/rules/planning.ts, shared/rules/planning-controles.ts ; actions : server/src/actions/planning.ts ; vues par espace
// et par profil : server/src/vues-planning.ts. Tables déclarées dans server/src/db.ts (bloc « lot 12 — C5 »), migration
// PostgreSQL server/migrations-pg/0026_planning_equipe.sql. Module livré désactivé (réglage `planningActif`) jusqu'à l'avis
// du CSE.
import type { Exigences, ISODate } from './types.ts';

/** Groupe d'un cycle (A, B, C…) et son décalage en jours sur la séquence. */
export interface GroupeCycle { code: string; decalage: number }

/**
 * Cycle de roulement (référentiel commun, écran Référentiels → Cycles) : code choisi une fois pour toutes, libellé, longueur
 * en jours, séquence des codes d'horaire jour par jour (null : repos), groupes et leur décalage, jour d'origine (premier
 * jour de la séquence pour le groupe de décalage 0). On l'archive au lieu de le supprimer.
 */
export interface Cycle {
  code: string; nom: string; longueur: number; sequence: (string | null)[]; groupes: GroupeCycle[]; origine: ISODate;
  archive: ISODate | null; creeLe: string; creePar: string;
}

/**
 * Affectation d'un salarié à un cycle (`roulements`) : groupe, du `du` au `au` (null : sans fin), équipe figée à
 * l'affectation. Jamais deux affectations du même salarié qui se chevauchent. Terminée par une date de fin (`finLe`,
 * `finPar`, `finMotif` : texte libre, jamais journalisé ni transmis hors du planificateur).
 */
export interface Roulement {
  id: number; empId: number; cycle: string; groupe: string; du: ISODate; au: ISODate | null; equipe: string | null;
  creeLe: string; creePar: string; finLe: string | null; finPar: string | null; finMotif: string | null;
}

/**
 * Besoin par poste d'une équipe (référentiel commun) : horaire, jours de la semaine (0 = lundi … 6 = dimanche), effectif
 * minimal, poste ou activité, exigences propres au créneau (en plus de celles du poste et de l'équipe), période.
 */
export interface BesoinPoste {
  id: number; equipe: string; horaire: string; jours: number[]; effectifMin: number; posteId: number | null; activite: string | null;
  exigences: Exigences; du: ISODate; au: ISODate | null; archive: ISODate | null;
}

/** Origine d'un créneau. */
export type SourceCreneau = 'cycle' | 'manuel' | 'echange' | 'remplacement';
/**
 * État d'un créneau : brouillon (généré ou corrigé, pas encore communiqué), publié (communiqué au salarié), remplacé (une
 * version publiée plus récente, ou un échange, le remplace : gardé pour l'inspection du travail), annulé (avec motif).
 */
export type StatutCreneau = 'brouillon' | 'publie' | 'remplace' | 'annule';

/**
 * Créneau planifié : un salarié (null : « à pourvoir », rattaché à l'équipe), un jour, un horaire (null : repos) et ses
 * heures figées (début, fin « HH:MM » à l'heure de Paris, la fin avant le début : le lendemain ; pause en minutes).
 * - Publication : version de la publication de l'équipe, auteur, jour où le salarié en a été informé (`communiqueLe` :
 *   envoi effectif de l'e-mail, jamais la notification push retardée par la plage de silence), hors du délai de
 *   prévenance (`horsDelai`) avec le motif des circonstances exceptionnelles (`motif`, texte libre jamais journalisé).
 * - Alertes acceptées à la publication : codes (`alertesAcceptees`, dont la réserve d'aptitude, visible du planificateur
 *   seul) et motif (`motifAlertes`, texte libre jamais journalisé).
 * - `remplaceId` : version publiée que ce brouillon remplacera à sa publication (modification d'un créneau publié).
 */
export interface Creneau {
  id: number; empId: number | null; jour: ISODate; equipe: string | null; horaire: string | null; debut: string | null; fin: string | null; pause: number;
  besoinId: number | null; source: SourceCreneau; statut: StatutCreneau; remplaceId: number | null;
  version: number | null; publieLe: string | null; publiePar: string | null; communiqueLe: ISODate | null;
  horsDelai: boolean; motif: string | null; motifAlertes: string | null; alertesAcceptees: string[] | null;
  creeLe: string; creePar: string; modifieLe: string | null; modifiePar: string | null;
  annuleLe: string | null; annulePar: string | null; annuleMotif: string | null;
}

/**
 * Publication du planning d'une équipe pour une période, versionnée (registre pour l'inspection du travail, art. D3171-16) :
 * nombre de créneaux publiés et de créneaux hors du délai de prévenance.
 */
export interface PublicationPlanning {
  id: number; equipe: string; du: ISODate; au: ISODate; version: number; publieLe: string; publiePar: string; communiqueLe: ISODate;
  creneaux: number; horsDelai: number;
}

/** État d'un échange de poste : proposé par A, accepté par B, validé (ou refusé) par le manager, annulé, expiré. */
export type StatutEchange = 'propose' | 'accepte' | 'valide' | 'refuse' | 'annule' | 'expire';
/**
 * Échange de poste (`echangesPoste`) : le demandeur cède son créneau publié au partenaire, ou l'échange contre un créneau
 * publié du partenaire (`creneauPartenaire`). Validé par le manager des deux salariés (ou son suppléant par délégation
 * « planning »), ou le service RH. `motifRefus` : texte libre, montré aux deux salariés, jamais journalisé.
 */
export interface EchangePoste {
  id: number; demandeurId: number; partenaireId: number; creneauDemandeur: number; creneauPartenaire: number | null; statut: StatutEchange;
  creeLe: string; accepteLe: string | null; decideLe: string | null; decidePar: string | null; parDelegationDe: number | null;
  motifRefus: string | null; alertesAcceptees: string[] | null;
}
