// Formations suivies par salarié (t116, shared/rules/formations-suivies.ts) : saisie directe et correction (service RH,
// référent HSE), annulation d'une saisie erronée (administrateur RH), et bénéficiaires d'une action du plan réalisée
// (`plan.avancer`, server/src/actions/budget.ts). Une demande hors catalogue acceptée se clôt par une saisie qui la
// désigne (`demandeId`). Rien n'est supprimé : une ligne annulée garde sa date, son auteur et son motif, hors des calculs.
// Motifs (texte libre) gardés dans Cursus, jamais recopiés au journal (REGLES de server/src/journal.ts).
import { parse } from '../../../shared/dates.ts';
import { fmt, key, plural } from '../../../shared/format.ts';
import { erreurMotifCorrection } from '../../../shared/rules/corrections.ts';
import { present } from '../../../shared/rules/contrats.ts';
import { cleLigne, rappelDeclaration } from '../../../shared/rules/passeport-prevention.ts';
import { controlerSuivie, intituleSuivie, obligatoireParDefaut, suiviesEnVigueur, type SaisieSuivie } from '../../../shared/rules/formations-suivies.ts';
import type { Employe, FormationSuivie, OrigineFormationSuivie, PlanAction } from '../../../shared/types.ts';
import { auteurDe } from '../delivrances.ts';
import { ActionError, type ActionHandler, type Ctx, getEmp, refuserSoiMeme, requireFormations, requireRhAdmin, str } from './context.ts';
// lot 12 — C4 : organisme choisi dans le référentiel (fiche) ; le texte libre reste admis hors catalogue.
import { organismeChoisi } from './organismes.ts';

/**
 * lot 12 — C4 : `organismeId` reçu (vide : aucune fiche, texte libre) ; une fiche choisie donne son nom usuel au texte
 * `organisme`. Absent : rien ne change (`null` à la saisie).
 */
function organismeDeLaSaisie(ctx: Ctx, p: Record<string, any>, texte: string | null, avant: number | null = null): { organismeId: number | null; organisme: string | null } {
  if (p.organismeId === undefined) return { organismeId: avant, organisme: texte };
  const organismeId = organismeChoisi(ctx, p.organismeId, avant);
  const fiche = organismeId == null ? null : (ctx.ds.organismes ?? []).find(o => o.id === organismeId);
  return { organismeId, organisme: fiche ? fiche.nomUsuel : texte };
}

/** Saisie contrôlée (première erreur), ou refus. */
function valeurDe(ctx: Ctx, p: SaisieSuivie, avant: Pick<FormationSuivie, 'f'> | null = null) {
  const { erreurs, valeur } = controlerSuivie(ctx.d, p, avant);
  if (!valeur) throw new ActionError(Object.values(erreurs)[0] ?? 'Saisie invalide');
  return valeur;
}

/** Formation suivie en vigueur (non annulée), introuvable : 404. */
function suivieDe(ctx: Ctx, id: unknown): FormationSuivie {
  const x = suiviesEnVigueur(ctx.ds).find(s => s.id === Number(id));
  if (!x) throw new ActionError('Formation suivie introuvable ou déjà supprimée', 404);
  return x;
}

const enregistre = (ctx: Ctx) => auteurDe(ctx.user, ctx.d.ti);
/** Formation terminée avant l'entrée du salarié, ou commencée après sa sortie : pas une formation de l'entreprise. */
const horsEntreprise = (e: Employe, v: Pick<FormationSuivie, 'du' | 'au'>) => v.au < e.entree || !present(e, v.du);

/**
 * Saisie directe d'une formation suivie (service RH, référent HSE) ; `demandeId` : demande hors catalogue acceptée qu'elle
 * clôt (même salarié, une seule fois), dont l'intitulé est repris si aucun n'est saisi.
 */
