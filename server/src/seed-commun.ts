// Démonstration commune (demande du propriétaire du 2 novembre 2026) : les personnes fictives des autres outils (Keystone,
// Codex, Vigie, Crucible ; Arche et Matrix n'en ont aucune) rejoignent la démonstration de Cursus, qui fait foi pour les
// salariés (décision D01 de Matrix) et les publie par cursus.pub_salaries ; les autres outils les rapprochent par matricule.
// Référentiel unifié, matricules et écarts relevés : docs/DEMO-COMMUNE.md ; demandes aux autres outils :
// docs/demandes/demo-commune-<outil>.md.
// - `ajouterReferentielCommun` : sites de Matrix (lyon, le_havre, marseille) et des essais (lyon_essais, site_rd), entité
//   EPC2I complétée, équipes existantes rattachées à un site et à une unité de Matrix, équipes des départements et des
//   ateliers, fiches 25 à 81 (identifiants FIXES : EMP-0025 à EMP-0081 ; EMP-0001 à EMP-0024 ne bougent pas), comptes de
//   démonstration, quelques certifications, projets de Keystone et affectations sur HLT-026. Idempotent (rejoué : rien
//   n'est ajouté deux fois), dans une transaction, refusé sur une base qui ne porte pas le marqueur de démonstration
//   (`REGLAGE_DEMO`) ou qui a été purgée ou exploitée (`refusDemo`).
// - Branchements : npm run demo-commun (server/src/demo-commun-cli.ts, --a-blanc pour l'aperçu), et, avec
//   CURSUS_DEMO_COMMUN=1, premier amorçage de la démonstration (server/src/index.ts), « Réinitialiser la démonstration »
//   (server/src/actions/parametres.ts) et npm run reset-demo. seedDemo n'en dépend jamais : les 24 salariés des tests restent.
// - Purge (npm run purge-demo) : fiches, comptes, certifications, projets, chantiers et missions partent avec les données
//   fictives ; `retirerReferentielCommun` retire en plus, après les fiches, les équipes, les sites et les postes ajoutés ici,
//   et défait le site et l'unité posés sur les équipes gardées et sur l'entité (server/src/purge-demo-execution.ts).
// Aucune table, aucune colonne, aucune migration : tout passe par les tables existantes (cache incrémental compris, les
// déclencheurs de révision suivent ces écritures comme celles d'une action).
import { matricule, plural } from '../../shared/format.ts';
import { identifiantSuggere, typeSuggere } from '../../shared/rules/comptes.ts';
import { entiteOuverte } from '../../shared/rules/entites.ts';
import type { CategorieEmploi, Employe, Entite, Equipe, Sexe, Site, Statut, TempsTravail } from '../../shared/types.ts';
import { VERSION } from './chemins.ts';
import { journaliser } from './comptes.ts';
import type { Db } from './db.ts';
import { amorcerEntites, CODE_ENTITE_AMORCEE, rattacherEquipeNeuve } from './demarrage.ts';
import { contexte, enregistrerAffectation, enregistrerChantier, enregistrerProjet, enregistrerTache } from './integrations/keystone-entrant.ts';
import { suivreVerdicts } from './integrations/keystone-verdicts.ts';
import { refusDemo, REGLAGE_DEMO } from './marqueurs.ts';
import { historiqueDepuisFiches } from './migrations/lot6-contrats.ts';
import { postesDepuisFiches } from './migrations/referentiels.ts';
import { recalerRattachements } from './rattachements.ts';
import { CREE_PAR_DEMO, SALARIES_DEMO } from './seed.ts';

/** Réglage posé par l'ajout du référentiel commun : instant et version ; lu par la purge (server/src/purge-demo.ts). */
export const REGLAGE_DEMO_COMMUN = 'demoCommun';
/** Code de journal de l'ajout (libellé : shared/journal.ts) ; décomptes seulement, jamais un nom. */
export const ACTION_DEMO_COMMUN = 'demo.commun';
/** Domaine des adresses de démonstration des outils (Crucible, Vigie) ; Keystone garde ses adresses en @epc2i.fr. */
export const DOMAINE_COMMUN = 'epc2i.example';
/** Premier et dernier identifiant du référentiel commun (EMP-0025 à EMP-0081). */
export const PREMIER_ID_COMMUN = 25;
export const DERNIER_ID_COMMUN = 81;

export class ReferentielCommunRefuse extends Error {}

export interface MarqueurDemoCommun { ajouteLe: string; version: string }

// — Sites (cache de matrix.pub_sites) : les trois sites de Matrix, libellés de Matrix ; la zone d'essais de Vigie (ville-b)
//   et le site d'essais de Crucible (RD-SITE), hors format de Matrix chez eux, sous des codes au format —

export const SITES_COMMUNS: readonly Site[] = [
  { code: 'lyon', libelle: 'Lyon — siège et atelier', actif: true, ordre: 10 },
  { code: 'le_havre', libelle: 'Le Havre — magasin', actif: true, ordre: 20 },
  { code: 'marseille', libelle: 'Marseille — magasin', actif: true, ordre: 30 },
  { code: 'lyon_essais', libelle: 'Lyon — zone d’essais', actif: true, ordre: 40 },
  { code: 'site_rd', libelle: 'Site d’essais R&D', actif: true, ordre: 50 },
];

