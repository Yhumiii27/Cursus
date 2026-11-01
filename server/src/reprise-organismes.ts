// Reprise sans perte des organismes de formation saisis en texte libre (lot 12, chantier C4, t190) : une étape TypeScript
// unique, commune aux deux moteurs, lancée après les migrations à chaque démarrage (server/src/demarrage.ts) et après le
// chargement de la démonstration (server/src/seed.ts). Elle est idempotente : `necessaire` ne la lance que s'il reste un
// texte sans fiche ou un objet sans organisme que sa formation désigne ; un second passage ne change rien.
// 1. Textes distincts de `formations.organisme`, `formations_suivies.organisme` et `certifications.organisme` (cette
//    dernière saisie par Vigie sur le serveur commun, alignée en SQLite au lot 12) : vides et « Organisme non renseigné »
//    écartés (jamais une fiche).
// 2. Clé de rapprochement par norm() (`cleOrganisme` : casse, accents, ponctuation, formes juridiques) ; « Interne · … »
//    devient une fiche de type interne, à part (sa clé ne rejoint jamais un organisme externe).
// 3. SIRET, déclaration d'activité et Qualiopi des dossiers OPCO (ligne du plan → formation → texte) : repris seulement
//    s'ils concordent ; jamais de rapprochement de deux textes de même clé dont les dossiers portent des SIRET différents
//    (une fiche par SIRET, plus une pour les textes sans SIRET, toutes « à vérifier » : conflit compté).
// 4. Une fiche par groupe (nom le plus fréquent, `source` « reprise », `a_verifier`, alias = toutes les graphies vues), ou
//    la fiche existante de même clé (SIRET compatible), qui reçoit les nouvelles graphies en alias.
// 5. Pose des `organisme_id` encore vides : formations et formations suivies d'après leur texte, puis sessions, lignes du
//    plan et dossiers OPCO d'après leur formation (les sessions passées reçoivent celui du catalogue, seule information
//    disponible), formations suivies sans texte d'après leur formation. Aucun texte d'origine n'est modifié ni effacé.
// 6. Journal `migration.organismes` : compteurs seulement (jamais un nom, un SIRET ou un alias).
// Ensuite, l'écran « À vérifier » confirme chaque fiche (`organisme.verifier`) ou fusionne les doublons
// (`organisme.fusionner`, administrateur RH, motif).
import { plural } from '../../shared/format.ts';
import { ndaValide, siretValide } from '../../shared/rules/opco.ts';
import { cleOrganisme, clesFiche, codePropose, estInterne, graphieDominante, NOM_ORGANISME_MAX, texteOrganisme } from '../../shared/rules/organismes.ts';
import type { Organisme } from '../../shared/types-organismes.ts';
import { journaliser } from './comptes.ts';
import type { Db } from './db.ts';

/** Auteur des fiches créées par la reprise. */
export const AUTEUR_REPRISE = 'Cursus (reprise)';

/** Compteurs de la reprise, seuls recopiés au journal. */
export interface BilanRepriseOrganismes {
  fiches: number; rattachements: number; alias: number; conflits: number; siret: number; nda: number; qualiopi: number;
}

type Ligne = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

