// Paramètres → Repos hebdomadaire : dérogation au repos dominical de chaque équipe (shared/rules/semaine.ts). Par défaut
// aucune : toute heure saisie un dimanche est signalée au service RH sur la feuille, sans blocage. Travail en continu ou
// équipe de suppléance : heures du dimanche attendues, avec la référence de l'accord ou de l'autorisation, exigée.
// Réglage de l'administrateur RH (`temps.derogationDominicale`) ; les autres profils consultent (la référence n'est
// transmise qu'au service RH). Les 7 jours travaillés restent signalés quelle que soit la dérogation (art. L3132-1).
import { useState } from 'react';
import { DEROGATIONS_DOMINICALES } from '../../../../shared/rules/semaine.ts';
import type { Equipe, TypeDerogationDominicale } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useData, useStore } from '../../state/store.tsx';
import type { SectionProps } from './commun.ts';
import { t } from '../../i18n/langue.ts';

const TYPES = Object.entries(DEROGATIONS_DOMINICALES) as [TypeDerogationDominicale, { label: string; aide: string }][];

export function ReposHebdomadaire(_: SectionProps) {
  const data = useData();
  const equipes = data.referentiels.equipes;
  if (!equipes.length) return null;
  return (
    <Panel title={t('Weekly rest')} style={{ gap: 'var(--space-4)' }}>
      <Fine>
        {t('Saturday and Sunday are greyed out in the timesheets but stay enterable (worksite, trip, imperative). A week of 7 days worked is always flagged (6 days at most and 35 h of consecutive rest, art. L3132-1 and L3132-2); the Sunday hours are too except for an exemption from Sunday rest set for the team (art. L3132-3).')}
      </Fine>
      {equipes.map(q => <DerogationEquipe key={q.nom} q={q} />)}
    </Panel>
  );
}

function DerogationEquipe({ q }: { q: Equipe }) {
  const data = useData();
  const { admin } = useRole();
  const { run } = useStore();
  const actuelle = data.derogationsDominicales?.find(x => x.equipe === q.nom) ?? null;
  const [type, setType] = useState<TypeDerogationDominicale>(actuelle?.type ?? 'aucune');
  const [reference, setReference] = useState(actuelle?.reference ?? '');
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = `repos-${q.nom.replace(/\W+/g, '-')}`;
  const erreur = type !== 'aucune' && !reference.trim() ? t('Enter the reference of the agreement, the collective agreement or the authorisation.') : null;
  const modifie = type !== (actuelle?.type ?? 'aucune') || (type !== 'aucune' && reference.trim() !== (actuelle?.reference ?? ''));

  const enregistrer = async () => {
    if (erreur) { setTente(true); document.getElementById(`${id}-ref`)?.focus(); return; }
    setBusy(true);
    await run('temps.derogationDominicale', { equipe: q.nom, type, reference: type === 'aucune' ? '' : reference });
    setBusy(false);
    setTente(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <Field label={`${t('Team ')}${q.nom}`} htmlFor={id}>
        <select className="input" id={id} value={type} disabled={!admin} onChange={e => setType(e.target.value as TypeDerogationDominicale)} style={{ maxWidth: 280 }}>
          {TYPES.map(([v, x]) => <option key={v} value={v}>{x.label}</option>)}
        </select>
      </Field>
      {type !== 'aucune' && (
        <Field label={t('Reference of the agreement or the authorisation')} htmlFor={`${id}-ref`} requis erreur={tente && erreur}>
          <input className="input" id={`${id}-ref`} maxLength={120} value={reference} disabled={!admin} placeholder={actuelle && !actuelle.reference ? t('Filled in (HR)') : t('Company agreement of …')}
            onChange={e => setReference(e.target.value)} />
        </Field>
      )}
      <Fine>{DEROGATIONS_DOMINICALES[type].aide}</Fine>
      {admin && modifie && (
        <div className="actions-end"><Btn variant="primary" small disabled={busy} onClick={enregistrer}>{t('Save')}</Btn></div>
      )}
    </div>
  );
}
