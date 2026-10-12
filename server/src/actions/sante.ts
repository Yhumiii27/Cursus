// Santé au travail : demandes de visite médicale et avis du médecin du travail (apte, restrictions, inapte).
// Service RH uniquement : le manager ne reçoit que le verdict et les restrictions en vigueur (dataset.ts),
// Keystone que le code de motif APTITUDE (shared/domain.ts, resourceStatus).
import { AVIS_MEDICAL, MOTIF_RESTRICTION, MOTIFS_VISITE } from '../../../shared/constants.ts';
import { parse } from '../../../shared/dates.ts';
import { fmt, plural } from '../../../shared/format.ts';
import { controlerAvis, estMotifVisite, motifParDefaut, suspendueParAvis } from '../../../shared/rules/sante.ts';
import type { DemandeVisite, Employe, HabTitre, HabType } from '../../../shared/types.ts';
import { signaler } from './conformite.ts';
import { ActionError, getEmp, requireRh, type ActionHandler, type Ctx } from './context.ts';

/**
 * Demande de visite au service de prévention et de santé au travail : enregistrée (date, motif, auteur) et suivie
 * jusqu'à la saisie de la visite (`medical.avis`) ; une seule en cours par collaborateur. Le service RH la transmet
 * avec la demande imprimable de la fiche du collaborateur.
 */
const demanderVisite: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.empId);
  const encours = ctx.d.demandeVisite(emp.id);
  if (encours) throw new ActionError(`Visite déjà demandée le ${fmt(parse(encours.le))} pour ${emp.nom}`);
  const motif = p.motif == null || p.motif === '' ? motifParDefaut(emp) : p.motif;
  if (!estMotifVisite(motif)) throw new ActionError('Motif de visite inconnu');
  const x = ctx.db.insert<DemandeVisite>('demandesVisite', { empId: emp.id, motif, le: ctx.d.ti, par: ctx.user.nom, statut: 'demandee', closeLe: null, closePar: null });
  return {
    message: `Visite médicale demandée — ${emp.nom} (${MOTIFS_VISITE[motif].court}) · demande à transmettre au service de santé au travail`,
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
 */
const enregistrerAvis: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.empId);
  const { avis: a, errors } = controlerAvis(p, ctx.d.ti);
  if (errors.length) throw new ActionError(errors.join(' '));
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

  ctx.db.update('employes', emp.id, { visite: a.date, avis: a.avis, restrictions: a.restrictions });
  // Suspension datée du jour de la décision, et non de la visite : le manager voit la date d'une mesure, jamais celle d'une visite.
  suspendre.forEach(({ t }) => ctx.db.update<HabTitre>('habTitres', t.id, {
    mesure: 'suspension', mesureDate: ctx.d.ti < t.delivree! ? t.delivree : ctx.d.ti, mesureMotif: MOTIF_RESTRICTION, mesurePar: ctx.user.nom,
  }));
  lever.forEach(({ t }) => ctx.db.update<HabTitre>('habTitres', t.id, { mesure: null, mesureDate: null, mesureMotif: null, mesurePar: null }));
  // La visite clôt les demandes qu'elle honore (faites au plus tard le jour de la visite).
  const closes = ctx.ds.demandesVisite.filter(x => x.empId === emp.id && x.statut === 'demandee' && x.le <= a.date);
  closes.forEach(x => ctx.db.update<DemandeVisite>('demandesVisite', x.id, { statut: 'realisee', closeLe: a.date, closePar: ctx.user.nom }));
  const { keystone } = signaler(ctx, emp);
  const suite = [
    suspendre.length ? plural(suspendre.length, 'habilitation suspendue', 'habilitations suspendues') : '',
    lever.length ? plural(lever.length, 'suspension levée', 'suspensions levées') : '',
    closes.length ? 'demande de visite close' : '',
  ].filter(Boolean).map(x => ` · ${x}`).join('');
  return `Avis du médecin du travail enregistré — ${emp.nom} · ${AVIS_MEDICAL[a.avis].court}, visite du ${fmt(parse(a.date))}${suite}${keystone}`;
};

export const santeActions: Record<string, ActionHandler> = {
  'medical.demander': demanderVisite,
  'medical.annuler': annulerVisite,
  'medical.avis': enregistrerAvis,
};
