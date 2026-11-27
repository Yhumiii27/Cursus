// lot 12 — C4 (organismes de formation et e-learning) : onglet Organismes de l'écran Référentiels. Liste des fiches
// filtrée (en vigueur, à vérifier, Qualiopi à surveiller, NDA absent, archivées) et fiche ouverte à côté : identité et
// Qualiopi, conditions commerciales, contacts, tarifs, évaluations consolidées sur plusieurs exercices, activité.
// Droits (le serveur les vérifie) : droit « formations » (service RH, référent HSE) pour l'identité, Qualiopi et les
// contacts ; service RH pour les conditions et les tarifs ; administrateur RH pour la fusion d'un doublon (motif) ; la
// lecture seule consulte, sans contacts ni tarifs. Fiches reprises des textes libres : marquées « à vérifier », à confirmer
// ou à fusionner avec leur doublon (jamais deux SIRET différents). Règles : shared/rules/organismes.ts et organismes-suivi.ts.
import { useState, type ReactNode, type RefObject } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { fmtEur, fmtIso } from '../../../shared/format.ts';
import { t, tn } from '../i18n/langue.ts';
import {
  avertissementsOrganisme, CATEGORIES_QUALIOPI, etatQualiopi, MODALITES_TARIF, organismeActif, rattachementsDe, ROLES_CONTACT, UNITES_TARIF,
} from '../../../shared/rules/organismes.ts';
import {
  comparatifFormation, exercicesGlissants, HORIZON_EVALUATIONS, HORIZONS_EVALUATIONS, indicateursOrganismesAffiches, organismesASurveiller, type ExerciceOrganisme,
} from '../../../shared/rules/organismes-suivi.ts';
import type { LigneEvaluation } from '../../../shared/types.ts';
import type { Organisme } from '../../../shared/types-organismes.ts';
import { Ouvrir } from '../components/Cliquable.tsx';
import {
  CLS_QUALIOPI, ETAT_QUALIOPI_LABEL, filtrerOrganismes, FILTRES_ORGANISMES, QUALIOPI_COURT, TYPES_ORGANISME,
} from '../components/organismes/etat.ts';
import { usePanneauVisible } from '../components/panneau.ts';
import { Btn, CloseButton, Empty, Fine, NoteAccent, Panel, SectionLabel, Seg, Tag, Two } from '../components/ui.tsx';
import { useAgir } from '../state/actions.ts';
import { archivageOrganisme, archivageTarif, retraitContact } from '../state/confirmations-organismes.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function Organismes() {
  const d = useDomain();
  const { ui, setUi, openDialog } = useStore();
  const { formations } = useRole();
  const liste = d.ds.organismes ?? [];
  const jours = d.ds.settings.organismeAlerteQualiopiJours;
  const lignes = filtrerOrganismes(liste, ui.orgFiltre, d.ti, jours);
  const sel = liste.find(o => o.id === ui.orgSel) ?? null;
  const panneau = usePanneauVisible<HTMLElement>(sel?.id);
  const aVerifier = liste.filter(o => organismeActif(o) && o.aVerifier).length;
  const surveiller = organismesASurveiller(liste, d.ti, d.ds.settings).filter(a => a.etat === 'echu' || a.etat === 'a_echeance');
  const ouvrir = (o: Organisme) => setUi({ orgSel: ui.orgSel === o.id ? null : o.id });
  const formationsDe = (o: Organisme) => d.ds.referentiels.formations.filter(f => !f.archive && f.organismeId === o.id).length;

  return (
    <>
      {(aVerifier > 0 || surveiller.length > 0) && (
        <Panel highlight title={t('To check')} aside={[aVerifier ? tn(aVerifier, 'sheet taken over', 'sheets taken over') : '', surveiller.length ? tn(surveiller.length, 'Qualiopi certification to renew', 'Qualiopi certifications to renew') : ''].filter(Boolean).join(' · ')}>
          {aVerifier > 0 && (
            <p style={{ margin: 0, fontSize: 14 }}>
              {t('Those providers entered as free text have been taken over as sheets: confirm each one (identity, SIRET, declaration of activity, Qualiopi), or merge it with its duplicate. Two sheets with different SIRETs are never merged.')}{' '}
              {ui.orgFiltre !== 'a_verifier' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUi({ orgFiltre: 'a_verifier' })}>{t('See the sheets to check')}</button>}
            </p>
          )}
          {surveiller.map(a => (
            <div key={a.organisme.id} className="list-row" style={{ padding: 'var(--space-2) 0' }}>
              <Ouvrir onOpen={() => setUi({ orgSel: a.organisme.id })}>{a.organisme.nomUsuel}</Ouvrir>
              <span className="text-muted sub">{ETAT_QUALIOPI_LABEL[a.etat]}{a.organisme.qualiopiValideJusquau ? `${t(' — end of validity on ')}${fmtIso(a.organisme.qualiopiValideJusquau)}` : ''}</span>
            </div>
          ))}
        </Panel>
      )}
      <div className="row-wrap">
        <Panel style={{ flex: '1 1 480px', minWidth: 0 }} head={
          <div className="panel-head top">
            <div>
              <h2>{t('Training providers')}</h2>
              <div className="text-muted sub">{tn(liste.filter(organismeActif).length, 'provider in force', 'providers in force')}</div>
            </div>
            <div className="actions-end" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Seg name="orgFiltre" label={t('Providers shown')} value={ui.orgFiltre} onChange={v => setUi({ orgFiltre: v })} options={FILTRES_ORGANISMES.map(([k, l]) => [k, t(l)])} style={{ flexWrap: 'wrap' }} />
              {formations && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'organisme' })}>{t('New provider')}</Btn>}
            </div>
          </div>
        }>
          {lignes.length > 0 ? (
            <div className="scroll-x">
              <table className="table">
                <thead><tr><th>{t('Provider')}</th><th>{t('Type')}</th><th>{t('Qualiopi')}</th><th>{t('NDA')}</th><th>{t('Catalogue')}</th><th>{t('State')}</th></tr></thead>
                <tbody>
                  {lignes.map(o => {
                    const etat = etatQualiopi(o, d.ti, jours);
                    return (
                      <tr key={o.id} className="clickable" onClick={() => ouvrir(o)}
                        style={{ backgroundColor: ui.orgSel === o.id ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : undefined }}>
                        <td style={{ minWidth: 180 }}>
                          <div><Ouvrir pressed={ui.orgSel === o.id} onOpen={() => ouvrir(o)}>{o.nomUsuel}</Ouvrir></div>
                          <div className="text-muted sub">{[o.code, o.raisonSociale].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td className="nowrap">{TYPES_ORGANISME[o.type]}</td>
                        <td>{etat === 'sans_objet' ? '—' : <Two nowrap main={<Tag cls={CLS_QUALIOPI[etat]}>{t(QUALIOPI_COURT[etat])}</Tag>} sub={o.qualiopiValideJusquau ? `${t('to #date-short')}${fmtIso(o.qualiopiValideJusquau)}` : undefined} />}</td>
                        <td className="nowrap">{o.type === 'interne' ? '—' : o.nda ? t('Declared#masc') : <span className="note-accent">{t('Missing#masc')}</span>}</td>
                        <td className="tnum">{formationsDe(o) || '—'}</td>
                        <td>{o.archive ? <Tag cls="tag-outline">{o.fusionneDans != null ? t('Merged') : t('Archived#masc')}</Tag> : o.aVerifier ? <Tag cls="tag-accent">{t('To check')}</Tag> : <Tag cls="tag-neutral">{t('In force')}</Tag>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty pad="sm">{liste.length ? t('No provider with this filter.') : t('No provider: the providers entered on the training courses are taken over here at start-up; add the others.')}</Empty>
          )}
          <Fine>
            {t('The usual name of a provider is copied onto the catalogue training courses that designate it. A session keeps the provider it had at its creation. Qualiopi missing or expired: a warning, never a block (the OPCO does not fund a non-certified provider).')}
          </Fine>
        </Panel>
        {sel && <FicheOrganisme panneau={panneau} o={sel} onClose={() => setUi({ orgSel: null })} />}
      </div>
    </>
  );
}

/** Ligne libellé / valeur de la fiche. */
function Ligne({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', fontSize: 13, padding: '2px 0' }}>
      <span className="text-muted">{label}</span>
      <span style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  );
}

type OngletFiche = 'identite' | 'contacts' | 'tarifs' | 'evaluations' | 'activite';

function FicheOrganisme({ panneau, o, onClose }: { panneau: RefObject<HTMLElement | null>; o: Organisme; onClose: () => void }) {
  const d = useDomain();
  const { openDialog, run, setUi } = useStore();
  const { formations, rh, admin } = useRole();
  const { occupe, agir } = useAgir();
  const [onglet, setOnglet] = useState<OngletFiche>('identite');
  const jours = d.ds.settings.organismeAlerteQualiopiJours;
  const etat = etatQualiopi(o, d.ti, jours);
  const fusionne = o.fusionneDans != null ? (d.ds.organismes ?? []).find(x => x.id === o.fusionneDans) ?? null : null;
  const modifiable = formations && !fusionne;
  const sessions = d.ds.sessions.filter(s => s.organismeId === o.id).length;
  const avert = avertissementsOrganisme(o, d.ti);
  // Contacts et tarifs : droit « formations » seulement (rien n'arrive à la lecture seule).
  const onglets: [OngletFiche, string][] = [
    ['identite', t('Identity and Qualiopi')], ...(formations ? [['contacts', t('Contacts')], ['tarifs', t('Rates')]] as [OngletFiche, string][] : []),
    ['evaluations', t('Evaluations')], ['activite', t('Activity')],
  ];

  return (
    <aside ref={panneau} tabIndex={-1} aria-labelledby="organisme-nom" className="card elev-md panneau-colonne" style={{ flex: '0 1 460px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 id="organisme-nom" style={{ overflowWrap: 'anywhere' }}>{o.nomUsuel}</h3>
          <div className="text-muted" style={{ fontSize: 13 }}>{TYPES_ORGANISME[o.type]}{t(' · code ')}{o.code}{o.source === 'reprise' ? t(' · taken over from a free text') : ''}</div>
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Tag cls={CLS_QUALIOPI[etat]}>{ETAT_QUALIOPI_LABEL[etat]}</Tag>
        {o.aVerifier && <Tag cls="tag-accent">{t('To check')}</Tag>}
        {fusionne ? <Tag cls="tag-outline">{t('Merged into ')}{fusionne.nomUsuel}</Tag> : o.archive ? <Tag cls="tag-outline">{t('Archived on #masc')}{fmtIso(o.archive)}</Tag> : null}
      </div>
      {fusionne && (
        <div className="text-muted sub">
          {t('Merged on ')}{o.fusionneLe ? fmtIso(o.fusionneLe) : '—'}{o.fusionnePar ? `${t(' by ')}${o.fusionnePar}` : ''}.{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUi({ orgSel: fusionne.id })}>{t('Open ')}{fusionne.nomUsuel}</button>
        </div>
      )}
      {!o.archive && avert.length > 0 && <NoteAccent>{avert.join(' · ')}</NoteAccent>}
      {modifiable && (
        <div className="actions-end" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <Btn small onClick={() => openDialog({ type: 'organisme', id: o.id })}>{t('Edit')}</Btn>
          {o.aVerifier && !o.archive && <Btn small variant="secondary" disabled={occupe} onClick={agir(() => run('organisme.verifier', { id: o.id }))}>{t('Confirm the sheet')}</Btn>}
          {admin && !o.archive && <Btn small onClick={() => openDialog({ type: 'organismeFusion', source: o.id })}>{t('Merge into…')}</Btn>}
          {o.archive
            ? <Btn small disabled={occupe} onClick={agir(() => run('organisme.archiver', { id: o.id, archive: false }))}>{t('Restore')}</Btn>
            : <Btn small onClick={() => openDialog({ type: 'confirmer', c: archivageOrganisme(o, sessions) })}>{t('Archive')}</Btn>}
        </div>
      )}
      <Seg name="ficheOrganisme" label={t('Part of the sheet')} value={onglet} onChange={setOnglet} options={onglets} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }} />
      {onglet === 'identite' && <Identite o={o} rh={rh && !fusionne} />}
      {onglet === 'contacts' && <Contacts o={o} modifiable={modifiable} />}
      {onglet === 'tarifs' && <Tarifs o={o} modifiable={rh && !fusionne} />}
      {onglet === 'evaluations' && <EvaluationsOrganisme o={o} />}
      {onglet === 'activite' && <Activite o={o} />}
    </aside>
  );
}

function Identite({ o, rh }: { o: Organisme; rh: boolean }) {
  const { openDialog } = useStore();
  return (
    <>
      <div>
        <SectionLabel>{t('Identity')}</SectionLabel>
        <Ligne label={t('Company name')}>{o.raisonSociale ?? '—'}</Ligne>
        <Ligne label={t('SIRET')}>{o.siret ?? '—'}</Ligne>
        {o.type !== 'interne' && <Ligne label={t('Declaration of activity')}>{o.nda ? `${o.nda}${o.ndaRegion ? ` · ${o.ndaRegion}` : ''}` : t('not filled in#fem')}</Ligne>}
        <Ligne label={t('Address')}>{o.adresse ?? '—'}</Ligne>
        {/* Site de l'organisme : ouvert hors de Cursus, sans lui transmettre la page d'origine. */}
        <Ligne label={t('Website')}>{o.siteWeb ? <a href={o.siteWeb} target="_blank" rel="noopener noreferrer">{o.siteWeb.replace(/^https?:\/\//, '')}</a> : '—'}</Ligne>
        {o.alias.length > 0 && <Ligne label={t('Other spellings')}>{o.alias.join(' · ')}</Ligne>}
      </div>
      {o.type !== 'interne' && (
        <div>
          <SectionLabel>{t('Qualiopi')}</SectionLabel>
          <Ligne label={t('Certification')}>{o.qualiopi ? t('Declared#fem') : t('Not certified')}</Ligne>
          {o.qualiopi && <>
            <Ligne label={t('Categories')}>{o.qualiopiCategories.length ? o.qualiopiCategories.map(c => CATEGORIES_QUALIOPI[c]).join(', ') : t('to be specified')}</Ligne>
            <Ligne label={t('Certifier · number')}>{o.qualiopiCertificateur ?? '—'} · {o.qualiopiNumero ?? '—'}</Ligne>
            <Ligne label={t('End of validity')}>{o.qualiopiValideJusquau ? fmtIso(o.qualiopiValideJusquau) : t('to be checked')}</Ligne>
          </>}
          <Ligne label={t('Last check')}>{o.qualiopiVerifieLe ? fmtIso(o.qualiopiVerifieLe) : '—'}</Ligne>
        </div>
      )}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
          <SectionLabel>{t('Conditions')}</SectionLabel>
          {rh && <Btn small onClick={() => openDialog({ type: 'organismeConditions', id: o.id })}>{t('Edit')}</Btn>}
        </div>
        <Ligne label={t('Payment subrogation')}>{o.subrogationAcceptee ? t('Accepted#fem') : t('No')}</Ligne>
        <Ligne label={t('Cancellation notice')}>{o.delaiAnnulationJours != null ? tn(o.delaiAnnulationJours, 'day', 'days') : '—'}</Ligne>
        {o.conditions && <p className="text-muted sub" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{o.conditions}</p>}
      </div>
    </>
  );
}

function Contacts({ o, modifiable }: { o: Organisme; modifiable: boolean }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const contacts = (d.ds.organismeContacts ?? []).filter(c => c.organismeId === o.id && !c.archive).sort((a, b) => Number(b.principal) - Number(a.principal) || a.nom.localeCompare(b.nom, 'fr'));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {contacts.length === 0 && <Empty pad="sm">{t('No contact.')}</Empty>}
      {contacts.map(c => (
        <div key={c.id} className="boxed" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14 }}>{c.nom}{c.principal ? t(' · main#contact') : ''}</span>
            <span className="text-muted sub">{ROLES_CONTACT[c.role]}{c.fonction ? ` · ${c.fonction}` : ''}</span>
          </div>
          <div className="sub" style={{ overflowWrap: 'anywhere' }}>
            {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}{c.email && c.telephone ? ' · ' : ''}{c.telephone && <a href={`tel:${c.telephone.replace(/[^+\d]/g, '')}`}>{c.telephone}</a>}
          </div>
          {modifiable && (
            <div className="actions-end" style={{ justifyContent: 'flex-start' }}>
              <Btn small onClick={() => openDialog({ type: 'organismeContact', organismeId: o.id, id: c.id })}>{t('Edit')}</Btn>
              <Btn small onClick={() => openDialog({ type: 'confirmer', c: retraitContact(c, o.nomUsuel) })}>{t('Remove')}</Btn>
            </div>
          )}
        </div>
      ))}
      {modifiable && <div><Btn small variant="secondary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'organismeContact', organismeId: o.id })}>{t('Add a contact')}</Btn></div>}
      <Fine>{t('Personal data of third parties: visible only to HR and the training referent, never copied into the log.')}</Fine>
    </div>
  );
}

function Tarifs({ o, modifiable }: { o: Organisme; modifiable: boolean }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const tarifs = (d.ds.organismeTarifs ?? []).filter(x => x.organismeId === o.id && !x.archive).sort((a, b) => b.valableDu.localeCompare(a.valableDu));
  const quoi = (x: { formation: string | null; libelle: string | null }) => (x.formation ? d.fm(x.formation)?.court ?? x.formation : x.libelle ?? '—');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {tarifs.length === 0 ? <Empty pad="sm">{t('No rate.')}</Empty> : (
        <div className="scroll-x">
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>{t('Training#course')}</th><th className="right">{t('Amount excl. VAT')}</th><th>{t('Validity')}</th>{modifiable && <th></th>}</tr></thead>
            <tbody>
              {tarifs.map(x => (
                <tr key={x.id}>
                  <td><Two main={quoi(x)} sub={MODALITES_TARIF[x.modalite]} /></td>
                  <td className="right"><Two nowrap main={fmtEur(x.montantHt)} sub={UNITES_TARIF[x.unite]} /></td>
                  <td className="nowrap">{fmtIso(x.valableDu)}{x.valableAu ? ` → ${fmtIso(x.valableAu)}` : ''}{x.valableAu && x.valableAu < d.ti ? <div className="text-muted sub">{t('expired#masc')}</div> : null}</td>
                  {modifiable && (
                    <td className="right">
                      <div className="actions-end" style={{ flexWrap: 'nowrap' }}>
                        <Btn small onClick={() => openDialog({ type: 'organismeTarif', organismeId: o.id, id: x.id })}>{t('Edit')}</Btn>
                        <Btn small onClick={() => openDialog({ type: 'confirmer', c: archivageTarif(x, quoi(x), o.nomUsuel) })}>{t('Archive')}</Btn>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modifiable && <div><Btn small variant="secondary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'organismeTarif', organismeId: o.id })}>{t('Add a rate')}</Btn></div>}
      <Fine>{t('The rate in force prefills the cost of a plan line and of an OPCO file, without ever imposing it. Rates and conditions: HR.')}</Fine>
    </div>
  );
}

/** Moyenne, taux et masquage d'une ligne d'évaluations. */
const note = (l: LigneEvaluation) => (l.moyenneChaud != null ? `${String(l.moyenneChaud).replace('.', ',')} / 5` : l.chaud ? t('hidden#fem') : '—');
const taux = (v: number | null, n: number) => (v != null ? `${v} %` : n ? t('hidden#masc') : '—');

function EvaluationsOrganisme({ o }: { o: Organisme }) {
  const d = useDomain();
  const [horizon, setHorizon] = useState<number>(HORIZON_EVALUATIONS);
  const exercices = exercicesGlissants(d.ti, horizon);
  const tous = indicateursOrganismesAffiches(d, exercices);
  const x = tous.find(i => i.organismeId === o.id) ?? null;
  const nomDe = (id: number) => (d.ds.organismes ?? []).find(f => f.id === id)?.nomUsuel ?? `${t('provider no. ')}${id}`;
  const ligne = (e: ExerciceOrganisme) => (
    <tr key={e.exercice}>
      <td className="nowrap">{e.exercice || t('Cumulative')}</td>
      <td className="tnum">{e.sessions}{e.annulees ? <span className="text-muted sub"> · {e.annulees}{t(' canc.')}</span> : null}</td>
      <td className="tnum">{e.ligne.participants}</td>
      <td className="nowrap">{note(e.ligne)}</td>
      <td className="nowrap">{taux(e.ligne.tauxEfficacite, e.ligne.froid)}</td>
      <td className="nowrap">{e.ligne.tauxFroid != null ? `${e.ligne.tauxFroid} %` : '—'}</td>
      <td className="right tnum nowrap">{e.coutReel ? fmtEur(e.coutReel) : '—'}</td>
    </tr>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <Seg name="horizonOrganisme" label={t('Financial years consolidated')} value={horizon} onChange={setHorizon}
        options={HORIZONS_EVALUATIONS.map(n => [n, `${n}${t(' financial years')}`] as [number, string])} style={{ alignSelf: 'flex-start' }} />
      {!x ? <Empty pad="sm">{t('No session nor assessable training course with this provider over ')}{exercices[0]}–{exercices[exercices.length - 1]}.</Empty> : <>
        <div className="scroll-x">
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>{t('Financial year')}</th><th>{t('Sessions')}</th><th>{t('Trainees')}</th><th>{t('Hot#evaluation')}</th><th>{t('Effectiveness')}</th><th>{t('Cold response')}</th><th className="right">{t('Actual cost')}</th></tr></thead>
            <tbody>
              {x.exercices.map(ligne)}
              {ligne(x.cumul)}
            </tbody>
          </table>
        </div>
        {x.parFormation.length > 0 && (
          <div>
            <SectionLabel>{t('Comparison by training course (cumulative)')}</SectionLabel>
            {x.parFormation.map(f => (
              <div key={f.formation} style={{ fontSize: 13, padding: '4px 0' }}>
                <div>{f.intitule}</div>
                {comparatifFormation(tous, f.formation, o.id).map(c => (
                  <div key={c.organismeId} className="text-muted sub" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                    <span>{c.organismeId === o.id ? <strong>{nomDe(c.organismeId)}</strong> : nomDe(c.organismeId)}</span>
                    <span className="nowrap">{tn(c.ligne.participants, 'trainee', 'trainees')} · {note(c.ligne)}{t(' · effectiveness ')}{taux(c.ligne.tauxEfficacite, c.ligne.froid)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </>}
      <Fine>
        {t('Hot and cold feedback of the trainees, counted with the provider of their session (frozen at its creation) or of their training followed. Under 3 answers, neither average nor rate in the aggregated view; no comment. The evaluations deleted by the retention period are no longer counted.')}
      </Fine>
    </div>
  );
}

function Activite({ o }: { o: Organisme }) {
  const d = useDomain();
  const r = rattachementsDe(d.ds, o.id);
  const catalogue = d.ds.referentiels.formations.filter(f => f.organismeId === o.id);
  const aVenir = d.ds.sessions.filter(s => s.organismeId === o.id && s.date >= d.ti && s.statut !== 'Annulée' && s.statut !== 'Clôturée').length;
  const modules = (d.ds.modulesElearning ?? []).filter(m => m.organismeId === o.id);
  return (
    <div>
      <SectionLabel>{t('Attachments#links')}</SectionLabel>
      <Ligne label={t('Training courses of the catalogue')}>{catalogue.length ? catalogue.map(f => f.court).join(', ') : '—'}</Ligne>
      <Ligne label={t('Sessions · of which upcoming')}>{r.sessions} · {aVenir}</Ligne>
      <Ligne label={t('Training courses followed')}>{r.suivies}</Ligne>
      <Ligne label={t('Plan lines (provider chosen)')}>{r.plan}</Ligne>
      <Ligne label={t('OPCO files')}>{r.dossiers}</Ligne>
      <Ligne label={t('E-learning modules#of')}>{modules.length ? modules.map(m => m.code).join(', ') : '—'}</Ligne>
    </div>
  );
}
