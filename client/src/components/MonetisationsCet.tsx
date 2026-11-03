// lot 13 — CET (monétisation) sur l'écran Congés & absences (shared/rules/cet-monetisation.ts) :
// - « Monétisations du CET à décider » : demandes en attente, validées ou refusées par le service RH (jamais les siennes) ;
//   les autres profils de l'espace RH les voient sans agir.
// - « Monétisations du CET » : demandes récentes (année en cours et précédente) avec leur état pour la paie ; le salarié
//   voit les siennes et retire une demande en attente ; le service RH annule une monétisation validée hors de tout lot.
// Le manager ne voit pas ce panneau (ses membres : jours déduits du solde seulement, server/src/vues-cet.ts).
import { fJ, fmtIso, plural } from '../../../shared/format.ts';
import { etatMonetisation, monetisationAnnulable } from '../../../shared/rules/cet-monetisation.ts';
import type { MonetisationCet } from '../../../shared/types.ts';
import { annulationMonetisationCet, refusMonetisationCet, validationMonetisationCet } from '../state/confirmations-cet.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Panel, Two } from './ui.tsx';

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
        <Panel highlight title="Monétisations du CET à décider" aside={`${plural(aDecider.length, 'demande', 'demandes')} · validées par le service RH, payées sous la rubrique CET_MON`}>
          <div className="list">
            {aDecider.map(m => (
              <div key={m.id} className="list-row">
                <div className="grow">
                  <Two main={`${nom(m)} · ${fJ(m.jours)}`} sub={`Demandée le ${fmtIso(m.demandeLe.slice(0, 10))}${m.demandeParInteresse ? '' : ` par ${m.demandePar || 'le service RH'}`}`} />
                </div>
                {rh && m.empId !== soi
                  ? <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: refusMonetisationCet(m, nom(m)) })}>Refuser</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'confirmer', c: validationMonetisationCet(m, nom(m), d.ti, clotureJour) })}>Valider</button>
                  </div>
                  : <span className="text-muted sub">{rh ? 'Décision par un autre membre du service RH' : 'Décision par le service RH'}</span>}
              </div>
            ))}
          </div>
        </Panel>
      )}
      {recentes.length > 0 && (
        <Panel title={espaceRh ? 'Monétisations du CET' : 'Mes monétisations du CET'} aside={`${d.year - 1} et ${d.year}`}>
          <div className="list">
            {recentes.map(m => {
              const parLeSalarie = !espaceRh && m.empId === me && m.statut === 'demandee';
              const parLeRh = rh && m.empId !== soi && m.statut === 'validee' && monetisationAnnulable(m);
              return (
                <div key={m.id} className="list-row">
                  <div className="grow">
                    <Two main={`${espaceRh ? `${nom(m)} · ` : ''}${fJ(m.jours)} · ${etatMonetisation(m)}`}
                      sub={`Demandée le ${fmtIso(m.demandeLe.slice(0, 10))}${m.decideLe ? ` · décidée le ${fmtIso(m.decideLe.slice(0, 10))}` : ''}${m.motif ? ` · motif : ${m.motif}` : ''}`} />
                  </div>
                  {(parLeSalarie || parLeRh) && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: annulationMonetisationCet(m, nom(m), parLeSalarie) })}>
                      {parLeSalarie ? 'Retirer' : 'Annuler'}
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
