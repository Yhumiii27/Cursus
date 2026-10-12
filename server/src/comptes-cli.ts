// npm run comptes -- admin <identifiant> [--local] [--nom "Prénom Nom"] [--adresse <e-mail>] [--salarie <n°>]
// Crée le premier administrateur RH d'une installation vide. Sur un compte existant, rétablit l'accès
// (profil administrateur RH, compte réactivé et débloqué, nouveau mot de passe provisoire pour un compte
// local, rattachement Microsoft retiré pour un compte Microsoft dont l'identité a été recréée) : recours
// du service informatique quand plus aucun administrateur ne peut se connecter.
// Sans --salarie, le compte est externe (aucune fiche salarié) : nom et adresse lui sont propres. Avec --salarie, un
// compte externe existant est rattaché à la fiche saisie depuis (le premier administrateur, créé avant les fiches).
import { normaliserIdentifiant } from '../../shared/rules/comptes.ts';
import { ActionError } from './actions/context.ts';
import { revokeSessionsDuCompte } from './auth.ts';
import { attribuerProvisoire, compteParIdentifiant, creerCompte, journaliser, nomDuCompte, rattacherCompte, refusDuCompte, type Compte } from './comptes.ts';
import { dbFile, openDb } from './db.ts';

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

const db = openDb();
let existant: Compte | undefined;
try {
  existant = compteParIdentifiant(db, identifiant);
  let compte: Compte, motDePasse: string | null = null, message: string;
  if (existant) {
    // Un membre du service RH salarié porte son profil sur le compte rattaché à sa fiche (décisions sur soi-même).
    const rattache = !!empId && existant.empId !== empId;
    if (rattache) rattacherCompte(db, existant, empId);
    db.update<Compte>('comptes', existant.id, { profilRh: 'rh_admin', actif: true, echecs: 0, blocageFin: null });
    compte = db.get<Compte>('comptes', existant.id)!;
    if (compte.type === 'local') {
      motDePasse = attribuerProvisoire(db, compte);
      revokeSessionsDuCompte(db, compte.id);
    } else if (compte.oid) {
      // La prochaine connexion Microsoft avec cette adresse rattache de nouveau le compte (identité recréée).
      db.update<Compte>('comptes', compte.id, { oid: null });
      revokeSessionsDuCompte(db, compte.id);
    }
    message = `Accès administrateur RH rétabli : ${nomDuCompte(db, compte)} (${compte.identifiant}${rattache ? ', rattaché à sa fiche salarié' : ''})`;
  } else {
    const adresse = typeof options.adresse === 'string' ? options.adresse : identifiant.includes('@') ? identifiant : '';
    if (!empId && !adresse) arreter('Compte externe : précisez son adresse e-mail (--adresse prenom.nom@entreprise.fr).');
    const r = creerCompte(db, {
      empId, nom: typeof options.nom === 'string' ? options.nom : nomDeduit, adresse, type: options.local ? 'local' : 'microsoft', identifiant, profilRh: 'rh_admin',
    }, AUTEUR);
    compte = r.compte;
    motDePasse = r.motDePasse;
    message = `Administrateur RH créé : ${nomDuCompte(db, compte)} (${compte.identifiant}, ${compte.type === 'local' ? 'compte Cursus' : 'Microsoft 365'})`;
  }
  journaliser(db, { actor: AUTEUR, role: null, action: 'compte.admin', message, payload: { identifiant }, compte });
  console.log(`${message}.`);
  const refus = refusDuCompte(db, compte);
  if (refus) console.warn(`Attention — connexion impossible pour ce compte : ${refus}.`);
  if (motDePasse) {
    console.log(`Mot de passe provisoire (affiché une seule fois, à changer à la première connexion) : ${motDePasse}`);
  } else if (compte.type === 'microsoft') {
    console.log('Compte Microsoft 365 : connexion par « Se connecter avec Microsoft », rattachée à la première connexion (docs/CONNEXION-MICROSOFT.md).');
  }
  console.log(`Base : ${dbFile()}`);
} catch (err) {
  arreter(err instanceof ActionError ? `${existant ? 'Accès non rétabli' : 'Compte non créé'} : ${err.message}.` : `Erreur : ${err instanceof Error ? err.message : err}`);
} finally {
  db.sql.close();
}
