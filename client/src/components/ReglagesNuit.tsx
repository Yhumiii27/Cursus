// Paramètres → Décompte des heures (pages/parametres/DecompteHeures.tsx), bloc « Travail de nuit » (t048, étape 2 ; shared/rules/repos-nuit.ts) : plage de nuit,
// seuils du travailleur de nuit, majoration des heures de nuit et référence de l'accord. Valeurs légales supplétives par
// défaut (nuit de 21 h à 6 h, 3 h deux fois par semaine ou 270 h sur 12 mois, majoration à 0 %) tant que l'accord ou la CCN
// n'est pas connu ; s'en écarter exige la référence de l'accord (COHERENCE de shared/reglages.ts). Les six champs
// s'enregistrent ensemble ; la majoration, figée sur chaque feuille à sa validation, ne change rien aux semaines validées.
// Réglages de l'administrateur RH ; les autres profils consultent.
import { type FormEvent, useEffect, useState } from 'react';
import {
  NUIT_DEBUT_LEGAL, NUIT_FIN_LEGAL, NUIT_SEUIL_ANNUEL_LEGAL, NUIT_SEUIL_QUOTIDIEN_LEGAL, PAUSE_DES, PAUSE_MIN, REPOS_QUOTIDIEN, refusPlageNuit,
} from '../../../shared/rules/repos-nuit.ts';
import type { Settings } from '../../../shared/types.ts';
import { Field } from './Dialog.tsx';
import { Btn, Fine } from './ui.tsx';
import { useRole } from '../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from '../pages/parametres/commun.ts';

const MAJORATIONS = Array.from({ length: 21 }, (_, i) => i * 5);
const DEBUTS = [21, 22], FINS = [6, 7];
const SEUILS_QUOTIDIENS = Array.from({ length: 9 }, (_, i) => i + 1);

