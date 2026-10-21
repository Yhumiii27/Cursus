// Espace documentaire de l'entreprise (GED développée avec Codex) : adaptateur du stockage des pièces justificatives
// (server/src/pieces.ts, `DepotPieces`). Réponse de l'entreprise : les pièces seront conservées dans cet espace, dont les
// rôles devront être adaptés ; son interface, ses rôles et sa date de mise en service ne sont pas encore connus. Ce
// squelette fixe le contrat : un nom stocké `ged:<référence du document>`, les mêmes appels que le dossier local. Tant
// qu'il n'est pas écrit, le réglage « GED » est refusé (shared/reglages.ts) et aucun document n'y est envoyé.
// À écrire quand l'API sera connue : authentification (compte de service, jamais celui de la personne connectée),
// classement par salarié et par objet, durée de conservation transmise, reprise des pièces du dossier local.
import type { DepotPieces } from '../pieces.ts';

/** Préfixe des noms stockés dans la GED (le dossier local n'a que des noms hexadécimaux). */
export const PREFIXE_GED = 'ged:';
export const estFichierGed = (fichier: string) => fichier.startsWith(PREFIXE_GED);

export const GED_NON_RACCORDEE = 'Espace documentaire (GED) pas encore raccordé à Cursus : son interface n’est pas connue';

/** Adaptateur de la GED : chaque appel est refusé tant que son interface n'est pas connue. */
export class DepotGed implements DepotPieces {
  readonly mode = 'ged' as const;
  async ecrire(_octets: Buffer): Promise<string> { throw new Error(GED_NON_RACCORDEE); }
  async lire(_fichier: string): Promise<Buffer | null> { throw new Error(GED_NON_RACCORDEE); }
  async supprimer(_fichier: string): Promise<void> { throw new Error(GED_NON_RACCORDEE); }
}
