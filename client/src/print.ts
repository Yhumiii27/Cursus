// Documents imprimables (passeport formation, compte rendu d'entretien) et exports CSV.

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export interface PrintSection { title: string; rows?: [string, string][]; table?: { head: string[]; rows: string[][] }; text?: string }

/** Ouvre un document A4 sobre dans un nouvel onglet et lance l'impression (ou l'enregistrement en PDF). */
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
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>
      body { font: 13px/1.5 Inter, system-ui, sans-serif; color: #1d1f2b; margin: 32px 40px; }
      header { border-bottom: 2px solid #5d5294; padding-bottom: 12px; margin-bottom: 20px; }
      .brand { color: #5d5294; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
      h1 { font-size: 22px; font-weight: 500; margin: 4px 0 2px; } .sub { color: #595d6c; }
      h2 { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: #5d5294; margin: 22px 0 8px; }
      table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e4e7f5; vertical-align: top; }
      th { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #595d6c; }
      dl { display: grid; grid-template-columns: 220px 1fr; gap: 4px 12px; margin: 0; } dt { color: #595d6c; } dd { margin: 0; }
      .text { white-space: pre-wrap; margin: 0; } footer { margin-top: 32px; color: #75798c; font-size: 11px; }
    </style></head><body>
    <header><div class="brand">Cursus</div><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div></header>
    ${body}
    <footer>Document généré le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</footer>
    <script>window.onload = () => setTimeout(() => window.print(), 150);</script>
  </body></html>`);
  w.document.close();
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
