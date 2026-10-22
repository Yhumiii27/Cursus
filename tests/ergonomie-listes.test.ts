// Ergonomie, étape 2 (lot 6, chantier 6) : tri par colonne et pagination des grandes listes (t145), recherche de
// collaborateurs avec suggestions et choix d'un salarié par combobox dans les dialogues (t152). Logique du client sans
// navigateur (tests/outils/client-node.ts) ; garde-fous sur le code des écrans (en-têtes triables, combobox ARIA).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
process.env.CURSUS_TODAY = '2026-10-10';

const { rendreHook } = await import('./outils/client-node.ts');
const { poserMagasin } = await import('./outils/store-factice.ts');
const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser } = await import('../server/src/dataset.ts');
const { norm, texteRecherche, matricule } = await import('../shared/format.ts');
const tri = await import('../client/src/components/tri.ts');
const recherche = await import('../client/src/components/recherche.ts');
const filtres = await import('../client/src/pages/absences-filtres.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Dataset = ReturnType<typeof buildSnapshot>;
type Store = NonNullable<Parameters<typeof poserMagasin>[0]>;

const db = new Db(':memory:');
seedDemo(db);
function donnees(empId: number | null, role: User['role']): Dataset {
  const c = (db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL').get(...(empId ? [empId] : [])) as { id: number }).id;
  return buildSnapshot(db, currentUser(db, { compteId: c, role, methode: 'demo' })!);
}
const lire = (chemin: string) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');

// — t145 : comparateurs —

type L = { nom: string; solde: number | null; du: string | null; statut: 'ok' | 'due' | 'exp' | 'autre' };
const L: L[] = [
  { nom: 'Fabre', solde: 3, du: '2026-11-02', statut: 'ok' },
  { nom: 'élodie Bernard', solde: null, du: '2026-10-01', statut: 'exp' },
  { nom: 'Dupont', solde: 12.5, du: null, statut: 'due' },
  { nom: 'Émile Zola', solde: 3, du: '2026-10-15', statut: 'autre' },
  { nom: 'Aubert', solde: -1, du: '2026-10-01', statut: 'ok' },
];
const COLS = {
  nom: tri.parTexte<L>(x => x.nom),
  solde: tri.parNombre<L>(x => x.solde, 'desc'),
  du: tri.parDate<L>(x => x.du),
  statut: tri.parRang<L, L['statut']>(x => x.statut, ['exp', 'due', 'ok']),
};
const noms = (rows: L[]) => rows.map(x => x.nom);

test('tri : sans clic, l’ordre par défaut de l’écran est gardé tel quel (colonne inconnue comprise)', () => {
  assert.deepEqual(noms(tri.trier(L, COLS, null)), noms(L));
  assert.deepEqual(noms(tri.trier(L, COLS, { col: 'inconnue', sens: 'asc' })), noms(L));
  assert.notEqual(tri.trier(L, COLS, null), L, 'une copie : la liste de l’écran n’est pas modifiée');
});

test('tri : texte dans l’ordre alphabétique français (accents et casse ignorés), chiffres lus comme des nombres', () => {
  assert.deepEqual(noms(tri.trier(L, COLS, { col: 'nom', sens: 'asc' })), ['Aubert', 'Dupont', 'élodie Bernard', 'Émile Zola', 'Fabre']);
  assert.deepEqual(noms(tri.trier(L, COLS, { col: 'nom', sens: 'desc' })), ['Fabre', 'Émile Zola', 'élodie Bernard', 'Dupont', 'Aubert']);
  const m = [{ nom: matricule(10) }, { nom: matricule(2) }, { nom: 'EMP-9' }];
  assert.deepEqual(tri.trier(m, { nom: tri.parTexte<{ nom: string }>(x => x.nom) }, { col: 'nom', sens: 'asc' }).map(x => x.nom), ['EMP-0002', 'EMP-9', 'EMP-0010']);
});

test('tri : nombre, date ISO et rang de statut ; valeurs vides en dernier dans les deux sens ; égalités dans l’ordre de départ', () => {
  // Solde : du plus grand au plus petit au premier clic ; « non concerné » (null) en dernier ; Fabre et Zola (3) dans l'ordre de départ.
  assert.deepEqual(noms(tri.trier(L, COLS, { col: 'solde', sens: 'desc' })), ['Dupont', 'Fabre', 'Émile Zola', 'Aubert', 'élodie Bernard']);
  assert.deepEqual(noms(tri.trier(L, COLS, { col: 'solde', sens: 'asc' })), ['Aubert', 'Fabre', 'Émile Zola', 'Dupont', 'élodie Bernard']);
  assert.deepEqual(noms(tri.trier(L, COLS, { col: 'du', sens: 'asc' })), ['élodie Bernard', 'Aubert', 'Émile Zola', 'Fabre', 'Dupont']);
  assert.deepEqual(noms(tri.trier(L, COLS, { col: 'du', sens: 'desc' })), ['Fabre', 'Émile Zola', 'élodie Bernard', 'Aubert', 'Dupont']);
  // Rang : le plus grave d'abord ; un statut hors de l'ordre est vide (en dernier).
  assert.deepEqual(noms(tri.trier(L, COLS, { col: 'statut', sens: 'asc' })), ['élodie Bernard', 'Dupont', 'Fabre', 'Aubert', 'Émile Zola']);
  const dates = [{ d: new Date(2026, 9, 12) }, { d: null }, { d: new Date(2026, 9, 1) }];
  assert.deepEqual(tri.trier(dates, { d: tri.parDate<{ d: Date | null }>(x => x.d) }, { col: 'd', sens: 'asc' }).map(x => x.d?.getDate() ?? null), [1, 12, null]);
  assert.deepEqual(tri.trier([{ v: NaN }, { v: '' as unknown as number }, { v: 2 }], { v: tri.parNombre<{ v: number }>(x => x.v) }, { col: 'v', sens: 'asc' }).map(x => x.v), [2, NaN, ''],
    'NaN et texte vide : valeurs vides');
});

test('tri : un clic trie, un deuxième inverse, un troisième revient à l’ordre par défaut ; aria-sort sur la seule colonne triée', () => {
  const a = tri.triSuivant(null, 'nom');
  assert.deepEqual(a, { col: 'nom', sens: 'asc' });
  const b = tri.triSuivant(a, 'nom');
  assert.deepEqual(b, { col: 'nom', sens: 'desc' });
  assert.equal(tri.triSuivant(b, 'nom'), null);
  assert.deepEqual(tri.triSuivant(b, 'solde', 'desc'), { col: 'solde', sens: 'desc' }, 'autre colonne : son premier sens');
  assert.deepEqual(tri.triSuivant({ col: 'solde', sens: 'desc' }, 'solde', 'desc'), { col: 'solde', sens: 'asc' });
  assert.equal(tri.triSuivant({ col: 'solde', sens: 'asc' }, 'solde', 'desc'), null);
  assert.equal(tri.ariaSort(a, 'nom'), 'ascending');
  assert.equal(tri.ariaSort(b, 'nom'), 'descending');
  assert.equal(tri.ariaSort(b, 'solde'), undefined);
  assert.equal(tri.ariaSort(null, 'nom'), undefined);
});

test('tri : le choix est gardé par liste dans ui.tris (store.tsx), sans toucher aux autres listes', () => {
  const appels: Record<string, unknown>[] = [];
  const ui = { tris: { 'absences.soldes': { col: 'cp', sens: 'desc' } } } as unknown as Store['ui'];
  poserMagasin({ ui, setUi: (p: Record<string, unknown>) => { appels.push(p); } } as unknown as Store);
  const t = rendreHook(() => tri.useTri('absences.soldes'));
  assert.deepEqual(t.tri, { col: 'cp', sens: 'desc' });
  t.cliquer('cp', 'desc');
  t.cliquer('nom');
  assert.deepEqual(appels, [
    { tris: { 'absences.soldes': { col: 'cp', sens: 'asc' } } },
    { tris: { 'absences.soldes': { col: 'nom', sens: 'asc' } } },
  ]);
  const autre = rendreHook(() => tri.useTri('collaborateurs'));
  assert.equal(autre.tri, null, 'autre liste : ordre par défaut');
  autre.cliquer('statut', 'desc');
  assert.deepEqual(appels[2], { tris: { 'absences.soldes': { col: 'cp', sens: 'desc' }, collaborateurs: { col: 'statut', sens: 'desc' } } });
  poserMagasin(null);
});

// — t145 : pagination —

test('pagination : rien jusqu’à 50 lignes, puis 50 lignes et « Afficher plus » ; la limite ne dépasse pas le total', () => {
  assert.equal(tri.TAILLE_PAGE, 50);
  assert.deepEqual(tri.pagination(0, 50), { total: 0, affichees: 0, reste: 0, active: false });
  assert.deepEqual(tri.pagination(50, 50), { total: 50, affichees: 50, reste: 0, active: false });
  assert.deepEqual(tri.pagination(120, 50), { total: 120, affichees: 50, reste: 70, active: true });
  assert.deepEqual(tri.pagination(120, 100), { total: 120, affichees: 100, reste: 20, active: true });
  assert.deepEqual(tri.pagination(120, 150), { total: 120, affichees: 120, reste: 0, active: true });
  assert.deepEqual(tri.pagination(120, Number.MAX_SAFE_INTEGER), { total: 120, affichees: 120, reste: 0, active: true }, 'Tout afficher');
  assert.equal(tri.pagination(51, 0).affichees, 50, 'jamais moins d’une page');
});

test('pagination : le hook rend les 50 premières lignes dans l’ordre reçu (trié), toutes en deçà du seuil', () => {
  const rows = Array.from({ length: 120 }, (_, i) => i);
  const p = rendreHook(() => tri.usePagination(rows, 'filtre'));
  assert.deepEqual([p.lignes.length, p.lignes[0], p.lignes[49], p.reste, p.active], [50, 0, 49, 70, true]);
  const court = rendreHook(() => tri.usePagination(rows.slice(0, 30), ''));
  assert.deepEqual([court.lignes.length, court.active], [30, false]);
  // Le pied de liste (components/TriListe.tsx) affiche les lignes sur le total, 50 de plus ou toutes.
  const pied = lire('client/src/components/TriListe.tsx');
  assert.match(pied, /Afficher \$\{Math\.min\(TAILLE_PAGE, p\.reste\)\} de plus/);
  assert.match(pied, /Tout afficher/);
  assert.match(pied, /aria-sort=\{s\}/);
});

// — t145 : filtres de l'écran Congés & absences —

test('absences : filtres d’état, de famille et de période ; soldes par recherche (matricule compris) et par équipe', () => {
  const ti = '2026-10-10';
  const a = (statut: string, type: string, au: string) => ({ statut, type, au }) as Parameters<typeof filtres.filtrerAbsence>[0];
  const f = (o: Partial<typeof filtres.SANS_FILTRE>) => ({ ...filtres.SANS_FILTRE, ...o });
  assert.equal(filtres.filtrerAbsence(a('annulee', 'CP', '2026-01-01'), filtres.SANS_FILTRE, ti), true, 'sans filtre : tout');
  assert.equal(filtres.filtrerAbsence(a('demandee', 'CP', ti), f({ statut: 'a-traiter' }), ti), true);
  assert.equal(filtres.filtrerAbsence(a('signalee', 'ABSENCE', ti), f({ statut: 'a-traiter' }), ti), true);
  assert.equal(filtres.filtrerAbsence(a('validee', 'CP', ti), f({ statut: 'a-traiter' }), ti), false);
  assert.equal(filtres.filtrerAbsence(a('refusee', 'RTT', ti), f({ statut: 'refusee', type: 'RTT' }), ti), true);
  assert.equal(filtres.filtrerAbsence(a('validee', 'MALADIE', ti), f({ type: 'hors' }), ti), true, 'nature hors congés');
  assert.equal(filtres.filtrerAbsence(a('validee', 'ABSENCE', ti), f({ type: 'hors' }), ti), true, 'absence vue par le manager');
  assert.equal(filtres.filtrerAbsence(a('validee', 'CP', ti), f({ type: 'hors' }), ti), false);
  assert.equal(filtres.filtrerAbsence(a('validee', 'CP', ti), f({ periode: 'a-venir' }), ti), true, 'finit aujourd’hui : en cours');
  assert.equal(filtres.filtrerAbsence(a('validee', 'CP', '2026-10-09'), f({ periode: 'a-venir' }), ti), false);
  assert.equal(filtres.filtrerAbsence(a('validee', 'CP', '2026-10-09'), f({ periode: 'passees' }), ti), true);
  // Ordre par défaut : demandes, signalements, puis le reste, les annulées en dernier.
  assert.deepEqual(['annulee', 'validee', 'signalee', 'demandee', 'refusee'].map(s => filtres.rangAbsence({ statut: s as never })), [3, 2, 1, 0, 2]);

  const RH = donnees(null, 'rh');
  const e = RH.employes.find(x => x.equipe && x.matriculePaie) ?? RH.employes.find(x => x.equipe)!;
  assert.equal(filtres.filtrerSolde(e, '', filtres.TOUTES), true);
  assert.equal(filtres.filtrerSolde(e, matricule(e.id).toLowerCase(), filtres.TOUTES), true, 'matricule Cursus');
  if (e.matriculePaie) assert.equal(filtres.filtrerSolde(e, e.matriculePaie, filtres.TOUTES), true, 'matricule de paie');
  assert.equal(filtres.filtrerSolde(e, e.nom.toUpperCase(), e.equipe!), true);
  assert.equal(filtres.filtrerSolde(e, '', `${e.equipe} (autre)`), false);
  const sans = { ...e, equipe: null };
  assert.equal(filtres.filtrerSolde(sans, '', 'À affecter'), true, 'sans équipe : « À affecter »');
});

test('exports : soldes, absences, annuaire, registre et échéances exportent les lignes filtrées et triées, pas seulement la page', () => {
  const abs = lire('client/src/pages/Absences.tsx');
  assert.match(abs, /csvSoldes\(d, soldes\.map\(r => r\.e\)\)/);
  assert.match(abs, /csvAbsences\(d, absAffichees\)/);
  assert.match(lire('client/src/pages/Collaborateurs.tsx'), /csvAnnuaire\(d, rows\)/);
  assert.match(lire('client/src/pages/Habilitations.tsx'), /csvRegistre\(d, rows\)/);
  assert.match(lire('client/src/pages/Echeances.tsx'), /const items = groups\.flatMap/);
});

test('écrans : en-têtes triables (ThTri) sur les grandes listes, pagination là où la liste peut dépasser 50 lignes', () => {
  const ecrans: [string, boolean][] = [
    ['client/src/pages/Absences.tsx', true], ['client/src/pages/Collaborateurs.tsx', true], ['client/src/pages/Habilitations.tsx', true],
    ['client/src/pages/Formations.tsx', true], ['client/src/pages/Comptes.tsx', true], ['client/src/pages/Echeances.tsx', false],
    ['client/src/components/SuiviFeuilles.tsx', false],
  ];
  for (const [f, pagine] of ecrans) {
    const s = lire(f);
    assert.match(s, /<ThTri /, `${f} : en-têtes triables`);
    assert.match(s, /useTri\('[a-z.]+'\)/, `${f} : tri gardé par liste`);
    assert.equal(/usePagination\(/.test(s), pagine, `${f} : pagination`);
  }
  // Noms de listes uniques : chaque liste garde son propre tri.
  const listes = ecrans.flatMap(([f]) => [...lire(f).matchAll(/useTri\('([a-z.]+)'\)/g)].map(m => m[1]));
  assert.equal(new Set(listes).size, listes.length, `noms de listes en double : ${listes.join(', ')}`);
});

// — t152 : recherche et suggestions —

test('recherche : même texte cherché que l’annuaire (nom, poste, équipe, matricules), accents et casse ignorés', () => {
  const e = { id: 7, nom: 'Aïcha Diallo', poste: 'Gestionnaire de paie', equipe: null, matriculePaie: 'S0042' };
  assert.equal(texteRecherche(e), norm('Aïcha Diallo Gestionnaire de paie À affecter S0042 EMP-0007'));
  for (const q of ['aicha', 'DIALLO', 'paie', 'a affecter', 's0042', 'emp-0007', '  diallo ']) assert.equal(recherche.correspond(e, q), true, q);
  assert.equal(recherche.correspond(e, 'zola'), false);
  assert.equal(recherche.correspond(e, '   '), true, 'recherche vide : tout le monde');
  // Le filtre de Collaborateurs passe par la même fonction.
  assert.match(lire('client/src/pages/Collaborateurs.tsx'), /&& correspond\(e, q\)\)/);
});

test('recherche : 8 suggestions au plus, noms qui commencent par la saisie d’abord, puis nom de famille, puis le reste', () => {
  const RH = donnees(null, 'rh');
  const tous = recherche.chercherCollaborateurs(RH.employes, '');
  assert.equal(tous.total, RH.employes.length);
  assert.equal(tous.suggestions.length, recherche.MAX_SUGGESTIONS);
  const emps = [
    { id: 1, nom: 'Paul Martin', poste: 'Technicien', equipe: 'Maintenance', matriculePaie: null },
    { id: 2, nom: 'Martine Dubois', poste: 'Opératrice', equipe: 'Production', matriculePaie: null },
    { id: 3, nom: 'Luc Faure', poste: 'Chef d’équipe', equipe: 'Martinique', matriculePaie: null },
    { id: 4, nom: 'Ana Lopez', poste: 'Opératrice', equipe: 'Production', matriculePaie: null },
  ];
  const r = recherche.chercherCollaborateurs(emps, 'mart');
  assert.deepEqual(r.suggestions.map(e => e.id), [2, 1, 3], 'prénom, puis nom de famille, puis équipe');
  assert.equal(r.total, 3);
  assert.deepEqual(recherche.chercherCollaborateurs(emps, 'opér', 1), { suggestions: [emps[3]], total: 2 }, 'au-delà du maximum : total compté');
});

test('recherche : périmètre du rôle (annuaire sans les sortis ; manager : son équipe sans lui-même, rien de plus que le serveur)', () => {
  const RH = donnees(null, 'rh');
  const p = recherche.perimetreRecherche(RH.employes, 'rh', null, RH.today);
  assert.ok(p.length > 0 && p.every(e => !e.fin || e.fin >= RH.today), 'aucun salarié sorti');
  const sorti = { ...RH.employes[0], fin: '2026-09-30' };
  assert.equal(recherche.perimetreRecherche([sorti], 'rh', null, RH.today).length, 0);
  // Karim Haddad (12), manager : le jeu de données ne contient que son périmètre ; la recherche le reprend, sans lui.
  const KARIM = donnees(12, 'manager');
  const pm = recherche.perimetreRecherche(KARIM.employes, 'manager', 12, KARIM.today);
  assert.ok(pm.length > 0);
  assert.ok(!pm.some(e => e.id === 12), 'pas le manager lui-même');
  assert.ok(pm.length < p.length, 'pas tout le site');
  assert.ok(pm.every(e => KARIM.employes.some(x => x.id === e.id)));
});

test('recherche : flèches en boucle, raccourci « / » hors d’un champ et Ctrl+K ou Cmd+K partout', () => {
  assert.equal(recherche.deplacer(-1, 5, 1), 0, 'première flèche bas : la première option');
  assert.equal(recherche.deplacer(-1, 5, -1), 4, 'première flèche haut : la dernière');
  assert.equal(recherche.deplacer(4, 5, 1), 0, 'après la dernière : la première');
  assert.equal(recherche.deplacer(0, 5, -1), 4);
  assert.equal(recherche.deplacer(2, 5, 1), 3);
  assert.equal(recherche.deplacer(7, 5, 1), 0, 'option disparue (liste réduite) : la première');
  assert.equal(recherche.deplacer(0, 0, 1), -1, 'aucune option');
  const t = (key: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...o });
  assert.equal(recherche.estRaccourciRecherche(t('/'), false), true);
  assert.equal(recherche.estRaccourciRecherche(t('/'), true), false, 'dans un champ, « / » reste un caractère');
  assert.equal(recherche.estRaccourciRecherche(t('k', { ctrlKey: true }), true), true);
  assert.equal(recherche.estRaccourciRecherche(t('K', { metaKey: true }), false), true);
  assert.equal(recherche.estRaccourciRecherche(t('k'), false), false);
  assert.equal(recherche.estRaccourciRecherche(t('k', { ctrlKey: true, altKey: true }), false), false);
  assert.equal(recherche.estRaccourciRecherche(t('/', { ctrlKey: true }), false), false);
});

test('combobox : ARIA 1.2 (combobox, listbox, option active), Échap et Entrée gérés, même recherche que l’en-tête', () => {
  const c = lire('client/src/components/ChoixCollaborateur.tsx');
  for (const m of [/role="combobox"/, /role="listbox"/, /role="option"/, /aria-activedescendant=/, /aria-expanded=\{ouvert\}/, /aria-controls=\{liste\}/,
    /aria-autocomplete="list"/, /aria-invalid=/, /ev\.stopPropagation\(\)/, /chercherCollaborateurs\(/, /onMouseDown=\{ev => ev\.preventDefault\(\)\}/])
    assert.match(c, m);
  const g = lire('client/src/layout/RechercheGlobale.tsx');
  for (const m of [/role="combobox"/, /aria-keyshortcuts=/, /go\('collaborateurs', \{ selectedId: id, search: '' \}\)/, /Voir tous les résultats/, /estRaccourciRecherche\(/, /perimetreRecherche\(/])
    assert.match(g, m);
  // L'en-tête ne redirige plus à la première frappe ; il s'ouvre au manager et aux profils RH qui ont l'annuaire.
  const shell = lire('client/src/layout/Shell.tsx');
  assert.doesNotMatch(shell, /if \(view !== 'collaborateurs'\) go\('collaborateurs'\)/);
  assert.match(shell, /user\.role !== 'collaborateur' && vuesDe\(user\.role, user\.profilRh\)\.includes\('collaborateurs'\)/);
});

test('dialogues et filtres : les listes de salariés sont des combobox (plus de <select> de salariés)', () => {
  const champs: [string, string][] = [
    ['client/src/dialogs/AbsSignalDialog.tsx', 'as-emp'], ['client/src/dialogs/AbsNatureDialog.tsx', 'an-emp'],
    ['client/src/dialogs/ReqFormDialog.tsx', '{id}'], ['client/src/pages/Temps.tsx', 'temps-salarie'], ['client/src/pages/Journal.tsx', 'journal-salarie'],
  ];
  for (const [f, id] of champs) {
    const s = lire(f);
    assert.match(s, new RegExp(`<ChoixCollaborateur id=${id.startsWith('{') ? '\\{id\\}' : `"${id}"`}`), `${f} : combobox`);
    assert.doesNotMatch(s, new RegExp(`<select[^>]*id=${id.startsWith('{') ? '\\{id\\}' : `"${id}"`}`), `${f} : plus de liste déroulante`);
  }
  assert.doesNotMatch(lire('client/src/pages/Temps.tsx'), /<select className="input" aria-label="Collaborateur"/);
});
