// lot 12 — C4 (organismes de formation et e-learning) : confirmations des actions sur les organismes, les modules et les
// inscriptions à l'e-learning (dialogs/ConfirmerDialog.tsx). Le motif d'une suppression d'inscription est lu par le seul
// service RH (server/src/vues-organismes.ts) et n'est jamais recopié au journal.
import { plural } from '../../../shared/format.ts';
import type { InscriptionElearning, ModuleElearning, Organisme, OrganismeContact, OrganismeTarif } from '../../../shared/types-organismes.ts';
import { aideMotifCorrection } from './confirmations-corrections.ts';
import type { Confirmation } from './confirmations.ts';
import { t } from '../i18n/langue.ts';

/** Archivage d'une fiche : plus proposée dans les dialogues ; ce qui la désigne déjà la garde. */
export function archivageOrganisme(o: Pick<Organisme, 'id' | 'nomUsuel'>, sessions: number): Confirmation {
  return {
    titre: 'Archiver l’organisme',
    question: `Archiver l’organisme « ${o.nomUsuel} » ?`,
    suites: [
      'Il n’est plus proposé : catalogue, sessions, plan, formations suivies, dossiers OPCO, modules d’e-learning.',
      sessions ? `${plural(sessions, 'session le garde', 'sessions le gardent')} (historique et évaluations).` : 'Aucune session ne le désigne.',
      'Ses contacts et tarifs restent sur la fiche ; elle se rétablit à tout moment.',
    ],
    bouton: 'Archiver',
    action: 'organisme.archiver',
    payload: { id: o.id },
  };
}

/** Retrait d'un contact (archivé, jamais effacé : il reste lisible du service RH et du référent). */
export function retraitContact(c: Pick<OrganismeContact, 'id' | 'nom'>, organisme: string): Confirmation {
  return {
    titre: 'Retirer le contact',
    question: `Retirer ${c.nom} des contacts de ${organisme} ?`,
    suites: ['Il n’est plus proposé comme destinataire ; la fiche garde sa trace (contact retiré).'],
    bouton: 'Retirer le contact',
    action: 'organisme.contact.retirer',
    payload: { id: c.id },
  };
}

/** Archivage d'un tarif : il ne préremplit plus aucun coût. */
export function archivageTarif(t: Pick<OrganismeTarif, 'id'>, quoi: string, organisme: string): Confirmation {
  return {
    titre: 'Archiver le tarif',
    question: `Archiver le tarif « ${quoi} » de ${organisme} ?`,
    suites: ['Il ne préremplit plus le coût d’une ligne du plan ni d’un dossier OPCO ; les coûts déjà saisis ne changent pas.'],
    bouton: 'Archiver le tarif',
    action: 'organisme.tarif.archiver',
    payload: { id: t.id },
  };
}

/** Archivage d'un module : plus proposé à l'inscription ; les inscriptions ouvertes continuent. */
export function archivageModule(m: Pick<ModuleElearning, 'id' | 'code' | 'intitule'>, ouvertes: number): Confirmation {
  return {
    titre: 'Archiver le module',
    question: `Archiver le module ${m.code} — ${m.intitule} ?`,
    suites: [
      'Personne ne peut plus y être inscrit.',
      ouvertes ? `${plural(ouvertes, 'inscription ouverte continue', 'inscriptions ouvertes continuent')} jusqu’à sa fin ou son abandon.` : 'Aucune inscription ouverte.',
    ],
    bouton: 'Archiver',
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
