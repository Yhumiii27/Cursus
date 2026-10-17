// Référentiels : catalogue des formations, habilitations et destinations de l'entreprise. Le service RH et le référent
// HSE / formation tiennent les formations et les habilitations, le service RH les destinations ; la lecture seule
// consulte. Création, modification (dialogues Ref*Dialog), archivage au lieu de la suppression (confirmé, rétabli d'un
// clic), référentiel type à charger dans un référentiel vide, à vérifier ensuite. Règles : shared/rules/referentiels.ts.
// Onglet Postes (formations et habilitations exigées par poste et par équipe) : pages/ReferentielsPostes.tsx.
import { useState, type ReactNode } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { SECU_RULES, VALIDATION_LABEL, VISA_RULES, secuDe } from '../../../shared/constants.ts';
import { parse } from '../../../shared/dates.ts';
import { fmt, fmtEur, plural, validiteLabel } from '../../../shared/format.ts';
import { actif, actifs, demandesEnAttente, titresADelivrer, type ReferentielId } from '../../../shared/rules/referentiels.ts';
import type { Destination, Formation, HabType, ISODate } from '../../../shared/types.ts';
import { Btn, Chips, Empty, Fine, Page, Panel, Seg, Tag, Two } from '../components/ui.tsx';
import { useAgir } from '../state/actions.ts';
import { archivageDestination, archivageFormation, archivageHabilitation, chargementType } from '../state/confirmations-referentiels.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Postes } from './ReferentielsPostes.tsx';

const ONGLETS: [ReferentielId | 'postes', string][] = [['formations', 'Formations'], ['habilitations', 'Habilitations'], ['postes', 'Postes'], ['destinations', 'Destinations']];

/** État d'un élément : en vigueur, ou archivé (date). */
const Etat = ({ archive }: { archive?: ISODate | null }) => (archive
  ? <Tag cls="tag-outline">Archivée le {fmt(parse(archive))}</Tag>
  : <Tag cls="tag-neutral">En vigueur</Tag>);

export function Referentiels() {
  const d = useDomain();
  const { ui, setUi } = useStore();
  const r = d.ds.referentiels;
  const kicker = [
    plural(actifs(r.formations).length, 'formation', 'formations'),
    plural(actifs(r.habilitations).length, 'habilitation', 'habilitations'),
    plural(actifs(r.postes).length, 'poste', 'postes'),
    plural(actifs(r.destinations).length, 'destination', 'destinations'),
  ].join(' · ') + ' en vigueur';
  return (
    <Page kicker={kicker} title="Référentiels"
      actions={<Seg name="refOnglet" label="Référentiel" value={ui.refOnglet} onChange={x => setUi({ refOnglet: x })} options={ONGLETS} />}>
      {ui.refOnglet === 'formations' && <Formations />}
      {ui.refOnglet === 'habilitations' && <Habilitations />}
      {ui.refOnglet === 'postes' && <Postes />}
      {ui.refOnglet === 'destinations' && <Destinations />}
    </Page>
  );
}

/**
 * Cadre commun d'un onglet : titre, nombre d'éléments, case « archivés », bouton de création ; référentiel vide :
 * explication et chargement du référentiel type.
 */
