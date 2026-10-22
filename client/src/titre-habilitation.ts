// Titre d'habilitation imprimé, à signer par l'employeur et le titulaire (t115) : depuis la fiche du collaborateur ou
// juste après la délivrance (HabDialog). Trois modèles, choisis au référentiel (`HabType.modele`) : habilitation
// électrique (norme NF C18-510, modèle de titre de son annexe), autorisation de conduite (art. R4323-56 du code du
// travail ; recommandations R489, R486) et générique. Modèles à faire valider par le référent HSE avant la mise en service
// (aide). L'aptitude médicale figure comme vérifiée, jamais l'avis ni les restrictions. Impression tracée au journal.
import { addMonths, iso, parse } from '../../shared/dates.ts';
import type { EmpX } from '../../shared/domain.ts';
import { equipeLabel, fmt } from '../../shared/format.ts';
import type { HabType, ISODate, ModeleTitre } from '../../shared/types.ts';
import { matriculesImprimes, printDocument, type PrintSection } from './print.ts';

export const MODELE_TITRE_LABEL: Record<ModeleTitre, string> = {
  generique: 'Générique (intitulé, précision, dates, signatures)',
  electrique: 'Habilitation électrique (NF C18-510)',
  conduite: 'Autorisation de conduite (R4323-56, R489, R486)',
};

/** Modèle rappelé à la délivrance : « modèle NF C18-510 ». */
export const MODELE_TITRE_COURT: Record<ModeleTitre, string> = { generique: 'modèle générique', electrique: 'modèle NF C18-510', conduite: 'autorisation de conduite R4323-56' };

/** Titre visé : délivrance (date, signataire) ; l'échéance est calculée avec la validité de l'habilitation. */
export interface DelivranceImprimee { delivree: ISODate; par: string }

const date = (j: ISODate) => fmt(parse(j));
const LIGNE = '……………………………………………';

/** Mentions propres au modèle. */
function mentions(modele: ModeleTitre, hm: HabType): PrintSection[] {
  if (modele === 'electrique') {
    return [
      {
        title: 'Champ de l’habilitation',
        rows: [
          ['Symboles d’habilitation et domaine de tension', hm.detail || LIGNE],
          ['Ouvrages ou installations concernés', LIGNE],
          ['Indications supplémentaires', LIGNE],
        ],
      },
      {
        title: 'Mentions',
        text: 'Titre établi selon la norme NF C18-510 (modèle de titre d’habilitation de son annexe), après une formation adaptée '
          + 'aux opérations confiées. L’habilitation est délivrée par l’employeur pour les seules opérations désignées ; elle ne '
          + 'vaut pas autorisation permanente et est revue à l’échéance, et aussi après un changement de fonction ou d’installation, '
          + 'une restriction médicale ou un manquement aux règles de sécurité. Le titulaire garde ce titre sur lui pendant ses '
          + 'interventions et applique les instructions de sécurité remises avec lui.',
      },
    ];
  }
  if (modele === 'conduite') {
    return [
      { title: 'Équipements et catégories', rows: [['Catégories autorisées', hm.detail || LIGNE], ['Lieux ou équipements particuliers', LIGNE]] },
      {
        title: 'Mentions',
        text: 'Autorisation de conduite délivrée par l’employeur (art. R4323-55 à R4323-57 du code du travail ; arrêté du 2 décembre '
          + '1998). Elle repose sur l’examen d’aptitude médicale (vérifié), le contrôle des connaissances et du savoir-faire du '
          + 'conducteur (CACES ou équivalent, recommandations R489 ou R486) et la connaissance des lieux et des instructions à '
          + 'respecter sur le site. Elle est personnelle, limitée aux catégories désignées et retirée si l’une de ces conditions cesse.',
      },
    ];
  }
  return [
    { title: 'Champ de l’autorisation', rows: [['Précision', hm.detail || LIGNE], ['Indications supplémentaires', LIGNE]] },
    {
      title: 'Mentions',
      text: 'Autorisation délivrée par l’employeur pour les seules opérations désignées, après vérification des prérequis '
        + 'ci-dessus. Elle est revue à l’échéance, et aussi après un changement de fonction, une restriction médicale ou un '
        + 'manquement aux règles de sécurité.',
    },
  ];
}

/** Sections du titre : titulaire, habilitation, validité, prérequis vérifiés, mentions du modèle, signatures. */
export function sectionsTitre(e: EmpX, hm: HabType, t: DelivranceImprimee): PrintSection[] {
  const modele = hm.modele ?? 'generique';
  const expire = iso(addMonths(parse(t.delivree), hm.validite));
  // Prérequis du référentiel : la certification en vigueur du salarié (obtention, échéance), telle que vue à l'impression.
  const prereqs = hm.prereqs.map(f => {
    const c = e.rawCerts.find(x => x.f === f);
    return [c?.fm.nom ?? f, c ? `obtenue le ${fmt(c.obt)}, valide jusqu’au ${fmt(c.exp)}` : 'non enregistrée dans Cursus'] as [string, string];
  });
  return [
    { title: 'Titulaire', rows: [['Nom', e.nom], ['Fonction', e.poste || '—'], ['Équipe', equipeLabel(e)]] },
    { title: modele === 'conduite' ? 'Autorisation' : 'Habilitation', rows: [['Intitulé', hm.nom], ['Délivrée le', date(t.delivree)], ['Valable jusqu’au', date(expire)]] },
    {
      title: 'Prérequis vérifiés à la délivrance',
      rows: [
        ...prereqs,
        ...(hm.medical ? [['Aptitude médicale', 'vérifiée (visite d’aptitude en cours de validité)'] as [string, string]] : []),
        ...(!prereqs.length && !hm.medical ? [['Prérequis', 'aucun au référentiel'] as [string, string]] : []),
      ],
    },
    ...mentions(modele, hm),
    {
      title: 'Signatures',
      rows: [
        ['Pour l’employeur', `${t.par} — date et signature : ${LIGNE}`],
        ['Le titulaire', `${e.nom} — date et signature : ${LIGNE}`],
      ],
    },
  ];
}

/** Titre du document imprimé : « Titre d'habilitation » ou « Autorisation de conduite ». */
export const titreDocument = (hm: HabType) => ((hm.modele ?? 'generique') === 'conduite' ? 'Autorisation de conduite' : 'Titre d’habilitation');

/** Imprime le titre ; faux si rien n'a pu s'ouvrir. */
export function imprimerTitre(e: EmpX, hm: HabType, t: DelivranceImprimee): boolean {
  return printDocument(`${titreDocument(hm)} — ${e.nom}`, hm.nom, sectionsTitre(e, hm, t), e.id, matriculesImprimes(e));
}
