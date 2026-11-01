// Formations suivies par salarié (t116), du catalogue ou hors catalogue : saisie directe par le service RH ou le référent
// HSE, clôture d'une action du plan réalisée (bénéficiaires choisis parmi l'équipe), demande hors catalogue acceptée une
// fois la formation faite. Une formation hors catalogue est « non obligatoire » par défaut (l'obligation passe par le
// catalogue « Réglementaire »), case modifiable à la saisie. Les formations non obligatoires des 8 dernières années
// comptent pour l'état des lieux du bilan à 8 ans (art. L6315-1, shared/rules/entretiens.ts), avec les certifications
// non réglementaires. Correction et annulation motivées comme les certifications (shared/rules/corrections.ts).
// Contrôles communs au dialogue et au serveur (server/src/actions/formations-suivies.ts).
import { addD, isValidDate } from '../dates.ts';
import type { Domain } from '../domain.ts';
import type { Dataset, DemandeCollab, Employe, Formation, FormationSuivie, ISODate, OrigineFormationSuivie } from '../types.ts';
import { dureeValide } from './heures-formation.ts';

export const ORIGINE_SUIVIE_LABEL: Record<OrigineFormationSuivie, string> = {
  demande: 'Demande hors catalogue', plan: 'Plan de formation', session: 'Session', saisie: 'Saisie du service RH',
  // lot 12 — C4 : fin d'un module d'e-learning validée par le service RH.
  elearning: 'Module d’e-learning',
};

/** Intitulé d'une formation hors catalogue et organisme : longueurs maximales. */
export const LIBELLE_SUIVIE_MAX = 120;
export const ORGANISME_SUIVIE_MAX = 80;

/** Formations suivies en vigueur (non annulées). */
export const suiviesEnVigueur = (ds: Pick<Dataset, 'formationsSuivies'>, empId?: number): FormationSuivie[] =>
  (ds.formationsSuivies ?? []).filter(x => !x.annuleLe && (empId == null || x.empId === empId));

/** Jours après le dernier jour d'une formation suivie pendant lesquels sa certification peut être datée. */
export const DELAI_CERTIFICATION_SUIVIE = 7;

/**
 * Formation suivie du catalogue dont le salarié a la certification (même code, obtenue du premier jour au dernier, plus
 * 7 jours) : action du plan réalisée sans session, puis certification saisie par le service RH. La certification la
 * représente au passeport et dans les indicateurs, pour ne pas compter deux fois la même formation.
 */
export function suivieCertifiee(e: Pick<Employe, 'certs'> | null | undefined, x: Pick<FormationSuivie, 'f' | 'du' | 'au'>): boolean {
  if (!x.f || !e) return false;
  const fin = addD(x.au, DELAI_CERTIFICATION_SUIVIE);
  return e.certs.some(c => c.f === x.f && !c.annuleLe && c.obtenue >= x.du && c.obtenue <= fin);
}

/** Formations suivies comptées à part (passeport, indicateurs) : en vigueur, hors celles que représente une certification. */
export const suiviesHorsCertifications = (d: Domain, empId?: number): FormationSuivie[] =>
  suiviesEnVigueur(d.ds, empId).filter(x => !suivieCertifiee(d.emp(x.empId), x));

/** Intitulé affiché : celui du catalogue, sinon celui saisi. */
export const intituleSuivie = (d: Domain, x: Pick<FormationSuivie, 'f' | 'libelle'>): string => (x.f && d.fm(x.f)?.nom) || x.libelle || x.f || '—';

/** Obligatoire par défaut : formation réglementaire du catalogue ; hors catalogue, non obligatoire. */
export const obligatoireParDefaut = (fm: Pick<Formation, 'type'> | null | undefined): boolean => fm?.type === 'Réglementaire';

/** Heures d'une formation suivie : saisies, sinon celles du catalogue, sinon inconnues (null). */
export function heuresSuivie(d: Domain, x: Pick<FormationSuivie, 'f' | 'duree'>): number | null {
  if (x.duree != null) return x.duree;
  return (x.f && d.fm(x.f)?.dureeHeures) || null;
}

/**
 * Formation non obligatoire suivie depuis `depuis` (état des lieux à 8 ans) : certification d'une formation qui n'est pas
 * « Réglementaire », ou formation suivie non obligatoire terminée depuis cette date.
 */
