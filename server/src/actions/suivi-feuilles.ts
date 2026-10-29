// Suivi des feuilles de temps (t130) : relance des feuilles en retard (salarié et valideur, par e-mail ou dans leur
// récapitulatif quotidien) et validation groupée des feuilles soumises, chacune avec les contrôles de temps.validate
// (dépassement sans motif, demande d'absence en attente, heures un jour d'absence…) : les refus sont listés au lieu de
// tout annuler, et les seuils de durée franchis (moyenne, temps partiel, contingent, contrepartie en repos) repris au
// message. État des semaines : shared/rules/suivi-feuilles.ts.
import { isoWeek, isValidDate, mondayOf } from '../../../shared/dates.ts';
import { plural } from '../../../shared/format.ts';
import { etatSemaines, maintenantParis, semainesSuivies } from '../../../shared/rules/suivi-feuilles.ts';
import { Domain } from '../../../shared/domain.ts';
import type { Employe } from '../../../shared/types.ts';
import { type FeuilleARelancer, notifierRelanceFeuilles, notifierRelanceSuppleants, notifierRelanceValideur } from '../notifications.ts';
import { CURSUS_OCCUPE, ERREUR_INTERNE, estOccupe } from '../erreurs.ts';
import { relevesAutomatiques } from '../releves.ts';
import { ActionError, type ActionHandler, type Ctx, decideParDelegation, isRh, isValidatorOf } from './context.ts';
import { validerFeuille } from './temps.ts';

/** Service RH (gestionnaire ou administrateur) ou manager ; ni le collaborateur, ni un profil restreint de l'espace RH. */
function exigerValideur(ctx: Ctx, quoi: string) {
  if (ctx.user.role === 'collaborateur' || (ctx.user.role === 'rh' && !isRh(ctx))) throw new ActionError(`${quoi} réservée aux managers et au service RH`, 403);
}

/**
 * Collaborateurs suivis : tous pour le service RH ; pour un manager, les membres de son équipe (hors lui-même), et ceux
 * dont il décide des feuilles par délégation d'un manager absent (t135). Une relance n'est pas une décision : elle n'est
 * pas signée « par délégation de » (`decideParDelegation` ne signe pas).
 */
function perimetre(ctx: Ctx): Employe[] {
  if (isRh(ctx)) return ctx.ds.employes;
  return ctx.ds.employes.filter(e => e.id !== ctx.user.empId && (ctx.d.mgrOf(e) === ctx.user.empId || (ctx.user.role === 'manager' && decideParDelegation(ctx, e, 'feuilles'))));
}

/**
 * `empId` (facultatif) : relance d'un seul collaborateur ; sinon de tous ceux du périmètre. Feuilles relancées : celles
 * des semaines suivies (réglage `suiviSemaines`) manquantes, en brouillon ou à corriger, une fois leur échéance passée.
 * Chaque salarié reçoit ses semaines, chaque valideur (manager direct, sinon la boîte du service RH) ses membres.
 */
const relancer: ActionHandler = async (ctx, p) => {
  exigerValideur(ctx, 'Relance des feuilles de temps');
  let emps = perimetre(ctx);
  if (p.empId !== undefined && p.empId !== null) {
    const id = Number(p.empId);
    emps = emps.filter(e => e.id === id);
    if (!emps.length) throw new ActionError('Collaborateur hors de votre périmètre', 403);
  }
  const semaines = semainesSuivies(ctx.d.ti, ctx.ds.settings.suiviSemaines);
  const retards = etatSemaines(ctx.d, emps.map(e => e.id), semaines, maintenantParis(ctx.d.ti))
    .map(l => ({ emp: l.emp, feuilles: l.cellules.filter(c => c.enRetard).map((c): FeuilleARelancer => ({ week: c.week, etat: c.etat as FeuilleARelancer['etat'] })) }))
    .filter(r => r.feuilles.length);
  if (!retards.length) throw new ActionError('Aucune feuille de temps en retard à relancer');
  const parValideur = new Map<number, typeof retards>();
  for (const r of retards) {
    await notifierRelanceFeuilles(ctx, r.emp, r.feuilles);
    const v = ctx.d.mgrOf(r.emp);
    parValideur.set(v, [...(parValideur.get(v) ?? []), r]);
  }
  for (const [v, liste] of parValideur) await notifierRelanceValideur(ctx, v, liste);
  // Valideurs en délégation (t135) : le suppléant d'un manager absent est relancé pour les membres dont il décide.
  await notifierRelanceSuppleants(ctx, retards);
  const n = retards.reduce((k, r) => k + r.feuilles.length, 0);
  return {
    message: `Relance envoyée pour ${plural(n, 'feuille de temps', 'feuilles de temps')} — ${retards.length > 1 ? `${retards.length} collaborateurs` : retards[0].emp.nom} et ${parValideur.size > 1 ? 'leurs valideurs' : 'son valideur'}`,
    result: { feuilles: retards.flatMap(r => r.feuilles.map(f => ({ empId: r.emp.id, week: f.week }))) },
  };
};

