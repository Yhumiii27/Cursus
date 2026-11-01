// lot 12 — C3 (entretiens suivis, t194) : onglets « Objectifs » et « Points de suivi » de l'écran Entretiens
// (pages/Entretiens.tsx), espaces RH et manager ; filtres dans l'adresse (state/url.ts : onglet, statut, échéance).
// - Objectifs : indicateurs de la campagne (taux d'entretiens annuels avec objectifs, taux d'objectifs évalués, résultats
//   par équipe masqués sous le seuil d'anonymat, souhaits exprimés, versés, acceptés et réalisés), ce qui attend
//   l'évaluateur avant la clôture (souhaits sans avis, propositions du salarié), puis les objectifs du périmètre, filtrés
//   par statut et par échéance, avec l'avancement et l'ajustement en cours d'année. La lecture seule (direction, DPO,
//   auditeur) et la consultation N+2 ne reçoivent que des compteurs par équipe (server/src/vues-entretiens-suivis.ts) :
//   jamais un libellé ni un résultat individuel.
// - Points de suivi : points de mi-année et points de suivi de l'année, et la planification d'un point pour chaque membre.
//   Facultatifs, sauf réglage `pointMiAnneeActif` (le point de mi-année devient alors une échéance de l'onglet Échéances).
import { useMemo } from 'react';
import { ENT_TYPES } from '../../../shared/constants.ts';
import { addD } from '../../../shared/dates.ts';
import { equipeLabel, fmtIso, plural } from '../../../shared/format.ts';
import { miAnnee } from '../../../shared/rules/entretiens.ts';
import { STATUT_OBJECTIF_LABEL, STATUTS_EVALUATION, estEvalue } from '../../../shared/rules/objectifs.ts';
import { aArbitrer, derniereMiseAJour, HORIZON_OBJECTIFS_JOURS, indicateursSuivi, taux } from '../../../shared/rules/objectifs-suivi.ts';
import { statutEntretien } from '../../../shared/rules/remise.ts';
import type { Objectif } from '../../../shared/types.ts';
import { detailObjectif, STATUT_OBJECTIF_CLS, useEvaluateur } from '../components/EntretienSuivi.tsx';
import { Ouvrir } from '../components/Cliquable.tsx';
import { Bar, Fine, Kpi, Kpis, NoteAccent, Panel, Seg, Tag, Two } from '../components/ui.tsx';
import { decideur } from '../state/delegues.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

const pct = (n: number | null) => (n == null ? '—' : `${n} %`);

