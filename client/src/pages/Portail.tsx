// Espace collaborateur : certifications, habilitations, voyages et demandes du salarié connecté. En tête, l'encart « À faire »
// (shared/rules/a-faire.ts) : compte rendu d'entretien à signer, feuille de temps renvoyée ou à soumettre, avec un accès direct.
import { DownloadSimpleIcon, PlusIcon, PrinterIcon } from '@phosphor-icons/react';
import {
  CERT_LABEL, CLS, EMP_LABEL, ENT_TYPES, HAB_CLS, HAB_LABEL, MODE_NOTIFICATION_LABEL, REQ_CLS, REQ_LABEL, SESS_CLS, TRIP_CLS, TRIP_LABEL,
} from '../../../shared/constants.ts';
import { isoWeek, parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt, fmtShort, rel } from '../../../shared/format.ts';
import { sessionDu } from '../../../shared/rules/plage-session.ts';
import { matriculeAffiche } from '../../../shared/rules/matricules.ts';
import { aFaireCollaborateur } from '../../../shared/rules/a-faire.ts';
import { declarationDetail, formaliteCle } from '../../../shared/rules/formalites.ts';
import { etatInscription } from '../../../shared/rules/sessions.ts';
import { auteurDemande, demandeRetirable } from '../../../shared/rules/corrections.ts';
import type { ModeNotification } from '../../../shared/types.ts';
import { retraitDemande } from '../state/confirmations-corrections.ts';
import { EnTetePage } from '../layout/Coque.tsx';
import { Bar, Btn, Chips, Empty, Fine, Kpi, Kpis, NoteAccent, Page, Panel, Seg, Tag } from '../components/ui.tsx';
import { ContactUrgencePanel } from '../components/ContactUrgence.tsx';
import { AgendaPortail } from '../components/AgendaPortail.tsx';
// lot 11 — pwa : installation sur le téléphone, notifications et appareil partagé.
import { InstallerApplication } from '../components/InstallerApplication.tsx';
import { MesAppareils } from '../components/MesAppareils.tsx';
import { AstreintesPortail } from '../components/AstreintesPortail.tsx';
import { Aptitude } from '../components/Aptitude.tsx';
import { ExigencesPortail } from '../components/Exigences.tsx';
import { FormationsSuiviesPortail } from '../components/FormationsSuivies.tsx';
import { ListeAttentePortail } from '../components/ListeAttente.tsx';
import { LignesEvaluationsAFaire, MesAvisFormations } from '../components/Evaluations.tsx';
import { attenteActive, placeTexte } from '../../../shared/rules/liste-attente.ts';
import { imprimerPasseport } from '../passeport.ts';
import { DelegationsPortail, suppleanceTexte } from '../components/Delegations.tsx';
// lot 12 — C4 (organismes de formation et e-learning)
import { MesModules } from '../components/elearning/MesModules.tsx';
import { useEnriched, useRole, useTrips } from '../state/derived.ts';
import { api } from '../api.ts';
import { useStore } from '../state/store.tsx';
// lot 12 — C3 (entretiens suivis)
import { BadgeEntretien } from '../components/OrigineEntretien.tsx';
import { reqKind, reqLabel } from './Dashboard.tsx';
// lot 12 — C6 (badgeage virtuel)
import { BoutonPointer } from '../components/BoutonPointer.tsx';
import { t, tn } from '../i18n/langue.ts';

const docCls = (k: string) => k === 'exp' ? 'tag-accent' : k === 'due' ? 'tag-outline' : 'tag-neutral';
/** Ligne de liste du portail : filet estompé, espacement du prototype. */
const rowStyle = { padding: 'var(--space-3) 0' };

