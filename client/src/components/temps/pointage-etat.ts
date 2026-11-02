// Badgeage virtuel (lot 12, chantier C6, étape 2) : règles d'affichage sans React, partagées par le bouton « Pointer »
// (components/BoutonPointer.tsx), l'écran Pointages (pages/Pointages.tsx, components/temps/Pointages.tsx), le menu
// (layout/Shell.tsx) et les tests du client.
import type { Domain } from '../../../../shared/domain.ts';
import { fmtIso } from '../../../../shared/format.ts';
import { hhmmParis, modeTempsAu, MOTIFS_CORRECTION } from '../../../../shared/rules/pointage.ts';
import type { CorrectionPointage, Dataset, ISODate, ModeTemps } from '../../../../shared/types.ts';
import { decideur } from '../../state/delegues.ts';

/** « 7 h 30 », « 45 min », « 0 h » : durée en minutes. */
export function fMinutes(m: number): string {
  const a = Math.abs(Math.round(m)), h = Math.floor(a / 60), mn = a % 60;
  const t = h ? `${h} h${mn ? ` ${String(mn).padStart(2, '0')}` : ''}` : mn ? `${mn} min` : '0 h';
  return m < 0 && a ? `− ${t}` : t;
}
/** Solde signé : « + 1 h 15 », « − 30 min », « 0 h ». */
export const fSolde = (m: number) => (Math.round(m) > 0 ? `+ ${fMinutes(m)}` : fMinutes(m));

/** Mode de décompte du salarié `empId` le jour `jour` (module inactif, hors population : « declaratif »). */
export function modeDe(data: Dataset, empId: number | null, jour: ISODate = data.today): ModeTemps {
  const e = empId != null ? data.employes.find(x => x.id === empId) : undefined;
  if (!e || !data.settings.pointageActif) return 'declaratif';
  return modeTempsAu({ settings: data.settings, equipes: data.referentiels.equipes, entites: data.referentiels.entites ?? [] }, e, jour);
}
/** Le salarié pointe-t-il ce jour-là (population en mode « controle » ou « calcule ») ? */
export const pointe = (data: Dataset, empId: number | null, jour?: ISODate) => modeDe(data, empId, jour) !== 'declaratif';

/** Valideur des pointages du salarié : service RH (jamais pour soi), manager direct ou suppléant « feuilles ». */
export function valideurPointages(d: Domain, empId: number, o: { rh: boolean; manager: boolean; me: number | null; soi: number | null }): boolean {
  const e = d.emp(empId);
  return !!e && ((o.rh && empId !== o.soi) || (o.manager && empId !== o.me && decideur(d, e, o.me, 'feuilles')));
}

/** Demandes de correction en attente que la personne connectée décide (file de validation, pastille du menu). */
export function correctionsAValider(d: Domain, o: { rh: boolean; manager: boolean; me: number | null; soi: number | null }): CorrectionPointage[] {
  return (d.ds.correctionsPointage ?? []).filter(c => c.statut === 'demandee' && valideurPointages(d, c.empId, o))
    .sort((a, b) => a.demandeLe.localeCompare(b.demandeLe));
}

export const STATUTS_CORRECTION: Record<CorrectionPointage['statut'], { label: string; cls: string }> = {
  demandee: { label: 'En attente', cls: 'tag-accent' },
  validee: { label: 'Validée', cls: 'tag-neutral' },
  refusee: { label: 'Refusée', cls: 'tag-outline' },
  annulee: { label: 'Retirée', cls: 'tag-outline' },
};

/** « Arrivée à 08:00 oubliée, mardi 6 oct. » ; « Retrait d'un pointage du 6 oct. 2026 » : objet d'une demande, sans commentaire. */
export function objetCorrection(c: Pick<CorrectionPointage, 'nature' | 'horodatage' | 'sens' | 'jour'>): string {
  if (c.nature === 'ajout' && c.horodatage) return `${c.sens === 'S' ? 'Départ' : 'Arrivée'} à ${hhmmParis(c.horodatage)} à ajouter, le ${fmtIso(c.jour)}`;
  return `Pointage erroné à retirer, le ${fmtIso(c.jour)}`;
}
export const motifCorrection = (c: Pick<CorrectionPointage, 'motif'>) => MOTIFS_CORRECTION[c.motif] ?? c.motif;

/** État de présence du jour (sans la nature d'une absence). */
export const PRESENCES: Record<string, { label: string; cls: string }> = {
  present: { label: 'Présent', cls: 'tag-accent' },
  parti: { label: 'Parti', cls: 'tag-neutral' },
  non_pointe: { label: 'Non pointé', cls: 'tag-outline' },
  absent: { label: 'Absent', cls: 'tag-outline' },
};
