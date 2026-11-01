// Planning d'équipe (lot 12, chantier C5) : information des salariés. À la publication, à la modification ou à l'annulation
// d'un créneau publié, le salarié reçoit aussitôt un e-mail (toujours immédiat, comme une astreinte : la date de cet envoi
// est `communiqueLe`, point de départ du délai de prévenance) et, s'il l'a choisie, une notification sur son téléphone
// (texte fixe, sans nom ni date, retardée par la plage de silence : jamais le point de départ du délai). Les étapes d'un
// échange de poste passent par les notifications ordinaires (réglage de chacun). Rien n'est envoyé à la personne qui agit,
// ni à un salarié sans adresse (à prévenir de vive voix : le message de l'action le dit). Le flux d'agenda (.ics) des
// créneaux publiés vient avec les écrans (étape 2).
import { fmtIso, plural } from '../../shared/format.ts';
import { plageTexte } from '../../shared/rules/horaires.ts';
import type { CurrentUser, Dataset, Employe } from '../../shared/types.ts';
import type { Creneau } from '../../shared/types-planning.ts';
import type { Db } from './db.ts';
import { envoyerEmail } from './integrations/email.ts';
import { adresseSalarie, courriel, lireMessagerie } from './messagerie.ts';
import { notifier } from './notifications.ts';
import { mettreEnFilePush } from './push.ts';

type Contexte = { db: Db; ds: Dataset; user: CurrentUser; parDelegation?: Set<number> };
export type ChangementPlanning = 'publie' | 'modifie' | 'annule';

/** « lun. 12 oct. : M (5 h – 13 h) », « mar. 13 oct. : repos ». */
export function ligneCreneau(c: Pick<Creneau, 'jour' | 'horaire' | 'debut' | 'fin'>): string {
  const jour = new Date(`${c.jour}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${jour} : ${c.horaire && c.debut && c.fin ? `${c.horaire} (${plageTexte({ debut: c.debut, fin: c.fin })})` : 'repos'}`;
}

const auteur = (user: CurrentUser) => (user.role === 'rh' ? 'Le service RH' : user.nom);

/**
 * Prévient le salarié de ses créneaux publiés, modifiés ou annulés (e-mail aussitôt, notification push s'il l'a choisie).
 * `motif` : circonstances exceptionnelles (délai de prévenance non tenu) ou motif d'annulation, communiqué au salarié.
 * Renvoie vrai si l'e-mail part.
 */
export async function prevenirPlanning(cx: Contexte, emp: Pick<Employe, 'id' | 'nom'>, creneaux: readonly Creneau[], quoi: ChangementPlanning, motif: string | null): Promise<boolean> {
  if (!creneaux.length) return false;
  const tries = [...creneaux].sort((a, b) => a.jour.localeCompare(b.jour));
  const periode = tries[0].jour === tries.at(-1)!.jour ? `du ${fmtIso(tries[0].jour)}` : `du ${fmtIso(tries[0].jour)} au ${fmtIso(tries.at(-1)!.jour)}`;
  const objet = quoi === 'publie' ? `Votre planning ${periode}` : quoi === 'modifie' ? `Planning modifié ${periode}` : `Poste annulé ${periode}`;
  const corps = [
    quoi === 'annule' ? `${auteur(cx.user)} annule ${plural(tries.length, 'votre poste', 'vos postes')} :` : `${auteur(cx.user)} vous communique ${quoi === 'publie' ? 'votre planning' : 'la modification de votre planning'} :`,
    '', ...tries.map(c => `- ${ligneCreneau(c)}`),
    ...(motif ? ['', `${quoi === 'annule' ? 'Motif' : 'Délai de prévenance plus court que d’habitude, en raison de circonstances exceptionnelles'} : ${motif}`] : []),
    '', 'Votre planning reste une prévision : les heures réellement faites se déclarent sur votre feuille de temps.',
  ];
  const soiMeme = cx.user.role !== 'rh' && cx.user.empId === emp.id;
  if (soiMeme) return false;
  await mettreEnFilePush(cx.db, { empId: emp.id }, quoi === 'publie' ? 'planning.publie' : 'planning.modifie');
  const d = await adresseSalarie(cx.db, emp.id, cx.ds.today);
  if (!d) return false;
  await envoyerEmail(cx.db, `planning.${quoi}`, courriel(cx.ds.messagerie ?? await lireMessagerie(cx.db), d.adresse, objet, corps.join('\n'), { nom: emp.nom }));
  return true;
}

/** Étape d'un échange de poste, au salarié ou au valideur (notification ordinaire, selon son réglage). */
export async function notifierEchange(cx: Contexte, dest: number, demande: boolean, objet: string, texte: string): Promise<void> {
  await notifier(cx, dest, { type: demande ? 'planning.echange.demande' : 'planning.echange.decision', objet, texte });
}
