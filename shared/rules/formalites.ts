// Formalités de voyage (passeport, visa, vaccination) : contrôle de la saisie, libellés
// et comparaison avec le dossier. Une déclaration du collaborateur attend la validation RH.
import { VACCINS, VISA_RULES } from '../constants.ts';
import { isValidDate } from '../dates.ts';
import { fmtIso } from '../format.ts';
import type { Domain } from '../domain.ts';
import type { Declaration, Employe, VaccinId } from '../types.ts';

const txt = (v: unknown) => typeof v === 'string' ? v.trim() : '';

/** Contrôle et normalise une formalité saisie ; renvoie le message d'erreur si elle est incomplète. */
export function lireFormalite(d: Domain, p: Record<string, unknown>): Declaration | string {
  const expire = txt(p.expire);
  if (p.kind === 'passeport') {
    const numero = txt(p.numero);
    if (!numero || !isValidDate(expire)) return 'Numéro et date d’expiration requis';
    return { kind: 'passeport', numero, expire };
  }
  if (p.kind === 'visa') {
    const dest = d.destOf(txt(p.dest)), obtenu = txt(p.obtenu);
    if (!dest || !isValidDate(expire)) return 'Pays et date de validité requis';
    return { kind: 'visa', dest: dest.code, type: txt(p.visaType) || VISA_RULES[dest.visa].label, obtenu: isValidDate(obtenu) ? obtenu : null, expire };
  }
  if (p.kind === 'vaccin') {
    const v = txt(p.v), date = txt(p.date);
    if (!Object.hasOwn(VACCINS, v) || !isValidDate(date)) return 'Vaccin et date d’injection requis';
    return { kind: 'vaccin', v: v as VaccinId, date };
  }
  return 'Type de formalité inconnu';
}

/** Revalide une déclaration conservée dans une demande (référentiel ou saisie modifiés depuis). */
export function relireDeclaration(d: Domain, x: Declaration): Declaration | string {
  return lireFormalite(d, x.kind === 'visa' ? { ...x, visaType: x.type } : { ...x });
}

/** Document visé : un seul passeport, un visa par pays, une vaccination par vaccin. */
export function formaliteCle(x: { kind: string; dest?: string; v?: string }): string {
  return x.kind === 'passeport' ? 'passeport' : x.kind === 'visa' ? `visa:${x.dest}` : `vaccin:${x.v}`;
}

const vaccinNom = (v: VaccinId) => VACCINS[v].nom.replace(/ \(.*\)/, '');

/** Intitulé de la demande « document ». */
export function declarationLabel(d: Domain, x: Declaration): string {
  if (x.kind === 'passeport') return 'Passeport mis à jour';
  if (x.kind === 'visa') return `Visa ${d.destOf(x.dest)?.pays ?? x.dest} déclaré`;
  return `Vaccination ${vaccinNom(x.v)} déclarée`;
}

/** Contenu déclaré — à n'afficher qu'au service RH et à l'intéressé. */
export function declarationDetail(x: Declaration): string {
  if (x.kind === 'passeport') return `n° ${x.numero} · expire le ${fmtIso(x.expire)}`;
  if (x.kind === 'visa') return `${x.type}${x.obtenu ? ` · obtenu le ${fmtIso(x.obtenu)}` : ''} · valable jusqu’au ${fmtIso(x.expire)}`;
  return `${vaccinNom(x.v)} · injection le ${fmtIso(x.date)}`;
}

/** Valeur du dossier que la déclaration remplacerait. */
export function valeurActuelle(d: Domain, emp: Employe, x: Declaration): string {
  if (x.kind === 'passeport') return emp.passeport ? `n° ${emp.passeport.numero} · expire le ${fmtIso(emp.passeport.expire)}` : 'aucun passeport enregistré';
  if (x.kind === 'visa') {
    const v = d.visaFor(emp, x.dest);
    return v ? `${v.type} · valable jusqu’au ${fmtIso(v.expire)}` : 'aucun visa enregistré pour ce pays';
  }
  const r = d.vacRec(emp, x.v);
  return r ? `injection le ${fmtIso(r.date)}` : 'aucune injection enregistrée';
}
