// Modules d'e-learning et inscriptions des salariés (lot 12, chantier C4, t190 ; règles : shared/rules/elearning.ts). Pas de
// plateforme embarquée, ni SCORM ni xAPI : un lien d'accès, un suivi déclaré ou importé, une fin validée par le service RH.
//   elearning.module.enregistrer  id (modification) ou création : droit « formations »
//   elearning.module.archiver     id, archive (false : rétablir) : droit « formations » ; les inscriptions ouvertes continuent
//   elearning.inscrire            moduleId, empIds (ou empId) ou planActionId (membres présents de l'équipe de la ligne),
//                                 echeance : droit « formations » ; un salarié déjà inscrit (ouverte) est passé
//   elearning.declarer            id : le salarié lui-même, « J'ai terminé » (fin déclarée, en ligne ; jamais un pourcentage)
//   elearning.importer            texte (CSV), apercu : droit « formations » ; colonnes fermées (matricule ou e-mail, module,
//                                 statut, avancement, date de fin, réussite), lignes valides appliquées, rapport par ligne
//   elearning.terminer            id, de, termineLe, heures, reussi : service RH ; formation suivie d'origine « elearning » et,
//                                 module rattaché au catalogue et réussi, certification par le circuit existant (`cert.ajouter`)
//   elearning.abandonner          id, de : droit « formations »
//   elearning.corriger            id, motif, echeance, avancement, planActionId : droit « formations », inscription ouverte
//   elearning.annuler             id, motif : administrateur RH, inscription saisie par erreur (sans formation suivie ni
//                                 certification encore en vigueur)
// Le journal ne garde jamais l'URL d'un module, un avancement nominatif ni un motif (REGLES de server/src/journal.ts).
import { isValidDate } from '../../../shared/dates.ts';
import { fmtIso, plural } from '../../../shared/format.ts';
import { erreurMotifCorrection } from '../../../shared/rules/corrections.ts';
import { present } from '../../../shared/rules/contrats.ts';
import {
  avancementDe, controlerModule, effetImport, finAutomatique, heuresRetenues, inscriptionOuverte, inscriptionOuverteDe, lireImportElearning, reussiteDe,
  STATUT_INSCRIPTION_LABEL,
} from '../../../shared/rules/elearning.ts';
import { dureeValide } from '../../../shared/rules/heures-formation.ts';
import { obligatoireParDefaut } from '../../../shared/rules/formations-suivies.ts';
import { organismeFinal } from '../../../shared/rules/organismes.ts';
import type { Employe, FormationSuivie, ISODate } from '../../../shared/types.ts';
import type { InscriptionElearning, ModuleElearning } from '../../../shared/types-organismes.ts';
import { auteurDe } from '../delivrances.ts';
import { conformiteActions } from './conformite.ts';
import {
  ActionError, type ActionHandler, type Ctx, estSoiMeme, getEmp, refuserSoiMeme, requireFormations, requireRh, requireRhAdmin, REVIENT_RH, str,
} from './context.ts';
import { organismeChoisi } from './organismes.ts';

/** Saisie refusée : la première erreur du contrôle partagé avec le dialogue. */
function refuser(erreurs: Partial<Record<string, string>>): never {
  throw new ActionError(Object.values(erreurs).find(Boolean) ?? 'Saisie invalide');
}

function moduleDe(ctx: Ctx, id: unknown): ModuleElearning {
  const m = (ctx.ds.modulesElearning ?? []).find(x => x.id === Number(id));
  if (!m) throw new ActionError('Module d’e-learning introuvable', 404);
  return m;
}

/** Inscription en vigueur (non annulée), introuvable : 404. */
function inscriptionDe(ctx: Ctx, id: unknown): InscriptionElearning {
  const i = (ctx.ds.inscriptionsElearning ?? []).find(x => x.id === Number(id));
  if (!i || i.annuleLe) throw new ActionError('Inscription introuvable ou annulée', 404);
  return i;
}

const nomInscription = (ctx: Ctx, i: InscriptionElearning) => `${moduleDe(ctx, i.moduleId).code} — ${ctx.d.emp(i.empId)?.nom ?? `salarié n° ${i.empId}`}`;

/**
 * Transition depuis une inscription ouverte : déjà dans l'état visé (double clic) → message ; statut affiché périmé (`de`)
 * ou inscription close → refus ; sinon null.
 */
