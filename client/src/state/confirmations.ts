// Confirmations des refus et des actions irréversibles, affichées par dialogs/ConfirmerDialog.tsx à la place des
// window.confirm et des boutons qui agissaient en un clic : ce qui va se passer, le bouton qui l'exécute et, pour
// un refus, le motif (obligatoire), dont l'aide nomme ceux qui le liront (instantanés de server/src/dataset.ts).
// Une confirmation n'est faite que de données : comme tout dialogue, elle se garde dans le brouillon d'une
// reconnexion Microsoft (state/brouillon.ts).
// Les actions confirmées gardent leurs contrôles serveur : un écran en retard (demande déjà traitée, feuille
// modifiée ailleurs) est refusé par le serveur et le dialogue reste ouvert avec le message.
import { fH } from '../../../shared/format.ts';
import { PERIMETRE_FICHIER } from '../../../shared/rules/lots-paie.ts';
import type { absencesDuLot } from '../../../shared/rules/absences-paie.ts';
import { feuillesDeLaPeriode, type GroupePaie, periodeLabel } from '../../../shared/rules/paie.ts';
import type { LotPaie, ModeRegularisation, SageMode } from '../../../shared/types.ts';
import type { NomAction } from '../api.ts';
import type { DialogState, UiState } from './store.tsx';
import { t, tn } from '../i18n/langue.ts';

/** Longueur maximale d'un motif (contrôlée aussi par le serveur). */
export const MOTIF_MAX = 500;

export interface Confirmation {
  titre: string;
  /** Question posée : elle décrit le dialogue pour un lecteur d'écran. */
  question: string;
  /** Conséquences, une phrase chacune. */
  suites?: string[];
  /** Libellé du bouton qui exécute l'action. */
  bouton: string;
  /** Action du serveur ; null pour une action faite sur l'appareil seulement (`local`). */
  action: NomAction | null;
  payload: Record<string, unknown>;
  /**
   * lot 11 — pwa : action faite sur l'appareil, sans le serveur. `abandonSaisie` : saisie gardée hors ligne retirée de
   * la file de l'appareil (`payload.id`, pwa/useHorsLigne.ts).
   */
  local?: 'abandonSaisie';
  /** Motif saisi, envoyé dans `payload.motif` ; `aide` dit qui le lira. */
  motif?: { label: string; requis: boolean; aide: string; placeholder?: string };
  /**
   * Après le succès : filtres d'écran à appliquer, mot de passe provisoire renvoyé à afficher (réinitialisation d'un
   * compte), dialogue d'origine à rouvrir (aussi à l'annulation : détail d'une session).
   */
  ensuite?: { ui?: Partial<UiState>; motDePasse?: { nom: string; identifiant: string }; retour?: DialogState };
}

/** Motif obligatoire d'un refus, lu par `lecteurs`. */
const motifRefus = (lecteurs: string, placeholder: string) => ({
  label: t('Reason for the refusal'), requis: true, aide: `${t('The reason is visible to ')}${lecteurs}${t(': do not put any medical information in it.')}`, placeholder,
});

/**
 * Refus d'une demande adressée au service RH (formation, habilitation, document déclaré). `objet` : intitulé
 * de la demande ; `manager` : nom du manager qui l'a faite pour son équipe ; `retire` : déclaration déjà au
 * dossier, que le refus en retire. Le refus et son motif ne sont montrés qu'au collaborateur (server/src/dataset.ts) :
 * le manager qui a fait la demande n'en voit rien dans son espace.
 */
export function refusDemande(r: { id: number; type: string }, nom: string, objet: string, opts: { manager?: string | null; retire?: boolean } = {}): Confirmation {
  const document = r.type === 'document';
  return {
    titre: document ? t('Refuse the declaration') : t('Refuse the request'),
    question: `${document ? t('Refuse the declaration of ') : t('Refuse the request of ')}${nom} : ${objet} ?`,
    suites: [
      document ? (opts.retire ? t('The document, already recorded in the file before HR approval, is removed from it.') : t('The file is not changed.')) : '',
      `${nom}${t(' sees the refusal and its reason in their space.')}`,
      opts.manager ? `${t('The refusal does not appear in the space of ')}${opts.manager}${t(', who made the request: to tell if needed.')}` : '',
    ].filter(Boolean),
    bouton: document ? t('Refuse the declaration') : t('Refuse the request'),
    action: 'demande.refuser',
    payload: { id: r.id },
    motif: motifRefus(nom, document ? t('Document unreadable, wrong expiry date…') : t('Budget of the year committed, internal training planned…')),
  };
}

