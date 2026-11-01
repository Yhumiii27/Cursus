// Modules d'e-learning et suivi des inscriptions (lot 12, chantier C4, t190), sans plateforme embarquée : règles pures,
// communes au serveur (server/src/actions/elearning.ts) et aux écrans.
// - Module : lien d'accès en https seulement, ouvert hors de Cursus (nouvel onglet, rel=noopener ; jamais dans un cadre :
//   la CSP n'ouvre aucun frame-src) ; formation du catalogue facultative, dont l'achèvement produit la certification.
// - Inscription : une seule ouverte (inscrit, en cours) par salarié et module ; « expiré » calculé (accès échu sans fin),
//   jamais stocké ; fin déclarée par le salarié (« J'ai terminé », en ligne) ou signalée par l'import, validée par le
//   service RH, qui produit la formation suivie (origine « elearning ») et, pour un module rattaché au catalogue et réussi,
//   la certification par le circuit existant (`suivieCertifiee` évite alors le double comptage des heures).
// - Import d'avancement (CSV, `lireCsv`) : colonnes fermées — identifiant du salarié (matricule ou e-mail professionnel),
//   code du module, statut, avancement, date de fin, réussite ; aucun temps de connexion ni journal d'activité de la
//   plateforme (une colonne inconnue fait refuser le fichier) ; une valeur identique ne change rien (idempotent).
// - Heures comptées dans le plan et les indicateurs (formation suivie), jamais proposées sur la feuille de temps.
import { addM, toIso } from '../dates.ts';
import { key } from '../format.ts';
import type { Dataset, Employe, Formation, ISODate } from '../types.ts';
import type { InscriptionElearning, ModuleElearning, Organisme, StatutInscriptionElearning } from '../types-organismes.ts';
import { dureeValide } from './heures-formation.ts';
import { lireCsv } from './imports.ts';
import { matriculeAffiche } from './matricules.ts';
import { organismeActif } from './organismes.ts';

export const STATUT_INSCRIPTION_LABEL: Record<StatutInscriptionElearning | 'expire', string> = {
  inscrit: 'Inscrit', en_cours: 'En cours', termine: 'Terminé', abandonne: 'Abandonné', expire: 'Accès expiré',
};
/** Langues proposées pour un module (code ISO 639-1). */
export const LANGUES_MODULE: Record<string, string> = { fr: 'Français', en: 'Anglais', de: 'Allemand', es: 'Espagnol', it: 'Italien' };

export const CODE_MODULE = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;
export const normaliserCodeModule = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : '');
export const INTITULE_MODULE_MAX = 120;
export const URL_MODULE_MAX = 500;
export const ACCES_MOIS_MAX = 120;
export const COUT_LICENCE_MAX = 100_000;

/**
 * Lien d'accès d'un module : https seulement, sans identifiants dans l'adresse, 500 caractères au plus. Jamais exécuté ni
 * chargé par Cursus : l'écran l'ouvre dans un nouvel onglet (rel=noopener noreferrer).
 */
