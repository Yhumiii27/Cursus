// lot 12 — C3 (entretiens suivis) : badge d'origine d'une demande de formation versée depuis un souhait exprimé en
// entretien (`demandesCollab.entretienId`), dans les demandes du tableau de bord (Formations → Demandes), de la fiche et
// de l'accueil du collaborateur. Date de l'entretien quand il est dans l'instantané reçu (le référent HSE ne reçoit pas
// les entretiens : badge sans date, le motif de la demande la portant déjà).
import type { Domain } from '../../../shared/domain.ts';
import { fmtShort } from '../../../shared/format.ts';
import { parse } from '../../../shared/dates.ts';
import type { DemandeCollab } from '../../../shared/types.ts';
import { Tag } from './ui.tsx';

/** Libellé de l'origine : « Entretien du 12 oct. », ou « Entretien » ; null hors d'un versement. */
export function origineEntretien(d: Domain, r: Pick<DemandeCollab, 'entretienId'>): string | null {
  if (!r.entretienId) return null;
  const x = d.ds.entretiens.find(y => y.id === r.entretienId);
  return x ? `Entretien du ${fmtShort(parse(x.date))}` : 'Entretien';
}

export function BadgeEntretien({ d, r }: { d: Domain; r: Pick<DemandeCollab, 'entretienId'> }) {
  const texte = origineEntretien(d, r);
  return texte ? <Tag cls="tag-outline" style={{ marginLeft: 'var(--space-2)', verticalAlign: 'middle' }}>{texte}</Tag> : null;
}
