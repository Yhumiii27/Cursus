// Déplacements, formalités (passeport, visas, vaccinations) et demandes Keystone.
import { SECU_RULES, VACCINS, secuDe } from '../../../shared/constants.ts';
import { isValidDate, parse } from '../../../shared/dates.ts';
import { fmt, plural } from '../../../shared/format.ts';
import { identifiantKeystone } from '../../../shared/rules/matricules.ts';
import { blocage, conflitsDates } from '../../../shared/rules/conflits.ts';
import { declarationLabel, estAuDossier, formaliteCle, lignesAuDossier, lireFormalite } from '../../../shared/rules/formalites.ts';
import { parseTrips, referenceDeplacement } from '../../../shared/rules/imports.ts';
import { refusArchive } from '../../../shared/rules/referentiels.ts';
import type { Declaration, DemandeCollab, DemandeKeystone, Employe, Vaccination, Visa, Voyage } from '../../../shared/types.ts';
import { sendToKeystone } from '../integrations/keystone.ts';
import { motifsRefusAcceptation } from '../integrations/keystone-entrant.ts';
import { ActionError, getEmp, isRh, isSelf, requireRh, str, type ActionHandler, type Ctx } from './context.ts';
import { deplacerPieces, joindrePieces } from './pieces.ts';

const creer: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.empId);
  const dest = ctx.d.destOf(str(p.dest));
  const motif = str(p.motif);
  if (!dest) throw new ActionError('Destination hors référentiel');
  if (dest.archive) throw new ActionError(refusArchive(dest, 'Destination')!);
  if (!isValidDate(p.depart) || !isValidDate(p.retour) || p.retour < p.depart || !motif) throw new ActionError('Dates et motif requis');
  // Déjà en déplacement ces jours-là, ou absent (congé validé, arrêt…) : refusé.
  const conflit = blocage(conflitsDates(ctx.d, emp.id, p.depart, p.retour, 'voyage'));
  if (conflit) throw new ActionError(conflit);
  const t = ctx.db.insert<Voyage>('voyages', { empId: emp.id, dest: dest.code, depart: p.depart, retour: p.retour, motif, origine: 'cursus', ref: null, chantier: null });
  const r = ctx.d.readiness(emp, t);
  return { message: `Déplacement créé — ${emp.nom}, ${dest.pays} · ${r.todo ? plural(r.todo, 'formalité à prévoir', 'formalités à prévoir') : 'dossier complet'}`, result: { id: t.id } };
};

/**
 * Formalités de détachement d'un déplacement, accomplies par le service RH : obtention du certificat de sécurité
 * sociale (A1, convention bilatérale ou maintien au régime français) et remise de l'information écrite d'une mission
 * de plus de 4 semaines. Seules les dates fournies changent ; une date vide efface une saisie erronée.
 */
const detachement: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const t = ctx.ds.voyages.find(v => v.id === Number(p.id));
  if (!t) throw new ActionError('Déplacement introuvable', 404);
  if (t.annuleLe) throw new ActionError('Déplacement annulé', 409);
  const emp = getEmp(ctx, t.empId), dest = ctx.d.destOf(t.dest);
  if (!dest) throw new ActionError('Destination hors référentiel');
  const champs = { detachementLe: SECU_RULES[secuDe(dest)].label, informationLe: 'Information écrite' };
  const patch: Partial<Pick<Voyage, 'detachementLe' | 'informationLe'>> = {};
  for (const [k, label] of Object.entries(champs) as [keyof typeof champs, string][]) {
    if (!(k in p)) continue;
    const v = str(p[k]);
    if (v && !isValidDate(v)) throw new ActionError(`${label} : date invalide`);
    if (v > ctx.d.ti) throw new ActionError(`${label} : la date ne peut pas être à venir`);
    patch[k] = v || null;
  }
  if (!Object.keys(patch).length) throw new ActionError('Aucune formalité à enregistrer');
  ctx.db.update<Voyage>('voyages', t.id, patch);
  const r = ctx.d.readiness(emp, { ...t, ...patch });
  return `Formalités de détachement enregistrées — ${emp.nom}, ${dest.pays} · ${r.todo ? plural(r.todo, 'formalité à prévoir', 'formalités à prévoir') : 'dossier complet'}`;
};

