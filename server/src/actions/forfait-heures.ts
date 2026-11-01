// Forfait annuel en heures (t044, lot 12, chantier C1) : clôture de chaque plage sous forfait d'une période de référence
// (année civile par défaut), à la sortie du salarié ou à l'avenant qui fait quitter le forfait, par l'administrateur RH.
// Règles : shared/rules/forfait-heures.ts ; paie : server/src/forfait-heures-paie.ts (famille « forfaitHeures »).
// - `forfaitHeures.cloturer` (lignes cochées : salarié et début de plage) : la ligne est recalculée sur l'instantané,
//   photographiée et confirmée ; une ligne déjà confirmée n'est jamais refaite ; une ligne bloquée (plage en cours, feuille
//   non validée, semaine sans feuille ni absence, durée légale atteinte par un temps partiel) refuse toute la clôture.
// - `forfaitHeures.rouvrir` (motif obligatoire, 500 caractères au plus) : avant transmission, la ligne repasse « à
//   confirmer » ; après, une nouvelle version « à confirmer » la remplace, dont seul l'écart partira (lot correctif). Refusée
//   tant que la ligne est dans un lot dont l'import n'est pas confirmé (annuler d'abord le lot).
// - `forfaitHeures.annuler` (motif obligatoire) : avant transmission seulement, hors d'un lot ; la plage redevient à clôturer.
// Toutes réservées à l'administrateur RH, jamais pour soi-même. Journal : identifiants, plage, version, statut ; ni heures, ni
// taux, ni montant, ni motif (server/src/journal.ts).
import { isValidDate } from '../../../shared/dates.ts';
import { fmtIso, plural } from '../../../shared/format.ts';
import { clotureForfaitHeures, derniereTransmise, periodeReference, sansEcartTransmis, versionsDe } from '../../../shared/rules/forfait-heures.ts';
import { erreurMotifReouverture } from '../../../shared/rules/regularisation.ts';
import type { ClotureForfaitHeures } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, type Ctx, getEmp, refuserSoiMeme, requireRhAdmin, REVIENT_RH, str } from './context.ts';

/** Lignes cochées d'une clôture : 500 au plus (une par salarié au forfait et par plage). */
const LIGNES_MAX = 500;

/** Motif d'une réouverture ou d'une annulation (mêmes bornes que la réouverture d'une feuille). */
function motifDe(p: Record<string, any>): string {
  const motif = str(p.motif);
  const erreur = erreurMotifReouverture(motif);
  if (erreur) throw new ActionError(erreur.replace('de la réouverture', 'de la réouverture ou de l’annulation'));
  return motif;
}

/** Ligne désignée par `id`, son salarié (refus pour soi-même). */
async function ligneDe(ctx: Ctx, id: unknown, refus: string): Promise<ClotureForfaitHeures> {
  const l = await ctx.db.get<ClotureForfaitHeures>('cloturesForfaitHeures', Number(id));
  if (!l) throw new ActionError('Clôture du forfait annuel en heures introuvable', 404);
  refuserSoiMeme(ctx, getEmp(ctx, l.empId), refus, REVIENT_RH);
  return l;
}

const plageTexte = (l: Pick<ClotureForfaitHeures, 'debut' | 'fin'>) => `du ${fmtIso(l.debut)} au ${fmtIso(l.fin)}`;

