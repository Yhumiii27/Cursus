// Données personnelles d'un salarié (droit d'accès et portabilité, RGPD articles 15 et 20) : un fichier JSON
// lisible qui reprend toutes les tables qui le concernent — toute table du schéma qui porte `empId`, son
// compte et ses sessions de connexion, les messages envoyés à Keystone à son matricule, les équipes qu'il
// encadre — et, pour l'export fait par le service RH, le journal des actions le concernant.
// Jamais d'empreinte de mot de passe ni d'identifiant de session (secret du cookie). Chaque export est tracé.
//   GET /api/salaries/:id/donnees  service RH, droit « rh » (remise au salarié qui exerce son droit d'accès) :
//                                  le dossier complet porte des données de santé, qu'un profil restreint de
//                                  l'espace RH (référent HSE, paie, lecture seule) ne voit pas
//   GET /api/mes-donnees           le salarié connecté, pour lui-même (portail) : sans le journal, que le RH
//                                  remet sur demande (il cite d'autres personnes : auteurs, autres salariés)
import express, { type Request, type Response, type Router } from 'express';
import { matricule, plural } from '../../shared/format.ts';
import { dossierComplet, libelleAction } from '../../shared/journal.ts';
import { journaliser, type Compte } from './comptes.ts';
import { identite } from './connexion.ts';
import { jsonLu, TABLES, type Db, type TableName } from './db.ts';
import { exigerRh, fichierJoint, tracerRefus } from './journal.ts';
import { contenuLocal } from './pieces.ts';

type Ligne = Record<string, unknown>;

/** Titre de chaque section ; une table ajoutée plus tard au schéma avec `empId` est exportée sous son nom. */
const TITRES: Partial<Record<TableName, string>> = {
  certifications: 'Certifications', habTitres: 'Habilitations', visas: 'Visas', vaccinations: 'Vaccinations',
  inscriptions: 'Inscriptions en formation', participations: 'Résultats de formation', voyages: 'Déplacements',
  demandesKeystone: 'Demandes de déplacement reçues de Keystone', missions: 'Affectations sur chantier', taches: 'Tâches planifiées (Keystone)',
  feuilles: 'Feuilles de temps', absences: 'Absences et congés', cet: 'Compte épargne-temps', reports: 'Reports de congés payés',
  soldesReprise: 'Compteurs repris de l’ancien outil', entretiens: 'Entretiens professionnels', demandesCollab: 'Demandes et déclarations',
  comptes: 'Compte de connexion', verdictsKeystone: 'Verdicts Go / No Go transmis à Keystone', clotures: 'Clôtures des périodes de congés',
  mandats: 'Mandats au CSE', informationsCp: 'Informations sur les congés au retour d’un arrêt',
  soldesSortie: 'Solde des compteurs à la sortie', contratsHistorique: 'Historique du contrat',
  pieces: 'Pièces justificatives',
  deplacementsPaie: 'Déplacements transmis à la paie (jours, nuits, trajets)',
  avenantsForfait: 'Avenants de renonciation à des jours de repos (forfait jours)',
  fractionnements: 'Jours de fractionnement des congés payés',
  habDelivrances: 'Délivrances des habilitations (historique)', formationsSuivies: 'Formations suivies',
  effacements: 'Effacements à la fin des durées de conservation', jetonsAgenda: 'Abonnements à l’agenda personnel',
  attentesSession: 'Listes d’attente des sessions de formation',
  declarationsPasseport: 'Formations déclarées au Passeport de prévention',
  evaluationsFormation: 'Évaluations des formations suivies',
  // lot 11 — dossiers OPCO nominatifs (alternance, plus tard) : aucun aujourd'hui.
  dossiersOpco: 'Dossiers de prise en charge OPCO (alternance)',
  // lot 11 — notes de frais
  notesFrais: 'Notes de frais', lignesFrais: 'Dépenses des notes de frais', vehiculesPerso: 'Véhicules personnels déclarés (indemnités kilométriques)',
  avancesFrais: 'Avances sur frais',
  // lot 12 — C1 (forfait annuel en heures)
  cloturesForfaitHeures: 'Clôtures du forfait annuel en heures (régularisation de fin de période)',
};
/**
 * Colonnes jamais exportées : empreinte du mot de passe (secret) et du jeton d'agenda ; nom stocké et jeton d'envoi d'une pièce justificative
 * (repères internes), dont le contenu est joint à part (`contenu`, base64).
 */
const RETIREES: Partial<Record<TableName, string[]>> = { comptes: ['motDePasse'], pieces: ['fichier', 'jeton', 'deposeCompteId'], jetonsAgenda: ['empreinte'] };
/**
 * Colonnes retirées de l'export remis au salarié lui-même (sans journal) : elles nomment d'autres personnes, comme le
 * journal qu'il ne reçoit pas — auteur d'une ligne de l'historique des contrats, que son portail ne lui montre pas, et de
 * l'enregistrement d'une délivrance d'habilitation ou d'une formation suivie.
 */
