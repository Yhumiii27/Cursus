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
import { fmtIso } from '../../../shared/format.ts';
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
import { t, tn } from '../i18n/langue.ts';

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
          <div style={{ fontSize: 14 }}>{t(x.type === 'chaud' ? 'Your feedback' : 'Effectiveness')} — {x.cible.intitule}</div>
          <div className="text-muted sub">
            {x.type === 'chaud'
              ? `${t('Training finished on ')}${fmtIso(x.cible.fin)}${t(': rate it from 1 to 5')}`
              : `${t('Training finished on ')}${fmtIso(x.cible.fin)}${t(': was it useful to you in your work?')}`}
          </div>
        </div>
        <Btn small variant="secondary" style={{ flex: 'none' }} onClick={() => openDialog({ type: 'evaluation', cle: x.cible.cle, quand: x.type })}>
          {t(x.type === 'chaud' ? 'Give my feedback' : 'Answer')}
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
    <Panel title={t('My feedback on training')} style={{ gap: 'var(--space-2)' }}>
      {lignes.map(({ e, c }) => (
        <div key={e.id} className="list-row">
          <div className="grow">
            <div style={{ fontSize: 14 }}>{c.intitule}</div>
            <div className="text-muted sub">{TYPE_EVALUATION_LABEL[e.type]} · {reponseTexte(e)} · {t('on#le')} {fmtIso(e.le)}</div>
          </div>
          {!refusEvaluation(d.ds.settings, d.ti, c, e.type, 'salarie') && (
            <Btn small style={{ flex: 'none' }} onClick={() => openDialog({ type: 'evaluation', cle: c.cle, quand: e.type })}>{t('Edit')}</Btn>
          )}
        </div>
      ))}
      <Fine>{t('Only HR reads your comments; your manager does not see your feedback.')}</Fine>
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
    <Panel highlight title={t('After-the-fact evaluations to do')} aside={tn(aFaire.length, 'training course of your team', 'training courses of your team')} style={{ gap: 'var(--space-2)' }}>
      <div className="list">
        {aFaire.map(x => (
          <div key={x.cible.cle} className="list-row">
            <div className="grow">
              <div style={{ fontSize: 14 }}>{d.personName(x.cible.empId)} — {x.cible.intitule}</div>
              <div className="text-muted sub">{t('Training finished on ')}{fmtIso(x.cible.fin)}{t(' · evaluation requested since ')}{fmtIso(x.depuis)}</div>
            </div>
            <Btn small variant="secondary" style={{ flex: 'none' }} onClick={() => openDialog({ type: 'evaluation', cle: x.cible.cle, quand: 'froid' })}>{t('Evaluate')}</Btn>
          </div>
        ))}
      </div>
      <Fine>
        {d.ds.settings.evaluationFroidDelai}{t(' days after the training: was it effective for the employee? The employee also gives their feedback; only HR reads the comments, and each one only sees their own.')}
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
      {e ? <Two main={reponseTexte(e)} sub={`${t('on#le')} ${fmtIso(e.le)}${e.auteur && e.auteurId !== c.empId && repondant === 'salarie' ? `${t(' · collected by ')}${e.auteur}` : ''}`} /> : <span className="text-muted">—</span>}
      {e?.commentaire && <div className="sub" style={{ whiteSpace: 'pre-wrap' }}>{e.commentaire}</div>}
      {ouverte && <div><Btn small onClick={ouvrir}>{t(e ? 'Edit' : 'Collect')}</Btn></div>}
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
    <h3 className="section-label">{t('Feedback of the participants')}</h3>
    <div className="scroll-x">
      <table className="table">
        <thead><tr><th>{t('Employee')}</th><th>{t('Immediate')}</th>{froid && <><th>{t('After the fact (employee)')}</th><th>{t('After the fact (manager)')}</th></>}</tr></thead>
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
        ? `${t('Immediate feedback given by the employee in their space, or collected here. After-the-fact effectiveness asked ')}${froid ? `${t('from #du')}${fmtIso(echeanceFroid(st, cibles[0]))}` : t('for the training courses set in Settings')}${t(' of the employee and their manager, with reminders by e-mail. Comments reserved for HR.')}`
        : t('Training evaluation deactivated (Settings → Training evaluation): the feedback already given remains.')}
    </Fine>
  </>;
}

