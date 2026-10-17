// Format du fichier d'import Sage (administrateur RH et gestionnaire de paie, écran Temps) : séparateur, colonnes
// facultatives (code dossier, libellé de la rubrique, début et fin de période) et ordre des colonnes, format de la
// période et des dates, séparateur décimal, ligne d'en-tête, encodage (UTF-8 sans BOM ou Windows-1252), quantités
// négatives acceptées ou non (régularisation d'une feuille rouverte par écart, ou en « annule et remplace »), ajustés par le
// gestionnaire de paie au modèle d'import de son Sage. Aperçu sur deux lignes d'exemple ; le format s'applique aux
// prochains téléchargements.
import { useState } from 'react';
import {
  COLONNES_FACULTATIVES, COLONNES_FICHIER, controlerFormat, DECIMALES, ENCODAGES, fichierLot, FORMAT_FICHIER_DEFAUT, FORMATS_DATE, FORMATS_PERIODE, SEPARATEURS,
} from '../../../shared/rules/lots-paie.ts';
import { modeRegularisation, MODES_REGULARISATION } from '../../../shared/rules/regularisation.ts';
import type { ColonneFichierPaie, FormatFichierPaie } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, Pre } from '../components/ui.tsx';
import { useData, useStore } from '../state/store.tsx';

