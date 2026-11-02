// lot 12 — C4 (organismes de formation et e-learning) : onglet Organismes de l'écran Référentiels. Liste des fiches
// filtrée (en vigueur, à vérifier, Qualiopi à surveiller, NDA absent, archivées) et fiche ouverte à côté : identité et
// Qualiopi, conditions commerciales, contacts, tarifs, évaluations consolidées sur plusieurs exercices, activité.
// Droits (le serveur les vérifie) : droit « formations » (service RH, référent HSE) pour l'identité, Qualiopi et les
// contacts ; service RH pour les conditions et les tarifs ; administrateur RH pour la fusion d'un doublon (motif) ; la
// lecture seule consulte, sans contacts ni tarifs. Fiches reprises des textes libres : marquées « à vérifier », à confirmer
// ou à fusionner avec leur doublon (jamais deux SIRET différents). Règles : shared/rules/organismes.ts et organismes-suivi.ts.
import { useState, type ReactNode, type RefObject } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { fmtEur, fmtIso, plural } from '../../../shared/format.ts';
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
        <Panel highlight title="À vérifier" aside={[aVerifier ? plural(aVerifier, 'fiche reprise', 'fiches reprises') : '', surveiller.length ? plural(surveiller.length, 'certification Qualiopi à renouveler', 'certifications Qualiopi à renouveler') : ''].filter(Boolean).join(' · ')}>
          {aVerifier > 0 && (
            <p style={{ margin: 0, fontSize: 14 }}>
              Les organismes saisis en texte libre ont été repris en fiches : confirmez chacune (identité, SIRET, déclaration d’activité, Qualiopi),
              ou fusionnez-la avec son doublon. Deux fiches aux SIRET différents ne se fusionnent jamais.{' '}
              {ui.orgFiltre !== 'a_verifier' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUi({ orgFiltre: 'a_verifier' })}>Voir les fiches à vérifier</button>}
            </p>
          )}
          {surveiller.map(a => (
            <div key={a.organisme.id} className="list-row" style={{ padding: 'var(--space-2) 0' }}>
              <Ouvrir onOpen={() => setUi({ orgSel: a.organisme.id })}>{a.organisme.nomUsuel}</Ouvrir>
              <span className="text-muted sub">{ETAT_QUALIOPI_LABEL[a.etat]}{a.organisme.qualiopiValideJusquau ? ` — fin de validité le ${fmtIso(a.organisme.qualiopiValideJusquau)}` : ''}</span>
            </div>
          ))}
        </Panel>
      )}
      <div className="row-wrap">
        <Panel style={{ flex: '1 1 480px', minWidth: 0 }} head={
          <div className="panel-head top">
            <div>
              <h2>Organismes de formation</h2>
              <div className="text-muted sub">{plural(liste.filter(organismeActif).length, 'organisme en vigueur', 'organismes en vigueur')}</div>
            </div>
            <div className="actions-end" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Seg name="orgFiltre" label="Organismes affichés" value={ui.orgFiltre} onChange={v => setUi({ orgFiltre: v })} options={FILTRES_ORGANISMES} style={{ flexWrap: 'wrap' }} />
              {formations && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'organisme' })}>Nouvel organisme</Btn>}
            </div>
          </div>
        }>
          {lignes.length > 0 ? (
            <div className="scroll-x">
              <table className="table">
                <thead><tr><th>Organisme</th><th>Type</th><th>Qualiopi</th><th>NDA</th><th>Catalogue</th><th>État</th></tr></thead>
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
                        <td>{etat === 'sans_objet' ? '—' : <Two nowrap main={<Tag cls={CLS_QUALIOPI[etat]}>{QUALIOPI_COURT[etat]}</Tag>} sub={o.qualiopiValideJusquau ? `au ${fmtIso(o.qualiopiValideJusquau)}` : undefined} />}</td>
                        <td className="nowrap">{o.type === 'interne' ? '—' : o.nda ? 'Déclaré' : <span className="note-accent">Absent</span>}</td>
                        <td className="tnum">{formationsDe(o) || '—'}</td>
                        <td>{o.archive ? <Tag cls="tag-outline">{o.fusionneDans != null ? 'Fusionné' : 'Archivé'}</Tag> : o.aVerifier ? <Tag cls="tag-accent">À vérifier</Tag> : <Tag cls="tag-neutral">En vigueur</Tag>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty pad="sm">{liste.length ? 'Aucun organisme avec ce filtre.' : 'Aucun organisme : les organismes saisis sur les formations sont repris ici au démarrage ; ajoutez les autres.'}</Empty>
          )}
          <Fine>
            Le nom usuel d’un organisme est recopié sur les formations du catalogue qui le désignent. Une session garde l’organisme qu’elle avait à sa
            création. Qualiopi absent ou échu : un avertissement, jamais un blocage (l’OPCO ne finance pas un organisme non certifié).
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
    ['identite', 'Identité et Qualiopi'], ...(formations ? [['contacts', 'Contacts'], ['tarifs', 'Tarifs']] as [OngletFiche, string][] : []),
    ['evaluations', 'Évaluations'], ['activite', 'Activité'],
  ];

  return (
    <aside ref={panneau} tabIndex={-1} aria-labelledby="organisme-nom" className="card elev-md side-panel" style={{ flex: '0 1 460px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 id="organisme-nom" style={{ overflowWrap: 'anywhere' }}>{o.nomUsuel}</h3>
          <div className="text-muted" style={{ fontSize: 13 }}>{TYPES_ORGANISME[o.type]} · code {o.code}{o.source === 'reprise' ? ' · repris d’un texte libre' : ''}</div>
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Tag cls={CLS_QUALIOPI[etat]}>{ETAT_QUALIOPI_LABEL[etat]}</Tag>
        {o.aVerifier && <Tag cls="tag-accent">À vérifier</Tag>}
        {fusionne ? <Tag cls="tag-outline">Fusionné dans {fusionne.nomUsuel}</Tag> : o.archive ? <Tag cls="tag-outline">Archivé le {fmtIso(o.archive)}</Tag> : null}
      </div>
      {fusionne && (
        <div className="text-muted sub">
          Fusionné le {o.fusionneLe ? fmtIso(o.fusionneLe) : '—'}{o.fusionnePar ? ` par ${o.fusionnePar}` : ''}.{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUi({ orgSel: fusionne.id })}>Ouvrir {fusionne.nomUsuel}</button>
        </div>
      )}
      {!o.archive && avert.length > 0 && <NoteAccent>{avert.join(' · ')}</NoteAccent>}
      {modifiable && (
        <div className="actions-end" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <Btn small onClick={() => openDialog({ type: 'organisme', id: o.id })}>Modifier</Btn>
          {o.aVerifier && !o.archive && <Btn small variant="secondary" disabled={occupe} onClick={agir(() => run('organisme.verifier', { id: o.id }))}>Confirmer la fiche</Btn>}
          {admin && !o.archive && <Btn small onClick={() => openDialog({ type: 'organismeFusion', source: o.id })}>Fusionner dans…</Btn>}
          {o.archive
            ? <Btn small disabled={occupe} onClick={agir(() => run('organisme.archiver', { id: o.id, archive: false }))}>Rétablir</Btn>
            : <Btn small onClick={() => openDialog({ type: 'confirmer', c: archivageOrganisme(o, sessions) })}>Archiver</Btn>}
        </div>
      )}
      <Seg name="ficheOrganisme" label="Partie de la fiche" value={onglet} onChange={setOnglet} options={onglets} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }} />
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
        <SectionLabel>Identité</SectionLabel>
        <Ligne label="Raison sociale">{o.raisonSociale ?? '—'}</Ligne>
        <Ligne label="SIRET">{o.siret ?? '—'}</Ligne>
        {o.type !== 'interne' && <Ligne label="Déclaration d’activité">{o.nda ? `${o.nda}${o.ndaRegion ? ` · ${o.ndaRegion}` : ''}` : 'non renseignée'}</Ligne>}
        <Ligne label="Adresse">{o.adresse ?? '—'}</Ligne>
        {/* Site de l'organisme : ouvert hors de Cursus, sans lui transmettre la page d'origine. */}
        <Ligne label="Site web">{o.siteWeb ? <a href={o.siteWeb} target="_blank" rel="noopener noreferrer">{o.siteWeb.replace(/^https?:\/\//, '')}</a> : '—'}</Ligne>
        {o.alias.length > 0 && <Ligne label="Autres graphies">{o.alias.join(' · ')}</Ligne>}
      </div>
      {o.type !== 'interne' && (
        <div>
          <SectionLabel>Qualiopi</SectionLabel>
          <Ligne label="Certification">{o.qualiopi ? 'Déclarée' : 'Non certifié'}</Ligne>
          {o.qualiopi && <>
            <Ligne label="Catégories">{o.qualiopiCategories.length ? o.qualiopiCategories.map(c => CATEGORIES_QUALIOPI[c]).join(', ') : 'à préciser'}</Ligne>
            <Ligne label="Certificateur · numéro">{o.qualiopiCertificateur ?? '—'} · {o.qualiopiNumero ?? '—'}</Ligne>
            <Ligne label="Fin de validité">{o.qualiopiValideJusquau ? fmtIso(o.qualiopiValideJusquau) : 'à vérifier'}</Ligne>
          </>}
          <Ligne label="Dernière vérification">{o.qualiopiVerifieLe ? fmtIso(o.qualiopiVerifieLe) : '—'}</Ligne>
        </div>
      )}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
          <SectionLabel>Conditions</SectionLabel>
          {rh && <Btn small onClick={() => openDialog({ type: 'organismeConditions', id: o.id })}>Modifier</Btn>}
        </div>
        <Ligne label="Subrogation de paiement">{o.subrogationAcceptee ? 'Acceptée' : 'Non'}</Ligne>
        <Ligne label="Délai d’annulation">{o.delaiAnnulationJours != null ? plural(o.delaiAnnulationJours, 'jour', 'jours') : '—'}</Ligne>
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
      {contacts.length === 0 && <Empty pad="sm">Aucun contact.</Empty>}
      {contacts.map(c => (
        <div key={c.id} className="boxed" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14 }}>{c.nom}{c.principal ? ' · principal' : ''}</span>
            <span className="text-muted sub">{ROLES_CONTACT[c.role]}{c.fonction ? ` · ${c.fonction}` : ''}</span>
          </div>
          <div className="sub" style={{ overflowWrap: 'anywhere' }}>
            {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}{c.email && c.telephone ? ' · ' : ''}{c.telephone && <a href={`tel:${c.telephone.replace(/[^+\d]/g, '')}`}>{c.telephone}</a>}
          </div>
          {modifiable && (
            <div className="actions-end" style={{ justifyContent: 'flex-start' }}>
              <Btn small onClick={() => openDialog({ type: 'organismeContact', organismeId: o.id, id: c.id })}>Modifier</Btn>
              <Btn small onClick={() => openDialog({ type: 'confirmer', c: retraitContact(c, o.nomUsuel) })}>Retirer</Btn>
            </div>
          )}
        </div>
      ))}
      {modifiable && <div><Btn small variant="secondary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'organismeContact', organismeId: o.id })}>Ajouter un contact</Btn></div>}
      <Fine>Données personnelles de tiers : visibles du service RH et du référent formation seulement, jamais recopiées au journal.</Fine>
    </div>
  );
}

function Tarifs({ o, modifiable }: { o: Organisme; modifiable: boolean }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const tarifs = (d.ds.organismeTarifs ?? []).filter(t => t.organismeId === o.id && !t.archive).sort((a, b) => b.valableDu.localeCompare(a.valableDu));
  const quoi = (t: { formation: string | null; libelle: string | null }) => (t.formation ? d.fm(t.formation)?.court ?? t.formation : t.libelle ?? '—');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {tarifs.length === 0 ? <Empty pad="sm">Aucun tarif.</Empty> : (
        <div className="scroll-x">
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>Formation</th><th className="right">Montant HT</th><th>Validité</th>{modifiable && <th></th>}</tr></thead>
            <tbody>
              {tarifs.map(t => (
                <tr key={t.id}>
                  <td><Two main={quoi(t)} sub={MODALITES_TARIF[t.modalite]} /></td>
                  <td className="right"><Two nowrap main={fmtEur(t.montantHt)} sub={UNITES_TARIF[t.unite]} /></td>
                  <td className="nowrap">{fmtIso(t.valableDu)}{t.valableAu ? ` → ${fmtIso(t.valableAu)}` : ''}{t.valableAu && t.valableAu < d.ti ? <div className="text-muted sub">échu</div> : null}</td>
                  {modifiable && (
                    <td className="right">
                      <div className="actions-end" style={{ flexWrap: 'nowrap' }}>
                        <Btn small onClick={() => openDialog({ type: 'organismeTarif', organismeId: o.id, id: t.id })}>Modifier</Btn>
                        <Btn small onClick={() => openDialog({ type: 'confirmer', c: archivageTarif(t, quoi(t), o.nomUsuel) })}>Archiver</Btn>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modifiable && <div><Btn small variant="secondary" icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'organismeTarif', organismeId: o.id })}>Ajouter un tarif</Btn></div>}
      <Fine>Le tarif en vigueur préremplit le coût d’une ligne du plan et d’un dossier OPCO, sans jamais l’imposer. Tarifs et conditions : service RH.</Fine>
    </div>
  );
}

/** Moyenne, taux et masquage d'une ligne d'évaluations. */
const note = (l: LigneEvaluation) => (l.moyenneChaud != null ? `${String(l.moyenneChaud).replace('.', ',')} / 5` : l.chaud ? 'masquée' : '—');
const taux = (v: number | null, n: number) => (v != null ? `${v} %` : n ? 'masqué' : '—');

function EvaluationsOrganisme({ o }: { o: Organisme }) {
  const d = useDomain();
  const [horizon, setHorizon] = useState<number>(HORIZON_EVALUATIONS);
  const exercices = exercicesGlissants(d.ti, horizon);
  const tous = indicateursOrganismesAffiches(d, exercices);
  const x = tous.find(i => i.organismeId === o.id) ?? null;
  const nomDe = (id: number) => (d.ds.organismes ?? []).find(f => f.id === id)?.nomUsuel ?? `organisme n° ${id}`;
  const ligne = (e: ExerciceOrganisme) => (
    <tr key={e.exercice}>
      <td className="nowrap">{e.exercice || 'Cumul'}</td>
      <td className="tnum">{e.sessions}{e.annulees ? <span className="text-muted sub"> · {e.annulees} ann.</span> : null}</td>
      <td className="tnum">{e.ligne.participants}</td>
      <td className="nowrap">{note(e.ligne)}</td>
      <td className="nowrap">{taux(e.ligne.tauxEfficacite, e.ligne.froid)}</td>
      <td className="nowrap">{e.ligne.tauxFroid != null ? `${e.ligne.tauxFroid} %` : '—'}</td>
      <td className="right tnum nowrap">{e.coutReel ? fmtEur(e.coutReel) : '—'}</td>
    </tr>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <Seg name="horizonOrganisme" label="Exercices consolidés" value={horizon} onChange={setHorizon}
        options={HORIZONS_EVALUATIONS.map(n => [n, `${n} exercices`] as [number, string])} style={{ alignSelf: 'flex-start' }} />
      {!x ? <Empty pad="sm">Aucune session ni formation évaluable avec cet organisme sur {exercices[0]}–{exercices[exercices.length - 1]}.</Empty> : <>
        <div className="scroll-x">
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>Exercice</th><th>Sessions</th><th>Stagiaires</th><th>À chaud</th><th>Efficacité</th><th>Réponse à froid</th><th className="right">Coût réel</th></tr></thead>
            <tbody>
              {x.exercices.map(ligne)}
              {ligne(x.cumul)}
            </tbody>
          </table>
        </div>
        {x.parFormation.length > 0 && (
          <div>
            <SectionLabel>Comparatif par formation (cumul)</SectionLabel>
            {x.parFormation.map(f => (
              <div key={f.formation} style={{ fontSize: 13, padding: '4px 0' }}>
                <div>{f.intitule}</div>
                {comparatifFormation(tous, f.formation, o.id).map(c => (
                  <div key={c.organismeId} className="text-muted sub" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                    <span>{c.organismeId === o.id ? <strong>{nomDe(c.organismeId)}</strong> : nomDe(c.organismeId)}</span>
                    <span className="nowrap">{plural(c.ligne.participants, 'stagiaire', 'stagiaires')} · {note(c.ligne)} · efficacité {taux(c.ligne.tauxEfficacite, c.ligne.froid)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </>}
      <Fine>
        Avis à chaud et à froid des stagiaires, comptés avec l’organisme de leur session (figé à sa création) ou de leur formation suivie. Sous 3 réponses,
        ni moyenne ni taux dans la vue agrégée ; aucun commentaire. Les évaluations supprimées par la conservation ne sont plus comptées.
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
      <SectionLabel>Rattachements</SectionLabel>
      <Ligne label="Formations du catalogue">{catalogue.length ? catalogue.map(f => f.court).join(', ') : '—'}</Ligne>
      <Ligne label="Sessions · dont à venir">{r.sessions} · {aVenir}</Ligne>
      <Ligne label="Formations suivies">{r.suivies}</Ligne>
      <Ligne label="Lignes du plan (organisme choisi)">{r.plan}</Ligne>
      <Ligne label="Dossiers OPCO">{r.dossiers}</Ligne>
      <Ligne label="Modules d’e-learning">{modules.length ? modules.map(m => m.code).join(', ') : '—'}</Ligne>
    </div>
  );
}
