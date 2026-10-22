// Conservation des dossiers des salariés sortis (t016, règles : shared/rules/conservation.ts). Décision de l'entreprise :
// « Cursus propose, le RH confirme ». Ce module :
// - repère les dossiers dont une durée est échue (`dossiersEchus`), pour l'écran Paramètres → Conservation des dossiers ;
// - efface, sur la confirmation de l'administrateur RH (`employe.anonymiser`), les données échues d'une catégorie, puis, à
//   l'échéance du dossier, anonymise la fiche en cascade (`effacerDossier`) : chaque colonne qui désigne un salarié
//   (REFERENCES de server/src/integrite.ts, et non le seul nom `empId`) a son traitement (TRAITEMENTS), vérifié par
//   tests/conservation.test.ts ; le nom et les adresses sont ensuite retirés des colonnes de texte de la base (journal,
//   file d'envoi, comptes rendus de reprise…), occurrence délimitée par occurrence délimitée, sans jamais toucher à la
//   fiche ni au compte d'un autre salarié (réembauche, homonyme) ;
// - signale chaque jour au service RH les dossiers échus (`verifierConservation`), sans rien effacer de lui-même.
// Les sauvegardes gardent les données effacées jusqu'à leur rotation (docs/SAUVEGARDE.md).
import { fmtIso, plural } from '../../shared/format.ts';
import { CATEGORIES, CATEGORIES_CONSERVATION, categoriesEchues, conservationActive, nomAnonyme } from '../../shared/rules/conservation.ts';
import type { CategorieConservation, DossierEchu, Employe, ISODate, Settings } from '../../shared/types.ts';
import { journaliser } from './comptes.ts';
import { loadSettings, todayIso } from './dataset.ts';
import { snake, TABLES, type Db } from './db.ts';
import { log } from './logs.ts';
import { lireMessagerie } from './messagerie.ts';
import { nettoyerBientot } from './pieces.ts';

/**
 * Traitement de chaque référence à un salarié (clé « table.colonne » de REFERENCES) :
 * - `lignes` : lignes supprimées à l'échéance de la catégorie (le dossier les emporte toutes) ;
 * - `textes` : lignes gardées (agrégats sans nom une fois la fiche anonymisée), textes libres vidés ;
 * - `gardee` : ligne gardée telle quelle (agrégat non nominatif, trace de l'effacement) ;
 * - `compte`, `pieces` : traitement propre (compte fermé ; pièces retirées, fichiers effacés) ;
 * - `auteur` : auteur d'une ligne d'un autre salarié, gardé ; son nom est retiré par le balayage des textes ;
 * - `detachee` : référence retirée (manager d'une équipe).
 * Une référence ajoutée à REFERENCES sans traitement fait échouer tests/conservation.test.ts.
 */
export type Traitement =
  | { mode: 'lignes' | 'textes'; categorie: CategorieConservation }
  | { mode: 'gardee' | 'compte' | 'pieces' | 'auteur' | 'detachee' };
