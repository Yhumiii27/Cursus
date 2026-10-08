// Fiches collaborateurs (contrat, statut, temps de travail), équipes et managers.
import { isValidDate } from '../../../shared/dates.ts';
import { key } from '../../../shared/format.ts';
import { contratFige } from '../../../shared/rules/temps.ts';
import { MANAGER_FIELDS, PROFIL_FIELDS, profilOf, validerProfil, type ProfilInput } from '../../../shared/rules/profil.ts';
import type { Employe, Equipe, FeuilleTemps } from '../../../shared/types.ts';
import { ActionError, getEmp, isManagerOf, isRh, requireRh, str, type ActionHandler, type Ctx } from './context.ts';

function equipesNoms(ctx: Ctx) { return ctx.ds.referentiels.equipes.map(q => q.nom); }

function getEquipe(ctx: Ctx, nom: unknown): Equipe {
  const q = ctx.ds.referentiels.equipes.find(x => x.nom === nom);
  if (!q) throw new ActionError('Équipe introuvable', 404);
  return q;
}

function check(ctx: Ctx, p: ProfilInput, empId?: number) {
  const v = validerProfil(p, { equipes: equipesNoms(ctx), year: ctx.d.year, encadre: empId ? ctx.d.teamsOf(empId) : [] });
  if (!v.ok) throw new ActionError(v.errors.join(' '));
  return v;
}

/** Un manager doit être un collaborateur de l'entreprise (pas un intérimaire). */
function checkManager(ctx: Ctx, id: unknown): Employe {
  const m = getEmp(ctx, id);
  if (m.typeContrat === 'interim') throw new ActionError('Un intérimaire ne peut pas être désigné manager');
  return m;
}

const REGIME: (keyof ProfilInput)[] = ['temps', 'heures', 'forfaitHeures', 'forfaitJours', 'jourOff', 'statut', 'typeContrat'];

/** Colonnes de la table employes pour une fiche validée. */
const toRow = (p: ProfilInput) => ({ ...p });

const creer: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const input = {} as Record<string, unknown>;
  PROFIL_FIELDS.forEach(k => { input[k] = p[k] ?? null; });
  const v = check(ctx, input as unknown as ProfilInput);
  const row = ctx.db.insert<Employe>('employes', toRow(v.profil));
  ctx.db.insert('soldesReprise', { empId: row.id, cpPris: 0, rttPris: 0, recupAcquis: 0, recupPris: 0 });
  return { message: `Fiche créée — ${v.profil.nom}${v.profil.equipe ? ' · équipe ' + v.profil.equipe : ' · à affecter'}`, result: { id: row.id } };
};

/** RH : toute la fiche. Manager : poste et jours non travaillés (temps partiel) des membres de son équipe. */
const modifier: ActionHandler = (ctx, p) => {
  const emp = getEmp(ctx, p.id);
  const cur = profilOf(emp);
  let fields: (keyof ProfilInput)[];
  if (isRh(ctx)) fields = PROFIL_FIELDS;
  else if (isManagerOf(ctx, emp)) fields = MANAGER_FIELDS;
  else throw new ActionError('Fiche réservée au service RH ou au manager du collaborateur', 403);
  const patch = Object.keys(p).filter(k => k !== 'id') as (keyof ProfilInput)[];
  const refused = patch.filter(k => !fields.includes(k));
  if (refused.length) throw new ActionError(`Champs réservés au service RH : ${refused.join(', ')}`, 403);
  if (!isRh(ctx) && patch.includes('jourOff') && cur.temps !== 'partiel') throw new ActionError('Les jours non travaillés ne concernent que le temps partiel');
  const next = { ...cur } as Record<string, unknown>;
  patch.forEach(k => { next[k] = p[k]; });
  const v = check(ctx, next as unknown as ProfilInput, emp.id);
  // Changement d'organisation du temps : date d'effet, et gel de l'ancien régime sur les semaines antérieures
  // pas encore figées, pour que l'historique ne soit pas recalculé avec le nouveau contrat.
  const avant = JSON.stringify(contratFige(emp)), apres = JSON.stringify(contratFige({ ...emp, ...v.profil }));
  const row = toRow(v.profil);
  if (avant !== apres && REGIME.some(k => patch.includes(k))) {
    const P = v.profil;
    const regimeTemps = emp.temps !== P.temps || emp.heures !== P.heures || emp.forfaitHeures !== P.forfaitHeures || emp.forfaitJours !== P.forfaitJours;
    // La date d'effet saisie ne vaut que pour un changement d'organisation du temps ; sinon le changement vaut à compter d'aujourd'hui.
    const effet = regimeTemps && isValidDate(p.tempsDepuis) ? p.tempsDepuis : ctx.d.ti;
    if (effet < emp.entree) throw new ActionError('La date d’effet précède la date d’entrée');
    if (effet > ctx.d.ti) throw new ActionError('Date d’effet future : enregistrez le changement le jour de sa prise d’effet');
    if (regimeTemps) row.tempsDepuis = effet;
    else row.tempsDepuis = emp.tempsDepuis;
    ctx.ds.feuilles.filter(f => f.empId === emp.id && !f.contrat && f.week < effet)
      .forEach(f => ctx.db.update<FeuilleTemps>('feuilles', f.id, { contrat: contratFige(emp) }));
  } else row.tempsDepuis = emp.tempsDepuis;
  ctx.db.update('employes', emp.id, row);
  return `Fiche de ${v.profil.nom} mise à jour`;
};

