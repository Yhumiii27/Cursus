// Contrats : sortie d'un salarié (date et motif, pour tous les contrats, CDI compris), présence à une date, contrôles et
// effets d'une sortie (partagés par le dialogue de sortie et le serveur), garde-fou d'un changement de régime de temps.
// La date de fin du contrat (`Employe.fin`) sert de date de sortie : passé ce jour, la connexion est refusée et les
// sessions ne valent plus (server/src/comptes.ts), aucune notification n'est envoyée (server/src/messagerie.ts), aucune
// feuille ni absence n'est admise (rules/absences.ts, bornes du contrat), et le salarié quitte la conformité, les
// échéances, les obligations d'entretien et les tableaux de bord (`present`, Domain.enrich). Pour Keystone, il reste en
// « No Go CONTRAT » sur les chantiers où il est affecté (Domain.evaluateChantiers), pour que Keystone soit prévenu.
import { addD, isValidDate, isoWeek, mondayOf, wDays } from '../dates.ts';
import { fJ, fmtIso, num, plural } from '../format.ts';
import type { Domain } from '../domain.ts';
import type { Absence, Certification, DemandeVisite, Employe, Entretien, FeuilleTemps, ISODate, Inscription, MotifSortie, Session } from '../types.ts';
import { absenceActive, periodeTexte, semaineHorsContrat } from './absences.ts';
import { rttDroit, rttInfo } from './conges.ts';

// — Sortie —

/** Motifs de sortie : liste fermée, sans texte libre (aucune information personnelle au-delà du motif). */
export const MOTIFS_SORTIE: Record<MotifSortie, string> = {
  demission: 'Démission',
  rupture_conventionnelle: 'Rupture conventionnelle',
  licenciement: 'Licenciement',
  fin_cdd: 'Fin de CDD',
  fin_periode_essai: 'Fin de période d’essai',
  retraite: 'Retraite',
  deces: 'Décès',
  fin_mission: 'Fin de mission',
  autre: 'Autre motif',
};
export const estMotifSortie = (v: unknown): v is MotifSortie => typeof v === 'string' && Object.hasOwn(MOTIFS_SORTIE, v);

/**
 * Salarié présent à la date : sa sortie (dernier jour du contrat) n'est pas passée. Une embauche à venir compte comme
 * présente : visite d'embauche, formations et habilitations se préparent avant l'arrivée.
 */
export const present = (e: Pick<Employe, 'fin'>, date: ISODate) => !e.fin || e.fin >= date;
/** Salarié sorti à la date (le lendemain de son dernier jour). */
export const sorti = (e: Pick<Employe, 'fin'>, date: ISODate) => !present(e, date);

/** Fin prévue au contrat, avant toute sortie enregistrée (CDD, mission, alternance ; null pour un CDI). */
export const finContrat = (e: Pick<Employe, 'fin' | 'motifSortie' | 'finPrevue'>) => (e.motifSortie ? e.finPrevue ?? null : e.fin);

/** « Démission · le 30 nov. 2026 », « Fin de contrat le 29 janv. 2027 » (fin prévue, sans sortie enregistrée). */
export function sortieTexte(e: Pick<Employe, 'fin' | 'motifSortie'>): string | null {
  if (!e.fin) return null;
  return e.motifSortie && estMotifSortie(e.motifSortie) ? `${MOTIFS_SORTIE[e.motifSortie]} · le ${fmtIso(e.fin)}` : `Fin de contrat le ${fmtIso(e.fin)}`;
}

/** Session ouverte (ni clôturée ni annulée) : une sortie en retire le salarié. */
const ouverte = (s: Pick<Session, 'statut'> | null | undefined) => !!s && s.statut !== 'Clôturée' && s.statut !== 'Annulée';
const heuresDuJour = (f: Pick<FeuilleTemps, 'lignes'>, i: number) => (f.lignes ?? []).reduce((n, l) => n + num(l.h?.[i]), 0);

