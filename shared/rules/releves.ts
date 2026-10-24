// Relevé hebdomadaire des heures des intérimaires, par agence d'intérim : heures des feuilles validées de la
// semaine (par jour, total, heures normales et majorées) et intérimaires dont la feuille attend sa validation.
// Envoyé chaque semaine à l'agence (CSV joint, server/src/releves.ts), consultable et renvoyable par le RH.
// Aucune nature d'absence : seul le nombre de jours d'absence de la semaine figure au relevé.
import { TYPES_CONTRAT } from '../constants.ts';
import { addD, isoWeek, mondayOf } from '../dates.ts';
import type { Domain } from '../domain.ts';
import { key } from '../format.ts';
import type { Employe, ISODate } from '../types.ts';
import { semaineHorsContrat } from './absences.ts';
import { calcSheet, joursAbsence } from './temps.ts';

export interface LigneReleve {
  empId: number; nom: string; poste: string;
  /** Heures du lundi au dimanche (semaine à 7 jours). */
  jours: number[];
  total: number; normal: number;
  /** Heures majorées : complémentaires à 10 % (temps partiel), à 25 % (supplémentaires ou complémentaires), supplémentaires à 50 %. */
  maj10: number; maj25: number; maj50: number;
  /** Jours d'absence de la semaine, du lundi au vendredi (congés, absence signalée ou qualifiée), sans leur nature. */
  absences: number;
}

export interface Releve {
  agence: string; semaine: ISODate;
  /** Intérimaires dont la feuille de la semaine est validée. */
  lignes: LigneReleve[];
  /** Intérimaires de l'agence sous contrat cette semaine dont la feuille n'est pas (encore) validée. */
  enAttente: { empId: number; nom: string }[];
  heures: number;
}

const h2 = (n: number) => Math.round(n * 100) / 100;

/** Intérimaires de l'agence (nom comparé sans casse ni accents) sous contrat au moins un jour de la semaine. */
export function interimairesDe(d: Domain, agence: string, semaine: ISODate): Employe[] {
  return d.ds.employes
    .filter(e => TYPES_CONTRAT[e.typeContrat]?.interim && key(e.agence) === key(agence) && !semaineHorsContrat(e, semaine))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

export function releveAgence(d: Domain, agence: string, semaine: ISODate): Releve {
  const lignes: LigneReleve[] = [], enAttente: Releve['enAttente'] = [];
  for (const e of interimairesDe(d, agence, semaine)) {
    const sh = d.ds.feuilles.find(f => f.empId === e.id && f.week === semaine);
    if (sh?.statut !== 'validee') { enAttente.push({ empId: e.id, nom: e.nom }); continue; }
    const c = calcSheet(d, e, sh);
    lignes.push({
      empId: e.id, nom: e.nom, poste: e.poste, jours: c.perDay.map(h2), total: h2(c.total), normal: h2(c.normal),
      maj10: h2(c.hc10), maj25: h2(c.sup25 + c.hc25), maj50: h2(c.sup50), absences: joursAbsence(d, e.id, semaine).slice(0, 5).filter(Boolean).length,
    });
  }
  return { agence, semaine, lignes, enAttente, heures: h2(lignes.reduce((n, l) => n + l.total, 0)) };
}

/**
 * Semaines révolues que l'envoi automatique rattrape : une feuille validée en retard (manager absent…) fait
 * encore partir le relevé de sa semaine, jusqu'à cinq semaines après.
 */
export const RATTRAPAGE_RELEVES = 5;

/**
 * Semaines dont le relevé part automatiquement (dès que toutes les feuilles sont validées) : les cinq semaines
 * précédentes, et la semaine en cours une fois son vendredi passé. Sans remonter avant la semaine qui précède
 * l'enregistrement de l'adresse de l'agence (`depuis`) : les relevés antérieurs lui sont parvenus autrement.
 */
export function semainesAutomatiques(today: ISODate, depuis?: ISODate | null): ISODate[] {
  const lundi = mondayOf(today);
  const debut = depuis ? addD(mondayOf(depuis), -7) : '';
  const out = Array.from({ length: RATTRAPAGE_RELEVES }, (_, i) => addD(lundi, -7 * (RATTRAPAGE_RELEVES - i)));
  if (addD(lundi, 4) < today) out.push(lundi);
  return out.filter(w => w >= debut);
}

/** Nombre d'heures pour le CSV et les textes : au centième (heures saisies au quart d'heure), virgule décimale. */
export const heuresTexte = (n: number) => String(h2(n)).replace('.', ',');

/** Relevé au format CSV (une ligne par intérimaire dont la feuille est validée) : nom du fichier, en-tête, lignes. */
export function releveCsv(r: Releve) {
  const head = ['Agence', 'Semaine', 'Du', 'Au', 'Intérimaire', 'Poste', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche', 'Total (h)',
    'Heures normales', 'Majorées 10 %', 'Majorées 25 %', 'Majorées 50 %', 'Jours d’absence'];
  const semaine = `${r.semaine.slice(0, 4)}-S${String(isoWeek(r.semaine)).padStart(2, '0')}`;
  const rows = r.lignes.map(l => [r.agence, semaine, r.semaine, addD(r.semaine, 6), l.nom, l.poste, ...l.jours.map(heuresTexte), heuresTexte(l.total),

    heuresTexte(l.normal), heuresTexte(l.maj10), heuresTexte(l.maj25), heuresTexte(l.maj50), String(l.absences)]);
  return { fichier: `releve-heures-${key(r.agence).replace(/ /g, '-') || 'agence'}-${r.semaine}.csv`, head, rows };
}
