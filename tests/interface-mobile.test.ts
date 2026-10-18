// Interface sur téléphone et confidentialité : ce qui attend le collaborateur (pastilles du menu, encart « À faire »),
// saisie des heures jour par jour (jour ouvert par défaut, nom des champs), titre de l'onglet, page Confidentialité
// (coordonnées réglées par l'administrateur RH, lisibles sans connexion, jamais recopiées au journal) et garde-fous
// sur les styles (tailles tactiles et contrastes surchargés dans app.css, nocturne.css inchangé).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { FeuilleTemps } from '../shared/types.ts';
process.env.CURSUS_TODAY = '2026-10-10';

const { default: express } = await import('express');
const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { lireConfidentialite, routesConfidentialite } = await import('../server/src/confidentialite.ts');
const { Domain } = await import('../shared/domain.ts');
const { wDays } = await import('../shared/dates.ts');
const { aFaireCollaborateur, semainePassee } = await import('../shared/rules/a-faire.ts');
const { A_COMPLETER, CONTACT_MAX, controleContact, INFO_CONFIDENTIALITE } = await import('../shared/confidentialite.ts');
const { familleAction, JOURNAL_LABEL } = await import('../shared/journal.ts');
const { ALLOWED_VIEWS, VUES_COMMUNES } = await import('../shared/constants.ts');
const { cellText, cellValue, jourLong, jourParDefaut, nomChamp } = await import('../client/src/components/heures.ts');
const { titreOnglet } = await import('../client/src/layout/navigation.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  const compte = (empId: number | null) => (db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: compte(empId), role, methode: 'demo' }))!;
  const RH = await user(null, 'rh');
  const domaine = async () => new Domain(await loadFull(db, RH));
  /** Comme POST /api/actions/:nom : action, puis trace au journal dans la même transaction. */
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: typeof r === 'string' ? r : null });
    return r;
  });
  return { db, user, RH, domaine, run };
}

// — Ce qui attend le collaborateur —

test('à faire : compte rendu à signer, feuille renvoyée, semaine passée à soumettre', async () => {
  const { db, domaine } = await fresh();
  const passee = semainePassee('2026-10-10');
  assert.equal(passee, '2026-09-28', 'samedi 10 octobre : la semaine passée commence le lundi 28 septembre');

  // Compte rendu clos par l'évaluateur, pas encore signé par le salarié (jeu de démonstration : Fatou Ndiaye).
  const cr = db.sql.prepare(`SELECT id, emp_id AS e FROM entretiens WHERE statut = 'realise' AND sign_sal IS NULL`).get() as { id: number; e: number };
  assert.deepEqual(aFaireCollaborateur(await domaine(), cr.e).comptesRendus.map(x => x.id), [cr.id]);
  await db.update('entretiens', cr.id, { signSal: '2026-10-09' });
  assert.deepEqual(aFaireCollaborateur(await domaine(), cr.e).comptesRendus, [], 'signé : plus rien à faire');

  // Mehdi Benali : feuille de la semaine passée validée, rien n'attend.
  const feuille = () => db.sql.prepare('SELECT id FROM feuilles WHERE emp_id = 2 AND week = ?').get(passee) as { id: number } | undefined;
  assert.deepEqual(aFaireCollaborateur(await domaine(), 2), { comptesRendus: [], feuilles: [] });
  // Renvoyée par le valideur : à corriger, avec son commentaire, comptée une seule fois.
  await db.update('feuilles', feuille()!.id, { statut: 'rejetee', comment: 'Heures du jeudi à répartir' });
  assert.deepEqual(aFaireCollaborateur(await domaine(), 2).feuilles, [{ week: passee, etat: 'renvoyee', commentaire: 'Heures du jeudi à répartir' }]);
  // Brouillon, ou aucune feuille : à soumettre.
  await db.update('feuilles', feuille()!.id, { statut: 'brouillon', comment: null });
  assert.deepEqual(aFaireCollaborateur(await domaine(), 2).feuilles, [{ week: passee, etat: 'a_soumettre', commentaire: null }]);
  await db.remove('feuilles', feuille()!.id);
  assert.equal(aFaireCollaborateur(await domaine(), 2).feuilles.length, 1, 'aucune feuille cette semaine-là, mais des feuilles antérieures');
  // Avant le début du suivi dans Cursus (aucune feuille jusqu'à la semaine passée : mise en service, reprise de
  // Lucca) : rien n'est réclamé ; une feuille ouverte cette semaine-ci n'y change rien.
  const anterieures = db.sql.prepare('SELECT id FROM feuilles WHERE emp_id = 2 AND week <= ?').all(passee) as { id: number }[];
  const sauvegarde = await Promise.all(anterieures.map(async x => (await db.get<FeuilleTemps>('feuilles', x.id))!));
  for (const x of anterieures) await db.remove('feuilles', x.id);
  await db.insert('feuilles', { empId: 2, week: '2026-10-05', statut: 'brouillon', comment: null, sage: false, keystone: false, lignes: [], contrat: null });
  assert.deepEqual(aFaireCollaborateur(await domaine(), 2).feuilles, [], 'première semaine suivie dans Cursus : la semaine en cours');
  for (const { id: _id, ...f } of sauvegarde) await db.insert('feuilles', f);
  assert.equal(aFaireCollaborateur(await domaine(), 2).feuilles.length, 1);
  // Semaine hors contrat (entrée postérieure) : aucune feuille attendue.
  await db.update('employes', 2, { entree: '2026-10-05' });
  assert.deepEqual(aFaireCollaborateur(await domaine(), 2).feuilles, []);
  // Feuille soumise : elle attend le valideur, pas le salarié.
  await db.update('employes', 2, { entree: '2019-03-01' });
  await db.insert('feuilles', { empId: 2, week: passee, statut: 'soumise', comment: null, sage: false, keystone: false, lignes: [], contrat: null });
  assert.deepEqual(aFaireCollaborateur(await domaine(), 2).feuilles, []);
  // Sans fiche (compte externe) : rien.
  assert.deepEqual(aFaireCollaborateur(await domaine(), null), { comptesRendus: [], feuilles: [] });
});

