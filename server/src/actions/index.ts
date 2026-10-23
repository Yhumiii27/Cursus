// Registre des actions métier exposées par POST /api/actions/:nom.
import { absencesActions } from './absences.ts';
import { activitesActions } from './activites.ts';
import { annulationEntretienActions } from './annulation-entretien.ts';
import { avenantsActions } from './avenants.ts';
import { budgetActions } from './budget.ts';
import { cloturesActions } from './clotures.ts';
import { informationRetourActions } from './information-retour.ts';
import { comptesActions } from './comptes.ts';
import { conformiteActions } from './conformite.ts';
import { correctionsActions } from './corrections.ts';
import { confidentialiteActions } from './confidentialite.ts';
import type { ActionHandler } from './context.ts';
import { convocationsActions } from './convocations.ts';
import { delegationActions } from './delegation.ts';
import { deplacementsActions } from './deplacements.ts';
import { entretiensActions } from './entretiens.ts';
import { envoisActions } from './envois.ts';
import { equipesActions } from './equipes.ts';
import { equipeModifierActions } from './equipe-modifier.ts';
import { exercicesActions } from './exercices.ts';
import { hierarchieActions } from './hierarchie.ts';
import { delegationsManagerActions } from './delegations-manager.ts';
import { messagerieActions } from './messagerie.ts';
import { paieActions } from './paie.ts';
import { parametresActions } from './parametres.ts';
import { piecesActions } from './pieces.ts';
import { referentielsActions } from './referentiels.ts';
import { remiseActions } from './remise.ts';
import { reouvertureActions } from './reouverture.ts';
import { repriseActions } from './reprise.ts';
import { reposDominicalActions } from './repos-dominical.ts';
import { santeActions } from './sante.ts';
import { sessionsActions } from './sessions.ts';
import { sortiesActions } from './sorties.ts';
import { suiviFeuillesActions } from './suivi-feuilles.ts';
import { contratsActions } from './contrats.ts';
import { tempsActions } from './temps.ts';
import { voyagesActions } from './voyages.ts';
import { deplacementsPaieActions } from './deplacements-paie.ts';
import { contactUrgenceActions } from './contact-urgence.ts';
import { feriesActions } from './feries.ts';
import { horairesActions } from './horaires.ts';
import { forfaitJoursActions } from './forfait-jours.ts';
import { fractionnementActions } from './fractionnement.ts';
import { formationsSuiviesActions } from './formations-suivies.ts';
import { conservationActions } from './conservation.ts';
import { agendaActions } from './agenda.ts';
import { astreintesActions } from './astreintes.ts';
import { c2pActions } from './c2p.ts';
import { listeAttenteActions } from './liste-attente.ts';
import { passeportPreventionActions } from './passeport-prevention.ts';

/**
 * Registre typé (t164) : chaque famille est déclarée avec « satisfies Record<string, ActionHandler> », ce qui garde ses
 * noms ; `NomAction` les réunit, et le client type `run` et `api.action` avec lui (import de type seulement) : tsc
 * signale tout nom d'action mal écrit. Les noms construits à l'exécution sont vérifiés par tests/actions-contrat.test.ts.
 */
const REGISTRE = {
  ...conformiteActions,
  ...sessionsActions,
  ...voyagesActions,
  ...budgetActions,
  ...tempsActions,
  ...reouvertureActions,
  ...absencesActions,
  ...entretiensActions,
  ...equipesActions,
  ...hierarchieActions,
  ...delegationsManagerActions,
  ...parametresActions,
  ...comptesActions,
  ...envoisActions,
  ...convocationsActions,
  ...messagerieActions,
  ...santeActions,
  ...referentielsActions,
  ...cloturesActions,
  ...informationRetourActions,
  ...sortiesActions,
  ...contratsActions,
  ...avenantsActions,
  ...paieActions,
  ...remiseActions,
  ...exercicesActions,
  ...confidentialiteActions,
  ...repriseActions,
  ...suiviFeuillesActions,
  ...deplacementsActions,
  ...annulationEntretienActions,
  ...equipeModifierActions,
  ...activitesActions,
  ...delegationActions,
  ...reposDominicalActions,
  ...correctionsActions,
  ...piecesActions,
  ...deplacementsPaieActions,
  ...contactUrgenceActions,
  ...feriesActions,
  ...horairesActions,
  ...forfaitJoursActions,
  ...fractionnementActions,
  ...formationsSuiviesActions,
  ...conservationActions,
  ...agendaActions,
  ...astreintesActions,
  ...c2pActions,
  ...listeAttenteActions,
  ...passeportPreventionActions,
} satisfies Record<string, ActionHandler>;

/** Nom d'une action exposée par POST /api/actions/:nom. */
export type NomAction = keyof typeof REGISTRE;

/** Recherche par nom reçu (chaîne quelconque de la requête) : un nom inconnu donne undefined. */
export const ACTIONS: Record<string, ActionHandler> = REGISTRE;

/**
 * Familles d'actions sans effet sur un verdict Go / No Go (temps, compteurs de congés, entretiens, budget, équipes, envois,
 * messagerie, page Confidentialité et formations suivies, qui ne sont pas des certifications) :
 * après toute autre action, les verdicts transmis à Keystone sont recalculés (integrations/keystone-verdicts.ts).
 * Les actions d'absence en font partie : une absence pendant la présence sur un chantier bloque la ressource.
 */
const SANS_EFFET_VERDICT = ['temps.', 'cet.', 'report.', 'conges.', 'entretien.', 'budget.', 'equipe.', 'envoi.', 'convocation.', 'messagerie.', 'notification.', 'releve.', 'paie.', 'confidentialite.', 'mandat.', 'piece.', 'forfait.', 'formationSuivie.', 'agenda.'];
export const changeVerdicts = (nom: string) => !SANS_EFFET_VERDICT.some(p => nom.startsWith(p));
