// E-mails sortants lus sans le droit « rh » (profil en lecture seule : Paramètres → Envois, `/api/envois`), alignés sur
// le journal (`pourLecteur`, server/src/journal.ts) : un e-mail qui désigne une donnée de santé garde ses destinataires,
// sa date et son état, mais son objet et son texte sont remplacés par « Détail réservé au service RH », ses pièces
// jointes retirées et son type neutralisé (`reserve`). Sont concernés l'information sur les congés au retour d'un arrêt
// (`conges.information`, envoyée seulement après un arrêt de maladie ou d'accident), la demande de visite médicale
// (`visite.demande`) et le récapitulatif quotidien qui contient l'une de ces notifications.
import { dossierComplet } from '../../shared/journal.ts';
import type { CurrentUser, Envoi } from '../../shared/types.ts';
import type { Db } from './db.ts';
import { DETAIL_RESERVE } from './journal.ts';

/** Types d'e-mail dont la seule existence désigne une donnée de santé. */
export const EMAILS_SANTE: readonly string[] = ['conges.information', 'visite.demande'];
/** Type affiché à la place d'un e-mail réservé au service RH. */
export const TYPE_RESERVE = 'reserve';

/** Récapitulatifs quotidiens (identifiants d'envoi) qui regroupent une notification de santé. */
function recapitulatifsSante(db: Db, ids: number[]): Set<number> {
  if (!ids.length) return new Set();
  const rows = db.sql.prepare(`SELECT DISTINCT envoi_id AS id FROM notifications WHERE envoi_id IN (${ids.map(() => '?').join(', ')})
    AND type IN (${EMAILS_SANTE.map(() => '?').join(', ')})`).all(...ids, ...EMAILS_SANTE) as { id: number }[];
  return new Set(rows.map(r => r.id));
}

/** Envois tels que `u` les lit : inchangés pour le service RH, e-mails de santé neutralisés pour la lecture seule. */
export function envoisPourLecteur(db: Db, u: Pick<CurrentUser, 'role' | 'profilRh'>, envois: Envoi[]): Envoi[] {
  if (dossierComplet(u)) return envois;
  const recap = recapitulatifsSante(db, envois.filter(e => e.cible === 'email' && e.type === 'recapitulatif').map(e => e.id));
  return envois.map(e => {
    if (e.cible !== 'email' || !(EMAILS_SANTE.includes(e.type) || recap.has(e.id))) return e;
    const { pj: _pj, ...contenu } = e.contenu as Record<string, unknown>;
    return { ...e, type: e.type === 'recapitulatif' ? e.type : TYPE_RESERVE, contenu: { ...contenu, objet: DETAIL_RESERVE, texte: DETAIL_RESERVE } };
  });
}
