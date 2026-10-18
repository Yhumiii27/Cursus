// Contrats : sortie d'un salarié (date et motif, pour tous les contrats, CDI compris), présence à une date, contrôles et
// effets d'une sortie (partagés par le dialogue de sortie et le serveur), garde-fou d'un changement de régime de temps.
// La date de fin du contrat (`Employe.fin`) sert de date de sortie : passé ce jour, la connexion est refusée et les
// sessions ne valent plus (server/src/comptes.ts), aucune notification n'est envoyée (server/src/messagerie.ts), aucune
// feuille ni absence n'est admise (rules/absences.ts, bornes du contrat), et le salarié quitte la conformité, les
// échéances, les obligations d'entretien et les tableaux de bord (`present`, Domain.enrich). Pour Keystone, il reste en
// « No Go CONTRAT » sur les chantiers où il est affecté (Domain.evaluateChantiers), pour que Keystone soit prévenu.
// Échéances du contrat (type `contrat` de Domain.echeances) : fin de la période d'essai, saisie depuis le contrat et
// alertée avant le délai de prévenance ; fin prévue d'un CDD, d'une mission, d'une alternance ; titre de séjour valant
// autorisation de travail (expiré : salarié non conforme et « No Go CONTRAT », libellé générique pour Keystone).
import { ESSAI_MAX_CDI, STATUTS } from '../constants.ts';
import { addD, addM, days, isFerie, isValidDate, isoWeek, joursSemaine, mondayOf, parse, weekday } from '../dates.ts';
import { fJ, fmtIso, num, plural } from '../format.ts';
import type { Domain, EchItem, EmpX } from '../domain.ts';
import type {
  Absence, AutorisationTravail, Certification, DemandeVisite, Employe, Entretien, FeuilleTemps, ISODate, Inscription, MotifSortie, Session, Settings,
  TypeTitreSejour,
} from '../types.ts';
import { absenceActive, periodeTexte, semaineHorsContrat } from './absences.ts';
import { rttDroitSelon, rttInfo } from './conges.ts';
import { regimeFiche, segmentsContrat, type SegmentContrat } from './historique-contrat.ts';
import { voyageActif } from './deplacements.ts';
import { echeancesMineur } from './mineurs.ts';

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

/**
 * Planification au-delà du dernier jour du contrat (sortie enregistrée, ou fin prévue d'un CDD, d'une mission, d'une
 * alternance) : inscription à une session, entretien, demande de visite. Refusée par le serveur et signalée dans les
 * dialogues ; message, ou null. Le motif de sortie n'est jamais cité (le manager ne le voit pas).
 */
export function horsContratLe(e: Pick<Employe, 'nom' | 'fin'>, date: ISODate): string | null {
  return present(e, date) ? null : `Date postérieure au dernier jour du contrat de ${e.nom} (${fmtIso(e.fin!)}) : rien ne se planifie après son départ.`;
}

/**
 * Sortie enregistrée (`employe.sortie`) : `fin` en est la date. Le motif ne parvient qu'au service RH, à la paie et à la
 * lecture seule ; le manager et le référent HSE reçoivent l'indication seule (`sortieEnregistree`, server/src/dataset.ts).
 */
export const sortieEnregistree = (e: Partial<Pick<Employe, 'motifSortie' | 'sortieEnregistree'>>) => !!e.motifSortie || !!e.sortieEnregistree;

