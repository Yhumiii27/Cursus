// Documents imprimables (passeport formation, compte rendu d'entretien, demande de visite, organigramme) et exports CSV.
// L'organigramme (lot 11) s'imprime en paysage, une entité par page, et se signale au journal par sa propre action
// (`organigramme.imprimer`, `organigramme.exporter` : entité, nombre de lignes et service choisi), d'où `journal: false`.
import { texteCsv } from '../../shared/csv.ts';
import { matricule } from '../../shared/format.ts';
import type { Employe } from '../../shared/types.ts';
// Chaque export ou impression est signalé au serveur pour le journal des actions (`empId` : salarié concerné).
import { api } from './api.ts';
import printCss from './styles/print.css?url';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export interface PrintSection {
  title: string; rows?: [string, string][]; table?: { head: string[]; rows: string[][] }; text?: string;
  // lot 11 — organigramme : sous-titre, arbre en listes imbriquées (traits de print.css), saut de page avant la section.
  sub?: string; arbre?: PrintArbre[]; saut?: boolean;
  // lot 12 — C7 (organigramme) : arbre vertical (boîtes reliées de haut en bas) et son échelle en pour cent (`echelle-NN`
  // de print.css, par dizaines de 30 à 100 : ni style ni script en ligne).
  vertical?: boolean; echelle?: number;
}
/** Nœud d'un arbre imprimé (organigramme) : libellé, précision, nœuds rattachés ; `groupe` : nœud d'entité ou d'équipe. */
export interface PrintArbre { libelle: string; detail?: string; enfants?: PrintArbre[]; groupe?: boolean }
/** Options d'impression (lot 11) : page en paysage ; `journal` faux : l'écran signale lui-même l'impression au journal. */
export interface OptionsImpression { paysage?: boolean; journal?: boolean }

/** Listes imbriquées d'un arbre imprimé. */
const arbreHtml = (noeuds: PrintArbre[]): string => `<ul>${noeuds.map(n => `<li${n.groupe ? ' class="groupe"' : ''}><span class="libelle">${esc(n.libelle)}</span>${n.detail ? ` <span class="detail">${esc(n.detail)}</span>` : ''}${n.enfants?.length ? arbreHtml(n.enfants) : ''}</li>`).join('')}</ul>`;

// lot 12 — C7 (organigramme)
/**
 * Arbre vertical imprimé : chaque nœud `groupe` est une boîte (libellé, précision, puis ses nœuds simples en liste
 * compacte), ses nœuds `groupe` dessous, reliés par les traits de print.css.
 */
const boiteHtml = (n: PrintArbre): string => {
  const membres = (n.enfants ?? []).filter(x => !x.groupe), groupes = (n.enfants ?? []).filter(x => x.groupe);
  return `<li><div class="boite"><span class="libelle">${esc(n.libelle)}</span>${n.detail ? `<span class="detail">${esc(n.detail)}</span>` : ''}${membres.length
    ? `<ul class="membres">${membres.map(m => `<li>${esc(m.libelle)}${m.detail ? ` <span class="detail">${esc(m.detail)}</span>` : ''}</li>`).join('')}</ul>` : ''}</div>${groupes.length
    ? `<ul class="enfants">${groupes.map(boiteHtml).join('')}</ul>` : ''}</li>`;
};
export const arbreVerticalHtml = (noeuds: PrintArbre[], echelle = 100): string => {
  const e = Math.min(100, Math.max(30, Math.round(echelle / 10) * 10));
  return `<div class="arbre-vertical${e < 100 ? ` echelle-${e}` : ''}"><ul class="racines">${noeuds.map(boiteHtml).join('')}</ul></div>`;
};

/** Script servi tel quel (client/public) : il lance l'impression depuis le document ouvert. */
const PRINT_JS = '/imprimer.js';

/**
 * En-tête employeur des documents : la coordonnée « responsable du traitement » (raison sociale et adresse, Paramètres →
 * Confidentialité, lisible sans connexion), lue une fois par onglet ; vide ou illisible : « Cursus » seul. Une réponse vide
 * ou une erreur n'est pas gardée : réglée ensuite par l'administrateur RH, la coordonnée vaut dès l'impression suivante.
 * Elle est aussi relue après chaque réglage de la confidentialité (`oublierEnteteEmployeur`).
 */
let employeur: Promise<string | null> | null = null;
function enteteEmployeur(): Promise<string | null> {
  const lecture = employeur ??= api.confidentialite().then(c => c.responsable?.trim() || null, () => null);
  lecture.then(v => { if (!v && employeur === lecture) employeur = null; });
  return lecture;
}
/** Oublie l'en-tête lu : la prochaine impression relit la coordonnée (après un réglage de la confidentialité). */
export function oublierEnteteEmployeur() { employeur = null; }
/** Attente maximale de l'en-tête avant d'imprimer sans lui (serveur lent). */
const ATTENTE_ENTETE_MS = 1500;

/** Matricules d'un document individuel : matricule de paie (s'il est saisi) et matricule Cursus. */
export function matriculesImprimes(e: Pick<Employe, 'id' | 'matriculePaie'>): string {
  return [e.matriculePaie ? `Matricule de paie ${e.matriculePaie}` : '', `matricule Cursus ${matricule(e.id)}`].filter(Boolean).join(' · ');
}

/** Document complet (HTML), avec la feuille d'impression et le script qui lance l'impression. */
function documentHtml(title: string, subtitle: string, sections: PrintSection[], entete: string | null, matricules?: string, o: OptionsImpression = {}): string {
  const url = (path: string) => esc(new URL(path, location.href).href);
  const body = sections.map(s => `
    <section${s.saut ? ' class="saut"' : ''}>
      <h2>${esc(s.title)}</h2>
      ${s.sub ? `<div class="sub">${esc(s.sub)}</div>` : ''}
      ${s.arbre && !s.vertical ? `<div class="arbre">${arbreHtml(s.arbre)}</div>` : ''}
      ${s.arbre && s.vertical ? arbreVerticalHtml(s.arbre, s.echelle) : ''}
      ${s.rows ? `<dl>${s.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      ${s.table ? `<table><thead><tr>${s.table.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${s.table.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}
      ${s.text ? `<p class="text">${esc(s.text)}</p>` : ''}
    </section>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <link rel="stylesheet" href="${url(printCss)}"></head><body${o.paysage ? ' class="paysage"' : ''}>
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
export function printDocument(title: string, subtitle: string, sections: PrintSection[], empId?: number, matricules?: string, o: OptionsImpression = {}): boolean {
  const signaler = () => { if (o.journal !== false) api.signalerExport({ nature: 'impression', titre: title, empId }); };
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
    signaler();
    w.document.open();
    w.document.write(documentHtml(title, subtitle, sections, null, matricules, o));
    w.document.close();
    return true;
  }
  cadre = f;
  signaler();
  const attente = new Promise<null>(r => setTimeout(() => r(null), ATTENTE_ENTETE_MS));
  void Promise.race([enteteEmployeur(), attente]).then(entete => {
    if (cadre !== f) return;
    doc.open();
    doc.write(documentHtml(title, subtitle, sections, entete, matricules, o));
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
export function downloadCsv(filename: string, head: string[], rows: (string | number)[][], empId?: number, o: Pick<OptionsImpression, 'journal'> = {}) {
  if (o.journal !== false) api.signalerExport({ nature: 'csv', titre: filename, lignes: rows.length, empId });
  const csv = texteCsv(head, rows);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
