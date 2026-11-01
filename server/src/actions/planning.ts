// Planning d'équipe (lot 12, chantier C5, t192, étape 1) : cycles de roulement et besoins par poste (service RH,
// référentiels communs), affectations au roulement, génération, corrections, publication et annulation des créneaux
// (planificateur : manager direct, son suppléant par délégation « planning », ou service RH, jamais pour soi-même),
// échanges de poste (le salarié propose, le collègue accepte, le manager des deux valide). Règles : shared/rules/cycles.ts,
// planning.ts, planning-controles.ts ; information des salariés : server/src/planning-envois.ts. Le module est livré
// désactivé (réglage `planningActif`, après l'avis du CSE) : tout est refusé (409) tant qu'il l'est, sauf les référentiels
// (cycles, besoins), qui se préparent avant l'activation. Les contrôles légaux et d'habilitation sont recalculés à chaque
// publication et à chaque validation d'un échange : un refus bloque, une alerte exige un motif (gardé sur le créneau, jamais
// journalisé), une information n'arrête rien.
import { addD, mondayOf } from '../../../shared/dates.ts';
import { fmtIso, plural } from '../../../shared/format.ts';
import { absenceBloque, jourHorsContrat } from '../../../shared/rules/absences.ts';
import { controlerCycle, cycleDe, normaliserCodeCycle, roulementsDuCycle } from '../../../shared/rules/cycles.ts';
import { delegationActive, valideursDe } from '../../../shared/rules/delegations-manager.ts';
import { exigencesDe } from '../../../shared/rules/exigences.ts';
import { horaireDe, normaliserCodeHoraire } from '../../../shared/rules/horaires.ts';
import {
  besoinsDuJour, controlerBesoin, controlerRoulement, creneauxPlanificateur, debutCreneau, ECHANGE_OUVERT, echangeExpire, figerHoraire, genererCreneaux,
  horaireDuCreneau, MOTIF_PLANNING_MAX, postesApresEchange, prevenanceCreneau, refusPeriode, refusPublication, sansBrouillonsPasses, sortGenere,
} from '../../../shared/rules/planning.ts';
import {
  type AlertePlanning, alertesHabilitations, codesAcceptes, controlesPlanning, JOURS_APRES, type JourPlanifie, reglagesPlanning, SEMAINES_AVANT, trierAlertes,
} from '../../../shared/rules/planning-controles.ts';
import { refusNuitMineur, statutNuit } from '../../../shared/rules/repos-nuit.ts';
import { derogationDe } from '../../../shared/rules/semaine.ts';
import type { Employe, Equipe, ISODate } from '../../../shared/types.ts';
import type { BesoinPoste, Creneau, Cycle, EchangePoste, PublicationPlanning, Roulement } from '../../../shared/types-planning.ts';
import { horloge } from '../astreintes.ts';
import { instantParis } from '../../../shared/rules/planning-controles.ts';
import { notifierEchange, prevenirPlanning } from '../planning-envois.ts';
import {
  ActionError, type ActionHandler, type Ctx, enriched, estSoiMeme, getEmp, isManagerOf, isRh, isValidatorOf, refuserSoiMeme, requireRh, str,
} from './context.ts';

// — Module, droits, lectures —

/** Module activé (réglage `planningActif`), sinon refus. */
function actif(ctx: Ctx) {
  if (!ctx.ds.settings.planningActif) throw new ActionError('Planning d’équipe désactivé : l’administrateur RH l’active dans Paramètres, après l’avis du CSE', 409);
}

/** Planificateur d'un salarié : service RH (jamais pour soi-même), manager direct, ou son suppléant par délégation « planning ». */
function requirePlanificateur(ctx: Ctx, e: Employe) {
  if (isRh(ctx)) { refuserSoiMeme(ctx, e, 'Planning pour vous-même'); return; }
  if (!isManagerOf(ctx, e, 'planning')) throw new ActionError('Planning tenu par le manager du salarié (ou son suppléant) ou le service RH', 403);
}

/** `requirePlanificateur` sans refus : la personne connectée planifie-t-elle aujourd'hui ce salarié ? */
const planifie = (ctx: Ctx, e: Employe) => (isRh(ctx) ? !estSoiMeme(ctx, e.id) : isManagerOf(ctx, e, 'planning'));

/**
 * Planificateur d'une équipe : service RH, son manager, ou le suppléant d'une délégation « planning » de ce manager (la
 * décision est alors signée « par délégation de »). Équipe inconnue : 404.
 */
function requirePlanificateurEquipe(ctx: Ctx, nom: unknown): Equipe {
  const q = ctx.ds.referentiels.equipes.find(x => x.nom === nom);
  if (!q) throw new ActionError('Équipe introuvable', 404);
  if (isRh(ctx)) return q;
  if (ctx.user.role === 'manager' && ctx.user.empId) {
    if (q.managerId === ctx.user.empId) return q;
    const g = q.managerId ? delegationActive(ctx.ds, q.managerId, ctx.d.ti, 'planning') : null;
    if (g && g.suppleantId === ctx.user.empId) { ctx.parDelegation.add(g.managerId); return q; }
  }
  throw new ActionError('Planning de l’équipe tenu par son manager (ou son suppléant) ou le service RH', 403);
}

/** Créneaux de la base (hors de la fenêtre de l'instantané comprise) qui vérifient la condition. */
const lireCreneaux = async (ctx: Ctx, where: string, params: readonly (string | number)[]) => await ctx.db.allDans<Creneau>('creneaux', { where, params });

/** Créneau désigné par son identifiant, dans le périmètre du planificateur (sinon le même refus qu'un inconnu). */
async function creneauDe(ctx: Ctx, id: unknown): Promise<{ c: Creneau; emp: Employe | null }> {
  const c = await ctx.db.get<Creneau>('creneaux', Number(id) || 0);
  if (!c) throw new ActionError('Créneau introuvable', isRh(ctx) ? 404 : 403);
  if (c.empId == null) { requirePlanificateurEquipe(ctx, c.equipe); return { c, emp: null }; }
  const emp = getEmp(ctx, c.empId);
  requirePlanificateur(ctx, emp);
  return { c, emp };
}

/** Motif reçu (texte libre, 500 caractères au plus), vide : null. */
function motifDe(v: unknown, quoi: string): string | null {
  const m = str(v).replace(/\s+/g, ' ');
  if (m.length > MOTIF_PLANNING_MAX) throw new ActionError(`${quoi} : ${MOTIF_PLANNING_MAX} caractères au plus`);
  return m || null;
}

/** Horaire reçu (code en vigueur ; « » ou null : repos) et ses colonnes figées. */
function horaireRecu(ctx: Ctx, v: unknown, reposAdmis = true) {
  const code = v == null ? '' : normaliserCodeHoraire(v);
  if (!code) {
    if (!reposAdmis) throw new ActionError('Choisissez l’horaire du poste');
    return figerHoraire(null);
  }
  const h = horaireDe(ctx.ds.referentiels, code);
  if (!h || h.archive) throw new ActionError(`Horaire ${code} inconnu ou archivé`);
  return figerHoraire(h);
}

