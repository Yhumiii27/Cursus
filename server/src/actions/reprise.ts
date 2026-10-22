// Mise en service : import des données reprises de Lucca (salariés, soldes de congés, certifications, habilitations,
// visites médicales), réservé à l'administrateur RH. Le fichier est relu avec les colonnes rapprochées dans l'aperçu et
// analysé par la même fonction que l'écran (`analyserReprise`, shared/rules/reprise.ts) : seules les lignes retenues
// sont écrites, dans une seule transaction, et le lot est conservé avec son compte rendu ligne par ligne (table
// `reprises`) pour être relu ou rejoué. Rejouer le même fichier ne crée aucun doublon.
import { fmtIso, plural } from '../../../shared/format.ts';
import { analyserReprise, bilanReprise, estTypeReprise, ISSUE_LABEL, type LigneReprise, REPRISES, RESTRICTION_A_RECOPIER, type TypeReprise } from '../../../shared/rules/reprise.ts';
import type { Certification, DemandeVisite, Employe, HabTitre, LotReprise, SoldeReprise } from '../../../shared/types.ts';
import { creerCompte } from '../comptes.ts';
import { rattacherFiches } from '../migrations/referentiels.ts';
import { ActionError, requireRhAdmin, str, type ActionHandler, type Ctx } from './context.ts';

/** Taille maximale du fichier importé (caractères) : quelques centaines de salariés tiennent largement. */
const TEXTE_MAX = 1_000_000;

/**
 * Écrit une ligne retenue ; renvoie l'identifiant du salarié, une remarque éventuelle (compte non créé…) et l'identifiant
 * du compte Microsoft 365 ouvert (journal).
 */