/** Fin prévue au contrat, avant toute sortie enregistrée (CDD, mission, alternance ; null pour un CDI). */
export const finContrat = (e: Pick<Employe, 'fin' | 'motifSortie' | 'finPrevue'> & Partial<Pick<Employe, 'sortieEnregistree'>>) =>
  (sortieEnregistree(e) ? e.finPrevue ?? null : e.fin);

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
  /**
   * Demandes de visite médicale en cours, annulées par une sortie passée ou du jour. Avant la date, elles sont gardées :
   * une visite de reprise (art. R4624-31) reste due tant que le salarié travaille.
   */
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
  const semaines = feuilles.filter(f => joursSemaine(f.week).some((j, i) => j > date && heuresDuJour(f, i) > 0)).map(f => f.week).sort();
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
  const visites = d.ds.demandesVisite.filter(x => x.empId === e.id && x.statut === 'demandee');
  if (date <= d.ti) c.visites = visites;
  else if (visites.length) c.avertissements.push('Demande de visite médicale en cours : gardée jusqu’au départ (une visite de reprise reste due tant que le salarié travaille) ; annulez-la depuis la fiche si elle n’a plus d’objet.');
  c.feuilles = feuilles.filter(f => f.statut !== 'validee' && f.week > date && joursSemaine(f.week).every((_, i) => heuresDuJour(f, i) === 0));

  d.ds.voyages.filter(v => v.empId === e.id && v.retour > date && voyageActif(v)).forEach(v => {
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

// — Garde-fou d'un changement de régime de temps (conservé avec l'historique des contrats, shared/rules/historique-contrat.ts) —

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

/**
 * Solde de RTT (ou de jours de repos) affiché avant un changement de régime, gardé au journal pour la paie. `nouveauDroit` :
 * droit de l'année au prorata des régimes après le changement (null : plus aucun) ; `apresEffet` : jours de RTT posés ou
 * validés à partir de la date d'effet `effet`, sous un régime qui n'en ouvre plus.
 */
export interface SoldeRtt {
  annee: number; label: string; droit: number; pris: number; poses: number; solde: number;
  effet: ISODate; nouveauDroit: number | null; apresEffet: number;
}

/**
 * RTT de l'année pris ou posés que le nouveau régime ne couvre plus, même au prorata des mois passés sous l'ancien
 * (historique des contrats : un passage de 39 h à 35 h au 1er octobre garde 9/12 des RTT de l'année). Deux cas : le
 * nouveau régime ne laisse aucun droit dans l'année (changement au tout début de l'année, passage en intérim) ; les jours
 * pris ou posés dépassent le nouveau droit au prorata (le solde deviendrait négatif). Le changement exige alors la
 * confirmation du service RH, et le solde affiché juste avant est gardé au journal pour la paie, avec le nouveau droit et
 * les RTT posés ou validés après la date d'effet (à revoir avec le salarié). Des RTT posés après la date d'effet et
 * couverts par le droit au prorata ne demandent rien : acquis sous l'ancien régime, ils se prennent ensuite. `effet` : date
 * d'effet du changement (aujourd'hui par défaut). null si rien n'est perdu.
 */
export function rttPerdus(d: Domain, avant: Employe, apres: Employe, effet: ISODate = d.ti): SoldeRtt | null {
  const r = rttInfo(d, avant);
  if (!r) return null;
  const segs: SegmentContrat[] = [
    ...segmentsContrat(d, avant).filter(x => x.du < effet && !x.programme),
    { du: effet, regime: regimeFiche(apres), ligne: null, programme: false },
  ];
  const nouveauDroit = rttDroitSelon(d, apres, d.year, segs), consommes = r.pris + r.poses;
  if (consommes <= 0 || (nouveauDroit != null && nouveauDroit >= consommes)) return null;
  // RTT posés ou validés à compter de la date d'effet, quand le nouveau régime n'ouvre ni RTT ni jours de repos.
  const c = d.contratOf(apres);
  const apresEffet = c.interim || (!c.rtt && !c.forfait) ? d.ds.absences
    .filter(a => a.empId === avant.id && a.type === 'RTT' && (a.statut === 'demandee' || a.statut === 'validee') && a.au >= effet)
    .reduce((n, a) => n + (a.du >= effet ? d.countDays(avant, a.du, a.au, 'RTT', a) : d.countDays(avant, effet, a.au, 'RTT')), 0) : 0;
  return { annee: d.year, label: r.label, droit: r.droit, pris: r.pris, poses: r.poses, solde: r.solde, effet, nouveauDroit, apresEffet };
}

/**
 * Raison de la confirmation d'un changement de régime (`rttPerdus`), pour le dialogue de la fiche et le refus du serveur :
 * « Le nouveau régime n'ouvre ni RTT ni jours de repos : le compteur de … ne sera plus suivi dans Cursus », ou « Avec le
 * nouveau régime, le droit RTT 2026 de … n'est plus que de 12 j au prorata (…) : solde de -5 j ».
 */
export function rttPerdusTexte(s: SoldeRtt, nom: string): string {
  const raison = s.nouveauDroit == null
    ? `Le nouveau régime n’ouvre ni RTT ni jours de repos : le compteur de ${nom} (${soldeRttTexte(s)}) ne sera plus suivi dans Cursus`
    : `Avec le nouveau régime, le droit ${s.label} ${s.annee} de ${nom} n’est plus que de ${fJ(s.nouveauDroit)} au prorata des mois passés sous l’ancien (${soldeRttTexte(s)}) : solde de ${fJ(s.nouveauDroit - s.pris - s.poses)}`;
  const apres = s.apresEffet > 0 ? `, et ${fJ(s.apresEffet)} de RTT ${s.apresEffet > 1 ? 'restent posés ou validés' : 'reste posé ou validé'} à partir du ${fmtIso(s.effet)}, sous ce régime : à annuler ou à revoir` : '';
  return raison + apres;
}

/** « RTT 2026 : 16 j pris, 1 j posé, solde 5 j ». */
export const soldeRttTexte = (s: SoldeRtt) =>
  `${s.label} ${s.annee} : ${fJ(s.pris)} pris${s.poses ? `, ${fJ(s.poses)} posé${s.poses > 1 ? 's' : ''}` : ''}, solde ${fJ(s.solde)}`;

// — Période d'essai (art. L1221-19 à L1221-25, L1242-10, L1251-14) —
// L'essai n'existe que s'il est écrit au contrat (art. L1221-23) : aucune durée n'est proposée. Le service RH saisit la
// date de fin (et celle du renouvellement) écrite au contrat ; Cursus avertit au-delà du maximum légal (une date trop
// tardive, gardée par erreur, ferait arriver l'alerte après la vraie fin : une rupture serait alors un licenciement).

type ContratEssai = Pick<Employe, 'statut' | 'typeContrat' | 'entree' | 'fin'> & Partial<Pick<Employe, 'motifSortie' | 'finPrevue' | 'sortieEnregistree'>>;
/** Fin prévue au contrat d'une saisie : la date de sortie enregistrée n'en est pas une (rupture de l'essai, départ anticipé). */
const termeContrat = (e: ContratEssai) => finContrat({ fin: e.fin, motifSortie: e.motifSortie ?? null, finPrevue: e.finPrevue ?? null, sortieEnregistree: e.sortieEnregistree });

/** Maximum légal de l'essai : dernier jour possible, avant et après renouvellement (null : pas de renouvellement légal). */
export interface EssaiMax { fin: ISODate; texte: string; renouvele: ISODate | null; texteRenouvele: string }

/** `n`-ième jour travaillé (lundi au vendredi, hors fériés) à partir de `du`, compris. */
function jourTravaille(du: ISODate, n: number): ISODate {
  let j = du, k = 0;
  for (;;) {
    if (weekday(j) < 5 && !isFerie(j) && ++k >= n) return j;
    j = addD(j, 1);
  }
}
/** Dernier jour d'une durée de `n` mois à compter de `du` (inclus). */
const finMois = (du: ISODate, n: number) => addD(addM(du, n), -1);

/**
 * Maximum légal de l'essai selon le contrat. CDI (et alternance sans terme) : 2, 3 ou 4 mois selon le statut, 4, 6 ou 8
 * renouvellement compris (ESSAI_MAX_CDI). CDD (et alternance à terme) : 1 jour par semaine de contrat, au plus 2 semaines
 * pour un contrat de 6 mois au plus, 1 mois au-delà, sans renouvellement prévu par la loi. Intérim, à défaut de convention :
 * 2 jours travaillés pour une mission d'un mois au plus, 3 jusqu'à 2 mois, 5 au-delà (ou sans terme connu). null : dates
 * invalides, ou CDD sans terme.
 */
export function essaiMaximum(e: ContratEssai): EssaiMax | null {
  if (!isValidDate(e.entree)) return null;
  const terme = termeContrat(e);
  const sansRenouvellement = (texte: string) => ({ renouvele: null, texteRenouvele: `aucun renouvellement prévu par la loi pour ${texte}` });
  if (e.typeContrat === 'interim') {
    const n = !terme || !isValidDate(terme) ? 5 : terme <= finMois(e.entree, 1) ? 2 : terme <= finMois(e.entree, 2) ? 3 : 5;
    return { fin: jourTravaille(e.entree, n), texte: `${n} jours travaillés pour cette mission, art. L1251-14`, ...sansRenouvellement('une mission d’intérim') };
  }
  if (e.typeContrat === 'cdd' || (e.typeContrat === 'alternance' && terme)) {
    if (!terme || !isValidDate(terme) || terme < e.entree) return null;
    const semaines = Math.max(1, Math.floor((days(parse(e.entree), parse(terme)) + 1) / 7));
    const long = terme > finMois(e.entree, 6), plafond = long ? finMois(e.entree, 1) : addD(e.entree, 13);
    const jours = addD(e.entree, semaines - 1);
    return {
      fin: jours < plafond ? jours : plafond, texte: `1 jour par semaine de contrat, ${long ? '1 mois' : '2 semaines'} au plus, art. L1242-10`,
      ...sansRenouvellement('un contrat à durée déterminée'),
    };
  }
  const m = ESSAI_MAX_CDI[e.statut] ?? ESSAI_MAX_CDI.ouvrier, statut = (STATUTS[e.statut] ?? STATUTS.ouvrier).label.toLowerCase();
  return {
    fin: finMois(e.entree, m.mois), texte: `${m.mois} mois pour un ${statut}, art. L1221-19`,
    renouvele: finMois(e.entree, m.renouvele), texteRenouvele: `${m.renouvele} mois renouvellement compris, art. L1221-21`,
  };
}

/** Saisie de la période d'essai, contrôlée avec la fiche (validerProfil). */
type EssaiSaisi = ContratEssai & { essaiFin?: string | null; essaiRenouveleJusquau?: string | null };

/**
 * Contrôles de la période d'essai : dates cohérentes avec le contrat (bloquants), maximum légal dépassé (avertissement :
 * la date reste celle du contrat, que le service RH vérifie). La borne de fin est la fin prévue au contrat, jamais la date
 * d'une sortie enregistrée : une rupture pendant l'essai la précède normalement, et la fiche doit rester modifiable sans
 * effacer l'essai écrit au contrat.
 */
export function controleEssai(p: EssaiSaisi): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  const fin = p.essaiFin || null, ren = p.essaiRenouveleJusquau || null;
  if (!fin && !ren) return { errors, warnings };
  if (fin && !isValidDate(fin)) errors.push('Date de fin de la période d’essai invalide.');
  if (ren && !isValidDate(ren)) errors.push('Date de fin du renouvellement de l’essai invalide.');
  if (errors.length) return { errors, warnings };
  if (!fin) errors.push('Renouvellement de l’essai sans la fin de la période initiale.');
  if (fin && isValidDate(p.entree) && fin < p.entree) errors.push('La fin de la période d’essai précède la date d’entrée.');
  const terme = termeContrat(p);
  if (fin && terme && fin > terme) errors.push('La fin de la période d’essai dépasse la fin prévue du contrat.');
  if (fin && ren && ren <= fin) errors.push('Le renouvellement de l’essai doit finir après la période initiale.');
  if (ren && terme && ren > terme) errors.push('Le renouvellement de l’essai dépasse la fin prévue du contrat.');
  if (errors.length) return { errors, warnings };
  const max = essaiMaximum(p);
  if (max && fin && fin > max.fin) {
    warnings.push(`Période d’essai au-delà du maximum légal (${max.texte}) : le ${fmtIso(max.fin)} au plus tard. Vérifiez la date écrite au contrat et la convention collective.`);
  }
  if (max && ren) {
    if (!max.renouvele) warnings.push(`Renouvellement de l’essai : ${max.texteRenouvele}, sauf si le contrat ou la convention le prévoit.`);
    else if (ren > max.renouvele) warnings.push(`Essai renouvelé au-delà du maximum légal (${max.texteRenouvele}) : le ${fmtIso(max.renouvele)} au plus tard.`);
  }
  return { errors, warnings };
}

/** Dernier jour de l'essai en vigueur : celui du renouvellement, sinon celui de la période initiale. */
export const finEssai = (e: Pick<Employe, 'essaiFin' | 'essaiRenouveleJusquau'>) => e.essaiRenouveleJusquau ?? e.essaiFin ?? null;

/**
 * Délai de prévenance de l'employeur qui rompt l'essai le jour `le` (art. L1221-25), selon la présence : 24 heures en deçà
 * de 8 jours, 48 heures jusqu'à un mois, 2 semaines jusqu'à 3 mois, 1 mois au-delà. Fin du délai et libellé.
 */
export function prevenance(entree: ISODate, le: ISODate): { jusquau: ISODate; texte: string } {
  if (le < addD(entree, 7)) return { jusquau: addD(le, 1), texte: '24 heures' };
  if (le <= addM(entree, 1)) return { jusquau: addD(le, 2), texte: '48 heures' };
  if (le <= addM(entree, 3)) return { jusquau: addD(le, 14), texte: '2 semaines' };
  return { jusquau: addM(le, 1), texte: '1 mois' };
}

/**
 * Dernier jour où l'employeur peut notifier la rupture de l'essai en respectant le délai de prévenance, qui ne prolonge
 * pas l'essai (art. L1221-25) : au-delà, l'essai finit avant la fin du délai (indemnité compensatrice). Le délai ne
 * concerne ni l'intérim ni un essai de moins d'une semaine : la date est alors la fin de l'essai. null : pas d'essai.
 */
export function limitePrevenance(e: Pick<Employe, 'entree' | 'typeContrat' | 'essaiFin' | 'essaiRenouveleJusquau'>): { le: ISODate; delai: string | null } | null {
  const fin = finEssai(e);
  if (!fin || !isValidDate(fin) || !isValidDate(e.entree) || fin < e.entree) return null;
  if (e.typeContrat === 'interim' || days(parse(e.entree), parse(fin)) + 1 < 7) return { le: fin, delai: null };
  for (let le = fin; le >= e.entree; le = addD(le, -1)) {
    const p = prevenance(e.entree, le);
    if (p.jusquau <= fin) return { le, delai: p.texte };
  }
  return { le: e.entree, delai: prevenance(e.entree, e.entree).texte };
}

// — Titre de séjour valant autorisation de travail (art. L5221-2, L5221-8, R5221-41) —

/** Types de titres valant autorisation de travail (liste fermée, sans texte libre). */
export const TYPES_TITRE_SEJOUR: Record<TypeTitreSejour, { label: string; court: string }> = {
  salarie: { label: 'Carte de séjour temporaire « salarié »', court: 'Carte « salarié »' },
  travailleur_temporaire: { label: 'Carte de séjour temporaire « travailleur temporaire »', court: 'Carte « travailleur temporaire »' },
  pluriannuelle: { label: 'Carte de séjour pluriannuelle', court: 'Carte pluriannuelle' },
  talent: { label: 'Carte de séjour « passeport talent »', court: 'Passeport talent' },
  vie_privee: { label: 'Carte de séjour « vie privée et familiale »', court: 'Carte « vie privée et familiale »' },
  etudiant: { label: 'Carte de séjour « étudiant » (964 heures par an au plus)', court: 'Carte « étudiant »' },
  resident: { label: 'Carte de résident (10 ans)', court: 'Carte de résident' },
  resident_permanent: { label: 'Carte de résident permanent (sans expiration)', court: 'Résident permanent' },
  recepisse: { label: 'Récépissé ou attestation de prolongation autorisant à travailler', court: 'Récépissé' },
  apt: { label: 'Autorisation provisoire de travail', court: 'Autorisation provisoire' },
  autre: { label: 'Autre titre valant autorisation de travail', court: 'Autre titre' },
};
export const estTypeTitre = (v: unknown): v is TypeTitreSejour => typeof v === 'string' && Object.hasOwn(TYPES_TITRE_SEJOUR, v);

/**
 * Libellé générique d'un titre expiré, le seul transmis à Keystone en partage détaillé (motif CONTRAT) et affiché aux
 * profils qui ne voient que le verdict sur les chantiers : jamais la mention d'un titre de séjour, qui révélerait la
 * situation administrative d'un salarié étranger.
 */
export const SITUATION_A_REGULARISER = 'Situation contractuelle à régulariser';

/** État de l'autorisation de travail à une date : détail (service RH, lecture seule, intéressé) ou verdict seul. */
export interface EtatAutorisation {
  requise: boolean; expiree: boolean; verdictSeul: boolean;
  type: TypeTitreSejour | null; expire: ISODate | null; demandeLe: ISODate | null; verifieLe: ISODate | null;
}
export function etatAutorisation(e: Pick<Employe, 'autorisationTravail' | 'autorisationVerdict'>, date: ISODate): EtatAutorisation {
  const t = e.autorisationTravail;
  if (t) return { requise: true, expiree: !!t.expire && t.expire < date, verdictSeul: false, type: t.type, expire: t.expire, demandeLe: t.demandeLe ?? null, verifieLe: t.verifieLe };
  const expiree = e.autorisationVerdict === 'expiree';
  return { requise: expiree, expiree, verdictSeul: !!e.autorisationVerdict, type: null, expire: null, demandeLe: null, verifieLe: null };
}

/** Verdict transmis au manager, au référent HSE et à la paie : « valide » aussi quand aucune autorisation n'est requise. */
export const verdictAutorisation = (e: Pick<Employe, 'autorisationTravail' | 'autorisationVerdict'>, date: ISODate): 'valide' | 'expiree' =>
  etatAutorisation(e, date).expiree ? 'expiree' : 'valide';

/** Jour ouvrable situé `n` jours ouvrables avant `date` (tous les jours sauf le dimanche et les jours fériés). */
export function joursOuvrablesAvant(date: ISODate, n: number): ISODate {
  let j = date, k = 0;
  while (k < n) { j = addD(j, -1); if (weekday(j) !== 6 && !isFerie(j)) k++; }
  return j;
}

/** Saisie du titre : `requise` faux pour un ressortissant français, de l'UE, de l'EEE ou de la Suisse. */
export interface AutorisationSaisie { requise: boolean; type?: unknown; numero?: unknown; expire?: unknown; demandeLe?: unknown; verifieLe?: unknown }

/** Numéro du titre : lettres et chiffres en majuscules, sans espace. */
export const normaliserNumeroTitre = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : '');

