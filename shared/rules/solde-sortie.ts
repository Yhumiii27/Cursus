// Solde de sortie (t128, lot 5, chantier I) : état des compteurs d'un salarié à son dernier jour de contrat, montré au
// service RH avant de confirmer la sortie (client/src/dialogs/SortieDialog.tsx), photographié à l'enregistrement
// (`employe.sortie`, table `soldesSortie` : une correction ultérieure ne change pas ce qui a été transmis), imprimé et
// exporté depuis la fiche (client/src/solde-sortie.ts), puis émis dans le lot de paie du mois de la sortie quand les
// rubriques de sortie sont actives (server/src/actions/paie.ts). Cursus fait foi pour les compteurs après la reprise
// depuis Lucca (décision de l'entreprise) ; le montant de l'indemnité (règle du dixième ou maintien de salaire) reste
// calculé par Sage, qui ne reçoit que des jours et des heures.
// - Calcul : les règles des compteurs (shared/rules/conges.ts) appliquées à un instantané vu à la date de sortie
//   (`domaineALaDate`) : jour du calcul ramené à cette date, fin du contrat à cette date, absences entièrement
//   postérieures annulées comme le fait la sortie. Demi-journées comprises (imputation des CP au demi-jour).
// - Congés payés : solde de la période acquise (droits, reports non échus compris, moins jours pris et posés), et jours
//   acquis sur la période en cours jusqu'au mois de la sortie (un mois compte si le salarié est sous contrat à la
//   mi-mois, comme l'acquisition) moins les jours déjà pris par anticipation ; leur somme est l'indemnité compensatrice
//   (ICCP_J). Une période précédente pas encore clôturée est signalée : la clôture (report ou perte) décide de son reste.
// - RTT ou jours de repos : droit de l'année au prorata des mois sous contrat moins jours pris et posés ; un solde
//   négatif est signalé comme trop-pris, sans retenue automatique (RTT_SOLDE n'emporte qu'un solde positif).
// - Récupération en heures (RECUP_H) ; CET : solde, liquidé en entier par défaut (CET_LIQ ; l'accord sur le CET n'est
//   pas encore connu).
// - Lot de paie : un élément par rubrique de sortie active et quantité positive, sur la période du mois de la sortie
//   (ou la période ouverte s'il est clos) ; rubriques désactivées par défaut : le solde de tout compte se saisit alors
//   dans Sage. Un code Sage à confirmer bloque un lot réel (`rubriquesAConfirmer`).
import { RUBRIQUES_PAIE } from '../constants.ts';
import { addM } from '../dates.ts';
import { Domain } from '../domain.ts';
import { fJ, fmtIso } from '../format.ts';
import type { ElementSortiePaie, Employe, EtatSortie, ISODate, SoldeSortie } from '../types.ts';
import { absenceActive, periodeTexte } from './absences.ts';
import { concerneCp } from './clotures.ts';
import { acquisAu, anneeCp, cetInfo, cpInfo, periodeCp, recupInfo, rttAnneeClose, rttInfo, soldePeriode } from './conges.ts';
import { matriculeAffiche } from './matricules.ts';
import { moisDe, periodeOuverte, type RubriqueVue } from './paie.ts';

/** Rubriques internes du solde de sortie (RUBRIQUES_PAIE), dans l'ordre de l'état. */
export const RUBRIQUES_SORTIE = ['ICCP_J', 'RTT_SOLDE', 'RECUP_H', 'CET_LIQ'] as const;
export type RubriqueSortie = typeof RUBRIQUES_SORTIE[number];

/** Quantités au centième, comme le fichier de paie : aucun bruit de calcul dans un solde photographié. */
const r2 = (n: number) => Math.round(n * 100) / 100;
/** « 10,42 j », « 3,5 h » : au centième, comme le fichier de paie. */
export const quantiteTexte = (n: number, unite: 'j' | 'h') => `${r2(n).toLocaleString('fr-FR')} ${unite}`;

/**
 * Instantané vu au dernier jour du contrat `date` : jour du calcul ramené à cette date, fin du contrat à cette date
 * (prorata des RTT, mois acquis), absences et demandes entièrement postérieures annulées (`controleSortie` les annule).
 */
