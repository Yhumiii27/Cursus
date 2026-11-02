// Feedback 360° (lot 12, chantier C3, t194, étape 3 ; règles : shared/rules/feedback360.ts ; actions :
// server/src/actions/feedback360.ts). Ce fichier tient ce qui garantit la confidentialité des réponses :
// - tampon : la réponse d'un répondant attend la clôture de la collecte dans `feedback_tampon`, chiffrée (AES-256-GCM, clé
//   CURSUS_PIECES_KEY hors de la base, sollicitation authentifiée avec le contenu), invisible de tous : jamais lue par
//   l'instantané (HORS_INSTANTANE), ni par le service RH ; seul le répondant relit la sienne (route ci-dessous) ;
// - versement par lot (`clore360`) : à la clôture de la fenêtre, toutes les réponses de l'entretien sont déchiffrées,
//   mélangées (ordre aléatoire tiré par node:crypto), puis inscrites dans `feedback_reponses` sous un identifiant aléatoire
//   (non séquentiel), sans répondant, sans sollicitation ni date de réception, dans une seule transaction ; le tampon est
//   purgé dans la même transaction. Sous le seuil de restitution, rien n'est versé (les réponses sont supprimées) ;
// - synthèse (`majSynthese360`) : calculée ici, jointe à l'entretien (`entretiens.synthese_feedback`) et recalculée après
//   chaque relecture d'un commentaire par le service RH ; c'est la seule chose que voient l'évalué et l'évaluateur ;
// - purge (`purgerEntretien360`) : réponses brutes, tampon et sollicitations supprimés à la clôture de l'entretien, et au
//   plus tard `feedback360ConservationMois` (6) après l'envoi (`tacheFeedback360`, tâche horaire de la conservation) ;
// - relance automatique des répondants sans réponse 3 jours avant l'échéance ; clôture automatique d'une fenêtre échue.
// Textes des e-mails et notifications : génériques, jamais le nom de l'évalué ni d'un répondant.
import { createCipheriv, createDecipheriv, randomBytes, randomInt } from 'node:crypto';
import express, { type Request, type Response, type Router } from 'express';
import { droitsRh } from '../../shared/constants.ts';
import { fmtIso, plural } from '../../shared/format.ts';
import {
  aRelancer360, type ContenuReponse360, jour360, limiteConservation360, lireReponse360, type Relation360, RELATIONS_360, sollicitationEnvoyee,
  synthese360,
} from '../../shared/rules/feedback360.ts';
import type { CurrentUser, Entretien, ISODate, Reponse360, Sollicitation360 } from '../../shared/types.ts';
import { makeCtx, type Ctx } from './actions/context.ts';
import { journaliser } from './comptes.ts';
import { clePieces, demoSurBoucleLocale, enProduction } from './config.ts';
import { identite } from './connexion.ts';
import { loadFull, loadSettings, todayIso } from './dataset.ts';
import type { Db } from './db.ts';
import { tracerRefus } from './journal.ts';
import { notifier } from './notifications.ts';
import { instantServeur } from './pointages.ts';

/**
 * Horodatage du feedback 360° (envoi, relance, clôture) : l'heure réelle ; avec une date du jour imposée (CURSUS_TODAY :
 * démonstration, tests), l'heure de Paris du moment ce jour-là, pour que délais et conservation suivent la même date.
 */
export const instant360 = () => new Date(instantServeur()).toISOString();
/** Horodatage d'un passage de la tâche pour le jour `today` (celui du jour même, ou midi de Paris d'un autre jour rejoué). */
const instantDu = (today: ISODate) => (today === todayIso() ? instant360() : `${today}T10:00:00.000Z`);

// ——— Tampon chiffré ———

/** En-tête d'une réponse chiffrée du tampon (version 1). */
const ENTETE = 'CURSUSF1:';
/** Réponse gardée en clair, faute de clé, hors production (démonstration, essais) : même format, sans chiffrement. */
const CLAIR = 'CLAIR1:';
const authentifie = (sollicitationId: number) => Buffer.from(`feedback360:${sollicitationId}`, 'utf8');

/**
 * Réponse refusée en production sans clé de chiffrement (CURSUS_PIECES_KEY, comme les pièces justificatives) : message,
 * ou null. La démonstration et les essais gardent le tampon en clair (`CLAIR`), seulement hors production.
 */
