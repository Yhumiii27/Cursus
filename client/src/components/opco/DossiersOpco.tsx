// lot 11 — dossiers OPCO : onglet « Dossiers OPCO » de l'écran Plan & budget, pour l'exercice affiché (celui de l'action
// du plan, où les montants sont comptés). Indicateurs (demandé, accordé, facturé, reçu, à récupérer, refusé, taux de prise
// en charge et reste à charge, nombre de dossiers par état), dossiers en retard en tête, tableau filtrable par état, OPCO et dispositif, panneau de détail du
// dossier ouvert, ventilation par OPCO, dispositif, équipe et trimestre, versements d'une période et exports CSV
// (listes-csv.ts : CSV simple, sans export comptable — réponse de l'entreprise du 31 octobre 2026). Service RH en
// modification, lecture seule en consultation (sans motifs) ; le serveur contrôle tout de nouveau.
import { useMemo, useState } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { fmtEur, fmtIso, rel } from '../../../../shared/format.ts';
import {
  DISPOSITIFS_OPCO, echeanceOpco, type EcheanceOpco, LISTE_DISPOSITIFS, CODES_OPCO, montantsOpco, OPCOS, STATUTS_OPCO, syntheseOpco, versementsDeLaPeriode,
  type LigneSyntheseOpco,
} from '../../../../shared/rules/opco.ts';
import type { CodeOpco, DispositifOpco, DossierOpco, StatutOpco } from '../../../../shared/types.ts';
import { Ouvrir } from '../Cliquable.tsx';
import { Btn, Empty, Kpi, Kpis, Panel, Seg, Tag, Two } from '../ui.tsx';
import { usePanneauVisible } from '../panneau.ts';
import { csvOpco, csvVersementsOpco } from '../../listes-csv.ts';
import { downloadCsv } from '../../print.ts';
import { useDomain } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { CLS_OPCO, nomDossierOpco, passeFiltre } from './commun.ts';
import { DossierOpcoPanel } from './DossierOpcoPanel.tsx';
import { t, tn } from '../../i18n/langue.ts';

type Axe = 'opco' | 'dispositif' | 'equipe' | 'trimestre';
// Libellés : chaînes sources anglaises, traduites au rendu.
const AXES: [Axe, string][] = [['opco', 'OPCO'], ['dispositif', 'Scheme'], ['equipe', 'Team'], ['trimestre', 'Quarter']];

/** Échéance d'un dossier en une ligne : « Justificatifs à envoyer… · 12 nov. 2026 (dans 5 j) ». */
export const texteEcheance = (e: EcheanceOpco) => `${e.libelle} · ${fmtIso(e.echeance)} (${rel(e.jours)})`;

