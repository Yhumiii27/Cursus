// Script d'amorçage du thème (Norma 1.0 ; règle et explication : client/src/theme/theme.ts). Chargé de manière bloquante
// dans le <head> de index.html, avant le module de l’interface : l'attribut data-theme de <html>
// est posé avant le premier rendu, sans flash. Cookie atrium-theme (Norma 3.0 ; à défaut l'ancien nom, lu seulement,
// assemblé en deux morceaux comme dans norma/charte/ds/theme.ts) : « light » donne l'affichage clair, « dark » le sombre,
// toute autre valeur ou son absence l'affichage sombre (par défaut). Script servi (CSP script-src 'self'), jamais en ligne.
(function () {
  var theme = 'dark';
  var jar = {};
  var parts = (document.cookie || '').split(';');
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    var eq = p.indexOf('=');
    if (eq > 0) jar[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
  }
  var noms = ['atrium-theme', ['e', 'pc2i-theme'].join('')];
  for (var j = 0; j < noms.length; j++) {
    var v = jar[noms[j]];
    if (v === 'light' || v === 'dark') { theme = v; break; }
  }
  document.documentElement.setAttribute('data-theme', theme);
  var scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute('content', theme);
  var fond = document.querySelector('meta[name="theme-color"]');
  if (fond) fond.setAttribute('content', theme === 'light' ? '#f4f5f9' : '#161826');
})();
