// Paramètres → Décompte des heures (pages/parametres/DecompteHeures.tsx), bloc « Forfait annuel en heures » (lot 12, chantier
// C1, étape 2 ; shared/rules/forfait-heures.ts) : début de la période de référence, début du suivi dans Cursus (mise en
// service), référence de l'accord, seuil de la tranche à 25 % (heures par semaine travaillée sous forfait), natures d'absence
// déduites de la cible, durée déduite par jour d'absence (calculée par défaut : forfait divisé par les jours ouvrés
// théoriques), mois d'émission des heures et imputation sur le contingent (désactivée tant que la paie ne l'a pas confirmée).
// S'écarter du défaut pour la période, le seuil, les absences ou la durée journalière exige la référence de l'accord
// (COHERENCE de shared/reglages.ts, art. L3121-63 et L3121-64). Champs enregistrés ensemble ; une ligne déjà confirmée n'est
// jamais recalculée (la rouvrir). Les lignes étant repérées par leur début de plage, déplacer le début du suivi ou de la
// période une fois une clôture enregistrée passe par une confirmation avec avertissement (state/confirmations-forfait-heures.ts),
// que le serveur exige aussi (`refusChangementDebutForfait`, parametres.maj). Réglages de l'administrateur RH ; les autres
// profils consultent.
import { type FormEvent, useEffect, useState } from 'react';
import { ABS_LABEL } from '../../../../shared/constants.ts';
import { isValidDate } from '../../../../shared/dates.ts';
import { fmtIso } from '../../../../shared/format.ts';
import {
  ABSENCES_DEDUCTIBLES, DEBUT_SUIVI_DEFAUT, forfaitHeuresHorsDefaut, heuresParJour, periodeReference, SEUIL_25_DEFAUT,
} from '../../../../shared/rules/forfait-heures.ts';
import type { AbsenceType, EmissionForfaitHeures, Settings } from '../../../../shared/types.ts';
import { Field } from '../Dialog.tsx';
import { Btn, Fine, NoteAccent, Seg } from '../ui.tsx';
import { useDomain, useRole } from '../../state/derived.ts';
import { changementDebutForfait } from '../../state/confirmations-forfait-heures.ts';
import { useStore } from '../../state/store.tsx';
import { type SectionProps, useEnregistrerReglages } from '../../pages/parametres/commun.ts';
import { JourMois } from '../../pages/parametres/Entretiens.tsx';
import { periodeTexte } from './forfait-heures-vue.ts';

