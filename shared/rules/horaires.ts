// Horaires de poste (t048, étape 1) : référentiel « Horaires » tenu par le service RH (écran Référentiels → Horaires,
// server/src/actions/horaires.ts), distinct des postes et de leurs exigences ; horaire par défaut de chaque équipe ;
// horaire du jour sur la feuille de temps, au niveau de la feuille et non de la ligne (les heures restent saisies par
// projet), sur ordinateur comme sur téléphone. Keystone ne transmet que des heures par jour : l'horaire vient de Cursus.
// - Facultatif : sans horaire, la feuille se tient comme avant. Un jour non choisi qui porte des heures reçoit l'horaire par
//   défaut de l'équipe (proposé, modifiable par le salarié, son manager ou le service RH) ; « Aucun » se choisit aussi.
// - Choix et horaires figés sont séparés : `FeuilleTemps.horaires` ne porte que les choix explicites, `horairesFiges` ce
//   qui est retenu à la soumission puis à la validation (`horairesAFiger`) : code, début, fin et pause de chaque jour.
//   Changer ensuite l'horaire de l'équipe, ou les heures d'un horaire au référentiel, ne touche aucune feuille soumise ;
//   une feuille renvoyée repart des choix et de l'équipe ; une feuille d'avant les horaires n'en reçoit jamais (aucun
//   contrôle rétroactif). Les contrôles du repos de 11 h, de la pause et des heures de nuit s'appuieront sur eux (étape 2).
// - Exemples amorcés à l'installation, modifiables et archivables (migration `lot6-horaires-exemples`) : J, M, AM, N.
// Contrôles partagés par le dialogue (client/src/dialogs/RefHoraireDialog.tsx) et l'action.
import type { Equipe, FeuilleTemps, Horaire, HoraireFige, Referentiels } from '../types.ts';
import { JOURS_FEUILLE } from './semaine.ts';

/** Horaires d'exemple (journée, matin, après-midi, nuit), à adapter à l'organisation du site. */
export const HORAIRES_EXEMPLES: readonly Omit<Horaire, 'archive'>[] = [
  { code: 'J', nom: 'Journée', debut: '08:00', fin: '16:00', pause: 60 },
  { code: 'M', nom: 'Équipe du matin', debut: '05:00', fin: '13:00', pause: 30 },
  { code: 'AM', nom: 'Équipe d’après-midi', debut: '13:00', fin: '21:00', pause: 30 },
  { code: 'N', nom: 'Équipe de nuit', debut: '21:00', fin: '05:00', pause: 30 },
];

/** Code d'un horaire : 1 à 6 lettres majuscules ou chiffres, commençant par une lettre (J, M, AM, N, 2X8M…). */
export const CODE_HORAIRE = /^[A-Z][A-Z0-9]{0,5}$/;
export const NOM_HORAIRE_MAX = 60;
export const PAUSE_MAX = 240;
export const normaliserCodeHoraire = (v: unknown) => String(v ?? '').trim().toUpperCase();

/** « 8 », « 8h », « 8 h 30 », « 08:30 », « 8.30 » → « 08:30 » ; null si ce n'est pas une heure de la journée. */
export function normaliserHeure(v: unknown): string | null {
  const m = /^(\d{1,2})(?:\s*(?:h|:|\.)\s*(\d{2})?)?$/i.exec(String(v ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]), mn = Number(m[2] ?? 0);
  return h < 24 && mn < 60 ? `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}` : null;
}
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Amplitude d'un horaire en minutes, de son début à sa fin (le lendemain quand la fin précède le début). */
export const amplitude = (h: Pick<Horaire, 'debut' | 'fin'>) => (minutes(h.fin) - minutes(h.debut) + 1440) % 1440;
/** Heures de travail d'un horaire : amplitude moins la pause. */
export const dureeHoraire = (h: Pick<Horaire, 'debut' | 'fin' | 'pause'>) => Math.max(0, amplitude(h) - h.pause) / 60;
/** Horaire qui finit le lendemain (poste de nuit, ou à cheval sur minuit). */
export const finitLeLendemain = (h: Pick<Horaire, 'debut' | 'fin'>) => minutes(h.fin) <= minutes(h.debut);

