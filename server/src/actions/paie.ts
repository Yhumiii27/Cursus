// Paie : correspondance des rubriques internes avec le plan de paie Sage (écran Temps, « Rubriques de paie »), saisie et
// confirmée par l'administrateur RH ou le gestionnaire de paie, qui n'a pas accès aux Paramètres. Chaque modification
// est tracée (action liée à la paie, archivée 3 ans) ; un code non confirmé bloque toute transmission réelle.
// Lots de paie (t029, mode fichier de t019) : la paie génère le lot d'une période (feuilles validées réservées, contenu
// figé, clé d'idempotence), télécharge son fichier d'import (server/src/fichier-paie.ts), l'importe dans Sage puis
// confirme l'import — confirmation datée et signée qui seule marque les feuilles transmises — ou annule le lot avant
// cette confirmation, ce qui libère ses feuilles. Après elle, une correction passera par un lot correctif (t131).
import { randomUUID } from 'node:crypto';
import { RUBRIQUES_PAIE } from '../../../shared/constants.ts';
import { plural } from '../../../shared/format.ts';
import { sansMatriculePaie } from '../../../shared/rules/matricules.ts';
import { controlerFormat, erreurReference, feuillesDuLot, libellesSage, periodeDeLaFeuille, resumeContenu } from '../../../shared/rules/lots-paie.ts';
import { erreurCodeSage, periodeLabel, rubriquesAConfirmer, rubriquesPaie, rubriquesTexte } from '../../../shared/rules/paie.ts';
import { buildSagePayload, rubriquesEmises, sagePending } from '../../../shared/rules/temps.ts';
import type { FeuilleTemps, LotPaie, RubriquePaie, SageMode } from '../../../shared/types.ts';
import { pushToSage, SAGE_DOSSIER, SageIndisponible, sageMode } from '../integrations/sage.ts';
import { lireFormatFichier, type LotEnregistre } from '../lots-paie.ts';
import { ActionError, type ActionHandler, type Ctx, requirePaie, str } from './context.ts';

/**
 * `code` : rubrique interne ; `codeSage` : code du plan de paie (inchangé s'il est absent) ; `active` : exportée ou non ;
 * `confirmer` : code vérifié dans le plan de paie Sage (date et auteur), `false` pour retirer la confirmation. Un code
 * changé sans `confirmer` repasse « à confirmer ». Deux rubriques d'unités différentes (heures, jours) ne partagent
 * jamais un code Sage.
 */
const rubrique: ActionHandler = (ctx, p) => {
  requirePaie(ctx);
  const code = str(p.code);
  if (!Object.hasOwn(RUBRIQUES_PAIE, code)) throw new ActionError('Rubrique de paie inconnue', 404);
  const table = rubriquesPaie(ctx.ds.rubriquesPaie), r = table.find(x => x.code === code)!;
  const codeSage = p.codeSage === undefined ? r.codeSage : str(p.codeSage);
  const erreur = erreurCodeSage(codeSage);
  if (erreur) throw new ActionError(erreur);
  const autre = table.find(x => x.code !== code && x.codeSage === codeSage && x.unite !== r.unite);
  if (autre) throw new ActionError(`Code Sage ${codeSage} déjà porté par ${autre.code} (${autre.unite === 'j' ? 'jours' : 'heures'}) : une rubrique ne mélange pas les unités`);
  const active = p.active === undefined ? r.active : !!p.active;
  // `confirmer` : true confirme (date du jour, auteur) ; false retire la confirmation ; absent : gardée si le code ne change pas.
  const confirmer = p.confirmer === true, retirer = p.confirmer === false || codeSage !== r.codeSage;
  const ligne: RubriquePaie & { modifieLe: string; modifiePar: string } = {
    code, codeSage, active,
    confirmeLe: confirmer ? ctx.d.ti : retirer ? null : r.confirmeLe,
    confirmePar: confirmer ? ctx.user.nom : retirer ? null : r.confirmePar,
    modifieLe: new Date().toISOString(), modifiePar: ctx.user.nom,
  };
  if (codeSage === r.codeSage && active === r.active && ligne.confirmeLe === r.confirmeLe && ligne.confirmePar === r.confirmePar) return `Rubrique ${code} inchangée`;
  if (ctx.db.get('rubriquesPaie', code)) ctx.db.update('rubriquesPaie', code, ligne);
  else ctx.db.insert('rubriquesPaie', ligne);
  const etat = !active ? 'désactivée, non exportée' : ligne.confirmeLe ? 'confirmé' : 'à confirmer';
  return `Rubrique ${code} : code Sage ${codeSage} (${etat})`;
};

