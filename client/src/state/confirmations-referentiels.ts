// Confirmations de l'écran Référentiels (dialogue « confirmer », comme celles de state/confirmations.ts) : archivage
// d'une formation, d'une habilitation, d'une destination, d'un poste, d'une activité interne ou d'un horaire, chargement du référentiel type, demande d'une
// habilitation exigée. Données seulement.
// L'archivage se défait (« Rétablir », sans confirmation) ; la confirmation annonce ce qu'il change, dont les demandes des
// collaborateurs encore en attente : sur un élément archivé, elles ne s'acceptent plus (à refuser, ou à rétablir d'abord).
import { CODE_DELEGATION } from '../../../shared/rules/activites.ts';
import type { ReferentielId } from '../../../shared/rules/referentiels.ts';
import type { Destination, Formation, HabType, Horaire, Poste, Projet } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';
import { t, tn } from '../i18n/langue.ts';

/** Demandes des collaborateurs en attente sur l'élément (`quoi` : « la formation »…) : elles ne s'acceptent plus une fois archivé. */
const demandesTexte = (demandes: number, quoi: string) => (demandes
  ? [`${tn(demandes, 'employee request awaits', 'employee requests await')}${t(' an answer (dashboard): ')}${t(demandes > 1 ? 'they can now only be refused' : 'it can now only be refused')}${t(', unless restoring ')}${quoi}.`]
  : []);

/**
 * Archivage d'une formation du catalogue ; `titulaires` : salariés qui en détiennent une certification ; `demandes` :
 * demandes de formation des collaborateurs en attente de réponse.
 */
export function archivageFormation(f: Pick<Formation, 'id' | 'court'>, titulaires: number, demandes = 0): Confirmation {
  return {
    titre: t('Archive the training course'),
    question: `${t('Archive the training course “')}${f.court}${t('”?')}`,
    suites: [
      t('It is no longer offered: catalogue, sessions, certifications, employee requests.'),
      titulaires
        ? `${t('The certifications of ')}${tn(titulaires, 'employee#salarie', 'employees#salarie')}${t(' stay in the file (history, prerequisites, Go / No Go), without counting in the statuses or the due dates.')}`
        : t('No employee holds a certification of it.'),
      ...demandesTexte(demandes, t('the training course')),
      t('It remains recognised in the exchanges with Keystone, and can be restored at any time.#fem'),
    ],
    bouton: t('Archive'),
    action: 'referentiel.formation.archiver',
    payload: { id: f.id },
  };
}

/**
 * Archivage d'une habilitation ; `titres` : titres délivrés à des salariés ; `attente` : demandes des collaborateurs en
 * attente de réponse, et titres demandés pas encore délivrés (« En attente » ou « Redemandée » de l'écran Habilitations).
 */
export function archivageHabilitation(h: Pick<HabType, 'id' | 'nom'>, titres: number, attente: { demandes: number; aDelivrer: number } = { demandes: 0, aDelivrer: 0 }): Confirmation {
  const { demandes, aDelivrer } = attente;
  return {
    titre: t('Archive the authorisation'),
    question: `${t('Archive the authorisation “')}${h.nom}${t('”?')}`,
    suites: [
      t('It is no longer offered: issue, employee requests.'),
      titres
        ? `${tn(titres, 'issued title stays', 'issued titles stay')}${t(' in the file and in the Go / No Go, without counting in the statuses or the due dates.')}`
        : t('No title has been issued.'),
      ...(aDelivrer
        ? [aDelivrer > 1
          ? `${aDelivrer}${t(' requested titles await their issue: they leave the Authorisations screen and are no longer issued, unless restoring the authorisation.')}`
          : t('1 requested title awaits its issue: it leaves the Authorisations screen and is no longer issued, unless restoring the authorisation.')]
        : []),
      ...demandesTexte(demandes, t('the authorisation')),
      t('It remains recognised in the exchanges with Keystone, and can be restored at any time.#fem'),
    ],
    bouton: t('Archive'),
    action: 'referentiel.habilitation.archiver',
    payload: { id: h.id },
  };
}

/** Archivage d'une destination ; `prevus` : déplacements non terminés vers ce pays. */
export function archivageDestination(dest: Pick<Destination, 'code' | 'pays'>, prevus: number): Confirmation {
  return {
    titre: t('Archive the destination'),
    question: `${t('Archive the destination “')}${dest.pays}${t('”?')}`,
    suites: [
      t('It is no longer offered for a new trip (entry, import), nor for a visa.'),
      prevus ? `${tn(prevus, 'planned trip keeps', 'planned trips keep')}${t(' its travel file.')}` : t('No trip planned to this country.'),
      t('A Keystone request to this country is still received; the destination can be restored at any time.'),
    ],
    bouton: t('Archive'),
    action: 'referentiel.destination.archiver',
    payload: { id: dest.code },
  };
}

