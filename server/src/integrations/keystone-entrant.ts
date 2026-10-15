// API entrante de Keystone : contrôle et enregistrement des projets, chantiers, affectations,
// tâches planifiées et demandes de déplacement (routes : keystone-routes.ts, contrat : docs/API-KEYSTONE.md).
// Chaque objet porte son identifiant Keystone : un nouvel envoi le met à jour (idempotence).
// Les salariés sont désignés par leur matricule, `matricule()` de shared/format.ts : aujourd'hui dérivé
// de l'identifiant interne (EMP-0001), il deviendra le matricule de paie (tâche distincte), sans autre
// changement ici que la correspondance de `contexte()`. Le jeu de démonstration passe par ces mêmes fonctions (seed.ts).
import { ACTIVITES_INTERNES } from '../../../shared/constants.ts';
import { isValidDate, iso, parse } from '../../../shared/dates.ts';
import { matricule, plural } from '../../../shared/format.ts';
import type { Chantier, DemandeKeystone, DemandeStatut, Destination, ISODate, Mission, Projet, StatutKeystone, TacheKeystone, Voyage } from '../../../shared/types.ts';
import type { Db } from '../db.ts';

/** Champ refusé : chemin (`debut`, `chantiers[2].fin`, `heures.2026-10-12`) et explication. */
export interface ErreurChamp { champ: string; message: string }

/** Refus d'un appel entrant : statut HTTP, code stable (docs/API-KEYSTONE.md), détail des champs. */
export class ErreurKeystone extends Error {
  status: number;
  code: string;
  details: ErreurChamp[];
  extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details: ErreurChamp[] = [], extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.extra = extra;
  }
}

/** Erreurs de champs accumulées ; `verifier()` lève le refus 400 s'il y en a (seuls les noms de champs vont au message). */
export class Erreurs {
  liste: ErreurChamp[] = [];
  add(champ: string, message: string) { this.liste.push({ champ, message }); }
  verifier() {
    if (!this.liste.length) return;
    throw new ErreurKeystone(400, 'VALIDATION', `Données invalides : ${[...new Set(this.liste.map(x => x.champ))].join(', ')}`, this.liste);
  }
}

export type Resultat = 'cree' | 'modifie' | 'inchange';
export interface Ecriture<T> { resultat: Resultat; objet: T }

/** Date « AAAA-MM-JJ » qui existe au calendrier (2026-02-31 est refusée). */
export const dateReelle = (s: unknown): s is ISODate => typeof s === 'string' && isValidDate(s) && iso(parse(s)) === s;

/** Identifiant Keystone : 1 à 64 caractères sûrs dans une URL. */
export const IDENTIFIANT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const IDENTIFIANT_AIDE = 'Identifiant invalide : 1 à 64 caractères, lettres, chiffres, « . », « _ », « : » ou « - »';

type Entree = Record<string, unknown>;
const estObjet = (v: unknown): v is Entree => !!v && typeof v === 'object' && !Array.isArray(v);

/** Référentiels lus une fois par appel : salariés par matricule, habilitations, formations, destinations. */
export interface Contexte {
  db: Db;
  salaries: Map<string, { id: number; fin: ISODate | null }>;
  habilitations: Set<string>;
  formations: Set<string>;
  destinations: Map<string, string>;
}

export function contexte(db: Db): Contexte {
  return {
    db,
    // Point unique de correspondance matricule → salarié (matricule de paie à venir).
    salaries: new Map(db.all<{ id: number; fin: ISODate | null }>('employes').map(e => [matricule(e.id), { id: e.id, fin: e.fin }])),
    habilitations: new Set(db.all<{ id: string }>('habilitations').map(h => h.id)),
    formations: new Set(db.all<{ id: string }>('formations').map(f => f.id)),
    destinations: new Map(db.all<Destination>('destinations').map(d => [d.code, d.pays])),
  };
}

/** Lecture contrôlée d'un objet reçu : chaque problème est noté avec le chemin du champ. */
class Lecture {
  o: Entree;
  err: Erreurs;
  prefixe: string;
  constructor(o: Entree, err: Erreurs, prefixe: string) {
    this.o = o;
    this.err = err;
    this.prefixe = prefixe;
  }
  chemin(champ: string) { return this.prefixe ? `${this.prefixe}.${champ}` : champ; }
  faute(champ: string, message: string) { this.err.add(this.chemin(champ), message); }

