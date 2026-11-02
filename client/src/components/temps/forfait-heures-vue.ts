// Forfait annuel en heures (lot 12, chantier C1, étape 2) : ce que montrent l'onglet « Forfait annuel en heures » de l'écran
// Temps de travail (components/temps/RecapForfaitHeures.tsx), le dialogue de clôture (dialogs/ClotureForfaitHeuresDialog.tsx)
// et la fiche (components/temps/ForfaitHeuresFiche.tsx). Sans import d'interface : lu aussi par les tests.
// Droits de lecture (projection de server/src/vues-forfait-heures.ts, que l'écran redit sans s'y fier) :
// - service RH (droit « rh ») : tout, bandeau et dialogue de clôture (clôture, réouverture, annulation : administrateur RH,
//   jamais pour soi-même) ;
// - paie : lignes confirmées et quantités ; collaborateur : sa ligne (le salarié lui-même : cible nette, projection) ;
// - manager (son équipe), lecture seule : réalisé (déjà lisible sur les feuilles), cible au prorata de la présence et
//   projection, jamais le total des absences déduites, la cible nette ni les heures de paie (un total d'absences élevé peut
//   laisser deviner un arrêt) ; référent HSE : rien (ni feuilles ni paie).
import type { Domain } from '../../../../shared/domain.ts';
import { fH, fmtIso, plural } from '../../../../shared/format.ts';
import {
  concerneParForfaitHeures, etatClotureForfait, lignesARevoir, periodeReference, plagesAClore, type CalculClotureForfait, type ClotureForfaitHeures,
  type MotifFinForfait, type PeriodeForfait, type PlageAClore,
} from '../../../../shared/rules/forfait-heures.ts';
import type { Employe } from '../../../../shared/types.ts';

/** Ce que la personne connectée peut voir du forfait d'un salarié. */
export interface DroitsForfaitHeures { rh: boolean; paie: boolean; consultation: boolean; manager: boolean; collab: boolean; soi: number | null }

/** Quantités du salarié (absences déduites, cible nette, heures de paie) : service RH, paie, le salarié lui-même. */
export const voitQuantites = (r: DroitsForfaitHeures, empId: number) => r.rh || r.paie || r.soi === empId;

/**
 * Quantités recalculées dans le navigateur (absences déduites et cible nette de la période en cours, « à revoir ») : service
 * RH et le salarié lui-même seulement. L'instantané de la paie masque la nature des absences des autres (« ABSENCE »,
 * server/src/dataset.ts) : recalculées là, elles s'écarteraient du calcul du serveur dès que la liste des absences déduites
 * n'est pas celle par défaut. La paie lit les quantités photographiées des lignes confirmées.
 */
export const voitRecalcul = (r: DroitsForfaitHeures, empId: number) => r.rh || r.soi === empId;

/** L'espace ouvre-t-il l'onglet du forfait : service RH, paie, lecture seule, manager, collaborateur (jamais le référent HSE). */
export const ouvreForfaitHeures = (r: DroitsForfaitHeures) => r.rh || r.paie || r.consultation || r.manager || r.collab;

/** Salariés de l'instantané concernés par le forfait annuel en heures et présents dans la période `ref`. */
export const salariesForfaitHeures = (d: Domain, ref: PeriodeForfait): Employe[] =>
  d.ds.employes.filter(e => !e.anonymiseLe && e.entree <= ref.fin && (!e.fin || e.fin >= ref.debut) && concerneParForfaitHeures(d, e))
    .sort((a, b) => a.nom.localeCompare(b.nom));

/**
 * Libellé de l'onglet de l'écran Temps, ou null quand il n'a rien à montrer (aucun salarié au forfait dans la période en
 * cours, aucune ligne de clôture) ; pour le service RH, le nombre de plages à clôturer et de lignes à revoir.
 */
