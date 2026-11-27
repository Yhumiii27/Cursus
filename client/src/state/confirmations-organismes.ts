// lot 12 — C4 (organismes de formation et e-learning) : confirmations des actions sur les organismes, les modules et les
// inscriptions à l'e-learning (dialogs/ConfirmerDialog.tsx). Le motif d'une suppression d'inscription est lu par le seul
// service RH (server/src/vues-organismes.ts) et n'est jamais recopié au journal.
import type { InscriptionElearning, ModuleElearning, Organisme, OrganismeContact, OrganismeTarif } from '../../../shared/types-organismes.ts';
import { aideMotifCorrection } from './confirmations-corrections.ts';
import type { Confirmation } from './confirmations.ts';
import { t, tn } from '../i18n/langue.ts';

/** Archivage d'une fiche : plus proposée dans les dialogues ; ce qui la désigne déjà la garde. */
export function archivageOrganisme(o: Pick<Organisme, 'id' | 'nomUsuel'>, sessions: number): Confirmation {
  return {
    titre: t('Archive the training provider'),
    question: `${t('Archive the training provider “')}${o.nomUsuel}${t('”?')}`,
    suites: [
      t('It is no longer offered: catalogue, sessions, plan, attended training, OPCO files, e-learning modules.'),
      sessions ? `${tn(sessions, 'session keeps it', 'sessions keep it')}${t(' (history and evaluations).')}` : t('No session designates it.'),
      t('Its contacts and rates stay on the sheet; it can be restored at any time.'),
    ],
    bouton: t('Archive'),
    action: 'organisme.archiver',
    payload: { id: o.id },
  };
}

/** Retrait d'un contact (archivé, jamais effacé : il reste lisible du service RH et du référent). */
export function retraitContact(c: Pick<OrganismeContact, 'id' | 'nom'>, organisme: string): Confirmation {
  return {
    titre: t('Remove the contact'),
    question: `${t('Remove #verb')}${c.nom}${t(' from the contacts of ')}${organisme}${t('?#question')}`,
    suites: [t('They are no longer offered as a recipient; the sheet keeps a trace of them (contact removed).')],
    bouton: t('Remove the contact'),
    action: 'organisme.contact.retirer',
    payload: { id: c.id },
  };
}

/** Archivage d'un tarif : il ne préremplit plus aucun coût. */
export function archivageTarif(x: Pick<OrganismeTarif, 'id'>, quoi: string, organisme: string): Confirmation {
  return {
    titre: t('Archive the rate'),
    question: `${t('Archive the rate “')}${quoi}${t('” of ')}${organisme}${t('?#question')}`,
    suites: [t('It no longer pre-fills the cost of a plan line or of an OPCO file; the costs already entered do not change.')],
    bouton: t('Archive the rate'),
    action: 'organisme.tarif.archiver',
    payload: { id: x.id },
  };
}

/** Archivage d'un module : plus proposé à l'inscription ; les inscriptions ouvertes continuent. */
export function archivageModule(m: Pick<ModuleElearning, 'id' | 'code' | 'intitule'>, ouvertes: number): Confirmation {
  return {
    titre: t('Archive the module'),
    question: `${t('Archive the module ')}${m.code} — ${m.intitule}${t('?#question')}`,
    suites: [
      t('No one can be enrolled in it any more.'),
      ouvertes ? `${tn(ouvertes, 'open enrolment continues', 'open enrolments continue')}${t(' until its completion or dropping out.')}` : t('No open enrolment.'),
    ],
    bouton: t('Archive'),
    action: 'elearning.module.archiver',
    payload: { id: m.id },
  };
}

/** Abandon d'une inscription ouverte (droit « formations ») : le statut affiché accompagne la demande. */
export function abandonInscription(i: Pick<InscriptionElearning, 'id' | 'statut'>, nom: string, module: string): Confirmation {
  return {
    // Chaînes sources anglaises (CU-N01), comme l'onglet E-learning qui l'ouvre.
    titre: t('Dropping out of the module'),
    question: `${t('Record the dropping out of the module ')}${module}${t(' by ')}${nom} ?`,
    suites: [t('The enrolment is closed without training followed; a new enrolment remains possible.'), `${nom}${t(' sees the dropping out in their space.')}`],
    bouton: t('Record the dropping out'),
    action: 'elearning.abandonner',
    payload: { id: i.id, de: i.statut },
  };
}

/** Suppression d'une inscription saisie par erreur (administrateur RH), motif obligatoire. */
export function annulationInscription(i: Pick<InscriptionElearning, 'id'>, nom: string, module: string): Confirmation {
  return {
    titre: t('Delete the enrolment'),
    question: `${t('Delete the enrolment of ')}${nom}${t(' in the module ')}${module} ?`,
    suites: [t('It stays in the database, dated and signed, but no longer appears anywhere, not even in the employee’s space.')],
    bouton: t('Delete the enrolment'),
    action: 'elearning.annuler',
    payload: { id: i.id },
    motif: { label: t('Reason for the deletion'), requis: true, placeholder: t('Enrolment on the wrong sheet, duplicate module…'), aide: aideMotifCorrection() },
  };
}
