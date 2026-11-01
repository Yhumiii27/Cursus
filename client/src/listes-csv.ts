// Exports CSV des listes RH (t140) : annuaire, registre des habilitations, soldes, absences, plan de formation.
// Chaque export reprend exactement les lignes affichées par l'écran, avec ses filtres (la page passe ses lignes) ;
// le jeu de données est déjà restreint au profil (server/src/dataset.ts) : qui voit l'écran peut l'exporter. Jamais de
// donnée de santé ni de texte libre : ni nature d'une absence hors congés, ni motif d'une mesure sur une habilitation,
// ni motif d'un refus. Fichiers datés du jour ; le téléchargement (downloadCsv de print.ts) neutralise les formules et
// signale l'export au journal avec son nombre de lignes. Module sans React : tests/exports-listes.test.ts.
import { ABS_LABEL, EMP_LABEL, HAB_LABEL, PLAN_LABEL, STATUTS, TEMPS_TRAVAIL, TYPES_CONTRAT } from '../../shared/constants.ts';
import type { Domain, EmpX, HabInfo } from '../../shared/domain.ts';
import { cpPeriods } from '../../shared/dates.ts';
import { matricule } from '../../shared/format.ts';
import { estConge, joursDecomptes, statutAbsence, uniteDecompte } from '../../shared/rules/absences.ts';
import { demiTexte } from '../../shared/rules/demi-journees.ts';
import { cetInfo, cpInfo, recupInfo, rttInfo } from '../../shared/rules/conges.ts';
import { sorti } from '../../shared/rules/contrats.ts';
import { coutRetenu } from '../../shared/rules/exercices.ts';
import type { Absence, Employe, ISODate, PlanAction } from '../../shared/types.ts';
// lot 11 — organigramme
import { ENTETE_CSV_ORGANIGRAMME, type LigneOrganigramme } from './organigramme-vue.ts';

/** Fichier prêt pour `downloadCsv` : nom daté, en-tête, lignes. */
export interface ListeCsv { fichier: string; head: string[]; rows: (string | number)[][] }

/** Date du fichier : JJ/MM/AAAA, lue comme une date par Excel. */
const jma = (iso: ISODate | null | undefined) => iso ? iso.split('-').reverse().join('/') : '';
const jmaDate = (d: Date | null | undefined) => d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
/** Nombre à la française (virgule décimale, deux décimales au plus), lu comme un nombre par Excel. */
export const nombre = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

/** Mention des soldes : Cursus fait foi pour les compteurs depuis la reprise (réponse de l'entreprise) ; la mention précise la source du fichier. */
export const MENTION_SOLDES = 'Soldes calculés par Cursus';

/** Contrat en clair : « CDD · Cadre · Forfait jours ». */
function contrat(d: Domain, e: Employe) {
  const c = d.contratOf(e);
  return [TYPES_CONTRAT[c.typeContrat].label, STATUTS[c.statut].court, TEMPS_TRAVAIL[c.temps].court].join(' · ');
}

/**
 * Annuaire (écran Collaborateurs) : lignes affichées (équipe, statut ou sortis, recherche). Statut de conformité et
 * prochaine échéance comme dans le tableau ; « Sorti » pour un salarié dont la sortie est passée.
 */
export function csvAnnuaire(d: Domain, rows: EmpX[]): ListeCsv {
  return {
    fichier: `annuaire-${d.ti}.csv`,
    head: ['Collaborateur', 'Matricule', 'Matricule de paie', 'Poste', 'Équipe', 'Contrat', 'Entrée', 'Sortie', 'Statut de conformité', 'Prochaine échéance'],
    rows: rows.map(e => [e.nom, matricule(e.id), e.matriculePaie ?? '', e.poste, e.equipe ?? 'À affecter', contrat(d, e), jma(e.entree), jma(e.fin),
      sorti(e, d.ti) ? 'Sorti' : EMP_LABEL[e.worst], jmaDate(e.next?.exp)]),
  };
}

/**
 * Registre des habilitations (écran Habilitations) : lignes affichées (statut, type choisi). La suspension ou le retrait
 * figure dans le statut, sans son motif (texte libre, comme dans le passeport formation).
 */
export function csvRegistre(d: Domain, rows: { e: EmpX; h: HabInfo }[]): ListeCsv {
  return {
    fichier: `registre-habilitations-${d.ti}.csv`,
    head: ['Titulaire', 'Matricule', 'Équipe', 'Habilitation', 'Délivrée le', 'Délivrée par', 'Échéance', 'Statut', 'Prérequis manquants'],
    rows: rows.map(({ e, h }) => [e.nom, matricule(e.id), e.equipe ?? 'À affecter', h.hm.nom, jma(h.delivree), h.par ?? '',
      jmaDate(h.exp), HAB_LABEL[h.key], h.checks.filter(c => !c.ok).map(c => c.label).join(' · ')]),
  };
}

/**
 * Soldes (écran Congés & absences) : CP de la période, en cours d'acquisition, RTT ou repos de l'année, récupération
 * (heures), CET (jours, demandes en attente déduites comme à l'écran) ; vide quand le compteur ne concerne pas le contrat. Chaque ligne porte la date d'arrêté et la
 * mention des soldes calculés par Cursus.
 */
