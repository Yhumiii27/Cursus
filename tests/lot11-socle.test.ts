// Socle commun du lot 11 (S0) : contrainte PostgreSQL des objets de pièce élargie d'avance (0015_lot11_socle) et
// registres créés vides pour les chantiers (saisie hors ligne, notifications push, gabarit d'export comptable). Les
// contrôles suivent les registres quand les chantiers les remplissent : une action hors ligne existe dans le registre du
// serveur, une notification push est un texte fixe sans nom ni date, tout objet de pièce du code est admis par PostgreSQL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { migrationsPg } = await import('../server/src/db-pg.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { OBJETS_PIECE } = await import('../shared/rules/pieces.ts');
const { ALLOWED_VIEWS } = await import('../shared/constants.ts');
const { ACTIONS_HORS_LIGNE } = await import('../shared/hors-ligne.ts');
const { NOTIFICATIONS_PUSH } = await import('../shared/notifications-push.ts');

/**
 * Valeurs de la dernière définition de pieces_objet_check dans la chaîne des migrations PostgreSQL (jusqu'à la migration
 * `jusqua` comprise, si elle est donnée).
 */
function objetsAdmisPg(jusqua?: string): string[] {
  let valeurs: string[] = [];
  for (const m of migrationsPg()) {
    if (jusqua && m.nom > jusqua) break;
    for (const r of m.sql.matchAll(/"pieces_objet_check" CHECK \("objet" IN \(([^)]*)\)\)/g)) valeurs = [...r[1].matchAll(/'([^']+)'/g)].map(v => v[1]);
  }
  return valeurs;
}

test('0015_lot11_socle : pieces_objet_check admet les objets existants et les quatre objets du lot 11', () => {
  const m = migrationsPg().find(x => x.nom === '0015_lot11_socle');
  assert.ok(m, 'migration 0015_lot11_socle absente');
  assert.match(m.sql, /ALTER TABLE "pieces" DROP CONSTRAINT "pieces_objet_check";/);
  // Seule la contrainte change : ni table, ni colonne, ni vue, ni schéma.
  assert.doesNotMatch(m.sql.replace(/^--.*$/gm, ''), /CREATE|ADD COLUMN|DROP TABLE|DROP COLUMN|pub_/);
  // Définition posée par 0015 (le lot 12 l'élargit à son tour : tests/lot12-socle.test.ts).
  assert.deepEqual(objetsAdmisPg('0015_lot11_socle'),
    ['absence', 'certification', 'habTitre', 'declaration', 'voyage', 'dossierOpco', 'ligneFrais', 'ligneFraisSante', 'vehiculePerso']);
});

test('objets de pièce du code (OBJETS_PIECE) tous admis par la contrainte PostgreSQL', () => {
  const admis = new Set(objetsAdmisPg());
  for (const objet of Object.keys(OBJETS_PIECE)) assert.ok(admis.has(objet), `${objet} refusé par pieces_objet_check : élargir la contrainte dans une migration`);
});

test('registre hors ligne : actions existantes, sans doublon', () => {
  assert.equal(new Set(ACTIONS_HORS_LIGNE).size, ACTIONS_HORS_LIGNE.length);
  for (const nom of ACTIONS_HORS_LIGNE) assert.ok(nom in ACTIONS, `${nom} : action inconnue du serveur`);
});

test('registre des notifications push : textes fixes, sans nom ni date, vue connue', () => {
  const vues = new Set<string>(Object.values(ALLOWED_VIEWS).flat());
  for (const [cle, n] of Object.entries(NOTIFICATIONS_PUSH)) {
    for (const texte of [n.titre, n.corps]) {
      assert.ok(texte.trim(), `${cle} : texte vide`);
      // Ni gabarit à remplir (nom, date…), ni chiffre (date, montant, nombre).
      assert.doesNotMatch(texte, /[{}$%]|\d/, `${cle} : « ${texte} » n'est pas un texte fixe`);
    }
    if (n.vue !== undefined) assert.ok(vues.has(n.vue), `${cle} : vue ${n.vue} inconnue`);
  }
});
