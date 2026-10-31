// Routes des appels entrants de Keystone, montées sur /api/integrations/keystone : version 1 sous /v1
// (contrat : docs/keystone-openapi.json, guide : docs/API-KEYSTONE.md) et anciennes routes gardées comme
// alias obsolètes. Toutes exigent l'en-tête X-Api-Key. Chaque appel authentifié est tracé dans le journal
// (méthode, chemin, statut, référence), jamais le contenu reçu : seuls des identifiants Keystone y figurent.
// Les appels sans clé valide, que n'importe qui peut émettre, sont seulement comptés et résumés.
import express, { type NextFunction, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { Domain } from '../../../shared/domain.ts';
import { plural } from '../../../shared/format.ts';
import type { Chantier, CurrentUser, DemandeKeystone, Destination, Formation, HabType } from '../../../shared/types.ts';
import { LimiteParIp } from '../auth.ts';
import { loadFull, todayIso } from '../dataset.ts';
import { jeuEnLecture } from '../cache-instantane.ts';
import type { Db } from '../db.ts';
import { ATTENTE_OCCUPE, CURSUS_OCCUPE, estOccupe } from '../erreurs.ts';
import { cheminJournal, log } from '../logs.ts';
import { KEYSTONE_API_KEY, keystoneKeyOk } from './keystone.ts';
import { suivreVerdicts } from './keystone-verdicts.ts';
import {
  ErreurKeystone, IDENTIFIANT, bilanTexte, contexte, correspondance, dateReelle, demandeApi, enregistrerAffectation, enregistrerChantier, enregistrerProjet,
  enregistrerTache, recevoirDemande, supprimerAffectation, supprimerTache, synchroniser, type Ecriture,
} from './keystone-entrant.ts';

/** Utilisateur technique des lectures (périmètre complet, comme le service RH). */
const KEYSTONE: CurrentUser = { role: 'rh', empId: null, nom: 'Keystone', intitule: 'Intégration' };
const BASE = '/api/integrations/keystone';
const SPEC = new URL('../../../docs/keystone-openapi.json', import.meta.url);

type Reponse = { status?: number; body: unknown };
type Traitement = (db: Db, req: Request, res: Response) => Reponse | Promise<Reponse>;
/** Route de la version 1 : méthode, chemin au format OpenAPI ({id}), traitement. */
type RouteV1 = [method: 'get' | 'put' | 'post' | 'delete', path: string, fn: Traitement];

/** Réponse d'une écriture : 201 à la création, 200 sinon (mise à jour ou envoi identique). */
function ecriture<T>(res: Response, nom: string, r: Ecriture<T>): Reponse {
  res.locals.resultat = r.resultat;
  return { status: r.resultat === 'cree' ? 201 : 200, body: { resultat: r.resultat, [nom]: r.objet } };
}

/** Identifiant de l'URL ; noté au journal seulement s'il a la forme d'un identifiant (le contrôle suit). */
const param = (req: Request, res: Response, nom: string) => {
  const v = String(req.params[nom]);
  if (IDENTIFIANT.test(v)) res.locals.reference = v;
  return v;
};

/** Verdict d'un chantier actif ; inconnu : 404, archivé : 410. */
async function evaluer(db: Db, id: string) {
  const c = await db.get<Chantier>('chantiers', id);
  if (!c) throw new ErreurKeystone(404, 'CHANTIER_INCONNU', 'Chantier inconnu');
  if (c.statut === 'archive') throw new ErreurKeystone(410, 'CHANTIER_ARCHIVE', 'Chantier archivé : plus de verdict Go / No Go');
  // Lecture partagée du cache dans la lecture stable de la route (lot 10, chantier A), comme loadFull(db, KEYSTONE).
  const full = await jeuEnLecture(db, KEYSTONE, todayIso(), async u => await loadFull(db, u));
  const d = new Domain(full);
  const ch = d.evaluateChantiers(d.enrich(full.settings.horizonAlerte, false), d.tripsAll()).find(x => x.c.id === id)!;
  return { d, ch, detail: full.settings.partageKeystone === 'detaille', evalueLe: new Date().toISOString() };
}

let spec: unknown = null;

/** Routes de la version 1, dans l'ordre de la spécification OpenAPI (cohérence vérifiée par les tests). */
export const ROUTES_V1: RouteV1[] = [
  ['get', '/openapi.json', () => {
    spec ??= JSON.parse(readFileSync(SPEC, 'utf8'));
    return { body: spec };
  }],
  // Éléments archivés compris (`archive` : date d'archivage) : leur code reste reçu, mais ne doit plus être proposé.
  ['get', '/referentiels', async db => ({
    body: {
      habilitations: (await db.all<HabType>('habilitations', 'rowid')).map(h => ({ code: h.id, nom: h.nom, archive: h.archive ?? null })),
      certifications: (await db.all<Formation>('formations', 'rowid')).map(f => ({ code: f.id, nom: f.nom, archive: f.archive ?? null })),
      destinations: (await db.all<Destination>('destinations', 'rowid')).map(d => ({ code: d.code, pays: d.pays, archive: d.archive ?? null })),
    },
  })],
  ['put', '/projets/{code}', async (db, req, res) => ecriture(res, 'projet', await db.tx(async () => await enregistrerProjet(await contexte(db), param(req, res, 'code'), req.body)))],
  ['put', '/chantiers/{id}', async (db, req, res) => ecriture(res, 'chantier', await db.tx(async () => await enregistrerChantier(await contexte(db), param(req, res, 'id'), req.body)))],
  ['get', '/chantiers/{id}/go-no-go', async (db, req, res) => {
    const { d, ch, detail, evalueLe } = await evaluer(db, param(req, res, 'id'));
    return { body: d.verdictKeystone(ch, detail, evalueLe) };
  }],
  ['put', '/affectations/{id}', async (db, req, res) => ecriture(res, 'affectation', await db.tx(async () => await enregistrerAffectation(await contexte(db), param(req, res, 'id'), req.body)))],
  ['delete', '/affectations/{id}', async (db, req, res) => {
    await db.tx(async () => await supprimerAffectation(db, param(req, res, 'id')));
    res.locals.resultat = 'supprime';
    return { body: { resultat: 'supprime' } };
  }],
  ['put', '/taches/{id}', async (db, req, res) => ecriture(res, 'tache', await db.tx(async () => await enregistrerTache(await contexte(db), param(req, res, 'id'), req.body)))],
  ['delete', '/taches/{id}', async (db, req, res) => {
    await db.tx(async () => await supprimerTache(db, param(req, res, 'id')));
    res.locals.resultat = 'supprime';
    return { body: { resultat: 'supprime' } };
  }],
  ['put', '/instantane', async (db, req, res) => {
    const bilan = await db.tx(async () => await synchroniser(await contexte(db), req.body));
    res.locals.resultat = bilanTexte(bilan);
    return { body: { resultat: 'synchronise', bilan } };
  }],
  ['post', '/demandes', async (db, req, res) => {
    res.locals.reference = referenceTracee(req.body);
    const dm = await db.tx(async () => await recevoirDemande(await contexte(db), req.body, todayIso(), true));
    res.locals.resultat = 'cree';
    return { status: 201, body: { resultat: 'cree', demande: demandeApi(dm, (await correspondance(db)).matricule) } };
  }],
  ['get', '/demandes/{reference}', async (db, req, res) => {
    const dm = (await db.where<DemandeKeystone>('demandesKeystone', 'ref', param(req, res, 'reference')))[0];
    if (!dm) throw new ErreurKeystone(404, 'DEMANDE_INCONNUE', 'Demande inconnue');
    return { body: { demande: demandeApi(dm, (await correspondance(db)).matricule) } };
  }],
];

/** Référence d'une demande reçue, notée au journal seulement si elle a la forme d'un identifiant. */
function referenceTracee(body: unknown): string | null {
  const r = (body as { reference?: unknown } | null)?.reference;
  return typeof r === 'string' && IDENTIFIANT.test(r) ? r : null;
}

/** Chemin tracé : un segment qui n'a pas la forme d'un identifiant (texte libre, encodé…) est remplacé par « … ». */
const cheminTrace = (chemin: string) => chemin.split('/').map(x => (!x || IDENTIFIANT.test(x) ? x : '…')).join('/').slice(0, 200);

/**
 * Nom d'un champ refusé, tracé : le chemin est fixé par Cursus (`chantiers[2].fin`), sauf les clés de l'objet
 * `heures`, choisies par l'appelant : remplacées par « <date> » ou « <clé invalide> », jamais recopiées.
 */
function champTrace(champ: string): string {
  const m = /^(.*?\bheures)\.(.+)$/.exec(champ);
  const fixe = m ? m[1] : champ;
  if (!/^[A-Za-z]+(\[\d{1,6}\])?(\.[A-Za-z]+(\[\d{1,6}\])?)*$/.test(fixe)) return '<champ>';
  return (m ? `${fixe}.${dateReelle(m[2]) ? '<date>' : '<clé invalide>'}` : fixe).slice(0, 64);
}

/** Réponse d'erreur envoyée à la place d'une réponse dont la trace a échoué, sans passer par la trace. */
function erreurNonTracee(res: Response, json: Response['json'], status: number, code: string, message: string) {
  res.locals.resultat = undefined;
  res.status(status);
  json({ error: message, code });
}

function erreur(res: Response, e: ErreurKeystone) {
  res.status(e.status).json({ error: e.message, code: e.code, ...(e.details.length ? { details: e.details } : {}), ...e.extra });
}

/** Trace l'appel juste avant la réponse (le journal est écrit même si l'écriture a été annulée). */
async function tracer(db: Db, req: Request, res: Response, body: unknown) {
  const chemin = cheminTrace(req.originalUrl.split('?')[0].slice(BASE.length) || '/');
  const statut = res.statusCode, reference: string | null = res.locals.reference ?? null;
  const b = body as { code?: string; details?: { champ: string }[] } | null;
  const champs = statut >= 400 && b?.details ? [...new Set(b.details.map(x => champTrace(x.champ)))].slice(0, 20) : [];
  const detail = statut >= 400 ? `${b?.code ?? 'ERREUR'}${champs.length ? ` (${champs.join(', ')})` : ''}` : res.locals.resultat ?? '';
  // Courte transaction à part, après la lecture ou l'écriture de l'appel (lot 8, chantier E).
  await db.tx(async () => await db.insert('journal', {
    at: new Date().toISOString(), actor: 'Keystone', role: 'integration', action: 'keystone.appel',
    message: `${req.method} ${chemin} → ${statut}${detail ? ` · ${detail}` : ''}${reference ? ` · réf. ${reference}` : ''}`,
    payload: { methode: req.method, chemin, statut, reference, version: chemin.startsWith('/v1/') ? 'v1' : 'obsolete', ...(statut >= 400 ? { erreur: b?.code ?? null, champs } : { resultat: res.locals.resultat ?? null }) },
  }));
}

/**
 * Exécute un traitement : réponse JSON, ou refus documenté (ErreurKeystone) ; le reste va au gestionnaire d'erreurs.
 * Lecture (GET) : sur un même état de la base, hors du verrou d'écriture (`Db.lecture`, lot 8, chantier E) ; la trace de
 * l'appel suit, dans sa propre courte transaction (`tracer`). Écriture : seule sur la base (`enSerie`), dans une
 * transaction où les verdicts Go / No Go changés sont signalés à Keystone.
 */
const executer = (db: Db, fn: Traitement) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = req.method === 'GET' ? await db.lecture(async () => await fn(db, req, res)) : await db.exclusif(async () => await db.tx(async () => {
      const r = await fn(db, req, res);
      await suivreVerdicts(db);
      return r;
    }));
    res.status(r.status ?? 200).json(r.body);
  } catch (e) {
    if (e instanceof ErreurKeystone) erreur(res, e);
    else next(e);
  }
};

