// Écran Référentiels, onglet Entités et sites (lot 11, chantier C1, étape 2 ; shared/rules/entites.ts) : sociétés et
// établissements au-dessus des équipes (SIREN, SIRET, IDCC dont ont besoin l'OPCO, les indicateurs et les frais), et
// sites de rattachement (cache de matrix.pub_sites, tenu à la main tant que Matrix ne le fournit pas).
// - Service RH : création et modification (dialogs/RefEntiteDialog.tsx, dialogs/RefSiteDialog.tsx) ; administrateur RH :
//   fermeture (confirmée ; refusée tant que l'entité porte des équipes ou des établissements ouverts) et réouverture.
//   Une entité tenue par Matrix (`source = 'matrix'`) se consulte seulement. La lecture seule et le référent HSE consultent.
// - Rattachement des équipes : écran Équipes & managers (une équipe racine porte l'entité, ses équipes rattachées en
//   héritent ; aucun valideur ne change).
import { useState } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { parse } from '../../../shared/dates.ts';
import { fmt, plural } from '../../../shared/format.ts';
import { entiteDe, entiteOuverte, equipesDeLEntite, TYPES_ENTITE } from '../../../shared/rules/entites.ts';
import type { Entite } from '../../../shared/types.ts';
import { Btn, Empty, Fine, Panel, Tag, Two } from '../components/ui.tsx';
import { formaterSiren, siteEffectif } from '../organigramme-vue.ts';
import { useAgir } from '../state/actions.ts';
import { fermetureEntite } from '../state/confirmations-entites.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';


export function EntitesEtSites() {
  return (
    <>
      <Entites />
      <Sites />
    </>
  );
}

/** Ordre d'affichage : chaque société suivie de ses établissements, puis les établissements dont la société manque. */
function ordonner(entites: readonly Entite[]): Entite[] {
  const tri = [...entites].sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom, 'fr'));
  const societes = tri.filter(x => x.type === 'societe');
  const vus = new Set<string>();
  const out: Entite[] = [];
  for (const s of societes) {
    out.push(s); vus.add(s.code);
    for (const e of tri.filter(x => x.type === 'etablissement' && x.parente === s.code)) { out.push(e); vus.add(e.code); }
  }
  return [...out, ...tri.filter(x => !vus.has(x.code))];
}