/** Équipes de la démonstration de Cursus : site et unité de l'organigramme de Matrix posés (noms et managers inchangés). */
export const UNITES_EQUIPES_DEMO: Readonly<Record<string, { uniteCode: string; siteCode: string }>> = {
  Production: { uniteCode: 'CHA-PROD', siteCode: 'lyon' },
  Maintenance: { uniteCode: 'CHA-MAINT', siteCode: 'lyon' },
  Logistique: { uniteCode: 'ACH-LOG', siteCode: 'lyon' },
  'Qualité & HSE': { uniteCode: 'HSE-QHSE', siteCode: 'lyon' },
  Administration: { uniteCode: 'RHU-ADM', siteCode: 'lyon' },
  Commercial: { uniteCode: 'COM-VENTE', siteCode: 'lyon' },
};

interface EquipeCommune { nom: string; uniteCode: string; siteCode: string; managerId: number | null; parente: string | null }

/**
 * Équipes ajoutées, parentes avant leurs équipes rattachées : une par département de Matrix (responsable de département
 * de Codex, HOLDERS de codex/src/db/seed-org.ts), puis les ateliers et services de Vigie et les moyens d'essais de
 * Crucible, rattachés à leur département. Une équipe rattachée porte son propre site quand il diffère.
 */
export const EQUIPES_COMMUNES: readonly EquipeCommune[] = [
  { nom: 'Direction', uniteCode: 'DIR', siteCode: 'lyon', managerId: 48, parente: null },
  { nom: 'Projets', uniteCode: 'PRJ', siteCode: 'lyon', managerId: 25, parente: null },
  { nom: 'Ingénierie', uniteCode: 'ING', siteCode: 'lyon', managerId: 33, parente: null },
  { nom: 'MEP', uniteCode: 'MEP', siteCode: 'lyon', managerId: 38, parente: null },
  { nom: 'Chantier', uniteCode: 'CHA', siteCode: 'le_havre', managerId: 40, parente: null },
  { nom: 'Qualité', uniteCode: 'QUA', siteCode: 'lyon', managerId: 44, parente: null },
  { nom: 'HSE', uniteCode: 'HSE', siteCode: 'lyon', managerId: 47, parente: null },
  { nom: 'Achats', uniteCode: 'ACH', siteCode: 'marseille', managerId: 46, parente: null },
  { nom: 'RH', uniteCode: 'RHU', siteCode: 'lyon', managerId: 49, parente: null },
  { nom: 'Finance', uniteCode: 'FIN', siteCode: 'lyon', managerId: 50, parente: null },
  { nom: 'Juridique', uniteCode: 'JUR', siteCode: 'lyon', managerId: 51, parente: null },
  { nom: 'SI', uniteCode: 'DSI', siteCode: 'lyon', managerId: 52, parente: null },
  { nom: 'Communication', uniteCode: 'CMN', siteCode: 'lyon', managerId: 53, parente: null },
  { nom: 'R&D', uniteCode: 'RDI', siteCode: 'lyon', managerId: 54, parente: null },
  // Rattachées : chef de projet du Havre, ateliers et services de Vigie, moyens d'essais de Crucible.
  { nom: 'Projets Le Havre', uniteCode: 'PRJ-HAVRE', siteCode: 'le_havre', managerId: 26, parente: 'Projets' },
  { nom: 'Bureau d’études', uniteCode: 'ING-BE', siteCode: 'lyon', managerId: 33, parente: 'Ingénierie' },
  { nom: 'Zone d’essais', uniteCode: 'ING-ESSAIS', siteCode: 'lyon_essais', managerId: 73, parente: 'Ingénierie' },
  { nom: 'Atelier montage', uniteCode: 'CHA-MONTAGE', siteCode: 'lyon', managerId: 77, parente: 'Chantier' },
  { nom: 'Atelier usinage', uniteCode: 'CHA-USINAGE', siteCode: 'lyon', managerId: 40, parente: 'Chantier' },
  { nom: 'Magasin', uniteCode: 'ACH-MAGASIN', siteCode: 'lyon', managerId: 46, parente: 'Achats' },
  { nom: 'Essais R&D', uniteCode: 'RDI-ESSAIS', siteCode: 'site_rd', managerId: 60, parente: 'R&D' },
];

// — Personnes : [id, nom, poste, équipe, statut, entrée, année de naissance, sexe, e-mail de l'outil source ou null, outils] —

type Personne = [id: number, nom: string, poste: string, equipe: string, statut: Statut, entree: string, naissance: number, sexe: Sexe, email: string | null, outils: string];

const K = (nom: string) => `${identifiantSuggere(nom, 'local')}@epc2i.fr`;
const I = (local: string) => `${local}@${DOMAINE_COMMUN}`;