// — Lots de paie —

const nomsSans = (ctx: Ctx, ids: number[]) => ids.map(id => ctx.d.emp(id)?.nom ?? `salarié n° ${id}`);

/**
 * Lot des feuilles `sheets` dans le mode `mode` : contrôles d'une transmission réelle (fichier d'import), contenu figé,
 * feuilles réservées. Hors simulation, chaque salarié doit avoir un matricule de paie (refus qui les nomme ; en
 * simulation, avertissement et matricule Cursus à la place) et chaque rubrique émise et exportée un code Sage confirmé
 * (409, liste des rubriques). Le libellé de chaque code Sage est figé avec le contenu (colonne facultative du fichier).
 */
export function creerLot(ctx: Ctx, sheets: FeuilleTemps[], mode: SageMode, periode: string): LotEnregistre {
  const sans = sansMatriculePaie(ctx.ds.employes, ctx.d.ti, sheets.map(sh => sh.empId)).map(e => e.id);
  if (sans.length && mode !== 'simulation') {
    throw new ActionError(`Transmission refusée : ${plural(sans.length, 'salarié sans matricule de paie', 'salariés sans matricule de paie')} (${nomsSans(ctx, sans).join(', ')}). Saisissez-le sur la fiche, puis générez de nouveau le lot.`);
  }
  if (mode !== 'simulation') {
    const manquantes = rubriquesAConfirmer(rubriquesEmises(ctx.d, sheets), rubriquesPaie(ctx.ds.rubriquesPaie));
    if (manquantes.length) {
      throw new ActionError(`Transmission impossible : code Sage à confirmer pour ${manquantes.length > 1 ? 'les rubriques' : 'la rubrique'} ${rubriquesTexte(manquantes)} (écran Temps, « Rubriques de paie »)`, 409);
    }
  }
  const payload = buildSagePayload(ctx.d, sheets, SAGE_DOSSIER, new Date(), mode);
  const contenu = { ...payload, libelles: libellesSage(payload, rubriquesPaie(ctx.ds.rubriquesPaie)) };
  const lot = ctx.db.insert<LotEnregistre>('lotsPaie', {
    cle: randomUUID(), mode, statut: 'genere', periode, periodes: contenu.periodes ?? [],
    // Semaines de périodes déjà closes : parties en rappel sur la période ouverte.
    rappels: [...new Set(contenu.lignes.flatMap(l => (l.periode_origine ? [l.periode_origine] : [])))].sort(),
    creation: new Date().toISOString(), auteur: ctx.user.nom,
    feuilles: sheets.map(sh => ({ empId: sh.empId, week: sh.week })), resume: resumeContenu(contenu), sansMatricule: sans, contenu,
    telechargeLe: null, telechargePar: null, telechargements: 0, confirmeLe: null, confirmePar: null, reference: null, annuleLe: null, annulePar: null, historique: false,
  });
  sheets.forEach(sh => ctx.db.update<FeuilleTemps>('feuilles', sh.id, { lotId: lot.id }));
  return lot;
}

/** Feuilles du lot, salarié par salarié (journal : archive paie, historique de la fiche). */
const resultatLot = (lot: Pick<LotPaie, 'id' | 'feuilles'>) => ({ lot: lot.id, feuilles: lot.feuilles });

/** « · rappel de septembre 2026 · 1 salarié sans matricule de paie (…), sous le matricule Cursus ». */
function suitesLot(ctx: Ctx, lot: Pick<LotPaie, 'rappels' | 'sansMatricule'>): string {
  return (lot.rappels.length ? ` · rappel de ${lot.rappels.map(periodeLabel).join(', ')}` : '')
    + (lot.sansMatricule.length ? ` · ${plural(lot.sansMatricule.length, 'salarié sans matricule de paie', 'salariés sans matricule de paie')} (${nomsSans(ctx, lot.sansMatricule).join(', ')}), sous le matricule Cursus et refusés d’une transmission réelle` : '');
}