function Onglet<T extends { archive?: ISODate | null }>({ titre, liste, nature, creer, peut, vide, charger, tableau, aide }: {
  titre: string; liste: T[]; nature: [string, string]; creer: () => void; peut: boolean; vide: ReactNode; charger: ReactNode;
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
          <div className="text-muted sub">{plural(enVigueur.length, `${nature[0]} en vigueur`, `${nature[1]} en vigueur`)}{nArchives ? ` · ${plural(nArchives, 'archivée', 'archivées')}` : ''}</div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          {nArchives > 0 && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={archives} onChange={e => setArchives(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
              Afficher les archivées
            </label>
          )}
          {peut && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={creer}>{`Nouvelle ${nature[0]}`}</Btn>}
        </div>
      </div>
    }>
      {liste.length === 0
        ? <>
          <Empty pad="sm">{vide}</Empty>
          {peut && charger && <div>{charger}</div>}
        </>
        : lignes.length === 0
          ? <Empty pad="sm">{`Toutes les ${nature[1]} sont archivées.`}</Empty>
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
      <Btn small onClick={modifier}>Modifier</Btn>
      {archive
        ? <Btn small disabled={occupe} onClick={retablir}>Rétablir</Btn>
        : <Btn small onClick={archiver}>Archiver</Btn>}
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
    <Onglet titre="Catalogue des formations" liste={liste} nature={['formation', 'formations']} peut={peut}
      creer={() => openDialog({ type: 'refFormation' })}
      vide="Catalogue vide : ajoutez les formations de l’entreprise, ou chargez le catalogue type (SST, habilitation électrique, ATEX, CACES, incendie…) puis vérifiez-le."
      charger={<Btn variant="secondary" small onClick={() => openDialog({ type: 'confirmer', c: chargementType('formations') })}>Charger le référentiel type</Btn>}
      aide="Le code identifie la formation dans les dossiers et auprès de Keystone : il ne change plus après la création. Une validité modifiée vaut aussi pour les certifications déjà obtenues (échéances recalculées). Archivée, une formation n’est plus proposée ni suivie ; ses certifications restent au dossier."
      tableau={lignes => (
        <table className="table">
          <thead><tr><th>Formation</th><th>Type</th><th>Validité</th><th>Validation</th><th>Organisme</th><th>Coût</th><th>Titulaires</th><th>État</th>{peut && <th></th>}</tr></thead>
          <tbody>
            {lignes.map(f => (
              <tr key={f.id}>
                <td><Two main={f.nom} sub={`${f.court} · code ${f.id}`} /></td>
                <td className="nowrap">{f.type}</td>
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
    <Onglet titre="Habilitations" liste={liste} nature={['habilitation', 'habilitations']} peut={peut}
      creer={() => openDialog({ type: 'refHabilitation' })}
      vide={sansFormation
        ? 'Aucune habilitation. Chargez d’abord le catalogue des formations (onglet Formations) : les habilitations type en exigent comme prérequis.'
        : 'Aucune habilitation : ajoutez celles de l’entreprise, ou chargez le référentiel type (électrique, conduite d’engins, ATEX, travaux en hauteur, AIPR) puis vérifiez-le.'}
      charger={sansFormation ? null : <Btn variant="secondary" small onClick={() => openDialog({ type: 'confirmer', c: chargementType('habilitations') })}>Charger le référentiel type</Btn>}
      aide="Les prérequis sont pris dans le catalogue des formations ; le signataire est proposé à chaque délivrance. Validité, prérequis et aptitude valent aussi pour les titres déjà délivrés. Archivée, une habilitation n’est plus proposée ni suivie ; ses titres restent au dossier et dans le Go / No Go."
      tableau={lignes => (
        <table className="table">
          <thead><tr><th>Habilitation</th><th>Prérequis</th><th>Validité</th><th>Signataire par défaut</th><th>Titres</th><th>État</th>{peut && <th></th>}</tr></thead>
          <tbody>
            {lignes.map(h => (
              <tr key={h.id}>
                <td><Two main={h.nom} sub={[h.detail, `code ${h.id}`].filter(Boolean).join(' · ')} /></td>
                <td>
                  <Chips items={[
                    ...h.prereqs.map(f => ({ key: f, label: d.fm(f)?.court ?? f, cls: actif(d.fm(f)) ? 'tag-neutral' : 'tag-outline' })),
                    ...(h.medical ? [{ key: 'med', label: 'Aptitude médicale', cls: 'tag-neutral' }] : []),
                    ...(h.sir ? [{ key: 'sir', label: 'Suivi renforcé', cls: 'tag-neutral' }] : []),
                  ]} />
                  {!h.prereqs.length && !h.medical && !h.sir && <span className="text-muted">Aucun</span>}
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
    <Onglet titre="Destinations" liste={liste} nature={['destination', 'destinations']} peut={peut}
      creer={() => openDialog({ type: 'refDestination' })}
      vide="Aucune destination : ajoutez les pays où partent les salariés, ou chargez les destinations de la démonstration puis vérifiez-les."
      charger={<Btn variant="secondary" small onClick={() => openDialog({ type: 'confirmer', c: chargementType('destinations') })}>Charger le référentiel type</Btn>}
      aide="Données indicatives tenues par le service RH — à vérifier sur France Diplomatie, auprès d’un centre de vaccinations internationales et, pour la sécurité sociale, sur cleiss.fr. Les dossiers voyage suivent toute modification ; archivée, une destination n’est plus proposée pour un nouveau déplacement."
      tableau={lignes => (
        <table className="table">
          <thead><tr><th>Pays</th><th>Entrée</th><th>Vaccin obligatoire</th><th>Vaccins recommandés</th><th>Passeport</th><th>Sécurité sociale</th><th>Déplacements</th><th>État</th>{peut && <th></th>}</tr></thead>
          <tbody>
            {lignes.map(x => {
              const rule = VISA_RULES[x.visa], secu = SECU_RULES[secuDe(x)];
              return (
                <tr key={x.code}>
                  <td><Two nowrap main={x.pays} sub={x.code} /></td>
                  <td><Two nowrap main={rule.label} sub={x.visaSub || rule.sub} /></td>
                  <td>{x.oblig.length ? d.vaccinNames(x.oblig) : '—'}</td>
                  <td className="text-muted">{d.vaccinNames([...x.rec, 'dtp'])}</td>
                  <td className="text-muted">{x.passMois ? `${x.passMois} mois après l’entrée` : 'Valide pendant le séjour'}</td>
                  <td><Two main={secu.label} sub={x.secu ? '' : 'selon le code pays'} /></td>
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
