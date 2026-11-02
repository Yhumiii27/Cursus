// Planning d'équipe (lot 12, chantier C5, t192, étape 2) : contrôles d'un salarié sur une période, communs au serveur
// (planning.publier, planning.echange.valider : server/src/actions/planning.ts) et aux dialogues Publier et Valider un
// échange, qui les montrent avant l'envoi (aperçu calculé sur l'instantané du planificateur ; le serveur recalcule et décide).
// - Jours planifiés (`joursPlanifiesDe`) : les créneaux du salarié tels que le planificateur les voit (un par jour, le
//   brouillon qui remplacera une version publiée passant devant elle, brouillons des jours passés ignorés), sur la fenêtre
//   des contrôles (11 semaines avant la période pour la moyenne sur 12 semaines, 7 jours après pour le repos qui la suit).
// - Contrôles (`controlesSalarie`) : légaux (shared/rules/planning-controles.ts) sur ces jours, les jours d'absence en vigueur
//   ignorés sans en lire la nature ; habilitations et formations exigées par le poste, l'équipe et le besoin de poste du jour,
//   à la date de chaque créneau ; réserve d'aptitude neutre (jamais datée).
// - Aperçu d'une publication (`apercuPublication`) et d'un échange (`apercuEchange`) : refus, alertes à motiver,
//   informations, créneaux communiqués sous le délai de prévenance, semaines verrouillées.
import { addD, mondayOf } from '../dates.ts';
import type { Domain, EmpX } from '../domain.ts';
import type { Employe, ISODate } from '../types.ts';
import type { Creneau, EchangePoste } from '../types-planning.ts';
import { absenceBloque } from './absences.ts';
import { exigencesDe } from './exigences.ts';
import {
  besoinsDuJour, creneauxPlanificateur, horaireDuCreneau, postesApresEchange, prevenanceCreneau, refusPublication, sansBrouillonsPasses,
} from './planning.ts';
import {
  type AlertePlanning, alertesHabilitations, controlesPlanning, JOURS_APRES, type JourPlanifie, reglagesPlanning, SEMAINES_AVANT, trierAlertes,
} from './planning-controles.ts';
import { statutNuit } from './repos-nuit.ts';
import { derogationDe } from './semaine.ts';

/** Premier et dernier jour lus autour d'une période pour ses contrôles. */
export const fenetreControles = (du: ISODate, au: ISODate): [ISODate, ISODate] => [addD(mondayOf(du), -7 * SEMAINES_AVANT), addD(au, JOURS_APRES)];

/**
 * Jours planifiés d'un salarié autour de la période (`creneaux` : au moins ceux de la fenêtre des contrôles), tels que le
 * planificateur les voit, avec `remplacer` appliqué (jour → créneau dont il prend l'horaire, null : repos).
 */
export function joursPlanifiesDe(creneaux: readonly Creneau[], empId: number, du: ISODate, au: ISODate, ti: ISODate,
  remplacer: ReadonlyMap<ISODate, Creneau | null> = new Map()): JourPlanifie[] {
  const [debut, fin] = fenetreControles(du, au);
  const siens = creneaux.filter(c => c.empId === empId && c.jour >= debut && c.jour <= fin);
  const parJour = new Map<ISODate, JourPlanifie>(creneauxPlanificateur(sansBrouillonsPasses(siens, ti)).map(c => [c.jour, { jour: c.jour, horaire: horaireDuCreneau(c) }]));
  for (const [jour, c] of remplacer) parJour.set(jour, { jour, horaire: c ? horaireDuCreneau(c) : null });
  return [...parJour.values()].sort((a, b) => a.jour.localeCompare(b.jour));
}

/**
 * Contrôles légaux et d'habilitation d'un salarié du `du` au `au` sur ses jours planifiés `jours` ; `ex` : sa fiche enrichie
 * (`Domain.enrich`, sortis compris), sans laquelle les habilitations ne sont pas contrôlées.
 */
export function controlesSalarie(d: Domain, emp: Employe, ex: Pick<EmpX, 'id' | 'habs' | 'rawCerts' | 'med'> | undefined, jours: readonly JourPlanifie[],
  du: ISODate, au: ISODate): AlertePlanning[] {
  const ds = d.ds;
  const absents = new Set<ISODate>();
  const premier = jours[0]?.jour, dernier = jours.at(-1)?.jour;
  if (premier && dernier) {
    for (const a of ds.absences.filter(x => x.empId === emp.id && absenceBloque(x) && x.au >= premier && x.du <= dernier)) {
      for (let j = a.du; j <= a.au; j = addD(j, 1)) absents.add(j);
    }
  }
  const c = d.contratOf(emp);
  const out = controlesPlanning({
    employe: emp, jours, du, au, reglages: ds.settings, derogationDominicale: !!derogationDe(ds, emp), absents,
    travailleurNuit: statutNuit(ds, emp.id, d.ti).travailleur, dureesExclues: c.dirigeant || c.forfait,
  });
  if (!ex) return out;
  const noms = {
    habilitation: (id: string) => ds.referentiels.habilitations.find(h => h.id === id)?.nom ?? id,
    formation: (id: string) => ds.referentiels.formations.find(f => f.id === id)?.court ?? id,
  };
  const base = exigencesDe(ds, emp);
  const travailles = jours.filter(j => j.horaire && j.jour >= du && j.jour <= au && !absents.has(j.jour)).map(j => {
    const propres = besoinsDuJour(ds.besoinsPoste, emp.equipe, j.horaire!.code, j.jour);
    return {
      jour: j.jour,
      exigences: {
        formations: [...new Set([...base.filter(x => x.type === 'formation').map(x => x.id), ...propres.flatMap(b => b.exigences.formations)])],
        habilitations: [...new Set([...base.filter(x => x.type === 'habilitation').map(x => x.id), ...propres.flatMap(b => b.exigences.habilitations)])],
      },
    };
  });
  return [...out, ...alertesHabilitations(ex, travailles, du, d.ti, noms)];
}