/**
 * `Domain` partagé entre les feuilles d'une validation groupée (lot 10, chantier B) : actif sauf si
 * CURSUS_VALIDATION_DOMAIN_PARTAGE vaut « 0 » (repli : un `Domain` neuf, sans mémo, après chaque feuille validée).
 */
export const domainePartageActif = (env: Record<string, string | undefined> = process.env) => env.CURSUS_VALIDATION_DOMAIN_PARTAGE?.trim() !== '0';

/** Feuilles validées en groupe au plus par appel. */
const LOT_MAX = 200;
/**
 * Feuilles validées dans une même transaction au plus (lot 8, chantier E) : le verrou d'écriture n'est tenu que le temps
 * d'une tranche, bien moins que la moitié du délai d'attente d'un verrou (`lock_timeout`, server/src/db-pg.ts).
 */
export const TRANCHE_MAX = 25;
/** Alertes de durée détaillées au message d'une validation groupée ; au-delà, elles sont comptées. */
const ALERTES_MAX = 5;
/**
 * Marque d'une tranche posée par le serveur (`validerEnTranches`) : la tranche rend son bilan sans conclure (une tranche
 * sans feuille validée n'est pas un refus de toute la validation). Un symbole : un corps JSON ne peut pas la porter.
 */
export const EN_TRANCHE = Symbol('tranche de validation groupée');

type Feuille = { empId: number; week: string };
/** Bilan d'une tranche (ou d'une validation entière) : de quoi composer le message final, sans le journaliser. */
interface BilanLot {
  validees: Feuille[];
  /** Feuilles déjà validées, sautées : une validation reprise après une interruption ne les refuse pas. */
  deja: Feuille[];
  refus: (Feuille & { raison: string; status: number })[];
  alertes: (Feuille & { texte: string })[];
  noms: Record<number, string>;
  /** Managers au nom desquels des feuilles ont été validées (délégation, t135), par leur nom. */
  delegations: string[];
}

/** Feuilles demandées [{ empId, week }] (lundis), contrôlées ; refus 400 au moindre élément invalide, ou au-delà de 200. */
export function feuillesDemandees(p: Record<string, any>): Feuille[] {
  const liste = Array.isArray(p.feuilles) ? p.feuilles as unknown[] : [];
  const demandees = liste.flatMap(x => {
    const o = (x && typeof x === 'object' ? x : {}) as { empId?: unknown; week?: unknown };
    const empId = Number(o.empId), week = String(o.week ?? '');
    return Number.isInteger(empId) && isValidDate(week) && mondayOf(week) === week ? [{ empId, week }] : [];
  });
  if (!demandees.length || demandees.length !== liste.length) throw new ActionError('Feuilles à valider invalides');
  if (demandees.length > LOT_MAX) throw new ActionError(`${LOT_MAX} feuilles au plus par validation groupée`);
  return demandees;
}

/**
 * Valide les feuilles `demandees` dans la transaction en cours, sur une seule lecture complète de la base (`ctx.ds`) :
 * chaque feuille validée y est remplacée par la ligne enregistrée (server/src/actions/temps.ts, `validerFeuille`), de
 * sorte que la suivante voie ce que la précédente a changé (contingent et contrepartie en repos cumulés sur l'année,
 * relevé d'une agence complet), comme si la base avait été relue. Chacune dans son point de reprise (SAVEPOINT) : un
 * refus annule ce qu'elle aurait écrit et s'ajoute à la liste. Une feuille déjà validée, dont la personne est
 * valideur, est sautée (reprise d'une validation interrompue).
 */
