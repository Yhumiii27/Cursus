// Conservation des dossiers des salariés sortis (t016, lot 6 chantier 7 étape 2) : règles des durées et des dossiers
// échus, cohérence des réglages, cascade d'anonymisation fondée sur REFERENCES (toute colonne qui désigne un salarié a son
// traitement : test générique, à rejouer après chaque fusion), effacement par catégorie, droit à l'effacement avant
// l'échéance, journal sans nom, signalement quotidien au service RH sans effacement, instantané réservé à l'administrateur RH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_DEMO = '1';

const { TABLES, snake } = await import('../server/src/db.ts');
const { json, nouvelleBase } = await import('./base.ts');
const { mettreAJourBase } = await import('../server/src/demarrage.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull, buildSnapshot, DEFAULT_SETTINGS } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { REFERENCES, controlerOrphelins } = await import('../server/src/integrite.ts');
const { TRAITEMENTS, dossiersEchus, verifierConservation, aEffacer, effacer, etapes, reouvertureSansMotif } = await import('../server/src/conservation.ts');
const { journaliser } = await import('../server/src/comptes.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const regles = await import('../shared/rules/conservation.ts');
const { appliquerReglages, ReglageInvalide } = await import('../shared/reglages.ts');
const { familleAction, JOURNAL_LABEL } = await import('../shared/journal.ts');
const { reglerJournaux } = await import('../server/src/logs.ts');
// Journaux du serveur muets : le nettoyage des pièces (setImmediate) écrirait sur la sortie standard, que le lanceur de
// tests lit.
reglerJournaux({ sortie: () => {} });
type Db = Awaited<ReturnType<typeof nouvelleBase>>;
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

async function base() {
  const db = await nouvelleBase();
  await mettreAJourBase(db);
  await seedDemo(db);
  return db;
}
const compteDe = async (db: Db, empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', (empId ? [empId] : [])) as { id: number }).id;
const personne = async (db: Db, empId: number | null, role: 'rh' | 'manager' | 'collaborateur' = 'rh') => (await currentUser(db, { compteId: await compteDe(db, empId), role, methode: 'demo' }))!;
/** Action exécutée comme par POST /api/actions/:nom : transaction, journal. */
async function agir(db: Db, u: User, nom: string, p: Record<string, unknown>) {
  return await db.tx(async () => {
    const trace = await preparerTrace(db, nom, p);
    const r = await ACTIONS[nom](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, trace, { user: u, compte: { id: u.compteId!, identifiant: 'essai' } as never, message: o.message ?? null, result: o.result });
    return o as { message: string; result?: any };
  });
}
const refus = async (f: () => Promise<unknown>, status: number, motif?: RegExp) => await assert.rejects(f, (e: unknown) => e instanceof ActionError && e.status === status && (!motif || motif.test(e.message)));
const reglages = async (db: Db, r: Record<string, unknown>) => await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), ...r });
const activer = async (db: Db) => await reglages(db, { conservationActive: true, conservationDecisionDpo: 'Décision DPO n° 2026-04' });
const compter = async (db: Db, sql: string, ...args: (string | number)[]) => Number((await db.one(sql, args) as { n: number }).n);

// — Règles —

test('règles : échéance par catégorie, passeport à la sortie, dossier à 5 ans, rien sans la décision du DPO', () => {
  const s = DEFAULT_SETTINGS;
  assert.equal(regles.echeanceConservation('2026-03-31', 0), '2026-04-01');
  assert.equal(regles.echeanceConservation('2021-02-28', 5), '2026-03-01');
  assert.equal(regles.echeanceConservation('2024-02-29', 1), '2025-03-01', 'fin de mois ramenée au 28 février');
  // Défauts (réponse de l'entreprise du 18 octobre 2026) : préremplis, inactifs.
  // lot 11 — notes de frais : 10 ans (terme comptable), au-delà du dossier.
  assert.deepEqual(regles.dureesConservation(s), { dossier: 5, temps: 3, paie: 5, sante: 5, passeport: 0, titreSejour: 5, entretiens: 5, formations: 5, frais: 10 });
  assert.equal(s.conservationActive, false);
  assert.equal(regles.conservationActive(s), false);
  assert.equal(regles.conservationActive({ conservationActive: true, conservationDecisionDpo: '  ' }), false);
  // Sorti au 31 mars 2026 : passeport et visas échus dès le lendemain ; le dossier en 2031.
  const ti = '2026-10-10';
  assert.deepEqual(regles.categoriesEchues({ fin: '2026-03-31' }, s, ti), { categories: ['passeport'], dossier: false });
  assert.deepEqual(regles.categoriesEchues({ fin: '2023-03-31' }, s, ti), { categories: ['temps', 'passeport'], dossier: false });
  // lot 11 — notes de frais : le dossier échu emporte la catégorie, dont les étapes gardent les notes dans leur terme.
  assert.deepEqual(regles.categoriesEchues({ fin: '2021-03-31' }, s, ti)?.categories, ['dossier', 'temps', 'sante', 'passeport', 'titreSejour', 'entretiens', 'formations', 'frais']);
  assert.equal(regles.categoriesEchues({ fin: '2021-03-31' }, s, ti)?.dossier, true);
  // Présent, sorti du jour, déjà anonymisé, catégorie déjà effacée ou sans données : rien.
  assert.equal(regles.categoriesEchues({ fin: null }, s, ti), null);
  assert.equal(regles.categoriesEchues({ fin: ti }, s, ti), null, 'dernier jour : encore présent');
  assert.equal(regles.categoriesEchues({ fin: '2021-03-31', anonymiseLe: '2026-05-01' }, s, ti, c => c !== 'frais'), null);
  // lot 11 — notes de frais : un dossier anonymisé est reproposé pour la seule catégorie « frais » quand des notes gardées
  // y ont passé leur terme comptable (les données comptées ne sont que celles-là).
  assert.deepEqual(regles.categoriesEchues({ fin: '2021-03-31', anonymiseLe: '2026-05-01' }, s, ti), { categories: ['frais'], dossier: false });
  assert.equal(regles.categoriesDroitEffacement({ fin: '2021-03-31', anonymiseLe: '2026-05-01' }, s, ti), null, 'droit à l’effacement : dossier déjà anonymisé');
  assert.equal(regles.categoriesEchues({ fin: '2026-03-31' }, s, ti, () => false), null);
  assert.equal(regles.nomAnonyme(12), 'Salarié anonymisé n° 12');
  assert.match(regles.categoriesTexte(['passeport', 'entretiens']), /^passeport et visas, entretiens professionnels$/);
});

