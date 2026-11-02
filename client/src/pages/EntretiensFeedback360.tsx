// lot 12 — C3 (feedback 360°, étape 3) : onglet « Feedback 360° » de l'écran Entretiens, service RH seulement (droit
// « rh »), le module activé :
// - commentaires à relire avant leur restitution (GET /api/feedback360/moderation : le commentaire seul, sans relation de
//   son auteur ni notes, jamais sur soi-même) : « Restituer » ou « Ne pas restituer » (`feedback360.moderer`) ; la synthèse
//   de l'entretien est recalculée aussitôt ;
// - collectes des entretiens : répondants et état de chaque sollicitation (le service RH suit la participation ; il ne
//   sait jamais qui a dit quoi : les réponses sont versées d'un bloc, sans répondant), sauf pour sa propre collecte ;
//   ouverture du compte rendu, où l'évaluateur relance et clôt.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ENT_TYPES } from '../../../shared/constants.ts';
import { fmtIso, plural } from '../../../shared/format.ts';
import { collecte360, lireSynthese360, RELATION_360_UN, sollicitationMasquee, STATUT_360_LABEL } from '../../../shared/rules/feedback360.ts';
import { api, type Commentaire360 } from '../api.ts';
import { Ouvrir } from '../components/Cliquable.tsx';
import { Empty, Fine, Panel, Tag } from '../components/ui.tsx';
import { useAgir } from '../state/actions.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function OngletFeedback360() {
  const d = useDomain();
  const { soi } = useRole();
  const { openDialog, run, notify } = useStore();
  const { occupe, agir } = useAgir();
  const [commentaires, setCommentaires] = useState<Commentaire360[] | null>(null);
  const relire = useCallback(() => {
    api.moderation360().then(r => setCommentaires(r.commentaires)).catch(() => notify('Les commentaires à relire n’ont pas pu être lus : réessayez', true));
  }, [notify]);
  // Relus à l'ouverture de l'onglet et après chaque changement de l'instantané (une clôture verse de nouveaux commentaires).
  useEffect(() => { relire(); }, [relire, d.ds.revision]);

  const collectes = useMemo(() => {
    const ids = [...new Set((d.ds.feedbackSollicitations ?? []).map(s => s.entretienId))];
    const synth = d.ds.entretiens.filter(x => x.syntheseFeedback && !ids.includes(x.id)).map(x => x.id);
    return [...ids, ...synth].flatMap(id => {
      const x = d.ds.entretiens.find(y => y.id === id);
      return x ? [{ x, c: collecte360(d.ds.feedbackSollicitations ?? [], id), sols: (d.ds.feedbackSollicitations ?? []).filter(s => s.entretienId === id && s.statut !== 'annulee') }] : [];
    }).sort((a, b) => Number(b.c.ouverte) - Number(a.c.ouverte) || b.x.date.localeCompare(a.x.date));
  }, [d]);
  const nom = (id: number) => d.ds.annuaire.find(p => p.id === id)?.nom ?? d.emp(id)?.nom ?? 'Salarié';
  const aRelire = (commentaires ?? []).filter(c => c.statut === 'a_moderer');
  const moderer = (c: Commentaire360, decision: 'retenu' | 'retire') => agir(async () => {
    const r = await run('feedback360.moderer', { id: c.id, decision });
    if (r.ok) relire();
  });

  return (<>
    <Panel title="Commentaires à relire" aside={commentaires ? plural(aRelire.length, 'commentaire', 'commentaires') : 'lecture…'} highlight={aRelire.length > 0}>
      {aRelire.length ? (
        <div className="list">
          {aRelire.map(c => (
            <div key={c.id} className="list-row stack">
              <div className="text-muted sub">Feedback 360° de {nom(c.empId)}</div>
              <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>« {c.verbatim} »</div>
              <div className="actions-end">
                <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={moderer(c, 'retire')}>Ne pas restituer</button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={occupe} onClick={moderer(c, 'retenu')}>Restituer</button>
              </div>
            </div>
          ))}
        </div>
      ) : <Empty>Aucun commentaire à relire.</Empty>}
      <Fine>
        Restituez un commentaire fait de faits observés au travail ; ne restituez pas celui qui porte sur la santé, la vie personnelle, des opinions, un propos
        injurieux, ou un détail qui désigne son auteur. Le commentaire n’est jamais modifié : il est restitué tel quel ou pas du tout. Les commentaires qui vous
        concernent sont relus par un autre membre du service RH.
      </Fine>
    </Panel>

    <Panel title="Collectes" aside={plural(collectes.length, 'entretien', 'entretiens')}>
      {collectes.length ? (
        <div className="list">
          {collectes.map(({ x, c, sols }) => {
            const propre = x.empId === soi;
            const s = lireSynthese360(x.syntheseFeedback);
            return (
              <div key={x.id} className="list-row stack">
                <div className="item-head">
                  <Ouvrir onOpen={() => openDialog({ type: 'ent', entId: x.id })}>{nom(x.empId)} · {ENT_TYPES[x.type].court} du {fmtIso(x.date)}</Ouvrir>
                  <Tag cls={c.ouverte ? 'tag-accent' : 'tag-outline'} style={{ flex: 'none' }}>{c.ouverte ? 'Collecte en cours' : s ? 'Synthèse jointe' : c.envoyees ? 'Collecte close' : 'À solliciter'}</Tag>
                </div>
                <div className="text-muted sub">
                  {c.envoyees ? `${plural(c.reponses, 'avis', 'avis')} · ${plural(c.declinees, 'refus', 'refus')} sur ${c.envoyees} sollicités` : s ? `${plural(s.reponses, 'réponse', 'réponses')} sur ${s.envoyees}` : 'Aucune sollicitation envoyée'}
                  {c.echeance ? ` · échéance le ${fmtIso(c.echeance)}` : ''}{c.proposees ? ` · ${plural(c.proposees, 'proposition à valider', 'propositions à valider')}` : ''}
                </div>
                {sols.length > 0 && (
                  <div className="text-muted sub">
                    {(propre ? sols.map(sollicitationMasquee) : sols).map(y => `${nom(y.repondantEmpId)} (${RELATION_360_UN[y.relation].toLowerCase()}, ${STATUT_360_LABEL[y.statut].toLowerCase()})`).join(' · ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : <Empty>Aucun feedback 360° en cours. L’évaluateur sollicite les répondants depuis le compte rendu d’un entretien annuel ou de mi-année.</Empty>}
      <Fine>Le service RH suit la participation ; il ne sait jamais qui a dit quoi : les réponses sont versées d’un bloc à la clôture, sans répondant ni date.</Fine>
    </Panel>
  </>);
}
