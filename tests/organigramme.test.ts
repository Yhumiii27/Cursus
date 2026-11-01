// Organigramme (lot 11, chantier C1, étape 1 ; shared/rules/organigramme.ts) : arbre société > établissement > équipe >
// équipe rattachée > personne, par valeurs. Présents seulement (entrée passée, fin à venir, fiches anonymisées exclues,
// ou liste des présents transmise par le serveur), valideurs lus tels quels (aucun ne change), suppléant d'après les
// délégations visibles et sans dates, anomalies et étiquettes pour le seul service RH, réglage `organigrammeOuvert`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anomalieTexte, arbre, cheminEquipe, ORGANIGRAMME_OUVERT, organigrammeOuvertA, presentA, presentsDe, sousArbre, type NoeudEntite, type NoeudEquipe, type PersonneArbre,
} from '../shared/rules/organigramme.ts';
import { present } from '../shared/rules/contrats.ts';
import type { DelegationValidation, Entite, Equipe } from '../shared/types.ts';

const T = '2026-10-10';
const entite = (code: string, o: Partial<Entite> = {}): Entite => ({
  code, nom: code.toUpperCase(), type: 'societe', parente: null, siren: null, siret: null, idcc: null, siteCode: null, ordre: 0, actif: true, fermeLe: null, source: 'local', ...o,
});
const equipe = (nom: string, managerId: number | null, o: Partial<Equipe> = {}): Equipe => ({ nom, managerId, ordre: 0, ...o });
const p = (id: number, nom: string, eq: string | null, o: Partial<PersonneArbre> = {}): PersonneArbre => ({ id, nom, equipe: eq, poste: `Poste ${id}`, ...o });
const delegation = (managerId: number, suppleantId: number, o: Partial<DelegationValidation> = {}): DelegationValidation => ({
  id: managerId * 100 + suppleantId, managerId, suppleantId, du: '2026-10-05', au: '2026-10-16', perimetre: ['absences'], creeLe: '2026-10-01', creePar: 'RH',
  revoqueeLe: null, revoqueePar: null, annonceeLe: null, ...o,
});

const ENTITES: Entite[] = [
  entite('epc2i', { nom: 'EPC2I', ordre: 1 }),
  entite('lyon', { nom: 'Lyon', type: 'etablissement', parente: 'epc2i', siret: '55210055400013', siteCode: 'lab67', ordre: 2 }),
  entite('alsace', { nom: 'Alsace', type: 'etablissement', parente: 'epc2i', ordre: 1 }),
  entite('ancienne', { nom: 'Ancienne', actif: false, fermeLe: '2026-01-01', ordre: 3 }),
  entite('orphelin', { nom: 'Orphelin', type: 'etablissement', parente: 'disparue', ordre: 4 }),
];
const EQUIPES: Equipe[] = [
  equipe('Production', 3, { entite: 'lyon', ordre: 1, siteCode: 'lab67', uniteCode: 'PRD' }),
  equipe('Maintenance', 12, { parente: 'Production', ordre: 2, entite: 'epc2i' }),
  equipe('Méthodes', null, { parente: 'Maintenance', ordre: 3 }),
  equipe('Commercial', 9, { entite: 'epc2i', ordre: 0 }),
  equipe('Site de Lyon', null, { ordre: 4 }),
  equipe('Fantôme', null, { parente: 'Disparue', ordre: 5, entite: 'inconnue' }),
];
const ANNUAIRE: PersonneArbre[] = [
  p(3, 'Paul Durand', 'Production', { entree: '2010-01-01' }),
  p(12, 'Karim Haddad', 'Maintenance'),
  p(2, 'Mehdi Benali', 'Maintenance'),
  p(6, 'Thomas Garnier', 'Maintenance', { fin: '2026-10-09' }),
  p(7, 'Adèle Arrivée', 'Maintenance', { entree: '2026-11-02' }),
  p(8, 'Anonyme', 'Maintenance', { anonymiseLe: '2026-06-01' }),
  p(9, 'Zoé Commerciale', 'Commercial', { fin: '2026-10-10' }),
  p(10, 'Bruno Méthode', 'Méthodes'),
  p(11, 'Sans Équipe', null),
  p(13, 'Équipe Inconnue', 'Disparue'),
  p(14, 'Fantomas', 'Fantôme'),
];

const noms = (l: readonly { nom: string }[]) => l.map(x => x.nom);
const equipeDe = (n: NoeudEntite | NoeudEquipe[], nom: string): NoeudEquipe | undefined => {
  const liste = Array.isArray(n) ? n : [...n.equipes, ...n.etablissements.flatMap(e => [...e.equipes])];
  for (const q of liste) {
    if (q.nom === nom) return q;
    const f = equipeDe(q.equipes, nom);
    if (f) return f;
  }
  return undefined;
};

