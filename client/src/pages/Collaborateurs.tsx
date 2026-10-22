// Annuaire (RH) ou équipe (manager) : statut de conformité, contrat et fiche détaillée.
import { useMemo, type ReactNode, type RefObject } from 'react';
import { DownloadSimpleIcon, PencilSimpleIcon, PlusIcon, UserMinusIcon, UserPlusIcon } from '@phosphor-icons/react';
import { CERT_LABEL, CLS, EMP_LABEL, HAB_CLS, HAB_LABEL, HAB_MESURE_LABEL, RANK, SESSION_PASSEE, STATUTS, TEMPS_TRAVAIL, TRIP_LABEL, TYPES_CONTRAT } from '../../../shared/constants.ts';
import type { ContratX, EmpX, HabInfo, Proposal } from '../../../shared/domain.ts';
import type { Formation } from '../../../shared/types.ts';
import { days, parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt, fmtIso, fmtShort, matricule, norm, plural, rel } from '../../../shared/format.ts';
import { sessionDu } from '../../../shared/rules/plage-session.ts';
import { absenceKinds } from '../../../shared/rules/conges.ts';
import { habSuivie } from '../../../shared/rules/referentiels.ts';
import { MOTIFS_SORTIE, sorti } from '../../../shared/rules/contrats.ts';
import { convocationEnvoyee, etatInscription } from '../../../shared/rules/sessions.ts';
import { JOURS_SEMAINE } from '../../../shared/rules/profil.ts';
import { equipesDescendantes } from '../../../shared/rules/hierarchie.ts';
import { usePanneauVisible } from '../components/panneau.ts';
import { Avatar, Bar, Btn, Chips, CloseButton, Empty, Fine, NoteAccent, Page, Panel, SectionLabel, Seg, Tag, Two } from '../components/ui.tsx';
import { Ouvrir } from '../components/Cliquable.tsx';
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
import { ActionsCertification, CertsAnnulees, DemandesFiche } from '../components/Corrections.tsx';
import { downloadCsv, matriculesImprimes, printDocument } from '../print.ts';
import { csvAnnuaire } from '../listes-csv.ts';
import { useEnriched, useIntentPermis, useRole, useTrips } from '../state/derived.ts';
import { desinscription, retraitEquipe } from '../state/confirmations.ts';
import { useStore } from '../state/store.tsx';
import { HistoriqueFiche } from './Journal.tsx';
import { EchRow } from './Dashboard.tsx';
import { PiecesFiche } from '../components/PiecesFiche.tsx';
import { CouverturePanel } from '../components/Couverture.tsx';
import { CopierLien } from '../components/CopierLien.tsx';

/** Valeur du filtre d'équipe pour les collaborateurs sans équipe (« À affecter »). */
const SANS_EQUIPE = '';

const docCls = (k: string) => k === 'exp' ? 'tag-accent' : k === 'due' ? 'tag-outline' : 'tag-neutral';

