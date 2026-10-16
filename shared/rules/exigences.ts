// Formations et habilitations exigées par poste, et communes à toute une équipe quel que soit le poste (t055).
// Le statut ne regardait que les titres détenus : un cariste sans CACES apparaissait « À jour ». Une exigence déclarée
// et jamais obtenue (aucune certification de la formation, aucune habilitation délivrée) rend désormais le salarié
// « Non conforme » (Domain.enrich), avec une échéance « exigence manquante » (Domain.echeances) et son action : inscrire à
// la formation, demander puis délivrer l'habilitation. Un titre obtenu mais échu reste suivi par sa propre échéance.
// - Référentiel vide par défaut : aucune exigence n'est créée d'office ; tant qu'un poste n'en a pas, le statut de ses
//   titulaires ne change pas. Le service RH les saisit dans l'écran Référentiels (onglet Postes), à partir au besoin de
//   la proposition déduite des titres que détiennent déjà tous les titulaires du poste (`exigencesProposees`).
// - Une formation ou une habilitation archivée n'est plus exigée (plus suivie) ; le filtre « réglementaires uniquement »
//   écarte aussi les formations exigées qui ne le sont pas.
// - Postes : le libellé de la fiche est conservé (exports, imports, historique) ; il suit le poste choisi dans la liste.
//   On archive au lieu de supprimer : un poste archivé n'est plus proposé, et ne s'archive pas tant qu'il est occupé.
import { CLS, SESSION_PASSEE } from '../constants.ts';
import { parse } from '../dates.ts';
import { Domain, sessionActive, type EchItem, type EmpX, type Proposal } from '../domain.ts';
import { fmtShort, key, plural } from '../format.ts';
import type { Dataset, Employe, Exigences, Formation, HabType, ISODate, Poste } from '../types.ts';
import { actif } from './referentiels.ts';
import { present } from './contrats.ts';

export type TypeExigence = 'formation' | 'habilitation';

/** Exigence qui s'applique à un salarié : formation ou habilitation, et d'où elle vient (poste, équipe). */
export interface Exigence {
  type: TypeExigence; id: string;
  /** « poste Cariste », « équipe Logistique » : l'origine de l'exigence, parfois les deux. */
  origines: string[];
}
/** Exigence non satisfaite : formation jamais suivie, ou habilitation jamais délivrée (éventuellement demandée). */
export interface ExigenceManquante extends Exigence { label: string }

const vide = (): Exigences => ({ formations: [], habilitations: [] });
/** Exigences d'une équipe, lues sur une ligne éventuellement ancienne (colonne vide). */
export const exigencesEquipe = (q: { exigences?: Exigences | null } | null | undefined): Exigences => ({
  formations: q?.exigences?.formations ?? [], habilitations: q?.exigences?.habilitations ?? [],
});
/** Nombre d'exigences déclarées (formations et habilitations). */
export const nombreExigences = (x: Exigences | null | undefined) => (x?.formations.length ?? 0) + (x?.habilitations.length ?? 0);

/**
 * Poste du référentiel d'une fiche (null : intitulé hors référentiel). Une fiche écrite sans `posteId` (import, reprise,
 * base antérieure) relève du poste en vigueur de même intitulé, sans attendre son rattachement (`rattacherFiches` de
 * server/src/migrations/referentiels.ts, au démarrage) : ses exigences s'appliquent quel que soit le chemin d'écriture.
 */
export function posteDe(ds: Pick<Dataset, 'referentiels'>, e: Pick<Employe, 'posteId' | 'poste'>): Poste | null {
  if (e.posteId == null) return posteParLibelle(ds.referentiels.postes, e.poste ?? '');
  return ds.referentiels.postes.find(p => p.id === e.posteId) ?? null;
}

/**
 * Exigences qui s'appliquent à un salarié : celles de son poste et celles de son équipe, réunies (une exigence commune aux
 * deux n'est comptée qu'une fois, avec ses deux origines). Seules les formations et habilitations en vigueur au
 * référentiel sont exigées.
 */