/**
 * Contrôles d'un titre (`employe.autorisationTravail`, dialogue de la fiche) : type de la liste, numéro (registre unique du
 * personnel), expiration (sauf résident permanent), envoi de la demande d'authentification à la préfecture et réponse,
 * jamais futurs, la réponse après la demande. Avertissements : titre expiré (art. L5221-8), demande non tracée, ou envoyée
 * moins de 2 jours ouvrables avant une embauche récente ou à venir (art. R5221-41). La règle porte sur l'envoi de la
 * demande, pas sur la réponse : sans réponse sous 2 jours ouvrables, l'obligation est remplie. Faute de date d'envoi, une
 * réponse reçue avant la date limite prouve une demande dans les délais ; reçue après, elle ne prouve rien.
 */
export function validerAutorisation(raw: AutorisationSaisie, opts: { entree: ISODate; ti: ISODate }): { valeur: AutorisationTravail | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  if (!raw.requise) return { valeur: null, errors, warnings };
  const type = estTypeTitre(raw.type) ? raw.type : null;
  if (!type) errors.push('Type de titre à choisir dans la liste.');
  const numero = normaliserNumeroTitre(raw.numero);
  if (!numero) errors.push('Numéro du titre requis (registre unique du personnel).');
  else if (!/^[A-Z0-9-]{4,30}$/.test(numero)) errors.push('Numéro du titre : 4 à 30 lettres et chiffres.');
  const permanent = type === 'resident_permanent';
  const expire = permanent ? null : typeof raw.expire === 'string' && raw.expire ? raw.expire : null;
  if (!permanent && !expire) errors.push('Date d’expiration du titre requise.');
  else if (expire && !isValidDate(expire)) errors.push('Date d’expiration du titre invalide.');
  const demandeLe = typeof raw.demandeLe === 'string' && raw.demandeLe ? raw.demandeLe : null;
  if (demandeLe && !isValidDate(demandeLe)) errors.push('Date d’envoi de la demande d’authentification invalide.');
  else if (demandeLe && demandeLe > opts.ti) errors.push('Date d’envoi de la demande d’authentification future : saisissez-la une fois la demande envoyée.');
  const verifieLe = typeof raw.verifieLe === 'string' && raw.verifieLe ? raw.verifieLe : null;
  if (verifieLe && !isValidDate(verifieLe)) errors.push('Date de vérification en préfecture invalide.');
  else if (verifieLe && verifieLe > opts.ti) errors.push('Date de vérification en préfecture future : saisissez-la une fois la réponse reçue.');
  else if (verifieLe && demandeLe && isValidDate(demandeLe) && verifieLe < demandeLe) errors.push('Date de vérification en préfecture antérieure à l’envoi de la demande.');
  if (errors.length || !type) return { valeur: null, errors, warnings };
  if (expire && expire < opts.ti) warnings.push(`Titre expiré le ${fmtIso(expire)} : le salarié ne peut plus être employé sans titre valable (art. L5221-8). Il est non conforme et en « No Go » sur les chantiers.`);
  // Date limite de la demande, pour une embauche récente ou à venir (un titre renouvelé depuis longtemps n'est pas concerné).
  const limite = isValidDate(opts.entree) && opts.entree >= addD(opts.ti, -30) ? joursOuvrablesAvant(opts.entree, 2) : null;
  if (!demandeLe && !verifieLe) warnings.push('Demande d’authentification du titre auprès de la préfecture non tracée (art. R5221-41).');
  else if (limite && demandeLe && demandeLe > limite) {
    warnings.push(`Demande d’authentification à envoyer à la préfecture au moins 2 jours ouvrables avant l’embauche, soit le ${fmtIso(limite)} au plus tard (art. R5221-41).`);
  } else if (limite && !demandeLe && verifieLe && verifieLe > limite) {
    warnings.push(`Réponse de la préfecture reçue après le ${fmtIso(limite)} : tracez la date d’envoi de la demande d’authentification, à faire au moins 2 jours ouvrables avant l’embauche (art. R5221-41).`);
  }
  return { valeur: { type, numero, expire, demandeLe, verifieLe }, errors, warnings };
}

