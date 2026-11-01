// Jeu de données de démonstration (repris du prototype Claude Design) :
// 24 collaborateurs d'un site industriel lyonnais, CCN Industries chimiques.
// lot 11 — notes de frais
import { fraisDemo } from './frais-demo.ts';
import { Domain } from '../../shared/domain.ts';
import { addD, addM, isFerie, joursSemaine, weekday } from '../../shared/dates.ts';
import { matricule } from '../../shared/format.ts';
import { identifiantSuggere, typeSuggere } from '../../shared/rules/comptes.ts';
import { repriseDesAbsences } from '../../shared/rules/absences.ts';
import { completerSession } from '../../shared/rules/plage-session.ts';
import { cpDroit, rttDroit } from '../../shared/rules/conges.ts';
import type {
  AutorisationTravail, AvisMedical, Dataset, Employe, EntretienType, Messagerie, ProfilRh, Restriction, Statut, TempsTravail, TypeContrat, VaccinId,
} from '../../shared/types.ts';
// lot 11 — indicateurs
import type { CategorieEmploi, Sexe } from '../../shared/types.ts';
import { ACTIVITE_FORMATION, MOTIF_RESTRICTION } from '../../shared/constants.ts';
import { VERSION } from './chemins.ts';
import type { Db } from './db.ts';
import { DEFAULT_SETTINGS, loadFull } from './dataset.ts';
import { marqueurDemo, REGLAGE_DEMO, REGLAGE_EXPLOITATION } from './marqueurs.ts';
import { contexte, enregistrerAffectation, enregistrerChantier, enregistrerProjet, enregistrerTache } from './integrations/keystone-entrant.ts';
import { suivreVerdicts } from './integrations/keystone-verdicts.ts';
import { figerFeuilles } from './migrate.ts';
import { postesDepuisFiches } from './migrations/referentiels.ts';
import { historiqueDepuisFiches } from './migrations/lot6-contrats.ts';
import { delivrancesDepuisTitres } from './migrations/lot6-securite.ts';
import { lotHistorique } from './migrations/paie.ts';
import { amorcerActivites } from './migrations/temps.ts';
import { amorcerHoraires } from './migrations/lot6-horaires.ts';
import { amorcerActiviteAstreinte } from './migrations/lot7-astreintes.ts';
// lot 12 — C5 (planning d'équipe)
import { amorcerCycles } from './migrations/lot12-planning.ts';

// Mode de validation : évaluation réussie pour les habilitations électriques, CACES, SST, ATEX, AIPR et PRAP ;
// la présence suffit pour les sensibilisations et formations d'information.
// `passeportPrevention` : formations santé-sécurité à déclarer au Passeport de prévention (lot 7, t066), comme les coche la
// migration lot7-prevention-passeport sur une base existante (ni FCO, ni RGPD).
// FORMATIONS, HABILITATIONS et DESTS forment aussi le référentiel type, chargé sur une base vide par le service RH
// (`referentiel.charger`, server/src/actions/referentiels.ts), sans les salariés.
export const FORMATIONS = [
  { id: 'sst', nom: 'Sauveteur secouriste du travail (SST)', court: 'SST', type: 'Réglementaire', validite: 24, duree: '7 h (MAC)', organisme: 'Croix-Rouge française', cout: 180, validation: 'evaluation', dureeHeures: 7, passeportPrevention: true },
  { id: 'elec', nom: 'Préparation à l’habilitation électrique B1V · B2V · BR', court: 'Formation élec. B1V-BR', type: 'Réglementaire', validite: 36, duree: '21 h', organisme: 'Apave', cout: 480, validation: 'evaluation', dureeHeures: 21, passeportPrevention: true },
  { id: 'atex', nom: 'Intervention en zone ATEX (niveau 1)', court: 'ATEX', type: 'Réglementaire', validite: 36, duree: '7 h', organisme: 'Apave', cout: 350, validation: 'evaluation', dureeHeures: 7, passeportPrevention: true },
  { id: 'caces489', nom: 'CACES R489 — Chariots élévateurs (cat. 3)', court: 'CACES R489', type: 'Réglementaire', validite: 60, duree: '21 h', organisme: 'AFTRAL', cout: 650, validation: 'evaluation', dureeHeures: 21, passeportPrevention: true },
  { id: 'caces486', nom: 'CACES R486 — Nacelles PEMP (cat. B)', court: 'CACES R486', type: 'Réglementaire', validite: 60, duree: '21 h', organisme: 'AFTRAL', cout: 650, validation: 'evaluation', dureeHeures: 21, passeportPrevention: true },
  { id: 'epi', nom: 'Équipier de première intervention incendie', court: 'EPI incendie', type: 'Réglementaire', validite: 12, duree: '4 h', organisme: 'Interne · HSE', cout: 40, validation: 'presence', dureeHeures: 4, passeportPrevention: true },
  { id: 'fco', nom: 'FCO Marchandises', court: 'FCO', type: 'Réglementaire', validite: 60, duree: '35 h', organisme: 'AFTRAL', cout: 900, validation: 'presence', dureeHeures: 35 },
  { id: 'aipr', nom: 'AIPR — Opérateur', court: 'AIPR', type: 'Réglementaire', validite: 60, duree: '7 h', organisme: 'Apave', cout: 190, validation: 'evaluation', dureeHeures: 7, passeportPrevention: true },
  { id: 'hauteur', nom: 'Travail en hauteur et port du harnais', court: 'Travail en hauteur', type: 'Recommandée', validite: 36, duree: '7 h', organisme: 'Socotec', cout: 320, validation: 'presence', dureeHeures: 7, passeportPrevention: true },
  { id: 'prap', nom: 'PRAP IBC — Prévention des risques liés à l’activité physique', court: 'PRAP', type: 'Recommandée', validite: 24, duree: '14 h', organisme: 'INRS', cout: 420, validation: 'evaluation', dureeHeures: 14, passeportPrevention: true },
  { id: 'rgpd', nom: 'Sensibilisation RGPD et sécurité de l’information', court: 'RGPD', type: 'Interne', validite: 24, duree: '2 h', organisme: 'Interne · DSI', cout: 0, validation: 'presence', dureeHeures: 2 },
];

export const HABILITATIONS = [
  { id: 'he', nom: 'Habilitation électrique', detail: 'B1V · B2V · BR — NF C18-510', prereqs: ['elec'], medical: true, validite: 36, signataire: 'Karim Haddad', modele: 'electrique' },
  { id: 'ac489', nom: 'Autorisation de conduite — chariots R489', detail: 'Chariots élévateurs cat. 3', prereqs: ['caces489'], medical: true, validite: 60, signataire: 'Olivier Marchal', modele: 'conduite' },
  { id: 'ac486', nom: 'Autorisation de conduite — nacelles R486', detail: 'PEMP cat. B', prereqs: ['caces486'], medical: true, validite: 60, signataire: 'Karim Haddad', modele: 'conduite' },
  { id: 'atex', nom: 'Habilitation ATEX', detail: 'Zones 1 et 2 — niveau 1', prereqs: ['atex'], medical: false, validite: 36, signataire: 'Sarah Cohen' },
  { id: 'hauteur', nom: 'Autorisation travaux en hauteur', detail: 'Port du harnais · accès toitures', prereqs: ['hauteur'], medical: true, validite: 36, signataire: 'Sarah Cohen' },
  { id: 'aipr', nom: 'Autorisation AIPR', detail: 'Intervention à proximité des réseaux', prereqs: ['aipr'], medical: false, validite: 60, signataire: 'Karim Haddad' },
];

// `secu` : convention bilatérale de sécurité sociale (Maroc, Inde, États-Unis, Côte d'Ivoire, Brésil), sinon maintien au régime français.
export const DESTS = [
  { code: 'MA', pays: 'Maroc', visa: 'none', visaSub: 'séjour ≤ 90 jours', oblig: [], rec: ['hepA', 'typhoide'], passMois: 0, secu: 'convention' },
  { code: 'IN', pays: 'Inde', visa: 'evisa', visaSub: '', oblig: [], rec: ['hepA', 'typhoide', 'hepB'], passMois: 6, secu: 'convention' },
  { code: 'US', pays: 'États-Unis', visa: 'esta', visaSub: '', oblig: [], rec: [], passMois: 0, secu: 'convention' },
  { code: 'CI', pays: 'Côte d’Ivoire', visa: 'evisa', visaSub: '', oblig: ['fj'], rec: ['hepA', 'typhoide'], passMois: 6, secu: 'convention' },
  { code: 'GH', pays: 'Ghana', visa: 'embassy', visaSub: '', oblig: ['fj'], rec: ['hepA', 'typhoide'], passMois: 6, secu: 'hors_convention' },
  { code: 'BR', pays: 'Brésil', visa: 'none', visaSub: 'séjour ≤ 90 jours', oblig: [], rec: ['fj', 'hepA', 'typhoide'], passMois: 6, secu: 'convention' },
  { code: 'SA', pays: 'Arabie saoudite', visa: 'evisa', visaSub: '', oblig: [], rec: ['hepA', 'typhoide'], passMois: 6, secu: 'hors_convention' },
  { code: 'VN', pays: 'Vietnam', visa: 'none', visaSub: 'séjour ≤ 45 jours', oblig: [], rec: ['hepA', 'typhoide'], passMois: 6, secu: 'hors_convention' },
];

