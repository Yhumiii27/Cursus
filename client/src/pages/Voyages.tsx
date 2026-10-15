// Voyages professionnels : demandes Keystone, déplacements à venir, dossier voyage,
// dossiers voyageurs et référentiel des destinations.
import { useMemo, type RefObject } from 'react';
import { PlusIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { SECU_RULES, TRIP_CLS, TRIP_LABEL, VISA_RULES, secuDe, type StatusKey } from '../../../shared/constants.ts';
import type { TripItem, TripX } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { fmt, fmtShort, monthShort, plural, rel } from '../../../shared/format.ts';
import { blocage, conflitsDates } from '../../../shared/rules/conflits.ts';
import { usePanneauVisible } from '../components/panneau.ts';
import { Btn, Chips, CloseButton, Empty, Fine, Page, Panel, Tag, Two, stop } from '../components/ui.tsx';
import { useAgir } from '../state/actions.ts';
import { refusKeystone } from '../state/confirmations.ts';
import { useEnriched, useTrips } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

const docCls = (k: StatusKey) => k === 'exp' ? 'tag-accent' : k === 'due' ? 'tag-outline' : 'tag-neutral';
const itemAction = (i: TripItem) => i.k === 'passeport' ? 'Mettre à jour le passeport' : i.k === 'visa' ? 'Enregistrer le visa' : 'Enregistrer la vaccination';
/** Formalités de détachement, accomplies par le service RH (dialogue « Formalités de détachement ») : saisie, ou correction. */
const detachementAction = (i: TripItem) => i.ok ? 'Modifier' : i.k === 'information' ? 'Enregistrer la remise' : 'Enregistrer l’obtention';

export function Voyages() {
  const { d, emps, horizon } = useEnriched();
  const trips = useTrips();
  const { ui, setUi, go, run, openDialog } = useStore();
  const { occupe, agir } = useAgir();
  const data = d.ds;

  const travelers = useMemo(() => emps
    .filter(e => e.passeport || e.visas.length || e.vaccins.length || trips.some(t => t.empId === e.id))
    .map(e => ({ e, tv: d.travelOf(e, horizon), nt: trips.find(x => x.empId === e.id) }))
    .sort((a, b) => (a.nt ? a.nt.depart : '9').localeCompare(b.nt ? b.nt.depart : '9') || a.e.nom.localeCompare(b.e.nom)),
  [d, emps, trips, horizon]);

  // Les demandes décidées restent en base (statut, date, décideur) ; seules celles en attente s'affichent ici.
  const demandes = data.demandesKeystone.filter(dm => dm.statut === 'attente').map(dm => {
    const emp = d.emp(dm.empId), c = d.chantier(dm.chantier), dest = d.destOf(dm.dest);
    const r = emp && dest ? d.readiness(emp, dm) : null;
    // Chef de projet facultatif dans l'API Keystone : « K. Haddad », rien s'il n'est pas renseigné.
    const mots = c?.chef ? c.chef.trim().split(/\s+/) : [];
    const chefCourt = mots.map((w, i) => i === 0 && mots.length > 1 ? w[0] + '.' : w).join(' ');
    // Déjà en déplacement ou absent sur ces dates : l'acceptation est refusée (`keystone.accepter`), reste le refus.
    const conflit = blocage(conflitsDates(d, dm.empId, dm.depart, dm.retour, 'voyage'));
    return { dm, emp, c, dest, r, chefCourt, conflit };
  });

  const count = (st: TripX['r']['status']) => trips.filter(t => t.r.status === st).length;
  const sel = trips.find(t => t.id === ui.tripSel) || null;
  // Écran étroit : le dossier voyage s'affiche sous la liste ; la sélection l'amène dans le champ de vision.
  const panneau = usePanneauVisible<HTMLElement>(sel?.id);
  const openEmp = (id: number) => go('collaborateurs', { selectedId: id });

  const accept = async (id: number) => {
    const r = await run('keystone.accepter', { id });
    if (r.ok) setUi({ tripSel: (r.result as { id: number } | undefined)?.id ?? null });
  };

  return (
    <Page
      kicker={`${plural(trips.length, 'déplacement à venir', 'déplacements à venir')} · ${count('pret')} prêts · ${count('todo')} à compléter · ${count('bloc')} bloquants`}
      title="Voyages professionnels"
      actions={<>
        <Btn onClick={() => openDialog({ type: 'fo' })}>Enregistrer une formalité</Btn>
        <Btn variant="secondary" icon={<UploadSimpleIcon size={14} />} onClick={() => openDialog({ type: 'tripImport' })}>Importer des demandes</Btn>
        <Btn variant="primary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'trip' })}>Nouveau déplacement</Btn>
      </>}
    >
      {demandes.length > 0 && (
        <Panel highlight title="Demandes Keystone" aside={`${plural(demandes.length, 'demande à valider', 'demandes à valider')} · ressources affectées à un chantier à l’étranger`}>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Collaborateur</th><th>Chantier</th><th>Formalités</th><th></th></tr></thead>
              <tbody>
                {demandes.map(({ dm, emp, c, dest, r, chefCourt, conflit }) => (
                  <tr key={dm.id}>
                    <td>
                      <Two nowrap main={emp?.nom ?? d.personName(dm.empId)} sub={`${dest?.pays ?? dm.dest} · ${fmtShort(parse(dm.depart))} → ${fmtShort(parse(dm.retour))}`} />
                      {conflit && <div className="note-accent">{conflit}</div>}
                    </td>
                    <td><Two main={c ? `${c.id} · ${c.nom}` : dm.chantier} sub={`Reçue le ${fmtShort(parse(dm.recue))}${dm.ref ? ` · réf. ${dm.ref}` : ''}${chefCourt ? ' · ' + chefCourt : ''}`} /></td>
                    <td>{r && <Tag cls={TRIP_CLS[r.status]}>{r.todo ? plural(r.todo, 'formalité à prévoir', 'formalités à prévoir') : 'Dossier complet'}</Tag>}</td>
                    <td className="right">
                      <div className="actions-end">
                        {/* Refus : confirmation et motif, conservé dans Cursus (jamais transmis à Keystone). */}
                        <Btn small disabled={occupe} onClick={() => openDialog({ type: 'confirmer',
                          c: refusKeystone(dm, emp?.nom ?? d.personName(dm.empId), c ? `${c.id} · ${c.nom}` : dm.chantier) })}>Refuser</Btn>
                        <Btn small variant="secondary" disabled={occupe || !!conflit} title={conflit ?? undefined} onClick={agir(() => accept(dm.id))}>Accepter</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <div className="row-wrap">
        <Panel style={{ flex: '1 1 480px', gap: 'var(--space-2)' }} head={<h2 style={{ margin: '0 0 var(--space-2)' }}>Déplacements à venir</h2>}>
          {trips.map(t => {
            const selected = ui.tripSel === t.id;
            const chips = t.r.items.filter(i => !i.ok).map(i => ({ key: i.k + i.label, label: i.short, cls: i.cls }));
            return (
              <div key={t.id} className="list-row top clickable" onClick={() => setUi({ tripSel: selected ? null : t.id })}
                style={{ padding: 'var(--space-3) var(--space-2)', borderRadius: 'var(--radius-md)', backgroundColor: selected ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : undefined }}>
                <div className="date-block" style={{ paddingTop: 2 }}>
                  <div className="d">{t.r.dep.getDate()}</div>
                  <div className="m">{monthShort(t.r.dep)}</div>
                </div>
                <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="item-head">
                    <div>
                      <div style={{ fontSize: 14 }}>{t.emp.nom} — {t.r.dest.pays}</div>
                      <div className="text-muted sub">{t.motif} · {fmtShort(t.r.dep)} → {fmt(t.r.ret)} · départ {rel(t.r.toGo)}</div>
                      <div className="sub-11" style={{ color: 'var(--color-accent-300)' }}>{d.originLabel(t)}</div>
                    </div>
                    <Tag cls={TRIP_CLS[t.r.status]} style={{ flex: 'none' }}>{TRIP_LABEL[t.r.status]}</Tag>
                  </div>
                  <Chips items={chips.length ? chips : [{ key: 'ok', label: 'Dossier complet', cls: 'tag-neutral' }]} />
                </div>
              </div>
            );
          })}
          {trips.length === 0 && <Empty>Aucun déplacement prévu.</Empty>}
        </Panel>

        {sel && <TripPanel panneau={panneau} t={sel} onClose={() => setUi({ tripSel: null })} onOpenEmp={() => openEmp(sel.emp.id)} />}
      </div>

      <Panel title="Dossiers voyageurs" aside={plural(travelers.length, 'dossier voyageur', 'dossiers voyageurs')}>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Collaborateur</th><th>Passeport</th><th>Visas · autorisations</th><th>Vaccinations</th><th>Prochain départ</th><th></th></tr></thead>
            <tbody>
              {travelers.map(({ e, tv, nt }) => (
                <tr key={e.id} className="clickable" onClick={() => openEmp(e.id)}>
                  <td><Two nowrap main={e.nom} sub={e.poste} /></td>
                  <td>
                    <Two nowrap main={tv.pass ? `Valide jusqu’au ${fmt(tv.pass.exp)}` : 'Non renseigné'}
                      sub={tv.pass ? (tv.pass.key === 'ok' ? `n° ${e.passeport!.numero}` : tv.pass.key === 'exp' ? 'expiré' : `expire ${rel(tv.pass.d)}`) : 'à fournir'} />
                  </td>
                  <td>
                    {tv.visas.length > 0
                      ? <Chips items={tv.visas.map(v => ({ key: v.dest, label: `${v.type} ${d.destOf(v.dest)?.pays ?? v.dest} · ${v.key === 'exp' ? 'expiré' : 'jusqu’au ' + fmtShort(v.exp)}`, cls: docCls(v.key) }))} />
                      : <span className="text-muted">—</span>}
                  </td>
                  <td>
                    {tv.vaccins.length > 0
                      ? <Chips items={tv.vaccins.map(x => ({ key: x.v, label: `${x.vm.court}${x.exp ? ' · ' + (x.key === 'exp' ? 'rappel dépassé' : x.exp.getFullYear()) : ''}`, cls: docCls(x.key) }))} />
                      : <span className="text-muted">Aucune enregistrée</span>}
                  </td>
                  <td><Two nowrap main={nt ? `${nt.r.dest.pays} · ${fmt(parse(nt.depart))}` : '—'} sub={nt ? TRIP_LABEL[nt.r.status] : 'aucun déplacement prévu'} /></td>
                  <td className="right"><Btn small onClick={stop(() => openDialog({ type: 'fo', empId: e.id }))}>Formalité</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Référentiel destinations">
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Pays</th><th>Entrée</th><th>Sécurité sociale</th><th>Vaccin obligatoire</th><th>Vaccins recommandés</th><th>Passeport</th></tr></thead>
            <tbody>
              {data.referentiels.destinations.map(x => {
                const rule = VISA_RULES[x.visa], secu = SECU_RULES[secuDe(x)];
                return (
                  <tr key={x.code}>
                    <td className="nowrap">{x.pays}</td>
                    <td><Two nowrap main={rule.label} sub={x.visaSub || rule.sub} /></td>
                    <td><Two main={secu.label} sub={secu.portee} /></td>
                    <td>{x.oblig.length ? d.vaccinNames(x.oblig) : '—'}</td>
                    <td className="text-muted">{d.vaccinNames([...x.rec, 'dtp'])}</td>
                    <td className="text-muted">{x.passMois ? `${x.passMois} mois après l’entrée` : 'Valide pendant le séjour'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Fine>Données indicatives tenues par le service RH — à vérifier sur France Diplomatie, auprès d’un centre de vaccinations internationales et, pour la sécurité sociale, sur cleiss.fr avant chaque départ.</Fine>
      </Panel>
    </Page>
  );
}

/** Dossier voyage du déplacement sélectionné : pièces exigées et actions. */
function TripPanel({ panneau, t, onClose, onOpenEmp }: { panneau: RefObject<HTMLElement | null>; t: TripX; onClose: () => void; onOpenEmp: () => void }) {
  const { d } = useEnriched();
  const { openDialog } = useStore();
  const r = t.r;
  return (
    <aside ref={panneau} tabIndex={-1} aria-labelledby="dossier-voyage-nom" className="card elev-md side-panel" style={{ flex: '0 1 400px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 id="dossier-voyage-nom">{t.emp.nom}</h3>
          <div className="text-muted" style={{ fontSize: 13 }}>{r.dest.pays} — {t.motif}</div>
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <Tag cls={TRIP_CLS[r.status]}>{TRIP_LABEL[r.status]}</Tag>
        <span className="text-muted sub">{fmt(r.dep)} → {fmt(r.ret)} · départ {rel(r.toGo)}</span>
        <span className="note-accent">{d.originLabel(t)}</span>
      </div>
      <div className="list">
        {r.items.map(i => (
          <div key={i.k + i.label} className="list-row stack" style={{ gap: 6, padding: 'var(--space-3) 0' }}>
            <div className="item-head">
              <div><div style={{ fontSize: 14 }}>{i.label}</div><div className="text-muted sub">{i.text}</div></div>
              <Tag cls={i.cls} style={{ flex: 'none' }}>{i.statut}</Tag>
            </div>
            {!i.ok && i.fix && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Btn small onClick={() => openDialog({ type: 'fo', empId: t.emp.id, kind: i.fix!.kind, dest: i.fix!.dest, v: i.fix!.v })}>{itemAction(i)}</Btn>
              </div>
            )}
            {(i.k === 'detachement' || i.k === 'information') && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Btn small onClick={() => openDialog({ type: 'detachement', id: t.id })}>{detachementAction(i)}</Btn>
              </div>
            )}
          </div>
        ))}
      </div>
      <Fine>{d.destSummary(r.dest)} Exigences tenues à jour par le service RH — à vérifier sur France Diplomatie avant le départ.</Fine>
      <Btn style={{ alignSelf: 'flex-start' }} onClick={onOpenEmp}>Fiche collaborateur →</Btn>
    </aside>
  );
}
