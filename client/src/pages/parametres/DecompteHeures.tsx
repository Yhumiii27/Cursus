// Paramètres → Décompte des heures (shared/rules/majorations.ts et durees.ts) : saisie un jour férié et majoration des
// fériés autres que le 1er mai (celui-ci : 100 %, fixé par la loi), plafond des heures complémentaires du temps partiel
// (le tiers seulement avec la référence d'un accord), moyenne maximale sur 12 semaines (46 h seulement avec la référence
// d'un accord), contingent annuel d'heures supplémentaires et seuil d'alerte. Réglages de l'administrateur RH ; les
// autres profils consultent. Les choix qui supposent un accord ne s'enregistrent qu'avec sa référence (COHERENCE de
// shared/reglages.ts) ; revenir à la valeur légale s'enregistre aussitôt, la référence gardée pour mémoire.
import { useEffect, useState } from 'react';
import { CONTINGENT_A_VERIFIER, CONTINGENT_LEGAL, MOYENNE_LEGALE, TAUX_COR } from '../../../../shared/rules/durees.ts';
import { MAJORATION_1ER_MAI } from '../../../../shared/rules/majorations.ts';
import type { PlafondComplementaires, Settings } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

/** Majoration des fériés (%) : de 0 à 100 par pas de 5 (contrôle entier(0, 100, 5) de shared/reglages.ts). */
const MAJORATIONS = Array.from({ length: 21 }, (_, i) => i * 5);
const PLAFONDS: [PlafondComplementaires, string][] = [['dixieme', 'Le dixième (loi)'], ['tiers', 'Le tiers (accord)']];
const MOYENNES: [number, string][] = [[44, '44 h (loi)'], [45, '45 h (accord)'], [46, '46 h (accord)']];
const ALERTES = Array.from({ length: 11 }, (_, i) => 50 + i * 5);

/**
 * Choix qui suppose un accord collectif : la valeur légale s'enregistre aussitôt ; une autre, avec la référence de
 * l'accord, au bouton « Enregistrer ».
 */
function useChoixAccord<T>(valeur: T, accordEnVigueur: string, legal: T, enregistrer: (v: T, accord: string) => Promise<unknown>) {
  const [choix, setChoix] = useState<T>(valeur);
  const [accord, setAccord] = useState(accordEnVigueur);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setChoix(valeur); setAccord(accordEnVigueur); setTente(false); }, [valeur, accordEnVigueur]);
  const choisir = (v: T) => {
    setChoix(v);
    setTente(false);
    if (v === legal && valeur !== legal) void enregistrer(v, accordEnVigueur);
  };
  const erreur = choix !== legal && !accord.trim() ? 'Indiquez la référence de l’accord collectif.' : null;
  const modifie = choix !== valeur || (choix !== legal && accord.trim() !== accordEnVigueur);
  const valider = async (id: string) => {
    if (erreur) { setTente(true); document.getElementById(id)?.focus(); return; }
    setBusy(true);
    await enregistrer(choix, accord);
    setBusy(false);
  };
  return { choix, choisir, accord, setAccord, erreur: tente ? erreur : null, modifie, valider, busy };
}

