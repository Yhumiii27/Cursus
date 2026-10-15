// Référentiels : catalogue des formations, habilitations et destinations, administrés depuis l'écran Référentiels.
// Formations et habilitations : service RH et référent HSE / formation (droit `formations`) ; destinations : service
// RH. Contrôles partagés avec les dialogues (shared/rules/referentiels.ts). On archive au lieu de supprimer : un élément
// archivé n'est plus proposé dans les listes mais reste reconnu (dossiers, historique, journal, Keystone) et se rétablit.
// Chaque modification est tracée au journal, valeurs avant et après (REGLES de server/src/journal.ts) ; les verdicts
// Go / No Go qu'elle change sont signalés à Keystone après l'action (changeVerdicts de ./index.ts).
import { sessionActive } from '../../../shared/domain.ts';
import { plural } from '../../../shared/format.ts';
import {
  actif, codeDestination, codeTitre, controlerDestination, controlerFormation, controlerHabilitation, demandesEnAttente, effetModification,
  premiereErreur, prerequisArchives, titresADelivrer, titresTexte, type EffetModification, type ReferentielId,
} from '../../../shared/rules/referentiels.ts';
import type { Destination, Formation, HabType } from '../../../shared/types.ts';
import { DESTS, FORMATIONS, HABILITATIONS } from '../seed.ts';
import { ActionError, type ActionHandler, type ActionOutput, type Ctx, requireFormations, requireRh } from './context.ts';

/** Élément visé par une modification ou un archivage (`id` : son code), introuvable : 404. */
function trouver<T>(liste: readonly T[], cle: (x: T) => string, id: string, nature: string): T {
  const x = liste.find(e => cle(e) === id);
  if (!x) throw new ActionError(`${nature} introuvable`, 404);
  return x;
}

/** Saisie refusée : la première erreur du contrôle partagé avec le dialogue. */
function refuser(erreurs: Partial<Record<string, string>>): never {
  throw new ActionError(premiereErreur(erreurs) ?? 'Saisie invalide');
}

/** Effet sur les titres détenus d'une validité (ou de prérequis) modifiée : échéances recalculées à l'affichage. */
function effetTexte(x: EffetModification | null): string {
  if (!x) return '';
  return [
    x.echus.length ? `${plural(x.echus.length, 'titre devient échu', 'titres deviennent échus')} : ${titresTexte(x.echus)}` : '',
    x.retablis.length ? plural(x.retablis.length, 'titre redevient valide', 'titres redeviennent valides') : '',
  ].filter(Boolean).map(t => ` · ${t}`).join('');
}
const validiteTexte = (avant: number, apres: number) => (avant !== apres ? ` · validité ${avant} → ${apres} mois, échéances recalculées` : '');
/**
 * Message d'une modification, et salariés dont un titre change de statut : le message en nomme, la ligne du journal
 * leur est donc rattachée (filtre « salarié », export de leurs données).
 */
function modifie(message: string, effet: EffetModification | null): ActionOutput {
  const salaries = [...new Set([...(effet?.echus ?? []), ...(effet?.retablis ?? [])].map(t => t.empId))];
  return { message: `${message}${effetTexte(effet)}`, result: { salaries } };
}
/** Demandes des collaborateurs restées en attente sur l'élément archivé : à refuser (ou à accepter après rétablissement). */
const attenteTexte = (n: number) => (n ? ` · ${plural(n, 'demande en attente', 'demandes en attente')} : à refuser, ou à accepter après rétablissement` : '');

// — Formations —

/** Création (`code`) ou modification (`id`) d'une formation du catalogue. */
const enregistrerFormation: ActionHandler = (ctx, p) => {
  requireFormations(ctx);
  const liste = ctx.ds.referentiels.formations;
  const avant = p.id != null && p.id !== '' ? trouver(liste, f => f.id, codeTitre(p.id), 'Formation') : null;
  const { erreurs, formation: f } = controlerFormation(p, liste, avant?.id ?? null);
  if (!f) refuser(erreurs);
  if (!avant) {
    ctx.db.insert<Formation>('formations', f);
    return `Formation « ${f.court} » ajoutée au catalogue`;
  }
  // Une nouvelle validité vaut aussi pour les certifications déjà obtenues (et les habilitations qui les exigent).
  const effet = f.validite !== avant.validite ? effetModification(ctx.ds, 'formations', f) : null;
  ctx.db.update<Formation>('formations', f.id, f);
  return modifie(`Formation « ${f.court} » modifiée${validiteTexte(avant.validite, f.validite)}`, effet);
};

/**
 * Archivage (`archive` vrai, par défaut) ou rétablissement. Refusé tant qu'une habilitation en vigueur l'exige en
 * prérequis ou qu'une session est ouverte (à venir ou à clôturer) : elle ne serait plus proposée.
 */
