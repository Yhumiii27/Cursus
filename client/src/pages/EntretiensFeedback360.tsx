// lot 12 — C3 (feedback 360°, étape 3) : onglet « Feedback 360° » de l'écran Entretiens, service RH seulement (droit
// « rh »), le module activé :
// - commentaires à relire avant leur restitution (GET /api/feedback360/moderation : le commentaire seul, sans relation de
//   son auteur ni notes, jamais sur soi-même) : « Restituer » ou « Ne pas restituer » (`feedback360.moderer`) ; la synthèse
//   de l'entretien est recalculée aussitôt ;
// - collectes des entretiens : qui a été sollicité et un compteur global par collecte (`suiviFeedback`), jamais l'état
//   d'une sollicitation désignée : le service RH conduit lui aussi des entretiens, et les répondants ont lu que
//   l'évaluateur ne sait pas qui a répondu (le serveur masque les sollicitations, server/src/vues-entretiens-suivis.ts) ;
//   ouverture du compte rendu, où l'évaluateur relance et clôt.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ENT_TYPES } from '../../../shared/constants.ts';
import { fmtIso } from '../../../shared/format.ts';
import { collecte360, lireSynthese360, RELATION_360_UN, sollicitationMasquee, STATUT_360_LABEL, suivi360 } from '../../../shared/rules/feedback360.ts';
import { api, type Commentaire360 } from '../api.ts';
import { Ouvrir } from '../components/Cliquable.tsx';
import { Empty, Fine, Panel, Tag } from '../components/ui.tsx';
import { useAgir } from '../state/actions.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

export function OngletFeedback360() {
  const d = useDomain();
  const { openDialog, run, notify } = useStore();
  const { occupe, agir } = useAgir();
  const [commentaires, setCommentaires] = useState<Commentaire360[] | null>(null);
  const relire = useCallback(() => {
    api.moderation360().then(r => setCommentaires(r.commentaires)).catch(() => notify(t('The comments to review could not be read: try again'), true));
  }, [notify]);
  // Relus à l'ouverture de l'onglet et après chaque changement de l'instantané (une clôture verse de nouveaux commentaires).
  useEffect(() => { relire(); }, [relire, d.ds.revision]);

  const collectes = useMemo(() => {
    const ids = [...new Set((d.ds.feedbackSollicitations ?? []).map(s => s.entretienId))];
    const synth = d.ds.entretiens.filter(x => x.syntheseFeedback && !ids.includes(x.id)).map(x => x.id);
    return [...ids, ...synth].flatMap(id => {
      const x = d.ds.entretiens.find(y => y.id === id);
      const brutes = d.ds.feedbackSollicitations ?? [];
      // Compteur global remis par le serveur (les sollicitations reçues sont masquées) ; masquées ici aussi par sûreté.
      const suivi = d.ds.suiviFeedback?.find(s => s.entretienId === id) ?? suivi360(brutes, id);
      return x ? [{ x, c: collecte360(brutes, id), suivi, sols: brutes.filter(s => s.entretienId === id && s.statut !== 'annulee').map(sollicitationMasquee) }] : [];
    }).sort((a, b) => Number(b.c.ouverte) - Number(a.c.ouverte) || b.x.date.localeCompare(a.x.date));
  }, [d]);
  const nom = (id: number) => d.ds.annuaire.find(p => p.id === id)?.nom ?? d.emp(id)?.nom ?? t('Employee#salarie');
  const aRelire = (commentaires ?? []).filter(c => c.statut === 'a_moderer');
  const moderer = (c: Commentaire360, decision: 'retenu' | 'retire') => agir(async () => {
    const r = await run('feedback360.moderer', { id: c.id, decision });
    if (r.ok) relire();
  });

  return (<>
    <Panel title={t('Comments to review')} aside={commentaires ? tn(aRelire.length, 'comment', 'comments') : t('reading…')} highlight={aRelire.length > 0}>
      {aRelire.length ? (
        <div className="list">
          {aRelire.map(c => (
            <div key={c.id} className="list-row stack">
              <div className="text-muted sub">{t('360° feedback of ')}{nom(c.empId)}</div>
              <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>« {c.verbatim} »</div>
              <div className="actions-end">
                <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={moderer(c, 'retire')}>{t('Do not pass on')}</button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={occupe} onClick={moderer(c, 'retenu')}>{t('Pass on')}</button>
              </div>
            </div>
          ))}
        </div>
      ) : <Empty>{t('No comment to review.')}</Empty>}
      <Fine>
        {t('Pass on a comment made of facts observed at work; do not pass on one about health, personal life, opinions, an insulting remark, or a detail that points to its author. The comment is never changed: it is passed on as it is or not at all. The comments about you are reviewed by another member of HR.')}
      </Fine>
    </Panel>

    <Panel title={t('Collections')} aside={tn(collectes.length, 'review#lower', 'reviews#lower')}>
      {collectes.length ? (
        <div className="list">
          {collectes.map(({ x, c, suivi, sols }) => {
            const s = lireSynthese360(x.syntheseFeedback);
            return (
              <div key={x.id} className="list-row stack">
                <div className="item-head">
                  <Ouvrir onOpen={() => openDialog({ type: 'ent', entId: x.id })}>{nom(x.empId)} · {ENT_TYPES[x.type].court}{t(' of #date')}{fmtIso(x.date)}</Ouvrir>
                  <Tag cls={c.ouverte ? 'tag-accent' : 'tag-outline'} style={{ flex: 'none' }}>{t(c.ouverte ? 'Collection in progress' : s ? 'Summary attached' : c.envoyees ? 'Collection closed' : 'To request')}</Tag>
                </div>
                <div className="text-muted sub">
                  {suivi.envoyees ? `${tn(suivi.reponses, 'feedback', 'feedbacks')} · ${tn(suivi.declinees, 'refusal', 'refusals')}${t(' out of ')}${suivi.envoyees}${t(' requested')}` : s ? `${tn(s.reponses, 'answer', 'answers')}${t(' out of ')}${s.envoyees}` : t('No request sent')}
                  {c.echeance ? ` · ${t('due on ')}${fmtIso(c.echeance)}` : ''}{c.proposees ? ` · ${tn(c.proposees, 'proposal to approve', 'proposals to approve')}` : ''}
                </div>
                {sols.length > 0 && (
                  <div className="text-muted sub">
                    {sols.map(y => `${nom(y.repondantEmpId)} (${RELATION_360_UN[y.relation].toLowerCase()}, ${STATUT_360_LABEL[y.statut].toLowerCase()})`).join(' · ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : <Empty>{t('No 360° feedback in progress. The reviewer asks the respondents from the report of an annual or mid-year review.')}</Empty>}
      <Fine>{t('HR sees who was asked and the number of feedbacks received, never who answered nor who said what: the answers are added in one block at the closing, without respondent or date.')}</Fine>
    </Panel>
  </>);
}
