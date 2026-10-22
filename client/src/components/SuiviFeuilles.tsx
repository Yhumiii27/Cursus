// Écran Temps : suivi des feuilles de temps semaine par semaine (t130), pour le service RH (tous, par équipe), la paie et
// la lecture seule (consultation) et le manager (son équipe). Pour chaque collaborateur et chacune des dernières
// semaines (réglage `suiviSemaines`) : feuille non saisie, en brouillon, à corriger, à valider, validée ou transmise
// (shared/rules/suivi-feuilles.ts), en retard une fois l'échéance passée (par défaut le lundi suivant à 12 h). Relance
// en un clic (temps.relancer : e-mail au salarié et à son valideur) et validation groupée des feuilles soumises
// (temps.validerLot : contrôles feuille par feuille, refus listés ; la confirmation compte les alertes de repos) : manager
// direct et service RH.
import { useState } from 'react';
import { addD, isoWeek, parse } from '../../../shared/dates.ts';
import { equipeLabel, fmtShort, plural } from '../../../shared/format.ts';
import {
  type CelluleSuivi, type EtatSemaine, compteursSuivi, delaiTexte, ETATS_SEMAINE, etatSemaines, limiteTexte, maintenantParis, semainesSuivies,
} from '../../../shared/rules/suivi-feuilles.ts';
import { nombreAvecRepos } from '../../../shared/rules/repos-a-verifier.ts';
import { useAgir } from '../state/actions.ts';
import { validationGroupee } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { parNombre, parTexte, trier, useTri, type Colonne } from './tri.ts';
import { ThTri } from './TriListe.tsx';
import { Fine, Panel, Tag, Two } from './ui.tsx';
import { decideur } from '../state/delegues.ts';

const TOUTES = '';
/** Cellule qui demande une action : à saisir, à corriger, à valider. */
/** Rang d'une semaine pour le tri : en retard, à corriger, non saisie, brouillon, à saisir, à valider, validée, transmise ; sans feuille attendue en dernier. */
const ORDRE_ETATS: readonly EtatSemaine[] = ['a_corriger', 'absente', 'brouillon', 'attendue', 'soumise', 'validee', 'transmise'];
const rangCellule = (c: CelluleSuivi | undefined) => !c?.etat ? null : c.enRetard ? -1 : ORDRE_ETATS.indexOf(c.etat);
const aSuivre = (c: CelluleSuivi) => c.etat === 'absente' || c.etat === 'brouillon' || c.etat === 'a_corriger' || c.etat === 'soumise';

