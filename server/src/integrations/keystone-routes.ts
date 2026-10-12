// Routes des appels entrants de Keystone, montées sur /api/integrations/keystone : version 1 sous /v1
// (contrat : docs/keystone-openapi.json, guide : docs/API-KEYSTONE.md) et anciennes routes gardées comme
// alias obsolètes. Toutes exigent l'en-tête X-Api-Key. Chaque appel est tracé dans le journal (méthode,
// chemin, statut, référence), jamais le contenu reçu : seuls des identifiants Keystone y figurent.
import express, { type NextFunction, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { Domain } from '../../../shared/domain.ts';
import type { Chantier, CurrentUser, DemandeKeystone, Destination, Formation, HabType } from '../../../shared/types.ts';
import { loadFull, todayIso } from '../dataset.ts';
import type { Db } from '../db.ts';
import { KEYSTONE_API_KEY, keystoneKeyOk } from './keystone.ts';
import {
  ErreurKeystone, bilanTexte, contexte, demandeApi, enregistrerAffectation, enregistrerChantier, enregistrerProjet, enregistrerTache,
  recevoirDemande, supprimerAffectation, supprimerTache, synchroniser, type Ecriture,
} from './keystone-entrant.ts';

/** Utilisateur technique des lectures (périmètre complet, comme le service RH). */
const KEYSTONE: CurrentUser = { role: 'rh', empId: null, nom: 'Keystone', intitule: 'Intégration' };
const BASE = '/api/integrations/keystone';
const SPEC = new URL('../../../docs/keystone-openapi.json', import.meta.url);

type Reponse = { status?: number; body: unknown };
type Traitement = (db: Db, req: Request, res: Response) => Reponse;
/** Route de la version 1 : méthode, chemin au format OpenAPI ({id}), traitement. */
type RouteV1 = [method: 'get' | 'put' | 'post' | 'delete', path: string, fn: Traitement];

/** Réponse d'une écriture : 201 à la création, 200 sinon (mise à jour ou envoi identique). */
function ecriture<T>(res: Response, nom: string, r: Ecriture<T>): Reponse {
  res.locals.resultat = r.resultat;
  return { status: r.resultat === 'cree' ? 201 : 200, body: { resultat: r.resultat, [nom]: r.objet } };
}

const param = (req: Request, res: Response, nom: string) => {
  const v = String(req.params[nom]);
  res.locals.reference = v;
  return v;
};

/** Verdict d'un chantier actif ; inconnu : 404, archivé : 410. */
function evaluer(db: Db, id: string) {
  const c = db.get<Chantier>('chantiers', id);
  if (!c) throw new ErreurKeystone(404, 'CHANTIER_INCONNU', 'Chantier inconnu');
  if (c.statut === 'archive') throw new ErreurKeystone(410, 'CHANTIER_ARCHIVE', 'Chantier archivé : plus de verdict Go / No Go');
  const full = loadFull(db, KEYSTONE);
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
  ['get', '/referentiels', db => ({
    body: {
      habilitations: db.all<HabType>('habilitations', 'rowid').map(h => ({ code: h.id, nom: h.nom })),
      certifications: db.all<Formation>('formations', 'rowid').map(f => ({ code: f.id, nom: f.nom })),
      destinations: db.all<Destination>('destinations', 'rowid').map(d => ({ code: d.code, pays: d.pays })),
    },
  })],
  ['put', '/projets/{code}', (db, req, res) => ecriture(res, 'projet', db.tx(() => enregistrerProjet(contexte(db), param(req, res, 'code'), req.body)))],
  ['put', '/chantiers/{id}', (db, req, res) => ecriture(res, 'chantier', db.tx(() => enregistrerChantier(contexte(db), param(req, res, 'id'), req.body)))],
  ['get', '/chantiers/{id}/go-no-go', (db, req, res) => {
    const { d, ch, detail, evalueLe } = evaluer(db, param(req, res, 'id'));
    return { body: d.verdictKeystone(ch, detail, evalueLe) };
  }],
  ['put', '/affectations/{id}', (db, req, res) => ecriture(res, 'affectation', db.tx(() => enregistrerAffectation(contexte(db), param(req, res, 'id'), req.body)))],
  ['delete', '/affectations/{id}', (db, req, res) => {
    db.tx(() => supprimerAffectation(db, param(req, res, 'id')));
    res.locals.resultat = 'supprime';
    return { body: { resultat: 'supprime' } };
  }],
  ['put', '/taches/{id}', (db, req, res) => ecriture(res, 'tache', db.tx(() => enregistrerTache(contexte(db), param(req, res, 'id'), req.body)))],
  ['delete', '/taches/{id}', (db, req, res) => {
    db.tx(() => supprimerTache(db, param(req, res, 'id')));
    res.locals.resultat = 'supprime';
    return { body: { resultat: 'supprime' } };
  }],
  ['put', '/instantane', (db, req, res) => {
    const bilan = db.tx(() => synchroniser(contexte(db), req.body));
    res.locals.resultat = bilanTexte(bilan);
    return { body: { resultat: 'synchronise', bilan } };
  }],
  ['post', '/demandes', (db, req, res) => {
    res.locals.reference = referenceTracee(req.body);
    const dm = db.tx(() => recevoirDemande(contexte(db), req.body, todayIso(), true));
    res.locals.resultat = 'cree';
    return { status: 201, body: { resultat: 'cree', demande: demandeApi(dm) } };
  }],
  ['get', '/demandes/{reference}', (db, req, res) => {
    const dm = db.where<DemandeKeystone>('demandesKeystone', 'ref', param(req, res, 'reference'))[0];
    if (!dm) throw new ErreurKeystone(404, 'DEMANDE_INCONNUE', 'Demande inconnue');
    return { body: { demande: demandeApi(dm) } };
  }],
];

/** Référence d'une demande reçue, notée au journal seulement si elle a la forme d'un identifiant. */
function referenceTracee(body: unknown): string | null {
  const r = (body as { reference?: unknown } | null)?.reference;
  return typeof r === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(r) ? r : null;
}

function erreur(res: Response, e: ErreurKeystone) {
  res.status(e.status).json({ error: e.message, code: e.code, ...(e.details.length ? { details: e.details } : {}), ...e.extra });
}

/** Trace l'appel juste avant la réponse (le journal est écrit même si l'écriture a été annulée). */
function tracer(db: Db, req: Request, res: Response, body: unknown) {
  const chemin = (req.originalUrl.split('?')[0].slice(BASE.length) || '/').slice(0, 200);
  const statut = res.statusCode, reference: string | null = res.locals.reference ?? null;
  const b = body as { code?: string; details?: { champ: string }[] } | null;
  const champs = statut >= 400 && b?.details ? [...new Set(b.details.map(x => x.champ))].slice(0, 20) : [];
  const detail = statut >= 400 ? `${b?.code ?? 'ERREUR'}${champs.length ? ` (${champs.join(', ')})` : ''}` : res.locals.resultat ?? '';
  db.insert('journal', {
    at: new Date().toISOString(), actor: 'Keystone', role: 'integration', action: 'keystone.appel',
    message: `${req.method} ${chemin} → ${statut}${detail ? ` · ${detail}` : ''}${reference ? ` · réf. ${reference}` : ''}`,
    payload: { methode: req.method, chemin, statut, reference, version: chemin.startsWith('/v1/') ? 'v1' : 'obsolete', ...(statut >= 400 ? { erreur: b?.code ?? null, champs } : { resultat: res.locals.resultat ?? null }) },
  });
}

/** Exécute un traitement : réponse JSON, ou refus documenté (ErreurKeystone) ; le reste va au gestionnaire d'erreurs. */
const executer = (db: Db, fn: Traitement) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = fn(db, req, res);
    res.status(r.status ?? 200).json(r.body);
  } catch (e) {
    if (e instanceof ErreurKeystone) erreur(res, e);
    else next(e);
  }
};

