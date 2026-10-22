// Paramètres → Forfait jours (t043, shared/rules/forfait-jours.ts) : seuil d'alerte du cumul annuel des jours travaillés
// (suivi toujours actif), et renonciation à des jours de repos par avenant — fermée par défaut, ouverte seulement avec la
// référence de l'accord collectif qui autorise le forfait jours (COHERENCE de shared/reglages.ts, art. L3121-63 et
// L3121-64) : plafond des jours travaillés avec avenant (235 à défaut d'accord, art. L3121-66), majoration minimale (10 %,
// art. L3121-59), période de paie des jours rachetés (JREN). Réglages de l'administrateur RH ; les autres profils de
// l'espace RH consultent. Le seuil s'enregistre aussitôt ; la renonciation, au bouton « Enregistrer ».
import { useEffect, useState } from 'react';
import { FORFAIT_LEGAL, MAJORATION_MINIMALE, PLAFOND_SUPPLETIF } from '../../../../shared/rules/forfait-jours.ts';
import type { EmissionJren, Settings } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, NoteAccent, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

const ALERTES = Array.from({ length: 11 }, (_, i) => 50 + i * 5);
const EMISSIONS: [EmissionJren, string][] = [['signature', 'Mois de la signature'], ['cloture', 'Décembre de l’année']];

export function ForfaitJours({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const save = useEnregistrerReglages();
  // Renonciation : champs enregistrés ensemble (la case exige la référence de l'accord).
  const [rachat, setRachat] = useState(s.forfaitJoursRachat);
  const [accord, setAccord] = useState(s.forfaitJoursAccord);
  const [plafond, setPlafond] = useState(String(s.forfaitJoursPlafond));
  const [majoration, setMajoration] = useState(String(s.forfaitJoursMajorationMin));
  const [emission, setEmission] = useState<EmissionJren>(s.forfaitJoursJren);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setRachat(s.forfaitJoursRachat); setAccord(s.forfaitJoursAccord); setPlafond(String(s.forfaitJoursPlafond));
    setMajoration(String(s.forfaitJoursMajorationMin)); setEmission(s.forfaitJoursJren); setTente(false);
  }, [s.forfaitJoursRachat, s.forfaitJoursAccord, s.forfaitJoursPlafond, s.forfaitJoursMajorationMin, s.forfaitJoursJren]);
  if (!espaceRh) return null;

  const p = Number(plafond), m = Number(majoration);
  const erreurAccord = rachat && !accord.trim() ? 'Indiquez la référence de l’accord collectif qui autorise le forfait jours.' : null;
  const erreurPlafond = !/^\d{3}$/.test(plafond.trim()) || p < FORFAIT_LEGAL || p > 282 ? `Indiquez un nombre de jours entier, de ${FORFAIT_LEGAL} à 282.` : null;
  const erreurMajoration = !/^\d{1,3}$/.test(majoration.trim()) || m < MAJORATION_MINIMALE || m > 100 ? `Indiquez un pourcentage entier, de ${MAJORATION_MINIMALE} à 100.` : null;
  const modifie = rachat !== s.forfaitJoursRachat || accord.trim() !== s.forfaitJoursAccord || p !== s.forfaitJoursPlafond || m !== s.forfaitJoursMajorationMin || emission !== s.forfaitJoursJren;
  const enregistrer = async () => {
    const erreur = [['fj-accord', erreurAccord], ['fj-plafond', erreurPlafond], ['fj-majoration', erreurMajoration]].find(([, e]) => e);
    if (erreur) { setTente(true); document.getElementById(erreur[0]!)?.focus(); return; }
    setBusy(true);
    await save({ forfaitJoursRachat: rachat, forfaitJoursAccord: accord, forfaitJoursPlafond: p, forfaitJoursMajorationMin: m, forfaitJoursJren: emission } satisfies Partial<Settings>);
    setBusy(false);
  };

  return (
    <Panel title="Forfait jours" style={{ gap: 'var(--space-4)' }}>
      <Field label="Alerte du cumul annuel" htmlFor="fj-alerte">
        <select className="input" id="fj-alerte" value={s.forfaitJoursAlerte} disabled={!admin} onChange={e => save({ forfaitJoursAlerte: Number(e.target.value) })} style={{ maxWidth: 240 }}>
          {ALERTES.map(v => <option key={v} value={v}>{v} % du plafond</option>)}
        </select>
      </Field>
      <Fine>
        Jours travaillés des feuilles validées de l’année (une demi-journée jusqu’à 4 h, une journée au-delà), comparés au forfait de la fiche ({FORFAIT_LEGAL} jours
        au plus, art. L3121-64) au prorata de la présence. Alerte sur la feuille, la file de validation et la fiche ; au-delà du plafond, la validation de la
        feuille exige un motif. Les jours de repos restants sont rappelés sur la fiche.
      </Fine>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={rachat} disabled={!admin} onChange={e => { setRachat(e.target.checked); setTente(false); }}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          Permettre la renonciation à des jours de repos par avenant
          <span className="text-muted sub" style={{ display: 'block' }}>Seulement si l’accord collectif qui autorise le forfait jours le prévoit (art. L3121-63 et L3121-64).</span>
        </span>
      </label>
      <Field label="Référence de l’accord collectif" htmlFor="fj-accord" requis={rachat} erreur={tente && erreurAccord}>
        <input className="input" id="fj-accord" maxLength={120} placeholder="Accord d’entreprise sur le temps de travail du …" value={accord} disabled={!admin} onChange={e => setAccord(e.target.value)} />
      </Field>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label="Plafond avec avenant (jours)" htmlFor="fj-plafond" requis erreur={tente && erreurPlafond}>
          <input className="input tnum" id="fj-plafond" inputMode="numeric" value={plafond} disabled={!admin} onChange={e => setPlafond(e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
        <Field label="Majoration minimale (%)" htmlFor="fj-majoration" requis erreur={tente && erreurMajoration}>
          <input className="input tnum" id="fj-majoration" inputMode="numeric" value={majoration} disabled={!admin} onChange={e => setMajoration(e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
      </div>
      <Field label="Jours rachetés dans la paie (JREN)">
        <Seg name="fj-jren" label="Jours rachetés dans la paie (JREN)" value={emission} options={EMISSIONS} disabled={!admin} onChange={setEmission} style={{ flexWrap: 'wrap' }} />
      </Field>
      {admin && modifie && <div className="actions-end"><Btn variant="primary" disabled={busy} onClick={enregistrer}>Enregistrer la renonciation</Btn></div>}
      {!s.forfaitJoursRachat && <NoteAccent>Accord collectif sur le forfait jours non référencé : suivi du cumul et alertes seulement, aucun avenant de renonciation.</NoteAccent>}
      <Fine>
        Valeurs de la loi à défaut d’accord : {PLAFOND_SUPPLETIF} jours travaillés au plus avec avenant (art. L3121-66), majoration d’au moins {MAJORATION_MINIMALE} %
        (art. L3121-59). L’avenant, écrit et valable pour l’année, s’enregistre sur la fiche du salarié ; ses jours rachetés partent à la paie sous la rubrique
        JREN, désactivée tant que la paie n’a pas donné son code : ils sont alors listés « à saisir dans Sage » dans le résumé du lot.
      </Fine>
    </Panel>
  );
}
