// Référentiels administrés dans Cursus (écran Référentiels) : catalogue des formations, habilitations et destinations.
// Contrôles de saisie partagés par les dialogues (client/src/dialogs/Ref*Dialog.tsx) et les actions du serveur
// (server/src/actions/referentiels.ts), éléments archivés, effet d'une modification sur les titres déjà détenus.
// - Codes : identifiants stables, échangés avec Keystone (exigences des chantiers, GET /referentiels) et inscrits dans
//   les dossiers ; choisis à la création, jamais modifiés ensuite.
// - Archivage plutôt que suppression : un élément archivé n'est plus proposé dans les listes (dialogues, catalogue) et
//   ses titres ne comptent plus dans les statuts ni les échéances ; il reste reconnu partout ailleurs (dossiers,
//   historique, journal, prérequis, Go / No Go, échanges avec Keystone) et se rétablit à tout moment.
// - Validité modifiée : les échéances sont calculées à l'affichage, la nouvelle durée vaut aussi pour les titres déjà
//   délivrés ; `effetModification` annonce, avant l'enregistrement, les titres qui deviennent échus.
// Vaccins (VACCINS) et règles de visa (VISA_RULES) restent dans le code (shared/constants.ts) pour cette version.
import { SECU_RULES, VACCINS, VISA_RULES } from '../constants.ts';
import { Domain, type EmpX } from '../domain.ts';
import { key } from '../format.ts';
import type { Dataset, Destination, Formation, FormationType, HabType, ISODate, SecuDetachement, VaccinId, ValidationMode, VisaKind } from '../types.ts';

export type ReferentielId = 'formations' | 'habilitations' | 'destinations';

/** Élément en vigueur : proposé dans les listes. */
export function actif(x: { archive?: ISODate | null } | null | undefined): boolean {
  return !!x && !x.archive;
}
/** Éléments en vigueur d'un référentiel, dans leur ordre. */
export function actifs<T extends { archive?: ISODate | null }>(liste: readonly T[]): T[] {
  return liste.filter(actif);
}
/**
 * Titre suivi : son habilitation n'est pas archivée. Le titre d'une habilitation archivée reste au dossier (prérequis,
 * Go / No Go) sans compter dans le statut ni les échéances, comme la certification d'une formation archivée.
 */
export function habSuivie(h: { hm: Pick<HabType, 'archive'> }): boolean {
  return actif(h.hm);
}
/** Refus d'une nouvelle saisie (session, certification, délivrance, demande, déplacement) sur un élément archivé. */
export function refusArchive(x: { archive?: ISODate | null } | null | undefined, nature: string): string | null {
  return x?.archive ? `${nature} archivée : rétablissez-la d’abord (écran Référentiels)` : null;
}

/**
 * Demandes des collaborateurs en attente de décision sur une formation ou une habilitation. Archivée, elle ne permet
 * plus de les accepter (`demande.accepter` refusée) : l'archivage les annonce, le service RH les refuse ensuite.
 */
export function demandesEnAttente(ds: Pick<Dataset, 'demandesCollab'>, ref: 'formations' | 'habilitations', id: string): number {
  return ds.demandesCollab.filter(r => r.statut === 'attente' && (ref === 'formations' ? r.type === 'formation' && r.f === id : r.type === 'habilitation' && r.h === id)).length;
}

/**
 * Titres d'une habilitation demandés et pas encore délivrés : première délivrance ou renouvellement d'un titre expiré
 * (« En attente » de l'écran Habilitations), nouvelle délivrance après un retrait (« Redemandée »). Archivée, elle ne se
 * délivre plus et ses titres quittent l'écran Habilitations : ils restent à délivrer après son rétablissement.
 */
export function titresADelivrer(ds: Pick<Dataset, 'employes'>, h: string): number {
  return ds.employes.filter(e => e.habs.some(t => t.h === h && (!t.delivree || !!t.demande))).length;
}

/**
 * Formations prérequises archivées d'une habilitation. Une habilitation en vigueur n'en a pas : la formation ne s'archive
 * pas tant qu'une habilitation en vigueur l'exige, et l'habilitation ne se rétablit qu'après ses prérequis.
 */