export function domaineALaDate(d: Domain, e: Employe, date: ISODate): { d: Domain; e: Employe } {
  const eS: Employe = { ...e, fin: date };
  return {
    e: eS,
    d: new Domain({
      ...d.ds, today: date,
      employes: d.ds.employes.map(x => (x.id === e.id ? eS : x)),
      absences: d.ds.absences.map(a => (a.empId === e.id && absenceActive(a) && a.du > date ? { ...a, statut: 'annulee' as const } : a)),
    }),
  };
}

/**
 * État des compteurs de `e` à sa date de sortie `date` (dernier jour du contrat). Le calcul suppose qu'aucune absence
 * ne suit la date : la sortie les annule (`domaineALaDate`).
 */
export function etatSortie(d: Domain, e: Employe, date: ISODate): EtatSortie {
  const x = domaineALaDate(d, e, date), dS = x.d, eS = x.e;
  const avertissements: string[] = [];
  const A = anneeCp(date), Y = Number(date.slice(0, 4));

  let cp: EtatSortie['cp'] = null;
  const ci = cpInfo(dS, eS);
  if (ci) {
    // Mois de la sortie compris s'il compte (sous contrat à la mi-mois) : jours acquis jusqu'au premier jour du mois suivant.
    const acquis = r2(acquisAu(dS, eS, A + 1, addM(`${date.slice(0, 7)}-01`, 1)));
    const solde = r2(ci.solde), anticipes = r2(ci.suivante), soldeEnCours = r2(acquis - anticipes);
    cp = { periode: A, droit: r2(ci.droit), pris: r2(ci.pris), poses: r2(ci.poses), solde, acquis, anticipes, soldeEnCours, total: r2(solde + soldeEnCours) };
    if (cp.total < 0) avertissements.push(`Congés payés pris au-delà des droits : ${fJ(-cp.total)}, à voir avec la paie (aucune retenue automatique).`);
    // Période précédente pas encore clôturée : son reste n'est pas dans le solde tant que la clôture n'a pas décidé.
    const close = dS.ds.clotures.some(c => c.empId === e.id && c.type === 'CP' && c.periode === A - 1);
    if (!close && concerneCp(dS, eS, A - 1)) {
      const reste = r2(soldePeriode(dS, eS, A - 1));
      if (reste > 0) avertissements.push(`Congés payés de la période ${periodeCp(A - 1)} pas encore clôturés : ${fJ(reste)} restants, hors du solde. Clôturez-la (report ou perte, Congés & absences), puis modifiez la sortie pour photographier de nouveau le solde.`);
    }
  }

  let rtt: EtatSortie['rtt'] = null;
  const ri = rttInfo(dS, eS, Y);
  if (ri) {
    const solde = r2(ri.solde);
    rtt = { annee: Y, label: ri.label, droit: r2(ri.droit), pris: r2(ri.pris), poses: r2(ri.poses), solde, tropPris: solde < 0 ? -solde : 0 };
    if (rtt.tropPris) avertissements.push(`${ri.label} ${Y} pris au-delà du droit au prorata : ${fJ(rtt.tropPris)} de trop, signalés à la paie, sans retenue automatique.`);
    const prec = !rttAnneeClose(dS, eS, Y - 1) ? rttInfo(dS, eS, Y - 1) : null;
    if (prec && r2(prec.solde) > 0) avertissements.push(`${prec.label} ${Y - 1} pas encore clôturés : ${fJ(prec.solde)} restants, hors du solde (clôture des RTT, Congés & absences).`);
  }

  const rc = recupInfo(dS, eS);
  const recup: EtatSortie['recup'] = rc ? { acquis: r2(rc.acq), pris: r2(rc.pris), poses: r2(rc.poses), solde: r2(rc.solde) } : null;

  const ct = cetInfo(dS, eS);
  // Compte vide (aucun placement, aucun solde repris) : pas de ligne.
  const cet: EtatSortie['cet'] = ct.eligible && r2(ct.total) !== 0 ? { cp: r2(ct.cp), rtt: r2(ct.rtt), repris: r2(ct.repris), total: r2(ct.total) } : null;

  // Demandes encore en attente avant la sortie : comptées comme posées, à valider ou refuser.
  dS.ds.absences.filter(a => a.empId === e.id && a.statut === 'demandee').forEach(a => {
    avertissements.push(`Demande de congé ${periodeTexte(a.du, a.au)} en attente : comptée comme posée ; validez-la ou refusez-la, puis modifiez la sortie pour photographier de nouveau le solde.`);
  });
  return { date, cp, rtt, recup, cet, avertissements };
}