/** Fiches enrichies (sortis compris) indexées, pour les contrôles d'habilitation. */
export const fichesEnrichies = (d: Domain): Map<number, EmpX> =>
  new Map(d.enrich(d.ds.settings.horizonAlerte, d.ds.settings.uniquementReglementaire, { sortis: true }).map(e => [e.id, e]));

/** Ce qu'une publication va communiquer, et ce qui l'arrête ou demande un motif. */
export interface ApercuPublication {
  /** Période effective : au plus tôt aujourd'hui. */
  du: ISODate; au: ISODate;
  /** Brouillons de l'équipe sur la période (« à pourvoir » compris). */
  brouillons: Creneau[];
  salaries: number[];
  /** Semaines verrouillées (feuille validée, jour passé) : publication refusée. */
  verrou: string[];
  /** Créneaux nominatifs communiqués sous le délai de prévenance : motif des circonstances exceptionnelles exigé. */
  horsDelai: Creneau[];
  delai: number;
  alertes: ReturnType<typeof trierAlertes>;
}

/**
 * Aperçu de la publication du planning de l'équipe `equipe` du `du` au `au`, sur les créneaux de l'instantané (ceux du
 * planificateur : `creneaux` et `creneauxAPourvoir`). La publication part aujourd'hui : c'est le jour de l'e-mail.
 */
export function apercuPublication(d: Domain, equipe: string, duSaisi: ISODate, au: ISODate, fiches: ReadonlyMap<number, EmpX> = fichesEnrichies(d)): ApercuPublication {
  const ds = d.ds, ti = d.ti;
  const du = duSaisi < ti ? ti : duSaisi;
  const tous = [...ds.creneaux ?? [], ...ds.creneauxAPourvoir ?? []];
  const brouillons = au < du ? [] : tous.filter(c => c.equipe === equipe && c.statut === 'brouillon' && c.jour >= du && c.jour <= au).sort((a, b) => a.jour.localeCompare(b.jour));
  const salaries = [...new Set(brouillons.filter(c => c.empId != null).map(c => c.empId!))];
  const verrou = refusPublication(brouillons, ds.feuilles, ti, id => d.personName(id));
  const delai = reglagesPlanning(ds.settings).planningDelaiPrevenance;
  const horsDelai = brouillons.filter(c => c.empId != null && prevenanceCreneau(c.jour, ti, delai).horsDelai);
  const alertes: AlertePlanning[] = [];
  for (const empId of salaries) {
    const emp = d.emp(empId);
    if (emp) alertes.push(...controlesSalarie(d, emp, fiches.get(empId), joursPlanifiesDe(ds.creneaux ?? [], empId, du, au, ti), du, au));
  }
  return { du, au, brouillons, salaries, verrou, horsDelai, delai, alertes: trierAlertes(alertes) };
}

/**
 * Aperçu de la validation d'un échange de poste, sur l'instantané du valideur : refus (poste modifié ou annulé, collègue
 * qui travaille déjà le jour reçu), ou contrôles recalculés pour les deux salariés avec leurs postes échangés.
 */
export function apercuEchange(d: Domain, e: Pick<EchangePoste, 'demandeurId' | 'partenaireId' | 'creneauDemandeur' | 'creneauPartenaire'>,
  fiches: ReadonlyMap<number, EmpX> = fichesEnrichies(d)): { refus: string | null; alertes: ReturnType<typeof trierAlertes> } {
  const ds = d.ds, creneaux = ds.creneaux ?? [];
  const vide = trierAlertes([]);
  const a = creneaux.find(c => c.id === e.creneauDemandeur), b = e.creneauPartenaire ? creneaux.find(c => c.id === e.creneauPartenaire) : null;
  if (!a || a.statut !== 'publie' || a.empId !== e.demandeurId || (e.creneauPartenaire && (!b || b.statut !== 'publie' || b.empId !== e.partenaireId))) {
    return { refus: 'Un des postes a été modifié ou annulé depuis la proposition : l’échange sera annulé', alertes: vide };
  }
  const jours = [...new Set([a.jour, ...(b ? [b.jour] : [])])].sort();
  const actifs = creneauxPlanificateur(creneaux.filter(c => (c.empId === e.demandeurId || c.empId === e.partenaireId) && jours.includes(c.jour)));
  if (actifs.some(c => c.statut === 'brouillon')) return { refus: 'Une modification du planning de ces jours attend sa publication : publiez-la ou retirez-la d’abord', alertes: vide };
  const r = postesApresEchange(a as Creneau & { empId: number }, (b ?? null) as (Creneau & { empId: number }) | null, e.partenaireId, actifs);
  if (r.refus) return { refus: r.refus, alertes: vide };
  const alertes: AlertePlanning[] = [];
  for (const empId of [e.demandeurId, e.partenaireId]) {
    const emp = d.emp(empId);
    if (!emp) continue;
    const siens = new Map([...r.postes].filter(([k]) => k.startsWith(`${empId}|`)).map(([k, c]) => [k.slice(k.indexOf('|') + 1), c]));
    alertes.push(...controlesSalarie(d, emp, fiches.get(empId), joursPlanifiesDe(creneaux, empId, jours[0], jours.at(-1)!, d.ti, siens), jours[0], jours.at(-1)!));
  }
  return { refus: null, alertes: trierAlertes(alertes) };
}
