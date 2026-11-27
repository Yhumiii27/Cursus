// Écran Référentiels, onglet Postes (t055) : postes et formations ou habilitations exigées, exigences communes à toute
// une équipe. Le service RH les tient ; le référent HSE et la lecture seule consultent. Aucune exigence n'est créée
// d'office : tant qu'un poste n'en a pas, le statut de ses titulaires ne change pas. Règles : shared/rules/exigences.ts.
import { useMemo, useState } from 'react';
import { PlusIcon, PrinterIcon } from '@phosphor-icons/react';
import { parse } from '../../../shared/dates.ts';
import { t, tn } from '../i18n/langue.ts';
import { fmt } from '../../../shared/format.ts';
import { exigencesEquipe, nombreExigences, posteDe, titulaires } from '../../../shared/rules/exigences.ts';
import { actif, actifs } from '../../../shared/rules/referentiels.ts';
import { avertissementRenforcee, postesARisques, raisonsDExaminer } from '../../../shared/rules/formation-renforcee.ts';
import { facteursDuPoste } from '../../../shared/rules/c2p.ts';
import { FACTEURS_C2P } from '../../../shared/constants.ts';
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
  if (!nombreExigences(x)) return <span className="text-muted">{t('None#fem')}</span>;
  return (
    <Chips items={[
      ...x.formations.map(f => ({ key: `f-${f}`, label: d.fm(f)?.court ?? f, cls: actif(d.fm(f)) ? 'tag-neutral' : 'tag-outline' })),
      ...x.habilitations.map(h => ({ key: `h-${h}`, label: d.hm(h)?.nom ?? h, cls: actif(d.hm(h)) ? 'tag-neutral' : 'tag-outline' })),
    ]} />
  );
}