/** Refus immédiats d'un poste un jour donné : hors du contrat, nuit d'un salarié mineur. */
function refusPoste(emp: Employe, jour: ISODate, h: ReturnType<typeof figerHoraire>) {
  const hors = jourHorsContrat(emp, jour);
  if (hors) throw new ActionError(`${fmtIso(jour)} : hors du contrat (${hors})`);
  const fige = horaireDuCreneau(h);
  const mineur = fige ? refusNuitMineur(emp, fige, jour) : null;
  if (mineur) throw new ActionError(mineur);
}

const maintenant = (ctx: Ctx) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(horloge.maintenant()).map(x => [x.type, x.value]));
  return instantParis(ctx.d.ti, `${p.hour}:${p.minute}`);
};
const nouveau = (ctx: Ctx) => ({ creeLe: new Date().toISOString(), creePar: ctx.user.nom });

// — Contrôles d'une période —

/** Postes connus d'un salarié autour de la période, tels que le planificateur les voit, avec `remplacer` appliqué. */
async function joursPlanifies(ctx: Ctx, empId: number, du: ISODate, au: ISODate, remplacer: ReadonlyMap<ISODate, Creneau | null> = new Map()): Promise<JourPlanifie[]> {
  // Brouillons des jours passés (jamais communiqués) ignorés : ces jours-là, la version publiée compte.
  const lues = await lireCreneaux(ctx, 'emp_id = ? AND jour >= ? AND jour <= ?', [empId, addD(mondayOf(du), -7 * SEMAINES_AVANT), addD(au, JOURS_APRES)]);
  const lignes = creneauxPlanificateur(sansBrouillonsPasses(lues, ctx.d.ti));
  const parJour = new Map<ISODate, JourPlanifie>(lignes.map(c => [c.jour, { jour: c.jour, horaire: horaireDuCreneau(c) }]));
  for (const [jour, c] of remplacer) parJour.set(jour, { jour, horaire: c ? horaireDuCreneau(c) : null });
  return [...parJour.values()].sort((a, b) => a.jour.localeCompare(b.jour));
}

/**
 * Contrôles légaux et d'habilitation des salariés `empIds` du `du` au `au`, sur leurs postes connus (avec les postes
 * remplacés par `remplacer`, clé « empId|jour »). Jours d'absence en vigueur ignorés ; nature jamais lue.
 */
async function controler(ctx: Ctx, empIds: readonly number[], du: ISODate, au: ISODate, remplacer: ReadonlyMap<string, Creneau | null> = new Map()): Promise<AlertePlanning[]> {
  const out: AlertePlanning[] = [];
  const enrichis = new Map(enriched(ctx).map(e => [e.id, e]));
  const noms = {
    habilitation: (id: string) => ctx.ds.referentiels.habilitations.find(h => h.id === id)?.nom ?? id,
    formation: (id: string) => ctx.ds.referentiels.formations.find(f => f.id === id)?.court ?? id,
  };
  for (const empId of empIds) {
    const emp = getEmp(ctx, empId), ex = enrichis.get(empId);
    const siens = new Map([...remplacer].filter(([k]) => k.startsWith(`${empId}|`)).map(([k, c]) => [k.slice(k.indexOf('|') + 1), c]));
    const jours = await joursPlanifies(ctx, empId, du, au, siens);
    const absents = new Set<ISODate>();
    for (const a of ctx.ds.absences.filter(x => x.empId === empId && absenceBloque(x) && x.au >= jours[0]?.jour && x.du <= (jours.at(-1)?.jour ?? x.du))) {
      for (let j = a.du; j <= a.au; j = addD(j, 1)) absents.add(j);
    }
    const c = ctx.d.contratOf(emp);
    out.push(...controlesPlanning({
      employe: emp, jours, du, au, reglages: ctx.ds.settings, derogationDominicale: !!derogationDe(ctx.ds, emp), absents,
      travailleurNuit: statutNuit(ctx.ds, emp.id, ctx.d.ti).travailleur, dureesExclues: c.dirigeant || c.forfait,
    }));
    if (ex) {
      const base = exigencesDe(ctx.ds, emp);
      const travailles = jours.filter(j => j.horaire && j.jour >= du && j.jour <= au && !absents.has(j.jour)).map(j => {
        const propres = besoinsDuJour(ctx.ds.besoinsPoste, emp.equipe, j.horaire!.code, j.jour);
        return {
          jour: j.jour,
          exigences: {
            formations: [...new Set([...base.filter(x => x.type === 'formation').map(x => x.id), ...propres.flatMap(b => b.exigences.formations)])],
            habilitations: [...new Set([...base.filter(x => x.type === 'habilitation').map(x => x.id), ...propres.flatMap(b => b.exigences.habilitations)])],
          },
        };
      });
      out.push(...alertesHabilitations(ex, travailles, du, ctx.d.ti, noms));
    }
  }
  return out;
}

/** Textes des alertes, avec le nom du salarié, limités aux premières. */
function listeAlertes(ctx: Ctx, alertes: readonly AlertePlanning[], n = 6): string {
  const textes = alertes.slice(0, n).map(a => `${ctx.d.personName(a.empId)} — ${a.texte}`);
  return `${textes.join(' ; ')}${alertes.length > n ? ` ; et ${alertes.length - n} autre${alertes.length - n > 1 ? 's' : ''}` : ''}`;
}

/** Refus et alertes : 409 pour un refus ; alertes sans motif : 400, avec la liste ; sinon le motif et le nombre d'alertes. */
function trancher(ctx: Ctx, alertes: readonly AlertePlanning[], motifRecu: unknown, quoi: 'Publication' | 'Validation de l’échange'): { motifAlertes: string | null; n: number } {
  const t = trierAlertes(alertes);
  if (t.refus.length) throw new ActionError(`${quoi} impossible : ${listeAlertes(ctx, t.refus)}`, 409);
  const motifAlertes = motifDe(motifRecu, 'Motif des alertes');
  if (t.alertes.length && !motifAlertes) throw new ActionError(`${quoi} : alertes à motiver — ${listeAlertes(ctx, t.alertes)}`);
  return { motifAlertes: t.alertes.length ? motifAlertes : null, n: t.alertes.length };
}

// — Cycles et besoins (service RH ; préparés avant l'activation) —

