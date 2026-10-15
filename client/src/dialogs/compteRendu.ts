// Compte rendu d'entretien imprimable (ou enregistré en PDF), dès la clôture par l'évaluateur : signé ou non par le
// salarié, avec l'état de la remise de sa copie (shared/rules/remise.ts). Ouvert depuis le compte rendu (EntDialog) et
// depuis le dialogue de remise (RemiseDialog).
import { ENT_TYPES, type EntSection } from '../../../shared/constants.ts';
import type { Domain } from '../../../shared/domain.ts';
import { equipeLabel, fmtIso } from '../../../shared/format.ts';
import { needsFinCarriere, obligations } from '../../../shared/rules/entretiens.ts';
import { texteRemise } from '../../../shared/rules/remise.ts';
import type { Entretien } from '../../../shared/types.ts';
import { printDocument, type PrintSection } from '../print.ts';

export const FIN_CARRIERE: EntSection = ['fincarriere', 'Fin de carrière : maintien dans l’emploi, aménagements souhaités', 'sal'];
export const INFO_LABEL = 'Information remise : CPF, VAE, conseil en évolution professionnelle (CEP), abondement employeur';
export const whoLabel = (who: EntSection[2]) => who === 'mgr' ? 'Évaluateur' : 'Salarié';

/** Sections du compte rendu : celles du type d'entretien, plus « fin de carrière » à partir de 58 ans. */
export function sectionsDe(d: Domain, x: Entretien): EntSection[] {
  const e = d.emp(x.empId);
  return e ? [...ENT_TYPES[x.type].sections, ...(needsFinCarriere(d, e, x.type) ? [FIN_CARRIERE] : [])] : [];
}

/** Ouvre le compte rendu à imprimer ; faux si le navigateur bloque la fenêtre. */
export function imprimerCompteRendu(d: Domain, x: Entretien): boolean {
  const e = d.emp(x.empId);
  if (!e) return false;
  const T0 = ENT_TYPES[x.type];
  const evaluateur = d.mgrName(d.mgrOf(e));
  const bilan = x.type === 'bilan' ? obligations(d, [e.id]).find(o => o.kind === 'bilan') : undefined;
  const remise = texteRemise(x);
  const doc: PrintSection[] = [
    { title: 'Entretien', rows: [
      ['Collaborateur', `${e.nom} — ${e.poste}, ${equipeLabel(e)}`],
      ['Date de l’entretien', fmtIso(x.date)],
      ['Évaluateur', evaluateur],
    ] },
    { title: 'Base légale', text: T0.base },
    ...(bilan ? [{ title: 'Contrôle automatique', text: bilan.detail }] : []),
    ...sectionsDe(d, x).map(([k, label, who]) => ({ title: `${label} · ${whoLabel(who)}`, text: x.cr[k]?.trim() || 'Non renseigné' })),
    ...(['epp', 'reprise'].includes(x.type)
      ? [{ title: 'Information du salarié', text: x.info ? `${INFO_LABEL}.` : 'Information sur le CPF, la VAE, le CEP et l’abondement employeur non remise.' }] : []),
    { title: 'Signatures', rows: [
      ['Évaluateur', x.signMgr ? `${evaluateur} — signé le ${fmtIso(x.signMgr)}` : 'Non signé'],
      ['Salarié', x.signSal ? `${e.nom} — signé le ${fmtIso(x.signSal)}` : 'Non signé par le salarié'],
      ...(remise ? [['Remise de la copie', remise] as [string, string]] : []),
    ] },
  ];
  return printDocument(`${T0.nom} — compte rendu`, `${e.nom} · ${e.poste} · ${fmtIso(x.date)}${x.signSal ? '' : ' · non signé par le salarié'}`, doc, e.id);
}