/** Fiches 25 à 81 ; outils : K Keystone, C Codex, V Vigie, Cr Crucible (docs/DEMO-COMMUNE.md). */
export const PERSONNES_COMMUNES: readonly Personne[] = [
  [25, 'Marie Lefebvre', 'Directrice de portefeuille', 'Projets', 'cadre', '2012-09-03', 1974, 'F', K('Marie Lefebvre'), 'K, C'],
  [26, 'Romain Aubert', 'Chef de projet', 'Projets Le Havre', 'cadre', '2015-02-02', 1982, 'M', K('Romain Aubert'), 'K, C'],
  [27, 'Sophie Perrin', 'Cheffe de projet', 'Projets', 'cadre', '2017-06-12', 1986, 'F', null, 'K, C'],
  [28, 'Cédric Moreau', 'Chef de projet', 'Projets', 'cadre', '2014-03-17', 1980, 'M', null, 'K, C'],
  [29, 'Léa Marchand', 'Contrôleuse de gestion', 'Projets', 'cadre', '2019-01-07', 1990, 'F', K('Léa Marchand'), 'K, C'],
  [30, 'Damien Roux', 'Planificateur', 'Projets', 'technicien', '2018-04-03', 1988, 'M', null, 'K'],
  [31, 'Camille Verdier', 'Coordinatrice logistique', 'Projets', 'technicien', '2021-09-01', 1993, 'F', K('Camille Verdier'), 'K'],
  [32, 'Ines Duarte', 'Responsable contrôle de projet', 'Projets', 'cadre', '2013-11-04', 1979, 'F', null, 'K'],
  [33, 'Marion Kerviel', 'Responsable ingénierie', 'Ingénierie', 'cadre', '2010-05-10', 1975, 'F', K('Marion Kerviel'), 'K, C'],
  [34, 'Antoine Girard', 'Référent ingénierie', 'Ingénierie', 'cadre', '2014-09-01', 1983, 'M', K('Antoine Girard'), 'K, C'],
  [35, 'Julien Wagner', 'Ingénieur structure', 'Ingénierie', 'cadre', '2018-02-05', 1989, 'M', K('Julien Wagner'), 'K, C'],
  [36, 'Samir Haddad', 'Ingénieur électricité', 'Ingénierie', 'cadre', '2020-01-06', 1991, 'M', null, 'K (« Sami »), C'],
  [37, 'Camille Morvan', 'Automaticienne', 'Ingénierie', 'cadre', '2021-03-01', 1994, 'F', null, 'K (« Claire »), C'],
  [38, 'Pauline Noguès', 'Responsable MEP', 'MEP', 'cadre', '2013-06-03', 1981, 'F', null, 'K, C'],
  [39, 'Sophie Renard', 'Ingénieure MEP', 'MEP', 'cadre', '2019-10-01', 1990, 'F', null, 'K'],
  [40, 'Olivier Blanc', 'Responsable opérations chantier', 'Chantier', 'cadre', '2009-04-14', 1972, 'M', null, 'K, C'],
  [41, 'Lucas Fabre', 'Responsable de chantier', 'Chantier', 'cadre', '2016-05-02', 1985, 'M', null, 'K, C'],
  [42, 'Amélie Ollivier', 'Cheffe de site', 'Chantier', 'cadre', '2017-01-09', 1987, 'F', null, 'K'],
  [43, 'Thomas Kerbrat', 'Opérations de levage', 'Chantier', 'technicien', '2015-07-01', 1984, 'M', null, 'K'],
  [44, 'Gabriel Comte', 'Responsable qualité', 'Qualité', 'cadre', '2011-10-03', 1977, 'M', K('Gabriel Comte'), 'K, C'],
  [45, 'Hélène Sauvage', 'Technicienne QA/QC', 'Qualité', 'technicien', '2018-09-03', 1992, 'F', null, 'K, C'],
  [46, 'Fabien Bertrand', 'Responsable achats et stock', 'Achats', 'cadre', '2012-01-16', 1978, 'M', K('Fabien Bertrand'), 'K, C'],
  [47, 'Claire Bardet', 'Responsable HSE et gestion documentaire', 'HSE', 'cadre', '2011-03-07', 1976, 'F', null, 'C'],
  [48, 'Hélène Costa', 'Directrice générale', 'Direction', 'cadre', '2008-01-07', 1968, 'F', null, 'C'],
  [49, 'Nadia Benali', 'Responsable RH', 'RH', 'cadre', '2014-02-03', 1980, 'F', null, 'C'],
  [50, 'Thomas Weil', 'Responsable financier', 'Finance', 'cadre', '2013-09-02', 1977, 'M', null, 'C'],
  [51, 'Inès Rahmani', 'Juriste', 'Juridique', 'cadre', '2020-06-01', 1990, 'F', null, 'C'],
  [52, 'Marc Delorme', 'Responsable SI', 'SI', 'cadre', '2012-11-05', 1975, 'M', null, 'C'],
  [53, 'Lucie Martin', 'Chargée de communication', 'Communication', 'cadre', '2022-02-01', 1995, 'F', null, 'C'],
  [54, 'Yasmine Aït-Saïd', 'Responsable R&D', 'R&D', 'cadre', '2016-04-04', 1983, 'F', null, 'C'],
  [55, 'James Holt', 'Auditeur interne', 'Qualité', 'cadre', '2019-05-06', 1981, 'M', null, 'C'],
  [56, 'David Imbert', 'Chef de projet', 'Projets', 'cadre', '2016-09-05', 1984, 'M', null, 'K (« D. Imbert »)'],
  [57, 'Karine Blanchard', 'Cheffe de projet', 'Projets', 'cadre', '2015-03-02', 1982, 'F', null, 'K (« K. Blanchard »)'],
  [58, 'Arnaud Naveau', 'Chef de projet', 'Projets', 'cadre', '2018-11-05', 1987, 'M', null, 'K (« A. Naveau »)'],
  [59, 'Laure Fontaine', 'Cheffe de projet', 'Projets', 'cadre', '2020-09-01', 1989, 'F', null, 'K (« L. Fontaine »)'],
  [60, 'Hélène Marchal', 'Directrice R&D', 'Essais R&D', 'cadre', '2010-09-01', 1973, 'F', I('h.marchal'), 'Cr'],
  [61, 'Antoine Leroy', 'Coordinateur des moyens d’essais', 'Essais R&D', 'cadre', '2017-02-06', 1986, 'M', I('a.leroy'), 'Cr'],
  [62, 'Nathalie Brun', 'Référente sécurité pyrotechnique', 'Essais R&D', 'cadre', '2014-06-02', 1979, 'F', I('n.brun'), 'Cr'],
  [63, 'Damien Petit', 'Responsable du PDE', 'Essais R&D', 'cadre', '2013-01-14', 1978, 'M', I('d.petit'), 'Cr'],
  [64, 'Camille Fabre', 'Cheffe de projet R&D', 'Essais R&D', 'cadre', '2019-04-01', 1988, 'F', I('c.fabre'), 'Cr'],
  [65, 'Julien Masson', 'Technicien d’essais', 'Essais R&D', 'technicien', '2020-10-05', 1994, 'M', I('j.masson'), 'Cr'],
  [66, 'Olivier Caron', 'Responsable ingénierie', 'Ingénierie', 'cadre', '2011-06-06', 1976, 'M', I('o.caron'), 'Cr'],
  [67, 'Sandrine Roux', 'Responsable du laboratoire 67', 'Essais R&D', 'cadre', '2015-09-07', 1982, 'F', I('s.roux'), 'Cr'],
  [68, 'Mehdi Arnaud', 'Chef de projet R&D', 'Essais R&D', 'cadre', '2021-01-11', 1990, 'M', I('m.arnaud'), 'Cr'],
  // Vigie : 13 personnes « [C. Lefèvre] » (initiale seule), prénom choisi d'après l'initiale ; adresses de Vigie.
  [69, 'Thierry Nguyen', 'Monteur', 'Atelier montage', 'ouvrier', '2019-05-13', 1991, 'M', I('t.nguyen'), 'V'],
  [70, 'Michel Girard', 'Usineur', 'Atelier usinage', 'ouvrier', '2012-10-01', 1975, 'M', I('m.girard'), 'V'],
  [71, 'Paul Roux', 'Usineur', 'Atelier usinage', 'ouvrier', '2020-02-03', 1996, 'M', I('p.roux'), 'V'],
  [72, 'Alice Martin', 'Technicienne d’essais', 'Zone d’essais', 'technicien', '2018-06-04', 1993, 'F', I('a.martin'), 'V'],
  [73, 'Jérôme Petit', 'Chef de zone d’essais', 'Zone d’essais', 'technicien', '2010-03-01', 1974, 'M', I('j.petit'), 'V'],
  [74, 'René Fontaine', 'Magasinier', 'Magasin', 'ouvrier', '2014-11-03', 1970, 'M', I('r.fontaine'), 'V'],
  [75, 'Émilie Dubois', 'Ingénieure bureau d’études', 'Bureau d’études', 'cadre', '2017-09-04', 1989, 'F', I('e.dubois'), 'V'],
  [76, 'Laurent Moreau', 'Responsable qualité atelier', 'Qualité', 'cadre', '2013-04-08', 1978, 'M', I('l.moreau'), 'V'],
  [77, 'Stéphane Benali', 'Chef d’atelier montage', 'Atelier montage', 'technicien', '2008-09-01', 1971, 'M', I('s.benali'), 'V'],
  [78, 'Kevin Bernard', 'Monteur', 'Atelier montage', 'ouvrier', '2026-09-28', 2000, 'M', I('k.bernard'), 'V'],
  [79, 'Céline Lefèvre', 'Animatrice QHSE', 'HSE', 'technicien', '2016-02-01', 1985, 'F', I('c.lefevre'), 'V'],
  [80, 'Henri Marchand', 'Directeur de site', 'Direction', 'cadre', '2009-01-05', 1966, 'M', I('h.marchand'), 'V'],
  [81, 'Yves Lambert', 'Usineur', 'Atelier usinage', 'ouvrier', '2026-04-01', 1998, 'M', I('y.lambert'), 'V'],
];