const cycleCreer: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const r = controlerCycle(p, ctx.ds.cycles ?? [], ctx.ds.referentiels.horaires ?? [], null);
  if (!r.valeurs) throw new ActionError(Object.values(r.erreurs)[0] ?? 'Cycle invalide');
  await ctx.db.insert<Cycle>('cycles', { ...r.valeurs, archive: null, ...nouveau(ctx) });
  return { message: `Cycle ${r.valeurs.code} créé (${plural(r.valeurs.longueur, 'jour', 'jours')}, ${plural(r.valeurs.groupes.length, 'groupe', 'groupes')})`, result: { code: r.valeurs.code } };
};

const cycleDeCode = (ctx: Ctx, code: unknown): Cycle => {
  const c = cycleDe(ctx.ds.cycles, normaliserCodeCycle(code));
  if (!c) throw new ActionError('Cycle introuvable', 404);
  return c;
};

const cycleModifier: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const avant = cycleDeCode(ctx, p.code);
  if (avant.archive) throw new ActionError(`Cycle ${avant.code} archivé : rétablissez-le d’abord`, 409);
  const r = controlerCycle(p, ctx.ds.cycles ?? [], ctx.ds.referentiels.horaires ?? [], avant);
  if (!r.valeurs) throw new ActionError(Object.values(r.erreurs)[0] ?? 'Cycle invalide');
  const { code: _code, ...maj } = r.valeurs;
  await ctx.db.update<Cycle>('cycles', avant.code, maj);
  return `Cycle ${avant.code} enregistré : les prochaines générations suivent la nouvelle séquence (les créneaux déjà publiés ne changent pas)`;
};

/** Archivage (`archive` vrai, par défaut) ou rétablissement ; archivage refusé tant qu'une affectation en cours ou à venir l'emploie. */
const cycleArchiver: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const c = cycleDeCode(ctx, p.code), retablir = p.archive === false;
  if (!!c.archive === !retablir) return null;
  if (!retablir) {
    const r = roulementsDuCycle(ctx.ds.roulements, c.code, ctx.d.ti);
    if (r.length) throw new ActionError(`Cycle ${c.code} employé par ${plural(r.length, 'affectation en cours ou à venir', 'affectations en cours ou à venir')} : terminez-les d’abord`, 409);
  }
  await ctx.db.update<Cycle>('cycles', c.code, { archive: retablir ? null : ctx.d.ti });
  return retablir ? `Cycle ${c.code} rétabli` : `Cycle ${c.code} archivé : plus proposé aux affectations`;
};

const referentielsBesoin = (ctx: Ctx) => ({
  equipes: ctx.ds.referentiels.equipes, horaires: ctx.ds.referentiels.horaires ?? [], postes: ctx.ds.referentiels.postes,
  formations: ctx.ds.referentiels.formations, habilitations: ctx.ds.referentiels.habilitations,
});
const besoinDe = (ctx: Ctx, id: unknown): BesoinPoste => {
  const b = (ctx.ds.besoinsPoste ?? []).find(x => x.id === Number(id));
  if (!b) throw new ActionError('Besoin introuvable', 404);
  return b;
};

const besoinCreer: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const r = controlerBesoin(p, referentielsBesoin(ctx), null);
  if (!r.valeurs) throw new ActionError(Object.values(r.erreurs)[0] ?? 'Besoin invalide');
  const b = await ctx.db.insert<BesoinPoste>('besoinsPoste', { ...r.valeurs, archive: null });
  return { message: `Besoin de l’équipe ${b.equipe} enregistré : ${b.effectifMin} au poste ${b.horaire}`, result: { besoin: b.id } };
};

const besoinModifier: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const avant = besoinDe(ctx, p.id);
  if (avant.archive) throw new ActionError('Besoin archivé : il ne se modifie plus', 409);
  const r = controlerBesoin(p, referentielsBesoin(ctx), avant);
  if (!r.valeurs) throw new ActionError(Object.values(r.erreurs)[0] ?? 'Besoin invalide');
  await ctx.db.update<BesoinPoste>('besoinsPoste', avant.id, r.valeurs);
  return `Besoin de l’équipe ${r.valeurs.equipe} enregistré : ${r.valeurs.effectifMin} au poste ${r.valeurs.horaire}`;
};

const besoinArchiver: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const b = besoinDe(ctx, p.id);
  if (b.archive) return null;
  await ctx.db.update<BesoinPoste>('besoinsPoste', b.id, { archive: ctx.d.ti });
  return `Besoin de l’équipe ${b.equipe} au poste ${b.horaire} archivé`;
};

// — Affectations au roulement —

const roulementAffecter: ActionHandler = async (ctx, p) => {
  actif(ctx);
  const emp = getEmp(ctx, p.empId);
  requirePlanificateur(ctx, emp);
  const r = controlerRoulement(p, emp, ctx.ds.cycles ?? [], ctx.ds.roulements ?? []);
  if (!r.valeurs) throw new ActionError(Object.values(r.erreurs)[0] ?? 'Affectation invalide');
  const x = await ctx.db.insert<Roulement>('roulements', { empId: emp.id, ...r.valeurs, equipe: emp.equipe ?? null, ...nouveau(ctx), finLe: null, finPar: null, finMotif: null });
  return {
    message: `${emp.nom} affecté au cycle ${x.cycle} (groupe ${x.groupe}) à partir du ${fmtIso(x.du)}${x.au ? ` jusqu’au ${fmtIso(x.au)}` : ''}`,
    result: { roulement: { id: x.id, empId: emp.id, cycle: x.cycle, groupe: x.groupe, du: x.du, au: x.au } },
  };
};

/** `id`, `au` (dernier jour, au plus tôt la veille du début pour une affectation pas encore commencée), `motif` facultatif. */
const roulementTerminer: ActionHandler = async (ctx, p) => {
  actif(ctx);
  const r = (ctx.ds.roulements ?? []).find(x => x.id === Number(p.id));
  if (!r) throw new ActionError('Affectation introuvable', isRh(ctx) ? 404 : 403);
  const emp = getEmp(ctx, r.empId);
  requirePlanificateur(ctx, emp);
  const au = str(p.au);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(au) || au < addD(r.du, -1)) throw new ActionError('Date de fin invalide, ou plus d’un jour avant le début');
  if (r.au && au > r.au) throw new ActionError(`L’affectation finit déjà le ${fmtIso(r.au)} : elle ne s’allonge pas (nouvelle affectation)`, 409);
  await ctx.db.update<Roulement>('roulements', r.id, { au, finLe: new Date().toISOString(), finPar: ctx.user.nom, finMotif: motifDe(p.motif, 'Motif') });
  return `Affectation de ${emp.nom} au cycle ${r.cycle} terminée le ${fmtIso(au)} : les créneaux déjà générés après cette date restent à corriger`;
};

// — Génération, corrections —

/**
 * `equipe`, `du`, `au` (12 semaines au plus, à partir d'aujourd'hui) : créneaux en brouillon d'après les affectations. Seuls
 * les salariés qui font aujourd'hui partie de l'équipe et que la personne connectée planifie sont générés : une affectation
 * garde l'équipe de sa saisie, et un salarié muté depuis relève de son nouveau planificateur (comptés à part).
 */