  texte(champ: string, max = 120, requis = true): string {
    const v = this.o[champ];
    if (v == null || v === '') { if (requis) this.faute(champ, 'Champ obligatoire'); return ''; }
    if (typeof v !== 'string') { this.faute(champ, 'Texte attendu'); return ''; }
    const t = v.trim();
    if (!t && requis) this.faute(champ, 'Champ obligatoire');
    else if (t.length > max) this.faute(champ, `${max} caractères au plus`);
    return t;
  }

  /** Identifiant d'une ressource ; `chemin` : celui de l'URL, que le corps peut répéter sans le contredire. */
  identifiant(champ: string, chemin?: string): string {
    const v = this.o[champ];
    if (chemin !== undefined) {
      if (v !== undefined && v !== chemin) this.faute(champ, 'Différent de l’identifiant de l’URL');
      if (!IDENTIFIANT.test(chemin)) this.faute(champ, IDENTIFIANT_AIDE);
      return chemin;
    }
    if (typeof v !== 'string' || !IDENTIFIANT.test(v)) { this.faute(champ, v == null ? 'Champ obligatoire' : IDENTIFIANT_AIDE); return ''; }
    return v;
  }

  date(champ: string): ISODate {
    const v = this.o[champ];
    if (v == null || v === '') { this.faute(champ, 'Champ obligatoire'); return ''; }
    if (!dateReelle(v)) { this.faute(champ, 'Date invalide (AAAA-MM-JJ, date existante)'); return ''; }
    return v;
  }

  /** Deux dates ordonnées (`fin` le même jour que `debut` au plus tôt). */
  periode(debut: string, fin: string): [ISODate, ISODate] {
    const a = this.date(debut), b = this.date(fin);
    if (a && b && b < a) this.faute(fin, `Antérieure à ${debut}`);
    return [a, b];
  }

  /** Liste de codes d'un référentiel de Cursus (doublons ignorés). */
  codes(champ: string, connus: Set<string>, nature: string): string[] {
    const v = this.o[champ];
    if (v == null) return [];
    if (!Array.isArray(v)) { this.faute(champ, 'Liste de codes attendue'); return []; }
    v.forEach((c, i) => {
      if (typeof c !== 'string' || !connus.has(c)) this.faute(`${champ}[${i}]`, `${nature} inconnue du référentiel de Cursus (voir GET /referentiels)`);
    });
    return [...new Set(v.filter((c): c is string => typeof c === 'string'))];
  }

  statut(champ: string): StatutKeystone {
    const v = this.o[champ] ?? 'actif';
    if (v !== 'actif' && v !== 'archive') { this.faute(champ, 'Valeur attendue : « actif » ou « archive »'); return 'actif'; }
    return v;
  }

  salarie(cx: Contexte, champ: string): number | null {
    const m = this.texte(champ, 32);
    if (!m) return null;
    const s = cx.salaries.get(m);
    if (!s) this.faute(champ, 'Matricule inconnu de Cursus');
    return s?.id ?? null;
  }
}

/** Ouvre la lecture d'un objet reçu (`null` si ce n'est pas un objet JSON). */
function lecture(body: unknown, err: Erreurs, prefixe: string): Lecture | null {
  if (estObjet(body)) return new Lecture(body, err, prefixe);
  err.add(prefixe || 'corps', 'Objet JSON attendu');
  return null;
}

const egal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// — Projets —

export interface ProjetApi { code: string; nom: string; statut: StatutKeystone }
const projetApi = (p: Projet): ProjetApi => ({ code: p.code, nom: p.nom, statut: p.statut ?? 'actif' });