/**
 * Refus d'une demande de congé (CP, RTT, récupération) par le manager ou le service RH. `quoi` : « CP du … au … » ;
 * `manager` : nom du manager du salarié quand ce n'est pas lui qui refuse (il voit le motif dans ses absences).
 */
export function refusAbsence(a: { id: number }, nom: string, quoi: string, manager?: string | null): Confirmation {
  return {
    // Chaînes sources anglaises (CU-N01), comme l'écran Congés & absences qui l'ouvre.
    titre: t('Refuse the absence request'),
    question: `${t('Refuse the request of ')}${nom} : ${quoi} ?`,
    suites: [t('The balance is not debited and Keystone is not told.'), `${nom}${t(' sees the refusal and its reason in their absences')}${manager ? `${t(', like their manager, ')}${manager}` : ''}.`],
    bouton: t('Refuse the request'),
    action: 'absence.decider',
    payload: { id: a.id, ok: false },
    motif: motifRefus(manager ? `${nom}${t(' and to their manager, ')}${manager}` : nom, t('Period of heavy activity, minimum staffing not reached…')),
  };
}

/** Refus d'une demande de déplacement reçue de Keystone. `chantier` : « K-2041 · Usine de Kenitra ». */
export function refusKeystone(dm: { id: number }, nom: string, chantier: string): Confirmation {
  return {
    titre: t('Refuse the Keystone request'),
    question: `${t('Refuse the trip of ')}${nom}${t(' for the worksite ')}${chantier}${t('?#question')}`,
    suites: [t('Keystone receives the decision and the project manager is notified of it, without the reason.'), t('The refusal is entered in the Cursus log (Settings) with its reason, its date and your name.')],
    bouton: t('Refuse the request'),
    action: 'keystone.refuser',
    payload: { id: dm.id },
    motif: { label: t('Reason for the refusal'), requis: true, aide: t('The reason stays in Cursus, readable by HR in the log: it is never sent to Keystone.'), placeholder: t('Visa impossible to obtain in time, authorisation missing…') },
  };
}

/** Suppression d'une ligne de feuille de temps qui porte des heures (`payload` : ligne visée, voir temps.removeLine). */
export function suppressionLigne(payload: Record<string, unknown>, ligne: string, heures: number): Confirmation {
  return {
    titre: t('Delete the line'),
    question: `${t('Delete the line ')}${ligne}${t(' and its ')}${fH(heures)}${t('?#question')}`,
    suites: [t('The hours of this line are erased from the week’s timesheet.')],
    bouton: t('Delete the line'),
    action: 'temps.removeLine',
    payload,
  };
}

/** Transmission à Sage Paie des feuilles validées en attente. */
/**
 * Transmission à Sage Paie, possible seulement en simulation (server/src/integrations/sage/sage.ts) : rien n'est envoyé, les
 * feuilles sont marquées transmises. `periodes` : feuilles par période de paie, dont les rappels d'une période close
 * (`feuillesParPeriode` de shared/rules/paie.ts), annoncés avant de confirmer.
 */
export function transmissionSage(feuilles: number, salaries: number, periodes: GroupePaie[] = [], perimetre = PERIMETRE_FICHIER, absences: AbsencesLot | null = null): Confirmation {
  const rappels = periodes.filter(p => p.origine);
  // Feuilles distinctes : une semaine ventilée jour par jour entre un rappel et la période ouverte n'y compte qu'une fois.
  const parPeriode = feuillesDeLaPeriode(periodes).map(p => `${periodeLabel(p.periode)} (${tn(p.feuilles, 'timesheet', 'timesheets')})`);
  return {
    titre: t('Pass to Sage Paie (simulation)'),
    question: `${t('Mark as passed to Sage Paie ')}${tn(feuilles, 'approved timesheet', 'approved timesheets')} (${tn(salaries, 'employee#salarie', 'employees#salarie')})${t('?#question')}`,
    suites: [
      t('Simulation: nothing is sent to Sage Paie. The timesheets are only marked as passed and will no longer be offered.'),
      parPeriode.length ? `${t(parPeriode.length > 1 ? 'Pay periods' : 'Pay period')}${t(': ')}${parPeriode.join(', ')}.` : '',
      ...rappels.map(r => rappelTexte(r)),
      absencesSuite(absences),
      perimetre,
    ].filter(Boolean),
    bouton: t('Mark as passed'),
    action: 'temps.pushSage',
    payload: {},
  };
}

