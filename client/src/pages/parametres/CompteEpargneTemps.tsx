// Paramètres → Compte épargne-temps : plafonds de placement (RTT par an, CP de la 5e semaine par période ; 5 et 5 par
// défaut, shared/rules/conges.ts) tant que l'accord sur le CET n'est pas connu, et rappel de ce que Cursus en fait : congé
// pris sur le CET validé comme un CP, rubrique de paie « CET » à confirmer, liquidation en entier à la sortie.
// Réglages de l'administrateur RH ; les autres profils de l'espace RH les consultent.
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

const PLAFONDS_RTT = [0, 2, 3, 5, 6, 8, 10, 12, 15, 20, 25];
const PLAFONDS_CP = [0, 1, 2, 3, 4, 5];

export function CompteEpargneTemps({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const save = useEnregistrerReglages();
  if (!espaceRh) return null;
  const liste = (valeurs: number[], v: number) => [...new Set([...valeurs, v])].sort((a, b) => a - b);
  return (
    <Panel title="Compte épargne-temps" style={{ gap: 'var(--space-4)' }}>
      <div className="grid-2">
        <Field label="RTT placés par an, au plus" htmlFor="param-cet-rtt">
          <select className="input" id="param-cet-rtt" value={s.cetPlafondRtt} disabled={!admin} onChange={e => save({ cetPlafondRtt: Number(e.target.value) })}>
            {liste(PLAFONDS_RTT, s.cetPlafondRtt).map(n => <option key={n} value={n}>{n ? `${n} j` : 'Aucun'}</option>)}
          </select>
        </Field>
        <Field label="CP de la 5e semaine par période, au plus" htmlFor="param-cet-cp">
          <select className="input" id="param-cet-cp" value={s.cetPlafondCp} disabled={!admin} onChange={e => save({ cetPlafondCp: Number(e.target.value) })}>
            {liste(PLAFONDS_CP, s.cetPlafondCp).map(n => <option key={n} value={n}>{n ? `${n} j` : 'Aucun'}</option>)}
          </select>
        </Field>
      </div>
      <Fine>
        Plafonds par défaut en attendant l’accord sur le compte épargne-temps : seuls les CP au-delà de 20 jours ouvrés (5e semaine) s’épargnent
        (art. L3151-2). Les jours épargnés se prennent en congé sur le CET, validé par le manager comme un congé payé et décompté en jours ouvrés ;
        le congé part dans le fichier de paie sous la rubrique « CET », désactivée et à confirmer par la paie : d’ici là, chaque congé est listé
        « à saisir dans Sage » dans le lot. Le solde est liquidé en entier à la sortie. Monétisation : pas encore proposée (accord à connaître).
      </Fine>
    </Panel>
  );
}
