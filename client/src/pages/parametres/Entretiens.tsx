// Paramètres → Campagne d'entretiens annuels : ouverture et clôture, ancienneté minimale, contrats exclus, affichage de
// l'échéance avant l'ouverture (réglages de l'administrateur RH, shared/rules/campagne.ts ; les autres profils les
// consultent). Par défaut, le fonctionnement d'origine : du 1er octobre au 15 décembre, sans ancienneté minimale, seul
// l'intérim exclu, échéance affichée toute l'année. Les dates s'enregistrent ensemble (« Enregistrer les dates ») : le
// serveur refuse une ouverture postérieure à la clôture.
import { useState } from 'react';
import { TYPES_CONTRAT } from '../../../../shared/constants.ts';
import { plural } from '../../../../shared/format.ts';
import { ANCIENNETES, CONTRATS_EXCLUABLES, campagne, PREAVIS, PREAVIS_TOUTE_ANNEE } from '../../../../shared/rules/campagne.ts';
import type { TypeContrat } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, Panel } from '../../components/ui.tsx';
import { useDomain, useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** Jours de chaque mois d'une année ordinaire (le 29 février n'existe pas chaque année). */
const JOURS_MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const pad = (n: number) => String(n).padStart(2, '0');

/** Jour et mois d'un réglage « MM-JJ » : deux listes ; un jour au-delà de la fin du mois est ramené à son dernier jour. */
function JourMois({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  const [m, j] = value.split('-').map(Number);
  const changer = (mois: number, jour: number) => onChange(`${pad(mois)}-${pad(Math.min(jour, JOURS_MOIS[mois - 1]))}`);
  return (
    <Field label={label} htmlFor={`${id}-jour`}>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <select className="input" id={`${id}-jour`} aria-label={`${label} : jour`} value={j} disabled={disabled} onChange={e => changer(m, Number(e.target.value))} style={{ width: 80 }}>
          {Array.from({ length: JOURS_MOIS[m - 1] }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n === 1 ? '1er' : n}</option>)}
        </select>
        <select className="input" aria-label={`${label} : mois`} value={m} disabled={disabled} onChange={e => changer(Number(e.target.value), j)} style={{ flex: 1 }}>
          {MOIS.map((nom, i) => <option key={nom} value={i + 1}>{nom}</option>)}
        </select>
      </div>
    </Field>
  );
}

export function Entretiens({ s }: SectionProps) {
  const d = useDomain();
  const { admin } = useRole();
  const enregistrer = useEnregistrerReglages();
  // Dates en cours de saisie : enregistrées ensemble, au bouton.
  const [debut, setDebut] = useState<string | null>(null);
  const [fin, setFin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dDebut = debut ?? s.campagneDebut, dFin = fin ?? s.campagneFin;
  const modifiees = dDebut !== s.campagneDebut || dFin !== s.campagneFin;
  const ordre = dDebut > dFin ? 'L’ouverture doit précéder la clôture, dans la même année.' : null;
  const c = campagne({ ...s, campagneDebut: dDebut, campagneFin: dFin }, d.year);

  const enregistrerDates = async () => {
    if (busy || ordre) return;
    setBusy(true);
    const r = await enregistrer({ campagneDebut: dDebut, campagneFin: dFin });
    setBusy(false);
    if (r.ok) { setDebut(null); setFin(null); }
  };
  const exclure = (t: TypeContrat, oui: boolean) =>
    enregistrer({ campagneExclus: CONTRATS_EXCLUABLES.filter(x => (x === t ? oui : s.campagneExclus.includes(x))) });

  return (
    <Panel title="Campagne d’entretiens annuels" style={{ gap: 'var(--space-4)' }}>
      <div className="grid-2">
        <JourMois id="camp-debut" label="Ouverture" value={dDebut} onChange={setDebut} disabled={!admin} />
        <JourMois id="camp-fin" label="Clôture (échéance)" value={dFin} onChange={setFin} disabled={!admin} />
      </div>
      {ordre && <p className="form-error">{ordre}</p>}
      {admin && modifiees && (
        <div className="actions-end">
          <Btn variant="secondary" disabled={busy} onClick={() => { setDebut(null); setFin(null); }}>Annuler</Btn>
          <Btn variant="primary" disabled={busy} onClick={enregistrerDates}>Enregistrer les dates</Btn>
        </div>
      )}
      <Fine>{c.libelle}. L’entretien annuel d’évaluation, distinct de l’entretien de parcours professionnel, est attendu de chaque salarié concerné avant la clôture.</Fine>

      <Field label="Ancienneté minimale à l’ouverture" htmlFor="camp-anciennete">
        <select className="input" id="camp-anciennete" value={s.campagneAncienneteMois} disabled={!admin}
          onChange={e => enregistrer({ campagneAncienneteMois: Number(e.target.value) })}>
          {[...new Set([...ANCIENNETES, s.campagneAncienneteMois])].sort((a, z) => a - z)
            .map(n => <option key={n} value={n}>{n ? plural(n, 'mois', 'mois') : 'Aucune'}</option>)}
        </select>
      </Field>

      <Field label="Contrats concernés">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {CONTRATS_EXCLUABLES.map(t => (
            <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
              <input type="checkbox" checked={!s.campagneExclus.includes(t)} disabled={!admin} onChange={e => exclure(t, !e.target.checked)}
                style={{ accentColor: 'var(--color-accent)' }} />
              {TYPES_CONTRAT[t].label}
            </label>
          ))}
          <span className="text-muted sub">CDI : toujours concernés · intérim : jamais (l’intérimaire relève de son agence).</span>
        </div>
      </Field>

      <Field label="Échéance affichée dans Entretiens" htmlFor="camp-preavis">
        <select className="input" id="camp-preavis" value={s.campagnePreavisJours} disabled={!admin}
          onChange={e => enregistrer({ campagnePreavisJours: Number(e.target.value) })}>
          {[...new Set([...PREAVIS, s.campagnePreavisJours])].sort((a, z) => z - a).map(n => (
            <option key={n} value={n}>{n >= PREAVIS_TOUTE_ANNEE ? 'Toute l’année' : n ? `${n} jours avant l’ouverture` : 'À l’ouverture'}</option>
          ))}
        </select>
      </Field>
      <Fine>L’entretien annuel apparaît « À planifier » dans les échéances à traiter à partir de ce moment, pour chaque salarié concerné qui n’en a pas eu dans l’année ; il se planifie depuis cette ligne.</Fine>
    </Panel>
  );
}