export const TRAITEMENTS: Record<string, Traitement> = {
  'demandes_visite.emp_id': { mode: 'lignes', categorie: 'sante' },
  'vaccinations.emp_id': { mode: 'lignes', categorie: 'sante' },
  'visas.emp_id': { mode: 'lignes', categorie: 'passeport' },
  'entretiens.emp_id': { mode: 'lignes', categorie: 'entretiens' },
  'demandes_collab.emp_id': { mode: 'lignes', categorie: 'dossier' },
  'notifications.emp_id': { mode: 'lignes', categorie: 'dossier' },
  'verdicts_keystone.emp_id': { mode: 'lignes', categorie: 'dossier' },
  'jetons_agenda.emp_id': { mode: 'lignes', categorie: 'dossier' },
  'certifications.emp_id': { mode: 'textes', categorie: 'formations' },
  'hab_titres.emp_id': { mode: 'textes', categorie: 'formations' },
  'feuilles.emp_id': { mode: 'textes', categorie: 'temps' },
  'absences.emp_id': { mode: 'textes', categorie: 'temps' },
  'reports.emp_id': { mode: 'textes', categorie: 'temps' },
  'clotures.emp_id': { mode: 'textes', categorie: 'temps' },
  'voyages.emp_id': { mode: 'textes', categorie: 'dossier' },
  'demandes_keystone.emp_id': { mode: 'textes', categorie: 'dossier' },
  'contrats_historique.emp_id': { mode: 'textes', categorie: 'dossier' },
  'inscriptions.emp_id': { mode: 'gardee' },
  'participations.emp_id': { mode: 'gardee' },
  'missions.emp_id': { mode: 'gardee' },
  'taches.emp_id': { mode: 'gardee' },
  'mandats.emp_id': { mode: 'gardee' },
  'cet.emp_id': { mode: 'gardee' },
  'soldes_reprise.emp_id': { mode: 'gardee' },
  'informations_cp.emp_id': { mode: 'gardee' },
  'soldes_sortie.emp_id': { mode: 'gardee' },
  'deplacements_paie.emp_id': { mode: 'gardee' },
  'effacements.emp_id': { mode: 'gardee' },
  'comptes.emp_id': { mode: 'compte' },
  'pieces.emp_id': { mode: 'pieces' },
  'contrats_historique.par_id': { mode: 'auteur' },
  'demandes_collab.par_id': { mode: 'auteur' },
  'equipes.manager_id': { mode: 'detachee' },
};

/**
 * Une étape d'effacement : lignes visées (`ou`, chaque « ? » reçoit l'identifiant du salarié), supprimées, ou dont les
 * colonnes `vider` passent à NULL et les colonnes `poser` reçoivent une valeur (liée) ou une expression SQL (`sql`).
 */
interface Etape { table: string; ou: string; supprimer?: true; vider?: readonly string[]; poser?: Record<string, unknown>; sql?: Record<string, string> }

/** Pièces retirées (fichier effacé après la validation, description gardée). */
const retrait = (cx: Cx, ou: string): Etape => ({ table: 'pieces', ou: `${ou} AND retiree_le IS NULL`, poser: { retiree_le: cx.le, retiree_par: cx.par, retiree_motif: 'Durée de conservation échue' } });
/** Déclarations d'un document (passeport, visa, vaccin) faites par le salarié. */
const declarations = (kinds: string) => `emp_id = ? AND type = 'document' AND json_extract(declaration, '$.kind') IN (${kinds})`;

/** Contexte d'un effacement : jour, auteur. */
export interface Cx { ti: ISODate; le: string; par: string }

