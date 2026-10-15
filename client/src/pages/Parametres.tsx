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

export function Parametres() {
  const data = useData();
  // `consultation` : service RH et lecture seule (journal, envois, réglages en lecture) ; `rh` : relance des envois.
  const { rh, admin, consultation, user } = useRole();
  // Envois sortants : état de l'intégration et derniers messages, rechargés comme le journal.
  const envois = useSuiviEnvois(consultation);

  if (!consultation) return <Page title="Paramètres"><Empty>Paramètres réservés au service RH.</Empty></Page>;

  const props: SectionProps = { s: data.settings, envois };
  const rendre = (place: SectionParametres['place']) => SECTIONS.filter(x => x.place === place).map(({ id, Section }) => <Section key={id} {...props} />);

  return (
    <Page kicker={`Administration · ${user.nom}`} title="Paramètres" note={admin
      ? 'Ces réglages s’appliquent à tous les utilisateurs de Cursus. Chaque modification est enregistrée immédiatement et tracée dans le journal.'
      : rh ? 'Consultation : les réglages et les comptes sont réservés à l’administrateur RH ; la transmission à la paie, à l’administrateur RH et au gestionnaire de paie.'
      : 'Lecture seule : réglages, intégrations, envois et journal des actions, sans modification. Les messages qui peuvent toucher à la santé sont masqués dans le journal.'}>
      <div className="row-wrap">
        <div className="col-stack" style={{ flex: '1 1 480px' }}>{rendre('gauche')}</div>
        <div className="col-stack" style={{ flex: '1 1 380px' }}>{rendre('droite')}</div>
      </div>
      {rendre('large')}
    </Page>
  );
}