/**
 * Information des salariés concernés (art. 13 du RGPD), sur le modèle de INFO_VACCINATIONS, affichée dans le dialogue du
 * titre : modèle à faire valider par le délégué à la protection des données (docs/RGPD.md).
 */
export const INFO_TITRE_SEJOUR = {
  titre: 'Titre de séjour : ce que Cursus enregistre',
  points: [
    ['Responsable', 'votre employeur, tenu de vérifier que vous êtes autorisé à travailler en France.'],
    ['Finalité', 'vérifier l’autorisation de travail à l’embauche et pendant le contrat, et anticiper son renouvellement.'],
    ['Base légale', 'obligation légale de l’employeur (art. L5221-8 et R5221-41 du Code du travail ; registre unique du personnel, art. L1221-13 et D1221-23 ; art. 6.1.c du RGPD).'],
    ['Données', 'le type de titre, son numéro, sa date d’expiration, les dates de la demande de vérification auprès de la préfecture et de sa réponse ; ni copie du document, ni nationalité.'],
    ['Destinataires', 'le service RH ; la lecture seule (direction, audit) sans le numéro. Votre manager et les autres profils ne voient qu’un verdict (titre valide ou à régulariser) ; Keystone ne reçoit qu’une « situation contractuelle à régulariser ».'],
    ['Conservation', 'durée fixée par l’entreprise avec son délégué à la protection des données (à préciser avant la mise en service) ; le registre unique du personnel se conserve 5 ans après votre départ.'],
    ['Vos droits', 'accès, rectification et limitation auprès du service RH ou du délégué à la protection des données ; réclamation auprès de la CNIL (cnil.fr).'],
  ] as [string, string][],
};