/** Quantités du solde par rubrique de sortie : positives seulement (un trop-pris de RTT n'est pas retenu). */
export function quantitesSortie(etat: EtatSortie): { rubrique: RubriqueSortie; quantite: number }[] {
  const q: [RubriqueSortie, number | undefined][] = [
    ['ICCP_J', etat.cp?.total], ['RTT_SOLDE', etat.rtt?.solde], ['RECUP_H', etat.recup?.solde], ['CET_LIQ', etat.cet?.total],
  ];
  return q.filter((x): x is [RubriqueSortie, number] => x[1] != null && x[1] > 0).map(([rubrique, quantite]) => ({ rubrique, quantite }));
}

/** « CP à indemniser 12,5 j · RTT 2 j · récupération 3,5 h · CET 4 j » ; « aucun compteur à solder ». */
export function resumeEtat(etat: EtatSortie): string {
  const t: Record<RubriqueSortie, (n: number) => string> = {
    ICCP_J: n => `CP à indemniser ${quantiteTexte(n, 'j')}`, RTT_SOLDE: n => `${etat.rtt?.label ?? 'RTT'} ${quantiteTexte(n, 'j')}`,
    RECUP_H: n => `récupération ${quantiteTexte(n, 'h')}`, CET_LIQ: n => `CET ${quantiteTexte(n, 'j')}`,
  };
  const l = quantitesSortie(etat).map(x => t[x.rubrique](x.quantite));
  return l.length ? l.join(' · ') : 'aucun compteur à solder';
}

/**
 * Ligne de l'état (dialogue, fiche, impression, CSV) : compteur, unité, droit ou jours acquis, pris, posés, solde, et
 * rubrique de sortie qui l'emporte (null : ligne de détail).
 */
export interface LigneEtat {
  libelle: string; unite: 'j' | 'h'; droit: number | null; pris: number | null; poses: number | null; solde: number; rubrique: RubriqueSortie | null;
}

/** Lignes de l'état, dans l'ordre : congés payés (période acquise, en cours, à indemniser), RTT, récupération, CET. */
export function lignesEtat(etat: EtatSortie): LigneEtat[] {
  const l: LigneEtat[] = [];
  if (etat.cp) {
    const c = etat.cp;
    l.push({ libelle: `Congés payés ${periodeCp(c.periode)} (période acquise, reports non échus compris)`, unite: 'j', droit: c.droit, pris: c.pris, poses: c.poses, solde: c.solde, rubrique: null });
    l.push({ libelle: `Congés payés ${periodeCp(c.periode + 1)} en cours d’acquisition (jusqu’au mois de la sortie)`, unite: 'j', droit: c.acquis, pris: c.anticipes, poses: null, solde: c.soldeEnCours, rubrique: null });
    l.push({ libelle: 'Congés payés à indemniser (indemnité compensatrice)', unite: 'j', droit: null, pris: null, poses: null, solde: c.total, rubrique: 'ICCP_J' });
  }
  if (etat.rtt) {
    const r = etat.rtt;
    l.push({ libelle: `${r.label} ${r.annee} (droit au prorata)${r.tropPris ? ' — trop-pris, sans retenue' : ''}`, unite: 'j', droit: r.droit, pris: r.pris, poses: r.poses, solde: r.solde, rubrique: 'RTT_SOLDE' });
  }
  if (etat.recup) l.push({ libelle: 'Récupération (repos compensateur)', unite: 'h', droit: etat.recup.acquis, pris: etat.recup.pris, poses: etat.recup.poses, solde: etat.recup.solde, rubrique: 'RECUP_H' });
  if (etat.cet) l.push({ libelle: 'Compte épargne-temps (liquidé en entier)', unite: 'j', droit: etat.cet.total, pris: null, poses: null, solde: etat.cet.total, rubrique: 'CET_LIQ' });
  return l;
}

