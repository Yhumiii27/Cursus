// Ce qui attend une action du collaborateur dans son espace : comptes rendus d'entretien réalisés qu'il n'a pas encore
// signés, feuilles de temps que son valideur lui a renvoyées, la feuille de la semaine passée pas encore soumise, et les
// évaluations de formation attendues (lot 7, t121 : avis à chaud, efficacité à froid ; shared/rules/evaluation-formation.ts).
// Compté dans le menu (pastilles de « Mes entretiens », « Mes heures » et « Accueil », layout/Shell.tsx) et détaillé dans
// l'encart « À faire » de l'accueil (pages/Portail.tsx), qui y mène directement.
// lot 12 — C3 (entretiens suivis) : objectifs en cours arrivant à échéance sans mise à jour récente (pastille de « Mes
// objectifs », shared/rules/objectifs-suivi.ts) ; avis 360° demandés au salarié comme répondant, encore à donner
// (pastille de « Avis demandés », étape 3), jamais le nom de l'évalué dans un rappel hors de l'écran.
import { addD, mondayOf } from '../dates.ts';
import type { Domain } from '../domain.ts';
import type { Entretien, ISODate } from '../types.ts';
import { semaineHorsContrat } from './absences.ts';
import { type EvaluationAFaire, evaluationsAFaire } from './evaluation-formation.ts';
// lot 12 — C3 (entretiens suivis)
import type { Objectif, Sollicitation360 } from '../types.ts';
import { objectifsAMettreAJour } from './objectifs-suivi.ts';

/** Feuille à reprendre : renvoyée par le valideur (avec son commentaire), ou semaine passée encore en brouillon. */
export interface FeuilleAFaire { week: ISODate; etat: 'renvoyee' | 'a_soumettre'; commentaire: string | null }
export interface AFaire { comptesRendus: Entretien[]; feuilles: FeuilleAFaire[]; evaluations: EvaluationAFaire[];
  // lot 12 — C3 (entretiens suivis)
  objectifs: Objectif[];
  /** Sollicitations 360° où il est répondant, sans avis donné ni refus, fenêtre ouverte (module activé). */
  avis360: Sollicitation360[];
}

/** Lundi de la semaine passée : sa feuille est attendue (soumise) dès le lundi suivant. */
export const semainePassee = (today: ISODate) => addD(mondayOf(today), -7);

export function aFaireCollaborateur(d: Domain, empId: number | null): AFaire {
  const e = empId != null ? d.emp(empId) : undefined;
  if (!e) return { comptesRendus: [], feuilles: [], evaluations: [], objectifs: [], avis360: [] };
  // Compte rendu clos par l'évaluateur, en attente de la signature du salarié.
  // lot 12 — C3 (entretiens suivis) : un point de suivi n'attend pas de signature (facultative), il n'est pas rappelé.
  const comptesRendus = d.ds.entretiens.filter(x => x.empId === e.id && x.statut === 'realise' && !x.signSal && x.type !== 'point')
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const feuilles: FeuilleAFaire[] = d.ds.feuilles.filter(f => f.empId === e.id && f.statut === 'rejetee')
    .sort((a, b) => a.week.localeCompare(b.week))
    .map(f => ({ week: f.week, etat: 'renvoyee', commentaire: f.comment }));
  // Semaine passée : ni soumise ni validée (une semaine d'absence se soumet aussi, sans heure) ; rien hors contrat.
  // Rien non plus avant le début du suivi des heures dans Cursus, c'est-à-dire avant la première feuille du salarié :
  // à la mise en service, la dernière semaine de la période reprise de Lucca (28 au 31 décembre 2026) n'est pas
  // réclamée, ni à un salarié qui n'a encore jamais saisi d'heures (docs/DEPLOIEMENT.md, « Postes et téléphones »).
  const passee = semainePassee(d.ti);
  const siennes = d.ds.feuilles.filter(f => f.empId === e.id);
  const sh = siennes.find(f => f.week === passee);
  const suivie = siennes.some(f => f.week <= passee);
  if (suivie && (!sh || sh.statut === 'brouillon') && !semaineHorsContrat(e, passee)) feuilles.push({ week: passee, etat: 'a_soumettre', commentaire: null });
  return { comptesRendus, feuilles, evaluations: evaluationsAFaire(d, e.id),
    // lot 12 — C3 (entretiens suivis) : réglage `objectifsActifs` éteint, rien n'est rappelé.
    objectifs: d.ds.settings.objectifsActifs ? objectifsAMettreAJour(d.ds.objectifs ?? [], d.ds.entretiens, e.id, d.ti) : [],
    avis360: d.ds.settings.feedback360Actif ? avisADonner(d.ds.feedbackSollicitations ?? [], e.id, d.ti) : [] };
}

/** Avis 360° à donner par le répondant `empId` : sollicitation envoyée, ni répondue ni déclinée, fenêtre ouverte. */
export function avisADonner(sollicitations: readonly Sollicitation360[], empId: number, today: ISODate): Sollicitation360[] {
  return sollicitations.filter(s => s.repondantEmpId === empId && s.statut === 'envoyee' && !s.closeLe && (!s.echeance || s.echeance >= today))
    .sort((a, b) => (a.echeance ?? '').localeCompare(b.echeance ?? '') || a.id - b.id);
}
