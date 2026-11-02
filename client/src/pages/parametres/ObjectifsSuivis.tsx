// lot 12 — C3 (entretiens suivis, t194) : Paramètres → Objectifs et points de suivi. Réglages de l'administrateur RH,
// enregistrés aussitôt (les autres profils les consultent) :
// - objectifs suivis aux entretiens annuels, nombre au plus par entretien, mode « objectifs facultatifs » (activé la
//   première année : la clôture n'exige pas l'évaluation des objectifs repris) ;
// - point de mi-année facultatif, ou dû dans une fenêtre réglable (échéance, relances) ;
// - versement des souhaits de formation (réponse du propriétaire du 1er novembre 2026 : à la clôture, avis favorable du
//   manager seulement ; pas de réglage) ;
// - feedback 360° : désactivé, activable à l'étape 3 seulement avec la référence de l'avis du CSE et de l'AIPD.
import { type ReactNode, useState } from 'react';
import { miAnnee } from '../../../../shared/rules/entretiens.ts';
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
  if (!espaceRh) return null;
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

      <NoteAccent>
        Feedback 360° : désactivé. Il ne pourra être activé qu’avec la référence de l’avis du CSE (art. L2312-38) et de l’analyse d’impact (AIPD), une fois le
        questionnaire porté à la connaissance des salariés (art. L1222-3). Les réponses restent confidentielles : jamais restituées sous 3 par catégorie.
      </NoteAccent>
    </Panel>
  );
}
