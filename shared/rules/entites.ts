// Entités juridiques (lot 11, chantier C1, t195) : société et établissement, au-dessus des équipes. L'équipe racine (sans
// équipe parente, shared/rules/hierarchie.ts) porte l'entité ; ses équipes rattachées en héritent. L'entité fournit le
// SIREN, le SIRET et l'IDCC dont ont besoin l'OPCO, les indicateurs légaux et les notes de frais. Choix retenus :
// - deux niveaux, société puis établissement : un établissement a une société parente, une société n'en a pas ;
// - la table `entites` est un cache (colonne `source`) : la source cible est Matrix (demande d'un contrat pub_entites,
//   docs/demandes/) ; en attendant, le service RH tient les entités `local` ; une entité `matrix` ne se modifie pas ici ;
// - rien n'est supprimé : une entité se ferme (plus proposée), jamais tant qu'elle porte des équipes ou, pour une
//   société, des établissements ouverts ; une entité fermée se rouvre ;
// - SIREN (9 chiffres) et SIRET (14) contrôlés par leur clé de Luhn, le SIRET commençant par le SIREN de la société
//   (la sienne pour une société, celle de la société parente pour un établissement) ; IDCC sur 4 chiffres. Ce sont des
//   données publiques (répertoire SIRENE), non personnelles : elles peuvent figurer au journal.
// - site de rattachement (D14, code de matrix.pub_sites, cache `sites`) et unité Matrix (D15, code saisi à la main,
//   aucun appel à Matrix) : portés par l'équipe, ou à défaut par une équipe au-dessus d'elle ; le site, à défaut, par
//   l'entité. Le salarié en reçoit le site et l'unité de son équipe (`rattachementSalarie`).
// Contrôles partagés par les dialogues (étape 2) et les actions (server/src/actions/entites.ts).
import type { Entite, Equipe, Site, TypeEntite } from '../types.ts';
import { ancetres } from './hierarchie.ts';

/** Code d'une entité ou d'un site : format des codes de site de Matrix (0002_partage.sql, `site_code`). */
export const CODE_ENTITE = /^[a-z][a-z0-9_]{1,31}$/;
export const CODE_SITE = CODE_ENTITE;
/** Code d'unité de l'organigramme de Matrix (0002_partage.sql, `unite_code`) : « PRD », « PRD-MAINT », « PRD-MAINT-EQ1 ». */
export const CODE_UNITE = /^[A-Z]{3}(-[A-Z0-9]{2,12}){0,2}$/;
export const NOM_ENTITE_MAX = 120;
export const LIBELLE_SITE_MAX = 80;

export const TYPES_ENTITE: Record<TypeEntite, string> = { societe: 'Société', etablissement: 'Établissement' };
export const estTypeEntite = (v: unknown): v is TypeEntite => typeof v === 'string' && Object.hasOwn(TYPES_ENTITE, v);

export const normaliserCodeEntite = (v: unknown) => String(v ?? '').trim().toLowerCase();
export const normaliserCodeUnite = (v: unknown) => String(v ?? '').trim().toUpperCase();
/** Numéro saisi avec ses séparateurs (« 552 100 554 00019 ») : chiffres seuls. */
export const chiffres = (v: unknown) => String(v ?? '').replace(/[\s.-]/g, '');

/** Clé de Luhn d'une suite de chiffres : somme des chiffres, ceux de rang pair (en partant de la droite) doublés. */
export function luhn(n: string): boolean {
  if (!/^\d+$/.test(n)) return false;
  let somme = 0;
  for (let i = 0; i < n.length; i++) {
    let c = Number(n[n.length - 1 - i]);
    if (i % 2 === 1) c = c * 2 > 9 ? c * 2 - 9 : c * 2;
    somme += c;
  }
  return somme % 10 === 0;
}

/** SIREN de La Poste : ses établissements ont des SIRET dont la somme des chiffres est un multiple de 5 (règle de l'INSEE). */
const SIREN_LA_POSTE = '356000000';

