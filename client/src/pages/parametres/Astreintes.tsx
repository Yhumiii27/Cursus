// Paramètres → Astreintes (t049, lot 7, étape 2 ; shared/rules/astreintes.ts) : délai de prévenance de la programmation
// (15 jours à défaut d'accord, art. R3121-3 ; plus court, seulement avec la référence de l'accord collectif, COHERENCE de
// shared/reglages.ts, art. L3121-11), forme de la compensation (financière par défaut, réponse de l'entreprise du
// 23 octobre 2026), astreinte d'un salarié mineur (refusée par défaut). Réglages de l'administrateur RH ; les autres
// profils de l'espace RH consultent. La compensation et la case des mineurs s'enregistrent aussitôt ; le délai et la
// référence de l'accord, ensemble, au bouton « Enregistrer ».
import { useEffect, useState } from 'react';
import { COMPENSATION_LABEL, DELAI_JOUR_FRANC, DELAI_PREVENANCE_LEGAL } from '../../../../shared/rules/astreintes.ts';
import type { CompensationAstreinte } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, NoteAccent, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

const COMPENSATIONS = Object.entries(COMPENSATION_LABEL) as [CompensationAstreinte, string][];
/** Délai de prévenance au plus (jours), comme le contrôle du réglage (shared/reglages.ts). */
const DELAI_MAX = 60;

export function Astreintes({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const save = useEnregistrerReglages();
  // Délai et accord : enregistrés ensemble (un délai de moins de 15 jours exige la référence de l'accord).
  const [delai, setDelai] = useState(String(s.astreinteDelaiPrevenance));
  const [accord, setAccord] = useState(s.astreinteAccord);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDelai(String(s.astreinteDelaiPrevenance)); setAccord(s.astreinteAccord); setTente(false); }, [s.astreinteDelaiPrevenance, s.astreinteAccord]);
  if (!espaceRh) return null;

  const n = Number(delai);
  const erreurDelai = !/^\d{1,2}$/.test(delai.trim()) || n < DELAI_JOUR_FRANC || n > DELAI_MAX ? `Indiquez un nombre de jours entier, de ${DELAI_JOUR_FRANC} à ${DELAI_MAX}.` : null;
  const erreurAccord = !erreurDelai && n < DELAI_PREVENANCE_LEGAL && !accord.trim()
    ? `Un délai de moins de ${DELAI_PREVENANCE_LEGAL} jours suppose un accord collectif (art. L3121-11) : indiquez sa référence.` : null;
  const modifie = n !== s.astreinteDelaiPrevenance || accord.trim() !== s.astreinteAccord;
  const enregistrer = async () => {
    const erreur = [['ast-delai', erreurDelai], ['ast-accord', erreurAccord]].find(([, e]) => e);
    if (erreur) { setTente(true); document.getElementById(erreur[0]!)?.focus(); return; }
    setBusy(true);
    await save({ astreinteDelaiPrevenance: n, astreinteAccord: accord });
    setBusy(false);
  };

  return (
    <Panel title="Astreintes" style={{ gap: 'var(--space-4)' }}>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label="Délai de prévenance (jours)" htmlFor="ast-delai" requis erreur={tente && erreurDelai}>
          <input className="input tnum" id="ast-delai" inputMode="numeric" value={delai} disabled={!admin} onChange={e => setDelai(e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
      </div>
      <Field label={<>Référence de l’accord sur les astreintes{n >= DELAI_PREVENANCE_LEGAL && <span className="who"> · facultatif</span>}</>} htmlFor="ast-accord"
        requis={n < DELAI_PREVENANCE_LEGAL} erreur={tente && erreurAccord}>
        <input className="input" id="ast-accord" maxLength={120} placeholder="Accord d’entreprise sur le temps de travail du …" value={accord} disabled={!admin} onChange={e => setAccord(e.target.value)} />
      </Field>
      {admin && modifie && <div className="actions-end"><Btn variant="primary" disabled={busy} onClick={enregistrer}>Enregistrer le délai</Btn></div>}
      <Fine>
        La programmation individuelle est communiquée au salarié au moins {DELAI_PREVENANCE_LEGAL} jours à l’avance à défaut d’accord (art. R3121-3) : e-mail et
        événement d’agenda. En dessous du délai réglé, la planification exige le motif des circonstances exceptionnelles ; jamais moins d’un jour franc.
      </Fine>

      <Field label="Forme de la compensation">
        <Seg name="ast-compensation" label="Forme de la compensation" value={s.astreinteCompensation} options={COMPENSATIONS} disabled={!admin}
          onChange={v => save({ astreinteCompensation: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      {!s.astreinteAccord && <NoteAccent>Accord sur les astreintes non référencé : forme et montant de la compensation à confirmer. Le récapitulatif mensuel remis au salarié (art. R3121-2) indique la forme réglée ici.</NoteAccent>}
      <Fine>
        Chaque astreinte donne lieu à une compensation, financière ou en repos (art. L3121-9). Cursus transmet à la paie les heures (AST_H) et les périodes
        (AST_PER) d’astreinte terminées ; le montant ou la durée du repos (AST_COMP) suivra l’accord. Ces rubriques sont désactivées tant que la paie n’a pas
        donné leurs codes : les éléments sont listés « à saisir dans Sage » dans le résumé du lot. Les interventions sont du travail effectif, décomptées sur la
        feuille de temps (heures normales, supplémentaires, de nuit et du dimanche).
      </Fine>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.astreinteMineurs} disabled={!admin} onChange={e => save({ astreinteMineurs: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          Admettre l’astreinte d’un salarié de moins de 18 ans
          <span className="text-muted sub" style={{ display: 'block' }}>Décochée par défaut : le travail de nuit lui est interdit (art. L3163-2) et une intervention ne se programme pas.</span>
        </span>
      </label>
    </Panel>
  );
}
