// Journal des actions du chantier C4 du lot 12 (organismes de formation et e-learning), en liste blanche : règles ajoutées à
// REGLES de server/src/journal.ts par une ligne de son bloc réservé. Seuls des identifiants, codes, dates, statuts,
// booléens, l'état Qualiopi et sa date, le nombre de lignes d'un import et le montant d'un tarif (montant de l'entreprise)
// sont recopiés. Jamais : le nom, la fonction, l'adresse ou le téléphone d'un contact, les conditions, une URL, un alias, le
// nom usuel (celui d'un formateur indépendant désigne une personne), un avancement nominatif, une réussite, ni un motif.
// Le SIRET (et la déclaration d'activité) d'un formateur indépendant désigne une personne : leur changement est noté
// « [SIRET modifié] » (« [déclaration d'activité modifiée] »), jamais leur valeur.
import type { TableName } from './db.ts';
import type { regleDe } from './journal.ts';

type Regle = NonNullable<ReturnType<typeof regleDe>>;
type Contexte = Parameters<NonNullable<Regle['bilan']>>[1];
type Ligne = Record<string, any>;

export const MENTION_SIRET = '[SIRET modifié]';
export const MENTION_NDA = '[déclaration d’activité modifiée]';
const MENTION_LIEN = '[lien modifié]';
const MENTION_TEXTE_LIBRE = '[texte renseigné]';

/** Identifiant rendu par l'action (`result.id`), ou null. */
const idRendu = (x: Contexte) => Number((x.result as { id?: unknown } | null)?.id) || null;
/** Ligne désignée par `id` du paramètre (modification, archivage…). */
const parId = (table: TableName, colonnes: readonly string[]) => ({ table, cle: (p: Ligne) => Number(p.id) || null, colonnes });

/**
 * Anciennes et nouvelles valeurs des colonnes changées ; `mentions` : colonne dont seul le changement est noté (texte libre,
 * SIRET, lien), jamais la valeur.
 */
function difference(avant: Ligne | null, apres: Ligne | null, colonnes: readonly string[], mentions: Record<string, string> = {}): { avant: Ligne; apres: Ligne } | null {
  if (!avant || !apres) return null;
  const a: Ligne = {}, b: Ligne = {};
  for (const c of colonnes) {
    if (JSON.stringify(avant[c] ?? null) === JSON.stringify(apres[c] ?? null)) continue;
    const m = mentions[c];
    a[c] = m ? (avant[c] ? m : null) : avant[c] ?? null;
    b[c] = m ? (apres[c] ? m : null) : apres[c] ?? null;
  }
  return Object.keys(a).length ? { avant: a, apres: b } : null;
}

/** Code de la fiche `id` (jamais son nom), lu dans la base. */
const codeFiche = async (x: Contexte, id: unknown) => (await x.db.get<Ligne>('organismes', Number(id) || 0))?.code ?? `n° ${id}`;
/**
 * Règle d'une action sur une fiche, un contact ou un tarif : colonnes de `table` (ligne `id`) avant et après, et message du
 * journal neutre — libellé et code de la fiche (`fiche` : identifiant lu sur la ligne ou le paramètre), jamais le nom
 * usuel, qui reprend celui d'un formateur indépendant (le message affiché à l'écran le garde).
 */
function neutre(table: TableName, colonnes: readonly string[], mentions: Record<string, string>, libelle: string, fiche: (p: Ligne, x: Contexte) => unknown): Partial<Regle> {
  return {
    cible: parId(table, colonnes),
    changements: async (p, x) => ({
      ...difference(x.avant, x.apres, colonnes, mentions) ?? { avant: undefined as unknown as Ligne, apres: undefined as unknown as Ligne },
      message: `${libelle} — organisme ${await codeFiche(x, fiche(p, x))}`,
    }),
  };
}
/** Fiche visée par la ligne d'un contact ou d'un tarif, sinon par `organismeId` (création). */
const ficheDeLigne = (p: Ligne, x: Contexte) => (x.apres ?? x.avant)?.organismeId ?? p.organismeId;
const ficheDuParametre = (p: Ligne, x: Contexte) => Number(p.id) || idRendu(x);

