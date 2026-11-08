// lot 14 — pré-déclarations de présence sur site (demande de Vigie du 4 novembre 2026, décision CV-10 ; règles :
// shared/rules/declarations-presence.ts ; actions du service RH : server/src/actions/declarations.ts).
// Lien permanent par entreprise extérieure ou agence d'intérim : jeton long et aléatoire (256 bits) montré une seule fois
// au service RH, stocké haché (SHA-256), révocable. Page publique `/declarer/<jeton>` (client/src/pages/Declarer.tsx),
// hors session : l'entreprise n'a pas de compte. Deux routes :
// - GET  /api/declaration/<jeton> : entreprise du lien et sites ouverts (rien d'autre : ni personne, ni déclaration) ;
// - POST /api/declaration/<jeton> : une déclaration « à valider » ; champ piège, débit limité par adresse et par lien,
//   plafond de déclarations en attente par lien. Un jeton inconnu ou révoqué reçoit la même réponse 404.
// Rien de ce que l'entreprise saisit n'est publié ni ne crée de fiche avant la validation par le service RH.
import express, { type Request, type Response, type Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { CONSERVATION_DEFAUT_MOIS, effaceeLe, erreursDeclaration, normaliserDeclaration, refDeclaration } from '../../shared/rules/declarations-presence.ts';
import type { ISODate } from '../../shared/types.ts';
import type { DeclarationPresence, LienDeclaration, Site } from '../../shared/types.ts';
import { loadSettings, todayIso } from './dataset.ts';
import type { Db } from './db.ts';
import { LimiteurDebit, tropDeRequetes } from './debit.ts';
import { journaliser } from './comptes.ts';

/** Jeton : 32 octets aléatoires en base64url (43 caractères). */
export const FORME_JETON_DECLARATION = /^[A-Za-z0-9_-]{43}$/;
export const empreinteLien = (jeton: string) => createHash('sha256').update(`declaration:${jeton}`).digest('hex');

/** Déclarations en attente au plus par lien : au-delà, le service RH doit d'abord trier. */
export const PLAFOND_EN_ATTENTE = 200;
/** Débits : lecture et dépôt par adresse, dépôt par lien. */
export const DEBIT_DECLARATION = {
  ip: { capacite: 30, parMinute: 10 },
  depot: { capacite: 20, parMinute: 4 },
} as const;

/** Nouveau lien : la valeur du jeton n'est renvoyée qu'ici, seule son empreinte est gardée. */
export async function creerLien(db: Db, l: Pick<LienDeclaration, 'categorie' | 'entreprise'>, par: string): Promise<{ jeton: string; lien: LienDeclaration }> {
  const jeton = randomBytes(32).toString('base64url');
  const lien = await db.insert<LienDeclaration>('liensDeclaration', {
    categorie: l.categorie, entreprise: l.entreprise, empreinte: empreinteLien(jeton), creeLe: new Date().toISOString(), creePar: par,
    revoqueLe: null, revoquePar: null, dernierUsage: null,
  } as LienDeclaration);
  return { jeton, lien };
}

/** Lien en vigueur d'un jeton ; undefined pour un jeton mal formé, inconnu ou révoqué. */
async function lienDe(db: Db, jeton: string): Promise<LienDeclaration | undefined> {
  if (!FORME_JETON_DECLARATION.test(jeton)) return undefined;
  const r = await db.one<{ id: number }>('SELECT id FROM liens_declaration WHERE empreinte = ? AND revoque_le IS NULL', [empreinteLien(jeton)]);
  return r ? await db.get<LienDeclaration>('liensDeclaration', r.id) : undefined;
}

/** Sites proposés : ceux du référentiel encore ouverts, dans l'ordre d'affichage. */
async function sitesOuverts(db: Db): Promise<{ code: string; libelle: string }[]> {
  return (await db.all<Site>('sites')).filter(x => x.actif).sort((a, b) => a.ordre - b.ordre).map(({ code, libelle }) => ({ code, libelle }));
}

export function routesDeclaration(db: Db, limites = { ip: new LimiteurDebit(DEBIT_DECLARATION.ip), depot: new LimiteurDebit(DEBIT_DECLARATION.depot) }): Router {
  const r = express.Router();
  const introuvable = (res: Response) => res.status(404).json({ error: 'Lien de déclaration introuvable ou révoqué. Demandez un nouveau lien au service RH.' });

  r.get('/api/declaration/:jeton', async (req: Request, res: Response) => {
    const attente = limites.ip.prendre(req.ip ?? '');
    if (attente) return tropDeRequetes(req, res, attente, 'Trop de demandes depuis ce poste');
    const lien = await lienDe(db, String(req.params.jeton));
    if (!lien) return introuvable(res);
    const s = await loadSettings(db);
    res.set('Cache-Control', 'no-store');
    res.json({
      entreprise: lien.entreprise, categorie: lien.categorie, sites: await sitesOuverts(db), today: todayIso(),
      conservationMois: s.declarationsConservationMois ?? CONSERVATION_DEFAUT_MOIS,
    });
  });

  r.post('/api/declaration/:jeton', async (req: Request, res: Response) => {
    const attente = limites.ip.prendre(req.ip ?? '');
    if (attente) return tropDeRequetes(req, res, attente, 'Trop de déclarations depuis ce poste');
    const p = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const lien = await lienDe(db, String(req.params.jeton));
    if (!lien) return introuvable(res);
    const attenteLien = limites.depot.prendre(String(lien.id));
    if (attenteLien) return tropDeRequetes(req, res, attenteLien, 'Trop de déclarations sur ce lien');
    // Champ piège (invisible à l'écran) : un robot le remplit ; réponse identique à un dépôt réussi, rien n'est gardé.
    if (typeof p.siteWeb === 'string' && p.siteWeb.trim()) return res.status(201).json({ ref: refDeclaration(0) });
    const s = normaliserDeclaration(p);
    const sites = (await sitesOuverts(db)).map(x => x.code);
    const erreurs = erreursDeclaration(s, { today: todayIso(), sites });
    if (erreurs.length) return res.status(400).json({ error: erreurs.join(' '), erreurs });
    const ref = await db.tx(async () => {
      const n = await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM declarations_presence WHERE lien_id = ? AND statut = \'a_valider\'', [lien.id]);
      if (Number(n?.n ?? 0) >= PLAFOND_EN_ATTENTE) return null;
      const maintenant = new Date().toISOString();
      const d = await db.insert<DeclarationPresence>('declarationsPresence', {
        lienId: lien.id, categorie: lien.categorie, entreprise: lien.entreprise, nom: s.nom, prenom: s.prenom, email: s.email,
        siteCode: s.siteCode, du: s.du, au: s.au, objet: s.objet, statut: 'a_valider', creeLe: maintenant, empId: null,
        decideLe: null, decidePar: null, valideeLe: null, motif: null, majLe: maintenant,
      } as DeclarationPresence);
      await db.update<LienDeclaration>('liensDeclaration', lien.id, { dernierUsage: maintenant });
      return refDeclaration(d.id);
    });
    if (!ref) return res.status(429).json({ error: 'Trop de déclarations en attente sur ce lien : le service RH doit d’abord traiter les précédentes.' });
    res.status(201).json({ ref });
  });
  return r;
}

/**
 * Purge quotidienne (tâche de la conservation, server/src/conservation.ts) : déclarations refusées, sans suite ou annulées
 * avant validation, `declarationsConservationMois` mois après (shared/rules/declarations-presence.ts, `effaceeLe`). Les
 * validées suivent la fiche de la personne. Journalisée sans identité (nombre seulement). Renvoie le nombre supprimé.
 */
export async function purgerDeclarations(db: Db, today: ISODate = todayIso()): Promise<number> {
  const mois = (await loadSettings(db)).declarationsConservationMois ?? CONSERVATION_DEFAUT_MOIS;
  return await db.tx(async () => {
    const echues = (await db.all<DeclarationPresence>('declarationsPresence')).filter(d => { const le = effaceeLe(d, mois); return le != null && le <= today; });
    for (const d of echues) await db.remove('declarationsPresence', d.id);
    if (echues.length) {
      await journaliser(db, {
        actor: 'Cursus', role: null, action: 'presence.purge', message: `Déclarations de présence refusées ou sans suite effacées : ${echues.length}`,
        payload: { declarations: echues.length, mois }, salaries: [],
      });
    }
    return echues.length;
  });
}
