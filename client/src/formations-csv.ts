// Exports CSV de la formation (t116, t122) : indicateurs du plan par exercice (stagiaires, heures par catégorie, par équipe
// et par statut, coûts, taux de réalisation, lignes de durée inconnue) et formations suivies. Comme les autres listes
// (client/src/listes-csv.ts) : lignes déjà restreintes au profil, aucun texte libre au-delà des intitulés et organismes de
// formation, ni donnée de santé ; nombres à la française. Module sans React : tests/formations-suivies.test.ts. Lot 7 (t121) :
// indicateurs des évaluations des formations (tests/client-evaluations-formation.test.ts).
import type { Domain } from '../../shared/domain.ts';
import { matricule } from '../../shared/format.ts';
import { heuresSuivie, intituleSuivie, ORIGINE_SUIVIE_LABEL, suiviesEnVigueur } from '../../shared/rules/formations-suivies.ts';
import type { IndicateursFormation, LigneIndicateur } from '../../shared/rules/heures-formation.ts';
import type { IndicateursEvaluation, LigneEvaluation } from '../../shared/types.ts';
import { nombre, type ListeCsv } from './listes-csv.ts';

const jma = (iso: string) => iso.split('-').reverse().join('/');

/** Indicateurs de l'exercice : une ligne par regroupement, puis les formations de durée inconnue. */
export function csvIndicateurs(d: Domain, x: IndicateursFormation): ListeCsv {
  const lignes = (groupe: string, l: LigneIndicateur[]) => l.map(r => [groupe, r.cle, r.stagiaires, r.realisations, nombre(r.heures), r.inconnues]);
  return {
    fichier: `indicateurs-formation-${x.exercice}-${d.ti}.csv`,
    head: ['Regroupement', 'Valeur', 'Stagiaires', 'Formations réalisées', 'Heures', 'Durée inconnue'],
    rows: [
      ...lignes('Total', [x.total]),
      ...lignes('Catégorie', x.parCategorie),
      ...lignes('Équipe', x.parEquipe),
      ...lignes('Statut', x.parStatut),
      ['Plan', 'Actions (hors reportées)', x.actions, x.actionsRealisees, '', ''],
      ['Plan', 'Taux de réalisation (%)', x.tauxRealisation ?? '', '', '', ''],
      ['Plan', 'Coût prévu (€)', nombre(x.coutPrevu), '', '', ''],
      ['Plan', 'Coût des actions réalisées (€)', nombre(x.coutRealise), '', '', ''],
      ...x.inconnues.map(r => ['Durée inconnue', `${r.intitule} — ${r.nom} (${jma(r.date)})`, '', '', '', 1]),
    ],
  };
}

/** Formations suivies en vigueur, de tous les salariés visibles ou d'un exercice (`exercice` : année du premier jour). */
export function csvFormationsSuivies(d: Domain, exercice?: number): ListeCsv {
  const liste = suiviesEnVigueur(d.ds).filter(x => exercice == null || x.du.startsWith(`${exercice}-`))
    .sort((a, b) => a.du.localeCompare(b.du) || a.id - b.id);
  return {
    fichier: `formations-suivies${exercice ? `-${exercice}` : ''}-${d.ti}.csv`,
    head: ['Salarié', 'Matricule', 'Équipe', 'Formation', 'Catégorie', 'Du', 'Au', 'Durée (h)', 'Organisme', 'Obligatoire', 'Origine'],
    rows: liste.map(x => {
      const e = d.emp(x.empId), fm = x.f ? d.fm(x.f) : null, h = heuresSuivie(d, x);
      return [e?.nom ?? '', matricule(x.empId), e?.equipe ?? 'À affecter', intituleSuivie(d, x), fm ? fm.type : 'Hors catalogue', jma(x.du), jma(x.au),
        h == null ? '' : nombre(h), x.organisme ?? fm?.organisme ?? '', x.obligatoire ? 'Oui' : 'Non', ORIGINE_SUIVIE_LABEL[x.origine]];
    }),
  };
}

/**
 * Indicateurs des évaluations de l'exercice (lot 7, t121 ; shared/rules/evaluation-formation.ts) : total, par organisme et
 * par formation. Agrégats seulement, jamais d'avis nominatif ni de commentaire ; un regroupement masqué (moins de
 * 3 réponses, vue du référent HSE et de la lecture seule) a ses moyennes et taux vides.
 */
export function csvEvaluations(d: Domain, x: IndicateursEvaluation): ListeCsv {
  const v = (n: number | null) => (n == null ? '' : nombre(n));
  const lignes = (groupe: string, l: LigneEvaluation[]) => l.map(r => [
    groupe, r.cle, r.participants, r.chaud, v(r.moyenneChaud), v(r.tauxChaud), r.froidAttendus, r.froid, r.efficaces, r.partielles, r.non,
    v(r.tauxEfficacite), v(r.tauxFroid), r.sessionsNotees, v(r.moyenneSessions), r.masque ? 'Oui' : '',
  ]);
  return {
    fichier: `evaluations-formation-${x.exercice}-${d.ti}.csv`,
    head: [
      'Regroupement', 'Valeur', 'Participants', 'Avis à chaud', 'Moyenne à chaud (/5)', 'Réponse à chaud (%)', 'Avis à froid attendus', 'Avis à froid reçus',
      'Efficace', 'Partiellement efficace', 'Pas efficace', 'Efficacité (%)', 'Réponse à froid (%)', 'Sessions notées (service RH)', 'Moyenne des sessions (/5)',
      'Moins de 3 réponses',
    ],
    rows: [...lignes('Total', [x.total]), ...lignes('Organisme', x.parOrganisme), ...lignes('Formation', x.parFormation)],
  };
}
