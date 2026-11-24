#!/usr/bin/env node
// Norma — questionnaire du responsable produit : modèle commun de page, sans dépendance (Node 22+).
//
// Depuis la racine d'un outil :
//   node norma/outils/questionnaire/build.mjs [--sortie <chemin.html>]
// lit scripts/questionnaire/config.json et scripts/questionnaire/questions.json, contrôle les questions et écrit la page
// autonome (par défaut config.sortie, sinon .artifacts/decisions-<outil>.html), à publier comme artefact. Les réponses
// vivent dans la base de l'artefact : collection `answers`, un document par question
// { choice: default | altN | other | discuss, note, updatedAt }, relu avec l'outil ArtifactData avant chaque livraison.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(ici, 'page.template.html');
const PALETTE = path.join(ici, '..', 'pages', 'nocturne-page.css');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const texte = (v) => typeof v === 'string' && v.trim() !== '';

/** Problems of a config and its questions (empty list = valid). */
export function valider(config, questions) {
  const p = [];
  if (!config || typeof config !== 'object') return ['config.json : objet attendu.'];
  if (!texte(config.titre)) p.push('config.json : « titre » obligatoire.');
  if (!Array.isArray(config.groupes) || !config.groupes.length) p.push('config.json : « groupes » obligatoire, liste de [clé, libellé].');
  const groupes = new Set();
  for (const g of config.groupes ?? []) {
    if (!Array.isArray(g) || g.length !== 2 || !texte(g[0]) || !texte(g[1])) p.push(`config.json : groupe ${JSON.stringify(g)} : [clé, libellé] attendu.`);
    else if (groupes.has(g[0])) p.push(`config.json : groupe « ${g[0]} » en double.`);
    else groupes.add(g[0]);
  }
  if (config.decide !== undefined && !(Array.isArray(config.decide) && config.decide.every(texte))) p.push('config.json : « decide » doit être une liste de textes.');
  if (!Array.isArray(questions)) return [...p, 'questions.json : liste attendue.'];
  const ids = new Set();
  questions.forEach((q, i) => {
    const ou = `questions.json : question ${texte(q?.id) ? q.id : `n° ${i + 1}`}`;
    if (!q || typeof q !== 'object') return p.push(`${ou} : objet attendu.`);
    if (!texte(q.id)) p.push(`${ou} : « id » obligatoire.`);
    else if (ids.has(q.id)) p.push(`${ou} : id en double.`);
    else ids.add(q.id);
    if (!groupes.has(q.group)) p.push(`${ou} : groupe « ${q.group} » absent de config.json.`);
    for (const champ of ['title', 'context']) if (!texte(q[champ])) p.push(`${ou} : « ${champ} » obligatoire.`);
    if (q.kind !== undefined && q.kind !== 'data') p.push(`${ou} : « kind » vaut "data" ou est absent.`);
    if (q.kind !== 'data') {
      if (!texte(q.proposal)) p.push(`${ou} : « proposal » obligatoire (proposition par défaut).`);
      if (!Array.isArray(q.alts) || !q.alts.every(texte)) p.push(`${ou} : « alts » doit être une liste de textes (vide permise).`);
    }
  });
  return p;
}

/** The page's HTML. `date` is the day shown as "mis à jour le …". */
export function construire(config, questions, date = new Date()) {
  const jour = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  const decide = config.decide?.length
    ? `<details class="decided">\n    <summary>${esc(config.decideTitre ?? 'Déjà décidé')}</summary>\n    <ul>\n${config.decide.map((d) => `      <li>${esc(d)}</li>`).join('\n')}\n    </ul>\n  </details>`
    : '';
  const valeurs = {
    __NOCTURNE__: readFileSync(PALETTE, 'utf8'),
    __TITRE__: esc(config.titre),
    __SOUS_TITRE__: esc(config.sousTitre ?? 'questionnaire du responsable produit'),
    __INTRODUCTION__: esc(config.introduction ?? ''),
    __DECIDE__: decide,
    __GROUPES__: json(config.groupes),
    __QUESTIONS__: json(questions),
    __UPDATED__: `mis à jour le ${jour}`,
  };
  return readFileSync(TEMPLATE, 'utf8').replace(/__[A-Z_]+__/g, (k) => (k in valeurs ? valeurs[k] : k));
}

/** Reads <outilRoot>/scripts/questionnaire/{config,questions}.json, checks them and writes the page. */
export function generer(outilRoot, sortie) {
  const dir = path.join(outilRoot, 'scripts', 'questionnaire');
  const lire = (f) => {
    const p = path.join(dir, f);
    if (!existsSync(p)) throw new Error(`${path.relative(outilRoot, p)} absent.`);
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { throw new Error(`${path.relative(outilRoot, p)} : JSON invalide (${e.message}).`); }
  };
  const config = lire('config.json');
  const questions = lire('questions.json');
  const problemes = valider(config, questions);
  if (problemes.length) throw new Error(problemes.join('\n'));
  let outil = 'outil';
  const nc = path.join(outilRoot, 'norma.config.json');
  if (existsSync(nc)) outil = JSON.parse(readFileSync(nc, 'utf8')).outil ?? outil;
  const cible = path.resolve(outilRoot, sortie ?? config.sortie ?? path.join('.artifacts', `decisions-${outil}.html`));
  mkdirSync(path.dirname(cible), { recursive: true });
  writeFileSync(cible, construire(config, questions));
  return { cible, nombre: questions.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--sortie');
  try {
    const r = generer(process.cwd(), i >= 0 ? args[i + 1] : undefined);
    console.log(`${r.nombre} questions → ${path.relative(process.cwd(), r.cible)}`);
  } catch (e) {
    for (const l of String(e.message).split('\n')) console.error(`✗ ${l}`);
    process.exit(1);
  }
}