/**
 * Génération du lot de paie d'une période (components/LotsPaie.tsx) : feuilles réservées, transmises seulement à la
 * confirmation de l'import ; rappels de périodes closes, salariés sans matricule (simulation), périmètre du fichier.
 */
export function generationLot(o: {
  periode: string; feuilles: number; salaries: number; rappels: GroupePaie[]; mode: SageMode; sansMatricule: string[]; perimetre?: string; absences?: AbsencesLot | null;
  /** Feuilles rouvertes après leur transmission, régularisées par ce lot (lot correctif, t131) ; mode du format du fichier. */
  correctifs?: number; regularisation?: ModeRegularisation;
  /** « Annule et remplace » : feuilles ordinaires laissées au lot suivant (le lot correctif part seul). */
  enAttente?: number;
  /** Soldes de sortie emportés (t128, rubriques de sortie actives). */
  sorties?: number;
  /** Déplacements du lot (t031) : salariés, et éléments à saisir dans Sage (rubrique désactivée, réglage décoché). */
  deplacements?: { salaries: number; aSaisir: number };
}): Confirmation {
  const simulation = o.mode === 'simulation';
  const absences = o.absences?.absences ? `, ${tn(o.absences.absences, 'absence', 'absences')}` : '';
  const sorties = o.sorties ? `, ${tn(o.sorties, 'departure balance', 'departure balances')}` : '';
  return {
    titre: t(simulation ? 'Generate the batch (simulation)' : 'Generate the import file'),
    question: `${t('Generate the batch #lot')}${t(/^[aeiou]/.test(periodeLabel(o.periode)) ? 'of #elided' : 'of #de')}${periodeLabel(o.periode)}${t(': ')}${tn(o.feuilles, 'approved timesheet', 'approved timesheets')}${absences}${sorties} (${tn(o.salaries, 'employee#salarie', 'employees#salarie')})${t('?#question')}`,
    suites: [
      simulation
        ? t('Simulation: nothing is sent to Sage Paie. The file is downloaded for testing; the timesheets only become “passed” on confirmation.')
        : t('The timesheets are reserved for the batch. Then download its file, import it into Sage, then confirm the import: only that marks them as passed.'),
      `${t('Before this confirmation, the batch can be cancelled: its timesheets')}${o.absences?.absences ? t(' and its absences') : ''}${t(' are pending again.')}`,
      ...o.rappels.map(r => rappelTexte(r)),
      o.correctifs ? `${t('Corrective batch: ')}${tn(o.correctifs, 'timesheet reopened', 'timesheets reopened')}${t(' after transmission — ')}${o.regularisation === 'remplace'
        ? `${t('complete items of the employee for the original period (cancels and replaces). This batch goes alone, to import in replacement mode; ')}${o.enAttente ? `${tn(o.enAttente, 'other timesheet', 'other timesheets')}${t(' pending and the absences will go')}` : t('the ordinary timesheets and the absences will go')}${t(' in the next batch, to generate after the confirmation of this import and to import as usual.')}`
        : t('only the difference with what has already gone, positive or negative, as a back-pay if the original period is closed.')}` : '',
      absencesSuite(o.absences ?? null),
      o.deplacements ? `${t('Trips: days and nights of long-distance travel, days abroad and journeys of ')}${tn(o.deplacements.salaries, 'employee#salarie', 'employees#salarie')}${o.deplacements.aSaisir ? ` ; ${tn(o.deplacements.aSaisir, 'item goes', 'items go')}${t(' without a Sage code, to enter in Sage (list in the batch summary)')}` : ''}.` : '',
      o.sorties ? t('Departure balances: counters captured at departure (paid leave to compensate, RTT, time off in lieu, time savings account), in days and in hours; Sage calculates the amount of the allowance.') : '',
      o.sansMatricule.length ? `${t('Without a payroll number, under their Cursus number (simulation only): ')}${o.sansMatricule.join(', ')}.` : '',
      o.perimetre ?? PERIMETRE_FICHIER,
    ].filter(Boolean),
    bouton: t('Generate the batch'),
    action: 'paie.lotGenerer',
    payload: { periode: o.periode },
  };
}

