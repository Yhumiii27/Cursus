// Contact d'urgence d'un salarié (t068) : panneau du portail (« Mon contact d'urgence », saisi par l'intéressé) et ligne
// de la fiche collaborateur pour le service RH. Jamais montré au manager : le serveur ne le lui transmet pas
// (server/src/dataset.ts). Saisie : dialogs/ContactUrgenceDialog.tsx.
import { Btn, Fine, Panel } from './ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

/** Panneau du portail : contact de l'intéressé, à saisir ou modifier. */
export function ContactUrgencePanel({ empId }: { empId: number }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const e = d.emp(empId);
  if (!e) return null;
  return (
    <Panel title={t('My emergency contact')} aside={<Btn small onClick={() => openDialog({ type: 'contactUrgence', empId })}>{t(e.urgenceNom ? 'Edit' : 'Fill in')}</Btn>}>
      <div style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{e.urgenceNom ? `${e.urgenceNom} · ${e.urgenceTel ?? ''}` : t('No emergency contact given')}</div>
      <Fine>{t('Person to notify in case of an accident, on site or travelling. Optional; seen by HR only, never by your manager.')}</Fine>
    </Panel>
  );
}

/** Ligne de la fiche collaborateur (service RH) : contact indiqué par le salarié, modifiable par le service RH. */
export function ContactUrgenceFiche({ empId }: { empId: number }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const { rh } = useRole();
  const e = d.emp(empId);
  // Hors du service RH (manager), le contact n'est pas transmis : rien à afficher.
  if (!e || !rh) return null;
  return (
    <div className="item-head" style={{ alignItems: 'center' }}>
      <div>
        <div className="text-muted sub">{t('Emergency contact')}</div>
        <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{e.urgenceNom ? `${e.urgenceNom} · ${e.urgenceTel ?? ''}` : t('Not given (the employee enters it from their space)')}</div>
      </div>
      <Btn small onClick={() => openDialog({ type: 'contactUrgence', empId })}>{t(e.urgenceNom ? 'Edit' : 'Fill in')}</Btn>
    </div>
  );
}