const EXEMPLE = {
  dossier: 'CURSUS-CHIMIE',
  lignes: [{ matricule: '004102', semaine: '2026-S41', periode: '2026-10', rubriques: { HN: 35, HS25: 2.5 } }],
  libelles: { HN: 'Heures normales', HS25: 'Heures supplémentaires payées, majorées à 25 %' },
};
const options = <K extends string>(r: Record<K, string>) => Object.entries(r) as [K, string][];
const caseStyle = { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' } as const;
const coche = { accentColor: 'var(--color-accent)', flex: 'none' } as const;

export function FormatFichierDialog() {
  const data = useData();
  const { run, closeDialog } = useStore();
  const actuel = { ...FORMAT_FICHIER_DEFAUT, ...data.formatFichierPaie };
  const [f, setF] = useState<FormatFichierPaie>(actuel);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const maj = (patch: Partial<FormatFichierPaie>) => setF(x => ({ ...x, ...patch }));
  const controle = controlerFormat(f as unknown as Record<string, unknown>, actuel);
  const erreur = typeof controle === 'string' ? controle : null;
  const erreurColonnes = erreur?.startsWith('Colonnes') ? erreur : null;
  const erreurDecimale = erreur && !erreurColonnes ? erreur : null;
  const dates = f.colonnes.includes('debut') || f.colonnes.includes('fin');

  const enregistrer = async () => {
    if (busy || !v.verifier(erreur)) return;
    setBusy(true);
    const r = await run('paie.formatFichier', { ...f });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  // Choisir en position i une colonne déjà placée ailleurs les échange : jamais deux fois la même colonne.
  const colonne = (i: number, c: ColonneFichierPaie) => setF(x => {
    const cols = [...x.colonnes], j = cols.indexOf(c);
    if (j >= 0) cols[j] = cols[i];
    cols[i] = c;
    return { ...x, colonnes: cols };
  });
  // Colonne facultative cochée : ajoutée en dernière position ; décochée : retirée.
  const facultative = (c: ColonneFichierPaie, oui: boolean) => maj({ colonnes: oui ? [...f.colonnes.filter(x => x !== c), c] : f.colonnes.filter(x => x !== c) });

  return (
    <Dialog title="Format du fichier d’import" width={600} onSubmit={enregistrer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer</SubmitButton>
    </>}>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label="Séparateur de colonnes" htmlFor="ff-sep">
          <select className="input" id="ff-sep" value={f.separateur} onChange={e => maj({ separateur: e.target.value as FormatFichierPaie['separateur'] })}>
            {options(SEPARATEURS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Séparateur décimal" htmlFor="ff-dec" erreur={erreurDecimale}>
          <select className="input" id="ff-dec" value={f.decimale} onChange={e => maj({ decimale: e.target.value as FormatFichierPaie['decimale'] })}>
            {options(DECIMALES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Période" htmlFor="ff-per">
          <select className="input" id="ff-per" value={f.formatPeriode} onChange={e => maj({ formatPeriode: e.target.value as FormatFichierPaie['formatPeriode'] })}>
            {options(FORMATS_PERIODE).map(([k, l]) => <option key={k} value={k}>{k} ({l})</option>)}
          </select>
        </Field>
        <Field label="Encodage" htmlFor="ff-enc">
          <select className="input" id="ff-enc" value={f.encodage} onChange={e => maj({ encodage: e.target.value as FormatFichierPaie['encodage'] })}>
            {options(ENCODAGES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Colonnes facultatives">
        <div className="row-wrap" style={{ gap: 'var(--space-2) var(--space-4)' }}>
          {COLONNES_FACULTATIVES.map(c => (
            <label key={c} style={caseStyle}>
              <input type="checkbox" checked={f.colonnes.includes(c)} onChange={e => facultative(c, e.target.checked)} style={coche} />
              <span>{COLONNES_FICHIER[c]}{c === 'dossier' ? ' (dossier de paie)' : ''}</span>
            </label>
          ))}
        </div>
      </Field>
      {dates && (
        <Field label="Format des dates de période" htmlFor="ff-date">
          <select className="input" id="ff-date" value={f.formatDate} onChange={e => maj({ formatDate: e.target.value as FormatFichierPaie['formatDate'] })} style={{ width: 'auto' }}>
            {options(FORMATS_DATE).map(([k, l]) => <option key={k} value={k}>{k} ({l})</option>)}
          </select>
        </Field>
      )}
      <Field label="Ordre des colonnes" erreur={erreurColonnes}>
        <div className="row-wrap" style={{ gap: 'var(--space-2)' }}>
          {f.colonnes.map((c, i) => (
            <select key={i} className="input" aria-label={`Colonne ${i + 1}`} value={c} onChange={e => colonne(i, e.target.value as ColonneFichierPaie)} style={{ width: 'auto' }}>
              {f.colonnes.map(k => <option key={k} value={k}>{i + 1}. {COLONNES_FICHIER[k]}</option>)}
            </select>
          ))}
        </div>
      </Field>
      <label style={caseStyle}>
        <input type="checkbox" checked={f.entete} onChange={e => maj({ entete: e.target.checked })} style={coche} />
        <span>Première ligne d’en-tête (noms des colonnes)</span>
      </label>
      {/* Correction d'une feuille déjà transmise (t131) : écart, ou « annule et remplace » si l'import refuse le négatif. */}
      <label style={caseStyle}>
        <input type="checkbox" checked={f.negatifs !== false} onChange={e => maj({ negatifs: e.target.checked })} style={coche} />
        <span>Quantités négatives acceptées par l’import (régularisation par écart)</span>
      </label>
      <Fine>{MODES_REGULARISATION[modeRegularisation(f)].aide} Ce choix s’applique aux prochains lots générés.</Fine>
      {!erreur && <>
        <Fine>Aperçu (deux lignes d’exemple) :</Fine>
        {/* Lignes longues (libellés) : défilement dans l'aperçu, sans élargir le dialogue sur un petit écran. */}
        <div style={{ width: 0, minWidth: '100%' }}>
          <Pre maxHeight={120}>{fichierLot(EXEMPLE, f).replace(/\t/g, '→')}</Pre>
        </div>
      </>}
      <Fine>
        Une ligne par salarié, période de paie et rubrique, quantités additionnées sur la période. Réglez le format sur le modèle d’import de votre Sage ; il s’applique aux prochains téléchargements, sans changer le contenu des lots.
        {f.encodage === 'windows-1252' ? ' Windows-1252 : un caractère absent de ce jeu (rare : codes, nombres et libellés en français y figurent) devient « ? ».' : ' UTF-8 sans BOM : choisissez Windows-1252 (ANSI) si Sage affiche mal les accents des libellés.'}
      </Fine>
    </Dialog>
  );
}