/** Identifiants et noms des fiches du référentiel commun (reconnues par la purge, server/src/purge-demo.ts). */
export const SALARIES_COMMUNS: readonly { id: number; nom: string }[] = PERSONNES_COMMUNES.map(([id, nom]) => ({ id, nom }));

/** Yves Lambert, sorti de Vigie (« Fin de contrat ») : CDD arrivé à son terme le 1er octobre 2026. */
const SORTI = { id: 81, fin: '2026-10-01' };

/** Profils RH des comptes (les autres : aucun) : la responsable RH de Codex, gestionnaire RH. */
const PROFILS_COMMUNS: Readonly<Record<number, 'rh_gestionnaire'>> = { 49: 'rh_gestionnaire' };

/** Quelques formations à jour ou proches de l'échéance, sans titre ni donnée de santé : [salarié, formation, obtenue]. */
const CERTIFICATIONS_COMMUNES: readonly [number, string, string][] = [
  [36, 'elec', '2024-10-08'], [41, 'sst', '2025-04-10'], [42, 'sst', '2025-02-14'], [42, 'hauteur', '2024-06-20'],
  [43, 'caces486', '2023-05-15'], [43, 'hauteur', '2024-03-12'], [45, 'sst', '2024-11-14'], [47, 'epi', '2026-02-03'],
  [69, 'sst', '2025-06-05'], [74, 'caces489', '2022-09-19'], [74, 'sst', '2025-01-23'], [79, 'sst', '2025-11-04'], [79, 'epi', '2026-01-20'],
];

// — Projets et affectations de Keystone (cache Keystone) : codes et noms de src/server/prototype/prototype-generated.json —

