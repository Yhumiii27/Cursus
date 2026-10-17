// Fiches collaborateurs (contrat, statut, temps de travail), équipes et managers.
import { isValidDate } from '../../../shared/dates.ts';
import { fmtIso, key, plural } from '../../../shared/format.ts';
import { rttPerdus, semainesAFiger, soldeRttTexte, sorti } from '../../../shared/rules/contrats.ts';
import { contratFige } from '../../../shared/rules/temps.ts';
import { matriculesPris } from '../../../shared/rules/matricules.ts';
import { adressesPrises } from '../../../shared/rules/messagerie.ts';
import { posteDe } from '../../../shared/rules/exigences.ts';
import { champsEnConflit, messageConflit } from '../../../shared/rules/fiche-concurrente.ts';
import { MANAGER_FIELDS, PROFIL_FIELDS, profilOf, validerProfil, type ProfilInput } from '../../../shared/rules/profil.ts';
import type { Employe, Equipe, FeuilleTemps } from '../../../shared/types.ts';
import { dernierAuteurFiche } from './fiche-auteur.ts';
import { rattacherPoste } from './referentiels.ts';
import { ActionError, getEmp, isManagerOf, isRh, isRhAdmin, requireRh, requireRhAdmin, str, type ActionHandler, type Ctx } from './context.ts';

function equipesNoms(ctx: Ctx) { return ctx.ds.referentiels.equipes.map(q => q.nom); }

function getEquipe(ctx: Ctx, nom: unknown): Equipe {
  const q = ctx.ds.referentiels.equipes.find(x => x.nom === nom);
  if (!q) throw new ActionError('Équipe introuvable', 404);
  return q;
}

/**
 * Contrôle de la fiche. L'adresse e-mail et le matricule de paie sont uniques : comparés à ceux des autres salariés.
 * Réutiliser le matricule de paie d'un salarié sorti (réembauche) : confirmé par l'administrateur RH (`reutiliserMatricule`).
 * Changer ou retirer un matricule de paie déjà enregistré : administrateur RH seul. Sinon, vider celui d'un salarié sorti
 * puis l'attribuer à une nouvelle fiche contournerait la confirmation de la réembauche, et l'ancienne fiche perdrait son
 * lien avec le dossier de paie.
 */
function check(ctx: Ctx, p: ProfilInput, empId?: number, reutiliser = false) {
  const emp = empId ? ctx.d.emp(empId) : null;
  const actuel = emp?.matriculePaie ?? null;
  const v = validerProfil(p, {
    equipes: equipesNoms(ctx), year: ctx.d.year, encadre: empId ? ctx.d.teamsOf(empId) : [], adressesPrises: adressesPrises(ctx.ds.employes, empId),
    matricules: { pris: matriculesPris(ctx.ds.employes, ctx.d.ti, empId), actuel, reutiliser }, contrat: { finPrevue: emp?.finPrevue ?? null },
  });
  if (!v.ok) throw new ActionError(v.errors.join(' '));
  if (reutiliser && v.matriculeAConfirmer) requireRhAdmin(ctx);
  if (actuel && v.profil.matriculePaie !== actuel && !isRhAdmin(ctx)) {
    throw new ActionError(`Matricule de paie ${actuel} déjà enregistré : seul l’administrateur RH le change ou le retire`, 403);
  }
  return v;
}

/** Un manager doit être un collaborateur de l'entreprise (pas un intérimaire), toujours présent. */
function checkManager(ctx: Ctx, id: unknown): Employe {
  const m = getEmp(ctx, id);
  if (m.typeContrat === 'interim') throw new ActionError('Un intérimaire ne peut pas être désigné manager');
  if (sorti(m, ctx.d.ti)) throw new ActionError(`${m.nom} a quitté l’entreprise le ${fmtIso(m.fin!)} : il ne peut pas être désigné manager`);
  return m;
}

const REGIME: (keyof ProfilInput)[] = ['temps', 'heures', 'forfaitHeures', 'forfaitJours', 'jourOff', 'statut', 'typeContrat'];

/** Colonnes de la table employes pour une fiche validée. */
const toRow = (p: ProfilInput) => ({ ...p });

