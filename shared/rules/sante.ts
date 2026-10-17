// Santé au travail : avis du médecin du travail (apte, apte avec restrictions, inapte), restrictions de poste
// datées et demandes de visite. Données de santé réservées au service RH et à l'intéressé : le manager ne reçoit
// que le verdict et les restrictions en vigueur (`aptitudeVueManager`), Keystone que le code de motif APTITUDE.
import { AVIS_MEDICAL, MOTIF_RESTRICTION, MOTIFS_VISITE } from '../constants.ts';
import { isValidDate, parse } from '../dates.ts';
import { fmt } from '../format.ts';
import type { AvisMedical, Employe, HabTitre, ISODate, MotifVisite, Restriction } from '../types.ts';
import { erreurProchaineVisite } from './suivi-medical.ts';

/** Longueur maximale d'une restriction recopiée, nombre maximal de restrictions par avis. */
export const RESTRICTION_MAX = 300;
export const RESTRICTIONS_MAX = 10;

/** Restriction encore en vigueur au jour `du` (ou au premier jour d'une période) : sans terme, ou terme pas encore passé. */
export const restrictionEnVigueur = (r: Restriction, du: ISODate) => !r.jusquau || r.jusquau >= du;

/** Restrictions de l'avis en cours encore en vigueur au jour `du` (aucune pour un avis apte ou d'inaptitude). */
export function restrictionsEnVigueur(e: Pick<Employe, 'avis' | 'restrictions'>, du: ISODate): Restriction[] {
  return e.avis === 'restrictions' ? (e.restrictions ?? []).filter(r => restrictionEnVigueur(r, du)) : [];
}

/** « Pas de port de charges de plus de 15 kg — jusqu’au 31 déc. 2026 ». */
export const restrictionTexte = (r: Restriction) => `${r.texte} — ${r.jusquau ? `jusqu’au ${fmt(parse(r.jusquau))}` : 'sans terme'}`;

/** Habilitation suspendue à la suite d'un avis (motif `MOTIF_RESTRICTION`) : l'avis suivant peut lever la suspension. */
export const suspendueParAvis = (h: Pick<HabTitre, 'mesure' | 'mesureMotif'>) => h.mesure === 'suspension' && h.mesureMotif === MOTIF_RESTRICTION;

/**
 * Aptitude transmise au manager pour un membre de son équipe : verdict (aptitude valide ou non, avis) et
 * restrictions en vigueur recopiées telles qu'écrites, sans date de visite ni demande de visite.
 */
export function aptitudeVueManager(e: Employe, ok: boolean, today: ISODate): NonNullable<Employe['aptitude']> {
  return { ok, avis: e.visite ? e.avis ?? 'apte' : null, restrictions: restrictionsEnVigueur(e, today).map(r => ({ texte: r.texte, jusquau: r.jusquau })) };
}

/** Motif proposé pour une demande de visite : visite d'embauche si aucune visite n'est enregistrée, sinon renouvellement. */
export const motifParDefaut = (e: Pick<Employe, 'visite'>): MotifVisite => e.visite ? 'periodique' : 'embauche';
export const estMotifVisite = (m: unknown): m is MotifVisite => typeof m === 'string' && Object.hasOwn(MOTIFS_VISITE, m);

/**
 * `prochaineVisite` : date de la prochaine visite fixée par le médecin du travail (null : la périodicité du type de suivi) ;
 * `examen` : la visite est un examen médical d'aptitude du suivi renforcé (shared/rules/suivi-medical.ts).
 */
export interface AvisSaisi { date: ISODate; avis: AvisMedical; restrictions: Restriction[]; prochaineVisite: ISODate | null; examen: boolean }

/**
 * Contrôle d'un avis saisi, partagé par le dialogue et le serveur : date de visite passée, avis connu, restrictions
 * recopiées (une au moins pour un avis avec restrictions, lignes vides ignorées), terme éventuel postérieur à la visite.
 * Hors avis avec restrictions, les restrictions sont vidées.
 */
export function controlerAvis(
  p: { date?: unknown; avis?: unknown; restrictions?: unknown; prochaineVisite?: unknown; examen?: unknown }, today: ISODate,
): { avis: AvisSaisi; errors: string[] } {
  const errors: string[] = [];
  const date = typeof p.date === 'string' ? p.date : '';
  if (!isValidDate(date)) errors.push('Date de la visite invalide.');
  else if (date > today) errors.push('La date de la visite ne peut pas être postérieure à aujourd’hui.');
  const avis = typeof p.avis === 'string' && Object.hasOwn(AVIS_MEDICAL, p.avis) ? p.avis as AvisMedical : null;
  if (!avis) errors.push('Avis du médecin du travail requis : apte, apte avec restrictions ou inapte.');
  const lignes = Array.isArray(p.restrictions) ? p.restrictions as { texte?: unknown; jusquau?: unknown }[] : [];
  const restrictions: Restriction[] = [];
  if (avis === 'restrictions') {
    lignes.forEach((l, i) => {
      const texte = typeof l?.texte === 'string' ? l.texte.trim().replace(/\s+/g, ' ') : '';
      const jusquau = typeof l?.jusquau === 'string' && l.jusquau ? l.jusquau : null;
      if (!texte && !jusquau) return;
      const n = `Restriction ${i + 1}`;
      if (!texte) errors.push(`${n} : recopiez le texte de l’avis.`);
      else if (texte.length > RESTRICTION_MAX) errors.push(`${n} : ${RESTRICTION_MAX} caractères au plus.`);
      if (jusquau && !isValidDate(jusquau)) errors.push(`${n} : date de fin invalide.`);
      else if (jusquau && isValidDate(date) && jusquau < date) errors.push(`${n} : la date de fin précède la visite.`);
      restrictions.push({ texte, jusquau });
    });
    if (!restrictions.length) errors.push('Recopiez au moins une restriction ou un aménagement de poste, tel qu’écrit sur l’avis.');
    if (restrictions.length > RESTRICTIONS_MAX) errors.push(`${RESTRICTIONS_MAX} restrictions au plus.`);
  }
  // Prochaine visite fixée par le médecin (facultative) : sans objet pour un avis d'inaptitude.
  const prochaineVisite = avis !== 'inapte' && typeof p.prochaineVisite === 'string' && p.prochaineVisite ? p.prochaineVisite : null;
  const erreurProchaine = erreurProchaineVisite(prochaineVisite, date);
  if (erreurProchaine) errors.push(erreurProchaine);
  return { avis: { date, avis: avis ?? 'apte', restrictions, prochaineVisite, examen: p.examen === true }, errors };
}
