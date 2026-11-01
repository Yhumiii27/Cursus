// Organismes de formation (lot 12, chantier C4, t190) : référentiel à la place de l'organisme en texte libre. Règles pures,
// communes au serveur (server/src/actions/organismes.ts, reprise server/src/reprise-organismes.ts) et aux dialogues :
// - clé de rapprochement des textes libres (`cleOrganisme`, d'après norm() : casse, accents, ponctuation, formes
//   juridiques), fiches internes à part (« Interne · HSE »), « Organisme non renseigné » jamais une fiche ;
// - saisie contrôlée d'une fiche (identité, SIRET par clé de Luhn, déclaration d'activité sur 11 chiffres, Qualiopi), des
//   conditions (service RH), d'un contact et d'un tarif ;
// - état Qualiopi à une date (certifié, à échéance, échu, sans date à vérifier, non certifié) : avertissement seulement,
//   jamais un blocage (choix par défaut du chantier) ; déclaration d'activité absente d'un organisme externe signalée ;
// - organisme d'une session (figé à sa création), d'une ligne du plan, d'une formation suivie : la fiche, sinon celle du
//   catalogue ; fiche fusionnée suivie jusqu'à celle qui la remplace ; tarif en vigueur ;
// - fusion de deux fiches : jamais si leurs SIRET diffèrent, alias réunis, objets réaffectés comptés.
import { addD, isValidDate } from '../dates.ts';
import { key, norm } from '../format.ts';
import type { Dataset, Formation, FormationSuivie, ISODate, PlanAction, Session } from '../types.ts';
import type {
  CategorieQualiopi, ModaliteTarif, Organisme, OrganismeContact, OrganismeResume, OrganismeTarif, RoleContactOrganisme, TypeOrganisme, UniteTarif,
} from '../types-organismes.ts';
import { ORGANISME_INCONNU } from './evaluation-formation.ts';
import { ndaValide, siretValide } from './opco.ts';

export const TYPES_ORGANISME: Record<TypeOrganisme, string> = { externe: 'Organisme externe', interne: 'Service interne', independant: 'Formateur indépendant' };
export const CATEGORIES_QUALIOPI: Record<CategorieQualiopi, string> = {
  formation: 'Actions de formation', bilan: 'Bilans de compétences', vae: 'Validation des acquis de l’expérience', apprentissage: 'Actions de formation par apprentissage',
};
export const ROLES_CONTACT: Record<RoleContactOrganisme, string> = { commercial: 'Commercial', administratif: 'Administratif', facturation: 'Facturation', formateur: 'Formateur' };
export const MODALITES_TARIF: Record<ModaliteTarif, string> = { inter: 'Inter-entreprises', intra: 'Intra-entreprise', distanciel: 'À distance', elearning: 'E-learning' };
export const UNITES_TARIF: Record<UniteTarif, string> = { stagiaire: 'par stagiaire', session: 'par session', jour: 'par jour', heure: 'par heure', licence: 'par licence' };

export const estTypeOrganisme = (v: unknown): v is TypeOrganisme => typeof v === 'string' && Object.hasOwn(TYPES_ORGANISME, v);
export const estCategorieQualiopi = (v: unknown): v is CategorieQualiopi => typeof v === 'string' && Object.hasOwn(CATEGORIES_QUALIOPI, v);
export const estRoleContact = (v: unknown): v is RoleContactOrganisme => typeof v === 'string' && Object.hasOwn(ROLES_CONTACT, v);
export const estModaliteTarif = (v: unknown): v is ModaliteTarif => typeof v === 'string' && Object.hasOwn(MODALITES_TARIF, v);
export const estUniteTarif = (v: unknown): v is UniteTarif => typeof v === 'string' && Object.hasOwn(UNITES_TARIF, v);

