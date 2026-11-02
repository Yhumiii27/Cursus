// lot 12 — C3 (feedback 360°, étape 3) : « Avis demandés », espaces collaborateur et manager. La personne y voit les
// sollicitations où elle est répondante, et seulement celles-là : à donner (ou décliner) avant l'échéance, données
// (modifiables tant que la collecte est ouverte), déclinées, closes. Elle ne voit ni les autres répondants, ni les
// réponses, ni la synthèse. Rien ne se donne hors ligne : l'avis part au serveur ou pas du tout (jamais dans la file de
// l'appareil). Ouvert seulement le module activé (réglage `feedback360Actif`).
import { useMemo } from 'react';
import { fmtIso, plural } from '../../../shared/format.ts';
import { RELATION_360_UN, TEXTE_CONFIDENTIALITE_360 } from '../../../shared/rules/feedback360.ts';
import type { Sollicitation360 } from '../../../shared/types.ts';
import { Empty, Fine, Page, Panel, Tag } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

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
  const nom = (id: number) => d.ds.annuaire.find(p => p.id === id)?.nom ?? 'Collègue';
  const ligne = (s: Sollicitation360, action: string | null, etat: string, cls: string) => (
    <div key={s.id} className="list-row">
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14 }}>{nom(s.empId)}</div>
        <div className="text-muted sub">Comme {RELATION_360_UN[s.relation].toLowerCase()}{s.echeance ? ` · jusqu’au ${fmtIso(s.echeance)}` : ''}</div>
      </div>
      <Tag cls={cls} style={{ flex: 'none' }}>{etat}</Tag>
      {action && (
        <button type="button" className="btn btn-secondary btn-sm" style={{ flex: 'none' }} disabled={!horsLigne.enLigne}
          onClick={() => openDialog({ type: 'avis360', id: s.id })}>{action}</button>
      )}
    </div>
  );

  return (
    <Page kicker="Feedback 360°" title="Avis demandés" note="Des collègues vous demandent un avis sur leur travail, pour leur entretien. Répondre est facultatif : vous pouvez décliner.">
      <Fine>{TEXTE_CONFIDENTIALITE_360}</Fine>
      {!horsLigne.enLigne && <Fine>Hors ligne : un avis se donne connecté, il n’est jamais gardé sur l’appareil.</Fine>}
      <Panel title="À donner" aside={plural(v.aDonner.length, 'avis', 'avis')}>
        {v.aDonner.length
          ? <div className="list">{v.aDonner.map(s => ligne(s, 'Donner mon avis', 'À donner', 'tag-accent'))}</div>
          : <Empty>Aucun avis à donner.</Empty>}
      </Panel>
      {v.donnees.length > 0 && (
        <Panel title="Avis donnés" aside="modifiables jusqu’à l’échéance">
          <div className="list">{v.donnees.map(s => ligne(s, 'Modifier mon avis', 'Avis donné', 'tag-neutral'))}</div>
        </Panel>
      )}
      {v.closes.length > 0 && (
        <Panel title="Terminés">
          <div className="list">{v.closes.map(s => ligne(s, null, s.statut === 'declinee' ? 'Décliné' : s.statut === 'repondue' ? 'Avis versé' : 'Clos sans réponse', 'tag-outline'))}</div>
        </Panel>
      )}
    </Page>
  );
}
