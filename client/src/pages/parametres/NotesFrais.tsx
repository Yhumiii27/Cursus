// lot 11 — Paramètres → Notes de frais (chantier C5, étape 2 ; shared/rules/frais*.ts) : activation du module (désactivé
// par défaut tant que l'essai de charge et le paramétrage ne sont pas faits), circuit, délai de soumission, seuil du
// justificatif, puissance fiscale, plafonds internes par catégorie (vides : aucune politique connue), barème kilométrique
// et limites d'exonération de l'année (alerte « barème de l'année manquant »), comptes et format du fichier d'écritures
// pour la comptabilité. Réglages de l'administrateur RH ; limites des forfaits saisies par le service RH ; les autres
// profils de l'espace RH consultent. Valeurs proposées à confirmer par la comptabilité, la paie et le service RH.
import { useEffect, useState } from 'react';
import { CATEGORIES_FRAIS } from '../../../../shared/rules/frais.ts';
import { baremeSaisi, TYPES_VEHICULE } from '../../../../shared/rules/frais-km.ts';
import { FORFAITS_FRAIS } from '../../../../shared/rules/frais-politique.ts';
import { COLONNES_ECRITURE, COLONNES_ECRITURE_FACULTATIVES, compteDeCharge, COMPTES_FRAIS_DEFAUT, estCompte, estJournal, LISTE_COLONNES_ECRITURE } from '../../../../shared/rules/frais-export.ts';
import { DECIMALES, ENCODAGES, FORMATS_DATE, SEPARATEURS } from '../../../../shared/rules/lots-paie.ts';
import type { ColonneEcriture, GabaritExportComptable } from '../../../../shared/rules/export-comptable.ts';
import type { CategorieFrais, CircuitFrais, TypeVehicule } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, NoteAccent, Panel } from '../../components/ui.tsx';
import { euros } from '../../components/frais/commun.ts';
import { nombreSaisi } from '../../components/frais/saisie.ts';
import { useDomain, useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

/** Catégories qui reçoivent un plafond interne : frais réels (ni indemnité kilométrique, ni allocation forfaitaire). */
const AVEC_PLAFOND = (Object.keys(CATEGORIES_FRAIS) as CategorieFrais[]).filter(c => c !== 'ik' && c !== 'forfait');
/** Catégories qui reçoivent un compte de charge (les frais médicaux portent toujours le compte générique). */
const AVEC_COMPTE = (Object.keys(CATEGORIES_FRAIS) as CategorieFrais[]).filter(c => c !== 'medical');

export function NotesFrais({ s }: SectionProps) {
  const d = useDomain();
  const { admin, rh, espaceRh } = useRole();
  const { openDialog } = useStore();
  const save = useEnregistrerReglages();
  const annee = Number(d.ti.slice(0, 4));
  const plafondsTexte = () => Object.fromEntries(AVEC_PLAFOND.map(c => [c, s.fraisPlafonds[c] != null ? String(s.fraisPlafonds[c]).replace('.', ',') : '']));
  const comptesTexte = () => ({ ...Object.fromEntries(AVEC_COMPTE.map(c => [c, s.fraisComptes[c] ?? ''])), generique: s.fraisCompteGenerique, tva: s.fraisCompteTva, salarie: s.fraisCompteSalarie, journal: s.fraisJournal });
  const [plafonds, setPlafonds] = useState<Record<string, string>>(plafondsTexte);
  const [comptes, setComptes] = useState<Record<string, string>>(comptesTexte);
  const [tente, setTente] = useState(false);
  // Réglages relus du serveur : la saisie suit les valeurs en vigueur (`s` change à chaque relecture des réglages, les
  // deux fonctions ne lisent que `s`).
  // oxlint-disable-next-line react/exhaustive-deps
  useEffect(() => { setPlafonds(plafondsTexte()); setComptes(comptesTexte()); setTente(false); }, [s]);
  if (!espaceRh) return null;

  const erreurPlafond = AVEC_PLAFOND.find(c => plafonds[c].trim() && (nombreSaisi(plafonds[c]) === null || nombreSaisi(plafonds[c])! < 0));
  // Compte d'une catégorie : vide admis (compte proposé) ; comptes généraux et journal : obligatoires.
  const parCategorie = new Set<string>(AVEC_COMPTE);
  const erreurCompte = Object.entries(comptes).find(([k, v]) => {
    const t = v.trim().toUpperCase();
    if (k === 'journal') return !estJournal(t);
    return parCategorie.has(k) ? !!t && !estCompte(t) : !estCompte(t);
  });
  const enregistrerPlafonds = async () => {
    if (erreurPlafond) { setTente(true); return; }
    await save({ fraisPlafonds: Object.fromEntries(AVEC_PLAFOND.filter(c => plafonds[c].trim()).map(c => [c, nombreSaisi(plafonds[c])!])) });
  };
  const enregistrerComptes = async () => {
    if (erreurCompte) { setTente(true); return; }
    const m = (v: string) => v.trim().toUpperCase();
    await save({
      fraisComptes: Object.fromEntries(AVEC_COMPTE.filter(c => comptes[c].trim()).map(c => [c, m(comptes[c])])),
      fraisCompteGenerique: m(comptes.generique), fraisCompteTva: m(comptes.tva), fraisCompteSalarie: m(comptes.salarie), fraisJournal: m(comptes.journal),
    });
  };
  const gabarit = (patch: Partial<GabaritExportComptable>) => save({ fraisGabarit: { ...s.fraisGabarit, ...patch } });
  const colonne = (c: ColonneEcriture, oui: boolean) => gabarit({ colonnes: LISTE_COLONNES_ECRITURE.filter(x => (x === c ? oui : s.fraisGabarit.colonnes.includes(x))) });
  const forfaitsAnnee = (d.ds.referentiels.forfaitsFrais ?? []).filter(f => f.annee === annee);
  const anneesBareme = [...new Set((d.ds.referentiels.baremesKm ?? []).map(b => b.annee))].sort((a, b) => b - a);

  return (
    <Panel title="Notes de frais" style={{ gap: 'var(--space-4)' }}>
      <label className="check-row">
        <input type="checkbox" checked={s.notesFraisActives} disabled={!admin} onChange={e => save({ notesFraisActives: e.target.checked })} />
        <span>Notes de frais activées (saisie, validation, contrôle, remboursement avec la paie)</span>
      </label>
      {!s.notesFraisActives && <Fine>Désactivées par défaut : l’essai de charge sur trois ans de frais dépasse le budget de l’instantané (docs/ARCHITECTURE.md). Préparez barème, limites et comptes avant d’activer.</Fine>}
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label="Circuit" htmlFor="frais-circuit">
          <select className="input" id="frais-circuit" value={s.fraisCircuit} disabled={!admin} onChange={e => save({ fraisCircuit: e.target.value as CircuitFrais })} style={{ maxWidth: 320 }}>
            <option value="manager_controle">Validation du manager, puis contrôle</option>
            <option value="manager">Validation du manager seule</option>
          </select>
        </Field>
        <Field label="Délai de soumission (mois)" htmlFor="frais-delai">
          <input className="input tnum" id="frais-delai" type="number" min={0} max={24} value={s.fraisDelaiSoumissionMois} disabled={!admin} onChange={e => save({ fraisDelaiSoumissionMois: Number(e.target.value) })} style={{ maxWidth: 100 }} />
        </Field>
        <Field label="Justificatif exigé au-delà de (€)" htmlFor="frais-seuil">
          <input className="input tnum" id="frais-seuil" type="number" min={0} max={1000} value={s.fraisSeuilJustificatif} disabled={!admin} onChange={e => save({ fraisSeuilJustificatif: Number(e.target.value) })} style={{ maxWidth: 100 }} />
        </Field>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={s.fraisIkCvReels} disabled={!admin} onChange={e => save({ fraisIkCvReels: e.target.checked })} />
        <span>Indemnités kilométriques à la puissance réelle au-delà de 7 CV (la part au-delà du barème plafonné est réintégrable)</span>
      </label>

      <Field label="Plafonds de la politique interne par catégorie (€, vide : aucun)">
        <div className="row-wrap" style={{ gap: 'var(--space-2)' }}>
          {AVEC_PLAFOND.map(c => (
            <label key={c} className="sub" style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 150 }}>
              {CATEGORIES_FRAIS[c].label}
              <input className="input tnum" inputMode="decimal" value={plafonds[c]} disabled={!admin} onChange={e => setPlafonds(x => ({ ...x, [c]: e.target.value }))} />
            </label>
          ))}
        </div>
      </Field>
      {tente && erreurPlafond && <p className="field-erreur" role="alert">Plafond {CATEGORIES_FRAIS[erreurPlafond].label.toLowerCase()} : montant en euros, positif.</p>}
      {admin && <div><Btn variant="secondary" small onClick={enregistrerPlafonds}>Enregistrer les plafonds</Btn></div>}
      <Fine>Un dépassement est une alerte : la dépense est acceptée avec un motif ou ramenée au plafond au contrôle. Ce n’est jamais une réintégration dans l’assiette des cotisations.</Fine>

      <Field label={`Barème kilométrique ${annee}`}>
        <div className="row-wrap" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
          {(Object.keys(TYPES_VEHICULE) as TypeVehicule[]).map(t => (
            <span key={t} style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <span className={baremeSaisi(d.ds.referentiels.baremesKm, annee, t) ? 'tag tag-neutral' : 'tag tag-accent'}>{TYPES_VEHICULE[t]} : {baremeSaisi(d.ds.referentiels.baremesKm, annee, t) ? 'saisi' : 'manquant'}</span>
              {admin && <Btn small onClick={() => openDialog({ type: 'fraisBareme', annee, vehicule: t })}>Saisir</Btn>}
            </span>
          ))}
        </div>
      </Field>
      {!baremeSaisi(d.ds.referentiels.baremesKm, annee) && <NoteAccent>Barème kilométrique {annee} manquant pour les voitures : les indemnités de l’année ne se calculent pas et leurs notes ne se soumettent pas.</NoteAccent>}
      {anneesBareme.length > 0 && <Fine>Barèmes saisis : {anneesBareme.join(', ')}. {admin ? `Saisir l’année suivante : ` : ''}{admin && <Btn small onClick={() => openDialog({ type: 'fraisBareme', annee: annee + 1, vehicule: 'voiture' })}>{`Barème ${annee + 1}`}</Btn>}</Fine>}

      <Field label={`Limites d’exonération ${annee} (montants URSSAF)`}>
        <table className="table">
          <tbody>
            {(Object.keys(FORFAITS_FRAIS) as (keyof typeof FORFAITS_FRAIS)[]).filter(k => k !== 'etranger').map(k => {
              const f = forfaitsAnnee.find(x => x.code === k && !x.pays);
              return <tr key={k}><td>{FORFAITS_FRAIS[k]}</td><td className="tnum nowrap">{f ? euros(f.montant) : <span className="tag tag-accent">manquante</span>}</td></tr>;
            })}
            {forfaitsAnnee.filter(f => f.code === 'etranger').map(f => (
              <tr key={f.id}><td>Étranger : {d.destOf(f.pays ?? '')?.pays ?? f.pays}</td><td className="tnum nowrap">{euros(f.montant)}</td></tr>
            ))}
          </tbody>
        </table>
      </Field>
      {rh && <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Btn small onClick={() => openDialog({ type: 'fraisForfait', annee })}>{`Saisir une limite ${annee}`}</Btn>
        <Btn small onClick={() => openDialog({ type: 'fraisForfait', annee: annee + 1 })}>{`Limites ${annee + 1}`}</Btn>
      </div>}
      <Fine>Montants 2026 de la démonstration repris de 2025 de mémoire : à vérifier sur urssaf.fr. Les forfaits de grand déplacement restent valorisés dans Sage ; Cursus bloque seulement leur cumul avec des frais réels de même nature.</Fine>

      <Field label="Fichier d’écritures pour la comptabilité : comptes">
        <div className="row-wrap" style={{ gap: 'var(--space-2)' }}>
          {AVEC_COMPTE.map(c => (
            <label key={c} className="sub" style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 150 }}>
              {CATEGORIES_FRAIS[c].label}
              <input className="input" value={comptes[c]} placeholder={COMPTES_FRAIS_DEFAUT[c] ?? compteDeCharge(c, s)} disabled={!admin} onChange={e => setComptes(x => ({ ...x, [c]: e.target.value }))} />
            </label>
          ))}
          {([['generique', 'Compte générique (divers, frais médicaux)'], ['tva', 'TVA déductible'], ['salarie', 'Compte du salarié'], ['journal', 'Journal']] as const).map(([k, l]) => (
            <label key={k} className="sub" style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 150 }}>
              {l}
              <input className="input" value={comptes[k]} disabled={!admin} onChange={e => setComptes(x => ({ ...x, [k]: e.target.value }))} />
            </label>
          ))}
        </div>
      </Field>
      {tente && erreurCompte && <p className="field-erreur" role="alert">Compte : chiffres et lettres, 13 caractères au plus ; journal : 1 à 6 lettres ou chiffres.</p>}
      {admin && <div><Btn variant="secondary" small onClick={enregistrerComptes}>Enregistrer les comptes</Btn></div>}
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label="Séparateur" htmlFor="frais-g-sep">
          <select className="input" id="frais-g-sep" value={s.fraisGabarit.separateur} disabled={!admin} onChange={e => gabarit({ separateur: e.target.value as GabaritExportComptable['separateur'] })}>
            {Object.entries(SEPARATEURS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Décimale" htmlFor="frais-g-dec">
          <select className="input" id="frais-g-dec" value={s.fraisGabarit.decimale} disabled={!admin} onChange={e => gabarit({ decimale: e.target.value as GabaritExportComptable['decimale'] })}>
            {Object.entries(DECIMALES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Dates" htmlFor="frais-g-date">
          <select className="input" id="frais-g-date" value={s.fraisGabarit.formatDate} disabled={!admin} onChange={e => gabarit({ formatDate: e.target.value as GabaritExportComptable['formatDate'] })}>
            {Object.entries(FORMATS_DATE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Encodage" htmlFor="frais-g-enc">
          <select className="input" id="frais-g-enc" value={s.fraisGabarit.encodage} disabled={!admin} onChange={e => gabarit({ encodage: e.target.value as GabaritExportComptable['encodage'] })}>
            {Object.entries(ENCODAGES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      </div>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <label className="check-row"><input type="checkbox" checked={s.fraisGabarit.entete} disabled={!admin} onChange={e => gabarit({ entete: e.target.checked })} /><span>Ligne d’en-tête</span></label>
        {COLONNES_ECRITURE_FACULTATIVES.map(c => (
          <label key={c} className="check-row"><input type="checkbox" checked={s.fraisGabarit.colonnes.includes(c)} disabled={!admin} onChange={e => void colonne(c, e.target.checked)} /><span>{COLONNES_ECRITURE[c].label}</span></label>
        ))}
      </div>
      <Fine>Comptes proposés (plan comptable général : 625x, 6061, 6135, TVA 44566, salarié 421, journal OD) à confirmer par la comptabilité. Les frais médicaux portent toujours le compte générique, avec le même libellé que toute dépense.</Fine>
    </Panel>
  );
}
