// Historique des contrats côté serveur (t074) : lignes écrites par la fiche (embauche, avenant), par le renouvellement
// d'un CDD (server/src/actions/avenants.ts) et par la sortie ; brouillons des feuilles de temps refigés sur le régime de
// leur semaine ; avenants programmés à une date future appliqués à la fiche ce jour-là, au démarrage puis toutes les
// heures (server/src/index.ts). Règles : shared/rules/historique-contrat.ts.
import { fmtIso, plural } from '../../shared/format.ts';
import { memeRegime, regimeAu, regimeFiche } from '../../shared/rules/historique-contrat.ts';
import type { ContratFige, ContratHistorique, Employe, FeuilleTemps, ISODate, NatureLigneContrat } from '../../shared/types.ts';
import { journaliser } from './comptes.ts';
import type { Db } from './db.ts';
import { log } from './logs.ts';
import { historiqueDepuisFiches } from './migrations/lot6-contrats.ts';

/** Auteur d'une ligne : nom de la personne connectée et sa fiche (null : compte sans fiche, ou Cursus). */
export interface Auteur { nom: string | null; empId: number | null }

/** Lignes d'un salarié, telles qu'en base (annulées comprises). */
export const lignesDe = async (db: Db, empId: number) => await db.where<ContratHistorique>('contratsHistorique', 'empId', empId);

/**
 * Première écriture dans l'historique d'une fiche qui n'en a pas (créée avant lui, importée) : il est d'abord amorcé
 * comme le fait la migration (server/src/migrations/lot6-contrats.ts), pour que l'avenant suive l'état d'avant.
 */
export async function amorcer(db: Db, empId: number, le: ISODate) {
  if (!(await lignesDe(db, empId)).length) await historiqueDepuisFiches(db, le, empId);
}

/** Nouvelle ligne de l'historique (embauche, avenant, renouvellement). */
export async function inscrireLigne(db: Db, l: {
  empId: number; effet: ISODate; nature: NatureLigneContrat; regime: ContratFige | null; jusquau?: ISODate | null; signeLe?: ISODate | null;
  reference?: string | null; applique?: boolean; fin?: ISODate | null;
}, auteur: Auteur, le: ISODate): Promise<ContratHistorique> {
  return await db.insert<ContratHistorique>('contratsHistorique', {
    jusquau: null, signeLe: null, reference: null, fin: null, ...l, applique: l.applique ?? true, annuleLe: null, le, par: auteur.nom, parId: auteur.empId,
  });
}

/**
 * Brouillons des feuilles de temps d'un salarié refigés sur le régime de leur semaine d'après l'historique à jour : figés
 * sur ce régime s'il diffère de la fiche (semaine antérieure à un changement, postérieure à un avenant programmé), sinon
 * sans régime (ils suivent la fiche). Une semaine de régime inconnu garde ce qu'elle a. Les feuilles soumises, renvoyées
 * ou validées gardent le régime figé à leur soumission.
 */
export async function refigerBrouillons(db: Db, empId: number): Promise<number> {
  const e = await db.get<Employe>('employes', empId);
  if (!e) return 0;
  const vue = { contratsHistorique: await lignesDe(db, empId) }, fiche = regimeFiche(e);
  let n = 0;
  for (const f of await db.where<FeuilleTemps>('feuilles', 'empId', empId)) {
    if (f.statut !== 'brouillon') continue;
    const r = regimeAu(vue, e, f.week);
    if (!r) continue;
    const contrat = memeRegime(r, fiche) ? null : r;
    if (!memeRegime(contrat, f.contrat ?? null)) { await db.update<FeuilleTemps>('feuilles', f.id, { contrat }); n++; }
  }
  return n;
}

/** Champs de la fiche écrits par un avenant (organisation du temps ; statut et nature du contrat changent le jour même). */
export const champsAvenant = (r: ContratFige) => ({ temps: r.temps, heures: r.heures, forfaitHeures: r.forfaitHeures, forfaitJours: r.forfaitJours, jourOff: r.jourOff });

/**
 * Sortie enregistrée (`employe.sortie`) : sa date clôt la dernière ligne qui a pris effet, les avenants programmés après
 * elle sont annulés (sans objet), comme les renouvellements d'un CDD qui devaient commencer après elle (sortie anticipée :
 * ils ne sont plus comptés). Renvoie le nombre d'avenants et de renouvellements annulés.
 */
