// Exports comptables des notes de frais (lot 11, chantier C5, étape 2 ; règles : shared/rules/frais-export.ts) :
// comptabilité (droit « compta ») ou service RH. Le fichier se télécharge par sa route (server/src/frais-exports.ts),
// tracée comme le fichier de paie ; la table exportsFrais reste hors de l'instantané.
//   frais.export.generer   attendues : fige les écritures des notes contrôlées, en paiement ou payées qui ne sont dans aucun
//                          export en vigueur ; `attendues` (nombre de notes affichées) refuse une liste qui a changé depuis
//                          l'affichage, et un double clic (409)
//   frais.export.annuler   id : export annulé (gardé et daté ; l'auteur est au journal), ses notes redeviennent à exporter
// Messages sans montant ni nom : ils sont recopiés au journal (les totaux y figurent comme agrégats, dans le détail).
// lot 12 — C2 (notes de frais : activation) : notes à exporter et leurs dépenses lues en base, archivées comprises (une
// note payée depuis plus de 13 mois et jamais exportée n'est jamais perdue) ; `attendues` reste le nombre de notes que
// l'écran affiche, celles de la fenêtre de l'instantané.
import { plural } from '../../../shared/format.ts';
import { lignesDe } from '../../../shared/rules/frais.ts';
import { matriculeAffiche } from '../../../shared/rules/matricules.ts';
import { dateEcriture, ecrituresNote, notesAExporter, totauxEcritures } from '../../../shared/rules/frais-export.ts';
import type { LigneEcriture } from '../../../shared/rules/export-comptable.ts';
import type { ExportFraisEnregistre } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, requireControleurFrais } from './context.ts';
// lot 12 — C2 (notes de frais : activation)
import { noteArchivee } from '../../../shared/rules/frais-fenetre.ts';
import { lignesDesNotesEnBase, notesExportablesEnBase } from '../frais-base.ts';

const exportGenerer: ActionHandler = async (ctx, p) => {
  requireControleurFrais(ctx);
  if (!ctx.ds.settings.notesFraisActives) throw new ActionError('Notes de frais désactivées : l’administrateur RH les active dans Paramètres', 409);
  const exports = await ctx.db.all<ExportFraisEnregistre>('exportsFrais');
  const notes = notesAExporter(await notesExportablesEnBase(ctx.db), exports);
  const archivees = notes.filter(n => noteArchivee(n, ctx.d.ti)).length;
  if (p.attendues !== undefined && Number(p.attendues) !== notes.length - archivees) {
    throw new ActionError(`La liste des notes à exporter a changé (${plural(notes.length - archivees, 'note', 'notes')} maintenant) : vérifiez-la, puis générez de nouveau`, 409);
  }
  const s = ctx.ds.settings, ti = ctx.d.ti, lignesEnBase = await lignesDesNotesEnBase(ctx.db, notes.map(n => n.id));
  const lignes: LigneEcriture[] = [];
  const retenues: number[] = [], salaries = new Set<number>();
  for (const n of notes) {
    const e = ctx.d.emp(n.empId);
    const nom = e?.nom ?? ctx.ds.annuaire.find(x => x.id === n.empId)?.nom ?? `Salarié ${n.empId}`;
    const ecr = ecrituresNote(n, lignesDe(lignesEnBase, n.id), { nom, compteTiers: matriculeAffiche({ id: n.empId, matriculePaie: e?.matriculePaie ?? null }) }, s, dateEcriture(n, ti));
    // Note sans rien de retenu (dépenses toutes refusées) : aucune écriture, et elle n'entre pas dans l'export.
    if (!ecr.length) continue;
    lignes.push(...ecr);
    retenues.push(n.id);
    salaries.add(n.empId);
  }
  if (!retenues.length) throw new ActionError('Aucune note contrôlée à exporter', 409);
  const t = totauxEcritures(lignes);
  const x = await ctx.db.insert<ExportFraisEnregistre>('exportsFrais', {
    type: 'compta', cle: `compta-${crypto.randomUUID()}`, creation: new Date().toISOString(), auteur: ctx.user.nom, notes: retenues,
    contenu: { lignes, ...t }, telechargements: 0, telechargeLe: null, telechargePar: null, annuleLe: null,
  });
  return {
    message: `Export comptable n° ${x.id} généré — ${plural(retenues.length, 'note', 'notes')}${archivees ? ` (dont ${plural(archivees, 'note archivée', 'notes archivées')})` : ''}, ${plural(t.ecritures, 'ligne d’écriture', 'lignes d’écriture')} · téléchargez le fichier pour l’importer en comptabilité`,
    result: { export: x.id, notes: retenues.length, archivees, ecritures: t.ecritures, montant: t.debit, salaries: [...salaries] },
  };
};

const exportAnnuler: ActionHandler = async (ctx, p) => {
  requireControleurFrais(ctx);
  const x = await ctx.db.get<ExportFraisEnregistre>('exportsFrais', Number(p.id) || 0);
  if (!x) throw new ActionError('Export comptable introuvable', 404);
  if (x.annuleLe) return { message: `Export comptable n° ${x.id} déjà annulé`, result: { export: x.id } };
  await ctx.db.update<ExportFraisEnregistre>('exportsFrais', x.id, { annuleLe: new Date().toISOString() });
  const n = x.notes?.length ?? 0;
  return {
    message: `Export comptable n° ${x.id} annulé · ${plural(n, 'note redevient', 'notes redeviennent')} à exporter${x.telechargements ? ' ; retirez de la comptabilité les écritures déjà importées' : ''}`,
    result: { export: x.id, notes: n },
  };
};

export const fraisExportActions = {
  'frais.export.generer': exportGenerer,
  'frais.export.annuler': exportAnnuler,
} satisfies Record<string, ActionHandler>;