/** `lignes` : [{ empId, debut }] — plages à clôturer, recalculées ici. */
const cloturer: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const demandes: unknown[] = Array.isArray(p.lignes) ? p.lignes : [];
  if (!demandes.length) throw new ActionError('Cochez au moins une ligne à clôturer');
  if (demandes.length > LIGNES_MAX) throw new ActionError(`${LIGNES_MAX} lignes au plus par clôture`);
  const toutes = await ctx.db.all<ClotureForfaitHeures>('cloturesForfaitHeures');
  const aEcrire: { calc: NonNullable<ReturnType<typeof clotureForfaitHeures>>; derniere: ClotureForfaitHeures | null; nom: string }[] = [];
  const deja: string[] = [], refus: string[] = [], vues = new Set<string>();
  for (const x of demandes) {
    const o = (x ?? {}) as Record<string, unknown>;
    const emp = getEmp(ctx, o.empId);
    refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas clôturer votre propre forfait annuel en heures', REVIENT_RH);
    const debut = str(o.debut);
    if (!isValidDate(debut)) throw new ActionError('Début de la plage à clôturer : date invalide');
    if (vues.has(`${emp.id}|${debut}`)) continue;
    vues.add(`${emp.id}|${debut}`);
    const calc = clotureForfaitHeures(ctx.d, emp, periodeReference(ctx.ds.settings, debut), debut);
    if (!calc) throw new ActionError(`${emp.nom} : aucune plage sous forfait annuel en heures ne commence le ${fmtIso(debut)}`, 404);
    const derniere = versionsDe(toutes, emp.id, debut).at(-1) ?? null;
    if (derniere?.statut === 'confirmee') { deja.push(emp.nom); continue; }
    if (calc.blocages.length) { refus.push(`${emp.nom} : ${calc.blocages.join(' ; ')}`); continue; }
    aEcrire.push({ calc, derniere, nom: emp.nom });
  }
  if (refus.length) throw new ActionError(`Clôture refusée, rien n’est enregistré — ${refus.join(' · ')}`, 409);
  const le = new Date().toISOString();
  const lignes: Pick<ClotureForfaitHeures, 'id' | 'empId' | 'debut' | 'fin' | 'version'>[] = [];
  const sansEcarts: number[] = [];
  for (const { calc, derniere } of aEcrire) {
    const photo = {
      fin: calc.fin, motifFin: calc.motifFin, forfait: calc.forfait, cible: calc.cible, absences: calc.absences, realise: calc.realise,
      hfa25: calc.hfa25, hfa50: calc.hfa50, hca10: calc.hca10, hca25: calc.hca25, nonRealise: calc.nonRealise,
      statut: 'confirmee' as const, confirmeeLe: le, confirmeePar: ctx.user.nom,
    };
    if (derniere?.statut === 'proposee') {
      // Ligne rouverte avant transmission, ou nouvelle version après transmission : recalculée et confirmée, même version.
      // Nouvelle version sans aucun écart avec la version transmise : réglée tout de suite, aucun lot ne l'emporterait.
      const sansEcart = sansEcartTransmis(toutes, { ...derniere, ...photo });
      await ctx.db.update<ClotureForfaitHeures>('cloturesForfaitHeures', derniere.id, { ...photo, ...(sansEcart ? { sage: true } : {}) });
      if (sansEcart) sansEcarts.push(calc.empId);
      lignes.push({ id: derniere.id, empId: calc.empId, debut: calc.debut, fin: calc.fin, version: derniere.version });
      continue;
    }
    // Première clôture, ou plage dont la ligne a été annulée : nouvelle version.
    const version = (derniere?.version ?? 0) + 1;
    const remplace = derniereTransmise(toutes, { empId: calc.empId, debut: calc.debut, version });
    const ligne: Omit<ClotureForfaitHeures, 'id'> = {
      empId: calc.empId, debut: calc.debut, version, remplaceId: remplace?.id ?? null, ...photo, lotId: null, sage: false, horsFichier: false,
      rouverteLe: null, rouvertePar: null, rouverteMotif: null, annuleeLe: null, annuleePar: null, annuleeMotif: null,
    };
    // Plage dont la version transmise reste en vigueur sous une version annulée : sans écart, réglée tout de suite.
    if (sansEcartTransmis(toutes, { id: 0, ...ligne })) { ligne.sage = true; sansEcarts.push(calc.empId); }
    const l = await ctx.db.insert<ClotureForfaitHeures>('cloturesForfaitHeures', ligne);
    lignes.push({ id: l.id, empId: l.empId, debut: l.debut, fin: l.fin, version: l.version });
  }
  const noms = aEcrire.map(x => x.nom);
  return {
    message: lignes.length
      ? `Forfait annuel en heures : ${plural(lignes.length, 'ligne clôturée', 'lignes clôturées')} (${noms.join(', ')}) · `
        + (sansEcarts.length === lignes.length ? 'aucun écart avec la version transmise : rien à transmettre'
          : 'heures à transmettre par le prochain lot de paie' + (sansEcarts.length ? ` (sauf ${sansEcarts.length > 1 ? 'les versions' : 'la version'} sans écart avec la version transmise)` : ''))
        + (deja.length ? ` · déjà ${deja.length > 1 ? 'confirmées' : 'confirmée'} : ${deja.join(', ')}` : '')
      : `Forfait annuel en heures : ${plural(deja.length, 'ligne déjà confirmée', 'lignes déjà confirmées')}, rien n’est refait`,
    result: { lignes },
  };
};