function transition(ctx: Ctx, i: InscriptionElearning, vise: InscriptionElearning['statut'], de: unknown): string | null {
  if (i.statut === vise) return `${nomInscription(ctx, i)} · déjà ${STATUT_INSCRIPTION_LABEL[vise].toLowerCase()}`;
  if (de != null && de !== '' && de !== i.statut) throw new ActionError(`${nomInscription(ctx, i)} : l’inscription est désormais « ${STATUT_INSCRIPTION_LABEL[i.statut]} », rechargez`, 409);
  if (!inscriptionOuverte(i)) throw new ActionError(`${nomInscription(ctx, i)} : inscription ${STATUT_INSCRIPTION_LABEL[i.statut].toLowerCase()}, elle ne change plus`);
  return null;
}

/** Date facultative (vide : null) ; jamais avant `apres`. */
function dateDe(v: unknown, libelle: string, apres?: ISODate): ISODate | null {
  const t = str(v);
  if (!t) return null;
  if (!isValidDate(t)) throw new ActionError(`${libelle} : date invalide`);
  if (apres && t < apres) throw new ActionError(`${libelle} : la date précède l’inscription (${fmtIso(apres)})`);
  return t;
}

// — Modules —

const enregistrerModule: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const liste = ctx.ds.modulesElearning ?? [];
  const avant = p.id != null && p.id !== '' ? moduleDe(ctx, p.id) : null;
  // Organisme suivi jusqu'à la fiche qui l'a absorbé ; un organisme archivé n'est accepté que s'il est déjà celui du module.
  const saisie = { ...p, ...(p.organismeId !== undefined ? { organismeId: organismeChoisi(ctx, p.organismeId, avant?.organismeId) } : {}) };
  const { erreurs, valeur } = controlerModule(saisie, liste, ctx.ds.referentiels.formations, ctx.ds.organismes ?? [], avant);
  if (!valeur) refuser(erreurs);
  if (!avant) {
    const m = await ctx.db.insert<ModuleElearning>('modulesElearning', { ...valeur, archive: null, creeLe: new Date().toISOString(), creePar: ctx.user.nom });
    return { message: `Module d’e-learning ${m.code} ajouté — ${m.intitule}`, result: { id: m.id } };
  }
  await ctx.db.update<ModuleElearning>('modulesElearning', avant.id, valeur);
  return { message: `Module d’e-learning ${avant.code} modifié`, result: { id: avant.id } };
};

const archiverModule: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const m = moduleDe(ctx, p.id);
  if (p.archive === false) {
    if (!m.archive) return `Module ${m.code} déjà proposé`;
    await ctx.db.update<ModuleElearning>('modulesElearning', m.id, { archive: null });
    return `Module ${m.code} rétabli`;
  }
  if (m.archive) return `Module ${m.code} déjà archivé`;
  await ctx.db.update<ModuleElearning>('modulesElearning', m.id, { archive: ctx.d.ti });
  const ouvertes = (ctx.ds.inscriptionsElearning ?? []).filter(i => i.moduleId === m.id && inscriptionOuverte(i)).length;
  return `Module ${m.code} archivé — plus proposé${ouvertes ? ` ; ${plural(ouvertes, 'inscription ouverte continue', 'inscriptions ouvertes continuent')}` : ''}`;
};

// — Inscriptions —

/**
 * Inscription d'un ou plusieurs salariés (présents) à un module en vigueur : individuelle (`empId`, `empIds`) ou depuis une
 * ligne du plan (`planActionId` : les membres présents de son équipe, sauf `empIds` donnés). Un salarié déjà inscrit au
 * module (inscription ouverte) est passé.
 */
