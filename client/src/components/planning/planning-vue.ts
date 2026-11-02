// Planning d'équipe (lot 12, chantier C5, étape 2) : ce que montrent l'onglet Planning d'équipe de Temps de travail
// (components/planning/PlanningEquipe.tsx), « Mon planning » (pages/MonPlanning.tsx) et l'affichage réglementaire
// (art. D3171-7), calculé sans React sur l'instantané reçu (déjà filtré par le serveur : server/src/vues-planning.ts) et
// testé dans tests/client-planning.test.ts.
// - Grille de l'équipe : une ligne par salarié, une case par jour avec une lettre (code de l'horaire, « R » pour un repos,
//   « A » pour une absence) et un texte complet (lecteur d'écran, détail sous la grille) ; aucune couleur seule. Un brouillon
//   est marqué « à publier » (astérisque et texte). L'absence n'est montrée qu'au planificateur, sans sa nature
//   (`etatPourPlanificateur`) : un jour d'absence en vigueur, quel que soit le poste prévu.
// - Ligne de couverture : postes planifiés du jour (absents retirés pour le planificateur) face au besoin minimal de l'équipe
//   par horaire (Référentiels → Besoins de poste) ; un manque est écrit, pas seulement coloré. Étape 3 : couverture
//   minimale par créneau (secouristes, équipiers d'intervention de l'équipe, à chaque horaire tenu : shared/rules/
//   couverture-creneaux.ts), absences retirées pour le planificateur seul.
// - Étape 3 : conflits d'un poste avec une mission ou une tâche Keystone, une session de formation, une astreinte
//   (shared/rules/planning-conflits.ts), marqués « ! » et écrits dans le texte de la case, pour le planificateur seul.
// - Affichage réglementaire : horaire collectif (horaires de l'équipe, avec leur plage et leur pause) et composition
//   nominative des équipes successives (qui tient chaque poste, jour par jour), d'après les seuls postes publiés.
import { addD, isFerie, parse } from '../../../../shared/dates.ts';
import type { Domain } from '../../../../shared/domain.ts';
import { fH, plural } from '../../../../shared/format.ts';
import { cycleDe } from '../../../../shared/rules/cycles.ts';
import { dureeHoraire, horaireDe, plageTexte } from '../../../../shared/rules/horaires.ts';
import { besoinsDuJour, creneauxPlanificateur, etatPourPlanificateur, horaireDuCreneau, STATUT_ECHANGE } from '../../../../shared/rules/planning.ts';
// lot 12 — C5 étape 3 (conflits, couverture par créneau)
import { couvertureCreneaux, creneauCouvertureTexte, manquesCreneau } from '../../../../shared/rules/couverture-creneaux.ts';
import { conflitsDuJour, conflitsPlanning } from '../../../../shared/rules/planning-conflits.ts';
import type { ISODate } from '../../../../shared/types.ts';
import type { Creneau, EchangePoste } from '../../../../shared/types-planning.ts';

/** Date complète d'un jour : « lundi 12 octobre 2026 ». */
export const jourLong = (s: ISODate) => parse(s).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
/** Date courte d'un jour : « lun. 12 oct. ». */
export const jourCourt = (s: ISODate) => parse(s).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

/** Jours affichés : `n` jours à partir de `du`. */
export const joursDe = (du: ISODate, n: number): ISODate[] => Array.from({ length: n }, (_, i) => addD(du, i));

export type EtatCase = 'poste' | 'repos' | 'absent' | 'vide' | 'a_pourvoir';
export interface CaseEquipe {
  jour: ISODate;
  etat: EtatCase;
  /** Lettre affichée : code de l'horaire, « R » (repos), « A » (absent), « » (rien de planifié). */
  marque: string;
  /** Brouillon à publier (nouveau créneau, ou nouvelle version d'un créneau publié). */
  brouillon: boolean;
  /** Créneau ouvert au clic (le brouillon, ou la version publiée) ; null : rien de planifié ce jour-là. */
  creneau: Creneau | null;
  texte: string;
  /** Étape 3 : poste en conflit avec un autre engagement du salarié (planificateur seul), marqué « ! ». */
  conflit?: boolean;
}
export interface LigneEquipe { empId: number | null; nom: string; cases: CaseEquipe[]; resume: string }
export interface CouvertureJour { jour: ISODate; texte: string; court: string; manque: boolean }

