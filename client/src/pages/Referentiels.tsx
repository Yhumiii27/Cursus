// Référentiels : catalogue des formations, habilitations et destinations de l'entreprise. Le service RH et le référent
// HSE / formation tiennent les formations et les habilitations, le service RH les destinations ; la lecture seule
// consulte. Création, modification (dialogues Ref*Dialog), archivage au lieu de la suppression (confirmé, rétabli d'un
// clic), référentiel type à charger dans un référentiel vide, à vérifier ensuite. Règles : shared/rules/referentiels.ts.
// Onglet Postes (formations et habilitations exigées par poste et par équipe) : pages/ReferentielsPostes.tsx ; onglet
// Activités internes (codes INT-… et ECOLE des feuilles de temps) : pages/ReferentielsActivites.tsx ; onglet Horaires
// (horaires de poste des feuilles de temps) : pages/ReferentielsHoraires.tsx ; onglet Entités et sites (sociétés,
// établissements et sites de rattachement, lot 11) : pages/ReferentielsEntites.tsx.
import { useState, type ReactNode } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { SECU_RULES, VALIDATION_LABEL, VISA_RULES, secuDe } from '../../../shared/constants.ts';
import { parse } from '../../../shared/dates.ts';
import { fmt, fmtEur, validiteLabel } from '../../../shared/format.ts';
import { t, tn } from '../i18n/langue.ts';
import { actif, actifs, demandesEnAttente, titresADelivrer, type ReferentielId } from '../../../shared/rules/referentiels.ts';
import type { Destination, Formation, HabType, ISODate } from '../../../shared/types.ts';
import { Btn, Chips, Empty, Fine, Page, Panel, Seg, Tag, Two } from '../components/ui.tsx';
import { useAgir } from '../state/actions.ts';
import { archivageDestination, archivageFormation, archivageHabilitation, chargementType } from '../state/confirmations-referentiels.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Postes } from './ReferentielsPostes.tsx';
import { Activites } from './ReferentielsActivites.tsx';
import { Horaires } from './ReferentielsHoraires.tsx';
import { EntitesEtSites } from './ReferentielsEntites.tsx';
// lot 12 — C4 (organismes de formation et e-learning) : onglets Organismes et Modules e-learning.
import { Organismes } from './ReferentielsOrganismes.tsx';
import { ModulesElearning } from './ReferentielsModules.tsx';
// lot 12 — C5 (planning d'équipe) : cycles de roulement et besoins de poste.
import { Besoins, Cycles } from './ReferentielsCycles.tsx';

/** Onglets : libellés en sources anglaises, traduits au rendu. */
const ONGLETS: [ReferentielId | 'postes' | 'activites' | 'horaires' | 'entites' | 'organismes' | 'modules' | /* lot 12 — C5 */ 'cycles' | 'besoins', string][] = [
  ['formations', 'Training'], ['habilitations', 'Authorisations'], ['postes', 'Jobs'], ['destinations', 'Destinations'], ['activites', 'Internal activities'],
  ['horaires', 'Schedules'],
  // lot 11 — organigramme
  ['entites', 'Entities and sites'],
  // lot 12 — C4 : droit « formations » et lecture seule (fiches complètes).
  ['organismes', 'Providers'], ['modules', 'E-learning modules'],
  // lot 12 — C5 (planning d'équipe)
  ['cycles', 'Cycles'], ['besoins', 'Job needs'],
];
/** lot 12 — C4 : onglets réservés au droit « formations » et à la lecture seule (paie : ni fiches ni modules). */
const ONGLETS_FORMATIONS = new Set(['organismes', 'modules']);

/** État d'un élément : en vigueur, ou archivé (date). */
const Etat = ({ archive }: { archive?: ISODate | null }) => (archive
  ? <Tag cls="tag-outline">{t('Archived on #fem')}{fmt(parse(archive))}</Tag>
  : <Tag cls="tag-neutral">{t('In force')}</Tag>);

