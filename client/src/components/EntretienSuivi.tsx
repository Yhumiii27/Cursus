// Blocs « Objectifs » et « Souhaits de formation » du compte rendu d'entretien (lot 12, chantier C3, t194), rendus par
// dialogs/EntDialog.tsx sous les sections rédigées :
// - entretien annuel : objectifs de la période précédente à évaluer (atteint, partiellement, non atteint, sans objet,
//   reconduit), puis objectifs fixés à cet entretien (par l'évaluateur, ou proposés par le salarié et validés) ;
// - point de mi-année et point de suivi : objectifs en cours, leur avancement et leur ajustement (avec un motif) ;
// - jamais dans un entretien de parcours professionnel, de reprise, l'état des lieux ni le forfait jours (art. L6315-1 ;
//   le serveur le refuse aussi) ;
// - souhaits de formation (parcours professionnel, reprise, annuel, mi-année), avec l'avis du manager ; à la clôture, seuls
//   les souhaits à avis favorable deviennent une demande au service RH, dont l'état s'affiche ensuite ici.
// Évaluateur : service RH (jamais pour soi-même), manager valideur ou suppléant d'une délégation « entretiens », comme
// le serveur (`isValidatorOf(ctx, e, 'entretiens')`). Chaque saisie s'ouvre dans son dialogue (`ouvrir`), après
// l'enregistrement des sections en cours du compte rendu.
import type { ReactNode } from 'react';
import { REQ_CLS, REQ_LABEL } from '../../../shared/constants.ts';
import { fmtIso } from '../../../shared/format.ts';
import {
  blocageClotureObjectifs, CATEGORIE_OBJECTIF_LABEL, estEvalue, objectifsDuCompteRendu, STATUT_OBJECTIF_LABEL, TYPES_AVEC_OBJECTIFS, TYPES_FIXATION,
} from '../../../shared/rules/objectifs.ts';
import {
  AVIS_SOUHAIT, AVIS_SOUHAIT_LABEL, NON_VERSE_LABEL, PRIORITE_SOUHAIT_LABEL, souhaitsDe, souhaitsSansAvis, souhaitTraite, TYPES_SOUHAITS,
} from '../../../shared/rules/souhaits.ts';
import type { AvisSouhait, Employe, Entretien, Objectif, SouhaitFormation, StatutObjectif } from '../../../shared/types.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { decideur } from '../state/delegues.ts';
import { retraitProposition } from '../state/confirmations-objectifs.ts';
import { type DialogState, useStore } from '../state/store.tsx';
import { Bar, Fine, NoteAccent, SectionLabel, Tag } from './ui.tsx';
import { t, tn } from '../i18n/langue.ts';

/** Classe de l'étiquette d'un statut d'objectif. */
export const STATUT_OBJECTIF_CLS: Record<StatutObjectif, string> = {
  propose: 'tag-outline', ouvert: 'tag-neutral', atteint: 'tag-neutral', partiel: 'tag-outline', non_atteint: 'tag-accent', sans_objet: 'tag-outline', reconduit: 'tag-outline',
};

/** Détail d'un objectif sur une ligne : catégorie, poids, échéance. */
export const detailObjectif = (o: Objectif) => [
  CATEGORIE_OBJECTIF_LABEL[o.categorie], o.poids != null ? `${t('weight ')}${o.poids} %` : '', o.echeance ? `${t('due on ')}${fmtIso(o.echeance)}` : '',
  o.reconduitDe ? t('carried over from the previous period') : '', o.ajusteLe ? `${t('adjusted on ')}${fmtIso(o.ajusteLe)}` : '',
].filter(Boolean).join(' · ');

/** Intitulé d'un souhait : la formation du catalogue, ou l'intitulé libre. */
export function nomSouhait(d: ReturnType<typeof useDomain>, s: Pick<SouhaitFormation, 'f' | 'libelle'>): string {
  return s.f ? d.ds.referentiels.formations.find(y => y.id === s.f)?.nom ?? s.f : s.libelle ?? '';
}

/** Personne connectée évaluateur de ce salarié (même règle que le serveur) ; jamais pour soi-même. */
export function useEvaluateur(e: Pick<Employe, 'id' | 'equipe'> | undefined): boolean {
  const d = useDomain();
  const { rh, manager, me, soi } = useRole();
  return !!e && e.id !== soi && (rh || (manager && decideur(d, e, me, 'entretiens')));
}