/** [code, nom, statut] : les projets clos, en garantie terminée ou annulés sont archivés. */
export const PROJETS_KEYSTONE: readonly [string, string, 'actif' | 'archive'][] = [
  ['HLT-026', 'Harbor Line Terminal Expansion', 'actif'], ['NDC-031', 'Northgate Data Center Retrofit', 'actif'],
  ['RCF-019', 'Clinique Pasteur Lyon Fit-out', 'actif'], ['ERP-202', 'ERP Migration — Phase 2', 'actif'],
  ['WSA-044', 'Westfield Solar Array', 'actif'], ['MSR-012', 'Marseille Metro Signage Rollout', 'actif'],
  ['EWA-051', 'Eastbank Warehouse Automation', 'actif'], ['FTU-052', 'Fleet Telematics Upgrade', 'actif'],
  ['RBR-048', 'Ridgeway Bridge Rehabilitation', 'actif'], ['CER-047', 'Campus Energy Retrofit', 'actif'],
  ['PRS-038', 'Portside Rail Spur', 'actif'], ['ALP-021', 'Airfield Lighting Phase 1', 'actif'],
  ['DRR-009', 'Depot Roof Replacement', 'archive'], ['HRM-011', 'HR System Migration', 'archive'],
  ['QFR-015', 'Quayside Fender Renewal', 'archive'], ['TTR-017', 'Telecom Tower Relocation', 'archive'],
  ['SCP-033', 'Southgate Car Park', 'archive'],
];

/** Phase de chantier de HLT-026 (Le Havre, quai 4 ; responsable de chantier de Codex), sans exigence du Go / No Go. */
const CHANTIER_HLT = {
  id: 'HLT-026', nom: 'Harbor Line Terminal Expansion', client: 'Autorité portuaire du Havre', lieu: 'Le Havre — quai 4', pays: 'FR',
  debut: '2026-10-12', fin: '2026-12-18', chef: 'Lucas Fabre', habilitations: [], certifications: [],
};

/**
 * Affectations sur HLT-026 : l'équipe du chantier dans Keystone (DEMO_ASSIGNMENTS, src/server/db/seed/demo-assignments.ts)
 * et EMP-0018 Romain Chevalier, comme l'exemple d'heures validées de Matrix (data/contrats/heures-validees.schema.json),
 * après ses chantiers de Tanger et d'Abidjan.
 */
const AFFECTATIONS_HLT: readonly [number, string, string][] = [
  [41, '2026-10-12', '2026-12-18'], [42, '2026-10-12', '2026-12-18'], [43, '2026-10-19', '2026-11-27'], [35, '2026-10-26', '2026-11-06'],
  [45, '2026-11-02', '2026-11-13'], [38, '2026-11-16', '2026-11-27'], [18, '2026-12-07', '2026-12-11'],
];

/** Tâche planifiée de Romain Chevalier sur HLT-026 (heures proposées dans sa feuille de temps). */
const TACHE_HLT = { id: 'KS-HLT-026-EMP-0018', projet: 'HLT-026', tache: 'Mise en service des variateurs', empId: 18, debut: '2026-12-07', fin: '2026-12-11' };

// — Plan et ajout —

/** Ce que l'ajout écrirait (aperçu, --a-blanc) ou a écrit : éléments manquants seulement. */
export interface PlanCommun {
  sites: string[];
  /** Équipes existantes dont le site ou l'unité est à poser. */
  rattachements: string[];
  equipes: string[];
  fiches: number[];
  comptes: number;
  certifications: number;
  projets: string[];
  affectations: number;
  /** Entité complétée (nom EPC2I, site lyon) : code, ou null. */
  entite: string | null;
}

const idAffectation = (empId: number) => `KS-HLT-026-${matricule(empId)}`;

/** Refus sur une base qui n'est pas une démonstration (marqueur absent, purgée ou exploitée), ou dont un identifiant est pris. */
export async function refusReferentielCommun(db: Db): Promise<string | null> {
  if (!await db.getSetting<unknown>(REGLAGE_DEMO, null)) {
    return `la base ne porte pas le marqueur de démonstration (réglage « ${REGLAGE_DEMO} ») : le référentiel commun ne s’ajoute qu’à une démonstration chargée par Cursus.`;
  }
  const refus = await refusDemo(db);
  if (refus) return refus;
  // Identifiants fixes : une fiche 25 à 81 d'une autre personne (créée par un visiteur) les rendrait ambigus.
  const pris = (await db.query<{ id: number; nom: string | null }>('SELECT id, nom FROM employes WHERE id >= ? AND id <= ? ORDER BY id', [PREMIER_ID_COMMUN, DERNIER_ID_COMMUN]))
    .filter(e => SALARIES_COMMUNS.find(s => s.id === Number(e.id))?.nom !== e.nom);
  if (pris.length) return `${plural(pris.length, 'identifiant réservé au référentiel commun est déjà pris', 'identifiants réservés au référentiel commun sont déjà pris')} par une autre fiche (${pris.map(e => matricule(Number(e.id))).join(', ')}) : réinitialisez la démonstration, puis relancez.`;
  return null;
}