/** Période de paie d'un solde de sortie : mois de la sortie, ou la période ouverte s'il est déjà clos. */
export function periodeSortie(date: ISODate, today: ISODate, clotureJour = 0): string {
  return [moisDe(date), periodeOuverte(today, clotureJour)].sort().at(-1)!;
}

/**
 * Éléments de sortie d'un lot de la période `jusqua` : soldes photographiés qui n'ont encore suivi aucun lot, dont la
 * période vient au plus tard, une ligne par rubrique de sortie active et quantité positive, sous son code Sage. Un solde
 * sans rubrique active ne part pas : la paie le saisit dans Sage. Intérimaires exclus.
 */
export function elementsSorties(d: Domain, jusqua: string, table: readonly Pick<RubriqueVue, 'code' | 'codeSage' | 'active'>[]): ElementSortiePaie[] {
  const out: ElementSortiePaie[] = [];
  for (const s of d.ds.soldesSortie ?? []) {
    if (s.lotId != null || s.sage) continue;
    const e = d.emp(s.empId);
    if (!e || d.contratOf(e).interim) continue;
    const periode = periodeSortie(s.date, d.ti, d.ds.settings?.clotureJour ?? 0);
    if (periode > jusqua) continue;
    for (const q of quantitesSortie(s.etat)) {
      const r = table.find(t => t.code === q.rubrique);
      if (r?.active) out.push({ sortie: s.id, empId: s.empId, matricule: matriculeAffiche(e), periode, rubrique: q.rubrique, codeSage: r.codeSage, quantite: q.quantite, date: s.date });
    }
  }
  return out.sort((a, b) => a.periode.localeCompare(b.periode) || a.empId - b.empId || RUBRIQUES_SORTIE.indexOf(a.rubrique as RubriqueSortie) - RUBRIQUES_SORTIE.indexOf(b.rubrique as RubriqueSortie));
}

/** Soldes d'un lot (identifiant, salarié), une fois chacun. */
export const sortiesDuContenu = (elements: readonly Pick<ElementSortiePaie, 'sortie' | 'empId'>[]) =>
  [...new Map(elements.map(x => [x.sortie, { id: x.sortie, empId: x.empId }])).values()];

/** Détail d'un élément de sortie (export des variables de la période) : « Solde de sortie au 31/10/2026 ». */
export const detailSortie = (x: Pick<ElementSortiePaie, 'date'>) => `Solde de sortie au ${x.date.split('-').reverse().join('/')}`;

/**
 * Où en est la transmission d'un solde photographié : parti dans un lot (à confirmer ou transmis), en attente du lot de sa
 * période, ou à saisir dans Sage faute de rubrique de sortie active.
 */
export function etatTransmission(s: Pick<SoldeSortie, 'date' | 'etat' | 'lotId' | 'sage'>, table: readonly Pick<RubriqueVue, 'code' | 'active'>[], today: ISODate, clotureJour = 0): string {
  if (s.sage) return `transmis à la paie (lot n° ${s.lotId})`;
  if (s.lotId != null) return `dans le lot de paie n° ${s.lotId}, import à confirmer`;
  const q = quantitesSortie(s.etat);
  if (!q.length) return 'aucun compteur à transmettre';
  const actives = q.filter(x => table.find(t => t.code === x.rubrique)?.active);
  if (!actives.length) return 'à saisir dans Sage (rubriques de sortie désactivées)';
  const reste = q.length - actives.length;
  return `en attente du lot de paie de ${periodeSortie(s.date, today, clotureJour)}${reste ? ` ; ${reste > 1 ? `${reste} compteurs` : '1 compteur'} à saisir dans Sage (rubrique désactivée)` : ''}`;
}

/** Libellé d'une rubrique de sortie (RUBRIQUES_PAIE). */
export const libelleSortie = (r: string) => RUBRIQUES_PAIE[r]?.label ?? r;

/** « Solde photographié le 10 oct. 2026 par Claire Martin ». */
export const photographieTexte = (s: Pick<SoldeSortie, 'le' | 'par'>) => `Solde photographié le ${fmtIso(s.le.slice(0, 10))} par ${s.par}`;
