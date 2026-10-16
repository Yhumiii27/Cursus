// Paramètres → Messagerie, récapitulatif des échéances (shared/rules/relances.ts, server/src/relances.ts) : envoi actif,
// paliers de relance (jours avant l'échéance ; l'échéance dépassée est toujours relancée) et jour d'envoi. Réglages de
// l'administrateur RH, enregistrés aussitôt ; les autres profils les consultent. Par défaut : actif, à 90, 30 et 7 jours
// puis échu, chaque jour à 7 h.
import { HEURE_RECAPITULATIF } from '../../../../shared/constants.ts';
import { JOURS_RELANCE, PALIERS_POSSIBLES, type JourRelance } from '../../../../shared/rules/relances.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

const JOUR_LABEL: Record<JourRelance, string> = {
  quotidien: 'Chaque jour', lundi: 'Le lundi', mardi: 'Le mardi', mercredi: 'Le mercredi', jeudi: 'Le jeudi', vendredi: 'Le vendredi',
};

export function RelancesEcheances({ s }: SectionProps) {
  const { admin } = useRole();
  const enregistrer = useEnregistrerReglages();
  // Le dernier palier coché ne se décoche pas : le serveur garderait les paliers en vigueur.
  const cocher = (p: number, oui: boolean) => enregistrer({ relancesPaliers: PALIERS_POSSIBLES.filter(x => (x === p ? oui : s.relancesPaliers.includes(x))) });

  return (
    <Panel title="Messagerie · récapitulatif des échéances" style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
        <input type="checkbox" checked={s.relancesActives} disabled={!admin} onChange={e => enregistrer({ relancesActives: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)' }} />
        Envoyer le récapitulatif des échéances par e-mail
      </label>
      <Fine>
        Le service RH (tout le périmètre), chaque manager (son équipe, sans visite médicale ni vaccination) et le référent HSE (formations et
        habilitations) reçoivent les titres, visites, formalités de voyage, entretiens et fins de contrat qui atteignent un palier : une seule
        fois par palier, à partir de {HEURE_RECAPITULATIF} h. Les feuilles de temps non soumises ont leur propre relance.
      </Fine>
      <Field label="Paliers de relance">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2) var(--space-4)' }}>
          {PALIERS_POSSIBLES.map(p => {
            const coche = s.relancesPaliers.includes(p);
            return (
              <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
                <input type="checkbox" checked={coche} disabled={!admin || !s.relancesActives || (coche && s.relancesPaliers.length === 1)}
                  onChange={e => cocher(p, e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
                {p} jours avant
              </label>
            );
          })}
          <span className="text-muted sub">puis l’échéance dépassée (toujours)</span>
        </div>
      </Field>
      <Field label="Envoi" htmlFor="relances-jour">
        <select className="input" id="relances-jour" value={s.relancesJour} disabled={!admin || !s.relancesActives}
          onChange={e => enregistrer({ relancesJour: e.target.value as JourRelance })}>
          {JOURS_RELANCE.map(j => <option key={j} value={j}>{JOUR_LABEL[j]}</option>)}
        </select>
      </Field>
    </Panel>
  );
}
