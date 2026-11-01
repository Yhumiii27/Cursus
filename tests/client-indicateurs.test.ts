// Lot 11, chantier C3, étape 2 : écran Indicateurs sociaux sous node --test (tests/outils/rendu.ts, banc-client.ts).
// Les lectures de l'écran (GET /api/indicateurs) sont servies par le vrai calcul du serveur (`indicateursDe`, agrégats
// déjà masqués) à travers un fetch remplacé : en-tête d'espace posé, case masquée « < k » affichée, onglets, BDESE (N-2,
// N-1, N, rubriques 3° à 10° hors Cursus), Égalité (indicateurs 1, 2 et 4 hors Cursus), arrêtés (boutons selon le profil,
// confirmation sans window.confirm), export par le serveur. Puis : saisie du sexe et de la catégorie (EmployeDialog),
// échéance agrégée, section de Paramètres, adresse de la page, mise en forme sans React (pages/indicateurs-vue.ts).
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

await import('./outils/rendu.ts');
const { act, cleanup, fireEvent, render, screen, within } = await import('@testing-library/react');
const { createElement } = await import('react');
const { baseDemo, monter } = await import('./outils/banc-client.ts');
const { Indicateurs } = await import('../client/src/pages/Indicateurs.tsx');
const { ArreteCseDialog } = await import('../client/src/dialogs/ArreteCseDialog.tsx');
const { EmployeDialog } = await import('../client/src/dialogs/EmployeDialog.tsx');
const { IndicateursACompleter } = await import('../client/src/components/IndicateursACompleter.tsx');
const { Indicateurs: SectionIndicateurs } = await import('../client/src/pages/parametres/Indicateurs.tsx');
const { ConfirmerDialog } = await import('../client/src/dialogs/ConfirmerDialog.tsx');
type Confirmation = import('../client/src/state/confirmations.ts').Confirmation;
const { indicateursDe } = await import('../server/src/indicateurs.ts');
const { lireUrl, ecrireUrl } = await import('../client/src/state/url.ts');
const V = await import('../client/src/pages/indicateurs-vue.ts');
const { texteCase } = await import('../client/src/components/graphiques/commun.ts');
const { requeteIndicateurs } = await import('../client/src/indicateurs-api.ts');
const { aCompleterIndicateurs } = await import('../shared/rules/indicateurs-legaux.ts');
type SqliteDb = import('../server/src/db.ts').SqliteDb;
type Groupe = import('../shared/rules/indicateurs-legaux.ts').GroupeIndicateurs;

afterEach(() => cleanup());

/** Lectures faites par l'écran : adresse et en-tête d'espace. */
const lus: { chemin: string; q: string; espace: string | null }[] = [];

/** fetch de l'écran servi par le calcul du serveur (lecture) ou un fichier CSV factice (export). */
function servir(db: SqliteDb) {
  lus.length = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url), 'http://localhost/');
    const espace = (init?.headers as Record<string, string> | undefined)?.['x-cursus-espace'] ?? null;
    lus.push({ chemin: u.pathname, q: u.search, espace });
    const groupe = (u.searchParams.get('groupe') ?? 'aucun') as Groupe;
    if (u.pathname.endsWith('/csv')) {
      return new Response('Indicateur;Valeur\n', { status: 200, headers: { 'content-disposition': 'attachment; filename="indicateurs-2026-annee-aucun.csv"' } });
    }
    let corps: unknown;
    if (u.searchParams.has('arrete')) {
      const a = (await db.get<{ id: number; annee: number; donnees: Record<string, unknown>; arreteLe: string; cseLe: string | null; annuleLe: string | null }>('indicateursArretes', Number(u.searchParams.get('arrete'))))!;
      corps = { ...(a.donnees[groupe] as object), arrete: { id: a.id, annee: a.annee, arreteLe: a.arreteLe, cseLe: a.cseLe, annule: !!a.annuleLe } };
    } else {
      corps = { ...(await indicateursDe(db, { annee: Number(u.searchParams.get('annee')), periode: 'annee', groupe }))!, arrete: null };
    }
    return new Response(JSON.stringify(corps), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

/** Laisse arriver les lectures (promesses du fetch remplacé). */
const attendre = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 5)); }); };