/** Référentiel type (celui de la démonstration, server/src/seed.ts) : ce qu'il ajoute, en quelques mots. */
const TYPE_LIBELLE: Record<ReferentielId, [string, string]> = {
  formations: ['the standard training catalogue', 'The 11 common training courses of an industrial site (first aid, electrical authorisation, ATEX, CACES, fire…) are added to the catalogue.'],
  habilitations: ['the standard authorisations reference data', 'The 6 common authorisations (electrical, driving forklifts and aerial platforms, ATEX, work at height, AIPR) are added, with their prerequisite training courses.'],
  destinations: ['the standard destinations reference data', 'The 8 destinations of the demonstration (Morocco, India, United States, Ivory Coast…) are added, with their entry formalities.'],
};

/** Chargement du référentiel type dans un référentiel vide, à vérifier ensuite par le service RH. */
export function chargementType(ref: ReferentielId): Confirmation {
  const [quoi, ajout] = TYPE_LIBELLE[ref].map(s => t(s));
  return {
    titre: t('Load the standard reference data'),
    question: `${t('Load #verb')}${quoi}${t('?#question')}`,
    suites: [ajout, t('To check and complete afterwards: validities, costs, training providers, signatories, formalities. Unneeded items are archived.')],
    bouton: t('Load'),
    action: 'referentiel.charger',
    payload: { referentiel: ref },
  };
}

/** Archivage d'un poste inoccupé (le serveur refuse tant qu'un salarié présent l'occupe). */
export function archivagePoste(p: Pick<Poste, 'id' | 'nom'>): Confirmation {
  return {
    titre: t('Archive the job'),
    question: `${t('Archive the job “')}${p.nom}${t('”?')}`,
    suites: [
      t('It is no longer offered on the sheets; those of employees who have left keep it, with its title.'),
      t('It can be restored at any time, with its requirements.'),
    ],
    bouton: t('Archive'),
    action: 'referentiel.poste.archiver',
    payload: { id: p.id },
  };
}

/** Archivage d'une activité interne (onglet Activités internes) : plus imputable dans les feuilles de temps. */
export function archivageActivite(a: Pick<Projet, 'code' | 'nom'>): Confirmation {
  return {
    titre: t('Archive the activity'),
    question: `${t('Archive the activity ')}${a.code}${t(' “')}${a.nom}${t('”?')}`,
    suites: [
      t('It is no longer offered in the timesheets: no new line is charged to it. The hours already entered stay on the timesheets.'),
      ...(a.code === CODE_DELEGATION ? [t('It is the code of the delegation hours: the CSE members will no longer be able to declare any as long as it is not restored.')] : []),
      t('It can be restored at any time.#fem'),
    ],
    bouton: t('Archive'),
    action: 'referentiel.activite.archiver',
    payload: { id: a.code },
  };
}

/**
 * Habilitation exigée jamais délivrée, demandée par le service RH ou le référent HSE (Échéances, tableau de bord, fiche) :
 * le titre « en attente » créé ne se retire pas, d'où la confirmation.
 */
export function demandeHabilitation(x: { empId: number; h: string; nom: string; label: string }): Confirmation {
  return {
    titre: t('Request the authorisation'),
    question: `${t('Request the authorisation “')}${x.label}${t('” for ')}${x.nom}${t('?#question')}`,
    suites: [
      t('A title “awaiting” issue is added to the Authorisations screen; it is issued after checking the prerequisites.'),
      t('Once requested, the title is not withdrawn: it stays pending until its issue.'),
    ],
    bouton: t('Request the authorisation'),
    action: 'hab.demander',
    payload: { empId: x.empId, h: x.h },
  };
}

/** Archivage d'un horaire de poste (lot 6, shared/rules/horaires.ts) : plus proposé, les feuilles qui le portent le gardent. */
export function archivageHoraire(h: Pick<Horaire, 'code' | 'nom'>): Confirmation {
  return {
    titre: t('Archive the schedule'),
    question: `${t('Archive the schedule ')}${h.code}${t(' “')}${h.nom}${t('”?')}`,
    suites: [
      t('It is no longer offered in the timesheets nor as a team’s default schedule.'),
      t('The timesheets that carry it already keep it. It can be restored at any time.'),
    ],
    bouton: t('Archive'),
    action: 'referentiel.horaire.archiver',
    payload: { id: h.code },
  };
}
