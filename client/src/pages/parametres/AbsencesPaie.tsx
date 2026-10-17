// Paramètres → Absences et paie (t028, shared/rules/absences-paie.ts) : absences validées dans le fichier d'import de la
// paie, avec les heures. Activé par défaut (réponse de l'entreprise du 17 octobre 2026) ; décoché, le fichier se limite
// aux heures et la paie saisit les absences dans Sage. Réglage de l'administrateur RH, enregistré aussitôt ; les autres
// profils le consultent. Les codes Sage des rubriques d'absence se confirment sur l'écran Temps (« Rubriques de paie »).
import { Fine, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

export function AbsencesPaie({ s }: SectionProps) {
  const { admin } = useRole();
  const enregistrer = useEnregistrerReglages();
  return (
    <Panel title="Absences et paie" style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.absencesFichierPaie} disabled={!admin} onChange={e => enregistrer({ absencesFichierPaie: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>Transmettre les absences validées dans le fichier d’import de la paie</span>
      </label>
      <Fine>
        Chaque lot de paie emporte, avec les heures, les absences validées : congés payés en jours ouvrés, RTT ou jours de repos en jours, récupération
        en heures, demi-journées comprises ; hors congés, une rubrique par rémunération (non payée, indemnisée, salaire maintenu) et par catégorie
        (santé, parentalité, événement familial), en jours de la nature. Les jours sont ventilés mois par mois ; ceux d’une période close partent en
        rappel. Une absence annulée, raccourcie ou requalifiée après sa transmission part en régularisation négative dans le lot suivant.
        Les rubriques d’absence restent « à confirmer » : tant que la paie n’a pas confirmé leur code Sage (écran Temps), seul un lot de simulation
        se génère ; une rubrique désactivée laisse sa nature à la saisie dans Sage. Décoché, le fichier se limite aux heures.
      </Fine>
    </Panel>
  );
}