export function SuiviFeuilles() {
  const d = useDomain();
  const { rh, manager, me, soi } = useRole();
  const { setUi, run, openDialog } = useStore();
  const { occupe, agir } = useAgir();
  const [equipe, setEquipe] = useState(TOUTES);
  const [tout, setTout] = useState(false);
  const s = d.ds.settings;
  const semaines = semainesSuivies(d.ti, s.suiviSemaines);
  // Manager : les membres de son équipe ; espace RH : tous, filtrés par équipe.
  const emps = d.ds.employes
    .filter(e => (manager ? decideur(d, e, me, 'feuilles') : equipe === TOUTES || equipeLabel(e) === equipe))
    .sort((a, b) => a.nom.localeCompare(b.nom));
  const lignes = etatSemaines(d, emps.map(e => e.id), semaines, maintenantParis(d.ti)).filter(l => l.cellules.some(c => c.etat));
  // Tri par colonne (t145, tri seulement : une ligne par collaborateur suivi) : par nom tant qu'aucun en-tête n'est cliqué ;
  // une semaine se trie de l'état qui demande le plus d'action (en retard, à corriger…) à la feuille transmise.
  const t = useTri('temps.suivi');
  const colonnes: Record<string, Colonne<(typeof lignes)[number]>> = {
    nom: parTexte(l => l.emp.nom),
    ...Object.fromEntries(semaines.map((w, i) => [`s${w}`, parNombre<(typeof lignes)[number]>(l => rangCellule(l.cellules[i]))])),
  };
  const visibles = trier(tout ? lignes : lignes.filter(l => l.cellules.some(aSuivre)), colonnes, t.tri);
  const n = compteursSuivi(lignes);
  const agit = rh || manager;
  // Feuilles soumises que la personne peut valider : jamais la sienne (un membre du RH passe par son valideur).
  const aValider = lignes.flatMap(l => l.cellules).filter(c => c.etat === 'soumise' && (manager || c.empId !== soi));
  const selection = aValider.map(c => ({ empId: c.empId, week: c.week }));
  const equipes = [...new Set(d.ds.employes.map(equipeLabel))].sort();

  const relancer = (empId?: number) => agir(() => run('temps.relancer', empId === undefined ? {} : { empId }));
  const ouvrir = (c: CelluleSuivi) => setUi({ tsEmp: c.empId, weekStart: c.week });

  return (
    <Panel head={
      <div className="panel-head" style={{ alignItems: 'center' }}>
        <div>
          <h2>Suivi des feuilles de temps</h2>
          <div className="text-muted sub">
            {plural(n.aSaisir, 'feuille à saisir', 'feuilles à saisir')} avant l’envoi à Sage, dont {n.enRetard} en retard · {plural(n.aValider, 'feuille à valider', 'feuilles à valider')}
          </div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          {!manager && (
            <select className="input" aria-label="Équipe" value={equipe} onChange={e => setEquipe(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
              <option value={TOUTES}>Toutes les équipes</option>
              {equipes.map(q => <option key={q} value={q}>{q}</option>)}
            </select>
          )}
          {agit && n.enRetard > 0 && (
            <button type="button" className="btn btn-secondary" disabled={occupe} onClick={relancer()}>Relancer les retards</button>
          )}
          {agit && aValider.length > 0 && (
            <button type="button" className="btn btn-primary" disabled={occupe}
              onClick={() => openDialog({ type: 'confirmer', c: validationGroupee(selection, new Set(aValider.map(c => c.empId)).size, nombreAvecRepos(d, selection)) })}>
              Valider les feuilles soumises ({aValider.length})
            </button>
          )}
        </div>
      </div>
    }>
      {visibles.length === 0 ? (
        <Fine>{lignes.length ? 'Aucune feuille à saisir, à corriger ni à valider sur les semaines suivies.' : 'Aucun collaborateur suivi.'}</Fine>
      ) : (
        <div className="scroll-x">
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr>
              <ThTri t={t} col="nom">Collaborateur</ThTri>
              {semaines.map(w => (
                <ThTri key={w} t={t} col={`s${w}`} className="center nowrap">
                  <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <span>S{isoWeek(w)}</span>
                    <span style={{ fontSize: 11, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--color-neutral-500)' }}>{fmtShort(parse(w))} → {fmtShort(parse(addD(w, 6)))}</span>
                  </span>
                </ThTri>
              ))}
              <th></th>
            </tr></thead>
            <tbody>
              {visibles.map(({ emp, cellules }) => (
                <tr key={emp.id}>
                  <td><Two main={emp.nom} sub={equipeLabel(emp)} nowrap /></td>
                  {cellules.map(c => (
                    <td key={c.week} className="center">
                      {c.etat ? (
                        <button type="button" className="btn btn-ghost btn-sm plain" onClick={() => ouvrir(c)}
                          title={`${emp.nom}, semaine ${isoWeek(c.week)} : ${ETATS_SEMAINE[c.etat].label}${c.enRetard ? ` — en retard, attendue ${limiteTexte(c.week, s)}` : ''}`}
                          aria-label={`${emp.nom}, semaine ${isoWeek(c.week)} : ${ETATS_SEMAINE[c.etat].label}${c.enRetard ? ', en retard' : ''}`}>
                          <Tag cls={c.enRetard ? 'tag-accent' : ETATS_SEMAINE[c.etat].cls}>{ETATS_SEMAINE[c.etat].court}</Tag>
                        </button>
                      ) : <span className="text-muted" title="Hors contrat ou semaine couverte par une absence">—</span>}
                    </td>
                  ))}
                  <td className="right">
                    {agit && cellules.some(c => c.enRetard) && (
                      <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={relancer(emp.id)}>Relancer</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" checked={tout} onChange={e => setTout(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
        Afficher aussi les collaborateurs à jour
      </label>
      <Fine>
        Feuille attendue {delaiTexte(s)}
        {' '}(réglage de l’administrateur RH, Paramètres → Suivi des feuilles de temps) ; après, elle est en retard et peut être relancée : e-mail au
        {' '}salarié et à son valideur. « — » : semaine hors contrat ou couverte par une absence. Un clic sur une semaine ouvre la feuille.
      </Fine>
    </Panel>
  );
}