/** Texte d'un poste : « M · 5 h – 13 h » ; repos : « repos ». */
export const posteTexte = (c: Pick<Creneau, 'horaire' | 'debut' | 'fin'>) => (c.horaire && c.debut && c.fin ? `${c.horaire} · ${plageTexte({ debut: c.debut, fin: c.fin })}` : 'repos');

/** Salariés de la grille : membres de l'équipe présents sur la période, et ceux qui y ont un créneau (mutés depuis). */
function salariesDeLEquipe(d: Domain, equipe: string, jours: readonly ISODate[], creneaux: readonly Creneau[]): number[] {
  const premier = jours[0], dernier = jours.at(-1)!;
  const membres = d.ds.employes.filter(e => e.equipe === equipe && e.entree <= dernier && (!e.fin || e.fin >= premier)).map(e => e.id);
  const autres = creneaux.filter(c => c.empId != null && c.equipe === equipe).map(c => c.empId!);
  return [...new Set([...membres, ...autres])].filter(id => d.emp(id)).sort((a, b) => d.personName(a).localeCompare(d.personName(b)));
}

/**
 * Créneaux d'où se calculent la grille et l'affichage : ceux de l'instantané, ou, pour une période hors de sa fenêtre, ceux
 * lus à la demande par l'historique (client/src/planning-api.ts, déjà filtrés par droits), nominatifs et « à pourvoir ».
 */
export function sourceCreneaux(d: Domain, historique?: readonly Creneau[] | null): { nominatifs: readonly Creneau[]; aPourvoir: readonly Creneau[] } {
  if (!historique) return { nominatifs: d.ds.creneaux ?? [], aPourvoir: d.ds.creneauxAPourvoir ?? [] };
  return { nominatifs: historique.filter(c => c.empId != null), aPourvoir: historique.filter(c => c.empId == null) };
}

/**
 * Grille de l'équipe `equipe` sur `jours` : `planificateur` (service RH, manager ou suppléant qui planifie l'équipe) voit les
 * absences (sans nature) ; les autres lecteurs, les seuls postes et repos. `historique` : créneaux lus à la demande pour une
 * période hors de la fenêtre de l'instantané.
 */
