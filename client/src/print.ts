// Documents imprimables (passeport formation, compte rendu d'entretien) et exports CSV.
import printCss from './styles/print.css?url';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export interface PrintSection { title: string; rows?: [string, string][]; table?: { head: string[]; rows: string[][] }; text?: string }

/**
 * Ouvre un document A4 sobre dans un nouvel onglet et lance l'impression (ou l'enregistrement en PDF).
 * L'onglet hérite de la politique de sécurité (CSP) de Cursus : ni script ni style en ligne,
 * la mise en page vient d'une feuille servie et l'impression est lancée depuis cette page.
 */
export function printDocument(title: string, subtitle: string, sections: PrintSection[]) {
  const w = window.open('', '_blank');
  if (!w) return false;
  const body = sections.map(s => `
    <section>
      <h2>${esc(s.title)}</h2>
      ${s.rows ? `<dl>${s.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      ${s.table ? `<table><thead><tr>${s.table.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${s.table.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}
      ${s.text ? `<p class="text">${esc(s.text)}</p>` : ''}
    </section>`).join('');
  const doc = w.document;
  doc.documentElement.lang = 'fr';
  doc.title = title;
  const css = doc.createElement('link');
  css.rel = 'stylesheet';
  css.href = new URL(printCss, location.href).href;
  // L'impression attend la feuille de style (chargée ou non) pour ne pas sortir une page brute.
  const print = () => setTimeout(() => { w.focus(); w.print(); }, 150);
  css.addEventListener('load', print, { once: true });
  css.addEventListener('error', print, { once: true });
  doc.head.append(css);
  doc.body.innerHTML = `
    <header><div class="brand">Cursus</div><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div></header>
    ${body}
    <footer>Document généré le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</footer>`;
  return true;
}

/** Télécharge un fichier CSV (séparateur « ; », encodage UTF-8 avec BOM pour Excel). */
export function downloadCsv(filename: string, head: string[], rows: (string | number)[][]) {
  const cell = (v: string | number) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [head, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
