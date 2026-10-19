// Absences dans le fichier d'import de la paie (t028), côté serveur : éléments déjà emportés par les lots non annulés (lus
// dans leur contenu figé, que seul le serveur garde), absences réservées par un lot à confirmer, premier jour transmis par
// Cursus (réglage `absencesPaieAPartirDu`, date de mise en service ; clés `absencesPaieDepuis` et `absencesPaieJusqua`
// de la table settings, date de départ posée par la migration lot5-paie-absences-anterieures sur une base existante, par
// le premier lot d'une base neuve ou à la réactivation du réglage, pour les absences déjà enregistrées), éléments d'un
// nouveau lot, libération à l'annulation, résumé de l'instantané et ce qu'en reçoit chaque profil. Règles :
// shared/rules/absences-paie.ts.
import { droitsRh } from '../../shared/constants.ts';
import { Domain } from '../../shared/domain.ts';
import { fmtIso, plural } from '../../shared/format.ts';
import {
  absencesDansLeFichier, absencesParPeriode, type DepartAbsences, elementsAbsences, type ElementCalcule, type ElementEmis, premierJourTransmis, rubriqueAbsence,
} from '../../shared/rules/absences-paie.ts';
import { periodeDeLaFeuille } from '../../shared/rules/lots-paie.ts';
import { periodeOuverte, rubriquesPaie } from '../../shared/rules/paie.ts';
import { sagePending } from '../../shared/rules/temps.ts';
import type { Absence, AbsencesPaieAttente, CurrentUser, Dataset, ElementAbsencePaie, ISODate, LotPaie, RubriquePaie, Settings } from '../../shared/types.ts';
import { journaliser } from './comptes.ts';
import type { Db } from './db.ts';
import type { LotEnregistre } from './lots-paie.ts';

/** Clé de la table settings : premier jour d'absence transmis par Cursus (null ou absente : tous). */
export const CLE_DEPUIS = 'absencesPaieDepuis';
/** Clé de la table settings : plus grand identifiant d'absence enregistré quand la date de départ a été posée. */
export const CLE_JUSQUA = 'absencesPaieJusqua';
export const lireDepuis = (db: Db): ISODate | null => db.getSetting<ISODate | null>(CLE_DEPUIS, null);

/**
 * Premier jour transmis (shared/rules/absences-paie.ts, `DepartAbsences`) : date de mise en service réglée, et date de
 * départ posée par Cursus pour les absences enregistrées jusque-là (identifiant absent, posé avant cette borne : toutes).
 */
export const lireDepart = (db: Db, s: Partial<Pick<Settings, 'absencesPaieAPartirDu'>> | undefined): DepartAbsences => ({
  aPartirDu: s?.absencesPaieAPartirDu ?? null, depuis: lireDepuis(db), jusqua: db.getSetting<number | null>(CLE_JUSQUA, null),
});

/**
 * Pose la date de départ : jours d'absence d'avant `depuis` laissés à la saisie dans Sage, pour les absences déjà
 * enregistrées (une absence enregistrée ensuite part entière, en rappel pour un mois clos). Une date déjà posée plus
 * tardive est gardée. Tracé au journal (`migration.absencesPaie` : date, nombre d'absences concernées, jamais leur
 * nature). Renvoie la date retenue et le nombre d'absences validées qui commencent avant elle.
 */
export function poserDepart(db: Db, depuis: ISODate, auteur: { actor: string; role: string | null }, raison: string) {
  const date = [lireDepuis(db), depuis].filter((x): x is ISODate => !!x).sort().at(-1)!;
  const max = Number((db.sql.prepare('SELECT MAX(id) AS m FROM absences').get() as { m: number | null }).m ?? 0);
  db.setSetting(CLE_DEPUIS, date);
  db.setSetting(CLE_JUSQUA, max);
  const n = Number((db.sql.prepare(`SELECT COUNT(*) AS n FROM absences WHERE statut = 'validee' AND du < ?`).get(date) as { n: number }).n);
  journaliser(db, {
    ...auteur, action: 'migration.absencesPaie',
    message: `${raison} : absences transmises à la paie à partir du ${fmtIso(date)} — ${plural(n, 'absence validée', 'absences validées')} avant cette date, déjà saisie${n > 1 ? 's' : ''} dans Sage, n’y partent pas ; une absence enregistrée ensuite part entière`,
    payload: { depuis: date, jusqua: max, absences: n },
  });
  return { depuis: date, absences: n };
}

