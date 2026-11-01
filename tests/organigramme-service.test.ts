// Organigramme, lot 12 — C7 (client/src/organigramme-vue.ts, client/src/state/url.ts, client/src/print.ts) : choix d'un
// service (l'équipe et ses sous-équipes, son rattachement gardé pour le CSV), combiné à l'entité, au site et à la
// recherche ; service inconnu ignoré ; services proposés triés par chemin ; fil d'Ariane ; service et présentation dans
// l'adresse ; arbre vertical imprimé et son échelle, par valeurs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arbre, type PersonneArbre } from '../shared/rules/organigramme.ts';
import type { Entite, Equipe, Site } from '../shared/types.ts';
import {
  boitesEnLargeur, choixServices, cleEquipe, cleMembres, clesDepliables, clesDepliablesGraphique, echelleImpression, ECHELLE_MIN, filAriane, filtrerArbre,
  lignesOrganigramme, noeudService, restreindreAuService, sectionsImpressionGraphique, SEUIL_MEMBRES,
} from '../client/src/organigramme-vue.ts';
import type { PrintArbre } from '../client/src/print.ts';
const { PARAMS_URL, lireUrl, adresse } = await import('../client/src/state/url.ts');

const T = '2026-10-10';
const entite = (code: string, o: Partial<Entite> = {}): Entite => ({
  code, nom: code.toUpperCase(), type: 'societe', parente: null, siren: null, siret: null, idcc: null, siteCode: null, ordre: 0, actif: true, fermeLe: null, source: 'local', ...o,
});
const equipe = (nom: string, managerId: number | null, o: Partial<Equipe> = {}): Equipe => ({ nom, managerId, ordre: 0, ...o });
const p = (id: number, nom: string, eq: string | null, poste = `Poste ${id}`): PersonneArbre => ({ id, nom, equipe: eq, poste });

// Site > service > atelier : Production (PDE) > Maintenance (lab67) > Électricité ; Qualité à part ; Commercial à Lyon.
const ENTITES: Entite[] = [
  entite('epc2i', { nom: 'EPC2I', ordre: 0, siteCode: 'pde' }),
  entite('lyon', { nom: 'Lyon', type: 'etablissement', parente: 'epc2i', ordre: 1 }),
];
const SITES: Site[] = [{ code: 'pde', libelle: 'PDE', actif: true, ordre: 0 }, { code: 'lab67', libelle: 'Laboratoire 67', actif: true, ordre: 1 }];
const EQUIPES: Equipe[] = [
  equipe('Production', 3, { entite: 'epc2i', ordre: 0 }),
  equipe('Maintenance', 12, { parente: 'Production', ordre: 1, siteCode: 'lab67' }),
  equipe('Électricité', 6, { parente: 'Maintenance', ordre: 2 }),
  equipe('Qualité', 23, { entite: 'epc2i', ordre: 3 }),
  equipe('Commercial', 9, { entite: 'lyon', ordre: 4 }),
  equipe('Orpheline', null, { ordre: 5 }),
];
const ANNUAIRE: PersonneArbre[] = [
  p(3, 'Sophie Lemaire', 'Production', 'Cheffe d’équipe'), p(8, 'Julien Moreau', 'Production', 'Opérateur de ligne'),
  p(12, 'Karim Haddad', 'Maintenance', 'Responsable maintenance'), p(2, 'Mehdi Benali', 'Maintenance', 'Technicien de maintenance'),
  p(6, 'Thomas Garnier', 'Électricité', 'Électromécanicien'), p(23, 'Inès Roux', 'Qualité', 'Responsable qualité'),
  p(9, 'Nadia Kaci', 'Commercial', 'Responsable grands comptes'), p(20, 'Paul Seul', 'Orpheline'), p(30, 'Sans Équipe', null),
];
const BRUT = arbre(ENTITES, EQUIPES, ANNUAIRE, [], T, { rh: true });
const sansFiltre = { entite: null, site: null, recherche: '' };
const contexte = { equipes: EQUIPES, entites: ENTITES, sites: SITES, nom: (id: number) => ANNUAIRE.find(x => x.id === id)?.nom ?? '' };
const noms = (a: Parameters<typeof clesDepliables>[0]) => clesDepliables(a).filter(c => c.startsWith('q:')).map(c => c.slice(2));

