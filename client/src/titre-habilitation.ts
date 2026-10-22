// Titre d'habilitation imprimé, à signer par l'employeur et le titulaire (t115) : depuis la fiche du collaborateur ou
// juste après la délivrance (HabDialog). Trois modèles, choisis au référentiel (`HabType.modele`) : habilitation
// électrique (norme NF C18-510, modèle de titre de son annexe), autorisation de conduite (art. R4323-56 du code du
// travail ; recommandations R489, R486) et générique. Modèles à faire valider par le référent HSE avant la mise en service
// (aide). L'aptitude médicale figure comme vérifiée, jamais l'avis ni les restrictions. Impression tracée au journal.
// Seul un titre en vigueur s'imprime (titreImprimable) : jamais un titre retiré, suspendu, échu ou aux prérequis manquants.
import { addMonths, iso, parse } from '../../shared/dates.ts';
import type { CertInfo, EmpX, HabInfo } from '../../shared/domain.ts';
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

/**
 * Titre délivré qu'on peut imprimer à signer : signataire connu, valide ou à renouveler (ni retiré, ni suspendu, ni échu)
 * et prérequis satisfaits (certifications et aptitude médicale). Sinon, le document attesterait une habilitation que le
 * salarié n'a plus.
 */
export const titreImprimable = (h: Pick<HabInfo, 'delivree' | 'par' | 'key' | 'prereqOk' | 'mesure'>): boolean =>
  !!h.delivree && !!h.par && (h.key === 'ok' || h.key === 'due') && h.prereqOk && !h.mesure;

/**
 * Certification qui satisfaisait un prérequis à la délivrance : obtenue au plus tard ce jour-là et valide ce jour-là, en
 * vigueur ou remplacée depuis (la plus récente) ; une certification obtenue après la délivrance n'a pas été vérifiée.
 */
function certALaDelivrance(e: EmpX, f: string, delivree: ISODate): CertInfo | null {
  const jour = parse(delivree);
  return [...e.rawCerts, ...e.anciennes].filter(c => c.f === f && c.obt <= jour && c.exp >= jour)
    .sort((a, b) => b.obt.getTime() - a.obt.getTime() || b.id - a.id)[0] ?? null;
}
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
  // Prérequis du référentiel : la certification valide à la date de délivrance (obtention, échéance).
  const prereqs = hm.prereqs.map(f => {
    const c = certALaDelivrance(e, f, t.delivree);
    return [c?.fm.nom ?? e.rawCerts.find(x => x.f === f)?.fm.nom ?? f, c ? `obtenue le ${fmt(c.obt)}, valide jusqu’au ${fmt(c.exp)}` : 'aucune certification valide à cette date dans Cursus'] as [string, string];
  });
  return [
    { title: 'Titulaire', rows: [['Nom', e.nom], ['Fonction', e.poste || '—'], ['Équipe', equipeLabel(e)]] },
    { title: modele === 'conduite' ? 'Autorisation' : 'Habilitation', rows: [['Intitulé', hm.nom], ['Délivrée le', date(t.delivree)], ['Valable jusqu’au', date(expire)]] },
    {
      title: 'Prérequis vérifiés à la délivrance',
      rows: [
        ...prereqs,
        // Vérifiée seulement si la visite d'aptitude est en cours de validité ; jamais l'avis ni les restrictions.
        ...(hm.medical ? [['Aptitude médicale', e.med.ok ? 'vérifiée (visite d’aptitude en cours de validité)' : 'non vérifiée : aucune visite d’aptitude en cours de validité'] as [string, string]] : []),
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