const generer: ActionHandler = async (ctx, p) => {
  actif(ctx);
  const q = requirePlanificateurEquipe(ctx, p.equipe);
  const refus = refusPeriode(p.du, p.au);
  if (refus) throw new ActionError(refus);
  const du = String(p.du) < ctx.d.ti ? ctx.d.ti : String(p.du), au = String(p.au);
  if (au < du) throw new ActionError('Période passée : un jour passé se corrige sur la feuille de temps');
  const g = genererCreneaux({
    equipe: q.nom, du, au, roulements: ctx.ds.roulements ?? [], cycles: ctx.ds.cycles ?? [], horaires: ctx.ds.referentiels.horaires ?? [],
    employes: ctx.ds.employes, derogation: !!derogationDe(ctx.ds, { equipe: q.nom }),
  });
  const existants = new Map(creneauxPlanificateur(await lireCreneaux(ctx, 'jour >= ? AND jour <= ? AND emp_id IS NOT NULL', [du, au])).map(c => [`${c.empId}|${c.jour}`, c]));
  let crees = 0, maj = 0, gardes = 0, soi = 0;
  const salaries = new Set<number>(), horsEquipe = new Set<number>();
  for (const x of g.creneaux) {
    if (estSoiMeme(ctx, x.empId) || x.empId === ctx.user.empId) { soi++; continue; }
    const emp = ctx.ds.employes.find(e => e.id === x.empId);
    if (!emp || emp.equipe !== q.nom || !planifie(ctx, emp)) { horsEquipe.add(x.empId); continue; }
    const e = existants.get(`${x.empId}|${x.jour}`), sort = sortGenere(e);
    const valeurs = { horaire: x.horaire, debut: x.debut, fin: x.fin, pause: x.pause };
    if (sort === 'garder') { gardes++; continue; }
    salaries.add(x.empId);
    if (sort === 'remplacer') {
      if (e!.horaire === x.horaire && e!.debut === x.debut && e!.fin === x.fin && e!.pause === x.pause) continue;
      await ctx.db.update<Creneau>('creneaux', e!.id, { ...valeurs, equipe: x.equipe, modifieLe: new Date().toISOString(), modifiePar: ctx.user.nom });
      maj++;
    } else {
      await ctx.db.insert<Creneau>('creneaux', {
        empId: x.empId, jour: x.jour, equipe: x.equipe, ...valeurs, besoinId: null, source: 'cycle', statut: 'brouillon', remplaceId: null, version: null,
        publieLe: null, publiePar: null, communiqueLe: null, horsDelai: false, motif: null, motifAlertes: null, alertesAcceptees: null, ...nouveau(ctx),
        modifieLe: null, modifiePar: null, annuleLe: null, annulePar: null, annuleMotif: null,
      });
      crees++;
    }
  }
  const ignores = new Set(g.ignores.map(i => i.empId)).size;
  return {
    message: `Planning de l’équipe ${q.nom} généré du ${fmtIso(du)} au ${fmtIso(au)} : ${plural(crees, 'créneau créé', 'créneaux créés')}, ${plural(maj, 'mis à jour', 'mis à jour')} (brouillon, à publier)`
      + (gardes ? ` · ${plural(gardes, 'créneau publié ou corrigé gardé', 'créneaux publiés ou corrigés gardés')}` : '')
      + (soi ? ` · ${plural(soi, 'créneau', 'créneaux')} vous concernant laissés à votre manager ou au service RH` : '')
      + (horsEquipe.size ? ` · ${plural(horsEquipe.size, 'salarié affecté', 'salariés affectés')} au roulement de l’équipe mais qui n’en ${horsEquipe.size > 1 ? 'font' : 'fait'} plus partie ou que vous ne planifiez pas : rien de généré (affectation à terminer)` : '')
      + (ignores ? ` · ${plural(ignores, 'salarié', 'salariés')} sans cycle ou horaire en vigueur : rien de généré pour eux` : ''),
    result: { equipe: q.nom, du, au, crees, maj, gardes, salaries: [...salaries] },
  };
};

/** `equipe`, `jour`, `horaire`, `empId` (absent : « à pourvoir »), `besoinId` facultatif : créneau ajouté en brouillon. */
const creneauAjouter: ActionHandler = async (ctx, p) => {
  actif(ctx);
  const q = requirePlanificateurEquipe(ctx, p.equipe);
  const emp = p.empId == null || p.empId === '' ? null : getEmp(ctx, p.empId);
  if (emp) requirePlanificateur(ctx, emp);
  // Un poste nominatif est rattaché à l'équipe actuelle du salarié : sinon le planificateur d'une autre équipe le publierait.
  if (emp && emp.equipe !== q.nom) throw new ActionError(`${emp.nom} ne fait pas partie de l’équipe ${q.nom}`);
  const jour = str(p.jour);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) throw new ActionError('Jour invalide');
  if (jour < ctx.d.ti) throw new ActionError('Jour passé : il se corrige sur la feuille de temps', 409);
  const h = horaireRecu(ctx, p.horaire, false);
  if (emp) {
    refusPoste(emp, jour, h);
    const deja = creneauxPlanificateur(await lireCreneaux(ctx, 'emp_id = ? AND jour = ?', [emp.id, jour]));
    if (deja.length) throw new ActionError(`${emp.nom} a déjà un créneau le ${fmtIso(jour)} : modifiez-le`, 409);
  }
  const besoinId = p.besoinId == null || p.besoinId === '' ? null : Number(p.besoinId);
  if (besoinId != null && !(ctx.ds.besoinsPoste ?? []).some(b => b.id === besoinId && b.equipe === q.nom)) throw new ActionError('Besoin inconnu pour cette équipe');
  const c = await ctx.db.insert<Creneau>('creneaux', {
    empId: emp?.id ?? null, jour, equipe: q.nom, ...h, besoinId, source: 'manuel', statut: 'brouillon', remplaceId: null, version: null, publieLe: null, publiePar: null,
    communiqueLe: null, horsDelai: false, motif: null, motifAlertes: null, alertesAcceptees: null, ...nouveau(ctx), modifieLe: null, modifiePar: null,
    annuleLe: null, annulePar: null, annuleMotif: null,
  });
  return {
    message: `${emp ? `Poste de ${emp.nom}` : 'Poste à pourvoir'} ajouté le ${fmtIso(jour)} (${h.horaire}) : brouillon, à publier`,
    result: { creneau: { id: c.id, empId: c.empId, jour, horaire: c.horaire, statut: c.statut } },
  };
};

/**
 * `id`, `horaire` (code ; « » : repos) : brouillon corrigé ; créneau publié à venir : une nouvelle version en brouillon, qui
 * le remplacera à sa publication (avec le délai de prévenance). Un jour passé se corrige sur la feuille de temps.
 */