/** Titres suivis (habilitation du référentiel en vigueur) : valides, à renouveler, non conformes, en attente. */
function habSummary(e: EmpX) {
  const suivies = e.habs.filter(habSuivie), hs = suivies.filter(h => h.key !== 'pending');
  const ko = hs.filter(h => h.key === 'exp' || h.key === 'susp' || h.key === 'retiree').length, due = hs.filter(h => h.key === 'due').length, pend = suivies.length - hs.length;
  return {
    label: ko ? plural(ko, 'non conforme', 'non conformes') : due ? `${due} à renouveler` : !hs.length ? `${pend} en attente` : plural(hs.length, 'valide', 'valides'),
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
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} et ${n[n.length - 1]}` : n[0] ?? '';
};

export function Collaborateurs() {
  const { emps, upcoming, horizon, onlyReg, d } = useEnriched();
  const trips = useTrips();
  // `espaceRh` : tout le site (service RH, référent HSE, lecture seule) ; `rh` : fiches et équipes.
  const { espaceRh, rh, manager, me } = useRole();
  const { ui, setUi, openDialog, notify } = useStore();

  const myTeams = useMemo(() => manager ? d.teamsOf(me) : [], [d, manager, me]);
  const team = useMemo(() => manager ? emps.filter(e => e.id !== me && d.mgrOf(e) === me) : emps, [emps, manager, me, d]);
  // Consultation N+2 (t136) : membres des équipes rattachées, en lecture seule, listés après l'équipe directe et filtrables
  // par sous-équipe ; ils ne comptent ni dans le résumé ni dans les échéances de contrat du manager.
  const lecture = useLectureSeule();
  const sousEquipes = useMemo(() => manager && lecture.size ? equipesDescendantes(d.ds.referentiels.equipes, myTeams) : [], [d, manager, lecture, myTeams]);
  const vus = useMemo(() => lecture.size ? [...team, ...emps.filter(e => lecture.has(e.id))] : team, [team, emps, lecture]);
  // Filtre « Sortis » : les salariés dont la date de sortie est passée, que `emps` ne compte plus (Domain.enrich).
  const sortis = ui.statut === 'sortis';
  const liste = useMemo(() => !sortis ? vus : d.enrich(horizon, onlyReg, { sortis: true })
    .filter(e => sorti(e, d.ti) && (!manager || (e.id !== me && (d.mgrOf(e) === me || lecture.has(e.id))))), [sortis, vus, d, horizon, onlyReg, manager, me, lecture]);
  const teamOptions = espaceRh ? d.equipes : [...myTeams, ...sousEquipes];
  const multi = espaceRh || teamOptions.length > 1;
  // Un filtre devenu sans objet (équipe renommée, hors périmètre) revient à « Toutes ».
  const filtre = multi && (ui.equipe === SANS_EQUIPE ? espaceRh : teamOptions.includes(ui.equipe)) ? ui.equipe : 'Toutes';
  const aAffecter = espaceRh ? emps.filter(e => !e.equipe).length : 0;

  const q = norm(ui.search.trim());
  const rows = useMemo(() => liste
    .filter(e => (filtre === 'Toutes' || (filtre === SANS_EQUIPE ? !e.equipe : e.equipe === filtre)) && (ui.statut === 'tous' || sortis || e.worst === ui.statut)
      // Recherche aussi par matricule : de paie (fiche) ou Cursus (EMP-0001, celui des messages de Keystone).
      && (!q || norm(`${e.nom} ${e.poste} ${equipeLabel(e)} ${e.matriculePaie ?? ''} ${matricule(e.id)}`).includes(q)))
    // Sortis : les départs les plus récents d'abord.
    .sort((a, b) => sortis ? (b.fin ?? '').localeCompare(a.fin ?? '') || a.nom.localeCompare(b.nom)
      : RANK[b.worst] - RANK[a.worst] || (a.next ? a.next.d : 1e9) - (b.next ? b.next.d : 1e9) || a.nom.localeCompare(b.nom)),
  [liste, filtre, ui.statut, sortis, q]);

  const sel = liste.find(e => e.id === ui.selectedId) || null;
  // Écran étroit : la fiche s'affiche sous la liste ; la sélection l'amène dans le champ de vision.
  const panneau = usePanneauVisible<HTMLElement>(sel?.id);
  const certCount = team.reduce((n, e) => n + e.certs.length, 0);
  const certs = plural(certCount, 'certification suivie', 'certifications suivies');
  const kicker = manager
    ? `${myTeams.length ? `${myTeams.length > 1 ? 'Équipes' : 'Équipe'} ${myTeams.join(', ')}` : 'Aucune équipe encadrée'} · ${plural(team.length, 'collaborateur', 'collaborateurs')} · ${certs}`
    : `${plural(emps.length, 'collaborateur', 'collaborateurs')} · ${plural(d.equipes.length, 'équipe', 'équipes')}${aAffecter ? ` · ${aAffecter} à affecter` : ''} · ${certs}`;
  const showEquipe = multi && !sel;
  const cible = filtre !== 'Toutes' && filtre !== SANS_EQUIPE ? filtre : null;
  // Résumé du manager : fins d'essai (avant le délai de prévenance) et fins de contrat de son équipe (shared/rules/contrats.ts).
  const contrats = useMemo(() => manager ? d.echeances(team, horizon).filter(x => x.kind === 'contrat' && x.key !== 'ok').sort((a, b) => a.d - b.d)
    .map(x => ({ ...x, action: null })) : [], [manager, d, team, horizon]);

  // Export de l'annuaire : les lignes affichées (équipe, statut, recherche), dans le périmètre de l'utilisateur.
  const exporter = () => {
    const x = csvAnnuaire(d, rows);
    downloadCsv(x.fichier, x.head, x.rows);
    notify(`Export CSV généré — ${plural(rows.length, 'collaborateur', 'collaborateurs')}`);
  };

  return (
    <Page tight kicker={kicker} title="Collaborateurs" actions={<>
      {multi && (
        <select className="input" aria-label="Équipe" value={filtre} onChange={e => setUi({ equipe: e.target.value })} style={{ width: 'auto', minWidth: 190 }}>
          <option value="Toutes">{espaceRh ? 'Toutes les équipes' : 'Toutes mes équipes'}</option>
          {teamOptions.map(nom => <option key={nom} value={nom}>{nom}{sousEquipes.includes(nom) ? ' (lecture seule)' : ''}</option>)}
          {espaceRh && <option value={SANS_EQUIPE}>{aAffecter ? `À affecter (${aAffecter})` : 'À affecter'}</option>}
        </select>
      )}
      <Seg name="statut" label="Statut" value={ui.statut} onChange={v => setUi({ statut: v })}
        options={[['tous', 'Tous'], ['ok', 'À jour'], ['due', 'À renouveler'], ['exp', 'Non conformes'], ['sortis', 'Sortis']]} />
      <Btn variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={exporter}>Exporter (CSV)</Btn>
      {rh && <Btn variant="primary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'employe', equipe: cible })}>Nouveau collaborateur</Btn>}
      {manager && myTeams.length > 0 && (
        <Btn variant="primary" icon={<UserPlusIcon size={14} />} onClick={() => openDialog({ type: 'membre', equipe: cible && myTeams.includes(cible) ? cible : myTeams[0] })}>Ajouter un membre</Btn>
      )}
    </>}>
      {contrats.length > 0 && (
        <Panel highlight title="Fins d’essai et de contrat" aside={plural(contrats.length, 'échéance à anticiper', 'échéances à anticiper')}>
          <div className="scroll-x">
            <table className="table">
              <tbody>
                {contrats.map(x => <EchRow key={`${x.emp.id}-${x.label}`} x={x} onOpen={() => setUi({ selectedId: x.emp.id })} onAct={() => undefined} />)}
              </tbody>
            </table>
          </div>
          <Fine>Fin d’essai : date limite pour notifier une rupture dans le délai de prévenance (art. L1221-25) ; décision à prendre avec le service RH.</Fine>
        </Panel>
      )}
      {manager && <CouverturePanel equipes={myTeams} />}
      <div className="row-wrap">
        <section style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Collaborateur</th>{showEquipe && <th>Équipe</th>}<th>Certifications</th><th>Habilitations</th><th>Exigences</th><th>{sortis ? 'Sortie' : 'Prochaine échéance'}</th><th>Statut</th></tr></thead>
              <tbody>
                {rows.map(e => {
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
                      {showEquipe && <td className={e.equipe ? 'text-muted' : undefined}>{e.equipe ?? <Tag cls="tag-outline">À affecter</Tag>}</td>}
                      <td><Chips items={e.certs.map(c => ({ key: c.id, label: c.fm.court, cls: CLS[c.key] }))} /></td>
                      <td>{e.habs.some(habSuivie) ? <Tag cls={hs.cls}>{hs.label}</Tag> : <span className="text-muted">—</span>}</td>
                      {/* Exigences du poste et de l'équipe (t055) : manquantes, remplies, ou aucune déclarée. */}
                      <td>{sortis ? <span className="text-muted">—</span> : <ExigencesCellule e={e} />}</td>
                      {sortis
                        ? <td><Two main={e.fin ? fmtIso(e.fin) : '—'} sub={e.motifSortie ? MOTIFS_SORTIE[e.motifSortie] : 'fin de contrat'} nowrap /></td>
                        : <td><Two main={e.next ? fmt(e.next.exp) : '—'} sub={e.next ? rel(e.next.d) : 'aucune certification suivie'} nowrap /></td>}
                      <td>{sortis ? <Tag cls="tag-outline">Sorti</Tag> : <Tag cls={CLS[e.worst]}>{EMP_LABEL[e.worst]}</Tag>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <Empty pad="md">
              {sortis && liste.length === 0 ? 'Aucun salarié sorti : la sortie s’enregistre depuis la fiche (section Contrat).'
                : liste.length > 0 ? 'Aucun collaborateur ne correspond à ces filtres.'
                : manager ? (myTeams.length ? 'Votre équipe ne compte encore aucun collaborateur : ajoutez un membre.' : 'Aucune équipe ne vous est confiée — le service RH désigne les managers d’équipe.')
                : 'Aucun collaborateur enregistré.'}
            </Empty>
          )}
          <p className="text-muted fine">{rows.length} {rows.length > 1 ? 'collaborateurs affichés' : 'collaborateur affiché'} sur {liste.length}</p>
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
  const { espaceRh, rh, formations, manager, me } = useRole();
  const permis = useIntentPermis();
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
  const nt = trips.find(t => t.empId === e.id);
  // État calculé par le serveur pour le manager, qui ne reçoit pas les vaccinations (comme Missions).
  const ntStatus = nt ? TRIP_LABEL[d.tripStatus(nt)] : null;
  const docChips = [
    ...tv.visas.map(v => ({ key: 'v' + v.dest, label: `${v.type} ${d.destOf(v.dest)?.pays ?? v.dest} · ${v.key === 'exp' ? 'expiré' : 'jusqu’au ' + fmtShort(v.exp)}`, cls: docCls(v.key) })),
    ...(manager ? [] : tv.vaccins.map(x => ({ key: 'x' + x.v, label: `${x.vm.court}${x.exp ? ' · ' + (x.key === 'exp' ? 'rappel dépassé' : x.exp.getFullYear()) : ''}`, cls: docCls(x.key) }))),
  ];
  const hasTravel = !!(e.passeport || tv.visas.length || tv.vaccins.length || nt);

  // — Contrat & temps de travail —
  const c = d.contratOf(e);
  const tt = TEMPS_TRAVAIL[c.temps];
  const nature = c.typeContrat === 'interim'
    ? `Intérim${e.agence ? ' · agence ' + e.agence : ''}${e.fin ? ' · mission jusqu’au ' + fmtIso(e.fin) : ''}`
    : e.fin
      ? `${TYPES_CONTRAT[c.typeContrat].label} · du ${fmtIso(e.entree)} au ${fmtIso(e.fin)}`
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
    if (!a || formations) return a && permis(a.intent) ? a : null;
    if (!membre) return null;
    if (a.intent.type === 'openPlan') return a;
    if (a.intent.type === 'goFormation') return { label: 'Demander la formation', intent: a.intent };
    return null;
  };
  /** Convocation à une session à venir (e-mail avec fichier .ics), envoi ou renvoi ; désinscription confirmée, qui libère la place. */
  const convoquer = (sessionId: number) => run('convocation.envoyer', { sessionId, empIds: [e.id] });
  const desinscrire = (sessionId: number, quoi: string, convoque: boolean, recyclage: boolean) =>
    openDialog({ type: 'confirmer', c: desinscription({ empId: e.id, sessionId }, e.nom, quoi, { recyclage, convoque }) });
  // « À renvoyer » : convocation déjà envoyée, avant un changement de date ou de lieu de la session.
  const convocation = (convoc: 'now' | 'later' | null, le: string | null) =>
    convoc === 'now' ? `convocation envoyée${le ? ` le ${fmtShort(parse(le))}` : ''}` : le ? `convocation à renvoyer (envoyée le ${fmtShort(parse(le))})` : 'convocation à envoyer';
  const runProposal = (a: Proposal) => {
    const it = a.intent;
    if (!formations && it.type === 'goFormation') openDialog({ type: 'reqForm', empId: e.id, f: it.f });
    else runIntent(it);
  };

  // Confirmation, puis la fiche se ferme : un manager ne voit plus le collaborateur retiré de son équipe.
  const retirer = () => openDialog({ type: 'confirmer', c: retraitEquipe(e.id, e.nom, equipeLabel(e), { selectedId: null }) });

  const passeportFormation = () => {
    const ok = printDocument(`Passeport formation — ${e.nom}`, `${e.poste} · ${equipeLabel(e)}`, [
      { title: 'Certifications', table: { head: ['Formation', 'Obtenue le', 'Expire le', 'Statut'], rows: e.rawCerts.map(c => [c.fm.nom, fmt(c.obt), fmt(c.exp), CERT_LABEL[c.key]]) } },
      ...(e.anciennes.length ? [{ title: 'Certifications remplacées', table: { head: ['Formation', 'Obtenue le', 'Expirait le', 'Remplacée le'], rows: e.anciennes.map(c => [c.fm.nom, fmt(c.obt), fmt(c.exp), fmt(c.remplacee!)]) } }] : []),
      // Le motif d'une suspension ou d'un retrait n'est pas imprimé : seuls l'état et sa date figurent au passeport.
      ...(e.habs.length ? [{ title: 'Habilitations', table: { head: ['Habilitation', 'Délivrée le', 'Par', 'Expire le', 'Statut'], rows: e.habs.map(h => [h.hm.nom, h.delivree ? fmt(parse(h.delivree)) : '—', h.par ?? '—', h.exp ? fmt(h.exp) : '—', HAB_LABEL[h.key] + (h.mesureLe ? ` le ${fmt(h.mesureLe)}` : '')]) } }] : []),
    ], e.id, matriculesImprimes(e));
    if (!ok) notify('Autorisez les fenêtres surgissantes pour imprimer le passeport formation', true);
  };

  return (
    <aside ref={panneau} tabIndex={-1} aria-labelledby="fiche-nom" className="card elev-md side-panel">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <Avatar nom={e.nom} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 id="fiche-nom">{e.nom}</h3>
          <div className="text-muted" style={{ fontSize: 13 }}>{e.poste} · {equipeLabel(e)}</div>
          <div className="text-muted sub" style={{ overflowWrap: 'anywhere' }}>{e.email ?? 'Aucune adresse e-mail professionnelle'}</div>
        </div>
        <CloseButton onClick={() => setUi({ selectedId: null })} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        {parti ? <Tag cls="tag-outline">Sorti</Tag> : <Tag cls={CLS[e.worst]}>{EMP_LABEL[e.worst]}</Tag>}
        {!e.equipe && <Tag cls="tag-outline">À affecter</Tag>}
        {lectureSeule && <LectureSeule d={d} empId={e.id} />}
        <span className="text-muted sub">
          {plural(e.certs.length, 'certification', 'certifications')} · {parti ? `sorti le ${fmtIso(e.fin!)} : plus d’échéance suivie` : e.next ? 'prochaine échéance le ' + fmt(e.next.exp) : 'aucune échéance'}
        </span>
        <CopierLien />
      </div>
      {!parti && <ExigencesMotif e={e} />}
      {lectureSeule && <Fine>Consultation en lecture seule (équipe rattachée) : les absences, les heures, les formations et les entretiens de {e.nom} relèvent de {d.mgrName(valideur)}.</Fine>}
      {/* Manager : verdict et restrictions en vigueur seulement ; demandes de visite et avis : service RH. */}
      <SectionLabel>Aptitude médicale</SectionLabel>
      <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
        <Aptitude e={e} d={d} horizon={horizon} actions={rh && !parti ? <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'visite', empId: e.id })}>{e.med.demande ? 'Demande de visite' : 'Demander une visite'}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'avis', empId: e.id })}>Avis du médecin du travail</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'suivi', empId: e.id })}>Type de suivi</button>
        </> : undefined} />
      </div>

      <SectionLabel>Certifications</SectionLabel>
      <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
        {e.certs.map(c => {
          const avail = upcomingCount(c.f);
          return (
            <div key={c.id} className="list-row stack">
              <div className="item-head">
                <div><div style={{ fontSize: 14 }}>{c.fm.nom}</div><div className="text-muted sub">Obtenue le {fmt(c.obt)} · expire le {fmt(c.exp)}</div></div>
                <Tag cls={CLS[c.key]} style={{ flex: 'none' }}>{CERT_LABEL[c.key]}</Tag>
              </div>
              <Bar variant="thin" pct={c.pct} color={c.key === 'ok' ? 'var(--color-accent-600)' : 'var(--color-accent-300)'} />
              {c.session && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <NoteAccent icon>Session {sessionDu(c.session)} · {convocation(c.convoc, c.convocLe)}</NoteAccent>
                  {canPlan && (
                    <div className="actions-end">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => convoquer(c.session!.id)}>{convocationEnvoyee(c) ? 'Renvoyer la convocation' : 'Envoyer la convocation'}</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => desinscrire(c.session!.id, `${c.fm.court} ${sessionDu(c.session!)}`, convocationEnvoyee(c), true)}>Désinscrire</button>
                    </div>
                  )}
                </div>
              )}
              {c.sessionPassee && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                  <NoteAccent>{SESSION_PASSEE} · session {sessionDu(c.sessionPassee)}</NoteAccent>
                  {formations && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'cloture', sessionId: c.sessionPassee!.id })}>Clôturer la session</button>}
                </div>
              )}
              {c.key !== 'ok' && !c.session && !c.sessionPassee && canPlan && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                  <span className="text-muted sub">{avail ? plural(avail, 'session disponible', 'sessions disponibles') : 'Aucune session disponible'}</span>
                  {/* Sans session ouverte, le manager ne peut pas en créer : il adresse la demande au service RH. */}
                  {!formations && !avail
                    ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'reqForm', empId: e.id, f: c.f })}>Demander la formation</button>
                    : <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'plan', empId: e.id, certId: c.id })}>Planifier un renouvellement</button>}
                </div>
              )}
              <ActionsCertification e={e} c={c} />
            </div>
          );
        })}
        {e.certs.length === 0 && <Empty pad="sm">Aucune certification suivie.</Empty>}
      </div>

      {/* Formations et habilitations exigées par le poste et l'équipe, obtenues ou manquantes. */}
      <ExigencesFiche e={e} membre={membre} parti={parti} />

      {(anciennes.length > 0 || archivees.length > 0 || (e.certsAnnulees?.length ?? 0) > 0) && <>
        <SectionLabel>Historique des certifications</SectionLabel>
        <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
          {archivees.map(c => (
            <div key={c.id} className="list-row past">
              <div className="grow">
                <div style={{ fontSize: 13 }}>{c.fm.nom}</div>
                <div className="sub">Obtenue le {fmt(c.obt)} · expire le {fmt(c.exp)} · plus suivie</div>
              </div>
              <Tag cls="tag-outline" style={{ flex: 'none' }}>Formation archivée</Tag>
            </div>
          ))}
          {anciennes.map(c => (
            <div key={c.id} className="list-row past">
              <div className="grow">
                <div style={{ fontSize: 13 }}>{c.fm.nom}</div>
                <div className="sub">Obtenue le {fmt(c.obt)} · remplacée le {fmt(c.remplacee!)}{c.fm.archive ? ' · formation archivée' : ''}</div>
              </div>
              <Tag cls="tag-outline" style={{ flex: 'none' }}>Remplacée</Tag>
              <ActionsCertification e={e} c={c} />
            </div>
          ))}
        </div>
        <CertsAnnulees e={e} />
      </>}

      <DemandesFiche e={e} membre={membre} />

      {inscriptions.length > 0 && <>
        <SectionLabel>Formations planifiées</SectionLabel>
        <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
          {inscriptions.map(({ i, x, s, fm }) => (
            <div key={i.id} className="list-row stack">
              <div className="item-head">
                <div>
                  <div style={{ fontSize: 14 }}>{fm?.nom ?? s.formation}</div>
                  <div className="text-muted sub">
                    {x.etat === 'a_planifier'
                      ? `${x.motif} · formation initiale à replanifier`
                      : `Session ${sessionDu(s)} · ${s.lieu}${fm?.organisme ? ` · ${fm.organisme}` : ''}${s.statut === 'À confirmer' ? ' · à confirmer' : ''}`}
                  </div>
                </div>
                {x.etat === 'passee' ? <Tag cls="tag-outline" style={{ flex: 'none' }}>Session passée</Tag>
                  : x.etat === 'a_planifier' ? <Tag cls="tag-accent" style={{ flex: 'none' }}>À planifier</Tag>
                  : <Tag cls={i.convoc === 'now' ? 'tag-neutral' : 'tag-outline'} style={{ flex: 'none' }}>{i.convoc === 'now' ? 'Convocation envoyée' : i.convocLe ? 'Convocation à renvoyer' : 'Convocation à envoyer'}</Tag>}
              </div>
              {x.etat === 'planifiee' && canPlan && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <span className="text-muted sub">{convocation(i.convoc, i.convocLe)}</span>
                  <div className="actions-end">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => convoquer(s.id)}>{convocationEnvoyee(i) ? 'Renvoyer la convocation' : 'Envoyer la convocation'}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => desinscrire(s.id, `${fm?.court ?? s.formation} ${sessionDu(s)}`, convocationEnvoyee(i), false)}>Désinscrire</button>
                  </div>
                </div>
              )}
              {x.etat === 'passee' && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                  <NoteAccent>{formations ? SESSION_PASSEE : `${SESSION_PASSEE} par le service RH`}</NoteAccent>
                  {formations && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'cloture', sessionId: s.id })}>Clôturer la session</button>}
                </div>
              )}
              {x.etat === 'a_planifier' && canPlan && (
                <div className="actions-end">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'plan', empId: e.id, inscriptionId: i.id })}>Planifier</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </>}

      {e.habs.length > 0 && <>
        <SectionLabel>Habilitations</SectionLabel>
        <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
          {e.habs.map(h => {
            const a = habProposal(h);
            // Suspendre : RH, référent HSE ou manager direct ; lever la suspension, retirer, délivrer de nouveau : RH et référent HSE.
            const mesures = (formations || membre) && !parti ? d.habMesures(h, formations) : [];
            const redelivrer = formations && !parti && h.key === 'retiree';
            return (
              <div key={h.hm.id} className="list-row stack">
                <div className="item-head">
                  <div>
                    <div style={{ fontSize: 14 }}>{h.hm.nom}</div>
                    <div className="text-muted sub">{h.delivree ? `Délivrée le ${fmt(parse(h.delivree))} par ${h.par} · expire le ${fmt(h.exp!)}` : `Demandée le ${fmt(parse(h.demande!))} · en attente de délivrance`}</div>
                  </div>
                  <Tag cls={HAB_CLS[h.key]} style={{ flex: 'none' }}>{HAB_LABEL[h.key]}</Tag>
                </div>
                {h.note && <NoteAccent>{h.note}</NoteAccent>}
                {(a || redelivrer || mesures.length > 0) && (
                  <div className="actions-end">
                    {a && <button type="button" className="btn btn-ghost btn-sm" onClick={() => runProposal(a)}>{a.label}</button>}
                    {redelivrer && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'hab', empId: e.id, h: h.h, mode: 'deliver' })}>Nouvelle délivrance</button>}
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

      <PiecesFiche empId={e.id} parti={parti} />

      {/* Dossier voyage (passeport, visas, vaccinations) : service RH ; pour le manager, sans les vaccinations. */}
      {hasTravel && (rh || manager) && <>
        <SectionLabel>Voyages</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'calc(-1 * var(--space-2))' }}>
          <div style={{ fontSize: 14 }}>
            {tv.pass ? `Passeport valide jusqu’au ${fmt(tv.pass.exp)}${tv.pass.key !== 'ok' ? ' · ' + (tv.pass.key === 'exp' ? 'expiré' : 'expire ' + rel(tv.pass.d)) : ''}` : 'Passeport non renseigné'}
          </div>
          {docChips.length > 0 && <Chips items={docChips} />}
          <div className="text-muted sub">{nt ? `Prochain déplacement : ${nt.r.dest.pays}, ${fmt(nt.r.dep)} · ${ntStatus}` : 'Aucun déplacement prévu'}</div>
          {rh && !parti && (
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'fo', empId: e.id })}>Enregistrer une formalité</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('voyages', { tripSel: nt ? nt.id : null })}>Dossier voyage →</button>
            </div>
          )}
        </div>
      </>}

      <SectionLabel>Contrat &amp; temps de travail</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'calc(-1 * var(--space-2))' }}>
        <Info label="Statut">{STATUTS[c.statut].label} <span className="text-muted">· {c.cadre ? 'cadre' : 'non-cadre'}</span></Info>
        <Info label="Nature du contrat">{nature}</Info>
        {finD != null && finD <= 60 && <NoteAccent>Fin de contrat {rel(finD)}</NoteAccent>}
        <Info label="Organisation du temps" sub={<>{tt.aide}{tt.article ? ` (${tt.article})` : ''}</>}>
          {c.label}{c.partiel && c.jourOff.length > 0 ? ` · ne travaille pas le ${joursListe(c.jourOff)}` : ''}
          {e.tempsDepuis ? <span className="text-muted"> · depuis le {fmtIso(e.tempsDepuis)}</span> : null}
        </Info>
        <Info label="Date d’entrée">{fmtIso(e.entree)}</Info>
        {/* Matricule du dossier de paie (Sage) : à saisir sur la fiche, faute de quoi le salarié est refusé d'une transmission réelle. */}
        {espaceRh && !c.interim && (
          <Info label="Matricule de paie" sub={`Matricule Cursus ${matricule(e.id)}`}>
            {e.matriculePaie ?? <span className="note-accent">À saisir</span>}
          </Info>
        )}
        <SortieFiche e={e} />
        <ContratFiche e={e} />
        <HistoriqueContrat e={e} />
        <ForfaitJoursFiche e={e} />
        <MineurFiche e={e} />
        <TravailNuitFiche e={e} />
        <MandatsFiche e={e} />
        <ContactUrgenceFiche empId={e.id} />
        <Info label="Manager valideur">{d.mgrName(valideur)}</Info>
        {rh && e.repriseDate && <Info label="Reprise après absence longue">{`${e.repriseMotif ?? 'Motif non renseigné'} · le ${fmtIso(e.repriseDate)}`}</Info>}
      </div>

      {membre && <>
        <SectionLabel>Pour ce collaborateur</SectionLabel>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'calc(-1 * var(--space-2))' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'reqForm', empId: e.id })}>Demander une formation</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'reqHab', empId: e.id })}>Demander une habilitation</button>
          {poseAbsence && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'abs', empId: e.id })}>Poser une absence</button>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'absSignal', empId: e.id })}>Signaler une absence</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('temps', { tsEmp: e.id })}>Feuille de temps →</button>
        </div>
        {!poseAbsence && (
          <Fine>{c.interim ? `Congés gérés par l’agence d’intérim${e.agence ? ' ' + e.agence : ''} : aucune absence à poser dans Cursus.` : 'Aucune absence à poser pour ce contrat.'}</Fine>
        )}
      </>}

      {/* Lecteurs du journal : actions qui concernent ce salarié ; droit « rh » : export de toutes ses données (droit d'accès). */}
      <HistoriqueFiche empId={e.id} />

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {(rh || membre) && <Btn variant="secondary" icon={<PencilSimpleIcon size={14} />} onClick={() => openDialog({ type: 'employe', empId: e.id })}>Modifier la fiche</Btn>}
        {formations && !parti && <Btn variant="secondary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'cert', empId: e.id })}>Ajouter une certification</Btn>}
        <Btn onClick={passeportFormation}>Passeport formation</Btn>
        {retirable && <Btn icon={<UserMinusIcon size={14} />} onClick={retirer}>Retirer de l’équipe</Btn>}
      </div>
    </aside>
  );
}
