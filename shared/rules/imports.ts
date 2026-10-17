// Imports CSV : lecture robuste des fichiers, plan prévisionnel de formation et demandes de déplacement (reprise depuis
// Lucca : shared/rules/reprise.ts).
import { parse, toIso } from '../dates.ts';
import { fmt, fmtShort, key, norm } from '../format.ts';
import { blocage, conflitsDates } from './conflits.ts';
import type { Destination, Employe, Formation, ISODate, Trimestre } from '../types.ts';
import type { Domain } from '../domain.ts';

/**
 * Lecture d'un fichier CSV (exports d'Excel, de Lucca…) : BOM retiré, séparateur détecté sur la première ligne
 * (« ; », tabulation ou « , », hors guillemets), cellules entre guillemets avec « ; », guillemets doublés (« "" ») ou
 * sauts de ligne, fins de ligne Windows ou Unix. Les lignes vides sont écartées ; chaque ligne garde son numéro dans le
 * fichier (`numeros`, à partir de 1), cité par les rapports d'erreurs.
 */
export function lireCsv(text: string): { lignes: string[][]; numeros: number[]; sep: string } {
  const t = String(text || '').replace(/^﻿/, '');
  // Séparateur : le plus fréquent hors guillemets sur la première ligne non vide (« ; » à égalité, celui d'Excel en France).
  const premiere = (t.split(/\r?\n/).find(l => l.trim()) ?? '').replace(/"[^"]*"/g, '');
  const compte = (c: string) => premiere.split(c).length - 1;
  const sep = [';', '\t', ','].reduce((a, c) => (compte(c) > compte(a) ? c : a), ';');
  const lignes: string[][] = [], numeros: number[] = [];
  let ligne: string[] = [], cellule = '', guillemets = false, n = 1, debut = 1;
  const finCellule = () => { ligne.push(cellule.trim()); cellule = ''; };
  const finLigne = () => {
    finCellule();
    if (ligne.some(c => c !== '')) { lignes.push(ligne); numeros.push(debut); }
    ligne = [];
  };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (guillemets) {
      if (c === '"' && t[i + 1] === '"') { cellule += '"'; i++; } else if (c === '"') guillemets = false;
      else { if (c === '\n') n++; cellule += c; }
    } else if (c === '"' && !cellule.trim()) { guillemets = true; cellule = ''; } else if (c === sep) finCellule();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      finLigne();
      debut = ++n;
    } else cellule += c;
  }
  finLigne();
  return { lignes, numeros, sep };
}

/** Lignes du fichier, découpées en cellules (`lireCsv`) : imports du plan et des déplacements. */
function splitCsv(text: string) {
  return { lines: lireCsv(text).lignes, cells: (l: string[]) => l };
}

export function matchFormation(formations: Formation[], label: string): Formation | null {
  const q = key(label);
  if (!q) return null;
  const qt = q.split(' ');
  return formations.find(f => key(f.court) === q || f.id === q.replace(/ /g, ''))
    || formations.find(f => key(f.nom).includes(q))
    || formations.find(f => key(f.court).split(' ').every(t => qt.includes(t)))
    || formations.find(f => qt.every(t => key(f.court).split(' ').includes(t))) || null;
}

export interface PlanRow { n: number; libelle: string; f: string | null; equipe: string | null; periode: Trimestre | null; effectif: number; cout: number; estime: boolean; errs: string[]; ok: boolean }

