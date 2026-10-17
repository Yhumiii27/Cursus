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
import express, { type Router } from 'express';
import { matricule, plural } from '../../shared/format.ts';
import { dossierComplet, libelleAction } from '../../shared/journal.ts';
import { journaliser, type Compte } from './comptes.ts';
import { identite } from './connexion.ts';
import { TABLES, type Db, type TableName } from './db.ts';
import { exigerRh, fichierJoint, tracerRefus } from './journal.ts';

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
};
/** Colonnes jamais exportées : empreinte du mot de passe (secret). */
const RETIREES: Partial<Record<TableName, string[]>> = { comptes: ['motDePasse'] };

/** Tables du schéma qui portent la colonne `empId` (la fiche elle-même est la section « Fiche »). */
export const TABLES_SALARIE = (Object.entries(TABLES) as [TableName, { cols: Record<string, string> }][])
  .filter(([nom, def]) => 'empId' in def.cols && nom !== 'employes').map(([nom]) => nom);

const sans = (r: Ligne, cols: string[] = []) => Object.fromEntries(Object.entries(r).filter(([k]) => !cols.includes(k)));

/** Contenu de l'export ; null si le salarié n'existe pas. `journal` : actions le concernant (export RH). */
export function donneesSalarie(db: Db, empId: number, o: { journal: boolean; par: string }) {
  const e = db.get<Ligne>('employes', empId);
  if (!e) return null;
  const sections: Record<string, unknown> = { Fiche: e };
  for (const t of TABLES_SALARIE) sections[TITRES[t] ?? t] = db.where<Ligne>(t, 'empId', empId).map(r => sans(r, RETIREES[t]));
  const comptes = db.where<Compte>('comptes', 'empId', empId).map(c => c.id);
  const dans = comptes.map(() => '?').join(', ');
  // Sessions de connexion : dates, espace, mode ; l'identifiant (secret du cookie) n'est jamais exporté.
  sections['Sessions de connexion'] = comptes.length
    ? db.sql.prepare(`SELECT role AS espace, methode, creation, expiration, revocation, activite FROM connexions WHERE compte_id IN (${dans}) ORDER BY creation`).all(...comptes)
    : [];
  sections['Équipes encadrées'] = db.where<Ligne>('equipes', 'managerId', empId).map(q => q.nom);
  // Messages envoyés (ou simulés) à Keystone au matricule du salarié : heures, absences (période seule), verdicts, décisions.
  // Matricule Cursus, ou matricule de paie si le réglage « identifiant envoyé à Keystone » l'a retenu. Un matricule de paie
  // partagé avec une autre fiche (réembauche confirmée) ne désigne ce salarié que pour les messages émis pendant sa
  // présence (de son entrée à sa sortie) : jamais les heures, absences ou verdicts de l'autre fiche.
  const m = matricule(empId), paie = typeof e.matriculePaie === 'string' && e.matriculePaie ? e.matriculePaie : null;
  const partage = !!paie && db.where<Ligne>('employes', 'matriculePaie', paie).some(x => x.id !== empId);
  const pendant = (creation: unknown) => !partage || (String(creation).slice(0, 10) >= String(e.entree) && (!e.fin || String(creation).slice(0, 10) <= String(e.fin)));
  sections['Messages envoyés à Keystone'] = (db.sql.prepare(`SELECT id, cible, type, statut, creation, envoi, contenu FROM envois WHERE contenu LIKE ? OR contenu LIKE ? ORDER BY id`)
    .all(`%"${m}"%`, paie ? `%"matricule":"${paie}"%` : `%"${m}"%`) as Ligne[])
    .filter(r => String(r.contenu).includes(`"${m}"`) || pendant(r.creation))
    .map(r => ({ ...r, contenu: JSON.parse(String(r.contenu)) }));
  if (o.journal) {
    // Actions qui le concernent (sa fiche, ses absences…) et actions faites avec son compte (connexions comprises), archive paie comprise.
    const lignes = db.sql.prepare(`SELECT at, actor, role, action, message, identifiant, payload, archivee FROM journal
      WHERE EXISTS (SELECT 1 FROM json_each(journal.salaries) WHERE value = ?)${comptes.length ? ` OR compte_id IN (${dans})` : ''} ORDER BY id`).all(empId, ...comptes) as Ligne[];
    sections['Journal des actions le concernant'] = lignes.map(l => ({
      date: l.at, auteur: l.actor, identifiant: l.identifiant, espace: l.role, action: libelleAction(String(l.action)), code: l.action,
      message: l.message, detail: JSON.parse(String(l.payload ?? '{}')), ...(l.archivee ? { archiveeLe: l.archivee } : {}),
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

  r.get('/api/salaries/:id/donnees', (req, res) => {
    const id = exigerRh(db, req, res, 'Export des données d’un salarié', dossierComplet);
    if (!id) return;
    const empId = Number(req.params.id);
    const x = Number.isInteger(empId) ? donneesSalarie(db, empId, { journal: true, par: id.user.nom }) : null;
    if (!x) return res.status(404).json({ error: 'Collaborateur introuvable' });
    journaliser(db, {
      actor: id.user.nom, role: id.user.role, action: 'salarie.export', compte: id.compte, salaries: [empId],
      message: `Export des données personnelles de ${String(x.salarie.nom)} (droit d’accès) — ${plural(compter(x.sections), 'élément', 'éléments')}`,
    });
    fichierJoint(res, 'application/json; charset=utf-8', nomFichier(empId), JSON.stringify(x, null, 2));
  });

  r.get('/api/mes-donnees', (req, res) => {
    const id = identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    const empId = id.compte.empId;
    if (!empId || id.user.role === 'rh') {
      tracerRefus(db, id, 'Téléchargement de ses données', 'aucun dossier salarié dans cet espace');
      return res.status(403).json({ error: 'Vos données se téléchargent depuis votre espace collaborateur' });
    }
    const x = donneesSalarie(db, empId, { journal: false, par: id.user.nom })!;
    journaliser(db, {
      actor: id.user.nom, role: id.user.role, action: 'donnees.export', compte: id.compte, salaries: [empId],
      message: `Téléchargement de ses données personnelles — ${plural(compter(x.sections), 'élément', 'éléments')}`,
    });
    fichierJoint(res, 'application/json; charset=utf-8', nomFichier(empId), JSON.stringify(x, null, 2));
  });

  return r;
}
