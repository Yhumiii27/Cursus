// Documents imprimables (passeport formation, compte rendu d'entretien) et exports CSV.
import { texteCsv } from '../../shared/csv.ts';
// Chaque export ou impression est signalé au serveur pour le journal des actions (`empId` : salarié concerné).
import { api } from './api.ts';
import printCss from './styles/print.css?url';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export interface PrintSection { title: string; rows?: [string, string][]; table?: { head: string[]; rows: string[][] }; text?: string }

/** Script servi tel quel (client/public) : il lance l'impression depuis le document ouvert. */
const PRINT_JS = '/imprimer.js';

/**
 * Ouvre un document A4 sobre dans un nouvel onglet et lance l'impression (ou l'enregistrement en PDF).
 * L'onglet hérite de la politique de sécurité (CSP) de Cursus : ni script ni style en ligne. La mise
 * en page vient d'une feuille servie, l'impression d'un script servi qui s'exécute dans l'onglet
 * ouvert, au premier plan (téléphones compris). Le doctype garde le document en mode standard.
 */
export function printDocument(title: string, subtitle: string, sections: PrintSection[], empId?: number) {
  const w = window.open('', '_blank');
  if (!w) return false;
  api.signalerExport({ nature: 'impression', titre: title, empId });
  const url = (path: string) => esc(new URL(path, location.href).href);
  const body = sections.map(s => `
    <section>
      <h2>${esc(s.title)}</h2>
      ${s.rows ? `<dl>${s.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      ${s.table ? `<table><thead><tr>${s.table.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${s.table.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}
      ${s.text ? `<p class="text">${esc(s.text)}</p>` : ''}
    </section>`).join('');
  w.document.open();
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <link rel="stylesheet" href="${url(printCss)}"></head><body>
    <header><div class="brand">Cursus</div><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div></header>
    ${body}
    <footer>Document généré le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</footer>
    <script src="${url(PRINT_JS)}"></script>
  </body></html>`);
  w.document.close();
  return true;
}

/**
 * Télécharge un fichier CSV (séparateur « ; », encodage UTF-8 avec BOM pour Excel). Les cellules qui commencent
 * comme une formule sont neutralisées (shared/csv.ts) : tout export passe par ici.
 */
export function downloadCsv(filename: string, head: string[], rows: (string | number)[][], empId?: number) {
  api.signalerExport({ nature: 'csv', titre: filename, lignes: rows.length, empId });
  const csv = texteCsv(head, rows);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
