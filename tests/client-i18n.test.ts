// Langue de l'interface (Norma § 2 et § 7, CU-N01 ; client/src/i18n/) sous node --test : moteur de traduction (anglais
// source, français par défaut), cookie cursus-lang, sélecteur FR / EN de l'en-tête (juste avant le bouton d'affichage),
// changement de langue sans rechargement, et complétude du dictionnaire français sur les fichiers migrés.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('./outils/rendu.ts');
const { act, cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { createElement } = await import('react');
const { enFrancais, frExact, makeT, localeIntl, sansContexte } = await import('../client/src/i18n/traduire.ts');
const { FR, MEMES_EN_FRANCAIS } = await import('../client/src/i18n/fr.ts');
const { choisirLangue, LANGUE_COOKIE, langueCookie, langueCourante, langueDe, langueDuCookie, t, tn } = await import('../client/src/i18n/langue.ts');
const { BoutonLangue } = await import('../client/src/i18n/BoutonLangue.tsx');
const { BoutonTheme } = await import('../client/src/theme/BoutonTheme.tsx');

const lire = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
afterEach(() => { cleanup(); choisirLangue('fr'); document.cookie = `${LANGUE_COOKIE}=; path=/; max-age=0`; });

test('moteur : entrée exacte, règles à paramètres, segments ; anglais = identité ; chaîne inconnue gardée', () => {
  assert.equal(enFrancais('Timesheets'), 'Feuilles de temps');
  assert.equal(enFrancais('3 to handle'), '3 à traiter');
  assert.equal(enFrancais('Worksites · Go / No Go'), 'Chantiers · Go / No Go');
  assert.equal(enFrancais('Help — Privacy'), 'Aide — Confidentialité');
  assert.equal(enFrancais('12,5 %'), '12,5 %', 'nombre seul');
  assert.equal(enFrancais(''), '');
  assert.equal(enFrancais('Not in the dictionary'), 'Not in the dictionary');
  assert.equal(frExact('constructor'), undefined, 'propriétés héritées ignorées');
  assert.equal(makeT('en')('Timesheets'), 'Timesheets');
  assert.equal(makeT('fr')('Timesheets'), 'Feuilles de temps');
  assert.equal(localeIntl('fr'), 'fr-FR');
  assert.equal(localeIntl('en'), 'en-GB');
});

test('cookie cursus-lang : « en » donne l’anglais, toute autre valeur ou son absence le français (par défaut)', () => {
  assert.equal(LANGUE_COOKIE, 'cursus-lang');
  assert.equal(langueDe('en'), 'en');
  for (const v of ['fr', 'EN', '', undefined, null, 'de']) assert.equal(langueDe(v), 'fr', String(v));
  assert.equal(langueDuCookie('a=1; cursus-lang=en; b=2'), 'en');
  assert.equal(langueDuCookie('x-cursus-lang=en; lang=en'), 'fr', 'nom exact du cookie seulement');
  assert.equal(langueDuCookie(undefined), 'fr');
  assert.equal(langueCookie('en'), 'cursus-lang=en; path=/; max-age=31536000; samesite=lax');
  assert.equal(langueCourante(), 'fr', 'français par défaut');
});

test('choisirLangue : t() suit la langue, attribut lang de <html> et cookie posés ; même langue sans effet', () => {
  assert.equal(t('Sign out'), 'Se déconnecter');
  choisirLangue('en');
  assert.equal(t('Sign out'), 'Sign out');
  assert.equal(document.documentElement.getAttribute('lang'), 'en');
  assert.match(document.cookie, /cursus-lang=en/);
  choisirLangue('en');
  assert.equal(langueCourante(), 'en');
  choisirLangue('fr', null);
  assert.equal(t('Sign out'), 'Se déconnecter', 'sans document : la langue change quand même');
});

test('sélecteur FR / EN : groupe « Langue », français choisi par défaut, l’anglais traduit aussitôt le sélecteur d’affichage', () => {
  render(createElement('div', null, createElement(BoutonLangue), createElement(BoutonTheme)));
  screen.getByRole('group', { name: 'Langue' });
  const fr = screen.getByRole('button', { name: 'FR' });
  const en = screen.getByRole('button', { name: 'EN' });
  assert.equal(fr.getAttribute('aria-pressed'), 'true');
  assert.equal(fr.getAttribute('title'), 'Français', 'infobulle');
  assert.equal(en.getAttribute('title'), 'English');
  assert.equal(en.getAttribute('lang'), 'en');
  act(() => { fireEvent.click(en); });
  assert.equal(langueCourante(), 'en');
  assert.equal(screen.getByRole('button', { name: 'EN' }).getAttribute('aria-pressed'), 'true');
  screen.getByRole('group', { name: 'Language' });
  // Le sélecteur d'affichage est rendu de nouveau par la coque (useLangue) : ici, rendu neuf en anglais.
  cleanup();
  render(createElement(BoutonTheme));
  screen.getByRole('group', { name: 'Dark / light display' });
  screen.getByRole('button', { name: 'Light display' });
});

/** Écrans passés aux chaînes sources anglaises, avec tous leurs fichiers (CLAUDE.md, « Langue de l'interface »). */
const ECRANS_MIGRES: { ecran: string; fichiers: string[] }[] = [
  { ecran: 'Hors ligne', fichiers: ['client/src/pages/HorsLigne.tsx', 'client/src/components/FileEnAttente.tsx', 'client/src/components/frais/DepenseHorsLigne.tsx'] },
  { ecran: 'Changer mon mot de passe', fichiers: ['client/src/pages/MotDePasse.tsx', 'client/src/dialogs/MotDePasseDialog.tsx'] },
  { ecran: 'Avis demandés', fichiers: ['client/src/pages/AvisDemandes.tsx', 'client/src/dialogs/Avis360Dialog.tsx'] },
  {
    ecran: 'Pointages', fichiers: ['client/src/pages/Pointages.tsx', 'client/src/components/BoutonPointer.tsx', 'client/src/components/temps/Pointages.tsx',
      'client/src/components/temps/pointage-etat.ts', 'client/src/dialogs/CorrectionPointageDialog.tsx', 'client/src/state/confirmations-pointage.ts'],
  },
  {
    // Avec les composants communs qu'il emploie : listes triées et paginées, référentiel vide, pièces justificatives,
    // contrôles des champs (repris pour tous les écrans qui s'en servent).
    ecran: 'Habilitations', fichiers: ['client/src/pages/Habilitations.tsx', 'client/src/dialogs/HabDialog.tsx', 'client/src/dialogs/HabMesureDialog.tsx',
      'client/src/components/TriListe.tsx', 'client/src/components/tri.ts', 'client/src/components/ReferentielVide.tsx',
      'client/src/components/PieceJointe.tsx', 'client/src/components/controles.ts'],
  },
  { ecran: 'Confidentialité', fichiers: ['client/src/pages/Confidentialite.tsx'] },
  { ecran: 'Expositions (C2P)', fichiers: ['client/src/pages/Prevention.tsx'] },
  {
    // Sessions, renouvellements, listes d'attente, e-learning, passeport de prévention, évaluations ; dialogues de session
    // (création, détail, clôture), de planification et de demande, confirmations qu'ils ouvrent (désinscription, retrait
    // de la liste d'attente, abandon et suppression d'une inscription à l'e-learning).
    ecran: 'Formations', fichiers: ['client/src/pages/Formations.tsx', 'client/src/dialogs/SessionDialog.tsx', 'client/src/dialogs/SessionDetailDialog.tsx',
      'client/src/dialogs/ClotureDialog.tsx', 'client/src/dialogs/PlanDialog.tsx', 'client/src/dialogs/ReqFormDialog.tsx',
      'client/src/components/ListeAttente.tsx', 'client/src/components/PasseportPrevention.tsx', 'client/src/components/Evaluations.tsx',
      'client/src/components/elearning/ElearningFormations.tsx', 'client/src/components/organismes/ChoixOrganisme.tsx',
      'client/src/state/confirmations-attente.ts', 'client/src/dialogs/ElearningDialogs.tsx', 'client/src/dialogs/ElearningImportDialog.tsx'],
  },
  {
    // Soldes, demandes et absences, règles, natures ; clôtures, fractionnement, informations au retour, monétisations du CET ;
    // dialogues de pose, signalement, qualification, prolongation, annulation, CET, report, monétisation, clôture et
    // fractionnement ; confirmations qu'ils ouvrent (refus d'une absence, monétisation).
    ecran: 'Congés & absences', fichiers: ['client/src/pages/Absences.tsx', 'client/src/pages/absences-filtres.ts',
      'client/src/components/CloturesConges.tsx', 'client/src/components/Fractionnement.tsx', 'client/src/components/InformationsRetour.tsx',
      'client/src/components/MonetisationsCet.tsx', 'client/src/dialogs/AbsDialog.tsx', 'client/src/dialogs/AbsSignalDialog.tsx',
      'client/src/dialogs/AbsNatureDialog.tsx', 'client/src/dialogs/AbsProlongerDialog.tsx', 'client/src/dialogs/AbsAnnulerDialog.tsx',
      'client/src/dialogs/CetDialog.tsx', 'client/src/dialogs/ReportDialog.tsx', 'client/src/dialogs/MonetisationCetDialog.tsx',
      'client/src/dialogs/ClotureCongesDialog.tsx', 'client/src/dialogs/FractionnementDialog.tsx', 'client/src/state/confirmations-cet.ts'],
  },
  {
    // Mes frais, validation, contrôle, toutes les notes, avances, exports comptables, tableau de bord, historique ; notes
    // rattachées (Missions, Voyages) ; dialogues de dépense, de note, d'avance, de montant retenu, de véhicule, de taux, de
    // limite d'exonération et de barème ; confirmations des renvois, refus et annulations.
    ecran: 'Notes de frais', fichiers: ['client/src/pages/Frais.tsx', 'client/src/components/frais/Notes.tsx', 'client/src/components/frais/Tableau.tsx',
      'client/src/components/frais/Exports.tsx', 'client/src/components/frais/FraisRattaches.tsx', 'client/src/components/frais/Historique.tsx',
      'client/src/components/frais/commun.ts', 'client/src/components/frais/historique.ts', 'client/src/components/frais/saisie.ts',
      'client/src/components/frais/onglets.ts', 'client/src/dialogs/FraisDepenseDialog.tsx', 'client/src/dialogs/FraisNoteDialog.tsx',
      'client/src/dialogs/FraisAvanceDialog.tsx', 'client/src/dialogs/FraisPlafondDialog.tsx', 'client/src/dialogs/FraisVehiculeDialog.tsx',
      'client/src/dialogs/FraisReferentielDialog.tsx', 'client/src/state/confirmations-frais.ts'],
  },
  {
    // Indicateurs, demandes des collaborateurs (acceptation sur liste d'attente, refus), contrats, couvertures (équipes,
    // postes planifiés), habilitations des postes planifiés, dossiers à effacer, sessions, déplacements.
    ecran: 'Tableau de bord', fichiers: ['client/src/pages/Dashboard.tsx', 'client/src/components/Couverture.tsx', 'client/src/components/DossiersEchus.tsx',
      'client/src/components/planning/CouvertureCreneaux.tsx', 'client/src/components/planning/HabilitationsPlanifiees.tsx',
      'client/src/dialogs/AccepterAttenteDialog.tsx'],
  },
  {
    ecran: 'Échéances', fichiers: ['client/src/pages/Echeances.tsx', 'client/src/components/IndicateursACompleter.tsx', 'client/src/components/opco/EcheancesOpco.tsx'],
  },
  {
    // Présents en mission, planning des 4 semaines (grille et légende), grand déplacement des chantiers, notes rattachées.
    ecran: 'Missions & déplacements', fichiers: ['client/src/pages/Missions.tsx', 'client/src/pages/PlanningMissions.tsx', 'client/src/pages/planning-missions.ts',
      'client/src/components/GrandDeplacement.tsx'],
  },
  {
    // Vue « un jour » des feuilles de temps (téléphone, tablette) et horaire du jour (aussi sur la grille de la semaine).
    ecran: 'Saisie du jour', fichiers: ['client/src/pages/SaisieJour.tsx', 'client/src/components/HorairesFeuille.tsx'],
  },
  {
    // Demandes Keystone, déplacements à venir et annulés, dossier voyage (vigilance, formalités, notes rattachées), dossiers
    // voyageurs, destinations ; dialogues de déplacement (création, modification, import), de détachement et de formalité ;
    // confirmations de refus d'une demande Keystone et d'annulation (fonctions reprises dans confirmations*.ts).
    ecran: 'Voyages', fichiers: ['client/src/pages/Voyages.tsx', 'client/src/components/VoyageVigilance.tsx', 'client/src/dialogs/TripDialog.tsx',
      'client/src/dialogs/TripModifierDialog.tsx', 'client/src/dialogs/TripImportDialog.tsx', 'client/src/dialogs/DetachementDialog.tsx',
      'client/src/dialogs/FormaliteDialog.tsx'],
  },
  {
    // Liste et fiche : aptitude, exigences, certifications, formations suivies, pièces, voyages, contrat (sortie et solde,
    // CDD, titre de séjour, historique, forfaits, mineur, nuit, mandats, contact d'urgence) ; dialogues de la fiche et
    // confirmations qu'ils ouvrent (avenants, corrections, sortie, retrait de l'équipe, visite).
    ecran: 'Collaborateurs', fichiers: ['client/src/pages/Collaborateurs.tsx', 'client/src/components/Aptitude.tsx', 'client/src/components/Exigences.tsx',
      'client/src/components/Sortie.tsx', 'client/src/components/SoldeSortie.tsx', 'client/src/components/ContratFiche.tsx',
      'client/src/components/HistoriqueContrat.tsx', 'client/src/components/Mineur.tsx', 'client/src/components/TravailNuit.tsx',
      'client/src/components/Delegation.tsx', 'client/src/components/ContactUrgence.tsx', 'client/src/components/ForfaitJours.tsx',
      'client/src/components/temps/ForfaitHeuresFiche.tsx', 'client/src/components/Corrections.tsx', 'client/src/components/PiecesFiche.tsx',
      'client/src/components/CopierLien.tsx', 'client/src/components/FormationsSuivies.tsx', 'client/src/components/PosteChoix.tsx',
      'client/src/dialogs/CertDialog.tsx', 'client/src/dialogs/VisiteDialog.tsx', 'client/src/dialogs/AvisDialog.tsx', 'client/src/dialogs/SuiviDialog.tsx',
      'client/src/dialogs/ReqHabDialog.tsx', 'client/src/dialogs/EmployeDialog.tsx', 'client/src/dialogs/FichePropreDialog.tsx',
      'client/src/dialogs/MembreDialog.tsx', 'client/src/dialogs/AutorisationDialog.tsx', 'client/src/dialogs/AvenantForfaitDialog.tsx',
      'client/src/dialogs/ContactUrgenceDialog.tsx', 'client/src/dialogs/FormationSuivieDialog.tsx', 'client/src/dialogs/MandatDialog.tsx',
      'client/src/dialogs/PieceDialog.tsx', 'client/src/dialogs/RenouvelerCddDialog.tsx', 'client/src/dialogs/SortieDialog.tsx',
      'client/src/state/confirmations-contrats.ts', 'client/src/state/confirmations-forfait.ts', 'client/src/state/confirmations-corrections.ts'],
  },
  // Grille de la semaine, file de validation et récapitulatif paie (les panneaux de l'écran gardent leurs propres fichiers).
  { ecran: 'Temps de travail (grille de la semaine)', fichiers: ['client/src/pages/Temps.tsx'] },
  {
    // Cartes, détail de l'équipe, à affecter ; hiérarchie (équipe parente, lecture seule N+2), délégations des validations ;
    // dialogues de l'équipe, de rattachement et de délégation ; confirmation de la révocation.
    ecran: 'Équipes & managers', fichiers: ['client/src/pages/Equipes.tsx', 'client/src/components/Hierarchie.tsx', 'client/src/components/Delegations.tsx',
      'client/src/dialogs/EquipeDialog.tsx', 'client/src/dialogs/EquipeRattachementDialog.tsx', 'client/src/dialogs/DelegationDialog.tsx',
      'client/src/state/confirmations-delegations.ts'],
  },
  // Recherche de l'en-tête (annuaire filtré, suggestions) et choix d'un collaborateur dans les dialogues et les filtres.
  { ecran: 'Annuaire (recherche)', fichiers: ['client/src/layout/RechercheGlobale.tsx', 'client/src/components/ChoixCollaborateur.tsx'] },
  {
    // Arbre en liste et vue graphique, filtres, service choisi et fil d'Ariane, anomalies (le document imprimé et l'export
    // CSV, construits par organigramme-vue.ts et listes-csv.ts, restent en français).
    ecran: 'Organigramme', fichiers: ['client/src/pages/Organigramme.tsx', 'client/src/components/organigramme/ArbreGraphique.tsx'],
  },
  {
    // Échéances et comptes rendus, objectifs, points de suivi, feedback 360° ; compte rendu (sections, objectifs, souhaits,
    // feedback 360° et sa synthèse), planification, remise de la copie, dialogues des objectifs, des souhaits et des répondants
    // (le compte rendu imprimé, ses libellés de sections et la mention d'information, dialogs/compteRendu*.ts, restent en français).
    ecran: 'Entretiens / 360°', fichiers: ['client/src/pages/Entretiens.tsx', 'client/src/pages/EntretiensSuivi.tsx', 'client/src/pages/EntretiensFeedback360.tsx',
      'client/src/components/EntretienSuivi.tsx', 'client/src/components/Feedback360Bloc.tsx', 'client/src/components/Synthese360.tsx',
      'client/src/dialogs/EntDialog.tsx', 'client/src/dialogs/EntPlanDialog.tsx', 'client/src/dialogs/RemiseDialog.tsx', 'client/src/dialogs/ObjectifDialog.tsx',
      'client/src/dialogs/ObjectifAvancerDialog.tsx', 'client/src/dialogs/ObjectifEvaluerDialog.tsx', 'client/src/dialogs/SouhaitDialog.tsx',
      'client/src/dialogs/Feedback360SolliciterDialog.tsx'],
  },
  { ecran: 'Mes objectifs', fichiers: ['client/src/pages/MesObjectifs.tsx'] },
  {
    // Déclarations à valider, présences prévues, extérieurs, intérimaires, liens de déclaration ; dialogues de la fiche
    // d'extérieur, du lien et de la validation (confirmations : state/confirmations-declarations.ts, déjà repris).
    ecran: 'Personnes sur site', fichiers: ['client/src/pages/PersonnesSite.tsx', 'client/src/dialogs/ExterieurDialog.tsx',
      'client/src/dialogs/LienDeclarationDialog.tsx', 'client/src/dialogs/ValiderDeclarationDialog.tsx'],
  },
  // Relevés d'heures des intérimaires (panneau de l'écran Temps ; confirmation d'envoi : state/confirmations.ts).
  { ecran: 'Relevés', fichiers: ['client/src/pages/Releves.tsx'] },
  { ecran: 'Chantiers', fichiers: ['client/src/pages/Chantiers.tsx'] },
  {
    // Enveloppes, consommation, plan prévisionnel et indicateurs de formation ; onglet et détail des dossiers OPCO ; dialogues
    // des enveloppes, de l'import, de la clôture d'un exercice et d'une action, de la correction d'une ligne, et ceux d'un dossier
    // OPCO (création, étapes, pièce, versement). Statuts, dispositifs et motifs des dossiers (shared/rules/opco.ts) restent en français.
    ecran: 'Plan & budget', fichiers: ['client/src/pages/Budget.tsx', 'client/src/components/IndicateursFormation.tsx',
      'client/src/components/opco/ColonneOpco.tsx', 'client/src/components/opco/DossiersOpco.tsx', 'client/src/components/opco/DossierOpcoPanel.tsx',
      'client/src/dialogs/BudgetDialog.tsx', 'client/src/dialogs/PlanImportDialog.tsx', 'client/src/dialogs/ExerciceClotureDialog.tsx',
      'client/src/dialogs/PlanRealiserDialog.tsx', 'client/src/dialogs/PlanLigneDialog.tsx', 'client/src/dialogs/OpcoDossierDialog.tsx',
      'client/src/dialogs/OpcoEtapeDialog.tsx', 'client/src/dialogs/OpcoPieceDialog.tsx', 'client/src/dialogs/OpcoVersementDialog.tsx'],
  },
  {
    // Onglets, tableaux et graphiques, BDESE, index d'égalité, arrêtés et leurs confirmations, impression ; mise à disposition
    // du CSE. Titres, définitions et lignes des tableaux viennent du serveur (shared/rules/indicateurs-legaux.ts) en français.
    ecran: 'Indicateurs sociaux', fichiers: ['client/src/pages/Indicateurs.tsx', 'client/src/pages/indicateurs-vue.ts',
      'client/src/components/graphiques/Barres.tsx', 'client/src/components/graphiques/Pyramide.tsx', 'client/src/dialogs/ArreteCseDialog.tsx'],
  },
];

/** Fichiers passés aux chaînes sources anglaises (CU-N01) : chacun de leurs littéraux de t() a sa traduction. */
const FICHIERS_MIGRES = [
  'client/src/App.tsx', 'client/src/layout/Shell.tsx', 'client/src/layout/Tiroir.tsx', 'client/src/layout/BarreOnglets.tsx',
  'client/src/theme/BoutonTheme.tsx', 'client/src/theme/theme.ts', 'client/src/i18n/BoutonLangue.tsx', 'client/src/components/Dialog.tsx',
  'client/src/pages/Login.tsx', 'client/src/layout/Coque.tsx',
  // Écrans entiers (page, composants et dialogues qu'elle ouvre), 26 novembre 2026.
  ...ECRANS_MIGRES.flatMap(e => e.fichiers),
  // Toutes les confirmations (dialogs/ConfirmerDialog.tsx), 27 novembre 2026 : celles que les écrans migrés n'emportent pas.
  ...['', '-annulations', '-astreintes', '-declarations', '-entites', '-forfait-heures', '-objectifs', '-opco', '-organismes', '-referentiels']
    .map(s => `client/src/state/confirmations${s}.ts`),
];

/** Chaînes sources d'un fichier : arguments littéraux de t(), libellés du menu et des options, textes de la connexion. */
function chainesSources(f: string): string[] {
  const s = lire(f);
  const out: string[] = [];
  for (const m of s.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) out.push(m[1]);
  for (const m of s.matchAll(/\bt\(\s*`([^`$]*)`\s*\)/g)) out.push(m[1]);
  // t(cond ? 'a' : 'b'), t(x === y ? 'a' : z === w ? 'b' : 'c') : chaque branche littérale.
  for (const m of s.matchAll(/\bt\(([^()]*\?[^()]*)\)/g)) for (const l of m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) if (!/^[a-z]+$/.test(l[1])) out.push(l[1]);
  for (const m of s.matchAll(/\blabel: (?:role === 'collaborateur' \? )?'([^']+)'(?: : '([^']+)')?/g)) out.push(...[m[1], m[2]].filter(Boolean) as string[]);
  for (const m of s.matchAll(/\[\['?([A-Z][^',]+)', \{ view:/g)) out.push(m[1]);
  for (const m of s.matchAll(/^\s*\['([A-Z][^']+)', \[/gm)) out.push(m[1]);
  for (const m of s.matchAll(/\b(?:title|text|dark|light): '([^'#][^']*)'/g)) out.push(m[1]);
  for (const m of s.matchAll(/\['(?:fr|en|rh|manager|collaborateur)', '[^']*', '([^']+)'\]|\['(?:rh|manager|collaborateur)', '([^']+)'\]/g)) out.push((m[1] ?? m[2])!);
  for (const m of s.matchAll(/LIBELLE_GROUPE_THEME = '([^']+)'/g)) out.push(m[1]);
  for (const m of s.matchAll(/\bfrais\('([^']+)'/g)) out.push(m[1]);
  // tn(n, 'singulier', 'pluriel') : les deux formes.
  for (const m of s.matchAll(/\btn\([^,()]+(?:\([^()]*\))?[^,()]*, '((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\)/g)) out.push(m[1], m[2]);
  return out.map(x => x.replace(/\\'/g, "'"));
}

test('complétude : chaque chaîne source des fichiers migrés a sa traduction française (ou est relue identique)', () => {
  const manquantes: string[] = [];
  let n = 0;
  for (const f of FICHIERS_MIGRES) {
    for (const c of chainesSources(f)) {
      n++;
      if (MEMES_EN_FRANCAIS.includes(c)) continue;
      if (enFrancais(c) === sansContexte(c)) manquantes.push(`${f} : ${c}`);
    }
  }
  assert.deepEqual(manquantes, []);
  assert.ok(n > 100, `${n} chaînes relevées`);
  for (const [en, fr] of Object.entries(FR)) assert.notEqual(en, fr, `${en} : traduction identique, à mettre dans MEMES_EN_FRANCAIS`);
  for (const c of MEMES_EN_FRANCAIS) assert.ok(!Object.hasOwn(FR, c), `${c} : dans le dictionnaire et parmi les chaînes identiques`);
});

test('fichiers migrés : plus de texte français en dur dans le rendu de la coque et de la connexion', () => {
  for (const f of ['client/src/layout/Shell.tsx', 'client/src/layout/BarreOnglets.tsx', 'client/src/layout/Tiroir.tsx', 'client/src/pages/Login.tsx', ...ECRANS_MIGRES.flatMap(e => e.fichiers)]) {
    // Chaînes JSX entre balises et attributs texte, hors commentaires : aucune lettre accentuée française.
    const code = lire(f).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    assert.doesNotMatch(code.replace(/\/\/.*$/gm, ''), /(aria-label|title)="[^"]*[éèàêç][^"]*"/, `${f} : attribut en français`);
    assert.doesNotMatch(code.replace(/\/\/.*$/gm, ''), />[^<>{}]*[éèàêçÉ][^<>{}]*</, `${f} : texte en français`);
  }
});

test('contexte et nombres : « #… » jamais affiché, tn() suit la règle de chaque langue', () => {
  assert.equal(t('Approved#fem'), 'Validée');
  assert.equal(t('Report a missed clock-in'), 'Signaler un oubli');
  assert.equal(t('Report a missed clock-in#dialog'), 'Signaler un pointage oublié');
  assert.equal(enFrancais('Unknown#ctx'), 'Unknown', 'contexte retiré sans entrée');
  assert.deepEqual([tn(0, 'entry', 'entries'), tn(1, 'entry', 'entries'), tn(2, 'entry', 'entries')], ['0 saisie', '1 saisie', '2 saisies']);
  assert.deepEqual([tn(2, 'present', 'present#plural'), tn(1, 'feedback', 'feedbacks')], ['2 présents', '1 avis']);
  choisirLangue('en');
  assert.equal(t('Approved#fem'), 'Approved');
  assert.deepEqual([tn(0, 'entry', 'entries'), tn(1, 'entry', 'entries'), tn(2, 'present', 'present#plural')], ['0 entries', '1 entry', '2 present']);
});

test('règles à paramètres des écrans migrés : la phrase française d’avant, nombre compris', () => {
  assert.equal(enFrancais('at least 12 characters'), '12 caractères au moins');
  assert.equal(enFrancais('300 characters at most.'), '300 caractères au plus.');
  assert.match(enFrancais('Clock-ins are kept for 5 years, then erased. They are read only by the employee, their manager (or their deputy for timesheets) and HR.'), /^Les pointages sont gardés 5 ans, puis effacés\./);
  assert.match(enFrancais('Online, your position is read once, on the click, to check that you are in a clock-in zone: only the result (in the zone, outside the zone…) is kept, never the position. You may refuse: the clock-in is recorded anyway, and is sent at the latest 10 seconds after the click.'), /part au plus tard 10 secondes après le clic\.$/);
  assert.match(enFrancais('A request is made within 7 days. Once approved, it adds the missed clock-in or removes the wrong one; the timesheet of an already approved week goes through its reopening first.'), /^Une demande se fait sous 7 jours\./);
  assert.equal(enFrancais('Request approved by your manager (or their deputy) or by HR, within 7 days of the clock-in.'), 'Demande validée par votre manager (ou son suppléant) ou par le service RH, sous 7 jours après le pointage.');
});

test('libellés des tables d’états des pointages : chacun a sa traduction', async () => {
  const { PRESENCES, STATUTS_CORRECTION } = await import('../client/src/components/temps/pointage-etat.ts');
  for (const l of [...Object.values(PRESENCES), ...Object.values(STATUTS_CORRECTION)].map(x => x.label)) {
    assert.ok(MEMES_EN_FRANCAIS.includes(l) || enFrancais(l) !== sansContexte(l), l);
  }
});

test('Habilitations et composants communs : règles à paramètres, tables de libellés, phrase française d’avant', async () => {
  assert.equal(enFrancais('Show 50 more'), 'Afficher 50 de plus');
  assert.equal(enFrancais('Whole number, at least 1.'), 'Nombre entier, au moins 1.');
  assert.equal(enFrancais('Remove “arrêt de travail (1).pdf” from the file?'), 'Retirer « arrêt de travail (1).pdf » du dossier ?');
  const { MODELE_TITRE_COURT } = await import('../client/src/titre-habilitation.ts');
  for (const l of Object.values(MODELE_TITRE_COURT)) assert.ok(enFrancais(l) !== l, l);
  // Tables du dialogue de mesure (titres, boutons) : chaque valeur a sa traduction.
  const mesure = lire('client/src/dialogs/HabMesureDialog.tsx');
  const valeurs = [...mesure.matchAll(/(?:suspendre|lever|retirer): '([^']+)'/g)].map(m => m[1]);
  assert.equal(valeurs.length, 6);
  for (const l of valeurs) assert.ok(enFrancais(l) !== l, l);
  const { titreTri } = await import('../client/src/components/tri.ts');
  choisirLangue('en');
  assert.equal(titreTri(null, 'nom'), 'Sort by this column');
  assert.equal(tn(2, 'current title', 'current titles'), '2 current titles');
});

test('Expositions (C2P) : règles à paramètres, la phrase française d’avant', () => {
  assert.equal(enFrancais('120 nights a year, pro rata'), '120 nuits par an, au prorata');
  assert.equal(enFrancais('Their nights count as night work (threshold of 120) in the meantime.'), 'Leurs nuits comptent au travail de nuit (seuil de 120) en attendant.');
  assert.equal(enFrancais('No employee exposed in 2026, nor any night under a schedule to qualify.'), 'Aucun salarié exposé en 2026, ni de nuit sous un horaire à qualifier.');
  assert.equal(enFrancais('thresholds pro rata (42 % of the year)'), 'seuils au prorata (42 % de l’année)');
  const note = enFrancais('A night counts when the shift includes at least 1 h of work between 0:00 and 5:00 (art. D4163-2), from the shift schedule frozen on the approved timesheet: Cursus only counts the nights from shift schedules, a timesheet without a schedule counts no night. Nights worked under a schedule qualified “alternating successive shifts” (Reference data → Schedules) count towards the threshold of 50 nights, the others towards that of 120; regulatory thresholds, not adjustable, pro rata for a contract of less than a year; a contract of less than a month is not declared. Repetitive work, hyperbaric environment, extreme temperatures and noise are ticked on the job (Reference data → Jobs) when its holders are exposed to them beyond the threshold after protection. The export lists the lines to enter in Sage’s DSN with Cursus’s internal codes and the presumed DSN code, to be confirmed by payroll.');
  assert.match(note, /^Une nuit compte quand le poste comprend au moins 1 h de travail entre 0 h et 5 h \(art\. D4163-2\),/);
  assert.match(note, /comptent au seuil de 50 nuits, les autres à celui de 120 ; seuils/);
  assert.equal(enFrancais('Settings → Privacy'), 'Paramètres → Confidentialité', 'segments');
});

test('Formations, Congés & absences : tables de libellés traduites au rendu, phrase française d’avant', async () => {
  const { FILTRES_STATUT, FILTRES_TYPE, FILTRES_PERIODE } = await import('../client/src/pages/absences-filtres.ts');
  const { FILTRES_ELEARNING } = await import('../client/src/components/organismes/etat.ts');
  const { PAIE_COURT } = await import('../client/src/pages/Absences.tsx');
  for (const l of [...FILTRES_STATUT, ...FILTRES_TYPE, ...FILTRES_PERIODE, ...FILTRES_ELEARNING].map(([, x]) => x).concat(Object.values(PAIE_COURT))) {
    assert.ok(enFrancais(l) !== sansContexte(l), l);
  }
  assert.deepEqual([enFrancais('paid#fem'), enFrancais('Approved or qualified#fem-plural'), enFrancais('Completions to approve')], ['payée', 'Validées ou qualifiées', 'Fins à valider']);
  // Contexte suivi d'un blanc : le blanc reste en anglais (« 2025 and 2026 »).
  choisirLangue('en');
  assert.deepEqual([t(' and #et'), t(' on #le'), t('Cancelled on #fem'), t('Save #verb')], [' and ', ' on ', 'Cancelled on ', 'Save ']);
  assert.equal(tn(2, 'place left', 'places left'), '2 places left');
});

test('Notes de frais : tables de libellés traduites à la lecture, phrase française d’avant', async () => {
  const { STATUTS_AVANCE, nomNote } = await import('../client/src/components/frais/commun.ts');
  const { LIBELLES_ONGLETS_FRAIS, SOURCES_ONGLETS_FRAIS } = await import('../client/src/components/frais/onglets.ts');
  for (const l of [...Object.values(STATUTS_AVANCE).map(x => x.label), ...Object.values(SOURCES_ONGLETS_FRAIS).filter(Boolean)]) {
    assert.ok(MEMES_EN_FRANCAIS.includes(l) || enFrancais(l) !== sansContexte(l), l);
  }
  assert.deepEqual([LIBELLES_ONGLETS_FRAIS.historique, LIBELLES_ONGLETS_FRAIS.controle], ['Historique', 'À contrôler']);
  assert.equal(enFrancais('24 months at most per search.'), '24 mois au plus par recherche.');
  assert.equal(nomNote({ id: 12, periode: '2026-10', medicale: true }), 'Note n° 12 — Octobre 2026 · frais médicaux');
  assert.equal(t('?#question'), ' ?');
  const { MARQUE } = await import('../client/src/pages/planning-missions.ts');
  assert.deepEqual({ ...MARQUE }, { mission: 'M', absence: 'A', demande: 'D', ferie: 'F', present: '' });
  choisirLangue('en');
  assert.deepEqual([MARQUE.demande, MARQUE.ferie], ['R', 'H']);
  assert.deepEqual([LIBELLES_ONGLETS_FRAIS.historique, LIBELLES_ONGLETS_FRAIS.controle, t('?#question')], ['History', 'To check', '?']);
});

test('partie 6 (annuaire, organigramme, entretiens, personnes sur site, relevés, chantiers) : la phrase française d’avant, contextes départagés', () => {
  assert.deepEqual([t('Closed#fem'), t(' of #date'), t(' of '), t('Set#objective'), t('on #date')], ['Fermée', ' du ', ' sur ', 'Fixé', 'le ']);
  assert.deepEqual([tn(3, 'other', 'others'), tn(1, 'refusal', 'refusals'), tn(2, 'refusal', 'refusals'), tn(2, 'timesheet approved', 'timesheets approved')],
    ['3 autres', '1 refus', '2 refus', '2 feuilles validées']);
  assert.equal(`${t('Collection closed on ')}12/11/2026${t(': ')}${tn(2, 'answer received', 'answers received')}`, 'Collecte close le 12/11/2026 : 2 réponses reçues');
  choisirLangue('en');
  assert.deepEqual([t('Organisation chart'), t('Closed#fem'), t(' of #date'), tn(1, 'person', 'people'), tn(2, 'person', 'people')],
    ['Organisation chart', 'Closed', ' of ', '1 person', '2 people']);
});
