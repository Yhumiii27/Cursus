// lot 11 — dossiers OPCO : onglet « Dossiers OPCO » de l'écran Plan & budget, pour l'exercice affiché (celui de l'action
// du plan, où les montants sont comptés). Indicateurs (demandé, accordé, reçu, à récupérer, taux de prise en charge et
// reste à charge), dossiers en retard en tête, tableau filtrable par état, OPCO et dispositif, panneau de détail du
// dossier ouvert, ventilation par OPCO, dispositif, équipe et trimestre, versements d'une période et exports CSV
// (listes-csv.ts : CSV simple, sans export comptable — réponse de l'entreprise du 31 octobre 2026). Service RH en
// modification, lecture seule en consultation (sans motifs) ; le serveur contrôle tout de nouveau.
import { useMemo, useState } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { fmtEur, fmtIso, plural, rel } from '../../../../shared/format.ts';
import {
  DISPOSITIFS_OPCO, echeanceOpco, type EcheanceOpco, LISTE_DISPOSITIFS, CODES_OPCO, montantsOpco, OPCOS, STATUTS_OPCO, syntheseOpco, versementsDeLaPeriode,
  type LigneSyntheseOpco,
} from '../../../../shared/rules/opco.ts';
import type { CodeOpco, DispositifOpco, DossierOpco } from '../../../../shared/types.ts';
import { Ouvrir } from '../Cliquable.tsx';
import { Btn, Empty, Kpi, Kpis, Panel, Seg, Tag, Two } from '../ui.tsx';
import { usePanneauVisible } from '../panneau.ts';
import { csvOpco, csvVersementsOpco } from '../../listes-csv.ts';
import { downloadCsv } from '../../print.ts';
import { useDomain } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { CLS_OPCO, nomDossierOpco, passeFiltre } from './commun.ts';
import { DossierOpcoPanel } from './DossierOpcoPanel.tsx';