const inscrire: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const m = moduleDe(ctx, p.moduleId);
  if (m.archive) throw new ActionError(`Module ${m.code} archivé : rétablissez-le avant d’y inscrire`);
  const ligne = p.planActionId != null && p.planActionId !== '' ? ctx.ds.plan.find(l => l.id === Number(p.planActionId)) : null;
  if (p.planActionId != null && p.planActionId !== '' && !ligne) throw new ActionError('Action du plan introuvable ou supprimée', 404);
  const echeance = dateDe(p.echeance, 'Échéance', ctx.d.ti);
  const ids = Array.isArray(p.empIds) ? p.empIds.map(Number) : p.empId != null && p.empId !== '' ? [Number(p.empId)]
    : ligne ? ctx.ds.employes.filter(e => e.equipe === ligne.equipe && present(e, ctx.d.ti)).map(e => e.id) : [];
  if (!ids.length) throw new ActionError('Choisissez au moins un salarié');
  const emps: Employe[] = [...new Set(ids)].map(id => {
    const e = getEmp(ctx, id);
    if (!present(e, ctx.d.ti)) throw new ActionError(`${e.nom} a quitté l’entreprise`);
    return e;
  });
  const nouveaux = emps.filter(e => !inscriptionOuverteDe(ctx.ds.inscriptionsElearning, e.id, m.id));
  const ins: number[] = [];
  for (const e of nouveaux) {
    ins.push((await ctx.db.insert<InscriptionElearning>('inscriptionsElearning', {
      empId: e.id, moduleId: m.id, planActionId: ligne?.id ?? null, inscritLe: ctx.d.ti, inscritPar: ctx.user.nom, echeance, statut: 'inscrit',
      avancement: null, avancementSource: null, avancementLe: null, declareLe: null, termineLe: null, heures: null, reussi: null, certId: null, suivieId: null,
      abandonLe: null, corrigeLe: null, corrigePar: null, corrigeMotif: null, annuleLe: null, annulePar: null, annuleMotif: null,
    })).id);
  }
  const deja = emps.length - nouveaux.length;
  return {
    message: `Module ${m.code} : ${plural(nouveaux.length, 'salarié inscrit', 'salariés inscrits')}${deja ? ` · ${plural(deja, 'déjà inscrit', 'déjà inscrits')}` : ''}`,
    result: { module: m.id, inscriptions: ins, empIds: nouveaux.map(e => e.id) },
  };
};

/** « J'ai terminé » : le salarié déclare la fin de sa propre inscription ; la fin reste à valider par le service RH. */
const declarer: ActionHandler = async (ctx, p) => {
  const i = inscriptionDe(ctx, p.id);
  if (![ctx.user.empId, ctx.user.salarieId].includes(i.empId)) throw new ActionError('Seul le salarié inscrit déclare la fin de son module', 403);
  if (i.declareLe) return `${moduleDe(ctx, i.moduleId).code} · fin déjà déclarée le ${fmtIso(i.declareLe)}`;
  if (!inscriptionOuverte(i)) throw new ActionError(`Inscription ${STATUT_INSCRIPTION_LABEL[i.statut].toLowerCase()} : rien à déclarer`);
  await ctx.db.update<InscriptionElearning>('inscriptionsElearning', i.id, { declareLe: ctx.d.ti, ...(i.statut === 'inscrit' ? { statut: 'en_cours' } : {}) });
  return { message: `${moduleDe(ctx, i.moduleId).intitule} — fin déclarée ; le service RH la valide`, result: { id: i.id } };
};

/**
 * Fin validée par le service RH (jamais la sienne) : statut « terminé », date, heures retenues (saisies, sinon la durée du
 * module), réussite ; formation suivie d'origine « elearning » ; module rattaché au catalogue et réussi : certification par
 * `cert.ajouter` (pièces, liste d'attente, recyclage), que `suivieCertifiee` compte une seule fois avec la formation suivie.
 * Une attestation exigée se joint à la certification ou à la formation suivie (pièces justificatives).
 */
export async function terminerInscription(ctx: Ctx, i: InscriptionElearning, v: { termineLe: ISODate; heures: number | null; reussi: boolean | null }): Promise<string> {
  const m = moduleDe(ctx, i.moduleId);
  const emp = getEmp(ctx, i.empId);
  const fm = m.formation ? ctx.d.fm(m.formation) : null;
  const organisme = organismeFinal(ctx.ds.organismes, m.organismeId);
  const heures = v.heures ?? heuresRetenues(i, m);
  const suivie = await ctx.db.insert<FormationSuivie>('formationsSuivies', {
    empId: emp.id, f: fm ? fm.id : null, libelle: fm ? null : m.intitule, du: i.inscritLe <= v.termineLe ? i.inscritLe : v.termineLe, au: v.termineLe, duree: heures,
    organisme: organisme?.nomUsuel ?? null, organismeId: organisme?.id ?? null, obligatoire: obligatoireParDefaut(fm), origine: 'elearning', planActionId: i.planActionId,
    demandeId: null, ...auteurDe(ctx.user, ctx.d.ti),
  });
  let certId: number | null = null, suite = '';
  if (fm && v.reussi !== false) {
    if (fm.archive) suite = ` · formation ${fm.court} archivée : certification à saisir`;
    else {
      const msg = await conformiteActions['cert.ajouter'](ctx, { empId: emp.id, f: fm.id, date: v.termineLe });
      certId = Number((await ctx.db.one<{ id: number }>('SELECT id FROM certifications WHERE emp_id = ? AND f = ? AND obtenue = ? ORDER BY id DESC LIMIT 1', [emp.id, fm.id, v.termineLe]))?.id) || null;
      suite = ` · ${typeof msg === 'string' ? msg : msg?.message ?? ''}`;
    }
  }
  await ctx.db.update<InscriptionElearning>('inscriptionsElearning', i.id, {
    statut: 'termine', termineLe: v.termineLe, heures, reussi: v.reussi, suivieId: suivie.id, certId,
    ...(i.avancement !== 100 ? { avancement: 100, avancementSource: i.avancementSource ?? 'rh', avancementLe: v.termineLe } : {}),
  });
  return `${m.code} terminé — ${emp.nom} · formation suivie enregistrée${heures != null ? ` (${String(heures).replace('.', ',')} h)` : ''}${suite}`;
}

