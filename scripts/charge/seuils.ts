// Seuils d'acceptation de l'essai de charge (lot 8, chantier E ; réponses de l'entreprise du 24 octobre 2026 : seuils
// proposés retenus, marge ×3 dans les contrôles automatiques). Une durée est en millisecondes ; `marge` multiplie les
// seuils de durée, jamais les invariants (sonde de santé jamais au-delà de 5 s, aucune erreur 5xx, verrou tenu moins
// de 15 s) : ceux-là valent sur toute machine, la CI comprise.

/** Mesures d'une route : nombre d'appels, quantiles, maximum, erreurs. */
export interface StatRoute { n: number; p50: number; p95: number; p99: number; max: number; e4xx: number; e5xx: number; e503: number; delais: number }

/** Relevés de la sonde (toutes les 500 ms) : santé, verrou, pool, mémoire. */
export interface StatSonde {
  sante: StatRoute;
  /** Plus longue attente du verrou d'écriture (pg_advisory_lock) vue sur le serveur, et nombre de sessions en attente au plus. */
  attenteVerrouMax: number;
  attentesMax: number;
  /** Plus longue tenue du verrou d'écriture par une même session. */
  tenueVerrouMax: number;
  /** Plus longue attente continue d'une connexion du pool, et nombre d'appels en attente au plus. */
  attentePoolMax: number;
  poolAttenteMax: number;
  /** Lectures stables en attente d'une place (server/src/db-pg.ts, `PlacesLecture`) au plus. */
  lecturesAttenteMax: number;
  /** Écritures de l'instance en attente de leur tour en mémoire (server/src/db-pg.ts, `FileEcritures`) au plus. */
  ecrituresAttenteMax: number;
  rssMax: number;
  tasMax: number;
}

export interface Verdict { critere: string; mesure: string; seuil: string; ok: boolean; invariant: boolean }

const ms = (v: number) => (v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

/**
 * Verdicts d'un essai : seuils des routes mesurées (absentes du scénario : non jugées) et de la sonde. `sans503` :
 * scénarios S1 à S3, où même un 503 de verrou est un échec.
 */
export function juger(routes: Record<string, StatRoute>, sonde: StatSonde, { marge = 1, sans503 = false } = {}): Verdict[] {
  const out: Verdict[] = [];
  const duree = (critere: string, mesure: number | undefined, seuil: number) => {
    if (mesure === undefined) return;
    out.push({ critere, mesure: ms(mesure), seuil: `< ${ms(seuil * marge)}`, ok: mesure < seuil * marge, invariant: false });
  };
  const invariant = (critere: string, ok: boolean, mesure: string, seuil: string) => out.push({ critere, mesure, seuil, ok, invariant: true });
  const r = (nom: string) => routes[nom];
  duree('/api/data p95 (collaborateur)', r('GET /api/data (collaborateur)')?.p95, 300);
  duree('/api/data p95 (manager)', r('GET /api/data (manager)')?.p95, 1000);
  duree('/api/data p95 (RH)', r('GET /api/data (rh)')?.p95, 2000);
  for (const a of ['temps.setCell', 'temps.addLine', 'temps.submit']) duree(`${a} p95`, r(`POST ${a}`)?.p95, 800);
  duree('validerLot de 30 feuilles au plus', r('POST temps.validerLot (≤ 30)')?.max, 10_000);
  duree('validerLot de 200 feuilles', r('POST temps.validerLot (200)')?.max, 60_000);
  duree('paie.lotGenerer', r('POST paie.lotGenerer')?.max, 15_000);
  duree('fichier d’import Sage', r('GET /api/paie/lots/:id/fichier')?.max, 5_000);
  duree('variables de paie', r('GET /api/paie/variables/:periode')?.max, 5_000);
  duree('CSV du journal (100 000 lignes)', r('GET /api/journal/csv')?.max, 20_000);
  duree('/api/health p99', sonde.sante.n ? sonde.sante.p99 : undefined, 2000);
  duree('attente d’une connexion du pool', sonde.attentePoolMax, 2000);
  duree('attente du verrou d’écriture', sonde.attenteVerrouMax, 10_000);
  out.push({ critere: 'mémoire du processus (RSS)', mesure: `${Math.round(sonde.rssMax / 1048576)} Mo`, seuil: `< ${1024 * marge} Mo`, ok: sonde.rssMax < 1024 * 1048576 * marge, invariant: false });
  // Invariants : jamais assouplis par la marge.
  invariant('/api/health jamais au-delà de 5 s', sonde.sante.max < 5000 && !sonde.sante.delais, `${ms(sonde.sante.max)}${sonde.sante.delais ? ` (${sonde.sante.delais} sans réponse)` : ''}`, '< 5 s');
  const e5xx = Object.values(routes).reduce((n, s) => n + s.e5xx - (sans503 ? 0 : s.e503), 0) + sonde.sante.e5xx;
  invariant(sans503 ? 'aucune erreur 5xx, 503 compris' : 'aucune erreur 5xx (hors 503 « occupé »)', e5xx === 0, String(e5xx), '0');
  invariant('verrou d’écriture tenu moins de 15 s', sonde.tenueVerrouMax < 15_000, ms(sonde.tenueVerrouMax), '< 15 s');
  return out;
}

/** Quantile `q` (0 à 1) d'une liste triée. */
export function quantile(tri: readonly number[], q: number): number {
  if (!tri.length) return 0;
  return tri[Math.min(tri.length - 1, Math.max(0, Math.ceil(q * tri.length) - 1))];
}

/** Statistiques d'une route à partir de ses durées et de ses erreurs. */
export function statistiques(durees: number[], erreurs: { e4xx: number; e5xx: number; e503: number; delais: number }): StatRoute {
  const tri = [...durees].sort((a, b) => a - b);
  return { n: tri.length, p50: quantile(tri, 0.5), p95: quantile(tri, 0.95), p99: quantile(tri, 0.99), max: tri.at(-1) ?? 0, ...erreurs };
}
