// Paramètres → Contrats : alertes avant l'expiration d'un titre de séjour valant autorisation de travail (première alerte,
// dans la fenêtre de la demande de renouvellement en préfecture, puis relance) ; CDD : renouvellements admis et durée
// maximale, à défaut d'accord de branche ceux de la loi (shared/rules/cdd.ts), avec la référence de l'accord qui y déroge.
// Réglages de l'administrateur RH ; les autres profils de l'espace RH les consultent. Les fins d'essai et de contrat
// suivent le seuil d'alerte (Règles de suivi).
import { useEffect, useState } from 'react';
import { CDD_RENOUVELLEMENTS_LEGAL } from '../../../../shared/rules/cdd.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

const ALERTES: [number, string][] = [[90, '90 j'], [120, '120 j'], [150, '150 j'], [180, '180 j']];
const RELANCES: [number, string][] = [[30, '30 j'], [45, '45 j'], [60, '60 j'], [90, '90 j']];
/** Renouvellements d'un CDD : 2 selon la loi (art. L1243-13-1), de 0 à 6 avec un accord de branche (contrôle de shared/reglages.ts). */
const RENOUVELLEMENTS: [number, string][] = [0, 1, 2, 3, 4, 5, 6].map(n => [n, n === CDD_RENOUVELLEMENTS_LEGAL ? `${n} (loi)` : String(n)]);
/** Durée maximale d'un CDD, renouvellements compris : 0 = selon le motif (art. L1242-8-1). */
const DUREES: [number, string][] = [[0, 'Selon le motif (loi)'], [12, '12 mois'], [18, '18 mois'], [24, '24 mois'], [36, '36 mois']];

/**
 * CDD : renouvellements et durée maximale, enregistrés ensemble avec la référence de l'accord de branche, exigée dès qu'une
 * valeur diffère de la loi (contrôle COHERENCE du serveur).
 */
function ReglagesCdd({ s, admin }: SectionProps & { admin: boolean }) {
  const save = useEnregistrerReglages();
  const [ren, setRen] = useState(s.cddRenouvellementsMax);
  const [duree, setDuree] = useState(s.cddDureeMaxMois);
  const [accord, setAccord] = useState(s.cddAccordBranche);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRen(s.cddRenouvellementsMax); setDuree(s.cddDureeMaxMois); setAccord(s.cddAccordBranche); setTente(false); }, [s.cddRenouvellementsMax, s.cddDureeMaxMois, s.cddAccordBranche]);
  const derogation = ren !== CDD_RENOUVELLEMENTS_LEGAL || duree > 0;
  const erreurAccord = derogation && !accord.trim() ? 'Indiquez la référence de l’accord de branche étendu qui fixe ces valeurs (art. L1242-8 et L1243-13).' : null;
  const modifie = ren !== s.cddRenouvellementsMax || duree !== s.cddDureeMaxMois || accord.trim() !== s.cddAccordBranche;
  const enregistrer = async () => {
    if (erreurAccord) { setTente(true); document.getElementById('param-cdd-accord')?.focus(); return; }
    setBusy(true);
    await save({ cddRenouvellementsMax: ren, cddDureeMaxMois: duree, cddAccordBranche: accord });
    setBusy(false);
  };
  return (
    <>
      <Field label="CDD : renouvellements admis">
        <Seg name="param-cdd-renouvellements" label="CDD : renouvellements admis" value={ren} options={RENOUVELLEMENTS} disabled={!admin}
          onChange={v => setRen(v)} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Field label="CDD : durée maximale, renouvellements compris" htmlFor="param-cdd-duree">
        <select className="input" id="param-cdd-duree" value={duree} disabled={!admin} onChange={e => setDuree(Number(e.target.value))} style={{ maxWidth: 240 }}>
          {DUREES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label="Référence de l’accord de branche" htmlFor="param-cdd-accord" requis={derogation} erreur={tente && erreurAccord}>
        <input className="input" id="param-cdd-accord" maxLength={120} placeholder="Accord de branche des industries chimiques du …" value={accord} disabled={!admin}
          onChange={e => setAccord(e.target.value)} />
      </Field>
      {admin && modifie && (
        <div className="actions-end">
          <Btn variant="primary" disabled={busy} onClick={enregistrer}>Enregistrer les règles des CDD</Btn>
        </div>
      )}
      <Fine>
        À défaut d’accord de branche étendu, la loi admet 2 renouvellements (art. L1243-13-1) et une durée maximale selon le motif : 18 mois en général,
        9 mois en attente d’un salarié recruté en CDI ou pour des travaux urgents, 24 mois pour une commande exceptionnelle à l’exportation ou un départ
        avant la suppression du poste, 36 mois pour un CDD senior (art. L1242-8-1). Une convention de branche peut y déroger (art. L1242-8 et L1243-13) :
        à vérifier pour la CCN des industries chimiques. Les dépassements sont signalés sur la fiche et au renouvellement, sans rien bloquer ; le délai
        de carence entre deux contrats sur le même poste est rappelé à la création de la fiche (art. L1244-3).
      </Fine>
    </>
  );
}

export function Contrats({ s, envois }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const save = useEnregistrerReglages();
  if (!espaceRh) return null;
  return (
    <Panel title="Contrats" style={{ gap: 'var(--space-4)' }}>
      <Field label="Titre de séjour : première alerte">
        <Seg name="param-titre-alerte" label="Titre de séjour : première alerte" value={s.titreSejourAlerte} options={ALERTES} disabled={!admin}
          onChange={v => save({ titreSejourAlerte: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Field label="Titre de séjour : relance">
        <Seg name="param-titre-relance" label="Titre de séjour : relance" value={s.titreSejourRelance} options={RELANCES} disabled={!admin}
          onChange={v => save({ titreSejourRelance: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Fine>
        Le renouvellement d’un titre de séjour se demande en préfecture dans les quatre mois qui précèdent son expiration : l’échéance passe
        « Renouvellement à demander » à la première alerte, « Relance » ensuite. Expiré, le titre rend le salarié non conforme et le passe en
        « No Go » sur les chantiers (art. L5221-8). Les fins de période d’essai, datées du dernier jour où notifier une rupture dans le délai
        de prévenance, et les fins de contrat suivent le seuil d’alerte des règles de suivi.
      </Fine>
      <ReglagesCdd s={s} envois={envois} admin={admin} />
    </Panel>
  );
}
