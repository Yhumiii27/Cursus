// Paramètres → Mise en service : outil de référence après la reprise depuis Lucca (avertissement), lots importés et accès
// à l'écran Mise en service (pages/MiseEnService.tsx, imports réservés à l'administrateur RH). Service RH seulement.
import { plural } from '../../../../shared/format.ts';
import { REPRISES, type TypeReprise, TYPES_REPRISE } from '../../../../shared/rules/reprise.ts';
import { Fine, NoteAccent, Panel, Tag } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useData, useStore } from '../../state/store.tsx';
import type { SectionProps } from './commun.ts';

export function Reprise(_: SectionProps) {
  const data = useData();
  const { go } = useStore();
  const { rh, admin } = useRole();
  if (!rh) return null;
  const faits = TYPES_REPRISE.filter(t => data.reprises.some(l => l.type === t));
  const manquent = TYPES_REPRISE.filter(t => !faits.includes(t as TypeReprise));
  return (
    <Panel title="Mise en service" style={{ gap: 'var(--space-3)' }}
      aside={data.reprises.length ? <Tag cls="tag-neutral">{plural(data.reprises.length, 'lot importé', 'lots importés')}</Tag> : <Tag cls="tag-outline">Aucun import</Tag>}>
      <NoteAccent>
        Après la reprise depuis Lucca, Cursus fait foi pour la liste des salariés et pour les compteurs de
        congés : entrées, sorties, matricules et soldes se tiennent dans Cursus, plus dans Lucca.
      </NoteAccent>
      <Fine>
        {faits.length ? `Importé : ${faits.map(t => REPRISES[t].court).join(', ')}.` : 'Rien n’a encore été importé.'}
        {manquent.length ? ` Reste à importer : ${manquent.map(t => REPRISES[t].court).join(', ')}.` : ''} Date d’arrêté conseillée des soldes : 1er janvier 2027.
      </Fine>
      <div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => go('miseEnService')}>
          {admin ? 'Ouvrir la mise en service' : 'Consulter les lots importés'}
        </button>
      </div>
    </Panel>
  );
}
