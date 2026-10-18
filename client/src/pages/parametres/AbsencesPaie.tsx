// Paramètres → Absences et paie (t028, shared/rules/absences-paie.ts) : absences validées dans le fichier d'import de la
// paie, avec les heures. Activé par défaut (réponse de l'entreprise du 17 octobre 2026) ; décoché, le fichier se limite
// aux heures et la paie saisit les absences dans Sage. Date de mise en service : premier jour d'absence transmis, les
// jours d'avant ayant été traités par Lucca et Sage. Réglages de l'administrateur RH, enregistrés aussitôt (la date en
// quittant le champ) ; les autres profils les consultent. Les codes Sage des rubriques d'absence se confirment sur
// l'écran Temps (« Rubriques de paie »).
import { useEffect, useState } from 'react';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

export function AbsencesPaie({ s }: SectionProps) {
  const { admin } = useRole();
  const enregistrer = useEnregistrerReglages();
  // Date saisie, enregistrée en quittant le champ : une saisie au clavier passe par des dates intermédiaires.
  const [depart, setDepart] = useState(s.absencesPaieAPartirDu ?? '');
  useEffect(() => setDepart(s.absencesPaieAPartirDu ?? ''), [s.absencesPaieAPartirDu]);
  const enregistrerDepart = () => {
    if (depart !== (s.absencesPaieAPartirDu ?? '')) enregistrer({ absencesPaieAPartirDu: depart || null });
  };
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
        se génère ; une rubrique désactivée laisse sa nature à la saisie dans Sage. Décoché, le fichier se limite aux heures ; coché de nouveau,
        les absences déjà enregistrées ne partent qu’à partir de la période de paie ouverte (la paie a saisi les autres dans Sage).
      </Fine>
      <Field label="Absences transmises à partir du" htmlFor="param-absences-depuis">
        <input className="input" id="param-absences-depuis" type="date" value={depart} disabled={!admin} style={{ maxWidth: 200 }}
          onChange={ev => setDepart(ev.target.value)} onBlur={enregistrerDepart} />
      </Field>
      <Fine>
        Date de mise en service (conseillée : la date d’arrêté des compteurs repris de Lucca, le 1er janvier 2027) : aucun jour d’absence d’avant
        ne part dans le fichier, Lucca et Sage les ont traités. Le service RH est prévenu quand une absence enregistrée, validée ou annulée a des jours
        avant cette date, à saisir ou corriger dans Sage. Sans date, le premier lot de paie pose la sienne au premier jour de la période ouverte,
        pour les absences déjà enregistrées ; une absence enregistrée ensuite part entière, en rappel pour un mois clos.
      </Fine>
    </Panel>
  );
}
