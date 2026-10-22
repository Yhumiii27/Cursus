// Espace collaborateur : certifications, habilitations, voyages et demandes du salarié connecté. En tête, l'encart « À faire »
// (shared/rules/a-faire.ts) : compte rendu d'entretien à signer, feuille de temps renvoyée ou à soumettre, avec un accès direct.
import { DownloadSimpleIcon, PlusIcon, PrinterIcon } from '@phosphor-icons/react';
import {
  CERT_LABEL, CLS, EMP_LABEL, ENT_TYPES, HAB_CLS, HAB_LABEL, MODE_NOTIFICATION_LABEL, REQ_CLS, REQ_LABEL, SESS_CLS, TRIP_CLS, TRIP_LABEL,
} from '../../../shared/constants.ts';
import { isoWeek, parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt, fmtShort, plural, rel } from '../../../shared/format.ts';
import { sessionDu } from '../../../shared/rules/plage-session.ts';
import { matriculeAffiche } from '../../../shared/rules/matricules.ts';
import { aFaireCollaborateur } from '../../../shared/rules/a-faire.ts';
import { declarationDetail, formaliteCle } from '../../../shared/rules/formalites.ts';
import { etatInscription } from '../../../shared/rules/sessions.ts';
import { auteurDemande, demandeRetirable } from '../../../shared/rules/corrections.ts';
import type { ModeNotification } from '../../../shared/types.ts';
import { retraitDemande } from '../state/confirmations-corrections.ts';
import { Bar, Btn, Chips, Empty, Fine, Kpi, Kpis, NoteAccent, Page, Panel, Seg, Tag } from '../components/ui.tsx';
import { ContactUrgencePanel } from '../components/ContactUrgence.tsx';
import { Aptitude } from '../components/Aptitude.tsx';
import { ExigencesPortail } from '../components/Exigences.tsx';
import { FormationsSuiviesPortail } from '../components/FormationsSuivies.tsx';
import { imprimerPasseport } from '../passeport.ts';
import { DelegationsPortail, suppleanceTexte } from '../components/Delegations.tsx';
import { useEnriched, useRole, useTrips } from '../state/derived.ts';
import { api } from '../api.ts';
import { useStore } from '../state/store.tsx';
import { reqKind, reqLabel } from './Dashboard.tsx';

const docCls = (k: string) => k === 'exp' ? 'tag-accent' : k === 'due' ? 'tag-outline' : 'tag-neutral';
/** Ligne de liste du portail : filet estompé, espacement du prototype. */
const rowStyle = { padding: 'var(--space-3) 0' };