const creer: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const input = {} as Record<string, unknown>;
  PROFIL_FIELDS.forEach(k => { input[k] = p[k] ?? null; });
  rattacherPoste(ctx, input);
  const v = check(ctx, input as unknown as ProfilInput, undefined, !!p.reutiliserMatricule);
  const row = ctx.db.insert<Employe>('employes', toRow(v.profil));
  // Compteurs repris à zéro, datés de la création : la fiche commence dans Cursus.
  ctx.db.insert('soldesReprise', { empId: row.id, cpPris: 0, rttPris: 0, recupAcquis: 0, recupPris: 0, arreteLe: ctx.d.ti });
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
  // `confirmerRtt` : confirmation d'un changement de régime qui ferme le compteur de RTT de l'année (garde-fou ci-dessous).
  // `avant` : valeurs d'origine des champs envoyés (modification concurrente, ci-dessous).
  const patch = Object.keys(p).filter(k => k !== 'id' && k !== 'reutiliserMatricule' && k !== 'confirmerRtt' && k !== 'avant') as (keyof ProfilInput)[];
  const refused = patch.filter(k => !fields.includes(k));
  if (refused.length) throw new ActionError(`Champs réservés au service RH : ${refused.join(', ')}`, 403);
  // Modification concurrente : un champ dont la valeur d'origine (celle de l'ouverture du dialogue) n'est plus celle de la
  // fiche a été modifié entre-temps par quelqu'un d'autre ; rien n'est enregistré (412, distinct du 409 du changement
  // d'espace). Sans `avant` (import, ancien écran), aucun contrôle. Seuls les champs envoyés, donc permis au rôle, sont
  // comparés : une valeur d'origine pour un autre champ est refusée, sans quoi le refus ou le succès révélerait une donnée
  // masquée (visite médicale, motif de reprise, matricule de paie pour le manager). Le nom de l'auteur, lu au journal,
  // n'est donné qu'au service RH.
  if (p.avant !== undefined) {
    if (!p.avant || typeof p.avant !== 'object' || Array.isArray(p.avant) || Object.keys(p.avant).some(k => !patch.includes(k as keyof ProfilInput))) {
      throw new ActionError('Valeurs d’origine reçues pour des champs non envoyés : rien n’a été enregistré');
    }
  }
  const conflit = champsEnConflit(p.avant, cur);
  if (conflit.length) throw new ActionError(messageConflit(conflit, isRh(ctx) ? dernierAuteurFiche(ctx, emp.id, conflit) : null), 412);
  if (!isRh(ctx) && patch.includes('jourOff') && cur.temps !== 'partiel') throw new ActionError('Les jours non travaillés ne concernent que le temps partiel');
  const next = { ...cur } as Record<string, unknown>;
  patch.forEach(k => { next[k] = p[k]; });
  // Poste choisi dans la liste, ou intitulé seul (rattaché au poste du même nom, ou libellé précisé du poste actuel).
  // Intitulé renvoyé tel quel (jours non travaillés seuls modifiés) : le poste n'est pas revu. Poste actuel : celui de la
  // fiche, ou celui de même intitulé d'une fiche pas encore rattachée (import).
  if (patch.includes('posteId') || (patch.includes('poste') && key(str(p.poste)) !== key(cur.poste))) {
    if (!patch.includes('posteId')) next.posteId = null;
    rattacherPoste(ctx, next, posteDe(ctx.ds, emp)?.id ?? null, !patch.includes('posteId'));
  }
  const v = check(ctx, next as unknown as ProfilInput, emp.id, !!p.reutiliserMatricule);
  // Une nouvelle visite s'enregistre avec l'avis du médecin du travail (`medical.avis`), qui clôt la demande en cours.
  if (patch.includes('visite') && v.profil.visite !== (emp.visite ?? null)) {
    throw new ActionError('La visite médicale s’enregistre avec l’avis du médecin du travail : bouton « Avis du médecin du travail » de la fiche');
  }
  // La sortie (date et motif) s'enregistre et s'annule par ses actions (`employe.sortie`, `employe.annulerSortie`), qui
  // annulent ce qui était prévu après le départ : la fiche ne change ni le motif, ni la date d'une sortie enregistrée.
  if (v.profil.motifSortie !== (emp.motifSortie ?? null) || (emp.motifSortie && v.profil.fin !== emp.fin)) {
    throw new ActionError('La sortie s’enregistre, se modifie ou s’annule par le bouton « Sortie » de la fiche du collaborateur');
  }
  // Changement d'organisation du temps : date d'effet, et gel de l'ancien régime sur les semaines antérieures
  // pas encore figées, pour que l'historique ne soit pas recalculé avec le nouveau contrat.
  const avant = JSON.stringify(contratFige(emp)), apres = JSON.stringify(contratFige({ ...emp, ...v.profil }));
  const row = toRow(v.profil);
  let figees: string[] = [], soldeRtt: ReturnType<typeof rttPerdus> = null;
  if (avant !== apres && REGIME.some(k => patch.includes(k))) {
    const P = v.profil;
    const regimeTemps = emp.temps !== P.temps || emp.heures !== P.heures || emp.forfaitHeures !== P.forfaitHeures || emp.forfaitJours !== P.forfaitJours;
    // La date d'effet saisie ne vaut que pour un changement d'organisation du temps ; sinon le changement vaut à compter d'aujourd'hui.
    const effet = regimeTemps && isValidDate(p.tempsDepuis) ? p.tempsDepuis : ctx.d.ti;
    if (effet < emp.entree) throw new ActionError('La date d’effet précède la date d’entrée');
    if (effet > ctx.d.ti) throw new ActionError('Date d’effet future : enregistrez le changement le jour de sa prise d’effet');
    if (regimeTemps) row.tempsDepuis = effet;
    else row.tempsDepuis = emp.tempsDepuis;
    // Garde-fou (en attendant l'historique daté des contrats) : RTT de l'année pris ou posés que le nouveau régime n'ouvre
    // plus. Le compteur disparaîtrait sans bruit : le service RH confirme, et le solde affiché avant est gardé au journal.
    soldeRtt = rttPerdus(ctx.d, emp, { ...emp, ...v.profil, tempsDepuis: row.tempsDepuis });
    if (soldeRtt && p.confirmerRtt !== true) {
      throw new ActionError(`Le nouveau régime n’ouvre ni RTT ni jours de repos : le compteur de ${emp.nom} (${soldeRttTexte(soldeRtt)}) ne sera plus suivi dans Cursus. Confirmez le changement : ce solde sera gardé au journal pour la paie`);
    }
    ctx.ds.feuilles.filter(f => f.empId === emp.id && !f.contrat && f.week < effet)
      .forEach(f => ctx.db.update<FeuilleTemps>('feuilles', f.id, { contrat: contratFige(emp) }));
    // Semaines des 8 dernières avant la date d'effet encore sans feuille : feuille brouillon vide figée sur l'ancien
    // régime, sans quoi une feuille créée ensuite pour l'une d'elles prendrait le nouveau (heures supplémentaires faussées).
    figees = semainesAFiger(emp, effet, ctx.ds.feuilles);
    figees.forEach(week => ctx.db.insert<FeuilleTemps>('feuilles', {
      empId: emp.id, week, statut: 'brouillon', comment: null, sage: false, keystone: false, lignes: [], contrat: contratFige(emp),
    }));
  } else row.tempsDepuis = emp.tempsDepuis;
  ctx.db.update('employes', emp.id, row);
  const suite = [
    figees.length ? `${plural(figees.length, 'semaine sans feuille figée', 'semaines sans feuille figées')} sur l’ancien régime` : '',
    soldeRtt ? `solde ${soldeRttTexte(soldeRtt)} gardé au journal pour la paie` : '',
  ].filter(Boolean).map(x => ` · ${x}`).join('');
  return { message: `Fiche de ${v.profil.nom} mise à jour${suite}`, result: soldeRtt ? { soldeRtt } : undefined };
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