test('écran Indicateurs : service RH, cases masquées « < 5 », onglets, BDESE et Égalité', async () => {
  const { db, personne } = await baseDemo();
  servir(db);
  const b = await monter(db, await personne(null, 'rh'), () => createElement(Indicateurs));
  render(b.element);
  await attendre();
  assert.ok(screen.getByRole('heading', { level: 1, name: 'Indicateurs sociaux' }));
  assert.ok(lus.length > 0 && lus.every(l => l.chemin === '/api/indicateurs' && l.espace === 'rh'), 'en-tête d’espace posé (garde de navigation interne)');
  assert.match(lus[0].q, /annee=2026/);
  assert.match(lus[0].q, /periode=annee/);
  // Effectifs : indicateurs clés et définition retenue, intérimaires masqués.
  assert.ok(screen.getByText('Effectif au 31 décembre'));
  assert.ok(screen.getAllByText(/Définition retenue/).length >= 1);
  assert.ok(document.querySelectorAll('abbr.case-masquee').length >= 1, 'case masquée « < k »');
  assert.match(document.querySelector('abbr.case-masquee')!.textContent!, /< 5/);
  // Âges et ancienneté : pyramide en SVG nommé, valeurs dans sa description.
  await act(async () => { fireEvent.click(screen.getByLabelText('Âges et ancienneté')); });
  await attendre();
  const svg = document.querySelector('svg.graph[role="img"]')!;
  assert.ok(svg, 'graphique SVG nommé');
  assert.match(svg.querySelector('desc')!.textContent!, /femmes .*, hommes /);
  // Groupement par sexe : nouvelle lecture.
  await act(async () => { fireEvent.change(screen.getByLabelText('Groupement'), { target: { value: 'sexe' } }); });
  await attendre();
  assert.ok(lus.some(l => /groupe=sexe/.test(l.q)));
  // BDESE : trois années, rubriques 1° et 2° remplies, 3° à 10° hors Cursus.
  await act(async () => { fireEvent.click(screen.getByLabelText('BDESE')); });
  await attendre();
  for (const a of [2024, 2025]) assert.ok(lus.some(l => l.q.includes(`annee=${a}`)), `année ${a} lue`);
  assert.ok(screen.getByRole('heading', { name: '1° Investissement social' }));
  assert.ok(screen.getByRole('heading', { name: /2° Égalité professionnelle/ }));
  assert.ok(screen.getByText('Fonds propres, endettement et impôts'));
  assert.ok(screen.getByText('Rémunération des salariés et dirigeants'));
  // Égalité : indicateurs 1, 2 et 4 hors Cursus, 3 préparé en partie.
  await act(async () => { fireEvent.click(screen.getByLabelText('Égalité')); });
  await attendre();
  assert.equal(screen.getAllByText('Hors Cursus').length, 3);
  assert.equal(screen.getAllByText('Préparé en partie').length, 1);
  assert.ok(screen.getByText(/Données manquantes/));
  // Export : produit et tracé par le serveur (pas de signalement du navigateur).
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Exporter (CSV)' })); });
  await attendre();
  assert.ok(lus.some(l => l.chemin === '/api/indicateurs/csv' && l.espace === 'rh'));
  assert.ok(b.trace.messages.some(m => /Export CSV généré — indicateurs-2026-annee-aucun\.csv/.test(m.text)));
  // Impression (print.ts, cadre caché ; mise en forme vérifiée plus bas par sectionsBdese et sectionsTableaux).
  assert.ok(screen.getByRole('button', { name: 'Imprimer' }));
});

