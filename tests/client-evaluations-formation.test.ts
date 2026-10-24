// Rendu de l'évaluation des formations (lot 7, chantier C, t121) sous node --test (tests/outils/rendu.ts,
// tests/outils/banc-client.ts) : avis à chaud du salarié depuis son encart « À faire » (note obligatoire, signalée sous le
// champ, bouton jamais grisé), efficacité à froid du manager depuis l'écran Formations, avis recueillis par le service RH à
// la clôture, indicateurs agrégés du référent HSE et leur export CSV, section de Paramètres.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

await import('./outils/rendu.ts');
const { act, cleanup, fireEvent, render, screen, within } = await import('@testing-library/react');
const { createElement } = await import('react');
const { baseDemo, monter } = await import('./outils/banc-client.ts');
const { EvaluationDialog } = await import('../client/src/dialogs/EvaluationDialog.tsx');
const { ClotureDialog } = await import('../client/src/dialogs/ClotureDialog.tsx');
const { EvaluationsManagerPanel, IndicateursEvaluationPanel, LignesEvaluationsAFaire, MesAvisFormations } = await import('../client/src/components/Evaluations.tsx');
const { aFaireCollaborateur } = await import('../shared/rules/a-faire.ts');
const { EvaluationsFormation } = await import('../client/src/pages/parametres/EvaluationsFormation.tsx');
const { csvEvaluations } = await import('../client/src/formations-csv.ts');
const { Domain } = await import('../shared/domain.ts');
const { indicateursEvaluation } = await import('../shared/rules/evaluation-formation.ts');
type SqliteDb = import('../server/src/db.ts').SqliteDb;

afterEach(() => cleanup());

async function cliquer(nom: string | RegExp) {
  const b = screen.getByRole('button', { name: nom });
  assert.equal((b as HTMLButtonElement).disabled, false, `« ${b.textContent} » ne doit pas être grisé`);
  await act(async () => { fireEvent.click(b); });
}

/** Session SST clôturée (un jour) avec les participations présentes de `empIds` ; renvoie leurs identifiants. */
async function sessionClose(db: SqliteDb, date: string, empIds: number[]) {
  const s = await db.insert<{ id: number }>('sessions', {
    formation: 'sst', date, fin: date, jours: [date], horaires: [], lieu: 'Site de Lyon — salle B', places: 12, statut: 'Clôturée', planId: null,
    bilan: { le: date, par: 'Sandrine Vidal', note: null, commentaire: null, motif: null },
  });
  const ids: number[] = [];
  for (const empId of empIds) ids.push((await db.insert<{ id: number }>('participations', { sessionId: s.id, empId, parcours: 'recyclage', present: true, reussi: null, certId: null })).id);
  return ids;
}

test('avis à chaud du salarié : dans « À faire », note obligatoire signalée sous le champ, puis avis enregistré', async () => {
  const { db, personne } = await baseDemo();
  const [p] = await sessionClose(db, '2026-10-02', [2]);
  const mehdi = await personne(2, 'collaborateur');
  // Encart « À faire » de Mon espace : l'avis attendu et son bouton.
  const portail = await monter(db, mehdi, () => createElement(LignesEvaluationsAFaire, { liste: aFaireCollaborateur(new Domain(portail.donnees()), 2).evaluations }));
  render(portail.element);
  assert.ok(screen.getByText('Votre avis — Sauveteur secouriste du travail (SST)'));
  await cliquer('Donner mon avis');
  assert.deepEqual(portail.trace.ouverts, [{ type: 'evaluation', cle: `p${p}`, quand: 'chaud' }]);
  cleanup();
  // Le dialogue : envoi sans note, l'erreur s'affiche, rien ne part ; avec une note et un commentaire, l'avis part.
  const b = await monter(db, mehdi, () => createElement(EvaluationDialog, { cle: `p${p}`, quand: 'chaud' }));
  render(b.element);
  assert.ok(screen.getByText(/votre manager ne voit pas votre avis/));
  await cliquer('Enregistrer l’avis');
  assert.ok(screen.getByText('Choisissez une note de 1 à 5'));
  assert.equal(b.trace.actions.length, 0);
  fireEvent.click(screen.getByRole('radio', { name: '4' }));
  fireEvent.change(screen.getByLabelText(/Commentaire/), { target: { value: 'Mises en situation utiles' } });
  await cliquer('Enregistrer l’avis');
  assert.equal(b.trace.actions.length, 1);
  const [a] = b.trace.actions;
  assert.equal(a.r.ok, true, a.r.error);
  assert.deepEqual(a.payload, { participationId: p, formationSuivieId: null, type: 'chaud', repondant: 'salarie', note: 4, commentaire: 'Mises en situation utiles' });
  assert.equal(b.trace.fermetures, 1);
  assert.equal(b.donnees().evaluationsFormation!.length, 1);
  cleanup();
  // Avis donné : repris dans « Mes avis sur les formations », modifiable.
  const mes = await monter(db, mehdi, () => createElement(MesAvisFormations, { empId: 2 }));
  render(mes.element);
  assert.ok(screen.getByText('À chaud · 4 / 5 · le 10 oct. 2026'));
  await cliquer('Modifier');
  assert.deepEqual(mes.trace.ouverts, [{ type: 'evaluation', cle: `p${p}`, quand: 'chaud' }]);
});