export async function cloreHistorique(db: Db, empId: number, date: ISODate, le: ISODate): Promise<{ avenants: number; renouvellements: number }> {
  // Un renouvellement n'est annulé que par une sortie : à la modification d'une sortie, ceux d'avant la nouvelle date
  // reprennent effet.
  const lignes = (await lignesDe(db, empId)).filter(l => !l.annuleLe || l.nature === 'renouvellement');
  const apres = lignes.filter(l => l.effet > date && !l.annuleLe);
  const programmes = apres.filter(l => !l.applique), renouvellements = apres.filter(l => l.nature === 'renouvellement');
  for (const l of [...programmes, ...renouvellements]) await db.update('contratsHistorique', l.id, { annuleLe: le });
  for (const l of lignes.filter(l => l.annuleLe && l.effet <= date)) await db.update('contratsHistorique', l.id, { annuleLe: null });
  const derniere = lignes.filter(l => l.effet <= date).sort((a, b) => a.effet.localeCompare(b.effet) || a.id - b.id).at(-1);
  for (const l of lignes.filter(l => l.fin && l.id !== derniere?.id)) await db.update('contratsHistorique', l.id, { fin: null });
  if (derniere) await db.update('contratsHistorique', derniere.id, { fin: date });
  return { avenants: programmes.length, renouvellements: renouvellements.length };
}

/**
 * Sortie annulée : plus aucune ligne close ; les renouvellements annulés par la sortie (seule à en annuler) reprennent
 * effet avec la fin prévue rétablie. Les avenants annulés par la sortie le restent.
 */
export async function rouvrirHistorique(db: Db, empId: number) {
  for (const l of (await lignesDe(db, empId)).filter(l => l.fin || (l.nature === 'renouvellement' && l.annuleLe))) await db.update('contratsHistorique', l.id, { fin: null, ...(l.nature === 'renouvellement' ? { annuleLe: null } : {}) });
}

/**
 * Avenants programmés dont la date d'effet est arrivée : organisation du temps et date d'effet écrites sur la fiche,
 * feuilles antérieures encore sans régime figées sur l'ancien (comme un changement saisi le jour même), brouillons refigés,
 * ligne marquée appliquée, et trace au journal (`employe.avenantApplique`). Un avenant d'un salarié sorti avant sa date est
 * annulé. Chaque avenant dans sa transaction. Renvoie le nombre d'avenants appliqués.
 */
export async function appliquerAvenants(db: Db, today: ISODate): Promise<number> {
  const dus = (await db.query(`SELECT id FROM contrats_historique WHERE applique = FALSE AND annule_le IS NULL AND nature = 'avenant' AND effet <= ? ORDER BY effet, id`, [today])) as { id: number }[];
  let n = 0;
  for (const { id } of dus) {
    await db.tx(async () => {
      const l = await db.get<ContratHistorique>('contratsHistorique', id);
      const e = l && (await db.get<Employe>('employes', l.empId));
      if (!l || !e || !l.regime) return;
      if (e.fin && e.fin < l.effet) { await db.update('contratsHistorique', l.id, { annuleLe: today }); return; }
      const ancien = regimeFiche(e);
      for (const f of (await db.where<FeuilleTemps>('feuilles', 'empId', e.id)).filter(f => !f.contrat && f.week < l.effet)) await db.update<FeuilleTemps>('feuilles', f.id, { contrat: ancien });
      await db.update('employes', e.id, { ...champsAvenant(l.regime), tempsDepuis: l.effet });
      await db.update('contratsHistorique', l.id, { applique: true });
      await refigerBrouillons(db, e.id);
      await journaliser(db, {
        actor: 'Cursus', role: null, action: 'employe.avenantApplique', salaries: [e.id],
        message: `Avenant du ${fmtIso(l.effet)} appliqué à la fiche de ${e.nom} (organisation du temps)`, payload: { ligne: l.id, effet: l.effet },
      });
      n++;
    });
  }
  if (n) log.info(`Historique des contrats : ${plural(n, 'avenant appliqué', 'avenants appliqués')} à sa date d’effet.`);
  return n;
}
