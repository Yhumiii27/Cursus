// Congés & absences : soldes CP / RTT / récupération / CET, demandes à valider, absences hors congés
// (signalées par le manager ou le salarié, qualifiées par le service RH, prolongées, annulées),
// règles appliquées (CCN Industries chimiques) et référentiel des natures d'absence.
// Le manager ne reçoit jamais la nature d'un arrêt de travail : il voit « Absence », ses dates et son état.
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ABS_CLS, ABS_LABEL, CATEGORIES_ABSENCE, NATURES_ABSENCE, STATUTS, type CategorieAbsence, type PaieAbsence } from '../../../shared/constants.ts';
import type { Domain } from '../../../shared/domain.ts';
import { cpPeriods, parse } from '../../../shared/dates.ts';
import { cap, equipeLabel, fH, fJ, fmt, fmtIso, fmtShort } from '../../../shared/format.ts';
import { absenceActive, droitAnnulation, estConge, joursDecomptes, natureDef, prolongeable, statutAbsence, uniteDecompte } from '../../../shared/rules/absences.ts';
import { depotOuvert, justificatifAVerifier, piecesDe } from '../../../shared/rules/pieces.ts';
import { DEMI_LABEL, periodeDemiTexte } from '../../../shared/rules/demi-journees.ts';
import { absenceKinds, cetInfo, cpInfo, recupInfo, reposForfait, rttInfo } from '../../../shared/rules/conges.ts';
import { fenetrePrincipale, jourMois } from '../../../shared/rules/fractionnement.ts';
import type { Absence, AbsenceStatut, DemiJournee, Employe, NatureAbsence, Piece } from '../../../shared/types.ts';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { CloturesConges } from '../components/CloturesConges.tsx';
import { Fractionnement } from '../components/Fractionnement.tsx';
import { InformationsRetour } from '../components/InformationsRetour.tsx';
// lot 13 — CET (monétisation)
import { MonetisationsCet } from '../components/MonetisationsCet.tsx';
import { monetisationInfo } from '../../../shared/rules/cet-monetisation.ts';
import { LectureSeule, useLectureSeule } from '../components/Hierarchie.tsx';
import { Btn, Empty, Fine, Kpi, Kpis, Page, Panel, Tag, Two } from '../components/ui.tsx';
import { comparerTexte, parDate, parNombre, parRang, parTexte, trier, usePagination, useTri, type Colonne } from '../components/tri.ts';
import { SuiteListe, ThTri } from '../components/TriListe.tsx';
import { csvAbsences, csvSoldes } from '../listes-csv.ts';
import { downloadCsv } from '../print.ts';
import { useAgir } from '../state/actions.ts';
import { refusAbsence } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { decideur } from '../state/delegues.ts';
// lot 11 — pwa
import { prendreNouvelleAbsence } from '../pwa/enregistrement.ts';
import {
  FILTRES_PERIODE, FILTRES_STATUT, FILTRES_TYPE, filtrerAbsence, filtrerSolde, rangAbsence, SANS_FILTRE, TOUTES,
  type FiltrePeriode, type FiltreStatut, type FiltreType,
} from './absences-filtres.ts';
import { t, tn } from '../i18n/langue.ts';

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
  const rttSuivTxt = rttSuivants ? ` · ${fJ(rttSuivants)}${t(rttSuivants > 1 ? ' set#plural' : ' set')}${t(' on #year')}${d.year + 1}` : '';
  return {
    // Valeurs triées des colonnes (t145) ; null : non concerné (rangé en dernier).
    n: { cp: cp ? cp.solde : null, cpN: cp ? cp.enCours : null, rtt: rt ? rt.solde : null, rec: rc ? rc.solde : null, cet: cet ? ct.total : null },
    e, cpSolde: cp ? cp.solde : 0, cetPlaceable: cet && (ct.placeCp > 0 || ct.placeRtt > 0 || ct.placeRttPrec > 0),
    // lot 13 — CET (monétisation) : réglage ouvert et au moins une demi-journée monétisable aujourd'hui.
    cetMonetisable: cet && (() => { const m = monetisationInfo(d, e); return m.ouverte && m.possible >= 0.5; })(),
    poser: absenceKinds(d, e).length > 0, cpGere: !!cp,
    contrat: `${STATUTS[c.statut].court} · ${c.label}`,
    cp: cp ? fJ(cp.solde) : t('Agency'),
    cpSub: cp
      ? `${t('out of ')}${cp.droit}${t(' d#days')}${cp.ageSupp ? t(' · of which 5 d CCN (59 and over)') : ''}${cp.recu ? `${t(' · of which ')}${fJ(cp.recu)}${t(' of carry-over received')}` : ''}${cp.accorde ? ` · ${fJ(cp.accorde)}${t(' carried over to ')}${P.labelN}${t(' at closing')}` : ''}`
      : t('managed by the temp agency'),
    cpN: cp ? fJ(cp.enCours) : '—',
    // Jours déjà imputés sur la période en cours d'acquisition : pris par anticipation, ou posés à partir du 1er juin.
    cpNSub: cp && cp.suivante ? `${t('of which ')}${fJ(cp.suivante)}${t(cp.suivante > 1 ? ' already set#plural' : ' already set')}${cp.anticipes ? ` (${fJ(cp.anticipes)}${t(' in advance')})` : ''}` : undefined,
    rtt: rt ? fJ(rt.solde) : '—',
    rttSub: rt ? `${rt.label}${t(' · out of ')}${rt.droit}${t(' d · lost on 31 Dec.')}${rttSuivTxt}` : t('not applicable'),
    rttLabel: rt ? rt.label : 'RTT',
    rttCard: rt ? `${t('out of ')}${rt.droit}${t(' d · lost on 31 Dec.')}${rttSuivTxt}`
      : c.dirigeant ? t('senior executive: paid leave only')
      : c.annuel ? t('annual fixed hours: no RTT')
      : t('not applicable'),
    rec: rc ? fH(rc.solde) : '—',
    recSub: rc ? `≈ ${fJ(rc.solde / rc.dh)}` : t('not applicable'),
    cet: cet ? fJ(ct.solde) : '—',
    // Congés pris sur le CET (validés) et demandés : déduits du solde affiché.
    cetSub: cet ? (ct.epargne ? `${ct.cp}${t(' d CP · ')}${ct.rtt}${t(' d RTT')}${ct.repris ? ` · ${ct.repris}${t(' d taken back')}` : ''}${ct.pris ? ` · ${fJ(ct.pris)}${t(' taken#plural')}` : ''}${ct.poses ? ` · ${fJ(ct.poses)}${t(' set#plural')}` : ''}${ct.monetises ? ` · ${fJ(ct.monetises)}${t(' cashed in')}` : ''}${ct.monetisationsEnAttente ? ` · ${fJ(ct.monetisationsEnAttente)}${t(' to cash in')}` : ''}` : t('no day saved')) : t('not applicable'),
  };
}

