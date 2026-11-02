// Onglet Planning d'équipe de Temps de travail (lot 12, chantier C5, étape 2), le module activé (réglage `planningActif`).
// Service RH (toutes les équipes), manager (ses équipes ; N+2 et délégations d'un autre périmètre en lecture), paie et lecture
// seule (consultation). Grille accessible sur le modèle du planning des missions (pages/PlanningMissions.tsx) : un vrai
// tableau, une lettre par case (code de l'horaire, R repos, A absent — pour le planificateur seul, sans nature), un astérisque
// sur un brouillon, un résumé par ligne et une ligne de couverture (postes face au besoin minimal) ; aucune couleur seule. Un
// seul arrêt de tabulation : flèches, Début et Fin d'une case à l'autre ; Entrée ou un clic ouvre la case (planificateur,
// jour à venir). Deux semaines à partir de la semaine choisie dans l'en-tête de l'écran ; équipe dans l'adresse.
// Sous la grille : échanges de poste (validation par le manager des deux, son suppléant « planning » ou le service RH),
// affectations au roulement, versions publiées (registre gardé pour l'inspection du travail) et affichage réglementaire de
// l'horaire collectif et de la composition des équipes successives (art. D3171-7), à imprimer ou à exporter.
import { useRef, useState, type KeyboardEvent } from 'react';
import { CalendarPlusIcon, ExportIcon, MegaphoneIcon, PlusIcon, PrinterIcon } from '@phosphor-icons/react';
import { addD, mondayOf, parse } from '../../../../shared/dates.ts';
import type { Domain } from '../../../../shared/domain.ts';
import { fH, fmtIso, plural } from '../../../../shared/format.ts';
import { ECHANGE_OUVERT, STATUT_ECHANGE } from '../../../../shared/rules/planning.ts';
import { downloadCsv, printDocument } from '../../print.ts';
import { useDomain, useRole } from '../../state/derived.ts';
import { decideur } from '../../state/delegues.ts';
import { useStore } from '../../state/store.tsx';
import { Btn, Empty, Fine, Panel, Tag, Two } from '../ui.tsx';
import { affichageEquipe, csvAffichage, equipesDuPlanning, grilleEquipe, jourCourt, joursDe, posteTexte, type CaseEquipe, type CouvertureJour, type LigneEquipe } from './planning-vue.ts';

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
    const t = cible[e.key];
    if (!t) return;
    e.preventDefault();
    const [nl, nc] = [Math.max(0, Math.min(lignes.length - 1, t[0])), Math.max(0, Math.min(jours.length - 1, t[1]))];
    grille.current?.querySelector<HTMLButtonElement>(`[data-case="${nl}-${nc}"]`)?.focus();
  };
  return (
    <>
      <table ref={grille} className="planning planning-equipe" aria-describedby="planning-equipe-aide">
        <caption className="sr-only">Planning de l’équipe sur deux semaines : poste de chaque salarié, jour par jour, et couverture des besoins</caption>
        <colgroup><col className="planning-nom" />{jours.map(s => <col key={s} />)}<col className="planning-resume" /></colgroup>
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Salarié</span></th>
            {jours.map(s => (
              <th key={s} scope="col" className={`planning-jour tnum${s === ti ? ' aujourdhui' : ''}`}>
                <span aria-hidden="true"><span>{parse(s).toLocaleDateString('fr-FR', { weekday: 'narrow' })}</span><span>{parse(s).getDate()}</span></span>
                <span className="sr-only">{jourCourt(s)}{s === ti ? ' (aujourd’hui)' : ''}</span>
              </th>
            ))}
            <th scope="col" className="planning-jour"><span className="sr-only">Résumé</span></th>
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
                    <span aria-hidden="true">{c.marque}{c.brouillon ? '*' : ''}</span>
                  </button>
                </td>
              ))}
              <td className="planning-total sub" title={r.resume}>{r.resume}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="planning-qui sub">Couverture</th>
            {couverture.map(c => <td key={c.jour} className={`planning-couverture tnum${c.manque ? ' manque' : ''}`} title={c.texte}><span aria-hidden="true">{c.court}</span><span className="sr-only">{c.texte}</span></td>)}
            <td className="planning-total sub">postes / besoin</td>
          </tr>
        </tfoot>
      </table>
      <p id="planning-equipe-aide" className="sr-only">Flèches pour passer d’un jour ou d’un salarié à l’autre, Début et Fin pour le premier ou le dernier jour ; Entrée ouvre le poste.</p>
      <p className="planning-detail sub" aria-hidden="true">{detail ?? 'Touchez ou sélectionnez une case pour afficher le détail du jour.'}</p>
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
  if (!equipe) return <Panel title="Planning d’équipe"><Empty pad="sm">Aucune équipe à planifier dans votre périmètre.</Empty></Panel>;
  const planif = planifieEquipe(d, { rh, manager, me }, equipe);
  const g = grilleEquipe(d, equipe, jours, planif);
  const ouvrir = planif ? (l: LigneEquipe, c: CaseEquipe) => {
    if (c.jour < d.ti && !(c.creneau?.statut === 'brouillon')) return;
    openDialog({ type: 'planningCreneau', equipe, jour: c.jour, empId: l.empId, id: c.creneau?.id ?? null });
  } : null;
  const fin = jours.at(-1)!;
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
    const a = affichageEquipe(d, equipe, jours);
    printDocument(`Horaire collectif et composition des équipes — ${equipe}`, `Du ${fmtIso(jours[0])} au ${fmtIso(fin)} · postes publiés (art. D3171-7)`, [
      { title: 'Horaire collectif', table: { head: ['Horaire', 'Libellé', 'Plage', 'Pause', 'Durée'], rows: a.horaires.map(h => [h.code, h.nom, h.plage, h.pause ? `${h.pause} min` : '—', fH(h.duree)]) } },
      ...(a.groupes.length ? [{ title: 'Groupes de roulement', table: { head: ['Cycle', 'Groupe', 'Salariés'], rows: a.groupes.map(x => [x.cycle, x.groupe, x.salaries.join(', ')]) } }] : []),
      { title: 'Composition nominative des équipes successives', table: { head: ['Jour', 'Horaire', 'Salariés'], rows: a.composition.map(x => [jourCourt(x.jour), x.horaire, x.salaries.join(', ')]) } },
    ]);
  };
  const exporter = () => {
    const x = csvAffichage(equipe, jours, affichageEquipe(d, equipe, jours));
    downloadCsv(x.fichier, x.head, x.rows);
  };
  return (
    <>
      <Panel head={
        <div className="panel-head top">
          <div>
            <h2>Planning d’équipe</h2>
            <div className="text-muted sub">
              Du {fmtIso(jours[0])} au {fmtIso(fin)}{g.brouillons ? ` · ${plural(g.brouillons, 'créneau à publier', 'créneaux à publier')}` : ''}{planif ? '' : ' · consultation'}
            </div>
          </div>
          <div className="actions-end" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="sr-only" htmlFor="plan-equipe">Équipe</label>
            <select className="input" id="plan-equipe" value={equipe} onChange={e => setUi({ planEquipe: e.target.value })} style={{ minWidth: 160 }}>
              {equipes.map(q => <option key={q} value={q}>{q}</option>)}
            </select>
            {planif && <Btn small icon={<CalendarPlusIcon size={14} />} onClick={() => openDialog({ type: 'planningGenerer', equipe, du: wk })}>Générer</Btn>}
            {planif && <Btn small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'planningCreneau', equipe, jour: wk < d.ti ? d.ti : wk, empId: null })}>Poste à pourvoir</Btn>}
            {planif && <Btn variant="primary" small icon={<MegaphoneIcon size={14} />} onClick={() => openDialog({ type: 'planningPublier', equipe, du: wk, au: fin })}>Publier</Btn>}
          </div>
        </div>
      }>
        {g.lignes.length === 0 ? <Empty pad="sm">Aucun salarié dans cette équipe sur la période.</Empty> : (
          <div className="scroll-x">
            <GrilleEquipe key={`${equipe}|${wk}`} jours={jours} lignes={g.lignes} couverture={g.couverture} ti={d.ti} ouvrir={ouvrir} />
          </div>
        )}
        <Fine>
          Lettre de chaque case : code de l’horaire (R : repos{planif ? ', A : absent, sans la nature de l’absence' : ''}) ; * : brouillon ou modification à publier, que
          le salarié ne voit pas encore. Couverture : postes planifiés du jour sur le besoin minimal de l’équipe (Référentiels → Besoins de poste), « ! » quand il
          n’est pas couvert. Le planning reste une prévision : les heures réellement faites se déclarent sur la feuille de temps.
        </Fine>
      </Panel>

      {echanges.length > 0 && (
        <Panel title="Échanges de poste" aside={plural(echanges.filter(e => e.statut === 'accepte').length, 'à valider', 'à valider')}>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Salariés</th><th>Postes</th><th>État</th><th></th></tr></thead>
              <tbody>
                {echanges.map(e => {
                  const a = (d.ds.creneaux ?? []).find(c => c.id === e.creneauDemandeur), b = e.creneauPartenaire ? (d.ds.creneaux ?? []).find(c => c.id === e.creneauPartenaire) : null;
                  return (
                    <tr key={e.id}>
                      <td><Two main={`${d.personName(e.demandeurId)} → ${d.personName(e.partenaireId)}`} sub={b ? 'échange' : 'cession'} /></td>
                      <td className="sub">{a ? `${jourCourt(a.jour)} · ${posteTexte(a)}` : '—'}{b ? ` contre ${jourCourt(b.jour)} · ${posteTexte(b)}` : ''}</td>
                      <td><Tag cls={e.statut === 'accepte' ? 'tag-accent' : 'tag-neutral'}>{STATUT_ECHANGE[e.statut]}</Tag></td>
                      <td className="right">
                        {e.statut === 'accepte' && valideur(e) && <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'planningEchangeValider', id: e.id })}>Examiner</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Affectations au roulement" aside={planif ? <Btn small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'planningRoulement', equipe })}>Affecter</Btn> : undefined}>
        {roulements.length === 0 ? <Empty pad="sm">Aucun salarié de l’équipe affecté à un cycle : le planning se génère d’après ces affectations.</Empty> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Salarié</th><th>Cycle</th><th>Groupe</th><th>Période</th><th></th></tr></thead>
              <tbody>
                {roulements.map(r => (
                  <tr key={r.id}>
                    <td>{d.personName(r.empId)}</td>
                    <td>{r.cycle}</td>
                    <td>{r.groupe}</td>
                    <td className="nowrap">depuis le {fmtIso(r.du)}{r.au ? ` jusqu’au ${fmtIso(r.au)}` : ''}</td>
                    <td className="right">{planif && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'planningRoulement', equipe, id: r.id })}>Terminer</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Versions publiées et affichage" aside={<div className="actions-end">
        <Btn small icon={<PrinterIcon size={14} />} onClick={imprimer}>Imprimer l’affichage</Btn>
        <Btn small icon={<ExportIcon size={14} />} onClick={exporter}>Exporter (CSV)</Btn>
      </div>}>
        {publications.length === 0 ? <Empty pad="sm">Aucune version publiée pour cette équipe.</Empty> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Version</th><th>Période</th><th>Publiée</th><th className="right">Créneaux</th><th className="right">Hors délai</th></tr></thead>
              <tbody>
                {publications.map(p => (
                  <tr key={p.id}>
                    <td className="tnum">{p.version}</td>
                    <td className="nowrap">du {fmtIso(p.du)} au {fmtIso(p.au)}</td>
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
          Affichage réglementaire (art. D3171-7) : horaire collectif de l’équipe et composition nominative des équipes successives sur les deux semaines affichées,
          d’après les postes publiés — à afficher ou à tenir en registre. Les versions publiées sont gardées au moins un an pour l’inspection du travail
          (art. D3171-16) ; les plus anciennes se consultent par l’historique.
        </Fine>
      </Panel>
    </>
  );
}
