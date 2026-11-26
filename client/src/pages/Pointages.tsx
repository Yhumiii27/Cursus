// Écran Pointages (lot 12, chantier C6, étape 2 ; badgeage virtuel, t191) : ouvert dans les trois espaces le module
// activé (réglage pointageActif ; sinon la vue ramène à la page d'accueil, state/store.tsx), raccourci « Pointer » de
// l'application installée (/pointages). Profils restreints de l'espace RH (paie, référent HSE, lecture seule) : jamais,
// ils lisent la feuille de temps (shared/constants.ts, vues des profils).
// - En tête, le bouton « Pointer » de la personne connectée quand elle pointe (components/BoutonPointer.tsx).
// - Manager et service RH : corrections à valider (pastille du menu) et présences du jour du périmètre.
// - Sa propre semaine (collaborateur, ou manager qui pointe), avec ses anomalies et ses demandes ; la semaine d'un
//   salarié de l'équipe s'ouvre dans Temps de travail, onglet « Pointages ».
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { addD, isoWeek, mondayOf, parse } from '../../../shared/dates.ts';
import { fmt, fmtShort } from '../../../shared/format.ts';
import { BoutonPointer } from '../components/BoutonPointer.tsx';
import { CorrectionsAValider, PointagesSemaine, PresencesDuJour } from '../components/temps/Pointages.tsx';
import { pointe } from '../components/temps/pointage-etat.ts';
import { Empty, Fine, Page } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function Pointages() {
  const d = useDomain();
  const { collab, manager, rh, me } = useRole();
  const { ui, setUi } = useStore();
  const moi = me != null ? d.emp(me) : undefined;
  const wk = ui.weekStart ?? mondayOf(d.ds.today);
  const jePointe = moi && (pointe(d.ds, moi.id) || pointe(d.ds, moi.id, addD(wk, 6) < d.ds.today ? addD(wk, 6) : d.ds.today));

  return (
    <Page kicker={`${t('Week ')}${isoWeek(wk)} · ${fmtShort(parse(wk))} → ${fmt(parse(addD(wk, 6)))}`} title={t('Clock-ins')}
      note={collab ? undefined : t('Corrections to approve and today’s attendance in your scope. An employee’s week is shown in Working time, “Clock-ins” tab.')}
      actions={jePointe ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <button type="button" className="btn btn-ghost btn-icon plain" aria-label={t('Previous week')} title={t('Previous week')} onClick={() => setUi({ weekStart: addD(wk, -7) })}><CaretLeftIcon size={14} /></button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUi({ weekStart: mondayOf(d.ds.today) })}>{t('This week')}</button>
          <button type="button" className="btn btn-ghost btn-icon plain" aria-label={t('Next week')} title={t('Next week')} disabled={addD(wk, 7) > d.ds.today} onClick={() => setUi({ weekStart: addD(wk, 7) })}><CaretRightIcon size={14} /></button>
        </div>
      ) : undefined}>
      <BoutonPointer />
      {(manager || rh) && <CorrectionsAValider />}
      {(manager || rh) && <PresencesDuJour />}
      {jePointe && moi && <PointagesSemaine key={wk} emp={moi} wk={wk} />}
      {collab && !jePointe && <Empty>{t('You are not in a population that clocks in: your time is declared on the timesheet.')}</Empty>}
      <Fine>
        {t(`Clock-ins are kept for ${d.ds.settings.conservationPointagesAns} years, then erased. They are read only by the employee, their manager (or their deputy for timesheets) and HR.`)} {d.ds.settings.geolocActive
          // Étape 3 : géolocalisation au pointage active (populations désignées seulement).
          ? t('No position is recorded: for the designated teams, only the result of the location check (in the zone, outside the zone…) is kept. No photo nor biometric data (Privacy page).')
          : t('No position, no photo nor biometric data is recorded (Privacy page).')}
      </Fine>
    </Page>
  );
}