const creerEquipe: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const nom = str(p.nom);
  if (!nom) throw new ActionError('Nom d’équipe requis');
  if (ctx.ds.referentiels.equipes.some(q => key(q.nom) === key(nom))) throw new ActionError('Une équipe porte déjà ce nom');
  const managerId = p.managerId ? checkManager(ctx, p.managerId).id : null;
  const ordre = Math.max(-1, ...ctx.ds.referentiels.equipes.map(q => q.ordre)) + 1;
  ctx.db.insert('equipes', { nom, managerId, ordre });
  return `Équipe ${nom} créée${managerId ? ' — manager : ' + ctx.d.personName(managerId) : ''}`;
};

const renommer: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const q = getEquipe(ctx, p.nom);
  const nouveau = str(p.nouveau);
  if (!nouveau) throw new ActionError('Nouveau nom requis');
  if (nouveau === q.nom) return null;
  if (ctx.ds.referentiels.equipes.some(x => x.nom !== q.nom && key(x.nom) === key(nouveau))) throw new ActionError('Une équipe porte déjà ce nom');
  for (const [table, col] of [['equipes', 'nom'], ['employes', 'equipe'], ['budgets', 'equipe'], ['plan_actions', 'equipe']]) {
    ctx.db.sql.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`).run(nouveau, q.nom);
  }
  return `Équipe ${q.nom} renommée en ${nouveau}`;
};

const designer: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const q = getEquipe(ctx, p.nom);
  if (!p.managerId) {
    ctx.db.update('equipes', q.nom, { managerId: null });
    return `L’équipe ${q.nom} n’a plus de manager — validations assurées par le service RH`;
  }
  const m = checkManager(ctx, p.managerId);
  ctx.db.update('equipes', q.nom, { managerId: m.id });
  return `${m.nom} devient manager de l’équipe ${q.nom}`;
};

const supprimer: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const q = getEquipe(ctx, p.nom);
  const n = ctx.ds.employes.filter(e => e.equipe === q.nom).length;
  if (n) throw new ActionError(`L’équipe compte encore ${n} collaborateur${n > 1 ? 's' : ''} : affectez-les d’abord à une autre équipe`);
  if (ctx.ds.plan.some(l => l.equipe === q.nom)) throw new ActionError('Des actions du plan de formation sont rattachées à cette équipe');
  ctx.db.sql.prepare('DELETE FROM budgets WHERE equipe = ?').run(q.nom);
  ctx.db.remove('equipes', q.nom);
  return `Équipe ${q.nom} supprimée`;
};

/**
 * Affectation d'un collaborateur à une équipe (`equipe` = null : à affecter).
 * RH : toute affectation. Manager : ajouter un collaborateur à une équipe qu'il encadre,
 * ou retirer un membre de son équipe (il revient alors au service RH).
 */
const affecter: ActionHandler = (ctx, p) => {
  const emp = getEmp(ctx, p.empId);
  const cible = p.equipe ? getEquipe(ctx, p.equipe).nom : null;
  const avant = emp.equipe;
  if (cible === avant) return null;
  if (!isRh(ctx)) {
    if (ctx.user.role !== 'manager') throw new ActionError('Affectation réservée au service RH et aux managers', 403);
    const mine = ctx.d.teamsOf(ctx.user.empId);
    if (emp.id === ctx.user.empId) throw new ActionError('Votre propre affectation relève du service RH', 403);
    if (cible && !mine.includes(cible)) throw new ActionError('Vous ne pouvez affecter qu’à une équipe que vous encadrez', 403);
    if (!cible && !(avant && mine.includes(avant))) throw new ActionError('Ce collaborateur ne fait pas partie de votre équipe', 403);
    // Les managers et le valideur du manager ne changent d'équipe que par le service RH (pas de validation croisée).
    if (ctx.d.teamsOf(emp.id).length) throw new ActionError(`${emp.nom} encadre une équipe : son affectation relève du service RH`, 403);
    const moi = ctx.d.emp(ctx.user.empId!);
    if (moi && ctx.d.mgrOf(moi) === emp.id) throw new ActionError('Votre propre manager ne peut pas rejoindre votre équipe', 403);
  }
  ctx.db.update('employes', emp.id, { equipe: cible });
  if (!cible) return `${emp.nom} retiré de l’équipe ${avant} — à affecter par le service RH`;
  return `${emp.nom} rejoint l’équipe ${cible}${avant ? ` (auparavant ${avant})` : ''}`;
};

export const equipesActions: Record<string, ActionHandler> = {
  'employe.creer': creer,
  'employe.modifier': modifier,
  'equipe.creer': creerEquipe,
  'equipe.renommer': renommer,
  'equipe.manager': designer,
  'equipe.supprimer': supprimer,
  'equipe.affecter': affecter,
};
