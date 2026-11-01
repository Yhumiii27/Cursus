// lot 11 — Paramètres → Dossiers OPCO (chantier C4, shared/rules/opco.ts) : OPCO et subrogation proposés à la création d'un
// dossier (enregistrés aussitôt), délais des échéances en jours (dépôt avant le début de la formation, justificatifs après
// la fin, relance d'un remboursement attendu après l'envoi des justificatifs ; enregistrés au bouton). Valeurs par défaut
// (OPCO 2i, 30, 90 et 60 jours) à confirmer avec le service RH d'après les conditions de l'OPCO de l'année. Réglages de
// l'administrateur RH ; les autres profils de l'espace RH consultent.
import { useEffect, useState } from 'react';
import { CODES_OPCO, DELAI_ACCORD_JOURS, OPCOS } from '../../../../shared/rules/opco.ts';
import type { CodeOpco } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

/** Bornes des délais, les mêmes que les contrôles de shared/reglages.ts (tests/client-opco.test.ts les compare). */
export const BORNES_DELAIS_OPCO = {
  opcoDelaiDepot: [0, 180], opcoDelaiJustificatifs: [15, 365], opcoDelaiRemboursement: [15, 365],
} as const;
type Delai = keyof typeof BORNES_DELAIS_OPCO;
const CHAMPS: [Delai, string, string][] = [
  ['opcoDelaiDepot', 'Dépôt avant le début de la formation (jours)', 'opco-delai-depot'],
  ['opcoDelaiJustificatifs', 'Justificatifs après la fin (jours)', 'opco-delai-justificatifs'],
  ['opcoDelaiRemboursement', 'Relance du remboursement après l’envoi (jours)', 'opco-delai-remboursement'],
];

/** Message sous un délai mal saisi, ou null. */
export function erreurDelaiOpco(k: Delai, v: string): string | null {
  const [min, max] = BORNES_DELAIS_OPCO[k];
  const n = Number(v.trim());
  return /^\d{1,3}$/.test(v.trim()) && n >= min && n <= max ? null : `Nombre de jours entier, de ${min} à ${max}.`;
}

export function Opco({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const save = useEnregistrerReglages();
  const [delais, setDelais] = useState<Record<Delai, string>>(() => ({
    opcoDelaiDepot: String(s.opcoDelaiDepot), opcoDelaiJustificatifs: String(s.opcoDelaiJustificatifs), opcoDelaiRemboursement: String(s.opcoDelaiRemboursement),
  }));
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  // Réglages relus du serveur (enregistrés ici ou ailleurs) : la saisie suit les valeurs en vigueur.
  useEffect(() => {
    setDelais({ opcoDelaiDepot: String(s.opcoDelaiDepot), opcoDelaiJustificatifs: String(s.opcoDelaiJustificatifs), opcoDelaiRemboursement: String(s.opcoDelaiRemboursement) });
    setTente(false);
  }, [s.opcoDelaiDepot, s.opcoDelaiJustificatifs, s.opcoDelaiRemboursement]);
  if (!espaceRh) return null;

  const erreurs = Object.fromEntries(CHAMPS.map(([k]) => [k, erreurDelaiOpco(k, delais[k])])) as Record<Delai, string | null>;
  const modifie = CHAMPS.some(([k]) => Number(delais[k]) !== s[k]);
  const enregistrer = async () => {
    const premier = CHAMPS.find(([k]) => erreurs[k]);
    if (premier) { setTente(true); document.getElementById(premier[2])?.focus(); return; }
    setBusy(true);
    await save(Object.fromEntries(CHAMPS.map(([k]) => [k, Number(delais[k])])));
    setBusy(false);
  };

  return (
    <Panel title="Dossiers OPCO" style={{ gap: 'var(--space-4)' }}>
      <Field label="OPCO proposé à la création d’un dossier" htmlFor="opco-defaut">
        <select className="input" id="opco-defaut" value={s.opcoDefaut} disabled={!admin} onChange={e => save({ opcoDefaut: e.target.value as CodeOpco })} style={{ maxWidth: 260 }}>
          {CODES_OPCO.map(c => <option key={c} value={c}>{OPCOS[c]}</option>)}
        </select>
      </Field>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.opcoSubrogation} disabled={!admin} onChange={e => save({ opcoSubrogation: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>Proposer la subrogation (paiement direct de l’organisme par l’OPCO)</span>
      </label>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        {CHAMPS.map(([k, label, id]) => (
          <Field key={k} label={label} htmlFor={id} requis erreur={tente && erreurs[k]}>
            <input className="input tnum" id={id} inputMode="numeric" value={delais[k]} disabled={!admin} onChange={e => setDelais(x => ({ ...x, [k]: e.target.value }))} style={{ maxWidth: 120 }} />
          </Field>
        ))}
      </div>
      {admin && modifie && <div><Btn variant="secondary" disabled={busy} onClick={enregistrer}>Enregistrer les délais</Btn></div>}
      <Fine>
        Échéances d’un dossier en cours (écran Échéances, onglet Dossiers OPCO de Plan & budget, récapitulatif du service RH sans montant ni nom) :
        dépôt avant le début de la formation, accord attendu {DELAI_ACCORD_JOURS} jours avant le début, justificatifs après la fin, puis relance
        du remboursement après leur envoi. Valeurs proposées (30, 90 et 60 jours) à confirmer d’après les conditions de prise en charge de l’OPCO
        de l’année. Un exercice clos ne bloque jamais un dossier : les remboursements arrivent souvent après la clôture.
      </Fine>
    </Panel>
  );
}
