// Organismes de formation (lot 12, chantier C4, t190 ; règles : shared/rules/organismes.ts). Droit « formations » (service
// RH et référent HSE / formation) pour l'identité, Qualiopi et les contacts ; service RH seul pour les tarifs et les
// conditions commerciales ; administrateur RH pour la fusion de deux fiches (motif). La lecture seule consulte.
//   organisme.enregistrer         id (modification) ou création ; identité et Qualiopi (shared/rules/organismes.ts,
//                                 `controlerOrganisme`) ; le nom usuel est recopié dans `formations.organisme` des formations
//                                 rattachées, dans la même transaction (contrat pub_titres_detenus)
//   organisme.conditions          id, subrogationAcceptee, delaiAnnulationJours, conditions : service RH
//   organisme.archiver            id, archive (false : rétablir) ; refusé tant qu'une formation du catalogue ou un module
//                                 en vigueur la désigne
//   organisme.verifier            id : fiche reprise confirmée (« À vérifier »)
//   organisme.fusionner           source, cible, motif, objets (nombre d'objets affiché, contre une confirmation périmée) :
//                                 administrateur RH ; jamais si les SIRET diffèrent ; objets réaffectés, alias réunis, fiche
//                                 absorbée archivée et désignant celle qui la remplace
//   organisme.contact.enregistrer id (modification) ou organismeId (création), nom, fonction, email, telephone, role, principal
//   organisme.contact.retirer     id : contact archivé
//   organisme.tarif.enregistrer   id (modification) ou organismeId (création), formation ou libelle, modalite, unite,
//                                 montantHt, valableDu, valableAu : service RH
//   organisme.tarif.archiver      id : service RH
// Rien n'est supprimé. Aucune de ces actions ne change un verdict Go / No Go, ni ne vise un salarié.
import { plural } from '../../../shared/format.ts';
import { erreurMotifCorrection } from '../../../shared/rules/corrections.ts';
import {
  aliasApresFusion, cleOrganisme, clesFiche, controlerConditions, controlerContact, controlerOrganisme, controlerTarif, organismeActif, organismeFinal, rattachementsDe,
  refusFusion, type Rattachements,
} from '../../../shared/rules/organismes.ts';
import type { Organisme, OrganismeContact, OrganismeTarif } from '../../../shared/types-organismes.ts';
import { ActionError, type ActionHandler, type Ctx, requireFormations, requireRh, requireRhAdmin, str } from './context.ts';

/** Saisie refusée : la première erreur du contrôle partagé avec le dialogue. */
function refuser(erreurs: Partial<Record<string, string>>): never {
  throw new ActionError(Object.values(erreurs).find(Boolean) ?? 'Saisie invalide');
}

/** Fiche désignée par `id` (fusionnée ou archivée comprise), introuvable : 404. */
function ficheDe(ctx: Ctx, id: unknown): Organisme {
  const o = (ctx.ds.organismes ?? []).find(x => x.id === Number(id));
  if (!o) throw new ActionError('Organisme introuvable', 404);
  return o;
}

/** Fiche fusionnée dans une autre : plus rien ne s'y modifie. */
function refuserFusionnee(ctx: Ctx, o: Organisme) {
  if (o.fusionneDans == null) return;
  const cible = (ctx.ds.organismes ?? []).find(x => x.id === o.fusionneDans);
  throw new ActionError(`${o.nomUsuel} a été fusionné dans ${cible?.nomUsuel ?? 'une autre fiche'} : modifiez celle-ci`);
}

/**
 * Organisme choisi dans un dialogue (session, formation, formation suivie…) : `v` vide → aucun (null) ; absent (undefined)
 * → `defaut` (celui du catalogue, de la ligne du plan…), suivi jusqu'à la fiche qui l'a absorbé. Une fiche choisie doit être
 * en vigueur (ni archivée, ni fusionnée), sauf si c'est déjà la valeur par défaut.
 */
