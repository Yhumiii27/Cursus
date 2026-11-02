// lot 12 — C3 (entretiens suivis, t194) : Paramètres → Objectifs et points de suivi. Réglages de l'administrateur RH,
// enregistrés aussitôt (les autres profils les consultent) :
// - objectifs suivis aux entretiens annuels, nombre au plus par entretien, mode « objectifs facultatifs » (activé la
//   première année : la clôture n'exige pas l'évaluation des objectifs repris) ;
// - point de mi-année facultatif, ou dû dans une fenêtre réglable (échéance, relances) ;
// - versement des souhaits de formation (réponse du propriétaire du 1er novembre 2026 : à la clôture, avis favorable du
//   manager seulement ; pas de réglage) ;
// - feedback 360° (étape 3) : désactivé ; activable seulement avec la référence de l'avis du CSE et celle de l'AIPD
//   (refus du serveur sinon, COHERENCE de shared/reglages.ts) ; seuil de restitution (3 à 5), fenêtre de réponse,
//   conservation des réponses brutes (6 mois au plus). Références enregistrées d'un bloc.
import { type ReactNode, useState } from 'react';
import { miAnnee } from '../../../../shared/rules/entretiens.ts';
import { CONSERVATION_360_MAX_MOIS, QUESTIONNAIRE_360, SEUIL_360_MAX, SEUIL_360_MIN } from '../../../../shared/rules/feedback360.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, NoteAccent, Panel, Seg } from '../../components/ui.tsx';
import { useDomain, useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { JourMois } from './Entretiens.tsx';

/** Nombres proposés, tous acceptés par le réglage (`entier(1, 20)`, shared/reglages.ts). */
const MAXIMA = [3, 5, 8, 10, 12];

function Case({ checked, disabled, onChange, children }: { checked: boolean; disabled: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: disabled ? undefined : 'pointer' }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
      <span>{children}</span>
    </label>
  );
}

