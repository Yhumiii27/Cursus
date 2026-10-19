// Référentiels : catalogue des formations, habilitations et destinations, administrés depuis l'écran Référentiels.
// Formations et habilitations : service RH et référent HSE / formation (droit `formations`) ; destinations : service
// RH. Contrôles partagés avec les dialogues (shared/rules/referentiels.ts). On archive au lieu de supprimer : un élément
// archivé n'est plus proposé dans les listes mais reste reconnu (dossiers, historique, journal, Keystone) et se rétablit.
// Chaque modification est tracée au journal, valeurs avant et après (REGLES de server/src/journal.ts) ; les verdicts
// Go / No Go qu'elle change sont signalés à Keystone après l'action (changeVerdicts de ./index.ts).
// Postes et exigences (t055, shared/rules/exigences.ts) : formations et habilitations exigées par poste ou communes à une
// équipe, tenues par le service RH ; une habilitation exigée jamais délivrée se demande (`hab.demander`).
import { sessionActive } from '../../../shared/domain.ts';
import { plural } from '../../../shared/format.ts';
import {
  actif, codeDestination, codeTitre, controlerDestination, controlerFormation, controlerHabilitation, demandesEnAttente, effetModification,
  premiereErreur, prerequisArchives, refusArchive, titresADelivrer, titresTexte, type EffetModification, type ReferentielId,
} from '../../../shared/rules/referentiels.ts';
import {
  controlerExigences, controlerPoste, effetExigences, effetTexte as effetExigencesTexte, exigencesEquipe, posteParLibelle, titulaires, type NouveauManquant,
} from '../../../shared/rules/exigences.ts';
import { key } from '../../../shared/format.ts';
import type { Destination, Equipe, Formation, HabTitre, HabType, Poste } from '../../../shared/types.ts';
import { DESTS, FORMATIONS, HABILITATIONS } from '../seed.ts';
import { enregistrerNuitEquipe } from './mineurs.ts';
import { enregistrerCouvertureEquipe } from './couverture.ts';
import { enregistrerHoraireEquipe } from './horaires.ts';
import { ActionError, getEmp, isRh, type ActionHandler, type ActionOutput, type Ctx, requireFormations, requireRh, str } from './context.ts';
import { devientDeconseillee } from '../../../shared/rules/vigilance.ts';
import { alerterVigilance } from '../vigilance.ts';

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
  // Titres demandés pas encore délivrés : ils quittent l'écran Habilitations et ne se délivrent plus d'ici le rétablissement.
  const aDelivrer = titresADelivrer(ctx.ds, h.id);
  return `Habilitation « ${h.nom} » archivée — plus proposée ni suivie${titres ? ` ; ${plural(titres, 'titre reste', 'titres restent')} au dossier` : ''}`
    + (aDelivrer ? ` · ${plural(aDelivrer, 'titre demandé reste', 'titres demandés restent')} à délivrer après rétablissement` : '')
    + attenteTexte(demandesEnAttente(ctx.ds, 'habilitations', h.id));
};

// — Destinations —