export function csvSoldes(d: Domain, emps: Employe[]): ListeCsv {
  const P = cpPeriods(d.ti), Y = d.year, arrete = jma(d.ti);
  return {
    fichier: `soldes-${d.ti}.csv`,
    head: ['Collaborateur', 'Matricule', 'Équipe', 'Contrat', `CP ${P.label} (j)`, `Droit CP ${P.label} (j)`, `CP en acquisition ${P.labelN} (j)`, `RTT / repos ${Y} (j)`,
      'Récupération (h)', 'CET (j)', 'Soldes au', 'Source'],
    rows: emps.map(e => {
      const c = d.contratOf(e), cp = cpInfo(d, e), rt = rttInfo(d, e), rc = recupInfo(d, e), ct = cetInfo(d, e);
      const cet = !c.interim && ct.eligible;
      return [e.nom, matricule(e.id), e.equipe ?? 'À affecter', contrat(d, e),
        cp ? nombre(cp.solde) : 'Agence d’intérim', cp ? nombre(cp.droit) : '', cp ? nombre(cp.enCours) : '',
        rt ? nombre(rt.solde) : '', rc ? nombre(rc.solde) : '', cet ? nombre(ct.solde) : '', arrete, MENTION_SOLDES];
    }),
  };
}

/**
 * Absences (écran Congés & absences) : lignes affichées. Congés payés, RTT et récupération sont nommés ; toute autre
 * absence reste « Absence » (jamais sa nature : arrêt, accident, enfant malade… sont des données de santé), quel que
 * soit le profil. Son décompte aussi est celui d'une absence générique (jours calendaires) : l'unité et le nombre de
 * jours de la nature réelle (calendaires pour un arrêt, ouvrés pour un enfant malade) trahiraient sa catégorie.
 * Ni motif de refus, ni signalement nominatif. Demi-journées d'un congé : jours décomptés 0,5 et dernière colonne
 * (« après-midi le premier jour · matin le dernier jour »), vide pour des journées entières.
 */
export function csvAbsences(d: Domain, list: { a: Absence; e: Employe }[]): ListeCsv {
  return {
    fichier: `absences-${d.ti}.csv`,
    head: ['Collaborateur', 'Matricule', 'Équipe', 'Absence', 'Du', 'Au', 'Jours', 'Décompte', 'Statut', 'Demi-journées'],
    rows: list.map(({ a, e }) => {
      const t = estConge(a.type) ? a.type : 'ABSENCE';
      return [e.nom, matricule(e.id), e.equipe ?? 'À affecter', estConge(t) ? ABS_LABEL[t] : 'Absence',
        jma(a.du), jma(a.au), nombre(joursDecomptes(d, e, { ...a, type: t })), `jours ${uniteDecompte(t)}`, statutAbsence(a), estConge(t) ? demiTexte(a) : ''];
    }),
  };
}

const ORIGINE: Record<string, string> = { import: 'Plan importé', demande: 'Demande acceptée', report: 'Report de l’exercice précédent' };

/**
 * Plan de formation (écran Plan & budget) : lignes affichées de l'exercice (filtre de statut). Effectif et coût retenus
 * (réels pour une action réalisée), coût prévu à côté.
 */
export function csvPlan(d: Domain, exercice: number, lignes: PlanAction[]): ListeCsv {
  return {
    fichier: `plan-formation-${exercice}-${d.ti}.csv`,
    // Catégorie du catalogue et durée en heures par stagiaire (t122) : vide quand elle est inconnue.
    head: ['Exercice', 'Formation', 'Équipe', 'Période', 'Effectif', 'Coût (€)', 'Coût prévu (€)', 'Statut', 'Origine', 'Catégorie', 'Durée (h)'],
    rows: lignes.map(l => {
      const fm = (l.f && d.fm(l.f)) || null;
      return [l.exercice, fm ? fm.nom : l.libelle ?? '', l.equipe, l.periode, l.statut === 'realise' && l.effectifReel != null ? l.effectifReel : l.effectif,
        nombre(coutRetenu(l)), nombre(l.cout), PLAN_LABEL[l.statut], l.origine ? ORIGINE[l.origine] ?? l.origine : '',
        fm ? fm.type : 'Hors catalogue', fm?.dureeHeures != null ? nombre(fm.dureeHeures) : ''];
    }),
  };
}

// lot 11 — organigramme
/**
 * Organigramme (pages/Organigramme.tsx) : une ligne par personne affichée (filtres d'entité et de site, recherche), avec
 * la structure (société, établissement, site, chemin des équipes, manager, valideur) et les seules colonnes de l'annuaire
 * (nom, poste, équipe) : ni contrat, ni étiquette, ni sortie, ni santé, quel que soit le profil. `entite` : code de
 * l'entité filtrée, dans le nom du fichier.
 */
export function csvOrganigramme(today: ISODate, lignes: LigneOrganigramme[], entite: string | null): ListeCsv {
  return {
    fichier: `organigramme${entite ? `-${entite}` : ''}-${today}.csv`,
    head: ENTETE_CSV_ORGANIGRAMME,
    rows: lignes.map(l => [l.societe, l.etablissement, l.site, l.chemin, l.equipe, l.nom, l.poste, l.manager, l.valideur]),
  };
}