/** Colonnes tracées d'une fiche (identité et Qualiopi), SIRET et déclaration d'activité réduits à leur changement. */
const COLONNES_FICHE = ['type', 'siret', 'nda', 'qualiopi', 'qualiopiCategories', 'qualiopiValideJusquau', 'qualiopiVerifieLe', 'aVerifier', 'archive'];
const MENTIONS_FICHE = { siret: MENTION_SIRET, nda: MENTION_NDA };
/** Fiche visée par `id` : son identifiant et son code (jamais son nom), lus après l'action. */
const ficheVisee = async (p: Ligne, x: Contexte): Promise<Ligne> => {
  const o = await x.db.get<Ligne>('organismes', Number(p.id) || idRendu(x) || 0);
  return o ? { organisme: o.id, code: o.code } : {};
};
/** Fiche d'un contact ou d'un tarif. */
const ficheDe = (x: Contexte) => ({ organisme: (x.apres ?? x.avant)?.organismeId ?? null });

/** Modules : colonnes tracées (jamais l'URL ni l'intitulé, dont seul le changement est noté). */
const COLONNES_MODULE = ['organismeId', 'formation', 'url', 'intitule', 'dureeHeures', 'langue', 'coutLicence', 'accesMois', 'attestationRequise', 'archive'];
const MENTIONS_MODULE = { url: MENTION_LIEN, intitule: MENTION_TEXTE_LIBRE };
const moduleVise = async (p: Ligne, x: Contexte): Promise<Ligne> => {
  const m = await x.db.get<Ligne>('modulesElearning', Number(p.id) || idRendu(x) || 0);
  return m ? { module: m.id, code: m.code } : {};
};
/** Inscriptions : statut, dates, heures, formation suivie et certification produites ; jamais l'avancement ni la réussite. */
const inscription = (colonnes: readonly string[]): Partial<Regle> => ({
  champs: ['id'], cible: parId('inscriptionsElearning', colonnes),
  bilan: (_p, x) => ({ module: (x.apres ?? x.avant)?.moduleId ?? null }),
});