/** Étapes propres à chaque catégorie, dans l'ordre (les pièces d'un objet avant l'objet). */
function etapes(cat: CategorieConservation, cx: Cx, empId: number): Etape[] {
  switch (cat) {
    case 'passeport': return [
      retrait(cx, `emp_id = ? AND objet = 'declaration' AND objet_id IN (SELECT id FROM demandes_collab WHERE ${declarations(`'passeport', 'visa'`)})`),
      { table: 'demandes_collab', ou: declarations(`'passeport', 'visa'`), supprimer: true },
      { table: 'visas', ou: 'emp_id = ?', supprimer: true },
      { table: 'employes', ou: 'id = ?', vider: ['passeport_numero', 'passeport_expire'] },
    ];
    case 'sante': return [
      retrait(cx, `emp_id = ? AND objet = 'declaration' AND objet_id IN (SELECT id FROM demandes_collab WHERE ${declarations(`'vaccin'`)})`),
      { table: 'demandes_collab', ou: declarations(`'vaccin'`), supprimer: true },
      { table: 'vaccinations', ou: 'emp_id = ?', supprimer: true },
      { table: 'demandes_visite', ou: 'emp_id = ?', supprimer: true },
      { table: 'employes', ou: 'id = ?', vider: ['visite', 'avis', 'restrictions', 'suivi', 'prochaine_visite', 'examen_aptitude', 'expose', 'reprise_motif', 'reprise_date'] },
    ];
    case 'titreSejour': return [{ table: 'employes', ou: 'id = ?', vider: ['autorisation_travail'] }];
    case 'entretiens': return [{ table: 'entretiens', ou: 'emp_id = ?', supprimer: true }];
    case 'temps': return [
      retrait(cx, `emp_id = ? AND objet = 'absence'`),
      { table: 'feuilles', ou: 'emp_id = ?', vider: ['comment', 'motif_depassement'] },
      { table: 'absences', ou: 'emp_id = ?', vider: ['motif_refus'] },
      { table: 'reports', ou: 'emp_id = ?', vider: ['motif'] },
      { table: 'clotures', ou: 'emp_id = ?', vider: ['motif'] },
    ];
    case 'formations': return [
      retrait(cx, `emp_id = ? AND objet IN ('certification', 'habTitre')`),
      { table: 'certifications', ou: 'emp_id = ?', vider: ['corrige_motif', 'annule_motif'] },
      { table: 'hab_titres', ou: 'emp_id = ?', vider: ['mesure_motif'] },
      { table: 'demandes_collab', ou: `emp_id = ? AND type IN ('formation', 'habilitation')`, supprimer: true },
    ];
    case 'paie': return [];
    case 'dossier': return [
      // Pièces restantes (déplacements, autres déclarations) retirées, et leur nom d'origine, qui peut nommer la personne.
      retrait(cx, 'emp_id = ?'),
      { table: 'pieces', ou: `emp_id = ? AND nom NOT LIKE 'piece-%'`, sql: { nom: `'piece-' || id` } },
      { table: 'demandes_collab', ou: 'emp_id = ?', supprimer: true },
      { table: 'notifications', ou: 'emp_id = ?', supprimer: true },
      { table: 'verdicts_keystone', ou: 'emp_id = ?', supprimer: true },
      { table: 'jetons_agenda', ou: 'emp_id = ?', supprimer: true },
      { table: 'voyages', ou: 'emp_id = ?', vider: ['motif', 'hebergement', 'contact_sur_place', 'annule_motif', 'demandeur'] },
      { table: 'demandes_keystone', ou: 'emp_id = ?', vider: ['motif_refus'] },
      { table: 'contrats_historique', ou: 'emp_id = ?', vider: ['reference'] },
      { table: 'equipes', ou: 'manager_id = ?', vider: ['manager_id'] },
      // Compte de connexion fermé : sessions supprimées, identité retirée (l'identifiant unique devient « anonyme-<n°> »).
      { table: 'connexions', ou: 'compte_id IN (SELECT id FROM comptes WHERE emp_id = ?)', supprimer: true },
      // Identifiant de connexion noté au journal : celui du compte fermé (un identifiant local n'est pas balayé, ci-dessous).
      { table: 'journal', ou: `compte_id IN (SELECT id FROM comptes WHERE emp_id = ?) AND identifiant IS NOT NULL AND identifiant NOT LIKE 'anonyme-%'`, sql: { identifiant: `'anonyme-' || compte_id` } },
      {
        table: 'comptes', ou: `emp_id = ? AND identifiant NOT LIKE 'anonyme-%'`, vider: ['nom', 'adresse', 'oid', 'mot_de_passe', 'blocage_fin'],
        poser: { actif: 0, changer_mot_de_passe: 0 }, sql: { identifiant: `'anonyme-' || id` },
      },
      // Fiche : identité neutre ; l'année de naissance, le poste, l'équipe et le contrat restent (agrégats sans nom).
      {
        table: 'employes', ou: 'id = ? AND anonymise_le IS NULL',
        vider: ['email', 'naissance_le', 'matricule_paie', 'urgence_nom', 'urgence_tel', 'derogation_travaux_le'],
        poser: { nom: nomAnonyme(empId), anonymise_le: cx.ti },
      },
    ];
  }
}