export function refusSansCle360(env: Record<string, string | undefined> = process.env): string | null {
  if (!enProduction(env) || demoSurBoucleLocale(env) || clePieces(env)) return null;
  return 'Avis non enregistré : le chiffrement des réponses n’est pas configuré. Le service informatique définit CURSUS_PIECES_KEY (docs/SAUVEGARDE.md) ; réessayez ensuite.';
}

/** Contenu du tampon pour la sollicitation `sollicitationId` : chiffré avec la clé, en clair sans clé (hors production). */
export function sceller360(c: ContenuReponse360, sollicitationId: number, cle: Buffer | null = clePieces()): string {
  const clair = Buffer.from(JSON.stringify(c), 'utf8');
  if (!cle) return CLAIR + clair.toString('base64');
  const iv = randomBytes(12);
  const x = createCipheriv('aes-256-gcm', cle, iv);
  x.setAAD(authentifie(sollicitationId));
  const chiffre = Buffer.concat([x.update(clair), x.final()]);
  return ENTETE + Buffer.concat([iv, x.getAuthTag(), chiffre]).toString('base64');
}

/** Contenu d'une réponse du tampon, contrôlé ; erreur si la clé manque, ne convient pas, ou si la ligne a été déplacée. */
export function ouvrir360(v: string, sollicitationId: number, cle: Buffer | null = clePieces()): ContenuReponse360 {
  let clair: Buffer;
  if (v.startsWith(CLAIR)) clair = Buffer.from(v.slice(CLAIR.length), 'base64');
  else if (v.startsWith(ENTETE)) {
    if (!cle) throw new Error('réponse chiffrée, mais CURSUS_PIECES_KEY est absente de l’environnement du serveur');
    const b = Buffer.from(v.slice(ENTETE.length), 'base64');
    const d = createDecipheriv('aes-256-gcm', cle, b.subarray(0, 12));
    d.setAAD(authentifie(sollicitationId));
    d.setAuthTag(b.subarray(12, 28));
    clair = Buffer.concat([d.update(b.subarray(28)), d.final()]);
  } else throw new Error('réponse du tampon illisible');
  const brut = JSON.parse(clair.toString('utf8')) as { version?: unknown; notes?: unknown; verbatim?: unknown };
  const c = lireReponse360(brut);
  if (typeof c === 'string') throw new Error(`réponse du tampon invalide (${c})`);
  return { ...c, version: typeof brut.version === 'string' ? brut.version : c.version };
}

// ——— Versement par lot ———

