// npm run comptes -- admin <identifiant> [--local] [--nom "Prénom Nom"] [--adresse <e-mail>] [--salarie <n°>]
// Crée le premier administrateur RH d'une installation vide. Sur un compte existant, rétablit l'accès
// (profil administrateur RH, compte réactivé et débloqué, nouveau mot de passe provisoire pour un compte
// local, rattachement Microsoft retiré pour un compte Microsoft dont l'identité a été recréée) : recours
// du service informatique quand plus aucun administrateur ne peut se connecter.
// Sans --salarie, le compte est externe (aucune fiche salarié) : nom et adresse lui sont propres. Avec --salarie, un
// compte externe existant est rattaché à la fiche saisie depuis (le premier administrateur, créé avant les fiches).
// Image Docker : volume rendu au compte du service, droits root abandonnés (avant tout autre import).
import './conteneur.ts';
import { normaliserIdentifiant } from '../../shared/rules/comptes.ts';
import { ActionError } from './actions/context.ts';
import { revokeSessionsDuCompte } from './auth.ts';
import { attribuerProvisoire, compteParIdentifiant, creerCompte, journaliser, nomDuCompte, rattacherCompte, refusDuCompte, type Compte } from './comptes.ts';
import { dbFile, openDb, urlPostgres } from './db.ts';
import { mettreAJourBase } from './demarrage.ts';
import { adresseDuCompte } from './messagerie.ts';
import { controlerPourOutil } from './migrations/cadre.ts';

const USAGE = `Usage : npm run comptes -- admin <identifiant> [--local] [--nom "Prénom Nom"] [--adresse <e-mail>] [--salarie <n°>]
  <identifiant>  adresse Microsoft 365 de la personne, ou identifiant d'un compte Cursus avec --local
  --local        compte propre à Cursus : un mot de passe provisoire est affiché, à changer à la première connexion
  --nom          nom affiché (compte externe ; déduit de l'identifiant par défaut)
  --adresse      adresse e-mail (compte externe ; l'identifiant s'il en est une)
  --salarie      numéro de la fiche du salarié (12 ou EMP-0012) : le compte lui est rattaché (compte externe existant compris)`;

function arreter(message: string): never {
  console.error(message);
  process.exit(1);
}

const [commande, identifiantBrut, ...reste] = process.argv.slice(2);
if (commande !== 'admin' || !identifiantBrut || identifiantBrut.startsWith('--')) arreter(USAGE);
const options: Record<string, string | true> = {};
for (let i = 0; i < reste.length; i++) {
  const o = reste[i];
  if (o === '--local') options.local = true;
  else if (['--nom', '--adresse', '--salarie'].includes(o) && reste[i + 1] !== undefined) options[o.slice(2)] = reste[++i];
  else arreter(`Option inconnue ou incomplète : ${o}\n${USAGE}`);
}

const identifiant = normaliserIdentifiant(identifiantBrut);
/** « rachel.martin@… » → « Rachel Martin ». */
const nomDeduit = identifiant.split('@')[0].split(/[._-]+/).filter(Boolean).map(m => m[0].toUpperCase() + m.slice(1)).join(' ');
const AUTEUR = 'Ligne de commande (npm run comptes)';

const empId = typeof options.salarie === 'string' ? Number(options.salarie.replace(/\D/g, '')) : null;
if (options.salarie !== undefined && !empId) arreter('Numéro de salarié invalide (--salarie 12 ou --salarie EMP-0012).');