const EQUIPES: [string, number][] = [['Logistique', 16], ['Maintenance', 12], ['Production', 3], ['Qualité & HSE', 23], ['Administration', 14], ['Commercial', 9]];

// — Keystone : projets, chantiers, affectations et planning, chargés par les fonctions de l'API entrante —

const PROJETS: Record<string, string> = {
  'K-2614': 'Rétrofit presse hydraulique', 'K-2620': 'Maintenance zone ATEX', 'K-2611': 'Mise en service ligne d’embouteillage', 'K-2625': 'Audit HSE usine',
  'K-2631': 'Transfert de ligne de conditionnement', 'K-2633': 'Dépannage four tunnel',
  'INT-PROD': 'Production — lignes internes', 'INT-LOG': 'Logistique interne', 'INT-MAINT': 'Maintenance interne', 'INT-HSE': 'Qualité, hygiène, sécurité',
  'INT-QUA': 'Contrôle qualité', 'INT-ADM': 'Fonctions support', 'INT-COM': 'Commercial & avant-vente', 'ECOLE': 'Cours en CFA (alternance)',
  [ACTIVITE_FORMATION.code]: ACTIVITE_FORMATION.nom,
};

/** Chantiers et exigences du Go / No Go ; le dépannage de Grenoble, terminé, est archivé. Les ressources viennent des affectations. */
const CHANTIERS = [
  { id: 'K-2614', nom: 'Rétrofit presse hydraulique', client: 'Atlas Emboutissage', lieu: 'Tanger', pays: 'MA', debut: '2026-10-27', fin: '2026-11-06', chef: 'Karim Haddad', habilitations: ['he', 'hauteur'], certifications: ['sst'] },
  { id: 'K-2620', nom: 'Maintenance zone ATEX', client: 'Pétrochimie du Rhône', lieu: 'Feyzin', pays: 'FR', debut: '2026-10-19', fin: '2026-10-23', chef: 'Sarah Cohen', habilitations: ['atex'], certifications: ['sst'] },
  { id: 'K-2611', nom: 'Mise en service ligne d’embouteillage', client: 'Sivop Boissons', lieu: 'Abidjan', pays: 'CI', debut: '2026-11-09', fin: '2026-11-27', chef: 'Karim Haddad', habilitations: ['he'], certifications: ['sst'] },
  { id: 'K-2625', nom: 'Audit HSE usine', client: 'Tema Packaging', lieu: 'Tema', pays: 'GH', debut: '2026-12-01', fin: '2026-12-05', chef: 'Sarah Cohen', habilitations: [], certifications: ['sst'] },
  { id: 'K-2631', nom: 'Transfert de ligne de conditionnement', client: 'Embalagens Paulista', lieu: 'São Paulo', pays: 'BR', debut: '2027-01-18', fin: '2027-01-29', chef: 'Olivier Marchal', habilitations: ['ac489'], certifications: ['caces489'] },
  { id: 'K-2633', nom: 'Dépannage four tunnel', client: 'Céramiques du Dauphiné', lieu: 'Grenoble', pays: 'FR', debut: '2026-10-06', fin: '2026-10-08', chef: 'Karim Haddad', habilitations: [], certifications: [], statut: 'archive' },
];

/**
 * Affectations (présence sur un chantier) : missions des salariés et ressources des chantiers. Le repérage
 * de Mehdi Benali à Feyzin précède le chantier : mission sans entrer dans le Go / No Go.
 */
const AFFECTATIONS = [
  { empId: 6, chantier: 'K-2633', du: '2026-10-06', au: '2026-10-08' },
  { empId: 2, chantier: 'K-2620', du: '2026-10-08', au: '2026-10-09' },
  ...[3, 8, 22].map(empId => ({ empId, chantier: 'K-2620', du: '2026-10-19', au: '2026-10-23' })),
  ...[18, 6, 12].map(empId => ({ empId, chantier: 'K-2614', du: '2026-10-27', au: '2026-11-06' })),
  ...[12, 18].map(empId => ({ empId, chantier: 'K-2611', du: '2026-11-09', au: '2026-11-27' })),
  ...[23, 5].map(empId => ({ empId, chantier: 'K-2625', du: '2026-12-01', au: '2026-12-05' })),
  ...[22, 16].map(empId => ({ empId, chantier: 'K-2631', du: '2027-01-18', au: '2027-01-29' })),
].map(a => ({ id: `AF-${a.chantier}-${a.empId}`, ...a }));

interface Profil {
  statut: Statut; typeContrat: TypeContrat; temps: TempsTravail; entree: string; naissance: number;
  fin?: string; heures?: number; forfaitHeures?: number; forfaitJours?: number; jourOff?: number[]; agence?: string; reprise?: { motif: string; date: string };
}
const cdi = (statut: Statut, temps: TempsTravail, entree: string, naissance: number, extra: Partial<Profil> = {}): Profil => ({ statut, typeContrat: 'cdi', temps, entree, naissance, ...extra });
const PROFILS: Record<number, Profil> = {
  1: cdi('ouvrier', '35h', '2019-03-04', 1990),
  2: cdi('technicien', '39h_rtt', '2016-09-01', 1985),
  3: cdi('technicien', '39h_rtt', '2012-05-14', 1981),
  4: { statut: 'ouvrier', typeContrat: 'cdd', temps: '35h', entree: '2026-02-02', fin: '2027-01-29', naissance: 1999 },
  5: cdi('cadre', '35h', '2021-01-11', 1988),
  6: cdi('technicien', '39h_rtt', '2009-04-06', 1976),
  7: cdi('technicien', 'partiel', '2014-10-01', 1983, { heures: 28, jourOff: [2], reprise: { motif: 'congé parental d’éducation', date: '2026-09-01' } }),
  8: cdi('ouvrier', '35h', '2018-06-04', 1994),
  9: cdi('cadre', 'forfait_jours', '2011-02-01', 1979, { forfaitJours: 218 }),
  10: cdi('ouvrier', '35h', '2017-11-06', 1987),
  11: cdi('cadre', 'forfait_heures_annuel', '2022-09-05', 1992, { forfaitHeures: 1607 }),
  12: cdi('cadre', 'forfait_jours', '2005-01-03', 1967, { forfaitJours: 218 }),
  13: cdi('ouvrier', 'partiel', '2020-03-02', 1971, { heures: 21, jourOff: [3, 4] }),
  14: cdi('technicien', 'forfait_heures_hebdo', '2023-04-03', 1995, { heures: 38.5 }),
  15: { statut: 'ouvrier', typeContrat: 'interim', temps: '35h', entree: '2026-06-15', naissance: 2001, agence: 'Proman Lyon' },
  16: cdi('ouvrier', '39h_rtt', '2015-08-24', 1986),
  17: cdi('technicien', '35h', '2024-01-08', 1997),
  18: cdi('technicien', '39h_rtt', '2013-03-18', 1984),
  19: cdi('cadre', 'forfait_jours', '2025-11-03', 1996, { forfaitJours: 218 }),
  20: cdi('ouvrier', '35h', '2021-06-01', 1993),
  21: cdi('ouvrier', 'partiel', '2010-09-13', 1966, { heures: 28, jourOff: [4] }),
  22: cdi('ouvrier', '39h_rtt', '2008-02-04', 1978),
  23: cdi('cadre', 'forfait_jours', '2016-01-04', 1980, { forfaitJours: 218 }),
  24: { statut: 'ouvrier', typeContrat: 'alternance', temps: '35h', entree: '2025-09-01', fin: '2027-08-31', naissance: 2006 },
};

// lot 11 — indicateurs : sexe et catégorie d'emploi des fiches de démonstration (shared/rules/indicateurs-legaux.ts) ;
// Yanis Bouzid sans sexe et Bastien Morel (apprenti) sans catégorie, pour montrer les fiches à compléter.
const SEXE_CATEGORIE_DEMO: Record<number, [Sexe | null, CategorieEmploi | null]> = {
  1: ['F', 'ouvrier'], 2: ['M', 'tam'], 3: ['F', 'tam'], 4: ['M', 'ouvrier'], 5: ['F', 'cadre'], 6: ['M', 'tam'], 7: ['F', 'employe'], 8: ['M', 'ouvrier'],
  9: ['F', 'cadre'], 10: ['M', 'ouvrier'], 11: ['F', 'cadre'], 12: ['M', 'cadre'], 13: ['F', 'ouvrier'], 14: ['M', 'tam'], 15: ['F', 'ouvrier'], 16: ['M', 'ouvrier'],
  17: ['F', 'tam'], 18: ['M', 'tam'], 19: ['F', 'cadre'], 20: [null, 'ouvrier'], 21: ['F', 'employe'], 22: ['M', 'ouvrier'], 23: ['F', 'cadre'], 24: ['M', null],
};

/** Jour et mois de naissance (date complète : shared/rules/mineurs.ts), l'année étant celle du profil. */
const NE_LE: Record<number, string> = {
  1: '04-17', 2: '11-02', 3: '07-23', 4: '02-09', 5: '05-30', 6: '09-12', 7: '12-05', 8: '03-21', 9: '06-14', 10: '10-28', 11: '01-07', 12: '08-19',
  13: '04-03', 14: '12-24', 15: '07-01', 16: '02-27', 17: '09-30', 18: '05-11', 19: '11-16', 20: '03-08', 21: '06-25', 22: '10-04', 23: '01-29', 24: '08-02',
};

