// Droits d'une personne connectée par Clavis, lus dans la base (décision du propriétaire, 23-24 novembre 2026 : une seule
// base pour tous les outils ; CURSUS_ACCES_CLAVIS=on). La vue clavis.pub_acces, définie par Matrix et lue avec le rôle de
// Cursus (cursus_app, lien accordé par Matrix), dit pour la personne et l'application « cursus » si l'accès s'ouvre
// (`ouvert`) et son profil RH (`role`, une clé de PROFILS_RH, réglée par la DSI dans Clavis). Lue à la connexion, puis
// au plus toutes les CURSUS_ACCES_CLAVIS_SECONDES (60 par défaut) pendant la session : un accès retiré ferme la session,
// un profil changé est reporté sur le compte. Une lecture impossible refuse (jamais d'accès par défaut).
// Les espaces manager et collaborateur viennent toujours de la fiche du salarié (équipes, délégations).
import { PROFILS_RH } from '../../shared/constants.ts';
import type { ProfilRh } from '../../shared/types.ts';
import { journaliser, type Compte } from './comptes.ts';
import type { Db } from './db.ts';

/** Profil RH de la ligne de clavis.pub_acces quand l'accès s'ouvre maintenant ; null : accès fermé (ou profil inconnu). */
export function profilDepuisAcces(ligne: Record<string, unknown> | null | undefined): ProfilRh | null {
  if (!ligne || ligne.ouvert !== true || typeof ligne.role !== 'string') return null;
  return Object.hasOwn(PROFILS_RH, ligne.role) ? ligne.role as ProfilRh : null;
}

/** Ligne de la personne (`oid` du jeton = personne_id de Clavis) pour Cursus, ou null. Lève une erreur hors PostgreSQL. */
export async function lireAccesClavis(db: Db, oid: string): Promise<Record<string, unknown> | null> {
  if (db.moteur !== 'pg') throw new Error('clavis.pub_acces se lit sur le serveur PostgreSQL commun');
  const r = await db.one<{ r: Record<string, unknown> | string }>(
    "SELECT to_jsonb(v) AS r FROM clavis.pub_acces v WHERE v.personne_id::text = ? AND v.application = 'cursus' LIMIT 1", [oid]);
  if (!r) return null;
  return typeof r.r === 'string' ? JSON.parse(r.r) as Record<string, unknown> : r.r;
}

const DUREE_MS = () => Math.max(0, Number(process.env.CURSUS_ACCES_CLAVIS_SECONDES ?? 60) || 0) * 1000;
const cache = new Map<string, { profil: ProfilRh | null; le: number }>();

/** Oublie les droits gardés (tests). */
export const oublierDroitsClavis = () => cache.clear();

/**
 * Profil RH accordé par Clavis à la personne, ou null (accès fermé, ligne absente, lecture impossible). `frais` : relit
 * la vue (connexion) ; sinon la dernière lecture sert pendant CURSUS_ACCES_CLAVIS_SECONDES.
 */
export async function droitClavis(db: Db, oid: string, o: { frais?: boolean } = {}): Promise<ProfilRh | null> {
  const d = cache.get(oid);
  if (!o.frais && d && Date.now() - d.le <= DUREE_MS()) return d.profil;
  let profil: ProfilRh | null = null;
  try {
    profil = profilDepuisAcces(await lireAccesClavis(db, oid));
  } catch (err) {
    console.warn(`clavis.pub_acces illisible (accès refusé) : ${err instanceof Error ? err.message : err}`);
  }
  cache.set(oid, { profil, le: Date.now() });
  if (cache.size > 5000) cache.delete(cache.keys().next().value!);
  return profil;
}

/** Reporte sur le compte le profil RH réglé dans Clavis, s'il a changé ; journalisé. Rend le compte à jour. */
export async function appliquerProfilClavis(db: Db, compte: Compte, profil: ProfilRh): Promise<Compte> {
  if (compte.profilRh === profil) return compte;
  const avant = compte.profilRh;
  const c = await db.update<Compte>('comptes', compte.id, { profilRh: profil });
  await journaliser(db, {
    actor: 'Clavis', role: null, action: 'compte.profil', compte: c,
    message: `Profil RH réglé dans Clavis : ${PROFILS_RH[avant]?.label ?? avant} → ${PROFILS_RH[profil].label}`, payload: { id: c.id, profilRh: profil, avant, source: 'clavis' },
  });
  return c;
}