/** Nom usuel : 80 caractères au plus, comme `formations.organisme`, où il est recopié (contrat pub_titres_detenus). */
export const NOM_ORGANISME_MAX = 80;
export const RAISON_SOCIALE_MAX = 120;
export const ADRESSE_MAX = 200;
export const CONDITIONS_MAX = 500;
export const TEXTE_COURT_MAX = 80;
export const DELAI_ANNULATION_MAX = 365;
export const MONTANT_TARIF_MAX = 1_000_000;

/**
 * Code d'une fiche : majuscules, chiffres, « - » ou « _ », 32 caractères au plus ; stable, jamais modifié (il est recopié au
 * journal à la place du nom, qui peut désigner une personne : formateur indépendant).
 */
export const CODE_ORGANISME = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;
export const normaliserCodeOrganisme = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : '');
export const estCodeOrganisme = (v: unknown): v is string => typeof v === 'string' && CODE_ORGANISME.test(v);

// — Rapprochement des textes libres —

/** Formes juridiques retirées de la clé : « Apave SAS » et « APAVE » désignent la même entité. */
const FORMES_JURIDIQUES = new Set(['sas', 'sasu', 'sarl', 'eurl', 'sa', 'sca', 'snc', 'scop', 'scic', 'sci', 'gie', 'selarl', 'ei', 'eirl', 'micro', 'entreprise']);

/**
 * Texte libre d'un organisme à reprendre : sans espaces superflus, ni vide, ni « Organisme non renseigné » (qui n'est
 * jamais une fiche) ; null sinon.
 */
export function texteOrganisme(v: unknown): string | null {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t && key(t) !== key(ORGANISME_INCONNU) ? t : null;
}

/** Service interne : texte qui commence par « Interne » (« Interne · HSE », « interne - DSI »). */
export const estInterne = (texte: string) => /^interne(\s|$)/.test(key(texte));

/**
 * Clé de rapprochement d'un texte libre, d'après norm() : casse et accents ignorés, ponctuation réduite à des espaces
 * (key), formes juridiques retirées ; « & » vaut « et ». Une fiche interne garde sa clé propre (« interne hse »), jamais
 * rapprochée d'un organisme externe. Vide : aucun rapprochement.
 */
export function cleOrganisme(texte: string | null | undefined): string {
  const mots = key(norm(texte ?? '').replace(/&/g, ' et ')).split(' ').filter(Boolean);
  const sans = mots.filter(m => !FORMES_JURIDIQUES.has(m));
  return (sans.length ? sans : mots).join(' ');
}

/** Graphie la plus fréquente d'un groupe de textes (à égalité, la première dans l'ordre alphabétique) : nom usuel repris. */
export function graphieDominante(textes: readonly string[]): string {
  const n = new Map<string, number>();
  for (const t of textes) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))[0]?.[0] ?? '';
}

