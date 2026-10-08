// Adaptateur Keystone (gestion de projets / chantiers).
// Mode simulation : les messages sortants sont tracés dans le journal au lieu
// d'être envoyés. Pour brancher la vraie API, implémenter `send` (URL et jeton
// via KEYSTONE_URL / KEYSTONE_TOKEN) — les écrans et actions restent inchangés.
import type { Db } from '../db.ts';

export type KeystoneEvent =
  | { type: 'demande.decision'; demandeId: number; matricule: string; chantier: string; decision: 'acceptee' | 'refusee' }
  | { type: 'heures.validees'; matricule: string; semaine: string; projets: Record<string, number> }
  | { type: 'absence.validee'; matricule: string; du: string; au: string; nature: string }
  | { type: 'verdict.modifie'; chantier: string; statut: string };

export const KEYSTONE_MODE = process.env.KEYSTONE_URL ? 'api' : 'simulation';

export function sendToKeystone(db: Db, event: KeystoneEvent) {
  if (KEYSTONE_MODE === 'api') {
    // Point d'extension : POST `${process.env.KEYSTONE_URL}/events` avec le jeton KEYSTONE_TOKEN.
    // Laissé volontairement non implémenté tant que le contrat d'API n'est pas fourni.
  }
  db.insert('journal', { at: new Date().toISOString(), actor: 'Cursus', role: 'integration', action: `keystone.${event.type}`, message: 'Message Keystone (simulation)', payload: event });
}

/** Clé attendue des appels entrants de Keystone (en-tête X-Api-Key). */
export const KEYSTONE_API_KEY = process.env.KEYSTONE_API_KEY || 'demo-keystone';
