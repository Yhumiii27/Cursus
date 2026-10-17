// Visites dues (t060) : visites médicales qu'un événement rend obligatoires, en plus du renouvellement périodique de
// l'aptitude (shared/rules/suivi-medical.ts). Cursus les signale de lui-même, datées, dans les échéances et le
// récapitulatif, avec l'action « Demander la visite » sur le bon motif.
// - Embauche (art. R4624-10) : dans les 3 mois qui suivent l'entrée ; avant l'affectation, donc le jour de l'entrée, pour
//   un suivi individuel renforcé (examen d'aptitude, art. R4624-24) ou un mineur (art. R4624-18). Une visite des 5 ans qui
//   précèdent l'embauche (2 ans en suivi renforcé) en dispense (art. R4624-15 et R4624-27), sauf avis d'inaptitude.
// - Reprise (art. R4624-31) : après tout congé de maternité et toute absence pour maladie professionnelle, quelle qu'en
//   soit la durée ; après 30 jours d'accident du travail ; après 60 jours de maladie ou d'accident non professionnel
//   (accident de trajet compris). Seuils de la loi, non réglables. Arrêts validés et jointifs réunis, les jours comptés
//   par catégorie : un accident du travail court prolongé par une maladie n'atteint ni l'un ni l'autre seuil.
// - Mi-carrière (art. L4624-2-2) : l'année civile des 45 ans, ou de l'âge fixé par accord (Paramètres → Santé).
// - Fin de carrière ou post-exposition (art. L4624-2-1, R4624-28-1) : sortie enregistrée d'un salarié en suivi renforcé
//   ou exposé à des risques particuliers (case du poste ou de la fiche), avant son départ. Sans case cochée, la sortie
//   d'un titulaire (ou d'un poste) d'une habilitation SIR ou ATEX ne donne qu'un rappel, jamais un blocage.
// Chaque visite due est close par une visite réalisée après l'événement : visite enregistrée (embauche, reprise), ou
// visite de ce motif enregistrée avec l'avis du médecin, demandée ou non (mi-carrière, fin de carrière : une visite
// périodique ne les remplace pas ; `demandeRealisee`, datée de la visite). Données de santé : le service RH et
// l'intéressé seulement ; le manager ne reçoit que « visite à programmer » (`visiteAProgrammer`, server/src/dataset.ts)
// pour l'embauche, la mi-carrière et la fin de carrière, jamais pour la reprise, qui trahirait la nature de l'arrêt.
import { addD, addMonths, iso, parse } from '../dates.ts';
import { fmtIso } from '../format.ts';
import type { Absence, Dataset, Employe, HabType, ISODate, MotifVisite } from '../types.ts';
import { lendemainOuvre } from './absences.ts';
import { posteDe } from './exigences.ts';
import { mineurAu } from './mineurs.ts';
import { actif } from './referentiels.ts';
import { suiviDe, type SuiviInfo } from './suivi-medical.ts';

/** Motifs d'une visite due à un événement (les autres motifs de demande, périodique et employeur, n'en sont pas). */
export type MotifVisiteDue = Extract<MotifVisite, 'embauche' | 'reprise' | 'mi_carriere' | 'fin_carriere'>;

/** Visite due : motif, échéance, événement qui l'ouvre, intitulé et précision (service RH et intéressé seulement). */
export interface VisiteDue {
  motif: MotifVisiteDue;
  /** Échéance : dernier jour où la visite doit avoir eu lieu (jour de l'entrée ou de la reprise pour une visite préalable). */
  le: ISODate;
  /** Événement : entrée, fin de l'arrêt, 1er janvier de l'année de mi-carrière, sortie. */
  depuis: ISODate;
  /** « Visite d’embauche », « Visite de reprise »… */
  label: string;
  /** « dans les 3 mois de l’entrée du 2 févr. 2026 », « après un arrêt de 45 jours »… (jamais transmis au manager). */
  detail: string;
}

