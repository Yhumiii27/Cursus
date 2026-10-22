// Exports CSV de la formation (t116, t122) : indicateurs du plan par exercice (stagiaires, heures par catégorie, par équipe
// et par statut, coûts, taux de réalisation, lignes de durée inconnue) et formations suivies. Comme les autres listes
// (client/src/listes-csv.ts) : lignes déjà restreintes au profil, aucun texte libre au-delà des intitulés et organismes de
// formation, ni donnée de santé ; nombres à la française. Module sans React : tests/formations-suivies.test.ts.
import type { Domain } from '../../shared/domain.ts';
import { matricule } from '../../shared/format.ts';
import { heuresSuivie, intituleSuivie, ORIGINE_SUIVIE_LABEL, suiviesEnVigueur } from '../../shared/rules/formations-suivies.ts';
import type { IndicateursFormation, LigneIndicateur } from '../../shared/rules/heures-formation.ts';
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