export function Referentiels() {
  const d = useDomain();
  const { ui, setUi } = useStore();
  // lot 12 — C4
  const { formations, consultation } = useRole();
  const onglets = formations || consultation ? ONGLETS : ONGLETS.filter(([o]) => !ONGLETS_FORMATIONS.has(o));
  const onglet = onglets.some(([o]) => o === ui.refOnglet) ? ui.refOnglet : 'formations';
  const r = d.ds.referentiels;
  const kicker = [
    tn(actifs(r.formations).length, 'training course', 'training courses'),
    tn(actifs(r.habilitations).length, 'authorisation', 'authorisations'),
    tn(actifs(r.postes).length, 'job', 'jobs'),
    tn(actifs(r.destinations).length, 'destination', 'destinations'),
  ].join(' · ') + t(' in force');
  return (
    <Page kicker={kicker} title={t('Reference data')}
      actions={<Seg name="refOnglet" label={t('Reference data#one')} value={onglet} onChange={x => setUi({ refOnglet: x })} options={onglets.map(([o, l]) => [o, t(l)])} style={{ flexWrap: 'wrap' }} />}>
      {onglet === 'formations' && <Formations />}
      {onglet === 'habilitations' && <Habilitations />}
      {onglet === 'postes' && <Postes />}
      {onglet === 'destinations' && <Destinations />}
      {onglet === 'activites' && <Activites />}
      {onglet === 'horaires' && <Horaires />}
      {onglet === 'entites' && <EntitesEtSites />}
      {/* lot 12 — C4 */}
      {onglet === 'organismes' && <Organismes />}
      {onglet === 'modules' && <ModulesElearning />}
      {/* lot 12 — C5 (planning d'équipe) */}
      {onglet === 'cycles' && <Cycles />}
      {onglet === 'besoins' && <Besoins />}
    </Page>
  );
}

/**
 * Cadre commun d'un onglet : titre, nombre d'éléments, case « archivés », bouton de création ; référentiel vide :
 * explication et chargement du référentiel type.
 */
