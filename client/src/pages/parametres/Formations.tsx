// Paramètres → Formations (t118, shared/rules/formations-temps.ts) : heures des sessions de formation proposées dans la
// feuille de temps des inscrits (ligne interne INT-FORM, jamais envoyée à Keystone). Réglage de l'administrateur RH,
// enregistré aussitôt ; les autres profils le consultent. Actif par défaut.
import { ACTIVITE_FORMATION } from '../../../../shared/constants.ts';
import { fH } from '../../../../shared/format.ts';
import { HEURES_JOUR_MAX } from '../../../../shared/rules/temps.ts';
import { Fine, Panel } from '../../components/ui.tsx';
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
        « Proposer les heures » de l’écran Temps de travail ajoute, pour chaque session de la semaine où le salarié est inscrit (ou présent, une
        fois la session clôturée), une ligne {ACTIVITE_FORMATION.code} · {ACTIVITE_FORMATION.nom} avec les heures prévues : celles des horaires de
        la session, pause déduite, sinon la durée du catalogue répartie sur ses jours ({fH(HEURES_JOUR_MAX)} par jour au plus). Rien les jours
        fériés, d’absence ou non travaillés. Les heures restent modifiables par le salarié et son valideur ; activité interne, elles ne partent
        jamais vers Keystone.
      </Fine>
    </Panel>
  );
}
