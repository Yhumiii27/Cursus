// Sortie d'un salarié (démission, rupture conventionnelle, licenciement, fin de CDD…), pour tous les contrats, CDI
// compris : le service RH enregistre la date (dernier jour du contrat, `fin`) et le motif, en liste fermée. Cursus
// annule ce qui était prévu après le départ (absences, Keystone prévenu ; inscriptions aux sessions, convocations
// annulées par e-mail ; entretiens planifiés ; demandes de visite médicale), retire les feuilles vides des semaines
// suivantes et ferme les sessions de connexion d'une sortie déjà passée. Passé la date, le salarié ne se connecte plus et
// quitte la conformité, les échéances et les tableaux de bord (shared/rules/contrats.ts) ; sur les chantiers, il reste en
// « No Go CONTRAT » pour Keystone (verdicts recalculés après l'action). Une sortie saisie par erreur s'annule.
// Solde de sortie (t128) : l'état des compteurs à la date est photographié à l'enregistrement et à chaque modification
// (server/src/soldes-sortie.ts), pour la paie ; une sortie dont le solde est dans un lot à confirmer ne change plus.
import { ouvreEspaceRh } from '../../../shared/constants.ts';
import { addD } from '../../../shared/dates.ts';
import { fmtIso } from '../../../shared/format.ts';
import { controleSortie, effetsSortie, estMotifSortie, finContrat, MOTIFS_SORTIE } from '../../../shared/rules/contrats.ts';
import type { Certification, DemandeVisite, Absence, Employe } from '../../../shared/types.ts';
import { revokeSessionsOf } from '../auth.ts';
import { adminsDurables, type Compte, refusDuCompte } from '../comptes.ts';
import { absenceKeystone, sendToKeystone } from '../integrations/keystone.ts';
import { annulerSiConvoque } from '../notifications.ts';
import { controlerSoldeSortie, photographierSortie, retirerSoldeSortie } from '../soldes-sortie.ts';
import { amorcer, cloreHistorique, rouvrirHistorique } from '../avenants.ts';
import { alerteAstreintes } from '../astreintes.ts';
import { promouvoirAttentes, retirerAttentesDe, retirerInscription } from '../liste-attente.ts';
import { ActionError, getEmp, refuserSoiMeme, requireRh, requireRhAdmin, str, type ActionHandler, type Ctx } from './context.ts';
// lot 12 — C3 (entretiens suivis)
import { detacherEntretien } from '../objectifs-entretien.ts';

/**
 * Sortie d'un membre de l'espace RH (service RH, référent HSE, paie, lecture seule) : elle ferme son compte, ce que seul
 * l'administrateur RH décide (Comptes et accès) ; un gestionnaire RH ne la saisit ni ne l'annule.
 */
async function compteRh(ctx: Ctx, emp: Employe) {
  if ((await ctx.db.where<Compte>('comptes', 'empId', emp.id)).some(c => ouvreEspaceRh(c.profilRh))) requireRhAdmin(ctx);
}

/**
 * Cursus garde un administrateur RH en mesure de se connecter : la sortie d'un administrateur attend qu'un autre reste
 * en place au-delà de la date (`adminsDurables` : une autre sortie déjà enregistrée à cette date ou avant ne compte pas).
 */
async function dernierAdministrateur(ctx: Ctx, emp: Employe, date: string) {
  const comptes = await ctx.db.where<Compte>('comptes', 'empId', emp.id);
  for (const c of comptes) {
    if (c.profilRh !== 'rh_admin' || await refusDuCompte(ctx.db, c) || await adminsDurables(ctx.db, c.id, date)) continue;
    throw new ActionError(`${emp.nom} est le dernier administrateur RH actif après le ${fmtIso(date)} : Cursus doit en garder un, désignez-en un autre d’abord (Comptes et accès)`);
  }
}

/**
 * Enregistre (ou modifie) la sortie : `id`, `date` (dernier jour du contrat), `motif` (MOTIFS_SORTIE). Refusée tant que
 * le salarié encadre une équipe, qu'une feuille porte des heures après la date ou qu'une absence est à cheval sur elle
 * (`controleSortie`). La fin prévue au contrat (CDD, mission, alternance) est gardée pour une annulation. L'état des
 * compteurs à la date est photographié (solde de sortie), sauf s'il est déjà parti à la paie.
 */