async function validerFeuilles(ctx: Ctx, demandees: Feuille[]): Promise<BilanLot> {
  const b: BilanLot = { validees: [], deja: [], refus: [], alertes: [], noms: {}, delegations: [] };
  // Lot 10, chantier B : un `Domain` à mémos par salarié, repris d'une feuille à l'autre (`remplacerFeuille`), et les
  // relevés des agences cherchés une fois en fin de tranche ; CURSUS_VALIDATION_DOMAIN_PARTAGE=0 revient à un `Domain`
  // neuf, sans mémo, après chaque feuille validée, et au relevé cherché après chaque feuille d'intérimaire.
  const partage = domainePartageActif();
  if (partage) ctx.d = new Domain(ctx.ds, { memoParSalarie: true });
  const releves = partage ? new Map<string, { agence: string; semaine: string }>() : undefined;
  for (const f of demandees) {
    const emp = ctx.d.emp(f.empId);
    if (emp) b.noms[f.empId] = emp.nom;
    const sh = ctx.ds.feuilles.find(x => x.empId === f.empId && x.week === f.week);
    if (emp && sh?.statut === 'validee' && isValidatorOf(ctx, emp, 'feuilles')) { b.deja.push(f); continue; }
    await ctx.db.exec('SAVEPOINT validation_groupee');
    // Contexte de la feuille : même lecture de la base ; sa signature « par délégation de » (t135) rejoint celle de la
    // validation groupée, et l'état qu'elle a changé n'est repris qu'une fois la feuille validée.
    const sous: Ctx = { ...ctx, parDelegation: new Set() };
    try {
      // Agences et semaines des intérimaires de la feuille : notées à part, gardées seulement si elle est validée.
      const siens = releves && new Map<string, { agence: string; semaine: string }>();
      const v = await validerFeuille(sous, f, siens);
      for (const [k, x] of siens ?? []) releves!.set(k, x);
      await ctx.db.exec('RELEASE validation_groupee');
      ctx.ds = sous.ds; ctx.d = sous.d;
      for (const m of sous.parDelegation) ctx.parDelegation.add(m);
      b.validees.push(f);
      b.alertes.push(...v.alertes.map(texte => ({ ...f, texte })));
    } catch (err) {
      await ctx.db.exec('ROLLBACK TO validation_groupee');
      await ctx.db.exec('RELEASE validation_groupee');
      if (!(err instanceof ActionError)) throw err;
      b.refus.push({ ...f, raison: err.message, status: err.status });
    }
  }
  if (releves) await relevesDeFinDeTranche(ctx, releves);
  b.delegations = [...ctx.parDelegation].map(id => ctx.d.personName(id));
  return b;
}

/**
 * Relevés des agences d'intérim en fin de tranche (lot 10, chantier B), dans sa transaction, sur la lecture où toutes ses
 * feuilles validées sont remplacées : une recherche par agence et semaine touchées, au lieu d'une par feuille
 * d'intérimaire. Même résultat : un relevé ne part que complet (toutes les feuilles de ses intérimaires validées), et une
 * feuille validée ne change plus dans la tranche ; celui qu'une feuille rendait complet part donc ici, identique.
 */
async function relevesDeFinDeTranche(ctx: Ctx, releves: Map<string, { agence: string; semaine: string }>): Promise<void> {
  for (const x of releves.values()) await relevesAutomatiques(ctx.db, x, ctx.d);
}

/**
 * Message et résultat d'une validation groupée, d'après son bilan (une seule passe, ou les tranches réunies). Aucune
 * validée ni déjà validée : refus (403 si toutes l'étaient pour des droits, sinon 400 avec la liste). `interruption` :
 * validation arrêtée avant la fin (Cursus occupé, erreur), les feuilles `restantes` sont à relancer.
 */