function ecrireProjet(cx: Contexte, code: string | undefined, body: unknown, err: Erreurs, prefixe = ''): Ecriture<ProjetApi> | null {
  const l = lecture(body, err, prefixe);
  if (!l) return null;
  const n = err.liste.length;
  const id = l.identifiant('code', code);
  const val = { nom: l.texte('nom'), statut: l.statut('statut') };
  if (err.liste.length > n) return null;
  const ex = cx.db.get<Projet>('projets', id);
  if (!ex) return { resultat: 'cree', objet: projetApi(cx.db.insert<Projet>('projets', { code: id, ...val })) };
  if (ex.nom === val.nom && (ex.statut ?? 'actif') === val.statut) return { resultat: 'inchange', objet: projetApi(ex) };
  return { resultat: 'modifie', objet: projetApi(cx.db.update<Projet>('projets', id, val)) };
}

/** Crée ou met à jour un projet (code Keystone) : les heures s'y imputent dans les feuilles de temps. */
export function enregistrerProjet(cx: Contexte, code: string | undefined, body: unknown): Ecriture<ProjetApi> {
  const err = new Erreurs();
  const r = ecrireProjet(cx, code, body, err);
  err.verifier();
  return r!;
}

// — Chantiers —

export interface ChantierApi {
  id: string; nom: string; client: string; lieu: string; pays: string; debut: ISODate; fin: ISODate; chef: string;
  habilitations: string[]; certifications: string[]; statut: StatutKeystone; ressources: string[];
}
const chantierApi = (c: Chantier): ChantierApi => ({
  id: c.id, nom: c.nom, client: c.client, lieu: c.lieu, pays: c.pays, debut: c.debut, fin: c.fin, chef: c.chef,
  habilitations: c.habs, certifications: c.certs, statut: c.statut ?? 'actif', ressources: c.ressources.map(matricule),
});

/** Lieu et nature d'une mission sur un chantier : « Tanger, Maroc » et déplacement international hors de France. */
function lieuMission(cx: Contexte, c: Pick<Chantier, 'lieu' | 'pays'>) {
  return c.pays === 'FR'
    ? { lieu: c.lieu, type: 'Mission' }
    : { lieu: `${c.lieu}, ${cx.destinations.get(c.pays) ?? c.pays}`, type: 'Déplacement international' };
}

/**
 * Ressources du chantier : salariés dont une affectation chevauche ses dates, dans l'ordre d'arrivée.
 * Une affectation hors de ces dates (repérage, préparation) reste une mission sans entrer dans le Go / No Go,
 * évalué sur les dates du chantier.
 */
export function recalculerRessources(db: Db, chantierId: string) {
  const c = db.get<Chantier>('chantiers', chantierId);
  if (!c) return;
  const ids = db.where<Mission>('missions', 'projet', chantierId)
    .filter(m => m.du <= c.fin && m.au >= c.debut)
    .sort((a, b) => a.du.localeCompare(b.du) || a.id - b.id)
    .map(m => m.empId);
  const ressources = [...new Set(ids)];
  if (!egal(ressources, c.ressources)) db.update<Chantier>('chantiers', chantierId, { ressources });
}

function ecrireChantier(cx: Contexte, id: string | undefined, body: unknown, err: Erreurs, prefixe = ''): Ecriture<ChantierApi> | null {
  const l = lecture(body, err, prefixe);
  if (!l) return null;
  const n = err.liste.length;
  const cid = l.identifiant('id', id);
  const [debut, fin] = l.periode('debut', 'fin');
  const pays = l.texte('pays', 8);
  if (pays && !/^[A-Z]{2}$/.test(pays)) l.faute('pays', 'Code pays ISO 3166-1 de deux lettres majuscules attendu (FR, MA…)');
  const val = {
    nom: l.texte('nom'), client: l.texte('client', 120, false), lieu: l.texte('lieu'), pays, debut, fin, chef: l.texte('chef', 120, false),
    habs: l.codes('habilitations', cx.habilitations, 'Habilitation'), certs: l.codes('certifications', cx.formations, 'Certification'),
    statut: l.statut('statut'),
  };
  if (err.liste.length > n) return null;
  const ex = cx.db.get<Chantier>('chantiers', cid);
  let resultat: Resultat = 'modifie';
  if (!ex) {
    cx.db.insert<Chantier>('chantiers', { id: cid, ...val, ressources: [] });
    resultat = 'cree';
  } else if ((Object.keys(val) as (keyof typeof val)[]).every(k => egal(val[k], k === 'statut' ? ex.statut ?? 'actif' : ex[k]))) {
    resultat = 'inchange';
  } else {
    cx.db.update<Chantier>('chantiers', cid, val);
    // Les missions du chantier suivent son lieu ; ses ressources, ses dates.
    if (ex.lieu !== val.lieu || ex.pays !== val.pays) {
      const m = lieuMission(cx, val);
      cx.db.sql.prepare('UPDATE missions SET lieu = ?, type = ? WHERE projet = ?').run(m.lieu, m.type, cid);
    }
  }
  if (resultat !== 'inchange') recalculerRessources(cx.db, cid);
  return { resultat, objet: chantierApi(cx.db.get<Chantier>('chantiers', cid)!) };
}