// — Saisie des heures jour par jour —

test('vue « un jour » : ouverte sur aujourd’hui, le vendredi le week-end, le lundi d’une autre semaine', () => {
  const semaine = wDays('2026-10-05');
  assert.equal(jourParDefaut(semaine, '2026-10-07'), 2, 'mercredi');
  assert.equal(jourParDefaut(semaine, '2026-10-05'), 0);
  assert.equal(jourParDefaut(semaine, '2026-10-10'), 4, 'samedi : le vendredi');
  assert.equal(jourParDefaut(semaine, '2026-10-11'), 4, 'dimanche : le vendredi');
  assert.equal(jourParDefaut(semaine, '2026-10-12'), 0, 'semaine passée affichée : le lundi');
  assert.equal(jourParDefaut(semaine, '2026-10-02'), 0, 'semaine à venir affichée : le lundi');
});

test('champ d’heures : nommé par projet, tâche et jour ; même normalisation que le serveur', () => {
  assert.equal(jourLong('2026-10-12'), 'lundi 12 octobre');
  assert.equal(nomChamp({ projet: 'INT-MAINT', tache: 'Maintenance préventive' }, jourLong('2026-10-12')), 'INT-MAINT · Maintenance préventive — lundi 12 octobre');
  assert.equal(cellValue('7,5'), 7.5);
  assert.equal(cellValue('30'), 24, '24 h au plus');
  assert.equal(cellValue('7,333'), 7.33);
  assert.equal(cellText(7.5), '7,5');
  assert.equal(cellText(0), '');
});

// — Navigation —

test('titre de l’onglet par page ; Confidentialité et Aide ouvertes dans tous les espaces', () => {
  assert.equal(titreOnglet('Feuilles de temps'), 'Feuilles de temps — Cursus');
  assert.equal(titreOnglet(null), 'Cursus');
  assert.deepEqual([...VUES_COMMUNES], ['confidentialite', 'aide']);
  // Vue commune : jamais parmi les vues d'un espace (la première est sa page d'accueil).
  for (const vues of Object.values(ALLOWED_VIEWS)) assert.ok(!(vues as readonly string[]).some(v => (VUES_COMMUNES as readonly string[]).includes(v)));
});

// — Page Confidentialité —

test('coordonnées : texte nettoyé, vide = aucune, longueur bornée', () => {
  assert.deepEqual(controleContact('  Chimie SAS   \n\n\n\n 12 rue du Rhône  ', 'Responsable'), { valeur: 'Chimie SAS\n\n12 rue du Rhône' });
  assert.deepEqual(controleContact('   ', 'Responsable'), { valeur: null });
  assert.deepEqual(controleContact(null, 'Responsable'), { valeur: null });
  assert.deepEqual(controleContact(42, 'Responsable'), { erreur: 'Responsable : texte attendu' });
  assert.deepEqual(controleContact('x'.repeat(CONTACT_MAX + 1), 'DPO'), { erreur: `DPO : ${CONTACT_MAX} caractères au plus` });
});