/** Éléments manquants, en lecture seule. */
export async function planReferentielCommun(db: Db): Promise<PlanCommun> {
  return await db.lecture(async () => {
    const sites = new Set((await db.all<Site>('sites')).map(s => s.code));
    const equipes = new Map((await db.all<Equipe>('equipes')).map(q => [q.nom, q]));
    const fiches = new Set((await db.query<{ id: number }>('SELECT id FROM employes')).map(e => Number(e.id)));
    const avecCompte = new Set((await db.query<{ emp_id: number | null }>('SELECT emp_id FROM comptes WHERE emp_id IS NOT NULL')).map(c => Number(c.emp_id)));
    const certs = new Set((await db.query<{ emp_id: number; f: string }>('SELECT emp_id, f FROM certifications')).map(c => `${c.emp_id}|${c.f}`));
    const projets = new Set((await db.query<{ code: string }>('SELECT code FROM projets')).map(p => p.code));
    const missions = new Set((await db.query<{ ref: string | null }>('SELECT ref FROM missions WHERE ref IS NOT NULL')).map(m => m.ref));
    const entite = await entiteCible(db);
    return {
      sites: SITES_COMMUNS.filter(s => !sites.has(s.code)).map(s => s.code),
      rattachements: Object.entries(UNITES_EQUIPES_DEMO).filter(([nom, r]) => {
        const q = equipes.get(nom);
        return q && (!q.uniteCode || !q.siteCode) && (q.uniteCode ?? r.uniteCode) === r.uniteCode;
      }).map(([nom]) => nom),
      equipes: EQUIPES_COMMUNES.filter(q => !equipes.has(q.nom)).map(q => q.nom),
      fiches: PERSONNES_COMMUNES.filter(([id]) => !fiches.has(id)).map(([id]) => id),
      // Comptes : un par fiche commune qui n'en a pas (les fiches à créer comprises), si la base a déjà ses comptes.
      comptes: await db.count('comptes') ? PERSONNES_COMMUNES.filter(([id]) => !avecCompte.has(id)).length : 0,
      certifications: CERTIFICATIONS_COMMUNES.filter(([e, f]) => !certs.has(`${e}|${f}`)).length,
      projets: PROJETS_KEYSTONE.filter(([code]) => !projets.has(code)).map(([code]) => code),
      affectations: AFFECTATIONS_HLT.filter(([e]) => !missions.has(idAffectation(e))).length,
      entite: entite && (entite.nom === 'Entreprise' || !entite.siteCode) ? entite.code : null,
    };
  });
}

/** Rien à ajouter ? */
export const planVide = (p: PlanCommun) => !p.sites.length && !p.rattachements.length && !p.equipes.length && !p.fiches.length && !p.comptes
  && !p.certifications && !p.projets.length && !p.affectations && !p.entite;

/** Entité à compléter : l'entité amorcée, sinon la seule société ouverte. */
async function entiteCible(db: Db): Promise<Entite | null> {
  const entites = await db.all<Entite>('entites');
  const ouvertes = entites.filter(x => entiteOuverte(x) && x.type === 'societe' && x.source !== 'matrix');
  return ouvertes.find(x => x.code === CODE_ENTITE_AMORCEE) ?? (ouvertes.length === 1 ? ouvertes[0] : null);
}

/** Date de naissance complète, tirée de l'identifiant (jour et mois plausibles, jamais un 29 février). */
const neLe = (id: number, annee: number) => `${annee}-${String((id % 12) + 1).padStart(2, '0')}-${String((id * 7 % 27) + 1).padStart(2, '0')}`;

const categorieDe = (s: Statut): CategorieEmploi => (s === 'cadre' ? 'cadre' : s === 'technicien' ? 'tam' : 'ouvrier');
/** Cadres au forfait annuel en jours ; techniciens à 39 h avec RTT ; ouvriers à 35 h. */
const regimeDe = (s: Statut): { temps: TempsTravail; forfaitJours: number | null } => (s === 'cadre'
  ? { temps: 'forfait_jours', forfaitJours: 218 } : { temps: s === 'technicien' ? '39h_rtt' : '35h', forfaitJours: null });

/**
 * Ajoute le référentiel commun (éléments manquants seulement), dans une transaction. Refus (ReferentielCommunRefuse) hors
 * démonstration. Rend le plan exécuté (vide quand tout y était déjà).
 */
