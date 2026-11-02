// Fiches collaborateurs (contrat, statut, temps de travail), équipes et managers.
import { isValidDate } from '../../../shared/dates.ts';
import { fmtIso, key, plural } from '../../../shared/format.ts';
import { rttPerdus, rttPerdusTexte, semainesAFiger, soldeRttTexte, sorti } from '../../../shared/rules/contrats.ts';
import { contratFige } from '../../../shared/rules/temps.ts';
import { matriculesPris } from '../../../shared/rules/matricules.ts';
import { adressesPrises } from '../../../shared/rules/messagerie.ts';
import { posteDe } from '../../../shared/rules/exigences.ts';
import { refusEquipeNuit } from '../../../shared/rules/mineurs.ts';
import { champsEnConflit, champsModifies, LIBELLE_CHAMP_FICHE, messageConflit } from '../../../shared/rules/fiche-concurrente.ts';
import { MANAGER_FIELDS, PROFIL_FIELDS, profilOf, SOI_MEME_FIELDS, validerProfil, type ProfilInput } from '../../../shared/rules/profil.ts';
import type { Employe, Equipe, FeuilleTemps } from '../../../shared/types.ts';
import { elementsRediriges } from '../../../shared/rules/hierarchie.ts';
import { dernierAuteurFiche } from './fiche-auteur.ts';
import { prevenir, redirectionsResultat, refuserCroisee, refuserSonValideur, suiteRedirection } from './hierarchie.ts';
import { carences, carenceTexte } from '../../../shared/rules/cdd.ts';
import { avenantProgramme, renouvellementsDe } from '../../../shared/rules/historique-contrat.ts';
import { amorcer, inscrireLigne, refigerBrouillons } from '../avenants.ts';
import { rattacherPoste } from './referentiels.ts';
import { renommerDerogation, retirerDerogation } from './repos-dominical.ts';
// lot 11 — organigramme
import { rattacherEquipeNeuve } from '../demarrage.ts';
import { recalerRattachements } from '../rattachements.ts';
// lot 12 — C6 (badgeage virtuel)
import { modeAFiger } from '../pointages.ts';
import {
  ActionError, estSoiMeme, getEmp, isManagerOf, isRh, isRhAdmin, refuserSoiMeme, requireRh, requireRhAdmin, REVIENT_RH, str, type ActionHandler, type Ctx,
} from './context.ts';

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
    naissance: { enregistree: !!emp?.naissanceLe },
    // Salarié mineur : pas d'équipe de nuit ou en continu (shared/rules/mineurs.ts).
    mineurs: { equipes: ctx.ds.referentiels.equipes, today: ctx.d.ti },
    // CDD : renouvellements de l'historique, fin enregistrée (une fin repoussée sans renouvellement est signalée).
    cdd: { renouvellements: empId ? renouvellementsDe(ctx.ds, empId).length : 0, finEnregistree: emp && !emp.motifSortie ? emp.fin : null, reglages: ctx.ds.settings },
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

/** Auteur d'une ligne de l'historique des contrats : la personne connectée et sa fiche. */
const auteur = (ctx: Ctx) => ({ nom: ctx.user.nom, empId: ctx.user.salarieId ?? ctx.user.empId ?? null });

const creer: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const input = {} as Record<string, unknown>;
  PROFIL_FIELDS.forEach(k => { input[k] = p[k] ?? null; });
  await rattacherPoste(ctx, input);
  const v = check(ctx, input as unknown as ProfilInput, undefined, !!p.reutiliserMatricule);
  // CDD : le terme initial est la fin saisie, tant qu'aucun renouvellement ne l'a repoussée.
  const P = v.profil;
  if (P.typeContrat === 'cdd' && !P.cddFinInitiale && P.fin && !P.motifSortie) P.cddFinInitiale = P.fin;
  const row = await ctx.db.insert<Employe>('employes', toRow(P));
  // Compteurs repris à zéro, datés de la création : la fiche commence dans Cursus.
  await ctx.db.insert('soldesReprise', { empId: row.id, cpPris: 0, rttPris: 0, recupAcquis: 0, recupPris: 0, arreteLe: ctx.d.ti });
  // Historique des contrats (t074) : embauche à l'entrée, avec le terme prévu d'un contrat à durée déterminée.
  await inscrireLigne(ctx.db, {
    empId: row.id, effet: P.entree, nature: 'embauche', regime: contratFige(row), jusquau: P.typeContrat !== 'cdi' && !P.motifSortie ? P.fin : null,
    fin: P.motifSortie ? P.fin : null,
  }, auteur(ctx), ctx.d.ti);
  // Délai de carence (art. L1244-3) : contrat antérieur sur le même poste ou du même titulaire (avertissement seul).
  // lot 11 — organigramme : site et unité de rattachement tirés de l'équipe (server/src/rattachements.ts).
  await recalerRattachements(ctx.db);
  const carence = carences(ctx.ds.employes, { ...P, id: row.id, posteId: row.posteId ?? null }).map(c => ` · ${carenceTexte(c).replace(/\.$/, '')}`).join('');
  return { message: `Fiche créée — ${P.nom}${P.equipe ? ' · équipe ' + P.equipe : ' · à affecter'}${carence}`, result: { id: row.id } };
};