export function organismeChoisi(ctx: Pick<Ctx, 'ds'>, v: unknown, defaut: number | null | undefined = null): number | null {
  const organismes = ctx.ds.organismes ?? [];
  const final = (id: number | null | undefined) => {
    let o = id == null ? undefined : organismes.find(x => x.id === id);
    for (let i = 0; o?.fusionneDans != null && i < 20; i++) o = organismes.find(x => x.id === o!.fusionneDans) ?? o;
    return o?.id ?? null;
  };
  if (v === undefined) return final(defaut);
  if (v === null || v === '') return null;
  const o = organismes.find(x => x.id === Number(v));
  if (!o) throw new ActionError('Organisme inconnu');
  if (!organismeActif(o) && o.id !== final(defaut)) throw new ActionError(`${o.nomUsuel} : organisme archivé ou fusionné, choisissez-en un autre`);
  return o.id;
}

/**
 * Fiche gardée quand un dialogue envoie seulement le texte de l'organisme (`organismeId` absent) : celle d'avant, si le
 * texte la désigne encore (même clé que son nom usuel ou l'un de ses alias) ; sinon aucune (null), le texte saisi est gardé
 * et la reprise du démarrage suivant le rattache à la bonne fiche, ou en crée une « à vérifier ». Jamais un texte et une
 * fiche qui se contredisent.
 */
export function ficheDuTexte(ctx: Pick<Ctx, 'ds'>, avant: number | null | undefined, texte: string | null | undefined): number | null {
  const fiche = organismeFinal(ctx.ds.organismes, avant);
  const cle = cleOrganisme(texte);
  return fiche && cle && clesFiche(fiche).has(cle) ? fiche.id : null;
}

/** Nom usuel de la fiche recopié dans `formations.organisme` des formations rattachées (contrat pub_titres_detenus). */
export async function recopierNom(ctx: Ctx, o: Pick<Organisme, 'id' | 'nomUsuel'>): Promise<number> {
  return Number((await ctx.db.run('UPDATE formations SET organisme = ? WHERE organisme_id = ? AND (organisme IS NULL OR organisme <> ?)', [o.nomUsuel, o.id, o.nomUsuel])).changes);
}

// — Fiche —

const enregistrer: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const liste = ctx.ds.organismes ?? [];
  const avant = p.id != null && p.id !== '' ? ficheDe(ctx, p.id) : null;
  if (avant) refuserFusionnee(ctx, avant);
  const { erreurs, valeur } = controlerOrganisme(p, liste, avant);
  if (!valeur) refuser(erreurs);
  if (!avant) {
    const o = await ctx.db.insert<Organisme>('organismes', {
      ...valeur, subrogationAcceptee: false, delaiAnnulationJours: null, conditions: null, alias: [], aVerifier: false, source: 'saisie', archive: null,
      creeLe: new Date().toISOString(), creePar: ctx.user.nom, fusionneDans: null, fusionneLe: null, fusionnePar: null, fusionneMotif: null,
    });
    return { message: `Organisme « ${o.nomUsuel} » ajouté au référentiel (code ${o.code})`, result: { id: o.id } };
  }
  const o = await ctx.db.update<Organisme>('organismes', avant.id, valeur);
  const recopies = o.nomUsuel !== avant.nomUsuel ? await recopierNom(ctx, o) : 0;
  return {
    message: `Organisme « ${o.nomUsuel} » modifié${recopies ? ` · nom repris par ${plural(recopies, 'formation du catalogue', 'formations du catalogue')}` : ''}`,
    result: { id: o.id },
  };
};

const conditions: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const avant = ficheDe(ctx, p.id);
  refuserFusionnee(ctx, avant);
  const { erreurs, valeur } = controlerConditions(p, avant);
  if (!valeur) refuser(erreurs);
  await ctx.db.update<Organisme>('organismes', avant.id, valeur);
  return { message: `Conditions de « ${avant.nomUsuel} » enregistrées`, result: { id: avant.id } };
};