test('droit à l’effacement (règles) : catégories sans obligation légale effacées, identité, titre de séjour, santé et temps gardés', () => {
  const s = DEFAULT_SETTINGS, ti = '2026-10-10';
  const r = regles.categoriesDroitEffacement({ fin: '2026-09-30' }, s, ti)!;
  assert.deepEqual(r.categories, ['passeport', 'entretiens', 'formations']);
  assert.equal(r.dossier, false);
  // lot 11 — notes de frais : gardées jusqu'à leur terme comptable (obligation du Code de commerce).
  assert.deepEqual(r.gardees.map(g => g.categorie), ['dossier', 'temps', 'sante', 'titreSejour', 'frais']);
  assert.equal(r.gardees.find(g => g.categorie === 'titreSejour')?.jusquAu, '2031-10-01', 'registre unique : 5 ans après le départ');
  for (const c of ['dossier', 'titreSejour', 'sante', 'temps'] as const) assert.ok(regles.CATEGORIES_CONSERVATION[c].obligation, c);
  // Temps échu (3 ans) : effacé à la demande ; dossier échu : anonymisation complète, rien de gardé.
  assert.deepEqual(regles.categoriesDroitEffacement({ fin: '2023-03-31' }, s, ti)!.categories, ['temps', 'passeport', 'entretiens', 'formations']);
  const tout = regles.categoriesDroitEffacement({ fin: '2021-03-31' }, s, ti)!;
  assert.equal(tout.dossier, true);
  assert.deepEqual(tout.gardees, []);
  assert.equal(regles.categoriesDroitEffacement({ fin: null }, s, ti), null);
});

test('réglages : décision du DPO exigée pour activer, dossier 5 ans au moins (registre unique) et jamais avant une autre catégorie', () => {
  const s = DEFAULT_SETTINGS;
  assert.throws(() => appliquerReglages(s, { conservationActive: true }), (e: unknown) => e instanceof ReglageInvalide && /décision du DPO/.test(e.message));
  const ok = appliquerReglages(s, { conservationActive: true, conservationDecisionDpo: '  Décision   DPO 2026-04 ' });
  assert.equal(ok.conservationDecisionDpo, 'Décision DPO 2026-04');
  assert.throws(() => appliquerReglages(s, { conservationDossierAns: 4, conservationTempsAns: 2, conservationPaieAns: 2, conservationSanteAns: 2, conservationTitreSejourAns: 2, conservationEntretiensAns: 2, conservationFormationsAns: 2 }),
    (e: unknown) => e instanceof ReglageInvalide && /5 ans au moins pour le dossier : l’identité et le titre de séjour figurent au registre unique/.test(e.message));
  assert.equal(regles.DOSSIER_MIN_ANS, 5);
  assert.throws(() => appliquerReglages(s, { conservationSanteAns: 8 }), (e: unknown) => e instanceof ReglageInvalide && /santé au travail et vaccinations au-delà/.test(e.message));
  assert.equal(appliquerReglages(s, { conservationDossierAns: 42, conservationPasseportAns: 42 }).conservationPasseportAns, regles.DUREE_MAX_ANS, 'bornée');
  assert.ok(JOURNAL_LABEL['employe.anonymiser'] && JOURNAL_LABEL['conservation.signalement']);
  assert.equal(familleAction('employe.anonymiser')?.id, 'fiches');
  assert.equal(familleAction('conservation.signalement')?.id, 'conservation');
});

// — Cascade —