/** Écrit une formalité dans le dossier : elle remplace celle du même document (passeport, visa du pays, vaccin). */
export function appliquerFormalite(ctx: Ctx, emp: Employe, x: Declaration): string {
  if (x.kind === 'passeport') {
    ctx.db.update('employes', emp.id, { passeportNumero: x.numero, passeportExpire: x.expire });
    return `Passeport de ${emp.nom} enregistré — valide jusqu’au ${fmt(parse(x.expire))}`;
  }
  if (x.kind === 'visa') {
    const dest = ctx.d.destOf(x.dest)!;
    emp.visas.filter(v => v.dest === dest.code).forEach(v => ctx.db.remove('visas', v.id));
    ctx.db.insert<Visa>('visas', { empId: emp.id, dest: dest.code, type: x.type, obtenu: x.obtenu, expire: x.expire });
    return `${x.type} ${dest.pays} enregistré — ${emp.nom}`;
  }
  emp.vaccins.filter(v => v.v === x.v).forEach(v => ctx.db.remove('vaccinations', v.id));
  ctx.db.insert<Vaccination>('vaccinations', { empId: emp.id, v: x.v, date: x.date });
  return `Vaccination ${VACCINS[x.v].nom} enregistrée — ${emp.nom}`;
}

/** Retire du dossier une formalité déclarée avant la validation RH, si elle n'a pas changé depuis. */
export function retirerFormalite(ctx: Ctx, emp: Employe, x: Declaration): boolean {
  if (!estAuDossier(emp, x)) return false;
  if (x.kind === 'passeport') ctx.db.update('employes', emp.id, { passeportNumero: null, passeportExpire: null });
  else lignesAuDossier(emp, x).forEach(r => ctx.db.remove(x.kind === 'visa' ? 'visas' : 'vaccinations', r.id));
  return true;
}

const formalite: ActionHandler = (ctx, p) => {
  const emp = getEmp(ctx, p.empId);
  const collab = ctx.user.role === 'collaborateur';
  if (!(isRh(ctx) || (collab && isSelf(ctx, emp.id)))) throw new ActionError('Formalités gérées par le service RH', 403);
  const x = lireFormalite(ctx.d, p);
  if (typeof x === 'string') throw new ActionError(x);
  // Saisie du service RH : enregistrée tout de suite.
  if (!collab) return appliquerFormalite(ctx, emp, x);
  // Déclaration du collaborateur : gardée dans la demande, le dossier ne change qu'à la validation RH.
  // Une nouvelle déclaration du même document remplace celle encore en attente.
  const cle = formaliteCle(x);
  const remplacees = ctx.ds.demandesCollab.filter(r => r.empId === emp.id && r.type === 'document' && r.statut === 'attente'
    && r.declaration && !r.declaration.dejaAuDossier && formaliteCle(r.declaration) === cle);
  remplacees.forEach(r => ctx.db.remove('demandesCollab', r.id));
  const dem = ctx.db.insert<DemandeCollab>('demandesCollab', {
    empId: emp.id, type: 'document', f: null, h: null, libelle: null, label: declarationLabel(ctx.d, x), sessionId: null, motif: null,
    date: ctx.d.ti, statut: 'attente', reponse: null, parId: null, declaration: x,
  });
  // Pièces de la déclaration remplacée gardées avec la nouvelle, puis celles jointes à cet envoi (actions/pieces.ts).
  remplacees.forEach(r => deplacerPieces(ctx, 'declaration', r.id, dem.id));
  const pieces = joindrePieces(ctx, p.pieces, 'declaration', dem.id, emp.id);
  return (remplacees.length
    ? 'Déclaration mise à jour — elle remplace la précédente, en attente de validation par le service RH'
    : 'Déclaration transmise au service RH — votre dossier sera mis à jour après validation') + pieces;
};

const importer: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const rows = parseTrips(ctx.d, str(p.texte)).filter(r => r.ok);
  if (!rows.length) throw new ActionError('Aucune demande valide à importer');
  // Sans référence dans le fichier : `DD-<identifiant>` (comme le prototype), jamais une référence déjà prise, ni en base
  // ni par une autre ligne du même fichier (une ligne plus bas peut porter « DD-<prochain identifiant> »).
  const prises = new Set(ctx.ds.voyages.map(v => v.ref).filter((x): x is string => !!x));
  rows.forEach(r => { if (r.ref) prises.add(r.ref); });
  rows.forEach(r => {
    const t = ctx.db.insert<Voyage>('voyages', {
      empId: r.emp!.id, dest: r.dest!.code, depart: r.depart!, retour: r.retour!, motif: r.motif, origine: 'formulaire', ref: r.ref || null, chantier: null,
      demandeur: r.demandeur,
    });
    const ref = r.ref || referenceDeplacement(t.id, prises);
    if (!r.ref) ctx.db.update<Voyage>('voyages', t.id, { ref });
    prises.add(ref);
  });
  return `${plural(rows.length, 'demande importée', 'demandes importées')} depuis le formulaire de déplacement`;
};

