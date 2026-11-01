// Tests des réglages (cadre commun du lot 4) : table « champ → contrôle » de shared/reglages.ts (valeurs par défaut,
// contrôles identiques à l'ancienne fonction parametres.maj, refus d'une saisie invalide) et écran Paramètres découpé
// en sections, une par fichier de client/src/pages/parametres/, toutes inscrites dans sections.tsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
process.env.CURSUS_TODAY = '2026-10-07';

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { DEFAULT_SETTINGS, loadFull, loadSettings } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { appliquerReglages, choix, REGLAGES, ReglageInvalide, reglagesParDefaut } = await import('../shared/reglages.ts');
type User = Parameters<typeof loadFull>[1];
type Settings = Awaited<ReturnType<typeof loadSettings>>;
const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };

const db = await nouvelleBase();
await seedDemo(db);
const run = async (name: string, p: Record<string, unknown>) => await db.tx(async () => await ACTIONS[name](makeCtx(db, RH, await loadFull(db, RH)), p));

test('réglages par défaut : une ligne par champ, valeurs d’avant le découpage', async () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    horizonAlerte: 90, uniquementReglementaire: false, seuilBudget: 85, partageKeystone: 'minimal', rtt39: 23, vueInitiale: 'dashboard',
    // Lot 4, reprise : Keystone garde le matricule Cursus, clôture des CP au cas par cas, RTT de l'année suivante sans restriction.
    identifiantKeystone: 'cursus', politiqueReportCp: 'cas_par_cas', rttAnneeSuivanteDes: '',
    // Acquisition des CP pendant un arrêt maladie (lot 5) : minimum légal de la loi 2024-364.
    cpMaladie: 'legal',
    // Paie (lot 4) : heures supplémentaires payées, semaine à cheval sur le mois de son dimanche, clôture le dernier jour.
    heuresSupMode: 'paiement', heuresSupAccord: '', periodeRattachement: 'dimanche', clotureJour: 0,
    // Semaine à 7 jours (lot 5) : heures du dimanche sans majoration par défaut.
    majorationDimanche: 0,
    // Suivi des feuilles de temps (lot 4) : 5 semaines affichées, feuille attendue le lundi suivant à 12 h.
    suiviSemaines: 5, feuilleLimiteJour: 1, feuilleLimiteHeure: 12,
    // Campagne d'entretiens : le fonctionnement d'avant le réglage (shared/rules/campagne.ts).
    campagneDebut: '10-01', campagneFin: '12-15', campagneAncienneteMois: 0, campagneExclus: [], campagnePreavisJours: 365,
    // Contrats : titres de séjour alertés à 4 mois, puis relancés à 2 mois.
    titreSejourAlerte: 120, titreSejourRelance: 60,
    // CDD (lot 6) : règles supplétives de la loi, 2 renouvellements, durée maximale selon le motif, sans accord de branche.
    cddRenouvellementsMax: 2, cddDureeMaxMois: 0, cddAccordBranche: '',
    // Récapitulatif des échéances (shared/rules/relances.ts) : actif, à 90, 30 et 7 jours puis échu, chaque jour.
    relancesActives: true, relancesPaliers: [90, 30, 7], relancesJour: 'quotidien',
    // Santé (lot 5) : 24 mois pour tous, le plus prudent ; examen d'aptitude du suivi renforcé tous les 4 ans.
    santeVipMois: 24, santeVipAdapteeMois: 24, santeSirIntermediaireMois: 24, santeSirAptitudeMois: 48,
    // Visite de mi-carrière l'année des 45 ans, à défaut d'accord de branche (art. L4624-2-2).
    santeMiCarriereAge: 45,
    // Formations (lot 5) : heures des sessions proposées dans les feuilles de temps (ligne interne INT-FORM).
    formationsTemps: true,
    // Décompte des heures (lot 5) : saisie un jour férié permise, fériés hors 1er mai sans majoration, heures complémentaires au
    // dixième, moyenne de 44 h sur 12 semaines, contingent de 220 h avec alerte à 90 %, sans référence d'accord.
    feriesTravaillesAutorises: true, tauxMajorationFerie: 0, plafondHeuresComplementaires: 'dixieme', heuresComplementairesAccord: '',
    moyenne12SemainesMax: 44, moyenne12SemainesAccord: '', contingentHeuresSup: 220, contingentAlerte: 90, contingentAccord: '',
    // Paie (lot 5, t028) : absences validées dans le fichier d'import, réponse de l'entreprise du 17 octobre 2026.
    absencesFichierPaie: true, absencesPaieAPartirDu: null,
    // Pièces justificatives (lot 6, t133) : désactivées tant que l'administrateur RH ne les active pas (18 octobre 2026).
    piecesStockage: 'desactive',
    // Sécurité au poste (lot 6) : formation renforcée non désignée ; entretien de mi-carrière 2 mois après la visite.
    formationRenforceeCode: '', entretienMiCarriereActif: true, entretienMiCarriereMois: 2,
    // Hiérarchie (t136) : consultation N+2 désactivée par défaut.
    consultationN2: false,
    delegationEntretiens: false,
    // Lot 6 (t031, t068) : déplacements hors du fichier tant que la paie n'a pas confirmé ses codes (réponse du 18 octobre
    // 2026) ; vigilance des pays à vérifier de nouveau au-delà de 30 jours.
    deplacementsFichierPaie: false, deplacementsPaieAPartirDu: null, vigilanceRappelJours: 30,
    // Lot 6 (t048) : travail de nuit aux valeurs supplétives de la loi, nuit de 21 h à 6 h, 3 h ou 270 h, sans majoration.
    nuitDebut: 21, nuitFin: 6, nuitSeuilQuotidien: 3, nuitSeuilAnnuel: 270, nuitMajoration: 0, nuitAccord: '',
    // Forfait jours (t043) : suivi et alerte à 90 %, renonciation fermée sans référence d'accord.
    forfaitJoursAlerte: 90, forfaitJoursRachat: false, forfaitJoursAccord: '', forfaitJoursPlafond: 235, forfaitJoursMajorationMin: 10, forfaitJoursJren: 'signature',
    // Lot 6, chantier 3 (t046, t127) : règle légale du fractionnement, congé principal du 1er mai au 31 octobre ; plafonds de
    // placement sur le CET, 5 RTT par an et 5 CP de la 5e semaine.
    fractionnementRegle: 'legal', fractionnementAccord: '', fractionnementDebut: '05-01', fractionnementFin: '10-31',
    cetPlafondRtt: 5, cetPlafondCp: 5,
    // Lot 6 (t016, t036) : durées de conservation préremplies mais inactives sans la décision du DPO (réponse du 18 octobre
    // 2026) ; flux d'agenda personnel désactivé, contenu complet.
    conservationActive: false, conservationDecisionDpo: '', conservationDossierAns: 5, conservationTempsAns: 3, conservationPaieAns: 5,
    conservationSanteAns: 5, conservationPasseportAns: 0, conservationTitreSejourAns: 5, conservationEntretiensAns: 5, conservationFormationsAns: 5,
    agendaFluxActif: false, agendaContenu: ['sessions', 'entretiens', 'absences', 'deplacements'],
    // Lot 7 (t049) : astreintes communiquées 15 jours avant (art. R3121-3), compensation financière (réponse du 23 octobre
    // 2026), aucune astreinte pour un salarié mineur, accord inconnu.
    astreinteDelaiPrevenance: 15, astreinteCompensation: 'financiere', astreinteMineurs: false, astreinteAccord: '',
    // Lot 7, chantier C (t120) : liste d'attente des sessions complètes activée ; place libérée proposée au service RH, qui
    // confirme (réponse de l'entreprise du 23 octobre 2026).
    formationsListeAttente: true, formationsAttenteMode: 'confirmer',
    // Lot 7, chantier B (t066) : gabarit de l'export du Passeport de prévention (format à confirmer), sans NIR.
    passeportColonnes: ['nom', 'prenom', 'naissance', 'matricule', 'intitule', 'organisme', 'du', 'au', 'duree', 'resultat'],
    // Lot 7, chantier C (t121) : évaluation des formations activée ; à froid 90 jours après, par le salarié et son manager
    // (réponse de l'entreprise du 23 octobre 2026), formations réglementaires et recommandées.
    evaluationsActives: true, evaluationFroidDelai: 90, evaluationFroidPar: 'les_deux', evaluationFroidCategories: ['Réglementaire', 'Recommandée'],
    // lot 11 — organigramme : ouvert à tous les salariés (choix par défaut du chantier).
    organigrammeOuvert: 'tous',
    // lot 11 — indicateurs : seuil d'anonymat de 5 ; absentéisme sur la santé, l'enfant malade, le sans solde et
    // l'injustifiée (choix par défaut du chantier, à arrêter avec le CSE).
    indicateursSeuil: 5, absenteismeNatures: ['MALADIE', 'ALD', 'AT', 'TRAJET', 'MP', 'ENFANT_MALADE', 'SANS_SOLDE', 'INJUSTIFIEE'],
    // lot 11 — dossiers OPCO : OPCO 2i, sans subrogation ; dépôt 30 jours avant, justificatifs 90 jours après, relance du
    // remboursement à 60 jours (à confirmer avec le service RH).
    opcoDefaut: 'opco2i', opcoSubrogation: false, opcoDelaiDepot: 30, opcoDelaiJustificatifs: 90, opcoDelaiRemboursement: 60,
    // Lot 11, chantier C5 : notes de frais désactivées, validation du manager puis contrôle, délai de 3 mois, aucun plafond
    // interne, justificatif toujours exigé, puissance plafonnée à 7 CV, notes payées gardées 10 ans.
    notesFraisActives: false, fraisCircuit: 'manager_controle', fraisDelaiSoumissionMois: 3, fraisPlafonds: {}, fraisSeuilJustificatif: 0, fraisIkCvReels: false,
    conservationFraisAns: 10,
    // Lot 11, chantier C5, étape 2 : fichier d'écritures (comptes proposés, journal OD, gabarit du fichier de paie).
    fraisComptes: {}, fraisCompteGenerique: '6256', fraisCompteTva: '44566', fraisCompteSalarie: '421', fraisJournal: 'OD',
    fraisGabarit: { separateur: ';', colonnes: ['journal', 'date', 'compte', 'compteTiers', 'piece', 'libelle', 'debit', 'credit'], decimale: ',', entete: true, encodage: 'utf-8', formatDate: 'JJ/MM/AAAA' },
    // lot 12 — C6 (badgeage virtuel) : module désactivé, sans population, accord et avis du CSE à saisir ; intérimaires
    // exclus ; corrections sous 7 jours ; hors ligne admis, signalé au-delà de 5 min ; écart de 15 min ; 3 ans.
    pointageActif: false, pointagePopulations: [], pointageAccord: '', pointageCseLe: null, pointageInterim: false, pointageDelaiCorrectionJours: 7,
    pointageHorsLigne: true, pointageEcartDiffereMin: 5, pointageEcartAnomalieMin: 15, conservationPointagesAns: 3,
  });
  assert.deepEqual(Object.keys(REGLAGES).sort(), Object.keys(await loadSettings(db)).sort());
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

test('parametres.maj : seuls les champs de la table, contrôlés ; une saisie refusée n’enregistre rien (400)', async () => {
  assert.equal(await run('parametres.maj', { horizonAlerte: 100, rtt39: 99, vueInitiale: 'budget' }), 'Paramètres enregistrés');
  const s = await loadSettings(db);
  assert.equal(s.horizonAlerte, 90);
  assert.equal(s.rtt39, 40);
  assert.equal(s.vueInitiale, 'dashboard');
  assert.equal(await run('parametres.maj', { seuilBudget: 70, silent: true }), null);
  // Réglage ajouté par un chantier, dont le contrôle refuse la saisie (date impossible…).
  const table = REGLAGES as unknown as Record<string, unknown>;
  table.essai = { defaut: null, controle: () => { throw new ReglageInvalide('Date d’arrêté invalide'); } };
  try {
    await assert.rejects(async () => await run('parametres.maj', { seuilBudget: 95, essai: '2027-02-31' }),
      (e: unknown) => e instanceof ActionError && e.status === 400 && e.message === 'Date d’arrêté invalide');
    assert.equal((await loadSettings(db)).seuilBudget, 70, 'rien n’est enregistré');
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
