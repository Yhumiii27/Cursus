#!/usr/bin/env node
// Garde-fou de la couche d'accès asynchrone (server/src/db.ts, adaptateurs SqliteDb et PgDb de server/src/db-pg.ts) :
// promesse jamais oubliée, connexions SQLite et PostgreSQL jamais utilisées en direct par le code applicatif. Lancé par `npm run typecheck` (donc par `npm run check` et la CI).
//
// Pourquoi un script plutôt qu'ESLint : le dépôt n'a pas d'ESLint, et la règle `no-floating-promises` de
// typescript-eslint demande l'API de TypeScript 5, absente de TypeScript 7 (compilateur natif, sans API JavaScript).
// TypeScript signale déjà une promesse utilisée comme une valeur (propriété lue, condition, type attendu) ; il ne dit
// rien d'un appel dont le résultat est ignoré, ni d'un rappel asynchrone passé à forEach ou filter. Ce script lit
// l'arbre syntaxique (analyseur d'oxc fourni par rolldown, déjà installé avec Vite) de server/, scripts/ et tests/ et
// refuse :
//   1. un appel à une fonction asynchrone du dépôt (déclarée `async` ou typée `Promise<…>`, résolue par les imports)
//      ou à une méthode de la base (`db.get`, `ctx.db.tx`…) qui n'est ni attendu (`await`), ni explicitement lâché
//      (`void`), ni passé à Promise.all / allSettled / race, ni rendu par une fonction qui renvoie une promesse, ni
//      gardé dans une variable (TypeScript refuse alors qu'elle reste inutilisée ou serve de valeur ordinaire) ;
//   2. un rappel asynchrone passé à une méthode de tableau autre que `.map` (forEach, filter, some, find, reduce…),
//      ou à `.map` hors de Promise.all, ou à assert.throws / doesNotThrow (à remplacer par rejects / doesNotReject), ou
//      à une fonction du fichier dont le paramètre est typé comme une fonction sans promesse (`fn: () => void`) ;
//   3. dans server/src, `.sql` (connexion node:sqlite) hors des fichiers propres à SQLite (FICHIERS_SQLITE), et
//      `.pool` (pool de connexions PostgreSQL) hors de l'adaptateur PostgreSQL (server/src/db-pg.ts).
// Une exception justifiée se marque par le commentaire `// await-ok: <raison>` sur la ligne de l'appel.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let parseSync;
try {
  ({ parseSync } = await import('rolldown/utils'));
} catch {
  console.error('verifier-await : analyseur introuvable (rolldown, installé avec Vite) : lancez npm ci.');
  process.exit(2);
}

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOSSIERS = ['server/src', 'scripts', 'tests'];
/** Fichiers qui manipulent la connexion SQLite elle-même : schéma, migrations nommées SQLite, déclaration à Matrix. */
const FICHIERS_SQLITE = new Set(['server/src/db.ts', 'server/src/migrations/cadre.ts', 'server/src/migrations/outils.ts', 'server/src/integrations/matrix.ts']);
/** Fichiers des adaptateurs : leurs méthodes asynchrones sont celles de la base (METHODES_DB), traitées à part. */
const FICHIERS_DB = new Set(['server/src/db.ts', 'server/src/db-pg.ts']);
const METHODES_DB = new Set(['all', 'where', 'get', 'insert', 'update', 'remove', 'count', 'tx', 'lecture', 'exclusif', 'getSetting', 'setSetting', 'clearAll',
  'resyncIds', 'columns', 'query', 'one', 'run', 'exec', 'fermer', 'migrer', 'controlerSchema']);
/** Classes et fonctions qui donnent une base (adaptateurs, ouverture, base des tests). */
const CLASSES_DB = ['Db', 'SqliteDb', 'PgDb'];
const OUVERTURES_DB = ['openDb', 'openSqlite', 'ouvrirPostgres', 'nouvelleBase'];
const TABLEAU = new Set(['forEach', 'filter', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'reduce', 'reduceRight', 'sort', 'toSorted', 'flatMap', 'map']);
const COLLECTEURS = new Set(['all', 'allSettled', 'race', 'any']);