export function EntretienSuivi({ x, e, ouvrir }: { x: Entretien; e: Employe; ouvrir: (dlg: DialogState) => void }) {
  const d = useDomain();
  const { collab, me } = useRole();
  const { run } = useStore();
  const evaluateur = useEvaluateur(e);
  const salarie = collab && x.empId === me;
  const planifie = x.statut === 'planifie';
  const s = d.ds.settings;
  const objectifs = d.ds.objectifs ?? [];
  // Annuel clos : ses objectifs (fixés ou évalués à cet entretien) restent affichés même réglage coupé ; la saisie, non.
  const { avec: avecObjectifs, aRevoir, fixes } = objectifsDuCompteRendu(objectifs, d.ds.entretiens, x, s);
  const fixation = TYPES_FIXATION.includes(x.type);
  const avecSouhaits = TYPES_SOUHAITS.includes(x.type);
  if (!avecObjectifs && !avecSouhaits) return null;

  // Point de mi-année, point de suivi : les objectifs en cours du salarié, fixés à un entretien clos.
  const clos = new Set(d.ds.entretiens.filter(y => y.statut === 'realise').map(y => y.id));
  const enCours = fixation ? [] : objectifs.filter(o => o.empId === e.id && o.statut === 'ouvert' && clos.has(o.entretienId));
  const blocage = evaluateur && planifie && fixation ? blocageClotureObjectifs(objectifs, d.ds.entretiens, x, s) : null;
  const poidsTotal = fixes.reduce((n, o) => n + (o.poids ?? 0), 0);
  const souhaits = souhaitsDe(x);
  const sansAvis = souhaitsSansAvis(x).length;

  /** Boutons de suivi d'un objectif en cours (entretien de fixation clos) : avancement, ajustement. */
  const suivi = (o: Objectif) => s.objectifsActifs && o.statut === 'ouvert' && clos.has(o.entretienId) && (<>
    {(evaluateur || (collab && o.empId === me)) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => ouvrir({ type: 'objectifAvancer', id: o.id, retour: x.id })}>{t('Progress')}</button>}
    {evaluateur && <button type="button" className="btn btn-ghost btn-sm" onClick={() => ouvrir({ type: 'objectif', mode: 'ajuster', id: o.id, retour: x.id })}>{t('Adjust')}</button>}
  </>);

  const ligne = (o: Objectif, actions: ReactNode, evaluation = false) => (
    <div key={o.id} className="list-row stack">
      <div className="item-head">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14 }}>{o.libelle}</div>
          <div className="text-muted sub">{detailObjectif(o)}</div>
          {o.mesure && <div className="text-muted sub">{t('Measure: ')}{o.mesure}</div>}
          {o.statut === 'ouvert' && clos.has(o.entretienId) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
              <Bar pct={o.avancement} width={120} /><span className="text-muted sub tnum">{o.avancement} %</span>
            </div>
          )}
          {o.commentaireSal && <div className="text-muted sub">{t('Employee’s comment: ')}{o.commentaireSal}</div>}
          {evaluation && o.evaluation && <div className="text-muted sub">{t('Evaluation: ')}{o.evaluation}</div>}
        </div>
        {/* Fixé à un entretien encore planifié : pas encore « en cours ». */}
        <Tag cls={STATUT_OBJECTIF_CLS[o.statut]} style={{ flex: 'none' }}>{o.statut === 'ouvert' && !clos.has(o.entretienId) ? t('Set#objective') : STATUT_OBJECTIF_LABEL[o.statut]}</Tag>
      </div>
      {actions && <div className="actions-end">{actions}</div>}
    </div>
  );

  const avis = (sh: SouhaitFormation) => {
    if (souhaitTraite(sh)) {
      const r = sh.demandeId ? d.ds.demandesCollab.find(y => y.id === sh.demandeId) : undefined;
      if (sh.nonVerse) return <Tag cls="tag-outline">{NON_VERSE_LABEL[sh.nonVerse]}</Tag>;
      return r ? <Tag cls={REQ_CLS[r.statut]}>{t('Request ')}{REQ_LABEL[r.statut].toLowerCase()}</Tag> : <Tag cls="tag-neutral">{t('Passed to HR')}</Tag>;
    }
    if (evaluateur && planifie) {
      return (
        <select className="input" aria-label={`${t('Opinion on the wish ')}${nomSouhait(d, sh)}`} value={sh.avis ?? ''} style={{ width: 'auto', minWidth: 140 }}
          onChange={ev => run('entretien.avisSouhait', { id: x.id, cle: sh.cle, avis: ev.target.value || null })}>
          <option value="">{t('Opinion to give')}</option>
          {AVIS_SOUHAIT.map(a => <option key={a} value={a}>{AVIS_SOUHAIT_LABEL[a]}</option>)}
        </select>
      );
    }
    return <Tag cls={sh.avis === 'favorable' ? 'tag-neutral' : 'tag-outline'}>{sh.avis ? `${t('Opinion ')}${AVIS_SOUHAIT_LABEL[sh.avis as AvisSouhait].toLowerCase()}` : t('No opinion')}</Tag>;
  };

  return (<>
    {avecObjectifs && fixation && aRevoir.length > 0 && (<>
      <SectionLabel>{t('Objectives of the previous period')}</SectionLabel>
      <div className="list">
        {aRevoir.map(o => ligne(o, evaluateur && planifie
          ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrir({ type: 'objectifEvaluer', id: o.id, entretienId: x.id, retour: x.id })}>{t(estEvalue(o) ? 'Change the evaluation' : 'Evaluate')}</button>
          : suivi(o), true))}
      </div>
      <Fine>
        {s.objectifsFacultatifs
          ? t('Optional objectives (first year): the evaluation is not required to close the review.')
          : t('Each objective of the previous period is evaluated before the closing: achieved, partly, not achieved, not applicable or carried over.')}
      </Fine>
    </>)}
    {avecObjectifs && fixation && (<>
      <SectionLabel>{t(planifie ? 'Objectives of the coming period' : 'Objectives set at this review')}</SectionLabel>
      {fixes.length > 0 ? (
        <div className="list">
          {fixes.map(o => ligne(o, planifie ? (<>
            {evaluateur && <button type="button" className="btn btn-ghost btn-sm" onClick={() => ouvrir({ type: 'objectif', mode: 'modifier', id: o.id, retour: x.id })}>{t(o.statut === 'propose' ? 'Approve or rephrase' : 'Edit')}</button>}
            {salarie && o.statut === 'propose' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => ouvrir({ type: 'confirmer', c: retraitProposition(o, x.id) })}>{t('Withdraw my proposal')}</button>}
          </>) : suivi(o)))}
        </div>
      ) : <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{t(planifie ? 'No objective set yet.' : 'No objective set at this review.')}</p>}
      {planifie && (evaluateur || salarie) && (
        <div className="actions-end" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span className="text-muted sub">{tn(fixes.length, 'objective', 'objectives')}{t(' out of ')}{s.objectifsMax}{t(' at most')}{poidsTotal ? ` · ${t('weight shared ')}${poidsTotal} %` : ''}</span>
          {fixes.length < s.objectifsMax && (evaluateur
            ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrir({ type: 'objectif', mode: 'ajouter', entretienId: x.id, retour: x.id })}>{t('Set an objective')}</button>
            : <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrir({ type: 'objectif', mode: 'proposer', entretienId: x.id, retour: x.id })}>{t('Propose an objective')}</button>)}
        </div>
      )}
      {blocage && <NoteAccent>{blocage}.</NoteAccent>}
    </>)}
    {avecObjectifs && !fixation && (<>
      <SectionLabel>{t('Objectives in progress')}</SectionLabel>
      {enCours.length > 0
        ? <div className="list">{enCours.map(o => ligne(o, suivi(o)))}</div>
        : <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{t('No objective in progress: they are set at the annual review.')}</p>}
      <Fine>{t('Follow-up meeting: the progress is updated and an objective is adjusted with a reason; the evaluation is made at the annual review.')}</Fine>
    </>)}
    {avecSouhaits && (<>
      <SectionLabel>{t('Training wishes')}</SectionLabel>
      {souhaits.length > 0 ? (
        <div className="list">
          {souhaits.map(sh => {
            // Objectif lié : seulement dans un entretien qui porte des objectifs (jamais un parcours professionnel, L6315-1).
            const objectif = sh.objectifId && TYPES_AVEC_OBJECTIFS.includes(x.type) ? objectifs.find(o => o.id === sh.objectifId) : undefined;
            const modifiable = planifie && !souhaitTraite(sh) && ((salarie && sh.auteur === 'sal') || (evaluateur && sh.auteur === 'mgr'));
            return (
              <div key={sh.cle} className="list-row stack">
                <div className="item-head">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14 }}>{nomSouhait(d, sh)}</div>
                    <div className="text-muted sub">
                      {t(sh.auteur === 'sal' ? 'Expressed by the employee' : 'Proposed by the reviewer')} · {t('priority ')}{PRIORITE_SOUHAIT_LABEL[sh.priorite].toLowerCase()}
                      {objectif ? ` · ${t('for the objective “')}${objectif.libelle}${t('”#close')}` : ''}{sh.verseLe ? ` · ${t('handled on ')}${fmtIso(sh.verseLe)}` : ''}
                    </div>
                  </div>
                  <div style={{ flex: 'none' }}>{avis(sh)}</div>
                </div>
                {modifiable && (
                  <div className="actions-end">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => ouvrir({ type: 'souhait', entretienId: x.id, cle: sh.cle })}>{t('Edit')}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{t('No training wish expressed.')}</p>}
      {planifie && (evaluateur || salarie) && (
        <div className="actions-end">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrir({ type: 'souhait', entretienId: x.id })}>{t('Add a wish')}</button>
        </div>
      )}
      {planifie && evaluateur && sansAvis > 0 && <NoteAccent>{tn(sansAvis, 'wish awaits', 'wishes await')}{t(' your opinion: only the wishes with a favourable opinion become a request to HR at the closing.')}</NoteAccent>}
      <Fine>{t('At the closing, each wish with a favourable opinion becomes a training request to HR, who decides (session, waiting list or training plan); the others stay in the report.')}</Fine>
    </>)}
  </>);
}