/** Suppression d'une équipe vide : administrateur RH. */
const supprimer: ActionHandler = (ctx, p) => {
  requireRhAdmin(ctx);
  const q = getEquipe(ctx, p.nom);
  // Les salariés sortis ne comptent plus parmi les membres (écran Équipes) : ils sont détachés de l'équipe supprimée.
  const membres = ctx.ds.employes.filter(e => e.equipe === q.nom), n = membres.filter(e => !sorti(e, ctx.d.ti)).length;
  if (n) throw new ActionError(`L’équipe compte encore ${n} collaborateur${n > 1 ? 's' : ''} : affectez-les d’abord à une autre équipe`);
  if (ctx.ds.plan.some(l => l.equipe === q.nom)) throw new ActionError('Des actions du plan de formation sont rattachées à cette équipe');
  membres.forEach(e => ctx.db.update('employes', e.id, { equipe: null }));
  ctx.db.sql.prepare('DELETE FROM budgets WHERE equipe = ?').run(q.nom);
  ctx.db.remove('equipes', q.nom);
  return `Équipe ${q.nom} supprimée${membres.length ? ` · ${plural(membres.length, 'salarié sorti détaché', 'salariés sortis détachés')} de l’équipe` : ''}`;
};

/**
 * Affectation d'un collaborateur à une équipe (`equipe` = null : à affecter).
 * RH : toute affectation. Manager : ajouter à une équipe qu'il encadre un salarié « à affecter », c'est-à-dire déjà
 * libéré par son manager d'origine (jamais prendre directement le membre d'une autre équipe : sa mutation passe
 * par le service RH), ou retirer un membre de son équipe (il revient alors au service RH).
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
    // Décision de l'entreprise : le manager n'accueille qu'un salarié « à affecter », libéré par son manager d'origine
    // (ou un membre d'une autre équipe qu'il encadre lui-même).
    if (cible && avant && !mine.includes(avant)) {
      throw new ActionError(`${emp.nom} fait partie de l’équipe ${avant} : seul un salarié « à affecter », libéré par son manager, peut rejoindre votre équipe — sinon, demandez sa mutation au service RH`, 403);
    }
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
