// lot 12 — C4 (organismes de formation et e-learning) : onglet Modules e-learning de l'écran Référentiels. Catalogue des
// modules suivis hors de Cursus (pas de plateforme embarquée, ni SCORM ni xAPI) : code, intitulé, organisme, formation
// du catalogue dont l'achèvement produit la certification, durée, langue, coût d'une licence (droit « formations »),
// validité de l'accès, attestation exigée. Le lien d'accès (https seulement) s'ouvre dans un nouvel onglet, jamais dans
// un cadre. Création, modification et archivage : droit « formations » ; la lecture seule consulte.
import { useState } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { fmtEur, fmtIso, plural } from '../../../shared/format.ts';
import { inscriptionOuverte, LANGUES_MODULE } from '../../../shared/rules/elearning.ts';
import { organismeFinal } from '../../../shared/rules/organismes.ts';
import type { ModuleElearning } from '../../../shared/types-organismes.ts';
import { Btn, Empty, Fine, Panel, Tag, Two } from '../components/ui.tsx';
import { useAgir } from '../state/actions.ts';
import { archivageModule } from '../state/confirmations-organismes.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function ModulesElearning() {
  const d = useDomain();
  const { openDialog, run } = useStore();
  const { formations } = useRole();
  const { occupe, agir } = useAgir();
  const [archives, setArchives] = useState(false);
  const liste = [...(d.ds.modulesElearning ?? [])].sort((a, b) => a.code.localeCompare(b.code));
  const enVigueur = liste.filter(m => !m.archive);
  const lignes = archives ? liste : enVigueur;
  const ouvertes = (m: ModuleElearning) => (d.ds.inscriptionsElearning ?? []).filter(i => i.moduleId === m.id && inscriptionOuverte(i)).length;
  const terminees = (m: ModuleElearning) => (d.ds.inscriptionsElearning ?? []).filter(i => i.moduleId === m.id && !i.annuleLe && i.statut === 'termine').length;
  return (
    <Panel head={
      <div className="panel-head top">
        <div>
          <h2>Modules e-learning</h2>
          <div className="text-muted sub">{plural(enVigueur.length, 'module en vigueur', 'modules en vigueur')}{liste.length > enVigueur.length ? ` · ${plural(liste.length - enVigueur.length, 'archivé', 'archivés')}` : ''}</div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          {liste.length > enVigueur.length && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={archives} onChange={e => setArchives(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
              Afficher les archivés
            </label>
          )}
          {formations && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'moduleElearning' })}>Nouveau module</Btn>}
        </div>
      </div>
    }>
      {lignes.length === 0 ? <Empty pad="sm">{liste.length ? 'Tous les modules sont archivés.' : 'Aucun module d’e-learning : ajoutez ceux que proposent vos organismes (lien d’accès, durée, formation du catalogue validée).'}</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Module</th><th>Organisme</th><th>Formation validée</th><th>Durée</th><th>Accès</th>{formations && <th className="right">Licence</th>}<th>Inscrits</th><th>État</th>{formations && <th></th>}</tr></thead>
            <tbody>
              {lignes.map(m => {
                const o = organismeFinal(d.ds.organismes, m.organismeId) ?? d.ds.referentiels.organismes?.find(x => x.id === m.organismeId);
                return (
                  <tr key={m.id}>
                    <td style={{ minWidth: 200 }}>
                      {/* Lien d'accès : nouvel onglet, sans transmettre la page d'origine (jamais dans un cadre). */}
                      <Two main={<a href={m.url} target="_blank" rel="noopener noreferrer">{m.intitule}</a>} sub={`${m.code} · ${LANGUES_MODULE[m.langue] ?? m.langue}${m.attestationRequise ? ' · attestation exigée' : ''}`} />
                    </td>
                    <td>{o?.nomUsuel ?? '—'}</td>
                    <td>{m.formation ? d.fm(m.formation)?.court ?? m.formation : '—'}</td>
                    <td className="nowrap">{m.dureeHeures != null ? `${String(m.dureeHeures).replace('.', ',')} h` : '—'}</td>
                    <td className="nowrap">{m.accesMois ? `${m.accesMois} mois` : 'sans limite'}</td>
                    {formations && <td className="right tnum nowrap">{m.coutLicence != null ? fmtEur(m.coutLicence) : '—'}</td>}
                    <td className="tnum nowrap">{ouvertes(m)} en cours · {terminees(m)} terminés</td>
                    <td>{m.archive ? <Tag cls="tag-outline">Archivé le {fmtIso(m.archive)}</Tag> : <Tag cls="tag-neutral">En vigueur</Tag>}</td>
                    {formations && (
                      <td className="right">
                        <div className="actions-end" style={{ flexWrap: 'nowrap' }}>
                          <Btn small onClick={() => openDialog({ type: 'moduleElearning', id: m.id })}>Modifier</Btn>
                          {m.archive
                            ? <Btn small disabled={occupe} onClick={agir(() => run('elearning.module.archiver', { id: m.id, archive: false }))}>Rétablir</Btn>
                            : <Btn small onClick={() => openDialog({ type: 'confirmer', c: archivageModule(m, ouvertes(m)) })}>Archiver</Btn>}
                        </div>
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
        Pas de plateforme intégrée : le lien s’ouvre chez l’organisme. Le suivi se limite au statut, à l’avancement déclaré ou importé, à la date de fin et à
        la réussite, sans temps de connexion. La fin d’un module, validée par le service RH, crée la formation suivie et, pour un module rattaché au catalogue,
        la certification. Inscriptions et import : écran Formations, onglet E-learning.
      </Fine>
    </Panel>
  );
}