test('cascade : chaque colonne de REFERENCES qui désigne un salarié a son traitement (à rejouer après chaque fusion)', () => {
  const salaries = REFERENCES.filter(r => r.cible === 'employes').map(r => `${r.table}.${r.colonne}`);
  // Toute colonne dont le nom désigne une personne (empId, managerId, parId…) figure dans REFERENCES.
  for (const [nom, def] of Object.entries(TABLES)) {
    for (const [col, type] of Object.entries(def.cols)) {
      if (type === 'int' && /^(emp|manager|suppleant|par|auteur|valideur|demandeur|delegue)Id$/.test(col) && nom !== 'employes') {
        assert.ok(REFERENCES.some(r => r.table === snake(nom) && r.colonne === snake(col)), `${nom}.${col} absente de REFERENCES`);
      }
    }
  }
  assert.ok(TRAITEMENTS['demandes_collab.par_id'], 'manager auteur d’une demande pour son équipe');
  const sans = salaries.filter(k => !TRAITEMENTS[k]);
  assert.deepEqual(sans, [], 'référence à un salarié sans traitement dans TRAITEMENTS (server/src/conservation.ts)');
  const inconnus = Object.keys(TRAITEMENTS).filter(k => !salaries.includes(k));
  assert.deepEqual(inconnus, [], 'traitement d’une référence absente de REFERENCES');
  // Toute table du schéma qui porte un salarié (emp_id) figure dans REFERENCES, donc ici.
  for (const [nom, def] of Object.entries(TABLES)) {
    if ('empId' in def.cols && nom !== 'employes') assert.ok(TRAITEMENTS[`${snake(nom)}.emp_id`], `${nom}.empId traité`);
  }
});

/**
 * Colonnes de texte (text, json) des tables gardées en mode « textes » qui ne sont pas du texte libre : codes, dates,
 * statuts, documents calculés, et noms d'auteurs (retirés par le balayage de l'identité à l'anonymisation). Toute autre
 * colonne de texte de ces tables doit être vidée (ou réécrite) par une étape de la conservation (lot 8, D4).
 */
const TEXTES_GARDES: Record<string, readonly string[]> = {
  // Contrat : dates, nature et régime codés ; auteur (nom) balayé. La référence (texte libre) est vidée.
  contrats_historique: ['effet', 'nature', 'regime', 'jusquau', 'signe_le', 'le', 'par', 'annule_le', 'fin'],
  // Certification : code de formation, dates, inscriptions closes (identifiants) ; auteurs (noms) balayés.
  certifications: ['f', 'obtenue', 'convoc', 'convoc_le', 'corrige_le', 'corrige_par', 'annule_le', 'annule_par', 'inscriptions_closes'],
  // Titre d'habilitation : code, dates, mesure codée ; auteurs (noms) balayés. Le motif de la mesure est vidé.
  hab_titres: ['h', 'delivree', 'par', 'demande', 'mesure', 'mesure_date', 'mesure_par'],
  // Formation suivie : code, intitulé et organisme de la formation (pas une donnée sur la personne), dates, origine
  // codée ; auteurs (noms) balayés.
  formations_suivies: ['f', 'libelle', 'du', 'au', 'organisme', 'origine', 'le', 'auteur', 'corrige_le', 'corrige_par', 'annule_le', 'annule_par'],
  // Déplacement : destination (code pays), dates, origine codée, référence et chantier du projet (Keystone) ; auteur
  // de l'annulation balayé.
  voyages: ['dest', 'depart', 'retour', 'origine', 'ref', 'chantier', 'detachement_le', 'information_le', 'annule_le', 'annule_par', 'ariane_le'],
  // Demande de Keystone : chantier, destination, dates, référence, statut ; décideur (nom) balayé.
  demandes_keystone: ['chantier', 'dest', 'depart', 'retour', 'recue', 'ref', 'statut', 'decidee', 'decideur'],
  // Feuille : semaine, statut, heures et contrat figés, mode des heures supplémentaires, contrepartie en repos, horaires.
  feuilles: ['week', 'statut', 'lignes', 'contrat', 'heures_sup', 'cor', 'horaires', 'horaires_figes', /* lot 12 — C6 : mode figé, pointé figé */ 'mode_temps', 'pointe_fige'],
  // Avenant de forfait : dates ; auteurs (noms) balayés.
  avenants_forfait: ['signe_le', 'cree_le', 'cree_par', 'annule_le', 'annule_par'],
  // Absence : type, dates, demi-journées et statut codés ; auteurs (noms) balayés.
  absences: ['type', 'du', 'au', 'statut', 'signale_le', 'signale_par', 'justificatif_le', 'fin_initiale', 'annulee_le', 'annulee_par', 'debut_demi', 'fin_demi'],
  // Report de congés : auteur (nom) balayé, date, sens, échéance et origine codés.
  reports: ['par', 'date', 'sens', 'expire', 'origine'],
  // Clôture de congés : type et décision codés, dates ; auteur (nom) balayé.
  clotures: ['type', 'decision', 'expire', 'le', 'par'],
  // Astreinte : équipe (code), dates et heures ; auteurs (noms) balayés.
  astreintes: ['equipe', 'du', 'debut', 'au', 'fin', 'communique_le', 'cree_le', 'cree_par', 'modifie_le', 'modifie_par', 'annule_le', 'annule_par'],
  // Liste d'attente : dates, statut et issue codés ; auteurs (noms) balayés.
  attentes_session: ['le', 'par', 'statut', 'proposee_le', 'issue_le', 'issue_par', 'issue'],
  // Évaluation de formation : type, répondant et efficacité codés, date ; auteur (nom) balayé.
  evaluations_formation: ['type', 'repondant', 'efficacite', 'le', 'auteur'],
};