const creneauModifier: ActionHandler = async (ctx, p) => {
  actif(ctx);
  const { c, emp } = await creneauDe(ctx, p.id);
  if (c.statut === 'annule' || c.statut === 'remplace') throw new ActionError('Créneau annulé ou remplacé : modifiez la version en vigueur', 409);
  if (c.jour < ctx.d.ti) throw new ActionError('Jour passé : il se corrige sur la feuille de temps', 409);
  const h = horaireRecu(ctx, p.horaire, c.empId != null);
  if (emp) refusPoste(emp, c.jour, h);
  const pareil = (x: Creneau) => x.horaire === h.horaire && x.debut === h.debut && x.fin === h.fin && x.pause === h.pause;
  const qui = emp ? emp.nom : 'à pourvoir';
  const modifie = { modifieLe: new Date().toISOString(), modifiePar: ctx.user.nom };
  if (c.statut === 'brouillon') {
    if (pareil(c)) return 'Aucune modification';
    await ctx.db.update<Creneau>('creneaux', c.id, { ...h, source: c.source === 'cycle' ? 'manuel' : c.source, ...modifie });
    return { message: `Créneau du ${fmtIso(c.jour)} (${qui}) corrigé : brouillon, à publier`, result: { creneau: { id: c.id, empId: c.empId, jour: c.jour, horaire: h.horaire, statut: 'brouillon' } } };
  }
  const brouillon = (await lireCreneaux(ctx, 'remplace_id = ? AND statut = ?', [c.id, 'brouillon']))[0];
  if (brouillon) {
    if (pareil(brouillon)) return 'Aucune modification';
    if (pareil(c)) {
      // Retour à la version publiée : la modification en attente est retirée.
      await ctx.db.remove('creneaux', brouillon.id);
      return { message: `Modification du ${fmtIso(c.jour)} (${qui}) retirée : la version publiée reste en vigueur`, result: { creneau: { id: c.id, empId: c.empId, jour: c.jour, horaire: c.horaire, statut: c.statut } } };
    }
    await ctx.db.update<Creneau>('creneaux', brouillon.id, { ...h, ...modifie });
    return { message: `Créneau du ${fmtIso(c.jour)} (${qui}) corrigé : à publier`, result: { creneau: { id: brouillon.id, empId: c.empId, jour: c.jour, horaire: h.horaire, statut: 'brouillon' } } };
  }
  if (pareil(c)) return 'Aucune modification';
  const n = await ctx.db.insert<Creneau>('creneaux', {
    empId: c.empId, jour: c.jour, equipe: c.equipe, ...h, besoinId: c.besoinId, source: 'manuel', statut: 'brouillon', remplaceId: c.id, version: null, publieLe: null,
    publiePar: null, communiqueLe: null, horsDelai: false, motif: null, motifAlertes: null, alertesAcceptees: null, ...nouveau(ctx), ...modifie,
    annuleLe: null, annulePar: null, annuleMotif: null,
  });
  return {
    message: `Créneau publié du ${fmtIso(c.jour)} (${qui}) modifié : la nouvelle version est à publier (délai de prévenance)`,
    result: { creneau: { id: n.id, empId: c.empId, jour: c.jour, horaire: h.horaire, statut: 'brouillon' } },
  };
};

/**
 * `id`, `motif` (exigé pour un créneau publié : communiqué au salarié, jamais au journal) : brouillon retiré (jamais
 * communiqué) ; créneau publié à venir annulé (gardé), le salarié prévenu, les échanges ouverts sur lui annulés.
 */
const creneauAnnuler: ActionHandler = async (ctx, p) => {
  actif(ctx);
  const { c, emp } = await creneauDe(ctx, p.id);
  if (c.statut === 'annule') return 'Créneau déjà annulé';
  if (c.statut === 'remplace') throw new ActionError('Créneau remplacé : annulez la version en vigueur', 409);
  const qui = emp ? emp.nom : 'à pourvoir';
  // Un brouillon n'a jamais été communiqué : il se retire, même passé (généré puis jamais publié).
  if (c.statut === 'brouillon') {
    await ctx.db.remove('creneaux', c.id);
    return { message: `Brouillon du ${fmtIso(c.jour)} (${qui}) retiré`, result: { creneau: { id: c.id, empId: c.empId, jour: c.jour, horaire: c.horaire, statut: 'retire' } } };
  }
  if (c.jour < ctx.d.ti) throw new ActionError('Jour passé : il se corrige sur la feuille de temps', 409);
  const motif = motifDe(p.motif, 'Motif');
  if (!motif) throw new ActionError('Indiquez le motif de l’annulation : il est communiqué au salarié');
  for (const b of await lireCreneaux(ctx, 'remplace_id = ? AND statut = ?', [c.id, 'brouillon'])) await ctx.db.remove('creneaux', b.id);
  const maj = { statut: 'annule' as const, annuleLe: new Date().toISOString(), annulePar: ctx.user.nom, annuleMotif: motif };
  await ctx.db.update<Creneau>('creneaux', c.id, maj);
  for (const e of (ctx.ds.echangesPoste ?? []).filter(x => ECHANGE_OUVERT.includes(x.statut) && (x.creneauDemandeur === c.id || x.creneauPartenaire === c.id))) {
    await ctx.db.update<EchangePoste>('echangesPoste', e.id, { statut: 'annule', decideLe: new Date().toISOString(), decidePar: ctx.user.nom });
  }
  const envoye = emp ? await prevenirPlanning(ctx, emp, [{ ...c, ...maj }], 'annule', motif) : false;
  return {
    message: `Poste du ${fmtIso(c.jour)} (${qui}) annulé${emp ? envoye ? ' · e-mail envoyé au salarié' : ' · pas d’adresse e-mail : prévenez le salarié de vive voix' : ''}`,
    result: { creneau: { id: c.id, empId: c.empId, jour: c.jour, horaire: c.horaire, statut: 'annule' } },
  };
};

// — Publication —

/**
 * `equipe`, `du`, `au` (12 semaines au plus), `motif` (circonstances exceptionnelles, exigé quand un créneau est communiqué
 * sous le délai de prévenance), `motifAlertes` (exigé quand les contrôles relèvent des alertes) : les brouillons de
 * l'équipe sur la période sont publiés en une version, les salariés prévenus. La période commence au plus tôt aujourd'hui :
 * les brouillons des jours passés (jamais communiqués) sont ignorés, et les contrôles d'habilitation partent de là. Refus :
 * un brouillon d'un salarié que la personne connectée ne planifie pas (403, avant tout contrôle : la réserve d'aptitude ne
 * sort jamais du planificateur), un contrôle bloquant, une semaine dont la feuille est validée.
 */