/** RH : toute la fiche. Manager : poste et jours non travaillés (temps partiel) des membres de son équipe. */
const modifier: ActionHandler = async (ctx, p) => {
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
  // Sa propre fiche (lot 8, chantier C) : l'adresse e-mail et les jours non travaillés seulement ; heures, temps, contrat,
  // matricule de paie, période d'essai, équipe… sont modifiés par un autre membre du service RH. Seuls les champs dont la
  // valeur change sont refusés : le dialogue envoie les champs liés ensemble (GROUPES_FICHE : les jours non travaillés
  // partent avec l'organisation du temps et ses paramètres, renvoyés inchangés).
  const reserves = estSoiMeme(ctx, emp.id) ? champsModifies(cur, p, patch.filter(k => !SOI_MEME_FIELDS.includes(k))) : [];
  if (reserves.length) refuserSoiMeme(ctx, emp, `Vous ne pouvez pas modifier sur votre propre fiche : ${reserves.map(k => LIBELLE_CHAMP_FICHE[k]).join(', ')} (seuls l’adresse e-mail et les jours non travaillés le sont)`, REVIENT_RH);
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
  if (conflit.length) throw new ActionError(messageConflit(conflit, isRh(ctx) ? await dernierAuteurFiche(ctx, emp.id, conflit) : null), 412);
  if (!isRh(ctx) && patch.includes('jourOff') && cur.temps !== 'partiel') throw new ActionError('Les jours non travaillés ne concernent que le temps partiel');
  const next = { ...cur } as Record<string, unknown>;
  patch.forEach(k => { next[k] = p[k]; });
  // Poste choisi dans la liste, ou intitulé seul (rattaché au poste du même nom, ou libellé précisé du poste actuel).
  // Intitulé renvoyé tel quel (jours non travaillés seuls modifiés) : le poste n'est pas revu. Poste actuel : celui de la
  // fiche, ou celui de même intitulé d'une fiche pas encore rattachée (import).
  if (patch.includes('posteId') || (patch.includes('poste') && key(str(p.poste)) !== key(cur.poste))) {
    if (!patch.includes('posteId')) next.posteId = null;
    await rattacherPoste(ctx, next, posteDe(ctx.ds, emp)?.id ?? null, !patch.includes('posteId'));
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
  // pas encore figées, pour que l'historique ne soit pas recalculé avec le nouveau contrat. Historique des contrats
  // (t074) : le changement y est inscrit (avenant) ; à une date future, il est programmé et appliqué à la fiche ce jour-là
  // (server/src/avenants.ts), la fiche gardant d'ici là son organisation du temps.
  const avant = JSON.stringify(contratFige(emp)), apres = JSON.stringify(contratFige({ ...emp, ...v.profil }));
  const row = toRow(v.profil);
  let figees: string[] = [], soldeRtt: ReturnType<typeof rttPerdus> = null, avenant: { id: number; effet: string } | null = null;
  if (avant !== apres && REGIME.some(k => patch.includes(k))) {
    const P = v.profil;
    const regimeTemps = emp.temps !== P.temps || emp.heures !== P.heures || emp.forfaitHeures !== P.forfaitHeures || emp.forfaitJours !== P.forfaitJours;
    // La date d'effet saisie ne vaut que pour un changement d'organisation du temps ; sinon le changement vaut à compter d'aujourd'hui.
    const effet = regimeTemps && isValidDate(p.tempsDepuis) ? p.tempsDepuis : ctx.d.ti;
    if (effet < emp.entree) throw new ActionError('La date d’effet précède la date d’entrée');
    const programme = avenantProgramme(ctx.ds, emp.id);
    if (programme) throw new ActionError(`Un avenant est déjà programmé au ${fmtIso(programme.effet)} : annulez-le d’abord (fiche du collaborateur, « Historique du contrat ») avant un autre changement de régime`);
    const futur = effet > ctx.d.ti;
    if (futur && (emp.statut !== P.statut || emp.typeContrat !== P.typeContrat)) {
      throw new ActionError('Un avenant à date future ne porte que sur l’organisation du temps : enregistrez séparément, le jour même, le changement de statut ou de nature du contrat');
    }
    if (futur && emp.fin && effet > emp.fin) throw new ActionError(`Date d’effet postérieure à la fin du contrat (${fmtIso(emp.fin)})`);
    // RTT de l'année pris ou posés que le nouveau régime ne couvre plus, même au prorata des mois passés sous l'ancien
    // (aucun droit, solde négatif, RTT posés après la date d'effet) : le service RH confirme, et le solde affiché avant est
    // gardé au journal avec le nouveau droit.
    soldeRtt = rttPerdus(ctx.d, emp, { ...emp, ...v.profil, tempsDepuis: regimeTemps ? effet : emp.tempsDepuis }, effet);
    if (soldeRtt && p.confirmerRtt !== true) {
      throw new ActionError(`${rttPerdusTexte(soldeRtt, emp.nom)}. Confirmez le changement : ce solde sera gardé au journal pour la paie`);
    }
    await amorcer(ctx.db, emp.id, ctx.d.ti);
    const ligne = await inscrireLigne(ctx.db, { empId: emp.id, effet, nature: 'avenant', regime: contratFige({ ...emp, ...v.profil }), applique: !futur }, auteur(ctx), ctx.d.ti);
    if (futur) {
      // Avenant programmé : la fiche garde son organisation du temps jusqu'à la date d'effet.
      Object.assign(row, { temps: emp.temps, heures: emp.heures, forfaitHeures: emp.forfaitHeures, forfaitJours: emp.forfaitJours, jourOff: emp.jourOff ?? [], tempsDepuis: emp.tempsDepuis });
      avenant = { id: ligne.id, effet };
    } else {
      if (regimeTemps) row.tempsDepuis = effet;
      else row.tempsDepuis = emp.tempsDepuis;
      for (const f of ctx.ds.feuilles.filter(f => f.empId === emp.id && !f.contrat && f.week < effet)) await ctx.db.update<FeuilleTemps>('feuilles', f.id, { contrat: contratFige(emp) });
      // Semaines des 8 dernières avant la date d'effet encore sans feuille : feuille brouillon vide figée sur l'ancien
      // régime (garde-fou conservé avec l'historique, qui fige aussi une feuille créée plus tard pour une semaine plus ancienne).
      figees = semainesAFiger(emp, effet, ctx.ds.feuilles);
      for (const week of figees) await ctx.db.insert<FeuilleTemps>('feuilles', {
        empId: emp.id, week, statut: 'brouillon', comment: null, sage: false, keystone: false, lignes: [], contrat: contratFige(emp),
        // lot 12 — C6 (badgeage virtuel) : mode de la population badgée cette semaine-là, figé comme à la saisie.
        ...modeAFiger(ctx.ds, emp, week),
      });
    }
  } else row.tempsDepuis = emp.tempsDepuis;
  // Changement d'équipe : mêmes contrôles de hiérarchie que l'affectation (t136).
  if ((v.profil.equipe ?? null) !== (emp.equipe ?? null)) {
    refuserCroisee(ctx, { employes: ctx.ds.employes.map(e => (e.id === emp.id ? { ...e, equipe: v.profil.equipe ?? null } : e)) });
  }
  await ctx.db.update('employes', emp.id, row);
  // Date d'entrée corrigée : l'embauche de l'historique la suit.
  if (patch.includes('entree') && v.profil.entree !== emp.entree) {
    await ctx.db.run(`UPDATE contrats_historique SET effet = ? WHERE emp_id = ? AND nature = 'embauche' AND effet = ?`, [v.profil.entree, emp.id, emp.entree]);
  }
  // Brouillons refigés sur le régime de leur semaine (changement daté, avenant programmé).
  if (avant !== apres) await refigerBrouillons(ctx.db, emp.id);
  // lot 11 — organigramme : site et unité de rattachement suivent un changement d'équipe (server/src/rattachements.ts).
  if ((v.profil.equipe ?? null) !== (emp.equipe ?? null)) await recalerRattachements(ctx.db);
  const suite = [
    avenant ? `avenant programmé au ${fmtIso(avenant.effet)} (${ctx.d.contratOf({ ...emp, ...v.profil }).label}), appliqué à la fiche à cette date` : '',
    figees.length ? `${plural(figees.length, 'semaine sans feuille figée', 'semaines sans feuille figées')} sur l’ancien régime` : '',
    soldeRtt ? `solde ${soldeRttTexte(soldeRtt)} gardé au journal pour la paie` : '',
    ...v.warnings.filter(w => w.startsWith('Fin du CDD repoussée')).map(w => w.replace(/\.$/, '')),
  ].filter(Boolean).map(x => ` · ${x}`).join('');
  return { message: `Fiche de ${v.profil.nom} mise à jour${suite}`, result: soldeRtt || avenant ? { ...(soldeRtt ? { soldeRtt } : {}), ...(avenant ? { avenant } : {}) } : undefined };
};

const creerEquipe: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const nom = str(p.nom);
  if (!nom) throw new ActionError('Nom d’équipe requis');
  if (ctx.ds.referentiels.equipes.some(q => key(q.nom) === key(nom))) throw new ActionError('Une équipe porte déjà ce nom');
  const managerId = p.managerId ? checkManager(ctx, p.managerId).id : null;
  const ordre = Math.max(-1, ...ctx.ds.referentiels.equipes.map(q => q.ordre)) + 1;
  await ctx.db.insert('equipes', { nom, managerId, ordre });
  // lot 11 — organigramme : équipe racine rattachée à l'entité unique (amorcée au besoin), sans changer de valideur.
  const entite = await rattacherEquipeNeuve(ctx.db, nom);
  return `Équipe ${nom} créée${managerId ? ' — manager : ' + ctx.d.personName(managerId) : ''}${entite ? ` · relève de ${entite.nom}` : ''}`;
};

