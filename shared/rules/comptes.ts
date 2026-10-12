// Comptes de connexion : identifiant, type de compte suggéré et contrôle du mot de passe,
// partagés par le dialogue de création (Paramètres → Comptes et accès) et le serveur.
import { MOT_DE_PASSE_MIN } from '../constants.ts';
import { norm } from '../format.ts';
import type { CompteType, Employe } from '../types.ts';

/** Identifiant tel qu'il est enregistré et comparé : sans espaces autour, en minuscules. */
export const normaliserIdentifiant = (s: string) => s.normalize('NFC').trim().toLowerCase();

const ADRESSE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const adresseValide = (s: string) => s.length <= 254 && ADRESSE.test(s);

/** Contrôle d'un identifiant déjà normalisé ; renvoie le message d'erreur, ou null. */
export function controleIdentifiant(type: CompteType, id: string): string | null {
  if (!id) return 'Identifiant requis';
  if (type === 'microsoft') return adresseValide(id) ? null : 'Un compte Microsoft 365 se désigne par son adresse (prenom.nom@entreprise.fr)';
  if (!/^[a-z0-9][a-z0-9._@-]{2,63}$/.test(id)) return 'Identifiant de 3 à 64 caractères : lettres sans accent, chiffres, point, tiret, @';
  return null;
}

/** Identifiant proposé pour une personne : « prenom.nom », suivi du domaine pour un compte Microsoft 365. */
export function identifiantSuggere(nom: string, type: CompteType, domaine = ''): string {
  const base = norm(nom).replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  return type === 'microsoft' && domaine ? `${base}@${domaine}` : base;
}

/**
 * Type de compte proposé : les ouvriers, intérimaires et alternants n'ont en général pas de compte
 * Microsoft 365 de l'entreprise, ils reçoivent un compte propre à Cursus.
 */
export function typeSuggere(e: Pick<Employe, 'statut' | 'typeContrat'>): CompteType {
  return e.statut === 'ouvrier' || e.typeContrat === 'interim' || e.typeContrat === 'alternance' ? 'local' : 'microsoft';
}

/** Contrôle d'un nouveau mot de passe ; renvoie le message d'erreur, ou null. */
export function controleMotDePasse(mdp: string, identifiant: string): string | null {
  if (mdp.length < MOT_DE_PASSE_MIN) return `Mot de passe trop court : ${MOT_DE_PASSE_MIN} caractères au moins`;
  if (mdp.length > 200) return 'Mot de passe trop long : 200 caractères au plus';
  if (normaliserIdentifiant(mdp).includes(identifiant)) return 'Le mot de passe ne doit pas contenir l’identifiant';
  return null;
}
