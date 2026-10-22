// Travailleur de nuit sur la fiche d'un salarié (Collaborateurs, section Contrat ; t048, étape 2) : statut calculé sur les
// feuilles validées et leurs horaires figés (shared/rules/repos-nuit.ts), critère rempli, et rappel du suivi médical adapté
// (VIP adaptée, art. R4624-17) quand le salarié est encore en VIP. Le référent HSE, qui n'a pas les feuilles, reçoit
// l'indication du serveur ; le suivi médical n'est montré qu'au service RH et à l'intéressé (`med.suiviNuit`).
import { estTravailleurNuit, NUIT_SEUIL_ANNUEL_LEGAL, plageNuitTexte, reglagesNuit, statutNuit, statutNuitTexte, SUIVI_NUIT } from '../../../shared/rules/repos-nuit.ts';
import type { EmpX } from '../../../shared/domain.ts';
import { useDomain } from '../state/derived.ts';
import { NoteAccent, Tag } from './ui.tsx';

export function TravailNuitFiche({ e }: { e: EmpX }) {
  const d = useDomain();
  if (!estTravailleurNuit(d.ds, e, d.ti)) return null;
  const s = reglagesNuit(d.ds.settings);
  // Vue du référent HSE : l'indication seule, sans les feuilles qui la fondent.
  const x = typeof e.travailleurNuit === 'boolean' ? null : statutNuit(d.ds, e.id, d.ti);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div>
        <div className="text-muted sub">Travail de nuit</div>
        <div style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          Travailleur de nuit <Tag cls="tag-outline">art. L3122-5</Tag>
        </div>
        <div className="text-muted sub">
          {x ? `${statutNuitTexte(x, s)} · ` : ''}plage de nuit {plageNuitTexte(s)}
          {s.nuitSeuilAnnuel !== NUIT_SEUIL_ANNUEL_LEGAL || s.nuitAccord ? ' (accord collectif)' : ' (valeurs supplétives de la loi)'}.
          Durée quotidienne de 8 h au plus (art. L3122-6), contreparties de l’accord à appliquer.
        </div>
      </div>
      {e.med.suiviNuit && <NoteAccent>{SUIVI_NUIT} : visite d’information et de prévention adaptée (art. R4624-17), type de suivi à changer sur la fiche.</NoteAccent>}
    </div>
  );
}