type C = { f: string; obtenue: string; session?: number; convoc?: 'now' };
const EMPLOYES: { id: number; nom: string; equipe: string; poste: string; certs: C[] }[] = [
  { id: 1, nom: 'Camille Roux', equipe: 'Logistique', poste: 'Cariste', certs: [{ f: 'caces489', obtenue: '2022-03-12' }, { f: 'sst', obtenue: '2024-11-20', session: 1, convoc: 'now' }, { f: 'prap', obtenue: '2025-06-01' }] },
  { id: 2, nom: 'Mehdi Benali', equipe: 'Maintenance', poste: 'Technicien de maintenance', certs: [{ f: 'elec', obtenue: '2023-09-14' }, { f: 'sst', obtenue: '2025-05-03' }, { f: 'hauteur', obtenue: '2025-01-10' }] },
  { id: 3, nom: 'Sophie Lemaire', equipe: 'Production', poste: 'Cheffe d’équipe', certs: [{ f: 'sst', obtenue: '2024-12-02' }, { f: 'epi', obtenue: '2026-02-15' }, { f: 'prap', obtenue: '2025-09-30' }] },
  { id: 4, nom: 'Lucas Martin', equipe: 'Logistique', poste: 'Préparateur de commandes', certs: [{ f: 'caces489', obtenue: '2021-10-28', session: 3, convoc: 'now' }, { f: 'prap', obtenue: '2025-04-11' }] },
  { id: 5, nom: 'Inès Dupont', equipe: 'Qualité & HSE', poste: 'Animatrice HSE', certs: [{ f: 'sst', obtenue: '2025-08-22' }, { f: 'epi', obtenue: '2025-11-05', session: 6, convoc: 'now' }, { f: 'hauteur', obtenue: '2025-03-01' }] },
  { id: 6, nom: 'Thomas Garnier', equipe: 'Maintenance', poste: 'Électromécanicien', certs: [{ f: 'elec', obtenue: '2024-01-20' }, { f: 'caces486', obtenue: '2021-08-30' }, { f: 'hauteur', obtenue: '2024-07-07' }] },
  { id: 7, nom: 'Aïcha Diallo', equipe: 'Administration', poste: 'Gestionnaire paie', certs: [{ f: 'rgpd', obtenue: '2024-12-15' }, { f: 'epi', obtenue: '2026-03-03' }] },
  { id: 8, nom: 'Julien Moreau', equipe: 'Production', poste: 'Opérateur de ligne', certs: [{ f: 'sst', obtenue: '2026-02-10' }, { f: 'prap', obtenue: '2024-10-12' }, { f: 'epi', obtenue: '2026-05-19' }] },
  { id: 9, nom: 'Nadia Kaci', equipe: 'Commercial', poste: 'Responsable grands comptes', certs: [{ f: 'rgpd', obtenue: '2025-11-30' }, { f: 'epi', obtenue: '2026-06-18' }] },
  { id: 10, nom: 'Pierre Fontaine', equipe: 'Logistique', poste: 'Chauffeur-livreur', certs: [{ f: 'fco', obtenue: '2022-02-01' }, { f: 'sst', obtenue: '2024-07-19' }, { f: 'caces489', obtenue: '2023-04-04' }] },
  { id: 11, nom: 'Élodie Bernard', equipe: 'Qualité & HSE', poste: 'Auditrice interne', certs: [{ f: 'rgpd', obtenue: '2025-01-12' }, { f: 'epi', obtenue: '2025-12-10' }] },
  { id: 12, nom: 'Karim Haddad', equipe: 'Maintenance', poste: 'Responsable maintenance', certs: [{ f: 'elec', obtenue: '2024-12-01' }, { f: 'hauteur', obtenue: '2023-11-28' }, { f: 'caces486', obtenue: '2024-01-15' }, { f: 'sst', obtenue: '2025-03-08' }] },
  { id: 13, nom: 'Marion Petit', equipe: 'Production', poste: 'Opératrice', certs: [{ f: 'sst', obtenue: '2024-10-30' }, { f: 'prap', obtenue: '2025-08-08' }] },
  { id: 14, nom: 'Antoine Leroy', equipe: 'Administration', poste: 'Chargé RH', certs: [{ f: 'rgpd', obtenue: '2025-05-05' }, { f: 'epi', obtenue: '2025-09-02' }] },
  { id: 15, nom: 'Léa Girard', equipe: 'Production', poste: 'Opératrice', certs: [{ f: 'sst', obtenue: '2025-06-14' }, { f: 'epi', obtenue: '2026-01-22' }, { f: 'prap', obtenue: '2026-03-05' }] },
  { id: 16, nom: 'Hugo Lambert', equipe: 'Logistique', poste: 'Cariste', certs: [{ f: 'caces489', obtenue: '2024-05-20' }, { f: 'sst', obtenue: '2025-09-09' }, { f: 'prap', obtenue: '2025-02-17' }] },
  { id: 17, nom: 'Fatou Ndiaye', equipe: 'Qualité & HSE', poste: 'Technicienne qualité', certs: [{ f: 'sst', obtenue: '2026-04-01' }, { f: 'rgpd', obtenue: '2025-10-20' }] },
  { id: 18, nom: 'Romain Chevalier', equipe: 'Maintenance', poste: 'Technicien de maintenance', certs: [{ f: 'elec', obtenue: '2025-02-11' }, { f: 'hauteur', obtenue: '2026-01-30' }, { f: 'aipr', obtenue: '2022-11-15' }, { f: 'sst', obtenue: '2025-12-01' }] },
  { id: 19, nom: 'Clara Roussel', equipe: 'Commercial', poste: 'Chargée d’affaires', certs: [{ f: 'rgpd', obtenue: '2026-03-18' }] },
  { id: 20, nom: 'Yanis Bouzid', equipe: 'Logistique', poste: 'Chauffeur-livreur', certs: [{ f: 'fco', obtenue: '2021-11-08' }, { f: 'sst', obtenue: '2025-10-15' }] },
  { id: 21, nom: 'Manon Faure', equipe: 'Administration', poste: 'Assistante de direction', certs: [{ f: 'rgpd', obtenue: '2025-07-07' }, { f: 'epi', obtenue: '2026-04-14' }, { f: 'sst', obtenue: '2026-06-20' }] },
  { id: 22, nom: 'Nicolas Perrin', equipe: 'Production', poste: 'Conducteur de ligne', certs: [{ f: 'sst', obtenue: '2025-01-25' }, { f: 'prap', obtenue: '2026-02-02' }, { f: 'caces489', obtenue: '2023-06-30' }] },
  { id: 23, nom: 'Sarah Cohen', equipe: 'Qualité & HSE', poste: 'Responsable HSE', certs: [{ f: 'sst', obtenue: '2026-05-11' }, { f: 'epi', obtenue: '2026-09-01' }, { f: 'hauteur', obtenue: '2025-04-22' }] },
  { id: 24, nom: 'Bastien Morel', equipe: 'Maintenance', poste: 'Apprenti électromécanicien', certs: [{ f: 'elec', obtenue: '2026-01-15' }, { f: 'sst', obtenue: '2026-03-12' }] },
];

/**
 * Identifiants et noms des salariés du jeu : indices d'une base de démonstration chargée avant le marqueur `demo`
 * (npm run purge-demo, server/src/purge-demo.ts).
 */
export const SALARIES_DEMO: readonly { id: number; nom: string }[] = EMPLOYES.map(({ id, nom }) => ({ id, nom }));