/** Âge de la visite de mi-carrière à défaut d'accord de branche (art. L4624-2-2). */
export const MI_CARRIERE_AGE = 45;
/** Entrée en vigueur de la visite de mi-carrière (loi du 2 août 2021, 31 mars 2022) : aucune n'est due avant 2022. */
const MI_CARRIERE_DEPUIS = 2022;
/** Délai de la visite d'information et de prévention à l'embauche (art. R4624-10). */
const EMBAUCHE_MOIS = 3;
/** Visite antérieure à l'embauche qui en dispense : 5 ans (VIP, art. R4624-15), 2 ans en suivi renforcé (art. R4624-27). */
const DISPENSE_VIP_MOIS = 60;
const DISPENSE_SIR_MOIS = 24;
/**
 * Embauche suivie : au-delà de 2 ans d'ancienneté, une fiche sans aucune visite enregistrée reste « visite médicale non
 * renseignée » (dossier repris sans ses visites) plutôt qu'une visite d'embauche dépassée depuis des années.
 */
const EMBAUCHE_SUIVIE_MOIS = 24;

/**
 * Seuils de la visite de reprise (art. R4624-31), en jours d'absence par catégorie : maternité et maladie professionnelle
 * quelle que soit la durée (0), accident du travail 30 jours, maladie ou accident non professionnel 60 jours.
 */
type CategorieReprise = 'maternite' | 'mp' | 'at' | 'non_pro';
const CATEGORIE_REPRISE: Partial<Record<Absence['type'], CategorieReprise>> = { MATERNITE: 'maternite', MP: 'mp', AT: 'at', MALADIE: 'non_pro', ALD: 'non_pro', TRAJET: 'non_pro' };
const SEUILS_REPRISE: Record<CategorieReprise, number> = { maternite: 0, mp: 0, at: 30, non_pro: 60 };

type Contexte = { ds: Pick<Dataset, 'referentiels' | 'absences' | 'demandesVisite' | 'settings'>; ti: ISODate };
type Fiche = Pick<Employe, 'id' | 'entree' | 'fin' | 'visite' | 'avis' | 'naissance' | 'habs' | 'posteId' | 'poste' | 'suivi'>
  & Partial<Pick<Employe, 'naissanceLe' | 'mineur' | 'motifSortie' | 'aptitude' | 'expose'>>;

/**
 * Arrêts validés jointifs (le suivant commence au plus tard le lendemain du précédent), réunis en une seule absence ;
 * `jours` : jours calendaires de chaque catégorie (un jour couvert deux fois ne compte qu'une fois).
 */
interface Arret { du: ISODate; au: ISODate; jours: Map<CategorieReprise, Set<ISODate>> }
function arrets(absences: readonly Pick<Absence, 'empId' | 'type' | 'du' | 'au' | 'statut'>[], empId: number): Arret[] {
  const out: Arret[] = [];
  absences.filter(a => a.empId === empId && a.statut === 'validee' && CATEGORIE_REPRISE[a.type] && a.au >= a.du)
    .sort((a, b) => a.du.localeCompare(b.du))
    .forEach(a => {
      let x = out.at(-1);
      if (x && a.du <= addD(x.au, 1)) { if (a.au > x.au) x.au = a.au; } else out.push(x = { du: a.du, au: a.au, jours: new Map() });
      const cat = CATEGORIE_REPRISE[a.type]!, set = x.jours.get(cat) ?? new Set<ISODate>();
      for (let j = a.du; j <= a.au; j = addD(j, 1)) set.add(j);
      x.jours.set(cat, set);
    });
  return out;
}

/** L'arrêt ouvre une visite de reprise : une de ses catégories atteint son seuil, sur ses seuls jours. */
const repriseDue = (x: Arret) => [...x.jours].some(([cat, j]) => j.size >= SEUILS_REPRISE[cat]);

/** Habilitation qui signale un poste à risques particuliers : cochée « SIR » au référentiel, ou habilitation ATEX. */
const habRisque = (h: HabType | undefined) => !!h && actif(h) && (!!h.sir || /atex/i.test(`${h.id} ${h.nom}`));

/** Salarié exposé à des risques particuliers : case de sa fiche (service RH) ou de son poste (Référentiels). */
export const exposeDe = (ds: Pick<Dataset, 'referentiels'>, e: Pick<Employe, 'posteId' | 'poste'> & Partial<Pick<Employe, 'expose'>>) =>
  !!e.expose || !!posteDe(ds, e)?.expose;

