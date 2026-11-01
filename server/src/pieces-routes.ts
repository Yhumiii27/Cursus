// Pièces justificatives (t133) : envoi et consultation, hors des actions JSON (server/src/pieces.ts pour le stockage).
//   POST /api/pieces       corps brut du fichier (express.raw, 10 Mo au plus), type PDF, JPEG ou PNG vérifié sur le
//                          contenu, nom d'origine dans l'en-tête X-Nom-Fichier (encodé) ; toute personne connectée,
//                          stockage activé ; la pièce reste en attente, à joindre par une action avec son jeton (201)
//                          ; en-tête Idempotency-Key facultatif (lot 11, file hors ligne : server/src/idempotence.ts) :
//                          le même fichier renvoyé avec la même clé rend la même pièce, sans en déposer une seconde
//   GET  /api/pieces/:id   contenu, après contrôle des droits (shared/rules/pieces.ts, `voitPiece`) et de l'empreinte ;
//                          `?telecharger=1` : en pièce jointe ; sinon affiché par le navigateur (PDF, image)
// Envoi et consultation sont tracés (`piece.deposer`, `piece.consulter`, une ligne par compte et par pièce pendant
// 15 minutes) : identifiants, objet, type et taille, jamais le nom du fichier. Un refus d'une personne connectée l'est aussi.
import { randomBytes } from 'node:crypto';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { Domain } from '../../shared/domain.ts';
import { decap } from '../../shared/format.ts';
import {
  depotOuvert, erreurPiece, LISTE_TYPES_PIECES, MAX_PIECES_EN_ATTENTE, nomPiece, OBJETS_PIECE, TAILLE_MAX_PIECE, tailleTexte, typeDuContenu, TYPES_PIECES, voitPiece,
} from '../../shared/rules/pieces.ts';
import { journaliser } from './comptes.ts';
import { refusPiecesLocales } from './config.ts';
import { espaceChange, identite, type Identite } from './connexion.ts';
import { loadFull, scopeIds } from './dataset.ts';
import type { Db } from './db.ts';
import { tracerRefus } from './journal.ts';
import { log } from './logs.ts';
import { depotDe, depotEcriture, empreinte, type PieceEnregistree, stockagePieces } from './pieces.ts';
import { PieceIndechiffrable } from './pieces-chiffrement.ts';
import { CLE_INVALIDE, CleReutilisee, empreinteCorps, type Envoi, garderReponse, lireCle, reponseGardee } from './idempotence.ts';

/** Pièce déjà déposée par cet envoi (même clé, même fichier) : elle-même, avec son jeton tant qu'elle attend d'être jointe. */
async function pieceDejaDeposee(db: Db, e: Envoi, compteId: number) {
  const g = await reponseGardee(db, e);
  if (!g) return null;
  const pid = Number((g.resultat as { id?: unknown } | null)?.id);
  const p = Number.isInteger(pid) ? await db.get<PieceEnregistree>('pieces', pid) : undefined;
  // Jointe entre-temps (jeton effacé) ou effacée (24 h) : plus rien à joindre, le client renvoie le fichier sans clé.
  if (!p || p.deposeCompteId !== compteId || !p.jeton) return { statut: 410, corps: { error: 'Pièce déjà jointe ou effacée : envoyez de nouveau le fichier' } };
  return { statut: 201, corps: { id: p.id, jeton: p.jeton, nom: p.nom, type: p.type, taille: p.taille } };
}

export const PIECES_DESACTIVEES = 'Pièces justificatives désactivées : l’administrateur RH les active dans Paramètres → Pièces justificatives.';
export const PIECE_TROP_VOLUMINEUSE = `Fichier trop volumineux : ${tailleTexte(TAILLE_MAX_PIECE)} au plus.`;
/** En-tête qui porte le nom d'origine du fichier (encodeURIComponent : un en-tête HTTP n'admet que l'ASCII). */
export const EN_TETE_NOM = 'x-nom-fichier';

/** Corps brut du fichier ; au-delà de 10 Mo, 413 avec le message des pièces (et non celui du JSON, 2 Mo). */
function corpsBrut() {
  const lire = express.raw({ type: [...LISTE_TYPES_PIECES], limit: TAILLE_MAX_PIECE });
  return (req: Request, res: Response, next: NextFunction) => lire(req, res, err => {
    if ((err as { type?: string } | undefined)?.type === 'entity.too.large') return res.status(413).json({ error: PIECE_TROP_VOLUMINEUSE });
    next(err);
  });
}

