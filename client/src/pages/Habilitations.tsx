// Habilitations : titres par type, prérequis, échéances, délivrance, suspension et retrait.
import { useMemo } from 'react';
import { DownloadSimpleIcon, PlusIcon } from '@phosphor-icons/react';
import { HAB_CLS, HAB_LABEL, HAB_MESURE_LABEL, type HabKey } from '../../../shared/constants.ts';
import { renouvellementDemande, type EmpX, type HabInfo, type PrereqCheck } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt, rel, validiteLabel } from '../../../shared/format.ts';
import { actifs, habSuivie } from '../../../shared/rules/referentiels.ts';
import { CatalogueVide } from '../components/ReferentielVide.tsx';
import { Btn, Chips, Empty, Page, Panel, Seg, Tag, Two, stop } from '../components/ui.tsx';
import { Ouvrir } from '../components/Cliquable.tsx';
import { parDate, parNombre, parTexte, trier, usePagination, useTri, type Colonne } from '../components/tri.ts';
import { SuiteListe, ThTri } from '../components/TriListe.tsx';
import { csvRegistre } from '../listes-csv.ts';
import { downloadCsv } from '../print.ts';
import { useEnriched, useIntentPermis, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';
import { PickCard } from './Formations.tsx';

const ORDER: Record<HabKey, number> = { exp: 0, susp: 0, retiree: 0, due: 1, pending: 2, ok: 3 };
type Ligne = { e: EmpX; h: HabInfo };
/** Colonnes triables du registre ; « Statut » : du moins valide au valide, comme l'ordre par défaut. */
const COLONNES: Record<string, Colonne<Ligne>> = {
  nom: parTexte(x => x.e.nom),
  habilitation: parTexte(x => x.h.hm.nom),
  delivrance: parDate(x => x.h.delivree ?? x.h.demande),
  echeance: parNombre(x => x.h.d),
  statut: parNombre(x => ORDER[x.h.key]),
};
const prereqCls = (c: PrereqCheck) => c.ok ? (c.due ? 'tag-outline' : 'tag-neutral') : 'tag-accent';
/** Titre non valide : expiré, suspendu (prérequis ou décision de l'employeur) ou retiré. */
const isKo = (k: HabKey) => k === 'exp' || k === 'susp' || k === 'retiree';
/** En attente de délivrance : titre demandé, ou titre expiré dont le renouvellement est accepté (qui reste non valide). */
const enAttente = (h: HabInfo) => h.key === 'pending' || renouvellementDemande(h);

export function Habilitations() {
  const { emps, d } = useEnriched();
  // Délivrance, mesures et propositions : service RH et référent HSE ; la visite médicale reste au service RH.
  const { formations } = useRole();
  const permis = useIntentPermis();
  const { ui, setUi, go, openDialog, runIntent, notify } = useStore();

  const v = useMemo(() => {
    // Habilitations suivies : celles du référentiel en vigueur (les titres d'une habilitation archivée restent à la fiche).
    const all = emps.flatMap(e => e.habs.filter(habSuivie).map(h => ({ e, h })));
    const titres = all.filter(x => x.h.key !== 'pending');
    const types = actifs(d.ds.referentiels.habilitations).map(hm => {
      const list = all.filter(x => x.h.hm.id === hm.id), t = list.filter(x => x.h.key !== 'pending');
      return { hm, titulaires: t.length, due: t.filter(x => x.h.key === 'due').length, ko: t.filter(x => isKo(x.h.key)).length, pending: list.filter(x => enAttente(x.h)).length };
    });
    const f = ui.habFilter;
    const rows = all
      .filter(({ h }) => (!ui.habType || h.hm.id === ui.habType) && (f === 'tous' || (f === 'due' ? h.key === 'due' : f === 'ko' ? isKo(h.key) : enAttente(h))))
      .sort((a, b) => ORDER[a.h.key] - ORDER[b.h.key] || (a.h.d ?? 1e9) - (b.h.d ?? 1e9) || a.e.nom.localeCompare(b.e.nom));
    return {
      types, rows,
      kicker: `${tn(titres.length, 'current title', 'current titles')} · ${titres.filter(x => x.h.key === 'due').length}${t(' to renew')} · ${titres.filter(x => isKo(x.h.key)).length}${t(' not valid')} · ${all.filter(x => enAttente(x.h)).length}${t(' pending')}`,
    };
  }, [emps, d, ui.habFilter, ui.habType]);
  // Tri par colonne et pagination (t145) : l'ordre par défaut (non valides, à renouveler, en attente, puis l'échéance)
  // tant qu'aucun en-tête n'est cliqué ; le registre exporté suit le filtre et le tri affichés.
  const tri = useTri('habilitations');
  const rows = useMemo(() => trier(v.rows, COLONNES, tri.tri), [v.rows, tri.tri]);
  const page = usePagination(rows, `${ui.habFilter}|${ui.habType ?? ''}`);

  const habFm = ui.habType ? d.hm(ui.habType) ?? null : null;
  // Registre : les titres affichés (statut et type choisis), sans le motif d'une suspension ou d'un retrait.
  const exporter = () => {
    const x = csvRegistre(d, rows);
    downloadCsv(x.fichier, x.head, x.rows);
    notify(`${t('CSV export generated')} — ${tn(rows.length, 'title', 'titles')}`);
  };

  return (
    <Page kicker={v.kicker} title={t('Authorisations')} actions={<>
      <Seg name="habFilter" label={t('Status of the authorisations')} value={ui.habFilter} onChange={x => setUi({ habFilter: x })}
        options={[['tous', t('All#fem')], ['due', t('To renew')], ['ko', t('Not valid')], ['pending', t('Pending')]]} />
      <Btn variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={exporter}>{t('Export (CSV)')}</Btn>
      {formations && <Btn variant="primary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'hab', mode: 'new' })}>{t('Issue an authorisation')}</Btn>}
    </>}>
      {v.types.length === 0 && <CatalogueVide onglet="habilitations" texte={t('No authorisation in the reference data.')} />}
      <div className="cards-grid">
        {v.types.map(ty => {
          const selected = ui.habType === ty.hm.id;
          return (
            <PickCard key={ty.hm.id} kicker={ty.hm.detail} title={ty.hm.nom} selected={selected}
              body={`${t('Prerequisites: ')}${[...ty.hm.prereqs.map(f => d.fm(f)?.court ?? f), ...(ty.hm.medical ? [t('medical fitness')] : [])].join(' · ') || t('none')} · ${t('validity ')}${validiteLabel(ty.hm.validite)}`}
              stats={[[ty.titulaires, t('holders')], [ty.due, t('to renew')], [ty.ko, t('not valid')]]}
              meta={<span>{ty.pending ? tn(ty.pending, 'pending request', 'pending requests') : `${t('Signatory: ')}${ty.hm.signataire}`}</span>}
              onClick={() => setUi({ habType: selected ? null : ty.hm.id })} />
          );
        })}
      </div>

      <Panel head={
        <div className="panel-head center">
          <h2>{habFm ? `${t('Titles')} — ${habFm.nom}` : t('All titles')}</h2>
          {habFm && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUi({ habType: null })}>{t('All authorisations')}</button>}
        </div>
      }>
        <div className="scroll-x">
          <table className="table">
            <thead><tr>
              <ThTri t={tri} col="nom">{t('Employee')}</ThTri>
              <ThTri t={tri} col="habilitation">{t('Authorisation')}</ThTri>
              <ThTri t={tri} col="delivrance">{t('Issue')}</ThTri>
              <ThTri t={tri} col="echeance">{t('Due date')}</ThTri>
              <th>{t('Prerequisites')}</th>
              <ThTri t={tri} col="statut">{t('Status')}</ThTri>
              <th></th>
            </tr></thead>
            <tbody>
              {page.lignes.map(({ e, h }) => {
                const proposee = d.habAction(e.id, h), a = proposee && permis(proposee.intent) ? proposee : null;
                const mesures = formations ? d.habMesures(h, true) : [];
                return (
                  <tr key={`${e.id}-${h.hm.id}`} className="clickable" onClick={() => go('collaborateurs', { selectedId: e.id })}>
                    <td><Two main={<Ouvrir onOpen={() => go('collaborateurs', { selectedId: e.id })}>{e.nom}</Ouvrir>} sub={equipeLabel(e)} nowrap /></td>
                    <td><Two main={h.hm.nom} sub={h.hm.detail} /></td>
                    <td><Two main={h.delivree ? fmt(parse(h.delivree)) : h.demande ? `${t('Requested on ')}${fmt(parse(h.demande))}` : '—'} sub={h.par ? `${t('by ')}${h.par}` : t('title to sign')} nowrap subNowrap /></td>
                    <td><Two main={h.exp ? fmt(h.exp) : '—'} sub={h.exp ? rel(h.d!) : `${t('validity ')}${validiteLabel(h.hm.validite)}`} nowrap subNowrap /></td>
                    <td><Chips items={h.checks.map(c => ({ key: c.label, label: c.label, cls: prereqCls(c) }))} /></td>
                    <td>
                      <Tag cls={HAB_CLS[h.key]}>{HAB_LABEL[h.key]}</Tag>
                      {h.mesure && h.mesureLe && <div className="text-muted sub" style={{ marginTop: 'var(--space-1)' }}>{t('on ')}{fmt(h.mesureLe)} — {h.mesureMotif}</div>}
                      {h.key === 'retiree' && h.demande && <div className="text-muted sub">{t('Requested again on ')}{fmt(parse(h.demande))}</div>}
                      {renouvellementDemande(h) && <div className="text-muted sub">{t('Renewal requested on ')}{fmt(parse(h.demande!))}</div>}
                    </td>
                    <td className="right">
                      <div className="actions-end">
                        {a && <button type="button" className="btn btn-ghost btn-sm" onClick={stop(() => runIntent(a.intent))}>{a.label}</button>}
                        {formations && h.key === 'retiree' && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={stop(() => openDialog({ type: 'hab', empId: e.id, h: h.h, mode: 'deliver' }))}>{t('New issue')}</button>
                        )}
                        {mesures.map(m => (
                          <button key={m} type="button" className="btn btn-ghost btn-sm" onClick={stop(() => openDialog({ type: 'habMesure', empId: e.id, h: h.h, action: m }))}>{HAB_MESURE_LABEL[m]}</button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {v.rows.length === 0 && <Empty pad="sm">{t('No authorisation matches these filters.')}</Empty>}
        <SuiteListe p={page} unite={['title', 'titles']} />
      </Panel>
    </Page>
  );
}
