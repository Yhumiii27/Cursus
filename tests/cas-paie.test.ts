// Cas de paie (t160) : chaque fichier tests/cas-paie/<nom>.json décrit un salarié, son contrat, ses absences et ses
// heures validées, avec les résultats attendus (compteurs CP, RTT et repos compensateur, décompte des semaines, lignes
// du fichier d'import Sage). Le test rejoue chaque cas sur une base en mémoire, à la date du jour du cas, et signale
// chaque écart champ par champ. Les cas réels anonymisés promis par la paie s'ajoutent comme simples fichiers JSON, sans
// code ; un dossier vide ne fait échouer aucun test. Un cas réel qui garde une donnée de santé (nature médicale d'une
// absence) n'est pas versionné : il se rejoue depuis un dossier hors du dépôt, donné par CURSUS_CAS_PAIE.
// Format et règles d'anonymisation : tests/cas-paie/LISEZMOI.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { migrate } = await import('../server/src/migrate.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { DEFAULT_SETTINGS, loadFull } = await import('../server/src/dataset.ts');
const { Domain } = await import('../shared/domain.ts');
const { isValidDate, mondayOf } = await import('../shared/dates.ts');
const { cpInfo, recupInfo, rttInfo } = await import('../shared/rules/conges.ts');
const { buildSagePayload, calcSheet, contratFige, sagePending } = await import('../shared/rules/temps.ts');
const { lignesFichier } = await import('../shared/rules/lots-paie.ts');
const { JOURS_FEUILLE } = await import('../shared/rules/semaine.ts');
const { natureMedicale } = await import('../shared/rules/absences.ts');
const { appliquerReglages } = await import('../shared/reglages.ts');
const { ABS_LABEL, STATUTS, TEMPS_TRAVAIL, TYPES_CONTRAT } = await import('../shared/constants.ts');
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
// Champs admis à l'intérieur du cas : une faute de frappe (`forfaitjours`) serait sinon ignorée et le cas rejoué avec
// la valeur par défaut, ce qui ferait passer une erreur du fichier pour un écart de calcul de Cursus.
const CLES_SALARIE = ['nom', 'matriculePaie', 'entree', 'fin', 'naissanceLe'];
const CLES_CONTRAT = ['statut', 'typeContrat', 'temps', 'heures', 'forfaitHeures', 'forfaitJours', 'jourOff'];
const CLES_REPRISE = ['arreteLe', 'cpPris', 'rttPris', 'recupAcquis', 'recupPris', 'cpSolde', 'cpSoldeSuivant', 'rttSolde', 'cetSolde'];
const CLES_ABSENCE = ['type', 'du', 'au', 'statut', 'debutDemi', 'finDemi'];
const CLES_SEMAINE = ['lundi', 'heures', 'projet'];
const CLES_LIGNE_SAGE = ['periode', 'rubrique', 'quantite'];
const STATUTS_ABSENCE = ['demandee', 'validee', 'refusee', 'signalee', 'annulee'];
const DEMI_JOURNEES = ['matin', 'apres_midi'];

/**
 * Contrôle du format d'un cas : message en clair pour la personne qui l'a écrit, avant tout calcul. `dansLeDepot` : le
 * cas est versionné (tests/cas-paie/) ; un cas réel (`source: "paie"`) n'y garde aucune nature d'absence médicale.
 */