/**
 * Crée ou met à jour un chantier (identifiant Keystone) : exigences du Go / No Go (habilitations, certifications),
 * dates, statut. Archivé, il n'est plus évalué ; ses missions restent en historique.
 */
export function enregistrerChantier(cx: Contexte, id: string | undefined, body: unknown): Ecriture<ChantierApi> {
  const err = new Erreurs();
  const r = ecrireChantier(cx, id, body, err);
  err.verifier();
  return r!;
}

// — Affectations (missions) —

export interface AffectationApi { id: string; matricule: string; chantier: string; du: ISODate; au: ISODate; ressource: boolean }

function affectationApi(db: Db, m: Mission): AffectationApi {
  const c = db.get<Chantier>('chantiers', m.projet);
  return { id: m.ref!, matricule: matricule(m.empId), chantier: m.projet, du: m.du, au: m.au, ressource: !!c && m.du <= c.fin && m.au >= c.debut };
}

const missionKeystone = (db: Db, ref: string) => db.where<Mission>('missions', 'ref', ref)[0];

function ecrireAffectation(cx: Contexte, id: string | undefined, body: unknown, err: Erreurs, prefixe = ''): Ecriture<AffectationApi> | null {
  const l = lecture(body, err, prefixe);
  if (!l) return null;
  const n = err.liste.length;
  const ref = l.identifiant('id', id);
  const empId = l.salarie(cx, 'matricule');
  const chantierId = l.texte('chantier', 64);
  const c = chantierId ? cx.db.get<Chantier>('chantiers', chantierId) : undefined;
  if (chantierId && !c) l.faute('chantier', 'Chantier inconnu : transmettez-le d’abord (PUT /chantiers/{id})');
  const [du, au] = l.periode('du', 'au');
  if (err.liste.length > n || !c || empId == null) return null;
  const val = { empId, projet: c.id, du, au, ...lieuMission(cx, c), ref };
  const ex = missionKeystone(cx.db, ref);
  if (!ex) {
    const m = cx.db.insert<Mission>('missions', val);
    recalculerRessources(cx.db, c.id);
    return { resultat: 'cree', objet: affectationApi(cx.db, m) };
  }
  if (ex.empId === val.empId && ex.projet === val.projet && ex.du === du && ex.au === au && ex.lieu === val.lieu && ex.type === val.type) {
    return { resultat: 'inchange', objet: affectationApi(cx.db, ex) };
  }
  const m = cx.db.update<Mission>('missions', ex.id, val);
  recalculerRessources(cx.db, c.id);
  if (ex.projet !== c.id) recalculerRessources(cx.db, ex.projet);
  return { resultat: 'modifie', objet: affectationApi(cx.db, m) };
}

/** Crée ou met à jour une affectation : mission du salarié et, si elle chevauche les dates du chantier, ressource du Go / No Go. */
export function enregistrerAffectation(cx: Contexte, id: string | undefined, body: unknown): Ecriture<AffectationApi> {
  const err = new Erreurs();
  const r = ecrireAffectation(cx, id, body, err);
  err.verifier();
  return r!;
}

export function supprimerAffectation(db: Db, ref: string) {
  const m = missionKeystone(db, ref);
  if (!m) throw new ErreurKeystone(404, 'AFFECTATION_INCONNUE', 'Affectation inconnue (déjà supprimée ou jamais reçue)');
  db.remove('missions', m.id);
  recalculerRessources(db, m.projet);
}

// — Tâches planifiées —