test('service choisi : l’équipe et ses sous-équipes, ses équipes parentes gardées sans membres ; ni autre équipe ni salarié à affecter', () => {
  const v = filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, service: 'Maintenance' });
  assert.deepEqual(noms(v), ['Production', 'Maintenance', 'Électricité']);
  assert.deepEqual(v.entites.map(n => n.code), ['epc2i'], 'Lyon (Commercial) écartée');
  assert.deepEqual(v.entites[0].equipes[0].membres, [], 'Production : chemin seulement');
  assert.deepEqual(v.sansEntite, []);
  assert.deepEqual(v.aAffecter, []);
  assert.equal(v.effectif, 3);
  assert.equal(v.entites[0].effectif, 3);
  const racine = noeudService(v, 'Maintenance')!;
  assert.deepEqual(racine.membres.map(m => m.nom), ['Karim Haddad', 'Mehdi Benali']);
  assert.deepEqual(racine.equipes.map(q => q.nom), ['Électricité']);
  // CSV : le chemin et la société restent, seules les personnes du service sont listées.
  assert.deepEqual(lignesOrganigramme(v, contexte).map(l => [l.societe, l.chemin, l.nom]), [
    ['EPC2I', 'Production › Maintenance', 'Karim Haddad'], ['EPC2I', 'Production › Maintenance', 'Mehdi Benali'],
    ['EPC2I', 'Production › Maintenance › Électricité', 'Thomas Garnier'],
  ]);
  // Équipe sans entité choisie seule ; équipe sans sous-équipe.
  const orph = filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, service: 'Orpheline' });
  assert.deepEqual(orph.entites, []);
  assert.deepEqual(orph.sansEntite.map(q => q.nom), ['Orpheline']);
  assert.equal(orph.effectif, 1);
  assert.equal(filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, service: 'Électricité' }).effectif, 1);
});

test('service inconnu, vide ou absent de l’arbre : l’arbre entier, comme sans service', () => {
  assert.equal(restreindreAuService(BRUT, EQUIPES, 'Inconnue'), BRUT);
  assert.equal(restreindreAuService(BRUT, EQUIPES, null), BRUT);
  assert.equal(restreindreAuService(BRUT, EQUIPES, ''), BRUT);
  const v = filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, service: 'Inconnue' });
  assert.equal(v.effectif, BRUT.effectif);
  assert.equal(noeudService(BRUT, 'Inconnue'), null);
  assert.equal(noeudService(BRUT, null), null);
  assert.equal(noeudService(BRUT, 'Commercial')!.nom, 'Commercial', 'équipe d’un établissement');
});

test('service combiné à l’entité, au site et à la recherche : la recherche ne porte que sur le service', () => {
  // Entité : un service d'une autre entité ne laisse rien.
  assert.equal(filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, entite: 'lyon', service: 'Maintenance' }).effectif, 0);
  assert.equal(filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, entite: 'epc2i', service: 'Maintenance' }).effectif, 3);
  // Site : Maintenance et Électricité héritent de lab67 ; Production (PDE) n'est que le chemin.
  const site = filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, site: 'lab67', service: 'Maintenance' });
  assert.equal(site.effectif, 3);
  assert.equal(filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, site: 'pde', service: 'Maintenance' }).effectif, 0);
  // Recherche : Julien (Production) est hors du service, Thomas (Électricité) dedans.
  assert.equal(filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, recherche: 'julien', service: 'Maintenance' }).effectif, 0);
  const thomas = filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, recherche: 'thomas', service: 'Maintenance' });
  assert.deepEqual([...thomas.trouves], [6]);
  assert.ok(thomas.chemins.has(cleEquipe('Maintenance')) && thomas.chemins.has(cleEquipe('Électricité')));
  // Sans service, la même recherche trouve Julien.
  assert.deepEqual([...filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, recherche: 'julien' }).trouves], [8]);
});

test('services proposés : équipes de l’arbre avec leur chemin, triées par chemin ; limitées par l’entité', () => {
  assert.deepEqual(choixServices(BRUT, EQUIPES).map(x => x.libelle), [
    'Commercial', 'Orpheline', 'Production', 'Production › Maintenance', 'Production › Maintenance › Électricité', 'Qualité',
  ]);
  assert.deepEqual(choixServices(BRUT, EQUIPES).find(x => x.nom === 'Électricité')!.chemin, ['Production', 'Maintenance', 'Électricité']);
  const lyon = filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, entite: 'lyon' });
  assert.deepEqual(choixServices(lyon, EQUIPES).map(x => x.nom), ['Commercial'], 'aucune équipe hors de l’arbre affiché');
  assert.deepEqual(choixServices({ entites: [], sansEntite: [] }, EQUIPES), []);
});

test('fil d’Ariane : entité, puis équipes parentes (de la plus haute à la plus proche) ; rien pour une équipe racine sans entité', () => {
  assert.deepEqual(filAriane(EQUIPES, ENTITES, 'Électricité'), [
    { libelle: 'EPC2I', service: null }, { libelle: 'Production', service: 'Production' }, { libelle: 'Maintenance', service: 'Maintenance' },
  ]);
  assert.deepEqual(filAriane(EQUIPES, ENTITES, 'Commercial'), [{ libelle: 'Lyon', service: null }]);
  assert.deepEqual(filAriane(EQUIPES, ENTITES, 'Orpheline'), []);
});

