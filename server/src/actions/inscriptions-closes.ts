// Inscriptions en formation initiale closes par une certification (`cert.ajouter`, `cert.modifier`), gardées sur elle
// (`Certification.inscriptionsCloses`) pour que sa correction ou son annulation (actions/corrections.ts) les rende :
// une certification saisie sur la mauvaise fiche ne fait plus perdre au salarié sa place à la session prévue.
import { sessionActive } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { fmt } from '../../../shared/format.ts';
import { inscriptionsARendre } from '../../../shared/rules/corrections.ts';
import type { Certification, Employe, Inscription } from '../../../shared/types.ts';
import type { Ctx } from './context.ts';

/** La certification obtenue clôt les inscriptions en formation initiale du salarié à la formation `f`, renvoyées pour être gardées sur elle. */
export function clore(ctx: Ctx, emp: Employe, f: string): Inscription[] {
  const closes = ctx.ds.inscriptions.filter(i => i.empId === emp.id && ctx.d.session(i.sessionId)?.formation === f);
  closes.forEach(i => ctx.db.remove('inscriptions', i.id));
  return closes;
}

/**
 * Inscriptions closes par la certification `c`, rendues quand elle est annulée ou change de formation (règles :
 * `inscriptionsARendre`). L'inscription revient telle qu'elle était, convocation comprise (la clôture n'avait pas envoyé
 * d'annulation) ; session annulée ou clôturée depuis : à replanifier. Session qui ne l'accueille plus (complète, passée,
 * conflit) : le message dit de réinscrire le salarié.
 */
export function rendre(ctx: Ctx, emp: Employe, c: Certification, certsApres: readonly Certification[]): string[] {
  return inscriptionsARendre(ctx.d, emp, c, certsApres).map(({ i, s, refus }) => {
    const quoi = `${ctx.d.fm(s.formation)?.court ?? s.formation}`;
    if (refus) return `inscription ${quoi} à la session du ${fmt(parse(s.date))} close par cette certification : retour impossible (${refus}), salarié à réinscrire`;
    // Même identifiant, sauf s'il a été repris depuis par une autre inscription.
    const id = ctx.ds.inscriptions.some(x => x.id === i.id) ? undefined : i.id;
    ctx.db.insert<Inscription>('inscriptions', { id, empId: emp.id, sessionId: i.sessionId, convoc: i.convoc, date: i.date, convocLe: i.convocLe ?? null });
    return sessionActive(s) ? `inscription ${quoi} à la session du ${fmt(parse(s.date))} rétablie` : `formation initiale ${quoi} de nouveau à replanifier`;
  });
}