test('conservation : chaque colonne de texte libre d’une table gardée (mode « textes ») est vidée ou sur la liste blanche', async () => {
  const db = await nouvelleBase();
  const traitees = new Map<string, Set<string>>();
  const cx = { ti: '2026-10-10', le: '', par: '' };
  for (const c of regles.CATEGORIES) {
    for (const e of etapes(db, c, cx, 2)) {
      const s = traitees.get(e.table) ?? new Set<string>();
      for (const col of [...e.vider ?? [], ...e.reecrire ? [e.reecrire.champ] : []]) s.add(col);
      traitees.set(e.table, s);
    }
  }
  const tables = [...new Set(Object.entries(TRAITEMENTS).filter(([, t]) => t.mode === 'textes').map(([k]) => k.split('.')[0]))];
  assert.deepEqual(Object.keys(TEXTES_GARDES).sort(), [...tables].sort(), 'une liste blanche par table gardée');
  for (const [nom, def] of Object.entries(TABLES) as [string, { cols: Record<string, string> }][]) {
    const t = snake(nom);
    if (!tables.includes(t)) continue;
    const textes = Object.entries(def.cols).filter(([, type]) => type === 'text' || type === 'json').map(([c]) => snake(c));
    const libres = textes.filter(c => !TEXTES_GARDES[t].includes(c) && !traitees.get(t)?.has(c));
    assert.deepEqual(libres, [], `${t} : colonne de texte ni vidée par la conservation ni sur la liste blanche (TEXTES_GARDES)`);
    const inconnues = TEXTES_GARDES[t].filter(c => !textes.includes(c));
    assert.deepEqual(inconnues, [], `${t} : colonne de la liste blanche absente du schéma`);
  }
  assert.ok(traitees.get('feuilles')!.has('motif_forfait') && traitees.get('feuilles')!.has('reouverture'));
});

test('conservation des temps : motif du forfait jours vidé, réouvertures gardées sans leurs motifs (précédentes comprises)', async () => {
  const db = await base();
  const [f, g] = await db.where<Record<string, any>>('feuilles', 'empId', 2);
  const reouverture = {
    le: '2026-03-02T08:00:00.000Z', par: 'Sandrine Vidal', motif: 'Erreur de saisie signalée par Mehdi (arrêt du 3 mars)', renvoyee: false, transmise: true, lot: 4,
    rubriques: { '2026-02': { HN: 35 } }, keystone: { 'HLT-026': 7 },
    precedentes: [{ le: '2026-02-20T08:00:00.000Z', par: 'Sandrine Vidal', motif: 'Rappel de salaire demandé par Mehdi' }],
  };
  await db.update('feuilles', f.id, { motifForfait: 'Mehdi a dépassé son plafond pour la revue du client', reouverture });
  // Réouverture sans précédente : rien d'ajouté.
  await db.update('feuilles', g.id, { reouverture: { ...reouverture, precedentes: undefined } });
  assert.equal(reouvertureSansMotif({ ...reouverture, precedentes: undefined }).precedentes, undefined);
  const avant = await aEffacer(db, 2, 'temps');
  assert.ok(avant >= 3, 'motif du forfait et deux réouvertures');
  await db.tx(async () => await effacer(db, 2, ['temps'], { ti: '2026-10-10', le: '2026-10-10T08:00:00.000Z', par: 'Essai' }, { motif: 'Durée échue', avantEcheance: false }));
  const apres = (await db.get<Record<string, any>>('feuilles', f.id))!;
  assert.equal(apres.motifForfait, null);
  assert.deepEqual(apres.reouverture, { ...reouverture, motif: '', precedentes: [{ ...reouverture.precedentes[0], motif: '' }] }, 'rubriques et heures Keystone gardées');
  assert.equal((await db.get<Record<string, any>>('feuilles', g.id))!.reouverture.motif, '');
  assert.equal(await aEffacer(db, 2, 'temps'), 0, 'rien de plus à effacer : étape idempotente');
  assert.equal(await compter(db, `SELECT COUNT(*) AS n FROM feuilles WHERE CAST(reouverture AS text) LIKE '%Mehdi%'`), 0);
});

