// Copies du serveur commun EPC2I dans le dépôt (lot 8, chantier D) :
// - infra/postgres-socle/ : copie du socle de Matrix au commit noté en tête. Toute colonne que Cursus déclare sensible
//   (convention du 15/10/2026, commentaire « Sensible » de ses migrations) doit figurer dans droits.colonnes_sensibles
//   de la copie, ou dans la demande à Matrix encore en attente (docs/demandes/matrix-lot8-colonnes-sensibles.sql) ;
//   une copie périmée, à qui il manquerait des colonnes, laisserait passer en CI une vue ou un droit refusé ensuite sur
//   le serveur réel. Quand Matrix a appliqué la demande, ce test échoue : recopier le socle, vider la demande, puis
//   rendre bloquante l'étape « Colonnes déclarées sensibles » de .github/workflows/ci.yml.
// - infra/postgres-partage/20-cursus.sql : pub_titres_detenus identique à la migration 0011 (noms qualifiés).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { cle, declareesSensibles, demandeMatrix, lire, socleCursus } = await import('./colonnes-sensibles.ts');

/** Commit de Matrix copié dans infra/postgres-socle/ (en-tête de chaque fichier). */
const COMMIT_SOCLE = '403ff37';

/**
 * Convention du 15/10/2026 et ajouts du 22/10/2026 (en-tête de server/migrations-pg/0002_partage.sql et § 4 du socle) :
 * colonnes que Cursus ne publie jamais et que Matrix ne lit jamais, commentées ou non dans les migrations.
 */
const CONVENTION = [
  'employes.visite', 'employes.passeport_numero', 'employes.passeport_expire', 'employes.naissance', 'employes.naissance_le',
  'employes.reprise_motif', 'employes.reprise_date', 'employes.avis', 'employes.restrictions', 'employes.suivi',
  'employes.prochaine_visite', 'employes.examen_aptitude', 'employes.autorisation_travail', 'employes.urgence_nom',
  'employes.urgence_tel', 'vaccinations.*', 'visas.*', 'entretiens.cr', 'pieces.jeton', 'pieces.nom', 'pieces.fichier',
  'journal.payload', 'journal.message', 'demandes_collab.label',
];

test('copie du socle : trois fichiers de Matrix au même commit, en-tête à jour', () => {
  for (const f of ['01-base-et-roles.sql', '02-schemas.sql', '03-droits.sql']) {
    const tete = lire(`infra/postgres-socle/${f}`).split('\n').slice(0, 4).join('\n');
    assert.match(tete, new RegExp(`infra/postgres/init/${f.replace('.', '\\.')} au commit ${COMMIT_SOCLE}\\b`), f);
    assert.match(tete, /Ne\s*(--\s*)?pas modifier ici/, f);
  }
  // Ajouts de Matrix du 22/10/2026, absents de l'ancienne copie (0abe407) : schéma extensions et suivi médical.
  assert.match(lire('infra/postgres-socle/02-schemas.sql'), /CREATE SCHEMA IF NOT EXISTS extensions/);
});

test('colonnes sensibles attendues par Cursus : toutes dans la copie du socle ou dans la demande à Matrix', () => {
  const socle = socleCursus(), demande = new Map(demandeMatrix().map(c => [cle(c), c]));
  const declarees = declareesSensibles().map(cle);
  assert.ok(declarees.length >= 50, `commentaires « Sensible » lus dans les migrations (${declarees.length})`);
  const attendues = [...new Set([...CONVENTION, ...declarees])].sort();
  const couverte = (k: string) => socle.has(k) || socle.has(`${k.split('.')[0]}.*`) || demande.has(k);
  assert.deepEqual(attendues.filter(k => !couverte(k)), [],
    'colonnes déclarées sensibles ni dans droits.colonnes_sensibles de la copie, ni dans docs/demandes/matrix-lot8-colonnes-sensibles.sql');
  // La convention est déjà appliquée par Matrix (pas seulement demandée).
  assert.deepEqual(CONVENTION.filter(k => !socle.has(k) && !socle.has(`${k.split('.')[0]}.*`)), []);
});

test('demande à Matrix : complète, cohérente avec les commentaires des migrations, pas encore appliquée par la copie', () => {
  const socle = socleCursus(), demande = demandeMatrix(), declarees = new Set(declareesSensibles().map(cle));
  assert.ok(demande.length > 0);
  assert.equal(new Set(demande.map(cle)).size, demande.length, 'aucune ligne en double');
  assert.ok(demande.every(c => c.origine === 'convention'), 'toutes en convention');
  // Chaque ligne demandée est déclarée sensible dans les migrations : le contrôle de la CI la couvre.
  assert.deepEqual(demande.map(cle).filter(k => !declarees.has(k)), [], 'commentaire « Sensible » manquant (migration 0011)');
  // settings reste lisible : pub_parametres (D19) la lit, et droits.verifier() refuse une vue publiée sur une table fermée.
  assert.ok(!demande.some(c => c.table === 'settings'));
  // Encore en attente : aucune ligne n'est déjà dans la copie en convention. Sinon Matrix l'a appliquée : la retirer de
  // la demande (et, demande vide, rendre bloquante l'étape de la CI).
  assert.deepEqual(demande.map(cle).filter(k => socle.get(k)?.origine === 'convention'), []);
});

test('partage : pub_titres_detenus de infra/postgres-partage/20-cursus.sql identique à la migration 0011', () => {
  const vue = (sql: string, debut: RegExp) => {
    const i = sql.search(debut);
    assert.ok(i >= 0, String(debut));
    const fin = sql.indexOf(') pr ON true;', i);
    return sql.slice(i, fin).replace(/^\s*--.*$/gm, '').replace(/\s+/g, ' ').replace(/"pub_titres_detenus"/, 'pub_titres_detenus');
  };
  const migration = vue(lire('server/migrations-pg/0011_pub_titres_valides.sql'), /CREATE OR REPLACE VIEW "pub_titres_detenus"/);
  const partage = vue(lire('infra/postgres-partage/20-cursus.sql'), /CREATE OR REPLACE VIEW cursus\.pub_titres_detenus/).replace(/\bcursus\./g, '');
  assert.equal(partage, migration);
  assert.match(migration, /c\.annule_le IS NULL/);
  assert.match(migration, /c2\.annule_le IS NULL/);
});
