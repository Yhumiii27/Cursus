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
import { DEMI_LABEL, periodeDemiTexte } from '../../../shared/rules/demi-journees.ts';
import { absenceKinds, cetInfo, cpInfo, recupInfo, reposForfait, rttInfo } from '../../../shared/rules/conges.ts';
import type { Absence, DemiJournee, Employe, NatureAbsence } from '../../../shared/types.ts';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { CloturesConges } from '../components/CloturesConges.tsx';
import { InformationsRetour } from '../components/InformationsRetour.tsx';
import { LectureSeule, useLectureSeule } from '../components/Hierarchie.tsx';
import { Btn, Empty, Fine, Kpi, Kpis, Page, Panel, Tag, Two } from '../components/ui.tsx';
import { csvAbsences, csvSoldes } from '../listes-csv.ts';
import { downloadCsv } from '../print.ts';
import { useAgir } from '../state/actions.ts';
import { refusAbsence } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/**
 * Soldes d'un collaborateur, mis en forme pour le tableau et les cartes.
 * Intérim : congés gérés par l'agence — ni absence à poser, ni compte épargne-temps.
 */
function soldeRow(d: Domain, e: Employe) {
  const c = d.contratOf(e), cp = cpInfo(d, e), rt = rttInfo(d, e), rc = recupInfo(d, e), ct = cetInfo(d, e);
  const cet = !c.interim && ct.eligible;
  const P = cpPeriods(d.ti);
  // RTT de l'année suivante déjà posés ou validés (posables dès maintenant sur le droit de cette année-là).
  const suiv = rt ? rttInfo(d, e, d.year + 1) : null, rttSuivants = suiv ? suiv.pris + suiv.poses : 0;
  const rttSuivTxt = rttSuivants ? ` · ${fJ(rttSuivants)} posé${rttSuivants > 1 ? 's' : ''} sur ${d.year + 1}` : '';
  return {
    e, cpSolde: cp ? cp.solde : 0, cetPlaceable: cet && (ct.placeCp > 0 || ct.placeRtt > 0 || ct.placeRttPrec > 0),
    poser: absenceKinds(d, e).length > 0, cpGere: !!cp,
    contrat: `${STATUTS[c.statut].court} · ${c.label}`,
    cp: cp ? fJ(cp.solde) : 'Agence',
    cpSub: cp
      ? `sur ${cp.droit} j${cp.ageSupp ? ' · dont 5 j CCN (59 ans et +)' : ''}${cp.recu ? ` · dont ${fJ(cp.recu)} de report reçu` : ''}${cp.accorde ? ` · ${fJ(cp.accorde)} reportés sur ${P.labelN} à la clôture` : ''}`
      : 'géré par l’agence d’intérim',
    cpN: cp ? fJ(cp.enCours) : '—',
    // Jours déjà imputés sur la période en cours d'acquisition : pris par anticipation, ou posés à partir du 1er juin.
    cpNSub: cp && cp.suivante ? `dont ${fJ(cp.suivante)} déjà posé${cp.suivante > 1 ? 's' : ''}${cp.anticipes ? ` (${fJ(cp.anticipes)} par anticipation)` : ''}` : undefined,
    rtt: rt ? fJ(rt.solde) : '—',
    rttSub: rt ? `${rt.label} · sur ${rt.droit} j · perdus au 31 déc.${rttSuivTxt}` : 'non concerné',
    rttLabel: rt ? rt.label : 'RTT',
    rttCard: rt ? `sur ${rt.droit} j · perdus au 31 déc.${rttSuivTxt}`
      : c.dirigeant ? 'cadre dirigeant : congés payés uniquement'
      : c.annuel ? 'forfait annuel en heures : pas de RTT'
      : 'non concerné',
    rec: rc ? fH(rc.solde) : '—',
    recSub: rc ? `≈ ${fJ(rc.solde / rc.dh)}` : 'non concerné',
    cet: cet ? fJ(ct.total) : '—',
    cetSub: cet ? (ct.total ? `${ct.cp} j CP · ${ct.rtt} j RTT${ct.repris ? ` · ${ct.repris} j repris` : ''}` : 'aucun jour épargné') : 'non concerné',
  };
}

function Num({ main, sub }: { main: ReactNode; sub?: ReactNode }) {
  return <><div className="tnum">{main}</div>{sub != null && <div className="text-muted sub">{sub}</div>}</>;
}

