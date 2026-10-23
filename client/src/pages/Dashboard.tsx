// Tableau de bord RH : conformité, échéances prioritaires, sessions et déplacements. Le référent HSE y traite les
// formations et habilitations ; la lecture seule le consulte sans bouton d'action.
import { useMemo } from 'react';
import { SESS_CLS, SESSION_PASSEE, TRIP_CLS, TRIP_LABEL } from '../../../shared/constants.ts';
import { sessionActive, type Domain, type EchItem } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { cap, equipeLabel, fmt, fmtShort, plural, rel } from '../../../shared/format.ts';
import { exigencesEquipe, nombreExigences } from '../../../shared/rules/exigences.ts';
import { declarationDetail, retireeAuRefus, valeurActuelle } from '../../../shared/rules/formalites.ts';
import type { DemandeCollab, Session } from '../../../shared/types.ts';
import { finSession, joursSession, plageCourte, plageTexte, surPlusieursJours } from '../../../shared/rules/plage-session.ts';
import { Bar, DateBlock, Empty, Kpi, Kpis, Page, Panel, Seg, Tag, Two, stop } from '../components/ui.tsx';
import { Ouvrir } from '../components/Cliquable.tsx';
import { useEnriched, useIntentPermis, useRole, useTrips } from '../state/derived.ts';
import { useAgir } from '../state/actions.ts';
import { refusDemande } from '../state/confirmations.ts';
import { useStore } from '../state/store.tsx';
import { LiensPieces } from '../components/PieceJointe.tsx';
import { CouverturePanel } from '../components/Couverture.tsx';
import { DossiersEchusPanel } from '../components/DossiersEchus.tsx';
import { sessionDemandeeComplete } from '../../../shared/rules/liste-attente.ts';

/** Ligne d'échéance (tableau de bord, page Échéances). */
export function EchRow({ x, onOpen, onAct }: { x: EchItem; onOpen: () => void; onAct: () => unknown }) {
  const { occupe, agir } = useAgir();
  return (
    <tr className="clickable" onClick={onOpen}>
      <td><Two main={<Ouvrir onOpen={onOpen}>{x.emp.nom}</Ouvrir>} sub={equipeLabel(x.emp)} /></td>
      <td><Two main={x.label} sub={x.kindLabel} /></td>
      <td>{x.sansDate ? <Two main={x.sansDateTexte?.main ?? 'Non renseignée'} sub={x.sansDateTexte?.sub ?? 'aucune visite enregistrée'} nowrap /> : <Two main={fmt(x.exp)} sub={rel(x.d)} nowrap />}</td>
      <td><Tag cls={x.cls}>{x.statut}</Tag></td>
      <td className="right">
        {/* Session à venir (planifié), ou passée en attente de clôture (note et bouton « Clôturer »). */}
        <div className="actions-end" style={{ alignItems: 'center' }}>
          {x.plannedLabel && <span className="note-accent nowrap">{x.plannedLabel}</span>}
          {!!x.action && !x.planned && <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={agir(onAct)}>{x.action.label}</button>}
        </div>
      </td>
    </tr>
  );
}

/**
 * Ligne de session : date (premier jour), plage (« 21 oct. → 23 oct. 2026 » sur plusieurs jours), formation, lieu,
 * remplissage, statut (passée à clôturer, complète…).
 */
export function sessionView(d: Domain, s: Session, nom: string) {
  const full = s.inscrits >= s.places;
  const statut = d.sessionStatut(s);
  const jours = surPlusieursJours(s) ? ` · ${plural(joursSession(s).length, 'jour', 'jours')}` : '';
  return { full, statut, cls: SESS_CLS[statut], pct: Math.round(s.inscrits / s.places * 100), nom, date: parse(s.date), plage: plageCourte(s), jours };
}