export function ReglagesNuit({ s }: Pick<SectionProps, 's'>) {
  const { admin } = useRole();
  const save = useEnregistrerReglages();
  const [debut, setDebut] = useState(s.nuitDebut);
  const [fin, setFin] = useState(s.nuitFin);
  const [quotidien, setQuotidien] = useState(s.nuitSeuilQuotidien);
  const [annuel, setAnnuel] = useState(String(s.nuitSeuilAnnuel));
  const [majoration, setMajoration] = useState(s.nuitMajoration);
  const [accord, setAccord] = useState(s.nuitAccord);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDebut(s.nuitDebut); setFin(s.nuitFin); setQuotidien(s.nuitSeuilQuotidien); setAnnuel(String(s.nuitSeuilAnnuel));
    setMajoration(s.nuitMajoration); setAccord(s.nuitAccord); setTente(false);
  }, [s.nuitDebut, s.nuitFin, s.nuitSeuilQuotidien, s.nuitSeuilAnnuel, s.nuitMajoration, s.nuitAccord]);

  const n = Number(annuel.trim());
  const erreurAnnuel = !/^\d{2,4}$/.test(annuel.trim()) || n < 50 || n > 1000 || n % 10 ? 'Indiquez un nombre d’heures de 50 à 1 000, par dizaine.' : null;
  const erreurPlage = refusPlageNuit({ nuitDebut: debut, nuitFin: fin });
  const horsLoi = debut !== NUIT_DEBUT_LEGAL || fin !== NUIT_FIN_LEGAL || quotidien !== NUIT_SEUIL_QUOTIDIEN_LEGAL || (!erreurAnnuel && n !== NUIT_SEUIL_ANNUEL_LEGAL);
  const erreurAccord = horsLoi && !accord.trim() ? 'Indiquez la référence de l’accord collectif qui fixe ces valeurs.' : null;
  const modifie = debut !== s.nuitDebut || fin !== s.nuitFin || quotidien !== s.nuitSeuilQuotidien || annuel.trim() !== String(s.nuitSeuilAnnuel)
    || majoration !== s.nuitMajoration || accord.trim() !== s.nuitAccord;

  const enregistrer = async (ev: FormEvent) => {
    ev.preventDefault();
    const champ = erreurPlage ? 'tn-debut' : erreurAnnuel ? 'tn-annuel' : erreurAccord ? 'tn-accord' : null;
    if (champ) { setTente(true); document.getElementById(champ)?.focus(); return; }
    setBusy(true);
    await save({ nuitDebut: debut, nuitFin: fin, nuitSeuilQuotidien: quotidien, nuitSeuilAnnuel: n, nuitMajoration: majoration, nuitAccord: accord } satisfies Partial<Settings>);
    setBusy(false);
  };

  return (
    <form onSubmit={enregistrer} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }} noValidate>
      <div className="text-muted sub" style={{ fontWeight: 600 }}>Travail de nuit, repos quotidien et pause</div>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label="Nuit de" htmlFor="tn-debut" erreur={tente && erreurPlage}>
          <select className="input" id="tn-debut" value={debut} disabled={!admin} onChange={e => setDebut(Number(e.target.value))}>
            {DEBUTS.map(v => <option key={v} value={v}>{v} h</option>)}
          </select>
        </Field>
        <Field label="à" htmlFor="tn-fin">
          <select className="input" id="tn-fin" value={fin} disabled={!admin} onChange={e => setFin(Number(e.target.value))}>
            {FINS.map(v => <option key={v} value={v}>{v} h</option>)}
          </select>
        </Field>
        <Field label="Majoration des heures de nuit" htmlFor="tn-majoration">
          <select className="input" id="tn-majoration" value={majoration} disabled={!admin} onChange={e => setMajoration(Number(e.target.value))}>
            {MAJORATIONS.map(v => <option key={v} value={v}>{v ? `${v} %` : 'Aucune (0 %)'}</option>)}
          </select>
        </Field>
      </div>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label="Travailleur de nuit : heures de nuit dans la journée" htmlFor="tn-quotidien">
          <select className="input" id="tn-quotidien" value={quotidien} disabled={!admin} onChange={e => setQuotidien(Number(e.target.value))}>
            {SEUILS_QUOTIDIENS.map(v => <option key={v} value={v}>{v} h, deux fois par semaine</option>)}
          </select>
        </Field>
        <Field label="ou heures de nuit sur 12 mois" htmlFor="tn-annuel" requis erreur={tente && erreurAnnuel}>
          <input className="input tnum" id="tn-annuel" inputMode="numeric" value={annuel} disabled={!admin} onChange={e => setAnnuel(e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
      </div>
      <Field label="Référence de l’accord sur le travail de nuit" htmlFor="tn-accord" requis={horsLoi} erreur={tente && erreurAccord}>
        <input className="input" id="tn-accord" maxLength={120} placeholder="CCN Industries chimiques, accord d’entreprise du …" value={accord} disabled={!admin}
          onChange={e => setAccord(e.target.value)} />
      </Field>
      {admin && modifie && <div className="actions-end"><Btn variant="primary" type="submit" disabled={busy}>Enregistrer le travail de nuit</Btn></div>}
      {!s.nuitAccord && <div className="note-accent">Valeurs supplétives de la loi : plage de nuit, contreparties et majoration de l’accord ou de la CCN à confirmer.</div>}
      <Fine>
        Avec un horaire de poste sur la feuille de temps : heures de nuit comptées dans la plage réglée (la loi : {NUIT_DEBUT_LEGAL} h – {NUIT_FIN_LEGAL} h,
        art. L3122-20 ; un accord peut retenir 9 h consécutives entre 21 h et 7 h, art. L3122-2), transmises en quantité (HNUIT) et majorées au taux réglé
        (MAJ_NUIT), figé sur chaque feuille à sa validation ; rubriques désactivées tant que la paie ne les a pas confirmées : à saisir dans Sage.
        Travailleur de nuit (art. L3122-5 et L3122-23) : {NUIT_SEUIL_QUOTIDIEN_LEGAL} h de nuit au moins deux fois par semaine, selon l’horaire habituel, ou
        {' '}{NUIT_SEUIL_ANNUEL_LEGAL} h sur 12 mois glissants ; repéré sur la fiche, suivi médical adapté signalé. Repos quotidien de {REPOS_QUOTIDIEN} h
        (art. L3131-1) et pause de {PAUSE_MIN} min dès {PAUSE_DES} h (art. L3121-16) : alertes avec motif, sans blocage. Pas de nuit pour un salarié de
        moins de 18 ans (art. L3163-2) : refusée.
      </Fine>
    </form>
  );
}
