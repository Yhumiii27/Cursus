// Espace collaborateur : certifications, habilitations, voyages et demandes du salarié connecté.
import { PlusIcon } from '@phosphor-icons/react';
import { CERT_LABEL, CLS, EMP_LABEL, HAB_CLS, HAB_LABEL, REQ_CLS, REQ_LABEL, SESS_CLS, TRIP_CLS, TRIP_LABEL } from '../../../shared/constants.ts';
import { parse } from '../../../shared/dates.ts';
import { equipeLabel, fmt, fmtShort, matricule, plural, rel } from '../../../shared/format.ts';
import { declarationDetail, formaliteCle } from '../../../shared/rules/formalites.ts';
import { etatInscription } from '../../../shared/rules/sessions.ts';
import { Bar, Btn, Chips, Empty, Fine, Kpi, Kpis, NoteAccent, Page, Panel, Tag } from '../components/ui.tsx';
import { Aptitude } from '../components/Aptitude.tsx';
import { useEnriched, useRole, useTrips } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { reqKind, reqLabel } from './Dashboard.tsx';

const docCls = (k: string) => k === 'exp' ? 'tag-accent' : k === 'due' ? 'tag-outline' : 'tag-neutral';
/** Ligne de liste du portail : filet estompé, espacement du prototype. */
const rowStyle = { padding: 'var(--space-3) 0' };

export function Portail() {
  const { emps, upcoming, horizon, d } = useEnriched();
  const trips = useTrips();
  const { me: meId } = useRole();
  const { openDialog } = useStore();
  const me = emps.find(e => e.id === meId);
  if (!me) return <Page title="Mon espace"><Empty>Aucun dossier collaborateur n’est associé à votre compte.</Empty></Page>;

  const tv = d.travelOf(me, horizon);
  const myTrips = trips.filter(t => t.empId === me.id);
  const myReqs = d.ds.demandesCollab.filter(r => r.empId === me.id);
  const okCerts = me.certs.filter(c => c.key !== 'exp').length, dueCerts = me.certs.filter(c => c.key !== 'ok').length;
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

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="kicker">{me.poste} · {equipeLabel(me)} · {matricule(me.id)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <h1>Bonjour {me.nom.split(' ')[0]}</h1>
            <Tag cls={CLS[me.worst]}>{EMP_LABEL[me.worst]}</Tag>
          </div>
          <div className="text-muted sub" style={{ marginTop: 'var(--space-1)' }}>{me.med.text}</div>
          <div className="text-muted sub">{contrat.libelle} · {mgrId ? `Manager : ${d.mgrName(mgrId)}` : `Validations : ${d.mgrName(0)}`}</div>
        </div>
        <div className="head-actions">
          <Btn onClick={openMyDocs}>Mes documents de voyage</Btn>
          <Btn variant="secondary" onClick={() => openDialog({ type: 'reqHab' })}>Demander une habilitation</Btn>
          <Btn variant="primary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'reqForm' })}>Demander une formation</Btn>
        </div>
      </header>

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
                      <div className="text-muted sub">{x.etat === 'a_planifier' ? x.motif : `Session du ${fmt(parse(s.date))} · ${s.lieu} · ${fm.organisme}`}</div>
                    </div>
                    {x.etat === 'planifiee'
                      ? <Tag cls={SESS_CLS[s.statut]} style={{ flex: 'none' }}>{s.statut}</Tag>
                      : <Tag cls="tag-outline" style={{ flex: 'none' }}>{x.etat === 'passee' ? 'Session passée' : 'À replanifier'}</Tag>}
                  </div>
                  <div className="sub text-n400">
                    {x.etat === 'passee' ? 'Présence et résultat en cours d’enregistrement par le service RH'
                      : x.etat === 'a_planifier' ? 'Le service RH vous inscrira à une prochaine session'
                      : i.convoc === 'now' ? `Convocation envoyée le ${fmtShort(parse(i.date))}` : 'Convocation à venir'}
                  </div>
                </div>
              ))}
            </Panel>
          )}

          <Panel title="Mes certifications" style={{ gap: 'var(--space-2)' }}>
            {me.certs.map(c => {
              const avail = upcoming.find(s => s.formation === c.f && s.inscrits < s.places);
              const pend = myReqs.some(r => r.type === 'formation' && r.f === c.f && r.statut === 'attente');
              const info = c.session ? `Inscrit à la session du ${fmt(parse(c.session.date))}`
                : c.sessionPassee ? `Session du ${fmt(parse(c.sessionPassee.date))} passée — présence et résultat en cours d’enregistrement par le service RH`
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
            {me.certs.length === 0 && <Empty>Aucune certification enregistrée.</Empty>}
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
            <Fine>Seules les dates de vaccination sont enregistrées, sans aucune information médicale.</Fine>
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
              </div>
            ))}
            {reqs.length === 0 && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Aucune demande envoyée.</p>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
