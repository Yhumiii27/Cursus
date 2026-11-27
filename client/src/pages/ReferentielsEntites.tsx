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
import { fmt } from '../../../shared/format.ts';
import { t, tn } from '../i18n/langue.ts';
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
          <h2>{t('Entities')}</h2>
          <div className="text-muted sub">{tn(ouvertes.length, 'open entity', 'open entities')}{nFermees ? ` · ${tn(nFermees, 'closed#fem', 'closed#fem-plural')}` : ''}</div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          {nFermees > 0 && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={fermees} onChange={e => setFermees(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
              {t('Show the closed ones#fem')}
            </label>
          )}
          {rh && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'refEntite' })}>{t('New entity')}</Btn>}
        </div>
      </div>
    }>
      {lignes.length === 0 ? <Empty pad="sm">{t('No entity: it is created with the first team, under the company name of the data controller (Settings → Privacy).')}</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>{t('Entity')}</th><th>{t('Type')}</th><th>{t('SIREN / SIRET')}</th><th>{t('IDCC')}</th><th>{t('Site')}</th><th className="right">{t('Teams')}</th><th>{t('State')}</th>{(rh || admin) && <th></th>}</tr></thead>
            <tbody>
              {lignes.map(x => {
                const equipes = equipesDeLEntite(r.equipes, x.code);
                const societe = x.type === 'etablissement' ? entiteDe(toutes, x.parente) : undefined;
                const matrix = x.source === 'matrix';
                return (
                  <tr key={x.code}>
                    <td><Two main={x.type === 'etablissement' ? <>— {x.nom}</> : x.nom} sub={`${t('code ')}${x.code}${societe ? `${t(' · company ')}${societe.nom}` : ''}${matrix ? t(' · kept by Matrix') : ''}`} /></td>
                    <td className="nowrap">{TYPES_ENTITE[x.type]}</td>
                    <td className="nowrap tnum">{x.type === 'societe'
                      ? <Two main={x.siren ? formaterSiren(x.siren) : <span className="text-muted">{t('SIREN to enter')}</span>} sub={x.siret ? `${t('head office ')}${formaterSiren(x.siret)}` : undefined} />
                      : x.siret ? formaterSiren(x.siret) : <span className="text-muted">{t('SIRET to enter')}</span>}</td>
                    <td className="tnum">{x.idcc ?? <span className="text-muted">—</span>}</td>
                    <td>{x.siteCode ? sites.find(s => s.code === x.siteCode)?.libelle ?? x.siteCode : <span className="text-muted">—</span>}</td>
                    <td className="right tnum" title={equipes.join(', ') || undefined}>{equipes.length}</td>
                    <td>{entiteOuverte(x) ? <Tag cls="tag-neutral">{t('Open#fem')}</Tag> : <Tag cls="tag-outline">{x.fermeLe ? `${t('Closed on #fem')}${fmt(parse(x.fermeLe))}` : t('Closed#fem')}</Tag>}</td>
                    {(rh || admin) && (
                      <td className="right">
                        {!matrix && (
                          <div className="actions-end" style={{ flexWrap: 'nowrap' }}>
                            {rh && <Btn small onClick={() => openDialog({ type: 'refEntite', code: x.code })}>{t('Edit')}</Btn>}
                            {admin && (entiteOuverte(x)
                              ? <Btn small onClick={() => openDialog({ type: 'confirmer', c: fermetureEntite(x) })}>{t('Close#verb')}</Btn>
                              : <Btn small disabled={occupe} onClick={agir(() => run('entite.rouvrir', { code: x.code }))}>{t('Reopen')}</Btn>)}
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
        {t('Two levels: the company (SIREN, IDCC of the collective agreement) and its establishments (SIRET, which starts with the company’s SIREN). SIREN and SIRET are checked by their key; they are public data (SIRENE register). A root team belongs to an entity and its attached teams inherit it (Teams & managers): no approver changes. The code and the type no longer change after creation; an entity is never deleted, it is closed when no team belongs to it any more. This reference data will be taken over from Matrix (common reference data), of which Cursus will keep a copy.')}
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
          <h2>{t('Attachment sites')}</h2>
          <div className="text-muted sub">{tn(actifs, 'active site', 'active sites')}{sites.length > actifs ? ` · ${tn(sites.length - actifs, 'inactive', 'inactive#plural')}` : ''}</div>
        </div>
        {rh && <div className="actions-end"><Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'refSite' })}>{t('New site')}</Btn></div>}
      </div>
    }>
      {sites.length === 0 ? <Empty pad="sm">{t('No site: add the sites of the common reference data (Matrix code) to attach the teams and filter the organisation chart.')}</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>{t('Site')}</th><th className="right">{t('Teams')}</th><th className="right">{t('Entities')}</th><th>{t('State')}</th>{rh && <th></th>}</tr></thead>
            <tbody>
              {sites.map(s => {
                const equipes = r.equipes.filter(q => siteEffectif(r.equipes, entites, q.nom) === s.code).length;
                return (
                  <tr key={s.code}>
                    <td><Two main={s.libelle} sub={`${t('code ')}${s.code}`} /></td>
                    <td className="right tnum">{equipes}</td>
                    <td className="right tnum">{entites.filter(x => x.siteCode === s.code).length}</td>
                    <td>{s.actif ? <Tag cls="tag-neutral">{t('Active')}</Tag> : <Tag cls="tag-outline">{t('Inactive')}</Tag>}</td>
                    {rh && <td className="right"><Btn small onClick={() => openDialog({ type: 'refSite', code: s.code })}>{t('Edit')}</Btn></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Fine>
        {t('Copy of the sites of Matrix’s common reference data (stable code, label), kept here by hand as long as Matrix does not provide it. An employee’s site is that of their team, of a team above or, failing that, of their entity; it is recalculated at each assignment and sent to Matrix with the sheet. An inactive site is no longer offered; the teams that carry it keep it.')}
      </Fine>
    </Panel>
  );
}