export const sirenValide = (v: string) => /^\d{9}$/.test(v) && luhn(v);
export function siretValide(v: string): boolean {
  if (!/^\d{14}$/.test(v)) return false;
  if (v.startsWith(SIREN_LA_POSTE)) return [...v].reduce((s, c) => s + Number(c), 0) % 5 === 0;
  return luhn(v) && sirenValide(v.slice(0, 9));
}

/** IDCC (identifiant de la convention collective) : 1 à 4 chiffres, rendu sur 4 (« 44 » → « 0044 », Industries chimiques). */
export function normaliserIdcc(v: unknown): string | null {
  const t = chiffres(v);
  return /^\d{1,4}$/.test(t) && Number(t) > 0 ? t.padStart(4, '0') : null;
}

/** Entité désignée par son code. */
export const entiteDe = (entites: readonly Entite[], code: string | null | undefined) => (code ? entites.find(x => x.code === code) : undefined);
/** Entité ouverte (ni fermée ni désactivée) : seule proposée au rattachement d'une équipe ou d'un établissement. */
export const entiteOuverte = (x: Pick<Entite, 'actif' | 'fermeLe'> | undefined) => !!x && x.actif && !x.fermeLe;
/** Société d'une entité : elle-même, ou la société parente d'un établissement. */
export const societeDe = (entites: readonly Entite[], x: Entite | undefined): Entite | undefined => (x?.type === 'etablissement' ? entiteDe(entites, x.parente) : x);

type EquipeE = Pick<Equipe, 'nom' | 'managerId'> & { parente?: string | null; entite?: string | null; siteCode?: string | null; uniteCode?: string | null };

/**
 * Entité d'une équipe : celle de son équipe racine (la plus haute de ses équipes parentes, ou elle-même). L'entité posée
 * sur une équipe rattachée n'est pas lue : elle hérite. null : équipe racine sans entité (anomalie signalée au RH).
 */
export function entiteEquipe(equipes: readonly EquipeE[], nom: string): string | null {
  const q = equipes.find(x => x.nom === nom);
  if (!q) return null;
  const racine = ancetres(equipes, nom).at(-1) ?? q;
  return racine.entite ?? null;
}

/** Équipes portées par une entité : équipes racines rattachées et leurs équipes rattachées. */
export const equipesDeLEntite = (equipes: readonly EquipeE[], code: string) => equipes.filter(q => entiteEquipe(equipes, q.nom) === code).map(q => q.nom);

/** Code porté par l'équipe ou, à défaut, par la plus proche de ses équipes parentes qui en a un. */
function porte(equipes: readonly EquipeE[], nom: string, champ: 'siteCode' | 'uniteCode'): string | null {
  const q = equipes.find(x => x.nom === nom);
  if (!q) return null;
  return q[champ] ?? ancetres(equipes, nom).find(p => p[champ])?.[champ] ?? null;
}

/**
 * Site et unité de rattachement d'un salarié (D14, D15) d'après son équipe : site de l'équipe ou d'une équipe au-dessus,
 * à défaut celui de son entité ; unité de l'équipe ou d'une équipe au-dessus. Sans équipe : aucun.
 */
export function rattachementSalarie(equipes: readonly EquipeE[], entites: readonly Pick<Entite, 'code' | 'siteCode'>[], equipe: string | null):
  { siteCode: string | null; uniteCode: string | null } {
  if (!equipe) return { siteCode: null, uniteCode: null };
  const entite = entiteEquipe(equipes, equipe);
  const site = porte(equipes, equipe, 'siteCode') ?? entites.find(x => x.code === entite)?.siteCode ?? null;
  return { siteCode: site, uniteCode: porte(equipes, equipe, 'uniteCode') };
}

export interface ErreursEntite { code?: string; nom?: string; type?: string; parente?: string; siren?: string; siret?: string; idcc?: string; siteCode?: string }

