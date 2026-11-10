// lot 16 — versement des pièces justificatives dans Codex (décision du propriétaire du 10 novembre 2026 : tous les
// documents de la suite sont stockés dans Codex ; demandes docs/demandes/codex-lot16-documents.md, Codex#29, et
// matrix-lot16-documents.md, Matrix#87). Réglage « Stockage des pièces » = « Codex » :
// - une pièce envoyée attend dans le dossier local (chiffrée, comme avant) d'être jointe à son objet ; jointe, elle est
//   versée dans Codex par le passage horaire des pièces (et au démarrage) : dépôt avec sa catégorie, le
//   matricule de la personne, sa fin de conservation et son empreinte, puis nom stocké `ged:<identifiant Codex>` et
//   fichier local effacé. Les pièces déjà dans le dossier local sont reprises de la même façon (reprise du lot 16) ;
// - une pièce versée se relit et se détruit par l'API de Codex (server/src/integrations/ged.ts) ;
// - le réglage n'est accepté que si Codex est raccordé (CODEX_URL, jeton et/ou secret, compte de service) et si chaque
//   catégorie de Cursus figure dans son registre (`codex.pub_types_document`, lien de lecture demandé à Matrix) ;
//   tant que Codex n'a pas livré la lecture et la destruction par l'application, il reste refusé.
// Une pièce n'est jamais versée deux fois : la `sourceRef` `cursus:piece/<id>` rend le dépôt rejouable chez Codex.
import { matricule, plural } from '../../shared/format.ts';
import { CATEGORIES_CODEX, categoriesManquantes, DEPARTEMENT_CODEX, sourceRefPiece, titrePiece, type TypeCodexLu } from '../../shared/rules/pieces-codex.ts';
import { refusPiecesLocales } from './config.ts';
import type { Db } from './db.ts';
import { type ClientCodex, clientCodex, CodexIndisponible, CodexRefus } from './integrations/codex-documents.ts';
import { estFichierGed, GED_NON_RACCORDEE, nomGed } from './integrations/ged.ts';
import { log } from './logs.ts';
import { depotLocal, empreinte, type PieceEnregistree, stockagePieces } from './pieces.ts';

const VUE_TYPES = 'codex.pub_types_document';

/** Types du registre de Codex, lus dans sa vue `pub_` ; null si la vue est absente ou non accordée (lien de Matrix). */
export async function lireTypesCodex(db: Db): Promise<TypeCodexLu[] | null> {
  if (db.moteur !== 'pg') return null;
  // CASE : has_table_privilege échoue sur une vue absente (pas de court-circuit garanti d'un AND).
  const ok = (await db.one(`SELECT CASE WHEN to_regclass(CAST(? AS text)) IS NULL THEN FALSE
    ELSE has_table_privilege(current_user, to_regclass(CAST(? AS text)), 'SELECT') END AS ok`, [VUE_TYPES, VUE_TYPES])) as { ok: boolean } | undefined;
  if (!ok?.ok) return null;
  const lignes = (await db.query(`SELECT code, subtypes FROM ${VUE_TYPES}`)) as { code: string; subtypes: unknown }[];
  return lignes.map(l => ({ code: l.code, subtypes: Array.isArray(l.subtypes) ? l.subtypes as TypeCodexLu['subtypes'] : typeof l.subtypes === 'string' ? JSON.parse(l.subtypes) : [] }));
}

/**
 * Refus du stockage dans Codex, ou null s'il peut être choisi : raccordement configuré, dossier local chiffré (les pièces y
 * attendent leur versement), catégories présentes dans le registre de Codex.
 */
export async function refusCodex(db: Db, o: { client?: ClientCodex | null; types?: TypeCodexLu[] | null } = {}): Promise<string | null> {
  const client = o.client === undefined ? clientCodex() : o.client;
  if (!client) return GED_NON_RACCORDEE;
  const local = refusPiecesLocales();
  if (local) return local;
  const types = o.types === undefined ? await lireTypesCodex(db) : o.types;
  if (!types) return `Registre des types de Codex illisible (${VUE_TYPES}) : lien de lecture de cursus_app à accorder par Matrix (demande du lot 16), sur le serveur PostgreSQL commun.`;
  const manquantes = categoriesManquantes(types);
  if (manquantes.length) return `Catégories absentes du registre de Codex : ${manquantes.join(', ')} (demande du lot 16 à Codex). Aucune pièce n’est versée avant leur création.`;
  return null;
}

export interface BilanVersement { versees: number; enEchec: number; restantes: number }

/** Pièces versées par passage au plus (le reste au passage suivant : une reprise ne tient jamais la tâche longtemps). */
const PAR_PASSAGE = 50;