interface Extra {
  visite?: string; certsPlus?: C[]; habs?: { h: string; delivree?: string; par?: string; demande?: string; restriction?: boolean }[];
  passeport?: { numero: string; expire: string }; visas?: { dest: string; type: string; obtenu: string; expire: string }[]; vaccins?: { v: VaccinId; date: string }[];
  /** Avis du médecin du travail à la visite et restrictions ; `restriction` : titre suspendu à la suite de cet avis. */
  avis?: AvisMedical; restrictions?: Restriction[];
}
const EXTRA: Record<number, Extra> = {
  1: { visite: '2025-02-10', habs: [{ h: 'ac489', delivree: '2022-04-15', par: 'Olivier Marchal' }] },
  2: { visite: '2025-06-15', habs: [{ h: 'he', delivree: '2023-10-01', par: 'Karim Haddad' }, { h: 'hauteur', delivree: '2025-02-01', par: 'Sarah Cohen' }], passeport: { numero: '20AB···91', expire: '2026-12-02' }, vaccins: [{ v: 'dtp', date: '2016-09-10' }, { v: 'hepA', date: '2022-03-11' }] },
  3: { visite: '2025-09-12', certsPlus: [{ f: 'atex', obtenue: '2024-05-20' }], habs: [{ h: 'atex', delivree: '2024-06-01', par: 'Sarah Cohen' }] },
  4: { visite: '2025-01-22', habs: [{ h: 'ac489', delivree: '2021-11-15', par: 'Olivier Marchal' }] },
  // Avis avec restrictions jusqu'à la fin de l'année : autorisation de travail en hauteur suspendue, réserve sur l'audit de Tema.
  5: {
    visite: '2026-09-28', avis: 'restrictions', habs: [{ h: 'hauteur', delivree: '2025-03-15', par: 'Sarah Cohen', restriction: true }],
    restrictions: [{ texte: 'Pas de port de charges de plus de 15 kg', jusquau: '2026-12-31' }, { texte: 'Pas de travail en hauteur', jusquau: '2026-12-31' }],
  },
  6: { visite: '2024-08-20', habs: [{ h: 'he', delivree: '2024-02-05', par: 'Karim Haddad' }, { h: 'ac486', delivree: '2021-09-15', par: 'Karim Haddad' }] },
  7: { visite: '2025-10-01' }, 11: { visite: '2025-04-08' }, 13: { visite: '2025-12-02' }, 14: { visite: '2025-02-27' }, 15: { visite: '2026-02-09' }, 17: { visite: '2025-08-18' }, 20: { visite: '2025-09-25' }, 21: { visite: '2025-01-16' },
  8: { visite: '2025-07-03', certsPlus: [{ f: 'atex', obtenue: '2023-11-02' }], habs: [{ h: 'atex', delivree: '2023-11-20', par: 'Sarah Cohen' }] },
  9: { visite: '2025-03-14', passeport: { numero: '18CF···27', expire: '2028-05-12' }, visas: [{ dest: 'US', type: 'ESTA', obtenu: '2024-11-03', expire: '2026-11-02' }], vaccins: [{ v: 'dtp', date: '2019-04-02' }, { v: 'hepA', date: '2018-06-01' }] },
  10: { visite: '2025-11-03', habs: [{ h: 'ac489', delivree: '2023-04-20', par: 'Olivier Marchal' }] },
  12: { visite: '2025-05-20', habs: [{ h: 'he', delivree: '2024-12-10', par: 'Philippe Aubert' }, { h: 'ac486', delivree: '2024-02-01', par: 'Philippe Aubert' }, { h: 'hauteur', delivree: '2023-12-10', par: 'Sarah Cohen' }], passeport: { numero: '16AE···58', expire: '2027-02-20' }, vaccins: [{ v: 'fj', date: '2015-07-10' }, { v: 'hepA', date: '2015-07-10' }, { v: 'typhoide', date: '2023-01-15' }, { v: 'dtp', date: '2015-07-10' }] },
  16: { visite: '2026-02-11', habs: [{ h: 'ac489', delivree: '2024-06-03', par: 'Olivier Marchal' }] },
  18: { visite: '2025-04-14', habs: [{ h: 'he', delivree: '2025-03-01', par: 'Karim Haddad' }, { h: 'aipr', delivree: '2022-12-01', par: 'Karim Haddad' }, { h: 'hauteur', delivree: '2026-02-10', par: 'Sarah Cohen' }], passeport: { numero: '21CD···44', expire: '2029-08-30' }, vaccins: [{ v: 'dtp', date: '2021-05-17' }, { v: 'hepA', date: '2022-04-05' }, { v: 'typhoide', date: '2024-09-01' }] },
  19: { visite: '2025-06-30', passeport: { numero: '19BA···73', expire: '2031-01-15' }, visas: [{ dest: 'US', type: 'ESTA', obtenu: '2025-03-02', expire: '2027-03-01' }], vaccins: [{ v: 'dtp', date: '2020-10-12' }] },
  22: { visite: '2026-03-02', certsPlus: [{ f: 'atex', obtenue: '2025-03-18' }], habs: [{ h: 'ac489', delivree: '2023-07-15', par: 'Jean-Marc Perret' }, { h: 'atex', delivree: '2025-04-01', par: 'Sarah Cohen' }], vaccins: [{ v: 'dtp', date: '2018-02-20' }] },
  23: { visite: '2025-10-01', habs: [{ h: 'hauteur', delivree: '2025-05-05', par: 'Philippe Aubert' }], passeport: { numero: '17AC···09', expire: '2030-06-21' }, visas: [{ dest: 'CI', type: 'e-Visa d’affaires', obtenu: '2025-09-20', expire: '2026-09-19' }], vaccins: [{ v: 'dtp', date: '2017-03-03' }, { v: 'hepA', date: '2019-02-14' }, { v: 'typhoide', date: '2025-09-01' }] },
  24: { habs: [{ h: 'he', demande: '2026-09-20' }] },
};

// Le nombre d'inscrits découle des certifications et inscriptions rattachées (RECYCLAGES, INSCRIPTIONS).
// `planId` : action du plan engagée pour la session (identifiants des lignes de PLAN, insérées dans l'ordre).
// Sessions sur plusieurs jours (shared/rules/plage-session.ts) : CACES R489 de 21 h sur trois jours avec horaires, PRAP
// de 14 h sur un vendredi et le lundi suivant, FCO de 35 h sur une semaine sans horaire (journées entières).
const HORAIRE_JOUR = { debut: '08:30', fin: '16:30', pause: 60 };
const SESSIONS = [
  { id: 1, formation: 'sst', date: '2026-10-14', lieu: 'Site de Lyon — salle B', places: 12, statut: 'Confirmée', planId: 7 },
  { id: 2, formation: 'sst', date: '2026-11-18', lieu: 'Site de Lyon — salle B', places: 12, statut: 'À confirmer' },
  {
    id: 3, formation: 'caces489', date: '2026-10-21', fin: '2026-10-23', jours: ['2026-10-21', '2026-10-22', '2026-10-23'], horaires: [HORAIRE_JOUR],
    lieu: 'AFTRAL Saint-Priest', places: 6, statut: 'Confirmée', planId: 8,
  },
  { id: 4, formation: 'caces489', date: '2026-11-25', lieu: 'AFTRAL Saint-Priest', places: 6, statut: 'Confirmée' },
  { id: 5, formation: 'elec', date: '2026-10-27', lieu: 'Apave Vénissieux', places: 8, statut: 'Confirmée', planId: 9 },
  { id: 6, formation: 'epi', date: '2026-10-09', lieu: 'Site de Lyon — atelier', places: 15, statut: 'Confirmée' },
  { id: 7, formation: 'hauteur', date: '2026-11-04', lieu: 'Socotec Lyon', places: 8, statut: 'À confirmer' },
  { id: 8, formation: 'rgpd', date: '2026-11-12', lieu: 'Visioconférence', places: 30, statut: 'Confirmée', planId: 10 },
  { id: 9, formation: 'caces486', date: '2026-12-02', lieu: 'AFTRAL Saint-Priest', places: 6, statut: 'À confirmer' },
  {
    id: 10, formation: 'prap', date: '2026-11-20', fin: '2026-11-23', jours: ['2026-11-20', '2026-11-23'], horaires: [{ debut: '09:00', fin: '17:00', pause: 60 }],
    lieu: 'Site de Lyon — salle B', places: 10, statut: 'Confirmée',
  },
  { id: 11, formation: 'fco', date: '2027-01-11', fin: '2027-01-15', lieu: 'AFTRAL Saint-Priest', places: 12, statut: 'À confirmer' },
  { id: 12, formation: 'epi', date: '2026-12-10', lieu: 'Site de Lyon — atelier', places: 15, statut: 'À confirmer' },
  { id: 13, formation: 'atex', date: '2026-11-16', lieu: 'Apave Vénissieux', places: 8, statut: 'Confirmée' },
];

/** Recyclages planifiés en plus de ceux des fiches : [collaborateur, formation, session]. */
const RECYCLAGES: [number, string, number][] = [
  [10, 'sst', 1], [13, 'sst', 1], [14, 'epi', 6], [11, 'epi', 6], [6, 'elec', 5], [8, 'prap', 10], [7, 'rgpd', 8], [11, 'rgpd', 8],
];
/** Inscriptions en formation initiale (formation jamais suivie) : [collaborateur, session]. */
const INSCRIPTIONS: [number, number][] = [[7, 1], [19, 1], [14, 1], [9, 2], [20, 3], [17, 6], [20, 6], [5, 8], [23, 8]];

const PLAN_DEBUT = '2026-09-14', PLAN_FIN = '2026-12-31';

/**
 * Planning Keystone : tâches de chaque salarié, gabarit du lundi au vendredi appliqué du 14 septembre
 * au 31 décembre, ou entre les dates indiquées. Les feuilles de temps passées en sont tirées.
 */
