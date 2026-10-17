// Guide d'utilisation (t155) : page Aide (shared/aide.ts, client/src/pages/Aide.tsx) et docs/GUIDE-UTILISATEUR.md tenus
// ensemble. Mêmes parties des deux côtés ; chaque libellé cité entre « » existe à l'écran (un bouton renommé fait échouer
// le test au lieu de laisser un guide périmé) ; procédure mensuelle de paie et mentions « à compléter » présentes ; vue
// commune ouverte dans tous les espaces et sans connexion, partie de l'espace ouvert affichée d'abord.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { A_COMPLETER_PAIE, GUIDE_AIDE, libellesCites, partieParDefaut } = await import('../shared/aide.ts');
const await_constants = await import('../shared/constants.ts');
const { ALLOWED_VIEWS, VUES_COMMUNES } = await_constants;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GUIDE = readFileSync(join(ROOT, 'docs/GUIDE-UTILISATEUR.md'), 'utf8');

/** Textes de l'interface : client/src et shared, sans le guide lui-même (un libellé ne se justifie pas par sa citation). */
function sourcesEcran(): string {
  const exclus = new Set([join(ROOT, 'shared/aide.ts'), join(ROOT, 'client/src/pages/Aide.tsx')]);
  const lire = (dir: string): string[] => readdirSync(dir).flatMap(nom => {
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) return lire(p);
    return /\.(ts|tsx)$/.test(nom) && !exclus.has(p) ? [readFileSync(p, 'utf8')] : [];
  });
  return [...lire(join(ROOT, 'client/src')), ...lire(join(ROOT, 'shared'))].join('\n');
}
/** Comparaison sans casse, apostrophe droite des docs égale à l'apostrophe typographique de l'interface. */
const norme = (t: string) => t.toLowerCase().replace(/'/g, '’');
const ECRAN = norme(sourcesEcran());

const textesAide = GUIDE_AIDE.flatMap(p => [p.pour, ...p.rubriques.flatMap(r => [r.intro ?? '', ...(r.etapes ?? []), ...(r.points ?? [])])]);

test('six parties : collaborateur, manager, service RH, paie, groupe pilote, à faire avant la mise en service', () => {
  assert.deepEqual(GUIDE_AIDE.map(p => p.id), ['collaborateur', 'manager', 'rh', 'paie', 'pilote', 'entreprise']);
  for (const p of GUIDE_AIDE) {
    assert.ok(p.rubriques.length > 0, p.id);
    for (const r of p.rubriques) assert.ok((r.etapes?.length ?? 0) + (r.points?.length ?? 0) > 0, `${p.id} · ${r.titre}`);
  }
});

test('docs/GUIDE-UTILISATEUR.md reprend chaque partie de la page Aide sous le même titre', () => {
  const titres = [...GUIDE.matchAll(/^## (.+)$/gm)].map(m => m[1].trim());
  assert.deepEqual(titres, GUIDE_AIDE.map(p => p.titre));
});

test('chaque libellé cité entre « » existe à l’écran (page Aide et guide)', () => {
  const cites = [...new Set([...textesAide.flatMap(libellesCites), ...libellesCites(GUIDE)])];
  assert.ok(cites.length > 60, `libellés cités : ${cites.length}`);
  const absents = cites.filter(l => !ECRAN.includes(norme(l)));
  assert.deepEqual(absents, [], 'libellé absent de l’interface : guide à mettre à jour');
});

test('procédure mensuelle de paie : les cinq gestes dans l’ordre, des deux côtés', () => {
  const gestes = ['Générer le fichier', 'Fichier', 'Modifier le format', 'Confirmer l’import', 'Annuler'];
  const procedure = GUIDE_AIDE.find(p => p.id === 'paie')!.rubriques.find(r => r.titre === 'Procédure mensuelle')!;
  const etapes = procedure.etapes!.join('\n');
  let pos = -1;
  for (const g of gestes.slice(0, 4)) {
    const i = etapes.indexOf(`« ${g} »`);
    assert.ok(i > pos, `page Aide : ${g}`);
    pos = i;
  }
  const md = norme(GUIDE.slice(GUIDE.indexOf('### Procédure mensuelle'), GUIDE.indexOf('### Calendrier du mois')));
  pos = -1;
  for (const g of gestes) {
    const i = md.indexOf(norme(`« ${g} »`), pos + 1);
    assert.ok(i > pos, `guide : ${g}`);
    pos = i;
  }
});

test('calendrier de paie inconnu : réglages par défaut rappelés, dates « à compléter par le gestionnaire de paie »', () => {
  const paie = textesAide.join('\n');
  assert.ok(paie.includes(A_COMPLETER_PAIE));
  assert.match(paie, /dernier jour du mois par défaut \(Paramètres → Paie\)/);
  assert.match(paie, /correction dans Sage en attendant le lot correctif/);
  assert.ok(GUIDE.split(A_COMPLETER_PAIE).length - 1 >= 4, 'calendrier et correction après import à compléter');
  assert.match(GUIDE, /le lundi suivant à 12 h/);
  assert.match(GUIDE, /\| Clôture des variables \| le dernier jour du mois \| Paramètres → Paie \|/);
});

test('groupe pilote : service RH, puis une équipe en horaires de journée, puis tout le site', () => {
  const pilote = GUIDE_AIDE.find(p => p.id === 'pilote')!;
  const etapes = pilote.rubriques[0].etapes!;
  assert.match(etapes[0], /^Service RH/);
  assert.match(etapes[1], /horaires de journée/);
  assert.match(etapes[2], /^Tout le site/);
  assert.match(GUIDE, /le service RH d'abord, puis une équipe pilote en horaires\s+de journée, puis tout le site/);
});

test('groupe pilote : comptes ouverts par un fichier réduit à l’équipe, libellé exact de la case, fiches modifiées signalées', () => {
  // L'import écrit toutes les lignes du fichier et ne crée que des comptes Microsoft 365 (salariés avec une adresse) :
  // l'export complet ouvrirait tout le site, et une fiche corrigée dans Cursus reprendrait les valeurs de Lucca.
  const CASE = '« Créer les comptes Microsoft 365 à partir des adresses e-mail »';
  const ecran = readFileSync(join(ROOT, 'client/src/pages/MiseEnService.tsx'), 'utf8');
  assert.ok(ecran.includes(CASE.slice(2, -2)), 'libellé de la case changé : guide à mettre à jour');
  const etape = GUIDE_AIDE.find(p => p.id === 'pilote')!.rubriques[0].etapes![1];
  const md = GUIDE.slice(GUIDE.indexOf('2. **Équipe pilote'), GUIDE.indexOf('3. **Tout le site'));
  for (const [nom, t] of [['page Aide', etape], ['guide', md.replace(/\s+/g, ' ')]] as const) {
    assert.ok(t.includes(CASE), `${nom} : libellé complet de la case`);
    assert.match(t, /réduit (à|aux lignes de) l[’']équipe pilote/, `${nom} : fichier réduit à l'équipe pilote`);
    assert.match(t, /Comptes et accès/, `${nom} : comptes Cursus un par un`);
    assert.match(t, /mise à jour/, `${nom} : lignes « mise à jour » de l'aperçu à relire`);
    assert.doesNotMatch(t, /sans rien changer aux fiches/, nom);
  }
});

test('partie paie : ni relance ni Paramètres attribués au profil paie (droits de PROFILS_RH et de la matrice)', () => {
  const { PROFILS_RH } = await_constants;
  assert.ok(!(PROFILS_RH.paie.vues as readonly string[]).includes('parametres'));
  const paie = GUIDE_AIDE.find(p => p.id === 'paie')!;
  const items = paie.rubriques.flatMap(r => [r.intro ?? '', ...(r.etapes ?? []), ...(r.points ?? [])]);
  // Chaque renvoi aux Paramètres nomme l'administrateur RH, ou l'intro le dit pour toute la partie.
  assert.match(paie.rubriques[0].intro!, /Paramètres : les réglages cités ici sont faits par l’administrateur RH/);
  for (const t of items.filter(t => t.includes('Paramètres →'))) assert.match(t, /administrateur RH/, t);
  assert.ok(!items.some(t => /\brelancez\b/i.test(t)), 'le profil paie ne relance pas (temps.relancer)');
  assert.match(paie.rubriques[0].intro!, /^Écran « Feuilles de temps »/);
  const md = GUIDE.slice(GUIDE.indexOf('## Gestionnaire de paie'), GUIDE.indexOf('### Procédure mensuelle'));
  assert.match(md.replace(/\s+/g, ' '), /Il n'a pas accès aux Paramètres et ne relance ni ne valide les feuilles/);
});

test('semaine à 7 jours décrite : samedi et dimanche saisissables, comptés dans les heures supplémentaires', () => {
  assert.match(textesAide.join('\n'), /Samedi et dimanche sont grisés et repliés/);
  assert.match(GUIDE, /prennent leur rang dans les heures supplémentaires/);
  assert.doesNotMatch(GUIDE, /recalcul\w* dans Sage/, 'semaine à 7 jours livrée (t047) : plus de recalcul dans Sage');
});

test('vue commune « aide » : dans tous les espaces et sans connexion, partie de l’espace ouvert d’abord', () => {
  assert.ok((VUES_COMMUNES as readonly string[]).includes('aide'));
  for (const vues of Object.values(ALLOWED_VIEWS)) assert.ok(!(vues as readonly string[]).includes('aide'));
  assert.equal(partieParDefaut(null), 'collaborateur');
  assert.equal(partieParDefaut('collaborateur'), 'collaborateur');
  assert.equal(partieParDefaut('manager'), 'manager');
  assert.equal(partieParDefaut('rh', 'rh_admin'), 'rh');
  assert.equal(partieParDefaut('rh', 'referent_hse'), 'rh');
  assert.equal(partieParDefaut('rh', 'paie'), 'paie');
  // Lien sous le menu de chaque espace et sur l'écran de connexion ; page servie avant la connexion.
  const shell = readFileSync(join(ROOT, 'client/src/layout/Shell.tsx'), 'utf8');
  const login = readFileSync(join(ROOT, 'client/src/pages/Login.tsx'), 'utf8');
  const app = readFileSync(join(ROOT, 'client/src/App.tsx'), 'utf8');
  assert.match(shell, /go\('aide'\)/);
  assert.match(login, /go\('aide'\)/);
  assert.match(app, /view === 'aide'/);
});

test('libellesCites : texte entre guillemets français, espaces retirés, vides ignorés', () => {
  assert.deepEqual(libellesCites('« Valider » puis «Renvoyer» ; « »'), ['Valider', 'Renvoyer']);
});
