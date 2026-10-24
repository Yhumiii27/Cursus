// Évaluation des formations (lot 7, chantier C, t121 ; shared/rules/evaluation-formation.ts), blocs d'écran :
// - `LignesEvaluationsAFaire` : avis attendus du salarié, dans l'encart « À faire » de Mon espace ;
// - `MesAvisFormations` : avis déjà donnés par le salarié (Mon espace), modifiables tant que l'évaluation est ouverte ;
// - `EvaluationsManagerPanel` : efficacité à froid à évaluer pour l'équipe directe (Formations, espace manager) ;
// - `AvisSession` : avis des participants d'une session clôturée (détail de la session, service RH seulement : notes et
//   commentaires nominatifs), avis recueilli au nom d'un participant ;
// - `IndicateursEvaluationPanel` : indicateurs par organisme et par formation sur l'exercice (Plan & budget ; Formations
//   pour le référent HSE, qui n'a pas Plan & budget), agrégats seuls pour le référent HSE et la lecture seule.
import { useMemo, useState } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { fmtIso, plural } from '../../../shared/format.ts';
import {
  type CibleEvaluation, ciblesEvaluation, concerneFroid, EFFICACITE_LABEL, echeanceFroid, evaluationDe, type EvaluationAFaire, evaluationsAFaireManager,
  exercicesEvaluation, indicateursAffiches, refusEvaluation, TYPE_EVALUATION_LABEL,
} from '../../../shared/rules/evaluation-formation.ts';
import type { EvaluationFormation, LigneEvaluation, RepondantEvaluation, Session, TypeEvaluation } from '../../../shared/types.ts';
import { csvEvaluations } from '../formations-csv.ts';
import { downloadCsv } from '../print.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Btn, Empty, Fine, Panel, Seg, Two } from './ui.tsx';

/** Nombre à la française, une décimale au plus. */
const dec = (n: number) => String(n).replace('.', ',');

/** Réponse donnée : « 4 / 5 » à chaud, l'efficacité à froid. */
export const reponseTexte = (e: Pick<EvaluationFormation, 'type' | 'note' | 'efficacite'>) =>
  e.type === 'chaud' ? `${e.note} / 5` : e.efficacite ? EFFICACITE_LABEL[e.efficacite] : '—';

/** Avis attendus du salarié, en lignes de l'encart « À faire » (pages/Portail.tsx). */
export function LignesEvaluationsAFaire({ liste }: { liste: EvaluationAFaire[] }) {
  const { openDialog } = useStore();
  return <>
    {liste.map(x => (
      <div key={`ev-${x.cible.cle}-${x.type}`} className="list-row">
        <div className="grow">
          <div style={{ fontSize: 14 }}>{x.type === 'chaud' ? 'Votre avis' : 'Efficacité'} — {x.cible.intitule}</div>
          <div className="text-muted sub">
            {x.type === 'chaud'
              ? `Formation terminée le ${fmtIso(x.cible.fin)} : notez-la de 1 à 5`
              : `Formation terminée le ${fmtIso(x.cible.fin)} : vous a-t-elle été utile dans votre travail ?`}
          </div>
        </div>
        <Btn small variant="secondary" style={{ flex: 'none' }} onClick={() => openDialog({ type: 'evaluation', cle: x.cible.cle, quand: x.type })}>
          {x.type === 'chaud' ? 'Donner mon avis' : 'Répondre'}
        </Btn>
      </div>
    ))}
  </>;
}