const terminer: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const i = inscriptionDe(ctx, p.id);
  const deja = transition(ctx, i, 'termine', p.de);
  if (deja) return deja;
  const emp = getEmp(ctx, i.empId);
  refuserSoiMeme(ctx, emp, 'Vous ne validez pas la fin de votre propre module', REVIENT_RH);
  const termineLe = dateDe(p.termineLe, 'Date de fin', i.inscritLe) ?? ctx.d.ti;
  if (termineLe > ctx.d.ti) throw new ActionError('Date de fin : la date ne peut pas être dans le futur');
  const h = str(String(p.heures ?? '')).replace(',', '.');
  const heures = h === '' ? null : Number(h);
  if (heures !== null && !dureeValide(heures)) throw new ActionError('Heures retenues : nombre de 0,25 à 2 000');
  const reussi = reussiteDe(p.reussi === undefined ? i.reussi : p.reussi);
  if (reussi === undefined) throw new ActionError('Réussite : oui, non ou sans objet');
  return { message: await terminerInscription(ctx, i, { termineLe, heures, reussi }), result: { id: i.id } };
};

const abandonner: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const i = inscriptionDe(ctx, p.id);
  const deja = transition(ctx, i, 'abandonne', p.de);
  if (deja) return deja;
  await ctx.db.update<InscriptionElearning>('inscriptionsElearning', i.id, { statut: 'abandonne', abandonLe: ctx.d.ti });
  return { message: `${nomInscription(ctx, i)} · inscription abandonnée`, result: { id: i.id } };
};

/** Correction d'une inscription ouverte (échéance, avancement saisi par le service RH, ligne du plan), motivée. */
const corriger: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const i = inscriptionDe(ctx, p.id);
  if (!inscriptionOuverte(i)) throw new ActionError(`${nomInscription(ctx, i)} : inscription ${STATUT_INSCRIPTION_LABEL[i.statut].toLowerCase()} — corrigez la formation suivie ou la certification produite`);
  const maj: Partial<InscriptionElearning> = {};
  if (p.echeance !== undefined) maj.echeance = dateDe(p.echeance, 'Échéance', i.inscritLe);
  if (p.avancement !== undefined) {
    const a = avancementDe(p.avancement);
    if (Number.isNaN(a)) throw new ActionError('Avancement : nombre de 0 à 100');
    Object.assign(maj, { avancement: a, avancementSource: a === null ? null : 'rh', avancementLe: a === null ? null : ctx.d.ti, ...(a && i.statut === 'inscrit' ? { statut: 'en_cours' } : {}) });
  }
  if (p.planActionId !== undefined) {
    const id = p.planActionId === null || p.planActionId === '' ? null : Number(p.planActionId);
    if (id !== null && !ctx.ds.plan.some(l => l.id === id)) throw new ActionError('Action du plan introuvable ou supprimée', 404);
    maj.planActionId = id;
  }
  const change = (Object.keys(maj) as (keyof InscriptionElearning)[]).some(k => maj[k] !== i[k]);
  if (!change) return 'Aucune modification';
  const err = erreurMotifCorrection(p.motif);
  if (err) throw new ActionError(err);
  await ctx.db.update<InscriptionElearning>('inscriptionsElearning', i.id, { ...maj, corrigeLe: ctx.d.ti, corrigePar: ctx.user.nom, corrigeMotif: str(p.motif) });
  return { message: `${nomInscription(ctx, i)} · inscription corrigée`, result: { id: i.id } };
};

