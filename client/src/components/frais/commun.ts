// Notes de frais à l'écran (lot 11, chantier C5, étape 2) : règles d'affichage sans React, partagées par l'écran Notes de
// frais (pages/Frais.tsx), Mes frais, les dialogues et les panneaux de Missions et Voyages (tests/client-frais.test.ts).
// Les droits affichés reprennent ceux du serveur (server/src/actions/frais.ts), qui contrôle de toute façon :
// - l'intéressé (ou le service RH) saisit, soumet et annule tant que personne n'a validé ;
// - le manager direct, ou son suppléant au périmètre « frais », valide ou renvoie une note soumise (jamais la sienne,
//   jamais une note médicale, qu'il ne reçoit pas) ;
// - la comptabilité ou le service RH contrôle une note validée : refus ou plafonnement d'une dépense, renvoi, contrôle.
// Totaux et alertes : calculés (shared/rules/frais*.ts), jamais stockés.
import { droitsRh } from '../../../../shared/constants.ts';
import type { Domain } from '../../../../shared/domain.ts';
import { fmtIso } from '../../../../shared/format.ts';
import { periodeLabel } from '../../../../shared/rules/paie.ts';
import { lignesDe, noteModifiable, totauxNote } from '../../../../shared/rules/frais.ts';
import { alertesDeNote, noteEnCircuit } from '../../../../shared/rules/frais-alertes.ts';
import { type AlerteFrais, bloquantes, totalReintegrable } from '../../../../shared/rules/frais-politique.ts';
import { tvaRecuperable } from '../../../../shared/rules/frais-tva.ts';
import { decideur } from '../../state/delegues.ts';
import type { AvanceFrais, CurrentUser, ISODate, LigneFrais, NoteFrais, Piece, StatutAvanceFrais } from '../../../../shared/types.ts';

/** Montant au centime : « 1 234,50 € » (une autre devise : son code). */
export const euros = (n: number, devise = 'EUR') =>
  `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise === 'EUR' ? '€' : devise}`;

/** « Octobre 2026 » : mois d'une note. */
export const moisNote = (n: Pick<NoteFrais, 'periode'>) => { const p = periodeLabel(n.periode); return p.charAt(0).toUpperCase() + p.slice(1); };

/** Rattachement d'une note : déplacement, mission Keystone, projet ou chantier ; vide sinon. */
export function rattachement(d: Domain, n: Pick<NoteFrais, 'voyageId' | 'missionId' | 'projet'>): string {
  if (n.voyageId) {
    const v = d.ds.voyages.find(x => x.id === n.voyageId);
    if (v) return `Déplacement : ${d.destOf(v.dest)?.pays ?? v.dest}, ${fmtIso(v.depart)} → ${fmtIso(v.retour)}`;
  }
  if (n.missionId) {
    const m = d.ds.missions.find(x => x.id === n.missionId);
    if (m) return `Mission : ${m.projet} · ${m.lieu}`;
  }
  return n.projet ? `Projet ou chantier : ${n.projet}` : '';
}

/** Libellé d'une note dans une liste ou un message : « Note n° 12 — octobre 2026 ». */
export const nomNote = (n: Pick<NoteFrais, 'id' | 'periode' | 'medicale'>) => `Note n° ${n.id} — ${moisNote(n)}${n.medicale ? ' · frais médicaux' : ''}`;

/** Justificatifs en vigueur d'une dépense (frais médicaux compris pour qui les reçoit). */
export const justificatifs = (pieces: readonly Piece[] | undefined, l: Pick<LigneFrais, 'id'>) =>
  (pieces ?? []).filter(p => (p.objet === 'ligneFrais' || p.objet === 'ligneFraisSante') && p.objetId === l.id && !p.retireeLe);

/** Ce que la personne connectée peut faire d'une note (rien de plus que le serveur). */
export interface DroitsNote { saisir: boolean; soumettre: boolean; annuler: boolean; valider: boolean; controler: boolean; renvoyer: boolean }

/** Contrôle des notes de frais : service RH ou comptabilité (droit « compta »). */
export const controleur = (u: Pick<CurrentUser, 'role' | 'profilRh'>) => droitsRh(u).some(x => x === 'rh' || x === 'compta');

export function droitsNote(d: Domain, u: CurrentUser, n: NoteFrais): DroitsNote {
  const rh = droitsRh(u).includes('rh');
  const soi = u.salarieId ?? u.empId;
  const proprio = (u.role !== 'rh' && n.empId === u.empId) || (rh && n.empId !== soi);
  const e = d.emp(n.empId);
  const valideur = !n.medicale && n.empId !== u.empId && ((rh && n.empId !== soi) || (u.role === 'manager' && !!e && decideur(d, e, u.empId, 'frais')));
  const ctrl = u.role === 'rh' && controleur(u) && n.empId !== soi;
  const avantValidation = n.statut === 'brouillon' || n.statut === 'soumise' || n.statut === 'a_corriger';
  return {
    saisir: proprio && noteModifiable(n),
    soumettre: proprio && noteModifiable(n),
    annuler: (proprio && avantValidation) || (rh && n.empId !== soi && (n.statut === 'validee' || n.statut === 'controlee')),
    valider: valideur && n.statut === 'soumise',
    controler: ctrl && n.statut === 'validee',
    renvoyer: (valideur && n.statut === 'soumise') || (ctrl && (n.statut === 'validee' || n.statut === 'controlee')),
  };
}

