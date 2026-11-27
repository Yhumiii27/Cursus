// Aptitude médicale d'un collaborateur (fiche, portail) : verdict, restrictions de poste, demande de visite en cours ;
// et demande de visite imprimable, que le service RH transmet au service de prévention et de santé au travail.
import type { ReactNode } from 'react';
import { AVIS_MEDICAL, CLS, MOTIFS_VISITE } from '../../../shared/constants.ts';
import type { Domain, EmpX } from '../../../shared/domain.ts';
import { equipeLabel, fmtIso } from '../../../shared/format.ts';
import { matriculeAffiche } from '../../../shared/rules/matricules.ts';
import { restrictionEnVigueur, restrictionTexte } from '../../../shared/rules/sante.ts';
import { suiviTexte } from '../../../shared/rules/suivi-medical.ts';
import { SUIVI_NUIT } from '../../../shared/rules/repos-nuit.ts';
import { exposeDe } from '../../../shared/rules/visites-dues.ts';
import type { DemandeVisite } from '../../../shared/types.ts';
import { matriculesImprimes, printDocument } from '../print.ts';
import { Tag } from './ui.tsx';
import { t } from '../i18n/langue.ts';

/**
 * Demande de visite imprimable (ou enregistrée en PDF) pour le service de prévention et de santé au travail :
 * identité et poste du salarié, motif de la visite, habilitations du poste qui exigent l'aptitude. Aucune donnée médicale.
 */
export function imprimerDemandeVisite(d: Domain, e: EmpX, x: DemandeVisite): boolean {
  const m = MOTIFS_VISITE[x.motif];
  const habs = e.habs.filter(h => h.delivree && h.hm.medical && h.mesure !== 'retrait');
  return printDocument(t('Medical visit request'), t('For the attention of the occupational health and prevention service'), [
    {
      title: t('Employee#salarie'),
      rows: [[t('Name'), e.nom], [t('Employee number'), matriculeAffiche(e)], e.naissanceLe ? [t('Date of birth'), fmtIso(e.naissanceLe)] : [t('Year of birth'), String(e.naissance)], [t('Job'), e.poste], [t('Team'), equipeLabel(e)],
        [t('Contract'), d.contratOf(e).libelle], [t('Start date'), fmtIso(e.entree)]],
    },
    {
      title: t('Visit requested'),
      rows: [[t('Reason'), m.label], [t('Reference'), `${m.article}${t(' of the Labour Code')}`], [t('Requested on#label'), fmtIso(x.le)], [t('By'), `${x.par}${t(', HR')}`],
        [t('Last visit recorded'), e.visite ? fmtIso(e.visite) : t('none#fem')]],
    },
    ...(habs.length ? [{ title: t('Authorisations of the job that require medical fitness'), table: { head: [t('Authorisation'), t('Detail')], rows: habs.map(h => [h.hm.nom, h.hm.detail]) } }] : []),
    { title: t('Follow-up'), text: t('Please call the employee in and send the fitness opinion to HR, who records it in Cursus. This request contains no medical information.') },
  ], e.id, `${e.nom} · ${matriculesImprimes(e)}`);
}

/**
 * Aptitude médicale : verdict, échéance et demande de visite en cours (texte de `med`), restrictions (en vigueur et
 * terminées pour le service RH et l'intéressé ; en vigueur seulement pour le manager). `actions` : boutons du service RH.
 */
export function Aptitude({ e, d, horizon, actions }: { e: EmpX; d: Domain; horizon: number; actions?: ReactNode }) {
  const m = e.med, key = d.medKey(m, horizon);
  const verdict = m.avis === 'inapte' ? AVIS_MEDICAL.inapte.label
    : !m.ok && !m.verdictSeul ? t(m.visite ? 'Fitness expired' : 'No visit recorded')
    : !m.ok ? t('Fitness not valid')
    : m.avis === 'restrictions' ? AVIS_MEDICAL.restrictions.court : t('Fit');
  const statut = t(key === 'exp' ? (m.avis === 'inapte' || m.verdictSeul ? 'Not valid#fem' : m.visite ? 'Expired#fem' : 'Not entered#fem') : key === 'due' ? (m.ok && m.examenRequis ? 'Examination required' : 'To renew') : 'Valid#fem');
  // Verdict seul (manager) : ni date ni échéance à afficher.
  // Visite due à un événement (vue manager) : « visite à programmer », sans motif ni date.
  const detail = !m.verdictSeul ? m.text : m.ok || m.avis === 'inapte' ? `${t('Occupational physician’s opinion')}${m.aProgrammer ? t(' · visit to schedule by HR') : ''}` : t('Visit to schedule by HR');
  return (
    <div className="list-row stack">
      <div className="item-head">
        <div>
          <div style={{ fontSize: 14 }}>{verdict}</div>
          <div className="text-muted sub">{detail}</div>
          {/* Type de suivi : service RH et intéressé (jamais dans la vue manager, `suivi` null). */}
          {m.suivi && <div className="text-muted sub">{t('Type of monitoring: ')}{suiviTexte(m.suivi)}{m.examenRequis ? t(' · medical fitness examination to schedule') : ''}{exposeDe(d.ds, e) ? t(' · exposed to particular risks') : ''}</div>}
          {/* Visites dues à un événement (embauche, reprise, mi-carrière, fin de carrière) : service RH et intéressé. */}
          {m.dues?.map(v => <div key={v.motif} className="text-muted sub">{v.label}{t(': ')}{t(v.le < d.ti ? 'overdue since' : 'at the latest on')} {fmtIso(v.le)} — {v.detail}</div>)}
          {/* Travailleur de nuit encore en VIP (shared/rules/repos-nuit.ts) : suivi adapté à prévoir, service RH et intéressé. */}
          {m.suiviNuit && <div className="text-muted sub">{SUIVI_NUIT}{t(': night worker (adapted VIP, art. R4624-17)')}</div>}
        </div>
        <Tag cls={CLS[key]} style={{ flex: 'none' }}>{statut}</Tag>
      </div>
      {m.restrictions.length > 0 && (
        <div>
          <div className="text-muted sub">{t('Job restrictions and adjustments (occupational physician’s opinion)')}</div>
          <ul className="rules">
            {m.restrictions.map((r, i) => (
              <li key={i} className={restrictionEnVigueur(r, d.ti) ? undefined : 'text-muted'}>
                {restrictionTexte(r)}{restrictionEnVigueur(r, d.ti) ? '' : t(' (ended)#fem')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {actions && <div className="actions-end">{actions}</div>}
    </div>
  );
}