function Num({ main, sub }: { main: ReactNode; sub?: ReactNode }) {
  return <><div className="tnum">{main}</div>{sub != null && <div className="text-muted sub">{sub}</div>}</>;
}

type Solde = ReturnType<typeof soldeRow>;

/** Colonnes triables des soldes : un solde se trie du plus grand au plus petit au premier clic. */
const COLONNES_SOLDES: Record<string, Colonne<Solde>> = {
  nom: parTexte(r => r.e.nom),
  cp: parNombre(r => r.n.cp, 'desc'),
  cpN: parNombre(r => r.n.cpN, 'desc'),
  rtt: parNombre(r => r.n.rtt, 'desc'),
  rec: parNombre(r => r.n.rec, 'desc'),
  cet: parNombre(r => r.n.cet, 'desc'),
};

/** Ordre des états pour le tri de la colonne « Statut » : à traiter d'abord, les annulées en dernier (ordre par défaut). */
const RANG_STATUT: readonly AbsenceStatut[] = ['demandee', 'signalee', 'validee', 'refusee', 'annulee'];

const NATURES = Object.entries(NATURES_ABSENCE) as [NatureAbsence, (typeof NATURES_ABSENCE)[NatureAbsence]][];
// Chaînes sources anglaises, traduites au rendu (CU-N01).
export const PAIE_COURT: Record<PaieAbsence, string> = { maintenue: 'paid#fem', indemnisee: 'compensated (IJSS)#fem', non_payee: 'unpaid#fem' };
// Demi-journées du premier et du dernier jour (CP, RTT, récupération) : « 12 oct. après-midi → 16 oct. 2026 matin ».
const demi = (x: DemiJournee | null | undefined) => x ? ` ${DEMI_LABEL[x]}` : '';
const dates = (a: Absence) => a.du === a.au ? `${fmt(parse(a.du))}${demi(a.debutDemi)}` : `${fmtShort(parse(a.du))}${demi(a.debutDemi)} → ${fmt(parse(a.au))}${demi(a.finDemi)}`;