function reqLabel(r: DemandeCollab, fmNom: (id: string) => string, hmNom: (id: string) => string) {
  return r.type === 'formation' ? (r.f ? fmNom(r.f) : r.libelle ?? '') : r.type === 'habilitation' ? hmNom(r.h!) : r.label ?? '';
}
export function reqKind(r: DemandeCollab) {
  return r.type === 'formation' ? (r.f ? 'Demande de formation' : 'Formation hors catalogue') : r.type === 'habilitation' ? 'Demande d’habilitation' : 'Document déclaré';
}
export { reqLabel };

export function Dashboard() {
  const { emps, upcoming, horizon, d } = useEnriched();
  const trips = useTrips();
  const { setUi, go, run, runIntent, openDialog } = useStore();
  const { rh, formations } = useRole();
  const permis = useIntentPermis();
  const { occupe, agir } = useAgir();
  const data = d.ds;
  // Sessions passées, puis sessions sur plusieurs jours à leur dernier jour (clôturables dès ce jour-là).
  const dernierJour = d.enCours().filter(s => finSession(s) === d.ti);
  const aCloturer = [...d.aCloturer(), ...dernierJour];

  const v = useMemo(() => {
    const ech = d.echeances(emps, horizon);
    // Renouvellements (certifications, habilitations, aptitudes) ; les échéances du contrat ont leur propre panneau.
    const compl = ech.filter(x => x.kind !== 'trip' && x.kind !== 'contrat');
    const sansAction = (x: EchItem) => (x.action && !permis(x.action.intent) ? { ...x, action: null } : x);
    const total = emps.length;
    const nonExp = emps.filter(e => e.worst !== 'exp').length;
    const allCerts = emps.flatMap(e => e.certs);
    const plannedCount = allCerts.filter(c => c.key !== 'ok' && c.session).length;
    const placesLeft = upcoming.reduce((n, s) => n + Math.max(0, s.places - s.inscrits), 0);
    const teams = d.equipes.map(nom => {
      const list = emps.filter(e => e.equipe === nom);
      // Équipe sans membre : pas de taux de conformité (« — », barre vide).
      const pct = list.length ? Math.round(list.filter(e => e.worst !== 'exp').length / list.length * 100) : null;
      return { nom, pct };
    });
    return {
      total, nonExp, plannedCount, placesLeft, teams,
      due: compl.filter(c => c.key === 'due').length,
      // Titres expirés ; les exigences manquantes (jamais obtenues) ont leur indicateur.
      exp: compl.filter(c => c.key === 'exp' && c.kind !== 'exigence').length,
      // Collaborateurs qui ont un titre expiré (hors exigences manquantes, comptées à part).
      expires: new Set(compl.filter(c => c.key === 'exp' && c.kind !== 'exigence').map(c => c.emp.id)).size,
      manquants: emps.reduce((n, e) => n + e.manquants.length, 0), sansExigence: emps.filter(e => e.manquants.length).length,
      declarees: d.ds.referentiels.postes.some(p => nombreExigences(p) > 0) || d.ds.referentiels.equipes.some(q => nombreExigences(exigencesEquipe(q)) > 0),
      // Propositions d'action réservées aux profils qui peuvent les lancer (aucune en lecture seule).
      priority: compl.filter(c => c.key !== 'ok').sort((a, b) => a.d - b.d).slice(0, 8).map(sansAction),
      // Fins d'essai (avant le délai de prévenance), fins de contrat et titres de séjour à traiter (shared/rules/contrats.ts).
      contrats: ech.filter(c => c.kind === 'contrat' && c.key !== 'ok').sort((a, b) => a.d - b.d).slice(0, 6).map(sansAction),
    };
  }, [d, emps, horizon, upcoming, permis]);

  const reqs = data.demandesCollab.filter(r => r.statut === 'attente').sort((a, b) => a.date.localeCompare(b.date));
  const openEmp = (id: number) => go('collaborateurs', { selectedId: id });
  const nextUp = upcoming[0];

  return (
    <Page
      kicker={cap(d.today.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}
      title="Tableau de bord"
      actions={<>
        <span className="hint-label">Seuil d’alerte</span>
        <Seg name="horizon" label="Seuil d’alerte" value={horizon} onChange={h => setUi({ horizon: h })}
          options={[[30, '30 j'], [60, '60 j'], [90, '90 j'], [180, '180 j']]} />
      </>}
    >
      <Kpis>
        <Kpi kicker="Conformité" value={v.total ? `${Math.round(v.nonExp / v.total * 100)} %` : '—'} sub={`${v.nonExp} collaborateurs sur ${v.total} sans échéance dépassée`} />
        <Kpi kicker="À renouveler" value={v.due} sub={`sous ${horizon} jours · ${plural(v.plannedCount, 'inscription planifiée', 'inscriptions planifiées')}`} />
        <Kpi kicker="Expirées" value={v.exp} sub={v.exp ? `${plural(v.expires, 'collaborateur non conforme', 'collaborateurs non conformes')} · certifications, habilitations et aptitudes médicales` : 'aucune certification, habilitation ni aptitude médicale expirée'} />
        {/* Exigences des postes et des équipes (t055) : formations jamais suivies, habilitations jamais délivrées. */}
        <Kpi kicker="Exigences manquantes" value={v.declarees ? v.manquants : '—'}
          sub={!v.declarees ? 'aucune exigence déclarée par poste ni par équipe (Référentiels → Postes)'
            : v.manquants ? `${plural(v.sansExigence, 'collaborateur non conforme', 'collaborateurs non conformes')} · formation ou habilitation exigée jamais obtenue` : 'toutes les exigences des postes et des équipes sont remplies'} />
        <Kpi kicker="Sessions à venir" value={upcoming.length}
          sub={`${nextUp ? `prochaine le ${fmtShort(parse(nextUp.date))} · ${plural(v.placesLeft, 'place restante', 'places restantes')}` : 'aucune session planifiée'}${aCloturer.length ? ` · ${plural(aCloturer.length, 'session à clôturer', 'sessions à clôturer')}` : ''}`} />
      </Kpis>

      <div className="row-wrap">
        {reqs.length > 0 && (
          <Panel highlight style={{ flex: '1 1 100%' }} title="Demandes des collaborateurs" aside={`${plural(reqs.length, 'demande à traiter', 'demandes à traiter')} · envoyées depuis l’espace collaborateur${reqs.some(r => r.parId) ? ' ou par les managers' : ''}`}>
            <div className="scroll-x">
              <table className="table">
                <thead><tr><th>Collaborateur</th><th>Demande</th><th>Motif</th><th></th></tr></thead>
                <tbody>
                  {reqs.map(r => {
                    const e = d.emp(r.empId);
                    const s = d.session(r.sessionId);
                    // Session souhaitée complète (lot 7, t120) : l'acceptation propose la liste d'attente ou le plan de formation.
                    const complete = sessionDemandeeComplete(d, r);
                    const detail = [r.motif, s ? `session souhaitée ${plageTexte(s)}${sessionActive(s) ? complete ? ' (complète)' : '' : ` (${s.statut.toLowerCase()})`}` : ''].filter(Boolean).join(' · ');
                    const x = r.declaration;
                    // Formation ou habilitation archivée depuis la demande : elle ne s'accepte plus (refus du serveur).
                    const archivee = r.type === 'formation' ? !!(r.f && d.fm(r.f)?.archive) : r.type === 'habilitation' && !!(r.h && d.hm(r.h)?.archive);
                    const sub = [reqKind(r), r.parId ? `par ${d.personName(r.parId)} (manager)` : '', archivee ? `${r.type} archivée : à refuser, ou à rétablir d’abord` : ''].filter(Boolean).join(' · ');
                    return (
                      <tr key={r.id} className="clickable" onClick={() => openEmp(r.empId)}>
                        <td><Two main={<Ouvrir onOpen={() => openEmp(r.empId)}>{e?.nom ?? d.personName(r.empId)}</Ouvrir>} sub={`${equipeLabel(e)} · Reçue le ${fmtShort(parse(r.date))}`} nowrap /></td>
                        <td><Two main={reqLabel(r, id => d.fm(id).nom, id => d.hm(id).nom)} sub={sub} /></td>
                        {x && e
                          // Document déclaré : contenu saisi et valeur du dossier qu'il remplacera à la validation
                          // (sauf déclaration reprise d'une ancienne base, encore au dossier : un refus l'en retire).
                          ? <td style={{ fontSize: 13 }}><Two main={`Déclaré : ${declarationDetail(x)}`}
                              sub={retireeAuRefus(d, e, r) ? 'Déjà enregistré dans le dossier (avant validation RH) — un refus l’en retire' : `Actuellement : ${valeurActuelle(d, e, x)}`} />
                              {/* Copie du document jointe par le collaborateur (pièce justificative) : à ouvrir avant de valider. */}
                              <LiensPieces objet="declaration" objetId={r.id} /></td>
                          : <td className="text-muted" style={{ fontSize: 13 }}>{detail || 'À contrôler dans le dossier voyageur'}</td>}
                        <td className="right">
                          {/* Documents déclarés : service RH ; formations et habilitations : aussi le référent HSE. */}
                          {(r.type === 'document' ? rh : formations) && (
                            <div className="actions-end">
                              {/* Refus : confirmation et motif, communiqué au collaborateur seul (le manager qui a fait la demande n'en voit rien). */}
                              <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={stop(() => openDialog({ type: 'confirmer', c: refusDemande(r, e?.nom ?? d.personName(r.empId),
                                reqLabel(r, id => d.fm(id).nom, id => d.hm(id).nom), { manager: r.parId ? d.personName(r.parId) : null, retire: !!e && retireeAuRefus(d, e, r) }) }))}>Refuser</button>
                              <button type="button" className="btn btn-secondary btn-sm" disabled={occupe}
                                onClick={complete ? stop(() => openDialog({ type: 'accepterAttente', id: r.id })) : agir(() => run('demande.accepter', { id: r.id }))}>{r.type === 'document' ? 'Valider' : 'Accepter'}</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {/* Fins d'essai, fins de contrat et titres de séjour (shared/rules/contrats.ts) : service RH et lecture seule. */}
        {v.contrats.length > 0 && (
          <Panel highlight style={{ flex: '1 1 100%' }} title="Contrats à suivre"
            aside={<a href="/echeances" className="link-more" onClick={e => { e.preventDefault(); go('echeances', { echType: 'contrat' }); }}>Toutes les échéances du contrat →</a>}>
            <div className="scroll-x">
              <table className="table">
                <thead><tr><th>Collaborateur</th><th>Élément</th><th>Échéance</th><th>Statut</th><th></th></tr></thead>
                <tbody>
                  {v.contrats.map(x => (
                    <EchRow key={`${x.kind}-${x.emp.id}-${x.label}`} x={x} onOpen={() => openEmp(x.emp.id)} onAct={() => x.action && runIntent(x.action.intent)} />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {/* Couverture minimale des équipes en SST et équipiers incendie (shared/rules/couverture.ts). */}
        <CouverturePanel style={{ flex: '1 1 100%' }} />

        <Panel style={{ flex: '1 1 560px' }} title="Échéances prioritaires"
          aside={<a href="/echeances" className="link-more" onClick={e => { e.preventDefault(); go('echeances'); }}>Toutes les échéances →</a>}>
          {/* Liste vide (base neuve, tout à jour) : un message plutôt qu'un tableau sans ligne. */}
          {v.priority.length === 0 ? <Empty pad="md">Aucune échéance dans les {horizon} jours.</Empty> : (
            <table className="table">
              <thead><tr><th>Collaborateur</th><th>Élément</th><th>Échéance</th><th>Statut</th><th></th></tr></thead>
              <tbody>
                {v.priority.map(x => (
                  <EchRow key={`${x.kind}-${x.emp.id}-${x.label}`} x={x} onOpen={() => openEmp(x.emp.id)} onAct={() => x.action && runIntent(x.action.intent)} />
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <div className="col-stack" style={{ flex: '1 1 320px' }}>
          <DossiersEchusPanel />
          {aCloturer.length > 0 && (
            <Panel highlight title="Sessions à clôturer" aside={<a href="/formations" className="link-more" onClick={e => { e.preventDefault(); go('formations'); }}>Formations →</a>}>
              <div className="list">
                {aCloturer.map(s => (
                  <div key={s.id} className="list-row clickable" onClick={() => openDialog({ type: 'sessionDetail', sessionId: s.id })}>
                    <DateBlock date={parse(s.date)} />
                    <div className="grow">
                      <div className="ellipsis" style={{ fontSize: 14 }}><Ouvrir onOpen={() => openDialog({ type: 'sessionDetail', sessionId: s.id })}>{d.fm(s.formation).court}</Ouvrir></div>
                      <div className="note-accent ellipsis">{dernierJour.includes(s) ? 'Dernier jour' : SESSION_PASSEE} · {plural(s.inscrits, 'inscrit', 'inscrits')}{surPlusieursJours(s) ? ` · ${plageCourte(s)}` : ''}</div>
                    </div>
                    {formations && <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 'none' }} onClick={stop(() => openDialog({ type: 'cloture', sessionId: s.id }))}>Clôturer</button>}
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="Conformité par équipe" style={{ gap: 'var(--space-4)' }}>
            {v.teams.length === 0 && <Empty>Aucune équipe.</Empty>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {v.teams.map(t => (
                <div key={t.nom} style={{ display: 'grid', gridTemplateColumns: '124px minmax(0, 1fr) 48px', alignItems: 'center', gap: 'var(--space-3)', fontSize: 13 }}>
                  <span className="ellipsis">{t.nom}</span>
                  <Bar pct={t.pct ?? 0} />
                  <span className="right tnum muted-70" title={t.pct == null ? 'Aucun membre' : undefined}>{t.pct == null ? '—' : `${t.pct} %`}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Prochaines sessions" aside={<a href="/formations" className="link-more" onClick={e => { e.preventDefault(); go('formations'); }}>Toutes →</a>}>
            {upcoming.length === 0 && <Empty>Aucune session à venir.</Empty>}
            <div className="list">
              {upcoming.slice(0, 3).map(s => {
                const sv = sessionView(d, s, d.fm(s.formation).court);
                return (
                  <div key={s.id} className="list-row clickable" onClick={() => openDialog({ type: 'sessionDetail', sessionId: s.id })}>
                    <DateBlock date={sv.date} />
                    <div className="grow">
                      <div className="ellipsis" style={{ fontSize: 14 }}><Ouvrir onOpen={() => openDialog({ type: 'sessionDetail', sessionId: s.id })}>{sv.nom}</Ouvrir></div>
                      <div className="text-muted sub ellipsis">{s.lieu} · {s.inscrits}/{s.places} inscrits{sv.jours}</div>
                    </div>
                    <Tag cls={sv.cls} style={{ flex: 'none' }}>{sv.statut}</Tag>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* Dossiers de voyage (passeport, visas, vaccinations) : service RH seulement. */}
          {rh && <Panel title="Déplacements à préparer" aside={<a href="/voyages" className="link-more" onClick={e => { e.preventDefault(); go('voyages'); }}>Tous →</a>}>
            {trips.length === 0 && <Empty>Aucun déplacement à préparer.</Empty>}
            <div className="list">
              {trips.slice(0, 3).map(t => (
                <div key={t.id} className="list-row clickable" onClick={() => go('voyages', { tripSel: t.id })}>
                  <DateBlock date={t.r.dep} />
                  <div className="grow">
                    <div className="ellipsis" style={{ fontSize: 14 }}><Ouvrir onOpen={() => go('voyages', { tripSel: t.id })}>{t.emp.nom}</Ouvrir></div>
                    <div className="text-muted sub ellipsis">{t.r.dest.pays} · {t.motif}</div>
                  </div>
                  <Tag cls={TRIP_CLS[t.r.status]} style={{ flex: 'none' }}>{TRIP_LABEL[t.r.status]}</Tag>
                </div>
              ))}
            </div>
          </Panel>}
        </div>
      </div>
    </Page>
  );
}