export function grilleEquipe(d: Domain, equipe: string, jours: readonly ISODate[], planificateur: boolean, historique?: readonly Creneau[] | null): { lignes: LigneEquipe[]; couverture: CouvertureJour[]; brouillons: number } {
  const premier = jours[0], dernier = jours.at(-1)!;
  const dans = (c: Creneau) => c.jour >= premier && c.jour <= dernier;
  const source = sourceCreneaux(d, historique);
  const nominatifs = creneauxPlanificateur(source.nominatifs.filter(dans));
  const aPourvoir = creneauxPlanificateur(source.aPourvoir.filter(c => dans(c) && c.equipe === equipe));
  const parCle = new Map(nominatifs.filter(c => c.empId != null).map(c => [`${c.empId}|${c.jour}`, c]));
  const absences = planificateur ? d.ds.absences : [];
  const lignes: LigneEquipe[] = salariesDeLEquipe(d, equipe, jours, nominatifs).map(empId => {
    const nom = d.personName(empId);
    // Conflits des jours planifiés (planificateur seul) : missions, sessions, astreintes.
    const planifies = jours.flatMap(jour => { const c = parCle.get(`${empId}|${jour}`); return c ? [{ jour, horaire: horaireDuCreneau(c) }] : []; });
    const conflits = planificateur ? conflitsPlanning(d, empId, planifies, premier, dernier) : [];
    const cases = jours.map((jour): CaseEquipe => {
      const c = parCle.get(`${empId}|${jour}`) ?? null;
      const absent = planificateur && etatPourPlanificateur({ empId, jour, horaire: null }, absences) === 'absent';
      const ferie = isFerie(jour) ? ' · jour férié' : '';
      if (absent) return { jour, etat: 'absent', marque: 'A', brouillon: !!c && c.statut === 'brouillon', creneau: c, texte: `${jourLong(jour)} — absent (absence en vigueur)${c?.horaire ? `, poste ${c.horaire} prévu` : ''}${ferie}` };
      if (!c) return { jour, etat: 'vide', marque: '', brouillon: false, creneau: null, texte: `${jourLong(jour)} — rien de planifié${ferie}` };
      const brouillon = c.statut === 'brouillon';
      const etat: EtatCase = c.horaire ? 'poste' : 'repos';
      const suite = brouillon ? (c.remplaceId ? ', modification à publier' : ', brouillon à publier') : `, publié${c.version ? ` (version ${c.version})` : ''}`;
      const conflit = conflitsDuJour(conflits, empId, jour).map(x => x.texte.slice(x.texte.indexOf(' : ') + 3));
      return {
        jour, etat, marque: c.horaire ?? 'R', brouillon, creneau: c, conflit: conflit.length > 0,
        texte: `${jourLong(jour)} — ${c.horaire ? `poste ${posteTexte(c)}` : 'repos'}${suite}${ferie}${conflit.length ? ` ; conflit : ${conflit.join(' ; ')}` : ''}`,
      };
    });
    const postes = cases.filter(x => x.etat === 'poste');
    const heures = postes.reduce((n, x) => { const h = horaireDuCreneau(x.creneau!); return n + (h ? dureeHoraire(h) : 0); }, 0);
    const brouillons = cases.filter(x => x.brouillon).length;
    const absents = cases.filter(x => x.etat === 'absent').length;
    const resume = [postes.length ? plural(postes.length, 'poste', 'postes') : 'Aucun poste', postes.length ? fH(heures) : '', absents ? plural(absents, 'jour d’absence', 'jours d’absence') : '', brouillons ? `${brouillons} à publier` : '']
      .filter(Boolean).join(' · ');
    return { empId, nom, cases, resume };
  });
  if (aPourvoir.length) {
    const cases = jours.map((jour): CaseEquipe => {
      const l = aPourvoir.filter(c => c.jour === jour);
      if (!l.length) return { jour, etat: 'vide', marque: '', brouillon: false, creneau: null, texte: `${jourLong(jour)} — aucun poste à pourvoir` };
      const brouillon = l.some(c => c.statut === 'brouillon');
      return {
        jour, etat: 'a_pourvoir', marque: l.length > 1 ? String(l.length) : l[0].horaire ?? '?', brouillon, creneau: l[0],
        texte: `${jourLong(jour)} — ${plural(l.length, 'poste à pourvoir', 'postes à pourvoir')} : ${l.map(posteTexte).join(', ')}${brouillon ? ', à publier' : ''}`,
      };
    });
    lignes.push({ empId: null, nom: 'À pourvoir', cases, resume: plural(aPourvoir.length, 'poste à pourvoir', 'postes à pourvoir') });
  }
  // Couverture minimale par créneau (formations de l'équipe à chaque horaire tenu), absences retirées pour le planificateur.
  const parCreneau = couvertureCreneaux(d.ds, equipe, jours, [...nominatifs, ...aPourvoir], planificateur);
  const court = (f: string) => d.fm(f)?.court ?? f;
  const couverture = jours.map((jour, i): CouvertureJour => {
    const parCode = new Map<string, number>();
    for (const l of lignes) {
      const x = l.cases[i];
      if (l.empId != null && x.etat === 'poste' && x.creneau?.horaire) parCode.set(x.creneau.horaire, (parCode.get(x.creneau.horaire) ?? 0) + 1);
    }
    const besoins = new Map<string, number>();
    for (const code of new Set([...parCode.keys(), ...(d.ds.besoinsPoste ?? []).filter(b => b.equipe === equipe).map(b => b.horaire)])) {
      const min = besoinsDuJour(d.ds.besoinsPoste, equipe, code, jour).reduce((n, b) => n + b.effectifMin, 0);
      if (min) besoins.set(code, min);
    }
    const codes = [...new Set([...parCode.keys(), ...besoins.keys()])].sort();
    const manques = codes.filter(c => (parCode.get(c) ?? 0) < (besoins.get(c) ?? 0));
    const total = [...parCode.values()].reduce((a, b) => a + b, 0), min = [...besoins.values()].reduce((a, b) => a + b, 0);
    // Case courte : postes des horaires qui ont un besoin, sur ce besoin (« !1/2 » : un poste du matin sur deux).
    const tenus = [...besoins.keys()].reduce((n, c) => n + (parCode.get(c) ?? 0), 0);
    const detail = codes.map(c => `${c} ${parCode.get(c) ?? 0}${besoins.has(c) ? ` sur ${besoins.get(c)}` : ''}`).join(', ');
    const formations = parCreneau.filter(x => x.jour === jour).flatMap(x => x.formations.filter(f => f.titulaires < f.min).map(f => `${court(f.formation)} au poste ${x.horaire} (${f.titulaires} sur ${f.min})`));
    const manque = manques.length > 0 || formations.length > 0;
    return {
      jour, manque, court: min ? `${manque ? '!' : ''}${tenus}/${min}` : `${formations.length ? '!' : ''}${total || ''}`,
      texte: `${jourLong(jour)} — ${total ? plural(total, 'poste planifié', 'postes planifiés') : 'aucun poste planifié'}${detail ? ` (${detail})` : ''}${manques.length ? ` : besoin non couvert pour ${manques.join(', ')}` : ''}${formations.length ? ` ; couverture minimale non tenue : ${formations.join(', ')}` : ''}`,
    };
  });
  return { lignes, couverture, brouillons: lignes.reduce((n, l) => n + l.cases.filter(c => c.brouillon).length, 0) };
}

