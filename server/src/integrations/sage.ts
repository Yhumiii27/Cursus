// Adaptateur Sage Paie : transmission des variables de paie hebdomadaires.
// Mode simulation : renvoie un accusé de réception fictif. Pour la production,
// implémenter l'appel HTTP (SAGE_URL / SAGE_TOKEN) et la correspondance des
// rubriques avec le plan de paie (HN, HS25, HS50, HC10, HC25, RCR_ACQUIS, JTRAV).
import type { SagePush } from '../../../shared/types.ts';

export const SAGE_MODE = process.env.SAGE_URL ? 'api' : 'simulation';
export const SAGE_DOSSIER = process.env.SAGE_DOSSIER || 'CURSUS-CHIMIE';

export function pushToSage(payload: SagePush): { ok: boolean; accuse: string } {
  if (SAGE_MODE === 'api') {
    // Point d'extension : POST `${process.env.SAGE_URL}/variables` avec le jeton SAGE_TOKEN.
  }
  return { ok: true, accuse: `SIM-${payload.periode_paie}-${payload.lignes.length}` };
}