export const REGLES_ORGANISMES: Record<string, Regle> = {
  'organisme.enregistrer': {
    ...neutre('organismes', COLONNES_FICHE, MENTIONS_FICHE, 'Organisme enregistré', ficheDuParametre),
    bilan: async (p, x) => {
      const o = await x.db.get<Ligne>('organismes', Number(p.id) || idRendu(x) || 0);
      if (!o) return {};
      // Création : type et état Qualiopi ; SIRET et déclaration d'activité seulement notés renseignés.
      return {
        organisme: o.id, code: o.code,
        ...(p.id ? {} : { type: o.type, qualiopi: o.qualiopi, qualiopiValideJusquau: o.qualiopiValideJusquau, siret: o.siret ? MENTION_SIRET : null, nda: o.nda ? MENTION_NDA : null }),
      };
    },
  },
  'organisme.conditions': {
    ...neutre('organismes', ['subrogationAcceptee', 'delaiAnnulationJours', 'conditions'], { conditions: MENTION_TEXTE_LIBRE }, 'Conditions enregistrées', ficheDuParametre),
    bilan: ficheVisee,
  },
  'organisme.archiver': {
    extra: p => ({ retablir: p.archive === false }), ...neutre('organismes', ['archive'], {}, 'Archivage ou rétablissement', ficheDuParametre), bilan: ficheVisee,
  },
  'organisme.verifier': { ...neutre('organismes', ['aVerifier'], {}, 'Fiche vérifiée', ficheDuParametre), bilan: ficheVisee },
  // Fusion : fiches absorbée et restante (identifiants et codes), objets réaffectés comptés ; jamais le motif.
  'organisme.fusionner': {
    champs: ['source', 'cible'],
    changements: async (p, x) => ({
      avant: undefined as unknown as Ligne, apres: undefined as unknown as Ligne,
      message: `Fusion de l’organisme ${await codeFiche(x, p.source)} dans ${await codeFiche(x, p.cible)}`,
    }),
    bilan: async (p, x) => {
      const [s, c] = [await x.db.get<Ligne>('organismes', Number(p.source) || 0), await x.db.get<Ligne>('organismes', Number(p.cible) || 0)];
      return { codeSource: s?.code ?? null, codeCible: c?.code ?? null, rattachements: (x.result as { rattachements?: unknown } | null)?.rattachements ?? null };
    },
  },
  // Contact : identifiant, fiche, rôle et contact principal ; jamais le nom, la fonction, l'e-mail ni le téléphone.
  'organisme.contact.enregistrer': {
    ...neutre('organismeContacts', ['role', 'principal'], {}, 'Contact enregistré', ficheDeLigne),
    bilan: async (_p, x) => {
      const c = await x.db.get<Ligne>('organismeContacts', idRendu(x) ?? 0);
      return c ? { contact: c.id, organisme: c.organismeId, role: c.role, principal: c.principal } : {};
    },
  },
  'organisme.contact.retirer': { champs: ['id'], ...neutre('organismeContacts', ['archive'], {}, 'Contact retiré', ficheDeLigne), bilan: (_p, x) => ficheDe(x) },
  // Tarif : formation, modalité, unité, montant hors taxes (montant de l'entreprise) et période ; libellé jamais recopié.
  'organisme.tarif.enregistrer': {
    ...neutre('organismeTarifs', ['formation', 'modalite', 'unite', 'montantHt', 'valableDu', 'valableAu'], {}, 'Tarif enregistré', ficheDeLigne),
    bilan: async (p, x) => {
      const t = await x.db.get<Ligne>('organismeTarifs', idRendu(x) ?? 0);
      return t ? { tarif: t.id, organisme: t.organismeId, ...(p.id ? {} : { formation: t.formation, modalite: t.modalite, unite: t.unite, montantHt: t.montantHt, valableDu: t.valableDu, valableAu: t.valableAu }) } : {};
    },
  },
  'organisme.tarif.archiver': { champs: ['id'], ...neutre('organismeTarifs', ['archive'], {}, 'Tarif archivé', ficheDeLigne), bilan: (_p, x) => ficheDe(x) },
  'elearning.module.enregistrer': {
    cible: parId('modulesElearning', COLONNES_MODULE),
    changements: (_p, x) => difference(x.avant, x.apres, COLONNES_MODULE, MENTIONS_MODULE),
    bilan: async (p, x) => {
      const m = await x.db.get<Ligne>('modulesElearning', Number(p.id) || idRendu(x) || 0);
      if (!m) return {};
      return {
        module: m.id, code: m.code,
        ...(p.id ? {} : { organismeId: m.organismeId, formation: m.formation, dureeHeures: m.dureeHeures, langue: m.langue, accesMois: m.accesMois, attestationRequise: m.attestationRequise }),
      };
    },
  },
  'elearning.module.archiver': { extra: p => ({ retablir: p.archive === false }), cible: parId('modulesElearning', ['archive']), bilan: moduleVise },
  // Inscription : module, ligne du plan, échéance, inscriptions créées ; salariés inscrits (historique de leur fiche).
  'elearning.inscrire': {
    champs: ['moduleId', 'planActionId', 'echeance'],
    bilan: (_p, x) => ({ inscriptions: (x.result as { inscriptions?: unknown[] } | null)?.inscriptions ?? [] }),
    salaries: (_p, x) => (x.result as { empIds?: unknown[] } | null)?.empIds ?? [],
  },
  'elearning.declarer': inscription(['statut', 'declareLe']),
  // Import : nombres de lignes seulement (ni salarié, ni avancement, ni réussite).
  'elearning.importer': {
    extra: p => ({ apercu: p.apercu === true }),
    bilan: (_p, x) => {
      const r = (x.result ?? {}) as { lignes?: number; modifiees?: number; inchangees?: number; terminees?: number; erreurs?: unknown[] };
      return { lignes: r.lignes ?? 0, modifiees: r.modifiees ?? 0, inchangees: r.inchangees ?? 0, terminees: r.terminees ?? 0, erreurs: r.erreurs?.length ?? 0 };
    },
  },
  'elearning.terminer': inscription(['statut', 'termineLe', 'heures', 'suivieId', 'certId']),
  'elearning.abandonner': inscription(['statut', 'abandonLe']),
  'elearning.corriger': inscription(['echeance', 'planActionId', 'corrigeLe']),
  'elearning.annuler': inscription(['annuleLe']),
};