const renommer: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const q = getEquipe(ctx, p.nom);
  const nouveau = str(p.nouveau);
  if (!nouveau) throw new ActionError('Nouveau nom requis');
  if (nouveau === q.nom) return null;
  if (ctx.ds.referentiels.equipes.some(x => x.nom !== q.nom && key(x.nom) === key(nouveau))) throw new ActionError('Une équipe porte déjà ce nom');
  // Équipes rattachées (`parente`, t136) : elles suivent le nouveau nom.
  for (const [table, col] of [['equipes', 'nom'], ['equipes', 'parente'], ['employes', 'equipe'], ['budgets', 'equipe'], ['plan_actions', 'equipe']]) {
    await ctx.db.run(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`, [nouveau, q.nom]);
  }
  await renommerDerogation(ctx.db, q.nom, nouveau);
  return `Équipe ${q.nom} renommée en ${nouveau}`;
};

const designer: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const q = getEquipe(ctx, p.nom);
  const m = p.managerId ? checkManager(ctx, p.managerId) : null;
  // Hiérarchie (t136) : le manager d'une équipe parente valide aussi les managers des équipes rattachées. Pas de
  // validation croisée nouvelle ; leurs éléments en attente sont redirigés, comme à l'enregistrement d'une équipe
  // parente (actions/hierarchie.ts). Ceux des membres de l'équipe passent au nouveau manager, comme auparavant.
  const equipes = ctx.ds.referentiels.equipes;
  const apres: Equipe[] = equipes.map(x => (x.nom === q.nom ? { ...x, managerId: m?.id ?? null } : x));
  // Sa propre équipe, ou une équipe dont elle relève : le membre du service RH ne choisit pas son valideur (lot 8, chantier C).
  refuserSonValideur(ctx, apres);
  refuserCroisee(ctx, { equipes: apres });
  const elements = elementsRediriges(ctx.ds, equipes, apres).filter(x => ctx.d.emp(x.empId)?.equipe !== q.nom);
  await ctx.db.update('equipes', q.nom, { managerId: m?.id ?? null });
  const message = m ? `${m.nom} devient manager de l’équipe ${q.nom}` : `L’équipe ${q.nom} n’a plus de manager — validations assurées par le service RH`;
  if (!elements.length) return message;
  await prevenir(ctx, q.nom, m ? `${m.nom} devient manager de l’équipe ${q.nom}, dont relèvent les managers des équipes rattachées` : `L’équipe ${q.nom} n’a plus de manager`, elements);
  return { message: message + suiteRedirection(ctx, elements), result: { redirections: redirectionsResultat(elements) } };
};

/** Suppression d'une équipe vide : administrateur RH. */
const supprimer: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const q = getEquipe(ctx, p.nom);
  // Les salariés sortis ne comptent plus parmi les membres (écran Équipes) : ils sont détachés de l'équipe supprimée.
  const membres = ctx.ds.employes.filter(e => e.equipe === q.nom), n = membres.filter(e => !sorti(e, ctx.d.ti)).length;
  if (n) throw new ActionError(`L’équipe compte encore ${n} collaborateur${n > 1 ? 's' : ''} : affectez-les d’abord à une autre équipe`);
  if (ctx.ds.plan.some(l => l.equipe === q.nom)) throw new ActionError('Des actions du plan de formation sont rattachées à cette équipe');
  // Hiérarchie (t136) : les équipes rattachées changeraient de valideur sans que personne le décide.
  const filles = ctx.ds.referentiels.equipes.filter(x => x.parente === q.nom).map(x => x.nom);
  if (filles.length) throw new ActionError(`${plural(filles.length, 'Une équipe est rattachée', 'Des équipes sont rattachées')} à ${q.nom} (${filles.join(', ')}) : changez d’abord leur équipe parente`);
  for (const e of membres) await ctx.db.update('employes', e.id, { equipe: null });
  await ctx.db.run('DELETE FROM budgets WHERE equipe = ?', [q.nom]);
  await ctx.db.remove('equipes', q.nom);
  await retirerDerogation(ctx.db, q.nom);
  // lot 11 — organigramme : salariés sortis détachés, sans site ni unité (server/src/rattachements.ts).
  if (membres.length) await recalerRattachements(ctx.db);
  return `Équipe ${q.nom} supprimée${membres.length ? ` · ${plural(membres.length, 'salarié sorti détaché', 'salariés sortis détachés')} de l’équipe` : ''}`;
};

/**
 * Affectation d'un collaborateur à une équipe (`equipe` = null : à affecter).
 * RH : toute affectation. Manager : ajouter à une équipe qu'il encadre un salarié « à affecter », c'est-à-dire déjà
 * libéré par son manager d'origine (jamais prendre directement le membre d'une autre équipe : sa mutation passe
 * par le service RH), ou retirer un membre de son équipe (il revient alors au service RH).
 */
const affecter: ActionHandler = async (ctx, p) => {
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
  // Membre du service RH : sa propre équipe désigne qui valide ses feuilles et ses congés (lot 8, chantier C).
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas modifier votre propre affectation', REVIENT_RH);
  // Salarié de moins de 18 ans : jamais dans une équipe de nuit ou en continu (art. L3163-2), quel que soit l'auteur.
  const nuit = refusEquipeNuit(emp, ctx.ds.referentiels.equipes.find(q => q.nom === cible), ctx.d.ti);
  if (nuit) throw new ActionError(nuit);
  // Hiérarchie (t136) : pas de validation croisée nouvelle (un manager rangé dans l'équipe de son N-1).
  refuserCroisee(ctx, { employes: ctx.ds.employes.map(e => (e.id === emp.id ? { ...e, equipe: cible } : e)) });
  await ctx.db.update('employes', emp.id, { equipe: cible });
  // lot 11 — organigramme : site et unité de rattachement tirés de la nouvelle équipe (server/src/rattachements.ts).
  await recalerRattachements(ctx.db);
  if (!cible) return `${emp.nom} retiré de l’équipe ${avant} — à affecter par le service RH`;
  return `${emp.nom} rejoint l’équipe ${cible}${avant ? ` (auparavant ${avant})` : ''}`;
};

export const equipesActions = {
  'employe.creer': creer,
  'employe.modifier': modifier,
  'equipe.creer': creerEquipe,
  'equipe.renommer': renommer,
  'equipe.manager': designer,
  'equipe.supprimer': supprimer,
  'equipe.affecter': affecter,
} satisfies Record<string, ActionHandler>;
