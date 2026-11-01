// Organigramme à l'écran (lot 11, chantier C1, étape 2 ; client/src/organigramme-vue.ts, client/src/listes-csv.ts) :
// filtres d'entité et de site, recherche, dépliage, lignes du CSV et sections imprimées, par valeurs. Le CSV ne porte que
// l'annuaire et la structure, jamais d'étiquette de contrat, même pour le service RH ; une entité par page imprimée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arbre, type PersonneArbre } from '../shared/rules/organigramme.ts';
import type { Entite, Equipe, Site } from '../shared/types.ts';
import {
  cleEntite, cleEquipe, clesDepliables, depliageInitial, ENTETE_CSV_ORGANIGRAMME, filtrerArbre, formaterSiren, libelleSite, lignesOrganigramme, mentionEtat,
  sectionsImpression, siteEffectif,
} from '../client/src/organigramme-vue.ts';
import { csvOrganigramme } from '../client/src/listes-csv.ts';
const { ALLOWED_VIEWS, PROFILS_RH, vuesDe } = await import('../shared/constants.ts');
const { PARAMS_URL, lireUrl, adresse } = await import('../client/src/state/url.ts');

const T = '2026-10-10';
const entite = (code: string, o: Partial<Entite> = {}): Entite => ({
  code, nom: code.toUpperCase(), type: 'societe', parente: null, siren: null, siret: null, idcc: null, siteCode: null, ordre: 0, actif: true, fermeLe: null, source: 'local', ...o,
});
const equipe = (nom: string, managerId: number | null, o: Partial<Equipe> = {}): Equipe => ({ nom, managerId, ordre: 0, ...o });
const p = (id: number, nom: string, eq: string | null, poste = `Poste ${id}`): PersonneArbre => ({ id, nom, equipe: eq, poste });

const ENTITES: Entite[] = [
  entite('epc2i', { nom: 'EPC2I', siren: '552100554', ordre: 0, siteCode: 'pde' }),
  entite('lyon', { nom: 'Lyon', type: 'etablissement', parente: 'epc2i', siret: '55210055400013', ordre: 1 }),
];
const SITES: Site[] = [{ code: 'pde', libelle: 'PDE', actif: true, ordre: 0 }, { code: 'lab67', libelle: 'Laboratoire 67', actif: true, ordre: 1 }];
const EQUIPES: Equipe[] = [
  equipe('Production', 3, { entite: 'epc2i', ordre: 0 }),
  equipe('Maintenance', 12, { parente: 'Production', ordre: 1, siteCode: 'lab67', uniteCode: 'PRD-MAINT' }),
  equipe('Commercial', 9, { entite: 'lyon', ordre: 2 }),
  equipe('Orpheline', null, { ordre: 3 }),
];
const ANNUAIRE: PersonneArbre[] = [
  p(3, 'Sophie Lemaire', 'Production', 'Cheffe d’équipe'), p(8, 'Julien Moreau', 'Production', 'Opérateur de ligne'),
  p(12, 'Karim Haddad', 'Maintenance', 'Responsable maintenance'), p(2, 'Mehdi Benali', 'Maintenance', 'Technicien de maintenance'),
  p(9, 'Nadia Kaci', 'Commercial', 'Responsable grands comptes'), p(20, 'Paul Seul', 'Orpheline'), p(30, 'Sans Équipe', null),
];
const BRUT = arbre(ENTITES, EQUIPES, ANNUAIRE, [], T, { rh: true, etiquettes: new Map([[2, 'Intérim']]) });
const sansFiltre = { entite: null, site: null, recherche: '' };
const nomsEquipes = (a: { entites: { equipes: { nom: string; equipes: unknown[] }[]; etablissements: unknown[] }[] }): string[] => {
  const out: string[] = [];
  const eq = (q: { nom: string; equipes: unknown[] }) => { out.push(q.nom); (q.equipes as { nom: string; equipes: unknown[] }[]).forEach(eq); };
  const en = (n: { equipes: { nom: string; equipes: unknown[] }[]; etablissements: unknown[] }) => { n.equipes.forEach(eq); (n.etablissements as typeof n[]).forEach(en); };
  a.entites.forEach(en);
  return out;
};

