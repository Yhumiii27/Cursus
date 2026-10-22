// Historique des délivrances d'habilitation (t115) : chaque délivrance et chaque renouvellement s'inscrit dans
// `habDelivrances`, le titre en vigueur restant la ligne de `habTitres` (Go / No Go, suspensions, pièces jointes). Au
// renouvellement, la délivrance précédente est close (`remplaceeLe`) avec la mesure en cours figée (suspension, retrait,
// date ; jamais le motif) : ses dates, son signataire et sa mesure ne sont plus perdus. Une délivrance antérieure à
// l'historique (titre repris, délivrance d'avant le lot 6 sans ligne) est inscrite au moment où elle est remplacée.
import { addMonths, iso, parse } from '../../shared/dates.ts';
import type { CurrentUser, HabDelivrance, HabTitre, ISODate } from '../../shared/types.ts';
import type { Db } from './db.ts';

/** Auteur de l'enregistrement : nom et fiche de la personne connectée (null : Cursus, reprise). */
export interface AuteurDelivrance { le: ISODate; auteur: string | null; auteurId: number | null }
/** Auteur d'une action : la personne connectée, sa fiche (salarié du compte, y compris dans l'espace RH). */
export const auteurDe = (user: CurrentUser, le: ISODate): AuteurDelivrance => ({ le, auteur: user.nom, auteurId: user.empId ?? user.salarieId ?? null });

/** Échéance d'une délivrance avec la validité de l'habilitation (mois) ; null si l'habilitation est inconnue. */
export function echeanceDelivrance(db: Db, h: string, delivree: ISODate): ISODate | null {
  const hm = db.get<{ validite: number }>('habilitations', h);
  return hm ? iso(addMonths(parse(delivree), hm.validite)) : null;
}

/**
 * Inscrit la nouvelle délivrance du titre `titreId` (écrite juste avant dans `habTitres`). `avant` : le titre tel qu'il
 * était (délivré ou non) ; s'il était délivré, sa délivrance est close à la date de la nouvelle, mesure figée.
 */
export function inscrireDelivrance(db: Db, avant: HabTitre | null | undefined, titreId: number, nouvelle: { empId: number; h: string; delivree: ISODate; par: string | null }, a: AuteurDelivrance): HabDelivrance {
  const ouvertes = db.where<HabDelivrance>('habDelivrances', 'titreId', titreId).filter(x => !x.remplaceeLe);
  if (avant?.delivree) {
    const fige = { remplaceeLe: nouvelle.delivree, mesure: avant.mesure ?? null, mesureDate: avant.mesure ? avant.mesureDate ?? null : null };
    if (ouvertes.length) ouvertes.forEach(x => db.update<HabDelivrance>('habDelivrances', x.id, fige));
    else {
      // Délivrance antérieure à l'historique : inscrite telle que le titre la portait, close aussitôt.
      db.insert<HabDelivrance>('habDelivrances', {
        empId: avant.empId, h: avant.h, titreId, delivree: avant.delivree, par: avant.par, expire: echeanceDelivrance(db, avant.h, avant.delivree),
        ...fige, le: a.le, auteur: null, auteurId: null,
      });
    }
  } else {
    // Titre jamais délivré (en attente) : une ligne ouverte égarée ne doit pas rester en vigueur.
    ouvertes.forEach(x => db.update<HabDelivrance>('habDelivrances', x.id, { remplaceeLe: nouvelle.delivree }));
  }
  return db.insert<HabDelivrance>('habDelivrances', {
    ...nouvelle, titreId, expire: echeanceDelivrance(db, nouvelle.h, nouvelle.delivree), remplaceeLe: null, mesure: null, mesureDate: null, ...a,
  });
}
