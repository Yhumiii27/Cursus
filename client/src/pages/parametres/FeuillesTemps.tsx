// Paramètres → Suivi des feuilles de temps (t130) : semaines affichées dans le tableau de l'écran Temps, jour et heure de
// la semaine suivante où une feuille est attendue (par défaut le lundi à 12 h), au-delà desquels elle est en retard et se
// relance (shared/rules/suivi-feuilles.ts). Réglages de l'administrateur RH ; les autres profils consultent. La date de
// clôture des variables de paie se règle dans la section Paie.
import { delaiTexte } from '../../../../shared/rules/suivi-feuilles.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

const SEMAINES = Array.from({ length: 11 }, (_, i) => i + 2);
const JOURS: [number, string][] = [[1, 'Lundi'], [2, 'Mardi'], [3, 'Mercredi'], [4, 'Jeudi'], [5, 'Vendredi']];
const HEURES = Array.from({ length: 24 }, (_, i) => i);

export function FeuillesTemps({ s }: SectionProps) {
  const { admin } = useRole();
  const save = useEnregistrerReglages();
  return (
    <Panel title="Suivi des feuilles de temps" style={{ gap: 'var(--space-4)' }}>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label="Feuille attendue le" htmlFor="ft-jour">
          <select className="input" id="ft-jour" value={s.feuilleLimiteJour} disabled={!admin} onChange={e => save({ feuilleLimiteJour: Number(e.target.value) })}>
            {JOURS.map(([v, l]) => <option key={v} value={v}>{l} suivant</option>)}
          </select>
        </Field>
        <Field label="À" htmlFor="ft-heure">
          <select className="input" id="ft-heure" value={s.feuilleLimiteHeure} disabled={!admin} onChange={e => save({ feuilleLimiteHeure: Number(e.target.value) })}>
            {HEURES.map(h => <option key={h} value={h}>{h} h</option>)}
          </select>
        </Field>
        <Field label="Semaines affichées" htmlFor="ft-semaines">
          <select className="input" id="ft-semaines" value={s.suiviSemaines} disabled={!admin} onChange={e => save({ suiviSemaines: Number(e.target.value) })}>
            {SEMAINES.map(n => <option key={n} value={n}>{n} semaines</option>)}
          </select>
        </Field>
      </div>
      <Fine>
        Une feuille de temps est attendue {delaiTexte(s)} : passé ce délai, une feuille non saisie, en brouillon ou à corriger est en retard,
        signalée dans l’écran Temps de travail et relancée en un clic (e-mail au salarié et à son valideur). La clôture des variables de paie se
        règle dans la section Paie.
      </Fine>
    </Panel>
  );
}