/** Dossier de Mehdi (2) garni : passeport, visa, vaccin, demande de visite, déclaration, demande de formation, journal, envoi. */
async function garnir(db: Db, fin: string) {
  await db.update('employes', 2, { fin, motifSortie: 'demission', naissanceLe: '1990-04-12', urgenceNom: 'Mme Benali', urgenceTel: '06 00 00 00 00', autorisationTravail: { type: 'carte_sejour', numero: 'AB1234567', expire: '2027-01-01', demandeLe: null, verifieLe: null } });
  await db.insert('visas', { empId: 2, dest: 'MA', type: 'visa', obtenu: '2025-01-01', expire: '2027-01-01' });
  await db.insert('demandesVisite', { empId: 2, motif: 'periodique', le: '2025-01-01', par: 'Sandrine Vidal', statut: 'demandee' });
  await db.insert('demandesCollab', { empId: 2, type: 'document', label: 'Passeport', date: '2025-01-01', statut: 'acceptee', declaration: { kind: 'passeport', numero: '21XY12345', expire: '2032-01-01' } });
  await db.insert('demandesCollab', { empId: 2, type: 'formation', f: 'sst', motif: 'Mehdi Benali souhaite se former', date: '2025-01-01', statut: 'refusee' });
  await db.insert('notifications', { empId: 2, adresse: 'mehdi.benali@entreprise.example', type: 'absence.decision', objet: 'Demande validée', texte: 'Bonjour Mehdi Benali', creation: '2025-01-01T08:00:00.000Z' });
  await db.insert('pieces', { empId: 2, objet: 'voyage', objetId: 1, nom: 'billet Mehdi Benali.pdf', type: 'application/pdf', taille: 5, empreinte: 'e', fichier: 'c'.repeat(32), deposeLe: '2025-01-01T08:00:00.000Z', deposePar: 'Mehdi Benali' });
  await db.insert('envois', { cible: 'email', type: 'absence.decision', cle: 'essai-conservation', contenu: { a: ['mehdi.benali@entreprise.example'], objet: 'Congés', texte: 'Bonjour Mehdi Benali' }, statut: 'envoye', tentatives: 1, creation: '2025-01-01T08:00:00.000Z' });
  await db.insert('jetonsAgenda', { empId: 2, empreinte: 'f'.repeat(64), creeLe: '2025-01-01T08:00:00.000Z' });
  // Autre salarié dont la ligne cite Mehdi comme auteur.
  await db.insert('absences', { empId: 6, type: 'ABSENCE', du: '2025-02-03', au: '2025-02-03', statut: 'signalee', keystone: false, justificatif: false, signaleLe: '2025-02-03', signalePar: 'Mehdi Benali' });
  await journaliser(db, { actor: 'Mehdi Benali', role: 'collaborateur', action: 'absence.demander', message: 'Demande de congés payés de Mehdi Benali', compte: { id: await compteDe(db, 2), identifiant: 'mehdi.benali@entreprise.example' } as never, salaries: [2] });
}

/** Valeurs de texte de toute la base qui contiennent l'un des termes : « table.colonne ». */
async function occurrences(db: Db, termes: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const [nom, def] of Object.entries(TABLES)) {
    for (const [col, type] of Object.entries(def.cols)) {
      if (type !== 'text' && type !== 'json') continue;
      for (const t of termes) if (await compter(db, `SELECT COUNT(*) AS n FROM ${snake(nom)} WHERE CAST(${snake(col)} AS text) LIKE '%' || CAST(? AS text) || '%'`, t)) out.push(`${snake(nom)}.${snake(col)}`);
    }
  }
  return out;
}