export function exigencesDe(ds: Pick<Dataset, 'referentiels'>, e: Pick<Employe, 'posteId' | 'poste' | 'equipe'>): Exigence[] {
  const out = new Map<string, Exigence>();
  const ajouter = (x: Exigences, origine: string) => {
    for (const [type, ids, liste] of [
      ['formation', x.formations, ds.referentiels.formations],
      ['habilitation', x.habilitations, ds.referentiels.habilitations],
    ] as [TypeExigence, string[], (Formation | HabType)[]][]) {
      for (const id of ids) {
        if (!actif(liste.find(r => r.id === id))) continue;
        const k = `${type}:${id}`;
        const deja = out.get(k);
        if (deja) { if (!deja.origines.includes(origine)) deja.origines.push(origine); } else out.set(k, { type, id, origines: [origine] });
      }
    }
  };
  const poste = posteDe(ds, e);
  if (poste) ajouter(poste, `poste ${poste.nom}`);
  const equipe = e.equipe ? ds.referentiels.equipes.find(q => q.nom === e.equipe) : null;
  if (equipe) ajouter(exigencesEquipe(equipe), `équipe ${equipe.nom}`);
  return [...out.values()];
}

/**
 * Exigences manquantes d'un salarié : formation exigée dont il n'a aucune certification (une certification échue est
 * suivie par sa propre échéance), habilitation exigée qui ne lui a jamais été délivrée (un titre seulement demandé ne
 * suffit pas). `formIds` : formations suivies (filtre « réglementaires uniquement »).
 */
export function exigencesManquantes(
  ds: Pick<Dataset, 'referentiels'>, e: Pick<Employe, 'posteId' | 'poste' | 'equipe'>,
  certs: readonly { f: string }[], habs: readonly { h: string; delivree: ISODate | null }[], formIds?: ReadonlySet<string>,
): ExigenceManquante[] {
  return exigencesDe(ds, e).flatMap(x => {
    if (x.type === 'formation') {
      if ((formIds && !formIds.has(x.id)) || certs.some(c => c.f === x.id)) return [];
      return [{ ...x, label: ds.referentiels.formations.find(f => f.id === x.id)!.court }];
    }
    if (habs.some(h => h.h === x.id && h.delivree)) return [];
    return [{ ...x, label: ds.referentiels.habilitations.find(h => h.id === x.id)!.nom }];
  });
}

/** « Formation exigée non suivie : CACES R489 · Habilitation exigée non délivrée : Conduite d'engins ». */
export function manquantsTexte(m: readonly ExigenceManquante[]): string {
  const f = m.filter(x => x.type === 'formation').map(x => x.label), h = m.filter(x => x.type === 'habilitation').map(x => x.label);
  return [
    f.length ? `${f.length > 1 ? 'Formations exigées non suivies' : 'Formation exigée non suivie'} : ${f.join(', ')}` : '',
    h.length ? `${h.length > 1 ? 'Habilitations exigées non délivrées' : 'Habilitation exigée non délivrée'} : ${h.join(', ')}` : '',
  ].filter(Boolean).join(' · ');
}

/** Origine affichée sous l'élément : « Exigence du poste Cariste », « … et de l'équipe Logistique ». */
export const origineTexte = (x: Exigence) => `Exigence ${x.origines.map(o => `du ${o}`.replace(/^du équipe/, 'de l’équipe')).join(' et ')}`;

/**
 * Échéance d'une exigence manquante (Domain.echeances) : sans date, classée au jour parmi les dépassées. Formation :
 * inscription planifiée (« Session du … »), session passée à clôturer, sinon « Inscrire à la formation ». Habilitation :
 * « Demander l'habilitation » (titre « en attente » de l'écran Habilitations), puis les actions d'un titre demandé
 * (délivrer, ou d'abord satisfaire ses prérequis).
 */
