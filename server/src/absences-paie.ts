// Absences dans le fichier d'import de la paie (t028), côté serveur : éléments déjà emportés par les lots non annulés (lus
// dans leur contenu figé, que seul le serveur garde), absences réservées par un lot à confirmer, premier jour transmis par
// Cursus (clé `absencesPaieDepuis` de la table settings, posée par la migration lot5-paie-absences-anterieures sur une
// base reprise), éléments d'un nouveau lot, libération à l'annulation, résumé de l'instantané et ce qu'en reçoit chaque
// profil. Règles : shared/rules/absences-paie.ts.
import { droitsRh } from '../../shared/constants.ts';
import { Domain } from '../../shared/domain.ts';
import {
  absencesDansLeFichier, absencesParPeriode, elementsAbsences, type ElementCalcule, type ElementEmis,
} from '../../shared/rules/absences-paie.ts';
import { periodeDeLaFeuille } from '../../shared/rules/lots-paie.ts';
import { periodeOuverte, rubriquesPaie } from '../../shared/rules/paie.ts';
import { sagePending } from '../../shared/rules/temps.ts';
import type { Absence, AbsencesPaieAttente, CurrentUser, Dataset, ElementAbsencePaie, ISODate, LotPaie, RubriquePaie } from '../../shared/types.ts';
import type { Db } from './db.ts';
import type { LotEnregistre } from './lots-paie.ts';

/** Clé de la table settings : premier jour d'absence transmis par Cursus (null ou absente : tous). */
export const CLE_DEPUIS = 'absencesPaieDepuis';
export const lireDepuis = (db: Db): ISODate | null => db.getSetting<ISODate | null>(CLE_DEPUIS, null);

/** Éléments d'absence des lots non annulés, et absences réservées par un lot généré en attente de confirmation. */
export function emisEtReservees(db: Db): { emis: ElementEmis[]; reservees: Set<number> } {
  const emis: ElementEmis[] = [], reservees = new Set<number>();
  for (const lot of db.all<LotEnregistre>('lotsPaie')) {
    if (lot.statut === 'annule' || !lot.contenu?.absences?.length) continue;
    emis.push(...lot.contenu.absences);
    if (lot.statut === 'genere') lot.contenu.absences.forEach(x => reservees.add(x.absence));
  }
  return { emis, reservees };
}

/** Éléments d'absence d'un lot de la période `jusqua` (aucun si le réglage les laisse à Sage). */
export function absencesAEmettre(db: Db, d: Domain, jusqua: string): ElementCalcule[] {
  if (!absencesDansLeFichier(d.ds.settings)) return [];
  return elementsAbsences(d, { jusqua, ...emisEtReservees(db), depuis: lireDepuis(db) });
}

/** Rubrique interne → code Sage figé à la génération : null pour une rubrique désactivée (saisie dans Sage). */
export function traduireElements(elements: readonly ElementCalcule[], stockees: readonly RubriquePaie[]): ElementAbsencePaie[] {
  const table = rubriquesPaie(stockees);
  return elements.map(x => {
    const r = table.find(t => t.code === x.rubrique);
    return { ...x, codeSage: r ? (r.active ? r.codeSage : null) : x.rubrique };
  });
}

/** Absences d'un lot (identifiant, salarié), une fois chacune. */
export const absencesDuContenu = (elements: readonly Pick<ElementAbsencePaie, 'absence' | 'empId'>[]) =>
  [...new Map(elements.map(x => [x.absence, { id: x.absence, empId: x.empId }])).values()];

/**
 * Lot annulé : ses absences ne lui sont plus rattachées ; chacune reprend le dernier lot transmis qui l'a emportée, ou
 * aucun. Ce qu'il portait redevient en attente (écart recalculé au prochain lot).
 */
export function libererAbsences(db: Db, lot: Pick<LotPaie, 'id'> & { absences?: { id: number }[] }) {
  const transmis = db.all<LotEnregistre>('lotsPaie').filter(l => l.statut === 'transmis' && l.id !== lot.id).sort((a, b) => b.id - a.id);
  for (const { id } of lot.absences ?? []) {
    const a = db.get<Absence>('absences', id);
    if (!a || a.lotId !== lot.id) continue;
    const dernier = transmis.find(l => l.contenu?.absences?.some(x => x.absence === id));
    db.update<Absence>('absences', id, { lotId: dernier?.id ?? null });
  }
}

/**
 * Absences en attente du fichier de paie, par période de destination, pour l'écran Temps : mois jusqu'à la période
 * ouverte, ou jusqu'à la dernière période des feuilles en attente si elle vient après. Calculées pour les profils qui
 * voient les lots (service RH, paie, lecture seule) ; rien pour les autres.
 */
export function resumeAbsencesPaie(db: Db, user: CurrentUser, ds: Dataset): AbsencesPaieAttente[] {
  const droits = droitsRh(user);
  if (!droits.includes('rh') && !droits.includes('paie') && !droits.includes('consultation')) return [];
  if (!absencesDansLeFichier(ds.settings)) return [];
  const d = new Domain(ds);
  const jusqua = [periodeOuverte(d.ti, ds.settings.clotureJour), ...sagePending(d).map(sh => periodeDeLaFeuille(sh.week, ds.settings, d.ti))].sort().at(-1)!;
  return absencesParPeriode(absencesAEmettre(db, d, jusqua));
}

/** Instantané d'un lecteur sans droit « paie » : ni les rubriques d'absence en attente, ni les codes des absences d'un lot. */
export function sansCodesAbsences(ds: Pick<Dataset, 'lotsPaie' | 'absencesPaie'>): Pick<Dataset, 'lotsPaie' | 'absencesPaie'> {
  return {
    lotsPaie: ds.lotsPaie.map(l => (l.resume.absences ? { ...l, resume: { ...l.resume, absences: { ...l.resume.absences, rubriques: {} } } } : l)),
    absencesPaie: (ds.absencesPaie ?? []).map(g => ({ ...g, rubriques: [] })),
  };
}

/** Absence hors de la paie et du service RH (manager, collaborateur, référent HSE) : sans son lot ni son indicateur. */
export const absenceSansPaie = <T extends Absence>(a: T): T => (a.lotId != null || a.sage ? { ...a, lotId: null, sage: false } : a);

/**
 * Message du service RH quand une absence déjà partie à la paie change (annulée, raccourcie, prolongée, requalifiée) :
 * l'écart partira dans le prochain lot (régularisation, nouveaux jours) ; comprise dans un lot à confirmer, celui-ci peut
 * être annulé puis généré de nouveau. Vide pour une absence jamais partie.
 */
export function suitePaie(db: Db, a: Pick<Absence, 'lotId' | 'sage'>): string {
  const lot = a.lotId ? db.get<LotPaie>('lotsPaie', a.lotId) : undefined;
  if (lot?.statut === 'genere') return ` · comprise dans le lot de paie n° ${lot.id}, import à confirmer : annulez-le puis générez-le de nouveau pour en tenir compte, sinon l’écart partira dans le lot suivant`;
  return a.sage ? ' · déjà transmise à la paie : l’écart partira dans le prochain lot de paie (régularisation)' : '';
}
