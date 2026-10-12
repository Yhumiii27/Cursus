// Sessions de formation : inscrits nominatifs et nombre d'inscrits (calculé, jamais stocké),
// contrôles de création et de modification, liste à transmettre à l'organisme, résultats de clôture.
import { iso, isValidDate, parse } from '../dates.ts';
import { sessionActive, type Domain } from '../domain.ts';
import { fmt, key } from '../format.ts';
import type { Certification, Formation, Inscription, ISODate, Participation, Session } from '../types.ts';

/** Formation validée sur évaluation réussie (catalogue) ; sinon la présence suffit. */
export const exigeEvaluation = (fm: Pick<Formation, 'validation'> | null | undefined) => fm?.validation === 'evaluation';

/**
 * Nombre d'inscrits de chaque session. Session ouverte : certifications rattachées (recyclages) et
 * inscriptions en formation initiale, une personne comptée une fois ; session clôturée : résultats
 * enregistrés ; session annulée : aucun.
 */
export function avecInscrits<S extends Omit<Session, 'inscrits'>>(
  sessions: S[], certs: Pick<Certification, 'empId' | 'sessionId'>[], inscriptions: Pick<Inscription, 'empId' | 'sessionId'>[],
  participations: Pick<Participation, 'sessionId'>[],
): (S & { inscrits: number })[] {
  return sessions.map(s => {
    if (s.statut === 'Annulée') return { ...s, inscrits: 0 };
    if (s.statut === 'Clôturée') return { ...s, inscrits: participations.filter(p => p.sessionId === s.id).length };
    const ids = new Set([...certs, ...inscriptions].filter(x => x.sessionId === s.id).map(x => x.empId));
    return { ...s, inscrits: ids.size };
  });
}

/** Inscrit d'une session ouverte, tel que le voit l'utilisateur (le manager : son équipe). */
export interface Inscrit {
  empId: number; nom: string; equipe: string | null; poste: string;
  /** Recyclage d'une certification détenue, ou formation initiale. */
  parcours: 'recyclage' | 'initiale';
  certId: number | null;
  inscriptionId: number | null;
  /** Recyclage : date d'obtention de la certification à renouveler. */
  obtenue: ISODate | null;
  convoc: 'now' | 'later' | null;
  /** Date d'envoi de la dernière convocation (e-mail avec fichier .ics). */
  convocLe: ISODate | null;
  /**
   * Recyclage déjà enregistré, daté du jour de la session ou après : rien à décider à la clôture. Un recyclage
   * antérieur à la session ne compte pas : la personne ne l'a pas suivie pour autant (la clôture le dira).
   */
  dejaObtenue: Certification | null;
}

/** `n` remplace `c` : même formation, enregistrée après (recyclage). */
const remplace = (n: Certification, c: Certification) => n.f === c.f && (n.obtenue > c.obtenue || (n.obtenue === c.obtenue && n.id > c.id));

/**
 * Certifications rattachées à une session dont la place n'a plus d'objet à cette date : un recyclage a été
 * enregistré avant (même règle que `cert.ajouter` et la migration). Un recyclage du jour même ou postérieur
 * garde l'inscrit : c'est la session qui l'a produit, sa clôture le constatera.
 */
export function placesRemplacees(d: Domain, sessionId: number, date: ISODate): { empId: number; c: Certification }[] {
  return d.ds.employes.flatMap(e => e.certs
    .filter(c => c.sessionId === sessionId && e.certs.some(n => remplace(n, c) && n.obtenue < date))
    .map(c => ({ empId: e.id, c })));
}

/** Inscrits nominatifs d'une session ouverte, par ordre alphabétique. */
export function inscritsDe(d: Domain, s: Pick<Session, 'id' | 'date'>): Inscrit[] {
  const out = new Map<number, Inscrit>();
  const personne = (empId: number) => {
    const e = d.emp(empId) ?? d.ds.annuaire.find(p => p.id === empId);
    return { nom: e?.nom ?? `#${empId}`, equipe: e?.equipe ?? null, poste: e?.poste ?? '' };
  };
  for (const e of d.ds.employes) {
    for (const c of e.certs.filter(x => x.sessionId === s.id)) {
      // Recyclage enregistré depuis : le plus ancien de ceux datés du jour de la session ou après.
      const deja = e.certs.filter(n => remplace(n, c) && n.obtenue >= s.date)
        .sort((a, b) => a.obtenue.localeCompare(b.obtenue) || a.id - b.id)[0] ?? null;
      const x: Inscrit = {
        empId: e.id, ...personne(e.id), parcours: 'recyclage', certId: c.id, inscriptionId: null, obtenue: c.obtenue, convoc: c.convoc, convocLe: c.convocLe ?? null,
        dejaObtenue: deja,
      };
      // Deux certifications rattachées (ancienne et en vigueur) : celle qui reste à décider prime.
      const prev = out.get(e.id);
      if (!prev || (prev.dejaObtenue && !x.dejaObtenue)) out.set(e.id, x);
    }
  }
  for (const i of d.ds.inscriptions.filter(x => x.sessionId === s.id)) {
    if (out.has(i.empId)) continue;
    out.set(i.empId, {
      empId: i.empId, ...personne(i.empId), parcours: 'initiale', certId: null, inscriptionId: i.id, obtenue: null, convoc: i.convoc, convocLe: i.convocLe ?? null, dejaObtenue: null,
    });
  }
  return [...out.values()].sort((a, b) => a.nom.localeCompare(b.nom));
}