export function Portail() {
  const { emps, upcoming, horizon, d } = useEnriched();
  const trips = useTrips();
  const { me: meId } = useRole();
  const { openDialog, notify, run, go } = useStore();
  const me = emps.find(e => e.id === meId);
  if (!me) return <Page title={t('My space')}><Empty>{t('No employee file is associated with your account.')}</Empty></Page>;

  const tv = d.travelOf(me, horizon);
  const myTrips = trips.filter(x => x.empId === me.id);
  const myReqs = d.ds.demandesCollab.filter(r => r.empId === me.id);
  const okCerts = me.certs.filter(c => c.key !== 'exp').length, dueCerts = me.certs.filter(c => c.key !== 'ok').length;
  // Certifications d'une formation archivée par le service RH : gardées au dossier, lisibles, hors des compteurs.
  const archivees = me.rawCerts.filter(c => c.fm.archive);
  const okHabs = me.habs.filter(h => h.key === 'ok' || h.key === 'due').length;
  const habKinds = [...new Set(me.habs.map(h => HAB_LABEL[h.key].toLowerCase()))].join(' · ');
  const nextTrip = myTrips[0];
  const docChips = [
    ...tv.visas.map(v => ({ key: 'v' + v.dest, label: `${v.type} ${d.destOf(v.dest)?.pays ?? v.dest} · ${v.key === 'exp' ? t('expired#masc-e') : t('until ') + fmtShort(v.exp)}`, cls: docCls(v.key) })),
    ...tv.vaccins.map(x => ({ key: 'x' + x.v, label: `${x.vm.court}${x.exp ? ' · ' + (x.key === 'exp' ? t('booster overdue') : x.exp.getFullYear()) : ''}`, cls: docCls(x.key) })),
  ];
  const reqs = [...myReqs].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  // Formalités déclarées, pas encore validées par le service RH : le dossier ne les compte pas encore.
  const declarees = reqs.filter(r => r.statut === 'attente' && r.declaration && !r.declaration.dejaAuDossier);
  const enAttente = new Set(declarees.map(r => formaliteCle(r.declaration!)));
  const openMyDocs = () => openDialog({ type: 'fo', empId: me.id });
  const contrat = d.contratOf(me);
  // Formations initiales : inscriptions à une session d'une formation jamais suivie (planifiées, session
  // passée en attente de clôture, ou à replanifier par le service RH).
  const planifiees = d.ds.inscriptions.flatMap(i => {
    const x = i.empId === me.id ? etatInscription(d, i) : null;
    return x ? [{ i, x, s: x.s, fm: d.fm(x.s.formation) }] : [];
  }).sort((a, b) => a.s.date.localeCompare(b.s.date));
  const mgrId = d.mgrOf(me);
  // Ce qui attend le collaborateur : les mêmes nombres que les pastilles du menu (layout/Shell.tsx).
  const aFaire = aFaireCollaborateur(d, me.id);
  const nAFaire = aFaire.comptesRendus.length + aFaire.feuilles.length + aFaire.evaluations.length
    // lot 12 — C3 (entretiens suivis) : objectifs à mettre à jour ; avis 360° demandés (étape 3).
    + aFaire.objectifs.length + aFaire.avis360.length;

  return (
    <div className="page">
      {/* En-tête commun (Norma 2.0, layout/Coque.tsx) : poste, équipe et matricule en sous-titre ; actions à droite (la
          principale, « Demander une formation », la plus à droite ; au-delà de trois, menu « Actions »). */}
      <EnTetePage titre={`${t('Hello ')}${me.nom.split(' ')[0]}`} titreAside={<Tag cls={CLS[me.worst]}>{EMP_LABEL[me.worst]}</Tag>}
        sousTitre={`${me.poste} · ${equipeLabel(me)} · ${matriculeAffiche(me)}`} actions={<>
          {/* Passeport formation (t115) : mêmes sections que celui imprimé depuis la fiche, impression tracée au journal. */}
          <Btn icon={<PrinterIcon size={14} />} onClick={() => imprimerPasseport(d, me) || notify(t('Allow pop-up windows to print the training passport'), true)}>{t('Print my training passport')}</Btn>
          <Btn onClick={openMyDocs}>{t('My travel documents')}</Btn>
          <Btn variant="secondary" onClick={() => openDialog({ type: 'reqHab' })}>{t('Request an authorisation')}</Btn>
          <Btn variant="primary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'reqForm' })}>{t('Request a training course')}</Btn>
        </>} />
      <div className="portail-situation">
        <div className="text-muted sub">{me.med.text}</div>
        <div className="text-muted sub">{contrat.libelle} · {mgrId ? `${t('Manager: ')}${d.mgrName(mgrId)}` : `${t('Approvals: ')}${d.mgrName(0)}`}{suppleanceTexte(d, me)}</div>
        {/* « Non conforme » dû aux exigences du poste ou de l'équipe : ce qui manque, et sa demande. */}
        <ExigencesPortail e={me} />
      </div>

      {/* lot 12 — C6 (badgeage virtuel) : bouton « Pointer », pour un salarié d'une population badgée, le module activé. */}
      <BoutonPointer />

      {nAFaire > 0 && (
        <Panel highlight title={t('To do')} aside={tn(nAFaire, 'action expected', 'actions expected')} style={{ gap: 'var(--space-2)' }}>
          <div className="list">
            {aFaire.comptesRendus.map(x => (
              <div key={`e${x.id}`} className="list-row">
                <div className="grow">
                  <div style={{ fontSize: 14 }}>{ENT_TYPES[x.type].nom}{t(' of #date')}{fmt(parse(x.date))}</div>
                  <div className="text-muted sub">{t('Closed report by your evaluator: to reread and sign')}</div>
                </div>
                <Btn small variant="secondary" style={{ flex: 'none' }} onClick={() => openDialog({ type: 'ent', entId: x.id })}>{t('Sign the report')}</Btn>
              </div>
            ))}
            {aFaire.feuilles.map(f => (
              <div key={`f${f.week}`} className="list-row">
                <div className="grow">
                  <div style={{ fontSize: 14 }}>{t('Timesheet of week ')}{isoWeek(f.week)}{t(' · from #date')}{fmtShort(parse(f.week))}</div>
                  <div className="text-muted sub">
                    {f.etat === 'renvoyee' ? `${t('Sent back for correction')}${f.commentaire ? `${t(': ')}${f.commentaire}` : ''}` : t('Past week, not yet submitted')}
                  </div>
                </div>
                <Btn small variant="secondary" style={{ flex: 'none' }} onClick={() => go('temps', { weekStart: f.week })}>
                  {f.etat === 'renvoyee' ? t('Correct the timesheet') : t('Enter the timesheet')}
                </Btn>
              </div>
            ))}
            {/* Évaluations de formation attendues (lot 7, t121) : avis à chaud, efficacité à froid. */}
            <LignesEvaluationsAFaire liste={aFaire.evaluations} />
            {/* lot 12 — C3 (entretiens suivis) : objectifs proches de leur échéance sans mise à jour depuis un mois. */}
            {aFaire.objectifs.map(o => (
              <div key={`o${o.id}`} className="list-row">
                <div className="grow">
                  <div style={{ fontSize: 14 }}>{o.libelle}</div>
                  <div className="text-muted sub">{t('Objective due on ')}{fmt(parse(o.echeance!))}{t(', without update for a month: where are you?')}</div>
                </div>
                <Btn small variant="secondary" style={{ flex: 'none' }} onClick={() => openDialog({ type: 'objectifAvancer', id: o.id })}>{t('Update')}</Btn>
              </div>
            ))}
            {/* lot 12 — C3 (feedback 360°, étape 3) : avis demandés, à donner ou décliner dans « Avis demandés ». */}
            {aFaire.avis360.length > 0 && (
              <div className="list-row">
                <div className="grow">
                  <div style={{ fontSize: 14 }}>{tn(aFaire.avis360.length, 'confidential opinion is requested from you', 'confidential opinions are requested from you')}{t(' (360° feedback)')}</div>
                  <div className="text-muted sub">{t('To give or decline before ')}{fmt(parse(aFaire.avis360[0].echeance ?? d.ti))}</div>
                </div>
                <Btn small variant="secondary" style={{ flex: 'none' }} onClick={() => go('avis')}>{t('See the requested opinions')}</Btn>
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* Délégation des validations (t135) : celles du manager connecté, et celles qu'il reçoit comme suppléant. */}
      <DelegationsPortail />

      <Kpis>
        <Kpi kicker={t('My valid certifications')} value={`${okCerts} / ${me.certs.length}`}
          sub={dueCerts ? tn(dueCerts, 'certification to renew', 'certifications to renew') : t('all up to date')} />
        <Kpi kicker={t('My authorisations')} value={`${okHabs} / ${me.habs.length}`} sub={me.habs.length ? habKinds : t('no authorisation')} />
        <Kpi kicker={t('Next trip')} value={nextTrip ? nextTrip.r.dest.pays : '—'}
          sub={nextTrip ? `${t('departure on ')}${fmt(nextTrip.r.dep)} · ${TRIP_LABEL[nextTrip.r.status].toLowerCase()}` : t('no trip planned')} />
      </Kpis>

      <div className="row-wrap">
        <div className="col-stack" style={{ flex: '1 1 480px' }}>
          {planifiees.length > 0 && (
            <Panel title={t('Planned training courses')} aside={t('initial training')} style={{ gap: 'var(--space-2)' }}>
              {planifiees.map(({ i, x, s, fm }) => (
                <div key={i.id} className="list-row stack" style={{ ...rowStyle, gap: 'var(--space-1)' }}>
                  <div className="item-head">
                    <div>
                      <div style={{ fontSize: 14 }}>{fm.nom}</div>
                      <div className="text-muted sub">{x.etat === 'a_planifier' ? x.motif : `${t('Session ')}${sessionDu(s)} · ${s.lieu} · ${fm.organisme}`}</div>
                    </div>
                    {x.etat === 'planifiee'
                      ? <Tag cls={SESS_CLS[s.statut]} style={{ flex: 'none' }}>{s.statut}</Tag>
                      : <Tag cls="tag-outline" style={{ flex: 'none' }}>{x.etat === 'passee' ? t('Past session') : t('To replan')}</Tag>}
                  </div>
                  <div className="sub text-n400">
                    {x.etat === 'passee' ? t('Presence and result being recorded by HR')
                      : x.etat === 'a_planifier' ? t('HR will enrol you in a next session')
                      : i.convoc === 'now' ? `${t('Invitation sent on ')}${fmtShort(parse(i.convocLe ?? i.date))}` : t('Invitation to come')}
                  </div>
                </div>
              ))}
            </Panel>
          )}

          {/* Listes d'attente des sessions complètes (lot 7, t120) : sa place dans la file, son retrait. */}
          <ListeAttentePortail empId={me.id} />

          {/* lot 12 — C4 : modules d'e-learning, lien d'accès et « J'ai terminé ». */}
          <MesModules empId={me.id} />

          <Panel title={t('My certifications')} style={{ gap: 'var(--space-2)' }}>
            {me.certs.map(c => {
              const avail = upcoming.find(s => s.formation === c.f && s.inscrits < s.places);
              const pend = myReqs.some(r => r.type === 'formation' && r.f === c.f && r.statut === 'attente');
              // En liste d'attente d'une session complète de cette formation (lot 7, t120) : rien à redemander.
              const enFile = (d.ds.attentesSession ?? []).find(a => a.empId === me.id && attenteActive(a) && d.session(a.sessionId)?.formation === c.f);
              const fileSession = enFile ? d.session(enFile.sessionId) : null;
              const convocation = c.convoc === 'now' ? `${t(' · invitation sent')}${c.convocLe ? `${t(' on #le')}${fmtShort(parse(c.convocLe))}` : ''}` : t(' · invitation to come');
              const info = c.session ? `${t('Enrolled in the session ')}${sessionDu(c.session)}${convocation}`
                : c.sessionPassee ? `${t('Session ')}${sessionDu(c.sessionPassee)}${t(' past — presence and result being recorded by HR')}`
                : pend ? t('Refresher request sent to HR')
                : fileSession ? `${t('Session ')}${sessionDu(fileSession)}${t(' full: ')}${placeTexte(enFile!.position)}` : '';
              return (
                <div key={c.id} className="list-row stack" style={rowStyle}>
                  <div className="item-head">
                    <div><div style={{ fontSize: 14 }}>{c.fm.nom}</div><div className="text-muted sub">{t('Obtained on ')}{fmt(c.obt)}{t(' · expires on ')}{fmt(c.exp)}</div></div>
                    <Tag cls={CLS[c.key]} style={{ flex: 'none' }}>{CERT_LABEL[c.key]}</Tag>
                  </div>
                  <Bar variant="thin" pct={c.pct} color={c.key === 'ok' ? 'var(--color-accent-600)' : 'var(--color-accent-300)'} />
                  {info && <NoteAccent>{info}</NoteAccent>}
                  {c.key !== 'ok' && !c.session && !c.sessionPassee && !pend && !enFile && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Btn small onClick={() => openDialog({ type: 'reqForm', f: c.f, sessionId: avail?.id ?? null })}>{t('Request the refresher')}</Btn>
                    </div>
                  )}
                </div>
              );
            })}
            {archivees.map(c => (
              <div key={c.id} className="list-row stack" style={rowStyle}>
                <div className="item-head">
                  <div><div style={{ fontSize: 14 }}>{c.fm.nom}</div><div className="text-muted sub">{t('Obtained on ')}{fmt(c.obt)}{t(' · training course removed from the catalogue, no longer followed')}</div></div>
                  <Tag cls="tag-outline" style={{ flex: 'none' }}>{t('Archived training course')}</Tag>
                </div>
              </div>
            ))}
            {me.certs.length === 0 && archivees.length === 0 && <Empty>{t('No certification recorded.')}</Empty>}
          </Panel>

          <Panel title={t('My authorisations')} style={{ gap: 'var(--space-2)' }}>
            {me.habs.map(h => (
              <div key={h.hm.id} className="list-row stack" style={{ ...rowStyle, gap: 'var(--space-2)' }}>
                <div className="item-head">
                  <div>
                    <div style={{ fontSize: 14 }}>{h.hm.nom}</div>
                    <div className="text-muted sub">
                      {h.delivree
                        ? `${t('Issued on #fem')}${fmt(parse(h.delivree))}${t(' · expires on ')}${fmt(h.exp!)}`
                        : `${h.demande ? `${t('Requested on #fem')}${fmt(parse(h.demande))}` : t('Requested#fem')}${t(' · awaiting issue')}`}
                    </div>
                  </div>
                  <Tag cls={HAB_CLS[h.key]} style={{ flex: 'none' }}>{HAB_LABEL[h.key]}</Tag>
                </div>
                {h.note && <NoteAccent>{h.note}</NoteAccent>}
              </div>
            ))}
            {me.habs.length === 0 && <Empty>{t('No authorisation. Your job requires one? Make a request.')}</Empty>}
          </Panel>

          <FormationsSuiviesPortail empId={me.id} />
          {/* Avis donnés sur les formations (lot 7, t121), modifiables tant que l'évaluation est ouverte. */}
          <MesAvisFormations empId={me.id} />

          {/* Avis du médecin du travail, restrictions de poste et visite demandée par le service RH. */}
          <Panel title={t('My medical fitness')} style={{ gap: 'var(--space-2)' }}>
            <Aptitude e={me} d={d} horizon={horizon} />
            <Fine>{me.med.demande ? t('The occupational health service will invite you. ') : ''}{t('Only the date of the visit, the opinion and the job restrictions are recorded; your manager only sees the opinion and the restrictions in force, never the date of the visit.')}</Fine>
          </Panel>
        </div>

        <div className="col-stack" style={{ flex: '1 1 380px' }}>
          <Panel title={t('My trips')} aside={<Btn small onClick={openMyDocs}>{t('Fill in')}</Btn>}>
            <div style={{ fontSize: 14 }}>
              {tv.pass ? `${t('Passport valid until ')}${fmt(tv.pass.exp)}${tv.pass.key !== 'ok' ? ' · ' + (tv.pass.key === 'exp' ? t('expired#masc-e') : t('expires ') + rel(tv.pass.d)) : ''}` : t('Passport not filled in')}
            </div>
            {docChips.length > 0 && <Chips items={docChips} />}
            {declarees.map(r => (
              <NoteAccent key={r.id}>{r.label} · {declarationDetail(r.declaration!)}{t(' — awaiting HR approval')}</NoteAccent>
            ))}
            {myTrips.map(tr => {
              const items = tr.r.items.filter(i => !i.ok);
              return (
                <div key={tr.id} className="boxed-lg" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-3)' }}>
                  <div className="item-head">
                    <div><div style={{ fontSize: 14 }}>{tr.r.dest.pays} — {tr.motif}</div><div className="text-muted sub">{fmtShort(tr.r.dep)} → {fmt(tr.r.ret)}{t(' · departure ')}{rel(tr.r.toGo)}</div></div>
                    <Tag cls={TRIP_CLS[tr.r.status]} style={{ flex: 'none' }}>{TRIP_LABEL[tr.r.status]}</Tag>
                  </div>
                  {items.map(i => (
                    <div key={i.k + i.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <div style={{ minWidth: 0 }}><div style={{ fontSize: 13 }}>{i.label}</div><div className="text-muted sub">{i.text}</div></div>
                      {i.fix && (enAttente.has(formaliteCle(i.fix))
                        ? <span className="sub text-n400" style={{ flex: 'none' }}>{t('Awaiting HR approval')}</span>
                        : <Btn small style={{ flex: 'none' }} onClick={() => openDialog({ type: 'fo', empId: me.id, kind: i.fix!.kind, dest: i.fix!.dest, v: i.fix!.v })}>{t('Fill in')}</Btn>
                      )}
                    </div>
                  ))}
                  {items.length === 0 && <NoteAccent>{t('Complete file — nothing to provide.')}</NoteAccent>}
                </div>
              );
            })}
            {myTrips.length === 0 && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{t('No trip planned.')}</p>}
            <Fine>{t('Your vaccinations (vaccine and injection date) are health data: only HR has access to them, never your manager. The information on their processing is shown before each declaration.')}</Fine>
          </Panel>

          <Panel title={t('My requests')} style={{ gap: 'var(--space-2)' }}>
            {reqs.map(r => (
              <div key={r.id} className="list-row stack" style={{ ...rowStyle, gap: 'var(--space-1)' }}>
                <div className="item-head">
                  <div>
                    {/* lot 12 — C3 (entretiens suivis) : souhait exprimé en entretien, versé au service RH. */}
                    <div style={{ fontSize: 14 }}>{reqLabel(r, id => d.fm(id).nom, id => d.hm(id).nom)}<BadgeEntretien d={d} r={r} /></div>
                    <div className="text-muted sub">{reqKind(r)} · {r.parId && r.parId !== me.id ? `${t('requested by ')}${d.personName(r.parId)}${t(' (manager) on')}` : t('sent on')} {fmtShort(parse(r.date))}</div>
                  </div>
                  <Tag cls={REQ_CLS[r.statut]} style={{ flex: 'none' }}>{REQ_LABEL[r.statut]}</Tag>
                </div>
                {r.declaration && <div className="sub">{t('Declared: ')}{declarationDetail(r.declaration)}</div>}
                <div className="sub text-n400">{r.reponse || (r.type === 'document' ? t('Awaiting HR approval') : t('Being processed by HR'))}</div>
                {/* Liste d'attente (lot 7, t120) : la place d'aujourd'hui, la réponse donnant celle du jour de la décision. */}
                {(() => {
                  const a = r.suite?.attenteId ? (d.ds.attentesSession ?? []).find(x => x.id === r.suite!.attenteId && attenteActive(x)) : undefined;
                  return a ? <div className="sub">{t('Today: ')}{a.statut === 'proposee' ? t('place freed, enrolment to confirm by HR') : placeTexte(a.position)}</div> : null;
                })()}
                {r.statut === 'refusee' && r.motifRefus && <div className="sub">{t('Reason for the refusal: ')}{r.motifRefus}</div>}
                {/* Demande en attente, faite par soi-même : retirée tant que le service RH ne l'a pas traitée. */}
                {demandeRetirable(r) && auteurDemande(r) === me.id && (
                  <div className="actions-end">
                    <Btn small onClick={() => openDialog({ type: 'confirmer', c: retraitDemande(r, reqLabel(r, id => d.fm(id).nom, id => d.hm(id).nom)) })}>{t('Withdraw the request')}</Btn>
                  </div>
                )}
              </div>
            ))}
            {reqs.length === 0 && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{t('No request sent.')}</p>}
          </Panel>

          <Panel title={t('My personal data')}>
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              {t('Copy of all the data Cursus keeps about you (sheet, training, authorisations, trips, time, absences, reviews, requests, account) in a readable file, which you can keep or pass on.')}
            </p>
            <div>
              <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={() => api.mesDonnees().catch(err => notify((err as Error).message, true))}>{t('Download my data')}</Btn>
            </div>
            <Fine>{t('The log of the actions concerning you is given to you on request by HR.')}</Fine>
          </Panel>

          {/* Astreintes (lot 7, t049) : prochaines astreintes et récapitulatif mensuel imprimable (art. R3121-2). */}
          <AstreintesPortail e={me} />

          <ContactUrgencePanel empId={me.id} />
          <AgendaPortail />
          <InstallerApplication />
          <MesAppareils />

          <Panel title={t('My e-mail notifications')} style={{ gap: 'var(--space-3)' }}>
            <div style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{me.email ?? t('No e-mail address on your sheet')}</div>
            <Seg name="notif-mode" label={t('E-mail notifications')} value={me.notifications} disabled={!me.email} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
              options={Object.entries(MODE_NOTIFICATION_LABEL) as [ModeNotification, string][]} onChange={mode => run('notification.regler', { mode })} />
            <Fine>
              {me.email
                ? t('Requests to approve, decisions, timesheets sent back, review reports to sign: each notification goes at once, or all together in a summary each morning. The invitations (training, reviews) always go at once, with their file for the calendar.')
                : t('Ask HR to enter your professional e-mail address on your sheet: notifications and invitations will reach you there.')}
            </Fine>
          </Panel>
        </div>
      </div>
    </div>
  );
}