test('anonymisation d’un dossier échu : cascade complète, nom retiré de toute la base, agrégats gardés, journal sans nom', async () => {
  const db = await base();
  await garnir(db, '2020-06-30');
  const admin = await personne(db, null);
  // Désactivé : aucune proposition, action refusée.
  assert.deepEqual(await dossiersEchus(db), []);
  await refus(async () => await agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'Durées échues' }), 409, /désactivée/);
  await activer(db);
  const echu = (await dossiersEchus(db)).find(d => d.empId === 2);
  assert.ok(echu?.dossier, 'dossier échu proposé');
  assert.ok(echu!.categories.includes('passeport') && echu!.categories.includes('sante'));
  // Motif exigé ; un gestionnaire RH ne confirme pas.
  await refus(async () => await agir(db, admin, 'employe.anonymiser', { ids: [2], motif: ' ' }), 400, /Motif requis/);
  await refus(async () => await agir(db, await personne(db, 14), 'employe.anonymiser', { ids: [2], motif: 'x' }), 403);
  const feuilles = await compter(db, 'SELECT COUNT(*) AS n FROM feuilles WHERE emp_id = 2');
  const certs = await compter(db, 'SELECT COUNT(*) AS n FROM certifications WHERE emp_id = 2');
  const r = await agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'Durées validées par le DPO' });
  assert.match(r.message, /^Données échues effacées le 10 oct\. 2026 — 1 dossier anonymisé \(n° 2\) · \d+ éléments effacés ; les sauvegardes les gardent jusqu’à leur rotation$/);
  // Fiche : identité neutre, compte fermé, sessions supprimées.
  const e = (await db.get<Record<string, any>>('employes', 2))!;
  assert.equal(e.nom, 'Salarié anonymisé n° 2');
  assert.equal(e.anonymiseLe, '2026-10-10');
  for (const c of ['email', 'naissanceLe', 'matriculePaie', 'urgenceNom', 'urgenceTel', 'passeportNumero', 'autorisationTravail', 'visite', 'avis']) assert.equal(e[c], null, c);
  const compte = (await db.where<Record<string, any>>('comptes', 'empId', 2))[0];
  assert.equal(compte.actif, false);
  assert.match(compte.identifiant, /^anonyme-\d+$/);
  assert.equal(await compter(db, 'SELECT COUNT(*) AS n FROM connexions WHERE compte_id = ?', compte.id), 0);
  // Références traitées : lignes supprimées, textes vidés, agrégats gardés.
  for (const [k, t] of Object.entries(TRAITEMENTS)) {
    const [table, colonne] = k.split('.');
    if (t.mode === 'lignes') assert.equal(await compter(db, `SELECT COUNT(*) AS n FROM ${table} WHERE ${colonne} = 2`), 0, `${k} supprimées`);
    if (t.mode === 'detachee') assert.equal(await compter(db, `SELECT COUNT(*) AS n FROM ${table} WHERE ${colonne} = 2`), 0, `${k} détachée`);
  }
  assert.equal(await compter(db, 'SELECT COUNT(*) AS n FROM pieces WHERE emp_id = 2 AND retiree_le IS NULL'), 0, 'pièces retirées');
  assert.equal(await compter(db, `SELECT COUNT(*) AS n FROM pieces WHERE emp_id = 2 AND nom LIKE 'piece-%'`), 1, 'nom d’origine retiré');
  assert.equal(await compter(db, 'SELECT COUNT(*) AS n FROM feuilles WHERE emp_id = 2'), feuilles, 'heures par projet gardées');
  assert.equal(await compter(db, 'SELECT COUNT(*) AS n FROM certifications WHERE emp_id = 2'), certs, 'certifications et coûts gardés');
  // Plus aucune trace du nom, de l'adresse ni de l'identifiant, dans aucune table (journal, file d'envoi, autres dossiers).
  assert.deepEqual(await occurrences(db, ['Mehdi Benali', 'mehdi.benali@entreprise.example']), []);
  assert.equal((await db.where<Record<string, any>>('absences', 'empId', 6)).find(a => a.du === '2025-02-03')?.signalePar, 'Salarié anonymisé n° 2', 'auteur nommé ailleurs');
  // Journal : ligne de l'action sans nom, motif masqué, salarié et catégories ; trace de l'effacement gardée.
  const j = await db.one(`SELECT message, payload, salaries FROM journal WHERE action = 'employe.anonymiser'`) as { message: string; payload: unknown; salaries: unknown };
  assert.equal(json(j.salaries)[0], 2);
  assert.equal(json(j.payload).motif, '[texte renseigné]');
  assert.ok(json(j.payload).effacements[0].categories.includes('dossier'));
  const trace = await db.where<Record<string, any>>('effacements', 'empId', 2);
  assert.equal(trace.length, 1);
  assert.equal(trace[0].motif, 'Durées validées par le DPO');
  // Plus rien à proposer ; une seconde confirmation est refusée ; aucune référence orpheline.
  assert.equal((await dossiersEchus(db)).some(d => d.empId === 2), false);
  await refus(async () => await agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'x' }), 409, /sans donnée échue/);
  await refus(async () => await agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'x', avantEcheance: true }), 409, /déjà anonymisé/);
  // Références seules (le fichier fictif de la pièce n'existe pas sur le disque de l'essai).
  assert.equal((await controlerOrphelins(db, [...REFERENCES])).orphelins, 0);
});

test('effacement par catégorie : passeport et visas à la sortie, le reste gardé ; le dossier vient ensuite', async () => {
  const db = await base();
  await garnir(db, '2026-03-31');
  await activer(db);
  const admin = await personne(db, null);
  const d = (await dossiersEchus(db)).find(x => x.empId === 2)!;
  assert.deepEqual(d.categories, ['passeport']);
  assert.equal(d.dossier, false);
  assert.ok(await aEffacer(db, 2, 'passeport') >= 3, 'passeport, visa, déclaration');
  const r = await agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'Passeport : effacé à la sortie' });
  assert.match(r.message, /dossier n° 2 : passeport et visas effacés/);
  const e = (await db.get<Record<string, any>>('employes', 2))!;
  assert.equal(e.nom, 'Mehdi Benali', 'identité gardée');
  assert.equal(e.passeportNumero, null);
  assert.equal(await compter(db, 'SELECT COUNT(*) AS n FROM visas WHERE emp_id = 2'), 0);
  assert.equal(await compter(db, `SELECT COUNT(*) AS n FROM demandes_collab WHERE emp_id = 2 AND type = 'document'`), 0);
  assert.ok(await compter(db, 'SELECT COUNT(*) AS n FROM vaccinations WHERE emp_id = 2') > 0, 'santé gardée 5 ans');
  assert.equal((await dossiersEchus(db)).some(x => x.empId === 2), false, 'rien d’autre d’échu');
  // Durée du dossier au minimum (5 ans) : le dossier n'est pas encore échu (sortie de mars 2026).
  await db.run(`UPDATE feuilles SET comment = 'Heures du samedi à reprendre' WHERE emp_id = 2`);
  await reglages(db, { conservationTempsAns: 0, conservationPaieAns: 0, conservationDossierAns: 5 });
  assert.deepEqual((await dossiersEchus(db)).find(x => x.empId === 2)?.categories, ['temps']);
});

