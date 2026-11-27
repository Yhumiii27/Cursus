// Confirmations des corrections d'une saisie erronée (t119, shared/rules/corrections.ts), affichées par
// dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts) : suppression d'une certification ou d'une ligne du plan
// (administrateur RH), retrait d'une demande par son auteur, réouverture d'une demande par le service RH.
import { fmtEur, fmtIso } from '../../../shared/format.ts';
import type { PlanAction } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';
import { t } from '../i18n/langue.ts';
import { enFrancais } from '../i18n/traduire.ts';

/** Où va le motif d'une correction (aussi dans dialogs/CertDialog.tsx) : le salarié le retrouve dans la copie de ses données. */
const AIDE_MOTIF_SOURCE = 'The reason stays in Cursus, with HR: never shown to the manager or to the employee in Cursus, never copied into the log; the employee finds it in the copy of their data. Do not put any medical information in it.';
/** Aide traduite dans la langue affichée (dialogues, confirmations). */
export const aideMotifCorrection = () => t(AIDE_MOTIF_SOURCE);
/** Texte français de l'aide (tests) : celui qu'affiche `aideMotifCorrection` en français. */
export const AIDE_MOTIF_CORRECTION = enFrancais(AIDE_MOTIF_SOURCE);

/** Motif obligatoire d'une correction du service RH : gardé dans Cursus, jamais montré hors du service RH. */
const motifCorrection = (label: string, placeholder: string) => ({ label, requis: true, placeholder, aide: aideMotifCorrection() });

/**
 * Suppression d'une certification saisie par erreur. `quoi` : « SST du 3 mai 2025 » ; `precedente` : date de la
 * certification de la même formation qui redevient en vigueur ; `session` : session où elle est inscrite ; `rendues` :
 * inscriptions en formation initiale qu'elle avait closes (shared/rules/corrections.ts, inscriptionsARendre), session et
 * raison pour laquelle elle ne l'accueille plus.
 */
export function suppressionCertification(
  c: { id: number }, nom: string, quoi: string,
  o: { precedente?: string | null; session?: string | null; rendues?: { session: string; refus: string | null; ouverte: boolean }[] } = {},
): Confirmation {
  return {
    titre: t('Delete the certification'),
    question: `${t('Delete the certification ')}${quoi}${t(' from the file of ')}${nom}${t('?#question')}`,
    suites: [
      t('It stays in the database, dated and signed, but no longer counts: status, due dates, authorisation prerequisites, Go / No Go.'),
      o.precedente ? `${t('The certification of ')}${fmtIso(o.precedente)}${t(' is back in force.')}` : '',
      o.session ? `${t('Its place at the session ')}${o.session}${t(' is freed; a notice received is cancelled by e-mail.')}` : '',
      ...(o.rendues ?? []).map(r => (r.refus
        ? `${t('It had closed their enrolment in the session ')}${r.session}${t(', which can no longer take them (')}${r.refus}${t('): re-enrol them.')}`
        : r.ouverte ? `${t('It had closed their enrolment in the session ')}${r.session}${t(': the enrolment is restored.')}`
        : `${t('It had closed their enrolment in the session ')}${r.session}${t(': their initial training is to replan again.')}`)),
      t('An issued authorisation that relies on it without another valid certification is to be suspended first.'),
    ].filter(Boolean),
    bouton: t('Delete the certification'),
    action: 'cert.annuler',
    payload: { id: c.id },
    motif: motifCorrection(t('Reason for the deletion'), t('Entered on the wrong sheet, certificate non-existent…')),
  };
}

/** Suppression d'une ligne du plan de formation saisie par erreur. `nom` : formation ou intitulé. */
export function suppressionLignePlan(l: Pick<PlanAction, 'id' | 'equipe' | 'periode' | 'exercice' | 'cout'>, nom: string): Confirmation {
  return {
    titre: t('Delete the plan action'),
    question: `${t('Delete #verb')}${nom} — ${l.equipe}, ${l.periode} ${l.exercice} (${fmtEur(l.cout)}${t(' planned#amount')})${t('?#question')}`,
    suites: [t('The line stays in the database, dated and signed, but leaves the plan and the envelope totals.')],
    bouton: t('Delete the action'),
    action: 'plan.supprimer',
    payload: { id: l.id },
    motif: motifCorrection(t('Reason for the deletion'), t('Duplicate of the import, action abandoned…')),
  };
}

/** Retrait d'une demande encore en attente par son auteur. `pour` : nom du salarié quand un manager l'a faite pour lui. */
export function retraitDemande(r: { id: number }, objet: string, pour?: string | null): Confirmation {
  return {
    titre: t('Withdraw the request'),
    question: `${t('Withdraw #verb')}${pour ? `${t('the request made for ')}${pour}` : t('your request')}${t(': ')}${objet}${t('?#question')}`,
    suites: [t('HR will not process it; it stays listed, “Withdrawn”. A new request remains possible.')],
    bouton: t('Withdraw the request'),
    action: 'demande.annuler',
    payload: { id: r.id },
  };
}

/** Réouverture d'une demande acceptée ou refusée par erreur. `effets` : ce que l'acceptation avait créé et qui est défait. */
export function reouvertureDemande(r: { id: number; statut: string }, nom: string, objet: string, effets: string[]): Confirmation {
  return {
    titre: t('Reopen the request'),
    question: `${t('Reopen the request of ')}${nom}${t(': ')}${objet} (${t(r.statut === 'acceptee' ? 'accepted#fem' : 'refused#fem')})${t('?#question')}`,
    suites: [...effets, t('The request goes back to “Pending”, to accept or refuse again; the previous answer is erased.')],
    bouton: t('Reopen the request'),
    action: 'demande.reouvrir',
    payload: { id: r.id },
    motif: motifCorrection(t('Reason for the reopening'), t('Accepted by mistake, unsuitable session chosen…')),
  };
}