/** Avis déjà donnés par le salarié (les siens, des 12 derniers mois), modifiables tant que l'évaluation est ouverte. */
export function MesAvisFormations({ empId }: { empId: number }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const lignes = useMemo(() => {
    const cibles = new Map(ciblesEvaluation(d).filter(c => c.empId === empId).map(c => [c.cle, c]));
    const depuis = `${Number(d.ti.slice(0, 4)) - 1}${d.ti.slice(4)}`;
    return (d.ds.evaluationsFormation ?? []).filter(e => e.empId === empId && e.repondant === 'salarie' && e.le >= depuis)
      .flatMap(e => {
        const c = cibles.get(e.participationId ? `p${e.participationId}` : `s${e.formationSuivieId}`);
        return c ? [{ e, c }] : [];
      })
      .sort((a, b) => b.e.le.localeCompare(a.e.le) || b.e.id - a.e.id);
  }, [d, empId]);
  if (!lignes.length) return null;
  return (
    <Panel title="Mes avis sur les formations" style={{ gap: 'var(--space-2)' }}>
      {lignes.map(({ e, c }) => (
        <div key={e.id} className="list-row">
          <div className="grow">
            <div style={{ fontSize: 14 }}>{c.intitule}</div>
            <div className="text-muted sub">{TYPE_EVALUATION_LABEL[e.type]} · {reponseTexte(e)} · le {fmtIso(e.le)}</div>
          </div>
          {!refusEvaluation(d.ds.settings, d.ti, c, e.type, 'salarie') && (
            <Btn small style={{ flex: 'none' }} onClick={() => openDialog({ type: 'evaluation', cle: c.cle, quand: e.type })}>Modifier</Btn>
          )}
        </div>
      ))}
      <Fine>Seul le service RH lit vos commentaires ; votre manager ne voit pas vos avis.</Fine>
    </Panel>
  );
}

/** Efficacité à froid à évaluer pour l'équipe directe du manager connecté (Formations, espace manager). */
export function EvaluationsManagerPanel() {
  const d = useDomain();
  const { me } = useRole();
  const { openDialog } = useStore();
  const aFaire = useMemo(() => evaluationsAFaireManager(d, me), [d, me]);
  if (!d.ds.settings.evaluationsActives || !aFaire.length) return null;
  return (
    <Panel highlight title="Évaluations à froid à faire" aside={plural(aFaire.length, 'formation de votre équipe', 'formations de votre équipe')} style={{ gap: 'var(--space-2)' }}>
      <div className="list">
        {aFaire.map(x => (
          <div key={x.cible.cle} className="list-row">
            <div className="grow">
              <div style={{ fontSize: 14 }}>{d.personName(x.cible.empId)} — {x.cible.intitule}</div>
              <div className="text-muted sub">Formation terminée le {fmtIso(x.cible.fin)} · évaluation demandée depuis le {fmtIso(x.depuis)}</div>
            </div>
            <Btn small variant="secondary" style={{ flex: 'none' }} onClick={() => openDialog({ type: 'evaluation', cle: x.cible.cle, quand: 'froid' })}>Évaluer</Btn>
          </div>
        ))}
      </div>
      <Fine>
        {d.ds.settings.evaluationFroidDelai} jours après la formation : a-t-elle été efficace pour le salarié ? Le salarié donne aussi son avis ; seul
        le service RH lit les commentaires, et chacun ne voit que le sien.
      </Fine>
    </Panel>
  );
}

/** Une cellule d'avis : réponse, date, commentaire (service RH), bouton pour recueillir ou modifier. */
function CelluleAvis({ c, quand, repondant, ouverte }: { c: CibleEvaluation; quand: TypeEvaluation; repondant: RepondantEvaluation; ouverte: boolean }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const e = evaluationDe(d.ds.evaluationsFormation, c, quand, repondant);
  const ouvrir = () => openDialog({ type: 'evaluation', cle: c.cle, quand, repondant });
  return (
    <td>
      {e ? <Two main={reponseTexte(e)} sub={`le ${fmtIso(e.le)}${e.auteur && e.auteurId !== c.empId && repondant === 'salarie' ? ` · recueilli par ${e.auteur}` : ''}`} /> : <span className="text-muted">—</span>}
      {e?.commentaire && <div className="sub" style={{ whiteSpace: 'pre-wrap' }}>{e.commentaire}</div>}
      {ouverte && <div><Btn small onClick={ouvrir}>{e ? 'Modifier' : 'Recueillir'}</Btn></div>}
    </td>
  );
}

