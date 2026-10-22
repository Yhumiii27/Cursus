// Protection de la base sur le disque : elle contient des données de santé (visites, avis, vaccinations), des numéros de
// passeport et la paie. Au démarrage, le fichier et ses journaux -wal / -shm sont réservés au compte du service (600) et
// son dossier lui est fermé (700) ; en production, Cursus refuse de démarrer si la base reste accessible à d'autres
// comptes. Le chiffrement du disque chez l'hébergeur est un prérequis de l'installation (docs/DEPLOIEMENT.md, « Disque
// chiffré ») ; un chiffrement des colonnes par Cursus attend l'avis du DPO.
import { chmodSync, existsSync, mkdirSync, realpathSync, statSync, type Stats } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { RACINE } from './chemins.ts';
import type { Env } from './config.ts';
import type { Db } from './db.ts';

/** Base laissée accessible à d'autres comptes, en production : démarrage refusé. */
export class ProtectionError extends Error {}

/** Fichiers de la base : le fichier lui-même et les journaux de SQLite, qui portent les écritures récentes. */
const SUFFIXES = ['', '-wal', '-shm', '-journal'];
const AUTRES_COMPTES = 0o077;

const droits = (st: Stats) => (st.mode & 0o7777).toString(8).padStart(3, '0');
const code = (e: unknown) => (e as NodeJS.ErrnoException).code ?? (e instanceof Error ? e.message : String(e));

export interface Protection {
  /** Fichiers et dossier ramenés aux droits du seul compte du service. */
  restreints: string[];
  /** À signaler au démarrage, sans l'empêcher : dossier partagé, droits impossibles à restreindre hors production. */
  avertissements: string[];
}

/**
 * Dossier propre à la base, que Cursus peut fermer aux autres comptes : à ce compte, sans bit sticky (/tmp et autres
 * dossiers partagés), et ni la racine du système ou du projet, ni le dossier de lancement. Le dossier personnel n'est
 * pas exclu : celui du compte de service est justement le dossier de la base (--home-dir /var/lib/cursus).
 */
function dossierPropre(dir: string, st: Stats): boolean {
  if (st.mode & 0o1000) return false;
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return false;
  return !['/', RACINE, process.cwd()].map(d => resolve(d)).includes(dir);
}

/**
 * Restreint les droits de la base (600) et de son dossier (700), le crée au besoin en 700. Un dossier partagé n'est pas
 * modifié (avertissement). En production (`production`), lève une ProtectionError si un fichier de la base reste
 * accessible à d'autres comptes (fichier d'un autre compte, système de fichiers qui ignore les droits). Sans effet sous
 * Windows, qui n'a pas ces droits. `chmod` : remplacé dans les tests (refus du système).
 */
export function protegerBase(fichier: string, { production = false, chmod = chmodSync }: { production?: boolean; chmod?: typeof chmodSync } = {}): Protection {
  const out: Protection = { restreints: [], avertissements: [] };
  if (process.platform === 'win32' || fichier === ':memory:') return out;
  let base = resolve(fichier);
  try { base = realpathSync(base); } catch { /* base pas encore créée */ }
  const dir = dirname(base);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = statSync(dir);
  if (st.mode & AUTRES_COMPTES) {
    if (!dossierPropre(dir, st)) {
      out.avertissements.push(`le dossier de la base ${dir} est partagé (droits ${droits(st)}) : placez la base dans un dossier réservé au compte du service, en 700 (docs/DEPLOIEMENT.md).`);
    } else {
      try {
        chmod(dir, 0o700);
        out.restreints.push(dir);
      } catch (e) {
        out.avertissements.push(`dossier de la base ${dir} accessible à d’autres comptes (droits ${droits(st)}), impossible à restreindre (${code(e)}) : chmod 700 ${dir}.`);
      }
    }
  }
  const restent: string[] = [];
  for (const f of SUFFIXES.map(s => base + s).filter(f => existsSync(f))) {
    const avant = statSync(f);
    if (!(avant.mode & AUTRES_COMPTES)) continue;
    try {
      chmod(f, 0o600);
    } catch { /* contrôlé ci-dessous */ }
    if (statSync(f).mode & AUTRES_COMPTES) {
      const proprietaire = typeof process.getuid === 'function' && avant.uid !== process.getuid() ? `, fichier du compte n° ${avant.uid}` : '';
      restent.push(`${f} (droits ${droits(avant)}${proprietaire})`);
    } else out.restreints.push(f);
  }
  if (restent.length) {
    const message = `la base reste accessible à d’autres comptes que celui du service : ${restent.join(', ')}. `
      + `Cursus n’a pas pu en restreindre les droits ; sous le compte root : chown cursus:cursus ${base}* && chmod 600 ${base}* (docs/DEPLOIEMENT.md).`;
    if (production) throw new ProtectionError(message);
    out.avertissements.push(message);
  }
  return out;
}

/**
 * Clé de signature des sessions écrite en base par une installation sans CURSUS_SECRET (développement, démonstration,
 * premiers essais) : retirée dès que CURSUS_SECRET est définie, qui la remplace. SQLite laisse d'ordinaire une ligne
 * supprimée dans la page libérée : la suppression est donc faite avec secure_delete (contenu effacé par des zéros),
 * puis le journal -wal est reporté dans la base et vidé, pour qu'une copie du fichier ne donne plus de quoi signer une
 * session. Renvoie vrai si elle était présente. Les sauvegardes antérieures la gardent.
 */
export async function retirerSecretStocke(db: Db, env: Env = process.env): Promise<boolean> {
  if (!env.CURSUS_SECRET || !await db.get('settings', 'secret')) return false;
  // PostgreSQL : pas de fichier à effacer ; la ligne supprimée disparaît au prochain nettoyage (autovacuum) et les
  // sauvegardes du schéma antérieures la gardent.
  if (db.moteur === 'pg') { await db.remove('settings', 'secret'); return true; }
  const avant = (await db.one<{ secure_delete: number }>('PRAGMA secure_delete'))!.secure_delete;
  await db.exec('PRAGMA secure_delete = ON');
  try {
    await db.remove('settings', 'secret');
  } finally {
    await db.exec(`PRAGMA secure_delete = ${avant ? 'ON' : 'OFF'}`);
  }
  await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  return true;
}