/** Équipes dont le planning se montre : celles du référentiel où la personne voit au moins un salarié, ou qu'elle encadre. */
export function equipesDuPlanning(d: Domain, me: number | null, rh: boolean): string[] {
  const vues = new Set(d.ds.employes.map(e => e.equipe).filter((q): q is string => !!q));
  return d.ds.referentiels.equipes.filter(q => rh ? vues.has(q.nom) || (d.ds.creneauxAPourvoir ?? []).some(c => c.equipe === q.nom) : vues.has(q.nom) || q.managerId === me)
    .sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom)).map(q => q.nom);
}

// — Mon planning —

/**
 * Le salarié `empId` est-il lui-même planifié ? Un poste publié, une affectation au roulement ou un échange de poste qui le
 * concerne dans l'instantané : « Mon planning » s'ouvre alors aussi à un compte manager (membre d'une équipe en cycle).
 */
export function planifieLuiMeme(ds: { creneaux?: readonly Creneau[]; echangesPoste?: readonly EchangePoste[]; roulements?: readonly { empId: number }[] }, empId: number): boolean {
  return (ds.creneaux ?? []).some(c => c.empId === empId && c.statut === 'publie')
    || (ds.roulements ?? []).some(r => r.empId === empId)
    || (ds.echangesPoste ?? []).some(e => e.demandeurId === empId || e.partenaireId === empId);
}

export interface JourSalarie { jour: ISODate; creneau: Creneau | null; texte: string }

/** Postes publiés du salarié `empId`, jour par jour (un jour sans poste publié : rien, affiché vide comme un repos). */
export function joursDuSalarie(creneaux: readonly Creneau[] | undefined, empId: number, jours: readonly ISODate[]): JourSalarie[] {
  const siens = new Map((creneaux ?? []).filter(c => c.empId === empId && c.statut === 'publie').map(c => [c.jour, c]));
  return jours.map(jour => {
    const c = siens.get(jour) ?? null;
    return { jour, creneau: c, texte: c ? (c.horaire ? `Poste ${posteTexte(c)}${c.pause ? `, pause ${c.pause} min` : ''}` : 'Repos') : '—' };
  });
}

/** Échange vu par le salarié : son rôle et l'étape. */
export function echangeTexte(d: Domain, e: EchangePoste, me: number): string {
  const autre = d.personName(e.demandeurId === me ? e.partenaireId : e.demandeurId);
  const sens = e.demandeurId === me ? `proposé à ${autre}` : `proposé par ${autre}`;
  return `${sens} — ${STATUT_ECHANGE[e.statut]}`;
}

// — Affichage réglementaire (art. D3171-7) —

export interface Affichage {
  /** Horaire collectif : horaires tenus par l'équipe sur la période (code, libellé, plage, pause, durée). */
  horaires: { code: string; nom: string; plage: string; pause: number; duree: number }[];
  /** Composition nominative : pour chaque jour et chaque horaire, les salariés au poste. */
  composition: { jour: ISODate; horaire: string; salaries: string[] }[];
  /** Groupes de roulement de l'équipe (cycle, groupe, salariés) en vigueur sur la période. */
  groupes: { cycle: string; groupe: string; salaries: string[] }[];
}

/**
 * Affichage de l'équipe `equipe` sur `jours`, d'après les postes publiés et les affectations en vigueur ; `historique` :
 * créneaux lus à la demande pour une période hors de la fenêtre de l'instantané.
 */
