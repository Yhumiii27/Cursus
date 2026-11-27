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
// lot 12 — C2 (notes de frais : activation)
import { prerequisFrais } from '../../../../shared/rules/frais-activation.ts';
import { COLONNES_ECRITURE, COLONNES_ECRITURE_FACULTATIVES, compteDeCharge, COMPTES_FRAIS_DEFAUT, estCompte, estJournal, LISTE_COLONNES_ECRITURE } from '../../../../shared/rules/frais-export.ts';
import { DECIMALES, ENCODAGES, FORMATS_DATE, SEPARATEURS } from '../../../../shared/rules/lots-paie.ts';
import type { ColonneEcriture, GabaritExportComptable } from '../../../../shared/rules/export-comptable.ts';
import type { CategorieFrais, CircuitFrais, TypeVehicule } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, NoteAccent, Panel, Tag, Two } from '../../components/ui.tsx';
import { euros } from '../../components/frais/commun.ts';
import { nombreSaisi } from '../../components/frais/saisie.ts';
import { useDomain, useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

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
    const x = v.trim().toUpperCase();
    if (k === 'journal') return !estJournal(x);
    return parCategorie.has(k) ? !!x && !estCompte(x) : !estCompte(x);
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
    <Panel title={t('Expense reports')} style={{ gap: 'var(--space-4)' }}>
      <label className="check-row">
        <input type="checkbox" checked={s.notesFraisActives} disabled={!admin} onChange={e => save({ notesFraisActives: e.target.checked })} />
        <span>{t('Expense reports activated (entry, approval, check, reimbursement with payroll)')}</span>
      </label>
      {!s.notesFraisActives && <Fine>{t('Deactivated by default: the load test (three and five years of expenses) does not yet meet all its budgets (docs/ARCHITECTURE.md). Activation is your decision: first check the prerequisites below.')}</Fine>}
      {/* lot 12 — C2 : prérequis de l'activation (comptes, rubriques FRAIS_*, barème de l'année), jamais bloquants. */}
      <div role="list" aria-label={t('Prerequisites of the activation')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {prerequisFrais(s, d.ds.rubriquesPaie, d.ds.referentiels.baremesKm, annee).map(p => (
          <div key={p.cle} role="listitem" className="list-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Tag cls={p.ok ? 'tag-neutral' : 'tag-accent'}>{p.ok ? t('Ready') : t('To do')}</Tag>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}><Two main={p.libelle} sub={p.detail} /></div>
          </div>
        ))}
      </div>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label={t('Circuit')} htmlFor="frais-circuit">
          <select className="input" id="frais-circuit" value={s.fraisCircuit} disabled={!admin} onChange={e => save({ fraisCircuit: e.target.value as CircuitFrais })} style={{ maxWidth: 320 }}>
            <option value="manager_controle">{t('Approval by the manager, then check')}</option>
            <option value="manager">{t('Approval by the manager alone')}</option>
          </select>
        </Field>
        <Field label={t('Submission time limit (months)')} htmlFor="frais-delai">
          <input className="input tnum" id="frais-delai" type="number" min={0} max={24} value={s.fraisDelaiSoumissionMois} disabled={!admin} onChange={e => save({ fraisDelaiSoumissionMois: Number(e.target.value) })} style={{ maxWidth: 100 }} />
        </Field>
        <Field label={t('Supporting document required beyond (€)')} htmlFor="frais-seuil">
          <input className="input tnum" id="frais-seuil" type="number" min={0} max={1000} value={s.fraisSeuilJustificatif} disabled={!admin} onChange={e => save({ fraisSeuilJustificatif: Number(e.target.value) })} style={{ maxWidth: 100 }} />
        </Field>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={s.fraisIkCvReels} disabled={!admin} onChange={e => save({ fraisIkCvReels: e.target.checked })} />
        <span>{t('Mileage allowances at the actual horsepower beyond 7 CV (the part beyond the capped scale can be reinstated)')}</span>
      </label>

      <Field label={t('Ceilings of the internal policy by category (€, empty: none)')}>
        <div className="row-wrap" style={{ gap: 'var(--space-2)' }}>
          {AVEC_PLAFOND.map(c => (
            <label key={c} className="sub" style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 150 }}>
              {CATEGORIES_FRAIS[c].label}
              <input className="input tnum" inputMode="decimal" value={plafonds[c]} disabled={!admin} onChange={e => setPlafonds(x => ({ ...x, [c]: e.target.value }))} />
            </label>
          ))}
        </div>
      </Field>
      {tente && erreurPlafond && <p className="field-erreur" role="alert">{t('Ceiling ')}{CATEGORIES_FRAIS[erreurPlafond].label.toLowerCase()}{t(': amount in euros, positive.')}</p>}
      {admin && <div><Btn variant="secondary" small onClick={enregistrerPlafonds}>{t('Save the ceilings')}</Btn></div>}
      <Fine>{t('An overrun is an alert: the expense is accepted with a reason or brought down to the ceiling at the check. It is never a reinstatement in the contribution base.')}</Fine>

      <Field label={`${t('Mileage scale ')}${annee}`}>
        <div className="row-wrap" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
          {(Object.keys(TYPES_VEHICULE) as TypeVehicule[]).map(ty => (
            <span key={ty} style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <span className={baremeSaisi(d.ds.referentiels.baremesKm, annee, ty) ? 'tag tag-neutral' : 'tag tag-accent'}>{TYPES_VEHICULE[ty]}{t(': ')}{baremeSaisi(d.ds.referentiels.baremesKm, annee, ty) ? t('entered#masc') : t('missing#masc')}</span>
              {admin && <Btn small onClick={() => openDialog({ type: 'fraisBareme', annee, vehicule: ty })}>{t('Enter#verb')}</Btn>}
            </span>
          ))}
        </div>
      </Field>
      {!baremeSaisi(d.ds.referentiels.baremesKm, annee) && <NoteAccent>{t('Mileage scale ')}{annee}{t(' missing for cars: the allowances of the year are not calculated and their reports are not submitted.')}</NoteAccent>}
      {anneesBareme.length > 0 && <Fine>{t('Scales entered: ')}{anneesBareme.join(', ')}. {admin ? t('Enter the next year: ') : ''}{admin && <Btn small onClick={() => openDialog({ type: 'fraisBareme', annee: annee + 1, vehicule: 'voiture' })}>{`${t('Scale ')}${annee + 1}`}</Btn>}</Fine>}

      <Field label={`${t('Exemption limits ')}${annee}${t(' (URSSAF amounts)')}`}>
        <table className="table">
          <tbody>
            {(Object.keys(FORFAITS_FRAIS) as (keyof typeof FORFAITS_FRAIS)[]).filter(k => k !== 'etranger').map(k => {
              const f = forfaitsAnnee.find(x => x.code === k && !x.pays);
              return <tr key={k}><td>{FORFAITS_FRAIS[k]}</td><td className="tnum nowrap">{f ? euros(f.montant) : <span className="tag tag-accent">{t('missing#fem')}</span>}</td></tr>;
            })}
            {forfaitsAnnee.filter(f => f.code === 'etranger').map(f => (
              <tr key={f.id}><td>{t('Abroad: ')}{d.destOf(f.pays ?? '')?.pays ?? f.pays}</td><td className="tnum nowrap">{euros(f.montant)}</td></tr>
            ))}
          </tbody>
        </table>
      </Field>
      {rh && <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Btn small onClick={() => openDialog({ type: 'fraisForfait', annee })}>{`${t('Enter a limit ')}${annee}`}</Btn>
        <Btn small onClick={() => openDialog({ type: 'fraisForfait', annee: annee + 1 })}>{`${t('Limits ')}${annee + 1}`}</Btn>
      </div>}
      <Fine>{t('2026 amounts of the demonstration taken over from 2025 from memory: to be checked on urssaf.fr. The long-distance travel flat rates stay valued in Sage; Cursus only blocks their combination with actual expenses of the same nature.')}</Fine>

      <Field label={t('Entries file for accounting: accounts')}>
        <div className="row-wrap" style={{ gap: 'var(--space-2)' }}>
          {AVEC_COMPTE.map(c => (
            <label key={c} className="sub" style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 150 }}>
              {CATEGORIES_FRAIS[c].label}
              <input className="input" value={comptes[c]} placeholder={COMPTES_FRAIS_DEFAUT[c] ?? compteDeCharge(c, s)} disabled={!admin} onChange={e => setComptes(x => ({ ...x, [c]: e.target.value }))} />
            </label>
          ))}
          {([['generique', 'Generic account (miscellaneous, medical expenses)'], ['tva', 'Deductible VAT'], ['salarie', 'Employee’s account'], ['journal', t('Journal')]] as const).map(([k, l]) => (
            <label key={k} className="sub" style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 150 }}>
              {t(l)}
              <input className="input" value={comptes[k]} disabled={!admin} onChange={e => setComptes(x => ({ ...x, [k]: e.target.value }))} />
            </label>
          ))}
        </div>
      </Field>
      {tente && erreurCompte && <p className="field-erreur" role="alert">{t('Account: digits and letters, 13 characters at most; journal: 1 to 6 letters or digits.')}</p>}
      {admin && <div><Btn variant="secondary" small onClick={enregistrerComptes}>{t('Save the accounts')}</Btn></div>}
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label={t('Separator')} htmlFor="frais-g-sep">
          <select className="input" id="frais-g-sep" value={s.fraisGabarit.separateur} disabled={!admin} onChange={e => gabarit({ separateur: e.target.value as GabaritExportComptable['separateur'] })}>
            {Object.entries(SEPARATEURS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label={t('Decimal')} htmlFor="frais-g-dec">
          <select className="input" id="frais-g-dec" value={s.fraisGabarit.decimale} disabled={!admin} onChange={e => gabarit({ decimale: e.target.value as GabaritExportComptable['decimale'] })}>
            {Object.entries(DECIMALES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label={t('Dates')} htmlFor="frais-g-date">
          <select className="input" id="frais-g-date" value={s.fraisGabarit.formatDate} disabled={!admin} onChange={e => gabarit({ formatDate: e.target.value as GabaritExportComptable['formatDate'] })}>
            {Object.entries(FORMATS_DATE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label={t('Encoding')} htmlFor="frais-g-enc">
          <select className="input" id="frais-g-enc" value={s.fraisGabarit.encodage} disabled={!admin} onChange={e => gabarit({ encodage: e.target.value as GabaritExportComptable['encodage'] })}>
            {Object.entries(ENCODAGES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      </div>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <label className="check-row"><input type="checkbox" checked={s.fraisGabarit.entete} disabled={!admin} onChange={e => gabarit({ entete: e.target.checked })} /><span>{t('Header line')}</span></label>
        {COLONNES_ECRITURE_FACULTATIVES.map(c => (
          <label key={c} className="check-row"><input type="checkbox" checked={s.fraisGabarit.colonnes.includes(c)} disabled={!admin} onChange={e => void colonne(c, e.target.checked)} /><span>{COLONNES_ECRITURE[c].label}</span></label>
        ))}
      </div>
      <Fine>{t('Accounts offered (general chart of accounts: 625x, 6061, 6135, VAT 44566, employee 421, journal OD) to be confirmed by accounting. Medical expenses always carry the generic account, with the same label as any expense.')}</Fine>
    </Panel>
  );
}
