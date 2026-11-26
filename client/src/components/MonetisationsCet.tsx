// lot 13 — CET (monétisation) sur l'écran Congés & absences (shared/rules/cet-monetisation.ts) :
// - « Monétisations du CET à décider » : demandes en attente, validées ou refusées par le service RH (jamais les siennes) ;
//   les autres profils de l'espace RH les voient sans agir.
// - « Monétisations du CET » : demandes récentes (année en cours et précédente) avec leur état pour la paie ; le salarié
//   voit les siennes et retire une demande en attente ; le service RH annule une monétisation validée hors de tout lot.
// Le manager ne voit pas ce panneau (ses membres : jours déduits du solde seulement, server/src/vues-cet.ts).
import { fJ, fmtIso } from '../../../shared/format.ts';
import { etatMonetisation, monetisationAnnulable } from '../../../shared/rules/cet-monetisation.ts';
import type { MonetisationCet } from '../../../shared/types.ts';
import { annulationMonetisationCet, refusMonetisationCet, validationMonetisationCet } from '../state/confirmations-cet.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Panel, Two } from './ui.tsx';
import { t, tn } from '../i18n/langue.ts';

export function MonetisationsCet() {
  const d = useDomain();
  const { espaceRh, rh, collab, me, soi } = useRole();
  const { openDialog } = useStore();
  if (!espaceRh && !collab) return null;
  const toutes = (d.ds.monetisationsCet ?? []).filter(m => espaceRh || m.empId === me);
  const nom = (m: MonetisationCet) => d.emp(m.empId)?.nom ?? '—';
  const aDecider = espaceRh ? toutes.filter(m => m.statut === 'demandee') : [];
  const recentes = toutes.filter(m => !(espaceRh && m.statut === 'demandee') && m.annee >= d.year - 1)
    .sort((a, b) => b.demandeLe.localeCompare(a.demandeLe));
  if (!aDecider.length && !recentes.length) return null;
  const clotureJour = d.ds.settings?.clotureJour ?? 0;
  return (
    <>
      {aDecider.length > 0 && (
        <Panel highlight title={t('CET cash-ins to decide')} aside={`${tn(aDecider.length, 'request', 'requests')}${t(' · approved by HR, paid under the item CET_MON')}`}>
          <div className="list">
            {aDecider.map(m => (
              <div key={m.id} className="list-row">
                <div className="grow">
                  <Two main={`${nom(m)} · ${fJ(m.jours)}`} sub={`${t('Requested on#fem')} ${fmtIso(m.demandeLe.slice(0, 10))}${m.demandeParInteresse ? '' : `${t(' by ')}${m.demandePar || t('HR#the')}`}`} />
                </div>
                {rh && m.empId !== soi
                  ? <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: refusMonetisationCet(m, nom(m)) })}>{t('Refuse')}</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'confirmer', c: validationMonetisationCet(m, nom(m), d.ti, clotureJour) })}>{t('Approve')}</button>
                  </div>
                  : <span className="text-muted sub">{t(rh ? 'Decision by another member of HR' : 'Decision by HR')}</span>}
              </div>
            ))}
          </div>
        </Panel>
      )}
      {recentes.length > 0 && (
        <Panel title={t(espaceRh ? 'CET cash-ins' : 'My CET cash-ins')} aside={`${d.year - 1}${t(' and #et')}${d.year}`}>
          <div className="list">
            {recentes.map(m => {
              const parLeSalarie = !espaceRh && m.empId === me && m.statut === 'demandee';
              const parLeRh = rh && m.empId !== soi && m.statut === 'validee' && monetisationAnnulable(m);
              return (
                <div key={m.id} className="list-row">
                  <div className="grow">
                    <Two main={`${espaceRh ? `${nom(m)} · ` : ''}${fJ(m.jours)} · ${etatMonetisation(m)}`}
                      sub={`${t('Requested on#fem')} ${fmtIso(m.demandeLe.slice(0, 10))}${m.decideLe ? `${t(' · decided on#fem')} ${fmtIso(m.decideLe.slice(0, 10))}` : ''}${m.motif ? `${t(' · reason: ')}${m.motif}` : ''}`} />
                  </div>
                  {(parLeSalarie || parLeRh) && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: annulationMonetisationCet(m, nom(m), parLeSalarie) })}>
                      {parLeSalarie ? t('Withdraw') : t('Cancel')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </>
  );
}
