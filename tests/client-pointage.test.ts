// Badgeage virtuel côté interface (lot 12, chantier C6, étape 2), sans navigateur :
// - affichage des durées et du débit-crédit, mode du salarié (module inactif, population), file des corrections à valider
//   (jamais les siennes, périmètre « feuilles »), objet d'une demande sans commentaire (components/temps/pointage-etat.ts) ;
// - pointage gardé hors ligne avec l'heure de l'appareil, jamais une position, libellé de la file (pwa/saisie-hors-ligne.ts) ;
// - confirmations du refus (motif obligatoire) et du retrait d'une demande (state/confirmations-pointage.ts) ;
// - écran Pointages ouvert dans les trois espaces, jamais aux profils restreints ; raccourci de l'application installée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CorrectionPointage, Dataset } from '../shared/types.ts';

const { correctionsAValider, fMinutes, fSolde, modeDe, objetCorrection, pointe, valideurPointages } = await import('../client/src/components/temps/pointage-etat.ts');
const { libelleSaisie, versFile } = await import('../client/src/pwa/saisie-hors-ligne.ts');
const { refusCorrectionPointage, retraitCorrectionPointage } = await import('../client/src/state/confirmations-pointage.ts');
const { Domain } = await import('../shared/domain.ts');
const { ALLOWED_VIEWS, PROFILS_RH } = await import('../shared/constants.ts');
const { instantParis } = await import('../shared/rules/pointage.ts');

const correction = (x: Partial<CorrectionPointage>): CorrectionPointage => ({
  id: 1, empId: 2, jour: '2026-10-07', nature: 'ajout', horodatage: new Date(instantParis('2026-10-07', 480)).toISOString(), sens: 'E', pointageId: null, motif: 'oubli',
  commentaire: 'Téléphone déchargé', statut: 'demandee', demandeLe: '2026-10-07T09:00:00.000Z', demandePar: 'Mehdi Benali', demandeParInteresse: true,
  decideLe: null, decidePar: null, motifRefus: null, pointageCreeId: null, ...x,
});

/** Instantané réduit : Mehdi (2, Maintenance, manager 12), Karim (12, manager), Hugo (16, Logistique), une forfait jours (5). */
function donnees(actif = true): Dataset {
  return {
    today: '2026-10-10', user: { empId: 12 },
    settings: { pointageActif: actif, pointageInterim: false, pointagePopulations: [{ critere: 'equipe', valeur: 'Maintenance', mode: 'controle', effet: '2026-10-01' }] },
    employes: [
      { id: 2, nom: 'Mehdi Benali', equipe: 'Maintenance', temps: '35h', typeContrat: 'cdi', entree: '2020-01-01', fin: null },
      { id: 5, nom: 'Claire Dumas', equipe: 'Maintenance', temps: 'forfait_jours', typeContrat: 'cdi', entree: '2020-01-01', fin: null },
      { id: 12, nom: 'Karim Haddad', equipe: 'Direction', temps: '35h', typeContrat: 'cdi', entree: '2020-01-01', fin: null },
      { id: 16, nom: 'Hugo Lambert', equipe: 'Logistique', temps: '35h', typeContrat: 'cdi', entree: '2020-01-01', fin: null },
    ],
    referentiels: { equipes: [{ nom: 'Maintenance', managerId: 12 }, { nom: 'Direction', managerId: null }, { nom: 'Logistique', managerId: 99 }], entites: [] },
    correctionsPointage: [correction({}), correction({ id: 2, empId: 16 }), correction({ id: 3, statut: 'validee' }), correction({ id: 4, empId: 12 })],
    delegues: [], delegations: [], absences: [], feuilles: [],
  } as unknown as Dataset;
}

test('durées et soldes : heures et minutes, signe du solde', () => {
  assert.deepEqual([fMinutes(0), fMinutes(45), fMinutes(60), fMinutes(450), fMinutes(-75)], ['0 h', '45 min', '1 h', '7 h 30', '− 1 h 15']);
  assert.deepEqual([fSolde(75), fSolde(-30), fSolde(0)], ['+ 1 h 15', '− 30 min', '0 h']);
});