/** Absences d'un lot (shared/rules/absences-paie.ts, `absencesDuLot`) annoncées avant de confirmer. */
type AbsencesLot = Pick<ReturnType<typeof absencesDuLot>, 'absences' | 'regularisations' | 'rappels'>;
function absencesSuite(a: AbsencesLot | null): string {
  if (!a?.absences) return '';
  return `${t('Approved absences: ')}${tn(a.absences, 'absence', 'absences')}${t(', in days (time off in lieu in hours), split by month')}`
    + (a.regularisations ? `${t(', of which #virgule')}${tn(a.regularisations, 'regularisation', 'regularisations')}${t(' of an absence cancelled, shortened or requalified after its transmission (negative quantity)')}` : '')
    + (a.rappels.length ? `${t(' ; back-pay of ')}${a.rappels.map(periodeLabel).join(', ')}${t(', period closed')}` : '') + '.';
}

/** Rappel d'une période close annoncé avant la transmission ou la génération d'un lot. */
const rappelTexte = (r: GroupePaie) =>
  `${t('Back-pay: ')}${tn(r.feuilles, 'timesheet', 'timesheets')}${t(' of #de-name')}${periodeLabel(r.origine!)}${t(', period closed, ')}${t(r.feuilles > 1 ? 'go#plural' : 'goes')}${t(' on #sur')}${periodeLabel(r.periode)}.`;

/** Annulation d'un lot dont l'import n'est pas confirmé : ses feuilles (et ses absences) sont libérées. */
export function annulationLot(lot: Pick<LotPaie, 'id' | 'periode' | 'feuilles' | 'telechargements' | 'absences'>): Confirmation {
  return {
    titre: t('Cancel the batch'),
    question: `${t('Cancel batch no. ')}${lot.id} (${periodeLabel(lot.periode)})${t('?#question')}`,
    suites: [
      lot.feuilles.length > 1
        ? `${t('Its #ses')}${lot.feuilles.length}${t(' timesheets are pending again and can go in a new batch.')}`
        : lot.feuilles.length ? t('Its timesheet is pending again and can go in a new batch.') : '',
      lot.absences?.length ? `${tn(lot.absences.length, 'absence is', 'absences are')}${t(' pending again.')}` : '',
      lot.telechargements ? t('Its file has already been downloaded: if it was imported into Sage, delete this import there, otherwise the hours would be paid twice.') : '',
    ].filter(Boolean),
    bouton: t('Cancel the batch'),
    action: 'paie.lotAnnuler',
    payload: { id: lot.id },
  };
}

/**
 * Validation groupée des feuilles soumises (components/SuiviFeuilles.tsx) : contrôles feuille par feuille, refus listés ;
 * `repos` : feuilles de la sélection qui portent une alerte de repos (shared/rules/repos-a-verifier.ts).
 */
export function validationGroupee(feuilles: { empId: number; week: string }[], salaries: number, repos = 0): Confirmation {
  return {
    titre: t('Approve the submitted timesheets'),
    question: `${t('Approve #verb')}${tn(feuilles.length, 'submitted timesheet', 'submitted timesheets')} (${tn(salaries, 'employee#salarie', 'employees#salarie')})${t('?#question')}`,
    suites: [
      t('Each timesheet goes through the approval checks: excess without a reason, pending absence request, hours on a day of absence. A refused timesheet stays to approve and the message names it.'),
      // Repos hebdomadaire ou dominical (`repos` : feuilles qui portent l'alerte) : validées quand même, signalées au RH.
      ...(repos ? [repos > 1
        ? `${repos}${t(' timesheets carry an alert of weekly or Sunday rest (7 days worked, hours on Sunday): approved anyway, they stay reported to HR (Time, “Weekly rest to check”).')}`
        : t('1 timesheet carries an alert of weekly or Sunday rest (7 days worked, hours on Sunday): approved anyway, it stays reported to HR (Time, “Weekly rest to check”).')] : []),
      t('The hours of the Keystone projects are sent back to Keystone; the approved timesheets then go to payroll.'),
    ],
    bouton: feuilles.length > 1 ? `${t('Approve the #les')}${feuilles.length}${t(' timesheets#count')}` : t('Approve the timesheet'),
    action: 'temps.validerLot',
    payload: { feuilles },
  };
}