/** Valeur considérée comme vide (rien à effacer) : NULL, chaîne vide, liste vide, case décochée. */
const renseignee = (c: string) => `(${c} IS NOT NULL AND ${c} NOT IN ('', '[]', 0))`;
const lier = (ou: string, empId: number) => Array.from({ length: (ou.match(/\?/g) ?? []).length }, () => empId);

/** Lignes ou valeurs qu'une étape effacerait encore. */
function compter(db: Db, e: Etape, empId: number): number {
  const reste = e.vider && !e.poser && !e.sql ? ` AND (${e.vider.map(renseignee).join(' OR ')})` : '';
  return Number((db.sql.prepare(`SELECT COUNT(*) AS n FROM ${e.table} WHERE ${e.ou}${reste}`).get(...lier(e.ou, empId)) as { n: number }).n);
}

function appliquer(db: Db, e: Etape, empId: number): number {
  if (e.supprimer) return Number(db.sql.prepare(`DELETE FROM ${e.table} WHERE ${e.ou}`).run(...lier(e.ou, empId)).changes);
  const n = compter(db, e, empId);
  if (!n) return 0;
  const sets = [...(e.vider ?? []).map(c => `${c} = NULL`), ...Object.keys(e.poser ?? {}).map(c => `${c} = ?`), ...Object.entries(e.sql ?? {}).map(([c, x]) => `${c} = ${x}`)];
  db.sql.prepare(`UPDATE ${e.table} SET ${sets.join(', ')} WHERE ${e.ou}`).run(...Object.values(e.poser ?? {}) as (string | number)[], ...lier(e.ou, empId));
  return n;
}

const cxNeutre = (ti: ISODate): Cx => ({ ti, le: '', par: '' });

/** Données d'une catégorie partielle encore présentes (lignes et valeurs). */
export function aEffacer(db: Db, empId: number, cat: CategorieConservation): number {
  return etapes(cat, cxNeutre(''), empId).reduce((n, e) => n + compter(db, e, empId), 0);
}

/**
 * Dossiers proposés à l'effacement : salariés sortis, non anonymisés, dont une catégorie qui a encore des données est
 * échue (une catégorie déjà effacée revient si des données y ont été saisies depuis), ou dont le dossier est échu. Vide
 * tant que la fonction n'est pas activée avec la décision du DPO.
 */
export function dossiersEchus(db: Db, s: Settings = loadSettings(db), ti: ISODate = todayIso()): DossierEchu[] {
  if (!conservationActive(s)) return [];
  const sortis = db.sql.prepare('SELECT id, fin FROM employes WHERE fin IS NOT NULL AND fin < ? AND anonymise_le IS NULL ORDER BY fin, id').all(ti) as { id: number; fin: string }[];
  const out: DossierEchu[] = [];
  for (const e of sortis) {
    const r = categoriesEchues(e, s, ti, c => aEffacer(db, e.id, c) > 0);
    if (!r) continue;
    const elements = r.categories.reduce((n, c) => n + aEffacer(db, e.id, c), 0);
    out.push({ empId: e.id, fin: e.fin, categories: r.categories, dossier: r.dossier, elements });
  }
  return out;
}

// — Retrait de l'identité des textes de la base —

/**
 * Termes d'identité retirés des textes : nom et adresses e-mail de la fiche et des comptes. L'identifiant de connexion
 * n'est retenu que s'il est une adresse complète : un identifiant local (« marc », « paie ») est souvent un mot courant.
 * Un terme sans espace ni « @ » (nom d'un seul mot) doit avoir 8 caractères au moins, les autres 4.
 */
