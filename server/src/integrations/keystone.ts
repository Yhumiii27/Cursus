// Adaptateur Keystone (gestion de projets / chantiers).
// Mode simulation : les messages sortants sont tracés dans le journal au lieu
// d'être envoyés. Pour brancher la vraie API, implémenter `send` (URL et jeton
// via KEYSTONE_URL / KEYSTONE_TOKEN) — les écrans et actions restent inchangés.
import { createHash, timingSafeEqual } from 'node:crypto';
import { demoActive, KEYSTONE_CLE_DEMO } from '../config.ts';
import type { Db } from '../db.ts';

export type KeystoneEvent =
  | { type: 'demande.decision'; demandeId: number; matricule: string; chantier: string; decision: 'acceptee' | 'refusee' }
  | { type: 'heures.validees'; matricule: string; semaine: string; projets: Record<string, number> }
  | { type: 'absence.validee'; matricule: string; du: string; au: string; nature: string }
  // Absence annulée : la période redevient disponible. `nature` : code générique, comme pour absence.validee.
  | { type: 'absence.annulee'; matricule: string; du: string; au: string; nature: string }
  | { type: 'verdict.modifie'; chantier: string; statut: string; ressource?: { matricule: string; statut: string; motifs: string[] } };

export const KEYSTONE_MODE = process.env.KEYSTONE_URL ? 'api' : 'simulation';

export function sendToKeystone(db: Db, event: KeystoneEvent) {
  if (KEYSTONE_MODE === 'api') {
    // Point d'extension : POST `${process.env.KEYSTONE_URL}/events` avec le jeton KEYSTONE_TOKEN.
    // Laissé volontairement non implémenté tant que le contrat d'API n'est pas fourni.
  }
  db.insert('journal', { at: new Date().toISOString(), actor: 'Cursus', role: 'integration', action: `keystone.${event.type}`, message: 'Message Keystone (simulation)', payload: event });
}

/**
 * Clé attendue des appels entrants de Keystone (en-tête X-Api-Key). Sans KEYSTONE_API_KEY,
 * la clé de démonstration n'est acceptée qu'en mode démonstration ; ailleurs, l'intégration
 * n'est pas configurée (null : les routes répondent 503).
 */
export const KEYSTONE_API_KEY: string | null = process.env.KEYSTONE_API_KEY || (demoActive() ? KEYSTONE_CLE_DEMO : null);

const empreinte = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** Comparaison en temps constant (empreintes de même longueur, quelle que soit la clé reçue). */
export function keystoneKeyOk(given: string | undefined): boolean {
  if (!KEYSTONE_API_KEY || !given) return false;
  return timingSafeEqual(empreinte(given), empreinte(KEYSTONE_API_KEY));
}