export function controlerCas(nom: string, brut: unknown, dansLeDepot = true): CasPaie {
  const pb = (m: string): never => { throw new Error(`Cas ${nom} : ${m} (format : tests/cas-paie/LISEZMOI.md)`); };
  const objet = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
  const champs = (ou: string, v: unknown, cles: string[]) => {
    if (!objet(v)) pb(`${ou} : objet attendu`);
    const inconnus = Object.keys(v as object).filter(k => !cles.includes(k));
    if (inconnus.length) pb(`champ inconnu ${inconnus.map(k => (ou ? `${ou}.${k}` : k)).join(', ')}`);
  };
  const valeur = (ou: string, v: unknown, admis: string[]) => { if (!admis.includes(v as string)) pb(`${ou} « ${v} » inconnu (${admis.join(', ')})`); };
  if (!objet(brut)) pb('le fichier doit contenir un objet JSON');
  const c = brut as CasPaie;
  champs('', c, CLES);
  if (!c.description) pb('description manquante');
  if (c.source !== 'fabriqué' && c.source !== 'paie') pb('source : « fabriqué » ou « paie »');
  if (!isValidDate(c.aujourdhui)) pb('aujourdhui : date AAAA-MM-JJ attendue');
  if (c.reglages !== undefined) {
    champs('reglages', c.reglages, Object.keys(DEFAULT_SETTINGS));
    // Mêmes contrôles que Paramètres ; une valeur que Paramètres ramènerait dans ses bornes ou à la valeur en vigueur
    // (hors liste, non numérique) est refusée ici, au lieu d'être corrigée en silence.
    let retenus: Record<string, unknown> = {};
    try { retenus = appliquerReglages(DEFAULT_SETTINGS, c.reglages as Record<string, unknown>) as unknown as Record<string, unknown>; } catch (e) { pb(`reglages : ${(e as Error).message}`); }
    for (const [k, v] of Object.entries(c.reglages)) if (JSON.stringify(retenus[k]) !== JSON.stringify(v)) pb(`reglages.${k} : valeur ${JSON.stringify(v)} refusée par Paramètres`);
  }
  champs('salarie', c.salarie, CLES_SALARIE);
  if (!c.salarie.matriculePaie || !isValidDate(c.salarie.entree)) pb('salarie : matriculePaie et entree (AAAA-MM-JJ) attendus');
  for (const k of ['fin', 'naissanceLe'] as const) if (c.salarie[k] != null && !isValidDate(c.salarie[k])) pb(`salarie.${k} : date AAAA-MM-JJ attendue`);
  champs('contrat', c.contrat, CLES_CONTRAT);
  if (!c.contrat.statut || !c.contrat.typeContrat || !c.contrat.temps) pb('contrat : statut, typeContrat et temps attendus');
  valeur('contrat.statut', c.contrat.statut, Object.keys(STATUTS));
  valeur('contrat.typeContrat', c.contrat.typeContrat, Object.keys(TYPES_CONTRAT));
  valeur('contrat.temps', c.contrat.temps, Object.keys(TEMPS_TRAVAIL));
  if (c.reprise !== undefined) {
    champs('reprise', c.reprise, CLES_REPRISE);
    if (!isValidDate(c.reprise.arreteLe)) pb('reprise.arreteLe : date AAAA-MM-JJ attendue');
  }
  for (const a of c.absences ?? []) {
    champs('absence', a, CLES_ABSENCE);
    if (!a.type || !isValidDate(a.du) || !isValidDate(a.au) || a.au < a.du) pb(`absence ${JSON.stringify(a)} : type, du et au attendus`);
    valeur('absence : type', a.type, Object.keys(ABS_LABEL));
    if (a.statut != null) valeur('absence : statut', a.statut, STATUTS_ABSENCE);
    if (a.debutDemi != null) valeur('absence : debutDemi', a.debutDemi, DEMI_JOURNEES);
    if (a.finDemi != null) valeur('absence : finDemi', a.finDemi, DEMI_JOURNEES);
    // La nature d'une absence pour raison de santé est une donnée de santé (docs/RGPD.md) : jamais dans l'historique git.
    if (dansLeDepot && c.source === 'paie' && natureMedicale(a.type)) {
      pb(`absence ${a.type} : nature médicale (donnée de santé) ; la remplacer par une absence non médicale de même effet, ou rejouer ce cas hors du dépôt (CURSUS_CAS_PAIE)`);
    }
  }
  for (const s of c.semaines ?? []) {
    champs('semaine', s, CLES_SEMAINE);
    if (!isValidDate(s.lundi) || mondayOf(s.lundi) !== s.lundi) pb(`semaine ${s.lundi} : un lundi AAAA-MM-JJ attendu`);
    if (!Array.isArray(s.heures) || ![5, JOURS_FEUILLE].includes(s.heures.length) || s.heures.some(h => typeof h !== 'number' || h < 0)) pb(`semaine ${s.lundi} : 5 ou 7 nombres d'heures attendus`);
  }
  if (!c.attendu || typeof c.attendu !== 'object') pb('attendu manquant');
  champs('attendu', c.attendu, CLES_ATTENDU);
  for (const l of c.attendu.fichierSage ?? []) champs('attendu.fichierSage', l, CLES_LIGNE_SAGE);
  return c;
}

const r2 = (v: unknown) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v ?? null);
const RH: User = { role: 'rh', empId: null, nom: 'Cas de paie', intitule: '', profilRh: 'rh_admin' };

