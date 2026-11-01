// Échéances : renouvellements des 12 prochains mois (certifications, habilitations, visites médicales, formalités de voyage),
// exigences des postes et des équipes jamais obtenues, parmi les dépassées (shared/rules/exigences.ts), et échéances du
// contrat (fin d'essai avant le délai de prévenance, fin de CDD, de mission, d'alternance, titre de séjour).
import { useMemo } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { RANK } from '../../../shared/constants.ts';
import type { EchItem } from '../../../shared/domain.ts';
import { cap, equipeLabel, monthShort, plural } from '../../../shared/format.ts';
import { parNombre, parTexte, trier, useTri, type Colonne } from '../components/tri.ts';
import { ThTri } from '../components/TriListe.tsx';
import { Btn, Empty, Page, Panel, Seg } from '../components/ui.tsx';
import { downloadCsv } from '../print.ts';
import { useEnriched, useIntentPermis } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { EchRow } from './Dashboard.tsx';
import { CouverturePanel } from '../components/Couverture.tsx';
// lot 11 — dossiers OPCO
import { EcheancesOpcoPanel } from '../components/opco/EcheancesOpco.tsx';
import { useRole } from '../state/derived.ts';

/** Colonnes triables des échéances ; « Statut » : dépassées d'abord. */
const COLONNES: Record<string, Colonne<EchItem>> = {
  nom: parTexte(x => x.emp.nom),
  element: parTexte(x => x.label),
  echeance: parNombre(x => x.d),
  statut: parNombre(x => RANK[x.key], 'desc'),
};