const enregistrer: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const emp = getEmp(ctx, p.empId);
  let origine: OrigineFormationSuivie = 'saisie', demandeId: number | null = null;
  const saisie: SaisieSuivie = { ...p };
  if (p.demandeId != null && p.demandeId !== '') {
    const r = ctx.ds.demandesCollab.find(x => x.id === Number(p.demandeId));
    if (!r || r.empId !== emp.id || r.type !== 'formation' || r.statut !== 'acceptee') throw new ActionError('Demande de formation acceptée introuvable pour ce collaborateur');
    if (suiviesEnVigueur(ctx.ds, emp.id).some(x => x.demandeId === r.id)) throw new ActionError('Cette demande est déjà enregistrée comme formation suivie');
    origine = 'demande';
    demandeId = r.id;
    if (!str(p.f) && !str(p.libelle)) saisie.libelle = r.libelle ?? '';
  }
  const v = valeurDe(ctx, saisie);
  // Doublon : même formation (ou même intitulé hors catalogue) déjà enregistrée le même premier jour.
  const doublon = suiviesEnVigueur(ctx.ds, emp.id).find(x => x.du === v.du && (v.f ? x.f === v.f : !x.f && key(x.libelle) === key(v.libelle)));
  if (doublon) throw new ActionError(`${intituleSuivie(ctx.d, v)} du ${fmt(parse(v.du))} déjà enregistrée pour ${emp.nom}`);
  if (horsEntreprise(emp, v)) throw new ActionError(`${emp.nom} n’était pas dans l’entreprise à ces dates`);
  const planActionId = demandeId ? ctx.ds.demandesCollab.find(x => x.id === demandeId)?.suite?.planId ?? null : null;
  const x = await ctx.db.insert<FormationSuivie>('formationsSuivies', { empId: emp.id, ...v, ...organismeDeLaSaisie(ctx, p, v.organisme), origine, planActionId, demandeId, ...enregistre(ctx) });
  // Ligne du plan créée par l'acceptation, pas encore réalisée : signalée, à clore dans Plan & budget (coût réel).
  const ligne = planActionId ? ctx.ds.plan.find(l => l.id === planActionId && (l.statut === 'prevu' || l.statut === 'engage')) : null;
  const suite = ligne ? ` · ligne du plan ${ligne.exercice} à passer « réalisée » dans Plan & budget` : '';
  return { message: `${intituleSuivie(ctx.d, v)} — ${emp.nom} · formation suivie du ${fmt(parse(v.du))} enregistrée${v.obligatoire ? '' : ' (non obligatoire)'}${suite}`, result: { id: x.id } };
};

/** Correction d'une formation suivie saisie avec une erreur (service RH, référent HSE ; jamais la sienne), motif obligatoire. */
const modifier: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const avant = suivieDe(ctx, p.id);
  const emp = getEmp(ctx, avant.empId);
  refuserSoiMeme(ctx, emp, 'Correction de votre propre formation');
  // Champs absents : inchangés.
  const champ = <K extends keyof SaisieSuivie>(k: K, actuel: unknown) => (p[k] === undefined ? actuel : p[k]);
  const v = valeurDe(ctx, {
    f: champ('f', avant.f ?? ''), libelle: champ('libelle', avant.libelle ?? ''), du: champ('du', avant.du), au: champ('au', avant.au),
    duree: champ('duree', avant.duree ?? ''), organisme: champ('organisme', avant.organisme ?? ''), obligatoire: champ('obligatoire', avant.obligatoire),
  }, avant);
  // lot 12 — C4 : fiche de l'organisme (champ absent : inchangée).
  const lien = organismeDeLaSaisie(ctx, p, v.organisme, avant.organismeId ?? null);
  Object.assign(v, { organisme: lien.organisme });
  const change = (Object.keys(v) as (keyof typeof v)[]).some(k => v[k] !== avant[k]) || lien.organismeId !== (avant.organismeId ?? null);
  if (!change) return 'Aucune modification';
  const err = erreurMotifCorrection(p.motif);
  if (err) throw new ActionError(err);
  await ctx.db.update<FormationSuivie>('formationsSuivies', avant.id, { ...v, organismeId: lien.organismeId, corrigeLe: ctx.d.ti, corrigePar: ctx.user.nom, corrigeMotif: str(p.motif) });
  // Passeport de prévention (lot 7, t066) : une ligne déjà déclarée se corrige aussi sur la plateforme.
  const rappel = rappelDeclaration(ctx.ds, cleLigne({ suivieId: avant.id }));
  return `${intituleSuivie(ctx.d, v)} — ${emp.nom} · formation suivie corrigée${rappel ? ` · ${rappel}` : ''}`;
};