const RETIREES_SALARIE: Partial<Record<TableName, string[]>> = {
  contratsHistorique: ['par', 'parId'], avenantsForfait: ['creePar', 'annulePar'], habDelivrances: ['auteur', 'auteurId'],
  formationsSuivies: ['auteur', 'auteurId'],
  // Administrateur RH qui a révoqué les abonnements à l'agenda, ou confirmé un effacement, et son motif (texte libre).
  jetonsAgenda: ['revoquePar'],
  effacements: ['par', 'motif'],
  // Liste d'attente (lot 7, t120) : membre du service RH qui l'y a placé ou l'en a retiré.
  attentesSession: ['par', 'issuePar'],
  // Passeport de prévention (lot 7, t066) : membre du service RH ou référent HSE qui a marqué la ligne déclarée.
  declarationsPasseport: ['auteur', 'auteurId'],
  // Évaluations des formations (lot 7, t121) : qui a saisi l'avis (service RH à la clôture, manager).
  evaluationsFormation: ['auteur', 'auteurId'],
  // lot 12 — C1 (forfait annuel en heures) : administrateur RH qui a confirmé, rouvert ou annulé la clôture.
  cloturesForfaitHeures: ['confirmeePar', 'rouvertePar', 'annuleePar'],
};

/**
 * Lignes retirées de l'export remis au salarié lui-même : avis à froid de son manager sur ses formations (lot 7, t121),
 * que ni son espace ni l'instantané ne lui montrent — le manager remplit son évaluation avec cette promesse, et seul le
 * service RH lit les commentaires. L'export fait par le service RH (droit d'accès) les garde.
 */
const LIGNES_SALARIE: Partial<Record<TableName, (r: Ligne) => boolean>> = {
  evaluationsFormation: r => r.repondant === 'salarie',
};

/** Tables du schéma qui portent la colonne `empId` (la fiche elle-même est la section « Fiche »). */
export const TABLES_SALARIE = (Object.entries(TABLES) as [TableName, { cols: Record<string, string> }][])
  .filter(([nom, def]) => 'empId' in def.cols && nom !== 'employes').map(([nom]) => nom);

const sans = (r: Ligne, cols: string[] = []) => Object.fromEntries(Object.entries(r).filter(([k]) => !cols.includes(k)));

/** Contenu de l'export ; null si le salarié n'existe pas. `journal` : actions le concernant (export RH). */
export async function donneesSalarie(db: Db, empId: number, o: { journal: boolean; par: string }) {
  const e = await db.get<Ligne>('employes', empId);
  if (!e) return null;
  const sections: Record<string, unknown> = { Fiche: e };
  for (const t of TABLES_SALARIE) {
    const retirees = [...(RETIREES[t] ?? []), ...(o.journal ? [] : RETIREES_SALARIE[t] ?? [])];
    const garder = o.journal ? undefined : LIGNES_SALARIE[t];
    sections[TITRES[t] ?? t] = (await db.where<Ligne>(t, 'empId', empId)).filter(r => !garder || garder(r)).map(r => sans(r, retirees));
  }
  // Pièces justificatives en vigueur : leur contenu est joint (copie du document), en base64 (server/src/pieces.ts).
  sections[TITRES.pieces!] = [];
  for (const r of await db.where<Ligne>('pieces', 'empId', empId)) {
    const octets = !r.retireeLe && typeof r.fichier === 'string' ? await contenuLocal(db, r.fichier) : null;
    (sections[TITRES.pieces!] as unknown[]).push({ ...sans(r, RETIREES.pieces), ...(octets ? { contenu: octets.toString('base64') } : {}) });
  }
  const comptes = (await db.where<Compte>('comptes', 'empId', empId)).map(c => c.id);
  const dans = comptes.map(() => '?').join(', ');
  // Sessions de connexion : dates, espace, mode ; l'identifiant (secret du cookie) n'est jamais exporté.
  sections['Sessions de connexion'] = comptes.length
    ? await db.query(`SELECT role AS espace, methode, creation, expiration, revocation, activite FROM connexions WHERE compte_id IN (${dans}) ORDER BY creation`, [...comptes])
    : [];
  sections['Équipes encadrées'] = (await db.where<Ligne>('equipes', 'managerId', empId)).map(q => q.nom);
  // Délégations des validations (t135) données ou reçues : dates, périmètre, autre personne, révocation (sans auteur).
  sections['Délégations des validations'] = (await db.all<Ligne>('delegations')).filter(g => g.managerId === empId || g.suppleantId === empId)
    .map(({ id, managerId, suppleantId, du, au, perimetre, revoqueeLe }) => ({ id, managerId, suppleantId, du, au, perimetre, revoqueeLe }));
  // Messages envoyés (ou simulés) à Keystone au matricule du salarié : heures, absences (période seule), verdicts, décisions.
  // Matricule Cursus, ou matricule de paie si le réglage « identifiant envoyé à Keystone » l'a retenu. Un matricule de paie
  // partagé avec une autre fiche (réembauche confirmée) ne désigne ce salarié que pour les messages émis pendant sa
  // présence (de son entrée à sa sortie) : jamais les heures, absences ou verdicts de l'autre fiche.
  const m = matricule(empId), paie = typeof e.matriculePaie === 'string' && e.matriculePaie ? e.matriculePaie : null;
  const partage = !!paie && (await db.where<Ligne>('employes', 'matriculePaie', paie)).some(x => x.id !== empId);
  const pendant = (creation: unknown) => !partage || (String(creation).slice(0, 10) >= String(e.entree) && (!e.fin || String(creation).slice(0, 10) <= String(e.fin)));
  sections['Messages envoyés à Keystone'] = (await db.query(`SELECT id, cible, type, statut, creation, envoi, ${db.jsonTexte('contenu')} AS contenu FROM envois WHERE ${db.jsonTexte('contenu')} LIKE ? OR ${db.jsonTexte('contenu')} LIKE ? ORDER BY id`, [`%"${m}"%`, paie ? `%"matricule":"${paie}"%` : `%"${m}"%`]) as Ligne[])
    .filter(r => String(r.contenu).includes(`"${m}"`) || pendant(r.creation))
    .map(r => ({ ...r, contenu: JSON.parse(String(r.contenu)) }));
  if (o.journal) {
    // Actions qui le concernent (sa fiche, ses absences…) et actions faites avec son compte (connexions comprises), archive paie comprise.
    const lignes = await db.query(`SELECT at, actor, role, action, message, identifiant, payload, archivee FROM journal
      WHERE ${db.contientEntier('journal.salaries')}${comptes.length ? ` OR compte_id IN (${dans})` : ''} ORDER BY id`, [empId, ...comptes]) as Ligne[];
    sections['Journal des actions le concernant'] = lignes.map(l => ({
      date: l.at, auteur: l.actor, identifiant: l.identifiant, espace: l.role, action: libelleAction(String(l.action)), code: l.action,
      message: l.message, detail: jsonLu(l.payload) ?? {}, ...(l.archivee ? { archiveeLe: l.archivee } : {}),
    }));
  }
  return {
    document: `Données personnelles de ${String(e.nom)} (${m}) conservées par Cursus`,
    cadre: 'Droit d’accès et portabilité (RGPD, articles 15 et 20) : copie de toutes les données qui concernent cette personne.',
    genereLe: new Date().toISOString(),
    par: o.par,
    salarie: { id: empId, matricule: m, matriculePaie: paie, nom: e.nom },
    ...(o.journal ? {} : { note: 'Le journal des actions vous concernant vous est remis sur demande par le service RH.' }),
    sections,
  };
}