/** Contrôles et effets d'une sortie à une date : ce qui la bloque, ce qu'elle annule ou retire, ce qu'il reste à voir. */
export interface ControleSortie {
  /** Blocages : la sortie est refusée tant qu'ils demeurent. */
  bloquants: string[];
  /** Absences (et demandes) entièrement postérieures à la sortie : annulées, Keystone prévenu. */
  absences: Absence[];
  /** Recyclages et inscriptions en formation initiale à une session ouverte postérieure : retirés, convocation annulée. */
  certs: Certification[];
  inscriptions: Inscription[];
  /** Entretiens planifiés après la sortie : retirés. */
  entretiens: Entretien[];
  /** Demandes de visite médicale en cours : annulées. */
  visites: DemandeVisite[];
  /** Feuilles de temps sans heure, non validées, des semaines qui suivent la sortie : retirées. */
  feuilles: FeuilleTemps[];
  /** Points d'attention qui ne bloquent pas (déplacement prévu après la sortie, demandes en attente). */
  avertissements: string[];
}

/**
 * Contrôles d'une sortie au `date` (dernier jour du contrat) : refusée avant l'entrée, après la fin prévue du contrat (à
 * prolonger d'abord dans la fiche), tant que le salarié encadre une équipe, qu'une feuille porte des heures après la date
 * ou qu'une absence est à cheval sur elle (à raccourcir ou annuler d'abord). La nature d'une absence n'est jamais citée.
 */
export function controleSortie(d: Domain, e: Employe, date: ISODate): ControleSortie {
  const c: ControleSortie = { bloquants: [], absences: [], certs: [], inscriptions: [], entretiens: [], visites: [], feuilles: [], avertissements: [] };
  if (!isValidDate(date)) { c.bloquants.push('Date de sortie invalide.'); return c; }
  if (date < e.entree) c.bloquants.push(`La date de sortie précède l’entrée (${fmtIso(e.entree)}).`);
  const prevue = finContrat(e);
  if (prevue && date > prevue) c.bloquants.push(`La date de sortie dépasse la fin prévue du contrat (${fmtIso(prevue)}) : prolongez d’abord le contrat dans la fiche.`);
  const equipes = d.teamsOf(e.id);
  if (equipes.length) c.bloquants.push(`Manager de l’équipe ${equipes.join(', ')} : désignez d’abord un autre manager (Équipes & managers).`);
  // Heures saisies après la sortie, sur une feuille de n'importe quel statut : à retirer d'abord (une feuille validée se
  // corrige avec la paie), sans quoi elles seraient payées hors contrat.
  const feuilles = d.ds.feuilles.filter(f => f.empId === e.id);
  const semaines = feuilles.filter(f => wDays(f.week).some((j, i) => j > date && heuresDuJour(f, i) > 0)).map(f => f.week).sort();
  if (semaines.length) {
    c.bloquants.push(`Heures saisies après le ${fmtIso(date)} (${semaines.length > 1 ? 'semaines' : 'semaine'} ${semaines.map(isoWeek).join(', ')}) : retirez-les des feuilles de temps d’abord, ou choisissez une date de sortie postérieure.`);
  }
  const absences = d.ds.absences.filter(a => a.empId === e.id && absenceActive(a));
  absences.filter(a => a.du <= date && a.au > date).forEach(a => {
    c.bloquants.push(`${a.statut === 'demandee' ? 'Demande d’absence' : 'Absence'} ${periodeTexte(a.du, a.au)} à cheval sur la date de sortie : raccourcissez-la ou annulez-la d’abord (Congés & absences).`);
  });

  c.absences = absences.filter(a => a.du > date);
  const apres = (id: number | null) => { const s = d.session(id); return ouverte(s) && s!.date > date; };
  c.certs = e.certs.filter(x => apres(x.sessionId));
  c.inscriptions = d.ds.inscriptions.filter(i => i.empId === e.id && apres(i.sessionId));
  c.entretiens = d.ds.entretiens.filter(x => x.empId === e.id && x.statut === 'planifie' && x.date > date);
  c.visites = d.ds.demandesVisite.filter(x => x.empId === e.id && x.statut === 'demandee');
  c.feuilles = feuilles.filter(f => f.statut !== 'validee' && f.week > date && [0, 1, 2, 3, 4].every(i => heuresDuJour(f, i) === 0));

  d.ds.voyages.filter(v => v.empId === e.id && v.retour > date).forEach(v => {
    c.avertissements.push(`Déplacement ${d.destOf(v.dest)?.pays ?? v.dest} ${periodeTexte(v.depart, v.retour)} au-delà de la sortie : à annuler ou écourter (Voyages).`);
  });
  const demandes = d.ds.demandesCollab.filter(r => r.empId === e.id && r.statut === 'attente').length;
  if (demandes) c.avertissements.push(`${plural(demandes, 'demande au service RH en attente', 'demandes au service RH en attente')} : à refuser ou accepter.`);
  return c;
}

