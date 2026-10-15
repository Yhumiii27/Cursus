// Sortie d'un salarié (démission, rupture conventionnelle, licenciement, fin de CDD…), pour tous les contrats, CDI
// compris : le service RH enregistre la date (dernier jour du contrat, `fin`) et le motif, en liste fermée. Cursus
// annule ce qui était prévu après le départ (absences, Keystone prévenu ; inscriptions aux sessions, convocations
// annulées par e-mail ; entretiens planifiés ; demandes de visite médicale), retire les feuilles vides des semaines
// suivantes et ferme les sessions de connexion d'une sortie déjà passée. Passé la date, le salarié ne se connecte plus et
// quitte la conformité, les échéances et les tableaux de bord (shared/rules/contrats.ts) ; sur les chantiers, il reste en
// « No Go CONTRAT » pour Keystone (verdicts recalculés après l'action). Une sortie saisie par erreur s'annule.
import { fmtIso } from '../../../shared/format.ts';
import { controleSortie, effetsSortie, estMotifSortie, finContrat, MOTIFS_SORTIE } from '../../../shared/rules/contrats.ts';
import type { Certification, DemandeVisite, Absence, Employe } from '../../../shared/types.ts';
import { revokeSessionsOf } from '../auth.ts';
import { adminsActifs, type Compte, refusDuCompte } from '../comptes.ts';
import { absenceKeystone, sendToKeystone } from '../integrations/keystone.ts';
import { annulerSiConvoque } from '../notifications.ts';
import { ActionError, getEmp, refuserSoiMeme, requireRh, str, type ActionHandler, type Ctx } from './context.ts';

/** Cursus garde un administrateur RH en mesure de se connecter : sa sortie attend la désignation d'un autre. */
function dernierAdministrateur(ctx: Ctx, emp: Employe) {
  const comptes = ctx.db.where<Compte>('comptes', 'empId', emp.id);
  if (comptes.some(c => c.profilRh === 'rh_admin' && !refusDuCompte(ctx.db, c) && !adminsActifs(ctx.db, c.id))) {
    throw new ActionError(`${emp.nom} est le dernier administrateur RH actif : Cursus doit en garder un, désignez-en un autre d’abord (Comptes et accès)`);
  }
}

/**
 * Enregistre (ou modifie) la sortie : `id`, `date` (dernier jour du contrat), `motif` (MOTIFS_SORTIE). Refusée tant que
 * le salarié encadre une équipe, qu'une feuille porte des heures après la date ou qu'une absence est à cheval sur elle
 * (`controleSortie`). La fin prévue au contrat (CDD, mission, alternance) est gardée pour une annulation.
 */
const sortie: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.id);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas enregistrer votre propre sortie');
  const date = str(p.date), motif = str(p.motif);
  if (!date) throw new ActionError('Date de sortie requise');
  if (!estMotifSortie(motif)) throw new ActionError('Motif de sortie à choisir dans la liste');
  const c = controleSortie(ctx.d, emp, date);
  if (c.bloquants.length) throw new ActionError(c.bloquants.join(' '));
  dernierAdministrateur(ctx, emp);

  ctx.db.update<Employe>('employes', emp.id, { fin: date, motifSortie: motif, finPrevue: finContrat(emp) });
  // Fiche mise à jour d'abord : les convocations d'un salarié déjà parti ne lui sont plus envoyées (adresse close).
  c.absences.forEach(a => {
    ctx.db.update<Absence>('absences', a.id, { statut: 'annulee', annuleeLe: ctx.d.ti, annuleePar: ctx.user.nom, keystone: false });
    if (a.keystone) sendToKeystone(ctx.db, absenceKeystone('absence.annulee', a));
  });
  let annulees = 0;
  c.certs.forEach(x => {
    ctx.db.update<Certification>('certifications', x.id, { sessionId: null, convoc: null, convocLe: null });
    if (annulerSiConvoque(ctx, ctx.d.session(x.sessionId), emp, x)) annulees++;
  });
  c.inscriptions.forEach(i => {
    ctx.db.remove('inscriptions', i.id);
    if (annulerSiConvoque(ctx, ctx.d.session(i.sessionId), emp, i)) annulees++;
  });
  c.entretiens.forEach(x => ctx.db.remove('entretiens', x.id));
  c.visites.forEach(x => ctx.db.update<DemandeVisite>('demandesVisite', x.id, { statut: 'annulee', closeLe: ctx.d.ti, closePar: ctx.user.nom }));
  c.feuilles.forEach(f => ctx.db.remove('feuilles', f.id));
  // Sortie déjà passée : les sessions ouvertes sont fermées ; sinon, elles ne valent plus dès le lendemain (comptes.ts).
  const fermees = date < ctx.d.ti ? revokeSessionsOf(ctx.db, emp.id) : 0;

  const effets = effetsSortie(c);
  if (annulees) effets.push(annulees > 1 ? `${annulees} annulations de convocation envoyées par e-mail` : 'annulation de convocation envoyée par e-mail');
  if (fermees) effets.push('sessions de connexion fermées');
  const acces = date >= ctx.d.ti ? ` · accès à Cursus jusqu’au ${fmtIso(date)} inclus` : '';
  return {
    message: `Sortie de ${emp.nom} enregistrée le ${fmtIso(date)} — ${MOTIFS_SORTIE[motif]}${effets.map(x => ` · ${x}`).join('')}${acces}`,
    result: {
      annulations: {
        absences: c.absences.length, inscriptions: c.certs.length + c.inscriptions.length, entretiens: c.entretiens.length,
        visites: c.visites.length, feuilles: c.feuilles.length, sessions: fermees,
      },
    },
  };
};

/**
 * Annule une sortie saisie par erreur : la fin prévue au contrat est rétablie (aucune pour un CDI). Ce que la sortie a
 * annulé (absences, inscriptions, entretiens, demandes de visite) n'est pas rétabli : le message le rappelle.
 */
const annulerSortie: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.id);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas annuler votre propre sortie');
  if (!emp.motifSortie) {
    throw new ActionError(emp.fin ? 'Aucune sortie enregistrée : la fin prévue du contrat se modifie dans la fiche' : 'Aucune sortie enregistrée pour ce salarié');
  }
  // Fin prévue gardée par la sortie ; une fiche reprise d'un autre outil avec sa sortie n'en a pas : la date reste alors
  // la fin prévue d'un CDD, d'une mission ou d'une alternance, et un CDI n'en a plus.
  const fin = emp.finPrevue ?? (emp.typeContrat === 'cdi' ? null : emp.fin);
  ctx.db.update<Employe>('employes', emp.id, { fin, motifSortie: null, finPrevue: null });
  return `Sortie de ${emp.nom} annulée — ${fin ? `fin de contrat prévue le ${fmtIso(fin)}` : 'contrat sans date de fin'}`
    + ' · les absences, inscriptions, entretiens et demandes de visite annulés par la sortie ne sont pas rétablis';
};

export const sortiesActions: Record<string, ActionHandler> = {
  'employe.sortie': sortie,
  'employe.annulerSortie': annulerSortie,
};