function Onglet<T extends { archive?: ISODate | null }>({ titre, liste, nature, creer, peut, vide, charger, tableau, aide }: {
  /** Nombre en vigueur, bouton de création, message « toutes archivées » (déjà traduits). */
  titre: string; liste: T[]; nature: { enVigueur: (n: number) => string; nouvelle: string; toutesArchivees: string }; creer: () => void; peut: boolean; vide: ReactNode; charger: ReactNode;
  tableau: (lignes: T[]) => ReactNode; aide: ReactNode;
}) {
  const [archives, setArchives] = useState(false);
  const enVigueur = actifs(liste), nArchives = liste.length - enVigueur.length;
  const lignes = archives ? liste : enVigueur;
  return (
    <Panel head={
      <div className="panel-head top">
        <div>
          <h2>{titre}</h2>
          <div className="text-muted sub">{nature.enVigueur(enVigueur.length)}{nArchives ? ` · ${tn(nArchives, 'archived#fem', 'archived#fem-plural')}` : ''}</div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          {nArchives > 0 && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={archives} onChange={e => setArchives(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
              {t('Show the archived ones#fem')}
            </label>
          )}
          {peut && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={creer}>{nature.nouvelle}</Btn>}
        </div>
      </div>
    }>
      {liste.length === 0
        ? <>
          <Empty pad="sm">{vide}</Empty>
          {peut && charger && <div>{charger}</div>}
        </>
        : lignes.length === 0
          ? <Empty pad="sm">{nature.toutesArchivees}</Empty>
          : <div className="scroll-x">{tableau(lignes)}</div>}
      <Fine>{aide}</Fine>
    </Panel>
  );
}

/** Boutons d'une ligne : modifier, archiver (confirmation) ou rétablir (aussitôt). */
function ActionsLigne({ archive, modifier, archiver, retablir, occupe }: {
  archive?: ISODate | null; modifier: () => void; archiver: () => void; retablir: () => void; occupe: boolean;
}) {
  return (
    <div className="actions-end" style={{ flexWrap: 'nowrap' }}>
      <Btn small onClick={modifier}>{t('Edit')}</Btn>
      {archive
        ? <Btn small disabled={occupe} onClick={retablir}>{t('Restore')}</Btn>
        : <Btn small onClick={archiver}>{t('Archive')}</Btn>}
    </div>
  );
}

function Formations() {
  const d = useDomain();
  const { formations: peut } = useRole();
  const { openDialog, run } = useStore();
  const { occupe, agir } = useAgir();
  const liste = d.ds.referentiels.formations;
  const titulaires = (f: Formation) => d.ds.employes.filter(e => e.certs.some(c => c.f === f.id)).length;
  return (
    <Onglet titre={t('Training catalogue')} liste={liste} peut={peut}
      nature={{ enVigueur: n => tn(n, 'training course in force', 'training courses in force'), nouvelle: t('New training course'), toutesArchivees: t('All training courses are archived.') }}
      creer={() => openDialog({ type: 'refFormation' })}
      vide={t('Empty catalogue: add the company’s training courses, or load the standard catalogue (first aid, electrical authorisation, ATEX, CACES, fire…) then check it.')}
      charger={<Btn variant="secondary" small onClick={() => openDialog({ type: 'confirmer', c: chargementType('formations') })}>{t('Load the standard reference data')}</Btn>}
      aide={t('The code identifies the training course in the files and with Keystone: it no longer changes after creation. A changed validity also applies to the certifications already obtained (due dates recalculated). Once archived, a training course is no longer offered nor followed; its certifications stay in the file.')}
      tableau={lignes => (
        <table className="table">
          <thead><tr><th>{t('Training#course')}</th><th>{t('Type')}</th><th>{t('Validity')}</th><th>{t('Validation')}</th><th>{t('Provider')}</th><th>{t('Cost')}</th><th>{t('Holders')}</th><th>{t('State')}</th>{peut && <th></th>}</tr></thead>
          <tbody>
            {lignes.map(f => (
              <tr key={f.id}>
                <td><Two main={f.nom} sub={`${f.court} · ${t('code ')}${f.id}`} /></td>
                {/* Passeport de prévention (lot 7, t066) : formation santé-sécurité déclarée sur la plateforme. */}
                <td className="nowrap"><Two main={f.type} sub={f.passeportPrevention ? t('Prevention passport') : undefined} /></td>
                <td className="nowrap">{validiteLabel(f.validite)}</td>
                <td>{VALIDATION_LABEL[f.validation]}</td>
                <td><Two main={f.organisme || '—'} sub={f.duree} /></td>
                <td className="nowrap">{fmtEur(f.cout)}</td>
                <td>{titulaires(f)}</td>
                <td><Etat archive={f.archive} /></td>
                {peut && (
                  <td className="right">
                    <ActionsLigne archive={f.archive} occupe={occupe}
                      modifier={() => openDialog({ type: 'refFormation', id: f.id })}
                      archiver={() => openDialog({ type: 'confirmer', c: archivageFormation(f, titulaires(f), demandesEnAttente(d.ds, 'formations', f.id)) })}
                      retablir={agir(() => run('referentiel.formation.archiver', { id: f.id, archive: false }))} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )} />
  );
}

function Habilitations() {
  const d = useDomain();
  const { formations: peut } = useRole();
  const { openDialog, run } = useStore();
  const { occupe, agir } = useAgir();
  const liste = d.ds.referentiels.habilitations;
  const titres = (h: HabType) => d.ds.employes.filter(e => e.habs.some(t => t.h === h.id && t.delivree)).length;
  const sansFormation = d.ds.referentiels.formations.length === 0;
  return (
    <Onglet titre={t('Authorisations')} liste={liste} peut={peut}
      nature={{ enVigueur: n => tn(n, 'authorisation in force', 'authorisations in force'), nouvelle: t('New authorisation'), toutesArchivees: t('All authorisations are archived.') }}
      creer={() => openDialog({ type: 'refHabilitation' })}
      vide={sansFormation
        ? t('No authorisation. First load the training catalogue (Training tab): the standard authorisations require some as prerequisites.')
        : t('No authorisation: add the company’s ones, or load the standard reference data (electrical, machine driving, ATEX, work at height, AIPR) then check it.')}
      charger={sansFormation ? null : <Btn variant="secondary" small onClick={() => openDialog({ type: 'confirmer', c: chargementType('habilitations') })}>{t('Load the standard reference data')}</Btn>}
      aide={t('Prerequisites are taken from the training catalogue; the signatory is offered at each issue. Validity, prerequisites and fitness also apply to the titles already issued. Once archived, an authorisation is no longer offered nor followed; its titles stay in the file and in the Go / No Go.')}
      tableau={lignes => (
        <table className="table">
          <thead><tr><th>{t('Authorisation')}</th><th>{t('Prerequisites')}</th><th>{t('Validity')}</th><th>{t('Default signatory')}</th><th>{t('Titles')}</th><th>{t('State')}</th>{peut && <th></th>}</tr></thead>
          <tbody>
            {lignes.map(h => (
              <tr key={h.id}>
                <td><Two main={h.nom} sub={[h.detail, `${t('code ')}${h.id}`].filter(Boolean).join(' · ')} /></td>
                <td>
                  <Chips items={[
                    ...h.prereqs.map(f => ({ key: f, label: d.fm(f)?.court ?? f, cls: actif(d.fm(f)) ? 'tag-neutral' : 'tag-outline' })),
                    ...(h.medical ? [{ key: 'med', label: t('Medical fitness'), cls: 'tag-neutral' }] : []),
                    ...(h.sir ? [{ key: 'sir', label: t('Enhanced monitoring'), cls: 'tag-neutral' }] : []),
                  ]} />
                  {!h.prereqs.length && !h.medical && !h.sir && <span className="text-muted">{t('None')}</span>}
                </td>
                <td className="nowrap">{validiteLabel(h.validite)}</td>
                <td>{h.signataire}</td>
                <td>{titres(h)}</td>
                <td><Etat archive={h.archive} /></td>
                {peut && (
                  <td className="right">
                    <ActionsLigne archive={h.archive} occupe={occupe}
                      modifier={() => openDialog({ type: 'refHabilitation', id: h.id })}
                      archiver={() => openDialog({ type: 'confirmer', c: archivageHabilitation(h, titres(h), { demandes: demandesEnAttente(d.ds, 'habilitations', h.id), aDelivrer: titresADelivrer(d.ds, h.id) }) })}
                      retablir={agir(() => run('referentiel.habilitation.archiver', { id: h.id, archive: false }))} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )} />
  );
}

function Destinations() {
  const d = useDomain();
  const { rh: peut } = useRole();
  const { openDialog, run } = useStore();
  const { occupe, agir } = useAgir();
  const liste = d.ds.referentiels.destinations;
  const prevus = (x: Destination) => d.ds.voyages.filter(v => v.dest === x.code && v.retour >= d.ti && !v.annuleLe).length;
  return (
    <Onglet titre={t('Destinations')} liste={liste} peut={peut}
      nature={{ enVigueur: n => tn(n, 'destination in force', 'destinations in force'), nouvelle: t('New destination'), toutesArchivees: t('All destinations are archived.') }}
      creer={() => openDialog({ type: 'refDestination' })}
      vide={t('No destination: add the countries the employees travel to, or load the demonstration destinations then check them.')}
      charger={<Btn variant="secondary" small onClick={() => openDialog({ type: 'confirmer', c: chargementType('destinations') })}>{t('Load the standard reference data')}</Btn>}
      aide={t('Indicative data kept by HR — to be checked on France Diplomatie, with an international vaccination centre and, for social security, on cleiss.fr. The travel files follow any change; once archived, a destination is no longer offered for a new trip.')}
      tableau={lignes => (
        <table className="table">
          <thead><tr><th>{t('Country')}</th><th>{t('Entry')}</th><th>{t('Mandatory vaccine')}</th><th>{t('Recommended vaccines')}</th><th>{t('Passport')}</th><th>{t('Social security')}</th><th>{t('Trips#column')}</th><th>{t('State')}</th>{peut && <th></th>}</tr></thead>
          <tbody>
            {lignes.map(x => {
              const rule = VISA_RULES[x.visa], secu = SECU_RULES[secuDe(x)];
              return (
                <tr key={x.code}>
                  <td><Two nowrap main={x.pays} sub={x.code} /></td>
                  <td><Two nowrap main={rule.label} sub={x.visaSub || rule.sub} /></td>
                  <td>{x.oblig.length ? d.vaccinNames(x.oblig) : '—'}</td>
                  <td className="text-muted">{d.vaccinNames([...x.rec, 'dtp'])}</td>
                  <td className="text-muted">{x.passMois ? `${x.passMois}${t(' months after entry')}` : t('Valid during the stay')}</td>
                  <td><Two main={secu.label} sub={x.secu ? '' : t('according to the country code')} /></td>
                  <td>{prevus(x)}</td>
                  <td><Etat archive={x.archive} /></td>
                  {peut && (
                    <td className="right">
                      <ActionsLigne archive={x.archive} occupe={occupe}
                        modifier={() => openDialog({ type: 'refDestination', code: x.code })}
                        archiver={() => openDialog({ type: 'confirmer', c: archivageDestination(x, prevus(x)) })}
                        retablir={agir(() => run('referentiel.destination.archiver', { id: x.code, archive: false }))} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )} />
  );
}