/**
 * Précisions d'une absence : rémunération et justificatif (hors congés), signalement, prolongation, annulation. Pièce
 * jointe dont le service RH n'a pas encore inscrit la réception : « à vérifier », pour lui comme pour le salarié.
 */
function details(a: Absence, pieces: Piece[] | undefined): string[] {
  const n = natureDef(a.type);
  const joint = justificatifAVerifier(a, pieces);
  return [
    n ? `${cap(t(PAIE_COURT[n.paie]))} · ${a.justificatif && a.justificatifLe ? `${t('supporting document received on ')}${fmtIso(a.justificatifLe)}` : joint ? t('supporting document attached, to be checked by HR') : n.justificatif ? t('supporting document expected') : t('without supporting document')}` : '',
    // Absence encore à qualifier : le panneau « Absences à qualifier » le dit déjà au service RH ; ici, au salarié.
    !n && joint ? t('Supporting document attached, to be checked by HR') : '',
    a.statut === 'signalee'
      ? `${t('Reported#fem')}${a.signaleLe ? `${t(' on #le')}${fmtIso(a.signaleLe)}` : ''}${a.signalePar ? `${t(' by ')}${a.signalePar}` : ''} · ${a.type === 'ABSENCE' ? t('nature to be specified by HR') : t('extension to qualify')}`
      : '',
    a.type === 'ABSENCE' && a.statut === 'validee' ? t('Nature specified by HR, confidential') : '',
    a.finInitiale && a.statut !== 'annulee' ? `${t('Extended · initial end on ')}${fmtIso(a.finInitiale)}` : '',
    a.statut === 'annulee' && a.annuleeLe ? `${t('Cancelled on #fem')}${fmtIso(a.annuleeLe)}${a.annuleePar ? `${t(' by ')}${a.annuleePar}` : ''}` : '',
    a.statut === 'refusee' && a.motifRefus ? `${t('Reason for the refusal: ')}${a.motifRefus}` : '',
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
  // Soldes affichés (t145) : recherche (nom, poste, équipe, matricule) et équipe, tri par colonne, 50 lignes puis « Afficher plus ».
  const [recherche, setRecherche] = useState('');
  const [equipe, setEquipe] = useState(TOUTES);
  const equipes = [...new Set(rows.map(r => equipeLabel(r.e)))].sort(comparerTexte);
  const tSoldes = useTri('absences.soldes');
  const soldes = trier(rows.filter(r => filtrerSolde(r.e, recherche, equipe)), COLONNES_SOLDES, tSoldes.tri);
  const pageSoldes = usePagination(soldes, `${recherche}|${equipe}`);
  // Consultation N+2 (t136) : soldes des équipes rattachées consultés, sans action.
  const lecture = useLectureSeule();
  const mine = collab ? rows.find(r => r.e.id === me) : undefined;
  // « Poser une absence » pour soi-même : masqué quand aucun type n'est ouvert (intérim).
  const canPoseMe = !espaceRh && !!rows.find(r => r.e.id === me)?.poser;
  // lot 11 — pwa : raccourci « Demander une absence » de l'application installée (manifeste, /absences?nouveau=1).
  useEffect(() => { if (canPoseMe && me != null && prendreNouvelleAbsence()) openDialog({ type: 'abs', empId: me }); }, [canPoseMe, me, openDialog]);
  const canCet = (r: ReturnType<typeof soldeRow>) => (rh || r.e.id === me) && r.cetPlaceable;
  // lot 13 — CET (monétisation) : le salarié pour lui-même, le service RH pour un autre (demande à valider).
  const canMonetiser = (r: ReturnType<typeof soldeRow>) => (rh || (!espaceRh && r.e.id === me)) && r.cetMonetisable;

  // Droits de l'utilisateur sur les absences d'un collaborateur : RH, intéressé, manager direct. Un membre du RH agit
  // sur ses propres absences comme intéressé.
  const qui = (e: Employe) => ({ rh: rh && e.id !== soi, self: (!espaceRh && e.id === me) || (rh && e.id === soi), manager: manager && decideur(d, e, me, 'absences') });
  // À traiter d'abord (demandes, signalements), les absences annulées en dernier.
  const absList = data.absences
    .filter(a => a.au >= P.prisStart || a.statut === 'signalee')
    .map(a => ({ a, e: d.emp(a.empId) }))
    .filter((x): x is { a: Absence; e: Employe } => !!x.e)
    .sort((x, y) => rangAbsence(x.a) - rangAbsence(y.a) || x.a.du.localeCompare(y.a.du))
    .map(({ a, e }) => {
      const q = qui(e);
      return {
        a, e,
        canDecide: a.statut === 'demandee' && (q.rh || (manager && decideur(d, e, me, 'absences'))),
        canProlong: prolongeable(a) && (q.rh || q.self || q.manager),
        annulation: droitAnnulation(a, data.today, q),
      };
    });
  const nDecide = absList.filter(x => x.canDecide).length;
  // Absences affichées (t145) : état, famille et période ; tri par colonne ; 50 lignes puis « Afficher plus ».
  const [filtres, setFiltres] = useState(SANS_FILTRE);
  const tAbs = useTri('absences.liste');
  const colonnesAbs: Record<string, Colonne<(typeof absList)[number]>> = {
    nom: parTexte(x => x.e.nom),
    du: parDate(x => x.a.du),
    jours: parNombre(x => joursDecomptes(d, x.e, x.a), 'desc'),
    statut: parRang(x => x.a.statut, RANG_STATUT),
  };
  const absAffichees = trier(absList.filter(x => filtrerAbsence(x.a, filtres, data.today)), colonnesAbs, tAbs.tri);
  const pageAbs = usePagination(absAffichees, `${filtres.statut}|${filtres.type}|${filtres.periode}`);
  // Exports des tableaux affichés (filtres et tri compris, toutes les pages) : soldes avec la mention « soldes calculés
  // par Cursus », absences sans leur nature.
  const exporterSoldes = () => {
    const x = csvSoldes(d, soldes.map(r => r.e));
    downloadCsv(x.fichier, x.head, x.rows);
    notify(`${t('CSV export generated')} — ${tn(soldes.length, 'balance', 'balances')}`);
  };
  const exporterAbsences = () => {
    const x = csvAbsences(d, absAffichees);
    downloadCsv(x.fichier, x.head, x.rows);
    notify(`${t('CSV export generated')} — ${tn(absAffichees.length, 'absence', 'absences')}`);
  };
  const boutonExport = (onClick: () => void) => <Btn small variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={onClick}>{t('Export (CSV)')}</Btn>;
  const aQualifier = rh ? absList.filter(x => x.a.statut === 'signalee' && x.e.id !== soi) : [];

  return (
    <Page
      kicker={t(espaceRh ? 'CP reference period: 1 June – 31 May · count in working days · CCN Chemical industries' : 'Paid leave in working days · RTT lost on 31 December')}
      title={t('Leave & absences')}
      actions={<>
        {rh && <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'absNature' })}>{t('Enter an absence')}</button>}
        {!espaceRh && <button type="button" className={canPoseMe ? 'btn btn-secondary' : 'btn btn-primary'} onClick={() => openDialog({ type: 'absSignal' })}>{t('Report an absence')}</button>}
        {canPoseMe && me != null && <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'abs', empId: me })}>{t('Request an absence')}</button>}
      </>}
    >
      {mine && (
        <Kpis>
          <Kpi kicker={`${t('Paid leave ')}${P.label}`} value={mine.cp} sub={mine.cpGere ? `${mine.cpSub}${t(' · before ')}${fmt(parse(P.deadline))}` : mine.cpSub} />
          <Kpi kicker={t('Being accrued')} value={mine.cpN} sub={mine.cpGere ? `${t('period ')}${P.labelN}${t(' · 2.08 d per month')}${mine.cpNSub ? ` · ${mine.cpNSub}` : ''}` : t('managed by the temp agency')} />
          <Kpi kicker={`${mine.rttLabel} ${Y}`} value={mine.rtt} sub={mine.rttCard} />
          <Kpi kicker={t('Time off in lieu')} value={mine.rec} sub={mine.recSub} />
          <Kpi kicker={t('Time savings account')} value={mine.cet} sub={mine.cetSub}
            action={canCet(mine) || canMonetiser(mine) ? <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flex: 'none' }}>
              {canCet(mine) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'cet', empId: mine.e.id })}>{t('Save#cet')}</button>}
              {canMonetiser(mine) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'monetisationCet', empId: mine.e.id })}>{t('Cash in')}</button>}
            </span> : undefined} />
        </Kpis>
      )}

      {espaceRh && <CloturesConges />}
      <Fractionnement />
      <InformationsRetour />
      {/* lot 13 — CET (monétisation) */}
      <MonetisationsCet />

      {aQualifier.length > 0 && (
        <Panel highlight title={t('Absences to qualify')} aside={`${tn(aQualifier.length, 'absence reported', 'absences reported')}${t(' · nature and supporting document to specify')}`}>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Employee')}</th><th>{t('Absence')}</th><th>{t('Days')}</th><th>{t('Report#signalement')}</th><th></th></tr></thead>
              <tbody>
                {aQualifier.map(({ a, e }) => (
                  <tr key={a.id}>
                    <td><Two main={e.nom} sub={equipeLabel(e)} nowrap /></td>
                    <td>
                      <div>{ABS_LABEL[a.type]} · {dates(a)}</div>
                      {a.finInitiale && <div className="text-muted sub">{t('Extended · initial end on ')}{fmtIso(a.finInitiale)}</div>}
                    </td>
                    <td><Num main={fJ(joursDecomptes(d, e, a))} sub={uniteDecompte(a.type)} /></td>
                    <td>
                      <Two main={a.signaleLe ? fmtIso(a.signaleLe) : '—'} sub={a.signalePar ?? ''} />
                      {/* Justificatif envoyé par l'intéressé (pièce justificative) : à ouvrir dans « Qualifier ». */}
                      {piecesDe(data.pieces, 'absence', a.id).length > 0 && <div className="text-muted sub">{t('Supporting document attached')}</div>}
                    </td>
                    <td className="right">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'absNature', id: a.id })}>{t('Qualify')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {!collab && (
        <Panel title={t('Balances')} aside={soldes.length > 0 ? boutonExport(exporterSoldes) : undefined}>
          {rows.length > 1 && (
            <div className="filtres-liste">
              <input className="input" type="search" placeholder={t('Name, job or employee number…')} aria-label={t('Search a balance')} value={recherche}
                onChange={e => setRecherche(e.target.value)} />
              {equipes.length > 1 && (
                <select className="input" aria-label={t('Team of the balances')} value={equipe} onChange={e => setEquipe(e.target.value)}>
                  <option value={TOUTES}>{t('All teams')}</option>
                  {equipes.map(q => <option key={q} value={q}>{q}</option>)}
                </select>
              )}
            </div>
          )}
          <div className="scroll-x">
            <table className="table">
              <thead><tr>
                <ThTri t={tSoldes} col="nom">{t('Employee')}</ThTri>
                <ThTri t={tSoldes} col="cp" premier="desc">CP {P.label}</ThTri>
                <ThTri t={tSoldes} col="cpN" premier="desc">{t('Accruing')}</ThTri>
                <ThTri t={tSoldes} col="rtt" premier="desc">{t('RTT / rest ')}{Y}</ThTri>
                <ThTri t={tSoldes} col="rec" premier="desc">{t('Time off in lieu')}</ThTri>
                <ThTri t={tSoldes} col="cet" premier="desc">CET</ThTri>
                <th></th>
              </tr></thead>
              <tbody>
                {pageSoldes.lignes.map(r => {
                  const canPose = r.poser && (rh || r.e.id === me || (manager && decideur(d, r.e, me, 'absences')));
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
                          {canCet(r) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'cet', empId: r.e.id })}>{t('Save#cet')}</button>}
                          {canMonetiser(r) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'monetisationCet', empId: r.e.id })}>{t('Cash in')}</button>}
                          {rh && r.e.id !== soi && r.cpSolde > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'report', empId: r.e.id })}>{t('Carry over')}</button>}
                          {canPose && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'abs', empId: r.e.id })}>{t('Request#absence')}</button>}
                          {manager && decideur(d, r.e, me, 'absences') && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'absSignal', empId: r.e.id })}>{t('Report#verb')}</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {soldes.length === 0 && rows.length > 0 && <Empty pad="sm">{t('No balance matches these filters.')}</Empty>}
          <SuiteListe p={pageSoldes} unite={['balance', 'balances']} />
        </Panel>
      )}

      <Panel title={t('Requests and planned absences')} aside={
        <div className="actions-end" style={{ alignItems: 'center' }}>
          <span className="text-muted sub">{`${tn(nDecide, 'request to approve', 'requests to approve')}${t(' · unavailabilities sent to Keystone for planning, without the nature of the sick leaves')}`}</span>
          {!collab && absAffichees.length > 0 && boutonExport(exporterAbsences)}
        </div>
      }>
        {absList.length > 1 && (
          <div className="filtres-liste">
            <select className="input" aria-label={t('State of the absences')} value={filtres.statut} onChange={e => setFiltres({ ...filtres, statut: e.target.value as FiltreStatut })}>
              {FILTRES_STATUT.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
            </select>
            <select className="input" aria-label={t('Type of absence')} value={filtres.type} onChange={e => setFiltres({ ...filtres, type: e.target.value as FiltreType })}>
              {FILTRES_TYPE.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
            </select>
            <select className="input" aria-label={t('Period of the absences')} value={filtres.periode} onChange={e => setFiltres({ ...filtres, periode: e.target.value as FiltrePeriode })}>
              {FILTRES_PERIODE.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
            </select>
          </div>
        )}
        {absAffichees.length > 0 ? (
          <div className="scroll-x">
            <table className="table">
              <thead><tr>
                <ThTri t={tAbs} col="nom">{t('Employee')}</ThTri>
                <ThTri t={tAbs} col="du">{t('Absence')}</ThTri>
                <ThTri t={tAbs} col="jours" premier="desc">{t('Days')}</ThTri>
                <ThTri t={tAbs} col="statut">{t('Status')}</ThTri>
                <th></th>
              </tr></thead>
              <tbody>
                {pageAbs.lignes.map(({ a, e, canDecide, canProlong, annulation }) => {
                  const m = data.missions.find(x => x.empId === a.empId && x.du <= a.au && x.au >= a.du);
                  const mgr = d.mgrOf(e);
                  // Sa propre demande : un membre du RH ne la décide pas, son manager ou un autre membre du service RH le fait.
                  const ks = a.statut === 'demandee' ? (rh && e.id === soi
                    ? `${t('Your request: decision by ')}${mgr ? `${d.personName(mgr)}${t(' or ')}` : ''}${t('another member of HR')}`
                    : `${t('Validation: ')}${d.mgrName(mgr)}`)
                    : a.statut === 'signalee' ? t('To qualify by HR')
                    : a.statut === 'validee' ? t(estConge(a.type) ? 'Sent to Keystone#fem' : 'Unavailability sent to Keystone') : '';
                  return (
                    <tr key={a.id}>
                      <td><Two main={e.nom} sub={equipeLabel(e)} nowrap /></td>
                      <td>
                        <div>{ABS_LABEL[a.type]} · {dates(a)}</div>
                        {details(a, data.pieces).map(x => <div key={x} className="text-muted sub">{x}</div>)}
                        {m && absenceActive(a) && <div className="note-accent">{t('Overlaps the assignment ')}{m.projet} · {m.lieu}</div>}
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
                                mgr && mgr !== me ? d.personName(mgr) : null) })}>{t('Refuse')}</button>
                            <button type="button" className="btn btn-secondary btn-sm" disabled={occupe} onClick={agir(() => run('absence.decider', { id: a.id, ok: true }))}>{t('Approve')}</button>
                          </>}
                          {/* Justificatif joint dont la réception n'est pas inscrite : « Vérifier » (ouvrir la pièce, la dire reçue). */}
                          {rh && e.id !== soi && prolongeable(a) && (
                            <button type="button" className={`btn btn-sm ${a.statut === 'signalee' || justificatifAVerifier(a, data.pieces) ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => openDialog({ type: 'absNature', id: a.id })}>
                              {a.statut === 'signalee' ? t('Qualify') : justificatifAVerifier(a, data.pieces) ? t('Check') : t('Edit')}
                            </button>
                          )}
                          {canProlong && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'absProlonger', id: a.id })}>{t('Extend')}</button>}
                          {/* Son justificatif (avis d'arrêt…), envoyé après le signalement : pièce justificative. */}
                          {e.id === soi && depotOuvert(data.settings.piecesStockage) && prolongeable(a) && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'piece', objet: 'absence', objetId: a.id, empId: e.id, libelle: `${ABS_LABEL[a.type]} · ${dates(a)}` })}>{t('Supporting document')}</button>
                          )}
                          {annulation.ok && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'absAnnuler', id: a.id })}>
                              {a.statut === 'demandee' && annulation.libelle.startsWith('Retirer') ? t('Withdraw') : t('Cancel')}
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
        ) : <Empty>{t(absList.length > 0 ? 'No absence matches these filters.' : 'No absence planned.')}</Empty>}
        <SuiteListe p={pageAbs} unite={['absence', 'absences']} />
      </Panel>

      {espaceRh && (
        <Panel title={t('Rules applied')}>
          <Rtt39Field />
          <ul className="rules">
            <li>{t('Paid leave: 25 working days a year, accrued at 2.08 d a month from 1 June to 31 May, rounded up to the next whole number.')}</li>
            <li>{t('Accrual during absences (law of 22 April 2024): work or commuting accident, occupational disease (with no limit of duration), maternity, paternity, adoption and family events count as actual work; ')}{t(data.settings.cpMaladie === 'assimile' ? 'sick leave also treated as actual work (more favourable agreement or CCN, Settings → Leave and closings)' : 'sick leave: 2 working days (Mon–Sat) a month (1.67 working day), 24 working days (Mon–Sat) (20 Mon–Fri) per period at most')}{t('; an absence still to qualify counts as sickness. Parental leave, unpaid leave, unjustified absence and sick child reduce the month pro rata, unless 4 weeks or 24 working days (Mon–Sat) of work remain.')}</li>
            <li>{t('Each day of leave is counted on the period whose entitlement is taken at its date (leave from May to June is split over two periods). Period used up: taken in advance on the days being accrued, within the limit of those accrued at the date of the leave, deducted from the next period on 1 June.')}</li>
            <li>{t('CCN Chemical industries: no seniority leave; +5 working days from age 59.')}</li>
            <li>{t('Annual fixed days: rest days calculated individually according to the number of days of the fixed term (calendar days − weekends − 25 CP − working public holidays − days of the fixed term); ')}{reposForfait(Y, 218)}{t(' days in ')}{Y}{t(' for a fixed term of 218 days.')}</li>
            <li>{t('Annual fixed hours: no RTT nor weekly compensatory rest; the hours beyond the fixed term are adjusted at year end.')}</li>
            <li>{t('Weekly fixed hours: overtime included in the fixed term (beyond 35 h) paid at a premium in the pay; hours worked beyond the fixed term paid at a premium, or replaced by a compensatory rest when a collective agreement provides for it (Settings → Payroll).')}</li>
            <li>{t('Senior executive (art. L3111-2): paid leave only — neither RTT nor compensatory rest.')}</li>
            <li>{t('Part time: same right to leave; the CP count includes the days not worked in the period.')}</li>
            <li>{t('Closing of paid leave, offered from 1 June: no day is lost automatically, HR decides for each employee to carry over the balance (capped at the balance, until the next 31 May) or to lose it. The days accrued during a health absence, a maternity, a paternity or an adoption, and those it prevented from taking, are carried over for 15 months (from the information of the employee on their return if it is later), within the limit of the balance. A carry-over granted during the period is applied at closing.')}</li>
            <li>{t('Return from sick leave or an accident: within the month, HR informs the employee of their days of leave and of the deadline to take them (“Information on return to give”); the 15-month carry-over runs from this information.')}</li>
            <li>{t('RTT and rest days: not carried over, closed on 31 December (balances not taken lost, after the CET reminder). Those of the next year are requested from now on its own entitlement; a request spanning two years is refused.')}</li>
            <li>{t('Counters taken over from the former tool: counted on the CP period and the RTT year of their cut-off date, never beyond.')}</li>
            <li>{t('Time savings account: up to ')}{data.settings.cetPlafondRtt ?? 5}{t(' RTT a year (before 31 December) and ')}{data.settings.cetPlafondCp ?? 5}{t(' CP per period, only those of the 5th week (beyond 20 working days); caps set in Settings → Time savings account. The days saved are taken as leave on the CET (working days), approved by the manager like paid leave; paid out in full on leaving.')}{data.settings.cetMonetisation ? `${t(' Cashing in open (agreement: ')}${data.settings.cetMonetisationAccord}${t('): days coming from RTT only, ')}${data.settings.cetMonetisationPlafond}${t(' d a year at most, on request approved by HR.')}` : t(' Cashing in: not open (agreement to reference).')}</li>
            <li>{t('Main leave: at least 12 consecutive working days (Mon–Sat) (10 Mon–Fri) between ')}{jourMois(fenetrePrincipale(data.settings, Y).du)}{t(' and #le')}{jourMois(fenetrePrincipale(data.settings, Y).au)}{t(', 24 working days (Mon–Sat) (20 Mon–Fri) in a row at most — flagged without blocking. ')}{data.settings.fractionnementRegle === 'aucun' ? t('Split days set aside by collective agreement.') : `${t('Split days: 2 days for 6 working days (Mon–Sat) or more of the main leave (5th week excluded) taken outside this period, 1 day for 3 to 5')}${data.settings.fractionnementRegle === 'accord' ? t(', or the rule of the company agreement') : ''}${t('; offered after the period, credited by HR or set aside by the employee’s waiver.')}`}</li>
            <li>{t('Temp work: leave managed by the agency; fixed-term contract: compensatory allowance for the CP not taken at the end.')}</li>
            <li>{t('Absences and timesheets stay within the bounds of the contract: start, end of the fixed-term contract, of the assignment or of the work-study.')}</li>
            <li>{t('Cancellation: the employee withdraws their pending request, or their own report as long as it is neither qualified nor extended; the manager or HR cancel an absence that has not started, HR alone an absence started or past. The balance is credited back and Keystone told; a timesheet submitted without hours that the absence covered is sent back for entry.')}</li>
          </ul>
        </Panel>
      )}

      {espaceRh && (
        <Panel title={t('Absences other than leave')} aside={t('Minimum durations of the Labour Code · the CCN may be more favourable')}>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Nature')}</th><th>{t('Pay')}</th><th>{t('Count · duration')}</th><th>{t('Supporting document')}</th><th>{t('Paid leave (for the record)')}</th></tr></thead>
              {(Object.keys(CATEGORIES_ABSENCE) as CategorieAbsence[]).map(c => (
                <tbody key={c}>
                  <tr><td colSpan={5} className="section-label">{CATEGORIES_ABSENCE[c]}</td></tr>
                  {NATURES.filter(([, n]) => n.categorie === c).map(([k, n]) => (
                    <tr key={k}>
                      <td><Two main={n.label} sub={n.reprise ? t('return career review at the end') : n.medicale ? t('nature never sent to the manager nor to Keystone') : undefined} /></td>
                      <td className="sub">{cap(t(PAIE_COURT[n.paie]))}</td>
                      <td><Two main={`${t(n.decompte === 'ouvres' ? 'Working days' : 'Calendar days')}${n.duree ? ` · ${fJ(n.duree)}${n.parAn ? t(' a year') : ''}` : ''}`} sub={[n.dureeNote, n.article].filter(Boolean).join(' · ')} /></td>
                      <td className="sub">{n.justificatif ?? '—'}</td>
                      <td className="sub">{n.cp}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          <Fine>
            {t('The manager or the employee reports an unplanned absence; it counts at once (no hours those days, unavailability sent to Keystone). HR qualifies it on receipt of the supporting document, or directly enters a foreseeable absence. No leave balance is debited; a week fully covered is submitted without hours. At the end of a maternity, an adoption, a parental leave or a long sick leave, the return date is entered on the sheet (career review, art. L6315-1), unless an earlier return is still waiting for its review; that of a long sick leave is not shown to the manager. The effect on CP accrual is given for the record: it is not yet applied to the calculation of the entitlement.')}
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
      <label htmlFor="rtt39">{t('39 h contracts: number of RTT a year')}</label>
      <input className="input" id="rtt39" type="number" min={0} max={40} value={text} disabled={!admin} title={admin ? undefined : t('Setting reserved for the HR administrator')}
        onChange={ev => setText(ev.target.value)} onBlur={commit} onKeyDown={onKey} style={{ width: 80, textAlign: 'right' }} />
    </div>
  );
}