test('site effectif : celui de l’équipe, d’une équipe au-dessus, sinon de l’entité ; libellé du cache', () => {
  assert.equal(siteEffectif(EQUIPES, ENTITES, 'Maintenance'), 'lab67');
  assert.equal(siteEffectif(EQUIPES, ENTITES, 'Production'), 'pde', 'site de l’entité');
  assert.equal(siteEffectif(EQUIPES, ENTITES, 'Commercial'), null, 'établissement sans site');
  assert.equal(libelleSite(SITES, 'lab67'), 'Laboratoire 67');
  assert.equal(libelleSite(SITES, 'inconnu'), 'inconnu');
  assert.equal(libelleSite(SITES, null), '');
  assert.equal(formaterSiren('552100554'), '552 100 554');
  assert.equal(formaterSiren('55210055400013'), '552 100 554 00013');
  assert.equal(formaterSiren(null), '');
});

test('sans filtre : l’arbre tel quel ; dépliage de départ (entités et équipes racines) et « tout déplier »', () => {
  const v = filtrerArbre(BRUT, EQUIPES, ENTITES, sansFiltre);
  assert.equal(v.entites, BRUT.entites);
  assert.equal(v.chemins.size, 0);
  assert.deepEqual(depliageInitial(BRUT), [cleEntite('epc2i'), cleEquipe('Production'), cleEntite('lyon'), cleEquipe('Commercial'), cleEquipe('Orpheline')]);
  assert.deepEqual(clesDepliables(BRUT), [cleEntite('epc2i'), cleEquipe('Production'), cleEquipe('Maintenance'), cleEntite('lyon'), cleEquipe('Commercial'), cleEquipe('Orpheline')]);
});

test('filtre d’entité : société avec ses établissements, ou l’établissement seul ; ni équipes sans entité ni salariés à affecter', () => {
  const societe = filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, entite: 'epc2i' });
  assert.deepEqual(nomsEquipes(societe), ['Production', 'Maintenance', 'Commercial']);
  assert.deepEqual(societe.sansEntite, []);
  assert.deepEqual(societe.aAffecter, []);
  assert.equal(societe.effectif, 5);
  const etab = filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, entite: 'lyon' });
  assert.deepEqual(etab.entites.map(n => n.code), ['lyon']);
  assert.deepEqual(nomsEquipes(etab), ['Commercial']);
  assert.equal(etab.effectif, 1);
  assert.equal(filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, entite: 'inconnue' }).effectif, 0);
});

test('filtre de site : l’équipe au-dessus d’une équipe du site reste, sans ses membres ; effectifs recomptés', () => {
  const v = filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, site: 'lab67' });
  assert.deepEqual(nomsEquipes(v), ['Production', 'Maintenance']);
  const production = v.entites[0].equipes[0];
  assert.deepEqual(production.membres, [], 'Production (site PDE) : membres retirés');
  assert.deepEqual(production.equipes[0].membres.map(m => m.nom), ['Karim Haddad', 'Mehdi Benali']);
  assert.equal(production.effectif, 2);
  assert.equal(v.effectif, 2);
  const pde = filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, site: 'pde' });
  assert.deepEqual(nomsEquipes(pde), ['Production'], 'Commercial (Lyon, sans site) écartée');
  assert.equal(pde.effectif, 2);
});

test('recherche : nom ou poste (accents et casse ignorés) ou nom d’équipe ; chemins dépliés, résultats surlignés', () => {
  const v = filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, recherche: 'mehdi' });
  assert.deepEqual([...v.trouves], [2]);
  assert.deepEqual(nomsEquipes(v), ['Production', 'Maintenance']);
  assert.deepEqual(v.entites[0].equipes[0].membres, []);
  assert.deepEqual([...v.chemins].sort(), [cleEntite('epc2i'), cleEquipe('Maintenance'), cleEquipe('Production')].sort());
  const poste = filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, recherche: 'OPERATEUR' });
  assert.deepEqual([...poste.trouves], [8]);
  // Équipe trouvée : tous ses membres, surlignés seulement s'ils correspondent eux-mêmes.
  const eq = filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, recherche: 'commerc' });
  assert.deepEqual([...eq.equipesTrouvees], ['Commercial']);
  assert.deepEqual(nomsEquipes(eq), ['Commercial']);
  assert.equal(eq.effectif, 1);
  assert.deepEqual([...eq.trouves], []);
  // Salariés à affecter (service RH) et équipes sans entité cherchés aussi.
  const seul = filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, recherche: 'sans équipe' });
  assert.deepEqual(seul.aAffecter.map(m => m.id), [30]);
  assert.deepEqual([...seul.trouves], [30]);
  const orph = filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, recherche: 'paul' });
  assert.deepEqual(orph.sansEntite.map(q => q.nom), ['Orpheline']);
  assert.ok(orph.chemins.has(cleEquipe('Orpheline')));
  assert.equal(filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, recherche: 'personne' }).effectif, 0);
  // Recherche et site ensemble : Julien (Production, PDE) n'est pas du site lab67.
  assert.equal(filtrerArbre(BRUT, EQUIPES, ENTITES, { entite: null, site: 'lab67', recherche: 'julien' }).effectif, 0);
});

