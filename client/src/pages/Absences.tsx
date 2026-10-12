// Congés & absences : soldes CP / RTT / récupération / CET, demandes à valider, absences hors congés
// (signalées par le manager ou le salarié, qualifiées par le service RH, prolongées, annulées),
// règles appliquées (CCN Industries chimiques) et référentiel des natures d'absence.
// Le manager ne reçoit jamais la nature d'un arrêt de travail : il voit « Absence », ses dates et son état.
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { ABS_CLS, ABS_LABEL, CATEGORIES_ABSENCE, NATURES_ABSENCE, STATUTS, type CategorieAbsence, type PaieAbsence } from '../../../shared/constants.ts';
import type { Domain } from '../../../shared/domain.ts';
import { cpPeriods, parse } from '../../../shared/dates.ts';
import { cap, equipeLabel, fH, fJ, fmt, fmtIso, fmtShort, plural } from '../../../shared/format.ts';
import { absenceActive, droitAnnulation, estConge, joursDecomptes, natureDef, prolongeable, statutAbsence, uniteDecompte } from '../../../shared/rules/absences.ts';
import { absenceKinds, cetInfo, cpInfo, recupInfo, reposForfait, rttInfo } from '../../../shared/rules/conges.ts';
import type { Absence, Employe, NatureAbsence } from '../../../shared/types.ts';
import { Empty, Fine, Kpi, Kpis, Page, Panel, Tag, Two, stop } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/**
 * Soldes d'un collaborateur, mis en forme pour le tableau et les cartes.
 * Intérim : congés gérés par l'agence — ni absence à poser, ni compte épargne-temps.
 */
function soldeRow(d: Domain, e: Employe) {
  const c = d.contratOf(e), cp = cpInfo(d, e), rt = rttInfo(d, e), rc = recupInfo(d, e), ct = cetInfo(d, e);
  const cet = !c.interim && ct.eligible;
  return {
    e, cpSolde: cp ? cp.solde : 0, cetPlaceable: cet && (ct.placeCp > 0 || ct.placeRtt > 0),
    poser: absenceKinds(d, e).length > 0, cpGere: !!cp,
    contrat: `${STATUTS[c.statut].court} · ${c.label}`,
    cp: cp ? fJ(cp.solde) : 'Agence',
    cpSub: cp
      ? `sur ${cp.droit} j${cp.ageSupp ? ' · dont 5 j CCN (59 ans et +)' : ''}${cp.recu ? ` · report +${cp.recu} j` : ''}${cp.accorde ? ` · ${cp.accorde} j protégés au-delà du 31 mai` : ''}`
      : 'géré par l’agence d’intérim',
    cpN: cp ? fJ(cp.enCours) : '—',
    rtt: rt ? fJ(rt.solde) : '—',
    rttSub: rt ? `${rt.label} · sur ${rt.droit} j · perdus au 31 déc.` : 'non concerné',
    rttLabel: rt ? rt.label : 'RTT',
    rttCard: rt ? `sur ${rt.droit} j · perdus au 31 déc.`
      : c.dirigeant ? 'cadre dirigeant : congés payés uniquement'
      : c.annuel ? 'forfait annuel en heures : pas de RTT'
      : 'non concerné',
    rec: rc ? fH(rc.solde) : '—',
    recSub: rc ? `≈ ${fJ(rc.solde / rc.dh)}` : 'non concerné',
    cet: cet ? fJ(ct.total) : '—',
    cetSub: cet ? (ct.total ? `${ct.cp} j CP · ${ct.rtt} j RTT` : 'aucun jour épargné') : 'non concerné',
  };
}

function Num({ main, sub }: { main: ReactNode; sub?: ReactNode }) {
  return <><div className="tnum">{main}</div>{sub != null && <div className="text-muted sub">{sub}</div>}</>;
}