export function prerequisArchives(h: Pick<HabType, 'prereqs'>, formations: readonly Formation[]): Formation[] {
  return h.prereqs.flatMap(f => formations.filter(x => x.id === f && !actif(x)));
}

// — Codes —

/** Code d'une formation ou d'une habilitation : minuscules, chiffres, « - » ou « _ », 32 caractères au plus. */
export const CODE_TITRE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
/** Code pays ISO 3166 à deux lettres d'une destination. */
export const CODE_PAYS = /^[A-Z]{2}$/;
/** « autre » désigne une formation hors catalogue dans les demandes des collaborateurs. */
const CODES_RESERVES = new Set(['autre']);

export const codeTitre = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
export const codeDestination = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : '');

/** Code proposé d'après l'intitulé court (« CACES R489 » → « caces-r489 »), libre dans le référentiel. */
export function codeSuggere(court: string, pris: Iterable<string>): string {
  const base = key(court).replace(/ /g, '-').slice(0, 28).replace(/-+$/, '') || 'formation';
  const deja = new Set(pris);
  let code = base, n = 1;
  while (deja.has(code) || CODES_RESERVES.has(code)) code = `${base}-${++n}`;
  return code;
}

// — Saisies —

export const TYPES_FORMATION: readonly FormationType[] = ['Réglementaire', 'Recommandée', 'Interne'];
export const MODES_VALIDATION: readonly ValidationMode[] = ['presence', 'evaluation'];
/** Durée de validité d'un titre, en mois : de 1 mois à 20 ans. */
export const VALIDITE_MAX = 240;
/** Mois de validité du passeport exigés après l'entrée dans le pays. */
export const PASSEPORT_MOIS_MAX = 24;
/** DTP : toujours recommandé (rappel), quelle que soit la destination (Domain.readiness). */
export const VACCIN_TOUJOURS_RECOMMANDE: VaccinId = 'dtp';

type Erreurs<K extends string> = Partial<Record<K, string>>;
/** Champ d'un formulaire : chaîne saisie, ou valeur déjà typée (appel de l'API). */
type Saisie = unknown;

const texte = (v: Saisie) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const nombre = (v: Saisie) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.trim().replace(',', '.')) : NaN);

function texteRequis(e: Erreurs<string>, champ: string, v: string, max: number, vide: string) {
  if (!v) e[champ] = vide;
  else if (v.length > max) e[champ] = `${max} caractères au plus.`;
}
function texteFacultatif(e: Erreurs<string>, champ: string, v: string, max: number) {
  if (v.length > max) e[champ] = `${max} caractères au plus.`;
}
function validiteMois(e: Erreurs<string>, v: Saisie): number {
  const n = nombre(v);
  if (texte(v) === '') e.validite = 'Indiquez la durée de validité, en mois.';
  else if (!Number.isInteger(n) || n < 1 || n > VALIDITE_MAX) e.validite = `Validité en mois : nombre entier de 1 à ${VALIDITE_MAX}.`;
  return n;
}
/** Code choisi à la création : format, unicité (éléments archivés compris), codes réservés. */
function codeNouveau(e: Erreurs<string>, code: string, pris: Iterable<string>, opts: { motif: RegExp; aide: string; nature: string }) {
  if (!code) e.code = 'Indiquez le code.';
  else if (!opts.motif.test(code)) e.code = opts.aide;
  else if (CODES_RESERVES.has(code)) e.code = `Code réservé : choisissez-en un autre.`;
  else if ([...pris].includes(code)) e.code = `Ce code désigne déjà ${opts.nature} (archivée comprise).`;
}

export type ChampFormation = 'code' | 'nom' | 'court' | 'type' | 'validite' | 'duree' | 'organisme' | 'cout' | 'validation';
export type SaisieFormation = Partial<Record<ChampFormation, Saisie>>;

/**
 * Formation saisie, contrôlée : une erreur par champ (formulaire), ou la formation à enregistrer. `id` : formation
 * modifiée (son code ne change pas, son archivage non plus), sinon création avec le code saisi.
 */
