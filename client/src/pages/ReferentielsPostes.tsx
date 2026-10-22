// Écran Référentiels, onglet Postes (t055) : postes et formations ou habilitations exigées, exigences communes à toute
// une équipe. Le service RH les tient ; le référent HSE et la lecture seule consultent. Aucune exigence n'est créée
// d'office : tant qu'un poste n'en a pas, le statut de ses titulaires ne change pas. Règles : shared/rules/exigences.ts.
import { useMemo, useState } from 'react';
import { PlusIcon, PrinterIcon } from '@phosphor-icons/react';
import { parse } from '../../../shared/dates.ts';
import { fmt, plural } from '../../../shared/format.ts';
import { exigencesEquipe, nombreExigences, posteDe, titulaires } from '../../../shared/rules/exigences.ts';
import { actif, actifs } from '../../../shared/rules/referentiels.ts';
import { avertissementRenforcee, postesARisques, raisonsDExaminer } from '../../../shared/rules/formation-renforcee.ts';
import { imprimerPostesARisques } from '../postes-risques.ts';
import { CouvertureCellule } from '../components/Couverture.tsx';
import type { Exigences } from '../../../shared/types.ts';
import { Btn, Chips, Empty, Fine, NoteAccent, Panel, Tag, Two } from '../components/ui.tsx';
import { useAgir } from '../state/actions.ts';
import { archivagePoste } from '../state/confirmations-referentiels.ts';
import { useEnriched, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Formations et habilitations exigées, en étiquettes ; un élément archivé (plus exigé) en contour. */
function ExigencesChips({ x }: { x: Exigences }) {
  const { d } = useEnriched();
  if (!nombreExigences(x)) return <span className="text-muted">Aucune</span>;
  return (
    <Chips items={[
      ...x.formations.map(f => ({ key: `f-${f}`, label: d.fm(f)?.court ?? f, cls: actif(d.fm(f)) ? 'tag-neutral' : 'tag-outline' })),
      ...x.habilitations.map(h => ({ key: `h-${h}`, label: d.hm(h)?.nom ?? h, cls: actif(d.hm(h)) ? 'tag-neutral' : 'tag-outline' })),
    ]} />
  );
}

export function Postes() {
  const { d, emps } = useEnriched();
  const { rh: peut } = useRole();
  const { openDialog, run } = useStore();
  const { occupe, agir } = useAgir();
  const [archives, setArchives] = useState(false);
  const liste = useMemo(() => [...d.ds.referentiels.postes].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')), [d]);
  const enVigueur = actifs(liste), nArchives = liste.length - enVigueur.length;
  const lignes = archives ? liste : enVigueur;
  // Titulaires présents à qui il manque une exigence (du poste ou de leur équipe).
  const nonConformes = (id: number) => emps.filter(e => posteDe(d.ds, e)?.id === id && e.manquants.length).length;
  const sansExigence = enVigueur.filter(p => !nombreExigences(p)).length;
  // Postes à risques particuliers (art. L4154-2) : liste imprimable, formation renforcée désignée dans Paramètres.
  const aRisques = postesARisques(liste).length, renforcee = aRisques ? avertissementRenforcee(d.ds) : null;

  return <>
    <Panel head={
      <div className="panel-head top">
        <div>
          <h2>Postes et exigences</h2>
          <div className="text-muted sub">
            {plural(enVigueur.length, 'poste en vigueur', 'postes en vigueur')}{nArchives ? ` · ${plural(nArchives, 'archivé', 'archivés')}` : ''}
            {sansExigence ? ` · ${plural(sansExigence, 'sans exigence', 'sans exigence')}` : ''}
            {aRisques ? ` · ${plural(aRisques, 'à risques particuliers', 'à risques particuliers')}` : ''}
          </div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          {nArchives > 0 && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={archives} onChange={e => setArchives(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
              Afficher les archivés
            </label>
          )}
          <Btn small icon={<PrinterIcon size={14} />} onClick={() => imprimerPostesARisques(d)}>Imprimer la liste des postes à risques</Btn>
          {peut && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'refPoste' })}>Nouveau poste</Btn>}
        </div>
      </div>
    }>
      {liste.length === 0
        ? <Empty pad="sm">Aucun poste : ils se créent ici, ou avec les fiches des collaborateurs (intitulé saisi), puis le service RH y indique les formations et habilitations exigées.</Empty>
        : lignes.length === 0
          ? <Empty pad="sm">Tous les postes sont archivés.</Empty>
          : (
            <div className="scroll-x">
              <table className="table">
                <thead><tr><th>Poste</th><th>Exigences</th><th>Titulaires</th><th>Exigences manquantes</th><th>État</th>{peut && <th></th>}</tr></thead>
                <tbody>
                  {lignes.map(p => {
                    const n = titulaires(d.ds, p.id).length, ko = nonConformes(p.id);
                    // Postes en suivi renforcé, exposés ou qui exigent une habilitation SIR ou ATEX : proposés, jamais cochés d'office.
                    const examiner = actif(p) && raisonsDExaminer(d.ds.referentiels, p).length > 0;
                    const cases = [p.sir ? 'Suivi individuel renforcé' : '', p.expose ? 'Exposé à des risques particuliers' : '', p.risquesL4154 ? 'Risques particuliers (L4154-2)' : '', examiner ? 'à examiner (L4154-2)' : ''].filter(Boolean);
                    return (
                      <tr key={p.id}>
                        <td>{cases.length ? <Two main={p.nom} sub={cases.join(' · ')} /> : <Two main={p.nom} />}</td>
                        <td><ExigencesChips x={p} /></td>
                        <td>{n}</td>
                        <td>{ko ? <Tag cls="tag-accent">{ko}</Tag> : <span className="text-muted">—</span>}</td>
                        <td>{p.archive ? <Tag cls="tag-outline">Archivé le {fmt(parse(p.archive))}</Tag> : <Tag cls="tag-neutral">En vigueur</Tag>}</td>
                        {peut && (
                          <td className="right">
                            <div className="actions-end" style={{ flexWrap: 'nowrap' }}>
                              <Btn small onClick={() => openDialog({ type: 'refPoste', id: p.id })}>Modifier</Btn>
                              {p.archive
                                ? <Btn small disabled={occupe} onClick={agir(() => run('referentiel.poste.archiver', { id: p.id, archive: false }))}>Rétablir</Btn>
                                : <Btn small onClick={() => openDialog({ type: 'confirmer', c: archivagePoste(p) })}>Archiver</Btn>}
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
      {renforcee && <NoteAccent>{renforcee} Désignez-la dans Paramètres → Postes à risques particuliers.</NoteAccent>}
      <Fine>
        Le poste se choisit dans la liste sur la fiche du collaborateur ; l’intitulé de la fiche suit le poste. Une formation
        exigée jamais suivie, ou une habilitation exigée jamais délivrée, rend le salarié « Non conforme » avec une échéance
        « exigence manquante ». Sans exigence, le statut des titulaires ne change pas. Un poste occupé ne s’archive pas. Sur un poste
        à risques particuliers (art. L4154-2), un CDD, un intérimaire ou un alternant doit avoir suivi la formation renforcée à la
        sécurité depuis son entrée : sinon « Non conforme » et No Go aux chantiers. La liste s’établit après avis du médecin du
        travail et du CSE ; les postes en suivi renforcé, exposés ou qui exigent une habilitation SIR ou ATEX sont signalés
        « à examiner », sans être cochés d’office.
      </Fine>
    </Panel>

    <Panel title="Exigences communes par équipe" aside="Pour tous les membres, quel que soit leur poste">
      <div className="scroll-x">
        <table className="table">
          <thead><tr><th>Équipe</th><th>Exigences</th><th>Nuit ou continu</th><th>Couverture minimale</th><th>Membres</th><th>Exigences manquantes</th>{peut && <th></th>}</tr></thead>
          <tbody>
            {d.equipes.map(nom => {
              const q = d.ds.referentiels.equipes.find(x => x.nom === nom)!;
              const membres = emps.filter(e => e.equipe === nom), ko = membres.filter(e => e.manquants.length).length;
              return (
                <tr key={nom}>
                  <td>{nom}</td>
                  <td><ExigencesChips x={exigencesEquipe(q)} /></td>
                  {/* Travail de nuit ou en continu : aucun salarié de moins de 18 ans (shared/rules/mineurs.ts). */}
                  <td>{q.nuit == null ? <span className="text-muted">À renseigner</span> : q.nuit ? 'Oui' : 'Non'}</td>
                  {/* Couverture minimale (SST, EPI incendie…) : shared/rules/couverture.ts. */}
                  <td><CouvertureCellule equipe={nom} /></td>
                  <td>{membres.length}</td>
                  <td>{ko ? <Tag cls="tag-accent">{ko}</Tag> : <span className="text-muted">—</span>}</td>
                  {peut && <td className="right"><Btn small onClick={() => openDialog({ type: 'refEquipe', nom })}>Modifier</Btn></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {d.equipes.length === 0 && <Empty pad="sm">Aucune équipe (Équipes &amp; managers).</Empty>}
    </Panel>
  </>;
}