const NATURES = Object.entries(NATURES_ABSENCE) as [NatureAbsence, (typeof NATURES_ABSENCE)[NatureAbsence]][];
const PAIE_COURT: Record<PaieAbsence, string> = { maintenue: 'payée', indemnisee: 'indemnisée (IJSS)', non_payee: 'non payée' };
const dates = (a: Absence) => a.du === a.au ? fmt(parse(a.du)) : `${fmtShort(parse(a.du))} → ${fmt(parse(a.au))}`;

/** Précisions d'une absence : rémunération et justificatif (hors congés), signalement, prolongation, annulation. */
function details(a: Absence): string[] {
  const n = natureDef(a.type);
  return [
    n ? `${cap(PAIE_COURT[n.paie])} · ${a.justificatif && a.justificatifLe ? `justificatif reçu le ${fmtIso(a.justificatifLe)}` : n.justificatif ? 'justificatif attendu' : 'sans justificatif'}` : '',
    a.statut === 'signalee'
      ? `Signalée${a.signaleLe ? ` le ${fmtIso(a.signaleLe)}` : ''}${a.signalePar ? ` par ${a.signalePar}` : ''} · ${a.type === 'ABSENCE' ? 'nature à préciser par le service RH' : 'prolongation à qualifier'}`
      : '',
    a.type === 'ABSENCE' && a.statut === 'validee' ? 'Nature précisée par le service RH, confidentielle' : '',
    a.finInitiale && a.statut !== 'annulee' ? `Prolongée · fin initiale le ${fmtIso(a.finInitiale)}` : '',
    a.statut === 'annulee' && a.annuleeLe ? `Annulée le ${fmtIso(a.annuleeLe)}${a.annuleePar ? ` par ${a.annuleePar}` : ''}` : '',
  ].filter(Boolean);
}

