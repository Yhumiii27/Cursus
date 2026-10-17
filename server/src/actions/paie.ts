// Paie : correspondance des rubriques internes avec le plan de paie Sage (écran Temps, « Rubriques de paie »), saisie et
// confirmée par l'administrateur RH ou le gestionnaire de paie, qui n'a pas accès aux Paramètres. Chaque modification
// est tracée (action liée à la paie, archivée 3 ans) ; un code non confirmé bloque toute transmission réelle.
// Lots de paie (t029, mode fichier de t019) : la paie génère le lot d'une période (feuilles validées réservées, contenu
// figé, clé d'idempotence), télécharge son fichier d'import (server/src/fichier-paie.ts), l'importe dans Sage puis
// confirme l'import — confirmation datée et signée qui seule marque les feuilles transmises — ou annule le lot avant
// cette confirmation, ce qui libère ses feuilles. Après elle, une correction passe par la réouverture de la feuille
// (`temps.rouvrir`, administrateur RH) : revalidée, son écart part dans le lot suivant, de type « correctif » (t131,
// shared/rules/regularisation.ts).
// Absences (t028, réglage `absencesFichierPaie`) : le lot emporte aussi les absences validées, ventilées par mois, et les
// régularisations de celles annulées ou raccourcies depuis leur transmission (server/src/absences-paie.ts) ; réservées
// (`absences.lotId`), libérées et marquées transmises (`absences.sage`) comme les feuilles.
import { randomUUID } from 'node:crypto';
import { RUBRIQUES_PAIE } from '../../../shared/constants.ts';
import { plural } from '../../../shared/format.ts';
import { sansMatriculePaie } from '../../../shared/rules/matricules.ts';
import { controlerFormat, erreurReference, feuillesDuLot, libellesSage, periodeDeLaFeuille, resumeContenu } from '../../../shared/rules/lots-paie.ts';
import { erreurCodeSage, periodeLabel, rubriquesAConfirmer, rubriquesPaie, rubriquesTexte } from '../../../shared/rules/paie.ts';
import { buildSagePayload, rubriquesEmises, sagePending } from '../../../shared/rules/temps.ts';
import { absencesDansLeFichier, type ElementCalcule } from '../../../shared/rules/absences-paie.ts';
import type { Absence, FeuilleTemps, LotPaie, RubriquePaie, SageMode } from '../../../shared/types.ts';
import { absencesAEmettre, absencesDuContenu, departAuPremierLot, libererAbsences, traduireElements } from '../absences-paie.ts';
import { pushToSage, SAGE_DOSSIER, SageIndisponible, sageMode } from '../integrations/sage.ts';
import { aRegulariser } from '../../../shared/rules/regularisation.ts';
import { optionsRegularisation } from '../regularisation-paie.ts';
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
 * Lot des feuilles `sheets` et des éléments d'absence `absences` dans le mode `mode` : contrôles d'une transmission
 * réelle (fichier d'import), contenu figé, feuilles et absences réservées. Hors simulation, chaque salarié doit avoir un
 * matricule de paie (refus qui les nomme ; en simulation, avertissement et matricule Cursus à la place) et chaque
 * rubrique émise et exportée un code Sage confirmé (409, liste des rubriques). Le libellé de chaque code Sage est figé
 * avec le contenu (colonne facultative du fichier), comme le code Sage de chaque absence.
 */
export function creerLot(ctx: Ctx, sheets: FeuilleTemps[], mode: SageMode, periode: string, absences: ElementCalcule[] = []): LotEnregistre {
  const sans = sansMatriculePaie(ctx.ds.employes, ctx.d.ti, [...sheets.map(sh => sh.empId), ...absences.map(x => x.empId)]).map(e => e.id);
  if (sans.length && mode !== 'simulation') {
    throw new ActionError(`Transmission refusée : ${plural(sans.length, 'salarié sans matricule de paie', 'salariés sans matricule de paie')} (${nomsSans(ctx, sans).join(', ')}). Saisissez-le sur la fiche, puis générez de nouveau le lot.`);
  }
  if (mode !== 'simulation') {
    const manquantes = rubriquesAConfirmer([...rubriquesEmises(ctx.d, sheets), ...absences.map(x => x.rubrique)], rubriquesPaie(ctx.ds.rubriquesPaie));
    if (manquantes.length) {
      throw new ActionError(`Transmission impossible : code Sage à confirmer pour ${manquantes.length > 1 ? 'les rubriques' : 'la rubrique'} ${rubriquesTexte(manquantes)} (écran Temps, « Rubriques de paie »)`, 409);
    }
  }
  // Feuilles rouvertes après leur transmission : écart, ou « annule et remplace » selon le format du fichier.
  const payload = buildSagePayload(ctx.d, sheets, SAGE_DOSSIER, new Date(), mode, optionsRegularisation(ctx.db, ctx.d));
  const correctifs = sheets.filter(aRegulariser).map(sh => ({ empId: sh.empId, week: sh.week }));
  const elements = traduireElements(absences, ctx.ds.rubriquesPaie);
  const avecAbsences = elements.length ? { ...payload, absences: elements, periodes: [...new Set([...(payload.periodes ?? []), ...elements.map(x => x.periode)])].sort() } : payload;
  const contenu = { ...avecAbsences, libelles: libellesSage(avecAbsences, rubriquesPaie(ctx.ds.rubriquesPaie)) };
  const lot = ctx.db.insert<LotEnregistre>('lotsPaie', {
    cle: randomUUID(), mode, statut: 'genere', periode, periodes: contenu.periodes ?? [],
    // Semaines et mois d'absence de périodes déjà closes : partis en rappel sur la période ouverte.
    rappels: [...new Set([...contenu.lignes.flatMap(l => (l.periode_origine ? [l.periode_origine] : [])), ...elements.filter(x => x.mois !== x.periode).map(x => x.mois)])].sort(),
    creation: new Date().toISOString(), auteur: ctx.user.nom,
    feuilles: sheets.map(sh => ({ empId: sh.empId, week: sh.week })), absences: absencesDuContenu(elements), resume: resumeContenu(contenu), sansMatricule: sans, contenu,
    telechargeLe: null, telechargePar: null, telechargements: 0, confirmeLe: null, confirmePar: null, reference: null, annuleLe: null, annulePar: null, historique: false,
    type: correctifs.length ? 'correctif' : 'normal', correctifs,
  });
  sheets.forEach(sh => ctx.db.update<FeuilleTemps>('feuilles', sh.id, { lotId: lot.id }));
  absencesDuContenu(elements).forEach(a => ctx.db.update<Absence>('absences', a.id, { lotId: lot.id }));
  return lot;
}

/**
 * Feuilles du lot, salarié par salarié, ses absences (identifiant et salarié, jamais la nature ni la rubrique) et ses
 * feuilles régularisées : journal, archive paie, historique de la fiche.
 */
const resultatLot = (lot: Pick<LotPaie, 'id' | 'feuilles' | 'absences' | 'correctifs'>) => ({
  lot: lot.id, feuilles: lot.feuilles, ...(lot.absences?.length ? { absences: lot.absences } : {}),
  // Lot correctif : feuilles rouvertes régularisées (salarié, semaine).
  ...(lot.correctifs?.length ? { correctifs: lot.correctifs } : {}),
});
/** « · 2 absences, dont 1 régularisation » : absences d'un lot, en fin de message. */
const absencesTexte = (absences: readonly ElementCalcule[]) => {
  const n = new Set(absences.map(x => x.absence)).size, reg = new Set(absences.filter(x => x.quantite < 0).map(x => x.absence)).size;
  return n ? ` · ${plural(n, 'absence', 'absences')}${reg ? `, dont ${plural(reg, 'régularisation', 'régularisations')}` : ''}` : '';
};

/** « · lot correctif : 1 feuille régularisée · rappel de septembre 2026 · 1 salarié sans matricule de paie (…) ». */
function suitesLot(ctx: Ctx, lot: Pick<LotPaie, 'rappels' | 'sansMatricule' | 'correctifs'>): string {
  return (lot.correctifs?.length ? ` · lot correctif : ${plural(lot.correctifs.length, 'feuille rouverte régularisée', 'feuilles rouvertes régularisées')}` : '')
    + (lot.rappels.length ? ` · rappel de ${lot.rappels.map(periodeLabel).join(', ')}` : '')
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
  // Premier lot d'une base sans date de départ : les absences déjà enregistrées ne partent qu'à partir de la période ouverte.
  const depart = departAuPremierLot(ctx.db, ctx.d, ctx.user);
  const absences = absencesAEmettre(ctx.db, ctx.d, periode);
  if (!sheets.length && !absences.length) {
    throw new ActionError(`Aucune feuille validée en attente pour ${periodeLabel(periode)}${absencesDansLeFichier(ctx.ds.settings) ? ', ni absence' : ''}`);
  }
  const mode = sageMode();
  const lot = creerLot(ctx, sheets, mode, periode, absences);
  const salaries = new Set([...sheets.map(sh => sh.empId), ...absences.map(x => x.empId)]).size;
  return {
    message: `Lot n° ${lot.id} généré — ${plural(sheets.length, 'feuille', 'feuilles')} (${plural(salaries, 'salarié', 'salariés')}), ${periodeLabel(periode)}`
      + (mode === 'simulation' ? ' · simulation : rien n’est envoyé à Sage Paie' : ' · téléchargez le fichier d’import, importez-le dans Sage, puis confirmez l’import')
      + suitesLot(ctx, lot) + absencesTexte(absences) + depart,
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
  ctx.db.sql.prepare('UPDATE absences SET sage = 1 WHERE lot_id = ?').run(lot.id);
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
    message: `Lot n° ${lot.id} : ${lot.mode === 'simulation' ? 'marqué transmis (simulation, rien n’est envoyé à Sage Paie)' : 'import dans Sage confirmé'} — ${plural(lot.feuilles.length, 'feuille marquée transmise', 'feuilles marquées transmises')}${lot.absences?.length ? ` · ${plural(lot.absences.length, 'absence', 'absences')}` : ''}${accuse ? ` · référence ${accuse}` : ''}`,
    result: resultatLot(lot),
  };
};

/** Annulation d'un lot dont l'import n'est pas confirmé : ses feuilles sont libérées, de nouveau en attente. */
const lotAnnuler: ActionHandler = (ctx, p) => {
  requirePaie(ctx);
  const lot = lotDe(ctx, p.id);
  if (lot.statut === 'annule') return { message: `Lot n° ${lot.id} déjà annulé`, result: resultatLot(lot) };
  if (lot.statut === 'transmis') {
    throw new ActionError(`Lot n° ${lot.id} : import confirmé dans Sage, il ne s’annule plus. Pour corriger une feuille, l’administrateur RH la rouvre avec un motif : revalidée, seul son écart part dans le lot suivant (lot correctif).`, 409);
  }
  ctx.db.update<LotEnregistre>('lotsPaie', lot.id, { statut: 'annule', annuleLe: new Date().toISOString(), annulePar: ctx.user.nom });
  ctx.db.sql.prepare('UPDATE feuilles SET lot_id = NULL WHERE lot_id = ? AND sage = 0').run(lot.id);
  libererAbsences(ctx.db, lot);
  return {
    message: `Lot n° ${lot.id} annulé — ${plural(lot.feuilles.length, 'feuille libérée', 'feuilles libérées')}${lot.absences?.length ? ` et ${plural(lot.absences.length, 'absence libérée', 'absences libérées')}` : ''}, de nouveau en attente${lot.telechargements ? ' · si son fichier a été importé dans Sage, supprimez-y cet import' : ''}`,
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
  // Absences des mêmes périodes, au plus tard la dernière des feuilles (premier lot : date de départ posée d'abord).
  const depart = departAuPremierLot(ctx.db, ctx.d, ctx.user);
  const absences = absencesAEmettre(ctx.db, ctx.d, periode);
  const lot = creerLot(ctx, sheets, mode, periode, absences);
  const reference = pushToSage(lot.contenu!, 'simulation').reference;
  confirmerLot(ctx, lot, reference);
  return {
    message: `${plural(sheets.length, 'feuille marquée transmise', 'feuilles marquées transmises')} — simulation, rien n’est envoyé à Sage Paie`
      + (lot.periodes.length ? ` · ${lot.periodes.length > 1 ? 'périodes' : 'période'} ${lot.periodes.map(periodeLabel).join(', ')}` : '')
      + suitesLot(ctx, lot) + absencesTexte(absences) + depart,
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
