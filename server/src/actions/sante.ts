// Santé au travail : demandes de visite médicale et avis du médecin du travail (apte, restrictions, inapte).
// Service RH uniquement : le manager ne reçoit que le verdict et les restrictions en vigueur (dataset.ts),
// Keystone que le code de motif APTITUDE (shared/domain.ts, resourceStatus).
import { AVIS_MEDICAL, MOTIF_RESTRICTION, MOTIFS_VISITE } from '../../../shared/constants.ts';
import { parse } from '../../../shared/dates.ts';
import { fmt, plural } from '../../../shared/format.ts';
import { horsContratLe } from '../../../shared/rules/contrats.ts';
import { controlerAvis, estMotifVisite, motifParDefaut, suspendueParAvis } from '../../../shared/rules/sante.ts';
import { estSuiviMedical, SUIVIS_MEDICAUX } from '../../../shared/rules/suivi-medical.ts';
import { visitesDues } from '../../../shared/rules/visites-dues.ts';
import type { DemandeVisite, Employe, HabTitre, HabType, SuiviMedical } from '../../../shared/types.ts';
import { transmettreDemandeVisite } from '../notifications.ts';
import { signaler } from './conformite.ts';
import { ActionError, getEmp, requireRh, type ActionHandler, type Ctx } from './context.ts';

/**
 * Demande de visite au service de prévention et de santé au travail : enregistrée (date, motif, auteur) et suivie
 * jusqu'à la saisie de la visite (`medical.avis`) ; une seule en cours par collaborateur. Envoyée par e-mail au
 * service de santé au travail (adresse de Paramètres → Messagerie), dans la même transaction, sans aucune donnée
 * médicale (comme la demande imprimable) ; sans adresse, le service RH transmet la demande imprimée.
 */
const demanderVisite: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.empId);
  // Salarié sorti : plus de visite à demander (une demande faite avant la date reste suivie jusqu'au départ).
  const hors = horsContratLe(emp, ctx.d.ti);
  if (hors) throw new ActionError(hors);
  const encours = ctx.d.demandeVisite(emp.id);
  if (encours) throw new ActionError(`Visite déjà demandée le ${fmt(parse(encours.le))} pour ${emp.nom}`);
  // Sans motif : celui de la visite due la plus proche (embauche, reprise, mi-carrière, fin de carrière), sinon embauche
  // ou renouvellement.
  const motif = p.motif == null || p.motif === '' ? motifParDefaut(emp, visitesDues(ctx.d, emp)) : p.motif;
  if (!estMotifVisite(motif)) throw new ActionError('Motif de visite inconnu');
  const x = ctx.db.insert<DemandeVisite>('demandesVisite', { empId: emp.id, motif, le: ctx.d.ti, par: ctx.user.nom, statut: 'demandee', closeLe: null, closePar: null });
  const envoyee = transmettreDemandeVisite(ctx, emp, x);
  return {
    message: `Visite médicale demandée — ${emp.nom} (${MOTIFS_VISITE[motif].court}) · ${envoyee
      ? 'demande envoyée au service de santé au travail' : 'demande à imprimer pour le service de santé au travail (aucune adresse dans Paramètres → Messagerie)'}`,
    result: { id: x.id },
  };
};

/** Annule une demande en cours (faite par erreur, salarié sorti…) : le service RH peut en faire une nouvelle. */
const annulerVisite: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const x = ctx.ds.demandesVisite.find(v => v.id === Number(p.id));
  if (!x || x.statut !== 'demandee') throw new ActionError('Demande de visite introuvable ou déjà close');
  const emp = getEmp(ctx, x.empId);
  ctx.db.update<DemandeVisite>('demandesVisite', x.id, { statut: 'annulee', closeLe: ctx.d.ti, closePar: ctx.user.nom });
  return `Demande de visite annulée — ${emp.nom}`;
};

/** Titres désignés par leur type (liste sans doublon) : chacun doit être détenu par le collaborateur. */
function titres(ctx: Ctx, emp: Employe, v: unknown): { hm: HabType; t: HabTitre }[] {
  const ids = [...new Set(Array.isArray(v) ? v.map(String) : [])];
  return ids.map(h => {
    const hm = ctx.d.hm(h), t = emp.habs.find(x => x.h === h);
    if (!hm) throw new ActionError('Habilitation inconnue');
    if (!t?.delivree) throw new ActionError(`${emp.nom} ne détient pas ce titre : ${hm.nom}`);
    return { hm, t };
  });
}

/**
 * Avis du médecin du travail : visite (date), avis, restrictions recopiées telles qu'écrites et datées. Dans la même
 * écriture, le service RH suspend les habilitations incompatibles (motif « Restriction d'aptitude », sans détail) et
 * lève les suspensions décidées à un avis précédent ; la visite clôt la demande en cours. Un avis d'inaptitude rend
 * d'office non valides les habilitations qui exigent l'aptitude (prérequis) et bloque la ressource sur les chantiers.
 * `motif` (facultatif) : motif de la visite (mi-carrière, fin de carrière…), qui clôt la demande de ce motif quelle que
 * soit sa date, ou, sans demande, s'enregistre comme visite réalisée de ce motif (convocation directe du service de santé
 * au travail, visite antérieure à la mise en service) : la visite due qu'elle honore est close à sa vraie date.
 */