function Entites() {
  const d = useDomain();
  const { rh, admin } = useRole();
  const { openDialog, run } = useStore();
  const { occupe, agir } = useAgir();
  const [fermees, setFermees] = useState(false);
  const r = d.ds.referentiels;
  const toutes = ordonner(r.entites ?? []);
  const ouvertes = toutes.filter(entiteOuverte), nFermees = toutes.length - ouvertes.length;
  const lignes = fermees ? toutes : ouvertes;
  const sites = r.sites ?? [];
  return (
    <Panel head={
      <div className="panel-head top">
        <div>
          <h2>Entités</h2>
          <div className="text-muted sub">{plural(ouvertes.length, 'entité ouverte', 'entités ouvertes')}{nFermees ? ` · ${plural(nFermees, 'fermée', 'fermées')}` : ''}</div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          {nFermees > 0 && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={fermees} onChange={e => setFermees(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
              Afficher les fermées
            </label>
          )}
          {rh && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'refEntite' })}>Nouvelle entité</Btn>}
        </div>
      </div>
    }>
      {lignes.length === 0 ? <Empty pad="sm">Aucune entité : elle est créée avec la première équipe, sous la raison sociale du responsable du traitement (Paramètres → Confidentialité).</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Entité</th><th>Type</th><th>SIREN / SIRET</th><th>IDCC</th><th>Site</th><th className="right">Équipes</th><th>État</th>{(rh || admin) && <th></th>}</tr></thead>
            <tbody>
              {lignes.map(x => {
                const equipes = equipesDeLEntite(r.equipes, x.code);
                const societe = x.type === 'etablissement' ? entiteDe(toutes, x.parente) : undefined;
                const matrix = x.source === 'matrix';
                return (
                  <tr key={x.code}>
                    <td><Two main={x.type === 'etablissement' ? <>— {x.nom}</> : x.nom} sub={`code ${x.code}${societe ? ` · société ${societe.nom}` : ''}${matrix ? ' · tenue par Matrix' : ''}`} /></td>
                    <td className="nowrap">{TYPES_ENTITE[x.type]}</td>
                    <td className="nowrap tnum">{x.type === 'societe'
                      ? <Two main={x.siren ? formaterSiren(x.siren) : <span className="text-muted">SIREN à saisir</span>} sub={x.siret ? `siège ${formaterSiren(x.siret)}` : undefined} />
                      : x.siret ? formaterSiren(x.siret) : <span className="text-muted">SIRET à saisir</span>}</td>
                    <td className="tnum">{x.idcc ?? <span className="text-muted">—</span>}</td>
                    <td>{x.siteCode ? sites.find(s => s.code === x.siteCode)?.libelle ?? x.siteCode : <span className="text-muted">—</span>}</td>
                    <td className="right tnum" title={equipes.join(', ') || undefined}>{equipes.length}</td>
                    <td>{entiteOuverte(x) ? <Tag cls="tag-neutral">Ouverte</Tag> : <Tag cls="tag-outline">{x.fermeLe ? `Fermée le ${fmt(parse(x.fermeLe))}` : 'Fermée'}</Tag>}</td>
                    {(rh || admin) && (
                      <td className="right">
                        {!matrix && (
                          <div className="actions-end" style={{ flexWrap: 'nowrap' }}>
                            {rh && <Btn small onClick={() => openDialog({ type: 'refEntite', code: x.code })}>Modifier</Btn>}
                            {admin && (entiteOuverte(x)
                              ? <Btn small onClick={() => openDialog({ type: 'confirmer', c: fermetureEntite(x) })}>Fermer</Btn>
                              : <Btn small disabled={occupe} onClick={agir(() => run('entite.rouvrir', { code: x.code }))}>Rouvrir</Btn>)}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Fine>
        Deux niveaux : la société (SIREN, IDCC de la convention collective) et ses établissements (SIRET, qui commence par le SIREN de la société).
        SIREN et SIRET sont contrôlés par leur clé ; ce sont des données publiques (répertoire SIRENE). Une équipe racine relève d’une entité et ses
        équipes rattachées en héritent (Équipes & managers) : aucun valideur ne change. Le code et le type ne changent plus après la création ; une
        entité n’est jamais supprimée, elle se ferme quand plus aucune équipe n’en relève. Ce référentiel sera repris de Matrix (référentiel commun),
        dont Cursus gardera une copie.
      </Fine>
    </Panel>
  );
}

function Sites() {
  const d = useDomain();
  const { rh } = useRole();
  const { openDialog } = useStore();
  const r = d.ds.referentiels;
  const sites = [...(r.sites ?? [])].sort((a, b) => a.ordre - b.ordre || a.libelle.localeCompare(b.libelle, 'fr'));
  const entites = r.entites ?? [];
  const actifs = sites.filter(s => s.actif).length;
  return (
    <Panel head={
      <div className="panel-head top">
        <div>
          <h2>Sites de rattachement</h2>
          <div className="text-muted sub">{plural(actifs, 'site actif', 'sites actifs')}{sites.length > actifs ? ` · ${plural(sites.length - actifs, 'inactif', 'inactifs')}` : ''}</div>
        </div>
        {rh && <div className="actions-end"><Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'refSite' })}>Nouveau site</Btn></div>}
      </div>
    }>
      {sites.length === 0 ? <Empty pad="sm">Aucun site : ajoutez les sites du référentiel commun (code de Matrix) pour rattacher les équipes et filtrer l’organigramme.</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Site</th><th className="right">Équipes</th><th className="right">Entités</th><th>État</th>{rh && <th></th>}</tr></thead>
            <tbody>
              {sites.map(s => {
                const equipes = r.equipes.filter(q => siteEffectif(r.equipes, entites, q.nom) === s.code).length;
                return (
                  <tr key={s.code}>
                    <td><Two main={s.libelle} sub={`code ${s.code}`} /></td>
                    <td className="right tnum">{equipes}</td>
                    <td className="right tnum">{entites.filter(x => x.siteCode === s.code).length}</td>
                    <td>{s.actif ? <Tag cls="tag-neutral">Actif</Tag> : <Tag cls="tag-outline">Inactif</Tag>}</td>
                    {rh && <td className="right"><Btn small onClick={() => openDialog({ type: 'refSite', code: s.code })}>Modifier</Btn></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Fine>
        Copie des sites du référentiel commun de Matrix (code stable, libellé), tenue ici à la main tant que Matrix ne la fournit pas. Le site d’un
        salarié est celui de son équipe, d’une équipe au-dessus ou, à défaut, de son entité ; il est recalculé à chaque affectation et transmis à Matrix
        avec la fiche. Un site inactif n’est plus proposé ; les équipes qui le portent le gardent.
      </Fine>
    </Panel>
  );
}