const dmy = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function Echeances() {
  const { emps, horizon, d } = useEnriched();
  const permis = useIntentPermis();
  const { ui, setUi, go, runIntent, notify } = useStore();
  // lot 11 — dossiers OPCO : échéances des dossiers (service RH, lecture seule), à part des échéances par salarié.
  const { rh, consultation } = useRole();
  const voitOpco = rh || consultation;
  const horsSalaries = ui.echType === 'couverture' || ui.echType === 'opco';

  const v = useMemo(() => {
    const list = d.echeances(emps, horizon)
      .filter(x => ui.echType === 'tous' || x.kind === ui.echType)
      // Propositions d'action réservées aux profils qui peuvent les lancer (aucune en lecture seule).
      .map(x => !x.action || permis(x.action.intent) ? x : { ...x, action: null });
    const exp = list.filter(x => x.key === 'exp').sort((a, b) => a.d - b.d);
    const t = d.today;
    const months = Array.from({ length: 12 }, (_, i) => {
      const m = new Date(t.getFullYear(), t.getMonth() + i, 1);
      const end = new Date(m.getFullYear(), m.getMonth() + 1, 1);
      const from = i === 0 ? t : m;
      // Un titre suspendu ou retiré aujourd'hui (non valide, échéance du jour) reste parmi les dépassées.
      return { m, items: list.filter(x => x.exp >= from && x.exp < end && !(x.key === 'exp' && x.d <= 0)).sort((a, b) => a.d - b.d) };
    });
    const max = Math.max(1, ...months.map(m => m.items.length));
    const year = months.reduce((n, m) => n + m.items.length, 0);
    const groups = [
      ...(exp.length ? [{ key: 'exp', label: 'Dépassées', count: plural(exp.length, 'échéance', 'échéances'), items: exp }] : []),
      ...months.filter(m => m.items.length).map(m => ({
        key: `${m.m.getFullYear()}-${m.m.getMonth()}`, label: cap(m.m.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })),
        count: plural(m.items.length, 'renouvellement', 'renouvellements'), items: m.items,
      })),
    ];
    return { months, max, year, exp: exp.length, groups };
  }, [d, emps, horizon, ui.echType, permis]);
  // Tri par colonne (t145) dans chaque groupe (dépassées, puis mois) : par échéance tant qu'aucun en-tête n'est cliqué.
  // L'export suit l'ordre affiché.
  const t = useTri('echeances');
  const groups = useMemo(() => v.groups.map(g => ({ ...g, items: trier(g.items, COLONNES, t.tri) })), [v.groups, t.tri]);

  const exportCsv = () => {
    const items = groups.flatMap(g => g.items);
    downloadCsv(`echeances-${d.ti}.csv`, ['Collaborateur', 'Équipe', 'Élément', 'Type', 'Échéance', 'Statut', 'Planifié'],
      items.map(x => [x.emp.nom, equipeLabel(x.emp), x.label, x.kindLabel, x.sansDate ? '' : dmy(x.exp), x.statut, x.planned ? x.plannedLabel : '']));
    notify(`Export CSV généré — ${plural(items.length, 'échéance', 'échéances')}`);
  };

  return (
    <Page
      kicker={`12 prochains mois · ${plural(v.year, 'renouvellement', 'renouvellements')} · ${plural(v.exp, 'dépassé', 'dépassés')}`}
      title="Échéances"
      actions={<>
        <Seg name="echType" label="Type d’échéance" value={ui.echType} onChange={x => setUi({ echType: x })}
          options={[['tous', 'Tout'], ['cert', 'Certifications'], ['hab', 'Habilitations'], ['med', 'Visites médicales'], ['exigence', 'Exigences'], ['trip', 'Voyages'], ['contrat', 'Contrats'], ['couverture', 'Couverture'],
            ...(voitOpco ? [['opco', 'Dossiers OPCO'] as ['opco', string]] : [])]} />
        {/* Filtre « Couverture » : le panneau par équipe seul ; ni export ni graphique, qui portent sur les échéances des salariés. */}
        {!horsSalaries && <Btn variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={exportCsv}>Exporter (CSV)</Btn>}
      </>}
    >
      {/* Couverture minimale des équipes (SST, EPI incendie) : par équipe, à part des échéances de chaque salarié. */}
      {(ui.echType === 'tous' || ui.echType === 'couverture') && <CouverturePanel />}

      {/* lot 11 — dossiers OPCO */}
      {(ui.echType === 'tous' || ui.echType === 'opco') && voitOpco && <EcheancesOpcoPanel />}

      {!horsSalaries && <Panel title="Renouvellements par mois" style={{ gap: 'var(--space-4)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 8, alignItems: 'end', height: 156 }}>
          {v.months.map((m, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 6, height: '100%' }}>
              <span className="sub tnum muted-70">{m.items.length}</span>
              <div style={{
                width: '100%', maxWidth: 40, borderRadius: 'var(--radius-sm) var(--radius-sm) 2px 2px',
                height: m.items.length ? Math.max(6, Math.round(m.items.length / v.max * 96)) : 2,
                background: i === 0 ? 'var(--color-accent-300)' : 'var(--color-accent-800)',
              }} />
              <span className="text-muted sub-11" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>{monthShort(m.m)}</span>
            </div>
          ))}
        </div>
      </Panel>}

      {ui.echType !== 'opco' && <Panel style={{ gap: 'var(--space-2)' }}>
        {groups.map(g => (
          <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
              <h2 className="section-label" style={{ fontSize: 13 }}>{g.label}</h2>
              <span className="text-muted sub">{g.count}</span>
            </div>
            <div className="scroll-x">
              <table className="table">
                <colgroup><col style={{ width: '26%' }} /></colgroup>
                <thead><tr>
                  <ThTri t={t} col="nom">Collaborateur</ThTri>
                  <ThTri t={t} col="element">Élément</ThTri>
                  <ThTri t={t} col="echeance">Échéance</ThTri>
                  <ThTri t={t} col="statut" premier="desc">Statut</ThTri>
                  <th><span className="sr-only">Action</span></th>
                </tr></thead>
                <tbody>
                  {g.items.map((x, i) => (
                    <EchRow key={`${x.kind}-${x.emp.id}-${x.label}-${i}`} x={x}
                      onOpen={() => go('collaborateurs', { selectedId: x.emp.id })} onAct={() => x.action && runIntent(x.action.intent)} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {v.groups.length === 0 && <Empty pad="sm">{ui.echType === 'couverture' ? 'Couverture minimale des équipes : les seuils non tenus figurent ci-dessus (Référentiels → Postes pour les saisir).' : 'Aucune échéance sur les 12 prochains mois.'}</Empty>}
      </Panel>}
    </Page>
  );
}
