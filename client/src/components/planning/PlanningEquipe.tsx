// Onglet Planning d'équipe de Temps de travail (lot 12, chantier C5, étape 2), le module activé (réglage `planningActif`).
// Service RH (toutes les équipes), manager (ses équipes ; N+2 et délégations d'un autre périmètre en lecture), paie et lecture
// seule (consultation). Grille accessible sur le modèle du planning des missions (pages/PlanningMissions.tsx) : un vrai
// tableau, une lettre par case (code de l'horaire, R repos, A absent — pour le planificateur seul, sans nature), un astérisque
// sur un brouillon, un résumé par ligne et une ligne de couverture (postes face au besoin minimal) ; aucune couleur seule. Un
// seul arrêt de tabulation : flèches, Début et Fin d'une case à l'autre ; Entrée ou un clic ouvre la case (planificateur,
// jour à venir). Deux semaines à partir de la semaine choisie dans l'en-tête de l'écran ; équipe dans l'adresse.
// Étape 3 : « ! » après la lettre d'un poste en conflit avec une mission ou une tâche Keystone, une session de formation ou
// une astreinte (planificateur seul, sans blocage) ; la couverture compte aussi, horaire par horaire, les secouristes et
// équipiers d'intervention de l'équipe.
// CU-142 (lot 18) : « ! » aussi sur un poste à venir dont une habilitation exigée ne sera pas valide ce jour-là, et, sous la
// grille, la liste de ces postes pour l'équipe (HabilitationsPlanifiees.tsx).
// Sous la grille : échanges de poste (validation par le manager des deux, son suppléant « planning » ou le service RH),
// affectations au roulement, versions publiées (registre gardé pour l'inspection du travail) et affichage réglementaire de
// l'horaire collectif et de la composition des équipes successives (art. D3171-7), à imprimer ou à exporter.
// Période hors de la fenêtre de l'instantané (plus de 8 semaines passées, plus de 12 semaines à venir) : la grille et
// l'affichage se calculent sur les créneaux lus à la demande par l'historique (client/src/planning-api.ts), filtrés par droits.
import { useRef, useState, type KeyboardEvent } from 'react';
import { CalendarPlusIcon, ExportIcon, MegaphoneIcon, PlusIcon, PrinterIcon } from '@phosphor-icons/react';
import { addD, mondayOf, parse } from '../../../../shared/dates.ts';
import type { Domain } from '../../../../shared/domain.ts';
import { fH, fmtIso } from '../../../../shared/format.ts';
import { ECHANGE_OUVERT, horsFenetre, STATUT_ECHANGE } from '../../../../shared/rules/planning.ts';
import { useHistoriquePlanning } from '../../planning-api.ts';
import { downloadCsv, printDocument } from '../../print.ts';
import { useDomain, useRole } from '../../state/derived.ts';
import { decideur } from '../../state/delegues.ts';
import { useData, useStore } from '../../state/store.tsx';
import { Btn, Empty, Fine, Panel, Tag, Two } from '../ui.tsx';
import { HabilitationsPlanifieesPanel } from './HabilitationsPlanifiees.tsx';
import { affichageEquipe, csvAffichage, equipesDuPlanning, grilleEquipe, jourCourt, joursDe, posteTexte, type CaseEquipe, type CouvertureJour, type LigneEquipe } from './planning-vue.ts';
import { t, tn } from '../../i18n/langue.ts';

/** Jours affichés : deux semaines. */
const JOURS_GRILLE = 14;

/**
 * La personne connectée planifie-t-elle l'équipe ? Service RH (droit « rh »), son manager, ou le suppléant d'une délégation
 * « planning » de ce manager (un membre de l'équipe dans `delegues` avec ce périmètre). Le serveur le contrôle de toute façon.
 */
export function planifieEquipe(d: Domain, x: { rh: boolean; manager: boolean; me: number | null }, equipe: string): boolean {
  if (x.rh) return true;
  if (!x.manager || !x.me) return false;
  const q = d.ds.referentiels.equipes.find(e => e.nom === equipe);
  if (q?.managerId === x.me) return true;
  return d.ds.employes.some(e => e.equipe === equipe && decideur(d, e, x.me, 'planning') && d.mgrOf(e) !== x.me);
}