const publier: ActionHandler = async (ctx, p) => {
  actif(ctx);
  const q = requirePlanificateurEquipe(ctx, p.equipe);
  const refus = refusPeriode(p.du, p.au);
  if (refus) throw new ActionError(refus);
  const du = String(p.du) < ctx.d.ti ? ctx.d.ti : String(p.du), au = String(p.au);
  if (au < du) throw new ActionError('Période passée : un jour passé se corrige sur la feuille de temps');
  const brouillons = await lireCreneaux(ctx, 'equipe = ? AND jour >= ? AND jour <= ? AND statut = ?', [q.nom, du, au, 'brouillon']);
  if (!brouillons.length) return 'Rien à publier sur cette période : aucun brouillon';
  const soi = brouillons.find(c => c.empId != null && (c.empId === ctx.user.empId || estSoiMeme(ctx, c.empId)));
  if (soi) refuserSoiMeme(ctx, getEmp(ctx, soi.empId!), 'Publication de votre propre planning');
  if (soi && !isRh(ctx)) throw new ActionError('Publication de votre propre planning : la décision revient à votre manager ou au service RH', 403);
  const autres = [...new Set(brouillons.filter(c => c.empId != null).map(c => c.empId!))].filter(id => !planifie(ctx, getEmp(ctx, id)));
  if (autres.length) {
    throw new ActionError(`Publication impossible : le planning de ${autres.map(id => ctx.d.personName(id)).join(', ')} est tenu par son manager (ou son suppléant) ou le service RH — retirez ces brouillons`, 403);
  }
  const verrou = refusPublication(brouillons, ctx.ds.feuilles, ctx.d.ti, id => ctx.d.personName(id));
  if (verrou.length) throw new ActionError(`Publication impossible : ${verrou.join(' ; ')}`, 409);
  const empIds = [...new Set(brouillons.filter(c => c.empId != null).map(c => c.empId!))];
  const alertes = await controler(ctx, empIds, du, au);
  if (trierAlertes(alertes).refus.length) trancher(ctx, alertes, null, 'Publication');
  // Délai de prévenance, depuis l'envoi de l'e-mail (aujourd'hui), jamais depuis la notification push.
  const delai = reglagesPlanning(ctx.ds.settings).planningDelaiPrevenance;
  const hors = brouillons.filter(c => c.empId != null && prevenanceCreneau(c.jour, ctx.d.ti, delai).horsDelai);
  const motif = motifDe(p.motif, 'Motif des circonstances exceptionnelles');
  if (hors.length && !motif) {
    throw new ActionError(`${plural(hors.length, 'créneau communiqué', 'créneaux communiqués')} moins de ${delai} jours avant leur date (dès le ${fmtIso(hors.map(c => c.jour).sort()[0])}) : indiquez les circonstances exceptionnelles qui le justifient (délai de prévenance)`);
  }
  const { motifAlertes, n } = trancher(ctx, alertes, p.motifAlertes, 'Publication');
  const precedente = await ctx.db.query<{ v: number | null }>('SELECT MAX(version) AS v FROM publications_planning WHERE equipe = ?', [q.nom]);
  const version = Number(precedente[0]?.v ?? 0) + 1;
  const le = new Date().toISOString(), horsIds = new Set(hors.map(c => c.id));
  const publies = new Map<number, Creneau[]>();
  const remplacements = new Set<number>();
  for (const c of brouillons) {
    const codes = c.empId != null ? codesAcceptes(alertes, c.empId, c.jour) : [];
    const maj: Partial<Creneau> = {
      statut: 'publie', version, publieLe: le, publiePar: ctx.user.nom, communiqueLe: ctx.d.ti, horsDelai: horsIds.has(c.id), motif: horsIds.has(c.id) ? motif : null,
      motifAlertes: codes.length ? motifAlertes : null, alertesAcceptees: codes.length ? codes : null,
    };
    if (c.remplaceId) {
      await ctx.db.update<Creneau>('creneaux', c.remplaceId, { statut: 'remplace' });
      if (c.empId != null) remplacements.add(c.empId);
    }
    await ctx.db.update<Creneau>('creneaux', c.id, maj);
    if (c.empId != null) publies.set(c.empId, [...publies.get(c.empId) ?? [], { ...c, ...maj } as Creneau]);
  }
  await ctx.db.insert<PublicationPlanning>('publicationsPlanning', {
    equipe: q.nom, du, au, version, publieLe: le, publiePar: ctx.user.nom, communiqueLe: ctx.d.ti, creneaux: brouillons.length, horsDelai: hors.length,
  });
  let envoyes = 0;
  for (const [empId, liste] of publies) {
    if (await prevenirPlanning(ctx, getEmp(ctx, empId), liste, remplacements.has(empId) ? 'modifie' : 'publie', liste.some(c => c.horsDelai) ? motif : null)) envoyes++;
  }
  const sansAdresse = publies.size - envoyes;
  return {
    message: `Planning de l’équipe ${q.nom} publié du ${fmtIso(du)} au ${fmtIso(au)} (version ${version}) : ${plural(brouillons.length, 'créneau', 'créneaux')}`
      + (hors.length ? ` dont ${hors.length} hors du délai de prévenance (motif noté)` : '') + (n ? ` · ${plural(n, 'alerte acceptée', 'alertes acceptées')}` : '')
      + ` · ${plural(envoyes, 'salarié prévenu par e-mail', 'salariés prévenus par e-mail')}${sansAdresse ? ` · ${plural(sansAdresse, 'salarié', 'salariés')} sans adresse e-mail : à prévenir de vive voix` : ''}`,
    result: { equipe: q.nom, du, au, version, creneaux: brouillons.length, horsDelai: hors.length, alertes: n, salaries: [...publies.keys()] },
  };
};

// — Échanges de poste —

const echangeDe = (ctx: Ctx, id: unknown): EchangePoste => {
  const e = (ctx.ds.echangesPoste ?? []).find(x => x.id === Number(id));
  if (!e) throw new ActionError('Échange introuvable', isRh(ctx) ? 404 : 403);
  return e;
};

/** Créneaux de l'échange, lus en base (hors de la fenêtre de l'instantané compris). */
async function creneauxDeLEchange(ctx: Ctx, e: Pick<EchangePoste, 'creneauDemandeur' | 'creneauPartenaire'>) {
  const a = await ctx.db.get<Creneau>('creneaux', e.creneauDemandeur);
  const b = e.creneauPartenaire ? await ctx.db.get<Creneau>('creneaux', e.creneauPartenaire) ?? null : null;
  return { a, b };
}

/** Échange ouvert dont un créneau a commencé : passé à « expiré », puis 409. */
async function refuserSiExpire(ctx: Ctx, e: EchangePoste) {
  const { a, b } = await creneauxDeLEchange(ctx, e);
  const m = new Map<number, Creneau>([...(a ? [[a.id, a] as const] : []), ...(b ? [[b.id, b] as const] : [])]);
  if (echangeExpire(e, m, maintenant(ctx))) {
    await ctx.db.update<EchangePoste>('echangesPoste', e.id, { statut: 'expire', decideLe: new Date().toISOString() });
    return true;
  }
  return false;
}

