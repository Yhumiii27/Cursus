// lot 12 — C3 (entretiens suivis) : sections du compte rendu imprimé (dialogs/compteRendu.ts) pour les objectifs et les
// souhaits de formation, sur le modèle du compte rendu à l'écran (components/EntretienSuivi.tsx) :
// - entretien annuel : objectifs de la période précédente et leur évaluation, objectifs fixés à cet entretien ;
// - point de mi-année, point de suivi : objectifs en cours et leur avancement à la date de l'impression ;
// - souhaits de formation, avec l'avis du manager et la suite donnée (demande au service RH, ou raison de ne pas la créer).
// Synthèse du feedback 360° (étape 3) : annexe distincte, après les signatures, seulement quand une synthèse est jointe ;
// agrégats et commentaires restitués, jamais une réponse prise seule.
import type { Domain } from '../../../shared/domain.ts';
import { fmtIso } from '../../../shared/format.ts';
import { CATEGORIE_OBJECTIF_LABEL, objectifsDuCompteRendu, STATUT_OBJECTIF_LABEL, TYPES_FIXATION } from '../../../shared/rules/objectifs.ts';
import { AVIS_SOUHAIT_LABEL, NON_VERSE_LABEL, PRIORITE_SOUHAIT_LABEL, souhaitsDe, TYPES_SOUHAITS } from '../../../shared/rules/souhaits.ts';
import { REQ_LABEL } from '../../../shared/constants.ts';
import type { Entretien, Objectif } from '../../../shared/types.ts';
import type { PrintSection } from '../print.ts';
import { libelleGroupe360, lireSynthese360, QUESTIONNAIRE_360 } from '../../../shared/rules/feedback360.ts';
import { t, tn } from '../i18n/langue.ts';

const detail = (o: Objectif) => [o.mesure ? `${t('Measure: ')}${o.mesure}` : '', o.reconduitDe ? t('renewed#objective') : '', o.ajusteLe ? `${t('adjusted on ')}${fmtIso(o.ajusteLe)}` : ''].filter(Boolean).join(' · ');

/** Sections « Objectifs » et « Souhaits de formation » du compte rendu imprimé de l'entretien `x` (vides : rien). */
export function sectionsSuivi(d: Domain, x: Entretien): PrintSection[] {
  const out: PrintSection[] = [];
  const objectifs = d.ds.objectifs ?? [];
  // Annuel clos : objectifs fixés et évalués à cet entretien, quel que soit le réglage actuel (compte rendu signé inchangé).
  const { avec, aRevoir: revus, fixes } = objectifsDuCompteRendu(objectifs, d.ds.entretiens, x, d.ds.settings);
  if (avec) {
    if (TYPES_FIXATION.includes(x.type)) {
      if (revus.length) {
        out.push({ title: t('Objectives of the previous period · Evaluator'), table: {
          head: [t('Objective'), t('Due date'), t('Result'), t('Comment')],
          rows: revus.map(o => [o.libelle, o.echeance ? fmtIso(o.echeance) : '—', o.statut === 'ouvert' ? t('Not evaluated') : STATUT_OBJECTIF_LABEL[o.statut], o.evaluation ?? '']),
        } });
      }
      out.push(fixes.length
        ? { title: t('Objectives set for the coming period'), table: {
          head: [t('Objective'), t('Category'), t('Weight'), t('Due date'), t('Details')],
          rows: fixes.map(o => [`${o.libelle}${o.statut === 'propose' ? t(' (proposed by the employee, to approve)') : ''}`, CATEGORIE_OBJECTIF_LABEL[o.categorie],
            o.poids != null ? `${o.poids} %` : '—', o.echeance ? fmtIso(o.echeance) : '—', detail(o)]),
        } }
        : { title: t('Objectives set for the coming period'), text: t('No objective set.') });
    } else {
      const clos = new Set(d.ds.entretiens.filter(y => y.statut === 'realise').map(y => y.id));
      const enCours = objectifs.filter(o => o.empId === x.empId && o.statut === 'ouvert' && clos.has(o.entretienId));
      out.push(enCours.length
        ? { title: t('Current objectives'), table: {
          head: [t('Objective'), t('Due date'), t('Progress'), t('Details')],
          rows: enCours.map(o => [o.libelle, o.echeance ? fmtIso(o.echeance) : '—', `${o.avancement} %`, detail(o)]),
        } }
        : { title: t('Current objectives'), text: t('No current objective.') });
    }
  }
  if (TYPES_SOUHAITS.includes(x.type)) {
    const souhaits = souhaitsDe(x);
    out.push(souhaits.length
      ? { title: t('Training wishes'), table: {
        head: [t('Training course wished'), t('Expressed by'), t('Priority'), t('Manager’s opinion'), t('Follow-up#suite')],
        rows: souhaits.map(s => {
          const r = s.demandeId ? d.ds.demandesCollab.find(y => y.id === s.demandeId) : undefined;
          const suite = s.nonVerse ? NON_VERSE_LABEL[s.nonVerse] : s.demandeId ? `${t('Request to HR')}${r ? `${t(': ')}${REQ_LABEL[r.statut].toLowerCase()}` : ''}` : s.avis === 'favorable' ? t('Transferred at the closing') : t('In the report');
          return [s.f ? d.ds.referentiels.formations.find(f => f.id === s.f)?.nom ?? s.f : s.libelle ?? '', s.auteur === 'sal' ? t('Employee#salarie') : t('Evaluator'),
            PRIORITE_SOUHAIT_LABEL[s.priorite], s.avis ? AVIS_SOUHAIT_LABEL[s.avis] : t('Without opinion'), suite];
        }),
      } }
      : { title: t('Training wishes'), text: t('No training wish expressed.') });
  }
  return out;
}

/** Annexe « Synthèse du feedback 360° » du compte rendu imprimé (vide : aucune synthèse jointe). */
export function annexeFeedback360(x: Entretien): PrintSection[] {
  const s = lireSynthese360(x.syntheseFeedback);
  if (!s) return [];
  const titre = t('Appendix — synthesis of the 360° feedback (confidential)');
  const entete = `${t('Collection closed on ')}${fmtIso(s.closeLe)}${t(': ')}${tn(s.reponses, 'answer', 'answers')}${t(' out of ')}${s.envoyees}${t(' solicited (questionnaire ')}${s.version}${t(', scale from 1 to 4).')}`;
  if (s.insuffisant) return [{ title: titre, saut: true, text: `${entete}${t(' Fewer than ')}${s.seuil}${t(' answers: nothing is returned.')}` }];
  const colonnes = [...s.groupes, ...(s.ensemble ? [s.ensemble] : [])];
  const moyenne = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  return [
    { title: titre, saut: true, text: `${entete}${t(' “—”: fewer than ')}${s.seuil}${t(' answers, nothing is returned; the categories of fewer than ')}${s.seuil}${t(' respondents are grouped.')}`, table: {
      head: [t('Question'), ...colonnes.map((g, i) => `${i === colonnes.length - 1 && s.ensemble ? t('Overall') : libelleGroupe360(g)} (${g.reponses})`)],
      rows: QUESTIONNAIRE_360.questions.map(q => [q.theme, ...colonnes.map(g => moyenne(g.moyennes[q.cle]))]),
    } },
    ...(s.verbatims.length ? [{ title: t('Comments returned (reviewed by HR)'), table: { head: [t('Comment')], rows: s.verbatims.map(v => [v]) } }] : []),
  ];
}