/** Saisie d'une entité, telle que la reçoivent le dialogue et les actions `entite.creer` et `entite.modifier`. */
export interface SaisieEntite { code?: unknown; nom?: unknown; type?: unknown; parente?: unknown; siren?: unknown; siret?: unknown; idcc?: unknown; siteCode?: unknown }

/**
 * Création (`existant` null : code choisi, jamais modifié ensuite, unique parmi les entités fermées comprises) ou
 * modification d'une entité. Le type ne change pas après la création (il changerait la place des équipes rattachées).
 * Contrôles : nom ; société sans parente, établissement rattaché à une société ouverte ; SIREN et SIRET valides (clé de
 * Luhn), uniques, SIRET commençant par le SIREN de la société ; SIREN d'une société qui garde ceux de ses établissements ;
 * IDCC sur 4 chiffres ; site connu et ouvert (`sites`, cache de Matrix). Champs vides : null.
 */
export function controlerEntite(p: SaisieEntite, entites: readonly Entite[], sites: readonly Site[], existant: Entite | null):
  { erreurs: ErreursEntite; entite: Entite | null } {
  const erreurs: ErreursEntite = {};
  const code = existant ? existant.code : normaliserCodeEntite(p.code);
  const nom = String(p.nom ?? '').replace(/\s+/g, ' ').trim();
  const type = existant ? existant.type : p.type;
  const texte = (v: unknown) => (v == null ? '' : String(v).trim());
  const parente = normaliserCodeEntite(p.parente) || null;
  const siren = chiffres(p.siren) || null, siret = chiffres(p.siret) || null;
  const idccTexte = texte(p.idcc), idcc = idccTexte ? normaliserIdcc(idccTexte) : null;
  const siteCode = normaliserCodeEntite(p.siteCode) || null;
  if (!existant) {
    if (!code) erreurs.code = 'Indiquez le code de l’entité (« epc2i », « site_67 »…).';
    else if (!CODE_ENTITE.test(code)) erreurs.code = 'Code : 2 à 32 lettres minuscules, chiffres ou « _ », en commençant par une lettre.';
    else if (entites.some(x => x.code === code)) erreurs.code = `Le code ${code} existe déjà (entités fermées comprises).`;
  }
  if (!nom) erreurs.nom = 'Indiquez la raison sociale ou le nom de l’établissement.';
  else if (nom.length > NOM_ENTITE_MAX) erreurs.nom = `Nom : ${NOM_ENTITE_MAX} caractères au plus.`;
  if (!estTypeEntite(type)) erreurs.type = 'Choisissez le type : société ou établissement.';
  const autres = entites.filter(x => x.code !== code);
  let societe: Entite | undefined;
  if (type === 'societe') {
    if (parente) erreurs.parente = 'Une société n’a pas de société parente.';
    if (siren && !sirenValide(siren)) erreurs.siren = 'SIREN : 9 chiffres, dont le dernier est la clé de contrôle (vérifiez la saisie).';
    else if (siren && autres.some(x => x.type === 'societe' && x.siren === siren)) erreurs.siren = `Le SIREN ${siren} est déjà celui d’une autre société.`;
    else if (siren && existant) {
      const ecart = entites.filter(x => x.type === 'etablissement' && x.parente === code && x.siret && !x.siret.startsWith(siren));
      if (ecart.length) erreurs.siren = `Le SIRET de ${ecart.map(x => x.nom).join(', ')} ne commence pas par ce SIREN.`;
    }
    societe = { siren } as Entite;
  } else if (type === 'etablissement') {
    if (siren) erreurs.siren = 'Le SIREN est celui de la société : l’établissement porte son SIRET.';
    const s = entiteDe(entites, parente);
    if (!parente) erreurs.parente = 'Choisissez la société dont relève l’établissement.';
    else if (!s || s.type !== 'societe') erreurs.parente = `Société ${parente} introuvable.`;
    else if (!entiteOuverte(s) && s.code !== existant?.parente) erreurs.parente = `La société ${s.nom} est fermée.`;
    societe = s;
  }
  if (siret) {
    if (!siretValide(siret)) erreurs.siret = 'SIRET : 14 chiffres (SIREN puis NIC), dont le dernier est la clé de contrôle (vérifiez la saisie).';
    else if (autres.some(x => x.siret === siret)) erreurs.siret = `Le SIRET ${siret} est déjà celui d’une autre entité.`;
    else if (societe?.siren && !siret.startsWith(societe.siren)) erreurs.siret = `Le SIRET doit commencer par le SIREN de la société (${societe.siren}).`;
  }
  if (idccTexte && !idcc) erreurs.idcc = 'IDCC : 1 à 4 chiffres (0044 pour les Industries chimiques).';
  if (siteCode && siteCode !== existant?.siteCode) {
    const site = sites.find(x => x.code === siteCode);
    if (!site) erreurs.siteCode = `Site ${siteCode} inconnu (Référentiels → Entités et sites).`;
    else if (!site.actif) erreurs.siteCode = `Le site ${site.libelle} n’est plus actif.`;
  }
  if (Object.keys(erreurs).length) return { erreurs, entite: null };
  return {
    erreurs,
    entite: {
      code, nom, type: type as TypeEntite, parente: type === 'etablissement' ? parente : null, siren: type === 'societe' ? siren : null, siret, idcc, siteCode,
      ordre: existant?.ordre ?? Math.max(-1, ...entites.map(x => x.ordre)) + 1,
      actif: existant?.actif ?? true, fermeLe: existant?.fermeLe ?? null, source: existant?.source ?? 'local',
    },
  };
}

