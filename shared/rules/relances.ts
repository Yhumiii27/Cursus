// Relances des échéances (t034) : ce qui arrive à échéance, par palier (90, 30 et 7 jours avant, puis échu par défaut ;
// réglables dans Paramètres → Messagerie). Le serveur (server/src/relances.ts) envoie chaque matin un récapitulatif au
// service RH, à chaque manager pour son équipe et au référent HSE pour les formations et habilitations, avec les seuls
// paliers franchis depuis la dernière relance (table `relances`) : un objet n'est relancé qu'une fois par palier.
// Sources : échéances du domaine (certifications, habilitations, visites médicales, passeports, visas, vaccinations),
// déplacements dont le dossier n'est pas complet, obligations d'entretien, fins de contrat prévues. Les salariés sortis
// n'y figurent pas ; les feuilles de temps non soumises relèvent de la relance des feuilles (suivi des feuilles).
// Jamais de donnée de santé dans un e-mail : une vaccination est une « formalité sanitaire », une visite médicale n'est
// nommée que par son échéance, un avis d'inaptitude n'est pas relancé ; le manager ne reçoit ni l'une ni l'autre.
import { ENT_TYPES, EXAMEN_REQUIS, TYPES_CONTRAT } from '../constants.ts';
import { days, iso, parse } from '../dates.ts';
import type { Domain, EmpX } from '../domain.ts';
import type { EtatCouverture, ISODate, Settings } from '../types.ts';
import { present } from './contrats.ts';
import { obligations } from './entretiens.ts';
import { ECHEANCE_18_ANS, ECHEANCE_DEROGATION } from './mineurs.ts';
import { debutManque, etatsCouverture } from './couverture.ts';