function fichiers(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) fichiers(p, out);
    else if (/\.(ts|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

const estFonction = n => n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration');
const parcourir = (n, fn, parent = null) => {
  if (!n || typeof n.type !== 'string') return;
  n.parent = parent;
  fn(n);
  for (const k of Object.keys(n)) {
    if (k === 'parent') continue;
    const v = n[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') parcourir(c, fn, n); }
    else if (v && typeof v.type === 'string') parcourir(v, fn, n);
  }
};
const ENVELOPPES = new Set(['ParenthesizedExpression', 'TSAsExpression', 'TSNonNullExpression', 'ChainExpression']);
const sansParentheses = n => { let p = n.parent; while (ENVELOPPES.has(p?.type)) p = p.parent; return p; };
const typeDb = t => t?.typeAnnotation?.type === 'TSTypeReference' && CLASSES_DB.includes(t.typeAnnotation.typeName?.name);
const renvoiePromesse = f => f.async || /^Promise\b/.test(f.returnType?.typeAnnotation?.typeName?.name ?? '');

const sources = new Map();
for (const d of DOSSIERS) for (const f of fichiers(join(RACINE, d))) {
  const texte = readFileSync(f, 'utf8');
  const r = parseSync(f, texte, { lang: f.endsWith('.mjs') ? 'js' : 'ts', sourceType: 'module' });
  if (r.errors.length) { console.error(`${relative(RACINE, f)} : ${r.errors[0].message}`); process.exit(2); }
  sources.set(f, { texte, ast: r.program });
}

// Fonctions asynchrones déclarées dans chaque fichier (tout niveau, par nom).
const asynchrones = new Map();
for (const [f, { ast }] of sources) {
  const noms = new Map();
  const noter = (nom, a) => { if (nom) noms.set(nom, (noms.get(nom) ?? false) || a); };
  parcourir(ast, n => {
    if (n.type === 'FunctionDeclaration' && n.id) noter(n.id.name, renvoiePromesse(n));
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && estFonction(n.init)) noter(n.id.name, renvoiePromesse(n.init));
    if (n.type === 'MethodDefinition' && n.key.type === 'Identifier') noter(`this.${n.key.name}`, renvoiePromesse(n.value));
  });
  asynchrones.set(f, noms);
}
const module = chemin => [chemin, `${chemin}.ts`].find(c => asynchrones.has(c));
// Méthodes asynchrones des classes du serveur (hors Db, traitée à part), appelées sur n'importe quel objet
// (`arret.echec(…)`, `oidc.verifierJeton(…)`) ; les noms trop courants pour être reconnus sûrement sont exclus.
const TROP_COURANTS = new Set(['lire', 'cle', 'valeur', 'document', ...METHODES_DB]);
const methodesAsynchrones = new Set();
for (const [f, { ast }] of sources) {
  if (!relative(RACINE, f).startsWith('server/src/') || FICHIERS_DB.has(relative(RACINE, f))) continue;
  parcourir(ast, n => {
    if (n.type === 'MethodDefinition' && n.key.type === 'Identifier' && renvoiePromesse(n.value) && !TROP_COURANTS.has(n.key.name)) methodesAsynchrones.add(n.key.name);
  });
}

const erreurs = [];
for (const [f, { texte, ast }] of sources) {
  const rel = relative(RACINE, f);
  const ligne = pos => texte.slice(0, pos).split('\n').length;
  const exception = pos => /\/\/ await-ok: \S/.test(texte.split('\n')[ligne(pos) - 1]);
  const signaler = (pos, msg) => { if (!exception(pos)) erreurs.push(`${rel}:${ligne(pos)} : ${msg}`); };
  // Imports : nom local → module et nom exporté (statiques, et `const { a } = await import(…)` des tests).
  const imports = new Map();
  const bases = new Set(['db']);
  parcourir(ast, n => {
    if (n.type === 'ImportDeclaration') {
      const de = module(resolve(dirname(f), n.source.value));
      for (const s of n.specifiers) if (s.type === 'ImportSpecifier') imports.set(s.local.name, { de, nom: s.imported.name ?? s.imported.value });
    }
    if (n.type === 'VariableDeclarator' && n.id.type === 'ObjectPattern' && n.init?.type === 'AwaitExpression' && n.init.argument.type === 'ImportExpression') {
      const de = module(resolve(dirname(f), n.init.argument.source.value));
      for (const p of n.id.properties) if (p.type === 'Property' && p.key.type === 'Identifier') imports.set(p.value.name ?? p.key.name, { de, nom: p.key.name });
    }
    // Variables qui portent une base : `new Db(…)`, `await openDb(…)`, paramètre ou variable typé Db / SqliteDb.
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') {
      const i = n.init?.type === 'AwaitExpression' ? n.init.argument : n.init;
      if ((i?.type === 'NewExpression' && CLASSES_DB.includes(i.callee.name)) || (i?.type === 'CallExpression' && OUVERTURES_DB.includes(i.callee.name)) || typeDb(n.id.typeAnnotation)) bases.add(n.id.name);
    }
    if (n.type === 'Identifier' && typeDb(n.typeAnnotation)) bases.add(n.name);
  });
  const locales = new Map(asynchrones.get(f));
  // Fonctions du fichier dont un paramètre est une fonction typée sans promesse (`fn: () => void`, `() => T`) :
  // nom → positions de ces paramètres. Un rappel asynchrone qui leur est passé ne serait pas attendu.
  const rappelsSynchrones = new Map();
  parcourir(ast, n => {
    const fn = n.type === 'FunctionDeclaration' ? n : n.type === 'VariableDeclarator' && estFonction(n.init) ? n.init : null;
    const nomFn = n.type === 'FunctionDeclaration' ? n.id?.name : n.type === 'VariableDeclarator' && n.id.type === 'Identifier' ? n.id.name : null;
    if (!fn || !nomFn) return;
    const positions = fn.params.flatMap((x, i) => {
      const t = (x.type === 'AssignmentPattern' ? x.left : x).typeAnnotation?.typeAnnotation;
      if (t?.type !== 'TSFunctionType') return [];
      const retour = texte.slice(t.returnType?.typeAnnotation?.start ?? 0, t.returnType?.typeAnnotation?.end ?? 0);
      return /Promise|unknown|any/.test(retour) ? [] : [i];
    });
    if (positions.length) rappelsSynchrones.set(nomFn, positions);
  });
  // Fonctions des tests rendues par une fonction d'aide et renommées à la déstructuration (`const { run: run2 } = await
  // fresh()`) : même statut que le nom d'origine.
  parcourir(ast, n => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'ObjectPattern' && n.init?.type === 'AwaitExpression' && n.init.argument.type === 'CallExpression') {
      for (const p of n.id.properties) {
        if (p.type === 'Property' && p.key.type === 'Identifier' && p.value.type === 'Identifier' && p.value.name !== p.key.name && locales.get(p.key.name)) locales.set(p.value.name, true);
      }
    }
  });
  const estAsynchrone = nom => {
    const i = imports.get(nom);
    if (i) return !!(i.de && asynchrones.get(i.de)?.get(i.nom));
    return !!locales.get(nom);
  };
  const recepteurDb = o => (o.type === 'Identifier' && bases.has(o.name)) || (o.type === 'MemberExpression' && !o.computed && o.property.name === 'db')
    || (o.type === 'NewExpression' && CLASSES_DB.includes(o.callee.name)) || (o.type === 'ParenthesizedExpression' && recepteurDb(o.expression));
  const dansCollecteur = call => {
    const p = sansParentheses(call);
    if (p?.type === 'ArrayExpression') return dansCollecteur(p);
    return p?.type === 'CallExpression' && p.callee.type === 'MemberExpression' && p.callee.object.name === 'Promise' && COLLECTEURS.has(p.callee.property.name);
  };

  parcourir(ast, n => {
    // 3. Connexion SQLite en direct.
    if (rel.startsWith('server/src/') && !FICHIERS_SQLITE.has(rel) && n.type === 'MemberExpression' && !n.computed && n.property.name === 'sql' && recepteurDb(n.object)) {
      signaler(n.start, '`.sql` (connexion node:sqlite) : passer par db.query / db.one / db.run / db.exec');
    }
    if (rel.startsWith('server/src/') && rel !== 'server/src/db-pg.ts' && n.type === 'MemberExpression' && !n.computed && n.property.name === 'pool' && recepteurDb(n.object)) {
      signaler(n.start, '`.pool` (connexions PostgreSQL) : passer par db.query / db.one / db.run / db.exec, db.tx / db.lecture / db.exclusif');
    }
    // 2. Rappel asynchrone passé à une méthode de tableau.
    if (estFonction(n) && n.async && n.parent?.type === 'CallExpression' && n.parent.arguments.includes(n) && n.parent.callee.type === 'MemberExpression') {
      const m = n.parent.callee.property.name;
      if (TABLEAU.has(m) && !(m === 'map' && dansCollecteur(n.parent))) signaler(n.start, `rappel asynchrone passé à .${m} : ses promesses ne sont pas attendues (for…of, ou Promise.all(….map(…)))`);
    }
    // 2 ter. Rappel asynchrone passé à une fonction du fichier qui attend un rappel synchrone (`fn: () => void`).
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && rappelsSynchrones.has(n.callee.name)) {
      for (const i of rappelsSynchrones.get(n.callee.name)) {
        const a = n.arguments[i];
        if (estFonction(a) && a.async) signaler(a.start, `rappel asynchrone passé à ${n.callee.name}, qui ne l'attend pas (paramètre typé sans Promise)`);
      }
    }
    // 2 bis. assert.throws / doesNotThrow sur une fonction asynchrone : l'exception devient un rejet, jamais vu.
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.name === 'assert' && ['throws', 'doesNotThrow'].includes(n.callee.property.name)
      && estFonction(n.arguments[0]) && n.arguments[0].async) signaler(n.start, `assert.${n.callee.property.name} sur une fonction asynchrone : await assert.${n.callee.property.name === 'throws' ? 'rejects' : 'doesNotReject'}`);
    // 1. Appel asynchrone non attendu.
    if (n.type !== 'CallExpression') return;
    const c = n.callee.type === 'TSNonNullExpression' ? n.callee.expression : n.callee;
    let nom = null;
    if (c.type === 'Identifier' && estAsynchrone(c.name)) nom = c.name;
    // Gestionnaire d'action pris dans un registre (ACTIONS[nom], equipesActions['equipe.renommer']…) : ActionHandler.
    else if (c.type === 'MemberExpression' && c.computed && c.object.type === 'Identifier' && /^(ACTIONS|\w+Actions)$/.test(c.object.name)) nom = `${c.object.name}[…]`;
    else if (c.type === 'MemberExpression' && !c.computed) {
      if (METHODES_DB.has(c.property.name) && recepteurDb(c.object)) nom = texte.slice(c.start, c.end);
      // Migration nommée (server/src/migrations/cadre.ts) : `necessaire` et `executer` peuvent renvoyer une promesse.
      else if (['necessaire', 'executer'].includes(c.property.name) && c.object.type === 'Identifier' && /^[A-Z][A-Z0-9_]*$|^m$/.test(c.object.name)) nom = texte.slice(c.start, c.end);
      else if (c.object.type === 'ThisExpression' && locales.get(`this.${c.property.name}`)) nom = `this.${c.property.name}`;
      else if (methodesAsynchrones.has(c.property.name)) nom = texte.slice(c.start, c.end);
    }
    if (!nom) return;
    let p = sansParentheses(n);
    // Chaîne `f().catch(…)` / `.then(…)` / `.finally(…)` : c'est la promesse de la chaîne qui doit être attendue.
    for (let e = n; p?.type === 'MemberExpression' && p.object === e && ['catch', 'then', 'finally'].includes(p.property.name) && p.parent?.type === 'CallExpression'; ) {
      e = p.parent; p = sansParentheses(e);
    }
    // Branche d'une condition (`return x ? f() : null`) : c'est la condition entière qui est attendue ou rendue.
    for (let e = n; p?.type === 'ConditionalExpression' && p.test !== e; ) { e = p; p = sansParentheses(p); }
    if (p?.type === 'AwaitExpression' || (p?.type === 'UnaryExpression' && p.operator === 'void') || dansCollecteur(n)) return;
    // Promesse gardée dans une variable pour être attendue plus loin (requêtes lancées ensemble) : TypeScript refuse
    // une variable jamais lue (noUnusedLocals) ou lue comme une valeur ordinaire.
    if (p?.type === 'VariableDeclarator' || (p?.type === 'AssignmentExpression' && p.right !== undefined)) return;
    // Promesse passée à assert.rejects / doesNotReject, qui l'attend.
    if (p?.type === 'CallExpression' && p.arguments[0] === n && p.callee.type === 'MemberExpression' && p.callee.object.name === 'assert'
      && ['rejects', 'doesNotReject'].includes(p.callee.property.name)) return;
    // Promesse rendue telle quelle par une fonction qui renvoie une promesse : attendue par l'appelant.
    if (p?.type === 'ReturnStatement' || (estFonction(p) && p.body === n)) {
      let fn = p; while (fn && !estFonction(fn)) fn = fn.parent;
      if (fn && renvoiePromesse(fn)) return;
      // Rappel de .then / .catch / .finally : sa promesse est reprise par la chaîne.
      if (fn?.parent?.type === 'CallExpression' && fn.parent.callee.type === 'MemberExpression' && ['then', 'catch', 'finally'].includes(fn.parent.callee.property.name)) return;
      // Promesses rassemblées : Promise.all(ids.map(id => db.get(…))).
      if (fn?.parent?.type === 'CallExpression' && fn.parent.callee.type === 'MemberExpression' && fn.parent.callee.property.name === 'map' && dansCollecteur(fn.parent)) return;
      // Rappel rendu à une fonction qui l'attend elle-même (db.tx(() => …), db.lecture(…), db.exclusif(…)).
      const appel = fn?.parent;
      if (appel?.type === 'CallExpression' && appel.arguments.includes(fn) && appel.callee.type === 'MemberExpression'
        && ['tx', 'lecture', 'exclusif'].includes(appel.callee.property.name) && recepteurDb(appel.callee.object)) return;
    }
    signaler(n.start, `${nom}(…) renvoie une promesse : await (ou void si l'appel est volontairement lâché)`);
  });
}

if (erreurs.length) {
  console.error(`verifier-await : ${erreurs.length} problème${erreurs.length > 1 ? 's' : ''}\n${erreurs.join('\n')}`);
  process.exit(1);
}
console.log(`verifier-await : ${sources.size} fichiers contrôlés, aucune promesse oubliée.`);