// Fichier SQLite : base mise à jour par une version plus récente de Cursus, ou pas encore par le serveur en service :
// refusée. Serveur PostgreSQL (DATABASE_URL) : openDb applique les migrations et contrôle le schéma, sous verrou.
const serveurPg = urlPostgres();
let aMettreAJour = true;
try {
  if (!serveurPg) aMettreAJour = controlerPourOutil(dbFile());
} catch (err) {
  arreter(`Commande impossible : ${err instanceof Error ? err.message : err}`);
}
let db: Awaited<ReturnType<typeof openDb>>;
try {
  db = await openDb();
} catch (err) {
  arreter(`Commande impossible : ${err instanceof Error ? err.message : err}`);
}
// Service arrêté : base mise à jour comme au démarrage du serveur (reprises, migrations nommées) avant d'y écrire ;
// le compte n'est jamais écrit dans une colonne qu'une migration reprendrait ensuite.
if (aMettreAJour) {
  try {
    await mettreAJourBase(db);
  } catch (err) {
    await db.fermer();
    arreter(`Commande impossible : ${err instanceof Error ? err.message : err}`);
  }
}
let existant: Compte | undefined;
try {
  existant = await compteParIdentifiant(db, identifiant);
  let compte: Compte, motDePasse: string | null = null, message: string;
  if (existant) {
    // Un membre du service RH salarié porte son profil sur le compte rattaché à sa fiche (décisions sur soi-même).
    const rattache = !!empId && existant.empId !== empId;
    if (rattache) await rattacherCompte(db, existant, empId);
    await db.update<Compte>('comptes', existant.id, { profilRh: 'rh_admin', actif: true, echecs: 0, blocageFin: null });
    compte = (await db.get<Compte>('comptes', existant.id))!;
    if (compte.type === 'local') {
      motDePasse = await attribuerProvisoire(db, compte);
      await revokeSessionsDuCompte(db, compte.id);
    } else if (compte.oid) {
      // La prochaine connexion Microsoft avec cette adresse rattache de nouveau le compte (identité recréée).
      await db.update<Compte>('comptes', compte.id, { oid: null });
      await revokeSessionsDuCompte(db, compte.id);
    }
    message = `Accès administrateur RH rétabli : ${await nomDuCompte(db, compte)} (${compte.identifiant}${rattache ? ', rattaché à sa fiche salarié' : ''})`;
  } else {
    const adresse = typeof options.adresse === 'string' ? options.adresse : identifiant.includes('@') ? identifiant : '';
    if (!empId && !adresse) arreter('Compte externe : précisez son adresse e-mail (--adresse prenom.nom@entreprise.fr).');
    const r = await creerCompte(db, {
      empId, nom: typeof options.nom === 'string' ? options.nom : nomDeduit, adresse, type: options.local ? 'local' : 'microsoft', identifiant, profilRh: 'rh_admin',
    }, AUTEUR);
    compte = r.compte;
    motDePasse = r.motDePasse;
    // Compte Microsoft 365 d'un salarié sans adresse e-mail : son identifiant devient l'adresse de sa fiche (comme compte.creer).
    const email = await adresseDuCompte(db, compte);
    message = `Administrateur RH créé : ${await nomDuCompte(db, compte)} (${compte.identifiant}, ${compte.type === 'local' ? 'compte Cursus' : 'Microsoft 365'})`
      + (email ? ` · adresse e-mail ${email} reprise sur la fiche` : '');
  }
  await journaliser(db, { actor: AUTEUR, role: null, action: 'compte.admin', message, payload: { identifiant }, compte });
  console.log(`${message}.`);
  const refus = await refusDuCompte(db, compte);
  if (refus) console.warn(`Attention — connexion impossible pour ce compte : ${refus}.`);
  if (motDePasse) {
    console.log(`Mot de passe provisoire (affiché une seule fois, à changer à la première connexion) : ${motDePasse}`);
  } else if (compte.type === 'microsoft') {
    console.log('Compte Microsoft 365 : connexion par « Se connecter avec Microsoft », rattachée à la première connexion (docs/CONNEXION-MICROSOFT.md).');
  }
  console.log(serveurPg ? 'Base : serveur PostgreSQL (DATABASE_URL), schéma cursus' : `Base : ${dbFile()}`);
} catch (err) {
  arreter(err instanceof ActionError ? `${existant ? 'Accès non rétabli' : 'Compte non créé'} : ${err.message}.` : `Erreur : ${err instanceof Error ? err.message : err}`);
} finally {
  await db.fermer();
}