/**
 * Génère le lot de la période de paie `periode` (AAAA-MM) : feuilles validées en attente dont la période de destination
 * vient au plus tard (rappels compris). Simulation ou fichier d'import ; le fichier se télécharge ensuite.
 */
const lotGenerer: ActionHandler = (ctx, p) => {
  requirePaie(ctx);
  const periode = str(p.periode);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periode)) throw new ActionError('Période de paie invalide');
  const sheets = feuillesDuLot(sagePending(ctx.d), periode, ctx.ds.settings, ctx.d.ti);
  if (!sheets.length) throw new ActionError(`Aucune feuille validée en attente pour ${periodeLabel(periode)}`);
  const mode = sageMode();
  const lot = creerLot(ctx, sheets, mode, periode);
  const salaries = new Set(sheets.map(sh => sh.empId)).size;
  return {
    message: `Lot n° ${lot.id} généré — ${plural(sheets.length, 'feuille', 'feuilles')} (${plural(salaries, 'salarié', 'salariés')}), ${periodeLabel(periode)}`
      + (mode === 'simulation' ? ' · simulation : rien n’est envoyé à Sage Paie' : ' · téléchargez le fichier d’import, importez-le dans Sage, puis confirmez l’import')
      + suitesLot(ctx, lot),
    result: resultatLot(lot),
  };
};

/** Lot désigné par `id`, avec son contenu. */
function lotDe(ctx: Ctx, id: unknown): LotEnregistre {
  const lot = ctx.db.get<LotEnregistre>('lotsPaie', Number(id));
  if (!lot) throw new ActionError('Lot de paie introuvable', 404);
  return lot;
}

/**
 * Confirmation de l'import dans Sage (accusé) : datée, signée de la personne connectée, avec la référence de l'import
 * si Sage en donne une. Elle seule marque les feuilles transmises. Lot de fichier : son fichier doit avoir été
 * téléchargé. Lot de simulation : refusé hors simulation (il n'a rien envoyé). Déjà confirmé : rien n'est refait.
 */
export function confirmerLot(ctx: Ctx, lot: LotEnregistre, reference: string | null) {
  ctx.db.update<LotEnregistre>('lotsPaie', lot.id, { statut: 'transmis', confirmeLe: new Date().toISOString(), confirmePar: ctx.user.nom, reference });
  ctx.db.sql.prepare('UPDATE feuilles SET sage = 1 WHERE lot_id = ?').run(lot.id);
}

const lotConfirmer: ActionHandler = (ctx, p) => {
  // Référence contrôlée avant tout, droits compris (elle est recopiée au journal, refus 403 compris : un code, jamais
  // un texte libre).
  const reference = str(p.reference);
  const erreur = erreurReference(reference);
  if (erreur) throw new ActionError(erreur);
  requirePaie(ctx);
  const lot = lotDe(ctx, p.id);
  if (lot.statut === 'transmis') return { message: `Lot n° ${lot.id} : import déjà confirmé`, result: resultatLot(lot) };
  if (lot.statut === 'annule') throw new ActionError(`Lot n° ${lot.id} annulé : générez un nouveau lot`, 409);
  const mode = sageMode();
  if (lot.mode === 'simulation' && mode !== 'simulation') {
    throw new ActionError(`Lot n° ${lot.id} généré en simulation : rien n’a été envoyé. Annulez-le, puis générez le lot réel de la période.`, 409);
  }
  if (lot.mode === 'fichier' && !lot.telechargements) {
    throw new ActionError(`Lot n° ${lot.id} : téléchargez d’abord son fichier d’import et importez-le dans Sage, puis confirmez l’import`, 409);
  }
  const accuse = reference || (lot.mode === 'simulation' ? pushToSage(lot.contenu ?? { lignes: [] }, 'simulation').reference : null);
  confirmerLot(ctx, lot, accuse);
  return {
    message: `Lot n° ${lot.id} : ${lot.mode === 'simulation' ? 'marqué transmis (simulation, rien n’est envoyé à Sage Paie)' : 'import dans Sage confirmé'} — ${plural(lot.feuilles.length, 'feuille marquée transmise', 'feuilles marquées transmises')}${accuse ? ` · référence ${accuse}` : ''}`,
    result: resultatLot(lot),
  };
};