/** Grille du planning : focus itinérant, détail de la case sous la grille, ouverture au clic ou à Entrée. */
function GrilleEquipe({ jours, lignes, couverture, ti, ouvrir }: {
  jours: string[]; lignes: LigneEquipe[]; couverture: CouvertureJour[]; ti: string; ouvrir: ((l: LigneEquipe, c: CaseEquipe) => void) | null;
}) {
  const [actif, setActif] = useState<[number, number]>(() => [0, Math.max(0, jours.indexOf(ti))]);
  const [detail, setDetail] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState('');
  const grille = useRef<HTMLTableElement>(null);
  const [li, co] = [Math.min(actif[0], lignes.length - 1), Math.min(actif[1], jours.length - 1)];
  const montrer = (l: number, c: number) => { setActif([l, c]); setDetail(`${lignes[l].nom} — ${lignes[l].cases[c].texte}`); };
  const toucher = (l: number, c: number) => {
    montrer(l, c);
    setAnnonce(`${lignes[l].nom} — ${lignes[l].cases[c].texte}`);
    ouvrir?.(lignes[l], lignes[l].cases[c]);
  };
  const deplacer = (e: KeyboardEvent, l: number, c: number) => {
    const cible: Record<string, [number, number]> = { ArrowLeft: [l, c - 1], ArrowRight: [l, c + 1], ArrowUp: [l - 1, c], ArrowDown: [l + 1, c], Home: [l, 0], End: [l, jours.length - 1] };
    const vers = cible[e.key];
    if (!vers) return;
    e.preventDefault();
    const [nl, nc] = [Math.max(0, Math.min(lignes.length - 1, vers[0])), Math.max(0, Math.min(jours.length - 1, vers[1]))];
    grille.current?.querySelector<HTMLButtonElement>(`[data-case="${nl}-${nc}"]`)?.focus();
  };
  return (
    <>
      <table ref={grille} className="planning planning-equipe" aria-describedby="planning-equipe-aide">
        <caption className="sr-only">{t('Team planning over two weeks: shift of each employee, day by day, and coverage of the needs')}</caption>
        <colgroup><col className="planning-nom" />{jours.map(s => <col key={s} />)}<col className="planning-resume" /></colgroup>
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">{t('Employee#salarie')}</span></th>
            {jours.map(s => (
              <th key={s} scope="col" className={`planning-jour tnum${s === ti ? ' aujourdhui' : ''}`}>
                <span aria-hidden="true"><span>{parse(s).toLocaleDateString('fr-FR', { weekday: 'narrow' })}</span><span>{parse(s).getDate()}</span></span>
                <span className="sr-only">{jourCourt(s)}{s === ti ? t(' (today)') : ''}</span>
              </th>
            ))}
            <th scope="col" className="planning-jour"><span className="sr-only">{t('Summary')}</span></th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((r, l) => (
            <tr key={r.empId ?? 'a-pourvoir'}>
              <th scope="row" className="ellipsis planning-qui">{r.nom}</th>
              {r.cases.map((c, i) => (
                <td key={c.jour}>
                  <button type="button" className={`planning-case poste-${c.etat}${c.brouillon ? ' poste-brouillon' : ''}`} data-case={`${l}-${i}`}
                    tabIndex={l === li && i === co ? 0 : -1} aria-label={`${r.nom}, ${c.texte}`} title={c.texte}
                    onFocus={() => montrer(l, i)} onClick={() => toucher(l, i)} onKeyDown={e => deplacer(e, l, i)}>
                    <span aria-hidden="true">{c.marque}{c.brouillon ? '*' : ''}{c.conflit || c.habilitation ? '!' : ''}</span>
                  </button>
                </td>
              ))}
              <td className="planning-total sub" title={r.resume}>{r.resume}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="planning-qui sub">{t('Coverage')}</th>
            {couverture.map(c => <td key={c.jour} className={`planning-couverture tnum${c.manque ? ' manque' : ''}`} title={c.texte}><span aria-hidden="true">{c.court}</span><span className="sr-only">{c.texte}</span></td>)}
            <td className="planning-total sub">{t('shifts / need')}</td>
          </tr>
        </tfoot>
      </table>
      <p id="planning-equipe-aide" className="sr-only">{t('Arrows to move from one day or one employee to another, Home and End for the first or last day; Enter opens the shift.')}</p>
      <p className="planning-detail sub" aria-hidden="true">{detail ?? t('Tap or select a cell to show the detail of the day.')}</p>
      <p className="sr-only" aria-live="polite">{annonce}</p>
    </>
  );
}

export function PlanningEquipe() {
  const d = useDomain();
  const role = useRole();
  const { espaceRh, rh, manager, me } = role;
  const { ui, setUi, openDialog } = useStore();
  const equipes = equipesDuPlanning(d, me, espaceRh);
  // Équipe par défaut : la première qui a un planning (affectations ou créneaux), sinon la première.
  const avecPlanning = equipes.find(q => (d.ds.roulements ?? []).some(r => r.equipe === q) || (d.ds.creneaux ?? []).some(c => c.equipe === q));
  const equipe = ui.planEquipe && equipes.includes(ui.planEquipe) ? ui.planEquipe : avecPlanning ?? equipes[0] ?? null;
  const wk = ui.weekStart ?? mondayOf(d.ti);
  const jours = joursDe(wk, JOURS_GRILLE);
  const fin = jours.at(-1)!;
  // Hors de la fenêtre de l'instantané : créneaux de la période lus à la demande (registre, art. D3171-16).
  const data = useData();
  const hors = !!equipe && horsFenetre(jours[0], fin, d.ti);
  const hist = useHistoriquePlanning(hors ? { du: jours[0], au: fin, equipe } : null, data.user.role, data.revision);
  if (!equipe) return <Panel title={t('Team planning')}><Empty pad="sm">{t('No team to plan in your scope.')}</Empty></Panel>;
  const planif = planifieEquipe(d, { rh, manager, me }, equipe);
  const historique = hist?.creneaux ?? null;
  const enAttente = !!hist && !hist.creneaux;
  const g = grilleEquipe(d, equipe, jours, planif, historique);
  const ouvrir = planif ? (l: LigneEquipe, c: CaseEquipe) => {
    if (c.jour < d.ti && !(c.creneau?.statut === 'brouillon')) return;
    openDialog({ type: 'planningCreneau', equipe, jour: c.jour, empId: l.empId, id: c.creneau?.id ?? null });
  } : null;
  const membres = new Set(d.ds.employes.filter(e => e.equipe === equipe).map(e => e.id));
  const echanges = (d.ds.echangesPoste ?? []).filter(e => membres.has(e.demandeurId) || membres.has(e.partenaireId))
    .filter(e => ECHANGE_OUVERT.includes(e.statut) || (e.decideLe ?? e.creeLe) >= addD(d.ti, -14)).sort((a, b) => b.creeLe.localeCompare(a.creeLe));
  const valideur = (e: { demandeurId: number; partenaireId: number }) => [e.demandeurId, e.partenaireId].every(id => {
    const x = d.emp(id);
    return !!x && ((rh && id !== role.soi) || (manager && decideur(d, x, me, 'planning')));
  });
  const roulements = (d.ds.roulements ?? []).filter(r => r.equipe === equipe && !(r.au && r.au < r.du) && (!r.au || r.au >= d.ti)).sort((a, b) => d.personName(a.empId).localeCompare(d.personName(b.empId)));
  const publications = (d.ds.publicationsPlanning ?? []).filter(p => p.equipe === equipe).sort((a, b) => b.version - a.version).slice(0, 8);
  const imprimer = () => {
    if (enAttente) return;
    const a = affichageEquipe(d, equipe, jours, historique);
    printDocument(`${t('Collective schedule and composition of the teams — ')}${equipe}`, `${t('From #date-cap')}${fmtIso(jours[0])}${t(' to #date')}${fmtIso(fin)}${t(' · published shifts (art. D3171-7)')}`, [
      { title: t('Collective schedule'), table: { head: [t('Schedule'), t('Label'), t('Range'), t('Break'), t('Duration')], rows: a.horaires.map(h => [h.code, h.nom, h.plage, h.pause ? `${h.pause}${t(' min')}` : '—', fH(h.duree)]) } },
      ...(a.groupes.length ? [{ title: t('Rotation groups'), table: { head: [t('Cycle'), t('Group'), t('Employees#salaries')], rows: a.groupes.map(x => [x.cycle, x.groupe, x.salaries.join(', ')]) } }] : []),
      { title: t('Nominative composition of the successive teams'), table: { head: [t('Day'), t('Schedule'), t('Employees#salaries')], rows: a.composition.map(x => [jourCourt(x.jour), x.horaire, x.salaries.join(', ')]) } },
    ]);
  };
  const exporter = () => {
    if (enAttente) return;
    const x = csvAffichage(equipe, jours, affichageEquipe(d, equipe, jours, historique));
    downloadCsv(x.fichier, x.head, x.rows);
  };
  return (
    <>
      <Panel head={
        <div className="panel-head top">
          <div>
            <h2>{t('Team planning')}</h2>
            <div className="text-muted sub">
              {t('From #date-cap')}{fmtIso(jours[0])}{t(' to #date')}{fmtIso(fin)}{g.brouillons ? ` · ${tn(g.brouillons, 'slot to publish', 'slots to publish')}` : ''}{planif ? '' : t(' · read only')}
            </div>
          </div>
          <div className="actions-end" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="sr-only" htmlFor="plan-equipe">{t('Team')}</label>
            <select className="input" id="plan-equipe" value={equipe} onChange={e => setUi({ planEquipe: e.target.value })} style={{ minWidth: 160 }}>
              {equipes.map(q => <option key={q} value={q}>{q}</option>)}
            </select>
            {planif && <Btn small icon={<CalendarPlusIcon size={14} />} onClick={() => openDialog({ type: 'planningGenerer', equipe, du: wk })}>{t('Generate')}</Btn>}
            {planif && <Btn small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'planningCreneau', equipe, jour: wk < d.ti ? d.ti : wk, empId: null })}>{t('Shift to fill')}</Btn>}
            {planif && <Btn variant="primary" small icon={<MegaphoneIcon size={14} />} onClick={() => openDialog({ type: 'planningPublier', equipe, du: wk, au: fin })}>{t('Publish')}</Btn>}
          </div>
        </div>
      }>
        {hist?.erreur ? <Empty pad="sm">{t('History unreadable: ')}{hist.erreur}</Empty>
          : enAttente ? <Empty pad="sm">{t('Period outside the weeks loaded: reading the history…')}</Empty>
          : g.lignes.length === 0 ? <Empty pad="sm">{t('No employee in this team over the period.')}</Empty> : (
          <div className="scroll-x">
            <GrilleEquipe key={`${equipe}|${wk}`} jours={jours} lignes={g.lignes} couverture={g.couverture} ti={d.ti} ouvrir={ouvrir} />
          </div>
        )}
        <Fine>
          {hors && t('Period outside the weeks loaded with the screen (8 past weeks, 12 to come): shifts read in the history. ')}
          {t('Letter of each cell: code of the schedule (R: rest')}{planif ? t(', A: absent, without the nature of the absence') : ''}{t('); *: draft or change to publish, which the employee does not see yet')}{planif ? t('; !: conflict with a Keystone assignment or task, a training session or an on-call duty, or required authorisation not valid at the date of the shift (detail of the cell), without blocking') : ''}{t('. Coverage: shifts planned for the day over the minimum need of the team (Reference data → Job needs), “!” when it is not covered or a schedule does not have the minimum of first-aiders or response team members of the team (Reference data → Jobs)')}{planif ? t(', absent removed') : ''}{t('. The planning stays a forecast: the hours actually worked are declared on the timesheet.')}
        </Fine>
      </Panel>

      {planif && !hors && <HabilitationsPlanifieesPanel equipe={equipe} />}

      {echanges.length > 0 && (
        <Panel title={t('Shift swaps')} aside={tn(echanges.filter(e => e.statut === 'accepte').length, 'to approve#count', 'to approve#count-plural')}>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Employees#salaries')}</th><th>{t('Shifts')}</th><th>{t('State')}</th><th></th></tr></thead>
              <tbody>
                {echanges.map(e => {
                  const a = (d.ds.creneaux ?? []).find(c => c.id === e.creneauDemandeur), b = e.creneauPartenaire ? (d.ds.creneaux ?? []).find(c => c.id === e.creneauPartenaire) : null;
                  return (
                    <tr key={e.id}>
                      <td><Two main={`${d.personName(e.demandeurId)} → ${d.personName(e.partenaireId)}`} sub={b ? t('swap') : t('transfer#cession')} /></td>
                      <td className="sub">{a ? `${jourCourt(a.jour)} · ${posteTexte(a)}` : '—'}{b ? `${t(' against ')}${jourCourt(b.jour)} · ${posteTexte(b)}` : ''}</td>
                      <td><Tag cls={e.statut === 'accepte' ? 'tag-accent' : 'tag-neutral'}>{STATUT_ECHANGE[e.statut]}</Tag></td>
                      <td className="right">
                        {e.statut === 'accepte' && valideur(e) && <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'planningEchangeValider', id: e.id })}>{t('Examine')}</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title={t('Assignments to the rotation')} aside={planif ? <Btn small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'planningRoulement', equipe })}>{t('Assign')}</Btn> : undefined}>
        {roulements.length === 0 ? <Empty pad="sm">{t('No employee of the team assigned to a cycle: the planning is generated from these assignments.')}</Empty> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Employee#salarie')}</th><th>{t('Cycle')}</th><th>{t('Group')}</th><th>{t('Period')}</th><th></th></tr></thead>
              <tbody>
                {roulements.map(r => (
                  <tr key={r.id}>
                    <td>{d.personName(r.empId)}</td>
                    <td>{r.cycle}</td>
                    <td>{r.groupe}</td>
                    <td className="nowrap">{t('since #date')}{fmtIso(r.du)}{r.au ? `${t(' until ')}${fmtIso(r.au)}` : ''}</td>
                    <td className="right">{planif && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'planningRoulement', equipe, id: r.id })}>{t('End#verb')}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={t('Published versions and display')} aside={<div className="actions-end">
        <Btn small icon={<PrinterIcon size={14} />} disabled={enAttente} onClick={imprimer}>{t('Print the display')}</Btn>
        <Btn small icon={<ExportIcon size={14} />} disabled={enAttente} onClick={exporter}>{t('Export (CSV)')}</Btn>
      </div>}>
        {publications.length === 0 ? <Empty pad="sm">{t('No version published for this team.')}</Empty> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Version')}</th><th>{t('Period')}</th><th>{t('Published#fem')}</th><th className="right">{t('Slots')}</th><th className="right">{t('Late#delai')}</th></tr></thead>
              <tbody>
                {publications.map(p => (
                  <tr key={p.id}>
                    <td className="tnum">{p.version}</td>
                    <td className="nowrap">{t('from #date')}{fmtIso(p.du)}{t(' to #date')}{fmtIso(p.au)}</td>
                    <td><Two main={fmtIso(p.communiqueLe)} sub={p.publiePar} /></td>
                    <td className="right tnum">{p.creneaux}</td>
                    <td className="right tnum">{p.horsDelai || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Fine>
          {t('Regulatory display (art. D3171-7): collective schedule of the team and nominative composition of the successive teams over the two weeks shown, from the published shifts — to post or keep in a register. The published versions are kept at least one year for the labour inspectorate (art. D3171-16): go back a week in the screen header to show, print or export an older period (read in the history).')}
        </Fine>
      </Panel>
    </>
  );
}
