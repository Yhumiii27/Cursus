// Paramètres (service RH) : règles de suivi, intégrations Keystone et Sage Paie, messagerie, envois sortants, comptes
// et accès, journal des actions (pages/Journal.tsx), démonstration. Les réglages, les comptes et la réinitialisation
// sont réservés à l'administrateur RH ; le gestionnaire RH et la lecture seule consultent (la lecture seule ne relance
// ni ne classe les envois). Une section par fichier dans pages/parametres/, dans l'ordre de parametres/sections.tsx.
import { Empty, Page } from '../components/ui.tsx';
import { useRole } from '../state/derived.ts';
import { useData } from '../state/store.tsx';
import type { SectionProps } from './parametres/commun.ts';
import { useSuiviEnvois } from './parametres/Envois.tsx';
import { type SectionParametres, SECTIONS } from './parametres/sections.tsx';
import { t } from '../i18n/langue.ts';

export function Parametres() {
  const data = useData();
  // `consultation` : service RH et lecture seule (journal, envois, réglages en lecture) ; `rh` : relance des envois.
  const { rh, admin, consultation, user } = useRole();
  // Envois sortants : état de l'intégration et derniers messages, rechargés comme le journal.
  const envois = useSuiviEnvois(consultation);

  if (!consultation) return <Page title={t('Settings')}><Empty>{t('Settings reserved to HR.')}</Empty></Page>;

  const props: SectionProps = { s: data.settings, envois };
  const rendre = (place: SectionParametres['place']) => SECTIONS.filter(x => x.place === place).map(({ id, Section }) => <Section key={id} {...props} />);

  return (
    <Page kicker={`${t('Administration')} · ${user.nom}`} title={t('Settings')} note={admin
      ? t('These settings apply to all Cursus users. Each change is saved immediately and traced in the log.')
      : rh ? t('Read only: the settings and the accounts are reserved to the HR administrator; the transmission to payroll, to the HR administrator and the payroll manager.')
      : t('Read only: settings, integrations, sends and log of actions, without change. The messages that may touch on health are hidden in the log.')}>
      <div className="row-wrap">
        <div className="col-stack" style={{ flex: '1 1 480px' }}>{rendre('gauche')}</div>
        <div className="col-stack" style={{ flex: '1 1 380px' }}>{rendre('droite')}</div>
      </div>
      {rendre('large')}
    </Page>
  );
}