/** Résultat d'un inscrit à une session clôturée. */
export interface Resultat { p: Participation; nom: string; equipe: string | null; label: string; obtenue: boolean }

export const resultatLabel = (p: Pick<Participation, 'present' | 'reussi' | 'certId'>) =>
  p.certId ? 'Certification obtenue' : !p.present ? 'Absent' : p.reussi === false ? 'Évaluation non réussie' : 'Non obtenue';

/** Résultats enregistrés à la clôture d'une session, par ordre alphabétique. */
export function resultatsDe(d: Domain, s: Pick<Session, 'id'>): Resultat[] {
  return d.ds.participations.filter(p => p.sessionId === s.id).map(p => {
    const e = d.ds.annuaire.find(x => x.id === p.empId);
    return { p, nom: e?.nom ?? d.personName(p.empId), equipe: e?.equipe ?? null, label: resultatLabel(p), obtenue: !!p.certId };
  }).sort((a, b) => a.nom.localeCompare(b.nom));
}

/** État d'une inscription en formation initiale : planifiée, session passée à clôturer, ou à replanifier. */
export type EtatInscription =
  | { etat: 'planifiee' | 'passee'; s: Session }
  | { etat: 'a_planifier'; s: Session; motif: string };

export function etatInscription(d: Domain, i: Inscription): EtatInscription | null {
  const s = d.session(i.sessionId);
  if (!s) return null;
  if (sessionActive(s)) return { etat: s.date < d.ti ? 'passee' : 'planifiee', s };
  const quand = fmt(parse(s.date));
  if (s.statut === 'Annulée') return { etat: 'a_planifier', s, motif: `Session du ${quand} annulée` };
  const p = d.ds.participations.find(x => x.sessionId === s.id && x.empId === i.empId);
  return { etat: 'a_planifier', s, motif: p && !p.present ? `Absent à la session du ${quand}` : `Non obtenue à la session du ${quand}` };
}

/** Champs d'une session saisis à la création ou à la modification. */
export interface SessionSaisie { date: unknown; lieu: unknown; places: unknown }

/** Session passée, pas encore clôturée : sa date peut encore être corrigée vers une autre date passée. */
export const sessionPassee = (today: ISODate, dateActuelle: ISODate | undefined) => !!dateActuelle && dateActuelle < today;

/**
 * Contrôle date, lieu et places ; renvoie le message d'erreur, sinon null. Une nouvelle date est
 * postérieure à aujourd'hui (une date inchangée reste admise) ; une session passée, à clôturer, se
 * redate au jour où elle a eu lieu (la clôture date les certifications de ce jour). Les places : un
 * entier au moins égal à 1 et au nombre d'inscrits.
 */
export function controleSession(today: ISODate, v: SessionSaisie, opts: { dateActuelle?: ISODate; inscrits?: number } = {}): string | null {
  const date = typeof v.date === 'string' ? v.date : '';
  const lieu = typeof v.lieu === 'string' ? v.lieu.trim() : '';
  const places = typeof v.places === 'number' ? v.places : typeof v.places === 'string' && v.places.trim() ? Number(v.places) : NaN;
  if (!isValidDate(date) || iso(parse(date)) !== date) return 'Date de la session requise';
  if (date !== opts.dateActuelle && date <= today && !sessionPassee(today, opts.dateActuelle)) return 'La date de la session doit être postérieure à aujourd’hui';
  if (!lieu) return 'Lieu requis';
  if (lieu.length > 200) return 'Lieu trop long (200 caractères au plus)';
  if (!Number.isInteger(places) || places < 1) return 'Nombre de places : un nombre entier, au moins 1';
  if (opts.inscrits && places < opts.inscrits) return `Nombre de places inférieur au nombre d’inscrits (${opts.inscrits})`;
  return null;
}

/**
 * Liste nominative à transmettre à l'organisme : nom, poste et parcours (initiale ou recyclage, avec
 * la date de la certification à renouveler). Ni matricule, ni contrat, ni santé, ni coordonnées personnelles.
 */
export function listeOrganisme(d: Domain, s: Session) {
  const fm = d.fm(s.formation);
  const head = ['Nom', 'Poste', 'Parcours', 'Certification à renouveler (obtenue le)'];
  const rows = inscritsDe(d, s).map(x => [x.nom, x.poste, x.parcours === 'recyclage' ? 'Recyclage' : 'Formation initiale', x.obtenue ? fmt(parse(x.obtenue)) : '']);
  return { fichier: `inscrits-${key(fm?.court ?? s.formation).replace(/ /g, '-')}-${s.date}.csv`, head, rows };
}
