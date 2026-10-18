// Entretiens obligatoires (art. L6315-1, L3121-64) et campagne annuelle (réglages : shared/rules/campagne.ts).
import { ENT_TYPES } from '../constants.ts';
import { addD, addM, parse } from '../dates.ts';
import { fmt, fmtIso, norm } from '../format.ts';
import type { Domain } from '../domain.ts';
import type { Dataset, Employe, Entretien, EntretienType, ISODate } from '../types.ts';
import { campagne, concerneParCampagne } from './campagne.ts';
import type { Conflit } from './conflits.ts';
import { present } from './contrats.ts';
import { ageAu } from './mineurs.ts';

export type ObligStatus = 'late' | 'soon' | 'planifie' | 'todo' | 'ok';
export interface Obligation { id: number; e: Employe; kind: EntretienType; due: ISODate; detail: string; pl?: Entretien; st: ObligStatus; risk?: boolean }

export const ENT_ST: Record<ObligStatus, [string, string]> = {
  late: ['En retard', 'tag-accent'], soon: ['À échéance', 'tag-outline'], planifie: ['Planifié', 'tag-neutral'], todo: ['À planifier', 'tag-outline'], ok: ['À jour', 'tag-neutral'],
};

/** Libellé et classe d'une obligation : planifiée à une date passée sans avoir été close, « Planifié, date dépassée » (en retard). */
export const statutObligation = (o: Pick<Obligation, 'st' | 'pl'>): [string, string] =>
  o.pl && o.st === 'late' ? ['Planifié, date dépassée', 'tag-accent'] : ENT_ST[o.st];

/** « de congé parental », « d’absence longue » : élision devant une voyelle. */
const de = (s: string) => /^[aeiouy]/.test(norm(s)) ? `d’${s}` : `de ${s}`;

export function obligations(d: Domain, scopeIds: number[]): Obligation[] {
  const Ti = d.ti, in90 = addD(Ti, 90), Y = d.year;
  // Campagne annuelle réglée dans Paramètres → Campagne d’entretiens annuels (dates, population, affichage avant l'ouverture).
  const camp = campagne(d.ds.settings, Y);
  const out: Obligation[] = [];
  scopeIds.forEach(id => {
    const e = d.emp(id);
    // Salarié sorti : plus d'obligation d'entretien.
    if (!e || !present(e, d.ti)) return;
    const c = d.contratOf(e);
    if (c.interim) return;
    const list = d.ds.entretiens.filter(x => x.empId === id);
    const done = (t: EntretienType[]) => list.filter(x => t.includes(x.type) && x.statut === 'realise').sort((a, b) => b.date.localeCompare(a.date));
    const push = (kind: EntretienType, due: ISODate, detail: string, extra?: Partial<Obligation>) => {
      const pl = list.find(x => x.type === kind && x.statut === 'planifie');
      // Due après le départ (sortie enregistrée, fin de CDD…) et pas planifiée avant : plus d'obligation.
      if (!pl && !present(e, due)) return;
      // Planifié à une date passée sans avoir été clos (reporté, oublié) : en retard, comme s'il ne l'était pas.
      out.push({ id, e, kind, due, detail, pl, st: pl ? (pl.date < Ti ? 'late' : 'planifie') : due < Ti ? 'late' : due <= in90 ? 'soon' : 'ok', ...(extra || {}) });
    };
    const lastE = done(['epp', 'reprise'])[0];
    push('epp', lastE ? addM(lastE.date, 48) : addM(e.entree, 12),
      lastE ? `Dernier le ${fmt(parse(lastE.date))} · périodicité 4 ans` : `Embauche le ${fmt(parse(e.entree))} — premier entretien dans l’année`);
    if (e.repriseDate && !(lastE && lastE.date >= e.repriseDate)) {
      push('reprise', e.repriseDate, `Retour ${de(e.repriseMotif ?? 'congé')} le ${fmt(parse(e.repriseDate))} — à proposer systématiquement`);
    }
    let anniv = addM(e.entree, 96);
    while (anniv < addM(Ti, -12)) anniv = addM(anniv, 96);
    if (anniv <= addM(Ti, 12) && !done(['bilan']).some(x => x.date >= addM(anniv, -12))) {
      const from = addM(anniv, -96);
      const nE = list.filter(x => ['epp', 'reprise'].includes(x.type) && x.statut === 'realise' && x.date >= from).length;
      const fno = e.certs.some(cc => d.fm(cc.f).type !== 'Réglementaire' && cc.obtenue >= from);
      push('bilan', anniv, `${nE} entretien${nE > 1 ? 's' : ''} de parcours sur 8 ans (2 attendus) · ${fno ? 'formation non obligatoire suivie' : 'aucune formation non obligatoire'}`, { risk: nE < 2 || !fno });
    }
    if (c.forfait) {
      // Premier entretien dans l'année suivant l'entrée dans la convention de forfait.
      const debut = [e.entree, e.tempsDepuis ?? ''].sort().at(-1)!;
      const lf = done(['forfait']).filter(x => x.date >= debut)[0];
      push('forfait', lf ? addM(lf.date, 12) : addM(debut, 12), lf ? `Dernier le ${fmt(parse(lf.date))} · chaque année` : debut > e.entree ? `Forfait jours depuis le ${fmt(parse(debut))} — premier entretien dans l’année` : 'Aucun entretien enregistré');
    }
    // Entretien annuel de l'année planifié à une date passée sans avoir été clos (reporté pendant la campagne, oublié) :
    // en retard, « Planifié, date dépassée », comme les obligations ci-dessus (compteurs, récapitulatif des échéances).
    const annuels = list.filter(x => x.type === 'annuel' && x.date >= `${Y}-01-01`);
    const depasse = annuels.find(x => x.statut === 'planifie' && x.date < Ti);
    if (depasse && !annuels.some(x => x.statut === 'realise')) {
      out.push({ id, e, kind: 'annuel', due: camp.fin, pl: depasse, st: 'late', detail: camp.libelle });
    } else if (Ti >= camp.visibleDes && concerneParCampagne(d, e, camp) && present(e, camp.fin) && !annuels.length) {
      out.push({ id, e, kind: 'annuel', due: camp.fin, st: 'todo', detail: camp.libelle });
    }
  });
  return out;
}

