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
export const lignesDe = (db: Db, empId: number) => db.where<ContratHistorique>('contratsHistorique', 'empId', empId);

/**
 * Première écriture dans l'historique d'une fiche qui n'en a pas (créée avant lui, importée) : il est d'abord amorcé
 * comme le fait la migration (server/src/migrations/lot6-contrats.ts), pour que l'avenant suive l'état d'avant.
 */
export function amorcer(db: Db, empId: number, le: ISODate) {
  if (!lignesDe(db, empId).length) historiqueDepuisFiches(db, le, empId);
}

/** Nouvelle ligne de l'historique (embauche, avenant, renouvellement). */
export function inscrireLigne(db: Db, l: {
  empId: number; effet: ISODate; nature: NatureLigneContrat; regime: ContratFige | null; jusquau?: ISODate | null; signeLe?: ISODate | null;
  reference?: string | null; applique?: boolean; fin?: ISODate | null;
}, auteur: Auteur, le: ISODate): ContratHistorique {
  return db.insert<ContratHistorique>('contratsHistorique', {
    jusquau: null, signeLe: null, reference: null, fin: null, ...l, applique: l.applique ?? true, annuleLe: null, le, par: auteur.nom, parId: auteur.empId,
  });
}

/**
 * Brouillons des feuilles de temps d'un salarié refigés sur le régime de leur semaine d'après l'historique à jour : figés
 * sur ce régime s'il diffère de la fiche (semaine antérieure à un changement, postérieure à un avenant programmé), sinon
 * sans régime (ils suivent la fiche). Une semaine de régime inconnu garde ce qu'elle a. Les feuilles soumises, renvoyées
 * ou validées gardent le régime figé à leur soumission.
 */
export function refigerBrouillons(db: Db, empId: number): number {
  const e = db.get<Employe>('employes', empId);
  if (!e) return 0;
  const vue = { contratsHistorique: lignesDe(db, empId) }, fiche = regimeFiche(e);
  let n = 0;
  for (const f of db.where<FeuilleTemps>('feuilles', 'empId', empId)) {
    if (f.statut !== 'brouillon') continue;
    const r = regimeAu(vue, e, f.week);
    if (!r) continue;
    const contrat = memeRegime(r, fiche) ? null : r;
    if (!memeRegime(contrat, f.contrat ?? null)) { db.update<FeuilleTemps>('feuilles', f.id, { contrat }); n++; }
  }
  return n;
}

/** Champs de la fiche écrits par un avenant (organisation du temps ; statut et nature du contrat changent le jour même). */
export const champsAvenant = (r: ContratFige) => ({ temps: r.temps, heures: r.heures, forfaitHeures: r.forfaitHeures, forfaitJours: r.forfaitJours, jourOff: r.jourOff });

/**
 * Sortie enregistrée (`employe.sortie`) : sa date clôt la dernière ligne en vigueur, et les avenants programmés après elle
 * sont annulés (sans objet). Renvoie le nombre d'avenants annulés.
 */
export function cloreHistorique(db: Db, empId: number, date: ISODate, le: ISODate): number {
  const lignes = lignesDe(db, empId).filter(l => !l.annuleLe);
  const programmes = lignes.filter(l => !l.applique && l.effet > date);
  programmes.forEach(l => db.update('contratsHistorique', l.id, { annuleLe: le }));
  const derniere = lignes.filter(l => l.applique || l.effet <= date).sort((a, b) => a.effet.localeCompare(b.effet) || a.id - b.id).at(-1);
  lignes.filter(l => l.fin && l.id !== derniere?.id).forEach(l => db.update('contratsHistorique', l.id, { fin: null }));
  if (derniere) db.update('contratsHistorique', derniere.id, { fin: date });
  return programmes.length;
}

/** Sortie annulée : plus aucune ligne close (les avenants annulés par la sortie le restent). */
export function rouvrirHistorique(db: Db, empId: number) {
  lignesDe(db, empId).filter(l => l.fin).forEach(l => db.update('contratsHistorique', l.id, { fin: null }));
}

/**
 * Avenants programmés dont la date d'effet est arrivée : organisation du temps et date d'effet écrites sur la fiche,
 * feuilles antérieures encore sans régime figées sur l'ancien (comme un changement saisi le jour même), brouillons refigés,
 * ligne marquée appliquée, et trace au journal (`employe.avenantApplique`). Un avenant d'un salarié sorti avant sa date est
 * annulé. Chaque avenant dans sa transaction. Renvoie le nombre d'avenants appliqués.
 */
export function appliquerAvenants(db: Db, today: ISODate): number {
  const dus = db.sql.prepare(`SELECT id FROM contrats_historique WHERE applique = 0 AND annule_le IS NULL AND nature = 'avenant' AND effet <= ? ORDER BY effet, id`)
    .all(today) as { id: number }[];
  let n = 0;
  for (const { id } of dus) {
    db.tx(() => {
      const l = db.get<ContratHistorique>('contratsHistorique', id);
      const e = l && db.get<Employe>('employes', l.empId);
      if (!l || !e || !l.regime) return;
      if (e.fin && e.fin < l.effet) { db.update('contratsHistorique', l.id, { annuleLe: today }); return; }
      const ancien = regimeFiche(e);
      db.where<FeuilleTemps>('feuilles', 'empId', e.id).filter(f => !f.contrat && f.week < l.effet)
        .forEach(f => db.update<FeuilleTemps>('feuilles', f.id, { contrat: ancien }));
      db.update('employes', e.id, { ...champsAvenant(l.regime), tempsDepuis: l.effet });
      db.update('contratsHistorique', l.id, { applique: true });
      refigerBrouillons(db, e.id);
      journaliser(db, {
        actor: 'Cursus', role: null, action: 'employe.avenantApplique', salaries: [e.id],
        message: `Avenant du ${fmtIso(l.effet)} appliqué à la fiche de ${e.nom} (organisation du temps)`, payload: { ligne: l.id, effet: l.effet },
      });
      n++;
    });
  }
  if (n) log.info(`Historique des contrats : ${plural(n, 'avenant appliqué', 'avenants appliqués')} à sa date d’effet.`);
  return n;
}
