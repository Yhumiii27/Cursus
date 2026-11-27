// Travailleur de nuit sur la fiche d'un salarié (Collaborateurs, section Contrat ; t048, étape 2) : statut calculé sur les
// feuilles validées et leurs horaires figés (shared/rules/repos-nuit.ts), critère rempli, et rappel du suivi médical adapté
// (VIP adaptée, art. R4624-17) quand le salarié est encore en VIP. Le référent HSE, qui n'a pas les feuilles, reçoit
// l'indication du serveur ; le suivi médical n'est montré qu'au service RH et à l'intéressé (`med.suiviNuit`).
import { estTravailleurNuit, NUIT_SEUIL_ANNUEL_LEGAL, plageNuitTexte, reglagesNuit, statutNuit, statutNuitTexte, SUIVI_NUIT } from '../../../shared/rules/repos-nuit.ts';
import type { EmpX } from '../../../shared/domain.ts';
import { useDomain } from '../state/derived.ts';
import { NoteAccent, Tag } from './ui.tsx';
import { t } from '../i18n/langue.ts';

export function TravailNuitFiche({ e }: { e: EmpX }) {
  const d = useDomain();
  if (!estTravailleurNuit(d.ds, e, d.ti)) return null;
  const s = reglagesNuit(d.ds.settings);
  // Vue du référent HSE : l'indication seule, sans les feuilles qui la fondent.
  const x = typeof e.travailleurNuit === 'boolean' ? null : statutNuit(d.ds, e.id, d.ti);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div>
        <div className="text-muted sub">{t('Night work')}</div>
        <div style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {t('Night worker')} <Tag cls="tag-outline">art. L3122-5</Tag>
        </div>
        <div className="text-muted sub">
          {x ? `${statutNuitTexte(x, s)} · ` : ''}{t('night period ')}{plageNuitTexte(s)}
          {t(s.nuitSeuilAnnuel !== NUIT_SEUIL_ANNUEL_LEGAL || s.nuitAccord ? ' (collective agreement)' : ' (default legal values)')}.
          {t(' Daily duration of 8 h at most (art. L3122-6), compensations of the agreement to apply.')}
        </div>
      </div>
      {e.med.suiviNuit && <NoteAccent>{SUIVI_NUIT}{t(': adapted information and prevention visit (art. R4624-17), type of monitoring to change on the sheet.')}</NoteAccent>}
    </div>
  );
}