/**
 * Refus de la fermeture d'une entité, ou null : elle porte encore des équipes (directement ou par héritage), ou, pour
 * une société, des établissements ouverts. Les équipes se rattachent d'abord à une autre entité.
 */
export function refusFermeture(x: Entite, entites: readonly Entite[], equipes: readonly EquipeE[]): string | null {
  const portees = equipesDeLEntite(equipes, x.code);
  if (portees.length) {
    return `${portees.length > 1 ? 'Des équipes relèvent' : 'Une équipe relève'} de ${x.nom} (${portees.join(', ')}) : rattachez-${portees.length > 1 ? 'les' : 'la'} d’abord à une autre entité`;
  }
  const etablissements = entites.filter(e => e.type === 'etablissement' && e.parente === x.code && entiteOuverte(e));
  if (etablissements.length) return `${x.nom} a encore des établissements ouverts (${etablissements.map(e => e.nom).join(', ')}) : fermez-les d’abord`;
  return null;
}

/** Refus de la réouverture d'un établissement dont la société est fermée, ou null. */
export function refusReouverture(x: Entite, entites: readonly Entite[]): string | null {
  if (x.type !== 'etablissement') return null;
  const s = entiteDe(entites, x.parente);
  return s && !entiteOuverte(s) ? `La société ${s.nom} est fermée : rouvrez-la d’abord` : null;
}

/**
 * Contrôle du rattachement d'une équipe à une entité (`entite` null : retrait) : équipe racine seulement (une équipe
 * rattachée hérite de son équipe racine), entité connue et ouverte. Renvoie le motif du refus, ou null.
 */
export function controleEntiteEquipe(equipes: readonly EquipeE[], entites: readonly Entite[], nom: string, entite: string | null): string | null {
  const q = equipes.find(x => x.nom === nom);
  if (!q) return `Équipe ${nom} introuvable`;
  if (q.parente) return `L’équipe ${nom} est rattachée à l’équipe ${q.parente} : elle relève de l’entité de son équipe racine`;
  if (!entite) return null;
  const x = entiteDe(entites, entite);
  if (!x) return `Entité ${entite} introuvable`;
  if (!entiteOuverte(x)) return `L’entité ${x.nom} est fermée`;
  return null;
}