export function echeanceExigence(d: Domain, e: EmpX, m: ExigenceManquante): EchItem {
  const base = {
    kind: 'exigence' as const, kindLabel: origineTexte(m), label: m.label, emp: e, exp: d.today, d: 0, key: 'exp' as const, cls: CLS.exp,
    sansDate: true, sansDateTexte: { main: 'Manquante', sub: m.type === 'formation' ? 'jamais suivie' : 'jamais délivrée' },
  };
  if (m.type === 'formation') {
    const sessions = d.ds.inscriptions.filter(i => i.empId === e.id).map(i => d.session(i.sessionId))
      .filter(s => !!s && s.formation === m.id && sessionActive(s)).sort((a, b) => a!.date.localeCompare(b!.date));
    const avenir = sessions.find(s => s!.date >= d.ti), passee = sessions.find(s => s!.date < d.ti);
    const action: Proposal | null = avenir ? null
      : passee ? { label: 'Clôturer', intent: { type: 'openCloture', sessionId: passee.id } }
      : { label: 'Inscrire à la formation', intent: { type: 'goFormation', f: m.id } };
    return {
      ...base, statut: 'Formation exigée non suivie', planned: !!avenir,
      plannedLabel: avenir ? `Session du ${fmtShort(parse(avenir.date))}` : passee ? SESSION_PASSEE : '', action,
    };
  }
  // Titre déjà demandé (demande acceptée, ou demandé par le service RH) : en attente de délivrance.
  const titre = e.habs.find(h => h.h === m.id && !h.delivree);
  return {
    ...base, statut: 'Habilitation exigée non délivrée', planned: false,
    plannedLabel: titre?.demande ? `Demandée le ${fmtShort(parse(titre.demande))}` : '',
    action: titre ? d.habAction(e.id, titre) : { label: 'Demander l’habilitation', intent: { type: 'demanderHab', empId: e.id, h: m.id, nom: e.nom, label: m.label } },
  };
}

// — Saisie des exigences (écran Référentiels) —

type Erreurs<K extends string> = Partial<Record<K, string>>;
const texte = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const codes = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(x => String(x).trim().toLowerCase()))] : []);

/**
 * Formations et habilitations exigées, contrôlées : éléments du référentiel en vigueur ; ceux déjà exigés et archivés
 * depuis restent admis (`avant`), sans être exigés tant qu'ils sont archivés.
 */
export function controlerExigences(
  s: { formations?: unknown; habilitations?: unknown }, ref: Pick<Dataset['referentiels'], 'formations' | 'habilitations'>, avant: Exigences | null = null,
): { erreurs: Erreurs<'formations' | 'habilitations'>; exigences: Exigences } {
  const e: Erreurs<'formations' | 'habilitations'> = {};
  const formations = codes(s.formations), habilitations = codes(s.habilitations);
  if (s.formations != null && !Array.isArray(s.formations)) e.formations = 'Liste de formations attendue.';
  if (s.habilitations != null && !Array.isArray(s.habilitations)) e.habilitations = 'Liste d’habilitations attendue.';
  const permis = (liste: readonly { id: string; archive?: ISODate | null }[], deja: readonly string[]) => (id: string) =>
    liste.some(x => x.id === id && (actif(x) || deja.includes(id)));
  const fi = formations.filter(id => !permis(ref.formations, avant?.formations ?? [])(id));
  const hi = habilitations.filter(id => !permis(ref.habilitations, avant?.habilitations ?? [])(id));
  if (fi.length) e.formations = `Formation inconnue ou archivée : ${fi.join(', ')}.`;
  if (hi.length) e.habilitations = `Habilitation inconnue ou archivée : ${hi.join(', ')}.`;
  return { erreurs: e, exigences: { formations, habilitations } };
}

export type ChampPoste = 'nom' | 'formations' | 'habilitations';

/** Poste saisi, contrôlé : intitulé (unique parmi les postes en vigueur) et exigences ; `id` : poste modifié. */
export function controlerPoste(
  s: Partial<Record<ChampPoste, unknown>>, ref: Pick<Dataset['referentiels'], 'postes' | 'formations' | 'habilitations'>, id: number | null = null,
): { erreurs: Erreurs<ChampPoste>; poste: Omit<Poste, 'id'> | null } {
  const avant = id != null ? ref.postes.find(p => p.id === id) ?? null : null;
  const nom = texte(s.nom);
  const { erreurs, exigences } = controlerExigences(s, ref, avant);
  const e: Erreurs<ChampPoste> = { ...erreurs };
  if (!nom) e.nom = 'Indiquez l’intitulé du poste.';
  else if (nom.length > 80) e.nom = '80 caractères au plus.';
  else if (ref.postes.some(p => p.id !== id && actif(p) && key(p.nom) === key(nom))) e.nom = 'Un poste du référentiel porte déjà cet intitulé.';
  if (Object.keys(e).length) return { erreurs: e, poste: null };
  return { erreurs: e, poste: { nom, ...exigences, archive: avant?.archive ?? null } };
}

