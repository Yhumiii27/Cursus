// Variables de paie d'une période (t028), export CSV de l'écran Temps pour le contrôle de la paie :
//   GET /api/paie/variables/:periode   administrateur RH et gestionnaire de paie (droit « paie ») : une ligne par
//                                      salarié, code Sage et origine (semaine d'une feuille, absence, solde de sortie), quantité et
//                                      détail, des lots non annulés de la période, puis de ce qui attend encore un lot
//                                      (« en attente », calculé comme le serait le lot du jour).
// Le code de rubrique d'une absence révèle sa catégorie (santé…) : export réservé au droit « paie », comme le fichier
// d'import ; le détail ne nomme jamais la nature. Chaque export est tracé (`sage.variables`, archive paie de 3 ans,
// salariés concernés), sans aucune quantité ni rubrique dans le journal.
import express, { type Router } from 'express';
import { droitsRh, RUBRIQUES_PAIE } from '../../shared/constants.ts';
import { texteCsv } from '../../shared/csv.ts';
import { Domain } from '../../shared/domain.ts';
import { plural } from '../../shared/format.ts';
import { detailElement } from '../../shared/rules/absences-paie.ts';
import { detailSortie } from '../../shared/rules/solde-sortie.ts';
import { feuillesDuLot, libellesSage, STATUTS_LOT } from '../../shared/rules/lots-paie.ts';
import { matriculeAffiche } from '../../shared/rules/matricules.ts';
import { periodeLabel, rubriquesPaie } from '../../shared/rules/paie.ts';
import { buildSagePayload, sagePending } from '../../shared/rules/temps.ts';
import type { CurrentUser, ElementAbsencePaie, RubriquePaie, SagePush } from '../../shared/types.ts';
import { absencesAEmettre, traduireElements } from './absences-paie.ts';
import { journaliser } from './comptes.ts';
import { identite } from './connexion.ts';
import { loadFull } from './dataset.ts';
import type { Db } from './db.ts';
import { SAGE_DOSSIER, sageMode } from './integrations/sage.ts';
import { fichierJoint, tracerRefus } from './journal.ts';
import type { LotEnregistre } from './lots-paie.ts';
import { sortiesAEmettre } from './soldes-sortie.ts';

/** Ligne de l'export : `empId` sert au journal (salariés concernés), il n'est pas écrit dans le fichier. */
export interface VariablePaie {
  matricule: string; salarie: string; rubrique: string; libelle: string; quantite: number; detail: string; lot: string; etat: string; empId: number | null;
}

/** Colonne « Rubrique Sage » d'un élément d'absence sans code Sage, qui ne part pas dans le fichier. */
export const A_SAISIR = 'À saisir dans Sage';

export const ENTETE_VARIABLES =['Matricule de paie', 'Salarié', 'Rubrique Sage', 'Libellé', 'Quantité', 'Détail', 'Lot', 'État'];

/**
 * Variables de la période `periode` (AAAA-MM) : lignes des lots générés ou transmis (contenu figé), puis lignes en
 * attente d'un lot. Rappels d'une période close compris (ils partent sur la période ouverte), régularisations négatives
 * comprises ; absence sans code Sage (rubrique désactivée, régularisation de jours saisis à la main) : « À saisir dans
 * Sage », absente du fichier.
 */