const NATURES = Object.entries(NATURES_ABSENCE) as [NatureAbsence, (typeof NATURES_ABSENCE)[NatureAbsence]][];
const PAIE_COURT: Record<PaieAbsence, string> = { maintenue: 'payée', indemnisee: 'indemnisée (IJSS)', non_payee: 'non payée' };
// Demi-journées du premier et du dernier jour (CP, RTT, récupération) : « 12 oct. après-midi → 16 oct. 2026 matin ».
const demi = (x: DemiJournee | null | undefined) => x ? ` ${DEMI_LABEL[x]}` : '';
const dates = (a: Absence) => a.du === a.au ? `${fmt(parse(a.du))}${demi(a.debutDemi)}` : `${fmtShort(parse(a.du))}${demi(a.debutDemi)} → ${fmt(parse(a.au))}${demi(a.finDemi)}`;

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
    a.statut === 'refusee' && a.motifRefus ? `Motif du refus : ${a.motifRefus}` : '',
  ].filter(Boolean);
}

export function Absences() {
  const d = useDomain();
  const data = d.ds;
  // Espace RH : toutes les absences ; décisions par le service RH, jamais sur ses propres absences (`soi`) ; la paie et
  // la lecture seule consultent.
  const { espaceRh, rh, manager, collab, me, soi } = useRole();
  const { openDialog, run, notify } = useStore();
  const { occupe, agir } = useAgir();
  const P = cpPeriods(data.today);
  const Y = d.year;

  const rows = data.employes.map(e => soldeRow(d, e)).sort((a, b) => a.e.nom.localeCompare(b.e.nom));
  // Consultation N+2 (t136) : soldes des équipes rattachées consultés, sans action.
  const lecture = useLectureSeule();
  const mine = collab ? rows.find(r => r.e.id === me) : undefined;
  // « Poser une absence » pour soi-même : masqué quand aucun type n'est ouvert (intérim).
  const canPoseMe = !espaceRh && !!rows.find(r => r.e.id === me)?.poser;
  const canCet = (r: ReturnType<typeof soldeRow>) => (rh || r.e.id === me) && r.cetPlaceable;

  // Droits de l'utilisateur sur les absences d'un collaborateur : RH, intéressé, manager direct. Un membre du RH agit
  // sur ses propres absences comme intéressé.
  const qui = (e: Employe) => ({ rh: rh && e.id !== soi, self: (!espaceRh && e.id === me) || (rh && e.id === soi), manager: manager && e.id !== me && d.mgrOf(e) === me });
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
        canDecide: a.statut === 'demandee' && (q.rh || (manager && d.mgrOf(e) === me)),
        canProlong: prolongeable(a) && (q.rh || q.self || q.manager),
        annulation: droitAnnulation(a, data.today, q),
      };
    });
  const nDecide = absList.filter(x => x.canDecide).length;
  // Exports des tableaux affichés : soldes avec la mention « soldes calculés par Cursus », absences sans leur nature.
  const exporterSoldes = () => {
    const x = csvSoldes(d, rows.map(r => r.e));
    downloadCsv(x.fichier, x.head, x.rows);
    notify(`Export CSV généré — ${plural(rows.length, 'solde', 'soldes')}`);
  };
  const exporterAbsences = () => {
    const x = csvAbsences(d, absList);
    downloadCsv(x.fichier, x.head, x.rows);
    notify(`Export CSV généré — ${plural(absList.length, 'absence', 'absences')}`);
  };
  const boutonExport = (onClick: () => void) => <Btn small variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={onClick}>Exporter (CSV)</Btn>;
  const aQualifier = rh ? absList.filter(x => x.a.statut === 'signalee' && x.e.id !== soi) : [];

  return (
    <Page
      kicker={espaceRh ? 'Période de référence CP : 1er juin – 31 mai · décompte en jours ouvrés · CCN Industries chimiques' : 'Congés payés en jours ouvrés · RTT perdus au 31 décembre'}
      title="Congés & absences"
      actions={<>
        {rh && <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'absNature' })}>Saisir une absence</button>}
        {!espaceRh && <button type="button" className={canPoseMe ? 'btn btn-secondary' : 'btn btn-primary'} onClick={() => openDialog({ type: 'absSignal' })}>Signaler une absence</button>}
        {canPoseMe && me != null && <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'abs', empId: me })}>Poser une absence</button>}
      </>}
    >
      {mine && (
        <Kpis>
          <Kpi kicker={`Congés payés ${P.label}`} value={mine.cp} sub={mine.cpGere ? `${mine.cpSub} · avant le ${fmt(parse(P.deadline))}` : mine.cpSub} />
          <Kpi kicker="En cours d’acquisition" value={mine.cpN} sub={mine.cpGere ? `période ${P.labelN} · 2,08 j par mois${mine.cpNSub ? ` · ${mine.cpNSub}` : ''}` : 'géré par l’agence d’intérim'} />
          <Kpi kicker={`${mine.rttLabel} ${Y}`} value={mine.rtt} sub={mine.rttCard} />
          <Kpi kicker="Récupération" value={mine.rec} sub={mine.recSub} />
          <Kpi kicker="Compte épargne-temps" value={mine.cet} sub={mine.cetSub}
            action={canCet(mine) ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'cet', empId: mine.e.id })}>Épargner</button> : undefined} />
        </Kpis>
      )}

      {espaceRh && <CloturesConges />}
      <InformationsRetour />

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
        <Panel title="Soldes" aside={rows.length > 0 ? boutonExport(exporterSoldes) : undefined}>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Collaborateur</th><th>CP {P.label}</th><th>En acquisition</th><th>RTT / repos {Y}</th><th>Récupération</th><th>CET</th><th></th></tr></thead>
              <tbody>
                {rows.map(r => {
                  const canPose = r.poser && (rh || r.e.id === me || (manager && d.mgrOf(r.e) === me));
                  return (
                    <tr key={r.e.id}>
                      <td><Two main={lecture.has(r.e.id) ? <>{r.e.nom} <LectureSeule d={d} empId={r.e.id} /></> : r.e.nom} sub={r.contrat} nowrap /></td>
                      <td><Num main={r.cp} sub={r.cpSub} /></td>
                      <td><Num main={r.cpN} sub={r.cpNSub} /></td>
                      <td><Num main={r.rtt} sub={r.rttSub} /></td>
                      <td><Num main={r.rec} sub={r.recSub} /></td>
                      <td><Num main={r.cet} sub={r.cetSub} /></td>
                      <td className="right">
                        <div style={{ display: 'flex', gap: 'var(--space-1)', justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          {canCet(r) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'cet', empId: r.e.id })}>Épargner</button>}
                          {rh && r.e.id !== soi && r.cpSolde > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'report', empId: r.e.id })}>Reporter</button>}
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

      <Panel title="Demandes et absences prévues" aside={
        <div className="actions-end" style={{ alignItems: 'center' }}>
          <span className="text-muted sub">{`${plural(nDecide, 'demande à valider', 'demandes à valider')} · indisponibilités transmises à Keystone pour la planification, sans la nature des arrêts`}</span>
          {!collab && absList.length > 0 && boutonExport(exporterAbsences)}
        </div>
      }>
        {absList.length > 0 ? (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Collaborateur</th><th>Absence</th><th>Jours</th><th>Statut</th><th></th></tr></thead>
              <tbody>
                {absList.map(({ a, e, canDecide, canProlong, annulation }) => {
                  const m = data.missions.find(x => x.empId === a.empId && x.du <= a.au && x.au >= a.du);
                  const mgr = d.mgrOf(e);
                  // Sa propre demande : un membre du RH ne la décide pas, son manager ou un autre membre du service RH le fait.
                  const ks = a.statut === 'demandee' ? (rh && e.id === soi
                    ? `Votre demande : décision par ${mgr ? `${d.personName(mgr)} ou ` : ''}un autre membre du service RH`
                    : `Validation : ${d.mgrName(mgr)}`)
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
                            {/* Refus : confirmation et motif, montré au salarié et à son manager dans leurs absences. */}
                            <button type="button" className="btn btn-ghost btn-sm" disabled={occupe}
                              onClick={() => openDialog({ type: 'confirmer', c: refusAbsence(a, e.nom, `${ABS_LABEL[a.type]}, ${periodeDemiTexte(a)}`,
                                mgr && mgr !== me ? d.personName(mgr) : null) })}>Refuser</button>
                            <button type="button" className="btn btn-secondary btn-sm" disabled={occupe} onClick={agir(() => run('absence.decider', { id: a.id, ok: true }))}>Valider</button>
                          </>}
                          {rh && e.id !== soi && prolongeable(a) && (
                            <button type="button" className={`btn btn-sm ${a.statut === 'signalee' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => openDialog({ type: 'absNature', id: a.id })}>
                              {a.statut === 'signalee' ? 'Qualifier' : 'Modifier'}
                            </button>
                          )}
                          {canProlong && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'absProlonger', id: a.id })}>Prolonger</button>}
                          {annulation.ok && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'absAnnuler', id: a.id })}>
                              {a.statut === 'demandee' && annulation.libelle.startsWith('Retirer') ? 'Retirer' : 'Annuler'}
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

      {espaceRh && (
        <Panel title="Règles appliquées">
          <Rtt39Field />
          <ul className="rules">
            <li>Congés payés : 25 jours ouvrés par an, acquis à raison de 2,08 j par mois du 1er juin au 31 mai, arrondis à l’entier supérieur.</li>
            <li>Acquisition pendant les absences (loi du 22 avril 2024) : accident du travail ou de trajet, maladie professionnelle (sans limite de durée), maternité, paternité, adoption et événements familiaux comptent comme du travail effectif ; {data.settings.cpMaladie === 'assimile' ? 'arrêt maladie assimilé lui aussi à du travail effectif (accord ou CCN plus favorable, Paramètres → Congés et clôtures)' : 'arrêt maladie : 2 jours ouvrables par mois (1,67 j ouvré), 24 jours ouvrables (20 ouvrés) par période au plus'} ; une absence encore à qualifier compte comme une maladie. Congé parental, sans solde, absence injustifiée et enfant malade réduisent le mois au prorata, sauf s’il reste 4 semaines ou 24 jours ouvrables de travail.</li>
            <li>Chaque jour de congé est décompté sur la période dont les droits se prennent à sa date (un congé de mai à juin est réparti sur deux périodes). Période épuisée : prise par anticipation sur les jours en cours d’acquisition, dans la limite de ceux acquis à la date du congé, déduits de la période suivante au 1er juin.</li>
            <li>CCN Industries chimiques : pas de congés d’ancienneté ; +5 jours ouvrés à partir de 59 ans.</li>
            <li>Forfait annuel en jours : jours de repos calculés individuellement selon le nombre de jours du forfait (jours calendaires − week-ends − 25 CP − fériés ouvrés − jours du forfait) ; {reposForfait(Y, 218)} jours en {Y} pour un forfait de 218 jours.</li>
            <li>Forfait annuel en heures : pas de RTT ni de repos compensateur hebdomadaire ; les heures au-delà du forfait sont régularisées en fin d’année.</li>
            <li>Forfait hebdomadaire en heures : heures supplémentaires incluses au forfait (au-delà de 35 h) majorées dans la rémunération ; heures effectuées au-delà du forfait payées avec majoration, ou remplacées par un repos compensateur quand un accord collectif le prévoit (Paramètres → Paie).</li>
            <li>Cadre dirigeant (art. L3111-2) : congés payés uniquement — ni RTT, ni repos compensateur.</li>
            <li>Temps partiel : même droit à congés ; le décompte des CP inclut les jours non travaillés de la période.</li>
            <li>Clôture des congés payés, proposée à partir du 1er juin : aucun jour n’est perdu d’office, le service RH décide pour chaque salarié du report du solde (plafonné au solde, jusqu’au 31 mai suivant) ou de sa perte. Les jours acquis pendant une absence de santé, une maternité, une paternité ou une adoption, et ceux qu’elle a empêché de prendre, sont reportés de 15 mois (à compter de l’information du salarié à son retour si elle est plus tardive), dans la limite du solde. Un report accordé en cours de période est appliqué à la clôture.</li>
            <li>Retour d’un arrêt de maladie ou d’accident : dans le mois, le service RH informe le salarié de ses jours de congés et de la date limite pour les prendre (« Informations au retour à faire ») ; le report de 15 mois court à partir de cette information.</li>
            <li>RTT et jours de repos : non reportables, clôturés au 31 décembre (soldes non pris perdus, après le rappel du CET). Ceux de l’année suivante se posent dès maintenant sur son propre droit ; une demande à cheval sur deux années est refusée.</li>
            <li>Compteurs repris de l’ancien outil : décomptés sur la période de CP et l’année de RTT de leur date d’arrêté, jamais au-delà.</li>
            <li>Compte épargne-temps : jusqu’à 5 RTT par an (avant le 31 décembre) et 5 CP par période, uniquement ceux de la 5e semaine (au-delà de 20 jours ouvrés).</li>
            <li>Intérim : congés gérés par l’agence ; CDD : indemnité compensatrice des CP non pris à l’échéance.</li>
            <li>Absences et feuilles de temps restent dans les bornes du contrat : entrée, fin du CDD, de la mission ou de l’alternance.</li>
            <li>Annulation : le salarié retire sa demande en attente, ou son propre signalement tant qu’il n’est ni qualifié ni prolongé ; le manager ou le service RH annulent une absence qui n’a pas commencé, le service RH seul une absence commencée ou passée. Le solde est recrédité et Keystone prévenu ; une feuille soumise sans heure que l’absence couvrait est renvoyée pour saisie.</li>
          </ul>
        </Panel>
      )}

      {espaceRh && (
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

/** Nombre de RTT des contrats 39 h : enregistré à la sortie du champ ou sur Entrée (paramètre : administrateur RH). */
function Rtt39Field() {
  const d = useDomain();
  const { run } = useStore();
  const { admin } = useRole();
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
      <input className="input" id="rtt39" type="number" min={0} max={40} value={text} disabled={!admin} title={admin ? undefined : 'Paramètre réservé à l’administrateur RH'}
        onChange={ev => setText(ev.target.value)} onBlur={commit} onKeyDown={onKey} style={{ width: 80, textAlign: 'right' }} />
    </div>
  );
}