/** Lignes qui désignent leur organisme par leur formation (catalogue) : propagation de son `organisme_id`. */
const PROPAGATIONS: readonly { table: string; ou: string; sql: string }[] = [
  {
    table: 'sessions', ou: 's.organisme_id IS NULL AND f.organisme_id IS NOT NULL',
    sql: 'UPDATE sessions SET organisme_id = (SELECT f.organisme_id FROM formations f WHERE f.id = sessions.formation) WHERE organisme_id IS NULL AND formation IN (SELECT id FROM formations WHERE organisme_id IS NOT NULL)',
  },
  {
    table: 'plan_actions', ou: 'p.organisme_id IS NULL AND f.organisme_id IS NOT NULL',
    sql: 'UPDATE plan_actions SET organisme_id = (SELECT f.organisme_id FROM formations f WHERE f.id = plan_actions.f) WHERE organisme_id IS NULL AND f IN (SELECT id FROM formations WHERE organisme_id IS NOT NULL)',
  },
  {
    table: 'formations_suivies', ou: 'x.organisme_id IS NULL AND (x.organisme IS NULL OR x.organisme = \'\') AND f.organisme_id IS NOT NULL',
    sql: `UPDATE formations_suivies SET organisme_id = (SELECT f.organisme_id FROM formations f WHERE f.id = formations_suivies.f)
      WHERE organisme_id IS NULL AND (organisme IS NULL OR organisme = '') AND f IN (SELECT id FROM formations WHERE organisme_id IS NOT NULL)`,
  },
  {
    table: 'dossiers_opco', ou: 'd.organisme_id IS NULL AND p.organisme_id IS NOT NULL',
    sql: 'UPDATE dossiers_opco SET organisme_id = (SELECT p.organisme_id FROM plan_actions p WHERE p.id = dossiers_opco.plan_action_id) WHERE organisme_id IS NULL AND plan_action_id IN (SELECT id FROM plan_actions WHERE organisme_id IS NOT NULL)',
  },
];
/** Requêtes de comptage de ce qui reste à propager (`necessaire`). */
const RESTE: readonly string[] = [
  'SELECT COUNT(*) AS n FROM sessions s JOIN formations f ON f.id = s.formation WHERE s.organisme_id IS NULL AND f.organisme_id IS NOT NULL',
  'SELECT COUNT(*) AS n FROM plan_actions p JOIN formations f ON f.id = p.f WHERE p.organisme_id IS NULL AND f.organisme_id IS NOT NULL',
  `SELECT COUNT(*) AS n FROM formations_suivies x JOIN formations f ON f.id = x.f WHERE x.organisme_id IS NULL AND (x.organisme IS NULL OR x.organisme = '') AND f.organisme_id IS NOT NULL`,
  'SELECT COUNT(*) AS n FROM dossiers_opco d JOIN plan_actions p ON p.id = d.plan_action_id WHERE d.organisme_id IS NULL AND p.organisme_id IS NOT NULL',
];

/** Texte libre à rattacher : formation du catalogue, formation suivie ou certification (cette dernière sans colonne de fiche). */
interface Occurrence { table: 'formations' | 'formations_suivies' | 'certifications'; id: string | number | null; texte: string; cle: string; formation: string | null }

/** Textes encore sans fiche (formations, formations suivies), et textes des certifications (comparés aux clés des fiches). */
async function occurrences(db: Db): Promise<Occurrence[]> {
  const out: Occurrence[] = [];
  const ajouter = (table: Occurrence['table'], id: Occurrence['id'], v: unknown, formation: string | null) => {
    const texte = texteOrganisme(v);
    const cle = texte ? cleOrganisme(texte) : '';
    if (texte && cle) out.push({ table, id, texte, cle, formation });
  };
  for (const f of await db.query<Ligne>('SELECT id, organisme FROM formations WHERE organisme_id IS NULL ORDER BY id')) ajouter('formations', String(f.id), f.organisme, String(f.id));
  for (const x of await db.query<Ligne>('SELECT id, organisme FROM formations_suivies WHERE organisme_id IS NULL ORDER BY id')) ajouter('formations_suivies', n(x.id), x.organisme, null);
  for (const c of await db.query<Ligne>('SELECT DISTINCT organisme FROM certifications WHERE organisme IS NOT NULL ORDER BY organisme')) ajouter('certifications', null, c.organisme, null);
  return out;
}

/** Fiches non fusionnées et leurs clés (nom usuel et alias). */
async function fiches(db: Db): Promise<{ o: Organisme; cles: Set<string> }[]> {
  return (await db.all<Organisme>('organismes', 'id')).filter(o => o.fusionneDans == null).map(o => ({ o, cles: clesFiche(o) }));
}

/** Vrai s'il reste un texte sans fiche ou un objet dont la formation désigne une fiche sans qu'il la porte. */
export async function repriseNecessaire(db: Db): Promise<boolean> {
  const occ = await occurrences(db);
  if (occ.some(o => o.table !== 'certifications')) return true;
  if (occ.length) {
    const connues = new Set((await fiches(db)).flatMap(f => [...f.cles]));
    if (occ.some(o => !connues.has(o.cle))) return true;
  }
  for (const sql of RESTE) if (n((await db.one<Ligne>(sql))?.n) > 0) return true;
  return false;
}

/** Valeurs des dossiers OPCO (actifs) d'une formation du catalogue : SIRET, déclaration d'activité et Qualiopi déclarés. */
interface Declare { sirets: Set<string>; ndas: Set<string>; qualiopi: boolean[] }
async function declaresParFormation(db: Db): Promise<Map<string, Declare>> {
  const m = new Map<string, Declare>();
  const lignes = await db.query<Ligne>(`SELECT p.f AS f, d.organisme_siret AS siret, d.organisme_nda AS nda, d.organisme_qualiopi AS qualiopi
    FROM dossiers_opco d JOIN plan_actions p ON p.id = d.plan_action_id WHERE d.annule_le IS NULL AND p.f IS NOT NULL ORDER BY d.id`);
  for (const l of lignes) {
    const f = String(l.f);
    const x = m.get(f) ?? { sirets: new Set<string>(), ndas: new Set<string>(), qualiopi: [] };
    if (typeof l.siret === 'string' && siretValide(l.siret)) x.sirets.add(l.siret);
    if (typeof l.nda === 'string' && ndaValide(l.nda)) x.ndas.add(l.nda);
    x.qualiopi.push(!!l.qualiopi);
    m.set(f, x);
  }
  return m;
}

