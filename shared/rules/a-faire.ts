// Ce qui attend une action du collaborateur dans son espace : comptes rendus d'entretien réalisés qu'il n'a pas encore
// signés, feuilles de temps que son valideur lui a renvoyées, la feuille de la semaine passée pas encore soumise, et les
// évaluations de formation attendues (lot 7, t121 : avis à chaud, efficacité à froid ; shared/rules/evaluation-formation.ts).
// Compté dans le menu (pastilles de « Mes entretiens », « Mes heures » et « Accueil », layout/Shell.tsx) et détaillé dans
// l'encart « À faire » de l'accueil (pages/Portail.tsx), qui y mène directement.
import { addD, mondayOf } from '../dates.ts';
import type { Domain } from '../domain.ts';
import type { Entretien, ISODate } from '../types.ts';
import { semaineHorsContrat } from './absences.ts';
import { type EvaluationAFaire, evaluationsAFaire } from './evaluation-formation.ts';

/** Feuille à reprendre : renvoyée par le valideur (avec son commentaire), ou semaine passée encore en brouillon. */
export interface FeuilleAFaire { week: ISODate; etat: 'renvoyee' | 'a_soumettre'; commentaire: string | null }
export interface AFaire { comptesRendus: Entretien[]; feuilles: FeuilleAFaire[]; evaluations: EvaluationAFaire[] }

/** Lundi de la semaine passée : sa feuille est attendue (soumise) dès le lundi suivant. */
export const semainePassee = (today: ISODate) => addD(mondayOf(today), -7);

export function aFaireCollaborateur(d: Domain, empId: number | null): AFaire {
  const e = empId != null ? d.emp(empId) : undefined;
  if (!e) return { comptesRendus: [], feuilles: [], evaluations: [] };
  // Compte rendu clos par l'évaluateur, en attente de la signature du salarié.
  const comptesRendus = d.ds.entretiens.filter(x => x.empId === e.id && x.statut === 'realise' && !x.signSal)
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
  return { comptesRendus, feuilles, evaluations: evaluationsAFaire(d, e.id) };
}