/** Routes Keystone, à monter avant l'analyse JSON globale : elles lisent elles-mêmes le corps, une fois la clé vérifiée. */
export function keystoneRoutes(db: Db) {
  const router = express.Router();
  // Journal : chaque réponse, y compris les refus de clé.
  router.use((req, res, next) => {
    const json = res.json.bind(res);
    res.json = ((body: unknown) => {
      try { tracer(db, req, res, body); } catch (err) { console.error(err); }
      return json(body);
    }) as Response['json'];
    next();
  });
  router.use((req, res, next) => {
    if (!KEYSTONE_API_KEY) return erreur(res, new ErreurKeystone(503, 'NON_CONFIGUREE', 'Intégration Keystone non configurée'));
    if (!keystoneKeyOk(req.get('x-api-key'))) return erreur(res, new ErreurKeystone(401, 'CLE_INVALIDE', 'Clé API invalide'));
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
  router.get('/chantiers/:id/go-no-go', obsolete('/chantiers/{id}/go-no-go'), executer(db, (db, req, res) => {
    const { d, ch, detail, evalueLe } = evaluer(db, param(req, res, 'id'));
    return { body: d.keystonePayload(ch, detail, evalueLe) };
  }));
  router.post('/demandes', obsolete('/demandes'), executer(db, (db, req, res) => {
    res.locals.reference = referenceTracee(req.body);
    const dm = db.tx(() => recevoirDemande(contexte(db), req.body, todayIso(), false));
    res.locals.resultat = 'cree';
    return { status: 201, body: { id: dm.id, statut: 'en_attente_rh' } };
  }));

  router.use((_req, res) => erreur(res, new ErreurKeystone(404, 'ROUTE_INCONNUE', 'Route inconnue de l’API Keystone (voir /v1/openapi.json)')));
  // Corps illisible ou trop volumineux, erreur imprévue : réponse JSON tracée comme les autres.
  router.use((err: { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.parse.failed') return erreur(res, new ErreurKeystone(400, 'JSON_INVALIDE', 'Corps JSON illisible'));
    if (err?.type === 'entity.too.large') return erreur(res, new ErreurKeystone(413, 'CORPS_TROP_VOLUMINEUX', 'Corps de plus de 2 Mo : envoyez l’instantané en plusieurs sections'));
    if (err?.status && err.status >= 400 && err.status < 500) return erreur(res, new ErreurKeystone(err.status, 'CORPS_INVALIDE', 'Corps de requête refusé'));
    console.error(err);
    erreur(res, new ErreurKeystone(500, 'ERREUR_INTERNE', 'Erreur interne'));
  });
  return router;
}
