#!/usr/bin/env node
// Norma — copie du socle commun dans un outil et contrôle de cette copie. Sans dépendance (Node 22+).
//
// Depuis la racine d'un outil :
//   node <clone de Norma>/outils/norma.mjs copier          copie le socle dans ./norma (règles, charte, registre,
//                                                           dépendances, ce script, le modèle de questionnaire),
//                                                           écrit norma/MANIFEST.json
//   node norma/outils/norma.mjs verifier                    (CI) la copie n'a pas été modifiée, et package.json respecte
//                                                           norma/dependances.json pour cet outil
// L'outil se nomme dans norma.config.json à sa racine : { "outil": "<code du registre>" }.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** What a tool receives (relative to Norma's root). */
export const DISTRIBUE = ['REGLES.md', 'VERSION', 'CHANGELOG.md', 'dependances.json', 'registre', 'charte', 'outils/norma.mjs', 'outils/pages', 'outils/questionnaire'];
const DOSSIER = 'norma';

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function fichiers(dir, base = dir) {
  const out = [];
  for (const nom of readdirSync(dir).sort()) {
    const p = path.join(dir, nom);
    if (statSync(p).isDirectory()) out.push(...fichiers(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/** Copies the distributed part of Norma (normaRoot) into <outilRoot>/norma and writes its manifest. */
export function copier(normaRoot, outilRoot) {
  const cible = path.join(outilRoot, DOSSIER);
  rmSync(cible, { recursive: true, force: true });
  mkdirSync(cible, { recursive: true });
  for (const p of DISTRIBUE) cpSync(path.join(normaRoot, p), path.join(cible, p), { recursive: true });
  const version = readFileSync(path.join(normaRoot, 'VERSION'), 'utf8').trim();
  const empreintes = Object.fromEntries(fichiers(cible).map((f) => [f, sha256(path.join(cible, f))]));
  writeFileSync(path.join(cible, 'MANIFEST.json'), JSON.stringify({ version, fichiers: empreintes }, null, 2) + '\n');
  return { version, nombre: Object.keys(empreintes).length };
}

/** "^16.4.6" → [16, 4, 6]; null when not a plain version (git URL, tag, "*"). */
export function versionDe(spec) {
  const m = /^[\^~>=v ]*(\d+)\.(\d+)\.(\d+)/.exec(String(spec));
  return m ? [+m[1], +m[2], +m[3]] : null;
}
const inferieure = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Checks <outilRoot>/norma against its manifest and package.json against dependances.json. Returns the problems. */
export function verifier(outilRoot) {
  const problemes = [];
  const cible = path.join(outilRoot, DOSSIER);
  const manifeste = path.join(cible, 'MANIFEST.json');
  if (!existsSync(manifeste)) return [`${DOSSIER}/MANIFEST.json absent : copier le socle (norma.mjs copier).`];
  const { fichiers: attendus } = JSON.parse(readFileSync(manifeste, 'utf8'));
  const presents = fichiers(cible).filter((f) => f !== 'MANIFEST.json');
  for (const f of presents) {
    if (!(f in attendus)) problemes.push(`${DOSSIER}/${f} : fichier ajouté à la copie du socle (le proposer dans Norma).`);
    else if (sha256(path.join(cible, f)) !== attendus[f]) problemes.push(`${DOSSIER}/${f} : modifié localement (une règle commune se change dans Norma).`);
  }
  for (const f of Object.keys(attendus)) if (!presents.includes(f)) problemes.push(`${DOSSIER}/${f} : supprimé de la copie du socle.`);

  const config = path.join(outilRoot, 'norma.config.json');
  if (!existsSync(config)) return [...problemes, 'norma.config.json absent : { "outil": "<code du registre>" }.'];
  const { outil } = JSON.parse(readFileSync(config, 'utf8'));
  const registre = JSON.parse(readFileSync(path.join(cible, 'registre/outils.json'), 'utf8'));
  if (!registre.outils.some((o) => o.code === outil)) problemes.push(`norma.config.json : outil « ${outil} » absent du registre.`);

  const pkgFile = path.join(outilRoot, 'package.json');
  if (!existsSync(pkgFile)) return problemes;
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  const regles = JSON.parse(readFileSync(path.join(cible, 'dependances.json'), 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const autorisee = (nom) => nom in regles.autorisees || Object.keys(regles.autorisees).some((k) => k.endsWith('/*') && nom.startsWith(k.slice(0, -1)));
  for (const [nom, spec] of Object.entries(deps)) {
    const interdite = regles.interdites[nom];
    if (interdite && !(interdite.derogations ?? []).includes(outil)) problemes.push(`${nom} : interdite (${interdite.raison}).`);
    else if (!interdite && !autorisee(nom)) problemes.push(`${nom} : à déclarer dans Norma (dependances.json) avant usage.`);
    const min = regles.minimum[nom];
    const v = versionDe(spec);
    if (min && v && inferieure(v, versionDe(min.version)) < 0) problemes.push(`${nom}@${spec} : minimum ${min.version} (${min.raison}).`);
  }
  return problemes;
}

const ici = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === ici) {
  const [commande] = process.argv.slice(2);
  const outilRoot = process.cwd();
  if (commande === 'copier') {
    const normaRoot = path.resolve(path.dirname(ici), '..');
    if (path.resolve(normaRoot) === path.resolve(outilRoot, DOSSIER)) {
      console.error('Lancer copier depuis un clone de Norma : node <clone de Norma>/outils/norma.mjs copier');
      process.exit(2);
    }
    const r = copier(normaRoot, outilRoot);
    console.log(`Norma ${r.version} copié dans ${DOSSIER}/ (${r.nombre} fichiers).`);
  } else if (commande === 'verifier') {
    const p = verifier(outilRoot);
    for (const l of p) console.error(`✗ ${l}`);
    if (p.length) process.exit(1);
    console.log(`✓ Norma ${readFileSync(path.join(outilRoot, DOSSIER, 'VERSION'), 'utf8').trim()} : copie intacte, dépendances conformes.`);
  } else {
    console.error('Usage : norma.mjs copier | verifier');
    process.exit(2);
  }
}