/** Suppression d'une équipe vide (administrateur RH). */
export function suppressionEquipe(nom: string): Confirmation {
  return {
    titre: t('Delete the team'),
    question: `${t('Delete the team ')}${nom}${t('?#question')}`,
    suites: [t('Its training budget envelopes are deleted.')],
    bouton: t('Delete the team'),
    action: 'equipe.supprimer',
    payload: { nom },
  };
}

/** Retrait d'un membre de son équipe : il passe « à affecter ». `ui` : filtres appliqués ensuite (fiche fermée). */
export function retraitEquipe(empId: number, nom: string, equipe: string, ui?: Partial<UiState>): Confirmation {
  return {
    titre: t('Remove from the team'),
    question: `${t('Remove #verb')}${nom}${t(' from the team ')}${equipe}${t('?#question')}`,
    suites: [`${nom}${t(' becomes “to assign”: HR approves their hours, absences and reviews until their new assignment.')}`],
    bouton: t('Remove from the team'),
    action: 'equipe.affecter',
    payload: { empId, equipe: null },
    ...(ui ? { ensuite: { ui } } : {}),
  };
}

/**
 * Changement du manager d'une équipe (null : aucun, validations par le service RH). `rattaches` : éléments en attente des
 * managers des équipes rattachées qui changent aussi de valideur (hiérarchie, t136), décrits pour l'écran.
 */
export function changementManager(equipe: string, ancien: string | null, nouveau: { id: number; nom: string } | null, rattaches: string[] = []): Confirmation {
  return {
    titre: t('Change the manager'),
    question: nouveau ? `${t('Appoint #verb')}${nouveau.nom}${t(' manager of the team ')}${equipe}${t('?#question')}` : `${t('Remove the manager of the team ')}${equipe}${t('?#question')}`,
    suites: [
      nouveau
        ? `${nouveau.nom}${t(' now approves the hours, absences and reviews of the team')}${ancien ? `${t(', instead of ')}${ancien}` : ''}.`
        : `${t('The hours, absences and reviews of the team are approved by HR')}${ancien ? `${t(', instead of ')}${ancien}` : ''}.`,
      t('The pending requests pass to the new approver.'),
      rattaches.length
        ? `${t('Managers of the attached teams: ')}${tn(rattaches.length, 'pending item changes', 'pending items change')}${t(' approver as well, who is notified by e-mail: ')}${rattaches.join(' ; ')}.`
        : '',
    ].filter(Boolean),
    bouton: t(nouveau ? 'Appoint the manager' : 'Remove the manager'),
    action: 'equipe.manager',
    payload: { nom: equipe, managerId: nouveau?.id ?? null },
  };
}

/**
 * Équipe parente (t136) : `valideur` : nouveau valideur du manager de l'équipe (nom, ou « le service RH ») ; `redirigees` :
 * éléments en attente qui changent de valideur (shared/rules/hierarchie.ts, `elementsRediriges`), décrits pour l'écran.
 */
export function rattachementEquipe(equipe: string, parente: string | null, valideur: string | null, redirigees: string[]): Confirmation {
  return {
    titre: t(parente ? 'Attach the team' : 'Remove the parent team'),
    question: parente ? `${t('Attach the team ')}${equipe}${t(' to the team ')}${parente}${t('?#question')}` : `${t('Remove the parent team of the team ')}${equipe}${t('?#question')}`,
    suites: [
      valideur ? `${t('The absences, timesheets and reviews of the team’s manager will be approved by ')}${valideur}.` : '',
      redirigees.length
        ? `${tn(redirigees.length, 'pending item changes', 'pending items change')}${t(' approver, who is notified by e-mail: ')}${redirigees.join(' ; ')}.`
        : t('No pending item changes approver.'),
    ].filter(Boolean),
    bouton: t(parente ? 'Attach#team' : 'Remove the attachment'),
    action: 'equipe.parente',
    payload: { nom: equipe, parente },
  };
}

