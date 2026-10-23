// Paramètres → Fractionnement des congés (t046, shared/rules/fractionnement.ts) : règle des jours de fractionnement
// (légale supplétive par défaut, fixée par un accord d'entreprise, ou aucun jour par accord collectif, avec la référence
// de l'accord exigée hors de la loi) et période du congé principal (du 1er mai au 31 octobre par défaut). Réglages de
// l'administrateur RH, enregistrés ensemble ; les autres profils de l'espace RH les consultent.
import { useEffect, useState } from 'react';
import type { RegleFractionnement } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { JourMois } from './Entretiens.tsx';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

const REGLES: [RegleFractionnement, string][] = [['legal', 'Règle légale'], ['accord', 'Accord d’entreprise'], ['aucun', 'Aucun jour (accord)']];

export function Fractionnement({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const save = useEnregistrerReglages();
  const [regle, setRegle] = useState(s.fractionnementRegle);
  const [accord, setAccord] = useState(s.fractionnementAccord);
  const [debut, setDebut] = useState(s.fractionnementDebut);
  const [fin, setFin] = useState(s.fractionnementFin);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setRegle(s.fractionnementRegle); setAccord(s.fractionnementAccord); setDebut(s.fractionnementDebut); setFin(s.fractionnementFin); setTente(false);
  }, [s.fractionnementRegle, s.fractionnementAccord, s.fractionnementDebut, s.fractionnementFin]);
  if (!espaceRh) return null;
  const erreurAccord = regle !== 'legal' && !accord.trim() ? 'Indiquez la référence de l’accord collectif d’entreprise (art. L3141-21).' : null;
  const ordre = debut >= fin ? 'Le début de la période doit précéder sa fin, dans la même année.' : null;
  const modifie = regle !== s.fractionnementRegle || accord.trim() !== s.fractionnementAccord || debut !== s.fractionnementDebut || fin !== s.fractionnementFin;
  const enregistrer = async () => {
    if (erreurAccord || ordre) { setTente(true); if (erreurAccord) document.getElementById('param-fract-accord')?.focus(); return; }
    setBusy(true);
    await save({ fractionnementRegle: regle, fractionnementAccord: accord, fractionnementDebut: debut, fractionnementFin: fin });
    setBusy(false);
  };
  return (
    <Panel title="Fractionnement des congés" style={{ gap: 'var(--space-4)' }}>
      <Field label="Jours de fractionnement">
        <Seg name="param-fract-regle" label="Jours de fractionnement" value={regle} options={REGLES} disabled={!admin} onChange={setRegle} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Field label="Référence de l’accord" htmlFor="param-fract-accord" requis={regle !== 'legal'} erreur={tente && erreurAccord}>
        <input className="input" id="param-fract-accord" maxLength={120} placeholder="Accord d’entreprise sur les congés du …" value={accord} disabled={!admin}
          onChange={e => setAccord(e.target.value)} />
      </Field>
      <div className="grid-2">
        <JourMois id="fract-debut" label="Congé principal : début de la période" value={debut} onChange={setDebut} disabled={!admin} />
        <JourMois id="fract-fin" label="Fin de la période" value={fin} onChange={setFin} disabled={!admin} />
      </div>
      {tente && ordre && <p className="form-error">{ordre}</p>}
      {admin && modifie && (
        <div className="actions-end">
          <Btn variant="primary" disabled={busy} onClick={enregistrer}>Enregistrer le fractionnement</Btn>
        </div>
      )}
      <Fine>
        Règle légale, supplétive (art. L3141-23) : 2 jours ouvrables de plus quand le salarié prend hors de la période au moins 6 jours de son congé
        principal (4 semaines, 5e exclue), 1 jour pour 3 à 5 ; crédités en jours ouvrés. Un accord d’entreprise peut fixer d’autres règles ou d’autres
        dates, ou écarter ces jours (art. L3141-21) : à vérifier avec les accords et la CCN des industries chimiques. Le congé principal, au moins
        12 jours ouvrables continus et 24 au plus d’affilée, est seulement signalé ; les jours de fractionnement sont proposés après la période et
        crédités par le service RH, jamais d’office, ou écartés par la renonciation écrite du salarié (art. L3141-19).
      </Fine>
    </Panel>
  );
}