/** `id`, `motif` : la ligne repasse à confirmer, ou une nouvelle version la remplace si elle est déjà transmise. */
const rouvrir: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const motif = motifDe(p);
  const l = await ligneDe(ctx, p.id, 'Vous ne pouvez pas rouvrir la clôture de votre propre forfait annuel en heures');
  const nom = ctx.d.emp(l.empId)!.nom;
  if (l.statut === 'annulee') throw new ActionError(`Clôture de ${nom} annulée : clôturez de nouveau la plage`, 409);
  if (l.statut === 'proposee') throw new ActionError(`Clôture de ${nom} déjà rouverte, à confirmer`, 409);
  if (l.lotId != null && !l.sage) {
    throw new ActionError(`Heures du forfait de ${nom} comprises dans le lot de paie n° ${l.lotId}, import à confirmer : annulez d’abord ce lot (écran Temps), puis rouvrez la clôture`, 409);
  }
  const versions = await ctx.db.where<ClotureForfaitHeures>('cloturesForfaitHeures', 'empId', l.empId);
  if (versions.some(x => x.debut === l.debut && x.version > l.version)) throw new ActionError(`Clôture de ${nom} : une version plus récente existe, rouvrez celle-ci`, 409);
  const rouverte = { rouverteLe: new Date().toISOString(), rouvertePar: ctx.user.nom, rouverteMotif: motif };
  if (!l.sage) {
    await ctx.db.update<ClotureForfaitHeures>('cloturesForfaitHeures', l.id, { statut: 'proposee', confirmeeLe: null, confirmeePar: null, ...rouverte });
    return {
      message: `Clôture du forfait annuel en heures de ${nom} (${plageTexte(l)}) rouverte : à confirmer de nouveau`,
      result: { id: l.id, empId: l.empId, version: l.version, nouvelle: null },
    };
  }
  // Déjà transmise : gardée telle quelle ; la nouvelle version n'enverra que l'écart (lot correctif).
  const { id: _id, ...copie } = l;
  const n = await ctx.db.insert<ClotureForfaitHeures>('cloturesForfaitHeures', {
    ...copie, version: l.version + 1, remplaceId: l.id, statut: 'proposee', confirmeeLe: null, confirmeePar: null, lotId: null, sage: false, horsFichier: false,
    ...rouverte, annuleeLe: null, annuleePar: null, annuleeMotif: null,
  });
  return {
    message: `Clôture du forfait annuel en heures de ${nom} (${plageTexte(l)}) rouverte après sa transmission : version ${n.version} à confirmer, seul l’écart partira dans un lot correctif`,
    result: { id: l.id, empId: l.empId, version: l.version, nouvelle: n.id },
  };
};

/** `id`, `motif` : annulation avant transmission, hors d'un lot. */
const annuler: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const motif = motifDe(p);
  const l = await ligneDe(ctx, p.id, 'Vous ne pouvez pas annuler la clôture de votre propre forfait annuel en heures');
  const nom = ctx.d.emp(l.empId)!.nom;
  if (l.statut === 'annulee') return { message: `Clôture du forfait annuel en heures de ${nom} déjà annulée`, result: { id: l.id, empId: l.empId } };
  if (l.sage) throw new ActionError(`Clôture de ${nom} déjà transmise à la paie : rouvrez-la pour corriger (lot correctif)`, 409);
  if (l.lotId != null) throw new ActionError(`Heures du forfait de ${nom} comprises dans le lot de paie n° ${l.lotId}, import à confirmer : annulez d’abord ce lot (écran Temps), puis la clôture`, 409);
  await ctx.db.update<ClotureForfaitHeures>('cloturesForfaitHeures', l.id, { statut: 'annulee', annuleeLe: new Date().toISOString(), annuleePar: ctx.user.nom, annuleeMotif: motif });
  return { message: `Clôture du forfait annuel en heures de ${nom} (${plageTexte(l)}) annulée : la plage est de nouveau à clôturer`, result: { id: l.id, empId: l.empId } };
};

export const forfaitHeuresActions = {
  'forfaitHeures.cloturer': cloturer,
  'forfaitHeures.rouvrir': rouvrir,
  'forfaitHeures.annuler': annuler,
} satisfies Record<string, ActionHandler>;
