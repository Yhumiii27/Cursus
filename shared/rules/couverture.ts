// Couverture minimale des équipes en sauveteurs secouristes et équipiers d'intervention (t067) : l'employeur organise les
// premiers secours, avec un membre du personnel formé dans chaque atelier où sont effectués des travaux dangereux (art.
// R4224-15), et désigne les équipiers chargés de la mise en œuvre des moyens d'extinction (art. R4227-28, R4227-39).
// - Seuil par équipe (Référentiels → Postes, exigences communes de l'équipe) : pour une formation du catalogue en vigueur
//   (SST, EPI incendie…), au moins `min` membres présents. Aucun seuil par défaut : la règle reste inactive tant que le
//   service RH ne l'a pas saisi. La saisie propose « 1 SST au minimum » (le minimum légal) ; l'INRS recommande de former
//   10 à 15 % de l'effectif. Cursus ne connaît pas le poste de quart de chacun : une équipe par quart (2x8, 3x8, continu)
//   se crée dans Équipes & managers, et sa couverture se suit comme celle de toute équipe.
// - Calcul (`etatsCouverture`) : chaque jour d'aujourd'hui à la fin de l'horizon d'alerte, les membres de l'équipe entrés
//   et pas encore sortis, sans absence validée ou signalée ce jour-là, titulaires d'une certification valide de la
//   formation (celle en vigueur, non annulée). Le premier jour sous le minimum est le manque, daté, avec ses causes :
//   certification échue, sortie ou fin de contrat, absence, ou titulaires trop peu nombreux. Un recyclage planifié ne
//   compte qu'une fois la certification enregistrée.
// - Affichage : tableau de bord (service RH, référent HSE, lecture seule), Équipes & managers, Échéances, équipe du
//   manager (ses équipes, jamais la nature d'une absence) et récapitulatif des échéances (shared/rules/relances.ts).
//   Calculé par le serveur sur l'instantané complet (`Dataset.couverture`, server/src/dataset.ts) : le référent HSE ne
//   reçoit pas toutes les absences ; il ne reçoit pas non plus le nom d'un membre absent.
import { addD, addMonths, iso, parse } from '../dates.ts';
import { fmtIso, plural } from '../format.ts';
import type { CauseCouverture, Dataset, Employe, Equipe, EtatCouverture, ISODate, LigneCouverture } from '../types.ts';
import { absenceBloque } from './absences.ts';
import { actif } from './referentiels.ts';

/** Lignes de couverture au plus par équipe (une par formation). */
export const COUVERTURE_LIGNES_MAX = 6;
/** Minimum proposé à la saisie : un sauveteur secouriste (art. R4224-15) ; l'aide rappelle la recommandation de l'INRS. */
export const COUVERTURE_PROPOSEE: LigneCouverture = { formation: 'sst', min: 1 };
export const RECOMMANDATION_INRS = 'L’INRS recommande de former 10 à 15 % de l’effectif au sauvetage secourisme du travail, et au moins un SST par atelier où sont effectués des travaux dangereux (art. R4224-15).';

/** Lignes d'une équipe, lues sur une ligne éventuellement ancienne (colonne vide). */
export const couvertureEquipe = (q: Pick<Equipe, 'couverture'> | null | undefined): LigneCouverture[] => (Array.isArray(q?.couverture) ? q!.couverture : []);

/**
 * Lignes reçues, réduites à ce qui peut être tracé au journal (codes et entiers), sans contrôle du catalogue ; null :
 * paramètre absent ou inexploitable.
 */
export function lignesCouverture(v: unknown): LigneCouverture[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter(x => x && typeof x === 'object')
    .map(x => ({ formation: String((x as LigneCouverture).formation ?? '').trim().toLowerCase(), min: Number((x as LigneCouverture).min) }))
    .filter(x => /^[a-z0-9_-]{1,40}$/.test(x.formation) && Number.isInteger(x.min))
    .slice(0, COUVERTURE_LIGNES_MAX);
}

/**
 * Couverture saisie, contrôlée (dialogue de l'équipe et `referentiel.equipe.exigences`) : formation du catalogue en vigueur
 * (déjà suivie et archivée depuis : gardée, sans effet), une ligne par formation, minimum entier de 1 à l'effectif présent
 * de l'équipe (1 au moins, pour une équipe encore vide). `erreur` : premier refus, ou null.
 */
export function controlerCouverture(v: unknown, ref: Pick<Dataset['referentiels'], 'formations'>, effectif: number, avant: readonly LigneCouverture[] = []):
  { erreur: string | null; lignes: LigneCouverture[] } {
  if (v == null) return { erreur: null, lignes: [...avant] };
  if (!Array.isArray(v)) return { erreur: 'Couverture minimale : liste attendue.', lignes: [] };
  if (v.length > COUVERTURE_LIGNES_MAX) return { erreur: `Couverture minimale : ${COUVERTURE_LIGNES_MAX} formations au plus.`, lignes: [] };
  const max = Math.max(1, effectif), lignes: LigneCouverture[] = [];
  for (const x of v as Partial<LigneCouverture>[]) {
    const formation = String(x?.formation ?? '').trim().toLowerCase(), min = Number(x?.min);
    const f = ref.formations.find(y => y.id === formation);
    if (!formation) return { erreur: 'Couverture minimale : choisissez la formation de chaque ligne.', lignes: [] };
    if (!f || (!actif(f) && !avant.some(a => a.formation === formation))) return { erreur: `Couverture minimale : formation inconnue ou archivée (${formation}).`, lignes: [] };
    if (lignes.some(l => l.formation === formation)) return { erreur: `Couverture minimale : ${f.court} figure deux fois.`, lignes: [] };
    if (!Number.isInteger(min) || min < 1 || min > max) {
      return { erreur: `Couverture minimale ${f.court} : un nombre entier de 1 à ${max} (${plural(effectif, 'membre présent', 'membres présents')}).`, lignes: [] };
    }
    lignes.push({ formation, min });
  }
  return { erreur: null, lignes };
}

