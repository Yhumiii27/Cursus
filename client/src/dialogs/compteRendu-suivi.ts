// lot 12 — C3 (entretiens suivis) : sections du compte rendu imprimé (dialogs/compteRendu.ts) pour les objectifs et les
// souhaits de formation, sur le modèle du compte rendu à l'écran (components/EntretienSuivi.tsx) :
// - entretien annuel : objectifs de la période précédente et leur évaluation, objectifs fixés à cet entretien ;
// - point de mi-année, point de suivi : objectifs en cours et leur avancement à la date de l'impression ;
// - souhaits de formation, avec l'avis du manager et la suite donnée (demande au service RH, ou raison de ne pas la créer).
// Synthèse du feedback 360° : annexe distincte et facultative, à l'étape 3 (module désactivé).
import type { Domain } from '../../../shared/domain.ts';
import { fmtIso } from '../../../shared/format.ts';
import { CATEGORIE_OBJECTIF_LABEL, objectifsDuCompteRendu, STATUT_OBJECTIF_LABEL, TYPES_FIXATION } from '../../../shared/rules/objectifs.ts';
import { AVIS_SOUHAIT_LABEL, NON_VERSE_LABEL, PRIORITE_SOUHAIT_LABEL, souhaitsDe, TYPES_SOUHAITS } from '../../../shared/rules/souhaits.ts';
import { REQ_LABEL } from '../../../shared/constants.ts';
import type { Entretien, Objectif } from '../../../shared/types.ts';
import type { PrintSection } from '../print.ts';

const detail = (o: Objectif) => [o.mesure ? `Mesure : ${o.mesure}` : '', o.reconduitDe ? 'reconduit' : '', o.ajusteLe ? `ajusté le ${fmtIso(o.ajusteLe)}` : ''].filter(Boolean).join(' · ');

/** Sections « Objectifs » et « Souhaits de formation » du compte rendu imprimé de l'entretien `x` (vides : rien). */
export function sectionsSuivi(d: Domain, x: Entretien): PrintSection[] {
  const out: PrintSection[] = [];
  const objectifs = d.ds.objectifs ?? [];
  // Annuel clos : objectifs fixés et évalués à cet entretien, quel que soit le réglage actuel (compte rendu signé inchangé).
  const { avec, aRevoir: revus, fixes } = objectifsDuCompteRendu(objectifs, d.ds.entretiens, x, d.ds.settings);
  if (avec) {
    if (TYPES_FIXATION.includes(x.type)) {
      if (revus.length) {
        out.push({ title: 'Objectifs de la période précédente · Évaluateur', table: {
          head: ['Objectif', 'Échéance', 'Résultat', 'Commentaire'],
          rows: revus.map(o => [o.libelle, o.echeance ? fmtIso(o.echeance) : '—', o.statut === 'ouvert' ? 'Non évalué' : STATUT_OBJECTIF_LABEL[o.statut], o.evaluation ?? '']),
        } });
      }
      out.push(fixes.length
        ? { title: 'Objectifs fixés pour la période à venir', table: {
          head: ['Objectif', 'Catégorie', 'Poids', 'Échéance', 'Précisions'],
          rows: fixes.map(o => [`${o.libelle}${o.statut === 'propose' ? ' (proposé par le salarié, à valider)' : ''}`, CATEGORIE_OBJECTIF_LABEL[o.categorie],
            o.poids != null ? `${o.poids} %` : '—', o.echeance ? fmtIso(o.echeance) : '—', detail(o)]),
        } }
        : { title: 'Objectifs fixés pour la période à venir', text: 'Aucun objectif fixé.' });
    } else {
      const clos = new Set(d.ds.entretiens.filter(y => y.statut === 'realise').map(y => y.id));
      const enCours = objectifs.filter(o => o.empId === x.empId && o.statut === 'ouvert' && clos.has(o.entretienId));
      out.push(enCours.length
        ? { title: 'Objectifs en cours', table: {
          head: ['Objectif', 'Échéance', 'Avancement', 'Précisions'],
          rows: enCours.map(o => [o.libelle, o.echeance ? fmtIso(o.echeance) : '—', `${o.avancement} %`, detail(o)]),
        } }
        : { title: 'Objectifs en cours', text: 'Aucun objectif en cours.' });
    }
  }
  if (TYPES_SOUHAITS.includes(x.type)) {
    const souhaits = souhaitsDe(x);
    out.push(souhaits.length
      ? { title: 'Souhaits de formation', table: {
        head: ['Formation souhaitée', 'Exprimé par', 'Priorité', 'Avis du manager', 'Suite'],
        rows: souhaits.map(s => {
          const r = s.demandeId ? d.ds.demandesCollab.find(y => y.id === s.demandeId) : undefined;
          const suite = s.nonVerse ? NON_VERSE_LABEL[s.nonVerse] : s.demandeId ? `Demande au service RH${r ? ` : ${REQ_LABEL[r.statut].toLowerCase()}` : ''}` : s.avis === 'favorable' ? 'Versé à la clôture' : 'Au compte rendu';
          return [s.f ? d.ds.referentiels.formations.find(f => f.id === s.f)?.nom ?? s.f : s.libelle ?? '', s.auteur === 'sal' ? 'Salarié' : 'Évaluateur',
            PRIORITE_SOUHAIT_LABEL[s.priorite], s.avis ? AVIS_SOUHAIT_LABEL[s.avis] : 'Sans avis', suite];
        }),
      } }
      : { title: 'Souhaits de formation', text: 'Aucun souhait de formation exprimé.' });
  }
  return out;
}