test('mode du salarié : module inactif ou hors population, déclaratif ; forfait jours jamais badgé ; date d’effet', () => {
  const d = donnees();
  assert.equal(modeDe(d, 2), 'controle');
  assert.equal(pointe(d, 2), true);
  assert.equal(pointe(d, 2, '2026-09-30'), false, 'avant la date d’effet');
  assert.equal(pointe(d, 5), false, 'forfait jours');
  assert.equal(pointe(d, 16), false, 'hors population');
  assert.equal(pointe(d, null), false);
  assert.equal(pointe(donnees(false), 2), false, 'module désactivé');
});

test('corrections à valider : périmètre « feuilles » du manager, service RH sans les siennes, jamais une demande traitée', () => {
  const d = new Domain(donnees());
  assert.deepEqual(correctionsAValider(d, { rh: false, manager: true, me: 12, soi: 12 }).map(c => c.id), [1], 'Mehdi seulement : ni Hugo, ni la sienne');
  assert.deepEqual(correctionsAValider(d, { rh: true, manager: false, me: null, soi: 12 }).map(c => c.id), [1, 2], 'service RH : toutes, sauf la sienne');
  assert.deepEqual(correctionsAValider(d, { rh: false, manager: false, me: 2, soi: 2 }), [], 'collaborateur : rien à valider');
  assert.equal(valideurPointages(d, 2, { rh: false, manager: true, me: 2, soi: 2 }), false, 'jamais pour soi');
});

test('objet d’une demande et confirmations : heure de Paris, sans commentaire ; refus avec motif obligatoire', () => {
  const c = correction({});
  assert.equal(objetCorrection(c), 'Arrivée à 08:00 à ajouter, le 7 oct. 2026');
  assert.equal(objetCorrection(correction({ nature: 'neutralisation', horodatage: null, sens: null, pointageId: 9 })), 'Pointage erroné à retirer, le 7 oct. 2026');
  const r = refusCorrectionPointage(c, 'Mehdi Benali');
  assert.equal(r.action, 'pointage.refuserCorrection');
  assert.deepEqual(r.payload, { id: 1 });
  assert.equal(r.motif?.requis, true);
  assert.ok(!JSON.stringify(r).includes('Téléphone déchargé'), 'jamais le commentaire');
  assert.equal(retraitCorrectionPointage(c, 'Mehdi Benali', true).action, 'pointage.annulerCorrection');
  assert.match(retraitCorrectionPointage(c, 'Mehdi Benali', true).question, /votre demande/);
});

test('hors ligne : pointage gardé avec l’heure de l’appareil, pour soi seulement, jamais une position', () => {
  const d = { ...donnees(), user: { empId: 2 } } as unknown as Dataset;
  const t = new Date('2026-10-10T06:02:00.000Z');
  assert.deepEqual(versFile('pointage.pointer', { empId: 2 }, d, () => t), { nom: 'pointage.pointer', payload: { empId: 2, horodatageAppareil: '2026-10-10T06:02:00.000Z' } });
  assert.deepEqual(versFile('pointage.pointer', { empId: 2, position: { lat: 1, lng: 2 } }, d, () => t)?.payload, { empId: 2, horodatageAppareil: '2026-10-10T06:02:00.000Z' }, 'position jamais gardée');
  assert.equal(versFile('pointage.pointer', { empId: 16 }, d, () => t), null, 'jamais pour un autre');
  assert.equal(versFile('pointage.corriger', { empId: 2, nature: 'ajout' }, d, () => t), null, 'une correction attend le réseau');
  assert.match(libelleSaisie('pointage.pointer', { empId: 2, horodatageAppareil: '2026-10-10T06:02:00.000Z' }), /^Pointage différé · samedi 10 octobre à \d{2}:02$/);
});

test('écran Pointages : trois espaces, jamais les profils restreints ; raccourci « Pointer » de l’application installée', () => {
  for (const r of ['rh', 'manager', 'collaborateur'] as const) assert.ok((ALLOWED_VIEWS[r] as readonly string[]).includes('pointages'), r);
  for (const p of ['referent_hse', 'paie', 'lecture_seule', 'comptabilite'] as const) assert.ok(!PROFILS_RH[p].vues?.includes('pointages'), p);
  const m = JSON.parse(readFileSync(new URL('../client/public/manifest.webmanifest', import.meta.url), 'utf8')) as { shortcuts: { name: string; url: string }[] };
  assert.equal(m.shortcuts.find(s => s.name === 'Pointer')?.url, '/pointages?source=pwa');
});