/**
 * Visite de fin de carrière ou post-exposition à la sortie : due (suivi renforcé, ou exposé), ou simple rappel (habilitation
 * SIR ou ATEX détenue ou exigée par le poste, sans case « exposé » cochée), ou rien. Décès : rien.
 */
export function visiteDeSortie(ds: Pick<Dataset, 'referentiels'>, e: Fiche, motif: Employe['motifSortie'] | null, suivi: SuiviInfo = suiviDe(ds, e)):
  { due: boolean; label: string; rappel: string | null } | null {
  if (motif === 'deces') return null;
  const label = motif === 'retraite' ? 'Visite de fin de carrière' : 'Visite post-exposition';
  if (suivi.type === 'sir' || exposeDe(ds, e)) return { due: true, label, rappel: null };
  const ref = ds.referentiels.habilitations, hm = (id: string) => ref.find(h => h.id === id);
  const risques = [...new Set([
    ...e.habs.filter(t => t.delivree && t.mesure !== 'retrait').map(t => t.h),
    ...(posteDe(ds, e)?.habilitations ?? []),
  ])].map(hm).filter(habRisque);
  return risques.length
    ? { due: false, label, rappel: `Vérifier si une visite post-exposition est due (${risques.map(h => h!.nom).join(', ')}) : cochez « exposé à des risques particuliers » sur le poste ou la fiche pour la suivre (art. L4624-2-1).` }
    : null;
}

/**
 * Visite de ce motif réalisée à partir de `depuis` : demande close par l'avis du médecin du travail, ou visite enregistrée
 * avec ce motif sans demande préalable (`medical.avis`), datée de la visite (`closeLe`).
 */
const demandeRealisee = (d: Contexte, empId: number, motif: MotifVisite, depuis: ISODate) =>
  d.ds.demandesVisite.some(x => x.empId === empId && x.motif === motif && x.statut === 'realisee' && (x.closeLe ?? x.le) >= depuis);

/**
 * Ce que la sortie (date, motif) appelle côté santé au travail, en clair pour le dialogue de sortie seulement (rien au
 * message ni au journal de `employe.sortie`, qui ne doivent rien porter de médical) : la visite de fin de carrière ou
 * post-exposition à demander avant le départ, ou le rappel ; null sinon.
 */
export function texteVisiteSortie(d: Contexte, e: Fiche, date: ISODate, motif: Employe['motifSortie'] | ''): string | null {
  const v = visiteDeSortie(d.ds, e, motif || null);
  if (!v || (v.due && demandeRealisee(d, e.id, 'fin_carriere', e.entree))) return null;
  if (!v.due) return v.rappel;
  return date >= d.ti
    ? `${v.label} à demander avant le départ (art. L4624-2-1) : elle figure dans les échéances jusqu’au ${fmtIso(date)}.`
    : `${v.label} due (art. L4624-2-1) : départ passé, prévenez le service de prévention et de santé au travail.`;
}

/**
 * Visites dues d'un salarié, de la plus proche à la plus lointaine. Vue sans les données de santé (manager, profils
 * restreints : `aptitude` sans `visite`) : aucune, le serveur ne leur transmet que « visite à programmer ».
 */
