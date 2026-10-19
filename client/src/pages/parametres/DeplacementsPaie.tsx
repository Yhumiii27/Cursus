// Paramètres → Déplacements et paie (t031, shared/rules/deplacements-paie.ts) : jours et nuits de grand déplacement, jours
// à l'étranger et trajets dans le fichier d'import de la paie. Désactivé par défaut (réponse de l'entreprise du 18 octobre
// 2026) : la paie l'active après avoir confirmé ses codes Sage ; d'ici là, les quantités sont calculées et listées « à
// saisir dans Sage » dans le résumé de chaque lot et l'export des variables. Date de mise en service : premier jour de
// déplacement transmis. Rappel de vérification de la vigilance des pays avant un départ (t068). Réglages de
// l'administrateur RH, enregistrés aussitôt (la date en quittant le champ) ; les autres profils les consultent.
import { useEffect, useState } from 'react';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

const RAPPELS: [number, string][] = [[15, '15 j'], [30, '30 j'], [60, '60 j'], [90, '90 j']];

export function DeplacementsPaie({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const enregistrer = useEnregistrerReglages();
  const [depart, setDepart] = useState(s.deplacementsPaieAPartirDu ?? '');
  useEffect(() => setDepart(s.deplacementsPaieAPartirDu ?? ''), [s.deplacementsPaieAPartirDu]);
  if (!espaceRh) return null;
  const enregistrerDepart = () => {
    if (depart !== (s.deplacementsPaieAPartirDu ?? '')) enregistrer({ deplacementsPaieAPartirDu: depart || null });
  };
  return (
    <Panel title="Déplacements et paie" style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.deplacementsFichierPaie} disabled={!admin} onChange={e => enregistrer({ deplacementsFichierPaie: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>Transmettre les déplacements dans le fichier d’import de la paie</span>
      </label>
      <Fine>
        Chaque lot de paie calcule, mois par mois : jours et nuits de grand déplacement en France (missions des chantiers que le service RH a
        qualifiés, écran Missions), jours de mission à l’étranger par pays (déplacements), et un forfait par trajet aller ou retour ; jours
        d’absence exclus, déplacements annulés retirés (régularisation au lot suivant). Quantités seules : le barème reste dans Sage. Décoché
        (par défaut, tant que la paie n’a pas confirmé ses codes), comme pour une rubrique désactivée, les quantités partent sans code Sage :
        listées « à saisir dans Sage » dans le résumé du lot et l’export des variables, elles ne repartent pas une fois le lot confirmé.
      </Fine>
      <Field label="Déplacements transmis à partir du" htmlFor="param-deplacements-depuis">
        <input className="input" id="param-deplacements-depuis" type="date" value={depart} disabled={!admin} style={{ maxWidth: 200 }}
          onChange={ev => setDepart(ev.target.value)} onBlur={enregistrerDepart} />
      </Field>
      <Fine>
        Date de mise en service (conseillée : le 1er janvier 2027, comme les absences) : aucun jour de déplacement d’avant ne part, Lucca et
        Sage les ont traités. Sans date, le premier lot de paie pose la sienne au premier jour de la période ouverte.
      </Fine>
      <Field label="Vigilance des pays : rappel avant un départ">
        <Seg name="param-vigilance-rappel" label="Vigilance des pays : rappel avant un départ" value={s.vigilanceRappelJours} options={RAPPELS} disabled={!admin}
          onChange={v => enregistrer({ vigilanceRappelJours: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Fine>
        Le dossier voyage rappelle de vérifier la vigilance du pays sur France Diplomatie tant que la vérification manque ou date de plus de ce
        nombre de jours (écran Référentiels, destinations). France Diplomatie n’a pas d’API : la mise à jour reste manuelle.
      </Fine>
    </Panel>
  );
}