test('droit à l’effacement avant l’échéance : sans obligation légale effacé, identité et titre de séjour gardés ; jamais un salarié présent', async () => {
  const db = await base();
  const admin = await personne(db, null);
  await refus(async () => await agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'Demande', avantEcheance: true }), 409, /encore présent/);
  await refus(async () => await agir(db, admin, 'employe.anonymiser', { ids: [2, 6], motif: 'Demande', avantEcheance: true }), 400, /un salarié à la fois/);
  await garnir(db, '2026-09-30');
  await db.insert('vaccinations', { empId: 2, v: 'dtp', date: '2025-01-01' });
  // Fonction désactivée : le droit à l'effacement reste exerçable par l'administrateur RH.
  const r = await agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'Demande du salarié du 1er octobre', avantEcheance: true });
  assert.match(r.message, /^Droit à l’effacement exercé le 10 oct\. 2026 — dossier n° 2 : passeport et visas, entretiens professionnels, formations et habilitations effacés · \d+ éléments effacés · gardés jusqu’à leur échéance \(obligation légale\) : dossier du salarié \(fiche et identité\), .*titre de séjour/);
  const e = (await db.get<Record<string, any>>('employes', 2))!;
  assert.equal(e.nom, 'Mehdi Benali', 'identité gardée : registre unique du personnel');
  assert.equal(e.anonymiseLe ?? null, null);
  assert.equal(e.autorisationTravail?.numero, 'AB1234567', 'titre de séjour gardé 5 ans');
  assert.equal(e.passeportNumero, null);
  assert.ok(await compter(db, 'SELECT COUNT(*) AS n FROM vaccinations WHERE emp_id = 2') > 0, 'santé gardée');
  assert.equal(await compter(db, 'SELECT COUNT(*) AS n FROM visas WHERE emp_id = 2'), 0);
  assert.equal(await compter(db, `SELECT COUNT(*) AS n FROM demandes_collab WHERE emp_id = 2 AND type = 'formation'`), 0);
  assert.equal((await db.where<Record<string, any>>('effacements', 'empId', 2))[0].avantEcheance, true);
  // Plus rien d'effaçable avant l'échéance.
  await refus(async () => await agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'Relance', avantEcheance: true }), 409, /Rien à effacer avant l’échéance/);
  // Dossier échu : la même demande anonymise en entier.
  await db.update('employes', 2, { fin: '2020-06-30' });
  await agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'Demande du salarié', avantEcheance: true });
  assert.equal((await db.get<Record<string, any>>('employes', 2))!.nom, 'Salarié anonymisé n° 2');
});

test('balayage de l’identité : occurrences délimitées seulement ; fiche et compte d’un homonyme ou d’une réembauche intacts', async () => {
  const db = await base();
  await garnir(db, '2020-06-30');
  await activer(db);
  const admin = await personne(db, null);
  // Salarié présent dont le nom et l'adresse commencent comme ceux de Mehdi.
  await db.update('employes', 6, { nom: 'Mehdi Benaliani', email: 'mehdi.benaliani@entreprise.example' });
  await db.run(`UPDATE comptes SET identifiant = 'mehdi.benaliani@entreprise.example', adresse = 'mehdi.benaliani@entreprise.example' WHERE emp_id = 6`);
  // Réembauche : nouvelle fiche, même nom, même adresse, compte local.
  const { id: _ancien, ...copie } = (await db.get<Record<string, any>>('employes', 2))!;
  await db.insert('employes', { ...copie, fin: null, motifSortie: null, matriculePaie: null });
  const nouvelId = await compter(db, 'SELECT MAX(id) AS n FROM employes');
  await db.insert('comptes', { empId: nouvelId, nom: 'Mehdi Benali', adresse: 'mehdi.benali@entreprise.example', identifiant: 'mbenali', type: 'local', actif: true });
  // Compte de Mehdi passé en identifiant local court (mot courant) : jamais balayé.
  await db.run(`UPDATE comptes SET identifiant = 'paie' WHERE emp_id = 2`);
  // Texte d'un autre salarié : nom cité, nom préfixe, mot qui contient l'identifiant.
  await db.run(`UPDATE feuilles SET comment = 'Remarque : voir avec Mehdi Benali. Mehdi Benaliani confirme la paie de mars' WHERE emp_id = 6`);
  const avant = { app: JSON.stringify(await db.getSetting('app', {})), six: await db.get<Record<string, any>>('employes', 6), compte6: (await db.where<Record<string, any>>('comptes', 'empId', 6))[0] };
  await agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'Durées échues — dossier de Mehdi Benali' });
  assert.equal((await db.get<Record<string, any>>('employes', 2))!.nom, 'Salarié anonymisé n° 2');
  // Homonyme préfixe : fiche et compte intacts.
  assert.deepEqual(await db.get<Record<string, any>>('employes', 6), avant.six);
  assert.deepEqual((await db.where<Record<string, any>>('comptes', 'empId', 6))[0], avant.compte6);
  // Réembauche : nom, adresse et compte intacts.
  const re = (await db.get<Record<string, any>>('employes', nouvelId))!;
  assert.equal(re.nom, 'Mehdi Benali');
  assert.equal(re.email, 'mehdi.benali@entreprise.example');
  const cre = (await db.where<Record<string, any>>('comptes', 'empId', nouvelId))[0];
  assert.deepEqual([cre.nom, cre.adresse, cre.identifiant, cre.actif], ['Mehdi Benali', 'mehdi.benali@entreprise.example', 'mbenali', true]);
  // Réglages intacts (« paiement »), texte d'un autre salarié remplacé à la seule occurrence délimitée.
  assert.equal(JSON.stringify(await db.getSetting('app', {})), avant.app);
  assert.equal((await db.getSetting<Record<string, any>>('app', {})).heuresSupMode, 'paiement');
  assert.deepEqual([...new Set((await db.where<Record<string, any>>('feuilles', 'empId', 6)).map(f => f.comment).filter(Boolean))],
    ['Remarque : voir avec Salarié anonymisé n° 2. Mehdi Benaliani confirme la paie de mars']);
  // Motif de la trace balayé (écrit avant le balayage) ; identifiant du compte fermé retiré du journal.
  assert.equal((await db.where<Record<string, any>>('effacements', 'empId', 2))[0].motif, 'Durées échues — dossier de Salarié anonymisé n° 2');
  assert.equal(await compter(db, `SELECT COUNT(*) AS n FROM journal WHERE identifiant = 'paie' OR identifiant LIKE 'mehdi.benali@%'`), 0);
});

