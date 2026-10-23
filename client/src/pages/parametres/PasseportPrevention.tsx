// Paramètres → Passeport de prévention (lot 7, chantier B, t066 ; shared/rules/passeport-prevention.ts) : colonnes de
// l'export des lignes à déclarer (écran Formations), dans l'ordre du gabarit. Le format d'import de la plateforme côté
// employeur n'est pas connu : gabarit réglable, mention « à confirmer ». Réglage de l'administrateur RH, enregistré
// aussitôt (au moins une colonne) ; les autres profils de l'espace RH le consultent.
import { COLONNES_PASSEPORT, MENTION_PASSEPORT } from '../../../../shared/rules/passeport-prevention.ts';
import type { ColonnePasseport } from '../../../../shared/types.ts';
import { Fine, NoteAccent, Panel } from '../../components/ui.tsx';
import { useDomain, useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

export function PasseportPrevention({ s }: SectionProps) {
  const d = useDomain();
  const { admin, espaceRh } = useRole();
  const enregistrer = useEnregistrerReglages();
  if (!espaceRh) return null;
  const basculer = (c: ColonnePasseport, oui: boolean) =>
    enregistrer({ passeportColonnes: COLONNES_PASSEPORT.map(x => x.id).filter(k => (k === c ? oui : s.passeportColonnes.includes(k))) });
  const marquees = d.ds.referentiels.formations.filter(f => f.passeportPrevention && !f.archive).length;
  return (
    <Panel title="Passeport de prévention" style={{ gap: 'var(--space-4)' }}>
      <NoteAccent>{MENTION_PASSEPORT} : colonnes à ajuster quand la Caisse des dépôts publiera le format d’import des employeurs.</NoteAccent>
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <legend className="text-muted sub" style={{ marginBottom: 'var(--space-2)' }}>Colonnes de l’export, dans cet ordre</legend>
        {COLONNES_PASSEPORT.map(c => {
          const coche = s.passeportColonnes.includes(c.id);
          return (
            <label key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
              {/* La dernière colonne cochée ne se décoche pas : l'export en garde au moins une. */}
              <input type="checkbox" checked={coche} disabled={!admin || (coche && s.passeportColonnes.length === 1)} onChange={e => basculer(c.id, e.target.checked)}
                style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
              <span>{c.label}{c.aide && <span className="text-muted sub" style={{ display: 'block' }}>{c.aide}</span>}</span>
            </label>
          );
        })}
      </fieldset>
      <Fine>
        Export depuis l’écran Formations (service RH et référent HSE), tracé dans le journal, suivi d’une mention sur chaque ligne. Sont exportées les
        certifications et formations suivies des formations cochées « Passeport de prévention » dans Référentiels → Formations ({marquees} en
        vigueur), hors celles déjà marquées déclarées. Cursus ne détient pas le NIR.
      </Fine>
    </Panel>
  );
}