/** Demande Keystone encore en attente de décision (une demande décidée est conservée, avec sa décision). */
function demandeEnAttente(ctx: Ctx, id: unknown): DemandeKeystone {
  const dm = ctx.ds.demandesKeystone.find(x => x.id === Number(id));
  if (!dm) throw new ActionError('Demande Keystone introuvable', 404);
  if (dm.statut !== 'attente') throw new ActionError(`Demande déjà ${dm.statut === 'acceptee' ? 'acceptée' : 'refusée'}${dm.decideur ? ` par ${dm.decideur}` : ''}`, 409);
  return dm;
}

const accepterKeystone: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const dm = demandeEnAttente(ctx, p.id);
  // Revalidation : affectation, chantier, destination ou effectifs ont pu changer depuis la réception.
  const motifs = motifsRefusAcceptation(ctx.db, dm, ctx.d.ti);
  if (motifs.length) throw new ActionError(`Acceptation impossible — ${motifs.join(' · ')}. Refusez la demande.`, 409);
  // Comme `voyage.creer` : déjà en déplacement ces jours-là (autre chantier), ou absent (congé validé, arrêt…).
  const conflit = blocage(conflitsDates(ctx.d, dm.empId, dm.depart, dm.retour, 'voyage'));
  if (conflit) throw new ActionError(`Acceptation impossible — ${conflit}. Refusez la demande.`, 409);
  const emp = getEmp(ctx, dm.empId), c = ctx.d.chantier(dm.chantier)!;
  // Le déplacement porte le chantier et la référence Keystone ; le salarié y est rattaché par son affectation.
  const t = ctx.db.insert<Voyage>('voyages', {
    empId: dm.empId, dest: dm.dest, depart: dm.depart, retour: dm.retour, motif: `${c.nom} — ${c.lieu}`,
    origine: 'keystone', ref: dm.ref, chantier: dm.chantier,
  });
  ctx.db.update<DemandeKeystone>('demandesKeystone', dm.id, { statut: 'acceptee', decidee: ctx.d.ti, decideur: ctx.user.nom, voyageId: t.id });
  sendToKeystone(ctx.db, { type: 'demande.decision', demande: dm.id, reference: dm.ref, matricule: identifiantKeystone(ctx.ds.settings.identifiantKeystone, emp), chantier: dm.chantier, decision: 'acceptee', date: ctx.d.ti });
  return { message: `Déplacement créé pour ${emp.nom} — chantier ${dm.chantier} · statut renvoyé à Keystone`, result: { id: t.id } };
};

const refuserKeystone: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const dm = demandeEnAttente(ctx, p.id);
  const c = ctx.d.chantier(dm.chantier);
  // Motif du refus : conservé dans Cursus (demande, et message de l'action, lu dans le journal par le service RH),
  // jamais envoyé à Keystone (texte libre).
  const motif = str(p.motif);
  if (motif.length > 500) throw new ActionError('Motif trop long (500 caractères au plus)');
  ctx.db.update<DemandeKeystone>('demandesKeystone', dm.id, { statut: 'refusee', decidee: ctx.d.ti, decideur: ctx.user.nom, motifRefus: motif || null });
  sendToKeystone(ctx.db, { type: 'demande.decision', demande: dm.id, reference: dm.ref, matricule: identifiantKeystone(ctx.ds.settings.identifiantKeystone, ctx.d.emp(dm.empId) ?? { id: dm.empId }), chantier: dm.chantier, decision: 'refusee', date: ctx.d.ti });
  return `Demande refusée — ${ctx.d.personName(dm.empId)} · ${c ? c.chef || 'le chef de projet' : 'le chef de projet'} notifié dans Keystone${motif ? ` · motif : ${motif}` : ''}`;
};

export const voyagesActions = {
  'voyage.creer': creer,
  'voyage.detachement': detachement,
  'formalite.enregistrer': formalite,
  'voyages.importer': importer,
  'keystone.accepter': accepterKeystone,
  'keystone.refuser': refuserKeystone,
} satisfies Record<string, ActionHandler>;