/** Groupe de textes rattachés à une même fiche : clé, SIRET (s'il est connu et unique), occurrences, valeurs déclarées. */
interface Groupe { cle: string; siret: string | null; occ: Occurrence[]; ndas: Set<string>; qualiopi: boolean[]; conflit: boolean }

/**
 * Groupes d'une clé : un seul si les dossiers OPCO de ses formations ne portent pas plus d'un SIRET ; sinon un par SIRET (les
 * formations qui portent ce seul SIRET) et un pour le reste (sans SIRET, ou plusieurs), tous en conflit : jamais réunis.
 */
function grouper(cle: string, occ: Occurrence[], declares: Map<string, Declare>): Groupe[] {
  const de = (o: Occurrence) => (o.formation ? declares.get(o.formation) : undefined);
  const sirets = new Set(occ.flatMap(o => [...de(o)?.sirets ?? []]));
  const groupe = (siret: string | null, liste: Occurrence[], conflit: boolean): Groupe => ({
    cle, siret, occ: liste, conflit, ndas: new Set(liste.flatMap(o => [...de(o)?.ndas ?? []])), qualiopi: liste.flatMap(o => de(o)?.qualiopi ?? []),
  });
  if (sirets.size <= 1) return [groupe([...sirets][0] ?? null, occ, false)];
  const out = [...sirets].sort().map(s => groupe(s, occ.filter(o => { const x = de(o)?.sirets; return x?.size === 1 && x.has(s); }), true));
  const reste = occ.filter(o => (de(o)?.sirets.size ?? 0) !== 1);
  return reste.length ? [...out, groupe(null, reste, true)] : out;
}

/**
 * Reprise : fiches créées ou complétées, `organisme_id` posés, journal (sauf `journal: false` : chargement de la
 * démonstration, qui vient d'effacer le journal) ; dans la transaction de l'appelant.
 */
