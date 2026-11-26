// lot 12 — C3 (feedback 360°, étape 3) : « Avis demandés », espaces collaborateur et manager. La personne y voit les
// sollicitations où elle est répondante, et seulement celles-là : à donner (ou décliner) avant l'échéance, données
// (modifiables tant que la collecte est ouverte), déclinées, closes. Elle ne voit ni les autres répondants, ni les
// réponses, ni la synthèse. Rien ne se donne hors ligne : l'avis part au serveur ou pas du tout (jamais dans la file de
// l'appareil). Ouvert seulement le module activé (réglage `feedback360Actif`).
import { useMemo } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { RELATION_360_UN, TEXTE_CONFIDENTIALITE_360 } from '../../../shared/rules/feedback360.ts';
import type { Sollicitation360 } from '../../../shared/types.ts';
import { Empty, Fine, Page, Panel, Tag } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

export function AvisDemandes() {
  const d = useDomain();
  const { me } = useRole();
  const { openDialog, horsLigne } = useStore();
  const v = useMemo(() => {
    const siennes = (d.ds.feedbackSollicitations ?? []).filter(s => s.repondantEmpId === me && s.statut !== 'proposee' && s.statut !== 'annulee');
    const ouverte = (s: Sollicitation360) => !s.closeLe && (!s.echeance || s.echeance >= d.ti);
    const parEcheance = (a: Sollicitation360, b: Sollicitation360) => (a.echeance ?? '').localeCompare(b.echeance ?? '') || a.id - b.id;
    return {
      aDonner: siennes.filter(s => s.statut === 'envoyee' && ouverte(s)).sort(parEcheance),
      donnees: siennes.filter(s => s.statut === 'repondue' && ouverte(s)).sort(parEcheance),
      closes: siennes.filter(s => !ouverte(s) || s.statut === 'declinee').sort((a, b) => b.id - a.id),
    };
  }, [d, me]);
  const nom = (id: number) => d.ds.annuaire.find(p => p.id === id)?.nom ?? t('Colleague');
  const ligne = (s: Sollicitation360, action: string | null, etat: string, cls: string) => (
    <div key={s.id} className="list-row">
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14 }}>{nom(s.empId)}</div>
        <div className="text-muted sub">{t('As ')}{RELATION_360_UN[s.relation].toLowerCase()}{s.echeance ? ` · ${t('until ')}${fmtIso(s.echeance)}` : ''}</div>
      </div>
      <Tag cls={cls} style={{ flex: 'none' }}>{etat}</Tag>
      {action && (
        <button type="button" className="btn btn-secondary btn-sm" style={{ flex: 'none' }} disabled={!horsLigne.enLigne}
          onClick={() => openDialog({ type: 'avis360', id: s.id })}>{action}</button>
      )}
    </div>
  );

  return (
    <Page kicker={t('360° feedback')} title={t('Feedback requested')} note={t('Colleagues ask for your feedback on their work, for their review. Answering is optional: you may decline.')}>
      <Fine>{TEXTE_CONFIDENTIALITE_360}</Fine>
      {!horsLigne.enLigne && <Fine>{t('Offline: feedback is given while connected, it is never kept on the device.')}</Fine>}
      <Panel title={t('To give')} aside={tn(v.aDonner.length, 'feedback', 'feedbacks')}>
        {v.aDonner.length
          ? <div className="list">{v.aDonner.map(s => ligne(s, t('Give my feedback'), t('To give'), 'tag-accent'))}</div>
          : <Empty>{t('No feedback to give.')}</Empty>}
      </Panel>
      {v.donnees.length > 0 && (
        <Panel title={t('Given feedback')} aside={t('can be changed until the deadline')}>
          <div className="list">{v.donnees.map(s => ligne(s, t('Change my feedback'), t('Feedback given'), 'tag-neutral'))}</div>
        </Panel>
      )}
      {v.closes.length > 0 && (
        <Panel title={t('Closed')}>
          <div className="list">{v.closes.map(s => ligne(s, null, t(s.statut === 'declinee' ? 'Declined' : s.statut === 'repondue' ? 'Feedback filed' : 'Closed without answer'), 'tag-outline'))}</div>
        </Panel>
      )}
    </Page>
  );
}
