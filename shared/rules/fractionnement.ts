// Fractionnement des congés payés (t046, lot 6, chantier 3) : congé principal et jours supplémentaires de fractionnement.
// - Congé principal (art. L3141-13 et L3141-18) : pris entre le 1er mai et le 31 octobre (période réglable, Paramètres →
//   Fractionnement des congés), dont une fraction d'au moins 12 jours ouvrables continus ; au plus 24 jours ouvrables
//   d'affilée (art. L3141-17, sauf dérogation individuelle). Contrôles de `checkAbsence` (shared/rules/conges.ts) : de
//   simples avertissements, jamais un refus.
// - Jours de fractionnement (art. L3141-23, règle supplétive) : 2 jours quand le salarié prend hors de la période au moins
//   6 jours ouvrables de son congé principal, 1 jour pour 3 à 5 ; la 5e semaine n'entre pas dans le calcul. Un accord
//   d'entreprise peut fixer d'autres règles ou y renoncer (art. L3141-21) : réglage `fractionnementRegle`, avec sa
//   référence. Le salarié peut y renoncer individuellement (art. L3141-19). Cursus ne crédite jamais d'office : il propose
//   les jours après la fin de la période, le service RH les confirme ou note la renonciation (`conges.fractionnement`,
//   server/src/actions/fractionnement.ts), sur le modèle de la clôture des congés au cas par cas.
// Unités : Cursus décompte en jours ouvrés (25 jours de la CCN), les seuils légaux sont en jours ouvrables. Conversion
// retenue : 5 ouvrés valent 6 ouvrables (24 ouvrables = 20 ouvrés, 12 ouvrables = 10 ouvrés, 6 ouvrables = 5 ouvrés,
// 3 ouvrables = 2,5 ouvrés). Le crédit, 1 ou 2 jours, est inscrit tel quel en jours ouvrés (plus favorable au salarié).
// Imputation : le calcul porte sur les jours imputés à la période de CP `A` (année de prise, `imputationCp`), quelle que soit
// leur date, comparés à la fenêtre de l'année `A` (du 1er mai au 31 octobre A). Cursus ouvre la période de prise au 1er juin :
// un congé pris du 1er au 31 mai A est imputé à la période A-1, dont la fenêtre (mai à octobre A-1) est passée — il compte
// donc comme pris hors période pour A-1 ; pris par anticipation sur A, il tombe dans la fenêtre de A.
// Périodes suivies : celles dont la fenêtre commence après la date d'arrêté des compteurs repris de l'ancien outil (les
// congés d'avant y sont des totaux, sans dates).
import { addD } from '../dates.ts';
import { fJ, plural } from '../format.ts';
import type { Domain } from '../domain.ts';
import type { Absence, Employe, ISODate, RegleFractionnement, Settings } from '../types.ts';
import type { DemiJournees } from './demi-journees.ts';
import { anneeCp, cpDroit, cpInfo, imputationCp, joursCp, periodeCp, soldePeriode, type JourCp } from './conges.ts';

/** Congé principal : 24 jours ouvrables (4 semaines), soit 20 ouvrés ; la 5e semaine n'ouvre pas de fractionnement. */
export const PRINCIPAL_OUVRES = 20;
/** Fraction continue du congé principal : 12 jours ouvrables, soit 10 ouvrés (art. L3141-18 et L3141-19). */
export const CONTINU_OUVRES = 10;
/** Congé pris en une seule fois : 24 jours ouvrables au plus, soit 20 ouvrés (art. L3141-17). */
export const MAX_CONTINU_OUVRES = 20;
/** Jours avant la fin de la période du congé principal à partir desquels l'écran signale ceux qui manquent. */
export const ALERTE_PRINCIPAL_JOURS = 60;
/** Jours de fractionnement qu'un crédit peut porter : 2 selon la loi ; davantage seulement si un accord le prévoit. */
export const CREDIT_MAX: Record<Exclude<RegleFractionnement, 'aucun'>, number> = { legal: 2, accord: 6 };

/** Jours ouvrables équivalents à des jours ouvrés (5 ouvrés = 6 ouvrables). */
export const ouvrables = (ouvres: number) => Math.round(ouvres * 6 / 5 * 100) / 100;

/** Règle des jours de fractionnement (réglage ; légale tant que l'administrateur RH ne l'a pas changée). */
export const regleFractionnement = (s: Partial<Settings> | undefined): RegleFractionnement => s?.fractionnementRegle ?? 'legal';