const enregistrerAvis: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.empId);
  const { avis: a, errors } = controlerAvis(p, ctx.d.ti);
  if (errors.length) throw new ActionError(errors.join(' '));
  const motif = p.motif == null || p.motif === '' ? null : p.motif;
  if (motif !== null && !estMotifVisite(motif)) throw new ActionError('Motif de visite inconnu');
  const suspendre = titres(ctx, emp, p.suspendre), lever = titres(ctx, emp, p.lever);
  const deux = suspendre.find(x => lever.some(y => y.hm.id === x.hm.id));
  if (deux) throw new ActionError(`${deux.hm.nom} : suspendre ou lever la suspension, pas les deux`);
  for (const { hm, t } of suspendre) {
    if (t.mesure) throw new ActionError(`${hm.nom} déjà ${t.mesure === 'retrait' ? 'retirée' : 'suspendue'} pour ${emp.nom}`);
  }
  if (lever.length && a.avis === 'inapte') throw new ActionError('Avis d’inaptitude : aucune suspension n’est levée');
  for (const { hm, t } of lever) {
    if (!suspendueParAvis(t)) throw new ActionError(`${hm.nom} n’est pas suspendue à la suite d’un avis du médecin du travail : levez la suspension depuis la fiche`);
  }

  // Prochaine visite fixée par le médecin : celle de cet avis, ou aucune (périodicité du type de suivi). Examen médical
  // d'aptitude du suivi renforcé : sa date, le dernier examen restant connu après une visite intermédiaire.
  ctx.db.update('employes', emp.id, {
    visite: a.date, avis: a.avis, restrictions: a.restrictions, prochaineVisite: a.prochaineVisite,
    ...(a.examen ? { examenAptitude: a.date } : {}),
  });
  // Suspension datée du jour de la décision, et non de la visite : le manager voit la date d'une mesure, jamais celle d'une visite.
  suspendre.forEach(({ t }) => ctx.db.update<HabTitre>('habTitres', t.id, {
    mesure: 'suspension', mesureDate: ctx.d.ti < t.delivree! ? t.delivree : ctx.d.ti, mesureMotif: MOTIF_RESTRICTION, mesurePar: ctx.user.nom,
  }));
  lever.forEach(({ t }) => ctx.db.update<HabTitre>('habTitres', t.id, { mesure: null, mesureDate: null, mesureMotif: null, mesurePar: null }));
  // La visite clôt les demandes qu'elle honore : faites au plus tard le jour de la visite, ou de son motif quelle que soit
  // leur date (demande faite après une visite déjà passée).
  const closes = ctx.ds.demandesVisite.filter(x => x.empId === emp.id && x.statut === 'demandee' && (x.le <= a.date || x.motif === motif));
  closes.forEach(x => ctx.db.update<DemandeVisite>('demandesVisite', x.id, { statut: 'realisee', closeLe: a.date, closePar: ctx.user.nom }));
  // Visite de mi-carrière ou de fin de carrière sans demande : enregistrée comme réalisée, datée de la visite, pour clore
  // la visite due (shared/rules/visites-dues.ts) ; les autres motifs se closent par la date de la visite elle-même.
  if ((motif === 'mi_carriere' || motif === 'fin_carriere') && !closes.some(x => x.motif === motif)) {
    ctx.db.insert<DemandeVisite>('demandesVisite', { empId: emp.id, motif, le: a.date, par: ctx.user.nom, statut: 'realisee', closeLe: a.date, closePar: ctx.user.nom });
  }
  const { keystone } = signaler(ctx, emp);
  const suite = [
    suspendre.length ? plural(suspendre.length, 'habilitation suspendue', 'habilitations suspendues') : '',
    lever.length ? plural(lever.length, 'suspension levée', 'suspensions levées') : '',
    closes.length ? 'demande de visite close' : '',
  ].filter(Boolean).map(x => ` · ${x}`).join('');
  return `Avis du médecin du travail enregistré — ${emp.nom} · ${AVIS_MEDICAL[a.avis].court}, visite du ${fmt(parse(a.date))}${suite}${keystone}`;
};

/**
 * Type de suivi médical saisi sur la fiche (service RH) : VIP, VIP adaptée ou suivi individuel renforcé ; vide : VIP par
 * défaut. Une habilitation ou un poste marqués « SIR » au référentiel placent le salarié en suivi renforcé quel que soit
 * le type saisi (shared/rules/suivi-medical.ts). `expose` (facultatif ; absent : inchangé) : salarié exposé à des risques
 * particuliers, visite post-exposition ou de fin de carrière à sa sortie (shared/rules/visites-dues.ts). Données réservées
 * au service RH et à l'intéressé : ni le manager, ni le journal ne les reçoivent.
 */
const suiviMedical: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.empId);
  const recu: unknown = p.suivi == null || p.suivi === '' ? null : p.suivi;
  if (recu !== null && !estSuiviMedical(recu)) throw new ActionError('Type de suivi inconnu : VIP, VIP adaptée ou suivi individuel renforcé');
  if (p.expose !== undefined && typeof p.expose !== 'boolean') throw new ActionError('Exposition à des risques particuliers : oui ou non');
  const suivi = recu as SuiviMedical | null;
  const expose = p.expose === undefined ? !!emp.expose : p.expose as boolean;
  if ((emp.suivi ?? null) === suivi && !!emp.expose === expose) return `Type de suivi médical inchangé — ${emp.nom}`;
  ctx.db.update('employes', emp.id, { suivi, expose });
  const { keystone } = signaler(ctx, emp);
  return `Type de suivi médical enregistré — ${emp.nom} · ${suivi ? SUIVIS_MEDICAUX[suivi].court : 'VIP par défaut'}${expose ? ' · exposé à des risques particuliers' : ''}${keystone}`;
};

export const santeActions = {
  'medical.demander': demanderVisite,
  'medical.annuler': annulerVisite,
  'medical.avis': enregistrerAvis,
  'medical.suivi': suiviMedical,
} satisfies Record<string, ActionHandler>;
