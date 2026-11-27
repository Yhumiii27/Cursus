// Annuaire (RH) ou équipe (manager) : statut de conformité, contrat et fiche détaillée.
import { useMemo, type ReactNode, type RefObject } from 'react';
import { DownloadSimpleIcon, PencilSimpleIcon, PlusIcon, UserMinusIcon, UserPlusIcon } from '@phosphor-icons/react';
import { CERT_LABEL, CLS, EMP_LABEL, HAB_CLS, HAB_LABEL, HAB_MESURE_LABEL, RANK, SESSION_PASSEE, STATUTS, TEMPS_TRAVAIL, TRIP_LABEL, TYPES_CONTRAT } from '../../../shared/constants.ts';
import type { ContratX, EmpX, HabInfo, Proposal } from '../../../shared/domain.ts';
import type { Formation } from '../../../shared/types.ts';
import { days, parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt, fmtIso, fmtShort, matricule, rel } from '../../../shared/format.ts';
import { sessionDu } from '../../../shared/rules/plage-session.ts';
import { absenceKinds } from '../../../shared/rules/conges.ts';
import { habSuivie } from '../../../shared/rules/referentiels.ts';
import { MOTIFS_SORTIE, sorti } from '../../../shared/rules/contrats.ts';
import { convocationEnvoyee, etatInscription } from '../../../shared/rules/sessions.ts';
import { JOURS_SEMAINE } from '../../../shared/rules/profil.ts';
import { equipesDescendantes } from '../../../shared/rules/hierarchie.ts';
import { AIDE_SOI_MEME, fichePropre, MESURES_SOI_MEME } from '../../../shared/rules/soi-meme.ts';
import { usePanneauVisible } from '../components/panneau.ts';
import { Avatar, Bar, Btn, Chips, CloseButton, Empty, Fine, NoteAccent, Page, Panel, SectionLabel, Seg, Tag, Two } from '../components/ui.tsx';
import { Ouvrir } from '../components/Cliquable.tsx';
import { correspond } from '../components/recherche.ts';
import { parDate, parNombre, parTexte, trier, usePagination, useTri, type Colonne } from '../components/tri.ts';
import { SuiteListe, ThTri } from '../components/TriListe.tsx';
import { Aptitude } from '../components/Aptitude.tsx';
import { ExigencesCellule, ExigencesFiche, ExigencesMotif } from '../components/Exigences.tsx';
import { SortieFiche } from '../components/Sortie.tsx';
import { ContratFiche } from '../components/ContratFiche.tsx';
import { HistoriqueContrat } from '../components/HistoriqueContrat.tsx';
import { MineurFiche } from '../components/Mineur.tsx';
import { TravailNuitFiche } from '../components/TravailNuit.tsx';
import { MandatsFiche } from '../components/Delegation.tsx';
import { LectureSeule, useLectureSeule } from '../components/Hierarchie.tsx';
import { ContactUrgenceFiche } from '../components/ContactUrgence.tsx';
import { ForfaitJoursFiche } from '../components/ForfaitJours.tsx';
// lot 12 — C1 (forfait annuel en heures)
import { ForfaitHeuresFiche } from '../components/temps/ForfaitHeuresFiche.tsx';
import { ActionsCertification, CertsAnnulees, DemandesFiche } from '../components/Corrections.tsx';
import { downloadCsv } from '../print.ts';
// lot 11 — indicateurs
import { aCompleterIndicateurs } from '../../../shared/rules/indicateurs-legaux.ts';
import { csvAnnuaire } from '../listes-csv.ts';
import { useEnriched, useIntentPermis, useRole, useTrips } from '../state/derived.ts';
import { desinscription, retraitEquipe } from '../state/confirmations.ts';
import { useStore } from '../state/store.tsx';
import { HistoriqueFiche } from './Journal.tsx';
import { EchRow } from './Dashboard.tsx';
import { PiecesFiche } from '../components/PiecesFiche.tsx';
import { CouverturePanel } from '../components/Couverture.tsx';
import { CopierLien } from '../components/CopierLien.tsx';
import { FormationsSuiviesFiche, HabilitationsAnterieures, ImprimerTitre } from '../components/FormationsSuivies.tsx';
import { ListeAttenteFiche } from '../components/ListeAttente.tsx';
import { imprimerPasseport } from '../passeport.ts';
import { titreImprimable } from '../titre-habilitation.ts';
import { membreOuDelegue } from '../state/delegues.ts';
import { t, tn } from '../i18n/langue.ts';

/** Valeur du filtre d'équipe pour les collaborateurs sans équipe (« À affecter »). */
const SANS_EQUIPE = '';

/** Colonnes triables de l'annuaire ; « Statut » et « Certifications » : du plus grave, du plus grand d'abord. */
const COLONNES: Record<string, Colonne<EmpX>> = {
  nom: parTexte(e => e.nom),
  equipe: parTexte(e => e.equipe),
  certifications: parNombre(e => e.certs.length, 'desc'),
  echeance: parNombre(e => e.next?.d),
  sortie: parDate(e => e.fin, 'desc'),
  statut: parNombre(e => RANK[e.worst], 'desc'),
};

const docCls = (k: string) => k === 'exp' ? 'tag-accent' : k === 'due' ? 'tag-outline' : 'tag-neutral';

