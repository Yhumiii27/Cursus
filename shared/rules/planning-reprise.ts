// Planning d'équipe (lot 12, chantier C5, étape 2) : reprise des « équipes par quart » en groupes de roulement. Avant le
// planning, la couverture minimale conseillait de créer une équipe par quart (2x8, 3x8, continu) dans Équipes & managers
// (shared/rules/couverture.ts) ; à l'activation du module, ces équipes deviennent les groupes d'un cycle : la première
// équipe (dans l'ordre des équipes) prend le premier groupe du cycle, la deuxième le deuxième, et ainsi de suite. Chaque
// membre présent est affecté au cycle, dans le groupe de son équipe, à partir du jour choisi ; l'équipe hiérarchique ne
// change pas (le planning de chaque équipe se génère et se publie comme avant). Un salarié déjà affecté sur la période, ou
// hors contrat au premier jour, est laissé de côté avec la raison. Rejouable : une seconde reprise ne trouve plus que des
// salariés déjà affectés. Proposée dans Paramètres → Planning, lancée par le service RH (action planning.reprise).
import type { Employe, Equipe, ISODate } from '../types.ts';
import type { Cycle, Roulement } from '../types-planning.ts';
import { cycleDe } from './cycles.ts';
import { controlerRoulement } from './planning.ts';

/**
 * Équipes par quart détectées : sous une même équipe parente, au moins deux équipes qui ont chacune un horaire par défaut
 * (« Production — matin », « Production — après-midi »…), dans l'ordre des équipes.
 */
export function equipesParQuart(equipes: readonly Pick<Equipe, 'nom' | 'ordre' | 'parente' | 'horaire'>[]): { parente: string; equipes: string[] }[] {
  const parParente = new Map<string, Pick<Equipe, 'nom' | 'ordre'>[]>();
  for (const q of equipes) if (q.parente && q.horaire) parParente.set(q.parente, [...parParente.get(q.parente) ?? [], q]);
  return [...parParente].filter(([, l]) => l.length >= 2).sort(([a], [b]) => a.localeCompare(b))
    .map(([parente, l]) => ({ parente, equipes: [...l].sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom)).map(q => q.nom) }));
}

export interface LigneReprise { empId: number; equipe: string; groupe: string }
export interface Reprise {
  /** Refus de l'ensemble (cycle inconnu, trop d'équipes pour ses groupes, équipe inconnue…) ; null : la reprise est possible. */
  erreur: string | null;
  /** Affectations à créer. */
  lignes: LigneReprise[];
  /** Salariés laissés de côté, avec la raison (déjà affecté, hors contrat). */
  ignores: { empId: number; equipe: string; raison: string }[];
}

/**
 * Reprise des équipes `noms` (dans l'ordre des équipes du référentiel, quel que soit l'ordre reçu) en groupes du cycle
 * `code`, à partir du `du`. Salariés présents ce jour-là ; `exclus` : salariés à laisser à un autre (la personne connectée,
 * qui ne se planifie pas elle-même).
 */
export function proposerReprise(x: {
  code: string; du: ISODate; noms: readonly string[]; equipes: readonly Pick<Equipe, 'nom' | 'ordre'>[]; cycles: readonly Cycle[];
  roulements: readonly Roulement[]; employes: readonly Pick<Employe, 'id' | 'equipe' | 'entree' | 'fin' | 'typeContrat'>[]; exclus?: ReadonlySet<number>;
}): Reprise {
  const vide = (erreur: string): Reprise => ({ erreur, lignes: [], ignores: [] });
  const c = cycleDe(x.cycles, x.code);
  if (!c || c.archive) return vide('Cycle inconnu ou archivé');
  const noms = [...new Set(x.noms)];
  if (noms.length < 1) return vide('Choisissez les équipes par quart à reprendre');
  const inconnue = noms.find(n => !x.equipes.some(q => q.nom === n));
  if (inconnue) return vide(`Équipe inconnue : ${inconnue}`);
  if (noms.length > c.groupes.length) return vide(`Le cycle ${c.code} n’a que ${c.groupes.length} groupe${c.groupes.length > 1 ? 's' : ''} pour ${noms.length} équipes`);
  const ordonnees = x.equipes.filter(q => noms.includes(q.nom)).sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom));
  const out: Reprise = { erreur: null, lignes: [], ignores: [] };
  ordonnees.forEach((q, i) => {
    const groupe = c.groupes[i].code;
    for (const e of x.employes.filter(e => e.equipe === q.nom && (!e.fin || e.fin >= x.du)).sort((a, b) => a.id - b.id)) {
      if (x.exclus?.has(e.id)) { out.ignores.push({ empId: e.id, equipe: q.nom, raison: 'votre propre planning, tenu par votre manager' }); continue; }
      const r = controlerRoulement({ cycle: c.code, groupe, du: x.du }, e, x.cycles, x.roulements);
      if (r.valeurs) out.lignes.push({ empId: e.id, equipe: q.nom, groupe });
      else out.ignores.push({ empId: e.id, equipe: q.nom, raison: Object.values(r.erreurs)[0]! });
    }
  });
  return out;
}