export function Postes() {
  const { d, emps } = useEnriched();
  const { rh: peut, formations: c2p } = useRole();
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
          <h2>{t('Jobs and requirements')}</h2>
          <div className="text-muted sub">
            {tn(enVigueur.length, 'job in force', 'jobs in force')}{nArchives ? ` · ${tn(nArchives, 'archived#masc', 'archived#masc-plural')}` : ''}
            {sansExigence ? ` · ${tn(sansExigence, 'without requirement', 'without requirement#plural')}` : ''}
            {aRisques ? ` · ${tn(aRisques, 'with particular risks', 'with particular risks#plural')}` : ''}
          </div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          {nArchives > 0 && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={archives} onChange={e => setArchives(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
              {t('Show the archived ones#masc')}
            </label>
          )}
          <Btn small icon={<PrinterIcon size={14} />} onClick={() => imprimerPostesARisques(d)}>{t('Print the list of jobs at risk')}</Btn>
          {peut && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'refPoste' })}>{t('New job')}</Btn>}
        </div>
      </div>
    }>
      {liste.length === 0
        ? <Empty pad="sm">{t('No job: they are created here, or with the employees’ sheets (title entered), then HR states on them the training courses and authorisations required.')}</Empty>
        : lignes.length === 0
          ? <Empty pad="sm">{t('All jobs are archived.')}</Empty>
          : (
            <div className="scroll-x">
              <table className="table">
                <thead><tr><th>{t('Job')}</th><th>{t('Requirements')}</th><th>{t('C2P factors')}</th><th>{t('Holders')}</th><th>{t('Missing requirements')}</th><th>{t('State')}</th>{(peut || c2p) && <th></th>}</tr></thead>
                <tbody>
                  {lignes.map(p => {
                    const n = titulaires(d.ds, p.id).length, ko = nonConformes(p.id);
                    // Postes en suivi renforcé, exposés ou qui exigent une habilitation SIR ou ATEX : proposés, jamais cochés d'office.
                    const examiner = actif(p) && raisonsDExaminer(d.ds.referentiels, p).length > 0;
                    const cases = [p.sir ? t('Enhanced individual monitoring') : '', p.expose ? t('Exposed to particular risks') : '', p.risquesL4154 ? t('Particular risks (L4154-2)') : '', examiner ? t('to examine (L4154-2)') : ''].filter(Boolean);
                    return (
                      <tr key={p.id}>
                        <td>{cases.length ? <Two main={p.nom} sub={cases.join(' · ')} /> : <Two main={p.nom} />}</td>
                        <td><ExigencesChips x={p} /></td>
                        {/* Compte professionnel de prévention (lot 7) : facteurs cochés par le service RH ou le référent HSE. */}
                        <td>{facteursDuPoste(p).length
                          ? <Chips items={facteursDuPoste(p).map(f => ({ key: f, label: FACTEURS_C2P[f].label, cls: 'tag-neutral' }))} />
                          : <span className="text-muted">{t('None')}</span>}</td>
                        <td>{n}</td>
                        <td>{ko ? <Tag cls="tag-accent">{ko}</Tag> : <span className="text-muted">—</span>}</td>
                        <td>{p.archive ? <Tag cls="tag-outline">{t('Archived on #masc')}{fmt(parse(p.archive))}</Tag> : <Tag cls="tag-neutral">{t('In force')}</Tag>}</td>
                        {(peut || c2p) && (
                          <td className="right">
                            <div className="actions-end" style={{ flexWrap: 'nowrap' }}>
                              {c2p && <Btn small onClick={() => openDialog({ type: 'refPosteC2p', id: p.id })}>{t('C2P factors')}</Btn>}
                              {peut && <Btn small onClick={() => openDialog({ type: 'refPoste', id: p.id })}>{t('Edit')}</Btn>}
                              {peut && (p.archive
                                ? <Btn small disabled={occupe} onClick={agir(() => run('referentiel.poste.archiver', { id: p.id, archive: false }))}>{t('Restore')}</Btn>
                                : <Btn small onClick={() => openDialog({ type: 'confirmer', c: archivagePoste(p) })}>{t('Archive')}</Btn>)}
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
      {renforcee && <NoteAccent>{renforcee}{t(' Designate it in Settings → Jobs with particular risks.')}</NoteAccent>}
      <Fine>
        {t('The job is chosen in the list on the employee’s sheet; the title of the sheet follows the job. A required training course never followed, or a required authorisation never issued, makes the employee “Non-compliant” with a “missing requirement” due date. Without a requirement, the status of the holders does not change. An occupied job cannot be archived. On a job with particular risks (art. L4154-2), a fixed-term employee, a temp or a work-study student must have followed the enhanced safety training since their entry: otherwise “Non-compliant” and No Go on the worksites. The list is drawn up after the opinion of the occupational doctor and the CSE; the jobs under enhanced monitoring, exposed or requiring a SIR or ATEX authorisation are flagged “to examine”, without being ticked automatically. C2P factors (repetitive work, hyperbaric environment, extreme temperatures, noise): ticked by HR or the HSE referent when the holders are exposed to them beyond the threshold after protection, unticked by default (Exposures screen).')}
      </Fine>
    </Panel>

    <Panel title={t('Common requirements by team')} aside={t('For all members, whatever their job')}>
      <div className="scroll-x">
        <table className="table">
          <thead><tr><th>{t('Team')}</th><th>{t('Requirements')}</th><th>{t('Night or continuous')}</th><th>{t('Minimum coverage')}</th><th>{t('Members')}</th><th>{t('Missing requirements')}</th>{peut && <th></th>}</tr></thead>
          <tbody>
            {d.equipes.map(nom => {
              const q = d.ds.referentiels.equipes.find(x => x.nom === nom)!;
              const membres = emps.filter(e => e.equipe === nom), ko = membres.filter(e => e.manquants.length).length;
              return (
                <tr key={nom}>
                  <td>{nom}</td>
                  <td><ExigencesChips x={exigencesEquipe(q)} /></td>
                  {/* Travail de nuit ou en continu : aucun salarié de moins de 18 ans (shared/rules/mineurs.ts). */}
                  <td>{q.nuit == null ? <span className="text-muted">{t('To fill in')}</span> : q.nuit ? t('Yes') : t('No')}</td>
                  {/* Couverture minimale (SST, EPI incendie…) : shared/rules/couverture.ts. */}
                  <td><CouvertureCellule equipe={nom} /></td>
                  <td>{membres.length}</td>
                  <td>{ko ? <Tag cls="tag-accent">{ko}</Tag> : <span className="text-muted">—</span>}</td>
                  {peut && <td className="right"><Btn small onClick={() => openDialog({ type: 'refEquipe', nom })}>{t('Edit')}</Btn></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {d.equipes.length === 0 && <Empty pad="sm">{t('No team (Teams & managers).')}</Empty>}
    </Panel>
  </>;
}