test('présents : entrée passée et fin à venir, plus strict que present() ; anonymisés exclus', () => {
  assert.equal(presentA({ entree: '2026-10-10', fin: '2026-10-10' }, T), true);
  assert.equal(presentA({ entree: '2026-10-11', fin: null }, T), false, 'embauche à venir');
  assert.equal(present({ fin: null }, T), true, 'present() inchangé : une embauche à venir y compte');
  assert.equal(presentA({ fin: '2026-10-09' }, T), false);
  assert.equal(presentA({}, T), true);
  assert.deepEqual(presentsDe(ANNUAIRE, T), [3, 12, 2, 9, 10, 11, 13, 14]);
});

test('réglage organigrammeOuvert : l’espace RH toujours, managers et collaborateurs selon le réglage', () => {
  assert.deepEqual((['tous', 'managers', 'rh'] as const).map(r => [organigrammeOuvertA(r, 'rh'), organigrammeOuvertA(r, 'manager'), organigrammeOuvertA(r, 'collaborateur')]),
    [[true, true, true], [true, true, false], [true, false, false]]);
  assert.equal(organigrammeOuvertA(undefined, 'collaborateur'), true, 'ouvert à tous par défaut');
  assert.deepEqual(Object.keys(ORGANIGRAMME_OUVERT), ['tous', 'managers', 'rh']);
});

test('arbre : sociétés et établissements, équipes racines et rattachées, présents, valideurs lus tels quels', () => {
  const a = arbre(ENTITES, EQUIPES, ANNUAIRE, [], T);
  // Sociétés d'abord, dans l'ordre ; établissement d'une société absente au premier niveau ; entité fermée sans équipe
  // retirée.
  assert.deepEqual(a.entites.map(e => [e.code, e.type, e.etablissements.map(x => x.code)]), [['epc2i', 'societe', ['alsace', 'lyon']], ['orphelin', 'etablissement', []]]);
  const epc2i = a.entites[0];
  assert.deepEqual(noms(epc2i.equipes), ['Commercial']);
  const lyon = epc2i.etablissements[1];
  assert.deepEqual([lyon.nom, lyon.siret, lyon.siteCode, lyon.fermee], ['Lyon', '55210055400013', 'lab67', false]);
  // L'entité posée sur une équipe rattachée (Maintenance) n'est pas lue : elle suit la Production.
  assert.deepEqual(noms(lyon.equipes), ['Production']);
  const prod = lyon.equipes[0];
  assert.deepEqual([prod.manager, prod.siteCode, prod.uniteCode, prod.valideurManager], ['Paul Durand', 'lab67', 'PRD', 0]);
  assert.deepEqual(noms(prod.equipes), ['Maintenance']);
  const maint = prod.equipes[0];
  // Présents seulement : sorti la veille, embauche à venir et fiche anonymisée exclus ; le manager en tête.
  assert.deepEqual(maint.membres.map(m => [m.nom, m.manager, m.valideur]), [['Karim Haddad', true, 3], ['Mehdi Benali', false, 12]]);
  assert.equal(maint.valideurManager, 3, 'N+1 du manager : celui de l’équipe parente');
  const meth = equipeDe(maint.equipes, 'Méthodes')!;
  assert.deepEqual([meth.manager, meth.valideurManager, meth.membres.map(m => m.valideur)], [null, 0, [0]], 'équipe sans manager : le service RH');
  assert.deepEqual([meth.effectif, maint.effectif, prod.effectif, lyon.effectif, epc2i.effectif], [1, 3, 4, 4, 5]);
  assert.equal(epc2i.equipes[0].membres[0].nom, 'Zoé Commerciale', 'présente jusqu’à son dernier jour');
  // Équipes racines sans entité : sans entité, d'une entité inconnue, d'une équipe parente inconnue.
  assert.deepEqual(noms(a.sansEntite), ['Site de Lyon', 'Fantôme']);
  assert.deepEqual(a.sansEntite[1].membres.map(m => m.nom), ['Fantomas']);
  // Hors du service RH : ni salariés à affecter, ni anomalies, ni étiquettes.
  assert.deepEqual([a.aAffecter, a.anomalies], [[], []]);
  assert.equal(a.effectif, 6);
  assert.ok(!JSON.stringify(a).includes('etiquette'));
});

test('arbre : présents transmis par le serveur à la place des dates (hors du service RH)', () => {
  const sansDates = ANNUAIRE.map(({ entree: _e, fin: _f, anonymiseLe: _a, ...x }) => x);
  const a = arbre(ENTITES, EQUIPES, sansDates, [], T, { presents: presentsDe(ANNUAIRE, T) });
  const b = arbre(ENTITES, EQUIPES, ANNUAIRE, [], T);
  assert.deepEqual(a, b);
  assert.equal(arbre(ENTITES, EQUIPES, sansDates, [], T, { presents: new Set([2]) }).effectif, 1);
});