/** Ordre aléatoire (Fisher-Yates, tirage de node:crypto ; `tirage` remplaçable par les tests). */
export function melanger<T>(l: readonly T[], tirage: (n: number) => number = n => randomInt(n)): T[] {
  const out = [...l];
  for (let i = out.length - 1; i > 0; i--) {
    const j = tirage(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Identifiant d'une réponse versée : aléatoire, sans ordre (ni compteur, ni horodatage). */
export const idReponse360 = () => randomBytes(12).toString('hex');

/** Sollicitations de l'entretien `entretienId`, lues en base (l'instantané d'une action peut précéder ses écritures). */
const sollicitationsDe = async (db: Db, entretienId: number) => await db.where<Sollicitation360>('feedbackSollicitations', 'entretienId', entretienId);
/** Réponses versées de l'entretien, lues en base (elles n'entrent jamais dans l'instantané). */
export const reponsesDe = async (db: Db, entretienId: number) => await db.where<Reponse360>('feedbackReponses', 'entretienId', entretienId);

/** Bilan d'une clôture de collecte : sollicitations envoyées, réponses reçues, versées (0 sous le seuil). */
export interface Cloture360 { envoyees: number; reponses: number; versees: number }

/**
 * Clôture de la collecte de l'entretien `x` (évaluateur, service RH, ou fenêtre échue) : réponses du tampon déchiffrées,
 * versées par lot dans un ordre aléatoire sous des identifiants aléatoires, sans répondant ni date de réception ; tampon
 * purgé ; sollicitations sans réponse passées « sans réponse » ; synthèse jointe à l'entretien. Sous le seuil, aucune
 * réponse n'est versée : la synthèse le dit, sans rien restituer. À appeler dans une transaction.
 */
export async function clore360(cx: { db: Db; ds: { settings: { feedback360Seuil: number } } }, x: Pick<Entretien, 'id'>, tirage?: (n: number) => number, quand = instant360()): Promise<Cloture360> {
  const { db } = cx;
  const sols = (await sollicitationsDe(db, x.id)).filter(s => sollicitationEnvoyee(s) && !s.closeLe);
  const ids = new Set(sols.map(s => s.id));
  const relation = new Map(sols.map(s => [s.id, s.relation] as const));
  const tampons = (await db.query<{ id: number; sollicitation_id: number; contenu: string }>('SELECT id, sollicitation_id, contenu FROM feedback_tampon')).filter(t => ids.has(t.sollicitation_id));
  const contenus = tampons.map(t => ({ relation: relation.get(t.sollicitation_id)!, c: ouvrir360(t.contenu, t.sollicitation_id) }));
  for (const t of tampons) await db.remove('feedbackTampon', t.id);
  const closeLe = quand;
  for (const s of sols) await db.update<Sollicitation360>('feedbackSollicitations', s.id, { statut: s.statut === 'envoyee' ? 'expiree' : s.statut, closeLe });
  const seuil = cx.ds.settings.feedback360Seuil;
  let versees = 0;
  if (contenus.length >= seuil) {
    const empId = (await db.get<Entretien>('entretiens', x.id))!.empId;
    for (const { relation: rel, c } of melanger(contenus, tirage)) {
      await db.insert('feedbackReponses', {
        id: idReponse360(), empId, entretienId: x.id, relation: rel, versionQuestionnaire: c.version, notes: c.notes,
        verbatim: c.verbatim, verbatimStatut: c.verbatim ? 'a_moderer' : null, modereLe: null, moderePar: null,
      });
      versees++;
    }
  }
  // Catégories sollicitées (et non celles qui ont répondu) : elles fixent les groupes de la synthèse et leurs intitulés.
  const sollicitees = RELATIONS_360.filter(r => sols.some(s => s.relation === r));
  await majSynthese360(db, x.id, { envoyees: sols.length, closeLe: jour360(closeLe), seuil, reponses: contenus.length, sollicitees });
  return { envoyees: sols.length, reponses: contenus.length, versees };
}

/**
 * Synthèse de l'entretien recalculée d'après ses réponses versées (clôture, relecture d'un commentaire) et jointe à
 * l'entretien. `reponses` : nombre reçu à la clôture quand rien n'a été versé (sous le seuil) ; sinon repris de la synthèse.
 */
export async function majSynthese360(db: Db, entretienId: number, o: { envoyees?: number; closeLe?: ISODate; seuil: number; reponses?: number; sollicitees?: Relation360[] }) {
  const x = await db.get<Entretien>('entretiens', entretienId);
  if (!x) return;
  const avant = (x.syntheseFeedback ?? null) as { envoyees?: number; closeLe?: string; sollicitees?: Relation360[] } | null;
  const rs = await reponsesDe(db, entretienId);
  // Après une relecture, les catégories sollicitées sont reprises de la synthèse (les sollicitations peuvent être purgées).
  const s = synthese360(rs, {
    envoyees: o.envoyees ?? avant?.envoyees ?? rs.length, closeLe: o.closeLe ?? avant?.closeLe ?? todayIso(), seuil: o.seuil,
    sollicitees: o.sollicitees ?? (Array.isArray(avant?.sollicitees) ? avant.sollicitees : undefined),
  });
  // Sous le seuil, rien n'a été versé : le nombre de réponses reçues reste le seul renseignement.
  if (o.reponses !== undefined && !rs.length) s.reponses = o.reponses;
  await db.update<Entretien>('entretiens', entretienId, { syntheseFeedback: s });
}

/**
 * Réponses brutes, tampon et sollicitations de l'entretien supprimés (clôture de l'entretien, conservation) ; la synthèse
 * reste jointe à l'entretien. Renvoie le nombre de lignes supprimées.
 */
export async function purgerEntretien360(db: Db, entretienId: number): Promise<number> {
  const t = await db.run('DELETE FROM feedback_tampon WHERE sollicitation_id IN (SELECT id FROM feedback_sollicitations WHERE entretien_id = ?)', [entretienId]);
  const r = await db.run('DELETE FROM feedback_reponses WHERE entretien_id = ?', [entretienId]);
  const s = await db.run('DELETE FROM feedback_sollicitations WHERE entretien_id = ?', [entretienId]);
  return t.changes + r.changes + s.changes;
}

// ——— Notifications (textes génériques) ———

/** Sollicitation envoyée, ou relance : au répondant, sans le nom de l'évalué (e-mail et téléphone). */
export async function notifierRepondant(cx: Ctx, repondantId: number, echeance: ISODate | null, relance = false) {
  await notifier(cx, repondantId, {
    type: relance ? 'feedback360.relance' : 'feedback360.demande',
    objet: relance ? 'Rappel : un avis vous est demandé' : 'Un avis vous est demandé',
    texte: `${relance ? 'Rappel : un' : 'Un'} collègue vous sollicite pour un avis confidentiel (feedback 360°)${echeance ? `, à donner avant le ${fmtIso(echeance)}` : ''}. `
      + 'Il se donne dans Cursus, « Avis demandés » ; vous pouvez aussi décliner. Votre avis n’est restitué qu’en moyenne, avec ceux des autres répondants, sans votre nom.',
  });
}

// ——— Tâche de fond ———

/** Lecteur des tâches de fond du feedback 360° (journal signé « Cursus »). */
const SYSTEME: CurrentUser = { role: 'rh', empId: null, nom: 'Cursus', intitule: 'Feedback 360°', profilRh: 'rh_admin' };

/**
 * Passage de la tâche horaire (server/src/conservation.ts, `demarrerConservation`) : fenêtres échues closes et versées,
 * répondants sans réponse relancés 3 jours avant l'échéance (une fois), collectes closes depuis plus de
 * `feedback360ConservationMois` après leur envoi purgées (synthèse gardée). Lecture complète de la base seulement s'il y a
 * quelque chose à faire. Renvoie les nombres de collectes closes, de relances et de collectes purgées.
 */
export async function tacheFeedback360(db: Db, today: ISODate = todayIso()): Promise<{ closes: number; relances: number; purgees: number }> {
  const bilan = { closes: 0, relances: 0, purgees: 0 };
  const sols = await db.all<Sollicitation360>('feedbackSollicitations');
  if (!sols.length) return bilan;
  // Fenêtres échues : clôture automatique, entretien par entretien (une transaction chacun).
  const echues = [...new Set(sols.filter(s => sollicitationEnvoyee(s) && !s.closeLe && !!s.echeance && s.echeance < today).map(s => s.entretienId))];
  for (const entretienId of echues) {
    await db.tx(async () => {
      const ds = await loadFull(db, SYSTEME);
      const x = ds.entretiens.find(y => y.id === entretienId);
      if (!x) return;
      const r = await clore360({ db, ds }, x, undefined, instantDu(today));
      await journaliser(db, {
        actor: 'Cursus', role: null, action: 'feedback360.clore', salaries: [x.empId], payload: { entretienId, envoyees: r.envoyees, reponses: r.reponses, versees: r.versees, auto: true },
        message: `Feedback 360° : fenêtre échue, collecte close — ${plural(r.reponses, 'réponse reçue', 'réponses reçues')} sur ${r.envoyees}`,
      });
      bilan.closes++;
    });
  }
  // Relance automatique : une par répondant, avant l'échéance (jamais nominative au journal).
  const aRelancer = aRelancer360(sols.filter(s => !echues.includes(s.entretienId)), today);
  if (aRelancer.length) {
    await db.tx(async () => {
      const ds = await loadFull(db, SYSTEME);
      if (!ds.settings.feedback360Actif) return;
      const cx = makeCtx(db, SYSTEME, ds);
      const relanceeLe = instantDu(today);
      for (const s of aRelancer) {
        await db.update<Sollicitation360>('feedbackSollicitations', s.id, { relanceeLe });
        await notifierRepondant(cx, s.repondantEmpId, s.echeance, true);
      }
      const entretiens = [...new Set(aRelancer.map(s => s.entretienId))];
      await journaliser(db, {
        actor: 'Cursus', role: null, action: 'feedback360.relancer', salaries: [...new Set(aRelancer.map(s => s.empId))],
        payload: { entretiens, relances: aRelancer.length, auto: true }, message: `Feedback 360° : ${plural(aRelancer.length, 'répondant relancé', 'répondants relancés')} avant l’échéance`,
      });
      bilan.relances = aRelancer.length;
    });
  }
  // Conservation : collectes closes envoyées avant la limite (6 mois au plus), réponses brutes et sollicitations supprimées.
  const limite = limiteConservation360(today, (await loadSettings(db)).feedback360ConservationMois);
  const parEntretien = new Map<number, Sollicitation360[]>();
  for (const x of sols) parEntretien.set(x.entretienId, [...(parEntretien.get(x.entretienId) ?? []), x]);
  const anciennes = [...parEntretien].filter(([id, l]) => !echues.includes(id) && l.some(y => y.closeLe) && l.every(y => !sollicitationEnvoyee(y) || !!y.closeLe)
    && l.some(y => y.envoyeeLe && jour360(y.envoyeeLe) < limite));
  if (anciennes.length) {
    await db.tx(async () => {
      for (const [id] of anciennes) await purgerEntretien360(db, id);
      await journaliser(db, {
        actor: 'Cursus', role: null, action: 'feedback360.purge', salaries: [...new Set(anciennes.flatMap(([, l]) => l.map(y => y.empId)))],
        payload: { entretiens: anciennes.map(([id]) => id), limite }, message: `Feedback 360° : réponses brutes de ${plural(anciennes.length, 'collecte', 'collectes')} supprimées (envoyées avant le ${fmtIso(limite)})`,
      });
    });
    bilan.purgees = anciennes.length;
  }
  return bilan;
}

// ——— Routes ———

/**
 * Commentaires des réponses versées, pour la relecture du service RH : identifiant (aléatoire), entretien, évalué,
 * commentaire et décision, dans l'ordre des identifiants ; jamais la relation de l'auteur ni ses notes. `soi` : salarié
 * du compte RH, dont les commentaires sont relus par un autre membre du service RH.
 */
export async function commentaires360(db: Db, soi: number | null) {
  const l = await db.query<{ id: string; entretien_id: number; emp_id: number; verbatim: string; verbatim_statut: 'a_moderer' | 'retenu' | 'retire' | null }>(
    'SELECT id, entretien_id, emp_id, verbatim, verbatim_statut FROM feedback_reponses WHERE verbatim IS NOT NULL ORDER BY id');
  return l.filter(v => v.emp_id !== soi).map(v => ({ id: v.id, entretienId: v.entretien_id, empId: v.emp_id, verbatim: v.verbatim, statut: v.verbatim_statut }));
}

/**
 * GET /api/feedback360/moderation : commentaires des réponses versées, à relire par le service RH (droit « rh ») avant
 * leur restitution ; ni relation de l'auteur, ni notes, dans l'ordre des identifiants (aléatoire).
 * GET /api/feedback360/reponse/:id : réponse en attente du versement, relue par son seul auteur (le répondant de la
 * sollicitation), tant que la collecte est ouverte ; jamais en cache.
 */
export function routesFeedback360(db: Db): Router {
  const r = express.Router();

  r.get('/api/feedback360/moderation', async (req: Request, res: Response) => {
    const id = await identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    if (!droitsRh(id.user).includes('rh')) {
      await db.tx(async () => await tracerRefus(db, id, 'Feedback 360° : relecture des commentaires', 'réservé au service RH'));
      return res.status(403).json({ error: 'Relecture des commentaires réservée au service RH' });
    }
    const commentaires = await db.lecture(async () => await commentaires360(db, id.user.salarieId ?? null));
    res.set('Cache-Control', 'no-store');
    res.json({ commentaires });
  });

  r.get('/api/feedback360/reponse/:id', async (req: Request, res: Response) => {
    const id = await identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    const sid = Number(req.params.id);
    const lu = await db.lecture(async () => {
      const s = Number.isInteger(sid) ? await db.get<Sollicitation360>('feedbackSollicitations', sid) : undefined;
      if (!s || id.user.empId == null || s.repondantEmpId !== id.user.empId) return null;
      const t = await db.one<{ contenu: string }>('SELECT contenu FROM feedback_tampon WHERE sollicitation_id = ?', [s.id]);
      return { s, t };
    });
    res.set('Cache-Control', 'no-store');
    if (!lu) return res.status(404).json({ error: 'Sollicitation introuvable' });
    if (lu.s.closeLe || !lu.t) return res.json({ reponse: null });
    res.json({ reponse: ouvrir360(lu.t.contenu, lu.s.id) });
  });

  return r;
}
