// Échéances : renouvellements des 12 prochains mois (certifications, habilitations, visites médicales, formalités de voyage),
// exigences des postes et des équipes jamais obtenues, parmi les dépassées (shared/rules/exigences.ts), et échéances du
// contrat (fin d'essai avant le délai de prévenance, fin de CDD, de mission, d'alternance, titre de séjour).
import { useMemo } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { RANK } from '../../../shared/constants.ts';
import type { EchItem } from '../../../shared/domain.ts';
import { cap, equipeLabel, monthShort } from '../../../shared/format.ts';
import { parNombre, parTexte, trier, useTri, type Colonne } from '../components/tri.ts';
import { ThTri } from '../components/TriListe.tsx';
import { Btn, Empty, Page, Panel, Seg } from '../components/ui.tsx';
import { downloadCsv } from '../print.ts';
import { useEnriched, useIntentPermis } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { EchRow } from './Dashboard.tsx';
import { CouverturePanel } from '../components/Couverture.tsx';
// lot 11 — indicateurs
import { IndicateursACompleter } from '../components/IndicateursACompleter.tsx';
// lot 11 — dossiers OPCO
import { EcheancesOpcoPanel } from '../components/opco/EcheancesOpco.tsx';
import { useRole } from '../state/derived.ts';
import { t, tn } from '../i18n/langue.ts';

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
  // `?type=dossiers-opco` lu dans l'adresse pour un profil qui ne voit pas les dossiers (lien partagé) : « Tout ».
  const echType = voitOpco || ui.echType !== 'opco' ? ui.echType : 'tous';
  const horsSalaries = echType === 'couverture' || echType === 'opco';

  const v = useMemo(() => {
    const list = d.echeances(emps, horizon)
      .filter(x => echType === 'tous' || x.kind === echType)
      // Propositions d'action réservées aux profils qui peuvent les lancer (aucune en lecture seule).
      .map(x => !x.action || permis(x.action.intent) ? x : { ...x, action: null });
    const exp = list.filter(x => x.key === 'exp').sort((a, b) => a.d - b.d);
    const auj = d.today;
    const months = Array.from({ length: 12 }, (_, i) => {
      const m = new Date(auj.getFullYear(), auj.getMonth() + i, 1);
      const end = new Date(m.getFullYear(), m.getMonth() + 1, 1);
      const from = i === 0 ? auj : m;
      // Un titre suspendu ou retiré aujourd'hui (non valide, échéance du jour) reste parmi les dépassées.
      return { m, items: list.filter(x => x.exp >= from && x.exp < end && !(x.key === 'exp' && x.d <= 0)).sort((a, b) => a.d - b.d) };
    });
    const max = Math.max(1, ...months.map(m => m.items.length));
    const year = months.reduce((n, m) => n + m.items.length, 0);
    const groups = [
      ...(exp.length ? [{ key: 'exp', label: t('Overdue#fem-plural'), count: tn(exp.length, 'due date', 'due dates'), items: exp }] : []),
      ...months.filter(m => m.items.length).map(m => ({
        key: `${m.m.getFullYear()}-${m.m.getMonth()}`, label: cap(m.m.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })),
        count: tn(m.items.length, 'renewal', 'renewals'), items: m.items,
      })),
    ];
    return { months, max, year, exp: exp.length, groups };
  }, [d, emps, horizon, echType, permis]);
  // Tri par colonne (t145) dans chaque groupe (dépassées, puis mois) : par échéance tant qu'aucun en-tête n'est cliqué.
  // L'export suit l'ordre affiché.
  const tri = useTri('echeances');
  const groups = useMemo(() => v.groups.map(g => ({ ...g, items: trier(g.items, COLONNES, tri.tri) })), [v.groups, tri.tri]);

  const exportCsv = () => {
    const items = groups.flatMap(g => g.items);
    downloadCsv(`echeances-${d.ti}.csv`, ['Collaborateur', 'Équipe', 'Élément', 'Type', 'Échéance', 'Statut', 'Planifié'],
      items.map(x => [x.emp.nom, equipeLabel(x.emp), x.label, x.kindLabel, x.sansDate ? '' : dmy(x.exp), x.statut, x.planned ? x.plannedLabel : '']));
    notify(`${t('CSV export generated — ')}${tn(items.length, 'due date', 'due dates')}`);
  };

  return (
    <Page
      kicker={`${t('Next 12 months · ')}${tn(v.year, 'renewal', 'renewals')} · ${tn(v.exp, 'overdue', 'overdue#plural')}`}
      title={t('Due dates')}
      actions={<>
        <Seg name="echType" label={t('Type of due date')} value={echType} onChange={x => setUi({ echType: x })}
          options={[['tous', t('All#tout')], ['cert', t('Certifications')], ['hab', t('Authorisations')], ['med', t('Medical visits')], ['exigence', t('Requirements')], ['trip', t('Trips')], ['contrat', t('Contracts')], ['couverture', t('Coverage')],
            ...(voitOpco ? [['opco', t('OPCO files')] as ['opco', string]] : [])]} />
        {/* Filtre « Couverture » : le panneau par équipe seul ; ni export ni graphique, qui portent sur les échéances des salariés. */}
        {!horsSalaries && <Btn variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={exportCsv}>{t('Export (CSV)')}</Btn>}
      </>}
    >
      {/* lot 11 — indicateurs : échéance agrégée du service RH (fiches sans sexe ou catégorie), une seule ligne. */}
      {ui.echType === 'tous' && <IndicateursACompleter />}
      {/* Couverture minimale des équipes (SST, EPI incendie) : par équipe, à part des échéances de chaque salarié. */}
      {(echType === 'tous' || echType === 'couverture') && <CouverturePanel />}

      {/* lot 11 — dossiers OPCO */}
      {(echType === 'tous' || echType === 'opco') && voitOpco && <EcheancesOpcoPanel />}

      {!horsSalaries && <Panel title={t('Renewals per month')} style={{ gap: 'var(--space-4)' }}>
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

      {echType !== 'opco' && <Panel style={{ gap: 'var(--space-2)' }}>
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
                  <ThTri t={tri} col="nom">{t('Employee')}</ThTri>
                  <ThTri t={tri} col="element">{t('Item')}</ThTri>
                  <ThTri t={tri} col="echeance">{t('Due date')}</ThTri>
                  <ThTri t={tri} col="statut" premier="desc">{t('Status')}</ThTri>
                  <th><span className="sr-only">{t('Action')}</span></th>
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
        {v.groups.length === 0 && <Empty pad="sm">{echType === 'couverture' ? t('Minimum coverage of the teams: the thresholds not met appear above (Reference data → Jobs to enter them).') : t('No due date over the next 12 months.')}</Empty>}
      </Panel>}
    </Page>
  );
}