test('arrêtés : l’administrateur RH arrête l’année close (confirmation), les chiffres viennent ensuite de l’arrêté', async () => {
  const { db, personne } = await baseDemo();
  servir(db);
  // Dialogue de confirmation rendu à côté de l'écran quand l'écran l'ouvre (le banc ne fait que noter l'ouverture).
  let c: Confirmation | null = null;
  const b = await monter(db, await personne(null, 'rh'), () => createElement('div', null, createElement(Indicateurs), c ? createElement(ConfirmerDialog, { c }) : null),
    { indOnglet: 'arretes' });
  render(b.element);
  await attendre();
  assert.ok(screen.getByText(/Aucun arrêté/));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Arrêter 2025' })); });
  const o = b.trace.ouverts.at(-1) as { type: string; c: Confirmation };
  assert.equal(o.type, 'confirmer');
  assert.equal(o.c.action, 'indicateurs.arreter');
  assert.deepEqual(o.c.payload, { annee: 2025 });
  c = o.c;
  // Redessiner l'écran (le banc redessine à chaque setUi) : même année choisie de nouveau.
  await act(async () => { fireEvent.change(screen.getByLabelText('Année'), { target: { value: '2026' } }); });
  await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Arrêter 2025' })); });
  await attendre();
  assert.equal(b.trace.actions.at(-1)!.name, 'indicateurs.arreter');
  assert.ok(b.trace.actions.at(-1)!.r.ok);
  c = null;
  // Redessiner l'écran (le banc redessine à chaque setUi) : même année choisie de nouveau.
  await act(async () => { fireEvent.change(screen.getByLabelText('Année'), { target: { value: '2026' } }); });
  const ligne = screen.getByText('n° 1').closest('tr')!;
  assert.ok(within(ligne).getByText('En vigueur'));
  await act(async () => { fireEvent.click(within(ligne).getByRole('button', { name: 'Mis à disposition du CSE' })); });
  assert.deepEqual(b.trace.ouverts.at(-1), { type: 'arreteCse', id: 1 });
  await act(async () => { fireEvent.click(within(ligne).getByRole('button', { name: 'Annuler' })); });
  const annul = b.trace.ouverts.at(-1) as { type: string; c: { action: string; motif?: { requis: boolean; aide: string } } };
  assert.equal(annul.c.action, 'indicateurs.annulerArrete');
  assert.equal(annul.c.motif?.requis, true);
  assert.match(annul.c.motif!.aide, /jamais écrit au journal/);
  // Année 2025 : chiffres de l'arrêté, « Calcul du jour » au choix.
  await act(async () => { fireEvent.click(within(ligne).getByRole('button', { name: 'Voir la BDESE' })); });
  await attendre();
  assert.ok(lus.some(l => /arrete=1/.test(l.q)), 'BDESE 2025 lue sur l’arrêté');
  assert.ok(screen.getByText('2025 : arrêté n° 1'));
});

test('arrêtés : la lecture seule consulte sans bouton ; mise à disposition du CSE par le dialogue (date contrôlée)', async () => {
  const { db, personne } = await baseDemo();
  servir(db);
  const { ACTIONS } = await import('../server/src/actions/index.ts');
  const { makeCtx } = await import('../server/src/actions/context.ts');
  const { loadFull } = await import('../server/src/dataset.ts');
  const u = await personne(null, 'rh');
  await db.tx(async () => await ACTIONS['indicateurs.arreter'](makeCtx(db, u, await loadFull(db, u)), { annee: 2025 }));
  const b2 = await monter(db, u, () => createElement(ArreteCseDialog, { id: 1 }));
  render(b2.element);
  const champ = screen.getByLabelText(/Mis à disposition le/) as HTMLInputElement;
  await act(async () => { fireEvent.change(champ, { target: { value: '2027-01-01' } }); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  assert.equal(b2.trace.actions.length, 0, 'date future refusée avant l’envoi');
  assert.ok(screen.getByText(/ne peut pas être datée du futur/));
  await act(async () => { fireEvent.change(champ, { target: { value: '2026-10-10' } }); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })); });
  assert.equal(b2.trace.actions.at(-1)!.name, 'indicateurs.marquerCse');
  assert.ok(b2.trace.actions.at(-1)!.r.ok);
  cleanup();
  // Lecture seule (Élodie Bernard, salariée 11) : arrêtés listés sans auteur ni bouton d'action.
  const lect = await monter(db, await personne(11, 'rh'), () => createElement(Indicateurs), { indOnglet: 'arretes' });
  render(lect.element);
  await attendre();
  assert.ok(screen.getByText('n° 1'));
  assert.equal(screen.queryByRole('button', { name: /Arrêter/ }), null);
  assert.equal(screen.queryByRole('button', { name: 'Annuler' }), null);
  assert.equal(screen.queryByRole('button', { name: /CSE/ }), null);
  assert.doesNotMatch(document.body.textContent!, /Sandrine Vidal/, 'auteur de l’arrêté non transmis à la lecture seule');
});