function identite(db: Db, empId: number): string[] {
  const e = db.get<Employe>('employes', empId);
  const comptes = db.sql.prepare('SELECT nom, adresse, identifiant FROM comptes WHERE emp_id = ?').all(empId) as { nom: string | null; adresse: string | null; identifiant: string | null }[];
  return [...new Set([e?.nom, e?.email, ...comptes.flatMap(c => [c.nom, c.adresse, c.identifiant?.includes('@') ? c.identifiant : null])]
    .filter((t): t is string => typeof t === 'string').map(t => t.trim())
    .filter(t => t.length >= (/[\s@]/.test(t) ? 4 : 8)))]
    .filter(t => !t.startsWith('anonyme-') && !t.startsWith('Salarié anonymisé'))
    .sort((a, b) => b.length - a.length);
}

/**
 * Hors balayage : la fiche et les comptes des autres salariés (seules les lignes du salarié visé sont balayées : une
 * réembauche ou un homonyme garde son nom et son adresse), les réglages de l'application (codes, boîtes partagées) et le
 * nom de l'action au journal (code).
 */
const LIGNES_DU_SALARIE: Partial<Record<string, string>> = { employes: 'id', comptes: 'emp_id' };
const TABLES_EXCLUES = new Set(['settings']);
const COLONNES_EXCLUES = new Set(['journal.action']);