const archiver: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const o = ficheDe(ctx, p.id);
  refuserFusionnee(ctx, o);
  if (p.archive === false) {
    if (!o.archive) return `Organisme « ${o.nomUsuel} » déjà en vigueur`;
    await ctx.db.update<Organisme>('organismes', o.id, { archive: null });
    return `Organisme « ${o.nomUsuel} » rétabli au référentiel`;
  }
  if (o.archive) return `Organisme « ${o.nomUsuel} » déjà archivé`;
  const formations = ctx.ds.referentiels.formations.filter(f => !f.archive && f.organismeId === o.id);
  const modules = (ctx.ds.modulesElearning ?? []).filter(m => !m.archive && m.organismeId === o.id);
  if (formations.length || modules.length) {
    throw new ActionError(`Organisme par défaut de ${[...formations.map(f => f.court), ...modules.map(m => m.code)].join(', ')} : choisissez-en un autre d’abord`);
  }
  await ctx.db.update<Organisme>('organismes', o.id, { archive: ctx.d.ti });
  return `Organisme « ${o.nomUsuel} » archivé — plus proposé ; les sessions et formations suivies le gardent`;
};

const verifier: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const o = ficheDe(ctx, p.id);
  refuserFusionnee(ctx, o);
  if (!o.aVerifier) return `Organisme « ${o.nomUsuel} » déjà vérifié`;
  await ctx.db.update<Organisme>('organismes', o.id, { aVerifier: false });
  return `Organisme « ${o.nomUsuel} » vérifié`;
};

/** Total des objets réaffectés par une fusion (confirmation affichée, journal). */
export const totalRattachements = (r: Rattachements) => Object.values(r).reduce((a, b) => a + b, 0);
/** Tables dont la colonne `organisme_id` désigne la fiche absorbée, réaffectées à la fiche qui l'absorbe. */
const TABLES_RATTACHEES = ['formations', 'sessions', 'formations_suivies', 'plan_actions', 'dossiers_opco', 'modules_elearning', 'organisme_contacts', 'organisme_tarifs'] as const;

/**
 * Fusion d'un doublon (`source`) dans la fiche qui reste (`cible`) : objets réaffectés (formations, sessions, formations
 * suivies, lignes du plan, dossiers OPCO, modules, contacts, tarifs, fiches déjà fusionnées dans la source), alias réunis,
 * SIRET, déclaration d'activité et Qualiopi complétés s'ils manquent à la cible ; la source est archivée et désigne la cible.
 * Pas de défusion simple : `objets`, le nombre d'objets affiché à la confirmation, doit être celui du moment.
 */
const fusionner: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const liste = ctx.ds.organismes ?? [];
  const source = liste.find(o => o.id === Number(p.source)) ?? null, cible = liste.find(o => o.id === Number(p.cible)) ?? null;
  const refus = refusFusion(source, cible);
  if (refus) throw new ActionError(refus, source && cible ? 400 : 404);
  const err = erreurMotifCorrection(p.motif);
  if (err) throw new ActionError(err);
  const r = rattachementsDe(ctx.ds, source!.id);
  const total = totalRattachements(r);
  if (p.objets != null && Number(p.objets) !== total) throw new ActionError(`Les objets rattachés à ${source!.nomUsuel} ont changé (${total} aujourd’hui) : rouvrez la fusion`, 409);
  for (const t of TABLES_RATTACHEES) await ctx.db.run(`UPDATE ${t} SET organisme_id = ? WHERE organisme_id = ?`, [cible!.id, source!.id]);
  await ctx.db.run('UPDATE organismes SET fusionne_dans = ? WHERE fusionne_dans = ?', [cible!.id, source!.id]);
  const complete: Partial<Organisme> = {
    alias: aliasApresFusion(source!, cible!),
    ...(!cible!.siret && source!.siret ? { siret: source!.siret } : {}),
    ...(!cible!.nda && source!.nda ? { nda: source!.nda, ndaRegion: source!.ndaRegion } : {}),
  };
  // SIRET de la source repris : elle le libère d'abord (un SIRET n'appartient qu'à une fiche non fusionnée).
  await ctx.db.update<Organisme>('organismes', source!.id, {
    archive: source!.archive ?? ctx.d.ti, fusionneDans: cible!.id, fusionneLe: ctx.d.ti, fusionnePar: ctx.user.nom, fusionneMotif: str(p.motif), aVerifier: false,
  });
  const c = await ctx.db.update<Organisme>('organismes', cible!.id, complete);
  const recopies = await recopierNom(ctx, c);
  return {
    message: `« ${source!.nomUsuel} » fusionné dans « ${c.nomUsuel} » — ${plural(total, 'objet réaffecté', 'objets réaffectés')}${recopies ? ` · nom repris par ${plural(recopies, 'formation du catalogue', 'formations du catalogue')}` : ''}`,
    result: { id: c.id, source: source!.id, rattachements: r },
  };
};