/** Paliers proposés (jours avant l'échéance) ; « échu » s'y ajoute toujours. */
export const PALIERS_POSSIBLES = [90, 60, 30, 15, 7] as const;
/** Fréquence de l'envoi : chaque jour, ou un jour de la semaine (paliers franchis depuis le dernier envoi). */
export const JOURS_RELANCE = ['quotidien', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'] as const;
export type JourRelance = typeof JOURS_RELANCE[number];

/**
 * Contrôle du réglage des paliers (shared/reglages.ts) : valeurs proposées seulement, sans doublon, de la plus lointaine à
 * la plus proche ; aucune valeur exploitable (liste vide comprise) : les paliers en vigueur sont gardés.
 */
export const paliersRelance = (v: unknown, actuels: number[]): number[] => {
  const p = Array.isArray(v) ? PALIERS_POSSIBLES.filter(x => v.map(Number).includes(x)) : [];
  return p.length ? [...p].sort((a, b) => b - a) : actuels;
};

/** Envoi prévu ce jour-là ? (lundi = 0 … vendredi = 4, comme `weekday`.) */
export const jourDEnvoi = (s: Pick<Settings, 'relancesJour'>, jourSemaine: number): boolean =>
  s.relancesJour === 'quotidien' || JOURS_RELANCE.indexOf(s.relancesJour) - 1 === jourSemaine;

/** Palier atteint `jours` avant l'échéance : « echu » une fois passée, sinon le plus proche des paliers réglés ; null au-delà. */
export function palierDe(jours: number, paliers: readonly number[]): string | null {
  if (jours < 0) return 'echu';
  const p = [...paliers].sort((a, b) => a - b).find(x => jours <= x);
  return p === undefined ? null : String(p);
}

/** Intitulé d'un palier dans le récapitulatif. */
export const titrePalier = (palier: string) => (palier === 'echu' ? 'Échéances dépassées' : `Sous ${palier} jours`);

export type CategorieRelance = 'formation' | 'habilitation' | 'visite' | 'formalite' | 'sanitaire' | 'deplacement' | 'entretien' | 'contrat' | 'couverture'
  // lot 11 — dossiers OPCO (shared/rules/opco.ts, `relancesOpco`)
  | 'opco';

/** Objet relancé : clé stable (avec la date de l'échéance : un renouvellement repart de zéro), salarié, libellé neutre. */
export interface Relance {
  cle: string; empId: number; categorie: CategorieRelance; libelle: string; echeance: ISODate; jours: number; palier: string;
  /**
   * Donnée de santé, même neutralisée (visite médicale, vaccination), ou réservée au service RH (titre de séjour, échéances
   * d'un salarié mineur) : jamais dans le récapitulatif d'un manager.
   */
  sante: boolean;
  /**
   * Couverture minimale d'une équipe (shared/rules/couverture.ts) : l'équipe, et `empId` 0 (aucun salarié désigné) ;
   * relancée au service RH, au manager de l'équipe et au référent HSE.
   */
  equipe?: string;
  /** Couverture calculée pour le référent HSE, sans les absences hors chantiers (clé `hse:couverture:…`) : à lui seul. */
  hse?: boolean;
  // lot 11 — dossiers OPCO
  /** Échéance propre au service RH, sans salarié (`empId` 0) : dossier OPCO (`opco:<id>:<étape>:<échéance>`), à sa seule boîte. */
  rhSeul?: boolean;
}

/**
 * Échéances du périmètre (tous les salariés présents) qui ont atteint un palier aujourd'hui. Les échéances déjà prises en
 * charge (session planifiée, visite demandée) ne sont pas relancées ; un entretien planifié non plus, sauf à une date
 * dépassée sans avoir été clos (relancé comme échu).
 */
export function relancesDues(d: Domain, emps: EmpX[], paliers: readonly number[]): Relance[] {
  const out: Relance[] = [];
  const ajouter = (r: Omit<Relance, 'jours' | 'palier'>, echu = false) => {
    const jours = days(d.today, parse(r.echeance)), palier = echu ? 'echu' : palierDe(jours, paliers);
    if (palier) out.push({ ...r, jours, palier });
  };
  const presents = emps.filter(e => present(e, d.ti));
  for (const x of d.echeances(presents, Math.max(...paliers, 90))) {
    if (x.planned) continue;
    const echeance = iso(x.exp), base = { empId: x.emp.id, echeance };
    if (x.kind === 'cert') ajouter({ ...base, cle: `cert:${x.emp.id}:${x.label}:${echeance}`, categorie: 'formation', libelle: `${x.kindLabel} ${x.label}`, sante: false });
    else if (x.kind === 'hab') ajouter({ ...base, cle: `hab:${x.emp.id}:${x.label}:${echeance}`, categorie: 'habilitation', libelle: x.label, sante: false });
    else if (x.kind === 'med') {
      // Avis d'inaptitude : rien à renouveler, suivi par le service RH ; visite jamais enregistrée : relancée comme échue.
      if (x.label === 'Avis d’inaptitude') continue;
      // Examen d'aptitude du suivi renforcé jamais enregistré : relancé comme échu tant qu'il manque, sous une clé à part.
      if (x.label === EXAMEN_REQUIS) { ajouter({ ...base, cle: `med:${x.emp.id}:examen`, categorie: 'visite', libelle: 'Examen médical d’aptitude à programmer', sante: true }, true); continue; }
      // Visite due à un événement (embauche, reprise, mi-carrière, fin de carrière : shared/rules/visites-dues.ts), relancée
      // par paliers sous une clé par motif ; l'e-mail ne la nomme pas (une visite de reprise trahirait un arrêt).
      if (x.motifVisite) { ajouter({ ...base, cle: `med:${x.emp.id}:${x.motifVisite}:${echeance}`, categorie: 'visite', libelle: 'Visite médicale à programmer', sante: true }); continue; }
      ajouter({ ...base, cle: `med:${x.emp.id}:${x.sansDate ? 'sans-date' : echeance}`, categorie: 'visite', libelle: x.sansDate ? 'Visite médicale non enregistrée' : 'Visite médicale', sante: true }, !!x.sansDate);
    } else if (x.kind === 'exigence') {
      // Exigence du poste ou de l'équipe jamais obtenue : sans date, relancée comme échue tant qu'elle manque.
      const formation = x.statut?.startsWith('Formation');
      ajouter({ ...base, cle: `exigence:${x.emp.id}:${formation ? 'f' : 'h'}:${x.label}`, categorie: formation ? 'formation' : 'habilitation', libelle: `${x.statut} : ${x.label}`, sante: false }, true);
    } else if (x.kind === 'contrat') {
      // Fin de contrat : relancée plus bas, même sans échéance affichée. Titre de séjour : réservé au service RH, comme une
      // donnée de santé (jamais dans le récapitulatif d'un manager), sans le type de titre.
      if (x.kindLabel === 'Fin de contrat') continue;
      // Salarié mineur (shared/rules/mineurs.ts) : 18 ans et fin de la dérogation pour travaux réglementés, sous des clés à
      // part (jamais celle d'une fin d'essai à la même date). Réservées au service RH comme le titre de séjour : le jour des
      // 18 ans donnerait au manager la date de naissance complète, et la dérogation ne lui est pas transmise.
      if (x.kindLabel === ECHEANCE_18_ANS) { ajouter({ ...base, cle: `mineur:18ans:${x.emp.id}:${echeance}`, categorie: 'contrat', libelle: '18 ans : fin des règles des mineurs', sante: true }); continue; }
      if (x.kindLabel === ECHEANCE_DEROGATION) { ajouter({ ...base, cle: `derogation:${x.emp.id}:${echeance}`, categorie: 'contrat', libelle: 'Dérogation pour travaux réglementés à renouveler', sante: true }); continue; }
      const titre = x.kindLabel === 'Titre de séjour';
      ajouter({ ...base, cle: `${titre ? 'titre' : 'essai'}:${x.emp.id}:${echeance}`, categorie: 'contrat', libelle: titre ? 'Titre de séjour' : x.label, sante: titre });
    } else if (x.kindLabel === 'Vaccination') {
      ajouter({ ...base, cle: `vaccin:${x.emp.id}:${x.label}:${echeance}`, categorie: 'sanitaire', libelle: 'Formalité sanitaire de voyage', sante: true });
    } else ajouter({ ...base, cle: `doc:${x.emp.id}:${x.label}:${echeance}`, categorie: 'formalite', libelle: x.kindLabel === 'Passeport' ? 'Passeport' : x.label, sante: false });
  }
  // Déplacements au dossier incomplet (formalités obligatoires manquantes), relancés selon la date de départ.
  const ids = new Set(presents.map(e => e.id));
  for (const t of d.tripsAll()) {
    if (!ids.has(t.empId) || !t.r.todo || t.depart < d.ti) continue;
    ajouter({ cle: `voyage:${t.id}:${t.depart}`, empId: t.empId, echeance: t.depart, categorie: 'deplacement', libelle: `Déplacement ${t.r.dest.pays} : ${t.r.todo} formalité${t.r.todo > 1 ? 's' : ''} à prévoir avant le départ`, sante: false });
  }
  // Obligations d'entretien non planifiées (ou planifiées à une date dépassée).
  for (const o of obligations(d, [...ids])) {
    if (o.st === 'ok' || o.st === 'planifie') continue;
    const echeance = o.pl && o.st === 'late' ? o.pl.date : o.due;
    ajouter({
      cle: `entretien:${o.id}:${o.kind}:${echeance}`, empId: o.id, echeance, categorie: 'entretien', sante: false,
      libelle: o.pl ? `${o.libelle ?? ENT_TYPES[o.kind].nom} planifié, date dépassée` : o.libelle ?? ENT_TYPES[o.kind].nom,
    });
  }
  // Couverture minimale des équipes (SST, EPI incendie…) : relancée à l'approche du premier jour sous le minimum, sans nom
  // ni nature d'absence.
  out.push(...relancesCouverture(d, etatsCouverture(d.ds, Math.max(...paliers, 90)), paliers));
  // Fins de contrat prévues (CDD, mission, alternance), tant qu'aucune sortie n'est enregistrée.
  for (const e of presents) {
    if (!e.fin || e.motifSortie) continue;
    ajouter({ cle: `contrat:${e.id}:${e.fin}`, empId: e.id, echeance: e.fin, categorie: 'contrat', libelle: `Fin de contrat (${TYPES_CONTRAT[d.contratOf(e).typeContrat].label})`, sante: false });
  }
  return out.sort((a, b) => a.echeance.localeCompare(b.echeance) || a.empId - b.empId);
}

/**
 * Relances de couverture minimale (`etats` : shared/rules/couverture.ts ; `prefixe` : clés à part, pour le référent HSE
 * dont la couverture est calculée sans les absences hors chantiers). Un manque à venir est relancé par paliers sous la
 * clé de sa date ; déjà là, comme échu, sous la date de son début (`debutManque`, stable d'un jour à l'autre : il n'est
 * relancé qu'une fois), ou « en-cours » sans cause datée.
 */
export function relancesCouverture(d: Domain, etats: readonly EtatCouverture[], paliers: readonly number[], prefixe = ''): Relance[] {
  const out: Relance[] = [];
  for (const c of etats) {
    if (!c.manque) continue;
    const court = d.fm(c.formation)?.court ?? c.formation;
    const echu = c.manque.le <= d.ti, debut = debutManque(c, d.ti), echeance = debut ?? d.ti;
    const jours = days(d.today, parse(echeance)), palier = echu ? 'echu' : palierDe(jours, paliers);
    if (!palier) continue;
    out.push({
      cle: `${prefixe}couverture:${c.equipe}:${c.formation}:${debut ?? 'en-cours'}`, empId: 0, equipe: c.equipe, echeance, jours, palier,
      categorie: 'couverture', sante: false, libelle: `Couverture ${court} : ${c.manque.compte} sur ${c.min} minimum`, ...(prefixe ? { hse: true } : {}),
    });
  }
  return out;
}

/** Catégories du récapitulatif du référent HSE : formations et habilitations. */
export const CATEGORIES_HSE: readonly CategorieRelance[] = ['formation', 'habilitation', 'couverture'];