/** Compteurs par équipe (lecture seule, consultation N+2) : nombres seulement, équipes de moins de 3 salariés masquées. */
function Compteurs({ titre = 'Objectifs par équipe' }: { titre?: string }) {
  const d = useDomain();
  const compteurs = d.ds.compteursObjectifs ?? [];
  return (
    <Panel title={titre} aside="nombres seulement">
      {compteurs.length > 0 ? (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th scope="col">Équipe</th><th scope="col" className="right">Salariés</th><th scope="col" className="right">Objectifs</th><th scope="col" className="right">En cours</th><th scope="col" className="right">Évalués</th></tr></thead>
            <tbody>
              {compteurs.map(c => (
                <tr key={c.equipe || '—'}>
                  <th scope="row" style={{ fontWeight: 'normal' }}>{c.equipe || 'Sans équipe'}</th>
                  {c.masque
                    ? <td colSpan={4} className="text-muted">Moins de 3 salariés concernés : non affiché</td>
                    : <><td className="right tnum">{c.salaries}</td><td className="right tnum">{c.objectifs}</td><td className="right tnum">{c.ouverts}</td><td className="right tnum">{c.evalues}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-muted empty">Aucun objectif suivi.</p>}
      <Fine>Les libellés, les évaluations et les comptes rendus ne sont transmis qu’à l’évaluateur, au salarié et au service RH.</Fine>
    </Panel>
  );
}

export function OngletObjectifs({ ids }: { ids: number[] }) {
  const d = useDomain();
  const { rh, manager } = useRole();
  const { ui, setUi, openDialog } = useStore();
  const s = d.ds.settings;
  const year = d.year;
  const v = useMemo(() => {
    const perimetre = new Set(ids);
    const objectifs = (d.ds.objectifs ?? []).filter(o => perimetre.has(o.empId));
    const ind = indicateursSuivi(d.ds, perimetre, year);
    const proches = addD(d.ti, HORIZON_OBJECTIFS_JOURS);
    const filtres = objectifs.filter(o => (ui.objStatut === 'tous' || (ui.objStatut === 'ouverts' && o.statut === 'ouvert')
      || (ui.objStatut === 'proposes' && o.statut === 'propose') || (ui.objStatut === 'evalues' && estEvalue(o)))
      && (ui.objEcheance === 'toutes' || (!!o.echeance && o.statut === 'ouvert' && (ui.objEcheance === 'depassees' ? o.echeance < d.ti : o.echeance >= d.ti && o.echeance <= proches))))
      .sort((a, b) => (a.echeance ?? '9999').localeCompare(b.echeance ?? '9999') || a.empId - b.empId || a.id - b.id);
    return { ind, filtres, arbitrer: aArbitrer(d.ds.entretiens, d.ds.objectifs ?? [], perimetre), total: objectifs.length };
  }, [d, ids, year, ui.objStatut, ui.objEcheance]);

  // Lecture seule (consultation) et profils sans le droit « rh » : compteurs seulement.
  if (!rh && !manager) return <Compteurs />;
  if (!s.objectifsActifs) return <Panel title="Objectifs"><p className="text-muted empty">Les objectifs ne sont pas suivis dans Cursus (Paramètres → Objectifs et points de suivi).</p></Panel>;
  const { ind } = v;
  const clos = new Set(d.ds.entretiens.filter(y => y.statut === 'realise').map(y => y.id));

  return (<>
    <Kpis>
      <Kpi kicker={`Entretiens annuels ${year} avec objectifs`} value={pct(taux(ind.annuelsAvecObjectifs, ind.annuels))} sub={`${ind.annuelsAvecObjectifs} sur ${plural(ind.annuels, 'entretien annuel clos', 'entretiens annuels clos')}`} />
      <Kpi kicker="Objectifs évalués" value={pct(taux(ind.evalues, ind.aEvaluer))} sub={`${ind.evalues} sur ${plural(ind.aEvaluer, 'objectif', 'objectifs')} de la période précédente`} />
      <Kpi kicker={`Souhaits de formation ${year}`} value={ind.souhaits.exprimes} sub={`${ind.souhaits.favorables} favorables · ${ind.souhaits.verses} versés · ${ind.souhaits.acceptes} acceptés · ${ind.souhaits.realises} réalisés`} />
    </Kpis>

    {v.arbitrer.length > 0 && (
      <Panel highlight title="À arbitrer avant la clôture" aside={plural(v.arbitrer.length, 'entretien', 'entretiens')}>
        <div className="list">
          {v.arbitrer.map(a => {
            const e = d.emp(a.entretien.empId);
            return (
              <div key={a.entretien.id} className="list-row clickable" style={{ justifyContent: 'space-between', gap: 'var(--space-3)' }} onClick={() => openDialog({ type: 'ent', entId: a.entretien.id })}>
                <Two main={<Ouvrir onOpen={() => openDialog({ type: 'ent', entId: a.entretien.id })}>{e?.nom ?? d.personName(a.entretien.empId)} · {ENT_TYPES[a.entretien.type].nom}</Ouvrir>}
                  sub={`Prévu le ${fmtIso(a.entretien.date)}`} />
                <span className="text-muted sub">{[a.souhaits ? plural(a.souhaits, 'souhait sans avis', 'souhaits sans avis') : '', a.propositions ? plural(a.propositions, 'objectif proposé', 'objectifs proposés') : ''].filter(Boolean).join(' · ')}</span>
              </div>
            );
          })}
        </div>
      </Panel>
    )}

    <Panel title="Objectifs de l’équipe" aside={plural(v.filtres.length, 'objectif', 'objectifs')}>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Seg name="objStatut" label="Statut des objectifs" value={ui.objStatut} onChange={x => setUi({ objStatut: x })} style={{ flexWrap: 'wrap' }}
          options={[['tous', 'Tous'], ['ouverts', 'En cours'], ['proposes', 'Proposés'], ['evalues', 'Évalués']]} />
        <Seg name="objEcheance" label="Échéance des objectifs" value={ui.objEcheance} onChange={x => setUi({ objEcheance: x })} style={{ flexWrap: 'wrap' }}
          options={[['toutes', 'Toutes échéances'], ['proches', 'Sous 30 jours'], ['depassees', 'Dépassées']]} />
      </div>
      {v.filtres.length > 0 ? (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th scope="col">Collaborateur</th><th scope="col">Objectif</th><th scope="col">Avancement</th><th scope="col">Statut</th><th scope="col"></th></tr></thead>
            <tbody>
              {v.filtres.map((o: Objectif) => {
                const e = d.emp(o.empId);
                const fixe = d.ds.entretiens.find(y => y.id === o.entretienId);
                const enCours = o.statut === 'ouvert' && clos.has(o.entretienId);
                return (
                  <tr key={o.id}>
                    <td><Two main={e?.nom ?? d.personName(o.empId)} sub={equipeLabel(e)} nowrap /></td>
                    <td style={{ minWidth: 220 }}><Two main={o.libelle} sub={detailObjectif(o) || (fixe ? `fixé le ${fmtIso(fixe.date)}` : '')} /></td>
                    <td>{enCours
                      ? <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}><Bar pct={o.avancement} width={80} /><span className="text-muted sub tnum">{o.avancement} %</span></div>
                      : <span className="text-muted sub">—</span>}
                      {enCours && <div className="text-muted sub nowrap">mis à jour le {fmtIso(derniereMiseAJour(o))}</div>}</td>
                    <td><Tag cls={STATUT_OBJECTIF_CLS[o.statut]}>{STATUT_OBJECTIF_LABEL[o.statut]}</Tag></td>
                    <td className="right"><ActionsObjectif o={o} enCours={enCours} entId={fixe?.statut === 'planifie' ? fixe.id : null} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="text-muted empty">{v.total ? 'Aucun objectif pour ces filtres.' : 'Aucun objectif fixé : ils se fixent à l’entretien annuel.'}</p>}
      <Fine>Objectifs fixés et évalués à l’entretien annuel, ajustés en cours d’année avec un motif. Aucun objectif dans un entretien de parcours professionnel (art. L6315-1).</Fine>
    </Panel>

    <Panel title={`Résultats ${year} par équipe`} aside="objectifs évalués dans l’année">
      {ind.resultats.length > 0 ? (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th scope="col">Équipe</th>{STATUTS_EVALUATION.map(x => <th key={x} scope="col" className="right">{STATUT_OBJECTIF_LABEL[x]}</th>)}</tr></thead>
            <tbody>
              {ind.resultats.map(r => (
                <tr key={r.equipe || '—'}>
                  <th scope="row" style={{ fontWeight: 'normal' }}>{r.equipe || 'Sans équipe'}</th>
                  {r.masque
                    ? <td colSpan={STATUTS_EVALUATION.length} className="text-muted">Moins de 3 salariés évalués : non affiché</td>
                    : STATUTS_EVALUATION.map(x => <td key={x} className="right tnum">{r.resultats[x]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-muted empty">Aucun objectif évalué en {year}.</p>}
      <Fine>Indicateurs calculés, jamais stockés ; une équipe de moins de 3 salariés évalués est masquée, pour qu’aucun résultat individuel ne se déduise.</Fine>
    </Panel>
    {/* Consultation N+2 (t136) : compteurs des équipes consultées, jamais leurs objectifs. */}
    {manager && (d.ds.compteursObjectifs?.length ?? 0) > 0 && <Compteurs titre="Équipes consultées (lecture seule)" />}
  </>);
}

/** Actions sur un objectif de la liste : compte rendu de l'entretien planifié qui le fixe, avancement, ajustement. */
function ActionsObjectif({ o, enCours, entId }: { o: Objectif; enCours: boolean; entId: number | null }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const evaluateur = useEvaluateur(d.emp(o.empId));
  if (!evaluateur) return null;
  return (
    <div className="actions-end" style={{ flexWrap: 'nowrap' }}>
      {entId != null && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'ent', entId })}>Compte rendu</button>}
      {enCours && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'objectifAvancer', id: o.id })}>Avancement</button>}
      {enCours && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'objectif', mode: 'ajuster', id: o.id })}>Ajuster</button>}
    </div>
  );
}

export function OngletPoints({ ids }: { ids: number[] }) {
  const d = useDomain();
  const { rh, manager, me, soi } = useRole();
  const { openDialog } = useStore();
  const year = d.year;
  const pm = miAnnee(d.ds.settings, year);
  const v = useMemo(() => {
    const perimetre = new Set(ids);
    const points = d.ds.entretiens.filter(x => perimetre.has(x.empId) && (x.type === 'mi_annee' || x.type === 'point') && (x.statut === 'planifie' || x.date >= `${year}-01-01`))
      .sort((a, b) => (a.statut === 'planifie' ? 0 : 1) - (b.statut === 'planifie' ? 0 : 1) || a.date.localeCompare(b.date));
    const membres = ids.map(id => d.emp(id)).filter((e): e is NonNullable<typeof e> => !!e).sort((a, b) => a.nom.localeCompare(b.nom)).map(e => {
      const siens = d.ds.entretiens.filter(x => x.empId === e.id && (x.type === 'mi_annee' || x.type === 'point'));
      const dernier = siens.filter(x => x.statut === 'realise').map(x => x.date).sort().at(-1) ?? null;
      const prevu = siens.find(x => x.statut === 'planifie') ?? null;
      const enCours = (d.ds.objectifs ?? []).filter(o => o.empId === e.id && o.statut === 'ouvert').length;
      return { e, dernier, prevu, enCours };
    });
    return { points, membres };
  }, [d, ids, year]);
  if (!rh && !manager) return <Panel title="Points de suivi"><p className="text-muted empty">Les comptes rendus des points de suivi ne sont pas transmis à ce profil.</p></Panel>;
  const peutPlanifier = (empId: number) => { const e = d.emp(empId); return !!e && ((rh && empId !== soi) || (manager && decideur(d, e, me, 'entretiens'))); };

  return (<>
    {pm
      ? <NoteAccent>{pm.libelle} : le point de mi-année est attendu de chaque salarié concerné (onglet Échéances, récapitulatif des échéances).</NoteAccent>
      : <Fine>Points de mi-année et points de suivi facultatifs : ils se planifient quand l’évaluateur le juge utile (Paramètres → Objectifs et points de suivi pour rendre le point de mi-année obligatoire).</Fine>}
    <div className="row-wrap">
      <Panel style={{ flex: '1 1 480px' }} title="Membres" aside="dernier point, prochain point, objectifs en cours">
        {v.membres.length > 0 ? (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th scope="col">Collaborateur</th><th scope="col">Dernier point</th><th scope="col">Prochain</th><th scope="col" className="right">Objectifs en cours</th><th scope="col"></th></tr></thead>
              <tbody>
                {v.membres.map(({ e, dernier, prevu, enCours }) => (
                  <tr key={e.id}>
                    <td><Two main={e.nom} sub={equipeLabel(e)} nowrap /></td>
                    <td className="nowrap">{dernier ? fmtIso(dernier) : <span className="text-muted">—</span>}</td>
                    <td className="nowrap">{prevu ? <Ouvrir onOpen={() => openDialog({ type: 'ent', entId: prevu.id })}>{ENT_TYPES[prevu.type].court} · {fmtIso(prevu.date)}</Ouvrir> : <span className="text-muted">—</span>}</td>
                    <td className="right tnum">{enCours}</td>
                    <td className="right">{peutPlanifier(e.id) && !prevu && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'entPlan', empId: e.id, kind: 'mi_annee' })}>Planifier un point</button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-muted empty">Aucun collaborateur.</p>}
      </Panel>
      <Panel style={{ flex: '1 1 320px', gap: 'var(--space-2)' }} title={`Points de suivi ${year}`}>
        {v.points.map(x => {
          const e = d.emp(x.empId);
          const [statut, cls] = x.statut === 'planifie' && x.date < d.ti ? ['Date dépassée', 'tag-accent'] : statutEntretien(x);
          return (
            <div key={x.id} className="list-row top clickable" style={{ justifyContent: 'space-between', gap: 'var(--space-3)' }} onClick={() => openDialog({ type: 'ent', entId: x.id })}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14 }}><Ouvrir onOpen={() => openDialog({ type: 'ent', entId: x.id })}>{e?.nom ?? d.personName(x.empId)} · {ENT_TYPES[x.type].nom}</Ouvrir></div>
                <div className="text-muted sub">{fmtIso(x.date)}</div>
              </div>
              <Tag cls={x.type === 'point' && x.statut === 'realise' && !x.signSal ? 'tag-neutral' : cls} style={{ flex: 'none' }}>{x.type === 'point' && x.statut === 'realise' && !x.signSal ? 'Clos' : statut}</Tag>
            </div>
          );
        })}
        {v.points.length === 0 && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Aucun point de suivi en {year}.</p>}
        <Fine>Le point de mi-année et le point de suivi ne portent que le suivi des objectifs (avancement, ajustement) : l’évaluation se fait à l’entretien annuel.</Fine>
      </Panel>
    </div>
  </>);
}