export function DecompteHeures({ s }: SectionProps) {
  const { admin } = useRole();
  const save = useEnregistrerReglages();
  const hc = useChoixAccord<PlafondComplementaires>(s.plafondHeuresComplementaires, s.heuresComplementairesAccord, 'dixieme',
    (v, accord) => save({ plafondHeuresComplementaires: v, heuresComplementairesAccord: accord }));
  const moy = useChoixAccord<number>(s.moyenne12SemainesMax, s.moyenne12SemainesAccord, MOYENNE_LEGALE,
    (v, accord) => save({ moyenne12SemainesMax: v, moyenne12SemainesAccord: accord }));

  // Contingent : trois champs enregistrés ensemble.
  const [contingent, setContingent] = useState(String(s.contingentHeuresSup));
  const [alerte, setAlerte] = useState(s.contingentAlerte);
  const [reference, setReference] = useState(s.contingentAccord);
  const [busy, setBusy] = useState(false);
  const [tente, setTente] = useState(false);
  useEffect(() => { setContingent(String(s.contingentHeuresSup)); setAlerte(s.contingentAlerte); setReference(s.contingentAccord); setTente(false); },
    [s.contingentHeuresSup, s.contingentAlerte, s.contingentAccord]);
  const n = Number(contingent.replace(',', '.'));
  const erreurContingent = !/^\d{1,4}$/.test(contingent.trim()) || n > 1000 ? 'Indiquez un nombre d’heures entier, de 0 à 1 000.' : null;
  const contingentModifie = contingent.trim() !== String(s.contingentHeuresSup) || alerte !== s.contingentAlerte || reference.trim() !== s.contingentAccord;
  const enregistrerContingent = async () => {
    if (erreurContingent) { setTente(true); document.getElementById('dh-contingent')?.focus(); return; }
    setBusy(true);
    await save({ contingentHeuresSup: n, contingentAlerte: alerte, contingentAccord: reference } satisfies Partial<Settings>);
    setBusy(false);
  };

  return (
    <Panel title="Décompte des heures" style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.feriesTravaillesAutorises} disabled={!admin} onChange={e => save({ feriesTravaillesAutorises: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          Permettre la saisie d’heures un jour férié
          <span className="text-muted sub" style={{ display: 'block' }}>Mention « Férié travaillé » sur la feuille ; chaque saisie est tracée au journal des actions.</span>
        </span>
      </label>
      <Field label="Majoration des jours fériés (hors 1er mai)" htmlFor="dh-ferie">
        <select className="input" id="dh-ferie" value={s.tauxMajorationFerie} disabled={!admin} onChange={e => save({ tauxMajorationFerie: Number(e.target.value) })} style={{ maxWidth: 240 }}>
          {MAJORATIONS.map(v => <option key={v} value={v}>{v ? `${v} %` : 'Aucune (0 %)'}</option>)}
        </select>
      </Field>
      <Fine>
        Le 1er mai travaillé est payé double : majoration de {MAJORATION_1ER_MAI} % fixée par la loi (art. L3133-6, rubrique MAJ_1MAI). Les autres fériés n’ont
        pas de majoration légale : leurs heures partent en quantité (FERIE_TRAV), et une majoration prévue par la convention ou un accord ajoute MAJ_FERIE,
        figée sur chaque feuille à sa validation. Le lundi de Pentecôte travaillé au titre de la journée de solidarité est repéré comme un férié : la paie le traite.
      </Fine>

      <Field label="Heures complémentaires du temps partiel">
        <Seg name="dh-hc" label="Heures complémentaires du temps partiel" value={hc.choix} options={PLAFONDS} disabled={!admin} onChange={hc.choisir} style={{ flexWrap: 'wrap' }} />
      </Field>
      {hc.choix === 'tiers' && (
        <>
          <Field label="Référence de l’accord collectif" htmlFor="dh-hc-accord" requis erreur={hc.erreur}>
            <input className="input" id="dh-hc-accord" maxLength={120} placeholder="Accord de branche ou d’entreprise du …" value={hc.accord} disabled={!admin}
              onChange={e => hc.setAccord(e.target.value)} />
          </Field>
          {admin && hc.modifie && <div className="actions-end"><Btn variant="primary" disabled={hc.busy} onClick={() => hc.valider('dh-hc-accord')}>Enregistrer le plafond du tiers</Btn></div>}
        </>
      )}
      <Fine>
        Sans accord, les heures complémentaires sont limitées au dixième de la durée contractuelle (art. L3123-28) ; un accord collectif peut porter la limite
        au tiers (art. L3123-20). Au-delà, la feuille exige un motif à la soumission. Majoration : 10 % jusqu’au dixième, 25 % au-delà (art. L3123-29).
      </Fine>

      <Field label="Moyenne maximale sur 12 semaines">
        <Seg name="dh-moyenne" label="Moyenne maximale sur 12 semaines" value={moy.choix} options={MOYENNES} disabled={!admin} onChange={moy.choisir} style={{ flexWrap: 'wrap' }} />
      </Field>
      {moy.choix !== MOYENNE_LEGALE && (
        <>
          <Field label="Référence de l’accord collectif" htmlFor="dh-moyenne-accord" requis erreur={moy.erreur}>
            <input className="input" id="dh-moyenne-accord" maxLength={120} placeholder="Accord d’entreprise sur le temps de travail du …" value={moy.accord} disabled={!admin}
              onChange={e => moy.setAccord(e.target.value)} />
          </Field>
          {admin && moy.modifie && <div className="actions-end"><Btn variant="primary" disabled={moy.busy} onClick={() => moy.valider('dh-moyenne-accord')}>Enregistrer la moyenne</Btn></div>}
        </>
      )}
      <Fine>
        Moyenne des 12 dernières semaines travaillées (feuilles validées ; une semaine sans feuille validée ou d’absence complète est sautée) : 44 h au plus
        (art. L3121-22), 46 h avec un accord (art. L3121-23). Le temps partiel dont l’horaire réel dépasse le contrat d’au moins 2 h pendant 12 semaines sur 15
        est signalé (art. L3123-13). Alertes au service RH sur l’écran Temps de travail, sans blocage.
      </Fine>

      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label="Contingent annuel d’heures supplémentaires" htmlFor="dh-contingent" requis erreur={tente && erreurContingent}>
          <input className="input tnum" id="dh-contingent" inputMode="numeric" value={contingent} disabled={!admin} onChange={e => setContingent(e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
        <Field label="Alerte à" htmlFor="dh-alerte">
          <select className="input" id="dh-alerte" value={alerte} disabled={!admin} onChange={e => setAlerte(Number(e.target.value))}>
            {ALERTES.map(v => <option key={v} value={v}>{v} %</option>)}
          </select>
        </Field>
      </div>
      <Field label="Référence de la convention ou de l’accord" htmlFor="dh-contingent-accord">
        <input className="input" id="dh-contingent-accord" maxLength={120} placeholder="CCN Industries chimiques, accord d’entreprise du …" value={reference} disabled={!admin}
          onChange={e => setReference(e.target.value)} />
      </Field>
      {admin && contingentModifie && <div className="actions-end"><Btn variant="primary" disabled={busy} onClick={enregistrerContingent}>Enregistrer le contingent</Btn></div>}
      {!s.contingentAccord && <div className="note-accent">{CONTINGENT_A_VERIFIER.charAt(0).toUpperCase() + CONTINGENT_A_VERIFIER.slice(1)}.</div>}
      <Fine>
        Heures supplémentaires de l’année civile, sur les feuilles validées et les heures reprises de l’ancien outil, sans celles remplacées par un repos
        (art. L3121-30) ni l’intérim ; {CONTINGENT_LEGAL} h par défaut (art. D3121-24). Au-delà, une contrepartie obligatoire en repos de {TAUX_COR} % (plus de 20
        salariés, art. L3121-38) est figée sur chaque feuille à sa validation, créditée au compteur de récupération et transmise à la paie (COR_ACQUIS).
      </Fine>
    </Panel>
  );
}