// — Contacts —

const enregistrerContact: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const avant = p.id != null && p.id !== '' ? (ctx.ds.organismeContacts ?? []).find(c => c.id === Number(p.id)) ?? null : null;
  if (p.id != null && p.id !== '' && (!avant || avant.archive)) throw new ActionError('Contact introuvable ou retiré', 404);
  const o = ficheDe(ctx, avant?.organismeId ?? p.organismeId);
  refuserFusionnee(ctx, o);
  const { erreurs, valeur } = controlerContact(p, avant);
  if (!valeur) refuser(erreurs);
  const c = avant ? await ctx.db.update<OrganismeContact>('organismeContacts', avant.id, valeur)
    : await ctx.db.insert<OrganismeContact>('organismeContacts', { ...valeur, organismeId: o.id, archive: null, creeLe: new Date().toISOString(), creePar: ctx.user.nom });
  // Un seul contact principal par organisme.
  if (c.principal) {
    for (const x of (ctx.ds.organismeContacts ?? []).filter(y => y.organismeId === o.id && y.id !== c.id && y.principal)) await ctx.db.update<OrganismeContact>('organismeContacts', x.id, { principal: false });
  }
  return { message: `Contact ${avant ? 'modifié' : 'ajouté'} — ${o.nomUsuel}`, result: { id: c.id } };
};

const retirerContact: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const c = (ctx.ds.organismeContacts ?? []).find(x => x.id === Number(p.id));
  if (!c) throw new ActionError('Contact introuvable', 404);
  if (c.archive) return 'Contact déjà retiré';
  await ctx.db.update<OrganismeContact>('organismeContacts', c.id, { archive: ctx.d.ti, principal: false });
  return `Contact retiré — ${ficheDe(ctx, c.organismeId).nomUsuel}`;
};

// — Tarifs —

const enregistrerTarif: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const avant = p.id != null && p.id !== '' ? (ctx.ds.organismeTarifs ?? []).find(t => t.id === Number(p.id)) ?? null : null;
  if (p.id != null && p.id !== '' && (!avant || avant.archive)) throw new ActionError('Tarif introuvable ou archivé', 404);
  const o = ficheDe(ctx, avant?.organismeId ?? p.organismeId);
  refuserFusionnee(ctx, o);
  const { erreurs, valeur } = controlerTarif(p, ctx.ds.referentiels.formations, avant, ctx.d.ti);
  if (!valeur) refuser(erreurs);
  const t = avant ? await ctx.db.update<OrganismeTarif>('organismeTarifs', avant.id, valeur)
    : await ctx.db.insert<OrganismeTarif>('organismeTarifs', { ...valeur, organismeId: o.id, archive: null, creeLe: new Date().toISOString(), creePar: ctx.user.nom });
  return { message: `Tarif ${avant ? 'modifié' : 'ajouté'} — ${o.nomUsuel}`, result: { id: t.id } };
};

const archiverTarif: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const t = (ctx.ds.organismeTarifs ?? []).find(x => x.id === Number(p.id));
  if (!t) throw new ActionError('Tarif introuvable', 404);
  if (t.archive) return 'Tarif déjà archivé';
  await ctx.db.update<OrganismeTarif>('organismeTarifs', t.id, { archive: ctx.d.ti });
  return `Tarif archivé — ${ficheDe(ctx, t.organismeId).nomUsuel}`;
};

export const organismesActions = {
  'organisme.enregistrer': enregistrer,
  'organisme.conditions': conditions,
  'organisme.archiver': archiver,
  'organisme.verifier': verifier,
  'organisme.fusionner': fusionner,
  'organisme.contact.enregistrer': enregistrerContact,
  'organisme.contact.retirer': retirerContact,
  'organisme.tarif.enregistrer': enregistrerTarif,
  'organisme.tarif.archiver': archiverTarif,
} satisfies Record<string, ActionHandler>;