export function controlerFormation(s: SaisieFormation, existantes: readonly Formation[], id: string | null = null): { erreurs: Erreurs<ChampFormation>; formation: Formation | null } {
  const e: Erreurs<ChampFormation> = {};
  const avant = id ? existantes.find(f => f.id === id) ?? null : null;
  const code = avant ? avant.id : codeTitre(s.code);
  if (!avant) codeNouveau(e, code, existantes.map(f => f.id), { motif: CODE_TITRE, aide: 'Code : lettres minuscules sans accent, chiffres, « - » ou « _ » (32 caractères au plus).', nature: 'une formation' });
  const nom = texte(s.nom), court = texte(s.court), duree = texte(s.duree), organisme = texte(s.organisme);
  texteRequis(e, 'nom', nom, 120, 'Indiquez l’intitulé de la formation.');
  if (!e.nom && existantes.some(f => f.id !== code && actif(f) && key(f.nom) === key(nom))) e.nom = 'Une formation du catalogue porte déjà cet intitulé.';
  texteRequis(e, 'court', court, 40, 'Indiquez le nom court (listes, étiquettes).');
  const type = texte(s.type) as FormationType;
  if (!TYPES_FORMATION.includes(type)) e.type = 'Choisissez le type de formation.';
  const validite = validiteMois(e, s.validite);
  texteFacultatif(e, 'duree', duree, 40);
  texteFacultatif(e, 'organisme', organisme, 80);
  // Coût par stagiaire, en euros : vide vaut 0 (formation interne).
  const cout = texte(s.cout) === '' ? 0 : nombre(s.cout);
  if (!Number.isFinite(cout) || cout < 0 || cout > 100_000) e.cout = 'Coût en euros : nombre de 0 à 100 000.';
  const validation = texte(s.validation) as ValidationMode;
  if (!MODES_VALIDATION.includes(validation)) e.validation = 'Choisissez le mode de validation.';
  if (Object.keys(e).length) return { erreurs: e, formation: null };
  return {
    erreurs: e,
    formation: { id: code, nom, court, type, validite, duree, organisme, cout: Math.round(cout * 100) / 100, validation, archive: avant?.archive ?? null },
  };
}

export type ChampHabilitation = 'code' | 'nom' | 'detail' | 'prereqs' | 'medical' | 'validite' | 'signataire';
export type SaisieHabilitation = Partial<Record<ChampHabilitation, Saisie>>;

/**
 * Habilitation saisie, contrôlée. Prérequis : formations du catalogue en vigueur ; une habilitation archivée garde ses
 * prérequis déjà inscrits dont la formation a été archivée depuis (rétablie, elle les exigera de nouveau : voir
 * `prerequisArchives`). Une habilitation en vigueur n'exige jamais une formation archivée, que nul ne pourrait obtenir.
 */
export function controlerHabilitation(
  s: SaisieHabilitation, existantes: readonly HabType[], formations: readonly Formation[], id: string | null = null,
): { erreurs: Erreurs<ChampHabilitation>; habilitation: HabType | null } {
  const e: Erreurs<ChampHabilitation> = {};
  const avant = id ? existantes.find(h => h.id === id) ?? null : null;
  const code = avant ? avant.id : codeTitre(s.code);
  if (!avant) codeNouveau(e, code, existantes.map(h => h.id), { motif: CODE_TITRE, aide: 'Code : lettres minuscules sans accent, chiffres, « - » ou « _ » (32 caractères au plus).', nature: 'une habilitation' });
  const nom = texte(s.nom), detail = texte(s.detail), signataire = texte(s.signataire);
  texteRequis(e, 'nom', nom, 120, 'Indiquez l’intitulé de l’habilitation.');
  if (!e.nom && existantes.some(h => h.id !== code && actif(h) && key(h.nom) === key(nom))) e.nom = 'Une habilitation du référentiel porte déjà cet intitulé.';
  texteFacultatif(e, 'detail', detail, 120);
  const liste = Array.isArray(s.prereqs) ? s.prereqs : [];
  if (s.prereqs != null && !Array.isArray(s.prereqs)) e.prereqs = 'Liste de formations attendue.';
  const prereqs = [...new Set(liste.map(codeTitre))];
  const permis = (f: string) => formations.some(x => x.id === f && (actif(x) || (!!avant && !actif(avant) && avant.prereqs.includes(f))));
  const inconnus = prereqs.filter(f => !permis(f));
  if (inconnus.length) e.prereqs = `Formation inconnue ou archivée : ${inconnus.join(', ')}.`;
  const validite = validiteMois(e, s.validite);
  texteRequis(e, 'signataire', signataire, 80, 'Indiquez le signataire proposé par défaut (employeur).');
  if (Object.keys(e).length) return { erreurs: e, habilitation: null };
  return { erreurs: e, habilitation: { id: code, nom, detail, prereqs, medical: s.medical === true || s.medical === 'true', validite, signataire, archive: avant?.archive ?? null } };
}