/**
 * Sections supplémentaires « fin de carrière » à partir de 58 ans, âge atteint à la date de l'entretien (`ageAu` : âge
 * exact avec la date de naissance, âge atteint dans l'année avec l'année seule). Vues sans la date de naissance : la
 * réponse du serveur (`finCarriere`), pour que l'évaluateur voie les mêmes sections que le serveur accepte. Section déjà
 * rédigée : gardée, même si l'entretien a été reprogrammé avant l'anniversaire ou la date de naissance complétée depuis
 * (le texte saisi, voire signé, ne disparaît ni de l'écran ni du compte rendu imprimé).
 */
export function needsFinCarriere(_d: Domain, e: Employe, x: Pick<Entretien, 'type' | 'date' | 'finCarriere'> & { cr?: Record<string, string> }): boolean {
  if (typeof x.cr?.fincarriere === 'string' && x.cr.fincarriere.trim()) return true;
  if (!['epp', 'reprise'].includes(x.type)) return false;
  return typeof x.finCarriere === 'boolean' ? x.finCarriere : ageAu(e, x.date) >= 58;
}

/** Compte rendu commencé : une section au moins renseignée, par l'évaluateur ou par le salarié. */
export const crCommence = (x: Entretien) => Object.values(x.cr ?? {}).some(v => String(v ?? '').trim() !== '');

/**
 * Entretien du même type déjà planifié (un seul à la fois) : une nouvelle date le reprogramme, qu'il soit à venir (absence
 * accordée ce jour-là, empêchement…) ou passé sans avoir été clos. Passé, ou prévu aujourd'hui, avec un compte rendu
 * commencé, il a pu avoir lieu : il se clôt à sa date réelle (`entretien.clore`), ou n'est reprogrammé, avec son compte
 * rendu, que si l'évaluateur confirme qu'il n'a pas été tenu (`nonTenu`) — sans quoi un entretien tenu sortirait de
 * l'historique (échéances, état des lieux à 8 ans). `msg` : avertissement, ou blocage (même date, confirmation manquante).
 * Partagé par `entretien.planifier` et le dialogue de planification.
 */
