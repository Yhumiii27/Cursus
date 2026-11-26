// lot 12 — C4 (organismes de formation et e-learning) : onglet E-learning de l'écran Formations. Inscriptions aux
// modules (statut, avancement déclaré ou importé, échéance, fin), filtrées : en cours, fins à valider, terminées, toutes.
// Droit « formations » (service RH, référent HSE) : inscrire, importer un fichier d'avancement, corriger, noter un
// abandon ; service RH : valider la fin (formation suivie et certification) ; administrateur RH : supprimer une
// inscription saisie par erreur. La lecture seule consulte ; le manager voit l'état de son équipe (périmètre reçu du
// serveur), sans aucun motif. Jamais de temps de connexion ni de score détaillé.
import { DownloadSimpleIcon, PlusIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { fmtIso } from '../../../../shared/format.ts';
import { etatInscription, finAcces, finAValider, inscriptionOuverte, STATUT_INSCRIPTION_LABEL } from '../../../../shared/rules/elearning.ts';
import { downloadCsv } from '../../print.ts';
import { abandonInscription, annulationInscription } from '../../state/confirmations-organismes.ts';
import { useDomain, useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { CLS_INSCRIPTION, filtrerInscriptions, FILTRES_ELEARNING } from '../organismes/etat.ts';
import { Ouvrir } from '../Cliquable.tsx';
import { Bar, Btn, Empty, Fine, Kpi, Kpis, Panel, Seg, Tag, Two, stop } from '../ui.tsx';
import { t, tn } from '../../i18n/langue.ts';

export function ElearningFormations() {
  const d = useDomain();
  const { ui, setUi, openDialog, go, notify } = useStore();
  const { formations, rh, admin, manager, espaceRh, soi } = useRole();
  const modules = d.ds.modulesElearning ?? [];
  const toutes = (d.ds.inscriptionsElearning ?? []).filter(i => !i.annuleLe);
  const moduleDe = (id: number) => modules.find(m => m.id === id) ?? null;
  const lignes = filtrerInscriptions(toutes, ui.elFiltre)
    .sort((a, b) => Number(finAValider(b)) - Number(finAValider(a)) || (a.echeance ?? '9999').localeCompare(b.echeance ?? '9999') || (d.emp(a.empId)?.nom ?? '').localeCompare(d.emp(b.empId)?.nom ?? ''));
  const annee = d.ti.slice(0, 4);
  const ouvertes = toutes.filter(inscriptionOuverte);
  const aValider = toutes.filter(finAValider);
  const expirees = ouvertes.filter(i => etatInscription(i, moduleDe(i.moduleId), d.ti) === 'expire');
  const terminees = toutes.filter(i => i.statut === 'termine' && i.termineLe?.startsWith(annee));
  const ouvrirFiche = (empId: number) => go('collaborateurs', { selectedId: empId });

  // Export de la liste affichée : statut, avancement et dates seulement (aucun motif, aucun temps de connexion). Le fichier
  // garde ses en-têtes et libellés français, comme les autres exports (CU-N01).
  const exporter = () => {
    downloadCsv(`e-learning-${d.ti}.csv`, ['Salarié', 'Matricule', 'Module', 'Inscrit le', 'Échéance', 'Statut', 'Avancement', 'Terminé le', 'Heures'],
      lignes.map(i => {
        const e = d.emp(i.empId), m = moduleDe(i.moduleId);
        return [e?.nom ?? '', e?.matriculePaie ?? '', m?.code ?? '', i.inscritLe, i.echeance ?? '', STATUT_INSCRIPTION_LABEL[etatInscription(i, m, d.ti)],
          i.avancement != null ? String(i.avancement) : '', i.termineLe ?? '', i.heures != null ? String(i.heures).replace('.', ',') : ''];
      }));
    notify(`${t('CSV export generated')} — ${tn(lignes.length, 'enrolment', 'enrolments')}`);
  };

  return (
    <>
      <Kpis>
        <Kpi kicker={t('In progress')} value={ouvertes.length} sub={expirees.length ? tn(expirees.length, 'access expired', 'accesses expired') : t('no access expired')} />
        <Kpi kicker={t('Completions to approve')} value={aValider.length} sub={t(rh ? 'declared or imported, to approve' : 'approved by HR#fem-plural')} />
        <Kpi kicker={`${t('Completed in ')}${annee}`} value={terminees.length} sub={`${tn(modules.filter(m => !m.archive).length, 'module offered', 'modules offered')}`} />
      </Kpis>
      <Panel head={
        <div className="panel-head top">
          <div>
            <h2>{t(manager ? 'E-learning of your team' : 'E-learning enrolments')}</h2>
            <div className="text-muted sub">{tn(lignes.length, 'enrolment', 'enrolments')}</div>
          </div>
          <div className="actions-end" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Seg name="elFiltre" label={t('Enrolments shown')} value={ui.elFiltre} onChange={v => setUi({ elFiltre: v })} options={FILTRES_ELEARNING.map(([k, l]) => [k, t(l)])} style={{ flexWrap: 'wrap' }} />
            {espaceRh && lignes.length > 0 && <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={exporter}>{t('Export')}</Btn>}
            {formations && <Btn small variant="secondary" icon={<UploadSimpleIcon size={14} />} onClick={() => openDialog({ type: 'elearningImport' })}>{t('Import the progress')}</Btn>}
            {formations && <Btn small variant="primary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'elearningInscrire' })}>{t('Enrol')}</Btn>}
          </div>
        </div>
      }>
        {lignes.length === 0 ? <Empty pad="sm">{t(toutes.length ? 'No enrolment with this filter.' : manager ? 'No member of your team is enrolled in a module.' : 'No enrolment in an e-learning module.')}</Empty> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Employee#salarie')}</th><th>{t('Module')}</th><th>{t('Due date')}</th><th>{t('Progress')}</th><th>{t('Status')}</th>{formations && <th></th>}</tr></thead>
              <tbody>
                {lignes.map(i => {
                  const e = d.emp(i.empId), m = moduleDe(i.moduleId);
                  const etat = etatInscription(i, m, d.ti);
                  const fin = finAcces(i, m);
                  const ouverte = inscriptionOuverte(i);
                  return (
                    <tr key={i.id}>
                      <td><Two nowrap main={espaceRh ? <Ouvrir onOpen={() => ouvrirFiche(i.empId)}>{e?.nom ?? `${t('no. ')}${i.empId}`}</Ouvrir> : e?.nom ?? `${t('no. ')}${i.empId}`} sub={e?.equipe ?? undefined} /></td>
                      <td style={{ minWidth: 200 }}><Two main={m ? `${m.code} — ${m.intitule}` : '—'} sub={`${t('enrolled on ')}${fmtIso(i.inscritLe)}${fin ? `${t(' · access until ')}${fmtIso(fin)}` : ''}`} /></td>
                      <td className="nowrap">{i.echeance ? fmtIso(i.echeance) : '—'}{ouverte && i.echeance && i.echeance < d.ti ? <div className="sub" style={{ color: 'var(--color-accent-300)' }}>{t('overdue#fem')}</div> : null}</td>
                      <td style={{ minWidth: 120 }}>
                        {i.avancement != null ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Bar pct={i.avancement} width={64} />
                            <span className="tnum nowrap">{i.avancement} %</span>
                          </div>
                        ) : <span className="text-muted">—</span>}
                        <div className="text-muted sub nowrap">{i.declareLe && ouverte ? `${t('completion declared on ')}${fmtIso(i.declareLe)}` : i.avancementSource === 'import' ? t('imported') : i.avancementSource === 'rh' ? t('entered by HR') : ''}</div>
                      </td>
                      <td>
                        <Tag cls={finAValider(i) ? 'tag-accent' : CLS_INSCRIPTION[etat]}>{finAValider(i) ? t('Completion to approve') : STATUT_INSCRIPTION_LABEL[etat]}</Tag>
                        {i.statut === 'termine' && <div className="text-muted sub nowrap">{i.termineLe ? fmtIso(i.termineLe) : ''}{i.heures != null ? ` · ${String(i.heures).replace('.', ',')} h` : ''}{i.reussi === false ? t(' · not passed') : ''}</div>}
                      </td>
                      {formations && (
                        <td className="right">
                          {ouverte && (
                            <div className="actions-end" style={{ flexWrap: 'wrap' }}>
                              {rh && i.empId !== soi && <Btn small variant={finAValider(i) ? 'secondary' : 'ghost'} onClick={stop(() => openDialog({ type: 'elearningTerminer', id: i.id }))}>{t('Approve the completion')}</Btn>}
                              <Btn small onClick={stop(() => openDialog({ type: 'elearningCorriger', id: i.id }))}>{t('Correct')}</Btn>
                              <Btn small onClick={stop(() => openDialog({ type: 'confirmer', c: abandonInscription(i, e?.nom ?? t('the employee'), m?.code ?? '') }))}>{t('Dropped out')}</Btn>
                              {admin && <Btn small onClick={stop(() => openDialog({ type: 'confirmer', c: annulationInscription(i, e?.nom ?? t('the employee'), m?.code ?? '') }))}>{t('Delete')}</Btn>}
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Fine>
          {manager
            ? t('State of the modules of your team: status, progress and completion. Enrolments and approval: HR.')
            : t('The follow-up is limited to the status, the progress declared or imported, the completion date and the pass, with no connection time. The completion, approved by HR, creates the training followed and, for a module linked to the catalogue and passed, the certification; its hours count in the plan, never on the timesheet.')}
        </Fine>
      </Panel>
    </>
  );
}