/** « 8 h – 16 h » ; « 21 h – 5 h (lendemain) ». */
const heureTexte = (hhmm: string) => `${Number(hhmm.slice(0, 2))} h${hhmm.slice(3) === '00' ? '' : ` ${hhmm.slice(3)}`}`;
export const plageTexte = (h: Pick<Horaire, 'debut' | 'fin'>) => `${heureTexte(h.debut)} – ${heureTexte(h.fin)}${finitLeLendemain(h) ? ' (lendemain)' : ''}`;
/** « J · 8 h – 16 h, pause 60 min » */
export const horaireTexte = (h: HoraireFige) => `${h.code} · ${plageTexte(h)}${h.pause ? `, pause ${h.pause} min` : ''}`;

export interface ErreursHoraire { code?: string; nom?: string; debut?: string; fin?: string; pause?: string }

/**
 * Création (`existant` null : code choisi, jamais modifié ensuite, unique parmi les horaires archivés compris) ou
 * modification d'un horaire. Début et fin différents ; pause de 0 à 240 minutes, plus courte que l'amplitude.
 */
export function controlerHoraire(p: { code?: unknown; nom?: unknown; debut?: unknown; fin?: unknown; pause?: unknown }, horaires: readonly Horaire[], existant: Horaire | null):
  { erreurs: ErreursHoraire; horaire: Horaire | null } {
  const erreurs: ErreursHoraire = {};
  const code = existant ? existant.code : normaliserCodeHoraire(p.code);
  const nom = String(p.nom ?? '').replace(/\s+/g, ' ').trim();
  const debut = normaliserHeure(p.debut), fin = normaliserHeure(p.fin);
  const pauseTexte = String(p.pause ?? '').trim(), pause = pauseTexte === '' ? 0 : Number(pauseTexte);
  if (!existant) {
    if (!code) erreurs.code = 'Indiquez le code de l’horaire (J, M, AM, N…).';
    else if (!CODE_HORAIRE.test(code)) erreurs.code = 'Code : 1 à 6 lettres ou chiffres, en commençant par une lettre.';
    else if (horaires.some(x => x.code === code)) erreurs.code = `Le code ${code} existe déjà (archivés compris).`;
  }
  if (!nom) erreurs.nom = 'Indiquez le libellé de l’horaire.';
  else if (nom.length > NOM_HORAIRE_MAX) erreurs.nom = `Libellé : ${NOM_HORAIRE_MAX} caractères au plus.`;
  if (!debut) erreurs.debut = 'Indiquez l’heure de début (8:00, 21 h…).';
  if (!fin) erreurs.fin = 'Indiquez l’heure de fin (16:00, 5 h…).';
  else if (debut && debut === fin) erreurs.fin = 'La fin doit différer du début.';
  if (!Number.isInteger(pause) || pause < 0 || pause > PAUSE_MAX) erreurs.pause = `Pause : un nombre entier de minutes, de 0 à ${PAUSE_MAX}.`;
  else if (debut && fin && debut !== fin && pause >= amplitude({ debut, fin })) erreurs.pause = 'La pause doit être plus courte que l’horaire.';
  return Object.keys(erreurs).length
    ? { erreurs, horaire: null }
    : { erreurs, horaire: { code, nom, debut: debut!, fin: fin!, pause, archive: existant?.archive ?? null } };
}

/** Horaires du référentiel, archivés compris, dans l'ordre de création. */
export const horairesDe = (r: Pick<Referentiels, 'horaires'>): Horaire[] => r.horaires ?? [];
export const horairesEnVigueur = (r: Pick<Referentiels, 'horaires'>) => horairesDe(r).filter(h => !h.archive);
export const horaireDe = (r: Pick<Referentiels, 'horaires'>, code: string | null | undefined) => (code ? horairesDe(r).find(h => h.code === code) ?? null : null);

/** Horaire par défaut de l'équipe, s'il existe et est en vigueur. */
export function horaireEquipe(r: Pick<Referentiels, 'horaires' | 'equipes'>, equipe: string | null | undefined): Horaire | null {
  const h = horaireDe(r, r.equipes.find(q => q.nom === equipe)?.horaire);
  return h && !h.archive ? h : null;
}
/** Équipes dont l'horaire par défaut est `code` (archivage refusé tant qu'il y en a). */
export const equipesDeLHoraire = (equipes: readonly Equipe[], code: string) => equipes.filter(q => q.horaire === code).map(q => q.nom);

/** Feuille encore en saisie (pas soumise) : l'horaire de l'équipe est proposé à la place d'un jour non choisi. */
const enSaisie = (sh: Pick<FeuilleTemps, 'statut'> | null) => !sh || sh.statut === 'brouillon' || sh.statut === 'rejetee';