/**
 * Désinscription d'une session à venir. `quoi` : « SST du 18 nov. 2026 » ; `convoque` : convocation déjà reçue (même
 * remise « à renvoyer »), annulée par e-mail ; `retour` : dialogue à rouvrir ensuite (détail de la session).
 */
export function desinscription(p: { empId: number; sessionId: number }, nom: string, quoi: string,
  opts: { recyclage: boolean; convoque: boolean; retour?: DialogState }): Confirmation {
  return {
    // Chaînes sources anglaises (CU-N01), comme l'écran Formations qui l'ouvre.
    titre: t('Unenrol from the session'),
    question: `${t('Unenrol')} ${nom}${t(' from the session ')}${quoi} ?`,
    suites: [
      `${t('The place is freed')}${t(opts.recyclage ? ' and the refresher is to plan again' : ' and the enrolment in initial training is removed')}.`,
      opts.convoque ? `${nom}${t(' receives the cancellation of their notice by e-mail, with the calendar file that removes the session.')}` : '',
    ].filter(Boolean),
    bouton: t('Unenrol'),
    action: 'plan.desinscrire',
    payload: p,
    ...(opts.retour ? { ensuite: { retour: opts.retour } } : {}),
  };
}

/** Relevé d'heures des intérimaires envoyé à leur agence : renvoi, ou envoi sans les feuilles pas encore validées. */
export function envoiReleve(agence: string, adresse: string, semaine: string, numero: number, opts: { renvoi: boolean; enAttente: string[] }): Confirmation {
  return {
    titre: t(opts.renvoi ? 'Resend the statement' : 'Send the statement'),
    question: `${t(opts.renvoi ? 'Resend' : 'Send')}${t(' the statement of week ')}${numero}${t(' to #a')}${agence} (${adresse})${t('?#question')}`,
    suites: [
      opts.enAttente.length ? `${t('Timesheet not approved, missing from the statement: ')}${opts.enAttente.join(', ')}${t('. The complete statement goes on its approval.')}` : '',
      opts.renvoi ? t('The agency receives a new e-mail with the up-to-date statement.') : '',
    ].filter(Boolean),
    bouton: t(opts.renvoi ? 'Resend the statement' : 'Send the statement'),
    action: 'releve.envoyer',
    payload: { agence, semaine },
  };
}

/** Annulation d'une demande de visite médicale en cours (faite par erreur, salarié sorti…). */
export function annulationVisite(x: { id: number; le: string }, nom: string, le: string): Confirmation {
  return {
    titre: t('Cancel the visit request'),
    question: `${t('Cancel the visit request of ')}${le}${t(' for ')}${nom}${t('?#question')}`,
    suites: [t('The request is closed without a visit; a new request remains possible. The occupational health service is not notified: to inform if the request was passed to it.')],
    bouton: t('Cancel the request'),
    action: 'medical.annuler',
    payload: { id: x.id },
  };
}

/**
 * Annulation d'une sortie saisie par erreur (service RH). `sortie` : « Démission · le 30 nov. 2026 » ; `fin` : fin prévue au
 * contrat, rétablie (« 29 janv. 2027 »), null pour un contrat sans date de fin.
 */
export function annulationSortie(e: { id: number; nom: string }, sortie: string, fin: string | null): Confirmation {
  return {
    titre: t('Cancel the departure'),
    question: `${t('Cancel the departure of ')}${e.nom} (${sortie})${t('?#question')}`,
    suites: [
      fin ? `${t('The contract takes back its planned end, on ')}${fin}.` : `${t('The contract is again without an end date: ')}${e.nom}${t(' gets their access to Cursus back and returns to compliance and due dates.')}`,
      t('What the departure cancelled (absences, session enrolments, planned reviews, visit requests) is not restored: to enter again if needed.'),
      t('Keystone receives the new verdict of the worksites where the employee is assigned.'),
    ],
    bouton: t('Cancel the departure'),
    action: 'employe.annulerSortie',
    payload: { id: e.id },
  };
}