export function reprogrammation(d: Domain, empId: number, type: EntretienType, date: ISODate, nonTenu = false): { prevu: Entretien | null; aConfirmer: boolean; msg: Conflit | null } {
  const prevu = d.ds.entretiens.find(x => x.empId === empId && x.type === type && x.statut === 'planifie') ?? null;
  if (!prevu) return { prevu, aConfirmer: false, msg: null };
  const nom = ENT_TYPES[type].nom, le = fmtIso(prevu.date);
  const aConfirmer = prevu.date <= d.ti && crCommence(prevu);
  const msg: Conflit = prevu.date === date ? { text: `${nom} déjà planifié à cette date`, bad: true }
    : aConfirmer && !nonTenu
      ? { text: `${nom} du ${le} au compte rendu commencé : s’il a eu lieu, clôturez-le à sa date réelle ; sinon, confirmez qu’il n’a pas été tenu pour le reprogrammer`, bad: true }
      : { text: `${nom} ${prevu.date < d.ti ? `prévu le ${le}, non tenu` : `déjà planifié le ${le}`} : il sera reprogrammé à cette date${crCommence(prevu) ? ', avec son compte rendu' : ''}`, bad: false };
  return { prevu, aConfirmer, msg };
}

/**
 * Date réelle admise à la clôture d'un entretien (`entretien.clore`) : aujourd'hui au plus tard et, au plus tôt, le jour où
 * il a été planifié ou reprogrammé (`planifieLe`) — sans quoi l'évaluateur pourrait dater de plusieurs années un entretien
 * planifié aujourd'hui et fausser l'échéance suivante et l'état des lieux à 8 ans. Planifié avant que Cursus conserve ce
 * jour : sa date prévue si elle est passée, sinon 30 jours avant aujourd'hui. Jamais avant l'entrée du salarié, ni le jour
 * du dernier entretien du même type réalisé ou avant. `raison` : la borne retenue, pour le message.
 */
export function debutCloture(d: Domain, x: Entretien): { min: ISODate; raison: string } {
  const e = d.emp(x.empId);
  const dernier = d.ds.entretiens.filter(y => y.empId === x.empId && y.type === x.type && y.statut === 'realise' && y.id !== x.id).map(y => y.date).sort().at(-1);
  const bornes = [
    x.planifieLe ? { min: x.planifieLe, raison: `entretien planifié le ${fmtIso(x.planifieLe)}` }
      : x.date <= d.ti ? { min: x.date, raison: `entretien prévu le ${fmtIso(x.date)}` }
      : { min: addD(d.ti, -30), raison: '30 jours au plus avant aujourd’hui' },
    ...(e ? [{ min: e.entree, raison: `entrée de ${e.nom} le ${fmtIso(e.entree)}` }] : []),
    ...(dernier ? [{ min: addD(dernier, 1), raison: `${ENT_TYPES[x.type].nom} déjà réalisé le ${fmtIso(dernier)}` }] : []),
  ];
  return bornes.reduce((a, b) => b.min > a.min ? b : a);
}

/**
 * Salariés dont les entretiens se suivent dans l'espace affiché : dans l'espace manager, son équipe sans lui-même — ses
 * propres entretiens relèvent de son responsable, et il les prépare et les signe dans son espace collaborateur ; ailleurs,
 * tout l'instantané (le RH, l'intéressé). Les salariés consultés en lecture seule (consultation N+2, t136) n'en font pas
 * partie : leurs entretiens relèvent de leur manager direct et ne sont pas transmis.
 */
export function perimetreEntretiens(ds: Pick<Dataset, 'user' | 'employes' | 'lectureSeule'>): number[] {
  const moi = ds.user.role === 'manager' ? ds.user.empId : null;
  const lecture = new Set(ds.lectureSeule ?? []);
  return ds.employes.filter(e => e.id !== moi && !lecture.has(e.id)).map(e => e.id);
}