test('confidentialite.regler : administrateur RH, champs absents conservés, rien du texte au journal', async () => {
  const { db, user, RH, run } = await fresh();
  assert.deepEqual(await lireConfidentialite(db), { responsable: null, dpo: null });
  assert.match(String(await run(RH, 'confidentialite.regler', { responsable: 'Chimie Industrie SAS, Feyzin' })), /DPO non renseigné : la page renvoie au service RH$/);
  assert.equal(String(await run(RH, 'confidentialite.regler', { dpo: 'Claire Martin, dpo@entreprise.example' })), 'Coordonnées de la page Confidentialité enregistrées');
  assert.deepEqual(await lireConfidentialite(db), { responsable: 'Chimie Industrie SAS, Feyzin', dpo: 'Claire Martin, dpo@entreprise.example' });
  // Vidé : la page renvoie de nouveau au service RH.
  await run(RH, 'confidentialite.regler', { dpo: '' });
  assert.equal((await lireConfidentialite(db)).dpo, null);
  await assert.rejects(async () => await run(RH, 'confidentialite.regler', { responsable: 'x'.repeat(CONTACT_MAX + 1) }), (e: unknown) => e instanceof ActionError && e.status === 400);
  // Gestionnaire RH et collaborateur : refus.
  for (const u of [await user(14, 'rh'), await user(2, 'collaborateur')]) {
    await assert.rejects(async () => await run(u, 'confidentialite.regler', { dpo: 'x' }), (e: unknown) => e instanceof ActionError && e.status === 403);
  }
  // Journal : le nom des champs modifiés, jamais leur texte ; libellé et famille « Administration ».
  const lignes = (await db.all<{ action: string; payload: Record<string, unknown> }>('journal')).filter(l => l.action === 'confidentialite.regler');
  assert.deepEqual(lignes.map(l => l.payload), [{ champsModifies: ['responsable'] }, { champsModifies: ['dpo'] }, { champsModifies: ['dpo'] }]);
  // Comme l'écran Paramètres : les deux champs envoyés, seul le DPO change (le responsable, renvoyé à l'identique,
  // n'est pas nommé) ; un enregistrement sans changement ne nomme aucun champ.
  await run(RH, 'confidentialite.regler', { responsable: 'Chimie Industrie SAS, Feyzin', dpo: 'Claire Martin, dpo@entreprise.example' });
  await run(RH, 'confidentialite.regler', { responsable: 'Chimie Industrie SAS, Feyzin', dpo: 'Claire Martin, dpo@entreprise.example' });
  const suite = (await db.all<{ action: string; payload: Record<string, unknown> }>('journal')).filter(l => l.action === 'confidentialite.regler').slice(3);
  assert.deepEqual(suite.map(l => l.payload), [{ champsModifies: ['dpo'] }, { champsModifies: [] }]);
  assert.ok(!JSON.stringify(await db.all('journal')).includes('Claire Martin'));
  assert.ok(JOURNAL_LABEL['confidentialite.regler']);
  assert.equal(familleAction('confidentialite.regler')?.id, 'administration');
});

test('GET /api/confidentialite : lisible sans connexion (écran de connexion)', async () => {
  const { db, RH, run } = await fresh();
  await run(RH, 'confidentialite.regler', { responsable: 'Chimie Industrie SAS', dpo: 'dpo@entreprise.example' });
  const app = express();
  app.use(routesConfidentialite(db));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  try {
    const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/confidentialite`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { responsable: 'Chimie Industrie SAS', dpo: 'dpo@entreprise.example' });
  } finally {
    srv.close();
  }
});

test('texte de la page : durées décidées reprises, mentions « à compléter par le DPO », descriptif docs/RGPD.md', () => {
  const texte = JSON.stringify(INFO_CONFIDENTIALITE);
  assert.match(texte, /Journal des actions","1 an ; les actions liées à la paie sont ensuite archivées, hors de l’écran, jusqu’à 3 ans/);
  assert.ok(texte.includes(A_COMPLETER), 'ce que l’entreprise n’a pas tranché est signalé');
  for (const r of INFO_CONFIDENTIALITE) assert.ok(r.points.length > 0, r.id);
  const doc = readFileSync(new URL('../docs/RGPD.md', import.meta.url), 'utf8');
  for (const d of ['Keystone', 'Sage Paie', 'Microsoft 365', 'Agences d\'intérim', 'santé au travail', 'Hébergeur', 'référent HSE', 'Gestionnaire de paie', 'Manager']) {
    assert.ok(doc.toLowerCase().includes(d.toLowerCase()), `destinataire décrit dans docs/RGPD.md : ${d}`);
  }
  assert.match(doc, /1 an ; les actions liées à la paie/);
  assert.match(doc, /supprimées au bout de 3 ans/);
});

// — Styles —

test('styles : tailles tactiles et contrastes surchargés dans app.css, le design system reste intact', () => {
  const app = readFileSync(new URL('../client/src/styles/app.css', import.meta.url), 'utf8');
  const nocturne = readFileSync(new URL('../client/src/styles/nocturne.css', import.meta.url), 'utf8');
  // nocturne.css : copie du design system (champs en 14 px, bordure --color-divider à 16 %), jamais modifiée.
  assert.match(nocturne, /font-size: 14px; color: var\(--color-text\); caret-color/);
  assert.match(nocturne, /--color-divider: color-mix\(in srgb, #e9e9ed 16%, transparent\);/);
  const tactile = /@media \(pointer: coarse\) \{([^@]*?)\n\}/.exec(app)?.[1] ?? '';
  assert.match(tactile, /\.input \{ font-size: 16px; min-height: 44px; \}/, 'champs en 16 px : pas de zoom automatique d’iOS');
  assert.match(tactile, /\.btn-icon \{ min-width: 44px; min-height: 44px; \}/);
  assert.match(app, /--bordure-champ: color-mix\(in srgb, var\(--color-text\) 45%, transparent\);/);
  assert.match(app, /\.input, \.seg, \.radio \.dot \{ border-color: var\(--bordure-champ\); \}/);
  assert.match(app, /\.card-meta \{ color: color-mix\(in srgb, var\(--color-text\) 60%, transparent\); \}/);
});
