// Cas de paie (t160) : chaque fichier tests/cas-paie/<nom>.json décrit un salarié, son contrat, ses absences et ses
// heures validées, avec les résultats attendus (compteurs CP, RTT et repos compensateur, décompte des semaines, lignes
// du fichier d'import Sage). Le test rejoue chaque cas sur une base en mémoire, à la date du jour du cas, et signale
// chaque écart champ par champ. Les cas réels anonymisés promis par la paie s'ajoutent comme simples fichiers JSON, sans
// code ; un dossier vide ne fait échouer aucun test. Format : tests/cas-paie/LISEZMOI.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const { Db } = await import('../server/src/db.ts');
const { migrate } = await import('../server/src/migrate.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { DEFAULT_SETTINGS, loadFull } = await import('../server/src/dataset.ts');
const { Domain } = await import('../shared/domain.ts');
const { isValidDate, mondayOf } = await import('../shared/dates.ts');
const { cpInfo, recupInfo, rttInfo } = await import('../shared/rules/conges.ts');
const { buildSagePayload, calcSheet, contratFige, sagePending } = await import('../shared/rules/temps.ts');
const { lignesFichier } = await import('../shared/rules/lots-paie.ts');
const { JOURS_FEUILLE } = await import('../shared/rules/semaine.ts');
type User = Parameters<typeof loadFull>[1];
type Settings = typeof DEFAULT_SETTINGS;

export const DOSSIER_CAS = join(import.meta.dirname, 'cas-paie');

/** Valeurs comparées : arrondies au centième (les compteurs et les quantités du fichier le sont). */
type Valeurs = Record<string, number | null>;
interface CasPaie {
  description: string;
  /** Explication libre : origine du cas, règle vérifiée, écart connu et analyse avec la paie. */
  commentaire?: string;
  /** « fabriqué » (règles légales et CCN par défaut) ou « paie » (cas réel anonymisé fourni par la paie). */
  source: 'fabriqué' | 'paie';
  /** Date du jour du calcul (AAAA-MM-JJ), comme CURSUS_TODAY. */
  aujourdhui: string;
  /** Réglages de Paramètres qui diffèrent des valeurs par défaut (rtt39, heuresSupMode, periodeRattachement…). */
  reglages?: Partial<Settings>;
  salarie: { nom: string; matriculePaie: string; entree: string; fin?: string | null; naissanceLe?: string | null };
  contrat: { statut: string; typeContrat: string; temps: string; heures?: number | null; forfaitHeures?: number | null; forfaitJours?: number | null; jourOff?: number[] };
  /** Compteurs arrêtés dans l'ancien outil (Lucca), comme la reprise de la mise en service. */
  reprise?: { arreteLe: string; cpPris?: number; rttPris?: number; recupAcquis?: number; recupPris?: number; cpSolde?: number | null; cpSoldeSuivant?: number | null; rttSolde?: number | null };
  absences?: { type: string; du: string; au: string; statut?: string; debutDemi?: string | null; finDemi?: string | null }[];
  /** Feuilles validées : lundi de la semaine, heures du lundi au dimanche (7 valeurs ; 5 : samedi et dimanche vides). */
  semaines?: { lundi: string; heures: number[]; projet?: string }[];
  attendu: {
    cp?: Valeurs | null; rtt?: Valeurs | null; recup?: Valeurs | null;
    /** Décompte de chaque semaine (calcSheet) : total, normal, sup25, sup50, hc10, hc25, incluses25, incluses50, recup, jours. */
    semaines?: ({ lundi: string } & Valeurs)[];
    /** Lignes du fichier d'import Sage du lot (une par matricule, période et rubrique, quantités cumulées). */
    fichierSage?: { periode: string; rubrique: string; quantite: number }[];
  };
}

const CLES = ['description', 'commentaire', 'source', 'aujourdhui', 'reglages', 'salarie', 'contrat', 'reprise', 'absences', 'semaines', 'attendu'];
const CLES_ATTENDU = ['cp', 'rtt', 'recup', 'semaines', 'fichierSage'];

/** Contrôle du format d'un cas : message en clair pour la personne qui l'a écrit, avant tout calcul. */
export function controlerCas(nom: string, brut: unknown): CasPaie {
  const pb = (m: string): never => { throw new Error(`Cas ${nom} : ${m} (format : tests/cas-paie/LISEZMOI.md)`); };
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) pb('le fichier doit contenir un objet JSON');
  const c = brut as CasPaie;
  const inconnues = Object.keys(c).filter(k => !CLES.includes(k));
  if (inconnues.length) pb(`champ inconnu ${inconnues.join(', ')}`);
  if (!c.description) pb('description manquante');
  if (c.source !== 'fabriqué' && c.source !== 'paie') pb('source : « fabriqué » ou « paie »');
  if (!isValidDate(c.aujourdhui)) pb('aujourdhui : date AAAA-MM-JJ attendue');
  if (!c.salarie?.matriculePaie || !isValidDate(c.salarie.entree)) pb('salarie : matriculePaie et entree (AAAA-MM-JJ) attendus');
  if (!c.contrat?.statut || !c.contrat.typeContrat || !c.contrat.temps) pb('contrat : statut, typeContrat et temps attendus');
  for (const a of c.absences ?? []) if (!a.type || !isValidDate(a.du) || !isValidDate(a.au) || a.au < a.du) pb(`absence ${JSON.stringify(a)} : type, du et au attendus`);
  for (const s of c.semaines ?? []) {
    if (!isValidDate(s.lundi) || mondayOf(s.lundi) !== s.lundi) pb(`semaine ${s.lundi} : un lundi AAAA-MM-JJ attendu`);
    if (!Array.isArray(s.heures) || ![5, JOURS_FEUILLE].includes(s.heures.length) || s.heures.some(h => typeof h !== 'number' || h < 0)) pb(`semaine ${s.lundi} : 5 ou 7 nombres d'heures attendus`);
  }
  if (!c.attendu || typeof c.attendu !== 'object') pb('attendu manquant');
  const inconnusAttendu = Object.keys(c.attendu).filter(k => !CLES_ATTENDU.includes(k));
  if (inconnusAttendu.length) pb(`attendu : champ inconnu ${inconnusAttendu.join(', ')}`);
  return c;
}

