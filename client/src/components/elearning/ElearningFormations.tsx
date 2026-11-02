// lot 12 — C4 (organismes de formation et e-learning) : onglet E-learning de l'écran Formations. Inscriptions aux
// modules (statut, avancement déclaré ou importé, échéance, fin), filtrées : en cours, fins à valider, terminées, toutes.
// Droit « formations » (service RH, référent HSE) : inscrire, importer un fichier d'avancement, corriger, noter un
// abandon ; service RH : valider la fin (formation suivie et certification) ; administrateur RH : supprimer une
// inscription saisie par erreur. La lecture seule consulte ; le manager voit l'état de son équipe (périmètre reçu du
// serveur), sans aucun motif. Jamais de temps de connexion ni de score détaillé.
import { DownloadSimpleIcon, PlusIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { fmtIso, plural } from '../../../../shared/format.ts';
import { etatInscription, finAcces, finAValider, inscriptionOuverte, STATUT_INSCRIPTION_LABEL } from '../../../../shared/rules/elearning.ts';
import { downloadCsv } from '../../print.ts';
import { abandonInscription, annulationInscription } from '../../state/confirmations-organismes.ts';
import { useDomain, useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { CLS_INSCRIPTION, filtrerInscriptions, FILTRES_ELEARNING } from '../organismes/etat.ts';
import { Ouvrir } from '../Cliquable.tsx';
import { Bar, Btn, Empty, Fine, Kpi, Kpis, Panel, Seg, Tag, Two, stop } from '../ui.tsx';

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

  // Export de la liste affichée : statut, avancement et dates seulement (aucun motif, aucun temps de connexion).
  const exporter = () => {
    downloadCsv(`e-learning-${d.ti}.csv`, ['Salarié', 'Matricule', 'Module', 'Inscrit le', 'Échéance', 'Statut', 'Avancement', 'Terminé le', 'Heures'],
      lignes.map(i => {
        const e = d.emp(i.empId), m = moduleDe(i.moduleId);
        return [e?.nom ?? '', e?.matriculePaie ?? '', m?.code ?? '', i.inscritLe, i.echeance ?? '', STATUT_INSCRIPTION_LABEL[etatInscription(i, m, d.ti)],
          i.avancement != null ? String(i.avancement) : '', i.termineLe ?? '', i.heures != null ? String(i.heures).replace('.', ',') : ''];
      }));
    notify(`Export CSV généré — ${plural(lignes.length, 'inscription', 'inscriptions')}`);
  };

  return (
    <>
      <Kpis>
        <Kpi kicker="En cours" value={ouvertes.length} sub={expirees.length ? plural(expirees.length, 'accès expiré', 'accès expirés') : 'aucun accès expiré'} />
        <Kpi kicker="Fins à valider" value={aValider.length} sub={rh ? 'déclarées ou importées, à valider' : 'validées par le service RH'} />
        <Kpi kicker={`Terminés en ${annee}`} value={terminees.length} sub={`${plural(modules.filter(m => !m.archive).length, 'module proposé', 'modules proposés')}`} />
      </Kpis>
      <Panel head={
        <div className="panel-head top">
          <div>
            <h2>{manager ? 'E-learning de votre équipe' : 'Inscriptions e-learning'}</h2>
            <div className="text-muted sub">{plural(lignes.length, 'inscription', 'inscriptions')}</div>
          </div>
          <div className="actions-end" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Seg name="elFiltre" label="Inscriptions affichées" value={ui.elFiltre} onChange={v => setUi({ elFiltre: v })} options={FILTRES_ELEARNING} style={{ flexWrap: 'wrap' }} />
            {espaceRh && lignes.length > 0 && <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={exporter}>Exporter</Btn>}
            {formations && <Btn small variant="secondary" icon={<UploadSimpleIcon size={14} />} onClick={() => openDialog({ type: 'elearningImport' })}>Importer l’avancement</Btn>}
            {formations && <Btn small variant="primary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'elearningInscrire' })}>Inscrire</Btn>}
          </div>
        </div>
      }>
        {lignes.length === 0 ? <Empty pad="sm">{toutes.length ? 'Aucune inscription avec ce filtre.' : manager ? 'Aucun membre de votre équipe n’est inscrit à un module.' : 'Aucune inscription à un module d’e-learning.'}</Empty> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Salarié</th><th>Module</th><th>Échéance</th><th>Avancement</th><th>Statut</th>{formations && <th></th>}</tr></thead>
              <tbody>
                {lignes.map(i => {
                  const e = d.emp(i.empId), m = moduleDe(i.moduleId);
                  const etat = etatInscription(i, m, d.ti);
                  const fin = finAcces(i, m);
                  const ouverte = inscriptionOuverte(i);
                  return (
                    <tr key={i.id}>
                      <td><Two nowrap main={espaceRh ? <Ouvrir onOpen={() => ouvrirFiche(i.empId)}>{e?.nom ?? `n° ${i.empId}`}</Ouvrir> : e?.nom ?? `n° ${i.empId}`} sub={e?.equipe ?? undefined} /></td>
                      <td style={{ minWidth: 200 }}><Two main={m ? `${m.code} — ${m.intitule}` : '—'} sub={`inscrit le ${fmtIso(i.inscritLe)}${fin ? ` · accès jusqu’au ${fmtIso(fin)}` : ''}`} /></td>
                      <td className="nowrap">{i.echeance ? fmtIso(i.echeance) : '—'}{ouverte && i.echeance && i.echeance < d.ti ? <div className="sub" style={{ color: 'var(--color-accent-300)' }}>dépassée</div> : null}</td>
                      <td style={{ minWidth: 120 }}>
                        {i.avancement != null ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Bar pct={i.avancement} width={64} />
                            <span className="tnum nowrap">{i.avancement} %</span>
                          </div>
                        ) : <span className="text-muted">—</span>}
                        <div className="text-muted sub nowrap">{i.declareLe && ouverte ? `fin déclarée le ${fmtIso(i.declareLe)}` : i.avancementSource === 'import' ? 'importé' : i.avancementSource === 'rh' ? 'saisi par le RH' : ''}</div>
                      </td>
                      <td>
                        <Tag cls={finAValider(i) ? 'tag-accent' : CLS_INSCRIPTION[etat]}>{finAValider(i) ? 'Fin à valider' : STATUT_INSCRIPTION_LABEL[etat]}</Tag>
                        {i.statut === 'termine' && <div className="text-muted sub nowrap">{i.termineLe ? fmtIso(i.termineLe) : ''}{i.heures != null ? ` · ${String(i.heures).replace('.', ',')} h` : ''}{i.reussi === false ? ' · non réussi' : ''}</div>}
                      </td>
                      {formations && (
                        <td className="right">
                          {ouverte && (
                            <div className="actions-end" style={{ flexWrap: 'wrap' }}>
                              {rh && i.empId !== soi && <Btn small variant={finAValider(i) ? 'secondary' : 'ghost'} onClick={stop(() => openDialog({ type: 'elearningTerminer', id: i.id }))}>Valider la fin</Btn>}
                              <Btn small onClick={stop(() => openDialog({ type: 'elearningCorriger', id: i.id }))}>Corriger</Btn>
                              <Btn small onClick={stop(() => openDialog({ type: 'confirmer', c: abandonInscription(i, e?.nom ?? 'le salarié', m?.code ?? '') }))}>Abandon</Btn>
                              {admin && <Btn small onClick={stop(() => openDialog({ type: 'confirmer', c: annulationInscription(i, e?.nom ?? 'le salarié', m?.code ?? '') }))}>Supprimer</Btn>}
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
            ? 'État des modules de votre équipe : statut, avancement et fin. Inscriptions et validation : service RH.'
            : 'Le suivi se limite au statut, à l’avancement déclaré ou importé, à la date de fin et à la réussite, sans temps de connexion. La fin, validée par le service RH, crée la formation suivie et, pour un module rattaché au catalogue et réussi, la certification ; ses heures comptent dans le plan, jamais sur la feuille de temps.'}
        </Fine>
      </Panel>
    </>
  );
}