/**
 * `creneauId` (son créneau publié, à venir), `partenaireId` (un collègue de son équipe), `creneauPartenaire` (facultatif :
 * un créneau publié à venir du collègue ; absent : cession) : proposé par l'intéressé seulement.
 */
const echangeProposer: ActionHandler = async (ctx, p) => {
  actif(ctx);
  const a = await ctx.db.get<Creneau>('creneaux', Number(p.creneauId) || 0);
  if (!a || a.empId == null || a.empId !== ctx.user.empId) throw new ActionError('Échange proposé par le salarié lui-même, sur l’un de ses créneaux publiés', 403);
  if (a.statut !== 'publie' || !a.horaire) throw new ActionError('Seul un poste publié s’échange', 409);
  const moi = getEmp(ctx, a.empId), autre = getEmp(ctx, p.partenaireId);
  if (autre.id === moi.id) throw new ActionError('Choisissez un collègue');
  if (!autre.equipe || autre.equipe !== a.equipe) throw new ActionError('Un échange se propose à un collègue de la même équipe');
  const now = maintenant(ctx);
  if (debutCreneau(a) <= now) throw new ActionError('Créneau commencé ou passé : il ne s’échange plus', 409);
  let b: Creneau | null = null;
  if (p.creneauPartenaire != null && p.creneauPartenaire !== '') {
    b = await ctx.db.get<Creneau>('creneaux', Number(p.creneauPartenaire)) ?? null;
    if (!b || b.empId !== autre.id || b.statut !== 'publie' || !b.horaire) throw new ActionError('Créneau du collègue introuvable ou non publié', 409);
    if (debutCreneau(b) <= now) throw new ActionError('Créneau du collègue commencé ou passé', 409);
  }
  const ouverts = (ctx.ds.echangesPoste ?? []).filter(x => ECHANGE_OUVERT.includes(x.statut));
  const ids = [a.id, ...(b ? [b.id] : [])];
  if (ouverts.some(x => ids.includes(x.creneauDemandeur) || (x.creneauPartenaire != null && ids.includes(x.creneauPartenaire)))) {
    throw new ActionError('Un échange est déjà en cours sur ce créneau', 409);
  }
  const x = await ctx.db.insert<EchangePoste>('echangesPoste', {
    demandeurId: moi.id, partenaireId: autre.id, creneauDemandeur: a.id, creneauPartenaire: b?.id ?? null, statut: 'propose', creeLe: new Date().toISOString(),
    accepteLe: null, decideLe: null, decidePar: null, parDelegationDe: null, motifRefus: null, alertesAcceptees: null,
  });
  await notifierEchange(ctx, autre.id, true, `Échange de poste proposé par ${moi.nom}`,
    `${moi.nom} vous propose ${b ? `d’échanger son poste du ${fmtIso(a.jour)} contre le vôtre du ${fmtIso(b.jour)}` : `de reprendre son poste du ${fmtIso(a.jour)}`}. Répondez dans Cursus ; l’échange sera ensuite validé par votre manager.`);
  return { message: `Échange proposé à ${autre.nom} : il doit l’accepter, puis votre manager le valider`, result: { echange: x.id, statut: x.statut, salaries: [moi.id, autre.id] } };
};

/** `id` : le collègue accepte ; l'échange part à la validation. */
const echangeAccepter: ActionHandler = async (ctx, p) => {
  actif(ctx);
  const e = echangeDe(ctx, p.id);
  if (e.partenaireId !== ctx.user.empId) throw new ActionError('Seul le collègue sollicité accepte l’échange', 403);
  if (e.statut !== 'propose') throw new ActionError('Échange déjà traité', 409);
  if (await refuserSiExpire(ctx, e)) return { message: 'Échange expiré : un des postes a commencé', result: { echange: e.id, statut: 'expire', salaries: [e.demandeurId, e.partenaireId] } };
  await ctx.db.update<EchangePoste>('echangesPoste', e.id, { statut: 'accepte', accepteLe: new Date().toISOString() });
  const a = getEmp(ctx, e.demandeurId), b = getEmp(ctx, e.partenaireId);
  // Valideurs : le manager de chacun et, pendant sa délégation « planning », son suppléant (service RH : récapitulatif).
  const valideurs = new Set([a, b].flatMap(x => valideursDe(ctx.ds, x, ctx.d.ti, 'planning').map(v => v.id)).filter(id => id && id !== a.id && id !== b.id));
  for (const v of valideurs) await notifierEchange(ctx, v, true, `Échange de poste à valider — ${a.nom} et ${b.nom}`, `${a.nom} et ${b.nom} demandent à échanger un poste. L’échange attend votre validation dans Cursus.`);
  await notifierEchange(ctx, a.id, false, 'Échange de poste accepté', `${b.nom} accepte votre échange de poste ; il attend la validation de votre manager.`);
  return { message: 'Échange accepté : il attend la validation du manager', result: { echange: e.id, statut: 'accepte', salaries: [e.demandeurId, e.partenaireId] } };
};

/**
 * `id`, `motifAlertes` (exigé en cas d'alerte) : le manager des deux salariés (ou son suppléant « planning », ou le service
 * RH) valide ; contrôles recalculés pour les deux ; les postes échangés deviennent des créneaux publiés (sans nouveau délai
 * de prévenance : l'échange vient des intéressés), les anciens sont remplacés.
 */
