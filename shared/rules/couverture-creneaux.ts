// Couverture minimale par créneau (lot 12, chantier C5, t192, étape 3) : pour une équipe planifiée, les lignes de couverture
// de l'équipe (secouristes, équipiers d'intervention : shared/rules/couverture.ts, art. R4224-15 et R4227-28) et ses besoins
// d'effectif (Référentiels → Besoins de poste) s'appliquent à chaque horaire tenu ce jour-là (exemple : un SST au poste de
// nuit), et non plus à la journée. Calculé, jamais stocké.
// - Créneau : une équipe, un jour, un horaire. Il existe dès qu'un salarié de l'équipe y est planifié ou qu'un besoin
//   d'effectif le demande (tous ses salariés absents : il reste, découvert). Une équipe sans planning ce jour-là n'a aucun créneau : sa couverture reste celle du jour
//   (`etatsCouverture`), qui garde les « équipes par quart » tant que leur reprise en groupes de roulement n'est pas faite.
// - Postes : salariés planifiés sur l'horaire (les « à pourvoir » ne comptent pas). Titulaire : certification en vigueur
//   de la formation, valide à la date du créneau (même règle que `etatsCouverture`).
// - Absences : retirées pour le planificateur seul (`avecAbsences`), sans jamais lire leur nature. Le référent HSE, la
//   paie et la lecture seule voient une couverture sans absences (`sansAbsences` de la couverture du jour) : sinon un
//   manque, croisé avec les postes publiés qu'ils voient, désignerait l'absent.
import { addMonths, iso, parse } from '../dates.ts';
import { certEnVigueur } from '../domain.ts';
import { plural } from '../format.ts';
import type { Absence, Employe, Equipe, Formation, ISODate } from '../types.ts';
import type { BesoinPoste, Creneau } from '../types-planning.ts';
import { couvertureEquipe } from './couverture.ts';
import { absentLe, besoinsDuJour } from './planning.ts';
import { actif } from './referentiels.ts';

/** Formation suivie sur un créneau : titulaires au poste face au minimum de l'équipe. */
export interface FormationCreneau { formation: string; min: number; titulaires: number }
export interface CouvertureCreneau {
  equipe: string; jour: ISODate; horaire: string;
  /** Salariés au poste (absents retirés pour le planificateur). */
  postes: number;
  /** Effectif minimal des besoins de poste en vigueur (0 : aucun). */
  besoin: number;
  formations: FormationCreneau[];
  /** Effectif sous le besoin, ou formation sous son minimum. */
  manque: boolean;
}

/** Ce que lit le calcul : salariés (certifications), équipes et formations du référentiel, besoins, absences. */
export interface SourceCouvertureCreneaux {
  employes: readonly Pick<Employe, 'id' | 'certs'>[];
  referentiels: { equipes: readonly Pick<Equipe, 'nom' | 'couverture'>[]; formations: readonly Pick<Formation, 'id' | 'validite' | 'archive'>[] };
  besoinsPoste?: readonly BesoinPoste[];
  absences: readonly Pick<Absence, 'empId' | 'du' | 'au' | 'statut'>[];
}

/** Certification de la formation `f` valide le jour `jour` (celle en vigueur, obtenue au plus tard ce jour-là). */
export function titulaireLe(e: Pick<Employe, 'certs'>, f: Pick<Formation, 'id' | 'validite'>, jour: ISODate): boolean {
  const c = certEnVigueur(e.certs, f.id);
  return !!c && c.obtenue <= jour && iso(addMonths(parse(c.obtenue), f.validite)) >= jour;
}

/**
 * Couverture de chaque créneau de l'équipe `equipe` sur `jours`, d'après `creneaux` (ceux qui comptent pour le lecteur :
 * un par salarié et par jour, ceux d'une autre équipe ignorés). `avecAbsences` : absences en vigueur retirées
 * (planificateur seul). Triée par jour puis par horaire.
 */
export function couvertureCreneaux(ds: SourceCouvertureCreneaux, equipe: string, jours: readonly ISODate[],
  creneaux: readonly Pick<Creneau, 'empId' | 'jour' | 'equipe' | 'horaire'>[], avecAbsences: boolean): CouvertureCreneau[] {
  const q = ds.referentiels.equipes.find(x => x.nom === equipe);
  const lignes = couvertureEquipe(q).map(l => ({ l, f: ds.referentiels.formations.find(x => x.id === l.formation) }))
    .filter((x): x is { l: typeof x.l; f: NonNullable<typeof x.f> } => !!x.f && actif(x.f));
  const employes = new Map(ds.employes.map(e => [e.id, e]));
  const codesBesoin = [...new Set((ds.besoinsPoste ?? []).filter(b => b.equipe === equipe && !b.archive).map(b => b.horaire))];
  const out: CouvertureCreneau[] = [];
  for (const jour of jours) {
    const parCode = new Map<string, number[]>();
    for (const c of creneaux) {
      if (c.jour !== jour || c.equipe !== equipe || c.empId == null || !c.horaire) continue;
      // Un horaire tenu reste un créneau même quand tous ses salariés sont absents : il est alors découvert.
      const presents = parCode.get(c.horaire) ?? [];
      parCode.set(c.horaire, avecAbsences && absentLe(ds.absences, c.empId, jour) ? presents : [...presents, c.empId]);
    }
    const besoins = new Map(codesBesoin.map(code => [code, besoinsDuJour(ds.besoinsPoste, equipe, code, jour).reduce((n, b) => n + b.effectifMin, 0)]));
    for (const horaire of [...new Set([...parCode.keys(), ...[...besoins].filter(([, n]) => n > 0).map(([c]) => c)])].sort()) {
      const presents = parCode.get(horaire) ?? [], besoin = besoins.get(horaire) ?? 0;
      const formations = lignes.map(({ l, f }) => ({
        formation: f.id, min: l.min, titulaires: presents.filter(id => { const e = employes.get(id); return !!e && titulaireLe(e, f, jour); }).length,
      }));
      out.push({ equipe, jour, horaire, postes: presents.length, besoin, formations, manque: presents.length < besoin || formations.some(x => x.titulaires < x.min) });
    }
  }
  return out;
}

/** « N : 1 poste sur 2 · SST 0 sur 1 » (`court` : libellé court d'une formation). */
export function creneauCouvertureTexte(x: CouvertureCreneau, court: (f: string) => string): string {
  const effectif = x.besoin ? `${x.postes} sur ${x.besoin} ${x.besoin > 1 ? 'postes' : 'poste'}` : plural(x.postes, 'poste', 'postes');
  return [`${x.horaire} : ${effectif}`, ...x.formations.map(f => `${court(f.formation)} ${f.titulaires} sur ${f.min}`)].join(' · ');
}

/** Ce qui manque sur un créneau : « effectif » et les formations sous leur minimum (libellés courts). */
export function manquesCreneau(x: CouvertureCreneau, court: (f: string) => string): string[] {
  return [...(x.postes < x.besoin ? ['effectif'] : []), ...x.formations.filter(f => f.titulaires < f.min).map(f => court(f.formation))];
}
