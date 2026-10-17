// Documents imprimables (passeport formation, compte rendu d'entretien, demande de visite) et exports CSV.
import { texteCsv } from '../../shared/csv.ts';
import { matricule } from '../../shared/format.ts';
import type { Employe } from '../../shared/types.ts';
// Chaque export ou impression est signalé au serveur pour le journal des actions (`empId` : salarié concerné).
import { api } from './api.ts';
import printCss from './styles/print.css?url';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export interface PrintSection { title: string; rows?: [string, string][]; table?: { head: string[]; rows: string[][] }; text?: string }

/** Script servi tel quel (client/public) : il lance l'impression depuis le document ouvert. */
const PRINT_JS = '/imprimer.js';

/**
 * En-tête employeur des documents : la coordonnée « responsable du traitement » (raison sociale et adresse, Paramètres →
 * Confidentialité, lisible sans connexion), lue une fois par onglet ; vide ou illisible : « Cursus » seul.
 */
let employeur: Promise<string | null> | null = null;
function enteteEmployeur(): Promise<string | null> {
  employeur ??= api.confidentialite().then(c => c.responsable?.trim() || null, () => { employeur = null; return null; });
  return employeur;
}
/** Attente maximale de l'en-tête avant d'imprimer sans lui (serveur lent). */
const ATTENTE_ENTETE_MS = 1500;

/** Matricules d'un document individuel : matricule de paie (s'il est saisi) et matricule Cursus. */
export function matriculesImprimes(e: Pick<Employe, 'id' | 'matriculePaie'>): string {
  return [e.matriculePaie ? `Matricule de paie ${e.matriculePaie}` : '', `matricule Cursus ${matricule(e.id)}`].filter(Boolean).join(' · ');
}

/** Document complet (HTML), avec la feuille d'impression et le script qui lance l'impression. */
function documentHtml(title: string, subtitle: string, sections: PrintSection[], entete: string | null, matricules?: string): string {
  const url = (path: string) => esc(new URL(path, location.href).href);
  const body = sections.map(s => `
    <section>
      <h2>${esc(s.title)}</h2>
      ${s.rows ? `<dl>${s.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      ${s.table ? `<table><thead><tr>${s.table.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${s.table.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}
      ${s.text ? `<p class="text">${esc(s.text)}</p>` : ''}
    </section>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <link rel="stylesheet" href="${url(printCss)}"></head><body>
    <header>${entete ? `<div class="employeur">${esc(entete)}</div>` : '<div class="brand">Cursus</div>'}<h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div>${matricules ? `<div class="sub">${esc(matricules)}</div>` : ''}</header>
    ${body}
    <footer>Document généré par Cursus le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</footer>
    <script src="${url(PRINT_JS)}"></script>
  </body></html>`;
}

/** Cadre d'impression en cours (un seul à la fois) : retiré après l'impression, ou à la suivante. */
let cadre: HTMLIFrameElement | null = null;

/**
 * Imprime un document A4 sobre (ou l'enregistre en PDF) : en-tête de l'employeur, titre, sous-titre et, pour un document
 * individuel, matricules du salarié (`matricules`, voir `matriculesImprimes`). Le document est écrit dans un cadre caché
 * de la page, sans fenêtre surgissante (bloquée par certains navigateurs) ; à défaut de cadre, il s'ouvre dans un nouvel
 * onglet, comme avant. Cadre et onglet héritent de la politique de sécurité (CSP) de Cursus : ni script ni style en ligne.
 * La mise en page vient d'une feuille servie, l'impression d'un script servi (client/public/imprimer.js) qui s'exécute
 * dans le document imprimé. Le doctype garde le document en mode standard. Faux si rien n'a pu s'ouvrir.
 */
export function printDocument(title: string, subtitle: string, sections: PrintSection[], empId?: number, matricules?: string): boolean {
  cadre?.remove();
  const f = document.createElement('iframe');
  f.className = 'cadre-impression';
  f.setAttribute('aria-hidden', 'true');
  f.tabIndex = -1;
  f.title = title;
  document.body.appendChild(f);
  const doc = f.contentDocument;
  if (!doc || !f.contentWindow) {
    // Cadre impossible (navigateur ancien) : nouvel onglet, synchrone pour rester dans le clic de la personne.
    f.remove();
    const w = window.open('', '_blank');
    if (!w) return false;
    api.signalerExport({ nature: 'impression', titre: title, empId });
    w.document.open();
    w.document.write(documentHtml(title, subtitle, sections, null, matricules));
    w.document.close();
    return true;
  }
  cadre = f;
  api.signalerExport({ nature: 'impression', titre: title, empId });
  const attente = new Promise<null>(r => setTimeout(() => r(null), ATTENTE_ENTETE_MS));
  void Promise.race([enteteEmployeur(), attente]).then(entete => {
    if (cadre !== f) return;
    doc.open();
    doc.write(documentHtml(title, subtitle, sections, entete, matricules));
    doc.close();
    // Impression terminée (ou annulée) : le cadre est retiré.
    f.contentWindow?.addEventListener('afterprint', () => setTimeout(() => { if (cadre === f) { f.remove(); cadre = null; } }, 0), { once: true });
  });
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