/** Synthèse d'une note : totaux, alertes par dépense, bloquantes, part réintégrable, TVA récupérable. */
export interface SyntheseNote {
  n: NoteFrais; lignes: LigneFrais[]; demande: number; retenu: number; nb: number; refusees: number;
  alertes: Map<number, AlerteFrais[]>; bloquantes: number; reintegrable: number; tva: number;
}
/**
 * Alertes d'une note : celles que le serveur a jointes à la vue (`alertesFrais` : manager, collaborateur, comptabilité,
 * dont l'instantané n'a pas tout ce qu'elles lisent) pour une note en circuit ; sinon calculées sur l'instantané (service
 * RH, qui a tout ; notes closes, dont les alertes ne décident plus de rien).
 */
export function alertesNote(d: Domain, n: NoteFrais, lignes: readonly LigneFrais[]): Map<number, AlerteFrais[]> {
  const serveur = d.ds.alertesFrais;
  if (!serveur || !noteEnCircuit(n)) return alertesDeNote(d, n, lignes);
  return new Map(lignes.map(l => [l.id, serveur[l.id] ?? []]));
}

export function syntheseNote(d: Domain, n: NoteFrais): SyntheseNote {
  const lignes = lignesDe(d.ds.lignesFrais, n.id);
  const t = totauxNote(lignes);
  const alertes = alertesNote(d, n, lignes);
  const toutes = [...alertes.values()].flat();
  return {
    n, lignes, demande: t.demande, retenu: t.retenu, nb: t.lignes, refusees: t.refusees, alertes,
    bloquantes: bloquantes(toutes).length, reintegrable: totalReintegrable(toutes),
    tva: Math.round(lignes.reduce((s, l) => s + tvaRecuperable(l), 0) * 100) / 100,
  };
}

/** Classe de l'étiquette d'une alerte. */
export const clsAlerte = (a: Pick<AlerteFrais, 'niveau'>) => (a.niveau === 'bloquant' ? 'tag-accent' : a.niveau === 'alerte' ? 'tag-outline' : 'tag-neutral');

export const STATUTS_AVANCE: Record<StatutAvanceFrais, { label: string; cls: string }> = {
  demandee: { label: 'À valider', cls: 'tag-accent' },
  validee: { label: 'Validée, versée avec la paie', cls: 'tag-neutral' },
  en_paiement: { label: 'En paiement', cls: 'tag-neutral' },
  versee: { label: 'Versée', cls: 'tag-neutral' },
  refusee: { label: 'Refusée', cls: 'tag-outline' },
  annulee: { label: 'Annulée', cls: 'tag-outline' },
};

/** Avance que la personne peut valider ou refuser : manager direct, suppléant « frais », ou service RH (jamais la sienne). */
export function decideAvance(d: Domain, u: CurrentUser, a: AvanceFrais): boolean {
  const rh = droitsRh(u).includes('rh'), soi = u.salarieId ?? u.empId;
  if (a.empId === u.empId || (rh && a.empId === soi)) return false;
  const e = d.emp(a.empId);
  return a.statut === 'demandee' && (rh || (u.role === 'manager' && !!e && decideur(d, e, u.empId, 'frais')));
}

/** Notes triées pour une liste : à traiter d'abord (selon l'onglet), puis les plus récentes. */
export const parRecence = (a: NoteFrais, b: NoteFrais) => b.periode.localeCompare(a.periode) || b.id - a.id;

/** Dépenses par mois et par catégorie (tableau de bord), sur les notes non annulées ; frais médicaux comptés à part. */
export interface Agregat { mois: string; montant: number; notes: number }
export function depensesParMois(notes: readonly NoteFrais[], lignes: readonly LigneFrais[], depuis: ISODate): Agregat[] {
  const actives = new Map(notes.filter(n => n.statut !== 'annulee' && n.statut !== 'brouillon' && n.periode >= depuis.slice(0, 7)).map(n => [n.id, n]));
  const par = new Map<string, { montant: number; notes: Set<number> }>();
  for (const l of lignes) {
    const n = actives.get(l.noteId);
    if (!n || l.refuseeLe) continue;
    const g = par.get(n.periode) ?? { montant: 0, notes: new Set<number>() };
    g.montant += l.montantRetenu ?? l.montantEur;
    g.notes.add(n.id);
    par.set(n.periode, g);
  }
  return [...par.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mois, g]) => ({ mois, montant: Math.round(g.montant * 100) / 100, notes: g.notes.size }));
}
