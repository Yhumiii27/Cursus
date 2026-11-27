// Compte rendu d'entretien imprimable (ou enregistré en PDF), dès la clôture par l'évaluateur : signé ou non par le
// salarié, avec l'état de la remise de sa copie (shared/rules/remise.ts). Ouvert depuis le compte rendu (EntDialog) et
// depuis le dialogue de remise (RemiseDialog).
import { ENT_TYPES, type EntSection } from '../../../shared/constants.ts';
import type { Domain } from '../../../shared/domain.ts';
import { equipeLabel, fmtIso } from '../../../shared/format.ts';
import { needsFinCarriere, obligations } from '../../../shared/rules/entretiens.ts';
import { texteRemise } from '../../../shared/rules/remise.ts';
import type { Entretien } from '../../../shared/types.ts';
import { matriculesImprimes, printDocument, type PrintSection } from '../print.ts';
// lot 12 — C3 (entretiens suivis) : objectifs et souhaits de formation imprimés après les sections rédigées.
import { annexeFeedback360, sectionsSuivi } from './compteRendu-suivi.ts';
import { objectifsDuCompteRendu, TYPES_FIXATION } from '../../../shared/rules/objectifs.ts';
import { t } from '../i18n/langue.ts';

// Libellés en sources anglaises (CU-N01) : FIN_CARRIERE et INFO_LABEL se traduisent au rendu (`libelleSection`, `t(INFO_LABEL)`) ;
// les autres sections viennent de shared/constants.ts (ENT_TYPES), en français.
export const FIN_CARRIERE: EntSection = ['fincarriere', 'End of career: job retention, desired adjustments', 'sal'];
export const INFO_LABEL = 'Information given: CPF, VAE, professional development advice (CEP), employer top-up';
export const whoLabel = (who: EntSection[2]) => who === 'mgr' ? t('Evaluator') : t('Employee#salarie');
/** Libellé affiché d'une section : la fin de carrière (propre à cet écran) traduite, les autres telles que shared/ les donne. */
export const libelleSection = (k: string, label: string) => (k === FIN_CARRIERE[0] ? t(label) : label);

/**
 * Sections du compte rendu : celles du type d'entretien, plus « fin de carrière » à partir de 58 ans. lot 12 — C3
 * (entretiens suivis) : objectifs suivis, la section en texte libre « Objectifs de l’année à venir » de l'entretien annuel
 * laisse la place aux objectifs structurés (components/EntretienSuivi.tsx), sauf si elle a déjà été rédigée.
 */
export function sectionsDe(d: Domain, x: Entretien): EntSection[] {
  const e = d.emp(x.empId);
  // Même règle que le bloc des objectifs (annuel clos : affiché quel que soit le réglage s'il porte des objectifs).
  const avecObjectifs = TYPES_FIXATION.includes(x.type) && objectifsDuCompteRendu(d.ds.objectifs ?? [], d.ds.entretiens, x, d.ds.settings).avec;
  const remplacee = (k: string) => k === 'objectifs' && avecObjectifs && !x.cr.objectifs?.trim();
  return e ? [...ENT_TYPES[x.type].sections.filter(([k]) => !remplacee(k)), ...(needsFinCarriere(d, e, x) ? [FIN_CARRIERE] : [])] : [];
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
    { title: t('Review#entretien'), rows: [
      [t('Employee'), `${e.nom} — ${e.poste}, ${equipeLabel(e)}`],
      [t('Date of the review'), fmtIso(x.date)],
      [t('Evaluator'), evaluateur],
    ] },
    { title: t('Legal basis'), text: T0.base },
    ...(bilan ? [{ title: t('Automatic check'), text: bilan.detail }] : []),
    ...sectionsDe(d, x).map(([k, label, who]) => ({ title: `${libelleSection(k, label)} · ${whoLabel(who)}`, text: x.cr[k]?.trim() || t('Not filled in') })),
    ...(['epp', 'reprise'].includes(x.type)
      ? [{ title: t('Information of the employee'), text: x.info ? `${t(INFO_LABEL)}.` : t('Information on the CPF, the VAE, the CEP and the employer top-up not given.') }] : []),
    // lot 12 — C3 (entretiens suivis)
    ...sectionsSuivi(d, x),
    { title: t('Signatures'), rows: [
      [t('Evaluator'), x.signMgr ? `${evaluateur}${t(' — signed on ')}${fmtIso(x.signMgr)}` : t('Not signed')],
      [t('Employee#salarie'), x.signSal ? `${e.nom}${t(' — signed on ')}${fmtIso(x.signSal)}` : t('Not signed by the employee')],
      ...(remise ? [[t('Handing over of the copy'), remise] as [string, string]] : []),
    ] },
    // lot 12 — C3 (feedback 360°, étape 3) : synthèse jointe, en annexe distincte.
    ...annexeFeedback360(x),
  ];
  return printDocument(`${T0.nom}${t(' — report')}`, `${e.nom} · ${e.poste} · ${fmtIso(x.date)}${x.signSal ? '' : t(' · not signed by the employee')}`, doc, e.id, matriculesImprimes(e));
}