/** Titres suivis (habilitation du référentiel en vigueur) : valides, à renouveler, non conformes, en attente. */
function habSummary(e: EmpX) {
  const suivies = e.habs.filter(habSuivie), hs = suivies.filter(h => h.key !== 'pending');
  const ko = hs.filter(h => h.key === 'exp' || h.key === 'susp' || h.key === 'retiree').length, due = hs.filter(h => h.key === 'due').length, pend = suivies.length - hs.length;
  return {
    label: ko ? tn(ko, 'non-compliant', 'non-compliant#plural') : due ? `${due}${t(' to renew')}` : !hs.length ? `${pend}${t(' pending')}` : tn(hs.length, 'valid', 'valid#plural'),
    cls: ko ? 'tag-accent' : due || !hs.length ? 'tag-outline' : 'tag-neutral',
  };
}

/** Résumé d'une ligne : « CDD · Cadre · Forfait jours » (la nature n'est rappelée que hors CDI). */
function contratCourt(c: ContratX) {
  const parts = [STATUTS[c.statut].court, TEMPS_TRAVAIL[c.temps].court];
  if (c.typeContrat !== 'cdi') parts.unshift(TYPES_CONTRAT[c.typeContrat].label);
  return parts.join(' · ');
}

const joursListe = (js: number[]) => {
  const n = js.map(j => JOURS_SEMAINE[j]?.toLowerCase()).filter(Boolean);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')}${t(' and #et')}${n[n.length - 1]}` : n[0] ?? '';
};

