// Déplacements, formalités (passeport, visas, vaccinations) et demandes Keystone.
import { VACCINS, VISA_RULES } from '../../../shared/constants.ts';
import { isValidDate, parse } from '../../../shared/dates.ts';
import { fmt, matricule, plural } from '../../../shared/format.ts';
import { parseTrips } from '../../../shared/rules/imports.ts';
import type { DemandeCollab, Vaccination, VaccinId, Visa, Voyage } from '../../../shared/types.ts';
import { sendToKeystone } from '../integrations/keystone.ts';
import { ActionError, getEmp, isRh, isSelf, requireRh, str, type ActionHandler } from './context.ts';

const creer: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.empId);
  const dest = ctx.d.destOf(str(p.dest));
  const motif = str(p.motif);
  if (!dest) throw new ActionError('Destination hors référentiel');
  if (!isValidDate(p.depart) || !isValidDate(p.retour) || p.retour < p.depart || !motif) throw new ActionError('Dates et motif requis');
  const t = ctx.db.insert<Voyage>('voyages', { empId: emp.id, dest: dest.code, depart: p.depart, retour: p.retour, motif, origine: 'cursus', ref: null, chantier: null });
  const r = ctx.d.readiness(emp, t);
  return { message: `Déplacement créé — ${emp.nom}, ${dest.pays} · ${r.todo ? plural(r.todo, 'formalité à prévoir', 'formalités à prévoir') : 'dossier complet'}`, result: { id: t.id } };
};

const formalite: ActionHandler = (ctx, p) => {
  const emp = getEmp(ctx, p.empId);
  const collab = ctx.user.role === 'collaborateur';
  if (!(isRh(ctx) || (collab && isSelf(ctx, emp.id)))) throw new ActionError('Formalités gérées par le service RH', 403);
  let msg: string, label: string;
  if (p.kind === 'passeport') {
    const numero = str(p.numero);
    if (!numero || !isValidDate(p.expire)) throw new ActionError('Numéro et date d’expiration requis');
    ctx.db.update('employes', emp.id, { passeportNumero: numero, passeportExpire: p.expire });
    msg = `Passeport de ${emp.nom} enregistré — valide jusqu’au ${fmt(parse(p.expire))}`;
    label = 'Passeport mis à jour';
  } else if (p.kind === 'visa') {
    const dest = ctx.d.destOf(str(p.dest));
    if (!dest || !isValidDate(p.expire)) throw new ActionError('Pays et date de validité requis');
    const type = str(p.visaType) || VISA_RULES[dest.visa].label;
    emp.visas.filter(v => v.dest === dest.code).forEach(v => ctx.db.remove('visas', v.id));
    ctx.db.insert<Visa>('visas', { empId: emp.id, dest: dest.code, type, obtenu: isValidDate(p.obtenu) ? p.obtenu : null, expire: p.expire });
    msg = `${type} ${dest.pays} enregistré — ${emp.nom}`;
    label = `Visa ${dest.pays} déclaré`;
  } else if (p.kind === 'vaccin') {
    const v = str(p.v) as VaccinId;
    if (!VACCINS[v] || !isValidDate(p.date)) throw new ActionError('Vaccin et date d’injection requis');
    emp.vaccins.filter(x => x.v === v).forEach(x => ctx.db.remove('vaccinations', x.id));
    ctx.db.insert<Vaccination>('vaccinations', { empId: emp.id, v, date: p.date });
    msg = `Vaccination ${VACCINS[v].nom} enregistrée — ${emp.nom}`;
    label = `Vaccination ${VACCINS[v].nom.replace(/ \(.*\)/, '')} déclarée`;
  } else throw new ActionError('Type de formalité inconnu');
  if (collab) {
    ctx.db.insert<DemandeCollab>('demandesCollab', { empId: emp.id, type: 'document', f: null, h: null, libelle: null, label, sessionId: null, motif: null, date: ctx.d.ti, statut: 'attente', reponse: null, parId: null });
    return 'Information enregistrée — transmise au service RH pour contrôle';
  }
  return msg;
};

const importer: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const rows = parseTrips(ctx.d, str(p.texte)).filter(r => r.ok);
  if (!rows.length) throw new ActionError('Aucune demande valide à importer');
  rows.forEach(r => ctx.db.insert<Voyage>('voyages', {
    empId: r.emp!.id, dest: r.dest!.code, depart: r.depart!, retour: r.retour!, motif: r.motif, origine: 'formulaire', ref: r.ref || null, chantier: null,
  }));
  return `${plural(rows.length, 'demande importée', 'demandes importées')} depuis le formulaire de déplacement`;
};

const accepterKeystone: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const dm = ctx.ds.demandesKeystone.find(x => x.id === Number(p.id));
  if (!dm) throw new ActionError('Demande Keystone introuvable');
  const emp = getEmp(ctx, dm.empId), c = ctx.d.chantier(dm.chantier);
  const t = ctx.db.insert<Voyage>('voyages', {
    empId: dm.empId, dest: dm.dest, depart: dm.depart, retour: dm.retour, motif: c ? `${c.nom} — ${c.lieu}` : `Chantier ${dm.chantier}`,
    origine: 'keystone', ref: null, chantier: dm.chantier,
  });
  ctx.db.remove('demandesKeystone', dm.id);
  sendToKeystone(ctx.db, { type: 'demande.decision', demandeId: dm.id, matricule: matricule(emp.id), chantier: dm.chantier, decision: 'acceptee' });
  return { message: `Déplacement créé pour ${emp.nom} — chantier ${dm.chantier} · statut renvoyé à Keystone`, result: { id: t.id } };
};

const refuserKeystone: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const dm = ctx.ds.demandesKeystone.find(x => x.id === Number(p.id));
  if (!dm) throw new ActionError('Demande Keystone introuvable');
  const emp = getEmp(ctx, dm.empId), c = ctx.d.chantier(dm.chantier);
  ctx.db.remove('demandesKeystone', dm.id);
  sendToKeystone(ctx.db, { type: 'demande.decision', demandeId: dm.id, matricule: matricule(emp.id), chantier: dm.chantier, decision: 'refusee' });
  return `Demande refusée — ${emp.nom} · ${c ? c.chef : 'le chef de projet'} notifié dans Keystone`;
};

export const voyagesActions: Record<string, ActionHandler> = {
  'voyage.creer': creer,
  'formalite.enregistrer': formalite,
  'voyages.importer': importer,
  'keystone.accepter': accepterKeystone,
  'keystone.refuser': refuserKeystone,
};