test('fiche : le service RH saisit sexe et catégorie (catégorie proposée d’après le statut) ; échéance agrégée', async () => {
  const { db, personne } = await baseDemo();
  const rh = await personne(14, 'rh');
  const b = await monter(db, rh, () => createElement(IndicateursACompleter));
  render(b.element);
  const avant = b.donnees().employes.filter(e => aCompleterIndicateurs(e, '2026-10-10')).length;
  assert.ok(avant > 0);
  assert.ok(screen.getByText(new RegExp(`^${avant} fiches? sans sexe ou catégorie`)));
  cleanup();
  const cible = b.donnees().employes.find(e => aCompleterIndicateurs(e, '2026-10-10') && e.statut === 'technicien')
    ?? b.donnees().employes.find(e => aCompleterIndicateurs(e, '2026-10-10'))!;
  const d = await monter(db, rh, () => createElement(EmployeDialog, { empId: cible.id }));
  render(d.element);
  await act(async () => { fireEvent.change(screen.getByLabelText(/^Sexe/), { target: { value: 'F' } }); });
  const reprendre = screen.queryByRole('button', { name: 'Reprendre' });
  if (reprendre) await act(async () => { fireEvent.click(reprendre); });
  else await act(async () => { fireEvent.change(screen.getByLabelText(/^Catégorie d’emploi/), { target: { value: 'ouvrier' } }); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ })); });
  const a = d.trace.actions.at(-1)!;
  assert.equal(a.name, 'employe.modifier');
  assert.ok(a.r.ok, a.r.error);
  assert.equal(a.payload.sexe, 'F');
  // Seuls les champs modifiés partent (avec leur valeur d'origine) : la fiche a ensuite les deux.
  const apres = d.donnees().employes.find(e => e.id === cible.id)!;
  assert.equal(apres.sexe, 'F');
  assert.ok(apres.categorie);
  assert.equal(d.donnees().employes.filter(e => aCompleterIndicateurs(e, '2026-10-10')).length, avant - 1);
  cleanup();
  // Manager : formulaire limité, sans sexe ni catégorie ; lecture seule : aucune échéance (elle ne reçoit pas les champs).
  const m = await monter(db, await personne(12, 'manager'), () => createElement(EmployeDialog, { empId: 2 }));
  render(m.element);
  assert.equal(screen.queryByLabelText(/^Sexe/), null);
  cleanup();
  const l = await monter(db, await personne(11, 'rh'), () => createElement(IndicateursACompleter));
  render(l.element);
  assert.equal(document.body.textContent, '');
});

test('Paramètres → Indicateurs sociaux : seuil et natures, modifiés par l’administrateur RH seul', async () => {
  const { db, personne } = await baseDemo();
  let lire = () => ({}) as import('../shared/types.ts').Settings;
  const b = await monter(db, await personne(null, 'rh'), () => createElement(SectionIndicateurs, { s: lire(), envois: {} as never }));
  lire = () => b.donnees().settings;
  render(b.element);
  assert.ok(screen.getByRole('heading', { name: 'Indicateurs sociaux' }));
  await act(async () => { fireEvent.click(screen.getByLabelText('7')); });
  assert.deepEqual(b.trace.actions.at(-1)!.payload, { indicateursSeuil: 7 });
  assert.ok(b.trace.actions.at(-1)!.r.ok);
  assert.equal(b.donnees().settings.indicateursSeuil, 7);
  await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Enfant malade' })); });
  assert.ok(!b.donnees().settings.absenteismeNatures.includes('ENFANT_MALADE'));
  cleanup();
  // Gestionnaire RH : consulte, contrôles désactivés ; paie : section masquée.
  const g = await monter(db, await personne(14, 'rh'), () => createElement(SectionIndicateurs, { s: b.donnees().settings, envois: {} as never }));
  render(g.element);
  assert.equal((screen.getByRole('checkbox', { name: 'Arrêt maladie' }) as HTMLInputElement).disabled, true);
  cleanup();
  const paie = await monter(db, await personne(7, 'rh'), () => createElement(SectionIndicateurs, { s: b.donnees().settings, envois: {} as never }));
  render(paie.element);
  assert.equal(document.body.textContent, '');
});

