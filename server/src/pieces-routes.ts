// Pièces justificatives (t133) : envoi et consultation, hors des actions JSON (server/src/pieces.ts pour le stockage).
//   POST /api/pieces       corps brut du fichier (express.raw, 10 Mo au plus), type PDF, JPEG ou PNG vérifié sur le
//                          contenu, nom d'origine dans l'en-tête X-Nom-Fichier (encodé) ; toute personne connectée,
//                          stockage activé ; la pièce reste en attente, à joindre par une action avec son jeton (201)
//   GET  /api/pieces/:id   contenu, après contrôle des droits (shared/rules/pieces.ts, `voitPiece`) et de l'empreinte ;
//                          `?telecharger=1` : en pièce jointe ; sinon affiché par le navigateur (PDF, image)
// Envoi et consultation sont tracés (`piece.deposer`, `piece.consulter`, une ligne par compte et par pièce pendant
// 15 minutes) : identifiants, objet, type et taille, jamais le nom du fichier. Un refus d'une personne connectée l'est aussi.
import { randomBytes } from 'node:crypto';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { Domain } from '../../shared/domain.ts';
import {
  depotOuvert, erreurPiece, LISTE_TYPES_PIECES, MAX_PIECES_EN_ATTENTE, nomPiece, OBJETS_PIECE, TAILLE_MAX_PIECE, tailleTexte, typeDuContenu, TYPES_PIECES, voitPiece,
} from '../../shared/rules/pieces.ts';
import { journaliser } from './comptes.ts';
import { espaceChange, identite, type Identite } from './connexion.ts';
import { loadFull, scopeIds } from './dataset.ts';
import type { Db } from './db.ts';
import { tracerRefus } from './journal.ts';
import { log } from './logs.ts';
import { depotDe, depotEcriture, empreinte, type PieceEnregistree, stockagePieces } from './pieces.ts';

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
function dejaTracee(db: Db, compteId: number, piece: number): boolean {
  const depuis = new Date(Date.now() - 15 * 60_000).toISOString();
  return !!db.sql.prepare(`SELECT 1 FROM journal WHERE compte_id = ? AND action = 'piece.consulter' AND at >= ? AND json_extract(payload, '$.piece') = ? LIMIT 1`)
    .get(compteId, depuis, piece);
}

/** En-tête Content-Disposition : nom ASCII de secours et nom exact encodé (RFC 6266). */
function disposition(mode: 'inline' | 'attachment', nom: string) {
  const ascii = nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nom)}`;
}

/** Équipe du manager connecté (périmètre de l'instantané, server/src/dataset.ts). */
const equipeDe = (db: Db, id: Identite) => new Set(scopeIds(new Domain(loadFull(db, id.user)), id.user));

export function routesPieces(db: Db): Router {
  const r = express.Router();

  r.post('/api/pieces', corpsBrut(), async (req, res) => {
    const id = identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    if (espaceChange(req, res, id)) return;
    if (!depotOuvert(stockagePieces(db))) return res.status(409).json({ error: PIECES_DESACTIVEES });
    const octets = Buffer.isBuffer(req.body) ? req.body : null;
    if (!octets) return res.status(415).json({ error: 'Format refusé : PDF, JPEG ou PNG seulement.' });
    // Type reconnu sur le contenu, seul gardé (c'est lui qui est servi ensuite) : une page HTML renommée en .pdf est
    // refusée ; une photo JPEG nommée .png (export d'un téléphone, d'une messagerie) est acceptée comme JPEG. Le type
    // déclaré par le navigateur ne sert qu'à recevoir le corps brut (PDF, JPEG ou PNG).
    const type = typeDuContenu(octets);
    const erreur = erreurPiece({ type, taille: octets.length });
    if (erreur || !type) return res.status(octets.length ? 415 : 400).json({ error: erreur ?? 'Format refusé' });
    const enAttente = Number((db.sql.prepare('SELECT COUNT(*) AS n FROM pieces WHERE objet IS NULL AND depose_compte_id = ?').get(id.compte.id) as { n: number }).n);
    if (enAttente >= MAX_PIECES_EN_ATTENTE) return res.status(429).json({ error: `${MAX_PIECES_EN_ATTENTE} pièces envoyées attendent déjà d’être jointes : enregistrez ou abandonnez d’abord vos saisies.` });
    let nomRecu = '';
    try { nomRecu = decodeURIComponent(req.get(EN_TETE_NOM) ?? ''); } catch { /* nom illisible : nom générique */ }
    const nom = nomPiece(nomRecu, type);
    const depot = depotEcriture(db)!;
    const fichier = await depot.ecrire(octets);
    try {
      const jeton = randomBytes(24).toString('base64url');
      const piece = db.tx(() => {
        const p = db.insert<PieceEnregistree>('pieces', {
          jeton, empId: null, objet: null, objetId: null, nom, type, taille: octets.length, empreinte: empreinte(octets), fichier,
          deposeLe: new Date().toISOString(), deposePar: id.user.nom, deposeCompteId: id.compte.id,
        });
        journaliser(db, {
          actor: id.user.nom, role: id.user.role, action: 'piece.deposer', compte: id.compte,
          message: `Pièce justificative envoyée (${TYPES_PIECES[type].label}, ${tailleTexte(octets.length)}), en attente d’être jointe`,
          payload: { piece: p.id, type, taille: octets.length },
        });
        return p;
      });
      res.status(201).json({ id: piece.id, jeton, nom, type, taille: octets.length });
    } catch (err) {
      await depot.supprimer(fichier).catch(() => {});
      throw err;
    }
  });

  r.get('/api/pieces/:id', async (req, res) => {
    const id = identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    const p = db.get<PieceEnregistree>('pieces', Number(req.params.id));
    // Pièce en attente : seul le compte qui l'a envoyée la relit ; sinon les règles de shared/rules/pieces.ts.
    const permis = !!p && (p.objet
      ? voitPiece(id.user, { empId: p.empId!, objet: p.objet }, empId => id.user.role === 'manager' && equipeDe(db, id).has(empId))
      : p.deposeCompteId === id.compte.id);
    if (!p || !permis) {
      // Même réponse pour une pièce inexistante ou hors de portée (rien ne dit qu'elle existe), refus tracé.
      if (p) tracerRefus(db, id, 'Pièce justificative', p.objet ? `${OBJETS_PIECE[p.objet].label} hors de vos droits` : 'pièce envoyée par un autre compte');
      return res.status(404).json({ error: 'Pièce introuvable' });
    }
    if (p.retireeLe || !p.fichier) return res.status(410).json({ error: 'Pièce retirée du dossier : son fichier a été effacé' });
    const octets = await depotDe(db, p.fichier).lire(p.fichier);
    if (!octets) {
      log.avertissement(`Pièce justificative n° ${p.id} : fichier absent du dépôt`);
      return res.status(410).json({ error: 'Fichier introuvable dans le dossier des pièces : prévenez l’administrateur (restauration depuis les sauvegardes)' });
    }
    if (p.empreinte && empreinte(octets) !== p.empreinte) {
      log.avertissement(`Pièce justificative n° ${p.id} : empreinte différente de celle de l’envoi`);
      return res.status(409).json({ error: 'Fichier altéré depuis son envoi (empreinte différente) : prévenez l’administrateur' });
    }
    if (p.objet && !dejaTracee(db, id.compte.id, p.id)) {
      journaliser(db, {
        actor: id.user.nom, role: id.user.role, action: 'piece.consulter', compte: id.compte, salaries: p.empId ? [p.empId] : [],
        message: `Pièce justificative consultée (${OBJETS_PIECE[p.objet].label.toLowerCase()})`,
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