/** Annulation d'une inscription saisie par erreur (administrateur RH), sans formation suivie ni certification en vigueur. */
const annuler: ActionHandler = async (ctx, p) => {
  requireRhAdmin(ctx);
  const i = inscriptionDe(ctx, p.id);
  const suivie = i.suivieId ? (ctx.ds.formationsSuivies ?? []).find(x => x.id === i.suivieId && !x.annuleLe) : null;
  const cert = i.certId ? ctx.d.emp(i.empId)?.certs.find(c => c.id === i.certId) : null;
  if (suivie || cert) throw new ActionError(`${nomInscription(ctx, i)} : supprimez d’abord la ${suivie ? 'formation suivie' : 'certification'} produite par la fin du module`);
  const err = erreurMotifCorrection(p.motif);
  if (err) throw new ActionError(err);
  await ctx.db.update<InscriptionElearning>('inscriptionsElearning', i.id, { annuleLe: ctx.d.ti, annulePar: ctx.user.nom, annuleMotif: str(p.motif) });
  return { message: `${nomInscription(ctx, i)} · inscription supprimée (saisie erronée)`, result: { id: i.id } };
};

// — Import d'avancement —

/**
 * Import d'un fichier d'avancement (CSV exporté de la plateforme) : `apercu` vrai, rien n'est écrit ; sinon les lignes
 * valides sont appliquées (une valeur identique ne change rien) et les autres rapportées. Fin automatique seulement si le
 * réglage l'admet et que le module n'exige pas d'attestation ; sinon la fin attend la validation du service RH.
 */
const importer: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  const texte = typeof p.texte === 'string' ? p.texte : '';
  if (texte.length > 2_000_000) throw new ActionError('Fichier trop volumineux (2 Mo au plus)');
  const lu = lireImportElearning(texte, ctx.ds, ctx.d.ti);
  if ('refus' in lu) throw new ActionError(lu.refus);
  const apercu = p.apercu === true;
  // Fins d'office comptées aussi à l'aperçu (rien n'y est écrit) : le service RH les voit avant de confirmer l'import.
  const auto = !!ctx.ds.settings.elearningFinAutoImport;
  let modifiees = 0, inchangees = 0, terminees = 0;
  const erreurs = lu.lignes.filter(l => l.errs.length).map(l => ({ n: l.n, erreurs: l.errs }));
  // État courant de chaque inscription : deux lignes du fichier sur la même inscription s'appliquent l'une après l'autre.
  const etat = new Map<number, InscriptionElearning>();
  for (const l of lu.lignes.filter(x => !x.errs.length)) {
    const i = etat.get(l.inscriptionId!) ?? inscriptionDe(ctx, l.inscriptionId);
    const maj = inscriptionOuverte(i) ? effetImport(l, i, ctx.d.ti) : null;
    // Fin d'office : réglage, module sans attestation, « terminé » et « réussi » ; jamais sa propre inscription.
    const fin = auto && inscriptionOuverte(i) && finAutomatique(true, moduleDe(ctx, i.moduleId), l) && !estSoiMeme(ctx, i.empId);
    if (!maj && !fin) { inchangees++; continue; }
    modifiees++;
    const apres = { ...i, ...maj };
    if (!apercu && maj) await ctx.db.update<InscriptionElearning>('inscriptionsElearning', i.id, maj);
    if (fin) {
      if (!apercu) await terminerInscription(ctx, apres, { termineLe: l.dateFin ?? ctx.d.ti, heures: null, reussi: true });
      apres.statut = 'termine';
      terminees++;
    }
    etat.set(i.id, apres);
  }
  const resume = `${plural(lu.lignes.length, 'ligne lue', 'lignes lues')} : ${plural(modifiees, 'inscription mise à jour', 'inscriptions mises à jour')}`
    + `${inchangees ? `, ${plural(inchangees, 'inchangée', 'inchangées')}` : ''}${terminees ? `, ${plural(terminees, 'fin validée', 'fins validées')} d’office` : ''}`
    + `${erreurs.length ? `, ${plural(erreurs.length, 'ligne en erreur', 'lignes en erreur')}` : ''}`;
  return { message: apercu ? `Aperçu — ${resume} (rien n’est enregistré)` : resume, result: { lignes: lu.lignes.length, modifiees, inchangees, terminees, erreurs, apercu } };
};

export const elearningActions = {
  'elearning.module.enregistrer': enregistrerModule,
  'elearning.module.archiver': archiverModule,
  'elearning.inscrire': inscrire,
  'elearning.declarer': declarer,
  'elearning.importer': importer,
  'elearning.terminer': terminer,
  'elearning.abandonner': abandonner,
  'elearning.corriger': corriger,
  'elearning.annuler': annuler,
} satisfies Record<string, ActionHandler>;