export function Portail() {
  const { emps, upcoming, horizon, d } = useEnriched();
  const trips = useTrips();
  const { me: meId } = useRole();
  const { openDialog, notify, run, go } = useStore();
  const me = emps.find(e => e.id === meId);
  if (!me) return <Page title="Mon espace"><Empty>Aucun dossier collaborateur n’est associé à votre compte.</Empty></Page>;

  const tv = d.travelOf(me, horizon);
  const myTrips = trips.filter(t => t.empId === me.id);
  const myReqs = d.ds.demandesCollab.filter(r => r.empId === me.id);
  const okCerts = me.certs.filter(c => c.key !== 'exp').length, dueCerts = me.certs.filter(c => c.key !== 'ok').length;
  // Certifications d'une formation archivée par le service RH : gardées au dossier, lisibles, hors des compteurs.
  const archivees = me.rawCerts.filter(c => c.fm.archive);
  const okHabs = me.habs.filter(h => h.key === 'ok' || h.key === 'due').length;
  const habKinds = [...new Set(me.habs.map(h => HAB_LABEL[h.key].toLowerCase()))].join(' · ');
  const nextTrip = myTrips[0];
  const docChips = [
    ...tv.visas.map(v => ({ key: 'v' + v.dest, label: `${v.type} ${d.destOf(v.dest)?.pays ?? v.dest} · ${v.key === 'exp' ? 'expiré' : 'jusqu’au ' + fmtShort(v.exp)}`, cls: docCls(v.key) })),
    ...tv.vaccins.map(x => ({ key: 'x' + x.v, label: `${x.vm.court}${x.exp ? ' · ' + (x.key === 'exp' ? 'rappel dépassé' : x.exp.getFullYear()) : ''}`, cls: docCls(x.key) })),
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
  const nAFaire = aFaire.comptesRendus.length + aFaire.feuilles.length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="kicker">{me.poste} · {equipeLabel(me)} · {matriculeAffiche(me)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <h1 tabIndex={-1}>Bonjour {me.nom.split(' ')[0]}</h1>
            <Tag cls={CLS[me.worst]}>{EMP_LABEL[me.worst]}</Tag>
          </div>
          <div className="text-muted sub" style={{ marginTop: 'var(--space-1)' }}>{me.med.text}</div>
          <div className="text-muted sub">{contrat.libelle} · {mgrId ? `Manager : ${d.mgrName(mgrId)}` : `Validations : ${d.mgrName(0)}`}{suppleanceTexte(d, me)}</div>
          {/* « Non conforme » dû aux exigences du poste ou de l'équipe : ce qui manque, et sa demande. */}
          <ExigencesPortail e={me} />
        </div>
        <div className="head-actions">
          {/* Passeport formation (t115) : mêmes sections que celui imprimé depuis la fiche, impression tracée au journal. */}
          <Btn icon={<PrinterIcon size={14} />} onClick={() => imprimerPasseport(d, me) || notify('Autorisez les fenêtres surgissantes pour imprimer le passeport formation', true)}>Imprimer mon passeport formation</Btn>
          <Btn onClick={openMyDocs}>Mes documents de voyage</Btn>
          <Btn variant="secondary" onClick={() => openDialog({ type: 'reqHab' })}>Demander une habilitation</Btn>
          <Btn variant="primary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'reqForm' })}>Demander une formation</Btn>
        </div>
      </header>

      {nAFaire > 0 && (
        <Panel highlight title="À faire" aside={plural(nAFaire, 'action attendue', 'actions attendues')} style={{ gap: 'var(--space-2)' }}>
          <div className="list">
            {aFaire.comptesRendus.map(x => (
              <div key={`e${x.id}`} className="list-row">
                <div className="grow">
                  <div style={{ fontSize: 14 }}>{ENT_TYPES[x.type].nom} du {fmt(parse(x.date))}</div>
                  <div className="text-muted sub">Compte rendu clos par votre évaluateur : à relire et à signer</div>
                </div>
                <Btn small variant="secondary" style={{ flex: 'none' }} onClick={() => openDialog({ type: 'ent', entId: x.id })}>Signer le compte rendu</Btn>
              </div>
            ))}
            {aFaire.feuilles.map(f => (
              <div key={`f${f.week}`} className="list-row">
                <div className="grow">
                  <div style={{ fontSize: 14 }}>Feuille de temps de la semaine {isoWeek(f.week)} · du {fmtShort(parse(f.week))}</div>
                  <div className="text-muted sub">
                    {f.etat === 'renvoyee' ? `Renvoyée pour correction${f.commentaire ? ` : ${f.commentaire}` : ''}` : 'Semaine passée, pas encore soumise'}
                  </div>
                </div>
                <Btn small variant="secondary" style={{ flex: 'none' }} onClick={() => go('temps', { weekStart: f.week })}>
                  {f.etat === 'renvoyee' ? 'Corriger la feuille' : 'Saisir la feuille'}
                </Btn>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Délégation des validations (t135) : celles du manager connecté, et celles qu'il reçoit comme suppléant. */}
      <DelegationsPortail />

      <Kpis>
        <Kpi kicker="Mes certifications valides" value={`${okCerts} / ${me.certs.length}`}
          sub={dueCerts ? plural(dueCerts, 'certification à renouveler', 'certifications à renouveler') : 'toutes à jour'} />
        <Kpi kicker="Mes habilitations" value={`${okHabs} / ${me.habs.length}`} sub={me.habs.length ? habKinds : 'aucune habilitation'} />
        <Kpi kicker="Prochain déplacement" value={nextTrip ? nextTrip.r.dest.pays : '—'}
          sub={nextTrip ? `départ le ${fmt(nextTrip.r.dep)} · ${TRIP_LABEL[nextTrip.r.status].toLowerCase()}` : 'aucun déplacement prévu'} />
      </Kpis>

      <div className="row-wrap">
        <div className="col-stack" style={{ flex: '1 1 480px' }}>
          {planifiees.length > 0 && (
            <Panel title="Formations planifiées" aside="formation initiale" style={{ gap: 'var(--space-2)' }}>
              {planifiees.map(({ i, x, s, fm }) => (
                <div key={i.id} className="list-row stack" style={{ ...rowStyle, gap: 'var(--space-1)' }}>
                  <div className="item-head">
                    <div>
                      <div style={{ fontSize: 14 }}>{fm.nom}</div>
                      <div className="text-muted sub">{x.etat === 'a_planifier' ? x.motif : `Session ${sessionDu(s)} · ${s.lieu} · ${fm.organisme}`}</div>
                    </div>
                    {x.etat === 'planifiee'
                      ? <Tag cls={SESS_CLS[s.statut]} style={{ flex: 'none' }}>{s.statut}</Tag>
                      : <Tag cls="tag-outline" style={{ flex: 'none' }}>{x.etat === 'passee' ? 'Session passée' : 'À replanifier'}</Tag>}
                  </div>
                  <div className="sub text-n400">
                    {x.etat === 'passee' ? 'Présence et résultat en cours d’enregistrement par le service RH'
                      : x.etat === 'a_planifier' ? 'Le service RH vous inscrira à une prochaine session'
                      : i.convoc === 'now' ? `Convocation envoyée le ${fmtShort(parse(i.convocLe ?? i.date))}` : 'Convocation à venir'}
                  </div>
                </div>
              ))}
            </Panel>
          )}

          <Panel title="Mes certifications" style={{ gap: 'var(--space-2)' }}>
            {me.certs.map(c => {
              const avail = upcoming.find(s => s.formation === c.f && s.inscrits < s.places);
              const pend = myReqs.some(r => r.type === 'formation' && r.f === c.f && r.statut === 'attente');
              const convocation = c.convoc === 'now' ? ` · convocation envoyée${c.convocLe ? ` le ${fmtShort(parse(c.convocLe))}` : ''}` : ' · convocation à venir';
              const info = c.session ? `Inscrit à la session ${sessionDu(c.session)}${convocation}`
                : c.sessionPassee ? `Session ${sessionDu(c.sessionPassee)} passée — présence et résultat en cours d’enregistrement par le service RH`
                : pend ? 'Demande de recyclage envoyée au service RH' : '';
              return (
                <div key={c.id} className="list-row stack" style={rowStyle}>
                  <div className="item-head">
                    <div><div style={{ fontSize: 14 }}>{c.fm.nom}</div><div className="text-muted sub">Obtenue le {fmt(c.obt)} · expire le {fmt(c.exp)}</div></div>
                    <Tag cls={CLS[c.key]} style={{ flex: 'none' }}>{CERT_LABEL[c.key]}</Tag>
                  </div>
                  <Bar variant="thin" pct={c.pct} color={c.key === 'ok' ? 'var(--color-accent-600)' : 'var(--color-accent-300)'} />
                  {info && <NoteAccent>{info}</NoteAccent>}
                  {c.key !== 'ok' && !c.session && !c.sessionPassee && !pend && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Btn small onClick={() => openDialog({ type: 'reqForm', f: c.f, sessionId: avail?.id ?? null })}>Demander le recyclage</Btn>
                    </div>
                  )}
                </div>
              );
            })}
            {archivees.map(c => (
              <div key={c.id} className="list-row stack" style={rowStyle}>
                <div className="item-head">
                  <div><div style={{ fontSize: 14 }}>{c.fm.nom}</div><div className="text-muted sub">Obtenue le {fmt(c.obt)} · formation retirée du catalogue, plus suivie</div></div>
                  <Tag cls="tag-outline" style={{ flex: 'none' }}>Formation archivée</Tag>
                </div>
              </div>
            ))}
            {me.certs.length === 0 && archivees.length === 0 && <Empty>Aucune certification enregistrée.</Empty>}
          </Panel>

          <Panel title="Mes habilitations" style={{ gap: 'var(--space-2)' }}>
            {me.habs.map(h => (
              <div key={h.hm.id} className="list-row stack" style={{ ...rowStyle, gap: 'var(--space-2)' }}>
                <div className="item-head">
                  <div>
                    <div style={{ fontSize: 14 }}>{h.hm.nom}</div>
                    <div className="text-muted sub">
                      {h.delivree
                        ? `Délivrée le ${fmt(parse(h.delivree))} · expire le ${fmt(h.exp!)}`
                        : `${h.demande ? `Demandée le ${fmt(parse(h.demande))}` : 'Demandée'} · en attente de délivrance`}
                    </div>
                  </div>
                  <Tag cls={HAB_CLS[h.key]} style={{ flex: 'none' }}>{HAB_LABEL[h.key]}</Tag>
                </div>
                {h.note && <NoteAccent>{h.note}</NoteAccent>}
              </div>
            ))}
            {me.habs.length === 0 && <Empty>Aucune habilitation. Votre poste en nécessite une ? Faites une demande.</Empty>}
          </Panel>

          <FormationsSuiviesPortail empId={me.id} />

          {/* Avis du médecin du travail, restrictions de poste et visite demandée par le service RH. */}
          <Panel title="Mon aptitude médicale" style={{ gap: 'var(--space-2)' }}>
            <Aptitude e={me} d={d} horizon={horizon} />
            <Fine>{me.med.demande ? 'Le service de santé au travail vous convoquera. ' : ''}Seuls la date de la visite, l’avis et les restrictions de poste sont enregistrés ; votre manager ne voit que l’avis et les restrictions en vigueur, jamais la date de la visite.</Fine>
          </Panel>
        </div>

        <div className="col-stack" style={{ flex: '1 1 380px' }}>
          <Panel title="Mes voyages" aside={<Btn small onClick={openMyDocs}>Renseigner</Btn>}>
            <div style={{ fontSize: 14 }}>
              {tv.pass ? `Passeport valide jusqu’au ${fmt(tv.pass.exp)}${tv.pass.key !== 'ok' ? ' · ' + (tv.pass.key === 'exp' ? 'expiré' : 'expire ' + rel(tv.pass.d)) : ''}` : 'Passeport non renseigné'}
            </div>
            {docChips.length > 0 && <Chips items={docChips} />}
            {declarees.map(r => (
              <NoteAccent key={r.id}>{r.label} · {declarationDetail(r.declaration!)} — en attente de validation RH</NoteAccent>
            ))}
            {myTrips.map(t => {
              const items = t.r.items.filter(i => !i.ok);
              return (
                <div key={t.id} className="boxed-lg" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-3)' }}>
                  <div className="item-head">
                    <div><div style={{ fontSize: 14 }}>{t.r.dest.pays} — {t.motif}</div><div className="text-muted sub">{fmtShort(t.r.dep)} → {fmt(t.r.ret)} · départ {rel(t.r.toGo)}</div></div>
                    <Tag cls={TRIP_CLS[t.r.status]} style={{ flex: 'none' }}>{TRIP_LABEL[t.r.status]}</Tag>
                  </div>
                  {items.map(i => (
                    <div key={i.k + i.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <div style={{ minWidth: 0 }}><div style={{ fontSize: 13 }}>{i.label}</div><div className="text-muted sub">{i.text}</div></div>
                      {i.fix && (enAttente.has(formaliteCle(i.fix))
                        ? <span className="sub text-n400" style={{ flex: 'none' }}>En attente de validation RH</span>
                        : <Btn small style={{ flex: 'none' }} onClick={() => openDialog({ type: 'fo', empId: me.id, kind: i.fix!.kind, dest: i.fix!.dest, v: i.fix!.v })}>Renseigner</Btn>
                      )}
                    </div>
                  ))}
                  {items.length === 0 && <NoteAccent>Dossier complet — rien à fournir.</NoteAccent>}
                </div>
              );
            })}
            {myTrips.length === 0 && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Aucun déplacement prévu.</p>}
            <Fine>Vos vaccinations (vaccin et date d’injection) sont des données de santé : seul le service RH y a accès, jamais votre manager. L’information sur leur traitement s’affiche avant chaque déclaration.</Fine>
          </Panel>

          <Panel title="Mes demandes" style={{ gap: 'var(--space-2)' }}>
            {reqs.map(r => (
              <div key={r.id} className="list-row stack" style={{ ...rowStyle, gap: 'var(--space-1)' }}>
                <div className="item-head">
                  <div>
                    <div style={{ fontSize: 14 }}>{reqLabel(r, id => d.fm(id).nom, id => d.hm(id).nom)}</div>
                    <div className="text-muted sub">{reqKind(r)} · {r.parId && r.parId !== me.id ? `demandée par ${d.personName(r.parId)} (manager) le` : 'envoyée le'} {fmtShort(parse(r.date))}</div>
                  </div>
                  <Tag cls={REQ_CLS[r.statut]} style={{ flex: 'none' }}>{REQ_LABEL[r.statut]}</Tag>
                </div>
                {r.declaration && <div className="sub">Déclaré : {declarationDetail(r.declaration)}</div>}
                <div className="sub text-n400">{r.reponse || (r.type === 'document' ? 'En attente de validation RH' : 'En cours de traitement par le service RH')}</div>
                {r.statut === 'refusee' && r.motifRefus && <div className="sub">Motif du refus : {r.motifRefus}</div>}
                {/* Demande en attente, faite par soi-même : retirée tant que le service RH ne l'a pas traitée. */}
                {demandeRetirable(r) && auteurDemande(r) === me.id && (
                  <div className="actions-end">
                    <Btn small onClick={() => openDialog({ type: 'confirmer', c: retraitDemande(r, reqLabel(r, id => d.fm(id).nom, id => d.hm(id).nom)) })}>Retirer la demande</Btn>
                  </div>
                )}
              </div>
            ))}
            {reqs.length === 0 && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Aucune demande envoyée.</p>}
          </Panel>

          <Panel title="Mes données personnelles">
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              Copie de toutes les données que Cursus conserve sur vous (fiche, formations, habilitations, voyages, temps, absences, entretiens, demandes, compte) dans un fichier lisible, que vous pouvez conserver ou transmettre.
            </p>
            <div>
              <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={() => api.mesDonnees().catch(err => notify((err as Error).message, true))}>Télécharger mes données</Btn>
            </div>
            <Fine>Le journal des actions qui vous concernent vous est remis sur demande par le service RH.</Fine>
          </Panel>

          <ContactUrgencePanel empId={me.id} />

          <Panel title="Mes notifications par e-mail" style={{ gap: 'var(--space-3)' }}>
            <div style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{me.email ?? 'Aucune adresse e-mail sur votre fiche'}</div>
            <Seg name="notif-mode" label="Notifications par e-mail" value={me.notifications} disabled={!me.email} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
              options={Object.entries(MODE_NOTIFICATION_LABEL) as [ModeNotification, string][]} onChange={mode => run('notification.regler', { mode })} />
            <Fine>
              {me.email
                ? 'Demandes à valider, décisions, feuilles de temps renvoyées, comptes rendus d’entretien à signer : chaque notification part aussitôt, ou toutes ensemble dans un récapitulatif chaque matin. Les convocations (formations, entretiens) partent toujours aussitôt, avec leur fichier pour l’agenda.'
                : 'Demandez au service RH d’inscrire votre adresse e-mail professionnelle sur votre fiche : notifications et convocations vous y parviendront.'}
            </Fine>
          </Panel>
        </div>
      </div>
    </div>
  );
}
