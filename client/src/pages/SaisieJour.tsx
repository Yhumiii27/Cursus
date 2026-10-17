// Saisie des heures sur téléphone et tablette : la grille de la semaine (projet × 7 jours) demande environ 620 px et
// des cibles minuscules au doigt. Sous 600 px de large, ou sur écran tactile (VUE_JOUR de components/heures.ts), la
// feuille s'affiche jour par jour : un sélecteur des sept jours (samedi et dimanche grisés, normalement non travaillés
// mais saisissables) avec le total de chacun, une ligne par projet avec un
// champ d'heures assez grand, le total du jour et de la semaine. Même feuille, mêmes règles et même action
// (`temps.setCell`) que la grille, que le PC garde ; « Ajouter un projet » et la soumission restent sous la vue
// (pages/Temps.tsx). Le jour s'ouvre sur aujourd'hui ; celui choisi est mémorisé (`ui.tsJour`) d'une semaine à l'autre.
// Chaque champ d'heures est nommé « <projet> · <tâche> — <jour> » ; l'alerte « heures un jour d'absence » lui est reliée
// (aria-describedby). Le champ (ChampHeures) sert aussi à la grille de la semaine.
import { useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { cap, fH, num } from '../../../shared/format.ts';
import type { ISODate, LigneTemps } from '../../../shared/types.ts';
import { cellText, cellValue, jourParDefaut, nomChamp, VUE_JOUR } from '../components/heures.ts';
import { useMedia } from '../components/media.ts';
import { CloseButton } from '../components/ui.tsx';
import { useStore } from '../state/store.tsx';

/**
 * Champ d'heures : valeur locale, envoyée au serveur à la sortie du champ ou sur Entrée. `label` : nom pour un lecteur
 * d'écran (projet, tâche, jour). `alerte` : heures saisies un jour d'absence validée — champ signalé, texte en infobulle et
 * relié au champ par `alerteId` (élément qui porte ce texte, visible ou réservé aux lecteurs d'écran).
 */
export function ChampHeures({ value, disabled, label, alerte, alerteId, className = '', style, onCommit }: {
  value: number; disabled: boolean; label: string; alerte?: string; alerteId?: string; className?: string; style?: CSSProperties;
  onCommit: (raw: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(cellText(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) { setPrev(value); setText(cellText(value)); }

  const commit = async () => {
    const n = cellValue(text);
    if (n === value) { setText(cellText(value)); return; }
    setText(cellText(n));
    if (!(await onCommit(text))) setText(cellText(value));
  };
  const onKey = (ev: KeyboardEvent<HTMLInputElement>) => { if (ev.key === 'Enter') ev.currentTarget.blur(); };

  return (
    <input
      className={`input tnum${alerte ? ' alerte' : ''}${className ? ` ${className}` : ''}`} type="text" inputMode="decimal" aria-label={label}
      value={text} disabled={disabled} title={alerte} aria-invalid={alerte ? true : undefined} aria-describedby={alerte && alerteId ? alerteId : undefined}
      onChange={ev => setText(ev.target.value.replace(/[^\d.,]/g, '').slice(0, 5))} onBlur={commit} onKeyDown={onKey} style={style}
    />
  );
}

/** Vrai quand la feuille s'affiche jour par jour ; suit la rotation de l'écran et le redimensionnement de la fenêtre. */
export const useVueJour = () => useMedia(VUE_JOUR);

/** Jour de la feuille, tel que calculé par la feuille de la semaine (pages/Temps.tsx). */
export interface JourFeuille {
  day: ISODate;
  /** « Lun. 12 » (en-tête de colonne) et « lundi 12 octobre » (nom des champs). */
  label: string; long: string;
  /** Férié, absence, jour non travaillé, mission… ; « — » sinon. `hl` : à signaler (mission, heures à retirer). */
  note: string; hl: boolean;
  /** Aucune heure ce jour-là (férié, absence, hors contrat) : un champ déjà rempli reste modifiable pour être vidé. */
  locked: boolean;
  /** Samedi ou dimanche : grisé, normalement non travaillé, saisissable (chantier, déplacement, impératif). */
  weekend?: boolean;
}

export function SaisieJour({ wk, days, lignes, perDay, total, editable, occupe, projet, alerteDe, enregistrer, supprimer }: {
  wk: ISODate; days: JourFeuille[]; lignes: LigneTemps[]; perDay: number[]; total: number; editable: boolean; occupe: boolean;
  /** Libellé d'un projet (Keystone ou activité interne). */
  projet: (code: string) => string;
  /** Alerte de la cellule (heures un jour d'absence), ou rien. */
  alerteDe: (li: number, di: number) => string | undefined;
  enregistrer: (li: number, di: number, raw: string) => Promise<boolean>;
  supprimer: (li: number, ev: MouseEvent) => void;
}) {
  const { ui, setUi, data } = useStore();
  const jour = Math.min(days.length - 1, Math.max(0, ui.tsJour ?? jourParDefaut(days.map(x => x.day), data?.today ?? '', perDay)));
  const x = days[jour];
  const titre = `ts-jour-${wk}`;

  return (
    <div className="saisie-jour">
      <div className={`jours-semaine${days.length > 5 ? ' sept' : ''}`} role="group" aria-label="Jour affiché">
        {days.map((j, i) => (
          <button key={j.day} type="button" className={`jour-btn${j.weekend ? ' weekend' : ''}`} aria-pressed={i === jour} onClick={() => setUi({ tsJour: i })}>

            <span>{j.label}</span>
            <span className={`jour-total tnum${j.hl ? ' signale' : ''}`}>{perDay[i] ? fH(perDay[i]) : '—'}</span>
          </button>
        ))}
      </div>

      <section className="jour-detail" aria-labelledby={titre}>
        <div className="jour-tete">
          <h3 id={titre}>{cap(x.long)}</h3>
          {x.note !== '—' && <span className={x.hl ? 'note-accent' : 'text-muted sub'}>{x.note}</span>}
        </div>
        {lignes.map((l, li) => {
          const alerte = alerteDe(li, jour), alerteId = `ts-jour-alerte-${li}`;
          return (
            <div key={li} className="jour-ligne">
              <div className="grow">
                <div><span style={{ color: 'var(--color-accent-300)' }}>{l.projet}</span> · {projet(l.projet)}</div>
                <div className="text-muted sub">{l.tache}</div>
                {alerte && <div className="note-accent" id={alerteId}>{alerte}</div>}
              </div>
              {/* Une clé par jour : la saisie en cours d'un jour ne passe pas au suivant. */}
              <ChampHeures key={`${li}-${jour}`} className="champ-jour" value={num(l.h[jour])} label={nomChamp(l, x.long)}
                disabled={!editable || (x.locked && !alerte)} alerte={alerte} alerteId={alerteId}
                onCommit={raw => enregistrer(li, jour, raw)} />
              {editable && <CloseButton label={`Supprimer la ligne ${l.projet}`} disabled={occupe} onClick={ev => supprimer(li, ev)} />}
            </div>
          );
        })}
        <div className="jour-totaux">
          <span>Total du jour</span><span className="tnum">{perDay[jour] ? fH(perDay[jour]) : '—'}</span>
        </div>
        <div className="jour-totaux">
          <span>Total de la semaine</span><span className="tnum">{fH(total)}</span>
        </div>
      </section>
    </div>
  );
}
