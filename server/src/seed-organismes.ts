// Organismes de formation et e-learning du jeu de démonstration (lot 12, chantier C4), chargés par seedDemo
// (server/src/seed.ts) après les formations, les formations suivies et le plan : la reprise des textes libres
// (server/src/reprise-organismes.ts) crée les fiches comme sur une base existante, puis la démonstration en complète
// quelques-unes (Qualiopi valide, à renouveler, échu, sans date ; doublon à fusionner), avec un contact, un tarif, deux
// modules d'e-learning et trois inscriptions. Données fictives : SIRET et déclarations d'activité inventés (clé exacte),
// adresses en « .example ».
import type { Db } from './db.ts';
import { executerReprise } from './reprise-organismes.ts';

/** Fiche reprise complétée, désignée par son code (proposé par la reprise d'après le nom). */
const COMPLETEES: Record<string, Record<string, unknown>> = {
  APAVE: {
    raisonSociale: 'Apave Exploitation France', siret: '77568516000001', nda: '11755468475', ndaRegion: 'Île-de-France', qualiopi: true, qualiopiCategories: ['formation'],
    qualiopiCertificateur: 'Afnor Certification', qualiopiNumero: 'QUA-2024-1187', qualiopiValideJusquau: '2027-06-30', qualiopiVerifieLe: '2026-09-01', aVerifier: false,
    siteWeb: 'https://www.apave.example', subrogationAcceptee: true, delaiAnnulationJours: 10,
  },
  // Qualiopi à renouveler dans moins de 60 jours (relance à l'étape 2).
  AFTRAL: {
    siret: '44712345000002', nda: '11930567893', ndaRegion: 'Île-de-France', qualiopi: true, qualiopiCategories: ['formation', 'apprentissage'], qualiopiValideJusquau: '2026-11-30',
    qualiopiVerifieLe: '2026-06-15', aVerifier: false,
  },
  // Qualiopi échu : avertissement sur le plan et les dossiers OPCO.
  SOCOTEC: { siret: '32635123000007', qualiopi: true, qualiopiCategories: ['formation'], qualiopiValideJusquau: '2026-09-30' },
  'INTERNE-HSE': { aVerifier: false },
  'INTERNE-DSI': { aVerifier: false },
};

export async function organismesDemo(db: Db): Promise<void> {
  await executerReprise(db, { journal: false });
  for (const [code, champs] of Object.entries(COMPLETEES)) {
    const o = await db.one<{ id: number }>('SELECT id FROM organismes WHERE code = ?', [code]);
    if (o) await db.update('organismes', o.id, champs);
  }
  const id = async (code: string) => (await db.one<{ id: number }>('SELECT id FROM organismes WHERE code = ?', [code]))?.id ?? null;
  // Doublon d'une agence saisie sous un autre nom : à fusionner depuis l'écran « À vérifier ».
  await db.insert('organismes', {
    code: 'APAVE-SUD', raisonSociale: null, nomUsuel: 'APAVE Sud Europe', type: 'externe', siret: null, nda: null, ndaRegion: null, qualiopi: false, qualiopiCategories: [],
    qualiopiCertificateur: null, qualiopiNumero: null, qualiopiValideJusquau: null, qualiopiVerifieLe: null, adresse: null, siteWeb: null, subrogationAcceptee: false,
    delaiAnnulationJours: null, conditions: null, alias: ['APAVE Sud Europe', 'Apave sud'], aVerifier: true, source: 'reprise', archive: null, creeLe: '2026-10-01T08:00:00.000Z',
    creePar: 'Cursus (reprise)', fusionneDans: null, fusionneLe: null, fusionnePar: null, fusionneMotif: null,
  });
  const apave = await id('APAVE'), dsi = await id('INTERNE-DSI');
  await db.insert('organismeContacts', {
    organismeId: apave, nom: 'Julie Martin', fonction: 'Chargée de clientèle formation', email: 'julie.martin@apave.example', telephone: '01 23 45 67 89', role: 'commercial',
    principal: true, archive: null, creeLe: '2026-09-01T08:00:00.000Z', creePar: 'Sandrine Vidal',
  });
  await db.insert('organismeTarifs', {
    organismeId: apave, formation: 'elec', libelle: null, modalite: 'inter', unite: 'stagiaire', montantHt: 480, valableDu: '2026-01-01', valableAu: '2026-12-31', archive: null,
    creeLe: '2026-09-01T08:00:00.000Z', creePar: 'Sandrine Vidal',
  });
  const rgpd = await db.insert<{ id: number }>('modulesElearning', {
    code: 'RGPD-EL', intitule: 'Sensibilisation RGPD et sécurité de l’information (en ligne)', organismeId: dsi, formation: 'rgpd', url: 'https://formation.entreprise.example/rgpd',
    dureeHeures: 2, langue: 'fr', coutLicence: 0, accesMois: 12, attestationRequise: false, archive: null, creeLe: '2026-09-01T08:00:00.000Z', creePar: 'Sandrine Vidal',
  });
  const atex = await db.insert<{ id: number }>('modulesElearning', {
    code: 'ATEX-THEO', intitule: 'ATEX niveau 1 — partie théorique', organismeId: apave, formation: null, url: 'https://elearning.apave.example/atex-1', dureeHeures: 3.5,
    langue: 'fr', coutLicence: 45, accesMois: 6, attestationRequise: true, archive: null, creeLe: '2026-09-01T08:00:00.000Z', creePar: 'Sandrine Vidal',
  });
  const inscription = async (empId: number, moduleId: number, x: Record<string, unknown>) => await db.insert('inscriptionsElearning', {
    empId, moduleId, planActionId: null, inscritLe: '2026-09-15', inscritPar: 'Sandrine Vidal', echeance: '2026-11-30', statut: 'inscrit', avancement: null, avancementSource: null,
    avancementLe: null, declareLe: null, termineLe: null, heures: null, reussi: null, certId: null, suivieId: null, abandonLe: null, corrigeLe: null, corrigePar: null,
    corrigeMotif: null, annuleLe: null, annulePar: null, annuleMotif: null, ...x,
  });
  // Mehdi Benali : en cours (avancement importé) ; Thomas Garnier : fin déclarée, à valider ; un technicien inscrit au module ATEX.
  await inscription(2, rgpd.id, { statut: 'en_cours', avancement: 40, avancementSource: 'import', avancementLe: '2026-10-05' });
  await inscription(6, rgpd.id, { statut: 'en_cours', declareLe: '2026-10-08' });
  await inscription(3, atex.id, {});
}