export function formationNonObligatoireDepuis(d: Domain, e: Pick<Employe, 'id' | 'certs'>, depuis: ISODate): boolean {
  return e.certs.some(c => d.fm(c.f)?.type !== 'Réglementaire' && c.obtenue >= depuis)
    || suiviesEnVigueur(d.ds, e.id).some(x => !x.obligatoire && x.au >= depuis);
}

/**
 * Demandes de formation hors catalogue acceptées dont la formation n'est pas encore enregistrée comme suivie (aucune ligne
 * qui la désigne) : à clore une fois la formation faite (fiche du collaborateur).
 */
export function demandesAClore(ds: Pick<Dataset, 'demandesCollab' | 'formationsSuivies'>, empId: number): DemandeCollab[] {
  const closes = new Set(suiviesEnVigueur(ds, empId).map(x => x.demandeId).filter(Boolean));
  return ds.demandesCollab.filter(r => r.empId === empId && r.type === 'formation' && !r.f && r.statut === 'acceptee' && !closes.has(r.id));
}

export type ChampSuivie = 'f' | 'libelle' | 'du' | 'au' | 'duree' | 'organisme';
export interface SaisieSuivie { f?: unknown; libelle?: unknown; du?: unknown; au?: unknown; duree?: unknown; organisme?: unknown; obligatoire?: unknown }
export type ValeurSuivie = Pick<FormationSuivie, 'f' | 'libelle' | 'du' | 'au' | 'duree' | 'organisme' | 'obligatoire'>;

const texte = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/**
 * Saisie contrôlée : une erreur par champ, ou la valeur à enregistrer. Formation du catalogue (code, en vigueur ou déjà
 * celle de la ligne corrigée), ou intitulé hors catalogue ; du (pas à venir), au (entre du et aujourd'hui, du par défaut) ;
 * durée en heures facultative ; obligatoire : case cochée, sinon la valeur par défaut de la formation.
 */
export function controlerSuivie(d: Domain, s: SaisieSuivie, avant: Pick<FormationSuivie, 'f'> | null = null): { erreurs: Partial<Record<ChampSuivie, string>>; valeur: ValeurSuivie | null } {
  const e: Partial<Record<ChampSuivie, string>> = {};
  const f = texte(s.f);
  const fm = f ? d.fm(f) ?? null : null;
  if (f && !fm) e.f = 'Formation inconnue du catalogue.';
  else if (fm?.archive && f !== avant?.f) e.f = `Formation « ${fm.court} » archivée : choisissez-en une autre, ou saisissez-la hors catalogue.`;
  const libelle = fm ? '' : texte(s.libelle);
  if (!fm && !f && !libelle) e.libelle = 'Indiquez l’intitulé de la formation hors catalogue.';
  else if (libelle.length > LIBELLE_SUIVIE_MAX) e.libelle = `${LIBELLE_SUIVIE_MAX} caractères au plus.`;
  const du = texte(s.du), au = texte(s.au) || du;
  if (!du) e.du = 'Indiquez le premier jour de la formation.';
  else if (!isValidDate(du)) e.du = 'Date invalide.';
  else if (du > d.ti) e.du = 'La formation n’a pas encore eu lieu : enregistrez-la une fois faite.';
  if (!e.du && du) {
    if (!isValidDate(au)) e.au = 'Date invalide.';
    else if (au < du) e.au = 'Le dernier jour précède le premier.';
    else if (au > d.ti) e.au = 'Le dernier jour est à venir : enregistrez la formation une fois faite.';
  }
  const dureeTexte = texte(s.duree);
  const duree = dureeTexte === '' ? null : Number(dureeTexte.replace(',', '.'));
  if (duree !== null && !dureeValide(duree)) e.duree = 'Durée en heures : nombre de 0,25 à 2 000.';
  const organisme = texte(s.organisme);
  if (organisme.length > ORGANISME_SUIVIE_MAX) e.organisme = `${ORGANISME_SUIVIE_MAX} caractères au plus.`;
  if (Object.keys(e).length) return { erreurs: e, valeur: null };
  const obligatoire = typeof s.obligatoire === 'boolean' ? s.obligatoire : s.obligatoire === 'true' ? true : s.obligatoire === 'false' ? false : obligatoireParDefaut(fm);
  return {
    erreurs: e,
    valeur: { f: fm ? fm.id : null, libelle: fm ? null : libelle, du, au, duree: duree === null ? null : Math.round(duree * 100) / 100, organisme: organisme || null, obligatoire },
  };
}