test('efficacité à froid du manager : écran Formations, réponse obligatoire, avis de manager enregistré', async () => {
  const { db, personne } = await baseDemo();
  const [p] = await sessionClose(db, '2026-06-10', [2]);
  const karim = await personne(12, 'manager');
  const panneau = await monter(db, karim, () => createElement(EvaluationsManagerPanel));
  render(panneau.element);
  assert.ok(screen.getByText('Mehdi Benali — Sauveteur secouriste du travail (SST)'));
  await cliquer('Évaluer');
  assert.deepEqual(panneau.trace.ouverts, [{ type: 'evaluation', cle: `p${p}`, quand: 'froid' }]);
  cleanup();
  const b = await monter(db, karim, () => createElement(EvaluationDialog, { cle: `p${p}`, quand: 'froid' }));
  render(b.element);
  assert.ok(screen.getByText('La formation a-t-elle été efficace pour ce salarié ?'));
  await cliquer('Enregistrer l’avis');
  assert.ok(screen.getByText('Choisissez une réponse'));
  assert.equal(b.trace.actions.length, 0);
  fireEvent.click(screen.getByRole('radio', { name: 'Partiellement efficace' }));
  await cliquer('Enregistrer l’avis');
  assert.equal(b.trace.actions[0].r.ok, true, b.trace.actions[0].r.error);
  assert.deepEqual(b.trace.actions[0].payload, { participationId: p, formationSuivieId: null, type: 'froid', repondant: 'manager', efficacite: 'partielle', commentaire: '' });
  assert.equal(b.donnees().evaluationsFormation![0].repondant, 'manager');
});

test('clôture : avis à chaud des présents recueilli par le service RH, envoyé avec la présence', async () => {
  const { db, personne } = await baseDemo();
  const b = await monter(db, await personne(14, 'rh'), () => createElement(ClotureDialog, { sessionId: 6 }));
  render(b.element);
  // Tous présents (session de validation par la présence).
  for (const nom of ['Antoine Leroy', 'Élodie Bernard', 'Fatou Ndiaye', 'Inès Dupont', 'Yanis Bouzid']) {
    fireEvent.click(within(screen.getByRole('radiogroup', { name: `Présence de ${nom}` })).getByRole('radio', { name: 'Présent' }));
  }
  // Avis proposé aux seuls présents ; note choisie pour Inès Dupont.
  fireEvent.change(screen.getByLabelText('Avis à chaud de Inès Dupont'), { target: { value: '4' } });
  await cliquer('Clôturer la session');
  const [a] = b.trace.actions;
  assert.equal(a.r.ok, true, a.r.error);
  const parts = a.payload.participants as { empId: number; note?: number }[];
  assert.deepEqual(parts.filter(x => x.note != null), [{ empId: 5, present: true, reussi: null, note: 4 }]);
  assert.match(a.r.message ?? '', /1 avis à chaud recueilli/);
});

test('référent HSE : indicateurs agrégés sans commentaire, export CSV ; section de Paramètres en consultation', async () => {
  const { db, personne } = await baseDemo();
  const ps = await sessionClose(db, '2026-03-10', [2, 6, 18]);
  for (const [p, note, empId] of [[ps[0], 4, 2], [ps[1], 5, 6], [ps[2], 2, 18]] as const) {
    await db.insert('evaluationsFormation', {
      empId, participationId: p, formationSuivieId: null, type: 'chaud', repondant: 'salarie', note, efficacite: null, commentaire: `Avis ${empId}`, le: '2026-03-11', auteur: 'X', auteurId: empId,
    });
  }
  const hse = await personne(23, 'rh');
  const b = await monter(db, hse, () => createElement(IndicateursEvaluationPanel));
  render(b.element);
  assert.ok(screen.getByText('Évaluation des formations 2026'));
  assert.equal(screen.getAllByText('3,7 / 5').length, 2, 'organisme et formation');
  assert.ok(screen.getByText(/3 participants · à chaud 3,7 \/ 5 \(3 avis\)/), 'total');
  assert.equal(document.body.textContent!.includes('Avis 2'), false, 'jamais de commentaire');
  // Export : agrégats seulement.
  const d = new Domain(b.donnees());
  const c = csvEvaluations(d, d.ds.indicateursEvaluation!.find(x => x.exercice === 2026)!);
  assert.equal(c.fichier, 'evaluations-formation-2026-2026-10-10.csv');
  assert.deepEqual(c.rows[0].slice(0, 5), ['Total', 'Total', 3, 3, '3,7']);
  assert.deepEqual(c.rows.map(r => r[1]), ['Total', 'Croix-Rouge française', 'Sauveteur secouriste du travail (SST)']);
  // Calcul identique à celui du service RH sur toutes les données (assez de réponses : rien de masqué).
  assert.deepEqual(d.ds.indicateursEvaluation!.find(x => x.exercice === 2026)!.total, indicateursEvaluation(new Domain(await (await import('../server/src/dataset.ts')).loadFull(db, await personne(14, 'rh'))), 2026).total);
  cleanup();
  const p = await monter(db, hse, () => createElement(EvaluationsFormation, { s: b.donnees().settings, envois: {} as never }));
  render(p.element);
  const coche = screen.getByRole('checkbox', { name: /Demander l’avis des participants/ }) as HTMLInputElement;
  assert.equal(coche.checked, true);
  assert.equal(coche.disabled, true, 'réglage de l’administrateur RH');
  assert.equal((screen.getByRole('checkbox', { name: 'Recommandées' }) as HTMLInputElement).checked, true);
  assert.equal((screen.getByRole('checkbox', { name: 'Internes' }) as HTMLInputElement).checked, false);
});
