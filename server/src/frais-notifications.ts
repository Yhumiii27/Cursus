// Notifications des notes de frais (lot 11, chantier C5, étape 2) par la file d'e-mails existante (server/src/notifications.ts,
// `notifier` : aussitôt ou dans le récapitulatif quotidien, doublées sur le téléphone par les notifications génériques de
// shared/notifications-push.ts) :
// - soumission : au valideur (manager direct) et à son suppléant au périmètre « frais » pendant une délégation ;
// - à contrôler : à la boîte du service RH, quand une note attend le contrôle (validée par le manager, ou soumise sans
//   valideur, note médicale comprise : le message est le même, il ne désigne jamais la nature des dépenses) ;
// - renvoi pour correction, contrôle (ou validation quand le circuit n'a pas de contrôle) et remboursement par la paie :
//   au salarié.
// Jamais de montant, de commerçant, d'invité ni de motif dans un message : le motif d'un renvoi se lit dans Cursus.
import { periodeLabel } from '../../shared/rules/paie.ts';
import { valideursDe } from '../../shared/rules/delegations-manager.ts';
import { droitsRh } from '../../shared/constants.ts';
import { fmtIso } from '../../shared/format.ts';
import type { CurrentUser, Dataset, Employe, NoteFrais } from '../../shared/types.ts';
import type { Db } from './db.ts';
import { notifier } from './notifications.ts';

type Contexte = { db: Db; ds: Dataset; user: CurrentUser };
type Note = Pick<NoteFrais, 'id' | 'periode'>;

/** « n° 12 (octobre 2026) ». */
const noteTexte = (n: Note) => `n° ${n.id} (${periodeLabel(n.periode)})`;
/** Auteur d'une décision nommé au salarié : le service RH, la comptabilité, ou le manager par son nom. */
const auteur = (u: CurrentUser) => (u.role !== 'rh' ? u.nom : droitsRh(u).includes('rh') ? 'le service RH' : 'la comptabilité');

/** Note soumise qui attend la validation du manager : au valideur et à son suppléant « frais ». */
export async function notifierNoteSoumise(cx: Contexte, emp: Employe, n: Note) {
  for (const v of valideursDe(cx.ds, emp, cx.ds.today, 'frais')) {
    if (!v.id) continue;
    const pour = v.delegation ? cx.ds.employes.find(e => e.id === v.delegation!.managerId)?.nom ?? 'son manager' : null;
    await notifier(cx, v.id, {
      type: 'frais.soumise', objet: `Note de frais à valider — ${emp.nom}${pour ? ` (en l’absence de ${pour})` : ''}`,
      texte: `${emp.nom} a soumis sa note de frais ${noteTexte(n)}. Elle attend votre validation (Notes de frais).`
        + (v.delegation ? `\nVous en décidez par délégation de ${pour}, jusqu’au ${fmtIso(v.delegation.au)}.` : ''),
    });
  }
}

/** Note qui attend le contrôle : à la boîte du service RH (récapitulatif selon son réglage). */
export async function notifierNoteAControler(cx: Contexte, emp: Employe, n: Note) {
  return await notifier(cx, 0, {
    type: 'frais.acontroler', objet: `Note de frais à contrôler — ${emp.nom}`,
    texte: `La note de frais ${noteTexte(n)} de ${emp.nom} attend le contrôle (Notes de frais).`,
  }, true);
}

/** Note renvoyée pour correction : au salarié. */
export async function notifierNoteRenvoyee(cx: Contexte, emp: Employe, n: Note) {
  return await notifier(cx, emp.id, {
    type: 'frais.renvoyee', objet: `Note de frais ${noteTexte(n)} à corriger`,
    texte: `Votre note de frais ${noteTexte(n)} vous est renvoyée pour correction par ${auteur(cx.user)}. Le motif est à lire dans Cursus (Mes frais) ; corrigez-la, puis soumettez-la de nouveau.`,
  });
}

/** Note contrôlée (ou validée, sans contrôle) : au salarié ; `close` : rien à rembourser. */
export async function notifierNoteValidee(cx: Contexte, emp: Employe, n: Note, close: boolean) {
  return await notifier(cx, emp.id, {
    type: 'frais.validee', objet: `Note de frais ${noteTexte(n)} ${close ? 'close' : 'validée'}`,
    texte: close
      ? `Votre note de frais ${noteTexte(n)} est close par ${auteur(cx.user)} : aucune dépense n’est à rembourser. Le détail est dans Cursus (Mes frais).`
      : `Votre note de frais ${noteTexte(n)} est validée par ${auteur(cx.user)} : elle sera remboursée avec la prochaine paie.`,
  });
}

/** Notes remboursées par un lot de paie confirmé : à chaque salarié, une note à la fois. */
export async function notifierNotesPayees(cx: Contexte, notes: readonly Pick<NoteFrais, 'id' | 'periode' | 'empId'>[], periodeLot: string) {
  for (const n of notes) {
    if (!cx.ds.employes.some(e => e.id === n.empId)) continue;
    await notifier(cx, n.empId, {
      type: 'frais.payee', objet: `Note de frais ${noteTexte(n)} remboursée`,
      texte: `Votre note de frais ${noteTexte(n)} est remboursée avec la paie de ${periodeLabel(periodeLot)} (ligne non soumise à cotisations du bulletin).`,
    });
  }
}