export interface TacheApi { id: string; projet: string; tache: string; matricule: string; debut: ISODate; fin: ISODate; heures: Record<ISODate, number> }
const tacheApi = (t: TacheKeystone): TacheApi => ({ id: t.ref!, projet: t.projet, tache: t.tache, matricule: matricule(t.empId), debut: t.debut, fin: t.fin, heures: t.heures });
const tacheKeystone = (db: Db, ref: string) => db.where<TacheKeystone>('taches', 'ref', ref)[0];

/** Heures planifiées par date : { "AAAA-MM-JJ": heures }, entre les dates de la tâche ; les jours à 0 sont omis. */
function lireHeures(l: Lecture, debut: ISODate, fin: ISODate): Record<ISODate, number> {
  const v = l.o.heures;
  if (v == null) { l.faute('heures', 'Champ obligatoire'); return {}; }
  if (!estObjet(v)) { l.faute('heures', 'Objet attendu : { "AAAA-MM-JJ": heures }'); return {}; }
  const out: Record<ISODate, number> = {};
  for (const [jour, h] of Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) {
    const champ = `heures.${jour}`;
    if (!dateReelle(jour)) l.faute(champ, 'Date invalide (AAAA-MM-JJ, date existante)');
    else if (debut && fin && (jour < debut || jour > fin)) l.faute(champ, 'Date en dehors de la tâche (debut → fin)');
    else if (typeof h !== 'number' || !Number.isFinite(h) || h < 0 || h > 24) l.faute(champ, 'Nombre d’heures entre 0 et 24 attendu');
    else if (h > 0) out[jour] = Math.round(h * 100) / 100;
  }
  return out;
}

function ecrireTache(cx: Contexte, id: string | undefined, body: unknown, err: Erreurs, prefixe = ''): Ecriture<TacheApi> | null {
  const l = lecture(body, err, prefixe);
  if (!l) return null;
  const n = err.liste.length;
  const ref = l.identifiant('id', id);
  const projet = l.texte('projet', 64);
  if (projet && !cx.db.get<Projet>('projets', projet)) l.faute('projet', 'Projet inconnu : transmettez-le d’abord (PUT /projets/{code})');
  const tache = l.texte('tache', 160);
  const empId = l.salarie(cx, 'matricule');
  const [debut, fin] = l.periode('debut', 'fin');
  const heures = lireHeures(l, debut, fin);
  if (err.liste.length > n || empId == null) return null;
  const val = { ref, empId, projet, tache, debut, fin, heures };
  const ex = tacheKeystone(cx.db, ref);
  if (!ex) return { resultat: 'cree', objet: tacheApi(cx.db.insert<TacheKeystone>('taches', val)) };
  if (ex.empId === empId && ex.projet === projet && ex.tache === tache && ex.debut === debut && ex.fin === fin && egal(ex.heures, heures)) {
    return { resultat: 'inchange', objet: tacheApi(ex) };
  }
  return { resultat: 'modifie', objet: tacheApi(cx.db.update<TacheKeystone>('taches', ex.id, val)) };
}

/** Crée ou met à jour une tâche planifiée : proposée dans la feuille de temps des semaines où des heures sont prévues. */
export function enregistrerTache(cx: Contexte, id: string | undefined, body: unknown): Ecriture<TacheApi> {
  const err = new Erreurs();
  const r = ecrireTache(cx, id, body, err);
  err.verifier();
  return r!;
}

export function supprimerTache(db: Db, ref: string) {
  const t = tacheKeystone(db, ref);
  if (!t) throw new ErreurKeystone(404, 'TACHE_INCONNUE', 'Tâche inconnue (déjà supprimée ou jamais reçue)');
  db.remove('taches', t.id);
}

// — Synchronisation complète (instantané) —

export interface BilanSection { crees: number; modifies: number; inchanges: number; archives?: number; supprimes?: number }
export type Bilan = Partial<Record<'projets' | 'chantiers' | 'affectations' | 'taches', BilanSection>>;

/**
 * Instantané : état complet des sections transmises (projets, chantiers, affectations, tâches), appliqué
 * en une transaction, tout ou rien. Chaque objet est créé ou mis à jour ; un projet (hors activités internes)
 * ou un chantier absent est archivé (jamais supprimé : feuilles et historique s'y réfèrent), une affectation
 * ou une tâche absente est supprimée — seulement si elle se termine à partir de `depuis`, quand cette date est fournie.
 * Une section omise n'est pas touchée. Les missions sans identifiant Keystone (bases antérieures) restent.
 */