export function urlModuleValide(v: unknown): v is string {
  if (typeof v !== 'string' || !v || v.length > URL_MODULE_MAX || /\s/.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

type Saisie = unknown;
type Erreurs<K extends string> = Partial<Record<K, string>>;
const texte = (v: Saisie) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim() : '');
const vrai = (v: Saisie) => v === true || v === 'true' || v === 1 || v === '1';
const nombre = (v: Saisie) => Number(texte(v).replace(',', '.'));

export type ChampModule = 'code' | 'intitule' | 'organismeId' | 'formation' | 'url' | 'dureeHeures' | 'langue' | 'coutLicence' | 'accesMois' | 'attestationRequise';
export type SaisieModule = Partial<Record<ChampModule, Saisie>>;
export type ValeurModule = Pick<ModuleElearning, ChampModule>;

/**
 * Module saisi, contrôlé : une erreur par champ, ou la valeur à enregistrer. `avant` : module modifié (son code ne change
 * pas ; champ absent de la saisie : inchangé). Organisme et formation : en vigueur (sauf s'ils sont déjà ceux du module).
 */
export function controlerModule(s: SaisieModule, existants: readonly ModuleElearning[], formations: readonly Formation[], organismes: readonly Organisme[], avant: ModuleElearning | null = null): { erreurs: Erreurs<ChampModule>; valeur: ValeurModule | null } {
  const e: Erreurs<ChampModule> = {};
  const champ = (k: ChampModule, actuel: unknown) => (s[k] === undefined ? actuel : s[k]);
  const code = avant ? avant.code : normaliserCodeModule(s.code);
  if (!avant) {
    if (!CODE_MODULE.test(code)) e.code = 'Code : majuscules, chiffres, « - » ou « _ » (32 caractères au plus).';
    else if (existants.some(m => m.code === code)) e.code = 'Ce code désigne déjà un module (archivé compris).';
  }
  const intitule = texte(champ('intitule', avant?.intitule));
  if (!intitule) e.intitule = 'Indiquez l’intitulé du module.';
  else if (intitule.length > INTITULE_MODULE_MAX) e.intitule = `Intitulé : ${INTITULE_MODULE_MAX} caractères au plus.`;
  const o = texte(champ('organismeId', avant?.organismeId));
  const organismeId = o === '' ? null : Number(o);
  if (organismeId !== null) {
    const fiche = organismes.find(x => x.id === organismeId);
    if (!fiche) e.organismeId = 'Organisme inconnu.';
    else if (!organismeActif(fiche) && organismeId !== avant?.organismeId) e.organismeId = 'Organisme archivé ou fusionné : choisissez-en un autre.';
  }
  const formation = texte(champ('formation', avant?.formation)) || null;
  if (formation) {
    const fm = formations.find(f => f.id === formation);
    if (!fm) e.formation = 'Formation inconnue du catalogue.';
    else if (fm.archive && formation !== avant?.formation) e.formation = 'Formation archivée : choisissez-en une autre.';
  }
  const url = texte(champ('url', avant?.url));
  if (!urlModuleValide(url)) e.url = 'Lien d’accès : adresse https complète (500 caractères au plus).';
  const d = texte(champ('dureeHeures', avant?.dureeHeures));
  const dureeHeures = d === '' ? null : nombre(d);
  if (dureeHeures !== null && !dureeValide(dureeHeures)) e.dureeHeures = 'Durée en heures : nombre de 0,25 à 2 000.';
  const langue = texte(champ('langue', avant?.langue ?? 'fr')).toLowerCase();
  if (!Object.hasOwn(LANGUES_MODULE, langue)) e.langue = 'Choisissez la langue du module.';
  const c = texte(champ('coutLicence', avant?.coutLicence));
  const coutLicence = c === '' ? null : nombre(c);
  if (coutLicence !== null && !(Number.isFinite(coutLicence) && coutLicence >= 0 && coutLicence <= COUT_LICENCE_MAX)) e.coutLicence = 'Coût d’une licence : nombre de 0 à 100 000.';
  const a = texte(champ('accesMois', avant?.accesMois));
  const accesMois = a === '' ? null : Number(a);
  if (accesMois !== null && !(Number.isInteger(accesMois) && accesMois >= 1 && accesMois <= ACCES_MOIS_MAX)) e.accesMois = `Validité de l’accès : nombre entier de mois, de 1 à ${ACCES_MOIS_MAX}.`;
  const attestationRequise = vrai(champ('attestationRequise', avant?.attestationRequise ?? false));
  if (Object.keys(e).length) return { erreurs: e, valeur: null };
  return {
    erreurs: e,
    valeur: {
      code, intitule, organismeId, formation, url, dureeHeures: dureeHeures === null ? null : Math.round(dureeHeures * 100) / 100, langue,
      coutLicence: coutLicence === null ? null : Math.round(coutLicence * 100) / 100, accesMois, attestationRequise,
    },
  };
}

// — Inscriptions —

/** Inscription ouverte : ni terminée, ni abandonnée, ni annulée (une seule par salarié et module). */
export const inscriptionOuverte = (i: Pick<InscriptionElearning, 'statut' | 'annuleLe'>) => !i.annuleLe && (i.statut === 'inscrit' || i.statut === 'en_cours');

/** Inscription ouverte d'un salarié à un module, s'il en a une. */
export const inscriptionOuverteDe = (liste: readonly InscriptionElearning[] | undefined, empId: number, moduleId: number) =>
  (liste ?? []).find(i => i.empId === empId && i.moduleId === moduleId && inscriptionOuverte(i)) ?? null;

/** Fin de l'accès au module (inscription + validité en mois), ou null (sans limite). */
export const finAcces = (i: Pick<InscriptionElearning, 'inscritLe'>, m: Pick<ModuleElearning, 'accesMois'> | null | undefined): ISODate | null =>
  (m?.accesMois ? addM(i.inscritLe, m.accesMois) : null);

/** Statut affiché le `le` : « expiré » pour une inscription ouverte dont l'accès est échu, sinon le statut enregistré. */
export function etatInscription(i: InscriptionElearning, m: Pick<ModuleElearning, 'accesMois'> | null | undefined, le: ISODate): StatutInscriptionElearning | 'expire' {
  const fin = finAcces(i, m);
  return inscriptionOuverte(i) && fin && fin < le ? 'expire' : i.statut;
}

/** Fin à valider par le service RH : inscription ouverte, fin déclarée par le salarié ou avancement complet importé. */
export const finAValider = (i: InscriptionElearning) => inscriptionOuverte(i) && (!!i.declareLe || i.avancement === 100);

/** Heures retenues à la fin : saisies par le service RH, sinon la durée du module, sinon inconnues. */
export const heuresRetenues = (i: Pick<InscriptionElearning, 'heures'>, m: Pick<ModuleElearning, 'dureeHeures'> | null | undefined) => i.heures ?? m?.dureeHeures ?? null;

/** Avancement saisi : entier de 0 à 100 (« 40 % » admis) ; null si vide, NaN si invalide. */
export function avancementDe(v: unknown): number | null {
  const t = texte(v).replace(/\s*%$/, '');
  if (t === '') return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : NaN;
}

/** Réussite saisie : oui, non, sans objet (vide) ; undefined si illisible. */
export function reussiteDe(v: unknown): boolean | null | undefined {
  if (v === true || v === false || v === null || v === undefined) return v ?? null;
  const k = key(String(v));
  if (k === '') return null;
  if (['oui', 'o', 'yes', 'y', 'true', '1', 'reussi', 'reussie', 'admis', 'passed'].includes(k)) return true;
  if (['non', 'n', 'no', 'false', '0', 'echec', 'echoue', 'failed'].includes(k)) return false;
  if (['sans objet', 'so', 'na', 'n a'].includes(k)) return null;
  return undefined;
}

/** Date saisie « AAAA-MM-JJ » ou « JJ/MM/AAAA » (`toIso`) ; null si vide, '' si invalide. */
export function dateSaisie(v: unknown): ISODate | null | '' {
  const t = texte(v);
  return t ? toIso(t) ?? '' : null;
}

// — Import d'avancement (CSV) —

/** Colonnes admises du fichier d'import, par clé d'en-tête (key) : liste fermée. */
const COLONNES: Record<string, ColonneImport> = {
  matricule: 'matricule', 'matricule paie': 'matricule', identifiant: 'matricule',
  email: 'email', 'e mail': 'email', courriel: 'email', 'adresse e mail': 'email', mail: 'email',
  module: 'module', 'code module': 'module', 'code du module': 'module',
  statut: 'statut', avancement: 'avancement', progression: 'avancement',
  'date fin': 'dateFin', 'date de fin': 'dateFin', 'termine le': 'dateFin', fin: 'dateFin',
  reussite: 'reussite', reussi: 'reussite', resultat: 'reussite',
};
export type ColonneImport = 'matricule' | 'email' | 'module' | 'statut' | 'avancement' | 'dateFin' | 'reussite';
/** Colonnes admises, telles qu'affichées dans l'aide et les messages. */
export const COLONNES_IMPORT_ELEARNING = 'matricule ou e-mail, module, statut, avancement, date de fin, réussite';

/** Statut lu dans le fichier : inscrit, en cours, terminé ; l'abandon reste une décision du service RH. */
const STATUTS_IMPORT: Record<string, 'inscrit' | 'en_cours' | 'termine'> = {
  inscrit: 'inscrit', 'non commence': 'inscrit', 'not started': 'inscrit',
  'en cours': 'en_cours', commence: 'en_cours', 'in progress': 'en_cours', started: 'en_cours',
  termine: 'termine', terminee: 'termine', acheve: 'termine', complete: 'termine', completed: 'termine', fini: 'termine',
};

/** Ligne du fichier d'import, rapprochée et contrôlée. */
export interface LigneImportElearning {
  n: number; empId: number | null; moduleId: number | null; inscriptionId: number | null;
  statut: 'inscrit' | 'en_cours' | 'termine' | null; avancement: number | null; dateFin: ISODate | null; reussi: boolean | null;
  errs: string[];
}

/** Données lues par l'import : fiches (matricule, e-mail), modules, inscriptions. */
export type DonneesImport = Pick<Dataset, 'modulesElearning' | 'inscriptionsElearning'> & { employes: readonly Pick<Employe, 'id' | 'matriculePaie' | 'email'>[] };

/**
 * Fichier d'avancement lu et rapproché : refus du fichier entier (en-tête manquant, colonne non admise, aucune ligne), ou
 * une ligne par ligne de données avec ses erreurs. Rapprochement par matricule (paie ou Cursus) ou e-mail professionnel,
 * et code du module ; l'inscription ouverte du salarié au module est exigée (l'import n'inscrit personne).
 */
export function lireImportElearning(text: string, d: DonneesImport, today: ISODate): { refus: string } | { lignes: LigneImportElearning[] } {
  const { lignes, numeros } = lireCsv(text);
  if (!lignes.length) return { refus: 'Fichier vide' };
  const entete = lignes[0].map(c => key(c));
  const inconnues = lignes[0].filter((_, i) => entete[i] && !COLONNES[entete[i]]);
  if (inconnues.length) {
    return { refus: `Colonne non admise : ${inconnues.map(c => `« ${c} »`).join(', ')} — seules ${COLONNES_IMPORT_ELEARNING} sont lues (aucun temps de connexion ni journal d’activité)` };
  }
  const col = new Map<ColonneImport, number>();
  entete.forEach((k, i) => { if (k && !col.has(COLONNES[k])) col.set(COLONNES[k], i); });
  if (!col.has('module') || !(col.has('matricule') || col.has('email'))) return { refus: 'En-tête attendu : matricule ou e-mail, et module' };
  if (lignes.length < 2) return { refus: 'Aucune ligne après l’en-tête' };
  const parMatricule = new Map<string, number>(), parEmail = new Map<string, number>();
  for (const e of d.employes) {
    parMatricule.set(matriculeAffiche(e).toUpperCase(), e.id);
    parMatricule.set(`EMP-${String(e.id).padStart(4, '0')}`, e.id);
    if (e.email) parEmail.set(e.email.toLowerCase(), e.id);
  }
  const modules = new Map((d.modulesElearning ?? []).map(m => [m.code, m]));
  const cellule = (l: string[], c: ColonneImport) => (col.has(c) ? (l[col.get(c)!] ?? '').trim() : '');
  return {
    lignes: lignes.slice(1).map((l, i): LigneImportElearning => {
      const errs: string[] = [];
      const mat = cellule(l, 'matricule').toUpperCase(), mail = cellule(l, 'email').toLowerCase();
      const empId = (mat && parMatricule.get(mat)) || (mail && parEmail.get(mail)) || null;
      if (!empId) errs.push(mat || mail ? 'salarié introuvable (matricule ou e-mail)' : 'matricule ou e-mail manquant');
      const m = modules.get(normaliserCodeModule(cellule(l, 'module')));
      if (!m) errs.push(cellule(l, 'module') ? 'module inconnu' : 'code du module manquant');
      const ins = empId && m ? inscriptionOuverteDe(d.inscriptionsElearning, empId, m.id) : null;
      if (empId && m && !ins) errs.push('aucune inscription ouverte à ce module');
      const s = key(cellule(l, 'statut'));
      const statut = s ? STATUTS_IMPORT[s] ?? null : null;
      if (s && !statut) errs.push('statut inconnu (inscrit, en cours, terminé)');
      const avancement = avancementDe(cellule(l, 'avancement'));
      if (Number.isNaN(avancement)) errs.push('avancement : nombre de 0 à 100');
      const dateFin = dateSaisie(cellule(l, 'dateFin'));
      if (dateFin === '') errs.push('date de fin invalide');
      else if (dateFin && dateFin > today) errs.push('date de fin dans le futur');
      else if (dateFin && ins && dateFin < ins.inscritLe) errs.push('date de fin antérieure à l’inscription');
      const reussi = reussiteDe(cellule(l, 'reussite'));
      if (reussi === undefined) errs.push('réussite : oui, non ou vide');
      if (!statut && avancement === null && !dateFin && reussi == null && !errs.length) errs.push('aucune valeur à reprendre');
      return {
        n: numeros[i + 1], empId: empId || null, moduleId: m?.id ?? null, inscriptionId: ins?.id ?? null, statut,
        avancement: Number.isNaN(avancement) ? null : avancement, dateFin: dateFin || null, reussi: reussi ?? null, errs,
      };
    }),
  };
}

/** Champs de l'inscription modifiés par une ligne d'import valide (avancement importé, réussite, date) ; null : rien ne change. */
export function effetImport(l: LigneImportElearning, i: InscriptionElearning, today: ISODate): Partial<InscriptionElearning> | null {
  const termine = l.statut === 'termine' || !!l.dateFin;
  const avancement = termine ? 100 : l.avancement ?? (l.statut === 'en_cours' ? i.avancement : null);
  const maj: Partial<InscriptionElearning> = {};
  if (avancement !== null && avancement !== i.avancement) Object.assign(maj, { avancement, avancementSource: 'import', avancementLe: termine ? l.dateFin ?? today : today });
  else if (termine && l.dateFin && l.dateFin !== i.avancementLe) Object.assign(maj, { avancementLe: l.dateFin, avancementSource: 'import' });
  if (l.reussi !== null && l.reussi !== i.reussi) maj.reussi = l.reussi;
  const statut = i.statut === 'inscrit' && (termine || l.statut === 'en_cours' || (avancement ?? 0) > 0) ? 'en_cours' : null;
  if (statut) maj.statut = statut;
  return Object.keys(maj).length ? maj : null;
}

/**
 * Fin automatique à l'import (réglage `elearningFinAutoImport`) : module sans attestation exigée, ligne « terminé » et
 * « réussi ». Sinon la fin attend la validation du service RH.
 */
export const finAutomatique = (actif: boolean, m: Pick<ModuleElearning, 'attestationRequise'>, l: Pick<LigneImportElearning, 'statut' | 'dateFin' | 'reussi'>) =>
  actif && !m.attestationRequise && (l.statut === 'termine' || !!l.dateFin) && l.reussi === true;
