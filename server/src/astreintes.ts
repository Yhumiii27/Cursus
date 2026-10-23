// Astreintes (t049, lot 7) : information du salarié par e-mail, toujours aussitôt (comme une convocation : la programmation
// individuelle lui est communiquée, art. L3121-12), avec l'événement d'agenda de la période (.ics, UID stable
// `astreinte-<n°>` : une modification met à jour l'événement, une annulation le retire). Son manager est prévenu quand le
// service RH planifie, modifie ou annule (notification ordinaire, selon son réglage). Rien n'est envoyé à la personne qui
// agit, ni à un salarié sans adresse (à prévenir de vive voix : le message de l'action le dit).
import { fH } from '../../shared/format.ts';
import { heuresAstreinte, periodeAstreinteTexte } from '../../shared/rules/astreintes.ts';
import { ACTIVITE_ASTREINTE } from '../../shared/constants.ts';
import type { Astreinte, CurrentUser, Dataset, Employe } from '../../shared/types.ts';
import type { Db } from './db.ts';
import { calendrier, domaineAgenda, envoyerEmail, pieceJointe, type EvenementAgenda } from './integrations/email.ts';
import { adresseSalarie, courriel, lireMessagerie } from './messagerie.ts';
import { notifier, organisateur } from './notifications.ts';

type Contexte = { db: Db; ds: Dataset; user: CurrentUser };
export type ChangementAstreinte = 'planifiee' | 'modifiee' | 'annulee';

/** Événement d'agenda d'une astreinte : plage continue à l'heure de Paris, du premier jour au dernier. */
export function evenementAstreinte(a: Pick<Astreinte, 'id' | 'du' | 'debut' | 'au' | 'fin' | 'equipe'>): EvenementAgenda {
  return {
    uid: `astreinte-${a.id}@${domaineAgenda()}`, date: a.du, plage: { debut: a.debut, finJour: a.au, fin: a.fin }, titre: 'Astreinte',
    description: `${a.equipe ? `Équipe ${a.equipe}. ` : ''}Interventions à déclarer sur la feuille de temps de Cursus (« ${ACTIVITE_ASTREINTE.nom} »), avec leurs heures de début et de fin.`,
  };
}

/** Fichier .ics de l'astreinte, ou de son annulation (même UID). */
export async function icsAstreinte(cx: Contexte, a: Astreinte, annule = false): Promise<string> {
  return calendrier({ ...evenementAstreinte(a), annule, organisateur: await organisateur(cx) });
}

/** Auteur nommé au salarié. */
const auteur = (user: CurrentUser) => (user.role === 'rh' ? 'Le service RH' : user.nom);

/**
 * Prévient le salarié d'une astreinte planifiée, modifiée ou annulée (e-mail aussitôt, .ics joint) et, quand le service RH
 * agit, son manager. `avant` : la période d'avant une modification. Renvoie vrai si l'e-mail au salarié part.
 */
export async function prevenirAstreinte(cx: Contexte, emp: Pick<Employe, 'id' | 'nom'>, a: Astreinte, quoi: ChangementAstreinte, o: { avant?: Astreinte; managerId?: number | null } = {}): Promise<boolean> {
  const periode = periodeAstreinteTexte(a), heures = fH(heuresAstreinte(a));
  const objet = quoi === 'planifiee' ? `Astreinte ${periode}` : quoi === 'modifiee' ? `Astreinte modifiée : ${periode}` : `Astreinte annulée : ${periode}`;
  const corps = quoi === 'annulee'
    ? [`${auteur(cx.user)} annule votre astreinte ${periode}.`, '', 'Ouvrez le fichier joint pour retirer l’événement de votre agenda, ou supprimez-le vous-même.']
    : [
      quoi === 'planifiee'
        ? `${auteur(cx.user)} vous informe de votre astreinte ${periode} (${heures}).`
        : `${auteur(cx.user)} modifie votre astreinte${o.avant ? ` (prévue ${periodeAstreinteTexte(o.avant)})` : ''} : elle a lieu ${periode} (${heures}).`,
      ...(a.motif ? ['', `Délai de prévenance plus court que d’habitude, en raison de circonstances exceptionnelles : ${a.motif}`] : []),
      '',
      `Pendant l’astreinte, chaque intervention est du temps de travail : déclarez-la sur votre feuille de temps (« ${ACTIVITE_ASTREINTE.nom} »), avec ses heures de début et de fin. Après une intervention, vous avez droit à 11 heures de repos consécutives avant de reprendre le travail.`,
      'Ouvrez le fichier joint pour ajouter l’astreinte à votre agenda.',
    ];
  const type = `astreinte.${quoi}`;
  const d = await adresseSalarie(cx.db, emp.id, cx.ds.today);
  const soiMeme = cx.user.role !== 'rh' && cx.user.empId === emp.id;
  let envoye = false;
  if (d && !soiMeme) {
    const ics = await icsAstreinte(cx, a, quoi === 'annulee');
    const methode = quoi === 'annulee' ? 'CANCEL' : 'PUBLISH';
    await envoyerEmail(cx.db, type, courriel(cx.ds.messagerie ?? await lireMessagerie(cx.db), d.adresse, objet, corps.join('\n'),
      { nom: emp.nom, pj: [pieceJointe(`${quoi === 'annulee' ? 'annulation-' : ''}astreinte-${a.du}.ics`, `text/calendar; charset=utf-8; method=${methode}`, ics)] }));
    envoye = true;
  }
  // Le service RH agit : le manager du salarié en est informé (il organise l'équipe).
  if (cx.user.role === 'rh' && o.managerId) {
    const verbe = quoi === 'planifiee' ? 'planifie' : quoi === 'modifiee' ? 'modifie' : 'annule';
    await notifier(cx, o.managerId, { type, objet: `${objet} — ${emp.nom}`, texte: `Le service RH ${verbe} l’astreinte de ${emp.nom} ${periode}.` });
  }
  return envoye;
}