const r2 = (v: unknown) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v ?? null);
const RH: User = { role: 'rh', empId: null, nom: 'Cas de paie', intitule: '', profilRh: 'rh_admin' };

/** Résultats de Cursus pour un cas, rejoué sur une base en mémoire neuve à la date du cas. */
export function rejouerCas(c: CasPaie) {
  const avant = process.env.CURSUS_TODAY;
  process.env.CURSUS_TODAY = c.aujourdhui;
  try {
    const db = new Db(':memory:');
    // Comme au démarrage du serveur : reprises puis migrations nommées (activités internes amorcées, etc.).
    migrate(db);
    appliquerMigrations(db);
    if (c.reglages) db.setSetting('app', c.reglages);
    const settings = loadFull(db, RH).settings;
    const e = db.insert<{ id: number }>('employes', {
      nom: c.salarie.nom, equipe: null, poste: 'Cas de paie', statut: c.contrat.statut, typeContrat: c.contrat.typeContrat, temps: c.contrat.temps,
      heures: c.contrat.heures ?? null, forfaitHeures: c.contrat.forfaitHeures ?? null, forfaitJours: c.contrat.forfaitJours ?? null, jourOff: c.contrat.jourOff ?? [],
      entree: c.salarie.entree, fin: c.salarie.fin ?? null, matriculePaie: c.salarie.matriculePaie,
      naissanceLe: c.salarie.naissanceLe ?? null, naissance: c.salarie.naissanceLe ? Number(c.salarie.naissanceLe.slice(0, 4)) : null,
    });
    if (c.reprise) db.insert('soldesReprise', { cpPris: 0, rttPris: 0, recupAcquis: 0, recupPris: 0, ...c.reprise, empId: e.id });
    for (const a of c.absences ?? []) db.insert('absences', { statut: 'validee', ...a, empId: e.id, keystone: false });
    const fiche = loadFull(db, RH).employes.find(x => x.id === e.id)!;
    // Feuilles validées : régime et mode des heures supplémentaires figés comme à la validation (server/src/actions/temps.ts).
    for (const s of c.semaines ?? []) {
      db.insert('feuilles', {
        empId: e.id, week: s.lundi, statut: 'validee', comment: null, sage: false, keystone: false, contrat: contratFige(fiche),
        lignes: [{ projet: s.projet ?? 'INT-PROD', tache: '', ks: false, h: s.heures }], heuresSup: settings.heuresSupMode, majDimanche: settings.majorationDimanche,
      });
    }
    const d = new Domain(loadFull(db, RH));
    const emp = d.emp(e.id)!;
    const feuilles = d.ds.feuilles.filter(sh => sh.empId === e.id);
    return {
      cp: cpInfo(d, emp), rtt: rttInfo(d, emp), recup: recupInfo(d, emp),
      semaines: feuilles.map(sh => ({ lundi: sh.week, ...calcSheet(d, emp, sh) })),
      fichierSage: lignesFichier(buildSagePayload(d, sagePending(d), 'CURSUS-CHIMIE')).map(({ periode, rubrique, quantite }) => ({ periode, rubrique, quantite })),
    };
  } finally {
    if (avant === undefined) delete process.env.CURSUS_TODAY;
    else process.env.CURSUS_TODAY = avant;
  }
}

