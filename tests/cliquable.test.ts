// Lignes et cartes cliquables accessibles au clavier (t142) : lecture du code de l'interface. Tout élément non
// interactif qui réagit au clic (ligne de tableau, ligne de liste, carte) doit offrir le même effet à un élément
// focalisable : le bouton `Ouvrir` sur le nom de la ligne, ou la carte `CartePick` (rôle de bouton, Entrée, Espace).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RACINE = join(import.meta.dirname, '..');
const CLIENT = join(RACINE, 'client', 'src');

function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? fichiers(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

/** Fin de la balise ouvrante qui commence à `i` (accolades et chaînes des attributs sautées) ; `auto` : `/>`. */
function finBalise(s: string, i: number): { fin: number; auto: boolean } {
  let prof = 0, guillemet: string | null = null;
  for (let k = i + 1; k < s.length; k++) {
    const c = s[k];
    if (guillemet) { if (c === guillemet && s[k - 1] !== '\\') guillemet = null; continue; }
    if (c === '"' || c === "'" || c === '`') { guillemet = c; continue; }
    if (c === '{') prof++;
    else if (c === '}') prof--;
    else if (c === '>' && prof === 0) return { fin: k + 1, auto: s[k - 1] === '/' };
  }
  throw new Error(`balise non fermée à ${i}`);
}

/** Contenu de l'élément `nom` dont la balise ouvrante finit à `debut` (jusqu'à sa balise fermante). */
function contenu(s: string, nom: string, debut: number): string {
  const re = new RegExp(`<${nom}\\b|</${nom}>`, 'g');
  re.lastIndex = debut;
  let prof = 1;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m[0].startsWith('</')) { if (--prof === 0) return s.slice(debut, m.index); }
    else if (!finBalise(s, m.index).auto) prof++;
  }
  throw new Error(`<${nom}> sans fermeture`);
}

interface Cliquable { fichier: string; ligne: number; nom: string; attributs: string; corps: string }

/** Éléments non interactifs (tr, div, article, li, td, span, section) qui portent un `onClick`, ou la classe `clickable`. */
function cliquables(): Cliquable[] {
  const out: Cliquable[] = [];
  for (const f of fichiers(CLIENT)) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/<(tr|div|article|li|td|span|section)\b/g)) {
      const { fin, auto } = finBalise(s, m.index);
      const attributs = s.slice(m.index, fin);
      if (!/\bonClick=/.test(attributs) && !/\bclickable\b/.test(attributs)) continue;
      out.push({ fichier: relative(RACINE, f), ligne: s.slice(0, m.index).split('\n').length, nom: m[1], attributs, corps: auto ? '' : contenu(s, m[1], fin) });
    }
  }
  return out;
}

test('lignes cliquables : un bouton « Ouvrir » sur le nom, la ligne restant cliquable à la souris', () => {
  const liste = cliquables();
  // Une vingtaine d'occurrences (tableau de bord, échéances, annuaire, habilitations, formations, voyages…).
  assert.ok(liste.length >= 15, `${liste.length} éléments cliquables trouvés : lecture du code à revoir`);
  const sansClavier = liste.filter(x => {
    // Fond du menu en tiroir : masqué aux lecteurs d'écran, Échap et « Fermer le menu » font de même.
    if (/aria-hidden="true"/.test(x.attributs)) return false;
    // Fond d'un dialogue : Échap et « Annuler » le ferment aussi.
    if (/className="dialog-backdrop"/.test(x.attributs)) return false;
    // Carte sélectionnable du composant commun (rôle de bouton, focalisable, Entrée et Espace).
    if (/role="button"/.test(x.attributs) && /tabIndex=\{0\}/.test(x.attributs) && /onKeyDown=/.test(x.attributs)) return false;
    return !/<Ouvrir\b/.test(x.corps);
  });
  assert.deepEqual(sansClavier.map(x => `${x.fichier}:${x.ligne} <${x.nom}>`), [], 'élément cliquable sans élément focalisable');
});

test('cartes sélectionnables : toutes passent par CartePick (aria-pressed, Entrée et Espace)', () => {
  const pick = cliquables().filter(x => /\bpick\b/.test(x.attributs));
  assert.deepEqual(pick.map(x => x.fichier), ['client/src/components/Cliquable.tsx']);
  const c = pick[0].attributs;
  assert.match(c, /aria-pressed=\{selected\}/);
  // Aucune autre carte `.pick` écrite à la main.
  for (const f of fichiers(CLIENT)) {
    if (f.endsWith('Cliquable.tsx')) continue;
    assert.doesNotMatch(readFileSync(f, 'utf8'), /className=\{?[`'"][^`'"]*\bpick\b/, relative(RACINE, f));
  }
});

test('Ouvrir arrête le clic (pas de double bascule de la ligne) ; focus visible sur les lignes et les cartes', () => {
  const src = readFileSync(join(CLIENT, 'components', 'Cliquable.tsx'), 'utf8');
  assert.match(src, /<button type="button" className="ouvrir"/);
  assert.match(src, /ev\.stopPropagation\(\); onOpen\(\);/);
  const css = readFileSync(join(CLIENT, 'styles', 'app.css'), 'utf8');
  assert.match(css, /\.ouvrir:focus-visible \{ outline: 2px solid var\(--color-accent\)/);
  assert.match(css, /\.card\.pick:focus-visible \{ outline: 2px solid var\(--color-accent\)/);
  // Le compte rendu d'entretien à signer, seul chemin vers sa signature, s'ouvre au clavier.
  const ent = readFileSync(join(CLIENT, 'pages', 'Entretiens.tsx'), 'utf8');
  assert.match(ent, /<Ouvrir onOpen=\{\(\) => openDialog\(\{ type: 'ent', entId: r\.x\.id \}\)\}>/);
});