export function Collaborateurs() {
  const { emps, upcoming, horizon, onlyReg, d } = useEnriched();
  const trips = useTrips();
  // `espaceRh` : tout le site (service RH, référent HSE, lecture seule) ; `rh` : fiches et équipes.
  const { espaceRh, rh, manager, me } = useRole();
  const { ui, setUi, openDialog, notify } = useStore();

  const myTeams = useMemo(() => manager ? d.teamsOf(me) : [], [d, manager, me]);
  const team = useMemo(() => manager ? emps.filter(e => membreOuDelegue(d, e, me)) : emps, [emps, manager, me, d]);
  // Consultation N+2 (t136) : membres des équipes rattachées, en lecture seule, listés après l'équipe directe et filtrables
  // par sous-équipe ; ils ne comptent ni dans le résumé ni dans les échéances de contrat du manager.
  const lecture = useLectureSeule();
  const sousEquipes = useMemo(() => manager && lecture.size ? equipesDescendantes(d.ds.referentiels.equipes, myTeams) : [], [d, manager, lecture, myTeams]);
  const vus = useMemo(() => lecture.size ? [...team, ...emps.filter(e => lecture.has(e.id))] : team, [team, emps, lecture]);
  // Filtre « Sortis » : les salariés dont la date de sortie est passée, que `emps` ne compte plus (Domain.enrich).
  const sortis = ui.statut === 'sortis';
  const liste = useMemo(() => !sortis ? vus : d.enrich(horizon, onlyReg, { sortis: true })
    .filter(e => sorti(e, d.ti) && (!manager || (membreOuDelegue(d, e, me) || (e.id !== me && lecture.has(e.id))))), [sortis, vus, d, horizon, onlyReg, manager, me, lecture]);
  const teamOptions = espaceRh ? d.equipes : [...myTeams, ...sousEquipes];
  const multi = espaceRh || teamOptions.length > 1;
  // Un filtre devenu sans objet (équipe renommée, hors périmètre) revient à « Toutes ».
  const filtre = multi && (ui.equipe === SANS_EQUIPE ? espaceRh : teamOptions.includes(ui.equipe)) ? ui.equipe : 'Toutes';
  const aAffecter = espaceRh ? emps.filter(e => !e.equipe).length : 0;

  const q = ui.search;
  // Tri par colonne (t145) : l'ordre par défaut (gravité, puis échéance, puis nom) tant qu'aucun en-tête n'est cliqué.
  const tri = useTri('collaborateurs');
  const rows = useMemo(() => trier(liste
    .filter(e => (filtre === 'Toutes' || (filtre === SANS_EQUIPE ? !e.equipe : e.equipe === filtre))
      && (ui.statut === 'tous' || sortis || (ui.statut === 'acompleter' ? !rh || aCompleterIndicateurs(e, d.ti) : e.worst === ui.statut))
      // Recherche aussi par matricule : de paie (fiche) ou Cursus (EMP-0001, celui des messages de Keystone).
      && correspond(e, q))
    // Sortis : les départs les plus récents d'abord.
    .sort((a, b) => sortis ? (b.fin ?? '').localeCompare(a.fin ?? '') || a.nom.localeCompare(b.nom)
      : RANK[b.worst] - RANK[a.worst] || (a.next ? a.next.d : 1e9) - (b.next ? b.next.d : 1e9) || a.nom.localeCompare(b.nom)),
  COLONNES, tri.tri), [liste, filtre, ui.statut, sortis, q, tri.tri, rh, d.ti]);
  // Au-delà de 50 lignes : « Afficher plus » ; les filtres ramènent aux 50 premières (l'export garde toutes les lignes).
  const page = usePagination(rows, `${filtre}|${ui.statut}|${q}`);

  const sel = liste.find(e => e.id === ui.selectedId) || null;
  // Écran étroit : la fiche s'affiche sous la liste ; la sélection l'amène dans le champ de vision.
  const panneau = usePanneauVisible<HTMLElement>(sel?.id);
  const certCount = team.reduce((n, e) => n + e.certs.length, 0);
  const certs = tn(certCount, 'tracked certification', 'tracked certifications');
  const kicker = manager
    ? `${myTeams.length ? `${t(myTeams.length > 1 ? 'Teams' : 'Team')} ${myTeams.join(', ')}` : t('No team managed')} · ${tn(team.length, 'employee', 'employees')} · ${certs}`
    : `${tn(emps.length, 'employee', 'employees')} · ${tn(d.equipes.length, 'team', 'teams')}${aAffecter ? ` · ${aAffecter}${t(' to assign')}` : ''} · ${certs}`;
  const showEquipe = multi && !sel;
  const cible = filtre !== 'Toutes' && filtre !== SANS_EQUIPE ? filtre : null;
  // Résumé du manager : fins d'essai (avant le délai de prévenance) et fins de contrat de son équipe (shared/rules/contrats.ts).
  const contrats = useMemo(() => manager ? d.echeances(team, horizon).filter(x => x.kind === 'contrat' && x.key !== 'ok').sort((a, b) => a.d - b.d)
    .map(x => ({ ...x, action: null })) : [], [manager, d, team, horizon]);

  // Export de l'annuaire : les lignes affichées (équipe, statut, recherche), dans le périmètre de l'utilisateur.
  const exporter = () => {
    const x = csvAnnuaire(d, rows);
    downloadCsv(x.fichier, x.head, x.rows);
    notify(`${t('CSV export generated — ')}${tn(rows.length, 'employee', 'employees')}`);
  };

  return (
    <Page tight kicker={kicker} title={t('Employees')} actions={<>
      {multi && (
        <select className="input" aria-label={t('Team')} value={filtre} onChange={e => setUi({ equipe: e.target.value })} style={{ width: 'auto', minWidth: 190 }}>
          <option value="Toutes">{t(espaceRh ? 'All teams' : 'All my teams')}</option>
          {teamOptions.map(nom => <option key={nom} value={nom}>{nom}{sousEquipes.includes(nom) ? t(' (read only)') : ''}</option>)}
          {espaceRh && <option value={SANS_EQUIPE}>{aAffecter ? `${t('To assign')} (${aAffecter})` : t('To assign')}</option>}
        </select>
      )}
      <Seg name="statut" label={t('Status')} value={ui.statut} onChange={v => setUi({ statut: v })}
        options={[['tous', t('All#masc')], ['ok', t('Up to date')], ['due', t('To renew')], ['exp', t('Non-compliant#plural-cap')], ['sortis', t('Left#plural')],
          // lot 11 — indicateurs : sexe ou catégorie d'emploi à compléter, service RH seulement (seul à les recevoir).
          ...(rh ? [['acompleter', t('Indicators to complete')] as ['acompleter', string]] : [])]} />
      <Btn variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={exporter}>{t('Export (CSV)')}</Btn>
      {rh && <Btn variant="primary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'employe', equipe: cible })}>{t('New employee')}</Btn>}
      {manager && myTeams.length > 0 && (
        <Btn variant="primary" icon={<UserPlusIcon size={14} />} onClick={() => openDialog({ type: 'membre', equipe: cible && myTeams.includes(cible) ? cible : myTeams[0] })}>{t('Add a member')}</Btn>
      )}
    </>}>
      {contrats.length > 0 && (
        <Panel highlight title={t('Ends of trial period and of contract')} aside={tn(contrats.length, 'due date to anticipate', 'due dates to anticipate')}>
          <div className="scroll-x">
            <table className="table">
              <tbody>
                {contrats.map(x => <EchRow key={`${x.emp.id}-${x.label}`} x={x} onOpen={() => setUi({ selectedId: x.emp.id })} onAct={() => undefined} />)}
              </tbody>
            </table>
          </div>
          <Fine>{t('End of trial period: deadline to notify a termination within the notice period (art. L1221-25); decision to take with HR.')}</Fine>
        </Panel>
      )}
      {manager && <CouverturePanel equipes={myTeams} />}
      <div className="row-wrap">
        <section style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="scroll-x">
            <table className="table">
              <thead><tr>
                <ThTri t={tri} col="nom">{t('Employee')}</ThTri>
                {showEquipe && <ThTri t={tri} col="equipe">{t('Team')}</ThTri>}
                <ThTri t={tri} col="certifications" premier="desc">{t('Certifications')}</ThTri>
                <th>{t('Authorisations')}</th><th>{t('Requirements')}</th>
                <ThTri t={tri} col={sortis ? 'sortie' : 'echeance'}>{t(sortis ? 'Departure#exit' : 'Next due date')}</ThTri>
                <ThTri t={tri} col="statut" premier="desc">{t('Status')}</ThTri>
              </tr></thead>
              <tbody>
                {page.lignes.map(e => {
                  const hs = habSummary(e);
                  return (
                    <tr key={e.id} className={`clickable${ui.selectedId === e.id ? ' selected' : ''}`} onClick={() => setUi({ selectedId: ui.selectedId === e.id ? null : e.id })}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Avatar nom={e.nom} />
                          <div>
                            <div className="nowrap"><Ouvrir pressed={ui.selectedId === e.id} onOpen={() => setUi({ selectedId: ui.selectedId === e.id ? null : e.id })}>{e.nom}</Ouvrir>{lecture.has(e.id) && <> <LectureSeule d={d} empId={e.id} /></>}</div>
                            <div className="text-muted sub">{e.poste}</div>
                            <div className="text-muted sub-11">{contratCourt(d.contratOf(e))}</div>
                          </div>
                        </div>
                      </td>
                      {showEquipe && <td className={e.equipe ? 'text-muted' : undefined}>{e.equipe ?? <Tag cls="tag-outline">{t('To assign')}</Tag>}</td>}
                      <td><Chips items={e.certs.map(c => ({ key: c.id, label: c.fm.court, cls: CLS[c.key] }))} /></td>
                      <td>{e.habs.some(habSuivie) ? <Tag cls={hs.cls}>{hs.label}</Tag> : <span className="text-muted">—</span>}</td>
                      {/* Exigences du poste et de l'équipe (t055) : manquantes, remplies, ou aucune déclarée. */}
                      <td>{sortis ? <span className="text-muted">—</span> : <ExigencesCellule e={e} />}</td>
                      {sortis
                        ? <td><Two main={e.fin ? fmtIso(e.fin) : '—'} sub={e.motifSortie ? MOTIFS_SORTIE[e.motifSortie] : t('end of contract')} nowrap /></td>
                        : <td><Two main={e.next ? fmt(e.next.exp) : '—'} sub={e.next ? rel(e.next.d) : t('no tracked certification')} nowrap /></td>}
                      <td>{sortis ? <Tag cls="tag-outline">{t('Left#masc')}</Tag> : <Tag cls={CLS[e.worst]}>{EMP_LABEL[e.worst]}</Tag>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <Empty pad="md">
              {sortis && liste.length === 0 ? t('No employee has left: a departure is recorded from the sheet (Contract section).')
                : liste.length > 0 ? t('No employee matches these filters.')
                : manager ? (myTeams.length ? t('Your team has no employee yet: add a member.') : t('No team is entrusted to you — HR appoints the team managers.'))
                : t('No employee recorded.')}
            </Empty>
          )}
          <SuiteListe p={page} unite={['employee', 'employees']} />
          <p className="text-muted fine">{rows.length} {t(rows.length > 1 ? 'employees shown' : 'employee shown')}{t(' of ')}{liste.length}</p>
        </section>

        {sel && <EmployeePanel panneau={panneau} e={sel} upcomingCount={(f: string) => upcoming.filter(s => s.formation === f && s.inscrits < s.places).length} trips={trips} horizon={horizon} />}
      </div>
    </Page>
  );
}

/** Ligne d'information du panneau : libellé atténué, valeur, précision éventuelle. */
function Info({ label, sub, children }: { label: ReactNode; sub?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="text-muted sub">{label}</div>
      <div style={{ fontSize: 14 }}>{children}</div>
      {sub != null && <div className="text-muted sub">{sub}</div>}
    </div>
  );
}

function EmployeePanel({ panneau, e, upcomingCount, trips, horizon }: {
  panneau: RefObject<HTMLElement | null>; e: EmpX; upcomingCount: (f: string) => number; trips: ReturnType<typeof useTrips>; horizon: number;
}) {
  const { d, formIds } = useEnriched();
  // `formations` : service RH et référent HSE (sessions, certifications, habilitations) ; `rh` : le reste de la fiche.
  const { espaceRh, rh, formations, manager, me, user } = useRole();
  const permis = useIntentPermis();
  /**
   * Sa propre fiche, dans l'espace RH (lot 8, chantier C) : ni titre, ni certification, ni levée de suspension, ni suivi
   * médical pour soi-même ; les boutons que le serveur refuserait sont remplacés par l'explication (shared/rules/soi-meme.ts).
   */
  const propre = fichePropre(user, e.id);
  const { setUi, openDialog, go, run, runIntent, notify } = useStore();
  /** Salarié sorti : fiche consultable (historique, passeport formation), sans action à planifier. */
  const parti = sorti(e, d.ti);
  /** Manager direct consultant un membre de son équipe (jamais sa propre fiche). */
  const membre = manager && e.id !== me && d.mgrOf(e) === me && !parti;
  /** Consultation N+2 (t136) : fiche consultée, décisions au manager direct. */
  const lectureSeule = useLectureSeule().has(e.id);
  const canPlan = (formations || membre) && !parti;
  /**
   * Certifications remplacées par un recyclage (historique), selon le filtre « réglementaires uniquement » ; celles
   * d'une formation archivée restent lisibles, comme sa certification en vigueur.
   */
  const anciennes = e.anciennes.filter(c => formIds.has(c.f) || c.fm.archive);
  /** Certifications en vigueur d'une formation archivée au référentiel : plus suivies, gardées au dossier. */
  const archivees = e.rawCerts.filter(c => c.fm.archive);
  const tv = d.travelOf(e, horizon);
  const nt = trips.find(x => x.empId === e.id);
  // État calculé par le serveur pour le manager, qui ne reçoit pas les vaccinations (comme Missions).
  const ntStatus = nt ? TRIP_LABEL[d.tripStatus(nt)] : null;
  const docChips = [
    ...tv.visas.map(v => ({ key: 'v' + v.dest, label: `${v.type} ${d.destOf(v.dest)?.pays ?? v.dest} · ${v.key === 'exp' ? t('expired') : t('until ') + fmtShort(v.exp)}`, cls: docCls(v.key) })),
    ...(manager ? [] : tv.vaccins.map(x => ({ key: 'x' + x.v, label: `${x.vm.court}${x.exp ? ' · ' + (x.key === 'exp' ? t('booster overdue') : x.exp.getFullYear()) : ''}`, cls: docCls(x.key) }))),
  ];
  const hasTravel = !!(e.passeport || tv.visas.length || tv.vaccins.length || nt);

  // — Contrat & temps de travail —
  const c = d.contratOf(e);
  const tt = TEMPS_TRAVAIL[c.temps];
  const nature = c.typeContrat === 'interim'
    ? `${t('Temporary work')}${e.agence ? t(' · agency ') + e.agence : ''}${e.fin ? t(' · assignment until ') + fmtIso(e.fin) : ''}`
    : e.fin
      ? `${TYPES_CONTRAT[c.typeContrat].label}${t(' · from ')}${fmtIso(e.entree)}${t(' to #au')}${fmtIso(e.fin)}`
      : TYPES_CONTRAT[c.typeContrat].label;
  // Sortie enregistrée : son échéance est rappelée par la section Sortie (SortieFiche).
  const finD = c.typeContrat !== 'cdi' && e.fin && !e.motifSortie ? days(d.today, parse(e.fin)) : null;
  const valideur = d.mgrOf(e);
  /** Types d'absence ouverts par le contrat (aucun pour un intérimaire : congés gérés par l'agence). */
  const poseAbsence = absenceKinds(d, e).length > 0;
  /** Un membre qui encadre lui-même une équipe ne change d'équipe que par le service RH. */
  const retirable = membre && d.teamsOf(e.id).length === 0;

  // Inscriptions en formation initiale (formation jamais suivie), jusqu'à l'obtention de la certification :
  // planifiées, session passée à clôturer, ou à replanifier (session annulée, absent, évaluation échouée).
  const inscriptions = d.ds.inscriptions
    .filter(i => i.empId === e.id)
    .flatMap(i => {
      const x = etatInscription(d, i);
      return x ? [{ i, x, s: x.s, fm: d.fm(x.s.formation) as Formation | undefined }] : [];
    })
    .sort((a, b) => a.s.date.localeCompare(b.s.date));

  /**
   * Propositions d'action sur une habilitation : toutes pour le RH, celles de formation pour le référent HSE ;
   * recyclage ou demande de formation pour le manager.
   */
  const habProposal = (h: HabInfo): Proposal | null => {
    const a = parti ? null : d.habAction(e.id, h);
    // Sa propre fiche : ni délivrance ni visite médicale proposées (refusées par le serveur).
    if (a && propre && (a.intent.type === 'openHab' || a.intent.type === 'medical')) return null;
    if (!a || formations) return a && permis(a.intent) ? a : null;
    if (!membre) return null;
    if (a.intent.type === 'openPlan') return a;
    if (a.intent.type === 'goFormation') return { label: t('Request the training course'), intent: a.intent };
    return null;
  };
  /** Convocation à une session à venir (e-mail avec fichier .ics), envoi ou renvoi ; désinscription confirmée, qui libère la place. */
  const convoquer = (sessionId: number) => run('convocation.envoyer', { sessionId, empIds: [e.id] });
  const desinscrire = (sessionId: number, quoi: string, convoque: boolean, recyclage: boolean) =>
    openDialog({ type: 'confirmer', c: desinscription({ empId: e.id, sessionId }, e.nom, quoi, { recyclage, convoque }) });
  // « À renvoyer » : convocation déjà envoyée, avant un changement de date ou de lieu de la session.
  const convocation = (convoc: 'now' | 'later' | null, le: string | null) =>
    convoc === 'now' ? `${t('notice sent')}${le ? `${t(' on #le')}${fmtShort(parse(le))}` : ''}` : le ? `${t('notice to resend (sent on ')}${fmtShort(parse(le))})` : t('notice to send');
  const runProposal = (a: Proposal) => {
    const it = a.intent;
    if (!formations && it.type === 'goFormation') openDialog({ type: 'reqForm', empId: e.id, f: it.f });
    else runIntent(it);
  };

  // Confirmation, puis la fiche se ferme : un manager ne voit plus le collaborateur retiré de son équipe.
  const retirer = () => openDialog({ type: 'confirmer', c: retraitEquipe(e.id, e.nom, equipeLabel(e), { selectedId: null }) });

  // Passeport formation : sections communes au portail du salarié (client/src/passeport.ts).
  const passeportFormation = () => {
    if (!imprimerPasseport(d, e)) notify(t('Allow pop-up windows to print the training passport'), true);
  };

  return (
    <aside ref={panneau} tabIndex={-1} aria-labelledby="fiche-nom" className="card elev-md panneau-colonne">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <Avatar nom={e.nom} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 id="fiche-nom">{e.nom}</h3>
          <div className="text-muted" style={{ fontSize: 13 }}>{e.poste} · {equipeLabel(e)}</div>
          <div className="text-muted sub" style={{ overflowWrap: 'anywhere' }}>{e.email ?? t('No work e-mail address')}</div>
        </div>
        <CloseButton onClick={() => setUi({ selectedId: null })} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        {parti ? <Tag cls="tag-outline">{t('Left#masc')}</Tag> : <Tag cls={CLS[e.worst]}>{EMP_LABEL[e.worst]}</Tag>}
        {!e.equipe && <Tag cls="tag-outline">{t('To assign')}</Tag>}
        {lectureSeule && <LectureSeule d={d} empId={e.id} />}
        <span className="text-muted sub">
          {tn(e.certs.length, 'certification', 'certifications')} · {parti ? `${t('left on ')}${fmtIso(e.fin!)}${t(': no more due date tracked')}` : e.next ? t('next due date on ') + fmt(e.next.exp) : t('no due date')}
        </span>
        <CopierLien />
      </div>
      {!parti && <ExigencesMotif e={e} />}
      {lectureSeule && <Fine>{t('Read-only consultation (attached team): the absences, hours, training and reviews of ')}{e.nom}{t(' are the responsibility of ')}{d.mgrName(valideur)}.</Fine>}
      {/* Manager : verdict et restrictions en vigueur seulement ; demandes de visite et avis : service RH. */}
      <SectionLabel>{t('Medical fitness')}</SectionLabel>
      <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
        <Aptitude e={e} d={d} horizon={horizon} actions={rh && !parti && !propre ? <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'visite', empId: e.id })}>{t(e.med.demande ? 'Visit request' : 'Request a visit')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'avis', empId: e.id })}>{t('Occupational physician’s opinion')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'suivi', empId: e.id })}>{t('Type of monitoring')}</button>
        </> : undefined} />
      </div>
      {rh && !parti && propre && <Fine>{AIDE_SOI_MEME.medical}</Fine>}

      <SectionLabel>{t('Certifications')}</SectionLabel>
      <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
        {e.certs.map(c => {
          const avail = upcomingCount(c.f);
          return (
            <div key={c.id} className="list-row stack">
              <div className="item-head">
                <div><div style={{ fontSize: 14 }}>{c.fm.nom}</div><div className="text-muted sub">{t('Obtained on ')}{fmt(c.obt)}{t(' · expires on ')}{fmt(c.exp)}</div></div>
                <Tag cls={CLS[c.key]} style={{ flex: 'none' }}>{CERT_LABEL[c.key]}</Tag>
              </div>
              <Bar variant="thin" pct={c.pct} color={c.key === 'ok' ? 'var(--color-accent-600)' : 'var(--color-accent-300)'} />
              {c.session && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <NoteAccent icon>{t('Session ')}{sessionDu(c.session)} · {convocation(c.convoc, c.convocLe)}</NoteAccent>
                  {canPlan && (
                    <div className="actions-end">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => convoquer(c.session!.id)}>{t(convocationEnvoyee(c) ? 'Resend the notice' : 'Send the notice')}</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => desinscrire(c.session!.id, `${c.fm.court} ${sessionDu(c.session!)}`, convocationEnvoyee(c), true)}>{t('Unenrol')}</button>
                    </div>
                  )}
                </div>
              )}
              {c.sessionPassee && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                  <NoteAccent>{SESSION_PASSEE}{t(' · session ')}{sessionDu(c.sessionPassee)}</NoteAccent>
                  {formations && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'cloture', sessionId: c.sessionPassee!.id })}>{t('Close the session')}</button>}
                </div>
              )}
              {c.key !== 'ok' && !c.session && !c.sessionPassee && canPlan && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                  <span className="text-muted sub">{avail ? tn(avail, 'available session', 'available sessions') : t('No session available')}</span>
                  {/* Sans session ouverte, le manager ne peut pas en créer : il adresse la demande au service RH. */}
                  {!formations && !avail
                    ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'reqForm', empId: e.id, f: c.f })}>{t('Request the training course')}</button>
                    : <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'plan', empId: e.id, certId: c.id })}>{t('Plan a renewal')}</button>}
                </div>
              )}
              <ActionsCertification e={e} c={c} />
            </div>
          );
        })}
        {e.certs.length === 0 && <Empty pad="sm">{t('No tracked certification.')}</Empty>}
      </div>

      {/* Formations et habilitations exigées par le poste et l'équipe, obtenues ou manquantes. */}
      <ExigencesFiche e={e} membre={membre} parti={parti} />

      {(anciennes.length > 0 || archivees.length > 0 || (e.certsAnnulees?.length ?? 0) > 0) && <>
        <SectionLabel>{t('Certification history')}</SectionLabel>
        <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
          {archivees.map(c => (
            <div key={c.id} className="list-row past">
              <div className="grow">
                <div style={{ fontSize: 13 }}>{c.fm.nom}</div>
                <div className="sub">{t('Obtained on ')}{fmt(c.obt)}{t(' · expires on ')}{fmt(c.exp)}{t(' · no longer tracked')}</div>
              </div>
              <Tag cls="tag-outline" style={{ flex: 'none' }}>{t('Archived training course')}</Tag>
            </div>
          ))}
          {anciennes.map(c => (
            <div key={c.id} className="list-row past">
              <div className="grow">
                <div style={{ fontSize: 13 }}>{c.fm.nom}</div>
                <div className="sub">{t('Obtained on ')}{fmt(c.obt)}{t(' · replaced on ')}{fmt(c.remplacee!)}{c.fm.archive ? t(' · archived training course') : ''}</div>
              </div>
              <Tag cls="tag-outline" style={{ flex: 'none' }}>{t('Replaced#fem')}</Tag>
              <ActionsCertification e={e} c={c} />
            </div>
          ))}
        </div>
        <CertsAnnulees e={e} />
      </>}

      <DemandesFiche e={e} membre={membre} />

      {inscriptions.length > 0 && <>
        <SectionLabel>{t('Planned training courses')}</SectionLabel>
        <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
          {inscriptions.map(({ i, x, s, fm }) => (
            <div key={i.id} className="list-row stack">
              <div className="item-head">
                <div>
                  <div style={{ fontSize: 14 }}>{fm?.nom ?? s.formation}</div>
                  <div className="text-muted sub">
                    {x.etat === 'a_planifier'
                      ? `${x.motif}${t(' · initial training to replan')}`
                      : `${t('Session ')}${sessionDu(s)} · ${s.lieu}${fm?.organisme ? ` · ${fm.organisme}` : ''}${s.statut === 'À confirmer' ? t(' · to be confirmed') : ''}`}
                  </div>
                </div>
                {x.etat === 'passee' ? <Tag cls="tag-outline" style={{ flex: 'none' }}>{t('Past session')}</Tag>
                  : x.etat === 'a_planifier' ? <Tag cls="tag-accent" style={{ flex: 'none' }}>{t('To plan')}</Tag>
                  : <Tag cls={i.convoc === 'now' ? 'tag-neutral' : 'tag-outline'} style={{ flex: 'none' }}>{t(i.convoc === 'now' ? 'Notice sent' : i.convocLe ? 'Notice to resend' : 'Notice to send')}</Tag>}
              </div>
              {x.etat === 'planifiee' && canPlan && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <span className="text-muted sub">{convocation(i.convoc, i.convocLe)}</span>
                  <div className="actions-end">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => convoquer(s.id)}>{t(convocationEnvoyee(i) ? 'Resend the notice' : 'Send the notice')}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => desinscrire(s.id, `${fm?.court ?? s.formation} ${sessionDu(s)}`, convocationEnvoyee(i), false)}>{t('Unenrol')}</button>
                  </div>
                </div>
              )}
              {x.etat === 'passee' && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                  <NoteAccent>{formations ? SESSION_PASSEE : `${SESSION_PASSEE}${t(' by HR#close')}`}</NoteAccent>
                  {formations && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'cloture', sessionId: s.id })}>{t('Close the session')}</button>}
                </div>
              )}
              {x.etat === 'a_planifier' && canPlan && (
                <div className="actions-end">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'plan', empId: e.id, inscriptionId: i.id })}>{t('Plan')}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </>}

      {/* Listes d'attente des sessions complètes (lot 7, t120). */}
      <ListeAttenteFiche e={e} />

      {e.habs.length > 0 && <>
        <SectionLabel>{t('Authorisations')}</SectionLabel>
        <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
          {e.habs.map(h => {
            const a = habProposal(h);
            // Suspendre : RH, référent HSE ou manager direct ; lever la suspension, retirer, délivrer de nouveau : RH et référent HSE.
            // Sa propre habilitation : se suspendre seulement (MESURES_SOI_MEME).
            const mesures = (formations || membre) && !parti ? d.habMesures(h, formations).filter(m => !propre || MESURES_SOI_MEME.includes(m)) : [];
            const redelivrer = formations && !parti && !propre && h.key === 'retiree';
            return (
              <div key={h.hm.id} className="list-row stack">
                <div className="item-head">
                  <div>
                    <div style={{ fontSize: 14 }}>{h.hm.nom}</div>
                    <div className="text-muted sub">{h.delivree ? `${t('Issued on ')}${fmt(parse(h.delivree))}${t(' by ')}${h.par}${t(' · expires on ')}${fmt(h.exp!)}` : `${t('Requested on ')}${fmt(parse(h.demande!))}${t(' · awaiting issue')}`}</div>
                  </div>
                  <Tag cls={HAB_CLS[h.key]} style={{ flex: 'none' }}>{HAB_LABEL[h.key]}</Tag>
                </div>
                {h.note && <NoteAccent>{h.note}</NoteAccent>}
                {(a || redelivrer || mesures.length > 0 || (formations && titreImprimable(h))) && (
                  <div className="actions-end">
                    {a && <button type="button" className="btn btn-ghost btn-sm" onClick={() => runProposal(a)}>{a.label}</button>}
                    <ImprimerTitre e={e} h={h} />
                    {redelivrer && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'hab', empId: e.id, h: h.h, mode: 'deliver' })}>{t('New issue')}</button>}
                    {mesures.map(m => (
                      <button key={m} type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'habMesure', empId: e.id, h: h.h, action: m })}>{HAB_MESURE_LABEL[m]}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </>}

      {/* Délivrances remplacées par un renouvellement (t115) et formations suivies, hors catalogue comprises (t116). */}
      <HabilitationsAnterieures e={e} />
      <FormationsSuiviesFiche e={e} parti={parti} />

      <PiecesFiche empId={e.id} parti={parti} />

      {/* Dossier voyage (passeport, visas, vaccinations) : service RH ; pour le manager, sans les vaccinations. */}
      {hasTravel && (rh || manager) && <>
        <SectionLabel>{t('Trips')}</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'calc(-1 * var(--space-2))' }}>
          <div style={{ fontSize: 14 }}>
            {tv.pass ? `${t('Passport valid until ')}${fmt(tv.pass.exp)}${tv.pass.key !== 'ok' ? ' · ' + (tv.pass.key === 'exp' ? t('expired') : t('expires ') + rel(tv.pass.d)) : ''}` : t('Passport not entered')}
          </div>
          {docChips.length > 0 && <Chips items={docChips} />}
          <div className="text-muted sub">{nt ? `${t('Next trip: ')}${nt.r.dest.pays}, ${fmt(nt.r.dep)} · ${ntStatus}` : t('No trip planned')}</div>
          {rh && !parti && (
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'fo', empId: e.id })}>{t('Record a formality')}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('voyages', { tripSel: nt ? nt.id : null })}>{t('Travel file →')}</button>
            </div>
          )}
        </div>
      </>}

      <SectionLabel>{t('Contract & working time')}</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'calc(-1 * var(--space-2))' }}>
        <Info label={t('Status')}>{STATUTS[c.statut].label} <span className="text-muted">· {t(c.cadre ? 'executive' : 'non-executive')}</span></Info>
        <Info label={t('Type of contract')}>{nature}</Info>
        {finD != null && finD <= 60 && <NoteAccent>{t('End of contract ')}{rel(finD)}</NoteAccent>}
        <Info label={t('Working time arrangement')} sub={<>{tt.aide}{tt.article ? ` (${tt.article})` : ''}</>}>
          {c.label}{c.partiel && c.jourOff.length > 0 ? `${t(' · does not work on ')}${joursListe(c.jourOff)}` : ''}
          {e.tempsDepuis ? <span className="text-muted">{t(' · since ')}{fmtIso(e.tempsDepuis)}</span> : null}
        </Info>
        <Info label={t('Start date')}>{fmtIso(e.entree)}</Info>
        {/* Matricule du dossier de paie (Sage) : à saisir sur la fiche, faute de quoi le salarié est refusé d'une transmission réelle. */}
        {espaceRh && !c.interim && (
          <Info label={t('Payroll number')} sub={`${t('Cursus number ')}${matricule(e.id)}`}>
            {e.matriculePaie ?? <span className="note-accent">{t('To enter')}</span>}
          </Info>
        )}
        <SortieFiche e={e} />
        <ContratFiche e={e} />
        <HistoriqueContrat e={e} />
        <ForfaitJoursFiche e={e} />
        {/* lot 12 — C1 (forfait annuel en heures) */}
        <ForfaitHeuresFiche e={e} />
        <MineurFiche e={e} />
        <TravailNuitFiche e={e} />
        <MandatsFiche e={e} />
        <ContactUrgenceFiche empId={e.id} />
        <Info label={t('Approving manager')}>{d.mgrName(valideur)}</Info>
        {rh && e.repriseDate && <Info label={t('Return after a long absence')}>{`${e.repriseMotif ?? t('Reason not entered')}${t(' · on ')}${fmtIso(e.repriseDate)}`}</Info>}
      </div>

      {membre && <>
        <SectionLabel>{t('For this employee')}</SectionLabel>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'calc(-1 * var(--space-2))' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'reqForm', empId: e.id })}>{t('Request a training course')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'reqHab', empId: e.id })}>{t('Request an authorisation')}</button>
          {poseAbsence && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'abs', empId: e.id })}>{t('Request an absence')}</button>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'absSignal', empId: e.id })}>{t('Report an absence')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('temps', { tsEmp: e.id })}>{t('Timesheet →')}</button>
        </div>
        {!poseAbsence && (
          <Fine>{c.interim ? `${t('Leave managed by the temporary work agency')}${e.agence ? ' ' + e.agence : ''}${t(': no absence to request in Cursus.')}` : t('No absence to request for this contract.')}</Fine>
        )}
      </>}

      {/* Lecteurs du journal : actions qui concernent ce salarié ; droit « rh » : export de toutes ses données (droit d'accès). */}
      <HistoriqueFiche empId={e.id} />

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {(rh || membre) && <Btn variant="secondary" icon={<PencilSimpleIcon size={14} />} onClick={() => openDialog({ type: 'employe', empId: e.id })}>{t('Edit the sheet')}</Btn>}
        {formations && !parti && !propre && <Btn variant="secondary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'cert', empId: e.id })}>{t('Add a certification')}</Btn>}
        <Btn onClick={passeportFormation}>{t('Training passport')}</Btn>
        {retirable && <Btn icon={<UserMinusIcon size={14} />} onClick={retirer}>{t('Remove from the team')}</Btn>}
      </div>
      {formations && !parti && propre && <Fine>{AIDE_SOI_MEME.titres}</Fine>}
    </aside>
  );
}