const EMISSIONS: [EmissionForfaitHeures, string][] = [['cloture', 'Mois de la confirmation'], ['periode', 'Dernier mois de la plage']];
/** Heures à deux décimales : « 7,02 h ». */
const heures2 = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString('fr-FR')} h`;
const saisie = (n: number) => (n ? String(n).replace('.', ',') : '');

/** Erreurs des champs saisis (null : valide). */
export function erreursForfaitHeures(v: { suivi: string; seuil: string; jour: string; accord: string; horsDefaut: boolean }) {
  const seuil = v.seuil.trim(), jour = v.jour.trim().replace(',', '.');
  return {
    suivi: isValidDate(v.suivi) ? null : 'Indiquez la date du début du suivi.',
    seuil: /^\d{1,2}$/.test(seuil) && Number(seuil) <= 48 ? null : 'Indiquez un nombre d’heures entier, de 0 à 48.',
    jour: !jour || (/^\d{1,2}(\.\d{1,2})?$/.test(jour) && Number(jour) <= 12) ? null : 'Indiquez une durée de 0 à 12 h (vide : calculée), deux décimales au plus.',
    accord: v.horsDefaut && !v.accord.trim() ? 'Indiquez la référence de l’accord collectif qui fixe ces règles.' : null,
  };
}

export function ReglagesForfaitHeures({ s }: Pick<SectionProps, 's'>) {
  const d = useDomain();
  const { admin } = useRole();
  const save = useEnregistrerReglages();
  const { openDialog } = useStore();
  // Clôtures enregistrées (non annulées) : repérées par leur début de plage, que déplace un autre début du suivi ou de la période.
  const enregistrees = (d.ds.cloturesForfaitHeures ?? []).filter(l => l.statut !== 'annulee').length;
  const [periode, setPeriode] = useState(s.forfaitHeuresDebutPeriode);
  const [suivi, setSuivi] = useState(s.forfaitHeuresDebutSuivi);
  const [accord, setAccord] = useState(s.forfaitHeuresAccord);
  const [seuil, setSeuil] = useState(String(s.forfaitHeuresSeuil25));
  const [absences, setAbsences] = useState<AbsenceType[]>(s.forfaitHeuresAbsencesDeduites);
  const [jour, setJour] = useState(saisie(s.forfaitHeuresJour));
  const [emission, setEmission] = useState<EmissionForfaitHeures>(s.forfaitHeuresEmission);
  const [contingent, setContingent] = useState(s.forfaitHeuresContingent);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPeriode(s.forfaitHeuresDebutPeriode); setSuivi(s.forfaitHeuresDebutSuivi); setAccord(s.forfaitHeuresAccord); setSeuil(String(s.forfaitHeuresSeuil25));
    setAbsences(s.forfaitHeuresAbsencesDeduites); setJour(saisie(s.forfaitHeuresJour)); setEmission(s.forfaitHeuresEmission); setContingent(s.forfaitHeuresContingent);
    setTente(false);
  }, [s.forfaitHeuresDebutPeriode, s.forfaitHeuresDebutSuivi, s.forfaitHeuresAccord, s.forfaitHeuresSeuil25, s.forfaitHeuresAbsencesDeduites, s.forfaitHeuresJour,
    s.forfaitHeuresEmission, s.forfaitHeuresContingent]);

  const n = Number(seuil.trim()), j = Number(jour.trim().replace(',', '.') || 0);
  const candidat = { forfaitHeuresDebutPeriode: periode, forfaitHeuresSeuil25: Number.isFinite(n) ? n : SEUIL_25_DEFAUT, forfaitHeuresAbsencesDeduites: absences, forfaitHeuresJour: Number.isFinite(j) ? j : 0 };
  const erreurs = erreursForfaitHeures({ suivi, seuil, jour, accord, horsDefaut: forfaitHeuresHorsDefaut(candidat) });
  const modifie = periode !== s.forfaitHeuresDebutPeriode || suivi !== s.forfaitHeuresDebutSuivi || accord.trim() !== s.forfaitHeuresAccord || seuil.trim() !== String(s.forfaitHeuresSeuil25)
    || absences.length !== s.forfaitHeuresAbsencesDeduites.length || absences.some(x => !s.forfaitHeuresAbsencesDeduites.includes(x)) || j !== s.forfaitHeuresJour
    || emission !== s.forfaitHeuresEmission || contingent !== s.forfaitHeuresContingent;
  const debutModifie = periode !== s.forfaitHeuresDebutPeriode || suivi !== s.forfaitHeuresDebutSuivi;
  const basculer = (t: AbsenceType, oui: boolean) => setAbsences(l => (oui ? [...new Set([...l, t])] : l.filter(x => x !== t)));
  const ref = periodeReference({ forfaitHeuresDebutPeriode: periode }, d.ti);

  const enregistrer = async (ev: FormEvent) => {
    ev.preventDefault();
    const champ = erreurs.suivi ? 'fh-suivi' : erreurs.seuil ? 'fh-seuil' : erreurs.jour ? 'fh-jour' : erreurs.accord ? 'fh-accord' : null;
    if (champ) { setTente(true); document.getElementById(champ)?.focus(); return; }
    const patch = {
      forfaitHeuresDebutPeriode: periode, forfaitHeuresDebutSuivi: suivi, forfaitHeuresAccord: accord, forfaitHeuresSeuil25: n, forfaitHeuresAbsencesDeduites: absences,
      forfaitHeuresJour: j, forfaitHeuresEmission: emission, forfaitHeuresContingent: contingent,
    } satisfies Partial<Settings>;
    // Début déplacé alors que des clôtures sont enregistrées : confirmation avec avertissement (exigée aussi par le serveur).
    if (debutModifie && enregistrees) { openDialog({ type: 'confirmer', c: changementDebutForfait(patch, enregistrees) }); return; }
    setBusy(true);
    await save(patch);
    setBusy(false);
  };

  return (
    <form onSubmit={enregistrer} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }} noValidate>
      <div className="text-muted sub" style={{ fontWeight: 600 }}>Forfait annuel en heures</div>
      <div className="grid-2">
        <JourMois id="fh-periode" label="Début de la période de référence" value={periode} onChange={setPeriode} disabled={!admin} />
        <Field label="Début du suivi dans Cursus" htmlFor="fh-suivi" requis erreur={tente && erreurs.suivi}>
          <input className="input" id="fh-suivi" type="date" value={suivi} disabled={!admin} onChange={e => setSuivi(e.target.value)} />
        </Field>
      </div>
      {admin && enregistrees > 0 && (
        <NoteAccent>
          {enregistrees > 1 ? `${enregistrees} clôtures sont enregistrées` : 'Une clôture est enregistrée'}, repérées par le début de leur plage : changer le début du suivi
          ou de la période de référence les fait passer « à revoir », et les plages qui les chevauchent restent bloquées (jamais payées deux fois). Confirmation demandée.
        </NoteAccent>
      )}
      <Fine>
        Période en cours : {periodeTexte(ref)}. Le réalisé d’avant le début du suivi n’est pas dans Cursus (par défaut, la mise en service du {fmtIso(DEBUT_SUIVI_DEFAUT)} ;
        le forfait 2026 se clôt à la main dans Sage) : une période commencée avant est clôturée « partielle », son début à compléter dans Sage.
      </Fine>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label="Heures à 25 % par semaine travaillée" htmlFor="fh-seuil" requis erreur={tente && erreurs.seuil}>
          <input className="input tnum" id="fh-seuil" inputMode="numeric" value={seuil} disabled={!admin} onChange={e => setSeuil(e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
        <Field label="Heures déduites par jour d’absence" htmlFor="fh-jour" erreur={tente && erreurs.jour}>
          <input className="input tnum" id="fh-jour" inputMode="decimal" placeholder="Calculée" value={jour} disabled={!admin} onChange={e => setJour(e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
      </div>
      <Fine>
        Au-delà de la cible nette, les heures de chaque semaine travaillée sous forfait jusqu’à ce seuil sont majorées de 25 % (HFA25), le reste de 50 % (HFA50) :
        {' '}{SEUIL_25_DEFAUT} h par défaut, de la 36e à la 43e heure (art. L3121-36 ; ventilation de l’accord). Durée déduite par jour ouvré d’absence : vide, le
        forfait divisé par les jours ouvrés théoriques de la période (soit {heures2(heuresParJour(undefined, 1607, ref))} pour
        1 607 h en {ref.debut.slice(0, 4)}) ; sinon la durée fixée par l’accord.
      </Fine>
      <Field label="Absences déduites de la cible">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-1) var(--space-3)' }}>
          {ABSENCES_DEDUCTIBLES.map(t => (
            <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13 }}>
              <input type="checkbox" checked={absences.includes(t)} disabled={!admin} onChange={e => basculer(t, e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
              {ABS_LABEL[t]}
            </label>
          ))}
        </div>
      </Field>
      <Fine>
        Par défaut, toutes les absences sauf les congés payés : les 1 607 h comprennent déjà les CP légaux, les jours fériés chômés et la journée de solidarité
        (art. L3121-41), jamais déduits. Seul le total des heures déduites est gardé sur la clôture, jamais la nature d’une absence.
      </Fine>
      <Field label="Référence de l’accord collectif" htmlFor="fh-accord" requis={forfaitHeuresHorsDefaut(candidat)} erreur={tente && erreurs.accord}>
        <input className="input" id="fh-accord" maxLength={120} placeholder="CCN Industries chimiques, accord d’entreprise sur le temps de travail du …" value={accord} disabled={!admin}
          onChange={e => setAccord(e.target.value)} />
      </Field>
      <Field label="Heures de la clôture dans la paie">
        <Seg name="fh-emission" label="Heures de la clôture dans la paie" value={emission} options={EMISSIONS} disabled={!admin} onChange={setEmission} style={{ flexWrap: 'wrap' }} />
      </Field>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={contingent} disabled={!admin} onChange={e => setContingent(e.target.checked)}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          Imputer les heures au-delà du forfait sur le contingent annuel
          <span className="text-muted sub" style={{ display: 'block' }}>Et la contrepartie obligatoire en repos au-delà ; à cocher une fois l’imputation confirmée par la paie.</span>
        </span>
      </label>
      {admin && modifie && <div className="actions-end"><Btn variant="primary" type="submit" disabled={busy}>Enregistrer le forfait annuel en heures</Btn></div>}
      {!s.forfaitHeuresAccord && <NoteAccent>Accord sur le forfait annuel en heures non référencé : règles par défaut (année civile, 8 h à 25 % par semaine, toutes les absences hors CP).</NoteAccent>}
      <Fine>
        Rubriques HFA25, HFA50, HCA10 et HCA25 désactivées tant que la paie n’a pas donné leurs codes (Temps de travail → Transmission à Sage Paie → Rubriques) :
        les heures sont alors listées « à saisir dans Sage ». Mois de la confirmation par défaut ; une plage close par la sortie part avec le solde de sortie.
      </Fine>
    </form>
  );
}