/**
 * Appels refusés sans clé valide (401, 503) : n'importe qui peut en émettre. Une ligne chacun laisserait un
 * inconnu remplir le journal ; ils sont comptés, puis résumés en une seule ligne `intervalle` ms après le
 * premier (une minute par défaut), sans chemin ni contenu reçus.
 */
function refusResumes(db: Db, intervalle: number) {
  let refus: { n: number; statuts: Record<number, number>; du: Date } | null = null;
  const resumer = async () => {
    const r = refus;
    refus = null;
    if (!r) return;
    const statuts = Object.entries(r.statuts).map(([s, n]) => `${s} × ${n}`).join(', ');
    try {
      await db.insert('journal', {
        at: new Date().toISOString(), actor: 'Keystone', role: 'integration', action: 'keystone.appel',
        message: `${plural(r.n, 'appel refusé', 'appels refusés')} sans clé valide (${statuts}) depuis ${r.du.toLocaleTimeString('fr-FR')}`,
        payload: { refuses: r.n, statuts: r.statuts, du: r.du.toISOString() },
      });
    } catch (err) {
      console.error(err);
    }
  };
  return (statut: number) => {
    if (!refus) {
      refus = { n: 0, statuts: {}, du: new Date() };
      setTimeout(resumer, intervalle).unref();
    }
    refus.n++;
    refus.statuts[statut] = (refus.statuts[statut] ?? 0) + 1;
  };
}