/**
 * Avis des participants présents d'une session clôturée (détail de la session) : à chaud, à froid du salarié et du
 * manager. Service RH seulement : notes et commentaires sont nominatifs.
 */
export function AvisSession({ s }: { s: Session }) {
  const d = useDomain();
  const { rh } = useRole();
  const cibles = useMemo(() => ciblesEvaluation(d).filter(c => c.sessionId === s.id).sort((a, b) => d.personName(a.empId).localeCompare(d.personName(b.empId))), [d, s.id]);
  if (!rh || !cibles.length) return null;
  const st = d.ds.settings;
  // Colonnes à froid : formation concernée (catégorie réglée) ; cases vides tant que l'échéance n'est pas venue.
  const froid = cibles.some(c => concerneFroid(st, c));
  const ouverte = (c: CibleEvaluation, quand: TypeEvaluation, r: RepondantEvaluation) => !refusEvaluation(st, d.ti, c, quand, r, true);
  return <>
    <h3 className="section-label">Avis des participants</h3>
    <div className="scroll-x">
      <table className="table">
        <thead><tr><th>Collaborateur</th><th>À chaud</th>{froid && <><th>À froid (salarié)</th><th>À froid (manager)</th></>}</tr></thead>
        <tbody>
          {cibles.map(c => (
            <tr key={c.cle}>
              <td>{d.personName(c.empId)}</td>
              <CelluleAvis c={c} quand="chaud" repondant="salarie" ouverte={ouverte(c, 'chaud', 'salarie')} />
              {froid && <>
                <CelluleAvis c={c} quand="froid" repondant="salarie" ouverte={ouverte(c, 'froid', 'salarie')} />
                <CelluleAvis c={c} quand="froid" repondant="manager" ouverte={ouverte(c, 'froid', 'manager')} />
              </>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <Fine>
      {st.evaluationsActives
        ? `Avis à chaud donné par le salarié dans son espace, ou recueilli ici. Efficacité à froid demandée ${froid ? `à partir du ${fmtIso(echeanceFroid(st, cibles[0]))}` : 'pour les formations réglées dans Paramètres'} au salarié et à son manager, avec des relances par e-mail. Commentaires réservés au service RH.`
        : 'Évaluation des formations désactivée (Paramètres → Évaluation des formations) : les avis déjà donnés restent.'}
    </Fine>
  </>;
}

/** Cellules d'une ligne d'indicateurs : participants, avis à chaud, efficacité à froid, appréciation de session (service RH). */
function LigneIndicateurs({ l }: { l: LigneEvaluation }) {
  const masque = l.masque ? ' (moins de 3 réponses)' : '';
  return (
    <tr>
      <th scope="row" style={{ fontWeight: 'normal' }}>{l.cle}</th>
      <td className="right tnum">{l.participants}</td>
      <td className="right tnum">
        <Two main={l.moyenneChaud == null ? '—' : `${dec(l.moyenneChaud)} / 5`} sub={`${plural(l.chaud, 'avis', 'avis')}${l.tauxChaud == null ? '' : ` · ${l.tauxChaud} %`}${l.chaud && l.moyenneChaud == null ? masque : ''}`} />
      </td>
      <td className="right tnum">
        <Two main={l.tauxEfficacite == null ? '—' : `${l.tauxEfficacite} % efficace`} sub={`${l.froid} / ${l.froidAttendus} réponses${l.froid && l.tauxEfficacite == null ? masque : l.partielles || l.non ? ` · ${l.partielles} partielle${l.partielles > 1 ? 's' : ''}, ${l.non} non` : ''}`} />
      </td>
      <td className="right tnum">{l.moyenneSessions == null ? '—' : <Two main={`${dec(l.moyenneSessions)} / 5`} sub={plural(l.sessionsNotees, 'session', 'sessions')} />}</td>
    </tr>
  );
}

function TableIndicateurs({ titre, lignes, total }: { titre: string; lignes: LigneEvaluation[]; total?: LigneEvaluation }) {
  return (
    <table className="table">
      <thead><tr>
        <th scope="col">{titre}</th><th scope="col" className="right">Participants</th><th scope="col" className="right">À chaud</th>
        <th scope="col" className="right">À froid</th><th scope="col" className="right">Session (RH)</th>
      </tr></thead>
      <tbody>
        {lignes.map(l => <LigneIndicateurs key={l.cle} l={l} />)}
        {total && <LigneIndicateurs l={total} />}
      </tbody>
    </table>
  );
}

/**
 * Indicateurs des évaluations de l'exercice : par organisme et par formation (moyenne à chaud, efficacité à froid, taux de
 * réponse). `exercice` imposé (Plan & budget) ou choisi ici parmi ceux qui ont des formations (Formations).
 */
export function IndicateursEvaluationPanel({ exercice: impose }: { exercice?: number }) {
  const d = useDomain();
  const { notify } = useStore();
  const exercices = useMemo(() => (d.ds.indicateursEvaluation ? d.ds.indicateursEvaluation.map(x => x.exercice) : exercicesEvaluation(d)), [d]);
  const [choisi, setChoisi] = useState(() => Number(d.ti.slice(0, 4)));
  const exercice = impose ?? choisi;
  const x = useMemo(() => indicateursAffiches(d, exercice), [d, exercice]);
  const exporter = () => {
    const c = csvEvaluations(d, x);
    downloadCsv(c.fichier, c.head, c.rows);
    notify('Export CSV des évaluations généré');
  };
  const vide = x.total.participants === 0 && x.total.sessionsNotees === 0;
  return (
    <Panel title={`Évaluation des formations ${exercice}`} aside={<div className="actions-end">
      {impose == null && exercices.length > 1 && (
        <Seg name="eval-exercice" label="Exercice" value={exercice} options={exercices.map(a => [a, String(a)] as [number, string])} onChange={setChoisi} />
      )}
      <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={exporter} disabled={vide}>Exporter les évaluations</Btn>
    </div>} style={{ gap: 'var(--space-3)' }}>
      {vide ? <Empty pad="sm">Aucune formation évaluable sur l’exercice {exercice}.</Empty> : <>
        <div className="text-muted sub">
          {plural(x.total.participants, 'participant', 'participants')} · à chaud {x.total.moyenneChaud == null ? '—' : `${dec(x.total.moyenneChaud)} / 5`} ({plural(x.total.chaud, 'avis', 'avis')})
          {' '}· à froid {x.total.tauxEfficacite == null ? '—' : `${x.total.tauxEfficacite} % efficace`} ({x.total.froid} / {x.total.froidAttendus} réponses)
        </div>
        <div className="scroll-x"><TableIndicateurs titre="Organisme" lignes={x.parOrganisme} /></div>
        <div className="scroll-x"><TableIndicateurs titre="Formation" lignes={x.parFormation} /></div>
      </>}
      <Fine>
        À chaud : note de 1 à 5 du salarié après la formation (taux : avis reçus sur les participants). À froid : efficacité selon le salarié et son
        manager {d.ds.settings.evaluationFroidDelai} jours après, pour les formations concernées (taux d’efficacité : réponses « efficace » sur les
        réponses reçues). Session (RH) : appréciation globale saisie à la clôture avant le lot 7, reprise telle quelle. Exercice : année du premier
        jour de la formation.{d.ds.indicateursEvaluation ? ' Agrégats seulement : sous 3 réponses, ni moyenne ni taux.' : ''}
      </Fine>
    </Panel>
  );
}