/** Annulation d'un lot dont l'import n'est pas confirmé : ses feuilles sont libérées, de nouveau en attente. */
const lotAnnuler: ActionHandler = (ctx, p) => {
  requirePaie(ctx);
  const lot = lotDe(ctx, p.id);
  if (lot.statut === 'annule') return { message: `Lot n° ${lot.id} déjà annulé`, result: resultatLot(lot) };
  if (lot.statut === 'transmis') {
    throw new ActionError(`Lot n° ${lot.id} : import confirmé dans Sage, il ne s’annule plus. Une correction passera par un lot correctif ; d’ici là, corrigez directement dans Sage.`, 409);
  }
  ctx.db.update<LotEnregistre>('lotsPaie', lot.id, { statut: 'annule', annuleLe: new Date().toISOString(), annulePar: ctx.user.nom });
  ctx.db.sql.prepare('UPDATE feuilles SET lot_id = NULL WHERE lot_id = ? AND sage = 0').run(lot.id);
  return {
    message: `Lot n° ${lot.id} annulé — ${plural(lot.feuilles.length, 'feuille libérée', 'feuilles libérées')}, de nouveau en attente${lot.telechargements ? ' · si son fichier a été importé dans Sage, supprimez-y cet import' : ''}`,
    result: resultatLot(lot),
  };
};

/**
 * Format du fichier d'import (séparateur, colonnes et leur ordre, période, dates, décimale, en-tête, encodage), ajusté
 * à l'import de Sage.
 */
const formatFichier: ActionHandler = (ctx, p) => {
  requirePaie(ctx);
  const f = controlerFormat(p, lireFormatFichier(ctx.db));
  if (typeof f === 'string') throw new ActionError(f);
  ctx.db.setSetting('formatFichierPaie', f);
  return 'Format du fichier d’import enregistré : il s’applique aux prochains téléchargements';
};

/**
 * Transmission en un clic, en simulation seulement : lot de toutes les feuilles en attente, aussitôt marqué transmis
 * (référence « SIM-… »), rien n'est envoyé. Mode fichier : refus 503, le lot passe par le fichier et la confirmation de
 * l'import (paie.lotGenerer, puis paie.lotConfirmer).
 */
export function pushSageSimulation(ctx: Ctx) {
  requirePaie(ctx);
  const sheets = sagePending(ctx.d);
  if (!sheets.length) throw new ActionError('Aucune feuille validée en attente de transmission');
  const mode = sageMode();
  if (mode !== 'simulation') {
    try {
      pushToSage({ lignes: [] }, mode);
    } catch (err) {
      if (err instanceof SageIndisponible) throw new ActionError(err.message, 503);
      throw err;
    }
  }
  const periode = sheets.map(sh => periodeDeLaFeuille(sh.week, ctx.ds.settings, ctx.d.ti)).sort().at(-1)!;
  const lot = creerLot(ctx, sheets, mode, periode);
  const reference = pushToSage(lot.contenu!, 'simulation').reference;
  confirmerLot(ctx, lot, reference);
  return {
    message: `${plural(sheets.length, 'feuille marquée transmise', 'feuilles marquées transmises')} — simulation, rien n’est envoyé à Sage Paie`
      + (lot.periodes.length ? ` · ${lot.periodes.length > 1 ? 'périodes' : 'période'} ${lot.periodes.map(periodeLabel).join(', ')}` : '')
      + suitesLot(ctx, lot),
    result: resultatLot(lot),
  };
}

export const paieActions: Record<string, ActionHandler> = {
  'paie.rubrique': rubrique,
  'paie.lotGenerer': lotGenerer,
  'paie.lotConfirmer': lotConfirmer,
  'paie.lotAnnuler': lotAnnuler,
  'paie.formatFichier': formatFichier,
};