export type ChampDestination = 'code' | 'pays' | 'visa' | 'visaSub' | 'oblig' | 'rec' | 'passMois' | 'secu';
export type SaisieDestination = Partial<Record<ChampDestination, Saisie>>;

const vaccins = (v: Saisie): string[] => (Array.isArray(v) ? [...new Set(v.map(x => String(x)))] : []);
const estVaccin = (v: string): v is VaccinId => Object.hasOwn(VACCINS, v);

/** Destination saisie, contrôlée. Le DTP, toujours recommandé, ne se déclare pas ; un vaccin est obligatoire ou recommandé. */
export function controlerDestination(s: SaisieDestination, existantes: readonly Destination[], code0: string | null = null): { erreurs: Erreurs<ChampDestination>; destination: Destination | null } {
  const e: Erreurs<ChampDestination> = {};
  const avant = code0 ? existantes.find(d => d.code === code0) ?? null : null;
  const code = avant ? avant.code : codeDestination(s.code);
  if (!avant) {
    if (code === 'FR') e.code = 'La France n’est pas une destination à l’étranger.';
    else codeNouveau(e, code, existantes.map(d => d.code), { motif: CODE_PAYS, aide: 'Code pays à deux lettres (ISO 3166) : MA, IN, US…', nature: 'une destination' });
  }
  const pays = texte(s.pays), visaSub = texte(s.visaSub);
  texteRequis(e, 'pays', pays, 60, 'Indiquez le pays.');
  if (!e.pays && existantes.some(d => d.code !== code && actif(d) && key(d.pays) === key(pays))) e.pays = 'Une destination du référentiel porte déjà ce nom.';
  const visa = texte(s.visa) as VisaKind;
  if (!Object.hasOwn(VISA_RULES, visa)) e.visa = 'Choisissez la formalité d’entrée.';
  texteFacultatif(e, 'visaSub', visaSub, 80);
  const oblig = vaccins(s.oblig), rec = vaccins(s.rec);
  if ((s.oblig != null && !Array.isArray(s.oblig)) || oblig.some(v => !estVaccin(v))) e.oblig = 'Vaccin inconnu.';
  if ((s.rec != null && !Array.isArray(s.rec)) || rec.some(v => !estVaccin(v))) e.rec = 'Vaccin inconnu.';
  else if (rec.includes(VACCIN_TOUJOURS_RECOMMANDE)) e.rec = `${VACCINS[VACCIN_TOUJOURS_RECOMMANDE].court} : toujours recommandé, inutile de le déclarer.`;
  else if (rec.some(v => oblig.includes(v))) e.rec = 'Un vaccin est soit obligatoire, soit recommandé.';
  const passMois = texte(s.passMois) === '' ? 0 : nombre(s.passMois);
  if (!Number.isInteger(passMois) || passMois < 0 || passMois > PASSEPORT_MOIS_MAX) e.passMois = `Nombre entier de mois, de 0 à ${PASSEPORT_MOIS_MAX}.`;
  // Sécurité sociale : vide, déduite du code pays (secuDe).
  const secu = texte(s.secu);
  if (secu && !Object.hasOwn(SECU_RULES, secu)) e.secu = 'Formalité de sécurité sociale inconnue.';
  if (Object.keys(e).length) return { erreurs: e, destination: null };
  return {
    erreurs: e,
    destination: {
      code, pays, visa, visaSub, oblig: oblig as VaccinId[], rec: rec as VaccinId[], passMois, secu: (secu || null) as SecuDetachement | null,
      archive: avant?.archive ?? null,
    },
  };
}

