// Espace documentaire de l'entreprise : Codex (lot 16, décision du propriétaire du 10 novembre 2026 : tous les
// documents de la suite sont stockés dans Codex). Adaptateur du stockage des pièces justificatives (server/src/pieces.ts,
// `DepotPieces`) pour les pièces déjà versées dans Codex : nom stocké `ged:<identifiant Codex>`, relecture et destruction
// par le client de server/src/integrations/codex-documents.ts. Une nouvelle pièce n'est jamais écrite directement dans
// Codex : elle est d'abord gardée dans le dossier local, puis versée une fois jointe à son objet (catégorie, salarié et
// conservation connus), par server/src/pieces-codex.ts.
import type { MotifDestruction } from '../../../shared/rules/pieces-codex.ts';
import type { DepotPieces } from '../pieces.ts';
import { type ClientCodex, clientCodex } from './codex-documents.ts';

/** Préfixe des noms stockés dans la GED (le dossier local n'a que des noms hexadécimaux). */
export const PREFIXE_GED = 'ged:';
export const estFichierGed = (fichier: string) => fichier.startsWith(PREFIXE_GED);
export const nomGed = (id: string) => `${PREFIXE_GED}${id}`;
const idGed = (fichier: string) => {
  if (!estFichierGed(fichier) || fichier.length === PREFIXE_GED.length) throw new Error(`Nom de pièce de la GED invalide : ${fichier}`);
  return fichier.slice(PREFIXE_GED.length);
};

export const GED_NON_RACCORDEE = 'Codex (espace documentaire) n’est pas raccordé à Cursus : CODEX_URL, CODEX_DOCUMENTS_TOKEN ou CODEX_DOCUMENTS_SECRET, et CODEX_DOCUMENTS_OWNER sont à définir';

/** Pièces versées dans Codex : relues et détruites par son API ; chaque appel est refusé sans raccordement configuré. */
export class DepotGed implements DepotPieces {
  readonly mode = 'ged' as const;
  private readonly client: ClientCodex | null;
  constructor(client: ClientCodex | null = clientCodex()) { this.client = client; }
  private c(): ClientCodex {
    if (!this.client) throw new Error(GED_NON_RACCORDEE);
    return this.client;
  }
  /** Jamais appelé : une pièce passe par le dossier local avant son versement (server/src/pieces-codex.ts). */
  async ecrire(_octets: Buffer): Promise<string> {
    throw new Error('Une pièce est versée dans Codex une fois jointe à son objet, jamais à son envoi');
  }
  async lire(fichier: string): Promise<Buffer | null> {
    return await this.c().lire(idGed(fichier));
  }
  async supprimer(fichier: string, motif: MotifDestruction = 'retrait'): Promise<void> {
    await this.c().detruire(idGed(fichier), motif);
  }
}