/**
 * Routes Keystone, à monter avant l'analyse JSON globale : elles lisent elles-mêmes le corps, une fois la clé vérifiée.
 * `resumeRefus` : délai du résumé des appels refusés sans clé valide, en millisecondes.
 * `clesInvalides` : appels sans clé valide par adresse IP ; au-delà du seuil (60 en 5 minutes), cette adresse reçoit
 * 429 (Retry-After) sans que la clé soit lue, jusqu'à la fin de la fenêtre. Keystone, qui a la bonne clé, n'y compte pas.
 */
export function keystoneRoutes(db: Db, { resumeRefus = 60_000, clesInvalides = new LimiteParIp(60, 5 * 60_000) } = {}) {
  const router = express.Router();
  const compterRefus = refusResumes(db, resumeRefus);
  // Journal : chaque réponse à un appel authentifié ; les refus de clé sont comptés à part. La réponse part une fois
  // l'appel tracé (écriture asynchrone) : un appelant qui lit le journal aussitôt après la réponse y trouve son appel.
  // Aucune réponse ne part sans sa trace (lot 8, chantier E) : trace impossible après une lecture (GET, rien d'écrit),
  // la réponse prévue est remplacée par 503 `OCCUPE` (Cursus occupé, Retry-After) ou 500, sans retracer ; après une
  // écriture validée, la trace est retentée une fois, puis, si elle échoue encore, la réponse part (l'écriture est
  // faite : un 503 la ferait refaire) et l'absence de trace est écrite en erreur dans les journaux du serveur.
  router.use((req, res, next) => {
    const json = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (!res.locals.cleValide) {
        compterRefus(res.statusCode);
        return json(body);
      }
      void (async () => {
        try {
          await tracer(db, req, res, body);
        } catch (err) {
          if (req.method === 'GET') {
            if (estOccupe(err)) return erreurNonTracee(res.set('Retry-After', String(ATTENTE_OCCUPE)), json, 503, 'OCCUPE', CURSUS_OCCUPE);
            log.erreur(`API Keystone : appel non tracé, réponse refusée (${req.method} ${cheminJournal(req.originalUrl)})`, { cause: err instanceof Error ? err.message : String(err) });
            return erreurNonTracee(res, json, 500, 'ERREUR_INTERNE', 'Erreur interne');
          }
          try {
            await tracer(db, req, res, body);
          } catch (err2) {
            log.erreur(`API Keystone : écriture faite, appel non tracé (${req.method} ${cheminJournal(req.originalUrl)})`, { cause: err2 instanceof Error ? err2.message : String(err2) });
          }
        }
        json(body);
      })();
      return res;
    }) as Response['json'];
    next();
  });
  router.use((req, res, next) => {
    if (!KEYSTONE_API_KEY) return erreur(res, new ErreurKeystone(503, 'NON_CONFIGUREE', 'Intégration Keystone non configurée'));
    const ip = req.ip ?? req.socket.remoteAddress ?? '';
    if (clesInvalides.depasse(ip)) {
      res.set('Retry-After', String(clesInvalides.attente(ip)));
      return erreur(res, new ErreurKeystone(429, 'TROP_DE_CLES_INVALIDES', 'Trop d’appels sans clé valide depuis cette adresse : réessayez après le délai indiqué (Retry-After)'));
    }
    if (!keystoneKeyOk(req.get('x-api-key'))) {
      clesInvalides.echec(ip);
      return erreur(res, new ErreurKeystone(401, 'CLE_INVALIDE', 'Clé API invalide'));
    }
    res.locals.cleValide = true;
    if ((req.method === 'PUT' || req.method === 'POST') && !req.is('application/json')) {
      return erreur(res, new ErreurKeystone(415, 'TYPE_NON_PRIS_EN_CHARGE', 'Corps JSON attendu (en-tête Content-Type: application/json)'));
    }
    next();
  });
  router.use(express.json({ limit: '2mb' }));

  for (const [method, path, fn] of ROUTES_V1) router[method](`/v1${path.replace(/\{(\w+)\}/g, ':$1')}`, executer(db, fn));

  // Anciennes routes (avant /v1) : alias obsolètes, réponses inchangées, mêmes contrôles et même journal.
  const obsolete = (successeur: string) => (_req: Request, res: Response, next: NextFunction) => {
    res.set('Deprecation', 'true');
    res.set('Link', `<${BASE}/v1${successeur}>; rel="successor-version"`);
    next();
  };
  router.get('/chantiers/:id/go-no-go', obsolete('/chantiers/{id}/go-no-go'), executer(db, async (db, req, res) => {
    const { d, ch, detail, evalueLe } = await evaluer(db, param(req, res, 'id'));
    return { body: d.keystonePayload(ch, detail, evalueLe) };
  }));
  router.post('/demandes', obsolete('/demandes'), executer(db, async (db, req, res) => {
    res.locals.reference = referenceTracee(req.body);
    const dm = await db.tx(async () => await recevoirDemande(await contexte(db), req.body, todayIso(), false));
    res.locals.resultat = 'cree';
    return { status: 201, body: { id: dm.id, statut: 'en_attente_rh' } };
  }));

  router.use((_req, res) => erreur(res, new ErreurKeystone(404, 'ROUTE_INCONNUE', 'Route inconnue de l’API Keystone (voir /v1/openapi.json)')));
  // Corps illisible ou trop volumineux, erreur imprévue : réponse JSON tracée comme les autres.
  router.use((err: { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.parse.failed') return erreur(res, new ErreurKeystone(400, 'JSON_INVALIDE', 'Corps JSON illisible'));
    if (err?.type === 'entity.too.large') return erreur(res, new ErreurKeystone(413, 'CORPS_TROP_VOLUMINEUX', 'Corps de plus de 2 Mo : envoyez l’instantané en plusieurs sections'));
    if (err?.status && err.status >= 400 && err.status < 500) return erreur(res, new ErreurKeystone(err.status, 'CORPS_INVALIDE', 'Corps de requête refusé'));
    // Délai du serveur PostgreSQL dépassé (verrou, requête) : rien n'est écrit, l'appel peut être refait (Retry-After).
    if (estOccupe(err)) return erreur(res.set('Retry-After', String(ATTENTE_OCCUPE)), new ErreurKeystone(503, 'OCCUPE', CURSUS_OCCUPE));
    console.error(err);
    erreur(res, new ErreurKeystone(500, 'ERREUR_INTERNE', 'Erreur interne'));
  });
  return router;
}