/** Contrôle du site d'une équipe ou d'une entité (`code` null : aucun) : site connu et actif, sauf celui déjà porté. */
export function controleSite(sites: readonly Site[], code: string | null, actuel: string | null | undefined): string | null {
  if (!code || code === actuel) return null;
  if (!CODE_SITE.test(code)) return 'Code de site : 2 à 32 lettres minuscules, chiffres ou « _ », en commençant par une lettre';
  const s = sites.find(x => x.code === code);
  if (!s) return `Site ${code} inconnu (Référentiels → Entités et sites)`;
  return s.actif ? null : `Le site ${s.libelle} n’est plus actif`;
}

/** Contrôle du code d'unité Matrix d'une équipe (`code` null : aucun) : format de Matrix, unique parmi les équipes. */
export function controleUnite(equipes: readonly EquipeE[], nom: string, code: string | null): string | null {
  if (!code) return null;
  if (!CODE_UNITE.test(code)) return 'Code d’unité : trois lettres majuscules, puis jusqu’à deux segments « -XX » (PRD, PRD-MAINT, PRD-MAINT-EQ1)';
  const autre = equipes.find(x => x.nom !== nom && x.uniteCode === code);
  return autre ? `Le code d’unité ${code} est déjà celui de l’équipe ${autre.nom}` : null;
}

/** Saisie d'un site (cache de matrix.pub_sites, tenu à la main tant que Matrix ne le fournit pas). */
export function controlerSite(p: { code?: unknown; libelle?: unknown; actif?: unknown }, sites: readonly Site[], existant: Site | null):
  { erreurs: { code?: string; libelle?: string }; site: Site | null } {
  const erreurs: { code?: string; libelle?: string } = {};
  const code = existant ? existant.code : normaliserCodeEntite(p.code);
  const libelle = String(p.libelle ?? '').replace(/\s+/g, ' ').trim();
  if (!existant) {
    if (!code) erreurs.code = 'Indiquez le code du site (code de Matrix : « lab67 », « pde »…).';
    else if (!CODE_SITE.test(code)) erreurs.code = 'Code : 2 à 32 lettres minuscules, chiffres ou « _ », en commençant par une lettre.';
    else if (sites.some(x => x.code === code)) erreurs.code = `Le site ${code} existe déjà.`;
  }
  if (!libelle) erreurs.libelle = 'Indiquez le libellé du site.';
  else if (libelle.length > LIBELLE_SITE_MAX) erreurs.libelle = `Libellé : ${LIBELLE_SITE_MAX} caractères au plus.`;
  if (Object.keys(erreurs).length) return { erreurs, site: null };
  return {
    erreurs,
    site: { code, libelle, actif: p.actif === undefined ? existant?.actif ?? true : p.actif !== false, ordre: existant?.ordre ?? Math.max(-1, ...sites.map(x => x.ordre)) + 1 },
  };
}

/** Mots qui désignent un lieu dans le nom d'une équipe racine (« Site de Lyon », « Usine 2 », « Établissement Nord », « Dépôt »). */
const MOTS_SITE = /(?:^|[^\p{L}])(?:site|usine|[ée]tablissement|agence|d[ée]p[ôo]t|entrep[ôo]t|plateforme|campus)s?(?![\p{L}])/iu;

/**
 * Équipes racines dont le nom ressemble à un site (PROFONDEUR_MAX était commenté « site, service, atelier, équipe ») :
 * seulement signalées au service RH, qui décide de les convertir à la main ; jamais converties d'office (une conversion
 * changerait les valideurs).
 */
export const equipesRessemblantAUnSite = (equipes: readonly EquipeE[]) => equipes.filter(q => !q.parente && MOTS_SITE.test(q.nom)).map(q => q.nom);