/**
 * Premier lot de paie d'une base neuve (mise en service : aucun lot, aucune date de départ) : Cursus pose la date de
 * départ au premier jour de la période ouverte, pour que les absences enregistrées avant ce lot ne repartent pas en
 * rappel des mois que Lucca et Sage ont traités. Une base qui a déjà des lots (lots historiques de la démonstration,
 * base existante mise à jour, que la migration lot5-paie-absences-anterieures a traitée) n'est pas concernée. Rien si les
 * absences restent à Sage. Renvoie la suite du message du lot.
 */
export function departAuPremierLot(db: Db, d: Domain, user: CurrentUser): string {
  if (!absencesDansLeFichier(d.ds.settings) || lireDepuis(db) !== null || db.all('lotsPaie').length) return '';
  const r = poserDepart(db, `${periodeOuverte(d.ti, d.ds.settings.clotureJour)}-01`, { actor: user.nom, role: user.role }, 'Premier lot de paie');
  return ` · absences transmises à partir du ${fmtIso(r.depuis)} : les jours d’avant restent à saisir dans Sage`;
}

/**
 * Message du service RH quand une absence validée (enregistrée, validée, qualifiée, annulée) a des jours avant son
 * premier jour transmis : ils ne partent pas dans le fichier, la paie les saisit ou les corrige dans Sage. Vide sinon.
 */
export function joursAvantDepart(db: Db, s: Settings, a: Pick<Absence, 'id' | 'type' | 'du'>): string {
  if (!absencesDansLeFichier(s) || !rubriqueAbsence(a.type)) return '';
  const premier = premierJourTransmis(a, lireDepart(db, s));
  return premier && a.du < premier ? ` · jours avant le ${fmtIso(premier)} non transmis dans le fichier de paie : à saisir ou corriger dans Sage par la paie` : '';
}

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
  return elementsAbsences(d, { jusqua, ...emisEtReservees(db), depart: lireDepart(db, d.ds.settings) });
}

/**
 * Rubrique interne → code Sage figé à la génération : null pour une rubrique désactivée (saisie dans Sage). Une
 * régularisation garde le code de l'élément d'origine qu'elle reprend.
 */
export function traduireElements(elements: readonly ElementCalcule[], stockees: readonly RubriquePaie[]): ElementAbsencePaie[] {
  const table = rubriquesPaie(stockees);
  return elements.map(x => {
    if (x.codeSage !== undefined) return { ...x, codeSage: x.codeSage };
    const r = table.find(t => t.code === x.rubrique);
    return { ...x, codeSage: r ? (r.active ? r.codeSage : null) : x.rubrique };
  });
}

/**
 * Réglage `absencesFichierPaie` réactivé : la paie a saisi dans Sage les absences de la période où il était décoché ;
 * la date de départ passe au premier jour de la période ouverte, pour les absences déjà enregistrées. Renvoie la suite
 * du message de parametres.maj.
 */
export function reactivationAbsences(db: Db, avant: Settings, apres: Settings, user: CurrentUser, ti: ISODate): string {
  if (absencesDansLeFichier(avant) || !absencesDansLeFichier(apres)) return '';
  const r = poserDepart(db, `${periodeOuverte(ti, apres.clotureJour)}-01`, { actor: user.nom, role: user.role }, 'Absences de nouveau dans le fichier de paie');
  return ` · absences transmises à partir du ${fmtIso(r.depuis)} : celles d’avant, saisies dans Sage pendant l’interruption, n’y repartent pas`;
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
    lotsPaie: ds.lotsPaie.map(l => (l.resume.absences ? { ...l, resume: { ...l.resume, absences: { ...l.resume.absences, rubriques: {} } } } : l))
      // Liste « à saisir dans Sage » (lot 6) : la rubrique d'une absence en dit la catégorie, elle est retirée.
      .map(l => (l.resume.aSaisir?.some(x => x.famille === 'absences') ? { ...l, resume: { ...l.resume, aSaisir: l.resume.aSaisir.map(x => (x.famille === 'absences' ? { ...x, rubrique: '' } : x)) } } : l)),
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
