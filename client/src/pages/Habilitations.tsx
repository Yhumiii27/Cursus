// Habilitations : titres par type, prérequis, échéances, délivrance, suspension et retrait.
import { useMemo } from 'react';
import { DownloadSimpleIcon, PlusIcon } from '@phosphor-icons/react';
import { HAB_CLS, HAB_LABEL, HAB_MESURE_LABEL, type HabKey } from '../../../shared/constants.ts';
import { renouvellementDemande, type HabInfo, type PrereqCheck } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt, plural, rel, validiteLabel } from '../../../shared/format.ts';
import { actifs, habSuivie } from '../../../shared/rules/referentiels.ts';
import { CatalogueVide } from '../components/ReferentielVide.tsx';
import { Btn, Chips, Empty, Page, Panel, Seg, Tag, Two, stop } from '../components/ui.tsx';
import { Ouvrir } from '../components/Cliquable.tsx';
import { csvRegistre } from '../listes-csv.ts';
import { downloadCsv } from '../print.ts';
import { useEnriched, useIntentPermis, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { PickCard } from './Formations.tsx';

const ORDER: Record<HabKey, number> = { exp: 0, susp: 0, retiree: 0, due: 1, pending: 2, ok: 3 };
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
      kicker: `${plural(titres.length, 'titre en cours', 'titres en cours')} · ${titres.filter(x => x.h.key === 'due').length} à renouveler · ${titres.filter(x => isKo(x.h.key)).length} non valides · ${all.filter(x => enAttente(x.h)).length} en attente`,
    };
  }, [emps, d, ui.habFilter, ui.habType]);

  const habFm = ui.habType ? d.hm(ui.habType) ?? null : null;
  // Registre : les titres affichés (statut et type choisis), sans le motif d'une suspension ou d'un retrait.
  const exporter = () => {
    const x = csvRegistre(d, v.rows);
    downloadCsv(x.fichier, x.head, x.rows);
    notify(`Export CSV généré — ${plural(v.rows.length, 'titre', 'titres')}`);
  };

  return (
    <Page kicker={v.kicker} title="Habilitations" actions={<>
      <Seg name="habFilter" label="Statut des habilitations" value={ui.habFilter} onChange={x => setUi({ habFilter: x })}
        options={[['tous', 'Toutes'], ['due', 'À renouveler'], ['ko', 'Non valides'], ['pending', 'En attente']]} />
      <Btn variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={exporter}>Exporter (CSV)</Btn>
      {formations && <Btn variant="primary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'hab', mode: 'new' })}>Délivrer une habilitation</Btn>}
    </>}>
      {v.types.length === 0 && <CatalogueVide onglet="habilitations" texte="Aucune habilitation au référentiel." />}
      <div className="cards-grid">
        {v.types.map(t => {
          const selected = ui.habType === t.hm.id;
          return (
            <PickCard key={t.hm.id} kicker={t.hm.detail} title={t.hm.nom} selected={selected}
              body={`Prérequis : ${[...t.hm.prereqs.map(f => d.fm(f)?.court ?? f), ...(t.hm.medical ? ['aptitude médicale'] : [])].join(' · ') || 'aucun'} · validité ${validiteLabel(t.hm.validite)}`}
              stats={[[t.titulaires, 'titulaires'], [t.due, 'à renouveler'], [t.ko, 'non valides']]}
              meta={<span>{t.pending ? plural(t.pending, 'demande en attente', 'demandes en attente') : `Signataire : ${t.hm.signataire}`}</span>}
              onClick={() => setUi({ habType: selected ? null : t.hm.id })} />
          );
        })}
      </div>

      <Panel head={
        <div className="panel-head center">
          <h2>{habFm ? `Titres — ${habFm.nom}` : 'Tous les titres'}</h2>
          {habFm && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUi({ habType: null })}>Toutes les habilitations</button>}
        </div>
      }>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Collaborateur</th><th>Habilitation</th><th>Délivrance</th><th>Échéance</th><th>Prérequis</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              {v.rows.map(({ e, h }) => {
                const proposee = d.habAction(e.id, h), a = proposee && permis(proposee.intent) ? proposee : null;
                const mesures = formations ? d.habMesures(h, true) : [];
                return (
                  <tr key={`${e.id}-${h.hm.id}`} className="clickable" onClick={() => go('collaborateurs', { selectedId: e.id })}>
                    <td><Two main={<Ouvrir onOpen={() => go('collaborateurs', { selectedId: e.id })}>{e.nom}</Ouvrir>} sub={equipeLabel(e)} nowrap /></td>
                    <td><Two main={h.hm.nom} sub={h.hm.detail} /></td>
                    <td><Two main={h.delivree ? fmt(parse(h.delivree)) : h.demande ? `Demandée le ${fmt(parse(h.demande))}` : '—'} sub={h.par ? `par ${h.par}` : 'titre à signer'} nowrap subNowrap /></td>
                    <td><Two main={h.exp ? fmt(h.exp) : '—'} sub={h.exp ? rel(h.d!) : `validité ${validiteLabel(h.hm.validite)}`} nowrap subNowrap /></td>
                    <td><Chips items={h.checks.map(c => ({ key: c.label, label: c.label, cls: prereqCls(c) }))} /></td>
                    <td>
                      <Tag cls={HAB_CLS[h.key]}>{HAB_LABEL[h.key]}</Tag>
                      {h.mesure && h.mesureLe && <div className="text-muted sub" style={{ marginTop: 'var(--space-1)' }}>le {fmt(h.mesureLe)} — {h.mesureMotif}</div>}
                      {h.key === 'retiree' && h.demande && <div className="text-muted sub">Redemandée le {fmt(parse(h.demande))}</div>}
                      {renouvellementDemande(h) && <div className="text-muted sub">Renouvellement demandé le {fmt(parse(h.demande!))}</div>}
                    </td>
                    <td className="right">
                      <div className="actions-end">
                        {a && <button type="button" className="btn btn-ghost btn-sm" onClick={stop(() => runIntent(a.intent))}>{a.label}</button>}
                        {formations && h.key === 'retiree' && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={stop(() => openDialog({ type: 'hab', empId: e.id, h: h.h, mode: 'deliver' }))}>Nouvelle délivrance</button>
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
        {v.rows.length === 0 && <Empty pad="sm">Aucune habilitation ne correspond à ces filtres.</Empty>}
      </Panel>
    </Page>
  );
}
