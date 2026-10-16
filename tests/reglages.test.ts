// Tests des réglages (cadre commun du lot 4) : table « champ → contrôle » de shared/reglages.ts (valeurs par défaut,
// contrôles identiques à l'ancienne fonction parametres.maj, refus d'une saisie invalide) et écran Paramètres découpé
// en sections, une par fichier de client/src/pages/parametres/, toutes inscrites dans sections.tsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
process.env.CURSUS_TODAY = '2026-10-07';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { DEFAULT_SETTINGS, loadFull, loadSettings } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { appliquerReglages, choix, REGLAGES, ReglageInvalide, reglagesParDefaut } = await import('../shared/reglages.ts');
type User = Parameters<typeof loadFull>[1];
type Settings = ReturnType<typeof loadSettings>;
const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };

const db = new Db(':memory:');
seedDemo(db);
const run = (name: string, p: Record<string, unknown>) => db.tx(() => ACTIONS[name](makeCtx(db, RH, loadFull(db, RH)), p));

test('réglages par défaut : une ligne par champ, valeurs d’avant le découpage', () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    horizonAlerte: 90, uniquementReglementaire: false, seuilBudget: 85, partageKeystone: 'minimal', rtt39: 23, vueInitiale: 'dashboard',
    // Lot 4, reprise : Keystone garde le matricule Cursus, clôture des CP au cas par cas, RTT de l'année suivante sans restriction.
    identifiantKeystone: 'cursus', politiqueReportCp: 'cas_par_cas', rttAnneeSuivanteDes: '',
    // Paie (lot 4) : heures supplémentaires payées, semaine à cheval sur le mois de son dimanche, clôture le dernier jour.
    heuresSupMode: 'paiement', heuresSupAccord: '', periodeRattachement: 'dimanche', clotureJour: 0,
    // Suivi des feuilles de temps (lot 4) : 5 semaines affichées, feuille attendue le lundi suivant à 12 h.
    suiviSemaines: 5, feuilleLimiteJour: 1, feuilleLimiteHeure: 12,
    // Campagne d'entretiens : le fonctionnement d'avant le réglage (shared/rules/campagne.ts).
    campagneDebut: '10-01', campagneFin: '12-15', campagneAncienneteMois: 0, campagneExclus: [], campagnePreavisJours: 365,
    // Contrats : titres de séjour alertés à 4 mois, puis relancés à 2 mois.
    titreSejourAlerte: 120, titreSejourRelance: 60,
    // Récapitulatif des échéances (shared/rules/relances.ts) : actif, à 90, 30 et 7 jours puis échu, chaque jour.
    relancesActives: true, relancesPaliers: [90, 30, 7], relancesJour: 'quotidien',
  });
  assert.deepEqual(Object.keys(REGLAGES).sort(), Object.keys(loadSettings(db)).sort());
  assert.deepEqual(reglagesParDefaut(), DEFAULT_SETTINGS);
});

test('contrôles : bornes, pas, listes et valeurs inexploitables comme avant', () => {
  const cur: Settings = { ...DEFAULT_SETTINGS, horizonAlerte: 60, rtt39: 12, partageKeystone: 'detaille' };
  const maj = (p: Record<string, unknown>) => appliquerReglages(cur, p);
  assert.equal(maj({ horizonAlerte: 100 }).horizonAlerte, 90, 'arrondi au pas de 30');
  assert.equal(maj({ horizonAlerte: 500 }).horizonAlerte, 180);
  assert.equal(maj({ horizonAlerte: 'abc' }).horizonAlerte, 60, 'saisie inexploitable : valeur en vigueur');
  assert.equal(maj({ horizonAlerte: null }).horizonAlerte, 30, 'null compte pour 0, ramené au minimum');
  assert.equal(maj({ seuilBudget: 87 }).seuilBudget, 85);
  assert.equal(maj({ seuilBudget: 20 }).seuilBudget, 60);
  assert.equal(maj({ rtt39: 41 }).rtt39, 40);
  assert.equal(maj({ rtt39: -1 }).rtt39, 0);
  assert.equal(maj({ rtt39: 12.6 }).rtt39, 13);
  assert.equal(maj({ uniquementReglementaire: 'oui' }).uniquementReglementaire, true);
  assert.equal(maj({ uniquementReglementaire: 0 }).uniquementReglementaire, false);
  assert.equal(maj({ partageKeystone: 'minimal' }).partageKeystone, 'minimal');
  assert.equal(maj({ partageKeystone: 'tout' }).partageKeystone, 'minimal', 'tout autre choix que le détaillé vaut minimal');
  assert.deepEqual(maj({ vueInitiale: 'budget', silent: true, inconnu: 1 }), cur, 'réglage sans contrôle, drapeau et champ inconnu ignorés');
  assert.deepEqual(maj({}), cur);
  // Liste sans valeur de repli : une valeur hors liste garde la valeur en vigueur.
  assert.equal(choix(['a', 'b'])('c', 'b'), 'b');
});

test('parametres.maj : seuls les champs de la table, contrôlés ; une saisie refusée n’enregistre rien (400)', () => {
  assert.equal(run('parametres.maj', { horizonAlerte: 100, rtt39: 99, vueInitiale: 'budget' }), 'Paramètres enregistrés');
  const s = loadSettings(db);
  assert.equal(s.horizonAlerte, 90);
  assert.equal(s.rtt39, 40);
  assert.equal(s.vueInitiale, 'dashboard');
  assert.equal(run('parametres.maj', { seuilBudget: 70, silent: true }), null);
  // Réglage ajouté par un chantier, dont le contrôle refuse la saisie (date impossible…).
  const table = REGLAGES as unknown as Record<string, unknown>;
  table.essai = { defaut: null, controle: () => { throw new ReglageInvalide('Date d’arrêté invalide'); } };
  try {
    assert.throws(() => run('parametres.maj', { seuilBudget: 95, essai: '2027-02-31' }),
      (e: unknown) => e instanceof ActionError && e.status === 400 && e.message === 'Date d’arrêté invalide');
    assert.equal(loadSettings(db).seuilBudget, 70, 'rien n’est enregistré');
  } finally {
    delete table.essai;
  }
});

test('écran Paramètres : chaque section de pages/parametres/ est inscrite dans sections.tsx', () => {
  const dossier = new URL('../client/src/pages/parametres/', import.meta.url);
  const sections = readFileSync(new URL('sections.tsx', dossier), 'utf8');
  const fichiers = readdirSync(dossier).filter(f => f.endsWith('.tsx') && f !== 'sections.tsx');
  assert.ok(fichiers.length >= 5, fichiers.join(', '));
  for (const f of fichiers) {
    const src = readFileSync(new URL(f, dossier), 'utf8');
    const composant = /export function ([A-Z]\w*)\([^)]*: SectionProps\)/.exec(src);
    assert.ok(composant, `${f} : composant de section (SectionProps) exporté`);
    const nom = composant[1];
    assert.match(sections, new RegExp(`import \\{[^}]*\\b${nom}\\b[^}]*\\} from './${f.replace('.', '\\.')}'`), `${f} : importé dans sections.tsx`);
    assert.match(sections, new RegExp(`Section: ${nom} \\}`), `${f} : inscrit dans SECTIONS`);
  }
});