const archiverFormation: ActionHandler = (ctx, p) => {
  requireFormations(ctx);
  const f = trouver(ctx.ds.referentiels.formations, x => x.id, codeTitre(p.id), 'Formation');
  if (p.archive === false) {
    if (actif(f)) return `Formation « ${f.court} » déjà au catalogue`;
    ctx.db.update<Formation>('formations', f.id, { archive: null });
    return `Formation « ${f.court} » rétablie au catalogue`;
  }
  if (!actif(f)) return `Formation « ${f.court} » déjà archivée`;
  const exigee = ctx.ds.referentiels.habilitations.filter(h => actif(h) && h.prereqs.includes(f.id));
  if (exigee.length) {
    throw new ActionError(`Prérequis de : ${exigee.map(h => h.nom).join(', ')} — retirez-la de leurs prérequis, ou archivez-les d’abord`);
  }
  const ouvertes = ctx.ds.sessions.filter(s => s.formation === f.id && sessionActive(s)).length;
  if (ouvertes) throw new ActionError(`${plural(ouvertes, 'session ouverte', 'sessions ouvertes')} (à venir ou à clôturer) : annulez-les ou clôturez-les d’abord`);
  ctx.db.update<Formation>('formations', f.id, { archive: ctx.d.ti });
  return `Formation « ${f.court} » archivée — plus proposée ni suivie ; les certifications restent au dossier${attenteTexte(demandesEnAttente(ctx.ds, 'formations', f.id))}`;
};

// — Habilitations —

/** Création (`code`) ou modification (`id`) d'une habilitation : prérequis du catalogue, aptitude, validité, signataire. */
const enregistrerHabilitation: ActionHandler = (ctx, p) => {
  requireFormations(ctx);
  const liste = ctx.ds.referentiels.habilitations;
  const avant = p.id != null && p.id !== '' ? trouver(liste, h => h.id, codeTitre(p.id), 'Habilitation') : null;
  const { erreurs, habilitation: h } = controlerHabilitation(p, liste, ctx.ds.referentiels.formations, avant?.id ?? null);
  if (!h) refuser(erreurs);
  if (!avant) {
    ctx.db.insert<HabType>('habilitations', h);
    return `Habilitation « ${h.nom} » ajoutée au référentiel`;
  }
  // Validité, prérequis ou condition d'aptitude modifiés : les titres délivrés suivent la nouvelle règle.
  const regle = (x: HabType) => JSON.stringify([x.validite, [...x.prereqs].sort(), x.medical]);
  const effet = regle(h) !== regle(avant) ? effetModification(ctx.ds, 'habilitations', h) : null;
  ctx.db.update<HabType>('habilitations', h.id, h);
  return modifie(`Habilitation « ${h.nom} » modifiée${validiteTexte(avant.validite, h.validite)}`, effet);
};

/**
 * Archivage ou rétablissement d'une habilitation : les titres délivrés restent au dossier, hors du suivi. Rétablie,
 * elle exige de nouveau ses prérequis : refusé tant que l'un d'eux est archivé (plus personne ne pourrait l'obtenir).
 */
const archiverHabilitation: ActionHandler = (ctx, p) => {
  requireFormations(ctx);
  const h = trouver(ctx.ds.referentiels.habilitations, x => x.id, codeTitre(p.id), 'Habilitation');
  if (p.archive === false) {
    if (actif(h)) return `Habilitation « ${h.nom} » déjà au référentiel`;
    const archives = prerequisArchives(h, ctx.ds.referentiels.formations);
    if (archives.length) {
      const [la, les] = archives.length > 1 ? ['ces formations', 'les'] : ['cette formation', 'la'];
      throw new ActionError(`${plural(archives.length, 'prérequis archivé', 'prérequis archivés')} : ${archives.map(f => f.court).join(', ')} — rétablissez d’abord ${la} (onglet Formations), ou retirez-${les} de ses prérequis`);
    }
    ctx.db.update<HabType>('habilitations', h.id, { archive: null });
    return `Habilitation « ${h.nom} » rétablie au référentiel`;
  }
  if (!actif(h)) return `Habilitation « ${h.nom} » déjà archivée`;
  ctx.db.update<HabType>('habilitations', h.id, { archive: ctx.d.ti });
  const titres = ctx.ds.employes.filter(e => e.habs.some(t => t.h === h.id && t.delivree)).length;
  // Titres demandés pas encore délivrés : ils sortent de « En attente » et ne se délivrent plus.
  const aDelivrer = titresADelivrer(ctx.ds, h.id);
  return `Habilitation « ${h.nom} » archivée — plus proposée ni suivie${titres ? ` ; ${plural(titres, 'titre reste', 'titres restent')} au dossier` : ''}`
    + (aDelivrer ? ` · ${plural(aDelivrer, 'titre demandé sort', 'titres demandés sortent')} de « En attente » sans être délivré${aDelivrer > 1 ? 's' : ''}` : '')
    + attenteTexte(demandesEnAttente(ctx.ds, 'habilitations', h.id));
};