const echapper = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Occurrence délimitée d'un terme, sans tenir compte de la casse : ni précédée ni suivie d'une lettre, d'un chiffre, de
 * « _ », « - », « @ » ou « . » (un point final de phrase, suivi d'une espace ou de la fin, reste un séparateur).
 * « Jean Martin » ne touche ni « Jean Martineau » ni « jean.martin@… ».
 */
export const motifTerme = (t: string) => new RegExp(`(?<![\\p{L}\\p{N}_@.-])${echapper(t)}(?![\\p{L}\\p{N}_@-]|\\.[\\p{L}\\p{N}])`, 'giu');

/**
 * Balayage : chaque occurrence délimitée d'un terme est remplacée par le nom neutre dans les colonnes de texte et JSON du
 * schéma (journal des actions et son auteur, file d'envoi, notifications, comptes rendus de reprise, auteurs nommés dans
 * d'autres dossiers, motif de la trace de l'effacement…). Les lignes candidates sont repérées en SQL, le remplacement
 * borné est fait ici. Renvoie le nombre de valeurs modifiées.
 */
export function retirerIdentite(db: Db, empId: number, termes: readonly string[], neutre: string): number {
  if (!termes.length) return 0;
  let n = 0;
  for (const [table, def] of Object.entries(TABLES) as [string, { cols: Record<string, string> }][]) {
    const t = snake(table);
    if (TABLES_EXCLUES.has(t)) continue;
    const borne = LIGNES_DU_SALARIE[t];
    for (const [col, type] of Object.entries(def.cols)) {
      const c = snake(col);
      if ((type !== 'text' && type !== 'json') || COLONNES_EXCLUES.has(`${t}.${c}`)) continue;
      // JSON : le terme aussi tel qu'il est écrit dans une chaîne JSON (guillemets et barres obliques échappés).
      const formes = [...new Set(termes.flatMap(x => [x, ...(type === 'json' ? [JSON.stringify(x).slice(1, -1)] : [])]))].sort((a, b) => b.length - a.length);
      const lignes = db.sql.prepare(`SELECT rowid AS r, ${c} AS v FROM ${t} WHERE (${formes.map(() => `instr(lower(${c}), lower(?)) > 0`).join(' OR ')})${borne ? ` AND ${borne} = ?` : ''}`)
        .all(...formes, ...(borne ? [empId] : [])) as { r: number; v: string }[];
      for (const l of lignes) {
        const v = formes.reduce((x, f) => x.replace(motifTerme(f), neutre), l.v);
        if (v === l.v) continue;
        db.sql.prepare(`UPDATE ${t} SET ${c} = ? WHERE rowid = ?`).run(v, l.r);
        n++;
      }
    }
  }
  return n;
}

/**
 * Efface les catégories données (partielles, et le dossier : anonymisation complète, qui reprend les étapes de toutes
 * les catégories, idempotentes, y compris celles déjà effacées où des données sont revenues) et trace l'effacement
 * (table `effacements`, écrite avant le balayage : un motif qui nomme le salarié ne garde pas son nom). Dans la
 * transaction de l'action ; les fichiers des pièces sont effacés après sa validation. Renvoie le nombre d'éléments effacés.
 */
export function effacer(db: Db, empId: number, categories: readonly CategorieConservation[], cx: Cx, o: { motif: string; avantEcheance: boolean }): number {
  const dossier = categories.includes('dossier');
  const liste = dossier ? [...CATEGORIES.filter(c => c !== 'dossier'), 'dossier' as const] : categories.filter(c => c !== 'dossier');
  const termes = dossier ? identite(db, empId) : [];
  let elements = 0;
  for (const c of liste) for (const e of etapes(c, cx, empId)) elements += appliquer(db, e, empId);
  db.insert('effacements', { empId, categories: liste, le: cx.le, par: cx.par, motif: o.motif, avantEcheance: o.avantEcheance, elements });
  if (dossier) retirerIdentite(db, empId, termes, nomAnonyme(empId));
  nettoyerBientot(db);
  return elements;
}

// — Signalement quotidien au service RH (aucun effacement) —

/** Réglages : jour du dernier passage, et dossiers déjà signalés (identifiants), pour ne signaler que les nouveaux. */
const VERIFIEE_LE = 'conservationVerifieeLe', SIGNALES = 'conservationSignales';

/**
 * Une fois par jour : dossiers échus calculés ; s'il en apparaît de nouveaux, notification à la boîte du service RH (dans
 * son récapitulatif quotidien) et ligne au journal, sans nom (nombre et identifiants). Rien n'est effacé. Renvoie le
 * nombre de dossiers échus, null si le passage du jour est déjà fait.
 */
export function verifierConservation(db: Db, ti: ISODate = todayIso()): number | null {
  if (db.getSetting<string | null>(VERIFIEE_LE, null) === ti) return null;
  return db.tx(() => {
    db.setSetting(VERIFIEE_LE, ti);
    const echus = dossiersEchus(db, loadSettings(db), ti);
    const signales = new Set(db.getSetting<number[]>(SIGNALES, []));
    const nouveaux = echus.filter(d => !signales.has(d.empId));
    db.setSetting(SIGNALES, echus.map(d => d.empId));
    if (!nouveaux.length) return echus.length;
    const rh = lireMessagerie(db).rh;
    const texte = `${plural(echus.length, 'dossier de salarié sorti a', 'dossiers de salariés sortis ont')} une durée de conservation échue `
      + `(${plural(nouveaux.length, 'nouveau', 'nouveaux')} depuis le dernier signalement). Cursus n’efface rien de lui-même : l’administrateur RH les examine `
      + 'et confirme chaque effacement dans Paramètres → Conservation des dossiers.';
    if (rh) {
      db.insert('notifications', { empId: null, adresse: rh, type: 'conservation.echus', objet: 'Dossiers de salariés sortis à effacer', texte, creation: new Date().toISOString(), envoiId: null });
    }
    journaliser(db, {
      actor: 'Cursus', role: null, action: 'conservation.signalement', message: `Conservation des dossiers au ${fmtIso(ti)} : ${texte.split(' (')[0]}`,
      payload: { echus: echus.length, nouveaux: nouveaux.map(d => d.empId) }, salaries: nouveaux.map(d => d.empId),
    });
    return echus.length;
  });
}

/** Au démarrage puis toutes les heures (un passage par jour) ; renvoie la fonction d'arrêt (server/src/index.ts). */
export function demarrerConservation(db: Db): () => void {
  const passer = () => {
    try { verifierConservation(db); } catch (err) { log.erreur(`Conservation des dossiers : ${err instanceof Error ? err.message : err}`); }
  };
  passer();
  const t = setInterval(passer, 3600_000);
  t.unref();
  return () => clearInterval(t);
}

/** Libellé d'une catégorie (messages). */
export const libelleCategorie = (c: CategorieConservation) => CATEGORIES_CONSERVATION[c].label;