export function synchroniser(cx: Contexte, body: unknown): Bilan {
  const err = new Erreurs();
  if (!estObjet(body)) { err.add('corps', 'Objet JSON attendu'); err.verifier(); }
  const o = body as Entree;
  let depuis: ISODate | null = null;
  if (o.depuis != null) {
    if (dateReelle(o.depuis)) depuis = o.depuis;
    else err.add('depuis', 'Date invalide (AAAA-MM-JJ, date existante)');
  }
  const SECTIONS = ['projets', 'chantiers', 'affectations', 'taches'] as const;
  if (!SECTIONS.some(s => o[s] !== undefined)) err.add('corps', 'Aucune section : projets, chantiers, affectations ou taches');
  const listes: Partial<Record<typeof SECTIONS[number], unknown[]>> = {};
  for (const s of SECTIONS) {
    if (o[s] === undefined) continue;
    if (Array.isArray(o[s])) listes[s] = o[s];
    else err.add(s, 'Liste attendue');
  }
  err.verifier();

  const bilan: Bilan = {};
  const db = cx.db;
  /** Applique une section : identifiants uniques, puis écriture objet par objet (les erreurs s'accumulent). */
  const section = <T>(nom: typeof SECTIONS[number], cle: 'id' | 'code', ecrire: (cx: Contexte, id: undefined, item: unknown, err: Erreurs, prefixe: string) => Ecriture<T> | null) => {
    const items = listes[nom];
    if (!items) return null;
    const b: BilanSection = { crees: 0, modifies: 0, inchanges: 0 };
    const vus = new Set<string>();
    items.forEach((item, i) => {
      const id = estObjet(item) ? item[cle] : undefined;
      if (typeof id === 'string' && vus.has(id)) { err.add(`${nom}[${i}].${cle}`, 'Identifiant en double dans l’instantané'); return; }
      if (typeof id === 'string') vus.add(id);
      const r = ecrire(cx, undefined, item, err, `${nom}[${i}]`);
      if (r) b[r.resultat === 'cree' ? 'crees' : r.resultat === 'modifie' ? 'modifies' : 'inchanges']++;
    });
    bilan[nom] = b;
    return { b, vus };
  };

  const projets = section('projets', 'code', ecrireProjet);
  if (projets) {
    projets.b.archives = 0;
    // Activités internes (INT-*) et cours en CFA (ECOLE) : imputables, mais pas des projets Keystone ;
    // un instantané qui les omet ne les archive pas (PUT /projets/{code} avec « archive » pour en clore une).
    for (const p of db.all<Projet>('projets')) {
      if (p.statut === 'archive' || projets.vus.has(p.code) || ACTIVITES_INTERNES.test(p.code)) continue;
      db.update<Projet>('projets', p.code, { statut: 'archive' });
      projets.b.archives++;
    }
  }
  const chantiers = section('chantiers', 'id', ecrireChantier);
  if (chantiers) {
    chantiers.b.archives = 0;
    for (const c of db.all<Chantier>('chantiers')) {
      if (c.statut !== 'archive' && !chantiers.vus.has(c.id)) { db.update<Chantier>('chantiers', c.id, { statut: 'archive' }); chantiers.b.archives++; }
    }
  }
  const affectations = section('affectations', 'id', ecrireAffectation);
  if (affectations) {
    affectations.b.supprimes = 0;
    const touches = new Set<string>();
    for (const m of db.all<Mission>('missions')) {
      if (!m.ref || affectations.vus.has(m.ref) || (depuis && m.au < depuis)) continue;
      db.remove('missions', m.id);
      touches.add(m.projet);
      affectations.b.supprimes++;
    }
    touches.forEach(id => recalculerRessources(db, id));
  }
  const taches = section('taches', 'id', ecrireTache);
  if (taches) {
    taches.b.supprimes = 0;
    for (const t of db.all<TacheKeystone>('taches')) {
      if (!t.ref || taches.vus.has(t.ref) || (depuis && t.fin < depuis)) continue;
      db.remove('taches', t.id);
      taches.b.supprimes++;
    }
  }
  // Une erreur annule tout l'instantané (transaction de l'appelant).
  err.verifier();
  return bilan;
}