test('catégorie effacée puis de nouveau renseignée : reproposée, et l’anonymisation l’efface quand même', async () => {
  const db = await base();
  await garnir(db, '2026-03-31');
  await activer(db);
  const admin = await personne(db, null);
  await agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'Passeport effacé à la sortie' });
  assert.equal((await dossiersEchus(db)).some(x => x.empId === 2), false);
  // Nouveau passeport et nouveau visa saisis après l'effacement.
  await db.update('employes', 2, { passeportNumero: 'P2-NOUVEAU', passeportExpire: '2035-01-01' });
  await db.insert('visas', { empId: 2, dest: 'US', type: 'visa', obtenu: '2026-05-01', expire: '2028-01-01' });
  assert.deepEqual((await dossiersEchus(db)).find(x => x.empId === 2)?.categories, ['passeport'], 'reproposée');
  // Droit à l'effacement exercé une fois le dossier échu : toutes les étapes rejouées, passeport compris.
  await db.update('employes', 2, { fin: '2020-06-30' });
  await agir(db, admin, 'employe.anonymiser', { ids: [2], motif: 'Demande', avantEcheance: true });
  const e = (await db.get<Record<string, any>>('employes', 2))!;
  assert.equal(e.nom, 'Salarié anonymisé n° 2');
  assert.equal(e.passeportNumero, null);
  assert.equal(await compter(db, 'SELECT COUNT(*) AS n FROM visas WHERE emp_id = 2'), 0);
});

test('signalement quotidien : notification au service RH sans nom, une fois par jour et pour les nouveaux dossiers ; rien n’est effacé', async () => {
  const db = await base();
  await garnir(db, '2020-06-30');
  assert.equal(await verifierConservation(db, '2026-10-10'), 0, 'désactivé : rien');
  await activer(db);
  assert.equal(await verifierConservation(db, '2026-10-10'), null, 'déjà passé ce jour');
  assert.equal(await verifierConservation(db, '2026-10-11'), 1);
  const n = await db.query(`SELECT objet, texte FROM notifications WHERE type = 'conservation.echus'`) as { objet: string; texte: string }[];
  assert.equal(n.length, 1);
  assert.match(n[0].texte, /^1 dossier de salarié sorti a une durée de conservation échue \(1 nouveau/);
  assert.doesNotMatch(n[0].texte, /Benali/);
  assert.equal((await db.get<Record<string, any>>('employes', 2))!.nom, 'Mehdi Benali', 'rien n’est effacé');
  // Le lendemain, même dossier : pas de nouveau signalement.
  assert.equal(await verifierConservation(db, '2026-10-12'), 1);
  assert.equal(await compter(db, `SELECT COUNT(*) AS n FROM notifications WHERE type = 'conservation.echus'`), 1);
  const j = await db.query(`SELECT message, salaries FROM journal WHERE action = 'conservation.signalement'`) as { message: string; salaries: string }[];
  assert.equal(j.length, 1);
  assert.doesNotMatch(j[0].message, /Benali/);
});

test('instantané : dossiers échus pour l’administrateur RH seulement ; date d’anonymisation retirée pour le manager', async () => {
  const db = await base();
  await garnir(db, '2020-06-30');
  await activer(db);
  assert.equal((await buildSnapshot(db, await personne(db, null))).conservation?.[0]?.empId, 2);
  for (const u of [await personne(db, 14), await personne(db, 11), await personne(db, 7), await personne(db, 23), await personne(db, 12, 'manager'), await personne(db, 6, 'collaborateur')]) {
    assert.equal((await buildSnapshot(db, u)).conservation, undefined, u.nom);
  }
  await agir(db, await personne(db, null), 'employe.anonymiser', { ids: [2], motif: 'Durées validées' });
  // Mehdi n'apparaît plus dans la vue du manager s'il est sorti ; s'il y figure, sans date d'anonymisation.
  const vue = (await buildSnapshot(db, await personne(db, 12, 'manager'))).employes.find(x => x.id === 2);
  assert.equal(vue?.anonymiseLe ?? null, null);
});