const TACHES: Record<number, [projet: string, tache: string, h: number[], du?: string, au?: string][]> = {
  1: [['INT-LOG', 'Réception / expédition', [7, 7, 7, 7, 7]]],
  2: [['INT-MAINT', 'Maintenance préventive', [8, 8, 8, 0, 0], PLAN_DEBUT, '2026-10-16'], ['K-2620', 'Repérage site Feyzin', [0, 0, 0, 8, 7], '2026-09-21', '2026-10-16'], ['INT-MAINT', 'Maintenance préventive', [8, 8, 8, 8, 7], '2026-10-19']],
  3: [['INT-PROD', 'Encadrement ligne 2', [8, 8, 8, 8, 7]]], 4: [['INT-LOG', 'Préparation de commandes', [7, 7, 7, 7, 7]]],
  5: [['INT-HSE', 'Animation sécurité', [4, 4, 4, 4, 4]], ['K-2625', 'Préparation audit Tema', [3, 3, 3, 3, 3], PLAN_DEBUT, '2026-11-27']],
  6: [['INT-MAINT', 'Maintenance préventive', [8, 0, 0, 0, 7], PLAN_DEBUT, '2026-10-09'], ['K-2633', 'Dépannage four — sur site', [0, 8, 8, 8, 0], '2026-09-21', '2026-10-08'], ['INT-MAINT', 'Maintenance préventive', [8, 8, 8, 8, 7], '2026-10-12']],
  7: [['INT-ADM', 'Paie & administration du personnel', [7, 7, 0, 7, 7]]], 8: [['INT-PROD', 'Conduite ligne 1', [7, 7, 7, 7, 7]]],
  9: [['INT-COM', 'Avant-vente grands comptes', [4, 4, 4, 4, 4]], ['K-2631', 'Suivi client Embalagens', [3, 3, 3, 3, 3]]], 10: [['INT-LOG', 'Tournées de livraison', [7, 7, 7, 7, 7]]],
  11: [['INT-QUA', 'Audits internes', [7, 7, 7, 7, 7]]],
  12: [['K-2614', 'Pilotage chantier', [3, 3, 3, 3, 3], PLAN_DEBUT, '2026-11-06'], ['K-2611', 'Préparation mise en service', [3, 3, 3, 3, 3], PLAN_DEBUT, '2026-11-27'], ['INT-MAINT', 'Management d’équipe', [2, 2, 2, 2, 2]]],
  13: [['INT-PROD', 'Conditionnement', [7, 7, 7, 0, 0]]], 14: [['INT-ADM', 'Recrutement & RH', [8, 8, 8, 8, 6.5]]], 15: [['INT-PROD', 'Opératrice ligne 1', [7, 7, 7, 7, 7]]],
  16: [['INT-LOG', 'Coordination du quai', [8, 8, 8, 8, 7]]], 17: [['INT-QUA', 'Contrôle réception', [7, 7, 7, 7, 7]]],
  18: [['K-2614', 'Rétrofit — circuit hydraulique', [8, 8, 8, 8, 7], PLAN_DEBUT, '2026-11-06'], ['INT-MAINT', 'Maintenance curative', [8, 8, 8, 8, 7], '2026-11-09']],
  19: [['INT-COM', 'Affaires export États-Unis', [7, 7, 7, 7, 7]]], 20: [['INT-LOG', 'Tournées de livraison', [7, 7, 7, 7, 7]]], 21: [['INT-ADM', 'Assistance de direction', [7, 7, 7, 7, 0]]],
  22: [['INT-PROD', 'Conduite ligne 2', [8, 8, 8, 8, 7]]], 23: [['INT-HSE', 'Pilotage HSE', [4, 4, 4, 4, 4]], ['K-2620', 'Plan de prévention ATEX', [3, 3, 3, 3, 3], PLAN_DEBUT, '2026-10-23']],
  24: [['INT-MAINT', 'Apprentissage — maintenance', [7, 7, 7, 0, 0]], ['ECOLE', 'Cours au CFA', [0, 0, 0, 7, 7]]],
};

/**
 * Tâches planifiées, heures par date (jours ouvrés hors fériés). Pendant une affectation, les heures
 * prévues sur d'autres projets passent au chantier (« Intervention sur site »).
 */
function planning() {
  const taches = Object.entries(TACHES).flatMap(([id, list]) => list.map(([projet, tache, h, du = PLAN_DEBUT, au = PLAN_FIN], i) => {
    const heures: Record<string, number> = {};
    for (let s = du; s <= au; s = addD(s, 1)) if (weekday(s) < 5 && !isFerie(s) && h[weekday(s)]) heures[s] = h[weekday(s)];
    return { id: `KT-${id}-${i + 1}`, empId: Number(id), projet, tache, debut: du, fin: au, heures };
  }));
  AFFECTATIONS.forEach(a => {
    const site = { id: `KT-${a.id}`, empId: a.empId, projet: a.chantier, tache: 'Intervention sur site', debut: a.du, fin: a.au, heures: {} as Record<string, number> };
    taches.filter(t => t.empId === a.empId && t.projet !== a.chantier).forEach(t => Object.entries(t.heures).forEach(([s, h]) => {
      if (s < a.du || s > a.au) return;
      site.heures[s] = (site.heures[s] ?? 0) + h;
      delete t.heures[s];
    }));
    if (Object.keys(site.heures).length) taches.push(site);
  });
  return taches;
}

/** `detachementLe` : certificat de sécurité sociale obtenu ; ceux de Riyad, Mumbai et São Paulo restent à demander. */
const VOYAGES = [
  { empId: 19, dest: 'US', depart: '2026-10-12', retour: '2026-10-16', motif: 'Visite client — Houston', origine: 'formulaire', ref: 'DD-2026-0398', detachementLe: '2026-09-30' },
  { empId: 9, dest: 'IN', depart: '2026-10-19', retour: '2026-10-24', motif: 'Salon Automation Expo — Mumbai', origine: 'formulaire', ref: 'DD-2026-0402' },
  { empId: 18, dest: 'MA', depart: '2026-10-27', retour: '2026-11-06', motif: 'Rétrofit presse hydraulique — Tanger', origine: 'keystone', chantier: 'K-2614', detachementLe: '2026-10-05' },
  { empId: 12, dest: 'CI', depart: '2026-11-09', retour: '2026-11-27', motif: 'Mise en service ligne — Abidjan', origine: 'keystone', chantier: 'K-2611', detachementLe: '2026-10-08' },
  { empId: 9, dest: 'SA', depart: '2026-11-23', retour: '2026-11-26', motif: 'Négociation distributeur — Riyad', origine: 'cursus' },
  { empId: 23, dest: 'GH', depart: '2026-12-01', retour: '2026-12-05', motif: 'Audit HSE usine — Tema', origine: 'keystone', chantier: 'K-2625', detachementLe: '2026-10-02' },
  { empId: 22, dest: 'BR', depart: '2027-01-18', retour: '2027-01-29', motif: 'Transfert de ligne — São Paulo', origine: 'keystone', chantier: 'K-2631' },
];

/** Demandes en attente, enregistrées telles quelles : leur contrôle à la réception dépend de la date du jour. */
const DEMANDES_KEYSTONE = [
  { ref: 'DK-2026-0412', empId: 18, chantier: 'K-2611', dest: 'CI', depart: '2026-11-09', retour: '2026-11-27', recue: '2026-10-05' },
  { ref: 'DK-2026-0398', empId: 6, chantier: 'K-2614', dest: 'MA', depart: '2026-10-27', retour: '2026-11-06', recue: '2026-10-02' },
  { ref: 'DK-2026-0417', empId: 16, chantier: 'K-2631', dest: 'BR', depart: '2027-01-18', retour: '2027-01-29', recue: '2026-10-06' },
  { ref: 'DK-2026-0418', empId: 5, chantier: 'K-2625', dest: 'GH', depart: '2026-12-01', retour: '2026-12-05', recue: '2026-10-06' },
].map(d => ({ ...d, statut: 'attente' }));

const ABSENCES = [
  { empId: 22, type: 'RTT', du: '2026-10-09', au: '2026-10-09', statut: 'validee', keystone: true },
  { empId: 14, type: 'CP', du: '2026-10-19', au: '2026-10-23', statut: 'validee', keystone: true },
  { empId: 1, type: 'CP', du: '2026-10-26', au: '2026-10-30', statut: 'demandee' },
  { empId: 17, type: 'RECUP', du: '2026-10-16', au: '2026-10-16', statut: 'demandee' },
  { empId: 2, type: 'RTT', du: '2026-11-02', au: '2026-11-02', statut: 'demandee' },
  { empId: 10, type: 'CP', du: '2026-12-21', au: '2026-12-31', statut: 'demandee' },
  { empId: 16, type: 'RTT', du: '2026-10-30', au: '2026-10-30', statut: 'validee', keystone: true },
  { empId: 8, type: 'CP', du: '2026-10-12', au: '2026-10-16', statut: 'validee', keystone: true },
  { empId: 18, type: 'CP', du: '2026-12-21', au: '2026-12-24', statut: 'demandee' },
  // Congé validé pendant l'audit de Tema, où Inès Dupont est affectée : No Go (motif ABSENCE, sans sa nature).
  { empId: 5, type: 'CP', du: '2026-12-04', au: '2026-12-04', statut: 'validee', keystone: true },
  // Absences hors congés : un signalement à qualifier, un arrêt qualifié (semaine sans heure), une maternité, un mariage.
  { empId: 20, type: 'ABSENCE', du: '2026-10-07', au: '2026-10-16', statut: 'signalee', keystone: true, signaleLe: '2026-10-07', signalePar: 'Hugo Lambert' },
  { empId: 13, type: 'MALADIE', du: '2026-10-05', au: '2026-10-07', statut: 'validee', keystone: true, signaleLe: '2026-10-05', signalePar: 'Sophie Lemaire', justificatif: true, justificatifLe: '2026-10-06' },
  { empId: 19, type: 'MATERNITE', du: '2026-11-16', au: '2027-03-07', statut: 'validee', keystone: true, justificatif: true, justificatifLe: '2026-09-15' },
  { empId: 10, type: 'MARIAGE', du: '2026-11-03', au: '2026-11-06', statut: 'validee', keystone: true },
];

const CET = [
  { empId: 6, type: 'RTT', jours: 5, date: '2025-12-15', periode: '2025' }, { empId: 6, type: 'CP', jours: 3, date: '2025-05-20', periode: '2024-2025' },
  { empId: 12, type: 'RTT', jours: 2, date: '2026-03-02', periode: '2026' }, { empId: 22, type: 'CP', jours: 2, date: '2026-09-01', periode: '2025-2026' },
  { empId: 2, type: 'RTT', jours: 4, date: '2025-12-10', periode: '2025' },
];