type Source = Pick<Dataset, 'today' | 'employes' | 'absences'> & { referentiels: Pick<Dataset['referentiels'], 'equipes' | 'formations'> };

/** Ce qu'il faut savoir d'un membre pour le compter chaque jour : entrée, sortie, fin de validité, absences. */
interface Membre { e: Employe; exp: ISODate | null; absences: { du: ISODate; au: ISODate }[] }

/** Fin de validité (dernier jour) de la certification en vigueur de la formation, ou null : jamais obtenue. */
function finValidite(e: Employe, f: string, validite: number): ISODate | null {
  const c = e.certs.filter(x => x.f === f && !x.annuleLe).sort((a, b) => b.obtenue.localeCompare(a.obtenue) || b.id - a.id)[0];
  // Valide jusqu'à sa date d'expiration comprise (même règle que Domain.certInfo : expirée une fois la date passée).
  return c ? iso(addMonths(parse(c.obtenue), validite)) : null;
}

/** Cause qui écarte un membre titulaire le jour `j` ; null : il compte (ou n'est pas encore entré). */
function cause(m: Membre, j: ISODate): CauseCouverture | null {
  const { e } = m;
  if (e.entree > j || !m.exp) return null;
  if (e.fin && e.fin < j) return { type: 'sortie', empId: e.id, nom: e.nom, le: e.fin };
  if (m.exp < j) return { type: 'expiration', empId: e.id, nom: e.nom, le: m.exp };
  const a = m.absences.find(x => x.du <= j && x.au >= j);
  return a ? { type: 'absence', empId: e.id, nom: e.nom, le: a.du } : null;
}
const compte = (membres: readonly Membre[], j: ISODate) => membres.filter(m => m.e.entree <= j && m.exp && !cause(m, j)).length;

/**
 * Couverture de chaque ligne de chaque équipe (`equipes` : seulement celles-ci), sur `horizon` jours à partir
 * d'aujourd'hui. Une formation archivée n'est plus suivie ; une équipe sans ligne n'apparaît pas.
 */
export function etatsCouverture(ds: Source, horizon: number, equipes?: readonly string[]): EtatCouverture[] {
  const out: EtatCouverture[] = [];
  const fin = addD(ds.today, Math.max(0, horizon));
  for (const q of ds.referentiels.equipes) {
    if (equipes && !equipes.includes(q.nom)) continue;
    const presents = ds.employes.filter(e => e.equipe === q.nom && (!e.fin || e.fin >= ds.today));
    for (const l of couvertureEquipe(q)) {
      const f = ds.referentiels.formations.find(x => x.id === l.formation);
      if (!f || !actif(f)) continue;
      const membres: Membre[] = presents.map(e => ({
        e, exp: finValidite(e, f.id, f.validite),
        absences: ds.absences.filter(a => a.empId === e.id && absenceBloque(a) && a.au >= ds.today && a.du <= fin).map(a => ({ du: a.du, au: a.au })),
      }));
      const n = compte(membres, ds.today);
      let manque: EtatCouverture['manque'] = null;
      for (let j = ds.today; j <= fin; j = addD(j, 1)) {
        const c = compte(membres, j);
        if (c >= l.min) continue;
        // Dernier jour du manque dans l'horizon : la veille du premier jour où le minimum est de nouveau atteint.
        let jusquau: ISODate | null = null;
        for (let k = addD(j, 1); k <= fin; k = addD(k, 1)) if (compte(membres, k) >= l.min) { jusquau = addD(k, -1); break; }
        const causes = membres.map(m => cause(m, j)).filter((x): x is CauseCouverture => !!x);
        manque = { le: j, compte: c, jusquau, causes: causes.length ? causes : [{ type: 'insuffisant', empId: null, nom: null, le: null }] };
        break;
      }
      out.push({ equipe: q.nom, formation: f.id, min: l.min, compte: n, manque });
    }
  }
  return out;
}

/** Manque daté d'aujourd'hui (ou déjà là) : « Sous le minimum » ; à venir : « À anticiper ». */
export const manqueImmediat = (x: EtatCouverture, ti: ISODate) => !!x.manque && x.manque.le <= ti;

/** « Camille Roux (certification valide jusqu’au 20 nov. 2026) · Hugo Lambert (absent) » ; nom retiré : « un membre (absent) ». */
export function causesTexte(c: readonly CauseCouverture[]): string {
  return c.map(x => {
    if (x.type === 'insuffisant') return 'titulaires trop peu nombreux';
    const qui = x.nom ?? 'un membre';
    return x.type === 'sortie' ? `${qui} (sortie le ${fmtIso(x.le!)})`
      : x.type === 'expiration' ? `${qui} (certification valide jusqu’au ${fmtIso(x.le!)})`
      : `${qui} (absent)`;
  }).join(' · ');
}

/** « SST : 1 sur 2 minimum le 20 nov. 2026 (jusqu’au 24 nov.) » ; sans manque : « SST : 3 pour 1 minimum ». */
export function couvertureTexte(x: EtatCouverture, court: string, ti: ISODate): string {
  if (!x.manque) return `${court} : ${x.compte} pour ${x.min} minimum`;
  const quand = x.manque.le <= ti ? 'aujourd’hui' : `le ${fmtIso(x.manque.le)}`;
  return `${court} : ${x.manque.compte} sur ${x.min} minimum ${quand}${x.manque.jusquau ? ` (jusqu’au ${fmtIso(x.manque.jusquau)})` : ''}`;
}