export function DossiersOpco({ exercice }: { exercice: number }) {
  const d = useDomain();
  const { ui, setUi, notify } = useStore();
  const s = d.ds.settings;
  const dossiers = useMemo(() => (d.ds.dossiersOpco ?? []).filter(x => !x.annuleLe), [d]);
  const versements = d.ds.versementsOpco;
  const syn = useMemo(() => syntheseOpco(exercice, dossiers, versements, d.ds.plan, s, d.ti), [exercice, dossiers, versements, d, s]);
  const [axe, setAxe] = useState<Axe>('opco');
  // Période des versements : l'exercice affiché jusqu'à aujourd'hui (fin de l'exercice s'il est passé) ; pour un exercice
  // futur, depuis le 1er janvier de l'année en cours, pour que le début ne tombe jamais après la fin. Budget.tsx remonte le
  // composant à chaque changement d'exercice (key), qui recalcule donc la période.
  const [du, setDu] = useState(() => [`${exercice}-01-01`, `${d.ti.slice(0, 4)}-01-01`].sort()[0]);
  const [au, setAu] = useState(() => [d.ti, `${exercice}-12-31`].sort()[0]);

  // Dossiers de l'exercice, avec leur échéance et leurs montants ; en retard d'abord (du plus ancien retard), puis en cours.
  const lignes = useMemo(() => dossiers.filter(x => x.exercice === exercice).map(x => ({
    x, e: echeanceOpco(x, versements, s, d.ti), m: montantsOpco(x, versements), nom: nomDossierOpco(d, x),
  })).sort((a, b) => Number(!!b.e?.retard) - Number(!!a.e?.retard) || (a.e?.retard && b.e?.retard ? a.e.echeance.localeCompare(b.e.echeance) : 0)
    || Number(STATUTS_OPCO[b.x.statut].enCours) - Number(STATUTS_OPCO[a.x.statut].enCours) || b.x.id - a.x.id), [dossiers, exercice, versements, s, d]);
  const retards = lignes.filter(l => l.e?.retard);
  const affichees = lignes.filter(l => passeFiltre(ui.opcoFiltre, l.x, !!l.e?.retard)
    && (!ui.opcoCode || l.x.opco === ui.opcoCode) && (!ui.opcoDispositif || l.x.dispositif === ui.opcoDispositif));
  const sel = lignes.find(l => l.x.id === ui.opcoSel)?.x ?? null;
  const panneau = usePanneauVisible<HTMLElement>(sel?.id);
  const ouvrir = (x: DossierOpco) => setUi({ opcoSel: ui.opcoSel === x.id ? null : x.id });
  // Listes des filtres : les OPCO et dispositifs présents sur l'exercice (et celui choisi, même absent).
  const codes = CODES_OPCO.filter(c => c === ui.opcoCode || lignes.some(l => l.x.opco === c));
  const dispositifs = LISTE_DISPOSITIFS.filter(c => c === ui.opcoDispositif || lignes.some(l => l.x.dispositif === c));
  const periode = versementsDeLaPeriode(versements, du, au).filter(v => dossiers.some(x => x.id === v.dossierId));
  const periodeErr = !du || !au ? t('Enter both dates.') : au < du ? t('The end comes before the start.') : null;
  const ventilation: LigneSyntheseOpco[] = { opco: syn.parOpco, dispositif: syn.parDispositif, equipe: syn.parEquipe, trimestre: syn.parTrimestre }[axe];
  const nomAxe = (cle: string) => (axe === 'opco' ? OPCOS[cle as CodeOpco] ?? cle : axe === 'dispositif' ? DISPOSITIFS_OPCO[cle as DispositifOpco]?.label ?? cle : cle);

  const exporterDossiers = () => {
    const x = csvOpco(d, exercice, affichees.map(l => l.x));
    downloadCsv(x.fichier, x.head, x.rows);
    notify(`${t('CSV export generated — ')}${tn(affichees.length, 'file#opco', 'files#opco')}`);
  };
  const exporterVersements = () => {
    if (periodeErr) return;
    const x = csvVersementsOpco(d, du, au, periode);
    downloadCsv(x.fichier, x.head, x.rows);
    notify(`${t('CSV export generated — ')}${tn(periode.length, 'payment', 'payments')}`);
  };

  return <>
    <Kpis>
      <Kpi kicker={t('Requested#masc')} value={fmtEur(syn.total.demande)} sub={`${tn(syn.total.dossiers, 'file#opco', 'files#opco')}${t(' over the financial year ')}${exercice}${syn.total.refuse ? ` · ${fmtEur(syn.total.refuse)}${t(' refused#plural')}` : ''}`} />
      <Kpi kicker={t('Granted')} value={fmtEur(syn.total.accorde)}
        sub={syn.tauxPriseEnCharge != null ? `${syn.tauxPriseEnCharge.toLocaleString('fr-FR')}${t(' % of the cost of the actions')} · ${t('remaining cost ')}${fmtEur(syn.resteACharge)}` : t('no action with a file in progress')} />
      <Kpi kicker={t('Received')} value={fmtEur(syn.total.recu)}
        sub={`${fmtEur(syn.total.facture)}${t(' invoiced to the OPCO')} · ${syn.total.attenduOrganisme ? `${fmtEur(syn.total.attenduOrganisme)}${t(' still expected by the providers (subrogation)')}` : t('company and providers (subrogation)')}`} />
      <Kpi kicker={t('To recover')} value={fmtEur(syn.total.aRecuperer)} sub={syn.retards ? tn(syn.retards, 'file late', 'files late') : t('no file late')} />
    </Kpis>
    {syn.total.dossiers > 0 && (
      <p className="fine text-muted">
        {t('Files by state: ')}{Object.entries(syn.parStatut).filter(([, n]) => n).map(([k, n]) => `${STATUTS_OPCO[k as StatutOpco].label} : ${n}`).join(' · ')}
      </p>
    )}

    {retards.length > 0 && (
      <Panel highlight title={t('Files late')} aside={tn(retards.length, 'due date passed', 'due dates passed')}>
        <div className="list">
          {retards.map(l => (
            <div key={l.x.id} className="list-row clickable" onClick={() => setUi({ opcoSel: l.x.id, opcoFiltre: 'tous' })}>
              <div className="grow">
                <div style={{ fontSize: 14 }}><Ouvrir onOpen={() => setUi({ opcoSel: l.x.id, opcoFiltre: 'tous' })}>{l.nom}</Ouvrir></div>
                <div className="text-muted sub">{texteEcheance(l.e!)}</div>
              </div>
              <Tag cls={CLS_OPCO[l.x.statut]} style={{ flex: 'none' }}>{STATUTS_OPCO[l.x.statut].label}</Tag>
            </div>
          ))}
        </div>
      </Panel>
    )}

    <div className="row-wrap">
      <Panel style={{ flex: '1 1 420px', minWidth: 0 }} head={
        <div className="panel-head center">
          <h2>{t('OPCO files ')}{exercice}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Seg name="opcoFiltre" label={t('State of the files')} value={ui.opcoFiltre}
              onChange={v => setUi({ opcoFiltre: v })} options={[['tous', t('All#everything')], ['en_cours', t('In progress')], ['retards', t('Late')], ['clos', t('Closed#plural')]]} />
            {codes.length > 1 && (
              <select className="input" aria-label="OPCO" value={ui.opcoCode ?? ''} onChange={e => setUi({ opcoCode: (e.target.value || null) as CodeOpco | null })} style={{ width: 'auto' }}>
                <option value="">{t('All OPCOs')}</option>
                {codes.map(c => <option key={c} value={c}>{OPCOS[c]}</option>)}
              </select>
            )}
            {dispositifs.length > 1 && (
              <select className="input" aria-label={t('Scheme')} value={ui.opcoDispositif ?? ''} onChange={e => setUi({ opcoDispositif: (e.target.value || null) as DispositifOpco | null })} style={{ width: 'auto', maxWidth: 260 }}>
                <option value="">{t('All schemes')}</option>
                {dispositifs.map(c => <option key={c} value={c}>{DISPOSITIFS_OPCO[c].label}</option>)}
              </select>
            )}
            {affichees.length > 0 && <Btn variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={exporterDossiers}>{t('Export (CSV)')}</Btn>}
          </div>
        </div>
      }>
        {affichees.length > 0 && (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Action of the plan')}</th><th>{t('State')}</th><th className="right">{t('Requested#masc')}</th><th className="right">{t('Granted')}</th><th className="right">{t('Received')}</th><th className="right">{t('To recover')}</th></tr></thead>
              <tbody>
                {affichees.map(({ x, e, m, nom }) => (
                  <tr key={x.id} className="clickable" onClick={() => ouvrir(x)}
                    style={{ backgroundColor: ui.opcoSel === x.id ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : undefined }}>
                    <td style={{ minWidth: 200 }}>
                      <div><Ouvrir pressed={ui.opcoSel === x.id} onOpen={() => ouvrir(x)}>{nom}</Ouvrir></div>
                      <div className="text-muted sub">{OPCOS[x.opco]} · {DISPOSITIFS_OPCO[x.dispositif].label}{x.reference ? ` · ${x.reference}` : ''}{x.subrogation ? ` · ${t('subrogation')}` : ''}</div>
                    </td>
                    <td>
                      <Tag cls={CLS_OPCO[x.statut]}>{STATUTS_OPCO[x.statut].label}</Tag>
                      {e && <div className={`sub nowrap${e.retard ? '' : ' text-muted'}`} style={e.retard ? { color: 'var(--color-accent-300)' } : undefined}>{fmtIso(e.echeance)} · {rel(e.jours)}</div>}
                    </td>
                    <td className="right tnum nowrap">{fmtEur(m.demande)}</td>
                    <td className="right tnum nowrap">{x.accordLe ? fmtEur(m.accorde) : '—'}</td>
                    <td className="right tnum nowrap">{fmtEur(m.recuEntreprise + m.payeOrganisme)}</td>
                    <td className="right tnum nowrap">{x.subrogation ? (m.attenduOrganisme ? <Two main={fmtEur(m.attenduOrganisme)} sub={t('to the provider')} /> : '—') : m.aRecuperer ? fmtEur(m.aRecuperer) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {lignes.length > 0 && affichees.length === 0 && <Empty pad="sm">{t('No file with these filters.')}</Empty>}
        {lignes.length === 0 && (
          <Empty pad="sm">
            {t('No OPCO file in the financial year ')}{exercice}{t('. A file is created from its line of the plan (Plan & budget tab, OPCO column): it follows the funding request, from its filing to its settlement.')}
          </Empty>
        )}
      </Panel>
      {sel && <DossierOpcoPanel panneau={panneau} dossier={sel} onClose={() => setUi({ opcoSel: null })} />}
    </div>

    {lignes.length > 0 && (
      <Panel title={t('Breakdown')} aside={<Seg name="opcoAxe" label={t('Breakdown by')} value={axe} onChange={setAxe} options={AXES.map(([k, l]) => [k, t(l)] as [Axe, string])} style={{ flexWrap: 'wrap' }} />}>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>{t(AXES.find(a => a[0] === axe)![1])}</th><th className="right">{t('Files#opco')}</th><th className="right">{t('Requested#masc')}</th><th className="right">{t('Granted')}</th><th className="right">{t('Invoiced')}</th><th className="right">{t('Received')}</th><th className="right">{t('To recover')}</th></tr></thead>
            <tbody>
              {ventilation.map(v => (
                <tr key={v.cle}>
                  <td>{nomAxe(v.cle)}</td>
                  <td className="right tnum">{v.dossiers}</td>
                  <td className="right tnum nowrap">{fmtEur(v.demande)}</td>
                  <td className="right tnum nowrap">{fmtEur(v.accorde)}</td>
                  <td className="right tnum nowrap">{fmtEur(v.facture)}</td>
                  <td className="right tnum nowrap">{fmtEur(v.recu)}</td>
                  <td className="right tnum nowrap">{fmtEur(v.aRecuperer + v.attenduOrganisme)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    )}

    <Panel head={
      <div className="panel-head center">
        <h2>{t('Payments of the OPCO')}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <label className="text-muted sub" htmlFor="opco-periode-du">{t('From#date')}</label>
          <input className="input" id="opco-periode-du" type="date" value={du} onChange={e => setDu(e.target.value)} style={{ width: 'auto' }} aria-invalid={periodeErr ? true : undefined} />
          <label className="text-muted sub" htmlFor="opco-periode-au">{t('to#date')}</label>
          <input className="input" id="opco-periode-au" type="date" value={au} onChange={e => setAu(e.target.value)} style={{ width: 'auto' }} aria-invalid={periodeErr ? true : undefined} />
          {!periodeErr && periode.length > 0 && <Btn variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={exporterVersements}>{t('Export (CSV)')}</Btn>}
        </div>
      </div>
    }>
      {periodeErr && <p className="field-erreur">{periodeErr}</p>}
      {!periodeErr && periode.length > 0 && (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>{t('Paid on')}</th><th>{t('File#opco')}</th><th>{t('Paid to')}</th><th>{t('Reference')}</th><th className="right">{t('Amount')}</th></tr></thead>
            <tbody>
              {periode.map(v => {
                const x = dossiers.find(y => y.id === v.dossierId)!;
                return (
                  <tr key={v.id}>
                    <td className="nowrap">{fmtIso(v.le)}</td>
                    <td><Two main={nomDossierOpco(d, x)} sub={`${OPCOS[x.opco]}${x.reference ? ` · ${x.reference}` : ''} · ${t('financial year ')}${x.exercice}`} /></td>
                    <td className="nowrap">{t(v.destinataire === 'organisme' ? 'Provider' : 'Company')}</td>
                    <td className="nowrap">{v.reference ?? '—'}</td>
                    <td className="right tnum nowrap">{fmtEur(v.montant)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!periodeErr && periode.length === 0 && <Empty pad="sm">{t('No payment of the OPCO over this period.')}</Empty>}
      <p className="fine text-muted">
        {t('Payments received over the period, all financial years together (date of receipt), for the reconciliation with the accounts. Amounts of the indicators above: counted in the financial year of the action of the plan. Delays of the due dates: Settings → OPCO files (to confirm with the conditions of the OPCO).')}
      </p>
    </Panel>
  </>;
}