async function ecrire(ctx: Ctx, l: LigneReprise, o: { comptes: boolean }): Promise<{ empId: number; note?: string; compte?: string }> {
  const w = l.ecriture!;
  switch (w.type) {
    case 'salaries': {
      if (w.equipeACreer && !await ctx.db.get('equipes', w.equipeACreer)) {
        const ordre = Math.max(-1, ...(await ctx.db.all<{ ordre: number }>('equipes')).map(q => q.ordre)) + 1;
        await ctx.db.insert('equipes', { nom: w.equipeACreer, managerId: null, ordre });
      }
      let empId = l.empId;
      if (empId) await ctx.db.update('employes', empId, { ...w.profil });
      else {
        empId = (await ctx.db.insert<Employe>('employes', { ...w.profil })).id;
        // Compteurs à zéro, datés de la création (comme employe.creer) : l'import des soldes les remplace.
        await ctx.db.insert('soldesReprise', { empId, cpPris: 0, rttPris: 0, recupAcquis: 0, recupPris: 0, arreteLe: ctx.d.ti });
      }
      // Compte Microsoft 365 à partir de l'adresse de la fiche (case cochée) : un salarié présent qui n'en a pas encore.
      let note: string | undefined, compte: string | undefined;
      if (o.comptes && w.profil.email && !(w.profil.fin && w.profil.fin < ctx.d.ti) && !(await ctx.db.where('comptes', 'empId', empId)).length) {
        try {
          compte = (await creerCompte(ctx.db, { empId, type: 'microsoft', identifiant: w.profil.email }, ctx.user.nom)).compte.identifiant;
          note = 'compte Microsoft 365 créé';
        } catch (e) {
          note = `compte non créé : ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      return { empId, note, compte };
    }
    case 'soldes': {
      // Même date d'arrêté : seuls les compteurs de la ligne changent (l'analyse a fusionné ceux déjà repris) ; la
      // récupération n'est réécrite que si le fichier la porte. Autre date d'arrêté : la ligne est remplacée.
      const R = await ctx.db.get<SoldeReprise>('soldesReprise', l.empId!);
      const soldes = { arreteLe: w.arreteLe, cpSolde: w.cpSolde, cpSoldeSuivant: w.cpSoldeSuivant, rttSolde: w.rttSolde, cetSolde: w.cetSolde, heuresSupAnnee: w.heuresSupAnnee };
      const recup = (x: number) => ({ recupAcquis: Math.max(x, 0), recupPris: Math.max(-x, 0) });
      if (R && R.arreteLe === w.arreteLe) await ctx.db.update('soldesReprise', l.empId!, { ...soldes, ...(w.recup != null ? recup(w.recup) : {}) });
      else {
        const row: SoldeReprise = { empId: l.empId!, cpPris: 0, rttPris: 0, ...recup(w.recup ?? 0), ...soldes };
        if (R) await ctx.db.update('soldesReprise', l.empId!, row);
        else await ctx.db.insert('soldesReprise', row);
      }
      return { empId: l.empId! };
    }
    case 'certifications':
      await ctx.db.insert<Certification>('certifications', { empId: l.empId!, f: w.f, obtenue: w.date, sessionId: null, convoc: null });
      return { empId: l.empId! };
    case 'habilitations': {
      const entry = { delivree: w.date, par: w.par, demande: null, mesure: null, mesureDate: null, mesureMotif: null, mesurePar: null };
      if (w.titreId) await ctx.db.update<HabTitre>('habTitres', w.titreId, entry);
      else await ctx.db.insert<HabTitre>('habTitres', { empId: l.empId!, h: w.h, ...entry });
      return { empId: l.empId! };
    }
    case 'visites': {
      // Restrictions inconnues de l'ancien outil : mention provisoire, à remplacer par l'avis recopié sur la fiche.
      const restrictions = w.avis === 'restrictions' ? [{ texte: RESTRICTION_A_RECOPIER, jusquau: null }] : [];
      // Une autre visite : la prochaine visite fixée par le médecin à la précédente ne vaut plus (shared/rules/suivi-medical.ts).
      const nouvelle = ctx.ds.employes.find(e => e.id === l.empId)?.visite !== w.date;
      await ctx.db.update('employes', l.empId!, { visite: w.date, avis: w.avis, restrictions, ...(nouvelle ? { prochaineVisite: null } : {}) });
      // La visite clôt les demandes qu'elle honore (faites au plus tard le jour de la visite), comme medical.avis.
      for (const x of ctx.ds.demandesVisite.filter(x => x.empId === l.empId && x.statut === 'demandee' && x.le <= w.date)) await ctx.db.update<DemandeVisite>('demandesVisite', x.id, { statut: 'realisee', closeLe: w.date, closePar: ctx.user.nom });
      return { empId: l.empId! };
    }
  }
}

/**
 * Motif d'une ligne au compte rendu conservé : erreurs (refus), sinon avertissements, sinon ce qui a été écrit. Visites :
 * jamais l'avis ni ce qui le laisse deviner (restrictions, inaptitude) — donnée de santé, comme au journal ; une visite
 * écrite n'est rappelée que par sa date.
 */
const motifDe = (type: TypeReprise, l: LigneReprise, note?: string) => {
  if (type === 'visites' && l.issue !== 'refus') {
    return l.ecriture?.type === 'visites' ? `Visite du ${fmtIso(l.ecriture.date)} reprise` : l.avertissements.filter(x => !/apte|restriction/i.test(x)).join(' · ');
  }
  return [...(l.issue === 'refus' ? l.erreurs : [l.detail, ...l.avertissements]), note ?? ''].filter(Boolean).join(' · ');
};

/**
 * `reprise.importer` : type, texte (CSV), colonnes (champ de chaque colonne), dateReprise (soldes), equipes (rapprochement),
 * confirmations (lignes cochées dans l'aperçu), comptes (créer les comptes Microsoft 365), fichier (nom, pour le lot).
 */
const importer: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  if (!estTypeReprise(p.type)) throw new ActionError('Import inconnu');
  const type: TypeReprise = p.type;
  const texte = typeof p.texte === 'string' ? p.texte : '';
  if (texte.length > TEXTE_MAX) throw new ActionError('Fichier trop volumineux : découpez-le');
  const colonnes = Array.isArray(p.colonnes) ? p.colonnes.map((c: unknown) => (typeof c === 'string' ? c : null)) : [];
  const equipes = p.equipes && typeof p.equipes === 'object' && !Array.isArray(p.equipes)
    ? Object.fromEntries(Object.entries(p.equipes as Record<string, unknown>).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, String(v)])) : {};
  const confirmations = Array.isArray(p.confirmations) ? p.confirmations.map(Number).filter(Number.isInteger) : [];
  const dateReprise = type === 'soldes' ? str(p.dateReprise) : null;
  const comptes = type === 'salaries' && p.comptes === true;
  // Case cochée : fiches qui ont déjà un compte (une fiche à jour sans compte reste à écrire, pour lui en ouvrir un).
  const avecCompte = comptes ? (await ctx.db.all<{ empId: number | null }>('comptes')).map(c => c.empId).filter((x): x is number => x != null) : null;
  const soiMeme = ctx.user.role === 'rh' ? ctx.user.salarieId ?? null : null;
  const a = analyserReprise(ctx.d, type, texte, { colonnes, dateReprise, equipes, confirmations, avecCompte, soiMeme });
  if (a.bloquant) throw new ActionError(a.bloquant);
  const retenues = a.lignes.filter(l => l.ecriture);
  if (!retenues.length) {
    const b = bilanReprise(a.lignes);
    throw new ActionError(`Aucune ligne à importer : ${plural(b.ignorees, 'déjà à jour ou ignorée', 'déjà à jour ou ignorées')}, ${plural(b.refusees, 'refusée', 'refusées')} (voir l’aperçu)`);
  }
  const salaries = new Set<number>();
  const notes = new Map<number, string>();
  const ouverts: { empId: number; identifiant: string }[] = [];
  for (const l of retenues) {
    const r = await ecrire(ctx, l, { comptes });
    salaries.add(r.empId);
    if (r.note) notes.set(l.n, r.note);
    if (r.compte) ouverts.push({ empId: r.empId, identifiant: r.compte });
  }
  // Fiches créées sans poste du référentiel : rattachées tout de suite au poste de même intitulé (créé au besoin sans
  // exigence), dans la même transaction. Une fiche mise à jour garde son poste (`posteId` repris de la fiche).
  if (type === 'salaries') await rattacherFiches(ctx.db);
  const comptesCrees = ouverts.length;
  const b = bilanReprise(a.lignes);
  const fichier = str(p.fichier).slice(0, 200) || null;
  const lot = await ctx.db.insert<LotReprise>('reprises', {
    type, le: new Date().toISOString(), par: ctx.user.nom, dateReprise, fichier, colonnes,
    options: { comptes, equipes, entetes: a.entetes.slice(0, 60).map(h => h.slice(0, 80)) },
    lignes: a.lignes.length, ...b,
    rapport: a.lignes.map(l => ({ n: l.n, issue: ISSUE_LABEL[l.issue], nom: l.nom, motif: motifDe(type, l, notes.get(l.n)) })),
  });
  const libelle = REPRISES[type].court;
  const message = `Import des ${libelle} : ${[
    b.crees ? plural(b.crees, 'ajout', 'ajouts') : '', b.majs ? plural(b.majs, 'mise à jour', 'mises à jour') : '',
    b.ignorees ? plural(b.ignorees, 'ligne ignorée', 'lignes ignorées') : '', b.refusees ? plural(b.refusees, 'ligne refusée', 'lignes refusées') : '',
  ].filter(Boolean).join(', ')}${dateReprise ? ` · soldes au ${fmtIso(dateReprise)}` : ''}${comptesCrees ? ` · ${plural(comptesCrees, 'compte Microsoft 365 créé', 'comptes Microsoft 365 créés')}` : ''}`;
  return { message, result: { lot: lot.id, salaries: [...salaries], ...b, comptes: comptesCrees, comptesOuverts: ouverts } };
};

export const repriseActions: Record<string, ActionHandler> = {
  'reprise.importer': importer,
};