// — Destinations —

/** Création (`code`) ou modification (`id`, code pays) d'une destination : entrée, vaccins, passeport, sécurité sociale. */
const enregistrerDestination: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const liste = ctx.ds.referentiels.destinations;
  const avant = p.id != null && p.id !== '' ? trouver(liste, d => d.code, codeDestination(p.id), 'Destination') : null;
  const { erreurs, destination: d } = controlerDestination(p, liste, avant?.code ?? null);
  if (!d) refuser(erreurs);
  if (!avant) {
    ctx.db.insert<Destination>('destinations', d);
    return `Destination « ${d.pays} » ajoutée au référentiel`;
  }
  ctx.db.update<Destination>('destinations', d.code, d);
  // Les dossiers voyage sont recalculés à l'affichage : les déplacements prévus suivent la nouvelle règle.
  const prevus = ctx.ds.voyages.filter(v => v.dest === d.code && v.retour >= ctx.d.ti).length;
  return `Destination « ${d.pays} » modifiée${prevus ? ` · ${plural(prevus, 'déplacement prévu suit', 'déplacements prévus suivent')} la nouvelle règle` : ''}`;
};

/** Archivage ou rétablissement : les déplacements déjà créés vers cette destination gardent leur dossier. */
const archiverDestination: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const d = trouver(ctx.ds.referentiels.destinations, x => x.code, codeDestination(p.id), 'Destination');
  if (p.archive === false) {
    if (actif(d)) return `Destination « ${d.pays} » déjà au référentiel`;
    ctx.db.update<Destination>('destinations', d.code, { archive: null });
    return `Destination « ${d.pays} » rétablie au référentiel`;
  }
  if (!actif(d)) return `Destination « ${d.pays} » déjà archivée`;
  ctx.db.update<Destination>('destinations', d.code, { archive: ctx.d.ti });
  return `Destination « ${d.pays} » archivée — plus proposée pour un nouveau déplacement ; les déplacements créés gardent leur dossier`;
};

// — Référentiel type —

/** Référentiel type (celui de la démonstration) : à vérifier par le service RH une fois chargé. */
const TYPE: Record<ReferentielId, { lignes: readonly object[]; nature: [string, string]; droit: (ctx: Ctx) => void }> = {
  formations: { lignes: FORMATIONS, nature: ['formation', 'formations'], droit: requireFormations },
  habilitations: { lignes: HABILITATIONS, nature: ['habilitation', 'habilitations'], droit: requireFormations },
  destinations: { lignes: DESTS, nature: ['destination', 'destinations'], droit: requireRh },
};

/**
 * Charge le référentiel type dans un référentiel vide (aucun élément, même archivé) : 11 formations, 6 habilitations
 * (après les formations, qui sont leurs prérequis) ou 8 destinations, à vérifier et compléter ensuite.
 */
const charger: ActionHandler = (ctx, p) => {
  const ref = String(p.referentiel ?? '') as ReferentielId;
  const t = Object.hasOwn(TYPE, ref) ? TYPE[ref] : null;
  if (!t) throw new ActionError('Référentiel inconnu');
  t.droit(ctx);
  if (ctx.ds.referentiels[ref].length) {
    throw new ActionError(`Référentiel des ${t.nature[1]} déjà rempli : le référentiel type ne se charge que dans un référentiel vide`);
  }
  if (ref === 'habilitations') {
    const manquantes = [...new Set(HABILITATIONS.flatMap(h => h.prereqs))].filter(f => !ctx.ds.referentiels.formations.some(x => x.id === f));
    if (manquantes.length) throw new ActionError(`Formations prérequises absentes du catalogue (${manquantes.join(', ')}) : chargez d’abord le catalogue type des formations`);
  }
  t.lignes.forEach(x => ctx.db.insert(ref, { ...x, archive: null }));
  return `${plural(t.lignes.length, t.nature[0], t.nature[1])} du référentiel type ${t.lignes.length > 1 ? 'ajoutées' : 'ajoutée'} : à vérifier et compléter (validités, coûts, organismes, signataires)`;
};

export const referentielsActions: Record<string, ActionHandler> = {
  'referentiel.formation.enregistrer': enregistrerFormation,
  'referentiel.formation.archiver': archiverFormation,
  'referentiel.habilitation.enregistrer': enregistrerHabilitation,
  'referentiel.habilitation.archiver': archiverHabilitation,
  'referentiel.destination.enregistrer': enregistrerDestination,
  'referentiel.destination.archiver': archiverDestination,
  'referentiel.charger': charger,
};
