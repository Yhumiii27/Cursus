// Paramètres → Formations (t118, shared/rules/formations-temps.ts) : heures des sessions de formation proposées dans la
// feuille de temps des inscrits (ligne interne INT-FORM, jamais envoyée à Keystone). Réglage de l'administrateur RH,
// enregistré aussitôt ; les autres profils le consultent. Actif par défaut.
import { ACTIVITE_FORMATION } from '../../../../shared/constants.ts';
import { fH } from '../../../../shared/format.ts';
import { HEURES_JOUR_MAX } from '../../../../shared/rules/temps.ts';
import { Fine, Panel, Seg } from '../../components/ui.tsx';
// lot 12 — C4 (organismes de formation et e-learning) : relance Qualiopi et fin des modules d'e-learning.
import { Field } from '../../components/Dialog.tsx';

/** lot 12 — C4 : premiers paliers proposés pour la relance Qualiopi (acceptés par le réglage, `entier(16, 180)`). */
const PALIERS_QUALIOPI: [number, string][] = [30, 60, 90, 120].map(n => [n, `${n} jours`]);
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

export function Formations({ s }: SectionProps) {
  const { admin } = useRole();
  const enregistrer = useEnregistrerReglages();
  return (
    <Panel title="Formations" style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.formationsTemps} disabled={!admin} onChange={e => enregistrer({ formationsTemps: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>Proposer les heures de formation dans les feuilles de temps</span>
      </label>
      <Fine>
        « Proposer » sur l’écran Temps de travail ajoute à la feuille, pour chaque session de la semaine où le salarié est inscrit (ou présent,
        une fois la session clôturée), une ligne {ACTIVITE_FORMATION.code} · {ACTIVITE_FORMATION.nom} avec les heures prévues : celles des horaires
        de la session, pause déduite ({fH(HEURES_JOUR_MAX)} par jour au plus), sinon la durée du catalogue répartie sur ses jours, une journée de
        travail au plus. Rien les jours fériés, d’absence ou non travaillés. Les lignes déjà saisies sont gardées : seules la ligne de la même
        formation et les tâches Keystone déjà proposées sont remplacées. Les heures restent modifiables par le salarié et son valideur ; activité
        interne, elles ne partent jamais vers Keystone.
      </Fine>
      {/* lot 12 — C4 (organismes de formation et e-learning) */}
      <Field label="Relance avant la fin de validité Qualiopi d’un organisme">
        <Seg name="param-qualiopi" label="Première relance Qualiopi" value={s.organismeAlerteQualiopiJours} disabled={!admin} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
          options={PALIERS_QUALIOPI.some(([n]) => n === s.organismeAlerteQualiopiJours) ? PALIERS_QUALIOPI : [...PALIERS_QUALIOPI, [s.organismeAlerteQualiopiJours, `${s.organismeAlerteQualiopiJours} jours`]]}
          onChange={v => enregistrer({ organismeAlerteQualiopiJours: v })} />
      </Field>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.elearningFinAutoImport} disabled={!admin} onChange={e => enregistrer({ elearningFinAutoImport: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>Valider d’office la fin d’un module d’e-learning à l’import (« terminé » et « réussi »), pour les modules sans attestation exigée</span>
      </label>
      <Fine>
        Qualiopi : le service RH est relancé par le récapitulatif des échéances à ce palier, 15 jours avant, puis une fois la certification échue ;
        c’est un avertissement, jamais un blocage. E-learning : sans fin d’office, chaque fin déclarée ou importée attend la validation du service RH,
        qui crée la formation suivie et, pour un module rattaché au catalogue, la certification. Évaluations par organisme : 3 exercices glissants
        par défaut (5 au choix sur la fiche).
      </Fine>
    </Panel>
  );
}