/** Annulation d'une formation suivie saisie par erreur (administrateur RH ; jamais la sienne), motif obligatoire. */
const annuler: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const x = suivieDe(ctx, p.id);
  const emp = getEmp(ctx, x.empId);
  refuserSoiMeme(ctx, emp, 'Suppression de votre propre formation');
  const err = erreurMotifCorrection(p.motif);
  if (err) throw new ActionError(err);
  await ctx.db.update<FormationSuivie>('formationsSuivies', x.id, { annuleLe: ctx.d.ti, annulePar: ctx.user.nom, annuleMotif: str(p.motif) });
  const rappel = rappelDeclaration(ctx.ds, cleLigne({ suivieId: x.id }));
  return `${intituleSuivie(ctx.d, x)} — ${emp.nom} · formation suivie supprimée (saisie erronée)${x.demandeId ? ' · la demande est de nouveau à clore' : ''}${rappel ? ` · ${rappel}` : ''}`;
};

/**
 * Bénéficiaires d'une action du plan clôturée « réalisée » (`plan.avancer`) : une formation suivie par salarié choisi,
 * membre présent de l'équipe de la ligne (ou demandeur d'une demande acceptée qui l'a créée), du `du` au `au` (pas à
 * venir). Une ligne réalisée par une session clôturée a déjà ses certifications : refus. Le demandeur d'une demande hors
 * catalogue rattachée à la ligne voit sa demande close. Contrôlé avant toute écriture ; l'écriture renvoie le texte du
 * message et les salariés dont une formation suivie a réellement été enregistrée (journal : `result.beneficiaires`).
 */
export function controlerBeneficiaires(ctx: Ctx, l: PlanAction, p: Record<string, any>): (() => Promise<{ texte: string; empIds: number[] }>) | null {
  if (p.beneficiaires == null) return null;
  if (!Array.isArray(p.beneficiaires)) throw new ActionError('Bénéficiaires : liste de collaborateurs attendue');
  const ids = [...new Set(p.beneficiaires.map(Number))];
  if (!ids.length) return null;
  if (ctx.ds.sessions.some(s => s.planId === l.id && s.statut === 'Clôturée')) {
    throw new ActionError('Action réalisée par une session clôturée : ses participants ont déjà leur certification');
  }
  const demandes = ctx.ds.demandesCollab.filter(r => r.type === 'formation' && r.statut === 'acceptee' && r.suite?.planId === l.id);
  const fm = l.f ? ctx.d.fm(l.f) : null;
  const v = valeurDe(ctx, { f: l.f ?? '', libelle: l.libelle ?? '', du: p.du, au: p.au, duree: p.duree ?? '', organisme: fm?.organisme ?? '', obligatoire: obligatoireParDefaut(fm) }, l.f ? { f: l.f } : null);
  const emps = ids.map(id => {
    const e = getEmp(ctx, id);
    if (e.equipe !== l.equipe && !demandes.some(r => r.empId === e.id)) throw new ActionError(`${e.nom} ne fait pas partie de l’équipe ${l.equipe}`);
    if (horsEntreprise(e, v)) throw new ActionError(`${e.nom} n’était pas dans l’entreprise le ${fmt(parse(v.du))}`);
    return e;
  });
  const deja = new Set(suiviesEnVigueur(ctx.ds).filter(x => x.planActionId === l.id).map(x => x.empId));
  return async () => {
    const nouveaux = emps.filter(e => !deja.has(e.id));
    for (const e of nouveaux) {
      await ctx.db.insert<FormationSuivie>('formationsSuivies', {
        empId: e.id, ...v, origine: 'plan', planActionId: l.id, demandeId: demandes.find(r => r.empId === e.id)?.id ?? null, ...enregistre(ctx),
      });
    }
    return {
      texte: nouveaux.length ? ` · ${plural(nouveaux.length, 'formation suivie enregistrée', 'formations suivies enregistrées')}` : '',
      empIds: nouveaux.map(e => e.id),
    };
  };
}

export const formationsSuiviesActions = {
  'formationSuivie.enregistrer': enregistrer,
  'formationSuivie.modifier': modifier,
  'formationSuivie.annuler': annuler,
} satisfies Record<string, ActionHandler>;