test('CSV : une ligne par personne affichée, colonnes de l’annuaire et structure, jamais d’étiquette de contrat', () => {
  const noms = (id: number) => ANNUAIRE.find(x => x.id === id)?.nom ?? `n° ${id}`;
  const lignes = lignesOrganigramme(BRUT, { equipes: EQUIPES, entites: ENTITES, sites: SITES, nom: noms });
  const x = csvOrganigramme(T, lignes, null);
  assert.equal(x.fichier, 'organigramme-2026-10-10.csv');
  assert.deepEqual(x.head, ENTETE_CSV_ORGANIGRAMME);
  assert.deepEqual(x.rows, [
    ['EPC2I', '', 'PDE', 'Production', 'Production', 'Sophie Lemaire', 'Cheffe d’équipe', 'Sophie Lemaire', 'Service RH'],
    ['EPC2I', '', 'PDE', 'Production', 'Production', 'Julien Moreau', 'Opérateur de ligne', 'Sophie Lemaire', 'Sophie Lemaire'],
    ['EPC2I', '', 'Laboratoire 67', 'Production › Maintenance', 'Maintenance', 'Karim Haddad', 'Responsable maintenance', 'Karim Haddad', 'Sophie Lemaire'],
    ['EPC2I', '', 'Laboratoire 67', 'Production › Maintenance', 'Maintenance', 'Mehdi Benali', 'Technicien de maintenance', 'Karim Haddad', 'Karim Haddad'],
    ['EPC2I', 'Lyon', '', 'Commercial', 'Commercial', 'Nadia Kaci', 'Responsable grands comptes', 'Nadia Kaci', 'Service RH'],
    ['', '', '', 'Orpheline', 'Orpheline', 'Paul Seul', 'Poste 20', '', 'Service RH'],
    ['', '', '', '', 'À affecter', 'Sans Équipe', 'Poste 30', '', 'Service RH'],
  ]);
  assert.ok(!x.rows.flat().some(c => String(c).includes('Intérim')), 'étiquette du service RH absente du fichier');
  // Filtre sur un établissement seul : la société parente reste dans la colonne « Société » (registre, OPCO, DSN par SIRET).
  const etab = filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, entite: 'lyon' });
  assert.deepEqual(lignesOrganigramme(etab, { equipes: EQUIPES, entites: ENTITES, sites: SITES, nom: noms }).map(l => [l.societe, l.etablissement, l.nom]),
    [['EPC2I', 'Lyon', 'Nadia Kaci']]);
  assert.equal(csvOrganigramme(T, [], 'lyon').fichier, 'organigramme-lyon-2026-10-10.csv');
});

