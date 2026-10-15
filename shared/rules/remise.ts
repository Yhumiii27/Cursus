// Remise du compte rendu d'entretien au salarié (art. L6315-1 : une copie lui est remise), sans dépendre de sa signature
// dans Cursus : un salarié sans compte, ou qui refuse de signer, ne bloque plus la remise. Le compte rendu s'imprime dès
// la clôture par l'évaluateur (mention « non signé par le salarié ») ; l'évaluateur ou le service RH enregistre la remise
// (`entretien.remettre`) : en main propre, après un refus de signer, ou par mise à disposition dans le portail — l'e-mail
// ne porte alors qu'un lien vers Cursus, jamais le texte du compte rendu (docs/EMAILS.md). Le premier téléchargement par
// le salarié, depuis son espace, est daté (`entretien.telecharger`). Partagé par l'écran et le serveur.
import { isValidDate } from '../dates.ts';
import { fmtIso } from '../format.ts';
import type { Entretien, ISODate, ModeRemise } from '../types.ts';

export const MODES_REMISE: Record<ModeRemise, { label: string; court: string; aide: string }> = {
  main_propre: {
    label: 'Remis en main propre', court: 'Remis',
    aide: 'Copie imprimée remise au salarié, signée ou non. Elle fait foi : ses sections ne se modifient plus dans Cursus.',
  },
  refus: {
    label: 'Remis après un refus de signer', court: 'Refus de signer',
    aide: 'Le salarié refuse de signer : le refus est daté et la copie imprimée lui est remise. Elle fait foi : ses sections ne se modifient plus.',
  },
  portail: {
    label: 'Mis à disposition dans le portail', court: 'Mis à disposition',
    aide: 'Le salarié consulte et télécharge le compte rendu dans son espace ; il reçoit un e-mail avec le seul lien vers Cursus. La date de son premier téléchargement est enregistrée.',
  },
};

/** Remise sur papier (main propre, refus de signer) : la copie remise fait foi, les sections du salarié ne se modifient plus. */
export const remisePhysique = (x: Pick<Entretien, 'remiseMode'>) => x.remiseMode === 'main_propre' || x.remiseMode === 'refus';

/** Premier jour possible de la remise : la clôture par l'évaluateur (sa signature), à défaut la date de l'entretien. */
export const debutRemise = (x: Pick<Entretien, 'signMgr' | 'date'>): ISODate => x.signMgr ?? x.date;

/**
 * Contrôle d'une remise, partagé par le dialogue et `entretien.remettre` : message du refus, ou null. Une remise sur papier
 * est définitive ; une mise à disposition dans le portail peut être complétée par une remise sur papier. La date (main
 * propre, refus) va de la clôture à aujourd'hui ; la mise à disposition est datée du jour.
 */
export function controleRemise(x: Entretien, mode: unknown, date: unknown, today: ISODate): string | null {
  if (x.statut !== 'realise') return 'Compte rendu à clore d’abord : la remise suit la clôture par l’évaluateur';
  if (typeof mode !== 'string' || !Object.hasOwn(MODES_REMISE, mode)) return 'Mode de remise inconnu';
  if (mode === 'refus' && x.signSal) return `Compte rendu signé par le salarié le ${fmtIso(x.signSal)} : aucun refus à enregistrer`;
  if (x.remiseMode && x.remiseLe && (remisePhysique(x) || mode === 'portail')) {
    return `Compte rendu déjà ${MODES_REMISE[x.remiseMode].label.toLowerCase()} le ${fmtIso(x.remiseLe)}`;
  }
  if (mode === 'portail') return null;
  if (typeof date !== 'string' || !isValidDate(date)) return 'Date de la remise invalide';
  if (date > today) return 'Date de la remise : aujourd’hui au plus tard';
  if (date < debutRemise(x)) return `Date de la remise : le ${fmtIso(debutRemise(x))} au plus tôt (clôture du compte rendu)`;
  return null;
}

/** État de la remise en une phrase : « Remis en main propre le 12 oct. 2026 par Karim Haddad », ou null. */
export function texteRemise(x: Entretien): string | null {
  if (!x.remiseMode || !x.remiseLe) return null;
  const base = `${MODES_REMISE[x.remiseMode].label} le ${fmtIso(x.remiseLe)}${x.remisePar ? ` par ${x.remisePar}` : ''}`;
  if (x.remiseMode !== 'portail') return base;
  return `${base} — ${x.telechargeLe ? `téléchargé par le salarié le ${fmtIso(x.telechargeLe)}` : 'pas encore téléchargé par le salarié'}`;
}

/** Statut d'un entretien dans la liste de l'écran Entretiens : libellé et classe du badge. */
export function statutEntretien(x: Entretien): [string, string] {
  if (x.statut === 'planifie') return ['Planifié', 'tag-outline'];
  if (x.signSal) return ['Signé', 'tag-neutral'];
  if (x.remiseMode === 'portail') return x.telechargeLe ? ['Téléchargé', 'tag-neutral'] : ['Mis à disposition', 'tag-outline'];
  if (x.remiseMode) return [MODES_REMISE[x.remiseMode].court, 'tag-neutral'];
  return ['À signer', 'tag-outline'];
}