export interface HoraireDuJour {
  /** Code retenu ce jour-là ; null : aucun horaire. */
  code: string | null;
  /** Proposé par l'équipe (jour non choisi qui porte des heures), et non choisi sur la feuille. */
  propose: boolean;
  /**
   * Heures retenues : celles figées sur la feuille quand le code y est figé, sinon celles du référentiel ; null : aucun
   * horaire. Les contrôles du repos, de la pause et de la nuit (étape 2) les liront.
   */
  horaire: HoraireFige | null;
}
const figer = (h: HoraireFige): HoraireFige => ({ code: h.code, debut: h.debut, fin: h.fin, pause: h.pause });

/**
 * Horaire de chaque jour de la feuille (0 = lundi … 6 = dimanche) :
 * - feuille validée et figée : les horaires figés, tels quels ;
 * - sinon le choix explicite du jour (« » : aucun) ; à défaut, un jour qui porte des heures (`perDay`) garde l'horaire
 *   figé à la soumission tant que la feuille est soumise, et reçoit sinon l'horaire par défaut de l'équipe, proposé (en
 *   saisie, ou jour complété par le valideur après une soumission avec les horaires) ; un jour sans heure n'en a aucun.
 * Une feuille renvoyée repart ainsi des choix et de l'équipe : un jour qui a perdu ses heures perd l'horaire proposé, un
 * jour qui en a reçu se le voit proposer. Une feuille soumise ou validée d'avant les horaires (`horairesFiges` absent)
 * ne reçoit aucune proposition (aucun contrôle rétroactif).
 */
export function horairesDeLaFeuille(r: Pick<Referentiels, 'horaires' | 'equipes'>, equipe: string | null | undefined,
  sh: Pick<FeuilleTemps, 'statut' | 'horaires' | 'horairesFiges'> | null, perDay: readonly number[]): HoraireDuJour[] {
  const figes = sh?.horairesFiges ?? null, saisie = enSaisie(sh);
  if (sh?.statut === 'validee' && figes) {
    return Array.from({ length: JOURS_FEUILLE }, (_, i) => ({ code: figes[i]?.code ?? null, propose: false, horaire: figes[i] ?? null }));
  }
  const defaut = saisie || (sh?.statut === 'soumise' && figes) ? horaireEquipe(r, equipe)?.code ?? null : null;
  return Array.from({ length: JOURS_FEUILLE }, (_, i) => {
    const f = figes?.[i] ?? null;
    // Heures d'un code déjà figé ce jour-là : celles d'alors ; sinon celles du référentiel.
    const jour = (code: string | null, propose: boolean): HoraireDuJour => {
      const h = code ? (f?.code === code ? f : horaireDe(r, code)) : null;
      return { code, propose, horaire: h ? figer(h) : null };
    };
    const choisi = sh?.horaires?.[i];
    if (choisi != null) return jour(choisi || null, false);
    if (!(perDay[i] > 0)) return jour(null, false);
    if (!saisie && f) return jour(f.code, false);
    return defaut ? jour(defaut, true) : jour(null, false);
  });
}

/**
 * Horaires à figer sur la feuille (`horairesFiges`) à sa soumission (`temps.submit`) et à sa validation (`temps.validate`,
 * après une éventuelle correction du valideur) : ceux affichés, l'horaire de l'équipe compris pour les jours non choisis
 * qui portent des heures, avec leurs heures du moment (celles déjà figées pour un code inchangé). Les choix (`horaires`)
 * ne sont pas touchés. Rien quand la feuille n'a ni n'avait aucun horaire et que le référentiel n'en propose aucun, ou
 * pour une feuille soumise d'avant les horaires sans choix.
 */
export function horairesAFiger(r: Pick<Referentiels, 'horaires' | 'equipes'>, equipe: string | null | undefined,
  sh: Pick<FeuilleTemps, 'statut' | 'horaires' | 'horairesFiges'>, perDay: readonly number[]): { horairesFiges?: (HoraireFige | null)[] } {
  const jours = horairesDeLaFeuille(r, equipe, sh, perDay);
  const utile = jours.some(j => j.code) || !!sh.horairesFiges || (enSaisie(sh) && horairesEnVigueur(r).length > 0);
  return utile ? { horairesFiges: jours.map(j => j.horaire) } : {};
}