/** Création (`code`) ou modification (`id`, code pays) d'une destination : entrée, vaccins, passeport, sécurité sociale. */
const enregistrerDestination: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const liste = ctx.ds.referentiels.destinations;
  const avant = p.id != null && p.id !== '' ? trouver(liste, d => d.code, codeDestination(p.id), 'Destination') : null;
  const { erreurs, destination: d } = controlerDestination(p, liste, avant?.code ?? null, ctx.d.ti);
  if (!d) refuser(erreurs);
  // Vigilance passée à l'orange ou au rouge (t068) : déplacements prévus signalés, service RH et managers prévenus.
  const alerte = devientDeconseillee(avant?.vigilance, d.vigilance) ? alerterVigilance(ctx, d) : null;
  if (!avant) {
    ctx.db.insert<Destination>('destinations', d);
    return { message: `Destination « ${d.pays} » ajoutée au référentiel${alerte?.texte ?? ''}`, result: { salaries: alerte?.salaries ?? [] } };
  }
  ctx.db.update<Destination>('destinations', d.code, d);
  // Les dossiers voyage sont recalculés à l'affichage : les déplacements prévus suivent la nouvelle règle.
  const prevus = ctx.ds.voyages.filter(v => v.dest === d.code && v.retour >= ctx.d.ti && !v.annuleLe).length;
  return {
    message: `Destination « ${d.pays} » modifiée${alerte ? alerte.texte : prevus ? ` · ${plural(prevus, 'déplacement prévu suit', 'déplacements prévus suivent')} la nouvelle règle` : ''}`,
    result: { salaries: alerte?.salaries ?? [] },
  };
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
    const prereqs = [...new Set(HABILITATIONS.flatMap(h => h.prereqs))];
    const manquantes = prereqs.filter(f => !ctx.ds.referentiels.formations.some(x => x.id === f));
    if (manquantes.length) throw new ActionError(`Formations prérequises absentes du catalogue (${manquantes.join(', ')}) : chargez d’abord le catalogue type des formations`);
    // Habilitations chargées en vigueur : aucune ne doit exiger une formation archivée, que nul ne pourrait plus obtenir.
    const archivees = prerequisArchives({ prereqs }, ctx.ds.referentiels.formations);
    if (archivees.length) {
      const la = archivees.length > 1 ? 'les' : 'la';
      throw new ActionError(`${plural(archivees.length, 'formation prérequise archivée', 'formations prérequises archivées')} : ${archivees.map(f => f.court).join(', ')} — rétablissez-${la} d’abord (onglet Formations), puis chargez le référentiel type`);
    }
  }
  t.lignes.forEach(x => ctx.db.insert(ref, { ...x, archive: null }));
  return `${plural(t.lignes.length, t.nature[0], t.nature[1])} du référentiel type ${t.lignes.length > 1 ? 'ajoutées' : 'ajoutée'} : à vérifier et compléter (validités, coûts, organismes, signataires)`;
};

// — Postes et exigences —

/** Message des salariés qui deviennent non conformes ; la ligne du journal leur est rattachée (`result.salaries`). */
function exigencesModifiees(message: string, effet: { nouveaux: NouveauManquant[]; resolus: number }): ActionOutput {
  const suite = [effetExigencesTexte(effet), effet.resolus ? plural(effet.resolus, 'salarié n’a plus d’exigence manquante', 'salariés n’ont plus d’exigence manquante') : '']
    .filter(Boolean).map(t => ` · ${t}`).join('');
  return { message: `${message}${suite}`, result: { salaries: effet.nouveaux.map(n => n.empId) } };
}

/**
 * Création (sans `id`) ou modification d'un poste : intitulé et exigences. Un intitulé modifié est recopié sur les fiches
 * de ses titulaires qui portaient l'ancien (le libellé conservé suit le poste choisi ; un libellé précisé reste).
 */
const enregistrerPoste: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const postes = ctx.ds.referentiels.postes;
  const avant = p.id != null && p.id !== '' ? trouver(postes, x => String(x.id), String(Number(p.id)), 'Poste') : null;
  const { erreurs, poste } = controlerPoste(p, ctx.ds.referentiels, avant?.id ?? null);
  if (!poste) refuser(erreurs);
  if (!avant) {
    const cree = ctx.db.insert<Poste>('postes', poste);
    return { message: `Poste « ${poste.nom} » ajouté au référentiel`, result: { id: cree.id, salaries: [] } };
  }
  const effet = effetExigences(ctx.ds, { postes: postes.map(x => (x.id === avant.id ? { ...x, ...poste } : x)) });
  ctx.db.update<Poste>('postes', avant.id, poste);
  let renommes = 0;
  if (poste.nom !== avant.nom) {
    // Un libellé précisé (« Cariste confirmé ») n'est pas l'intitulé du poste : il reste tel quel.
    for (const e of ctx.ds.employes.filter(x => x.posteId === avant.id && key(x.poste) === key(avant.nom))) { ctx.db.update('employes', e.id, { poste: poste.nom }); renommes++; }
  }
  const nom = poste.nom !== avant.nom ? `Poste « ${avant.nom} » renommé « ${poste.nom} »${renommes ? ` sur ${plural(renommes, 'fiche', 'fiches')}` : ''}` : `Poste « ${poste.nom} » modifié`;
  return exigencesModifiees(nom, effet);
};