export async function ajouterReferentielCommun(db: Db, maintenant = new Date()): Promise<PlanCommun> {
  return await db.tx(async () => {
    const refus = await refusReferentielCommun(db);
    if (refus) throw new ReferentielCommunRefuse(refus);
    // Entité unique amorcée comme au démarrage (sans effet quand elle existe), avant les équipes nouvelles.
    await amorcerEntites(db);
    const plan = await planReferentielCommun(db);
    if (planVide(plan)) return plan;

    // 1. Sites, puis entité complétée (nom de la société, site du siège).
    for (const s of SITES_COMMUNS) if (plan.sites.includes(s.code)) await db.insert<Site>('sites', s);
    const entite = await entiteCible(db);
    if (entite && plan.entite) {
      await db.update<Entite>('entites', entite.code, { ...(entite.nom === 'Entreprise' ? { nom: 'EPC2I' } : {}), ...(entite.siteCode ? {} : { siteCode: 'lyon' }) });
    }
    // 2. Équipes de la démonstration : site et unité de Matrix (un champ déjà posé par le service RH n'est jamais remplacé).
    for (const nom of plan.rattachements) {
      const q = (await db.get<Equipe>('equipes', nom))!, r = UNITES_EQUIPES_DEMO[nom];
      await db.update<Equipe>('equipes', nom, { siteCode: q.siteCode ?? r.siteCode, uniteCode: q.uniteCode ?? r.uniteCode });
    }
    // 3. Équipes nouvelles, après les existantes ; managers posés avant leurs fiches (clé différée en PostgreSQL).
    let ordre = Number((await db.one<{ n: number | null }>('SELECT MAX(ordre) AS n FROM equipes'))?.n ?? -1);
    for (const q of EQUIPES_COMMUNES) {
      if (!plan.equipes.includes(q.nom)) continue;
      await db.insert('equipes', { nom: q.nom, managerId: q.managerId, ordre: ++ordre, parente: q.parente, siteCode: q.siteCode, uniteCode: q.uniteCode });
      // Équipe racine : rattachée à la société, comme une équipe créée par le service RH.
      if (!q.parente) await rattacherEquipeNeuve(db, q.nom);
    }
    // 4. Fiches (identifiants fixes), puis postes du référentiel et historique des contrats, comme le jeu de démonstration.
    for (const [id, nom, poste, equipe, statut, entree, naissance, sexe, email] of PERSONNES_COMMUNES) {
      if (!plan.fiches.includes(id)) continue;
      const sorti = id === SORTI.id;
      await db.insert('employes', {
        id, nom, equipe, poste, statut, typeContrat: sorti ? 'cdd' : 'cdi', ...regimeDe(statut), heures: null, forfaitHeures: null, jourOff: [],
        entree, fin: sorti ? SORTI.fin : null, naissance, naissanceLe: neLe(id, naissance), agence: null, matriculePaie: String(4100 + id).padStart(6, '0'),
        email: email ?? identifiantSuggere(nom, 'microsoft', DOMAINE_COMMUN), notifications: 'immediat',
        repriseMotif: null, repriseDate: null, visite: null, avis: null, restrictions: [], passeportNumero: null, passeportExpire: null, autorisationTravail: null,
        sexe, categorie: categorieDe(statut),
        ...(sorti ? { motifRecours: 'accroissement', cddFinInitiale: SORTI.fin, motifSortie: 'fin_cdd', finPrevue: SORTI.fin } : {}),
      });
    }
    if (plan.fiches.length) {
      await postesDepuisFiches(db);
      await historiqueDepuisFiches(db);
    }
    // Site et unité des fiches tirés de leur équipe (server/src/rattachements.ts) : nouvelles fiches et équipes rattachées.
    await recalerRattachements(db);
    // 5. Comptes de démonstration (connexion libre), si la base a déjà ses comptes (sinon comptesDemo les créera tous).
    if (plan.comptes) {
      const pris = new Set((await db.query<{ identifiant: string }>('SELECT identifiant FROM comptes')).map(c => c.identifiant.toLowerCase()));
      const avecCompte = new Set((await db.query<{ emp_id: number | null }>('SELECT emp_id FROM comptes WHERE emp_id IS NOT NULL')).map(c => Number(c.emp_id)));
      for (const e of await db.query<Pick<Employe, 'id' | 'nom' | 'statut' | 'typeContrat' | 'email'>>(
        'SELECT id, nom, statut, type_contrat AS "typeContrat", email FROM employes WHERE id >= ? AND id <= ? ORDER BY id', [PREMIER_ID_COMMUN, DERNIER_ID_COMMUN])) {
        if (avecCompte.has(Number(e.id))) continue;
        const type = typeSuggere(e);
        let identifiant = type === 'microsoft' && e.email ? e.email.toLowerCase() : identifiantSuggere(e.nom, type);
        for (let n = 2; pris.has(identifiant); n++) identifiant = identifiant.replace(/^([^@]+?)\d*(@|$)/, `$1${n}$2`);
        pris.add(identifiant);
        await db.insert('comptes', {
          empId: Number(e.id), nom: null, adresse: null, identifiant, type, profilRh: PROFILS_COMMUNS[Number(e.id)] ?? 'aucun',
          oid: null, actif: true, motDePasse: null, changerMotDePasse: false, echecs: 0, blocageFin: null,
          creation: maintenant.toISOString(), creePar: CREE_PAR_DEMO, derniereConnexion: null,
        });
      }
    }
    // 6. Certifications.
    const certs = new Set((await db.query<{ emp_id: number; f: string }>('SELECT emp_id, f FROM certifications')).map(c => `${c.emp_id}|${c.f}`));
    for (const [empId, f, obtenue] of CERTIFICATIONS_COMMUNES) {
      if (!certs.has(`${empId}|${f}`)) await db.insert('certifications', { empId, f, obtenue, sessionId: null, convoc: null, convocLe: null });
    }
    // 7. Keystone : mêmes contrôles et mêmes tables que l'API entrante (server/src/integrations/keystone-entrant.ts).
    const cx = await contexte(db);
    for (const [code, nom, statut] of PROJETS_KEYSTONE) if (plan.projets.includes(code)) await enregistrerProjet(cx, code, { nom, statut });
    if (plan.affectations) {
      const { id, ...c } = CHANTIER_HLT;
      if (!await db.get('chantiers', id)) await enregistrerChantier(cx, id, c);
      for (const [empId, du, au] of AFFECTATIONS_HLT) await enregistrerAffectation(cx, idAffectation(empId), { matricule: cx.matricule(empId), chantier: id, du, au });
      const heures = Object.fromEntries(['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11'].map(j => [j, 7]));
      const { id: tid, empId, ...t } = TACHE_HLT;
      await enregistrerTache(cx, tid, { matricule: cx.matricule(empId), ...t, heures });
      // Verdicts Go / No Go de départ des nouvelles ressources, mémorisés sans envoi (comme seedDemo).
      await suivreVerdicts(db, { initial: true });
    }
    // 8. Séquences PostgreSQL au-delà des identifiants fixés (sans effet en SQLite), marqueur et journal (décomptes seuls).
    await db.resyncIds();
    await db.setSetting(REGLAGE_DEMO_COMMUN, { ajouteLe: maintenant.toISOString(), version: VERSION } satisfies MarqueurDemoCommun);
    await journaliser(db, {
      actor: 'Cursus', role: null, action: ACTION_DEMO_COMMUN,
      message: `Référentiel commun de démonstration ajouté : ${plural(plan.fiches.length, 'fiche', 'fiches')}, ${plural(plan.equipes.length, 'équipe', 'équipes')}, `
        + `${plural(plan.sites.length, 'site', 'sites')}, ${plural(plan.projets.length, 'projet', 'projets')}`,
      payload: {
        fiches: plan.fiches.length, equipes: plan.equipes.length, sites: plan.sites, rattachements: plan.rattachements.length, comptes: plan.comptes,
        certifications: plan.certifications, projets: plan.projets.length, affectations: plan.affectations, entite: plan.entite,
      },
    });
    return plan;
  });
}

