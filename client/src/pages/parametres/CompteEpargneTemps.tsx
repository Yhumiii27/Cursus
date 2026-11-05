// Paramètres → Compte épargne-temps : plafonds de placement (RTT par an, CP de la 5e semaine par période ; 5 et 5 par
// défaut, shared/rules/conges.ts) tant que l'accord sur le CET n'est pas connu, et rappel de ce que Cursus en fait : congé
// pris sur le CET validé comme un CP, rubrique de paie « CET » à confirmer, liquidation en entier à la sortie.
// lot 13 — monétisation (shared/rules/cet-monetisation.ts, art. L3151-3) : fermée par défaut, ouverte seulement avec la
// référence de l'accord (COHERENCE de shared/reglages.ts) ; plafond de jours monétisés par an ; solde repris de l'ancien
// outil monétisable ou non. Les plafonds s'enregistrent aussitôt ; la monétisation, au bouton « Enregistrer ».
// Réglages de l'administrateur RH ; les autres profils de l'espace RH les consultent.
import { useEffect, useState } from 'react';
import type { Settings } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, NoteAccent, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

const PLAFONDS_RTT = [0, 2, 3, 5, 6, 8, 10, 12, 15, 20, 25];
const PLAFONDS_CP = [0, 1, 2, 3, 4, 5];
const PLAFONDS_MONETISATION = [1, 2, 3, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60];

export function CompteEpargneTemps({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const save = useEnregistrerReglages();
  // Monétisation : champs enregistrés ensemble (la case exige la référence de l'accord).
  const [ouverte, setOuverte] = useState(s.cetMonetisation);
  const [accord, setAccord] = useState(s.cetMonetisationAccord);
  const [plafond, setPlafond] = useState(s.cetMonetisationPlafond);
  const [repris, setRepris] = useState(s.cetReprisMonetisable);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setOuverte(s.cetMonetisation); setAccord(s.cetMonetisationAccord); setPlafond(s.cetMonetisationPlafond); setRepris(s.cetReprisMonetisable); setTente(false);
  }, [s.cetMonetisation, s.cetMonetisationAccord, s.cetMonetisationPlafond, s.cetReprisMonetisable]);
  if (!espaceRh) return null;
  const liste = (valeurs: number[], v: number) => [...new Set([...valeurs, v])].sort((a, b) => a - b);
  const erreurAccord = ouverte && !accord.trim() ? 'Indiquez la référence de l’accord collectif qui prévoit la monétisation.' : null;
  const modifie = ouverte !== s.cetMonetisation || accord.trim() !== s.cetMonetisationAccord || plafond !== s.cetMonetisationPlafond || repris !== s.cetReprisMonetisable;
  const enregistrer = async () => {
    if (erreurAccord) { setTente(true); document.getElementById('param-cet-accord')?.focus(); return; }
    setBusy(true);
    await save({ cetMonetisation: ouverte, cetMonetisationAccord: accord, cetMonetisationPlafond: plafond, cetReprisMonetisable: repris } satisfies Partial<Settings>);
    setBusy(false);
  };
  return (
    <Panel title="Compte épargne-temps" style={{ gap: 'var(--space-4)' }}>
      <div className="grid-2">
        <Field label="RTT placés par an, au plus" htmlFor="param-cet-rtt">
          <select className="input" id="param-cet-rtt" value={s.cetPlafondRtt} disabled={!admin} onChange={e => save({ cetPlafondRtt: Number(e.target.value) })}>
            {liste(PLAFONDS_RTT, s.cetPlafondRtt).map(n => <option key={n} value={n}>{n ? `${n} j` : 'Aucun'}</option>)}
          </select>
        </Field>
        <Field label="CP de la 5e semaine par période, au plus" htmlFor="param-cet-cp">
          <select className="input" id="param-cet-cp" value={s.cetPlafondCp} disabled={!admin} onChange={e => save({ cetPlafondCp: Number(e.target.value) })}>
            {liste(PLAFONDS_CP, s.cetPlafondCp).map(n => <option key={n} value={n}>{n ? `${n} j` : 'Aucun'}</option>)}
          </select>
        </Field>
      </div>
      <Fine>
        Plafonds par défaut en attendant l’accord sur le compte épargne-temps : seuls les CP au-delà de 20 jours ouvrés (5e semaine) s’épargnent
        (art. L3151-2). Les jours épargnés se prennent en congé sur le CET, validé par le manager comme un congé payé et décompté en jours ouvrés ;
        le congé part dans le fichier de paie sous la rubrique « CET », désactivée et à confirmer par la paie : d’ici là, chaque congé est listé
        « à saisir dans Sage » dans le lot. Le solde est liquidé en entier à la sortie.
      </Fine>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={ouverte} disabled={!admin} onChange={e => { setOuverte(e.target.checked); setTente(false); }}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          Permettre la monétisation des jours épargnés
          <span className="text-muted sub" style={{ display: 'block' }}>Seulement si l’accord collectif qui institue le compte épargne-temps le prévoit (art. L3151-3).</span>
        </span>
      </label>
      <Field label="Référence de l’accord collectif" htmlFor="param-cet-accord" requis={ouverte} erreur={tente && erreurAccord}>
        <input className="input" id="param-cet-accord" maxLength={120} placeholder="Accord d’entreprise sur le compte épargne-temps du …" value={accord} disabled={!admin} onChange={e => setAccord(e.target.value)} />
      </Field>
      <Field label="Jours monétisés par salarié et par an, au plus" htmlFor="param-cet-plafond-mon">
        <select className="input" id="param-cet-plafond-mon" value={plafond} disabled={!admin} onChange={e => setPlafond(Number(e.target.value))} style={{ maxWidth: 240 }}>
          {liste(PLAFONDS_MONETISATION, plafond).map(n => <option key={n} value={n}>{n} j</option>)}
        </select>
      </Field>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={repris} disabled={!admin} onChange={e => setRepris(e.target.checked)}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          Solde repris de l’ancien outil monétisable
          <span className="text-muted sub" style={{ display: 'block' }}>À cocher seulement s’il ne contient aucun jour de congé payé : son origine (CP ou RTT) n’est pas connue de Cursus.</span>
        </span>
      </label>
      {admin && modifie && <div className="actions-end"><Btn variant="primary" disabled={busy} onClick={enregistrer}>Enregistrer la monétisation</Btn></div>}
      {!s.cetMonetisation && <NoteAccent>Accord sur la monétisation du compte épargne-temps non référencé : les jours épargnés se prennent en congé ou sont liquidés à la sortie, aucune monétisation.</NoteAccent>}
      <Fine>
        Seuls les jours venus des RTT se monétisent : les CP placés (5e semaine) ne le peuvent pas, la loi réservant la monétisation des droits issus du congé
        annuel aux jours au-delà de 30 jours ouvrables (art. L3151-3). Les congés pris sur le CET s’imputent d’abord sur les CP placés. Le salarié demande,
        le service RH valide ou refuse ; validés, les jours partent à la paie sous la rubrique CET_MON (Sage calcule le montant), désactivée tant que la paie
        n’a pas donné son code : ils sont alors listés « à saisir dans Sage » dans le résumé du lot.
      </Fine>
    </Panel>
  );
}