/** Archivage ou rétablissement d'un poste : refusé tant qu'un salarié présent l'occupe (changer d'abord son poste). */
const archiverPoste: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const x = trouver(ctx.ds.referentiels.postes, y => String(y.id), String(Number(p.id)), 'Poste');
  if (p.archive === false) {
    if (actif(x)) return `Poste « ${x.nom} » déjà au référentiel`;
    if (posteParLibelle(ctx.ds.referentiels.postes, x.nom)) throw new ActionError(`Un poste en vigueur porte déjà l’intitulé « ${x.nom} »`);
    ctx.db.update<Poste>('postes', x.id, { archive: null });
    return `Poste « ${x.nom} » rétabli au référentiel`;
  }
  if (!actif(x)) return `Poste « ${x.nom} » déjà archivé`;
  const occupe = titulaires(ctx.ds, x.id);
  if (occupe.length) {
    throw new ActionError(`${plural(occupe.length, 'salarié occupe', 'salariés occupent')} ce poste : choisissez d’abord un autre poste sur ${occupe.length > 1 ? 'leurs fiches' : 'sa fiche'}`);
  }
  ctx.db.update<Poste>('postes', x.id, { archive: ctx.d.ti });
  return `Poste « ${x.nom} » archivé — plus proposé sur les fiches`;
};

/**
 * Exigences communes à tous les membres d'une équipe, quel que soit leur poste ; case « travail de nuit ou en continu » (`nuit`) ;
 * horaire de poste par défaut (`horaire`).
 */
const exigencesEquipeAction: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const q = ctx.ds.referentiels.equipes.find(x => x.nom === p.nom);
  if (!q) throw new ActionError('Équipe introuvable', 404);
  const { erreurs, exigences } = controlerExigences(p, ctx.ds.referentiels, exigencesEquipe(q));
  if (premiereErreur(erreurs)) refuser(erreurs);
  const valeur = exigences.formations.length || exigences.habilitations.length ? exigences : null;
  const effet = effetExigences(ctx.ds, { equipes: ctx.ds.referentiels.equipes.map(x => (x.nom === q.nom ? { ...x, exigences: valeur } : x)) });
  ctx.db.update<Equipe>('equipes', q.nom, { exigences: valeur });
  // Case « travail de nuit ou en continu » (salariés mineurs exclus) : ./mineurs.ts.
  const nuit = enregistrerNuitEquipe(ctx, q, p.nuit);
  // Couverture minimale (SST, EPI incendie…) : ./couverture.ts.
  const couverture = enregistrerCouvertureEquipe(ctx, q, p.couverture);
  // Horaire de poste proposé par défaut sur les feuilles de ses membres (lot 6) : ./horaires.ts.
  const horaire = enregistrerHoraireEquipe(ctx, q, p.horaire);
  return exigencesModifiees(`Exigences communes de l’équipe ${q.nom} enregistrées${nuit}${couverture}${horaire}`, effet);
};

/**
 * Habilitation exigée jamais délivrée : titre demandé, « en attente » de délivrance (écran Habilitations), comme après
 * l'acceptation d'une demande du collaborateur. La délivrance suit, après contrôle des prérequis.
 */
const demanderHab: ActionHandler = (ctx, p) => {
  requireFormations(ctx);
  const emp = getEmp(ctx, p.empId);
  const hm = ctx.d.hm(codeTitre(p.h));
  if (!hm) throw new ActionError('Habilitation inconnue');
  const refus = refusArchive(hm, 'Habilitation');
  if (refus) throw new ActionError(refus);
  const t = emp.habs.find(x => x.h === hm.id);
  if (t?.delivree) throw new ActionError(`${hm.nom} déjà délivrée à ${emp.nom} : renouvelez-la depuis sa fiche`);
  if (t) return `${hm.nom} déjà demandée pour ${emp.nom} — en attente de délivrance (écran Habilitations)`;
  ctx.db.insert<HabTitre>('habTitres', { empId: emp.id, h: hm.id, delivree: null, par: null, demande: ctx.d.ti });
  return `${hm.nom} demandée pour ${emp.nom} — à délivrer après contrôle des prérequis (écran Habilitations, « En attente »)`;
};