const DEMANDES_COLLAB = [
  { empId: 13, type: 'formation', f: 'caces489', sessionId: 4, motif: 'Polyvalence sur le quai de chargement', date: '2026-10-02', statut: 'attente', parId: 3 },
  { empId: 3, type: 'habilitation', h: 'hauteur', motif: 'Interventions sur les passerelles de la ligne 2', date: '2026-10-05', statut: 'attente' },
  { empId: 9, type: 'document', label: 'Passeport mis à jour', date: '2026-10-06', statut: 'attente', declaration: { kind: 'passeport', numero: '26FD···63', expire: '2036-09-29' } },
  { empId: 19, type: 'formation', f: null, libelle: 'Anglais technique', motif: 'Échanges avec les clients américains', date: '2026-09-28', statut: 'refusee', reponse: 'Reportée au plan 2027 — enveloppe Commercial atteinte' },
];

const BUDGETS: Record<number, Record<string, number>> = {
  2026: { Logistique: 11000, Maintenance: 10000, Production: 6500, 'Qualité & HSE': 4500, Administration: 2500, Commercial: 2000 },
  2027: { Logistique: 11500, Maintenance: 10500, Production: 7000, 'Qualité & HSE': 4500, Administration: 2500, Commercial: 2000 },
};

const PLAN = [
  // Actions réalisées : coût et effectif réels saisis à la clôture (par défaut, ceux du plan).
  { f: 'sst', equipe: 'Production', periode: 'T1', effectif: 8, cout: 1440, statut: 'realise', coutReel: 1260, effectifReel: 7 },
  { f: 'elec', equipe: 'Maintenance', periode: 'T1', effectif: 4, cout: 1920, statut: 'realise' },
  { f: 'caces489', equipe: 'Logistique', periode: 'T2', effectif: 5, cout: 3250, statut: 'realise', coutReel: 3480 },
  { f: 'prap', equipe: 'Production', periode: 'T2', effectif: 6, cout: 2520, statut: 'realise' },
  { f: 'hauteur', equipe: 'Maintenance', periode: 'T2', effectif: 3, cout: 960, statut: 'realise' },
  { f: 'epi', equipe: 'Administration', periode: 'T3', effectif: 6, cout: 240, statut: 'realise' },
  { f: 'sst', equipe: 'Logistique', periode: 'T4', effectif: 6, cout: 1080, statut: 'engage' },
  { f: 'caces489', equipe: 'Logistique', periode: 'T4', effectif: 4, cout: 2600, statut: 'engage' },
  { f: 'elec', equipe: 'Maintenance', periode: 'T4', effectif: 5, cout: 2400, statut: 'engage' },
  { f: 'rgpd', equipe: 'Commercial', periode: 'T4', effectif: 10, cout: 0, statut: 'engage' },
  { f: 'fco', equipe: 'Logistique', periode: 'T4', effectif: 2, cout: 1800, statut: 'prevu' },
  { f: 'caces486', equipe: 'Maintenance', periode: 'T4', effectif: 2, cout: 1300, statut: 'prevu' },
  { f: 'aipr', equipe: 'Maintenance', periode: 'T4', effectif: 3, cout: 570, statut: 'prevu' },
  { f: 'prap', equipe: 'Qualité & HSE', periode: 'T4', effectif: 4, cout: 1680, statut: 'prevu' },
  { f: null, libelle: 'Management de proximité', equipe: 'Production', periode: 'T3', effectif: 3, cout: 2700, statut: 'realise' },
  { f: null, libelle: 'Excel avancé', equipe: 'Administration', periode: 'T2', effectif: 4, cout: 1200, statut: 'realise' },
];

/** Feuilles de temps des deux semaines précédentes (tâches planifiées ces semaines-là), plus un brouillon en cours. */
function feuilles(taches: ReturnType<typeof planning>) {
  const out: { empId: number; week: string; statut: string; sage: boolean; keystone: boolean; lignes: unknown[]; heuresSup?: string | null }[] = [];
  Object.keys(TACHES).map(Number).forEach(id => ['2026-09-21', '2026-09-28'].forEach((week, wi) => {
    const lignes = taches.filter(t => t.empId === id).map(t => ({ projet: t.projet, tache: t.tache, ks: true, h: joursSemaine(week).map(s => t.heures[s] ?? 0) }))
      .filter(l => l.h.some(v => v > 0))
      .map(l => ({ ...l, h: l.h.map((v, i) => v + ((id === 22 || id === 18) && wi === 1 && i < 2 && v ? 2 : 0)) }));
    // Élu au CSE (mandat de démonstration) : 3 h de délégation le mercredi de la semaine 40, prises sur la production.
    if (id === 8 && wi === 1) {
      lignes[0].h[2] -= 3;
      lignes.push({ projet: 'INT-DELEG', tache: 'Réunion du CSE', ks: false, h: [0, 0, 3, 0, 0, 0, 0] });
    }
    const statut = wi === 1 && id % 3 === 0 ? 'soumise' : 'validee';
    // Heures supplémentaires payées, mode figé à la validation (comme temps.validate).
    out.push({ empId: id, week, lignes, statut, sage: wi === 0 && id !== 15, keystone: wi === 0, heuresSup: statut === 'validee' ? 'paiement' : null });
  }));
  out.push({ empId: 1, week: '2026-10-05', lignes: [{ projet: 'INT-LOG', tache: 'Réception / expédition', ks: true, h: [7, 7.5, 0, 0, 0, 0, 0] }], statut: 'brouillon', sage: false, keystone: false });
  return out;
}

function entretiens() {
  const H: Record<number, string> = { 1: '2023-03-13', 2: '2024-09-20', 3: '2022-05-02', 5: '2025-01-20', 6: '2023-04-03', 7: '2022-11-15', 8: '2024-06-10', 9: '2023-02-06', 10: '2022-10-03', 11: '2024-09-09', 12: '2025-03-17', 13: '2024-03-04', 14: '2024-04-08', 16: '2023-09-11', 17: '2025-01-13', 18: '2022-06-20', 20: '2023-06-05', 21: '2024-11-04', 22: '2021-09-27', 23: '2024-02-12' };
  const out: { empId: number; type: EntretienType; date: string; statut: string; cr: Record<string, string>; info: boolean; signSal: string | null; signMgr: string | null }[] = [];
  const add = (o: Partial<typeof out[number]> & { empId: number; type: EntretienType; date: string; statut: string }) => out.push({ cr: {}, info: true, signSal: null, signMgr: null, ...o });
  const done = (empId: number, type: EntretienType, date: string, cr?: Record<string, string>) => add({ empId, type, date, statut: 'realise', signMgr: date, signSal: date, cr: cr || {} });
  Object.entries(H).forEach(([k, d]) => {
    const empId = Number(k);
    done(empId, 'epp', d);
    const prior = addM(d, -24);
    if (![21, 22].includes(empId) && prior > PROFILS[empId].entree) done(empId, 'epp', prior);
  });
  ([[9, '2025-10-20'], [12, '2025-06-10'], [23, '2026-03-02']] as [number, string][]).forEach(([e, d]) => done(e, 'forfait', d));
  done(5, 'annuel', '2026-09-24', { bilan: 'Objectifs sécurité atteints : zéro accident avec arrêt sur le site.', objectifs: 'Déployer les visites de sécurité croisées.', avis: 'Échange constructif.' });
  add({ empId: 17, type: 'annuel', date: '2026-10-01', statut: 'realise', signMgr: '2026-10-01', info: false, cr: { bilan: 'Bonne prise en main du contrôle réception.', objectifs: 'Autonomie sur les audits fournisseurs.' } });
  ([[1, '2026-10-14'], [2, '2026-10-20'], [8, '2026-10-21'], [11, '2026-10-22']] as [number, string][]).forEach(([e, d]) => add({ empId: e, type: 'annuel', date: d, statut: 'planifie', info: false }));
  add({ empId: 22, type: 'epp', date: '2026-10-15', statut: 'planifie', info: false, cr: { parcours: 'Souhaite évoluer vers un poste de chef d’équipe.', formation: 'Management de proximité, financé via le CPF.' } });
  return out;
}

/** Compteurs déjà consommés avant la mise en service (repris de l'ancien outil). */
function histo(id: number, forfait: boolean) {
  const k = id % 4;
  return { cp: [12, 15, 18, 20][k], rtt: forfait ? [3, 5, 4, 6][k] : [10, 14, 16, 12][k], recA: [0, 7, 3.5, 10.5][k], recP: [0, 7, 0, 3.5][k] };
}

/**
 * Exigences de démonstration (t055) : en production, aucune n'est créée d'office (référentiel des postes à compléter par
 * le service RH). Caristes et techniciens de maintenance détiennent déjà les leurs ; l'apprenti électromécanicien attend
 * la délivrance de son habilitation électrique, et la Logistique exige le SST de tous ses membres (Lucas Martin ne l'a pas).
 */