test('impression : une section par entité (société, puis chaque établissement), arbre imbriqué, mention de l’état', () => {
  const noms = (id: number) => ANNUAIRE.find(x => x.id === id)?.nom ?? '';
  const s = sectionsImpression(BRUT, { equipes: EQUIPES, entites: ENTITES, sites: SITES, nom: noms });
  assert.deepEqual(s.map(x => x.titre), ['EPC2I', 'Lyon (EPC2I)', 'Équipes sans entité', 'À affecter']);
  assert.match(s[0].sousTitre, /^Société · 5 pers\.$/);
  assert.match(s[1].sousTitre, /SIRET 552 100 554 00013/);
  const production = s[0].arbre[0];
  assert.equal(production.libelle, 'Production');
  assert.match(production.detail!, /manager : Sophie Lemaire · PDE · 4 pers\./);
  assert.deepEqual(production.enfants!.map(n => n.libelle), ['Sophie Lemaire', 'Julien Moreau', 'Maintenance']);
  assert.equal(production.enfants![0].detail, 'Cheffe d’équipe · manager');
  assert.ok(!JSON.stringify(s).includes('Intérim'), 'aucune étiquette de contrat imprimée');
  // Société sans équipe propre mais avec un établissement : pas de page vide.
  const seul = arbre([entite('epc2i', { nom: 'EPC2I' }), ENTITES[1]], [equipe('Commercial', 9, { entite: 'lyon' })], ANNUAIRE, [], T);
  assert.deepEqual(sectionsImpression(seul, { equipes: [], entites: ENTITES, sites: SITES, nom: noms }).map(x => x.titre), ['Lyon (EPC2I)']);
  // Filtre sur un établissement seul : le titre garde la société parente.
  const etab = filtrerArbre(BRUT, EQUIPES, ENTITES, { ...sansFiltre, entite: 'lyon' });
  assert.deepEqual(sectionsImpression(etab, { equipes: EQUIPES, entites: ENTITES, sites: SITES, nom: noms }).map(x => x.titre), ['Lyon (EPC2I)']);
  // Société ouverte sans équipe ni établissement (créée dans Référentiels → Entités et sites) : pas de page blanche.
  const vide = arbre([...ENTITES, entite('filiale', { nom: 'Filiale vide', ordre: 2 })], EQUIPES, ANNUAIRE, [], T, { rh: true });
  assert.ok(vide.entites.some(n => n.code === 'filiale'), 'l’entité ouverte vide reste dans l’arbre');
  assert.deepEqual(sectionsImpression(vide, { equipes: EQUIPES, entites: ENTITES, sites: SITES, nom: noms }).map(x => x.titre),
    ['EPC2I', 'Lyon (EPC2I)', 'Équipes sans entité', 'À affecter']);
  assert.equal(mentionEtat(T), 'Document interne — état au 10/10/2026');
});

test('vue « organigramme » : trois espaces et profils restreints (sauf Comptabilité) ; entité et site dans l’adresse', () => {
  for (const vues of Object.values(ALLOWED_VIEWS)) assert.ok((vues as readonly string[]).includes('organigramme'));
  for (const profil of ['referent_hse', 'paie', 'lecture_seule'] as const) assert.ok(vuesDe('rh', profil).includes('organigramme'), profil);
  assert.ok(!(PROFILS_RH.comptabilite.vues as readonly string[]).includes('organigramme'), 'Comptabilité : frais seulement');
  // lot 12 — C7 (organigramme) : service et présentation s'ajoutent à l'entité et au site (tests/organigramme-service.test.ts).
  assert.deepEqual(PARAMS_URL.organigramme!.map(x => x.nom), ['entite', 'site', 'service', 'vue']);
  const data = { referentiels: { entites: ENTITES, sites: SITES, equipes: EQUIPES } } as never;
  assert.deepEqual(lireUrl('organigramme', '?entite=lyon&site=lab67', data), { orgEntite: 'lyon', orgSite: 'lab67', orgService: null, orgVue: 'liste' });
  assert.deepEqual(lireUrl('organigramme', '?entite=inconnue&site=x', data), { orgEntite: null, orgSite: null, orgService: null, orgVue: 'liste' });
  assert.deepEqual(lireUrl('referentiels', '?onglet=entites', data), { refOnglet: 'entites' });
  assert.match(adresse('organigramme', { orgEntite: 'lyon', orgSite: null } as never), /^\/organigramme\?entite=lyon$/);
});

test('journal : familles sans doublon ; entités, sites et organigramme dans « Fiches et équipes »', async () => {
  const { FAMILLES_JOURNAL } = await import('../shared/journal.ts');
  const ids = FAMILLES_JOURNAL.map(f => f.id);
  assert.equal(new Set(ids).size, ids.length, `famille en double : ${ids.filter((x, i) => ids.indexOf(x) !== i).join(', ')}`);
  const fiches = FAMILLES_JOURNAL.find(f => f.id === 'fiches')!;
  for (const p of ['entite.', 'site.', 'organigramme.']) assert.ok(fiches.prefixes.includes(p), p);
  assert.ok(FAMILLES_JOURNAL.find(f => f.id === 'formations')!.prefixes.includes('opco.'));
});