/** Cellules d'une ligne d'indicateurs : participants, avis à chaud, efficacité à froid, appréciation de session (service RH). */
function LigneIndicateurs({ l }: { l: LigneEvaluation }) {
  const masque = l.masque ? t(' (fewer than 3 answers)') : '';
  return (
    <tr>
      <th scope="row" style={{ fontWeight: 'normal' }}>{l.cle}</th>
      <td className="right tnum">{l.participants}</td>
      <td className="right tnum">
        <Two main={l.moyenneChaud == null ? '—' : `${dec(l.moyenneChaud)} / 5`} sub={`${tn(l.chaud, 'feedback', 'feedbacks')}${l.tauxChaud == null ? '' : ` · ${l.tauxChaud} %`}${l.chaud && l.moyenneChaud == null ? masque : ''}`} />
      </td>
      <td className="right tnum">
        <Two main={l.tauxEfficacite == null ? '—' : `${l.tauxEfficacite}${t(' % effective')}`} sub={`${l.froid} / ${l.froidAttendus}${t(' answers')}${l.froid && l.tauxEfficacite == null ? masque : l.partielles || l.non ? ` · ${tn(l.partielles, 'partial', 'partial#plural')}, ${l.non}${t(' no#answer')}` : ''}`} />
      </td>
      <td className="right tnum">{l.moyenneSessions == null ? '—' : <Two main={`${dec(l.moyenneSessions)} / 5`} sub={tn(l.sessionsNotees, 'session', 'sessions')} />}</td>
    </tr>
  );
}

function TableIndicateurs({ titre, lignes, total }: { titre: string; lignes: LigneEvaluation[]; total?: LigneEvaluation }) {
  return (
    <table className="table">
      <thead><tr>
        <th scope="col">{titre}</th><th scope="col" className="right">{t('Participants')}</th><th scope="col" className="right">{t('Immediate')}</th>
        <th scope="col" className="right">{t('After the fact')}</th><th scope="col" className="right">{t('Session (HR)')}</th>
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
    notify(t('CSV export of the evaluations generated'));
  };
  const vide = x.total.participants === 0 && x.total.sessionsNotees === 0;
  return (
    <Panel title={`${t('Training evaluation ')}${exercice}`} aside={<div className="actions-end">
      {impose == null && exercices.length > 1 && (
        <Seg name="eval-exercice" label={t('Financial year')} value={exercice} options={exercices.map(a => [a, String(a)] as [number, string])} onChange={setChoisi} />
      )}
      <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={exporter} disabled={vide}>{t('Export the evaluations')}</Btn>
    </div>} style={{ gap: 'var(--space-3)' }}>
      {vide ? <Empty pad="sm">{t('No training course to evaluate in the financial year ')}{exercice}.</Empty> : <>
        <div className="text-muted sub">
          {tn(x.total.participants, 'participant', 'participants')}{t(' · immediate ')}{x.total.moyenneChaud == null ? '—' : `${dec(x.total.moyenneChaud)} / 5`} ({tn(x.total.chaud, 'feedback', 'feedbacks')})
          {' '}{t('· after the fact ')}{x.total.tauxEfficacite == null ? '—' : `${x.total.tauxEfficacite}${t(' % effective')}`} ({x.total.froid} / {x.total.froidAttendus}{t(' answers')})
        </div>
        <div className="scroll-x"><TableIndicateurs titre={t('Provider')} lignes={x.parOrganisme} /></div>
        <div className="scroll-x"><TableIndicateurs titre={t('Training course')} lignes={x.parFormation} /></div>
      </>}
      <Fine>
        {t('Immediate: rating from 1 to 5 by the employee after the training (rate: feedback received out of the participants). After the fact: effectiveness according to the employee and their manager ')}{d.ds.settings.evaluationFroidDelai}{t(' days afterwards, for the training courses concerned (effectiveness rate: “effective” answers out of the answers received). Session (HR): overall rating entered at closing before lot 7, taken over as is. Financial year: year of the first day of the training.')}{d.ds.indicateursEvaluation ? t(' Aggregates only: below 3 answers, neither average nor rate.') : ''}
      </Fine>
    </Panel>
  );
}