test('adresse de la page et mise en forme sans React', () => {
  const data = { referentiels: { equipes: [] } } as never;
  assert.deepEqual(lireUrl('indicateurs', '?onglet=bdese&annee=2025&groupe=sexe', data), { indOnglet: 'bdese', indAnnee: 2025, indGroupe: 'sexe' });
  assert.deepEqual(lireUrl('indicateurs', '?onglet=inconnu&annee=1850&groupe=salaire', data), { indOnglet: 'effectifs', indAnnee: null, indGroupe: 'aucun' });
  const ui = { indOnglet: 'ages', indAnnee: 2024, indGroupe: 'categorie' } as never;
  assert.equal(ecrireUrl('indicateurs', ui), '?onglet=ages&annee=2024&groupe=categorie');
  assert.equal(requeteIndicateurs({ annee: 2026, groupe: 'aucun' }), '?annee=2026&periode=annee&groupe=aucun');
  assert.equal(requeteIndicateurs({ arrete: 3, groupe: 'sexe' }), '?arrete=3&groupe=sexe');
  assert.equal(texteCase({ valeur: null, masque: true }, 5), '< 5');
  assert.equal(texteCase({ valeur: 12.5, masque: false }, 5, ' %'), '12,5 %');
  assert.equal(texteCase(undefined, 5), '—');
  assert.equal(texteCase({ valeur: null, masque: false }, 5), '—');
  // BDESE : une case masquée d'une année reste masquée, jamais recalculée.
  const t = { id: 'effectifs', titre: 'Effectifs', definition: 'déf', dimension: 'Ensemble', lignes: ['Ensemble'], colonnes: ['a', 'b', 'c', 'd', 'e'],
    cases: [[{ valeur: 20, masque: false }, { valeur: null, masque: true }, { valeur: 19, masque: false }, { valeur: 19, masque: false }, { valeur: 0, masque: false }]], completude: 100, completudeTexte: null };
  const r = { tableaux: [t], index: { effectifs: { ...t, id: 'indexEffectifs', lignes: ['Ouvriers', 'Total'], cases: [[{ valeur: null, masque: true }], [{ valeur: 3, masque: false }]] } } } as never;
  const annees = [{ annee: 2025, arrete: 2, r: { aucun: r } }, { annee: 2026, arrete: null, r: { aucun: null } }];
  const r1 = V.rubrique1(annees);
  assert.equal(r1[0].lignes[0].cases[0]!.valeur, 20);
  assert.equal(r1[0].lignes[1].cases[0]!.masque, true);
  assert.equal(r1[0].lignes[0].cases[1], undefined, 'année sans réponse : vide');
  const p = V.sectionsBdese(annees, 5);
  assert.ok(p[0].table!.head.includes('2025 (arrêté n° 2)'));
  assert.equal(p[0].table!.rows[1][1], '< 5');
  assert.ok(p.some(s => s.title.startsWith('Rubriques 3° à 10°')));
  assert.equal(V.caseDe(t as never, 'Inconnue', 0), undefined);
  assert.equal(V.caseDe(undefined, null, 0), undefined);
  assert.match(V.noteTableau({ ...t, completude: 80, completudeTexte: '2 fiches sans sexe' } as never), /Complétude : 80 % \(2 fiches sans sexe\)/);
  assert.equal(V.sectionsTableaux([t as never], 5)[0].table!.rows[0][2], '< 5');
  const arr = { id: 4, annee: 2025, cseLe: '2026-02-01', arreteLe: '2026-01-15T10:00:00.000Z', arretePar: null, seuil: 5, reglesVersion: 'x', annuleLe: '2026-03-01T10:00:00.000Z', annulePar: null } as never;
  assert.match(V.resumeArrete(arr), /mis à disposition du CSE le 1 févr\. 2026 · annulé le 1 mars 2026/);
  assert.equal(V.arreteEnVigueur([arr], 2025), null, 'annulé : plus en vigueur');
  assert.match(V.confirmationAnnuler(arr).suites!.join(' '), /prévenez les élus/);
  assert.match(V.confirmationArreter(2025, 5).suites![0], /seuil d’anonymat actuel \(5\)/);
  assert.equal(V.etatIndex('hors_cursus'), 'Hors Cursus');
});