export function parsePlan(d: Domain, text: string): PlanRow[] {
  const { lines, cells } = splitCsv(text);
  if (!lines.length) return [];
  const colOf = (c: string) => /^(formation|intitul|libell|action)/.test(c) ? 'formation' : /^(equipe|service|direction)/.test(c) ? 'equipe' : /^(period|trimestre|quand)/.test(c) ? 'periode' : /^(effectif|nb|nombre|participants)/.test(c) ? 'effectif' : /^(cout|budget|montant|prix)/.test(c) ? 'cout' : c;
  const head = cells(lines[0]).map(c => colOf(norm(c)));
  const hasHead = head.some(c => ['formation', 'equipe', 'periode', 'effectif', 'cout'].includes(c));
  const cols = hasHead ? head : ['formation', 'equipe', 'periode', 'effectif', 'cout'];
  const eqKey: Record<string, string> = {};
  d.equipes.forEach(e => { eqKey[key(e)] = e; });
  const formations = d.ds.referentiels.formations;
  return lines.slice(hasHead ? 1 : 0).map((l, i) => {
    const v: Record<string, string> = {};
    cells(l).forEach((c, j) => { v[cols[j]] = c; });
    const errs: string[] = [];
    const libelle = (v.formation || '').trim();
    if (!libelle) errs.push('Formation manquante');
    const fm = matchFormation(formations, libelle);
    const equipe = eqKey[key(v.equipe)] || null;
    if (!equipe) errs.push(v.equipe ? `Équipe inconnue : ${v.equipe}` : 'Équipe manquante');
    const pm = /^(?:t|q|trim\w*\s*)?\s*([1-4])/i.exec((v.periode || '').trim());
    const periode = pm ? `T${pm[1]}` as Trimestre : null;
    if (!periode) errs.push('Période invalide (T1–T4)');
    const effectif = parseInt(v.effectif, 10);
    if (!(effectif > 0)) errs.push('Effectif invalide');
    const raw = (v.cout || '').replace(/[^\d,.-]/g, '').replace(',', '.');
    let cout = raw === '' ? NaN : Number(raw), estime = false;
    if (!(cout >= 0)) {
      if (fm && effectif > 0) { cout = effectif * fm.cout; estime = true; } else errs.push('Coût manquant');
    }
    return { n: i + 1, libelle, f: fm ? fm.id : null, equipe, periode, effectif, cout, estime, errs, ok: errs.length === 0 };
  });
}

export interface TripRow {
  n: number; ref: string; emp: Employe | undefined; dest: Destination | undefined; depart: ISODate | null; retour: ISODate | null;
  motif: string; errs: string[]; ok: boolean; nomLabel: string; destLabel: string; dates: string;
  /**
   * Demandeur (colonne « demandeur ») : nom du salarié reconnu, sinon le nom tel que saisi (texte libre, 120 caractères au
   * plus) ; null si la colonne est vide. `demandeurConnu` : un salarié de Cursus porte ce nom.
   */
  demandeur: string | null; demandeurConnu: boolean;
}

/** Longueur maximale du demandeur gardé tel que saisi. */
export const DEMANDEUR_MAX = 120;

/**
 * Référence d'un déplacement importé sans référence : `DD-<identifiant>`, comme le prototype ; une référence déjà prise
 * (saisie telle quelle dans un fichier précédent) reçoit un suffixe (`DD-12-2`). `prises` : références existantes.
 */