/** Période du congé principal de l'année `A` : du 1er mai au 31 octobre par défaut. */
export function fenetrePrincipale(s: Partial<Settings> | undefined, A: number): { du: ISODate; au: ISODate } {
  return { du: `${A}-${s?.fractionnementDebut ?? '05-01'}`, au: `${A}-${s?.fractionnementFin ?? '10-31'}` };
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** « 1er mai », « 31 octobre » : jour et mois d'une date, sans l'année. */
export function jourMois(s: ISODate): string {
  const j = Number(s.slice(8, 10));
  return `${j === 1 ? '1er' : j} ${MOIS[Number(s.slice(5, 7)) - 1]}`;
}

/**
 * Jours de fractionnement dus pour des jours ouvrés du congé principal pris hors de la période (règle légale, art.
 * L3141-23) : 2 pour 6 jours ouvrables ou plus, 1 pour 3 à 5, aucun en dessous.
 */
export function joursFractionnement(horsOuvres: number): number {
  const o = horsOuvres * 6 / 5 + 1e-9;
  return o >= 6 ? 2 : o >= 3 ? 1 : 0;
}

/**
 * Période suivie par Cursus pour le salarié : la fenêtre du congé principal commence à la date d'arrêté de ses compteurs
 * repris ou après (sans compteurs repris : toujours). Avant, les congés pris sont des totaux de l'ancien outil, sans dates.
 */
export function periodeSuivie(d: Domain, e: Employe, A: number): boolean {
  const arrete = d.ds.soldesReprise.find(s => s.empId === e.id)?.arreteLe ?? null;
  return !arrete || arrete <= fenetrePrincipale(d.ds.settings, A).du;
}

/** Congé payé posé ou à contrôler : dates et demi-journées. */
type CongeCp = { du: ISODate; au: ISODate } & DemiJournees;

/** Congé continu : jours décomptés (ouvrés, demi-journées 0,5), du premier au dernier jour ; `nouveau` : il contient la demande. */
export interface BlocConge { du: ISODate; au: ISODate; jours: { jour: ISODate; poids: number }[]; nouveau: boolean }

/**
 * Congés payés continus du salarié (validés et demandés, plus la demande `nouveau`) : deux congés se suivent quand aucun jour
 * décompté ne les sépare (week-ends, fériés et jour non travaillé compris dans la continuité) et qu'aucune demi-journée
 * travaillée ne les coupe (dernier jour au matin, premier jour l'après-midi).
 */
export function blocsConges(d: Domain, e: Employe, nouveau?: CongeCp): BlocConge[] {
  const conges = [
    ...d.ds.absences.filter(a => a.empId === e.id && a.type === 'CP' && (a.statut === 'validee' || a.statut === 'demandee')).map(a => ({ ...congeDe(a), nouveau: false })),
    ...(nouveau ? [{ ...nouveau, nouveau: true }] : []),
  ].sort((x, y) => x.du.localeCompare(y.du));
  const blocs: (BlocConge & { coupe: boolean })[] = [];
  for (const a of conges) {
    const jours = d.countedDays(e, a.du, a.au, 'CP', a);
    if (!jours.length) continue;
    const prev = blocs.at(-1);
    const suit = !!prev && !prev.coupe && a.debutDemi !== 'apres_midi' && a.du > prev.au && !d.countedDays(e, addD(prev.au, 1), addD(a.du, -1), 'CP').length;
    // Un congé qui s'arrête au matin (dernier jour, ou congé d'un seul matin) laisse l'après-midi travaillé : il coupe.
    const coupe = a.finDemi === 'matin' || (a.du === a.au && a.debutDemi === 'matin');
    if (prev && suit) Object.assign(prev, { au: a.au, jours: [...prev.jours, ...jours], coupe, nouveau: prev.nouveau || a.nouveau });
    else blocs.push({ du: a.du, au: a.au, jours, nouveau: a.nouveau, coupe });
  }
  return blocs.map(({ coupe: _, ...b }) => b);
}

const congeDe = (a: Absence): CongeCp => ({ du: a.du, au: a.au, debutDemi: a.debutDemi, finDemi: a.finDemi });

/**
 * État du fractionnement de la période `A` (année de prise) : jours de CP imputés sur elle (validés et demandés, plus la
 * demande `nouveau`) pris dans la période du congé principal (`dans`) et hors d'elle (`hors`), congé principal (`principal` :
 * 20 ouvrés au plus, sans la 5e semaine ni le supplément d'âge), jours du principal pris ou à prendre hors période
 * (`restant`), dont déjà posés (`joursHors`), crédit correspondant (`credit`) et crédit si tout le reste du principal se
 * prend hors période (`potentiel`) ; plus long congé continu dans la période (`plusLong`, jours imputés sur `A`), fraction
 * continue exigée (`besoin` : 10 ouvrés, ou tout le principal s'il est plus court) et son respect (`principalOk`).
 */
export function etatFractionnement(d: Domain, e: Employe, A: number, nouveau?: CongeCp, imp: JourCp[] = imputationCp(d, e, nouveau)) {
  const f = fenetrePrincipale(d.ds.settings, A), dansFenetre = (s: ISODate) => s >= f.du && s <= f.au;
  const surA = imp.filter(j => j.periode === A && !j.horsDroit);
  const poidsA = new Map<ISODate, number>();
  for (const j of surA) poidsA.set(j.jour, (poidsA.get(j.jour) ?? 0) + j.poids);
  const dans = joursCp(surA.filter(j => dansFenetre(j.jour))), hors = joursCp(surA.filter(j => !dansFenetre(j.jour)));
  const principal = Math.min(PRINCIPAL_OUVRES, cpDroit(d, e, A).acq);
  const restant = Math.max(0, principal - dans), joursHors = Math.min(hors, restant);
  const plusLong = Math.max(0, ...blocsConges(d, e, nouveau)
    .map(b => b.jours.filter(x => dansFenetre(x.jour)).reduce((n, x) => n + Math.min(x.poids, poidsA.get(x.jour) ?? 0), 0)));
  const besoin = Math.min(CONTINU_OUVRES, principal);
  return {
    periode: A, fenetre: f, principal, dans, hors, restant, joursHors, credit: joursFractionnement(joursHors), potentiel: joursFractionnement(restant),
    plusLong, besoin, principalOk: plusLong + 1e-9 >= besoin,
  };
}
export type EtatFractionnement = ReturnType<typeof etatFractionnement>;

/**
 * Avertissements d'une demande de congés payés (`checkAbsence`, `imp` : imputation avec la demande), jamais bloquants :
 * congé continu de plus de 24 jours ouvrables (art. L3141-17, dérogations individuelles rappelées) ; demande qui ne laisse
 * plus de quoi prendre la fraction continue du congé principal dans la période ; jours pris hors période qui ouvrent des
 * jours de fractionnement (sauf renonciation par accord collectif), à confirmer par le service RH.
 */
export function avertissementsFractionnement(d: Domain, e: Employe, nouveau: CongeCp, imp: JourCp[]): string[] {
  const out: string[] = [];
  const long = blocsConges(d, e, nouveau).find(b => b.nouveau && joursCp(b.jours) > MAX_CONTINU_OUVRES + 1e-9);
  if (long) {
    const n = joursCp(long.jours);
    out.push(`Congé continu de ${fJ(n)} ouvrés (${fJ(ouvrables(n))} ouvrables) : au-delà de 24 jours ouvrables d’affilée (art. L3141-17), seulement par dérogation individuelle — contraintes géographiques particulières, ou enfant ou adulte handicapé, ou personne âgée en perte d’autonomie au foyer.`);
  }
  const regle = regleFractionnement(d.ds.settings);
  const nouveaux = imp.filter(j => j.statut === 'nouveau' && !j.horsDroit);
  let avant: JourCp[] | null = null;
  for (const A of new Set(nouveaux.map(j => j.periode))) {
    if (!periodeSuivie(d, e, A)) continue;
    const apres = etatFractionnement(d, e, A, nouveau, imp), f = apres.fenetre;
    const periodeTxt = fenetreTexte(f);
    if (d.ti <= f.au && !apres.principalOk) {
      const reste = soldePeriode(d, e, A) - joursCp(nouveaux.filter(j => j.periode === A));
      if (reste + apres.plusLong < apres.besoin - 1e-9) {
        out.push(`Après cette demande, il ne resterait que ${fJ(Math.max(0, reste))} sur la période ${periodeCp(A)} : le congé principal d’au moins 12 jours ouvrables continus (${fJ(apres.besoin)} ouvrés) ${periodeTxt} ne pourrait plus être pris (art. L3141-18 et L3141-19).`);
      }
    }
    if (regle === 'aucun') continue;
    const sans = etatFractionnement(d, e, A, undefined, avant ??= imputationCp(d, e));
    if (apres.credit > sans.credit) {
      out.push(`Jours pris hors de la période du congé principal (${periodeTxt}) : ${plural(apres.credit, 'jour', 'jours')} de fractionnement (art. L3141-23)${regle === 'accord' ? ' selon la règle légale, à vérifier avec l’accord d’entreprise' : ''}, à confirmer par le service RH après le ${jourMois(f.au)}, sauf renonciation du salarié.`);
    }
  }
  return out;
}

/** Salarié présent à la date, hors intérim, dont Cursus tient les congés payés. */
const cpSuivis = (d: Domain, jour: ISODate) => d.ds.employes.filter(e => e.entree <= jour && (!e.fin || e.fin >= jour) && !!cpInfo(d, e));

/**
 * Salariés sans congé principal (fraction continue de 12 jours ouvrables, 10 ouvrés) dans la période de l'année en cours,
 * signalés pendant les `ALERTE_PRINCIPAL_JOURS` qui précèdent sa fin (écran Congés & absences) : présents à la fin de la
 * période, période suivie par Cursus. `reste` : solde de la période de CP encore à poser.
 */
export function principauxAPrevoir(d: Domain) {
  const A = d.year, f = fenetrePrincipale(d.ds.settings, A);
  if (d.ti < addD(f.au, -ALERTE_PRINCIPAL_JOURS) || d.ti > f.au) return [];
  return cpSuivis(d, f.au).filter(e => periodeSuivie(d, e, A))
    .map(e => ({ e, etat: etatFractionnement(d, e, A), reste: soldePeriode(d, e, A) }))
    .filter(x => x.etat.besoin > 0 && !x.etat.principalOk);
}

/**
 * Jours de fractionnement à proposer au service RH pour la période `A` (ou les périodes en cours et précédente, sans `A`),
 * après la fin de la période du congé principal : salariés présents, hors intérim, période suivie, ni clôturée ni déjà
 * décidée (crédit ou renonciation), dont le congé principal laisse au moins 2,5 jours ouvrés hors période (`potentiel`).
 * `propose` : jours proposés (le potentiel ; le service RH peut le réduire s'il reste des jours à prendre dans la période
 * suivante). Rien sous la règle « aucun jour » (accord collectif).
 */
export function fractionnementsAProposer(d: Domain, A?: number) {
  if (regleFractionnement(d.ds.settings) === 'aucun') return [];
  const enCours = anneeCp(d.ti);
  const periodes = (A != null ? [A] : [enCours - 1, enCours]).filter(P => P >= enCours - 1 && P <= enCours && d.ti > fenetrePrincipale(d.ds.settings, P).au);
  return periodes.flatMap(P => cpSuivis(d, d.ti)
    .filter(e => periodeSuivie(d, e, P) && !(d.ds.fractionnements ?? []).some(x => x.empId === e.id && x.periode === P)
      && !d.ds.clotures.some(c => c.empId === e.id && c.type === 'CP' && c.periode === P))
    .map(e => ({ e, periode: P, etat: etatFractionnement(d, e, P) }))
    .filter(x => x.etat.potentiel > 0)
    .map(x => ({ ...x, propose: x.etat.potentiel })));
}
export type LigneFractionnement = ReturnType<typeof fractionnementsAProposer>[number];

/** Propositions groupées par période, pour le bandeau de l'écran Congés & absences. */
export function fractionnementsAFaire(d: Domain) {
  const lignes = fractionnementsAProposer(d);
  return [...new Set(lignes.map(l => l.periode))].sort().map(periode => ({
    periode, fenetre: fenetrePrincipale(d.ds.settings, periode), lignes: lignes.filter(l => l.periode === periode),
  }));
}

/** Libellé d'une fenêtre : « du 1er mai au 31 octobre 2026 ». */
export const fenetreTexte = (f: { du: ISODate; au: ISODate }) => `du ${jourMois(f.du)} au ${jourMois(f.au)} ${f.au.slice(0, 4)}`;

/** Libellé de l'état d'un salarié : « 8 j ouvrés pris dans la période, 12 j hors période ». */
export const etatTexte = (x: EtatFractionnement) =>
  `${fJ(x.dans)} pris dans la période · ${fJ(x.joursHors)} du congé principal hors période${x.restant > x.joursHors ? ` · ${fJ(x.restant - x.joursHors)} restant à prendre` : ''}`;