/** Résumé d'un bilan pour le journal : « 3 chantiers créés · 1 archivé… ». */
export function bilanTexte(b: Bilan): string {
  const parts: string[] = [];
  for (const [nom, s] of Object.entries(b) as [string, BilanSection][]) {
    parts.push(`${nom} : ${plural(s.crees + s.modifies + s.inchanges, 'reçu', 'reçus')}, ${plural(s.crees, 'créé', 'créés')}, ${plural(s.modifies, 'modifié', 'modifiés')}`
      + (s.archives != null ? `, ${plural(s.archives, 'archivé', 'archivés')}` : '') + (s.supprimes != null ? `, ${plural(s.supprimes, 'supprimé', 'supprimés')}` : ''));
  }
  return parts.join(' · ');
}

// — Demandes de déplacement —

/** Statut d'une demande dans l'API (l'ancienne route renvoyait déjà « en_attente_rh »). */
const STATUT_DEMANDE: Record<DemandeStatut, string> = { attente: 'en_attente_rh', acceptee: 'acceptee', refusee: 'refusee' };

export function demandeApi(dm: DemandeKeystone) {
  return {
    id: dm.id, reference: dm.ref, matricule: matricule(dm.empId), chantier: dm.chantier, destination: dm.dest,
    depart: dm.depart, retour: dm.retour, statut: STATUT_DEMANDE[dm.statut ?? 'attente'], recue: dm.recue, decidee: dm.decidee,
  };
}

type DemandeContenu = Pick<DemandeKeystone, 'empId' | 'chantier' | 'dest' | 'depart' | 'retour'>;

/**
 * Contrôles métier d'une demande, à la réception comme à l'acceptation par le RH : chantier actif,
 * destination du pays du chantier, salarié présent dans les effectifs et affecté au chantier sur ces dates
 * (affectation Keystone), déplacement non terminé.
 */
export function controlesDemande(cx: Contexte, x: DemandeContenu, today: ISODate): ErreurChamp[] {
  const out: ErreurChamp[] = [];
  const c = cx.db.get<Chantier>('chantiers', x.chantier);
  if (!c) out.push({ champ: 'chantier', message: 'Chantier inconnu' });
  else if (c.statut === 'archive') out.push({ champ: 'chantier', message: 'Chantier archivé dans Keystone' });
  if (!cx.destinations.has(x.dest)) out.push({ champ: 'destination', message: 'Destination hors du référentiel de Cursus (voir GET /referentiels)' });
  else if (c && c.pays !== x.dest) out.push({ champ: 'destination', message: 'Destination différente du pays du chantier' });
  if (x.retour < today) out.push({ champ: 'retour', message: 'Déplacement déjà terminé' });
  const fin = [...cx.salaries.values()].find(s => s.id === x.empId)?.fin;
  if (fin && fin < x.depart) out.push({ champ: 'matricule', message: 'Salarié sorti des effectifs avant le départ' });
  const affecte = cx.db.where<Mission>('missions', 'empId', x.empId).some(m => m.projet === x.chantier && m.du <= x.retour && m.au >= x.depart);
  if (c && !affecte) out.push({ champ: 'matricule', message: 'Salarié non affecté au chantier sur ces dates (affectation Keystone requise)' });
  return out;
}

/**
 * Reçoit une demande de déplacement. La référence externe (`reference`) est unique : un nouvel envoi
 * de la même référence, ou d'une demande identique encore en attente, reçoit 409 avec la demande existante.
 * `referenceRequise` : vrai pour l'API v1 ; l'ancienne route l'accepte facultative.
 */