const EXIGENCES_DEMO: Record<string, { formations: string[]; habilitations: string[] }> = {
  'Cariste': { formations: ['caces489'], habilitations: ['ac489'] },
  'Technicien de maintenance': { formations: ['elec'], habilitations: ['he'] },
  'Apprenti électromécanicien': { formations: ['elec'], habilitations: ['he'] },
};
/** CDD de démonstration : terme initial, renouvellement signé avant lui (avenant n° 1), nouveau terme de la fiche. */
const CDD_DEMO = { initial: '2026-07-31', signeLe: '2026-07-15', reference: 'Avenant n° 1' };
async function renouvellementDemo(db: Db) {
  for (const id of Object.keys(PROFILS).map(Number).filter(id => PROFILS[id].typeContrat === 'cdd')) {
    const embauche = (await db.where<{ regime: unknown }>('contratsHistorique', 'empId', id))[0];
    await db.insert('contratsHistorique', {
      empId: id, effet: '2026-08-01', nature: 'renouvellement', regime: embauche?.regime ?? null, jusquau: PROFILS[id].fin, signeLe: CDD_DEMO.signeLe, reference: CDD_DEMO.reference,
      le: CDD_DEMO.signeLe, par: RH_DEMO, parId: null, applique: true, annuleLe: null, fin: null,
    });
  }
}

/**
 * Habilitation électrique de Mehdi Benali renouvelée le 1er octobre 2023 : la délivrance précédente reste à l'historique
 * (t115). Formation hors catalogue suivie par lui, non obligatoire (t116).
 */
async function historiqueSecuriteDemo(db: Db) {
  const titre = (await db.where<{ id: number; h: string }>('habTitres', 'empId', 2)).find(t => t.h === 'he');
  if (titre) {
    await db.insert('habDelivrances', {
      empId: 2, h: 'he', titreId: titre.id, delivree: '2020-09-15', par: 'Philippe Aubert', expire: '2023-09-15', remplaceeLe: '2023-10-01',
      mesure: null, mesureDate: null, le: '2020-09-15', auteur: null, auteurId: null,
    });
  }
  await db.insert('formationsSuivies', {
    empId: 2, f: null, libelle: 'Lecture de schémas électriques industriels', du: '2025-03-18', au: '2025-03-19', duree: 14, organisme: 'GRETA Industrie',
    obligatoire: false, origine: 'saisie', planActionId: null, demandeId: null, le: '2025-03-20', auteur: RH_DEMO, auteurId: null,
  });
}

async function exigencesDemo(db: Db) {
  for (const [nom, x] of Object.entries(EXIGENCES_DEMO)) await db.run('UPDATE postes SET formations = ?, habilitations = ? WHERE nom = ?', [JSON.stringify(x.formations), JSON.stringify(x.habilitations), nom]);
  await db.update('equipes', 'Logistique', { exigences: { formations: ['sst'], habilitations: [] } });
  // Couverture minimale (t067) : 4 SST en Production, où deux certifications arrivent à échéance sous l'horizon d'alerte.
  await db.update('equipes', 'Production', { couverture: [{ formation: 'sst', min: 4 }] });
}

export async function seedDemo(db: Db) {
  await db.tx(async () => {
    const secret = await db.getSetting<string | null>('secret', null); // conserve les sessions ouvertes
    // Marqueur d'exploitation (server/src/marqueurs.ts) : jamais effacé, la base reste refusée par npm run purge-demo.
    const exploitation = await db.getSetting<unknown>(REGLAGE_EXPLOITATION, null);
    await db.clearAll();
    if (secret) await db.setSetting('secret', secret);
    if (exploitation) await db.setSetting(REGLAGE_EXPLOITATION, exploitation);
    await db.setSetting('app', DEFAULT_SETTINGS);
    await db.setSetting('messagerie', MESSAGERIE_DEMO);
    // Marqueur de base de démonstration (server/src/marqueurs.ts) : la purge des données fictives s'appuie dessus.
    await db.setSetting(REGLAGE_DEMO, marqueurDemo(VERSION));
    for (const f of FORMATIONS) await db.insert('formations', f);
    for (const h of HABILITATIONS) await db.insert('habilitations', h);
    for (const d of DESTS) await db.insert('destinations', d);
    for (const [ordre, [nom, managerId]] of EQUIPES.entries()) await db.insert('equipes', { nom, managerId, ordre });
    for (const s of SESSIONS) await db.insert('sessions', completerSession(s));
    for (const e of EMPLOYES) {
      const p = PROFILS[e.id], x = EXTRA[e.id] || {};
      await db.insert('employes', {
        id: e.id, nom: e.nom, equipe: e.equipe, poste: e.poste, statut: p.statut, typeContrat: p.typeContrat, temps: p.temps,
        heures: p.heures ?? null, forfaitHeures: p.forfaitHeures ?? null, forfaitJours: p.forfaitJours ?? null, jourOff: p.jourOff ?? [],
        entree: p.entree, fin: p.fin ?? null, naissance: p.naissance, naissanceLe: `${p.naissance}-${NE_LE[e.id]}`, agence: p.agence ?? null, matriculePaie: matriculePaieDemo(e.id, p.typeContrat),
        // Chacun a une adresse professionnelle (décision de l'entreprise) ; Karim Haddad reçoit un récapitulatif quotidien.
        email: identifiantSuggere(e.nom, 'microsoft', DOMAINE_DEMO), notifications: e.id === 12 ? 'quotidien' : 'immediat',
        repriseMotif: p.reprise?.motif ?? null, repriseDate: p.reprise?.date ?? null, visite: x.visite ?? null,
        avis: x.avis ?? null, restrictions: x.restrictions ?? [],
        passeportNumero: x.passeport?.numero ?? null, passeportExpire: x.passeport?.expire ?? null,
        autorisationTravail: TITRES_DEMO[e.id] ?? null,
        // lot 11 — indicateurs
        sexe: SEXE_CATEGORIE_DEMO[e.id]?.[0] ?? null, categorie: SEXE_CATEGORIE_DEMO[e.id]?.[1] ?? null,
        // CDD de Lucas Martin : accroissement temporaire d'activité, terme initial fin juillet, renouvelé une fois (ci-dessous).
        ...(p.typeContrat === 'cdd' ? { motifRecours: 'accroissement', cddFinInitiale: CDD_DEMO.initial } : {}),
      });
      for (const c of [...e.certs, ...(x.certsPlus || [])]) await db.insert('certifications', { empId: e.id, f: c.f, obtenue: c.obtenue, sessionId: c.session ?? null, convoc: c.convoc ?? null, convocLe: c.convoc ? CONVOQUES_LE : null });
      for (const h of (x.habs || [])) await db.insert('habTitres', {
        empId: e.id, h: h.h, delivree: h.delivree ?? null, par: h.par ?? null, demande: h.demande ?? null,
        ...(h.restriction ? { mesure: 'suspension', mesureDate: '2026-09-30', mesureMotif: MOTIF_RESTRICTION, mesurePar: RH_DEMO } : {}),
      });
      for (const v of (x.visas || [])) await db.insert('visas', { empId: e.id, ...v });
      for (const v of (x.vaccins || [])) await db.insert('vaccinations', { empId: e.id, ...v });
    }
    // Postes du référentiel d'après les intitulés des fiches (comme la reprise d'une base existante), puis exigences.
    await postesDepuisFiches(db);
    await exigencesDemo(db);
    // Historique des contrats amorcé depuis les fiches (comme la migration d'une base existante), puis renouvellement du CDD.
    await historiqueDepuisFiches(db);
    await renouvellementDemo(db);
    // Délivrances d'habilitation amorcées depuis les titres (comme la migration), puis une délivrance remplacée et une
    // formation suivie hors catalogue (t115, t116).
    await delivrancesDepuisTitres(db);
    await historiqueSecuriteDemo(db);
    for (const [empId, f, sessionId] of RECYCLAGES) {
      const c = (await db.where<{ id: number; f: string }>('certifications', 'empId', empId)).find(x => x.f === f)!;
      await db.update('certifications', c.id, { sessionId, convoc: 'now', convocLe: CONVOQUES_LE });
    }
    for (const [empId, sessionId] of INSCRIPTIONS) await db.insert('inscriptions', { empId, sessionId, convoc: 'now', date: CONVOQUES_LE, convocLe: CONVOQUES_LE });
    // Keystone : mêmes contrôles et mêmes tables que l'API entrante (server/src/integrations/keystone-entrant.ts).
    const cx = await contexte(db), taches = planning();
    for (const [code, nom] of Object.entries(PROJETS)) await enregistrerProjet(cx, code, { nom });
    // Activités internes de base (dont la délégation du CSE) : comme la migration d'une base neuve, rejouée à la réinitialisation.
    await amorcerActivites(db);
    // Activité des interventions d'astreinte (t049), comme la migration d'une base neuve.
    await amorcerActiviteAstreinte(db);
    // Horaires de poste d'exemple (comme la migration d'une base neuve) ; horaire de journée proposé à la Maintenance et à
    // l'Administration, équipe du matin à la Production (2x8 : l'après-midi se choisit sur la feuille).
    await amorcerHoraires(db);
    for (const [nom, horaire] of [['Maintenance', 'J'], ['Administration', 'J'], ['Production', 'M']]) await db.update('equipes', nom, { horaire });
    // lot 12 — C5 (planning d'équipe) : modèles de cycles (Journée, 2x8, 3x8, 5x8), comme la migration d'une base neuve.
    await amorcerCycles(db);
    // Mandat au CSE de Julien Moreau : titulaire, crédit de la table R2314-1 pour une centaine de salariés.
    await db.insert('mandats', { empId: 8, role: 'titulaire', du: '2025-11-01', au: null, credit: 21 });

    for (const { id, ...c } of CHANTIERS) await enregistrerChantier(cx, id, c);
    for (const { id, empId, ...a } of AFFECTATIONS) await enregistrerAffectation(cx, id, { matricule: matricule(empId), ...a });
    for (const { id, empId, ...t } of taches) await enregistrerTache(cx, id, { matricule: matricule(empId), ...t });
    for (const v of VOYAGES) await db.insert('voyages', v);
    for (const d of DEMANDES_KEYSTONE) await db.insert('demandesKeystone', d);
    for (const a of ABSENCES) await db.insert('absences', a);
    for (const c of CET) await db.insert('cet', c);
    // Report légal de 15 mois (arrêt de travail), reçu sur la période 2026-2027 et courant au-delà : sa clôture l'imposera.
    await db.insert('reports', { empId: 6, jours: 4, motif: 'CP 2024-2025 non pris — arrêt de travail', par: 'Sandrine Vidal', date: '2026-06-02', sens: 'recu', periode: 2026, expire: '2027-08-31' });
    for (const d of DEMANDES_COLLAB) await db.insert('demandesCollab', d);
    // Visite d'embauche demandée pour l'apprenti, jamais vu par le médecin du travail.
    await db.insert('demandesVisite', { empId: 24, motif: 'embauche', le: '2026-10-05', par: RH_DEMO, statut: 'demandee', closeLe: null, closePar: null });
    for (const [ex, list] of Object.entries(BUDGETS)) {
      for (const [equipe, montant] of Object.entries(list)) await db.insert('budgets', { exercice: Number(ex), equipe, montant });
    }
    for (const l of PLAN) await db.insert('planActions', { exercice: 2026, ...(l.statut === 'realise' ? { coutReel: l.cout, effectifReel: l.effectif } : {}), ...l });
    for (const f of feuilles(taches)) await db.insert('feuilles', f);
    // Feuilles déjà transmises de la démonstration : réunies en un lot de paie historique, comme une base reprise.
    await lotHistorique(db, LOT_DEMO, '2026-10-02T15:00:00.000Z');
    await figerFeuilles(db);
    for (const e of entretiens()) await db.insert('entretiens', e);
    await comptesDemo(db);
    // lot 11 — notes de frais : module activé en démonstration, barème, forfaits, notes à chaque étape du circuit.
    await fraisDemo(db);

    // Reprise des compteurs : jours déjà pris sur les périodes en cours, arrêtés au jour du chargement (période de CP à
    // prendre et année de RTT de cette date), plafonnés pour laisser un solde réaliste.
    const ds: Dataset = await loadFull(db, { role: 'rh', empId: null, nom: '', intitule: '' });
    const d = new Domain(ds), arrete = ds.today;
    for (const e of ds.employes) {
      const c = d.contratOf(e), h = histo(e.id, !!c.forfait);
      const cp = c.interim ? 0 : Math.min(h.cp, Math.max(0, cpDroit(d, e).droit - 4));
      const rd = rttDroit(d, e);
      const rtt = rd == null ? 0 : Math.min(h.rtt, Math.max(0, rd - 3));
      // Les demandes de récupération en attente doivent rester couvertes par le compteur acquis.
      const recupDemandee = ds.absences.filter(a => a.empId === e.id && a.type === 'RECUP' && a.statut === 'demandee')
        .reduce((n, a) => n + d.countDays(e, a.du, a.au, 'RECUP', a) * d.dayH(e), 0);
      await db.insert('soldesReprise', { empId: e.id, cpPris: cp, rttPris: rtt, recupAcquis: Math.max(h.recA, h.recP + recupDemandee), recupPris: h.recP, arreteLe: arrete });
      // Reprise après une absence longue (maternité…), inscrite comme à la saisie par le RH.
      const r = repriseDesAbsences(ds.absences, e.id);
      if (r && !e.repriseDate) await db.update('employes', e.id, { repriseMotif: r.motif, repriseDate: r.date });
    }
    // Verdicts Go / No Go de départ, mémorisés sans envoi : en mode API, réputés connus de Keystone, seuls leurs
    // changements lui seront envoyés ; en simulation, ils repartiront tous au passage en mode API.
    await suivreVerdicts(db, { initial: true });
    // PostgreSQL : séquences placées au-delà des identifiants fixés par le jeu (salariés, sessions) ; sans effet en SQLite.
    await db.resyncIds();
  });
}