function conclureLot(b: BilanLot, interruption?: { motif: string; restantes: Feuille[] }): { message: string; result: unknown } {
  const nom = (id: number) => b.noms[id] ?? `salarié n° ${id}`;
  const refusTexte = b.refus.map(r => `${nom(r.empId)} S${isoWeek(r.week)} (${r.raison})`).join(' ; ');
  if (!b.validees.length && !b.deja.length && !interruption) {
    if (b.refus.every(r => r.status === 403)) throw new ActionError(b.refus.length === 1 ? b.refus[0].raison : `Aucune feuille validée : ${refusTexte}`, 403);
    throw new ActionError(`Aucune feuille validée — ${plural(b.refus.length, 'refus', 'refus')} : ${refusTexte}`);
  }
  // Seuils franchis, comme à la validation d'une seule feuille : les premiers en entier, le reste compté.
  const alertesTexte = b.alertes.slice(0, ALERTES_MAX).map(a => ` · ${nom(a.empId)} S${isoWeek(a.week)} : ${a.texte}`).join('')
    + (b.alertes.length > ALERTES_MAX ? ` · ${plural(b.alertes.length - ALERTES_MAX, 'autre alerte', 'autres alertes')} de durée, sur les feuilles validées` : '');
  const tete = b.validees.length || !b.deja.length ? plural(b.validees.length, 'feuille validée', 'feuilles validées') : 'Aucune nouvelle feuille validée';
  const message = `${tete}${b.deja.length ? ` · ${plural(b.deja.length, 'feuille déjà validée', 'feuilles déjà validées')}, sautée${b.deja.length > 1 ? 's' : ''}` : ''}`
    + `${b.refus.length ? ` · ${plural(b.refus.length, 'feuille non validée', 'feuilles non validées')}, à ouvrir une à une : ${refusTexte}` : ''}${alertesTexte}`
    + (interruption ? ` · validation interrompue (${interruption.motif}) : ${plural(interruption.restantes.length, 'feuille restante', 'feuilles restantes')} à valider de nouveau, celles déjà validées seront sautées` : '');
  return {
    message,
    result: {
      validees: b.validees, refus: b.refus.map(({ empId, week }) => ({ empId, week })), deja: b.deja,
      ...(interruption ? { restantes: interruption.restantes } : {}),
    },
  };
}

/**
 * Tranche posée par le serveur (`EN_TRANCHE`), absente pour un appel ordinaire : son rang ; `rienAvant` : aucune tranche
 * précédente n'a validé (ni trouvé déjà validée) de feuille ; `refusEnAttente` : refus des tranches précédentes restés
 * sans ligne de journal (tranches vides annulées), à compter dans la ligne de journal de cette tranche.
 */
interface Tranche { rang: number; total: number; rienAvant: boolean; refusEnAttente: Feuille[] }
const trancheDe = (p: Record<string, any>) => (p as Record<symbol, unknown>)[EN_TRANCHE] as Tranche | undefined;

/**
 * Tranche sans feuille validée ni déjà validée alors qu'aucune tranche n'a encore rien fait : levée pour annuler sa
 * transaction (une validation dont tout est refusé n'a pas de ligne de journal, comme en une passe), son bilan (refus)
 * rejoignant celui de la validation ; ses refus sont comptés dans la ligne de journal de la tranche suivante qui en a une.
 */
class TrancheVide extends Error {
  readonly bilan: BilanLot;
  constructor(bilan: BilanLot) { super('Tranche sans feuille validée'); this.bilan = bilan; }
}

/**
 * `feuilles` : [{ empId, week }] soumises (200 au plus), validées sur une seule lecture de la base (`validerFeuilles`).
 * Appelée par le serveur pour une tranche (`EN_TRANCHE`), elle rend son bilan (`result.bilan`, jamais journalisé : la
 * règle du journal ne retient que les feuilles validées et le nombre de refus) au lieu de conclure.
 */