export async function executerReprise(db: Db, o: { journal?: boolean } = {}): Promise<BilanRepriseOrganismes> {
  const bilan: BilanRepriseOrganismes = { fiches: 0, rattachements: 0, alias: 0, conflits: 0, siret: 0, nda: 0, qualiopi: 0 };
  const declares = await declaresParFormation(db);
  const parCle = new Map<string, Occurrence[]>();
  for (const o of await occurrences(db)) parCle.set(o.cle, [...parCle.get(o.cle) ?? [], o]);
  const existantes = await fiches(db);
  const codes = new Set((await db.query<Ligne>('SELECT code FROM organismes')).map(r => String(r.code)));
  const sirets = new Set(existantes.map(f => f.o.siret).filter(Boolean));
  const maintenant = new Date().toISOString();
  for (const [cle, occ] of [...parCle].sort((a, b) => a[0].localeCompare(b[0]))) {
    const groupes = grouper(cle, occ, declares);
    if (groupes.length > 1) bilan.conflits++;
    for (const g of groupes) {
      const nda = g.ndas.size === 1 ? [...g.ndas][0] : null;
      if (g.ndas.size > 1) bilan.conflits++;
      // Qualiopi : seulement si tous les dossiers du groupe le déclarent (sans date de validité : à vérifier).
      const qualiopi = g.qualiopi.length > 0 && g.qualiopi.every(Boolean);
      const graphies = [...new Set(g.occ.map(o => o.texte))].sort((a, b) => a.localeCompare(b, 'fr'));
      // Fiche existante de même clé, au SIRET compatible (le même d'abord, puis sans SIRET) ; jamais une au SIRET différent.
      // En conflit, les textes sans SIRET ne rejoignent qu'une fiche sans SIRET (jamais celle d'un autre groupe de la clé).
      const compatible = (o: Organisme) => (g.siret ? !o.siret || o.siret === g.siret : !g.conflit || !o.siret);
      const candidates = existantes.filter(f => f.cles.has(cle) && compatible(f.o))
        .sort((a, b) => Number(b.o.siret === g.siret) - Number(a.o.siret === g.siret) || Number(!a.o.siret) - Number(!b.o.siret) || a.o.id - b.o.id);
      let fiche = candidates[0]?.o ?? null;
      if (fiche) {
        const nouvelles = graphies.filter(t => t !== fiche!.nomUsuel && !fiche!.alias.includes(t));
        // Fiche encore à vérifier, issue de la reprise : SIRET, déclaration d'activité et Qualiopi complétés s'ils manquent.
        const completer = fiche.aVerifier && fiche.source === 'reprise';
        const maj: Partial<Organisme> = {
          ...(nouvelles.length ? { alias: [...fiche.alias, ...nouvelles] } : {}),
          ...(completer && !fiche.siret && g.siret && !sirets.has(g.siret) ? { siret: g.siret } : {}),
          ...(completer && !fiche.nda && nda ? { nda } : {}),
          ...(completer && !fiche.qualiopi && qualiopi ? { qualiopi: true } : {}),
        };
        if (Object.keys(maj).length) {
          fiche = await db.update<Organisme>('organismes', fiche.id, maj);
          bilan.alias += nouvelles.length;
          if (maj.siret) { bilan.siret++; sirets.add(maj.siret); }
          if (maj.nda) bilan.nda++;
          if (maj.qualiopi) bilan.qualiopi++;
          const i = existantes.findIndex(f => f.o.id === fiche!.id);
          existantes[i] = { o: fiche, cles: clesFiche(fiche) };
        }
      } else {
        const nomUsuel = graphieDominante(g.occ.map(o => o.texte)).slice(0, NOM_ORGANISME_MAX).trim();
        const code = codePropose(nomUsuel, codes);
        codes.add(code);
        const siret = g.siret && !sirets.has(g.siret) ? g.siret : null;
        if (siret) sirets.add(siret);
        fiche = await db.insert<Organisme>('organismes', {
          code, raisonSociale: null, nomUsuel, type: estInterne(nomUsuel) ? 'interne' : 'externe', siret, nda, ndaRegion: null,
          qualiopi, qualiopiCategories: qualiopi ? ['formation'] : [], qualiopiCertificateur: null, qualiopiNumero: null, qualiopiValideJusquau: null, qualiopiVerifieLe: null,
          adresse: null, siteWeb: null, subrogationAcceptee: false, delaiAnnulationJours: null, conditions: null,
          alias: graphies, aVerifier: true, source: 'reprise', archive: null, creeLe: maintenant, creePar: AUTEUR_REPRISE,
          fusionneDans: null, fusionneLe: null, fusionnePar: null, fusionneMotif: null,
        });
        existantes.push({ o: fiche, cles: clesFiche(fiche) });
        bilan.fiches++;
        if (siret) bilan.siret++;
        if (nda) bilan.nda++;
        if (qualiopi) bilan.qualiopi++;
      }
      // Rattachement des formations et des formations suivies du groupe (les certifications n'ont pas de colonne de fiche).
      for (const o of g.occ) {
        if (o.table === 'certifications') continue;
        const r = await db.run(`UPDATE ${o.table} SET organisme_id = ? WHERE id = ? AND organisme_id IS NULL`, [fiche.id, o.id]);
        bilan.rattachements += n(r.changes);
      }
    }
  }
  // Objets désignés par leur formation : sessions (celui du catalogue, figé), lignes du plan, formations suivies sans texte,
  // dossiers OPCO (par leur ligne du plan).
  for (const p of PROPAGATIONS) bilan.rattachements += n((await db.run(p.sql)).changes);
  if (o.journal !== false && (bilan.fiches || bilan.rattachements || bilan.alias)) {
    await journaliser(db, {
      actor: 'Cursus', role: null, action: 'migration.organismes',
      message: `Reprise des organismes de formation : ${plural(bilan.fiches, 'fiche créée', 'fiches créées')} (à vérifier), ${plural(bilan.rattachements, 'rattachement', 'rattachements')}`
        + (bilan.conflits ? `, ${plural(bilan.conflits, 'conflit', 'conflits')} de SIRET ou de déclaration d’activité à vérifier` : ''),
      payload: { ...bilan },
    });
  }
  return bilan;
}

/**
 * Étape de démarrage (deux moteurs) : rien si la reprise n'est pas nécessaire ; sinon, dans une transaction, la reprise et son
 * bilan.
 */
export async function reprendreOrganismes(db: Db): Promise<BilanRepriseOrganismes | null> {
  return await db.tx(async () => (await repriseNecessaire(db) ? await executerReprise(db) : null));
}