/**
 * Matricule de paie de démonstration (dossier Sage fictif) : l'intérimaire, payé par son agence, n'en a pas, ni l'apprenti
 * tout juste embauché, à saisir (Paramètres → Matricules de paie).
 */
const matriculePaieDemo = (id: number, typeContrat: string) => typeContrat === 'interim' || id === 24 ? null : String(4100 + id).padStart(6, '0');
/** Auteur du lot de paie historique de la démonstration. */
export const LOT_DEMO = 'Démonstration';
/** Auteur des comptes de démonstration (`comptes.creePar`). */
export const CREE_PAR_DEMO = 'Jeu de démonstration';
/** Domaine des adresses Microsoft 365 de démonstration (réservé à la documentation, jamais routé). */
export const DOMAINE_DEMO = 'entreprise.example';
/** Date des convocations déjà envoyées du jeu de démonstration. */
const CONVOQUES_LE = '2026-09-28';
/**
 * Titre de séjour valant autorisation de travail (shared/rules/contrats.ts) : celui de Fatou Ndiaye expire fin janvier 2027,
 * dans la fenêtre de la demande de renouvellement (alerte à 120 jours) ; les autres n'en ont pas besoin.
 */
const TITRES_DEMO: Record<number, AutorisationTravail> = {
  17: { type: 'pluriannuelle', numero: 'CS7712345', expire: '2027-01-29', verifieLe: '2023-12-20' },
};
/**
 * Messagerie de démonstration : boîte du service RH, service de santé au travail, agence de l'intérimaire (domaines
 * fictifs), dont l'adresse a été renseignée le 5 octobre : le premier relevé automatique est celui de la semaine 40.
 */
const MESSAGERIE_DEMO: Messagerie = {
  rh: `rh@${DOMAINE_DEMO}`, rhMode: 'immediat', santeTravail: 'contact@sante-travail.example',
  agences: [{ nom: 'Proman Lyon', adresse: 'releves.lyon@agence-interim.example', depuis: '2026-10-05' }],
};
/** Compte RH de démonstration : la responsable RH du jeu de données, administratrice RH, sans fiche salarié. */
export const RH_DEMO = 'Sandrine Vidal';

/** Profils des comptes de démonstration, selon le poste du salarié. */
const PROFILS_DEMO: Record<string, ProfilRh> = {
  'Chargé RH': 'rh_gestionnaire', 'Responsable HSE': 'referent_hse', 'Gestionnaire paie': 'paie', 'Auditrice interne': 'lecture_seule',
  // lot 11 — notes de frais : Manon Faure contrôle les notes de frais (profil « Comptabilité »).
  'Assistante de direction': 'comptabilite',
};

/**
 * Comptes de démonstration, créés une seule fois : la RH de démonstration (administratrice RH, compte
 * externe) et un compte par salarié — Microsoft 365, ou compte Cursus pour les ouvriers, intérimaires et
 * alternants. Antoine Leroy, chargé RH, est gestionnaire RH ; Sarah Cohen, responsable HSE, référente HSE / formation ;
 * Aïcha Diallo, gestionnaire de paie ; Élodie Bernard, auditrice interne, en lecture seule (PROFILS_DEMO). Les comptes
 * Cursus n'ont pas de mot de passe : en démonstration, la connexion est libre ; l'administrateur peut en attribuer un
 * (Comptes et accès).
 * Appelé aussi au démarrage pour une base de démonstration antérieure aux comptes.
 */
export async function comptesDemo(db: Db) {
  if (await db.count('comptes')) return;
  // Une ancienne base de démonstration a pu renommer la RH unique (paramètre rhNom) : même personne.
  const rhNom = (await db.getSetting<{ rhNom?: string }>('app', {})).rhNom || RH_DEMO;
  const base = {
    oid: null, actif: true, motDePasse: null, changerMotDePasse: false, echecs: 0, blocageFin: null,
    creation: new Date().toISOString(), creePar: CREE_PAR_DEMO, derniereConnexion: null,
  };
  const pris = new Set<string>();
  const unique = (id: string) => {
    let x = id, n = 1;
    while (pris.has(x)) x = id.replace(/^([^@]+)/, `$1${++n}`);
    pris.add(x);
    return x;
  };
  const adresse = unique(identifiantSuggere(rhNom, 'microsoft', DOMAINE_DEMO));
  await db.insert('comptes', { ...base, empId: null, nom: rhNom, adresse, identifiant: adresse, type: 'microsoft', profilRh: 'rh_admin' });
  for (const e of await db.all<Employe>('employes')) {
    const type = typeSuggere(e);
    await db.insert('comptes', {
      ...base, empId: e.id, nom: null, adresse: null, identifiant: unique(identifiantSuggere(e.nom, type, DOMAINE_DEMO)), type,
      profilRh: PROFILS_DEMO[e.poste] ?? 'aucun',
    });
  }
}
