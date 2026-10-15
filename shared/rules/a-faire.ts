// Ce qui attend une action du collaborateur dans son espace : comptes rendus d'entretien réalisés qu'il n'a pas encore
// signés, feuilles de temps que son valideur lui a renvoyées, et la feuille de la semaine passée pas encore soumise.
// Compté dans le menu (pastilles de « Mes entretiens » et « Mes heures », layout/Shell.tsx) et détaillé dans l'encart
// « À faire » de l'accueil (pages/Portail.tsx), qui y mène directement.
import { addD, mondayOf } from '../dates.ts';
import type { Domain } from '../domain.ts';
import type { Entretien, ISODate } from '../types.ts';
import { semaineHorsContrat } from './absences.ts';

/** Feuille à reprendre : renvoyée par le valideur (avec son commentaire), ou semaine passée encore en brouillon. */
export interface FeuilleAFaire { week: ISODate; etat: 'renvoyee' | 'a_soumettre'; commentaire: string | null }
export interface AFaire { comptesRendus: Entretien[]; feuilles: FeuilleAFaire[] }

/** Lundi de la semaine passée : sa feuille est attendue (soumise) dès le lundi suivant. */
export const semainePassee = (today: ISODate) => addD(mondayOf(today), -7);

export function aFaireCollaborateur(d: Domain, empId: number | null): AFaire {
  const e = empId != null ? d.emp(empId) : undefined;
  if (!e) return { comptesRendus: [], feuilles: [] };
  // Compte rendu clos par l'évaluateur, en attente de la signature du salarié.
  const comptesRendus = d.ds.entretiens.filter(x => x.empId === e.id && x.statut === 'realise' && !x.signSal)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const feuilles: FeuilleAFaire[] = d.ds.feuilles.filter(f => f.empId === e.id && f.statut === 'rejetee')
    .sort((a, b) => a.week.localeCompare(b.week))
    .map(f => ({ week: f.week, etat: 'renvoyee', commentaire: f.comment }));
  // Semaine passée : ni soumise ni validée (une semaine d'absence se soumet aussi, sans heure) ; rien hors contrat.
  const passee = semainePassee(d.ti);
  const sh = d.ds.feuilles.find(f => f.empId === e.id && f.week === passee);
  if ((!sh || sh.statut === 'brouillon') && !semaineHorsContrat(e, passee)) feuilles.push({ week: passee, etat: 'a_soumettre', commentaire: null });
  return { comptesRendus, feuilles };
}