export function ObjectifsSuivis({ s }: SectionProps) {
  const d = useDomain();
  const { admin, espaceRh } = useRole();
  const enregistrer = useEnregistrerReglages();
  // Fenêtre du point de mi-année en cours de saisie : enregistrée d'un bloc (le serveur refuse un début après la fin).
  const [debut, setDebut] = useState<string | null>(null);
  const [fin, setFin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Feedback 360° : références de l'avis du CSE et de l'AIPD en cours de saisie, enregistrées d'un bloc.
  const [cse, setCse] = useState<string | null>(null);
  const [aipd, setAipd] = useState<string | null>(null);
  if (!espaceRh) return null;
  const rCse = cse ?? s.feedback360Cse, rAipd = aipd ?? s.feedback360Aipd;
  const refsModifiees = rCse !== s.feedback360Cse || rAipd !== s.feedback360Aipd;
  const enregistrerRefs = async () => {
    if (busy) return;
    setBusy(true);
    const r = await enregistrer({ feedback360Cse: rCse, feedback360Aipd: rAipd });
    setBusy(false);
    if (r.ok) { setCse(null); setAipd(null); }
  };
  const dDebut = debut ?? s.pointMiAnneeDebut, dFin = fin ?? s.pointMiAnneeFin;
  const modifiees = dDebut !== s.pointMiAnneeDebut || dFin !== s.pointMiAnneeFin;
  const ordre = dDebut > dFin ? 'Le début de la fenêtre doit précéder sa fin, dans la même année.' : null;
  const pm = miAnnee({ ...s, pointMiAnneeActif: true, pointMiAnneeDebut: dDebut, pointMiAnneeFin: dFin }, d.year)!;
  const enregistrerFenetre = async () => {
    if (busy || ordre) return;
    setBusy(true);
    const r = await enregistrer({ pointMiAnneeDebut: dDebut, pointMiAnneeFin: dFin });
    setBusy(false);
    if (r.ok) { setDebut(null); setFin(null); }
  };

  return (
    <Panel title="Objectifs et points de suivi" style={{ gap: 'var(--space-4)' }}>
      <Case checked={s.objectifsActifs} disabled={!admin} onChange={v => enregistrer({ objectifsActifs: v })}>
        Suivre des objectifs structurés aux entretiens annuels
        <span className="text-muted sub" style={{ display: 'block' }}>Fixés et évalués à l’entretien annuel, ajustés en cours d’année avec un motif ; le salarié propose, le manager valide. Désactivé : ni saisie ni « Mes objectifs », les objectifs déjà fixés restent en base.</span>
      </Case>
      <Case checked={s.objectifsFacultatifs} disabled={!admin || !s.objectifsActifs} onChange={v => enregistrer({ objectifsFacultatifs: v })}>
        Objectifs facultatifs (première année)
        <span className="text-muted sub" style={{ display: 'block' }}>La clôture d’un entretien annuel n’exige pas l’évaluation des objectifs repris. Une proposition du salarié reste à valider ou retirer avant la clôture.</span>
      </Case>
      <Field label="Objectifs au plus par entretien">
        <Seg name="param-objectifs-max" label="Nombre d’objectifs au plus par entretien" value={s.objectifsMax}
          options={[...new Set([...MAXIMA, s.objectifsMax])].sort((a, z) => a - z).map(n => [n, String(n)] as [number, string])}
          disabled={!admin || !s.objectifsActifs} onChange={v => enregistrer({ objectifsMax: v })} style={{ flexWrap: 'wrap' }} />
      </Field>

      <Case checked={s.pointMiAnneeActif} disabled={!admin} onChange={v => enregistrer({ pointMiAnneeActif: v })}>
        Rendre le point de mi-année obligatoire
        <span className="text-muted sub" style={{ display: 'block' }}>Facultatif par défaut. Obligatoire : il devient une échéance de chaque salarié concerné par la campagne, relancée comme les autres entretiens.</span>
      </Case>
      <div className="grid-2">
        <JourMois id="pm-debut" label="Ouverture de la fenêtre" value={dDebut} onChange={setDebut} disabled={!admin || !s.pointMiAnneeActif} />
        <JourMois id="pm-fin" label="Fin de la fenêtre (échéance)" value={dFin} onChange={setFin} disabled={!admin || !s.pointMiAnneeActif} />
      </div>
      {ordre && <p className="form-error">{ordre}</p>}
      {admin && modifiees && (
        <div className="actions-end">
          <Btn variant="secondary" disabled={busy} onClick={() => { setDebut(null); setFin(null); }}>Annuler</Btn>
          <Btn variant="primary" disabled={busy} onClick={enregistrerFenetre}>Enregistrer la fenêtre</Btn>
        </div>
      )}
      <Fine>{s.pointMiAnneeActif ? pm.libelle : `${pm.libelle.replace(/^Point de mi-année \d+ — /, 'Fenêtre prévue ')} (appliquée si le point devient obligatoire)`}.</Fine>

      <Field label="Souhaits de formation exprimés en entretien">
        <p style={{ fontSize: 14, margin: 0 }}>Versés automatiquement à la clôture, seulement avec l’avis favorable du manager.</p>
      </Field>
      <Fine>Chaque souhait favorable devient une demande de formation au service RH, contrôlée comme une demande du salarié (jamais deux fois, ni pendant une inscription à venir) ; acceptée, elle donne une ligne du plan d’origine « entretien ». Les autres souhaits restent au compte rendu.</Fine>

      <Case checked={s.feedback360Actif} disabled={!admin} onChange={v => enregistrer({ feedback360Actif: v })}>
        Feedback 360° (avis de collègues, du N+2 et de collaborateurs encadrés)
        <span className="text-muted sub" style={{ display: 'block' }}>
          Moyen d’évaluation des salariés : activé seulement avec la référence de l’avis du CSE (art. L2312-38) et de l’analyse d’impact (AIPD), une fois le questionnaire
          (version {QUESTIONNAIRE_360.version}) porté à la connaissance des salariés (art. L1222-3). Désactivé : plus de sollicitation ; les synthèses déjà jointes restent.
        </span>
      </Case>
      <div className="grid-2">
        <Field label="Référence de l’avis du CSE" htmlFor="f360-cse">
          <input className="input" id="f360-cse" value={rCse} maxLength={120} disabled={!admin} placeholder="Ex. : avis du CSE du 12 mars 2027" onChange={ev => setCse(ev.target.value)} />
        </Field>
        <Field label="Référence de l’AIPD" htmlFor="f360-aipd">
          <input className="input" id="f360-aipd" value={rAipd} maxLength={120} disabled={!admin} placeholder="Ex. : AIPD-2027-02 validée par le DPO" onChange={ev => setAipd(ev.target.value)} />
        </Field>
      </div>
      {admin && refsModifiees && (
        <div className="actions-end">
          <Btn variant="secondary" disabled={busy} onClick={() => { setCse(null); setAipd(null); }}>Annuler</Btn>
          <Btn variant="primary" disabled={busy} onClick={enregistrerRefs}>Enregistrer les références</Btn>
        </div>
      )}
      <Field label="Seuil de restitution (réponses par groupe)">
        <Seg name="param-f360-seuil" label="Seuil de restitution du feedback 360°" value={s.feedback360Seuil}
          options={Array.from({ length: SEUIL_360_MAX - SEUIL_360_MIN + 1 }, (_, i) => SEUIL_360_MIN + i).map(n => [n, String(n)] as [number, string])}
          disabled={!admin} onChange={v => enregistrer({ feedback360Seuil: v })} />
      </Field>
      <div className="grid-2">
        <Field label="Fenêtre de réponse (jours)">
          <Seg name="param-f360-fenetre" label="Fenêtre de réponse du feedback 360°" value={s.feedback360FenetreJours}
            options={[...new Set([14, 21, 28, 42, s.feedback360FenetreJours])].sort((a, z) => a - z).map(n => [n, String(n)] as [number, string])}
            disabled={!admin} onChange={v => enregistrer({ feedback360FenetreJours: v })} style={{ flexWrap: 'wrap' }} />
        </Field>
        <Field label="Réponses brutes gardées (mois)">
          <Seg name="param-f360-conservation" label="Conservation des réponses brutes du feedback 360°" value={s.feedback360ConservationMois}
            options={[...new Set([2, 3, CONSERVATION_360_MAX_MOIS, s.feedback360ConservationMois])].sort((a, z) => a - z).map(n => [n, String(n)] as [number, string])}
            disabled={!admin} onChange={v => enregistrer({ feedback360ConservationMois: v })} style={{ flexWrap: 'wrap' }} />
        </Field>
      </div>
      <Fine>
        Réponses confidentielles : versées d’un bloc à la clôture, sans répondant ni date ; restituées en moyenne par groupe d’au moins {s.feedback360Seuil} réponses (jamais
        moins de 3), commentaires après la relecture du service RH. Réponses brutes supprimées à la clôture de l’entretien, et au plus tard {s.feedback360ConservationMois} mois
        après l’envoi ; la synthèse reste au compte rendu.
      </Fine>
      {!s.feedback360Actif && <NoteAccent>Feedback 360° désactivé : à activer après l’avis du CSE, l’analyse d’impact du DPO et l’information des salariés.</NoteAccent>}
    </Panel>
  );
}