const nomFichier = (empId: number) => `donnees-${matricule(empId)}-${new Date().toISOString().slice(0, 10)}.json`;
const compter = (s: Record<string, unknown>) => Object.values(s).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 1), 0);

export function routesDonnees(db: Db): Router {
  const r = express.Router();

  // Lecture hors du verrou d'écriture (`Db.lecture`), puis la trace dans sa propre courte transaction, écrite avant
  // l'envoi du fichier (lot 8, chantier E : la trace suit la lecture).
  r.get('/api/salaries/:id/donnees', async (req: Request, res: Response) => {
    const id = await exigerRh(db, req, res, 'Export des données d’un salarié', dossierComplet);
    if (!id) return;
    const empId = Number(req.params.id);
    const x = Number.isInteger(empId) ? await db.lecture(async () => await donneesSalarie(db, empId, { journal: true, par: id.user.nom })) : null;
    if (!x) return res.status(404).json({ error: 'Collaborateur introuvable' });
    await db.tx(async () => await journaliser(db, {
      actor: id.user.nom, role: id.user.role, action: 'salarie.export', compte: id.compte, salaries: [empId],
      message: `Export des données personnelles de ${String(x.salarie.nom)} (droit d’accès) — ${plural(compter(x.sections), 'élément', 'éléments')}`,
    }));
    fichierJoint(res, 'application/json; charset=utf-8', nomFichier(empId), JSON.stringify(x, null, 2));
  });

  r.get('/api/mes-donnees', async (req: Request, res: Response) => {
    const id = await identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    const empId = id.compte.empId;
    if (!empId || id.user.role === 'rh') {
      await db.tx(async () => await tracerRefus(db, id, 'Téléchargement de ses données', 'aucun dossier salarié dans cet espace'));
      return res.status(403).json({ error: 'Vos données se téléchargent depuis votre espace collaborateur' });
    }
    const x = (await db.lecture(async () => await donneesSalarie(db, empId, { journal: false, par: id.user.nom })))!;
    await db.tx(async () => await journaliser(db, {
      actor: id.user.nom, role: id.user.role, action: 'donnees.export', compte: id.compte, salaries: [empId],
      message: `Téléchargement de ses données personnelles — ${plural(compter(x.sections), 'élément', 'éléments')}`,
    }));
    fichierJoint(res, 'application/json; charset=utf-8', nomFichier(empId), JSON.stringify(x, null, 2));
  });

  return r;
}