export function affichageEquipe(d: Domain, equipe: string, jours: readonly ISODate[], historique?: readonly Creneau[] | null): Affichage {
  const premier = jours[0], dernier = jours.at(-1)!;
  const publies = sourceCreneaux(d, historique).nominatifs.filter(c => c.statut === 'publie' && c.equipe === equipe && c.horaire && c.empId != null && c.jour >= premier && c.jour <= dernier);
  const codes = [...new Set(publies.map(c => c.horaire!))].sort();
  const horaires = codes.map(code => {
    const ref = horaireDe(d.ds.referentiels, code), h = ref ?? publies.map(horaireDuCreneau).find(x => x?.code === code) ?? null;
    return { code, nom: ref?.nom ?? code, plage: h ? plageTexte(h) : '', pause: h?.pause ?? 0, duree: h ? dureeHoraire(h) : 0 };
  });
  const composition = jours.flatMap(jour => codes.map(horaire => ({
    jour, horaire, salaries: publies.filter(c => c.jour === jour && c.horaire === horaire).map(c => d.personName(c.empId!)).sort((a, b) => a.localeCompare(b)),
  }))).filter(x => x.salaries.length);
  const parGroupe = new Map<string, { cycle: string; groupe: string; salaries: string[] }>();
  for (const r of (d.ds.roulements ?? []).filter(r => r.equipe === equipe && r.du <= dernier && (!r.au || r.au >= premier) && !(r.au && r.au < r.du))) {
    const cle = `${r.cycle}|${r.groupe}`;
    const g = parGroupe.get(cle) ?? { cycle: cycleDe(d.ds.cycles, r.cycle)?.nom ?? r.cycle, groupe: r.groupe, salaries: [] };
    g.salaries.push(d.personName(r.empId));
    parGroupe.set(cle, g);
  }
  const groupes = [...parGroupe.values()].map(g => ({ ...g, salaries: [...new Set(g.salaries)].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.cycle.localeCompare(b.cycle) || a.groupe.localeCompare(b.groupe));
  return { horaires, composition, groupes };
}

/** Fichier CSV de l'affichage : une ligne par jour et par horaire (aucun motif, aucune absence). */
export function csvAffichage(equipe: string, jours: readonly ISODate[], a: Affichage): { fichier: string; head: string[]; rows: string[][] } {
  const jma = (iso: ISODate) => iso.split('-').reverse().join('/');
  const plage = new Map(a.horaires.map(h => [h.code, h.plage]));
  return {
    fichier: `affichage-equipes-${equipe.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-${jours[0]}.csv`,
    head: ['Équipe', 'Jour', 'Horaire', 'Plage', 'Salariés'],
    rows: a.composition.map(x => [equipe, jma(x.jour), x.horaire, plage.get(x.horaire) ?? '', x.salaries.join(', ')]),
  };
}

// — Couverture minimale par poste planifié (étape 3 : tableau de bord du service RH, du référent HSE, de la lecture seule) —

export interface ManqueCreneau { equipe: string; jour: ISODate; horaire: string; manques: string[]; texte: string }

/**
 * Créneaux publiés des `n` prochains jours (à partir d'aujourd'hui) sous leur couverture minimale, toutes les équipes reçues
 * : effectif face au besoin de poste, titulaires des formations de couverture de l'équipe à chaque horaire tenu.
 * `avecAbsences` : absences en vigueur retirées (service RH seul) ; sinon couverture sans absences (référent HSE, paie,
 * lecture seule). `creneaux` : nombre de créneaux suivis (0 : aucun planning publié sur la période).
 */
export function couvertureAVenir(d: Domain, n: number, avecAbsences: boolean): { creneaux: number; manques: ManqueCreneau[] } {
  const jours = joursDe(d.ti, n);
  // Postes, repos et « à pourvoir » publiés : un jour sans rien de publié pour une équipe (semaine pas encore publiée,
  // brouillon) n'est pas suivi, même si l'équipe a des besoins de poste ce jour-là.
  const publies = [...(d.ds.creneaux ?? []), ...(d.ds.creneauxAPourvoir ?? [])].filter(c => c.statut === 'publie' && c.jour >= jours[0] && c.jour <= jours.at(-1)!);
  const court = (f: string) => d.fm(f)?.court ?? f;
  const equipes = d.ds.referentiels.equipes.filter(q => publies.some(c => c.equipe === q.nom)).sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom));
  let creneaux = 0;
  const manques: ManqueCreneau[] = [];
  for (const q of equipes) {
    for (const x of couvertureCreneaux(d.ds, q.nom, jours, publies, avecAbsences)) {
      creneaux++;
      if (x.manque) manques.push({ equipe: q.nom, jour: x.jour, horaire: x.horaire, manques: manquesCreneau(x, court), texte: creneauCouvertureTexte(x, court) });
    }
  }
  return { creneaux, manques: manques.sort((a, b) => a.jour.localeCompare(b.jour) || a.equipe.localeCompare(b.equipe) || a.horaire.localeCompare(b.horaire)) };
}