/** Code proposé pour une fiche nommée `nom`, unique parmi `pris` (suffixe -2, -3… au besoin). */
export function codePropose(nom: string, pris: ReadonlySet<string>): string {
  const base = (key(nom).toUpperCase().replace(/ /g, '-').slice(0, 28).replace(/-+$/, '')) || 'ORGANISME';
  if (!pris.has(base)) return base;
  for (let i = 2; ; i++) if (!pris.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Clés d'une fiche : son nom usuel et chacun de ses alias. */
export const clesFiche = (o: Pick<Organisme, 'nomUsuel' | 'alias'>): Set<string> => new Set([o.nomUsuel, ...o.alias].map(cleOrganisme).filter(Boolean));

// — Lecture —

/** Fiche finale : celle qui a absorbé `id` par une fusion (chaîne suivie, boucle impossible tenue à distance), ou elle-même. */
export function organismeFinal(organismes: readonly Organisme[] | undefined, id: number | null | undefined): Organisme | null {
  const parId = new Map((organismes ?? []).map(o => [o.id, o]));
  let o = id == null ? undefined : parId.get(id);
  for (let i = 0; o?.fusionneDans != null && i < 20; i++) o = parId.get(o.fusionneDans) ?? o;
  return o ?? null;
}

/** Fiche d'une formation du catalogue (organisme par défaut). */
export const organismeDeFormation = (ds: Pick<Dataset, 'organismes'>, fm: Pick<Formation, 'organismeId'> | null | undefined) => organismeFinal(ds.organismes, fm?.organismeId);

/** Organisme d'une session : le sien, figé à la création ; à défaut (session d'avant la reprise), celui du catalogue. */
export function organismeDeSession(ds: Pick<Dataset, 'organismes' | 'referentiels'>, s: Pick<Session, 'formation' | 'organismeId'>): Organisme | null {
  if (s.organismeId != null) return organismeFinal(ds.organismes, s.organismeId);
  return organismeDeFormation(ds, ds.referentiels.formations.find(f => f.id === s.formation));
}

/** Organisme prévu d'une ligne du plan : le sien, sinon celui de sa formation du catalogue. */
export function organismeDuPlan(ds: Pick<Dataset, 'organismes' | 'referentiels'>, l: Pick<PlanAction, 'f' | 'organismeId'>): Organisme | null {
  if (l.organismeId != null) return organismeFinal(ds.organismes, l.organismeId);
  return l.f ? organismeDeFormation(ds, ds.referentiels.formations.find(f => f.id === l.f)) : null;
}

/** Organisme d'une formation suivie : le sien, sinon (sans texte saisi) celui de sa formation du catalogue. */
export function organismeDeSuivie(ds: Pick<Dataset, 'organismes' | 'referentiels'>, x: Pick<FormationSuivie, 'f' | 'organisme' | 'organismeId'>): Organisme | null {
  if (x.organismeId != null) return organismeFinal(ds.organismes, x.organismeId);
  return !x.organisme && x.f ? organismeDeFormation(ds, ds.referentiels.formations.find(f => f.id === x.f)) : null;
}

/**
 * Fiche nommée dans les référentiels transmis à tous les espaces (`referentiels.organismes`) : celle d'une formation du
 * catalogue (son nom y figure déjà), sinon une fiche qui n'est ni un formateur indépendant (personne physique) ni un texte
 * libre repris encore à vérifier (une formation suivie peut nommer une personne ou révéler une formation individuelle).
 * Le service RH, le référent et la lecture seule reçoivent toutes les fiches (`organismes`).
 */
export function organismePublie(o: Pick<Organisme, 'id' | 'type' | 'source' | 'aVerifier'>, catalogue: ReadonlySet<number>): boolean {
  return catalogue.has(o.id) || (o.type !== 'independant' && !(o.source === 'reprise' && o.aVerifier));
}

/** Fiche réduite transmise à tous les espaces. */
export const resumeOrganisme = (o: Organisme): OrganismeResume => ({ id: o.id, code: o.code, nomUsuel: o.nomUsuel, type: o.type, archive: o.archive });

/** Fiche en vigueur : ni archivée, ni fusionnée. */
export const organismeActif = (o: Pick<Organisme, 'archive' | 'fusionneDans'>) => !o.archive && o.fusionneDans == null;

// — Qualiopi et déclaration d'activité —

/** Second palier de relance avant la fin de validité Qualiopi (le premier est réglé : `organismeAlerteQualiopiJours`). */
export const QUALIOPI_SECOND_PALIER = 15;

export type EtatQualiopi = 'certifie' | 'a_echeance' | 'echu' | 'a_verifier' | 'non_certifie' | 'sans_objet';
export const ETAT_QUALIOPI_LABEL: Record<EtatQualiopi, string> = {
  certifie: 'Certifié Qualiopi', a_echeance: 'Qualiopi à renouveler', echu: 'Qualiopi échu', a_verifier: 'Qualiopi à vérifier (sans date de validité)',
  non_certifie: 'Non certifié Qualiopi', sans_objet: 'Service interne',
};

/**
 * État Qualiopi d'un organisme à la date `le` : un service interne n'en a pas besoin ; certifié sans date de validité : à
 * vérifier (fiche reprise) ; échu le lendemain de la date de validité ; à échéance dans les `jours` qui précèdent.
 */
export function etatQualiopi(o: Pick<Organisme, 'type' | 'qualiopi' | 'qualiopiValideJusquau'>, le: ISODate, jours: number): EtatQualiopi {
  if (o.type === 'interne') return 'sans_objet';
  if (!o.qualiopi) return 'non_certifie';
  if (!o.qualiopiValideJusquau) return 'a_verifier';
  if (o.qualiopiValideJusquau < le) return 'echu';
  return o.qualiopiValideJusquau <= addD(le, jours) ? 'a_echeance' : 'certifie';
}

/** Certifié Qualiopi et valide le jour `le` (dossier OPCO : date de début de la formation) ; sans date : non établi (faux). */
export const qualiopiValideLe = (o: Pick<Organisme, 'type' | 'qualiopi' | 'qualiopiValideJusquau'>, le: ISODate) =>
  o.type !== 'interne' && o.qualiopi && !!o.qualiopiValideJusquau && o.qualiopiValideJusquau >= le;

/** Déclaration d'activité absente d'un organisme qui en a besoin (externe ou formateur indépendant) : signalée, jamais exigée. */
export const ndaManquant = (o: Pick<Organisme, 'type' | 'nda'>) => o.type !== 'interne' && !o.nda;

/**
 * Avertissements d'un organisme pour une formation qui commence le `le` (dossier OPCO, ligne du plan, session) : Qualiopi
 * absent, échu ou à vérifier, déclaration d'activité absente. Jamais un blocage : l'OPCO ne finance pas un organisme non
 * certifié, mais le service RH peut avoir une certification récente pas encore saisie.
 */
export function avertissementsOrganisme(o: Pick<Organisme, 'type' | 'qualiopi' | 'qualiopiValideJusquau' | 'nda' | 'nomUsuel'>, le: ISODate): string[] {
  if (o.type === 'interne') return [];
  const out: string[] = [];
  if (!o.qualiopi) out.push(`${o.nomUsuel} : non certifié Qualiopi, l’OPCO ne finance pas`);
  else if (!o.qualiopiValideJusquau) out.push(`${o.nomUsuel} : certification Qualiopi sans date de validité, à vérifier`);
  else if (o.qualiopiValideJusquau < le) out.push(`${o.nomUsuel} : certification Qualiopi échue le ${o.qualiopiValideJusquau}, l’OPCO ne finance pas`);
  if (ndaManquant(o)) out.push(`${o.nomUsuel} : déclaration d’activité (NDA) non renseignée`);
  return out;
}

// — Saisie —

type Saisie = unknown;
type Erreurs<K extends string> = Partial<Record<K, string>>;
const texte = (v: Saisie) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim() : '');
const facultatif = (e: Erreurs<string>, champ: string, v: string, max: number, libelle: string) => {
  if (v.length > max) e[champ] = `${libelle} : ${max} caractères au plus.`;
  return v || null;
};
const vrai = (v: Saisie) => v === true || v === 'true' || v === 1 || v === '1';
const dateFacultative = (e: Erreurs<string>, champ: string, v: Saisie, libelle: string): ISODate | null => {
  const t = texte(v);
  if (!t) return null;
  if (!isValidDate(t)) e[champ] = `${libelle} : date invalide.`;
  return t;
};

export type ChampOrganisme = 'code' | 'nomUsuel' | 'raisonSociale' | 'type' | 'siret' | 'nda' | 'ndaRegion' | 'qualiopi' | 'qualiopiCategories'
  | 'qualiopiCertificateur' | 'qualiopiNumero' | 'qualiopiValideJusquau' | 'qualiopiVerifieLe' | 'adresse' | 'siteWeb';
export type SaisieOrganisme = Partial<Record<ChampOrganisme, Saisie>>;
/** Champs d'identité et Qualiopi d'une fiche (droit « formations »). */
export type IdentiteOrganisme = Pick<Organisme, 'code' | 'nomUsuel' | 'raisonSociale' | 'type' | 'siret' | 'nda' | 'ndaRegion' | 'qualiopi' | 'qualiopiCategories'
  | 'qualiopiCertificateur' | 'qualiopiNumero' | 'qualiopiValideJusquau' | 'qualiopiVerifieLe' | 'adresse' | 'siteWeb'>;

/** Site web : http ou https, sans identifiants, 200 caractères au plus ; null si vide. */
export function siteWebValide(v: string): boolean {
  if (v.length > 200) return false;
  try {
    const u = new URL(v);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
  } catch {
    return false;
  }
}

/**
 * Identité et Qualiopi saisis, contrôlés : une erreur par champ, ou la valeur à enregistrer. `avant` : fiche modifiée (son
 * code ne change pas ; un champ absent de la saisie garde sa valeur). Nom usuel unique parmi les fiches en vigueur (clé de
 * rapprochement) ; SIRET unique parmi les fiches non fusionnées : deux fiches au même SIRET se fusionnent.
 */
export function controlerOrganisme(s: SaisieOrganisme, existants: readonly Organisme[], avant: Organisme | null = null): { erreurs: Erreurs<ChampOrganisme>; valeur: IdentiteOrganisme | null } {
  const e: Erreurs<ChampOrganisme> = {};
  const champ = (k: ChampOrganisme, actuel: unknown) => (s[k] === undefined ? actuel : s[k]);
  const code = avant ? avant.code : normaliserCodeOrganisme(s.code) || codePropose(texte(s.nomUsuel), new Set(existants.map(o => o.code)));
  if (!avant) {
    if (!CODE_ORGANISME.test(code)) e.code = 'Code : majuscules, chiffres, « - » ou « _ » (32 caractères au plus).';
    else if (existants.some(o => o.code === code)) e.code = 'Ce code désigne déjà un organisme (archivé compris).';
  }
  const nomUsuel = texte(champ('nomUsuel', avant?.nomUsuel));
  if (!nomUsuel) e.nomUsuel = 'Indiquez le nom usuel de l’organisme.';
  else if (nomUsuel.length > NOM_ORGANISME_MAX) e.nomUsuel = `Nom usuel : ${NOM_ORGANISME_MAX} caractères au plus.`;
  else if (existants.some(o => o.id !== avant?.id && organismeActif(o) && cleOrganisme(o.nomUsuel) === cleOrganisme(nomUsuel))) e.nomUsuel = 'Un organisme en vigueur porte déjà ce nom : fusionnez les fiches plutôt.';
  const raisonSociale = facultatif(e, 'raisonSociale', texte(champ('raisonSociale', avant?.raisonSociale)), RAISON_SOCIALE_MAX, 'Raison sociale');
  const type = texte(champ('type', avant?.type ?? 'externe'));
  if (!estTypeOrganisme(type)) e.type = 'Choisissez le type d’organisme.';
  const siret = texte(champ('siret', avant?.siret)).replace(/\s/g, '') || null;
  if (siret && !siretValide(siret)) e.siret = 'SIRET : 14 chiffres, clé de contrôle exacte.';
  else if (siret && existants.some(o => o.id !== avant?.id && o.fusionneDans == null && o.siret === siret)) e.siret = 'Ce SIRET est déjà celui d’un autre organisme : fusionnez les fiches plutôt.';
  const nda = texte(champ('nda', avant?.nda)).replace(/\s/g, '') || null;
  if (nda && !ndaValide(nda)) e.nda = 'Déclaration d’activité : 11 chiffres.';
  const ndaRegion = facultatif(e, 'ndaRegion', texte(champ('ndaRegion', avant?.ndaRegion)), TEXTE_COURT_MAX, 'Région de déclaration');
  const qualiopi = vrai(champ('qualiopi', avant?.qualiopi ?? false));
  const cats = champ('qualiopiCategories', avant?.qualiopiCategories ?? []);
  const qualiopiCategories = (Array.isArray(cats) ? cats : []).filter(estCategorieQualiopi);
  if (Array.isArray(cats) && qualiopiCategories.length !== cats.length) e.qualiopiCategories = 'Catégories Qualiopi : choisissez dans la liste.';
  const qualiopiCertificateur = facultatif(e, 'qualiopiCertificateur', texte(champ('qualiopiCertificateur', avant?.qualiopiCertificateur)), TEXTE_COURT_MAX, 'Certificateur');
  const qualiopiNumero = facultatif(e, 'qualiopiNumero', texte(champ('qualiopiNumero', avant?.qualiopiNumero)), 40, 'Numéro de certificat');
  const qualiopiValideJusquau = dateFacultative(e, 'qualiopiValideJusquau', champ('qualiopiValideJusquau', avant?.qualiopiValideJusquau), 'Fin de validité Qualiopi');
  const qualiopiVerifieLe = dateFacultative(e, 'qualiopiVerifieLe', champ('qualiopiVerifieLe', avant?.qualiopiVerifieLe), 'Vérification Qualiopi');
  const adresse = facultatif(e, 'adresse', texte(champ('adresse', avant?.adresse)), ADRESSE_MAX, 'Adresse');
  const siteWeb = texte(champ('siteWeb', avant?.siteWeb)) || null;
  if (siteWeb && !siteWebValide(siteWeb)) e.siteWeb = 'Site web : adresse http ou https.';
  if (Object.keys(e).length) return { erreurs: e, valeur: null };
  return {
    erreurs: e,
    valeur: {
      code, nomUsuel, raisonSociale, type: type as TypeOrganisme, siret, nda, ndaRegion,
      // Sans certification, ni catégories ni dates : rien ne reste d'une ancienne certification décochée.
      qualiopi, qualiopiCategories: qualiopi ? qualiopiCategories : [], qualiopiCertificateur: qualiopi ? qualiopiCertificateur : null,
      qualiopiNumero: qualiopi ? qualiopiNumero : null, qualiopiValideJusquau: qualiopi ? qualiopiValideJusquau : null, qualiopiVerifieLe, adresse, siteWeb,
    },
  };
}

export type ChampConditions = 'subrogationAcceptee' | 'delaiAnnulationJours' | 'conditions';
export type Conditions = Pick<Organisme, ChampConditions>;

/** Conditions commerciales (service RH) : subrogation, délai d'annulation en jours, texte court ; champ absent : inchangé. */
export function controlerConditions(s: Partial<Record<ChampConditions, Saisie>>, avant: Conditions): { erreurs: Erreurs<ChampConditions>; valeur: Conditions | null } {
  const e: Erreurs<ChampConditions> = {};
  const subrogationAcceptee = s.subrogationAcceptee === undefined ? avant.subrogationAcceptee : vrai(s.subrogationAcceptee);
  let delaiAnnulationJours = avant.delaiAnnulationJours;
  if (s.delaiAnnulationJours !== undefined) {
    const t = texte(s.delaiAnnulationJours);
    delaiAnnulationJours = t === '' ? null : Number(t);
    if (delaiAnnulationJours !== null && !(Number.isInteger(delaiAnnulationJours) && delaiAnnulationJours >= 0 && delaiAnnulationJours <= DELAI_ANNULATION_MAX)) {
      e.delaiAnnulationJours = `Délai d’annulation : nombre entier de jours, de 0 à ${DELAI_ANNULATION_MAX}.`;
    }
  }
  const conditions = s.conditions === undefined ? avant.conditions : facultatif(e, 'conditions', texte(s.conditions), CONDITIONS_MAX, 'Conditions');
  return Object.keys(e).length ? { erreurs: e, valeur: null } : { erreurs: e, valeur: { subrogationAcceptee, delaiAnnulationJours, conditions } };
}

export type ChampContact = 'nom' | 'fonction' | 'email' | 'telephone' | 'role' | 'principal';
export type SaisieContact = Pick<OrganismeContact, ChampContact>;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Contact saisi : nom requis, rôle de la liste, e-mail et téléphone contrôlés ; champ absent : inchangé. */
export function controlerContact(s: Partial<Record<ChampContact, Saisie>>, avant: SaisieContact | null = null): { erreurs: Erreurs<ChampContact>; valeur: SaisieContact | null } {
  const e: Erreurs<ChampContact> = {};
  const champ = (k: ChampContact, actuel: unknown) => (s[k] === undefined ? actuel : s[k]);
  const nom = texte(champ('nom', avant?.nom));
  if (!nom) e.nom = 'Indiquez le nom du contact.';
  else if (nom.length > TEXTE_COURT_MAX) e.nom = `Nom : ${TEXTE_COURT_MAX} caractères au plus.`;
  const fonction = facultatif(e, 'fonction', texte(champ('fonction', avant?.fonction)), TEXTE_COURT_MAX, 'Fonction');
  const email = texte(champ('email', avant?.email)).toLowerCase() || null;
  if (email && (!EMAIL.test(email) || email.length > 120)) e.email = 'Adresse e-mail invalide.';
  const telephone = texte(champ('telephone', avant?.telephone)) || null;
  if (telephone && !/^\+?[0-9 .()-]{6,25}$/.test(telephone)) e.telephone = 'Téléphone : chiffres, espaces, « + », « . », « - » (25 caractères au plus).';
  const role = texte(champ('role', avant?.role ?? 'administratif'));
  if (!estRoleContact(role)) e.role = 'Choisissez le rôle du contact.';
  const principal = vrai(champ('principal', avant?.principal ?? false));
  return Object.keys(e).length ? { erreurs: e, valeur: null } : { erreurs: e, valeur: { nom, fonction, email, telephone, role: role as RoleContactOrganisme, principal } };
}

export type ChampTarif = 'formation' | 'libelle' | 'modalite' | 'unite' | 'montantHt' | 'valableDu' | 'valableAu';
export type SaisieTarif = Pick<OrganismeTarif, ChampTarif>;

/** Tarif saisi : formation du catalogue ou libellé, modalité, unité, montant HT, période ; champ absent : inchangé. */
export function controlerTarif(s: Partial<Record<ChampTarif, Saisie>>, formations: readonly Pick<Formation, 'id'>[], avant: SaisieTarif | null, today: ISODate): { erreurs: Erreurs<ChampTarif>; valeur: SaisieTarif | null } {
  const e: Erreurs<ChampTarif> = {};
  const champ = (k: ChampTarif, actuel: unknown) => (s[k] === undefined ? actuel : s[k]);
  const formation = texte(champ('formation', avant?.formation)) || null;
  if (formation && !formations.some(f => f.id === formation)) e.formation = 'Formation inconnue du catalogue.';
  const libelle = facultatif(e, 'libelle', texte(champ('libelle', avant?.libelle)), 120, 'Libellé');
  if (!formation && !libelle && !e.libelle) e.libelle = 'Indiquez la formation du catalogue ou un libellé.';
  const modalite = texte(champ('modalite', avant?.modalite ?? 'inter'));
  if (!estModaliteTarif(modalite)) e.modalite = 'Choisissez la modalité.';
  const unite = texte(champ('unite', avant?.unite ?? 'stagiaire'));
  if (!estUniteTarif(unite)) e.unite = 'Choisissez l’unité.';
  const m = Number(texte(champ('montantHt', avant?.montantHt)).replace(',', '.'));
  if (texte(champ('montantHt', avant?.montantHt)) === '' || !Number.isFinite(m) || m < 0 || m > MONTANT_TARIF_MAX) e.montantHt = 'Montant hors taxes : nombre de 0 à 1 000 000.';
  const valableDu = texte(champ('valableDu', avant?.valableDu ?? today));
  if (!isValidDate(valableDu)) e.valableDu = 'Début de validité : date invalide.';
  const valableAu = dateFacultative(e, 'valableAu', champ('valableAu', avant?.valableAu), 'Fin de validité');
  if (!e.valableDu && !e.valableAu && valableAu && valableAu < valableDu) e.valableAu = 'La fin de validité précède le début.';
  return Object.keys(e).length ? { erreurs: e, valeur: null } : {
    erreurs: e,
    valeur: { formation, libelle, modalite: modalite as ModaliteTarif, unite: unite as UniteTarif, montantHt: Math.round(m * 100) / 100, valableDu, valableAu },
  };
}

/**
 * Tarif en vigueur le `le` d'un organisme pour une formation (et une modalité, si donnée) : non archivé, période qui
 * contient la date ; le plus récent d'abord. Il préremplit un coût, sans jamais l'imposer.
 */
export function tarifEnVigueur(tarifs: readonly OrganismeTarif[] | undefined, organismeId: number, formation: string | null, le: ISODate, modalite?: ModaliteTarif): OrganismeTarif | null {
  return (tarifs ?? []).filter(t => t.organismeId === organismeId && !t.archive && t.formation === formation && (!modalite || t.modalite === modalite)
    && t.valableDu <= le && (!t.valableAu || t.valableAu >= le))
    .sort((a, b) => b.valableDu.localeCompare(a.valableDu) || b.id - a.id)[0] ?? null;
}

// — Fusion —

/** Objets rattachés à une fiche, réaffectés par une fusion (comptés dans la confirmation et le journal). */
export interface Rattachements { formations: number; sessions: number; suivies: number; plan: number; dossiers: number; modules: number; contacts: number; tarifs: number }

/** Objets de l'instantané rattachés à la fiche `id` (fiche elle-même, non suivie jusqu'à une autre). */
export function rattachementsDe(ds: Pick<Dataset, 'referentiels' | 'sessions' | 'formationsSuivies' | 'plan' | 'dossiersOpco' | 'modulesElearning' | 'organismeContacts' | 'organismeTarifs'>, id: number): Rattachements {
  const n = <T extends { organismeId?: number | null }>(l: readonly T[] | undefined) => (l ?? []).filter(x => x.organismeId === id).length;
  return {
    formations: n(ds.referentiels.formations), sessions: n(ds.sessions), suivies: n(ds.formationsSuivies), plan: n(ds.plan), dossiers: n(ds.dossiersOpco),
    modules: n(ds.modulesElearning), contacts: n(ds.organismeContacts), tarifs: n(ds.organismeTarifs),
  };
}

/**
 * Refus d'une fusion de `source` dans `cible` (null : permise) : deux fiches distinctes, en vigueur (une fiche déjà fusionnée
 * ne se fusionne plus), jamais si leurs SIRET diffèrent (agences ou entités distinctes), jamais un service interne avec un
 * organisme externe.
 */
export function refusFusion(source: Organisme | null, cible: Organisme | null): string | null {
  if (!source || !cible) return 'Organisme introuvable';
  if (source.id === cible.id) return 'Choisissez deux organismes différents';
  if (source.fusionneDans != null || cible.fusionneDans != null) return 'Un organisme déjà fusionné ne se fusionne plus';
  if (cible.archive) return `${cible.nomUsuel} est archivé : rétablissez-le avant d’y fusionner une autre fiche`;
  if (source.siret && cible.siret && source.siret !== cible.siret) return 'SIRET différents : ce sont deux entités distinctes, la fusion est refusée';
  if ((source.type === 'interne') !== (cible.type === 'interne')) return 'Un service interne ne se fusionne pas avec un organisme externe';
  return null;
}

/** Alias de la fiche qui absorbe : les siens, le nom usuel et les alias de la fiche absorbée (sans doublon de clé). */
export function aliasApresFusion(source: Pick<Organisme, 'nomUsuel' | 'alias'>, cible: Pick<Organisme, 'nomUsuel' | 'alias'>): string[] {
  const out = [...cible.alias];
  const vus = new Set([cible.nomUsuel, ...cible.alias]);
  for (const a of [source.nomUsuel, ...source.alias]) if (!vus.has(a)) { vus.add(a); out.push(a); }
  return out;
}