/** Première erreur d'un contrôle (refus du serveur). */
export const premiereErreur = (e: Partial<Record<string, string>>): string | null => Object.values(e).find(Boolean) ?? null;

// — Effet d'une modification sur les titres détenus —

/** Titre dont la validité change avec la modification : salarié, intitulé du titre. */
export interface TitreTouche { empId: number; nom: string; titre: string }
export interface EffetModification {
  /** Titres valides (ou à renouveler) qui deviennent échus ou non valides. */
  echus: TitreTouche[];
  /** Titres non valides qui redeviennent valides. */
  retablis: TitreTouche[];
}

/**
 * Titres dont le statut change si l'élément modifié remplace l'actuel : certifications de la formation et habilitations
 * qui l'exigent en prérequis, ou titres de l'habilitation. Comparés sur les collaborateurs de l'instantané, aujourd'hui.
 */
export function effetModification(ds: Dataset, ref: 'formations', element: Formation): EffetModification;
export function effetModification(ds: Dataset, ref: 'habilitations', element: HabType): EffetModification;
export function effetModification(ds: Dataset, ref: 'formations' | 'habilitations', element: Formation | HabType): EffetModification {
  const liste = ds.referentiels[ref] as (Formation | HabType)[];
  if (!liste.some(x => x.id === element.id)) return { echus: [], retablis: [] };
  const remplace = liste.map(x => (x.id === element.id ? element : x));
  const avant = new Domain(ds), apres = new Domain({ ...ds, referentiels: { ...ds.referentiels, [ref]: remplace } });
  const horizon = ds.settings.horizonAlerte;
  const titres = (d: Domain) => new Map(d.enrich(horizon, false).flatMap(e => titresDe(e, ref, element.id)));
  const a = titres(avant), b = titres(apres);
  const out: EffetModification = { echus: [], retablis: [] };
  for (const [cle, t] of b) {
    const ok = a.get(cle)?.valide;
    if (ok === true && !t.valide) out.echus.push(t.titre);
    if (ok === false && t.valide) out.retablis.push(t.titre);
  }
  return out;
}

/** Titres d'un collaborateur touchés par l'élément : certification de la formation, habilitations concernées. */
function titresDe(e: EmpX, ref: 'formations' | 'habilitations', id: string): [string, { valide: boolean; titre: TitreTouche }][] {
  const out: [string, { valide: boolean; titre: TitreTouche }][] = [];
  if (ref === 'formations') {
    for (const c of e.rawCerts.filter(c => c.f === id)) out.push([`c${e.id}-${c.f}`, { valide: c.key !== 'exp', titre: { empId: e.id, nom: e.nom, titre: c.fm.court } }]);
  }
  for (const h of e.habs) {
    if (!h.delivree || (ref === 'habilitations' ? h.h !== id : !h.hm.prereqs.includes(id))) continue;
    out.push([`h${e.id}-${h.h}`, { valide: h.key === 'ok' || h.key === 'due', titre: { empId: e.id, nom: e.nom, titre: h.hm.nom } }]);
  }
  return out;
}

/** « Camille Roux (SST), Hugo Lambert (SST) et 3 autres » : les premiers titres touchés, nommés. */
export function titresTexte(liste: readonly TitreTouche[], max = 4): string {
  const noms = liste.slice(0, max).map(t => `${t.nom} (${t.titre})`);
  const reste = liste.length - noms.length;
  return reste > 0 ? `${noms.join(', ')} et ${reste} autre${reste > 1 ? 's' : ''}` : noms.join(', ').replace(/, ([^,]*)$/, ' et $1');
}