/** Consultation tracée une fois par compte et par pièce pendant 15 minutes (aperçu d'une image, puis ouverture). */
async function dejaTracee(db: Db, compteId: number, piece: number): Promise<boolean> {
  const depuis = new Date(Date.now() - 15 * 60_000).toISOString();
  return !!(await db.one(`SELECT 1 FROM journal WHERE compte_id = ? AND action = 'piece.consulter' AND at >= ? AND ${db.jsonCleEgale('payload', 'piece')} LIMIT 1`, [compteId, depuis, piece]));
}

/** En-tête Content-Disposition : nom ASCII de secours et nom exact encodé (RFC 6266). */
function disposition(mode: 'inline' | 'attachment', nom: string) {
  const ascii = nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nom)}`;
}

/** Équipe du manager connecté (périmètre de l'instantané, server/src/dataset.ts). */
const equipeDe = async (db: Db, id: Identite) => new Set(scopeIds(new Domain(await loadFull(db, id.user)), id.user));

export function routesPieces(db: Db): Router {
  const r = express.Router();

  r.post('/api/pieces', corpsBrut(), async (req, res) => {
    const id = await identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    if (espaceChange(req, res, id)) return;
    const stockage = await stockagePieces(db);
    if (!depotOuvert(stockage)) return res.status(409).json({ error: PIECES_DESACTIVEES });
    // Lot 8 : jamais de pièce écrite en clair dans le dossier local en production (CURSUS_PIECES_KEY).
    const refus = stockage === 'local' ? refusPiecesLocales() : null;
    if (refus) return res.status(409).json({ error: refus });
    const octets = Buffer.isBuffer(req.body) ? req.body : null;
    if (!octets) return res.status(415).json({ error: 'Format refusé : PDF, JPEG ou PNG seulement.' });
    // Lot 11 : envoi rejoué par la file hors ligne (même clé, même fichier) : la pièce déjà déposée, aucune seconde copie.
    const cle = lireCle(req);
    if (cle === false) return res.status(400).json({ error: CLE_INVALIDE });
    const envoi: Envoi | null = cle ? { compteId: id.compte.id, cle, operation: 'piece.deposer', empreinte: empreinteCorps('piece.deposer', octets) } : null;
    try {
      const deja = envoi ? await pieceDejaDeposee(db, envoi, id.compte.id) : null;
      if (deja) return res.status(deja.statut).set('idempotent-replayed', 'true').json(deja.corps);
    } catch (err) {
      if (err instanceof CleReutilisee) return res.status(422).json({ error: err.message });
      throw err;
    }
    // Type reconnu sur le contenu, seul gardé (c'est lui qui est servi ensuite) : une page HTML renommée en .pdf est
    // refusée ; une photo JPEG nommée .png (export d'un téléphone, d'une messagerie) est acceptée comme JPEG. Le type
    // déclaré par le navigateur ne sert qu'à recevoir le corps brut (PDF, JPEG ou PNG).
    const type = typeDuContenu(octets);
    const erreur = erreurPiece({ type, taille: octets.length });
    if (erreur || !type) return res.status(octets.length ? 415 : 400).json({ error: erreur ?? 'Format refusé' });
    const enAttente = Number(((await db.one('SELECT COUNT(*) AS n FROM pieces WHERE objet IS NULL AND depose_compte_id = ?', [id.compte.id])) as { n: number }).n);
    if (enAttente >= MAX_PIECES_EN_ATTENTE) return res.status(429).json({ error: `${MAX_PIECES_EN_ATTENTE} pièces envoyées attendent déjà d’être jointes : enregistrez ou abandonnez d’abord vos saisies.` });
    let nomRecu = '';
    try { nomRecu = decodeURIComponent(req.get(EN_TETE_NOM) ?? ''); } catch { /* nom illisible : nom générique */ }
    const nom = nomPiece(nomRecu, type);
    const depot = (await depotEcriture(db))!;
    const fichier = await depot.ecrire(octets);
    try {
      const jeton = randomBytes(24).toString('base64url');
      const piece = await db.tx(async () => {
        // Envoi simultané de la même requête, déjà enregistré dans une autre transaction : sa pièce, ce fichier effacé.
        const deja = envoi ? await pieceDejaDeposee(db, envoi, id.compte.id) : null;
        if (deja) return deja;
        const p = await db.insert<PieceEnregistree>('pieces', {
          jeton, empId: null, objet: null, objetId: null, nom, type, taille: octets.length, empreinte: empreinte(octets), fichier,
          chiffree: depot.chiffre === true,
          deposeLe: new Date().toISOString(), deposePar: id.user.nom, deposeCompteId: id.compte.id,
        });
        await journaliser(db, {
          actor: id.user.nom, role: id.user.role, action: 'piece.deposer', compte: id.compte,
          message: `Pièce justificative envoyée (${TYPES_PIECES[type].label}, ${tailleTexte(octets.length)}), en attente d’être jointe`,
          payload: { piece: p.id, type, taille: octets.length },
        });
        if (envoi) await garderReponse(db, envoi, { statut: 201, resultat: { id: p.id } });
        return p;
      });
      if ('statut' in piece) {
        await depot.supprimer(fichier).catch(() => {});
        return res.status(piece.statut).set('idempotent-replayed', 'true').json(piece.corps);
      }
      res.status(201).json({ id: piece.id, jeton, nom, type, taille: octets.length });
    } catch (err) {
      await depot.supprimer(fichier).catch(() => {});
      if (err instanceof CleReutilisee) return res.status(422).json({ error: err.message });
      throw err;
    }
  });

  r.get('/api/pieces/:id', async (req, res) => {
    const id = await identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    const p = await db.get<PieceEnregistree>('pieces', Number(req.params.id));
    // Pièce en attente : seul le compte qui l'a envoyée la relit ; sinon les règles de shared/rules/pieces.ts.
    const equipe = p?.objet && id.user.role === 'manager' ? await equipeDe(db, id) : new Set<number>();
    const permis = !!p && (p.objet
      ? voitPiece(id.user, { empId: p.empId!, objet: p.objet }, empId => id.user.role === 'manager' && equipe.has(empId))
      : p.deposeCompteId === id.compte.id);
    if (!p || !permis) {
      // Même réponse pour une pièce inexistante ou hors de portée (rien ne dit qu'elle existe), refus tracé.
      if (p) await tracerRefus(db, id, 'Pièce justificative', p.objet ? `${OBJETS_PIECE[p.objet].label} hors de vos droits` : 'pièce envoyée par un autre compte');
      return res.status(404).json({ error: 'Pièce introuvable' });
    }
    if (p.retireeLe || !p.fichier) return res.status(410).json({ error: 'Pièce retirée du dossier : son fichier a été effacé' });
    let octets: Buffer | null;
    try {
      octets = await depotDe(db, p.fichier).lire(p.fichier);
    } catch (err) {
      if (!(err instanceof PieceIndechiffrable)) throw err;
      log.avertissement(`Pièce justificative n° ${p.id} : ${err.message}`);
      return res.status(409).json({ error: 'Fichier chiffré illisible avec la clé du serveur : prévenez l’administrateur (clé CURSUS_PIECES_KEY)' });
    }
    if (!octets) {
      log.avertissement(`Pièce justificative n° ${p.id} : fichier absent du dépôt`);
      return res.status(410).json({ error: 'Fichier introuvable dans le dossier des pièces : prévenez l’administrateur (restauration depuis les sauvegardes)' });
    }
    if (p.empreinte && empreinte(octets) !== p.empreinte) {
      log.avertissement(`Pièce justificative n° ${p.id} : empreinte différente de celle de l’envoi`);
      return res.status(409).json({ error: 'Fichier altéré depuis son envoi (empreinte différente) : prévenez l’administrateur' });
    }
    if (p.objet && !(await dejaTracee(db, id.compte.id, p.id))) {
      await journaliser(db, {
        actor: id.user.nom, role: id.user.role, action: 'piece.consulter', compte: id.compte, salaries: p.empId ? [p.empId] : [],
        message: `Pièce justificative consultée (${decap(OBJETS_PIECE[p.objet].label)})`,
        payload: { piece: p.id, objet: p.objet, objetId: p.objetId },
      });
    }
    res.set({
      'Content-Type': p.type,
      'Content-Disposition': disposition(req.query.telecharger ? 'attachment' : 'inline', p.nom),
      'Cache-Control': 'no-store',
      // Affichage du PDF ou de l'image seulement : aucun script, aucun cadre, rien d'autre chargé.
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'none'",
    });
    res.send(octets);
  });

  return r;
}