const echangeValider: ActionHandler = async (ctx, p) => {
  actif(ctx);
  const e = echangeDe(ctx, p.id);
  const ea = getEmp(ctx, e.demandeurId), eb = getEmp(ctx, e.partenaireId);
  if (!isValidatorOf(ctx, ea, 'planning') || !isValidatorOf(ctx, eb, 'planning')) throw new ActionError('Échange validé par le manager des deux salariés (ou son suppléant) ou le service RH', 403);
  if (e.statut !== 'accepte') throw new ActionError(e.statut === 'propose' ? 'Échange pas encore accepté par le collègue' : 'Échange déjà traité', 409);
  if (await refuserSiExpire(ctx, e)) return { message: 'Échange expiré : un des postes a commencé', result: { echange: e.id, statut: 'expire', salaries: [ea.id, eb.id] } };
  const { a, b } = await creneauxDeLEchange(ctx, e);
  if (!a || a.statut !== 'publie' || a.empId !== ea.id || (e.creneauPartenaire && (!b || b.statut !== 'publie' || b.empId !== eb.id))) {
    await ctx.db.update<EchangePoste>('echangesPoste', e.id, { statut: 'annule', decideLe: new Date().toISOString(), decidePar: ctx.user.nom });
    return { message: 'Échange annulé : un des postes a été modifié ou annulé depuis la proposition', result: { echange: e.id, statut: 'annule', salaries: [ea.id, eb.id] } };
  }
  const jours = [...new Set([a.jour, ...(b ? [b.jour] : [])])].sort();
  const actifs = creneauxPlanificateur(await lireCreneaux(ctx, `emp_id IN (?, ?) AND jour IN (${jours.map(() => '?').join(', ')})`, [ea.id, eb.id, ...jours]));
  if (actifs.some(c => c.statut === 'brouillon')) throw new ActionError('Une modification du planning de ces jours attend sa publication : publiez-la ou retirez-la d’abord', 409);
  const r = postesApresEchange(a as Creneau & { empId: number }, b as (Creneau & { empId: number }) | null, eb.id, actifs);
  if (r.refus) throw new ActionError(r.refus, 409);
  const alertes = await controler(ctx, [ea.id, eb.id], jours[0], jours.at(-1)!, r.postes);
  const { motifAlertes } = trancher(ctx, alertes, p.motifAlertes, 'Validation de l’échange');
  const le = new Date().toISOString(), codesTous = new Set<string>();
  for (const [cle, source] of r.postes) {
    const empId = Number(cle.slice(0, cle.indexOf('|'))), jour = cle.slice(cle.indexOf('|') + 1);
    const ancien = actifs.find(c => c.empId === empId && c.jour === jour && c.statut === 'publie');
    if (ancien) await ctx.db.update<Creneau>('creneaux', ancien.id, { statut: 'remplace' });
    const codes = codesAcceptes(alertes, empId, jour);
    codes.forEach(c => codesTous.add(c));
    await ctx.db.insert<Creneau>('creneaux', {
      empId, jour, equipe: (source ?? a).equipe, ...figerHoraire(source ? horaireDuCreneau(source) : null), besoinId: source?.besoinId ?? null, source: 'echange',
      statut: 'publie', remplaceId: ancien?.id ?? null, version: ancien?.version ?? source?.version ?? null, publieLe: le, publiePar: ctx.user.nom, communiqueLe: ctx.d.ti,
      horsDelai: false, motif: null, motifAlertes: codes.length ? motifAlertes : null, alertesAcceptees: codes.length ? codes : null, ...nouveau(ctx),
      modifieLe: null, modifiePar: null, annuleLe: null, annulePar: null, annuleMotif: null,
    });
  }
  await ctx.db.update<EchangePoste>('echangesPoste', e.id, {
    statut: 'valide', decideLe: le, decidePar: ctx.user.nom, parDelegationDe: [...ctx.parDelegation][0] ?? null, alertesAcceptees: codesTous.size ? [...codesTous] : null,
  });
  for (const x of [ea, eb]) await notifierEchange(ctx, x.id, false, 'Échange de poste validé', `L’échange de poste entre ${ea.nom} et ${eb.nom} est validé : votre planning est mis à jour dans Cursus.`);
  return {
    message: `Échange entre ${ea.nom} et ${eb.nom} validé : planning mis à jour${codesTous.size ? ` · ${plural(codesTous.size, 'alerte acceptée', 'alertes acceptées')}` : ''}`,
    result: { echange: e.id, statut: 'valide', alertes: codesTous.size, salaries: [ea.id, eb.id] },
  };
};

/** `id`, `motif` facultatif (montré aux deux salariés, jamais au journal) : le collègue (proposé) ou le valideur (accepté) refuse. */
const echangeRefuser: ActionHandler = async (ctx, p) => {
  actif(ctx);
  const e = echangeDe(ctx, p.id);
  const ea = getEmp(ctx, e.demandeurId), eb = getEmp(ctx, e.partenaireId);
  if (e.statut === 'propose') {
    if (e.partenaireId !== ctx.user.empId) throw new ActionError('Seul le collègue sollicité répond à la proposition', 403);
  } else if (e.statut === 'accepte') {
    if (!isValidatorOf(ctx, ea, 'planning') || !isValidatorOf(ctx, eb, 'planning')) throw new ActionError('Échange refusé par le manager des deux salariés (ou son suppléant) ou le service RH', 403);
  } else throw new ActionError('Échange déjà traité', 409);
  const motif = motifDe(p.motif, 'Motif');
  await ctx.db.update<EchangePoste>('echangesPoste', e.id, {
    statut: 'refuse', decideLe: new Date().toISOString(), decidePar: ctx.user.nom, motifRefus: motif, parDelegationDe: [...ctx.parDelegation][0] ?? null,
  });
  for (const x of e.statut === 'propose' ? [ea] : [ea, eb]) {
    await notifierEchange(ctx, x.id, false, 'Échange de poste refusé', `L’échange de poste entre ${ea.nom} et ${eb.nom} est refusé${motif ? ` : ${motif}` : ''}.`);
  }
  return { message: 'Échange refusé', result: { echange: e.id, statut: 'refuse', salaries: [ea.id, eb.id] } };
};

/** `id` : le demandeur retire sa proposition tant qu'elle n'est pas décidée. */
const echangeAnnuler: ActionHandler = async (ctx, p) => {
  actif(ctx);
  const e = echangeDe(ctx, p.id);
  if (e.demandeurId !== ctx.user.empId) throw new ActionError('Seul le salarié qui a proposé l’échange le retire', 403);
  if (!ECHANGE_OUVERT.includes(e.statut)) throw new ActionError('Échange déjà traité', 409);
  await ctx.db.update<EchangePoste>('echangesPoste', e.id, { statut: 'annule', decideLe: new Date().toISOString(), decidePar: ctx.user.nom });
  if (e.statut === 'accepte') await notifierEchange(ctx, e.partenaireId, false, 'Échange de poste retiré', `${ctx.d.personName(e.demandeurId)} retire l’échange de poste proposé.`);
  return { message: 'Échange retiré', result: { echange: e.id, statut: 'annule', salaries: [e.demandeurId, e.partenaireId] } };
};

export const planningActions = {
  'planning.cycle.creer': cycleCreer,
  'planning.cycle.modifier': cycleModifier,
  'planning.cycle.archiver': cycleArchiver,
  'planning.besoin.creer': besoinCreer,
  'planning.besoin.modifier': besoinModifier,
  'planning.besoin.archiver': besoinArchiver,
  'planning.roulement.affecter': roulementAffecter,
  'planning.roulement.terminer': roulementTerminer,
  'planning.generer': generer,
  'planning.creneau.ajouter': creneauAjouter,
  'planning.creneau.modifier': creneauModifier,
  'planning.creneau.annuler': creneauAnnuler,
  'planning.publier': publier,
  'planning.echange.proposer': echangeProposer,
  'planning.echange.accepter': echangeAccepter,
  'planning.echange.valider': echangeValider,
  'planning.echange.refuser': echangeRefuser,
  'planning.echange.annuler': echangeAnnuler,
} satisfies Record<string, ActionHandler>;