/** Comptes et accès (administrateur RH). */
/** Rattachement d'un compte (externe) à la fiche de la personne. */
export function rattachementCompte(c: { id: number; nom: string; identifiant: string }, e: { id: number; nom: string }): Confirmation {
  return {
    titre: t('Attach the account to a sheet'),
    question: `${t('Attach the account of ')}${c.nom} (${c.identifiant})${t(' to the sheet of ')}${e.nom}${t('?#question')}`,
    suites: [t('The account also opens their employee spaces.'), t('They can no longer decide on their own absences, timesheets or reviews.')],
    bouton: t('Attach the account'),
    action: 'compte.rattacher',
    payload: { id: c.id, empId: e.id },
  };
}

export function desactivationCompte(c: { id: number; nom: string }): Confirmation {
  return {
    titre: t('Deactivate the account'),
    question: `${t('Deactivate the account of ')}${c.nom}${t('?#question')}`,
    suites: [t('Their open sessions are closed at once; the account can be reactivated.')],
    bouton: t('Deactivate the account'),
    action: 'compte.activer',
    payload: { id: c.id, actif: false },
  };
}

export function delierCompte(c: { id: number; nom: string; identifiant: string }): Confirmation {
  return {
    titre: t('Unlink the Microsoft account'),
    question: `${t('Remove the Microsoft link of ')}${c.nom}${t('?#question')}`,
    suites: [`${t('Their sessions are closed; their next Microsoft sign-in with ')}${c.identifiant}${t(' will attach the account to their current Microsoft identity.')}`],
    bouton: t('Unlink the account'),
    action: 'compte.reinitialiser',
    payload: { id: c.id },
  };
}

export function nouveauMotDePasse(c: { id: number; nom: string; identifiant: string }): Confirmation {
  return {
    titre: t('New temporary password'),
    question: `${t('Assign a new temporary password to ')}${c.nom}${t('?#question')}`,
    suites: [t('The old password will no longer work and their sessions are closed.'), t('The new password is shown only once, to give to the person.')],
    bouton: t('Assign a password'),
    action: 'compte.reinitialiser',
    payload: { id: c.id },
    ensuite: { motDePasse: { nom: c.nom, identifiant: c.identifiant } },
  };
}

/** Réinitialisation des données de démonstration (administrateur RH, mode démonstration). */
export function reinitialisationDemo(): Confirmation {
  return {
    titre: t('Reset the demonstration'),
    question: t('Reset all the demonstration data?'),
    suites: [t('The changes made since the last loading are erased. A backup of the database is kept on the server.')],
    bouton: t('Reset'),
    action: 'demo.reinitialiser',
    payload: {},
  };
}

/** Erreur du motif saisi, ou null. */
export function erreurMotif(c: Confirmation, motif: string): string | null {
  if (!c.motif) return null;
  const m = motif.trim();
  // « Indiquez le motif du refus. », « Indiquez le motif de l’annulation. »
  if (c.motif.requis && !m) return `${t('Enter the #motif')}${c.motif.label.charAt(0).toLowerCase()}${c.motif.label.slice(1)}.`;
  if (m.length > MOTIF_MAX) return `${t('Reason too long (')}${MOTIF_MAX}${t(' characters at most).')}`;
  return null;
}

/** Paramètres envoyés : ceux de la confirmation, et le motif s'il y en a un. */
export const parametres = (c: Confirmation, motif: string): Record<string, unknown> =>
  c.motif ? { ...c.payload, motif: motif.trim() } : c.payload;

// lot 11 — pwa

/**
 * Abandon d'une saisie gardée sur l'appareil (file hors ligne, bandeau « saisies en attente d'envoi ») : elle est effacée
 * de l'appareil sans jamais partir. `libelle` : la saisie telle que la liste l'affiche ; `conflit` : refusée parce que la
 * cellule a changé, à ressaisir dans la feuille.
 */
export function abandonSaisie(id: string, libelle: string, conflit = false): Confirmation {
  return {
    titre: t('Abandon the entry'),
    question: `${t('Abandon the entry “')}${libelle}${t('”?')}`,
    suites: [
      t('It is erased from this device and will never be sent.'),
      conflit ? t('The timesheet keeps the value saved on the server: enter yours again there if it must replace it.') : '',
    ].filter(Boolean),
    bouton: t('Abandon the entry'),
    action: null,
    local: 'abandonSaisie',
    payload: { id },
  };
}
