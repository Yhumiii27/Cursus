// Paramètres → Agenda (t036, server/src/agenda.ts) : abonnement de chaque salarié à son agenda personnel (Outlook),
// désactivé par défaut, et ce que le flux publie. Les absences y figurent toujours sous « Absent », quelle que soit leur
// nature. L'administrateur RH révoque tous les abonnements d'un coup (adresse divulguée, changement de règle) ; chaque
// salarié gère le sien depuis son portail. Les congés validés arrivent aussi par l'e-mail de décision (.ics joint).
import type { ContenuAgenda } from '../../../../shared/types.ts';
import { Btn, Fine, Panel, Tag } from '../../components/ui.tsx';
import type { Confirmation } from '../../state/confirmations.ts';
import { useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

/** Contenu publié : sources anglaises, traduites au rendu. */
const CONTENUS: [ContenuAgenda, string][] = [
  ['sessions', 'Training sessions they are enrolled in'],
  ['entretiens', 'Planned reviews'],
  ['absences', 'Absences and leave in force (under “Absent”)'],
  ['deplacements', 'Trips (countries and dates)'],
  // lot 12 — C5 (planning d'équipe)
  ['postes', 'Published shifts of the team planning (module activated)'],
];

/** Révocation de tous les abonnements : chacun en recrée un depuis son espace. */
const revocationAgendas = (): Confirmation => ({
  titre: t('Revoke all subscriptions'),
  question: t('Revoke the subscriptions of all employees to their calendar?'),
  suites: [t('The subscribed calendars stop updating; the events already received stay until the next reading.'), t('Everyone can create a new address from their space.')],
  bouton: t('Revoke all'),
  action: 'agenda.revoquerTout',
  payload: {},
});

export function Agenda({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const { openDialog } = useStore();
  const enregistrer = useEnregistrerReglages();
  if (!espaceRh) return null;
  const basculer = (c: ContenuAgenda, oui: boolean) => enregistrer({ agendaContenu: CONTENUS.map(([k]) => k).filter(k => (k === c ? oui : s.agendaContenu.includes(k))) });
  return (
    <Panel title={t('Calendar')} aside={<Tag cls={s.agendaFluxActif ? 'tag-neutral' : 'tag-outline'}>{s.agendaFluxActif ? t('Subscription open') : t('Deactivated')}</Tag>} style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.agendaFluxActif} disabled={!admin} onChange={e => enregistrer({ agendaFluxActif: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>{t('Subscription to the personal calendar: each employee can add their Cursus calendar to Outlook from their space')}</span>
      </label>
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <legend className="text-muted sub" style={{ marginBottom: 'var(--space-2)' }}>{t('Content published')}</legend>
        {CONTENUS.map(([k, l]) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={s.agendaContenu.includes(k)} disabled={!admin} onChange={e => basculer(k, e.target.checked)} style={{ accentColor: 'var(--color-accent)', flex: 'none' }} />
            <span>{t(l)}</span>
          </label>
        ))}
      </fieldset>
      {admin && <div><Btn small onClick={() => openDialog({ type: 'confirmer', c: revocationAgendas() })}>{t('Revoke all subscriptions…')}</Btn></div>}
      <Fine>
        {t('Personal and secret address (random token, kept only as a fingerprint), revocable by the employee; it stops working when they leave or when their account is deactivated. Three months past and one year ahead, refreshed by Outlook every few hours. The approved leave also goes as a calendar file with the decision e-mail, and its cancellation removes it.')}
      </Fine>
    </Panel>
  );
}