test('adresse : service (équipe du référentiel reçu) et présentation ; valeur inconnue ramenée à la valeur par défaut', () => {
  assert.deepEqual(PARAMS_URL.organigramme!.map(x => x.nom), ['entite', 'site', 'service', 'vue']);
  const data = { referentiels: { entites: ENTITES, sites: SITES, equipes: EQUIPES } } as never;
  assert.deepEqual(lireUrl('organigramme', '?service=Maintenance&vue=graphique', data), { orgEntite: null, orgSite: null, orgService: 'Maintenance', orgVue: 'graphique' });
  assert.deepEqual(lireUrl('organigramme', '?service=%C3%89lectricit%C3%A9', data), { orgEntite: null, orgSite: null, orgService: 'Électricité', orgVue: 'liste' });
  assert.deepEqual(lireUrl('organigramme', '?service=Inconnue&vue=arbre', data), { orgEntite: null, orgSite: null, orgService: null, orgVue: 'liste' });
  // Hors du périmètre : une équipe absente du référentiel reçu est refusée.
  const reduit = { referentiels: { entites: ENTITES, sites: SITES, equipes: EQUIPES.filter(q => q.nom !== 'Qualité') } } as never;
  assert.equal(lireUrl('organigramme', '?service=Qualit%C3%A9', reduit).orgService, null);
  const ui = { orgEntite: 'epc2i', orgSite: null, orgService: 'Électricité', orgVue: 'graphique' } as never;
  assert.equal(adresse('organigramme', ui), '/organigramme?entite=epc2i&service=%C3%89lectricit%C3%A9&vue=graphique');
  assert.equal(adresse('organigramme', { orgEntite: null, orgSite: null, orgService: null, orgVue: 'liste' } as never), '/organigramme');
});

test('vue graphique : « N personnes » au-delà du seuil dans « Tout déplier » ; impression verticale (service seul, ou une page par entité)', () => {
  const nombreux = Array.from({ length: SEUIL_MEMBRES + 1 }, (_, i) => p(100 + i, `Opérateur ${i + 1}`, 'Qualité'));
  const grand = arbre(ENTITES, EQUIPES, [...ANNUAIRE, ...nombreux], [], T);
  assert.ok(clesDepliablesGraphique(grand).includes(cleMembres('Qualité')));
  assert.ok(!clesDepliablesGraphique(grand).includes(cleMembres('Production')), 'Production : deux membres, liste directe');
  assert.ok(!clesDepliables(grand).includes(cleMembres('Qualité')), 'la liste n’a pas ce nœud');

  const service = sectionsImpressionGraphique(BRUT, contexte, 'Maintenance');
  assert.equal(service.length, 1);
  assert.equal(service[0].titre, 'Service Production › Maintenance');
  assert.equal(service[0].sousTitre, 'Rattachement : EPC2I › Production');
  assert.equal(service[0].arbre[0].libelle, 'Maintenance');
  assert.deepEqual(service[0].arbre[0].enfants!.map(n => [n.libelle, !!n.groupe]), [['Karim Haddad', false], ['Mehdi Benali', false], ['Électricité', true]]);
  assert.equal(service[0].echelle, 100);
  const pages = sectionsImpressionGraphique(BRUT, contexte);
  assert.deepEqual(pages.map(s => s.titre), ['EPC2I', 'Lyon (EPC2I)', 'Équipes sans entité', 'À affecter']);
  assert.equal(pages[0].arbre[0].libelle, 'EPC2I', 'boîte de l’entité en haut');
  assert.deepEqual(pages[0].arbre[0].enfants!.map(n => n.libelle), ['Production', 'Qualité']);
  assert.deepEqual(pages[3].arbre[0].enfants!.map(n => n.libelle), ['Sans Équipe']);
  assert.equal(sectionsImpressionGraphique(BRUT, contexte, 'Inconnue').length, 4, 'service inconnu : toutes les pages');
});

test('échelle de l’arbre imprimé : 100 % s’il tient dans la page, réduite par dizaines sinon, jamais sous le minimum', () => {
  const boite = (n: number): PrintArbre => ({ libelle: 'Racine', groupe: true, enfants: Array.from({ length: n }, (_, i) => ({ libelle: `É${i}`, groupe: true, enfants: [{ libelle: 'Personne' }] })) });
  assert.equal(boitesEnLargeur([boite(0)]), 1);
  assert.equal(boitesEnLargeur([boite(7)]), 7);
  assert.equal(boitesEnLargeur([boite(3), boite(2)]), 5);
  assert.equal(echelleImpression([boite(5)]), 100);
  assert.equal(echelleImpression([boite(6)]), 90);
  assert.equal(echelleImpression([boite(8)]), 70);
  assert.equal(echelleImpression([boite(40)]), ECHELLE_MIN);
});