type Axe = 'opco' | 'dispositif' | 'equipe' | 'trimestre';
const AXES: [Axe, string][] = [['opco', 'OPCO'], ['dispositif', 'Dispositif'], ['equipe', 'Équipe'], ['trimestre', 'Trimestre']];

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
  const [du, setDu] = useState(`${exercice}-01-01`);
  const [au, setAu] = useState(d.ti);

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
  const periodeErr = !du || !au ? 'Indiquez les deux dates.' : au < du ? 'La fin précède le début.' : null;
  const ventilation: LigneSyntheseOpco[] = { opco: syn.parOpco, dispositif: syn.parDispositif, equipe: syn.parEquipe, trimestre: syn.parTrimestre }[axe];
  const nomAxe = (cle: string) => (axe === 'opco' ? OPCOS[cle as CodeOpco] ?? cle : axe === 'dispositif' ? DISPOSITIFS_OPCO[cle as DispositifOpco]?.label ?? cle : cle);

  const exporterDossiers = () => {
    const x = csvOpco(d, exercice, affichees.map(l => l.x));
    downloadCsv(x.fichier, x.head, x.rows);
    notify(`Export CSV généré — ${plural(affichees.length, 'dossier', 'dossiers')}`);
  };
  const exporterVersements = () => {
    if (periodeErr) return;
    const x = csvVersementsOpco(d, du, au, periode);
    downloadCsv(x.fichier, x.head, x.rows);
    notify(`Export CSV généré — ${plural(periode.length, 'versement', 'versements')}`);
  };

  return <>
    <Kpis>
      <Kpi kicker="Demandé" value={fmtEur(syn.total.demande)} sub={`${plural(syn.total.dossiers, 'dossier', 'dossiers')} sur l’exercice ${exercice}${syn.total.refuse ? ` · ${fmtEur(syn.total.refuse)} refusés` : ''}`} />
      <Kpi kicker="Accordé" value={fmtEur(syn.total.accorde)}
        sub={syn.tauxPriseEnCharge != null ? `${syn.tauxPriseEnCharge.toLocaleString('fr-FR')} % du coût des actions · reste à charge ${fmtEur(syn.resteACharge)}` : 'aucune action avec un dossier en cours'} />
      <Kpi kicker="Reçu" value={fmtEur(syn.total.recu)} sub={syn.total.attenduOrganisme ? `${fmtEur(syn.total.attenduOrganisme)} encore attendus par les organismes (subrogation)` : 'entreprise et organismes (subrogation)'} />
      <Kpi kicker="À récupérer" value={fmtEur(syn.total.aRecuperer)} sub={syn.retards ? plural(syn.retards, 'dossier en retard', 'dossiers en retard') : 'aucun dossier en retard'} />
    </Kpis>

    {retards.length > 0 && (
      <Panel highlight title="Dossiers en retard" aside={plural(retards.length, 'échéance dépassée', 'échéances dépassées')}>
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
          <h2>Dossiers OPCO {exercice}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Seg name="opcoFiltre" label="État des dossiers" value={ui.opcoFiltre}
              onChange={v => setUi({ opcoFiltre: v })} options={[['tous', 'Tout'], ['en_cours', 'En cours'], ['retards', 'En retard'], ['clos', 'Clos']]} />
            {codes.length > 1 && (
              <select className="input" aria-label="OPCO" value={ui.opcoCode ?? ''} onChange={e => setUi({ opcoCode: (e.target.value || null) as CodeOpco | null })} style={{ width: 'auto' }}>
                <option value="">Tous les OPCO</option>
                {codes.map(c => <option key={c} value={c}>{OPCOS[c]}</option>)}
              </select>
            )}
            {dispositifs.length > 1 && (
              <select className="input" aria-label="Dispositif" value={ui.opcoDispositif ?? ''} onChange={e => setUi({ opcoDispositif: (e.target.value || null) as DispositifOpco | null })} style={{ width: 'auto', maxWidth: 260 }}>
                <option value="">Tous les dispositifs</option>
                {dispositifs.map(c => <option key={c} value={c}>{DISPOSITIFS_OPCO[c].label}</option>)}
              </select>
            )}
            {affichees.length > 0 && <Btn variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={exporterDossiers}>Exporter (CSV)</Btn>}
          </div>
        </div>
      }>
        {affichees.length > 0 && (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Action du plan</th><th>État</th><th className="right">Demandé</th><th className="right">Accordé</th><th className="right">Reçu</th><th className="right">À récupérer</th></tr></thead>
              <tbody>
                {affichees.map(({ x, e, m, nom }) => (
                  <tr key={x.id} className="clickable" onClick={() => ouvrir(x)}
                    style={{ backgroundColor: ui.opcoSel === x.id ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : undefined }}>
                    <td style={{ minWidth: 200 }}>
                      <div><Ouvrir pressed={ui.opcoSel === x.id} onOpen={() => ouvrir(x)}>{nom}</Ouvrir></div>
                      <div className="text-muted sub">{OPCOS[x.opco]} · {DISPOSITIFS_OPCO[x.dispositif].label}{x.reference ? ` · ${x.reference}` : ''}{x.subrogation ? ' · subrogation' : ''}</div>
                    </td>
                    <td>
                      <Tag cls={CLS_OPCO[x.statut]}>{STATUTS_OPCO[x.statut].label}</Tag>
                      {e && <div className={`sub nowrap${e.retard ? '' : ' text-muted'}`} style={e.retard ? { color: 'var(--color-accent-300)' } : undefined}>{fmtIso(e.echeance)} · {rel(e.jours)}</div>}
                    </td>
                    <td className="right tnum nowrap">{fmtEur(m.demande)}</td>
                    <td className="right tnum nowrap">{x.accordLe ? fmtEur(m.accorde) : '—'}</td>
                    <td className="right tnum nowrap">{fmtEur(m.recuEntreprise + m.payeOrganisme)}</td>
                    <td className="right tnum nowrap">{x.subrogation ? (m.attenduOrganisme ? <Two main={fmtEur(m.attenduOrganisme)} sub="à l’organisme" /> : '—') : m.aRecuperer ? fmtEur(m.aRecuperer) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {lignes.length > 0 && affichees.length === 0 && <Empty pad="sm">Aucun dossier avec ces filtres.</Empty>}
        {lignes.length === 0 && (
          <Empty pad="sm">
            Aucun dossier OPCO sur l’exercice {exercice}. Un dossier se crée depuis sa ligne du plan (onglet Plan & budget, colonne OPCO) : il suit la
            demande de prise en charge, de son dépôt au solde.
          </Empty>
        )}
      </Panel>
      {sel && <DossierOpcoPanel panneau={panneau} dossier={sel} onClose={() => setUi({ opcoSel: null })} />}
    </div>

    {lignes.length > 0 && (
      <Panel title="Répartition" aside={<Seg name="opcoAxe" label="Répartition par" value={axe} onChange={setAxe} options={AXES} style={{ flexWrap: 'wrap' }} />}>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>{AXES.find(a => a[0] === axe)![1]}</th><th className="right">Dossiers</th><th className="right">Demandé</th><th className="right">Accordé</th><th className="right">Reçu</th><th className="right">À récupérer</th></tr></thead>
            <tbody>
              {ventilation.map(v => (
                <tr key={v.cle}>
                  <td>{nomAxe(v.cle)}</td>
                  <td className="right tnum">{v.dossiers}</td>
                  <td className="right tnum nowrap">{fmtEur(v.demande)}</td>
                  <td className="right tnum nowrap">{fmtEur(v.accorde)}</td>
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
        <h2>Versements de l’OPCO</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <label className="text-muted sub" htmlFor="opco-periode-du">Du</label>
          <input className="input" id="opco-periode-du" type="date" value={du} onChange={e => setDu(e.target.value)} style={{ width: 'auto' }} aria-invalid={periodeErr ? true : undefined} />
          <label className="text-muted sub" htmlFor="opco-periode-au">au</label>
          <input className="input" id="opco-periode-au" type="date" value={au} onChange={e => setAu(e.target.value)} style={{ width: 'auto' }} aria-invalid={periodeErr ? true : undefined} />
          {!periodeErr && periode.length > 0 && <Btn variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={exporterVersements}>Exporter (CSV)</Btn>}
        </div>
      </div>
    }>
      {periodeErr && <p className="field-erreur">{periodeErr}</p>}
      {!periodeErr && periode.length > 0 && (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Versé le</th><th>Dossier</th><th>Payé à</th><th>Référence</th><th className="right">Montant</th></tr></thead>
            <tbody>
              {periode.map(v => {
                const x = dossiers.find(y => y.id === v.dossierId)!;
                return (
                  <tr key={v.id}>
                    <td className="nowrap">{fmtIso(v.le)}</td>
                    <td><Two main={nomDossierOpco(d, x)} sub={`${OPCOS[x.opco]}${x.reference ? ` · ${x.reference}` : ''} · exercice ${x.exercice}`} /></td>
                    <td className="nowrap">{v.destinataire === 'organisme' ? 'Organisme' : 'Entreprise'}</td>
                    <td className="nowrap">{v.reference ?? '—'}</td>
                    <td className="right tnum nowrap">{fmtEur(v.montant)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!periodeErr && periode.length === 0 && <Empty pad="sm">Aucun versement de l’OPCO sur cette période.</Empty>}
      <p className="fine text-muted">
        Versements reçus sur la période, tous exercices confondus (date d’encaissement), pour le rapprochement avec la comptabilité. Montants des
        indicateurs ci-dessus : comptés sur l’exercice de l’action du plan. Délais des échéances : Paramètres → Dossiers OPCO (à confirmer avec
        les conditions de l’OPCO).
      </p>
    </Panel>
  </>;
}