/**
 * Poste d'une fiche saisie (`employe.creer`, `employe.modifier`) : le poste choisi dans la liste (`posteId`) donne son
 * intitulé à la fiche. Un intitulé saisi seul est rattaché au poste en vigueur du même nom ; sinon, quand la saisie ne
 * touche pas au poste (`garder` : intitulé modifié par l'API, sans `posteId`), il n'est qu'un libellé précisé du poste
 * actuel, dont les exigences continuent de s'appliquer ; sinon encore, le service RH crée ce poste, sans exigence (fiche
 * créée, « Nouveau poste » de la fiche). Le poste actuel d'une fiche reste admis même archivé depuis, et son libellé
 * précisé est gardé tant que le poste ne change pas. Le manager ne change pas de poste : ses exigences décident de la
 * conformité, et seul le service RH en répond ; il ne fait que préciser l'intitulé (fiche hors référentiel : rattachée
 * au poste de même intitulé, s'il existe).
 */
export function rattacherPoste(ctx: Ctx, fiche: Record<string, unknown>, actuel: number | null = null, garder = false): void {
  const postes = ctx.ds.referentiels.postes;
  const id = fiche.posteId == null || fiche.posteId === '' ? null : Number(fiche.posteId);
  const libelle = str(fiche.poste).replace(/\s+/g, ' ');
  if (!isRh(ctx)) {
    if (id != null && id !== actuel) throw new ActionError('Le poste se change par le service RH : seul l’intitulé peut être précisé', 403);
    fiche.posteId = actuel ?? posteParLibelle(postes, libelle)?.id ?? null;
    if (fiche.posteId == null && key(libelle)) throw new ActionError('Poste inconnu : le service RH l’ajoute d’abord au référentiel des postes');
    return;
  }
  if (id != null) {
    const x = postes.find(y => y.id === id);
    if (!x) throw new ActionError('Poste inconnu : choisissez-le dans la liste');
    if (!actif(x) && x.id !== actuel) throw new ActionError(`Poste « ${x.nom} » archivé : rétablissez-le d’abord (écran Référentiels)`);
    fiche.posteId = x.id;
    // Même poste : l'intitulé saisi (libellé précisé, « Cariste confirmé ») est gardé ; un autre poste donne le sien.
    fiche.poste = x.id === actuel && key(libelle) ? libelle : x.nom;
    return;
  }
  fiche.posteId = garder ? actuel : null;
  if (!key(libelle)) return;
  const x = posteParLibelle(postes, libelle);
  if (x) { fiche.posteId = x.id; fiche.poste = x.nom; return; }
  if (garder && actuel != null) return;
  if (libelle.length > 80) throw new ActionError('Intitulé du poste : 80 caractères au plus');
  fiche.posteId = ctx.db.insert<Poste>('postes', { nom: libelle, formations: [], habilitations: [], archive: null }).id;
  fiche.poste = libelle;
}

export const referentielsActions: Record<string, ActionHandler> = {
  'referentiel.poste.enregistrer': enregistrerPoste,
  'referentiel.poste.archiver': archiverPoste,
  'referentiel.equipe.exigences': exigencesEquipeAction,
  'hab.demander': demanderHab,
  'referentiel.formation.enregistrer': enregistrerFormation,
  'referentiel.formation.archiver': archiverFormation,
  'referentiel.habilitation.enregistrer': enregistrerHabilitation,
  'referentiel.habilitation.archiver': archiverHabilitation,
  'referentiel.destination.enregistrer': enregistrerDestination,
  'referentiel.destination.archiver': archiverDestination,
  'referentiel.charger': charger,
};