/** Lignes de l'aperçu ou du bilan, pour le terminal. */
export function textePlan(p: PlanCommun, fait: boolean): string[] {
  if (planVide(p)) return ['Référentiel commun déjà présent : rien à ajouter.'];
  const ids = p.fiches.length ? ` (${matricule(p.fiches[0])} à ${matricule(p.fiches.at(-1)!)})` : '';
  const accord = (fem: boolean) => (fait ? `ajouté${fem ? 'e' : ''}s` : 'à ajouter');
  return [
    `Référentiel commun de démonstration ${fait ? 'ajouté' : 'à ajouter (rien n’a été écrit)'} :`,
    `  - sites ${accord(false)} : ${p.sites.join(', ') || 'aucun'}`,
    `  - entité complétée : ${p.entite ?? 'aucune'}`,
    `  - équipes existantes rattachées à un site et à une unité de Matrix : ${p.rattachements.join(', ') || 'aucune'}`,
    `  - équipes ${accord(true)} : ${p.equipes.join(', ') || 'aucune'}`,
    `  - fiches ${accord(true)} : ${p.fiches.length}${ids}`,
    `  - comptes de démonstration : ${p.comptes} ; certifications : ${p.certifications}`,
    `  - projets Keystone : ${p.projets.join(', ') || 'aucun'} ; affectations sur HLT-026 : ${p.affectations}`,
  ];
}

// — Purge (npm run purge-demo, server/src/purge-demo-execution.ts) —

/** Bilan du retrait : lignes supprimées et lignes gardées ajustées, par table (noms SQL). */
export interface RetraitCommun { supprimees: Record<string, number>; ajustees: Record<string, number> }

/** Postes déduits des intitulés du référentiel commun, absents du jeu de démonstration (supprimés quand plus rien ne les désigne). */
export async function postesCommuns(db: Db): Promise<string[]> {
  const jeu = new Set((await db.query<{ poste: string | null }>('SELECT poste FROM employes WHERE id <= ?', [SALARIES_DEMO.length])).map(e => (e.poste ?? '').trim().toLowerCase()));
  return [...new Set(PERSONNES_COMMUNES.map(p => p[2]))].filter(p => !jeu.has(p.toLowerCase()));
}

/**
 * Retrait de ce que l'ajout a posé hors des tables vidées par la purge, après la suppression des fiches, dans la
 * transaction de la purge : équipes ajoutées (rattachées d'abord), sites ajoutés, postes du référentiel commun qu'aucune
 * fiche ne désigne plus ; site et unité de Matrix posés sur les équipes gardées et site posé sur l'entité, remis à vide
 * quand ils valent encore ce que l'ajout y a mis (un rattachement refait par le service RH est gardé). `postes` : noms
 * relevés avant la suppression des fiches (`postesCommuns`).
 */
export async function retirerReferentielCommun(db: Db, postes: readonly string[]): Promise<RetraitCommun> {
  const supprimees: Record<string, number> = {}, ajustees: Record<string, number> = {};
  const compter = (o: Record<string, number>, t: string, n: number) => { if (n) o[t] = (o[t] ?? 0) + n; };
  for (const q of [...EQUIPES_COMMUNES].reverse()) {
    // Une équipe encore désignée (fiche gardée, équipe rattachée par le service RH) reste : la purge le signalerait.
    const membres = Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM employes WHERE equipe = ?', [q.nom]))!.n);
    const filles = Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM equipes WHERE parente = ?', [q.nom]))!.n);
    if (!membres && !filles) compter(supprimees, 'equipes', (await db.run('DELETE FROM equipes WHERE nom = ?', [q.nom])).changes);
  }
  for (const [nom, r] of Object.entries(UNITES_EQUIPES_DEMO)) {
    compter(ajustees, 'equipes', (await db.run('UPDATE equipes SET site_code = NULL, unite_code = NULL WHERE nom = ? AND site_code = ? AND unite_code = ?', [nom, r.siteCode, r.uniteCode])).changes);
  }
  const codes = SITES_COMMUNS.map(s => s.code), marques = codes.map(() => '?').join(', ');
  compter(ajustees, 'entites', (await db.run(`UPDATE entites SET site_code = NULL WHERE site_code IN (${marques})`, codes)).changes);
  compter(ajustees, 'equipes', (await db.run(`UPDATE equipes SET site_code = NULL WHERE site_code IN (${marques})`, codes)).changes);
  compter(supprimees, 'sites', (await db.run(`DELETE FROM sites WHERE code IN (${marques})`, codes)).changes);
  for (const p of postes) {
    compter(supprimees, 'postes', (await db.run('DELETE FROM postes WHERE nom = ? AND NOT EXISTS (SELECT 1 FROM employes WHERE poste_id = postes.id)', [p])).changes);
  }
  return { supprimees, ajustees };
}