export function ongletForfaitHeures(d: Domain, r: DroitsForfaitHeures): string | null {
  if (!ouvreForfaitHeures(r)) return null;
  const ref = periodeReference(d.ds.settings, d.ti);
  const lignes = d.ds.cloturesForfaitHeures ?? [];
  const aClore = r.rh ? plagesAClore(d) : [];
  if (!aClore.length && !lignes.length && !salariesForfaitHeures(d, ref).length) return null;
  const n = aClore.length + (r.rh ? lignesARevoir(d).length : 0);
  return n ? `Forfait annuel en heures · ${n}` : 'Forfait annuel en heures';
}

/** « année 2027 », ou « du 1 juin 2027 au 31 mai 2028 » pour une période qui n'est pas l'année civile. */
export const periodeTexte = (p: PeriodeForfait) =>
  (p.debut.endsWith('-01-01') && p.fin === `${p.debut.slice(0, 4)}-12-31` ? `année ${p.debut.slice(0, 4)}` : `du ${fmtIso(p.debut)} au ${fmtIso(p.fin)}`);

export const MOTIF_FIN_LABEL: Record<MotifFinForfait, string> = { periode: 'fin de la période', sortie: 'sortie du salarié', avenant: 'avenant (fin du forfait)' };

/** « du 1 janv. 2027 au 31 déc. 2027 · fin de la période ». */
export const plageTexte = (p: Pick<CalculClotureForfait, 'debut' | 'fin' | 'motifFin'>) => `du ${fmtIso(p.debut)} au ${fmtIso(p.fin)} · ${MOTIF_FIN_LABEL[p.motifFin]}`;

/** Heures dues de la clôture : « HFA25 120 h · HFA50 15 h », ou « heures non réalisées : 20 h (information) », ou « aucune ». */
export function heuresDuesTexte(l: Pick<CalculClotureForfait, 'hfa25' | 'hfa50' | 'hca10' | 'hca25' | 'nonRealise'>): string {
  const q = ([['HFA25', l.hfa25], ['HFA50', l.hfa50], ['HCA10', l.hca10], ['HCA25', l.hca25]] as const).filter(([, h]) => h).map(([c, h]) => `${c} ${fH(h)}`);
  if (q.length) return q.join(' · ');
  return l.nonRealise ? `heures non réalisées : ${fH(l.nonRealise)} (information, jamais retenues)` : 'aucune heure à payer';
}

/** Groupe du bandeau : plages d'une même période de référence, dont combien sont bloquées. */
export interface GroupeAClore { reference: PeriodeForfait; plages: PlageAClore[]; bloquees: number; enCours: boolean }

/** Plages à clôturer par période de référence, de la plus ancienne à la plus récente. */
export function groupesAClore(d: Domain, plages: readonly PlageAClore[] = plagesAClore(d)): GroupeAClore[] {
  const out = new Map<string, GroupeAClore>();
  for (const p of plages) {
    const g = out.get(p.reference.debut) ?? { reference: p.reference, plages: [], bloquees: 0, enCours: p.reference.fin >= d.ti };
    g.plages.push(p);
    if (p.calc.blocages.length) g.bloquees++;
    out.set(p.reference.debut, g);
  }
  return [...out.values()].sort((a, b) => a.reference.debut.localeCompare(b.reference.debut));
}

/** Sous-titre d'un groupe du bandeau : « 3 salariés à clôturer, dont 1 bloqué » ; sorties et avenants d'une période en cours. */
export function groupeTexte(g: GroupeAClore): string {
  const n = new Set(g.plages.map(p => p.e.id)).size;
  return `${plural(g.plages.length, 'plage', 'plages')} à clôturer (${plural(n, 'salarié', 'salariés')})${g.bloquees ? `, dont ${plural(g.bloquees, 'bloquée', 'bloquées')} (feuille à valider, semaine sans feuille…)` : ''}`
    + (g.enCours ? ' · période en cours : sorties et avenants qui font quitter le forfait' : '');
}

/** État d'une ligne enregistrée pour l'écran ; « à revoir » s'ajoute au besoin. */
export const etatTexte = (l: ClotureForfaitHeures, revoir: string | null) => `${etatClotureForfait(l)}${revoir ? ` · à revoir : ${revoir}` : ''}`;