const sortie: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.id);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas enregistrer votre propre sortie');
  await compteRh(ctx, emp);
  const date = str(p.date), motif = str(p.motif);
  if (!date) throw new ActionError('Date de sortie requise');
  if (!estMotifSortie(motif)) throw new ActionError('Motif de sortie à choisir dans la liste');
  const c = controleSortie(ctx.d, emp, date);
  if (c.bloquants.length) throw new ActionError(c.bloquants.join(' '));
  await dernierAdministrateur(ctx, emp, date);
  await controlerSoldeSortie(ctx.db, emp);
  // Photographie calculée sur l'état d'avant la sortie (elle annule d'elle-même les absences postérieures).
  const solde = await photographierSortie(ctx, emp, date);

  // Historique des contrats (t074) : la date clôt la dernière ligne, les avenants programmés et les renouvellements prévus
  // après elle sont annulés.
  await amorcer(ctx.db, emp.id, ctx.d.ti);
  const { avenants, renouvellements } = await cloreHistorique(ctx.db, emp.id, date, ctx.d.ti);
  await ctx.db.update<Employe>('employes', emp.id, { fin: date, motifSortie: motif, finPrevue: finContrat(emp) });
  // Fiche mise à jour d'abord : les convocations d'un salarié déjà parti ne lui sont plus envoyées (adresse close).
  for (const a of c.absences) {
    await ctx.db.update<Absence>('absences', a.id, { statut: 'annulee', annuleeLe: ctx.d.ti, annuleePar: ctx.user.nom, keystone: false });
    if (a.keystone) await sendToKeystone(ctx.db, absenceKeystone('absence.annulee', a));
  }
  let annulees = 0;
  for (const x of c.certs) {
    await ctx.db.update<Certification>('certifications', x.id, { sessionId: null, convoc: null, convocLe: null });
    if (await annulerSiConvoque(ctx, ctx.d.session(x.sessionId), emp, x)) annulees++;
  }
  for (const i of c.inscriptions) {
    await retirerInscription(ctx, i.id);
    if (await annulerSiConvoque(ctx, ctx.d.session(i.sessionId), emp, i)) annulees++;
  }
  // Liste d'attente (lot 7, t120) : ses attentes de sessions qui finissent après son départ sont retirées ; les places qu'il
  // quitte (inscriptions annulées, place proposée) se proposent à la liste d'attente de leur session.
  const attentes = await retirerAttentesDe(ctx, emp, date);
  const promues = await promouvoirAttentes(ctx, [...c.certs.map(x => x.sessionId), ...c.inscriptions.map(i => i.sessionId), ...attentes.sessions]);
  for (const x of c.entretiens) {
    // lot 12 — C3 (entretiens suivis) : objectifs, demandes versées et feedback 360° de l'entretien retiré défaits d'abord.
    await detacherEntretien(ctx, x);
    await ctx.db.remove('entretiens', x.id);
  }
  for (const x of c.visites) await ctx.db.update<DemandeVisite>('demandesVisite', x.id, { statut: 'annulee', closeLe: ctx.d.ti, closePar: ctx.user.nom });
  for (const f of c.feuilles) await ctx.db.remove('feuilles', f.id);
  // Sortie déjà passée : les sessions ouvertes sont fermées ; sinon, elles ne valent plus dès le lendemain (comptes.ts).
  const fermees = date < ctx.d.ti ? await revokeSessionsOf(ctx.db, emp.id) : 0;

  const effets = effetsSortie(c);
  if (annulees) effets.push(annulees > 1 ? `${annulees} annulations de convocation envoyées par e-mail` : 'annulation de convocation envoyée par e-mail');
  if (fermees) effets.push('sessions de connexion fermées');
  if (attentes.n) effets.push(attentes.n > 1 ? `retiré de ${attentes.n} listes d’attente` : 'retiré de la liste d’attente');
  if (promues) effets.push(promues);
  if (avenants) effets.push(avenants > 1 ? `${avenants} avenants programmés annulés` : 'avenant programmé annulé');
  if (renouvellements) effets.push(renouvellements > 1 ? `${renouvellements} renouvellements du CDD sans effet annulés` : 'renouvellement du CDD sans effet annulé');
  effets.push(solde.texte);
  const acces = date >= ctx.d.ti ? ` · accès à Cursus jusqu’au ${fmtIso(date)} inclus` : '';
  // Astreintes planifiées au-delà de la sortie (t049) : à annuler ou raccourcir par le manager ou le service RH.
  const astreintes = alerteAstreintes(ctx.ds, emp.id, addD(date, 1), null);
  return {
    message: `Sortie de ${emp.nom} enregistrée le ${fmtIso(date)} — ${MOTIFS_SORTIE[motif]}${effets.map(x => ` · ${x}`).join('')}${acces}${astreintes}`,
    result: {
      annulations: {
        absences: c.absences.length, inscriptions: c.certs.length + c.inscriptions.length, entretiens: c.entretiens.length,
        visites: c.visites.length, feuilles: c.feuilles.length, sessions: fermees,
      },
      soldeSortie: solde.solde.id,
    },
  };
};

/**
 * Annule une sortie saisie par erreur : la fin prévue au contrat est rétablie (aucune pour un CDI). Ce que la sortie a
 * annulé (absences, inscriptions, entretiens, demandes de visite) n'est pas rétabli : le message le rappelle.
 */
const annulerSortie: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.id);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas annuler votre propre sortie');
  await compteRh(ctx, emp);
  await controlerSoldeSortie(ctx.db, emp);
  if (!emp.motifSortie) {
    throw new ActionError(emp.fin ? 'Aucune sortie enregistrée : la fin prévue du contrat se modifie dans la fiche' : 'Aucune sortie enregistrée pour ce salarié');
  }
  // Fin prévue gardée par la sortie ; une fiche reprise d'un autre outil avec sa sortie n'en a pas : la date reste alors
  // la fin prévue d'un CDD, d'une mission ou d'une alternance. Un CDI n'en a aucune, même devenu CDI depuis la sortie
  // (la fin du CDD gardée ne vaut plus).
  const fin = emp.typeContrat === 'cdi' ? null : emp.finPrevue ?? emp.fin;
  await ctx.db.update<Employe>('employes', emp.id, { fin, motifSortie: null, finPrevue: null });
  await rouvrirHistorique(ctx.db, emp.id);
  return `Sortie de ${emp.nom} annulée — ${fin ? `fin de contrat prévue le ${fmtIso(fin)}` : 'contrat sans date de fin'}`
    + ' · les absences, inscriptions, entretiens et demandes de visite annulés par la sortie ne sont pas rétablis' + await retirerSoldeSortie(ctx.db, emp);
};

export const sortiesActions = {
  'employe.sortie': sortie,
  'employe.annulerSortie': annulerSortie,
} satisfies Record<string, ActionHandler>;