/** Résultats de Cursus pour un cas, rejoué sur une base en mémoire neuve à la date du cas. */
export async function rejouerCas(c: CasPaie) {
  const avant = process.env.CURSUS_TODAY;
  process.env.CURSUS_TODAY = c.aujourdhui;
  try {
    const db = new Db(':memory:');
    // Comme au démarrage du serveur : reprises puis migrations nommées (activités internes amorcées, etc.).
    await migrate(db);
    await appliquerMigrations(db);
    if (c.reglages) await db.setSetting('app', c.reglages);
    const settings = (await loadFull(db, RH)).settings;
    const e = await db.insert<{ id: number }>('employes', {
      nom: c.salarie.nom, equipe: null, poste: 'Cas de paie', statut: c.contrat.statut, typeContrat: c.contrat.typeContrat, temps: c.contrat.temps,
      heures: c.contrat.heures ?? null, forfaitHeures: c.contrat.forfaitHeures ?? null, forfaitJours: c.contrat.forfaitJours ?? null, jourOff: c.contrat.jourOff ?? [],
      entree: c.salarie.entree, fin: c.salarie.fin ?? null, matriculePaie: c.salarie.matriculePaie,
      naissanceLe: c.salarie.naissanceLe ?? null, naissance: c.salarie.naissanceLe ? Number(c.salarie.naissanceLe.slice(0, 4)) : null,
    });
    if (c.reprise) await db.insert('soldesReprise', { cpPris: 0, rttPris: 0, recupAcquis: 0, recupPris: 0, ...c.reprise, empId: e.id });
    for (const a of c.absences ?? []) await db.insert('absences', { statut: 'validee', ...a, empId: e.id, keystone: false });
    const fiche = (await loadFull(db, RH)).employes.find(x => x.id === e.id)!;
    // Feuilles validées : régime et mode des heures supplémentaires figés comme à la validation (server/src/actions/temps.ts).
    for (const s of c.semaines ?? []) {
      await db.insert('feuilles', {
        empId: e.id, week: s.lundi, statut: 'validee', comment: null, sage: false, keystone: false, contrat: contratFige(fiche),
        lignes: [{ projet: s.projet ?? 'INT-PROD', tache: '', ks: false, h: s.heures }], heuresSup: settings.heuresSupMode, majDimanche: settings.majorationDimanche,
      });
    }
    const d = new Domain(await loadFull(db, RH));
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
export function ecartsCas(c: CasPaie, obtenu: Awaited<ReturnType<typeof rejouerCas>>): string[] {
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

/**
 * Dossiers rejoués : tests/cas-paie/ (versionné) et, si CURSUS_CAS_PAIE est posé, un dossier hors du dépôt (chemin
 * absolu) pour les cas réels qui gardent une donnée de santé ; ces cas ne sont jamais copiés dans tests/cas-paie/.
 */
const horsDepot = process.env.CURSUS_CAS_PAIE?.trim();
const dossiers = [{ dossier: DOSSIER_CAS, dansLeDepot: true }];
if (horsDepot) dossiers.push({ dossier: horsDepot, dansLeDepot: false });

for (const { dossier, dansLeDepot } of dossiers) {
  if (!dansLeDepot && (!isAbsolute(dossier) || !existsSync(dossier))) {
    test('cas de paie hors du dépôt', () => assert.fail(`CURSUS_CAS_PAIE : dossier introuvable ou chemin non absolu (${dossier})`));
    continue;
  }
  for (const f of readdirSync(dossier).filter(x => x.endsWith('.json')).sort()) {
    const nom = (dansLeDepot ? '' : 'hors dépôt ') + f.replace(/\.json$/, '');
    test(`cas de paie ${nom}`, async () => {
      const c = controlerCas(nom, JSON.parse(readFileSync(join(dossier, f), 'utf8')), dansLeDepot);
      const ecarts = ecartsCas(c, await rejouerCas(c));
      assert.deepEqual(ecarts, [], `${c.description} — écarts avec ${c.source === 'paie' ? 'la paie' : 'le calcul attendu'} :\n  ${ecarts.join('\n  ')}`);
    });
  }
}

test('cas de paie : format contrôlé et écart signalé champ par champ', async () => {
  assert.throws(() => controlerCas('x', { description: 'd', source: 'paie', aujourdhui: '2026-10-10', salarie: { matriculePaie: 'M1', entree: '2026-01-05' }, contrat: { statut: 'ouvrier', typeContrat: 'cdi', temps: '35h' }, attendu: {}, salaire: 1 }),
    /Cas x : champ inconnu salaire/);
  assert.throws(() => controlerCas('x', { description: 'd', source: 'paie', aujourdhui: '2026-10-10', salarie: { matriculePaie: 'M1', entree: '2026-01-05' }, contrat: { statut: 'ouvrier', typeContrat: 'cdi', temps: '35h' }, semaines: [{ lundi: '2026-09-08', heures: [7, 7, 7, 7, 7] }], attendu: {} }),
    /semaine 2026-09-08 : un lundi/);
  // Fautes de frappe à l'intérieur du cas : refusées, au lieu d'un rejeu avec la valeur par défaut.
  const base = { description: 'd', source: 'paie', aujourdhui: '2026-10-10', salarie: { matriculePaie: 'M1', entree: '2026-01-05' }, contrat: { statut: 'ouvrier', typeContrat: 'cdi', temps: '35h' }, attendu: {} };
  const refus = (modif: Record<string, unknown>, motif: RegExp) => assert.throws(() => controlerCas('x', { ...base, ...modif }), motif);
  refus({ reglages: { heureSupMode: 'repos' } }, /Cas x : champ inconnu reglages\.heureSupMode/);
  refus({ reglages: { heuresSupMode: 'recuperation' } }, /reglages\.heuresSupMode : valeur "recuperation" refusée/);
  refus({ reglages: { rtt39: 'vingt' } }, /reglages\.rtt39 : valeur "vingt" refusée/);
  refus({ contrat: { ...base.contrat, temps: '39h-rtt' } }, /contrat\.temps « 39h-rtt » inconnu/);
  refus({ contrat: { ...base.contrat, statut: 'employe' } }, /contrat\.statut « employe » inconnu/);
  refus({ contrat: { ...base.contrat, typeContrat: 'CDI' } }, /contrat\.typeContrat « CDI » inconnu/);
  refus({ contrat: { ...base.contrat, temps: 'forfait_jours', forfaitjours: 218 } }, /Cas x : champ inconnu contrat\.forfaitjours/);
  refus({ salarie: { ...base.salarie, naissance: '1985-04-12' } }, /Cas x : champ inconnu salarie\.naissance/);
  refus({ salarie: { ...base.salarie, naissanceLe: '12/04/1985' } }, /salarie\.naissanceLe : date/);
  refus({ reprise: { arreteLe: '2026-05-31', cpPri: 3 } }, /Cas x : champ inconnu reprise\.cpPri/);
  refus({ reprise: { cpPris: 3 } }, /reprise\.arreteLe : date/);
  refus({ absences: [{ type: 'CONGE', du: '2026-08-03', au: '2026-08-07' }] }, /absence : type « CONGE » inconnu/);
  refus({ absences: [{ type: 'CP', du: '2026-08-03', au: '2026-08-07', statut: 'valide' }] }, /absence : statut « valide » inconnu/);
  refus({ absences: [{ type: 'CP', du: '2026-08-03', au: '2026-08-07', debutDemi: 'aprem' }] }, /absence : debutDemi « aprem » inconnu/);
  refus({ absences: [{ type: 'CP', du: '2026-08-03', fin: '2026-08-07' }] }, /Cas x : champ inconnu absence\.fin/);
  refus({ semaines: [{ lundi: '2026-10-05', heures: [7, 7, 7, 7, 7], projt: 'INT-PROD' }] }, /Cas x : champ inconnu semaine\.projt/);
  refus({ attendu: { fichierSage: [{ periode: '2026-10', rubrique: 'HN', qte: 35 }] } }, /Cas x : champ inconnu attendu\.fichierSage\.qte/);
  // Un cas réel versionné ne garde aucune nature d'absence médicale (donnée de santé) ; hors du dépôt, ou fabriqué, si.
  const maladie = { ...base, absences: [{ type: 'MALADIE', du: '2026-03-02', au: '2026-03-13' }] };
  assert.throws(() => controlerCas('x', maladie), /absence MALADIE : nature médicale \(donnée de santé\).*CURSUS_CAS_PAIE/);
  assert.throws(() => controlerCas('x', { ...maladie, absences: [{ type: 'ENFANT_MALADE', du: '2026-03-02', au: '2026-03-02' }] }), /nature médicale/);
  assert.equal(controlerCas('x', maladie, false).absences?.[0].type, 'MALADIE');
  assert.equal(controlerCas('x', { ...maladie, source: 'fabriqué' }).absences?.[0].type, 'MALADIE');
  assert.equal(controlerCas('x', { ...maladie, absences: [{ type: 'SANS_SOLDE', du: '2026-03-02', au: '2026-03-13' }] }).absences?.[0].type, 'SANS_SOLDE');
  const c =controlerCas('essai', {
    description: '35 h, une semaine de 40 h', source: 'fabriqué', aujourdhui: '2026-10-10',
    salarie: { nom: 'Essai', matriculePaie: 'E001', entree: '2026-01-05' }, contrat: { statut: 'ouvrier', typeContrat: 'cdi', temps: '35h' },
    semaines: [{ lundi: '2026-10-05', heures: [8, 8, 8, 8, 8] }],
    attendu: { rtt: null, semaines: [{ lundi: '2026-10-05', sup25: 4 }], fichierSage: [{ periode: '2026-10', rubrique: 'HN', quantite: 35 }] },
  });
  assert.deepEqual(ecartsCas(c, await rejouerCas(c)), [
    'semaine du 2026-10-05.sup25 : attendu 4, Cursus 5',
    'fichier Sage 2026-10 HS25 : ligne non attendue (5)',
  ]);
});