export function visitesDues(d: Contexte, e: Fiche, suivi: SuiviInfo = suiviDe(d.ds, e)): VisiteDue[] {
  if (!e.visite && e.aptitude) return [];
  const out: VisiteDue[] = [];
  const sir = suivi.type === 'sir';

  // Embauche des 2 dernières années : close par une visite enregistrée depuis l'entrée ; une visite des 5 ans qui la
  // précèdent (2 ans en suivi renforcé) en dispense, hors avis d'inaptitude et sauf pour un mineur.
  const mineur = mineurAu(e, e.entree), prealable = sir || mineur;
  const dispense = !!e.visite && !mineur && e.avis !== 'inapte' && parse(e.visite) >= addMonths(parse(e.entree), -(sir ? DISPENSE_SIR_MOIS : DISPENSE_VIP_MOIS));
  const recente = parse(e.entree) > addMonths(parse(d.ti), -EMBAUCHE_SUIVIE_MOIS);
  if (recente && !(e.visite && e.visite >= e.entree) && !dispense) {
    out.push({
      motif: 'embauche', depuis: e.entree, label: 'Visite d’embauche',
      le: prealable ? e.entree : iso(addMonths(parse(e.entree), EMBAUCHE_MOIS)),
      detail: prealable
        ? `avant l’affectation au poste (${sir ? 'suivi individuel renforcé, art. R4624-24' : 'salarié mineur, art. R4624-18'}), entrée le ${fmtIso(e.entree)}`
        : `dans les 3 mois de l’entrée du ${fmtIso(e.entree)} (art. R4624-10)`,
    });
  }

  // Reprise : le dernier arrêt qui l'ouvre, sans visite enregistrée après sa fin.
  const arret = arrets(d.ds.absences, e.id).filter(repriseDue).at(-1);
  if (arret && arret.au >= e.entree && !(e.visite && e.visite > arret.au)) {
    const le = lendemainOuvre(arret.au);
    out.push({
      motif: 'reprise', depuis: arret.du, le, label: 'Visite de reprise',
      detail: `le jour de la reprise, au plus tard le ${fmtIso(addD(le, 8))}, après une absence du ${fmtIso(arret.du)} au ${fmtIso(arret.au)} (art. R4624-31)`,
    });
  }

  // Mi-carrière : l'année civile de l'âge réglé, salarié présent cette année-là ; suivie l'année même et la suivante (une
  // visite manquée plus ancienne ne fait plus d'alerte, comme à la reprise d'un dossier sans l'historique de ses visites).
  const age = Number.isFinite(d.ds.settings.santeMiCarriereAge) ? d.ds.settings.santeMiCarriereAge : MI_CARRIERE_AGE;
  const annee = e.naissance + age, cette = Number(d.ti.slice(0, 4));
  if (Number.isFinite(annee) && annee >= MI_CARRIERE_DEPUIS && annee >= cette - 1 && annee <= cette && annee >= Number(e.entree.slice(0, 4))
    && !demandeRealisee(d, e.id, 'mi_carriere', `${annee - 2}-01-01`)) {
    out.push({ motif: 'mi_carriere', depuis: `${annee}-01-01`, le: `${annee}-12-31`, label: 'Visite de mi-carrière', detail: `année des ${age} ans (art. L4624-2-2)` });
  }

  // Fin de carrière ou post-exposition : sortie enregistrée d'un salarié en suivi renforcé ou exposé, avant le départ.
  const sortie = e.motifSortie && e.fin ? visiteDeSortie(d.ds, e, e.motifSortie, suivi) : null;
  if (sortie?.due && !demandeRealisee(d, e.id, 'fin_carriere', e.entree)) {
    out.push({
      motif: 'fin_carriere', depuis: e.fin!, le: e.fin!, label: sortie.label,
      detail: `avant le départ du ${fmtIso(e.fin!)} (${sir ? 'suivi individuel renforcé' : 'exposition à des risques particuliers'}, art. L4624-2-1)`,
    });
  }
  return out.sort((a, b) => a.le.localeCompare(b.le));
}

/**
 * Motifs signalés au manager et aux profils restreints : ceux qui ne révèlent rien de la santé (entrée, âge, sortie). La
 * reprise en est exclue : ces lecteurs voient les dates de chaque absence, et, les seuils de l'art. R4624-31 étant connus,
 * « visite à programmer » après un arrêt court désignerait une maladie professionnelle ou une maternité (comme
 * `repriseMedicale` pour l'entretien de reprise) ; le service RH la suit seul.
 */
const MOTIFS_SIGNALES: readonly MotifVisiteDue[] = ['embauche', 'mi_carriere', 'fin_carriere'];

/**
 * « Visite à programmer » transmise au manager et aux profils restreints : une visite due d'un motif signalé
 * (`MOTIFS_SIGNALES`), échue ou sous l'horizon d'alerte, sans motif ni date (calculée par le serveur sur l'instantané complet).
 */
export function visiteAProgrammer(d: Contexte, e: Fiche): boolean {
  const limite = addD(d.ti, d.ds.settings.horizonAlerte ?? 90);
  return visitesDues(d, e).some(v => MOTIFS_SIGNALES.includes(v.motif) && v.le <= limite);
}
