// Délégation des validations d'un manager absent (t135) : message au suppléant le premier jour de la délégation, avec les
// demandes déjà en attente qui lui reviennent (congés demandés, feuilles soumises, entretiens planifiés si le périmètre les
// comprend). Envoyé à l'enregistrement d'une délégation qui commence aujourd'hui, sinon par les tâches de fond des e-mails
// (`tachesEmails`, server/src/notifications.ts) le jour de son début ; `annonceeLe` garde la trace de l'envoi.
// Les demandes faites ensuite sont notifiées au suppléant une à une (notifications.ts, `notifierSuppleants`).
import { ABS_LABEL, ENT_TYPES } from '../../shared/constants.ts';
import { isoWeek } from '../../shared/dates.ts';
import { fmtIso, plural } from '../../shared/format.ts';
import { delegationEnVigueur, delegationPour, perimetreEffectif, perimetreTexte } from '../../shared/rules/delegations-manager.ts';
import type { CurrentUser, Dataset, DelegationValidation } from '../../shared/types.ts';
import { todayIso } from './dataset.ts';
import type { Db } from './db.ts';
import { periodeLongue } from './messagerie.ts';
import { notifier } from './notifications.ts';
import { type Lecture, lectureDirecte } from './lecture-partagee.ts';

/** Lecture du périmètre complet, comme le service RH (tâche de fond). */
const SUIVI: CurrentUser = { role: 'rh', empId: null, nom: 'Cursus', intitule: 'Délégations des validations' };

const nom = (ds: Dataset, id: number) => ds.employes.find(e => e.id === id)?.nom ?? `salarié n° ${id}`;

/**
 * Demandes en attente dont le suppléant décide par cette délégation aujourd'hui, en une ligne chacune (jamais la nature
 * d'une absence de santé : seuls les congés se demandent).
 */
export function enAttenteDuSuppleant(ds: Dataset, g: DelegationValidation, jour: string): string[] {
  const par = (empId: number, p: 'absences' | 'feuilles' | 'entretiens') => {
    const e = ds.employes.find(x => x.id === empId);
    return !!e && delegationPour(ds, e, g.suppleantId, jour, p)?.id === g.id;
  };
  return [
    ...ds.absences.filter(a => a.statut === 'demandee' && par(a.empId, 'absences'))
      .map(a => `${nom(ds, a.empId)} : demande de ${ABS_LABEL[a.type].toLowerCase()} ${periodeLongue(a.du, a.au)}`),
    ...ds.feuilles.filter(f => f.statut === 'soumise' && par(f.empId, 'feuilles'))
      .map(f => `${nom(ds, f.empId)} : feuille de temps de la semaine ${isoWeek(f.week)}, soumise`),
    ...ds.entretiens.filter(x => x.statut === 'planifie' && par(x.empId, 'entretiens'))
      .map(x => `${nom(ds, x.empId)} : ${(ENT_TYPES[x.type]?.nom ?? 'entretien').toLowerCase()} planifié le ${fmtIso(x.date)}`),
  ];
}

/**
 * Message au suppléant au début de la délégation : période, périmètre, demandes déjà en attente. `cx` : contexte de
 * l'action (ou de la tâche de fond). Note l'envoi sur la délégation.
 */
export async function annoncerDelegation(cx: { db: Db; ds: Dataset; user: CurrentUser }, g: DelegationValidation): Promise<void> {
  const m = nom(cx.ds, g.managerId);
  const attente = enAttenteDuSuppleant(cx.ds, g, cx.ds.today);
  const perimetre = perimetreTexte(perimetreEffectif(cx.ds.settings, g));
  await notifier(cx, g.suppleantId, {
    type: 'delegation.debut',
    objet: `Vous remplacez ${m} jusqu’au ${fmtIso(g.au)} — validations déléguées`,
    texte: `${m} vous délègue ses validations (${perimetre}) ${periodeLongue(g.du, g.au)}. Pendant cette période, l’espace Manager de Cursus vous est ouvert `
      + 'pour décider à sa place ; vos propres demandes vont à son responsable, ou au service RH. Vos décisions sont signées « par délégation ».\n'
      + (attente.length ? `${plural(attente.length, 'demande attend', 'demandes attendent')} déjà une décision :\n${attente.map(x => `- ${x}`).join('\n')}\n` : 'Aucune demande n’attend de décision pour le moment.\n'),
  });
  await cx.db.update('delegations', g.id, { annonceeLe: new Date().toISOString() });
}

/**
 * Tâche de fond (dans la transaction de `tachesEmails`) : délégations en vigueur aujourd'hui pas encore annoncées.
 * Renvoie le nombre de suppléants prévenus.
 */
export async function annoncerDelegations(db: Db, lire: Lecture = lectureDirecte(db)): Promise<number> {
  const jour = todayIso();
  const a = (await db.all<DelegationValidation>('delegations')).filter(g => !g.annonceeLe && delegationEnVigueur(g, jour));
  if (!a.length) return 0;
  // Lecture partagée du passage du quart d'heure (server/src/lecture-partagee.ts) : noms et demandes en attente.
  const ds = await lire(SUIVI);
  for (const g of a) await annoncerDelegation({ db, ds, user: SUIVI }, g);
  return a.length;
}