test('arbre : suppléant d’après les délégations visibles en vigueur, sans les dates', () => {
  const a = arbre(ENTITES, EQUIPES, ANNUAIRE, [delegation(12, 2), delegation(3, 10, { revoqueeLe: '2026-10-06T08:00:00Z' }), delegation(9, 11, { du: '2026-10-11' })], T);
  const maint = equipeDe(a.entites[0], 'Maintenance')!;
  assert.deepEqual(maint.suppleant, { id: 2, nom: 'Mehdi Benali' });
  assert.equal(equipeDe(a.entites[0], 'Production')!.suppleant, null, 'délégation révoquée');
  assert.equal(equipeDe(a.entites[0], 'Commercial')!.suppleant, null, 'délégation à venir');
  assert.ok(!JSON.stringify(maint).includes('2026-'), 'aucune date');
  // Suppléant absent de l'annuaire : non montré.
  assert.equal(equipeDe(arbre(ENTITES, EQUIPES, ANNUAIRE, [delegation(12, 99)], T).entites[0], 'Maintenance')!.suppleant, null);
});

test('arbre : service RH — salariés à affecter, anomalies, étiquettes de contrat', () => {
  const etiquettes = new Map([[2, 'Intérim'], [11, 'Stage']]);
  const a = arbre(ENTITES, EQUIPES, ANNUAIRE, [], T, { rh: true, etiquettes });
  assert.deepEqual(a.aAffecter.map(m => [m.nom, m.etiquette ?? null]), [['Équipe Inconnue', null], ['Sans Équipe', 'Stage']]);
  assert.equal(equipeDe(a.entites[0], 'Maintenance')!.membres[1].etiquette, 'Intérim');
  assert.deepEqual(a.anomalies, [
    { kind: 'equipeSansManager', equipe: 'Méthodes' }, { kind: 'equipeSansManager', equipe: 'Site de Lyon' }, { kind: 'equipeSansManager', equipe: 'Fantôme' },
    { kind: 'aAffecter', empId: 13 }, { kind: 'aAffecter', empId: 11 },
    { kind: 'racineSansEntite', equipe: 'Site de Lyon' }, { kind: 'racineSansEntite', equipe: 'Fantôme' },
    { kind: 'equipeSite', equipe: 'Site de Lyon' },
  ]);
  assert.equal(a.effectif, 8);
  // Étiquettes ignorées hors du service RH, même fournies.
  assert.ok(!JSON.stringify(arbre(ENTITES, EQUIPES, ANNUAIRE, [], T, { etiquettes })).includes('Intérim'));
  const nom = (id: number) => ANNUAIRE.find(x => x.id === id)?.nom ?? '?';
  assert.deepEqual(a.anomalies.slice(0, 1).concat(a.anomalies.slice(3, 4), a.anomalies.slice(5, 6), a.anomalies.slice(7)).map(x => anomalieTexte(x, nom)), [
    'L’équipe Méthodes n’a pas de manager : ses validations reviennent au service RH.',
    'Équipe Inconnue n’est affecté à aucune équipe.',
    'L’équipe Site de Lyon ne relève d’aucune entité (société ou établissement).',
    'L’équipe racine Site de Lyon porte un nom de site : à convertir à la main en site ou en établissement si c’en est un.',
  ]);
});

test('arbre : entité fermée qui porte encore une équipe (écriture directe) montrée, marquée fermée ; base vide', () => {
  const a = arbre(ENTITES, [equipe('Archives', 5, { entite: 'ancienne' })], [p(5, 'Archiviste', 'Archives')], [], T);
  assert.deepEqual(a.entites.map(e => [e.code, e.fermee, e.effectif]), [['epc2i', false, 0], ['ancienne', true, 1], ['orphelin', false, 0]]);
  assert.deepEqual(arbre([], [], [], [], T), { entites: [], sansEntite: [], aAffecter: [], anomalies: [], effectif: 0 });
});

test('chemin d’une équipe et sous-arbre', () => {
  assert.deepEqual(cheminEquipe(EQUIPES, 'Méthodes'), { chemin: ['Production', 'Maintenance', 'Méthodes'], entite: 'lyon' });
  assert.deepEqual(cheminEquipe(EQUIPES, 'Commercial'), { chemin: ['Commercial'], entite: 'epc2i' });
  assert.deepEqual(sousArbre(EQUIPES, ['Production']), ['Production', 'Maintenance', 'Méthodes']);
});