export function variablesDeLaPeriode(db: Db, user: CurrentUser, periode: string): VariablePaie[] {
  const d = new Domain(loadFull(db, user));
  const nomPar = new Map(d.ds.employes.map(e => [matriculeAffiche(e), { nom: e.nom, id: e.id }]));
  const table = rubriquesPaie(db.all<RubriquePaie>('rubriquesPaie'));
  const out: VariablePaie[] = [];
  const ajouter = (contenu: Pick<SagePush, 'lignes' | 'absences' | 'sorties' | 'libelles'>, lot: string, etat: string) => {
    const libelles = contenu.libelles ?? libellesSage(contenu, table);
    for (const l of contenu.lignes) {
      if ((l.periode ?? '') !== periode) continue;
      const e = nomPar.get(l.matricule);
      for (const [rubrique, quantite] of Object.entries(l.rubriques)) {
        if (!quantite) continue;
        out.push({
          matricule: l.matricule, salarie: e?.nom ?? '', rubrique, libelle: libelles[rubrique] ?? rubrique, quantite, lot, etat, empId: e?.id ?? null,
          detail: `Semaine ${l.semaine}${l.periode_origine ? ` · rappel de ${periodeLabel(l.periode_origine)}` : ''}`,
        });
      }
    }
    for (const x of contenu.absences ?? []) {
      if (x.periode !== periode) continue;
      // Sans code Sage (rubrique désactivée, ou régularisation de jours saisis à la main) : absent du fichier, listé ici
      // pour que la paie le saisisse ou le corrige dans Sage.
      const code = x.codeSage ?? A_SAISIR;
      out.push({
        matricule: x.matricule, salarie: d.emp(x.empId)?.nom ?? '', rubrique: code, quantite: x.quantite, lot, etat, empId: x.empId,
        libelle: x.codeSage ? libelles[x.codeSage] ?? x.codeSage : RUBRIQUES_PAIE[x.rubrique]?.label ?? x.rubrique,
        detail: detailElement(x, periodeLabel),
      });
    }
    // Soldes de sortie (t128) : rubriques de sortie actives seulement, toujours sous un code Sage.
    for (const x of contenu.sorties ?? []) {
      if (x.periode !== periode) continue;
      out.push({
        matricule: x.matricule, salarie: d.emp(x.empId)?.nom ?? '', rubrique: x.codeSage, quantite: x.quantite, lot, etat, empId: x.empId,
        libelle: libelles[x.codeSage] ?? x.codeSage, detail: detailSortie(x),
      });
    }
  };
  for (const lot of db.all<LotEnregistre>('lotsPaie')) {
    if (lot.statut !== 'annule' && lot.contenu) ajouter(lot.contenu, `n° ${lot.id}`, STATUTS_LOT[lot.statut].label);
  }
  // En attente : ce que le lot de la période emporterait aujourd'hui.
  const sheets = feuillesDuLot(sagePending(d), periode, d.ds.settings, d.ti);
  const absences: ElementAbsencePaie[] = traduireElements(absencesAEmettre(db, d, periode), d.ds.rubriquesPaie);
  const sorties = sortiesAEmettre(db, d, periode);
  if (sheets.length || absences.length || sorties.length) ajouter({ ...buildSagePayload(d, sheets, SAGE_DOSSIER, new Date(), sageMode()), absences, sorties }, '', 'En attente d’un lot');
  return out.sort((a, b) => a.matricule.localeCompare(b.matricule) || a.rubrique.localeCompare(b.rubrique) || a.detail.localeCompare(b.detail));
}

/** Texte CSV de l'export (« ; », UTF-8 avec BOM, quantités à la française). */
export const csvVariables = (lignes: readonly VariablePaie[]) =>
  texteCsv(ENTETE_VARIABLES, lignes.map(l => [l.matricule, l.salarie, l.rubrique, l.libelle, String(l.quantite).replace('.', ','), l.detail, l.lot, l.etat]));

export function routesVariablesPaie(db: Db): Router {
  const r = express.Router();

  r.get('/api/paie/variables/:periode', (req, res) => {
    const id = identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    if (!droitsRh(id.user).includes('paie')) {
      tracerRefus(db, id, 'Variables de paie de la période', 'réservé à l’administrateur RH et au gestionnaire de paie');
      return res.status(403).json({ error: 'Variables de paie réservées à l’administrateur RH et au gestionnaire de paie' });
    }
    const periode = String(req.params.periode);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periode)) return res.status(400).json({ error: 'Période de paie invalide' });
    const lignes = variablesDeLaPeriode(db, id.user, periode);
    journaliser(db, {
      actor: id.user.nom, role: id.user.role, action: 'sage.variables', compte: id.compte,
      salaries: [...new Set(lignes.flatMap(l => (l.empId != null ? [l.empId] : [])))],
      message: `Variables de paie ${/^[aeiou]/.test(periodeLabel(periode)) ? 'd’' : 'de '}${periodeLabel(periode)} exportées — ${plural(lignes.length, 'ligne', 'lignes')}`,
      payload: { periode, lignes: lignes.length },
    });
    fichierJoint(res, 'text/csv; charset=utf-8', `variables-paie-${periode}.csv`, csvVariables(lignes));
  });

  return r;
}