// — Échéances du contrat (type `contrat` de Domain.echeances) —

const FIN_CONTRAT_LABEL: Record<string, string> = { cdd: 'Fin de CDD', interim: 'Fin de mission', alternance: 'Fin d’alternance' };
const CLS_CONTRAT = { ok: 'tag-neutral', due: 'tag-outline', exp: 'tag-accent' } as const;

/**
 * Échéances du contrat d'un salarié présent : fin de la période d'essai (datée du dernier jour où notifier une rupture
 * dans le délai de prévenance), fin prévue d'un CDD, d'une mission ou d'une alternance (sans sortie enregistrée), titre de
 * séjour (alerte puis relance réglables ; expiré : non conforme). Le verdict seul (manager, profils restreints) ne donne
 * aucune échéance de titre.
 */
export function echeancesContrat(d: Domain, e: EmpX, horizon: number): EchItem[] {
  const out: EchItem[] = [], s: Settings = d.ds.settings;
  const item = (o: Pick<EchItem, 'kindLabel' | 'label' | 'key' | 'statut' | 'action'> & { le: ISODate }): EchItem => {
    const { le, ...x } = o, exp = parse(le);
    return { ...x, kind: 'contrat', emp: e, exp, d: days(d.today, exp), cls: CLS_CONTRAT[o.key], planned: false, plannedLabel: '' };
  };
  // Fin de la période d'essai, tant qu'elle n'est pas passée et qu'aucune sortie ne la précède : une rupture de l'essai
  // (ou un départ) déjà enregistrée n'est plus « à décider ».
  const fe = finEssai(e), lim = limitePrevenance(e), sortie = sortieEnregistree(e);
  if (fe && lim && fe >= d.ti && !sortie && !(e.fin && e.fin < fe)) {
    const n = days(d.today, parse(lim.le)), key = n < 0 ? 'exp' : n <= horizon ? 'due' : 'ok';
    out.push(item({
      kindLabel: lim.delai ? `Période d’essai · prévenance de ${lim.delai}` : 'Période d’essai',
      label: `Fin d’essai${e.essaiRenouveleJusquau ? ' renouvelé' : ''} le ${fmtIso(fe)}`, le: lim.le, key,
      statut: key === 'exp' ? 'Prévenance dépassée' : key === 'due' ? 'À décider' : 'En cours',
      action: { label: 'Mettre à jour', intent: { type: 'openContrat', empId: e.id, quoi: 'fiche' } },
    }));
  }
  // Fin prévue d'un contrat à terme : une sortie enregistrée la remplace (le motif, ou l'indication seule pour le manager
  // et le référent HSE, pour que leurs échéances soient celles du service RH).
  if (e.typeContrat !== 'cdi' && e.fin && !sortie) {
    const key = days(d.today, parse(e.fin)) <= horizon ? 'due' : 'ok';
    out.push(item({
      kindLabel: 'Fin de contrat', label: FIN_CONTRAT_LABEL[e.typeContrat] ?? 'Fin de contrat', le: e.fin, key,
      statut: key === 'due' ? 'À anticiper' : 'Prévue', action: { label: 'Enregistrer la sortie', intent: { type: 'openContrat', empId: e.id, quoi: 'sortie' } },
    }));
  }
  // Titre de séjour : alerte (fenêtre de la demande de renouvellement), relance, puis expiré (non conforme).
  const t = etatAutorisation(e, d.ti);
  if (t.requise && !t.verdictSeul && t.expire && t.type) {
    const n = days(d.today, parse(t.expire)), key = n < 0 ? 'exp' : n <= s.titreSejourAlerte ? 'due' : 'ok';
    out.push(item({
      kindLabel: 'Titre de séjour', label: TYPES_TITRE_SEJOUR[t.type].court, le: t.expire, key,
      statut: n < 0 ? 'Expiré — non conforme' : n <= s.titreSejourRelance ? 'Relance' : key === 'due' ? 'Renouvellement à demander' : 'Valide',
      action: { label: 'Mettre à jour', intent: { type: 'openContrat', empId: e.id, quoi: 'titre' } },
    }));
  }
  // Salarié mineur : 18 ans, dérogation pour travaux réglementés (shared/rules/mineurs.ts).
  out.push(...echeancesMineur(d, e, horizon));
  return out;
}