/** Matricule publié de la personne d'une pièce : I…/E… d'une personne sur site extérieure, sinon le matricule Cursus. */
async function matriculeDe(db: Db, empId: number | null): Promise<string | null> {
  if (empId == null) return null;
  const e = await db.get<{ exterieur?: boolean | null; matriculeSite?: string | null }>('employes', empId);
  return e?.exterieur && e.matriculeSite ? e.matriculeSite : matricule(empId);
}

/**
 * Verse dans Codex les pièces jointes encore gardées dans le dossier local (nouvelles et reprise). Une pièce dont le
 * fichier local manque ou n'a plus son empreinte n'est pas versée (contrôle d'intégrité) ; un refus définitif de Codex
 * la laisse en local, signalée dans les journaux du serveur ; Codex injoignable : arrêt, nouvel essai au passage suivant.
 */
export async function verserPieces(db: Db, client: ClientCodex, o: { limite?: number } = {}): Promise<BilanVersement> {
  const limite = o.limite ?? PAR_PASSAGE;
  const a = `objet IS NOT NULL AND retiree_le IS NULL AND fichier IS NOT NULL AND fichier NOT LIKE 'ged:%'`;
  const lignes = (await db.query(`SELECT id FROM pieces WHERE ${a} ORDER BY id LIMIT ${Number(limite)}`)) as { id: number }[];
  const local = depotLocal(db);
  let versees = 0, enEchec = 0;
  for (const { id } of lignes) {
    const p = await db.get<PieceEnregistree>('pieces', id);
    if (!p?.fichier || estFichierGed(p.fichier) || !p.objet || p.objetId == null || p.retireeLe) continue;
    let octets: Buffer | null;
    try { octets = await local.lire(p.fichier); } catch { octets = null; }
    if (!octets || (p.empreinte && empreinte(octets) !== p.empreinte)) {
      enEchec++;
      log.avertissement(`Pièce justificative n° ${id} : fichier local absent, illisible ou altéré, non versée dans Codex (contrôle d’intégrité)`);
      continue;
    }
    const c = CATEGORIES_CODEX[p.objet];
    const mat = await matriculeDe(db, p.empId);
    let docId: string;
    try {
      ({ id: docId } = await client.deposer(octets, p.type, p.nom, {
        sourceRef: sourceRefPiece(id), title: titrePiece(p.objet, { matricule: mat, objetId: p.objetId, deposeLe: p.deposeLe }),
        typeCode: c.typeCode, subtype: c.sousType, department: DEPARTEMENT_CODEX, conf: c.conf,
        subjectMatricule: mat, expiresAt: p.conserverJusquau ?? null, sha256: empreinte(octets),
      }));
    } catch (err) {
      if (err instanceof CodexIndisponible) { log.avertissement(`Versement des pièces dans Codex interrompu : ${err.message}`); break; }
      if (!(err instanceof CodexRefus)) throw err;
      enEchec++;
      log.avertissement(`Pièce justificative n° ${id} : ${err.message}, gardée dans le dossier local`);
      continue;
    }
    const fichierLocal = p.fichier;
    // Nom stocké remplacé seulement s'il n'a pas changé entre-temps ; une pièce retirée pendant le dépôt passe à Codex
    // quand même, et le nettoyage l'y détruit avec son motif.
    const fait = await db.tx(async () => {
      const q = await db.get<PieceEnregistree>('pieces', id);
      if (q?.fichier !== fichierLocal) return false;
      await db.update<PieceEnregistree>('pieces', id, { fichier: nomGed(docId), chiffree: false });
      return true;
    });
    if (fait) {
      versees++;
      await local.supprimer(fichierLocal).catch(() => { /* repris par le nettoyage des fichiers sans pièce */ });
    }
  }
  const restantes = Number(((await db.one(`SELECT COUNT(*) AS n FROM pieces WHERE ${a}`)) as { n: number }).n);
  return { versees, enEchec, restantes };
}

export const bilanVersement = (b: BilanVersement) => [
  b.versees && plural(b.versees, 'pièce versée dans Codex', 'pièces versées dans Codex'),
  b.enEchec && plural(b.enEchec, 'pièce non versée', 'pièces non versées'),
  b.restantes && plural(b.restantes, 'pièce reste à verser', 'pièces restent à verser'),
].filter(Boolean).join(' · ');

/** Passage du versement (tâche horaire des pièces) : rien si le stockage n'est pas Codex ou si Codex n'est pas raccordé. */
export async function verserSiCodex(db: Db, client: ClientCodex | null = clientCodex()): Promise<BilanVersement | null> {
  if ((await stockagePieces(db)) !== 'ged') return null;
  if (!client) { log.avertissement(`Pièces justificatives : stockage « Codex » choisi, mais ${GED_NON_RACCORDEE}`); return null; }
  return await verserPieces(db, client);
}
