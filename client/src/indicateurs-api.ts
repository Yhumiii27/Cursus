// lot 11 — indicateurs (t197) : lecture des indicateurs sociaux et de leur export, calculés et masqués par le serveur
// (server/src/indicateurs.ts : GET /api/indicateurs et /api/indicateurs/csv). Les deux adresses sont gardées contre une
// navigation provoquée depuis un autre site (`exigerNavigationInterne('appel')`) : l'appel porte l'en-tête d'espace,
// qu'aucun lien ne peut poser. L'export est tracé par le serveur (`indicateurs.export` : période, groupement, nombre de
// lignes, jamais une valeur) ; il n'est donc pas signalé par `api.signalerExport`.
// Fichier à part de client/src/api.ts (propriétaire unique : chantier C2) ; mêmes messages et même délai de lecture.
import type { GroupeIndicateurs, IndicateursLegaux } from '../../shared/rules/indicateurs-legaux.ts';
import type { Role } from '../../shared/types.ts';
import { DELAI_LECTURE_MS, messageHttp, MSG_DELAI, MSG_RESEAU, type ApiError } from './api.ts';

/** Arrêté servi avec les agrégats figés (null : calcul de la période). */
export interface ArreteServi { id: number; annee: number; arreteLe: string; cseLe: string | null; annule: boolean }
export type ReponseIndicateurs = IndicateursLegaux & { arrete: ArreteServi | null };

/** Requête : année civile calculée, ou arrêté figé ; groupement. */
export type RequeteIndicateurs = { annee: number; groupe: GroupeIndicateurs } | { arrete: number; groupe: GroupeIndicateurs };

/** Paramètres d'adresse d'une requête (période : l'année civile, seule admise par le serveur). */
export function requeteIndicateurs(q: RequeteIndicateurs): string {
  const p = new URLSearchParams('arrete' in q ? { arrete: String(q.arrete) } : { annee: String(q.annee), periode: 'annee' });
  p.set('groupe', q.groupe);
  return `?${p}`;
}

const erreur = (message: string, status: number): ApiError => Object.assign(new Error(message), { status });

async function appeler(url: string, espace: Role): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin', headers: { 'x-cursus-espace': espace }, signal: AbortSignal.timeout(DELAI_LECTURE_MS) });
  } catch (err) {
    throw erreur((err as { name?: string } | null)?.name === 'TimeoutError' ? MSG_DELAI : MSG_RESEAU, 0);
  }
  if (!res.ok) {
    const json = await res.json().catch(() => ({})) as { error?: string };
    throw erreur(json.error || messageHttp(res.status), res.status);
  }
  return res;
}

/** Indicateurs de l'année (ou d'un arrêté), déjà masqués au seuil d'anonymat. */
export async function lireIndicateurs(q: RequeteIndicateurs, espace: Role): Promise<ReponseIndicateurs> {
  return await (await appeler(`/api/indicateurs${requeteIndicateurs(q)}`, espace)).json() as ReponseIndicateurs;
}

/** Export CSV au format long (produit et tracé par le serveur), enregistré sous le nom qu'il donne ; rend ce nom. */
export async function exporterIndicateurs(q: RequeteIndicateurs, espace: Role): Promise<string> {
  return await enregistrer(await appeler(`/api/indicateurs/csv${requeteIndicateurs(q)}`, espace), 'indicateurs.csv');
}

/**
 * Export de la BDESE de l'année N (onglet BDESE) : N-2, N-1 et N, chacune d'après son arrêté en vigueur s'il existe, et
 * les groupements de la BDESE (ensemble, sexe, catégorie, contrat), en un fichier produit et tracé par le serveur.
 */
export async function exporterBdese(annee: number, espace: Role): Promise<string> {
  return await enregistrer(await appeler(`/api/indicateurs/bdese/csv?annee=${annee}`, espace), 'bdese.csv');
}

/** Enregistre le fichier d'une réponse sous le nom qu'elle donne ; rend ce nom. */
async function enregistrer(res: Response, defaut: string): Promise<string> {
  const nom = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? defaut;
  const href = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href, download: nom });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return nom;
}