export function referenceDeplacement(id: number, prises: ReadonlySet<string>): string {
  const base = `DD-${id}`;
  if (!prises.has(base)) return base;
  let n = 2;
  while (prises.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function parseTrips(d: Domain, text: string): TripRow[] {
  const { lines, cells } = splitCsv(text);
  if (!lines.length) return [];
  const colOf = (c: string) => /^(ref|numero)/.test(c) ? 'ref' : /^(collab|salari|employ|voyageur|nom)/.test(c) ? 'collaborateur' : /^(dest|pays)/.test(c) ? 'destination' : /^(depart|aller|debut)/.test(c) ? 'depart' : /^(retour|fin)/.test(c) ? 'retour' : /^(motif|objet)/.test(c) ? 'motif' : /^demandeur/.test(c) ? 'demandeur' : c;
  const head = cells(lines[0]).map(c => colOf(norm(c)));
  const hasHead = head.includes('collaborateur') || head.includes('destination');
  const cols = hasHead ? head : ['ref', 'collaborateur', 'destination', 'depart', 'retour', 'motif', 'demandeur'];
  const seen = new Set(d.ds.voyages.map(v => v.ref).filter(Boolean));
  /** Lignes valides déjà lues : deux déplacements du fichier ne se chevauchent pas non plus. */
  const retenues: { n: number; empId: number; depart: ISODate; retour: ISODate }[] = [];
  return lines.slice(hasHead ? 1 : 0).map((l, i) => {
    const v: Record<string, string> = {};
    cells(l).forEach((c, j) => { v[cols[j]] = c; });
    const errs: string[] = [];
    const emp = d.ds.employes.find(e => key(e.nom) === key(v.collaborateur));
    if (!emp) errs.push(v.collaborateur ? `Collaborateur inconnu : ${v.collaborateur}` : 'Collaborateur manquant');
    const dest = d.ds.referentiels.destinations.find(x => key(x.pays) === key(v.destination) || x.code === (v.destination || '').toUpperCase());
    if (!dest) errs.push(v.destination ? `Destination hors référentiel : ${v.destination}` : 'Destination manquante');
    else if (dest.archive) errs.push(`Destination archivée : ${dest.pays}`);
    const depart = toIso(v.depart), retour = toIso(v.retour);
    if (!depart || !retour || retour < depart) errs.push('Dates invalides');
    else if (emp) {
      // Déjà en déplacement ou absent ces jours-là (contrôle commun, `conflits.ts`), ou chevauchement dans le fichier.
      const conflit = blocage(conflitsDates(d, emp.id, depart, retour, 'voyage'));
      if (conflit) errs.push(conflit);
      const autre = retenues.find(x => x.empId === emp.id && x.depart <= retour && x.retour >= depart);
      if (autre) errs.push(`Chevauche le déplacement de la ligne ${autre.n}`);
    }
    const ref = (v.ref || '').trim();
    if (ref && seen.has(ref)) errs.push(`Déjà importée : ${ref}`);
    if (ref) seen.add(ref);
    if (!errs.length) retenues.push({ n: i + 1, empId: emp!.id, depart: depart!, retour: retour! });
    // Demandeur : rapproché d'un salarié comme le collaborateur, sinon gardé tel que saisi.
    const saisi = (v.demandeur || '').replace(/\s+/g, ' ').trim().slice(0, DEMANDEUR_MAX);
    const parQui = saisi ? d.ds.employes.find(e => key(e.nom) === key(saisi)) : undefined;
    return {
      n: i + 1, ref, emp, dest, depart, retour, motif: (v.motif || '').trim() || 'Déplacement professionnel', errs, ok: errs.length === 0,
      demandeur: parQui ? parQui.nom : saisi || null, demandeurConnu: !!parQui,
      nomLabel: emp ? emp.nom : (v.collaborateur || '—'), destLabel: dest ? dest.pays : (v.destination || '—'),
      dates: depart && retour ? `${fmtShort(parse(depart))} → ${fmt(parse(retour))}` : '—',
    };
  });
}

export const SAMPLE_PLAN_CSV = 'formation;equipe;periode;effectif;cout\nSST;Production;T1;10;1 800\nHabilitation électrique;Maintenance;T1;6;2 880\nCACES R489;Logistique;T2;5;3 250\nEPI incendie;Administration;T2;8;320\nTravail en hauteur;Maintenance;T3;4;1 280\nPRAP;Production;T3;6;\nRGPD;Commercial;T4;12;0\nManagement de proximité;Production;T2;4;3 600\nAnglais professionnel;Commercial;T1;3;2 400\nFCO;Logistique;T3;3;2 700\nGestion du stress;Marketing;T2;5;1 500';

export const SAMPLE_TRIPS_CSV = 'reference;collaborateur;destination;depart;retour;motif;demandeur\nDD-2026-0431;Clara Roussel;États-Unis;02/11/2026;06/11/2026;Salon FabTech — Chicago;Nadia Kaci\nDD-2026-0433;Nadia Kaci;Inde;07/12/2026;11/12/2026;Formation partenaire — Pune;Nadia Kaci\nDD-2026-0435;Mehdi Benali;Vietnam;12/01/2027;22/01/2027;Audit fournisseur — Hô Chi Minh-Ville;Karim Haddad\nDD-2026-0436;Paul Durand;Maroc;10/11/2026;12/11/2026;Visite client — Casablanca;Nadia Kaci\nDD-2026-0437;Antoine Leroy;Japon;14/11/2026;20/11/2026;Séminaire — Osaka;Antoine Leroy';