export function recevoirDemande(cx: Contexte, body: unknown, today: ISODate, referenceRequise: boolean): DemandeKeystone {
  const err = new Erreurs();
  const l = lecture(body, err, '');
  if (!l) throw new ErreurKeystone(400, 'VALIDATION', 'Données invalides : corps', err.liste);
  const ref = referenceRequise || l.o.reference != null ? l.identifiant('reference') : null;
  if (ref) {
    const ex = cx.db.where<DemandeKeystone>('demandesKeystone', 'ref', ref)[0];
    if (ex) throw new ErreurKeystone(409, 'DEMANDE_EN_DOUBLE', 'Demande déjà reçue sous cette référence', [], { demande: demandeApi(ex) });
  }
  const empId = l.salarie(cx, 'matricule');
  const chantier = l.texte('chantier', 64);
  const c = chantier ? cx.db.get<Chantier>('chantiers', chantier) : undefined;
  if (chantier && !c) l.faute('chantier', 'Chantier inconnu');
  // Destination : le pays du chantier par défaut.
  const dest = l.o.destination == null ? c?.pays ?? '' : l.texte('destination', 8);
  const [depart, retour] = l.periode('depart', 'retour');
  err.verifier();
  const x: DemandeContenu = { empId: empId!, chantier, dest, depart, retour };
  controlesDemande(cx, x, today).forEach(e => err.add(e.champ, e.message));
  err.verifier();
  const doublon = cx.db.where<DemandeKeystone>('demandesKeystone', 'empId', x.empId)
    .find(d => d.statut === 'attente' && d.chantier === x.chantier && d.depart === x.depart && d.retour === x.retour);
  if (doublon) throw new ErreurKeystone(409, 'DEMANDE_EN_DOUBLE', 'Demande identique déjà en attente de validation RH', [], { demande: demandeApi(doublon) });
  return cx.db.insert<DemandeKeystone>('demandesKeystone', { ...x, recue: today, ref, statut: 'attente', decidee: null, decideur: null, voyageId: null });
}

/**
 * Contrôles repris à l'acceptation d'une demande par le RH : la situation a pu changer depuis la réception
 * (affectation retirée, chantier archivé, départ du salarié…). Un déplacement déjà créé pour ce chantier
 * sur ces dates est aussi refusé. Renvoie les motifs de refus (liste vide : acceptable).
 */
export function motifsRefusAcceptation(db: Db, dm: DemandeKeystone, today: ISODate): string[] {
  const motifs = controlesDemande(contexte(db), dm, today).map(e => e.message);
  if (!db.where<{ id: number }>('employes', 'id', dm.empId).length) motifs.unshift('Salarié inconnu');
  const deja = db.where<Voyage>('voyages', 'empId', dm.empId).some(v => v.chantier === dm.chantier && v.depart <= dm.retour && v.retour >= dm.depart);
  if (deja) motifs.push('Un déplacement existe déjà pour ce chantier sur ces dates');
  return motifs;
}

// — Démarrage —

/**
 * Base existante : statuts par défaut des données antérieures à l'API, retrait des tâches sans dates
 * (anciennes données de démonstration recopiées chaque semaine), index d'unicité des identifiants Keystone.
 */
export function migrerKeystone(db: Db, avant: () => void = () => {}) {
  const q = (sql: string) => Number((db.sql.prepare(sql).get() as { n: number }).n);
  const aReprendre = q(`SELECT (SELECT COUNT(*) FROM projets WHERE statut IS NULL) + (SELECT COUNT(*) FROM chantiers WHERE statut IS NULL)
    + (SELECT COUNT(*) FROM demandes_keystone WHERE statut IS NULL) + (SELECT COUNT(*) FROM taches WHERE debut IS NULL) AS n`);
  if (aReprendre) {
    avant();
    const sansDates = q('SELECT COUNT(*) AS n FROM taches WHERE debut IS NULL');
    db.tx(() => {
      db.sql.exec(`UPDATE projets SET statut = 'actif' WHERE statut IS NULL;
        UPDATE chantiers SET statut = 'actif' WHERE statut IS NULL;
        UPDATE demandes_keystone SET statut = 'attente' WHERE statut IS NULL;
        DELETE FROM taches WHERE debut IS NULL;`);
    });
    if (sansDates) console.log(`Migration : ${plural(sansDates, 'tâche Keystone sans dates retirée', 'tâches Keystone sans dates retirées')} (Keystone transmet désormais des tâches datées).`);
  }
  db.sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS demandes_keystone_ref ON demandes_keystone (ref) WHERE ref IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS missions_ref ON missions (ref) WHERE ref IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS taches_ref ON taches (ref) WHERE ref IS NOT NULL;`);
}