/** Poste en vigueur dont l'intitulé est celui saisi (casse, accents et ponctuation ignorés). */
export function posteParLibelle(postes: readonly Poste[], libelle: string): Poste | null {
  const k = key(libelle);
  return k ? postes.find(p => actif(p) && key(p.nom) === k) ?? null : null;
}

/** Salariés présents qui occupent un poste (rattachés, ou de même intitulé sans rattachement : `posteDe`). */
export function titulaires(ds: Pick<Dataset, 'employes' | 'today' | 'referentiels'>, posteId: number): Employe[] {
  return ds.employes.filter(e => posteDe(ds, e)?.id === posteId && present(e, ds.today));
}

/**
 * Point de départ proposé pour les exigences d'un poste (ou d'une équipe) : les formations et habilitations en vigueur que
 * détiennent déjà tous ses titulaires présents (certification, même échue ; habilitation délivrée). À valider par le
 * service RH : rien n'est enregistré sans lui.
 */
export function exigencesProposees(ds: Pick<Dataset, 'employes' | 'today' | 'referentiels'>, membres: readonly Employe[]): Exigences {
  if (!membres.length) return vide();
  const tous = (detient: (e: Employe, id: string) => boolean) => (id: string) => membres.every(e => detient(e, id));
  return {
    formations: ds.referentiels.formations.filter(actif).map(f => f.id).filter(tous((e, id) => e.certs.some(c => c.f === id))),
    habilitations: ds.referentiels.habilitations.filter(actif).map(h => h.id).filter(tous((e, id) => e.habs.some(t => t.h === id && !!t.delivree))),
  };
}

/** Salarié qui devient non conforme avec les nouvelles exigences : ses exigences manquantes ajoutées. */
export interface NouveauManquant { empId: number; nom: string; manquants: string[] }

/**
 * Effet de nouvelles exigences (poste ou équipe modifié) sur les salariés présents : ceux à qui il manque une exigence de
 * plus, annoncés avant l'enregistrement et repris dans le message de l'action ; et le nombre dont il en manque moins.
 */
export function effetExigences(ds: Dataset, referentiels: Partial<Pick<Dataset['referentiels'], 'postes' | 'equipes'>>): { nouveaux: NouveauManquant[]; resolus: number } {
  const horizon = ds.settings.horizonAlerte;
  // Même filtre « réglementaires uniquement » que l'affichage : une formation non réglementaire exigée n'y compte pas.
  const enrichis = (x: Dataset) => new Domain(x).enrich(horizon, !!ds.settings.uniquementReglementaire);
  const cles = (e: EmpX) => e.manquants.map(m => `${m.type}:${m.id}`);
  const a = new Map(enrichis(ds).map(e => [e.id, cles(e)]));
  const nouveaux: NouveauManquant[] = [];
  let resolus = 0;
  for (const e of enrichis({ ...ds, referentiels: { ...ds.referentiels, ...referentiels } })) {
    const avant = a.get(e.id) ?? [], apres = cles(e);
    const ajout = e.manquants.filter(m => !avant.includes(`${m.type}:${m.id}`));
    if (ajout.length) nouveaux.push({ empId: e.id, nom: e.nom, manquants: ajout.map(m => m.label) });
    if (avant.some(k => !apres.includes(k))) resolus++;
  }
  return { nouveaux, resolus };
}

/** « 3 salariés deviennent non conformes : Camille Roux (CACES R489), Hugo Lambert (CACES R489) et 1 autre ». */
export function effetTexte(x: { nouveaux: readonly NouveauManquant[] }, max = 3): string {
  if (!x.nouveaux.length) return '';
  const noms = x.nouveaux.slice(0, max).map(n => `${n.nom} (${n.manquants.join(', ')})`);
  const reste = x.nouveaux.length - noms.length;
  const liste = reste > 0 ? `${noms.join(', ')} et ${plural(reste, 'autre', 'autres')}` : noms.join(', ').replace(/, ([^,]*)$/, ' et $1');
  return `${plural(x.nouveaux.length, 'salarié devient non conforme', 'salariés deviennent non conformes')} : ${liste}`;
}