/** Écarts entre les résultats attendus d'un cas et ceux de Cursus : un message par valeur différente. */
export function ecartsCas(c: CasPaie, obtenu: ReturnType<typeof rejouerCas>): string[] {
  const out: string[] = [];
  const comparer = (ou: string, attendu: Valeurs | null | undefined, recu: Record<string, unknown> | null) => {
    if (attendu === undefined) return;
    if (attendu === null || recu === null) {
      if (attendu !== recu) out.push(`${ou} : attendu ${attendu === null ? 'aucun compteur' : 'un compteur'}, Cursus ${recu === null ? 'n’en tient pas' : 'en tient un'}`);
      return;
    }
    for (const [k, v] of Object.entries(attendu)) {
      if (k === 'lundi') continue;
      if (!(k in recu)) out.push(`${ou}.${k} : valeur inconnue de Cursus`);
      else if (r2(recu[k]) !== r2(v)) out.push(`${ou}.${k} : attendu ${v}, Cursus ${r2(recu[k])}`);
    }
  };
  comparer('cp', c.attendu.cp, obtenu.cp);
  comparer('rtt', c.attendu.rtt, obtenu.rtt);
  comparer('recup', c.attendu.recup, obtenu.recup);
  for (const s of c.attendu.semaines ?? []) {
    const recu = obtenu.semaines.find(x => x.lundi === s.lundi);
    if (!recu) out.push(`semaine du ${s.lundi} : absente des heures du cas`);
    else comparer(`semaine du ${s.lundi}`, s, recu as unknown as Record<string, unknown>);
  }
  if (c.attendu.fichierSage) {
    const cle = (l: { periode: string; rubrique: string }) => `${l.periode} ${l.rubrique}`;
    const recus = new Map(obtenu.fichierSage.map(l => [cle(l), l.quantite]));
    const attendus = new Map(c.attendu.fichierSage.map(l => [cle(l), l.quantite]));
    for (const [k, q] of attendus) if (r2(recus.get(k) ?? 0) !== r2(q)) out.push(`fichier Sage ${k} : attendu ${q}, Cursus ${recus.get(k) ?? 'aucune ligne'}`);
    for (const [k, q] of recus) if (!attendus.has(k)) out.push(`fichier Sage ${k} : ligne non attendue (${q})`);
  }
  return out;
}

const fichiers = readdirSync(DOSSIER_CAS).filter(f => f.endsWith('.json')).sort();

for (const f of fichiers) {
  const nom = f.replace(/\.json$/, '');
  test(`cas de paie ${nom}`, () => {
    const c = controlerCas(nom, JSON.parse(readFileSync(join(DOSSIER_CAS, f), 'utf8')));
    const ecarts = ecartsCas(c, rejouerCas(c));
    assert.deepEqual(ecarts, [], `${c.description} — écarts avec ${c.source === 'paie' ? 'la paie' : 'le calcul attendu'} :\n  ${ecarts.join('\n  ')}`);
  });
}

test('cas de paie : format contrôlé et écart signalé champ par champ', () => {
  assert.throws(() => controlerCas('x', { description: 'd', source: 'paie', aujourdhui: '2026-10-10', salarie: { matriculePaie: 'M1', entree: '2026-01-05' }, contrat: { statut: 'ouvrier', typeContrat: 'cdi', temps: '35h' }, attendu: {}, salaire: 1 }),
    /Cas x : champ inconnu salaire/);
  assert.throws(() => controlerCas('x', { description: 'd', source: 'paie', aujourdhui: '2026-10-10', salarie: { matriculePaie: 'M1', entree: '2026-01-05' }, contrat: { statut: 'ouvrier', typeContrat: 'cdi', temps: '35h' }, semaines: [{ lundi: '2026-09-08', heures: [7, 7, 7, 7, 7] }], attendu: {} }),
    /semaine 2026-09-08 : un lundi/);
  const c = controlerCas('essai', {
    description: '35 h, une semaine de 40 h', source: 'fabriqué', aujourdhui: '2026-10-10',
    salarie: { nom: 'Essai', matriculePaie: 'E001', entree: '2026-01-05' }, contrat: { statut: 'ouvrier', typeContrat: 'cdi', temps: '35h' },
    semaines: [{ lundi: '2026-10-05', heures: [8, 8, 8, 8, 8] }],
    attendu: { rtt: null, semaines: [{ lundi: '2026-10-05', sup25: 4 }], fichierSage: [{ periode: '2026-10', rubrique: 'HN', quantite: 35 }] },
  });
  assert.deepEqual(ecartsCas(c, rejouerCas(c)), [
    'semaine du 2026-10-05.sup25 : attendu 4, Cursus 5',
    'fichier Sage 2026-10 HS25 : ligne non attendue (5)',
  ]);
});