/** Effets d'une sortie, en clair : « 2 absences annulées (Keystone prévenu) · 1 entretien planifié retiré ». */
export function effetsSortie(c: Pick<ControleSortie, 'absences' | 'certs' | 'inscriptions' | 'entretiens' | 'visites' | 'feuilles'>): string[] {
  const keystone = c.absences.some(a => a.keystone);
  const sessions = c.certs.length + c.inscriptions.length;
  return [
    c.absences.length ? `${plural(c.absences.length, 'absence annulée', 'absences annulées')}${keystone ? ' (Keystone prévenu)' : ''}` : '',
    sessions ? `${plural(sessions, 'inscription à une session retirée', 'inscriptions à des sessions retirées')}` : '',
    c.entretiens.length ? plural(c.entretiens.length, 'entretien planifié retiré', 'entretiens planifiés retirés') : '',
    c.visites.length ? 'demande de visite médicale annulée' : '',
    c.feuilles.length ? plural(c.feuilles.length, 'feuille de temps vide retirée', 'feuilles de temps vides retirées') : '',
  ].filter(Boolean);
}

// — Garde-fou d'un changement de régime de temps (avant l'historique daté des contrats) —

/** Semaines qui précèdent la date d'effet d'un changement de régime, figées sur l'ancien régime. */
export const SEMAINES_FIGEES = 8;

/**
 * Lundis des 8 semaines qui précèdent la date d'effet (une semaine dont le lundi la précède compte, comme pour le gel des
 * feuilles existantes), sous contrat et encore sans feuille : chacune reçoit une feuille brouillon vide figée sur l'ancien
 * régime. Sans elle, une feuille créée après le changement pour une de ces semaines prendrait le nouveau régime (heures
 * supplémentaires faussées). Ordre chronologique.
 */
export function semainesAFiger(e: Employe, effet: ISODate, feuilles: readonly Pick<FeuilleTemps, 'empId' | 'week'>[]): ISODate[] {
  const derniere = mondayOf(addD(effet, -1)), out: ISODate[] = [];
  for (let k = SEMAINES_FIGEES - 1; k >= 0; k--) {
    const w = addD(derniere, -7 * k);
    if (!semaineHorsContrat(e, w) && !feuilles.some(f => f.empId === e.id && f.week === w)) out.push(w);
  }
  return out;
}

/** Solde de RTT (ou de jours de repos) affiché avant un changement de régime, gardé au journal pour la paie. */
export interface SoldeRtt { annee: number; label: string; droit: number; pris: number; poses: number; solde: number }

/**
 * RTT de l'année pris ou posés que le nouveau régime n'ouvre plus (39 h + RTT vers 35 h, passage en intérim…) : le
 * compteur disparaîtrait de Cursus sans bruit. Le changement exige alors la confirmation du service RH, et le solde
 * affiché juste avant est gardé au journal pour la paie. null si rien n'est perdu.
 */
export function rttPerdus(d: Domain, avant: Employe, apres: Employe): SoldeRtt | null {
  const r = rttInfo(d, avant);
  if (!r || r.pris + r.poses <= 0 || rttDroit(d, apres) != null) return null;
  return { annee: d.year, label: r.label, droit: r.droit, pris: r.pris, poses: r.poses, solde: r.solde };
}

/** « RTT 2026 : 16 j pris, 1 j posé, solde 5 j ». */
export const soldeRttTexte = (s: SoldeRtt) =>
  `${s.label} ${s.annee} : ${fJ(s.pris)} pris${s.poses ? `, ${fJ(s.poses)} posé${s.poses > 1 ? 's' : ''}` : ''}, solde ${fJ(s.solde)}`;