export function Absences() {
  const d = useDomain();
  const data = d.ds;
  const { rh, manager, collab, me } = useRole();
  const { openDialog, run } = useStore();
  const P = cpPeriods(data.today);
  const Y = d.year;

  const rows = data.employes.map(e => soldeRow(d, e)).sort((a, b) => a.e.nom.localeCompare(b.e.nom));
  const mine = collab ? rows.find(r => r.e.id === me) : undefined;
  // « Poser une absence » pour soi-même : masqué quand aucun type n'est ouvert (intérim).
  const canPoseMe = !rh && !!rows.find(r => r.e.id === me)?.poser;
  const canCet = (r: ReturnType<typeof soldeRow>) => (rh || r.e.id === me) && r.cetPlaceable;

  // Droits de l'utilisateur sur les absences d'un collaborateur : RH, intéressé, manager direct.
  const qui = (e: Employe) => ({ rh, self: !rh && e.id === me, manager: manager && e.id !== me && d.mgrOf(e) === me });
  // À traiter d'abord (demandes, signalements), les absences annulées en dernier.
  const rang = (a: Absence) => a.statut === 'demandee' ? 0 : a.statut === 'signalee' ? 1 : a.statut === 'annulee' ? 3 : 2;
  const absList = data.absences
    .filter(a => a.au >= P.prisStart || a.statut === 'signalee')
    .map(a => ({ a, e: d.emp(a.empId) }))
    .filter((x): x is { a: Absence; e: Employe } => !!x.e)
    .sort((x, y) => rang(x.a) - rang(y.a) || x.a.du.localeCompare(y.a.du))
    .map(({ a, e }) => {
      const q = qui(e);
      return {
        a, e,
        canDecide: a.statut === 'demandee' && (rh || (manager && d.mgrOf(e) === me)),
        canProlong: prolongeable(a) && (q.rh || q.self || q.manager),
        annulation: droitAnnulation(a, data.today, q),
      };
    });
  const nDecide = absList.filter(x => x.canDecide).length;
  const aQualifier = rh ? absList.filter(x => x.a.statut === 'signalee') : [];

  return (
    <Page
      kicker={rh ? 'Période de référence CP : 1er juin – 31 mai · décompte en jours ouvrés · CCN Industries chimiques' : 'Congés payés en jours ouvrés · RTT perdus au 31 décembre'}
      title="Congés & absences"
      actions={<>
        {rh && <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'absNature' })}>Saisir une absence</button>}
        {!rh && <button type="button" className={canPoseMe ? 'btn btn-secondary' : 'btn btn-primary'} onClick={() => openDialog({ type: 'absSignal' })}>Signaler une absence</button>}
        {canPoseMe && me != null && <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'abs', empId: me })}>Poser une absence</button>}
      </>}
    >
      {mine && (
        <Kpis>
          <Kpi kicker={`Congés payés ${P.label}`} value={mine.cp} sub={mine.cpGere ? `${mine.cpSub} · avant le ${fmt(parse(P.deadline))}` : mine.cpSub} />
          <Kpi kicker="En cours d’acquisition" value={mine.cpN} sub={mine.cpGere ? `période ${P.labelN} · 2,08 j par mois` : 'géré par l’agence d’intérim'} />
          <Kpi kicker={`${mine.rttLabel} ${Y}`} value={mine.rtt} sub={mine.rttCard} />
          <Kpi kicker="Récupération" value={mine.rec} sub={mine.recSub} />
          <Kpi kicker="Compte épargne-temps" value={mine.cet} sub={mine.cetSub}
            action={canCet(mine) ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'cet', empId: mine.e.id })}>Épargner</button> : undefined} />
        </Kpis>
      )}

      {aQualifier.length > 0 && (
        <Panel highlight title="Absences à qualifier" aside={`${plural(aQualifier.length, 'absence signalée', 'absences signalées')} · nature et justificatif à préciser`}>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Collaborateur</th><th>Absence</th><th>Jours</th><th>Signalement</th><th></th></tr></thead>
              <tbody>
                {aQualifier.map(({ a, e }) => (
                  <tr key={a.id}>
                    <td><Two main={e.nom} sub={equipeLabel(e)} nowrap /></td>
                    <td>
                      <div>{ABS_LABEL[a.type]} · {dates(a)}</div>
                      {a.finInitiale && <div className="text-muted sub">Prolongée · fin initiale le {fmtIso(a.finInitiale)}</div>}
                    </td>
                    <td><Num main={fJ(joursDecomptes(d, e, a))} sub={uniteDecompte(a.type)} /></td>
                    <td><Two main={a.signaleLe ? fmtIso(a.signaleLe) : '—'} sub={a.signalePar ?? ''} /></td>
                    <td className="right">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'absNature', id: a.id })}>Qualifier</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {!collab && (
        <Panel title="Soldes">
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Collaborateur</th><th>CP {P.label}</th><th>En acquisition</th><th>RTT / repos {Y}</th><th>Récupération</th><th>CET</th><th></th></tr></thead>
              <tbody>
                {rows.map(r => {
                  const canPose = r.poser && (rh || r.e.id === me || (manager && d.mgrOf(r.e) === me));
                  return (
                    <tr key={r.e.id}>
                      <td><Two main={r.e.nom} sub={r.contrat} nowrap /></td>
                      <td><Num main={r.cp} sub={r.cpSub} /></td>
                      <td className="tnum">{r.cpN}</td>
                      <td><Num main={r.rtt} sub={r.rttSub} /></td>
                      <td><Num main={r.rec} sub={r.recSub} /></td>
                      <td><Num main={r.cet} sub={r.cetSub} /></td>
                      <td className="right">
                        <div style={{ display: 'flex', gap: 'var(--space-1)', justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          {canCet(r) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'cet', empId: r.e.id })}>Épargner</button>}
                          {rh && r.cpSolde > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'report', empId: r.e.id })}>Reporter</button>}
                          {canPose && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'abs', empId: r.e.id })}>Poser</button>}
                          {manager && r.e.id !== me && d.mgrOf(r.e) === me && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'absSignal', empId: r.e.id })}>Signaler</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Demandes et absences prévues" aside={`${plural(nDecide, 'demande à valider', 'demandes à valider')} · indisponibilités transmises à Keystone pour la planification, sans la nature des arrêts`}>
        {absList.length > 0 ? (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Collaborateur</th><th>Absence</th><th>Jours</th><th>Statut</th><th></th></tr></thead>
              <tbody>
                {absList.map(({ a, e, canDecide, canProlong, annulation }) => {
                  const m = data.missions.find(x => x.empId === a.empId && x.du <= a.au && x.au >= a.du);
                  const ks = a.statut === 'demandee' ? `Validation : ${d.mgrName(d.mgrOf(e))}`
                    : a.statut === 'signalee' ? 'À qualifier par le service RH'
                    : a.statut === 'validee' ? (estConge(a.type) ? 'Transmise à Keystone' : 'Indisponibilité transmise à Keystone') : '';
                  return (
                    <tr key={a.id}>
                      <td><Two main={e.nom} sub={equipeLabel(e)} nowrap /></td>
                      <td>
                        <div>{ABS_LABEL[a.type]} · {dates(a)}</div>
                        {details(a).map(t => <div key={t} className="text-muted sub">{t}</div>)}
                        {m && absenceActive(a) && <div className="note-accent">Chevauche la mission {m.projet} · {m.lieu}</div>}
                      </td>
                      <td className="nowrap"><Num main={fJ(joursDecomptes(d, e, a))} sub={uniteDecompte(a.type)} /></td>
                      <td>
                        <Tag cls={ABS_CLS[a.statut]}>{statutAbsence(a)}</Tag>
                        <div className="text-muted sub-11" style={{ marginTop: 'var(--space-1)' }}>{ks}</div>
                      </td>
                      <td className="right">
                        <div className="actions-end">
                          {canDecide && <>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={stop(() => run('absence.decider', { id: a.id, ok: false }))}>Refuser</button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={stop(() => run('absence.decider', { id: a.id, ok: true }))}>Valider</button>
                          </>}
                          {rh && prolongeable(a) && (
                            <button type="button" className={`btn btn-sm ${a.statut === 'signalee' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => openDialog({ type: 'absNature', id: a.id })}>
                              {a.statut === 'signalee' ? 'Qualifier' : 'Modifier'}
                            </button>
                          )}
                          {canProlong && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'absProlonger', id: a.id })}>Prolonger</button>}
                          {annulation.ok && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'absAnnuler', id: a.id })}>
                              {a.statut === 'demandee' && !rh ? 'Retirer' : 'Annuler'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty>Aucune absence prévue.</Empty>}
      </Panel>

      {rh && (
        <Panel title="Règles appliquées">
          <Rtt39Field />
          <ul className="rules">
            <li>Congés payés : 25 jours ouvrés par an, acquis à raison de 2,08 j par mois du 1er juin au 31 mai, arrondis à l’entier supérieur.</li>
            <li>CCN Industries chimiques : pas de congés d’ancienneté ; +5 jours ouvrés à partir de 59 ans.</li>
            <li>Forfait annuel en jours : jours de repos calculés individuellement selon le nombre de jours du forfait (jours calendaires − week-ends − 25 CP − fériés ouvrés − jours du forfait) ; {reposForfait(Y, 218)} jours en {Y} pour un forfait de 218 jours.</li>
            <li>Forfait annuel en heures : pas de RTT ni de repos compensateur hebdomadaire ; les heures au-delà du forfait sont régularisées en fin d’année.</li>
            <li>Forfait hebdomadaire en heures : heures supplémentaires incluses au forfait (au-delà de 35 h) majorées dans la rémunération ; repos compensateur pour les heures effectuées au-delà du forfait.</li>
            <li>Cadre dirigeant (art. L3111-2) : congés payés uniquement — ni RTT, ni repos compensateur.</li>
            <li>Temps partiel : même droit à congés ; le décompte des CP inclut les jours non travaillés de la période.</li>
            <li>Report d’une année sur l’autre : CP uniquement, au cas par cas par le service RH. RTT perdus au 31 décembre.</li>
            <li>Compte épargne-temps : jusqu’à 5 RTT par an (avant le 31 décembre) et 5 CP par période, uniquement ceux de la 5e semaine (au-delà de 20 jours ouvrés).</li>
            <li>Intérim : congés gérés par l’agence ; CDD : indemnité compensatrice des CP non pris à l’échéance.</li>
            <li>Absences et feuilles de temps restent dans les bornes du contrat : entrée, fin du CDD, de la mission ou de l’alternance.</li>
            <li>Annulation : le salarié retire sa demande en attente, ou son propre signalement tant qu’il n’est ni qualifié ni prolongé ; le manager ou le service RH annulent une absence qui n’a pas commencé, le service RH seul une absence commencée ou passée. Le solde est recrédité et Keystone prévenu ; une feuille soumise sans heure que l’absence couvrait est renvoyée pour saisie.</li>
          </ul>
        </Panel>
      )}

      {rh && (
        <Panel title="Absences hors congés" aside="Durées minimales du Code du travail · la CCN peut être plus favorable">
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Nature</th><th>Rémunération</th><th>Décompte · durée</th><th>Justificatif</th><th>Congés payés (pour mémoire)</th></tr></thead>
              {(Object.keys(CATEGORIES_ABSENCE) as CategorieAbsence[]).map(c => (
                <tbody key={c}>
                  <tr><td colSpan={5} className="section-label">{CATEGORIES_ABSENCE[c]}</td></tr>
                  {NATURES.filter(([, n]) => n.categorie === c).map(([k, n]) => (
                    <tr key={k}>
                      <td><Two main={n.label} sub={n.reprise ? 'entretien de parcours de reprise à la fin' : n.medicale ? 'nature jamais transmise au manager ni à Keystone' : undefined} /></td>
                      <td className="sub">{cap(PAIE_COURT[n.paie])}</td>
                      <td><Two main={`Jours ${n.decompte === 'ouvres' ? 'ouvrés' : 'calendaires'}${n.duree ? ` · ${fJ(n.duree)}${n.parAn ? ' par an' : ''}` : ''}`} sub={[n.dureeNote, n.article].filter(Boolean).join(' · ')} /></td>
                      <td className="sub">{n.justificatif ?? '—'}</td>
                      <td className="sub">{n.cp}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          <Fine>
            Le manager ou le salarié signale une absence imprévue ; elle compte aussitôt (aucune heure ces jours-là, indisponibilité transmise à Keystone).
            Le service RH la qualifie à réception du justificatif, ou saisit directement une absence prévisible. Aucun solde de congés n’est débité ;
            une semaine entièrement couverte se soumet sans heure. À la fin d’une maternité, d’une adoption, d’un congé parental ou d’un arrêt longue maladie,
            la date de reprise est inscrite sur la fiche (entretien de parcours professionnel, art. L6315-1), sauf si une reprise antérieure attend encore son entretien ;
            celle d’un arrêt longue maladie n’est pas montrée au manager. L’effet sur l’acquisition des CP est indiqué pour mémoire : il n’est pas encore appliqué au calcul des droits.
          </Fine>
        </Panel>
      )}
    </Page>
  );
}

/** Nombre de RTT des contrats 39 h : enregistré à la sortie du champ ou sur Entrée. */
function Rtt39Field() {
  const d = useDomain();
  const { run } = useStore();
  const value = Number(d.ds.settings.rtt39) || 0;
  const [text, setText] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) { setPrev(value); setText(String(value)); }

  const commit = async () => {
    const n = Math.max(0, Math.min(40, Math.round(Number(text) || 0)));
    setText(String(n));
    if (n === value) return;
    const r = await run('parametres.maj', { rtt39: n, silent: true });
    if (!r.ok) setText(String(value));
  };
  const onKey = (ev: KeyboardEvent<HTMLInputElement>) => { if (ev.key === 'Enter') ev.currentTarget.blur(); };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', fontSize: 14 }}>
      <label htmlFor="rtt39">Contrats 39 h : nombre de RTT par an</label>
      <input className="input" id="rtt39" type="number" min={0} max={40} value={text} onChange={ev => setText(ev.target.value)} onBlur={commit} onKeyDown={onKey} style={{ width: 80, textAlign: 'right' }} />
    </div>
  );
}