const validerLot: ActionHandler = async (ctx, p) => {
  exigerValideur(ctx, 'Validation des feuilles de temps');
  const b = await validerFeuilles(ctx, feuillesDemandees(p));
  const tranche = trancheDe(p);
  if (!tranche) return conclureLot(b);
  // Rien de fait jusqu'ici (première tranche, ou précédentes toutes vides) : tranche vide annulée. Après une tranche
  // journalisée, une tranche vide est journalisée elle aussi (aucune feuille validée, ses refus comptés).
  if (!b.validees.length && !b.deja.length && tranche.rienAvant) throw new TrancheVide(b);
  const refus = [...tranche.refusEnAttente, ...b.refus.map(({ empId, week }) => ({ empId, week }))];
  return {
    message: `${plural(b.validees.length, 'feuille validée', 'feuilles validées')} (tranche ${tranche.rang} sur ${tranche.total} d’une validation groupée)`
      + `${b.deja.length ? ` · ${plural(b.deja.length, 'feuille déjà validée', 'feuilles déjà validées')}` : ''}`
      + `${b.refus.length ? ` · ${plural(b.refus.length, 'feuille non validée', 'feuilles non validées')}` : ''}`
      + `${tranche.refusEnAttente.length ? ` · ${plural(tranche.refusEnAttente.length, 'feuille non validée', 'feuilles non validées')} aux tranches précédentes` : ''}`,
    result: { validees: b.validees, refus, bilan: b },
  };
};

/** Une passe de l'action dans sa transaction, journal compris (server/src/app.ts). */
type Passe = (p: Record<string, any>) => Promise<{ message?: string | null; result?: unknown }>;

/**
 * Validation groupée par tranches (lot 8, chantier E) : au-delà de `TRANCHE_MAX` feuilles, une transaction par tranche
 * (verrou d'écriture rendu entre deux tranches, chacune journalisée), puis un message pour l'ensemble. Une tranche qui
 * échoue (Cursus occupé, erreur imprévue) arrête la validation : celles déjà faites restent validées, le résultat
 * partiel nomme les feuilles restantes ; relancer la même validation saute les feuilles déjà validées. Rien de fait :
 * l'erreur est rendue telle quelle (503 « occupé », 500). `signaler` : erreur imprévue d'une tranche, écrite aux
 * journaux du serveur.
 */
export async function validerEnTranches(p: Record<string, any>, passe: Passe, signaler: (err: unknown) => void = () => {}): Promise<{ message?: string | null; result?: unknown }> {
  const demandees = feuillesDemandees(p);
  if (demandees.length <= TRANCHE_MAX) return await passe(p);
  const tranches: Feuille[][] = [];
  for (let i = 0; i < demandees.length; i += TRANCHE_MAX) tranches.push(demandees.slice(i, i + TRANCHE_MAX));
  const b: BilanLot = { validees: [], deja: [], refus: [], alertes: [], noms: {}, delegations: [] };
  let interruption: { motif: string; restantes: Feuille[] } | undefined;
  /** Refus des tranches vides annulées, pas encore comptés dans une ligne de journal. */
  let refusEnAttente: Feuille[] = [];
  const reunir = (t: BilanLot) => {
    b.validees.push(...t.validees); b.deja.push(...t.deja); b.refus.push(...t.refus); b.alertes.push(...t.alertes);
    Object.assign(b.noms, t.noms);
    for (const n of t.delegations) if (!b.delegations.includes(n)) b.delegations.push(n);
  };
  for (const [i, feuilles] of tranches.entries()) {
    try {
      const o = await passe({ ...p, feuilles, [EN_TRANCHE]: { rang: i + 1, total: tranches.length, rienAvant: !b.validees.length && !b.deja.length, refusEnAttente } satisfies Tranche });
      reunir((o.result as { bilan: BilanLot }).bilan);
      refusEnAttente = [];
    } catch (err) {
      if (err instanceof TrancheVide) {
        reunir(err.bilan);
        refusEnAttente = [...refusEnAttente, ...err.bilan.refus.map(({ empId, week }) => ({ empId, week }))];
        continue;
      }
      // Refus de droits ou de saisie (première tranche : rien n'est fait) et rien de validé : rendu tel quel.
      if (!b.validees.length && !b.deja.length) throw err;
      if (!(err instanceof ActionError) && !estOccupe(err)) signaler(err);
      interruption = { motif: err instanceof ActionError ? err.message : estOccupe(err) ? CURSUS_OCCUPE : ERREUR_INTERNE, restantes: tranches.slice(i).flat() };
      break;
    }
  }
  const o = conclureLot(b, interruption);
  return { ...o, message: `${o.message}${b.delegations.length ? ` · par délégation de ${b.delegations.join(' et de ')}` : ''}` };
}

export const suiviFeuillesActions = {
  'temps.relancer': relancer,
  'temps.validerLot': validerLot,
} satisfies Record<string, ActionHandler>;
