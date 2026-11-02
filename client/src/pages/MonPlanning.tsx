// « Mon planning » (lot 12, chantier C5, étape 2) : espace collaborateur, le module activé (réglage `planningActif`), aussi
// dans l'application installée (lecture hors ligne par le cache de l'instantané ; aucune action de planning dans la file
// hors ligne : un échange exige un état frais). Le salarié voit ses postes publiés (la version communiquée, jamais un
// brouillon) sur quatre semaines à partir de la semaine choisie, avec la version et la date de communication ; un jour sans
// poste publié s'affiche vide. Il propose un échange sur un poste à venir en nommant un collègue de son équipe, répond aux
// échanges qu'on lui propose et retire les siens. Les postes de ses collègues (nom, horaire ; jamais une absence ni un repos)
// ne s'affichent que si le réglage `planningCollegues` l'ouvre. Notifications sur le téléphone : planning publié ou modifié,
// étapes d'un échange (préférences dans l'accueil) ; agenda : les postes publiés figurent dans le flux personnel (.ics).
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { addD, mondayOf } from '../../../shared/dates.ts';
import { fmtIso, plural } from '../../../shared/format.ts';
import { debutCreneau, ECHANGE_OUVERT } from '../../../shared/rules/planning.ts';
import { instantParis } from '../../../shared/rules/planning-controles.ts';
import { Empty, Fine, Page, Panel, Tag, Two } from '../components/ui.tsx';
import { echangeTexte, joursDe, joursDuSalarie, jourCourt, jourLong, posteTexte } from '../components/planning/planning-vue.ts';
import { useAgir } from '../state/actions.ts';
import { refusEchange } from '../dialogs/PlanningDialog.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Semaines affichées. */
const SEMAINES = 4;

export function MonPlanning() {
  const d = useDomain();
  const { me } = useRole();
  const { ui, setUi, openDialog, run } = useStore();
  const { occupe, agir } = useAgir();
  const wk = ui.weekStart ?? mondayOf(d.ti);
  const jours = joursDe(wk, 7 * SEMAINES);
  if (!me) return <Page title="Mon planning"><Empty>Aucun salarié rattaché à votre compte.</Empty></Page>;
  const siens = joursDuSalarie(d.ds.creneaux, me, jours);
  const maintenant = instantParis(d.ti, '00:00');
  const echanges = (d.ds.echangesPoste ?? []).filter(e => e.demandeurId === me || e.partenaireId === me).sort((a, b) => b.creeLe.localeCompare(a.creeLe)).slice(0, 12);
  const enEchange = new Set((d.ds.echangesPoste ?? []).filter(e => ECHANGE_OUVERT.includes(e.statut)).flatMap(e => [e.creneauDemandeur, e.creneauPartenaire]));
  const collegues = (d.ds.creneaux ?? []).filter(c => c.empId !== me && c.empId != null && c.statut === 'publie' && c.horaire && c.jour >= jours[0] && c.jour <= jours.at(-1)!);
  const derniere = siens.map(j => j.creneau).filter(c => c != null).sort((a, b) => (b!.publieLe ?? '').localeCompare(a!.publieLe ?? ''))[0];
  return (
    <Page title="Mon planning" kicker={`Du ${fmtIso(jours[0])} au ${fmtIso(jours.at(-1)!)}`}
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <button type="button" className="btn btn-ghost btn-icon plain" aria-label="Semaines précédentes" title="Semaines précédentes" onClick={() => setUi({ weekStart: addD(wk, -7 * SEMAINES) })}><CaretLeftIcon size={14} /></button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUi({ weekStart: mondayOf(d.ti) })}>Cette semaine</button>
          <button type="button" className="btn btn-ghost btn-icon plain" aria-label="Semaines suivantes" title="Semaines suivantes" onClick={() => setUi({ weekStart: addD(wk, 7 * SEMAINES) })}><CaretRightIcon size={14} /></button>
        </div>
      }>
      <Panel title="Mes postes" aside={derniere ? `version ${derniere.version ?? 1} · communiquée le ${fmtIso(derniere.communiqueLe ?? d.ti)}` : undefined}>
        {siens.every(j => !j.creneau) ? <Empty pad="sm">Aucun poste publié sur ces quatre semaines.</Empty> : (
          <div className="mon-planning">
            {siens.map(j => {
              const c = j.creneau;
              const echangeable = !!c && !!c.horaire && debutCreneau(c) > maintenant && j.jour >= d.ti && !enEchange.has(c.id);
              return (
                <div key={j.jour} className={`list-row mon-planning-jour${j.jour === d.ti ? ' aujourdhui' : ''}${mondayOf(j.jour) === j.jour ? ' lundi' : ''}`}>
                  <span className="mon-planning-date tnum">{jourCourt(j.jour)}</span>
                  <span className="grow">{j.texte}{c?.horsDelai && c.motif ? <span className="text-muted sub"> · délai court : {c.motif}</span> : null}</span>
                  {echangeable && <button type="button" className="btn btn-ghost btn-sm" aria-label={`Proposer un échange du poste du ${jourLong(j.jour)}`} onClick={() => openDialog({ type: 'planningEchange', creneauId: c!.id })}>Échanger…</button>}
                </div>
              );
            })}
          </div>
        )}
        <Fine>
          Votre planning reste une prévision : les heures réellement faites se déclarent sur votre feuille de temps, où l’horaire du poste publié vous est proposé.
          Vos postes publiés figurent aussi dans votre agenda si vous êtes abonné au flux de Cursus (Accueil → Agenda).
        </Fine>
      </Panel>

      {echanges.length > 0 && (
        <Panel title="Mes échanges de poste" aside={plural(echanges.filter(e => e.statut === 'propose' && e.partenaireId === me).length, 'à traiter', 'à traiter')}>
          <div>
            {echanges.map(e => {
              const a = (d.ds.creneaux ?? []).find(c => c.id === e.creneauDemandeur);
              return (
                <div key={e.id} className="list-row">
                  <div className="grow"><Two main={echangeTexte(d, e, me)} sub={a ? `${jourCourt(a.jour)} · ${posteTexte(a)}${e.motifRefus ? ` · motif : ${e.motifRefus}` : ''}` : undefined} /></div>
                  <div className="actions-end">
                    {e.statut === 'propose' && e.partenaireId === me && <>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={occupe} onClick={agir(() => run('planning.echange.accepter', { id: e.id }))}>Accepter</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: refusEchange(e.id, d.personName(e.demandeurId)) })}>Refuser</button>
                    </>}
                    {ECHANGE_OUVERT.includes(e.statut) && e.demandeurId === me && <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={agir(() => run('planning.echange.annuler', { id: e.id }))}>Retirer</button>}
                    {!ECHANGE_OUVERT.includes(e.statut) && <Tag cls="tag-outline">{e.statut === 'valide' ? 'Validé' : e.statut === 'refuse' ? 'Refusé' : e.statut === 'expire' ? 'Expiré' : 'Annulé'}</Tag>}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {d.ds.settings.planningCollegues && (
        <Panel title="Postes de mon équipe">
          {collegues.length === 0 ? <Empty pad="sm">Aucun poste publié de vos collègues sur ces quatre semaines.</Empty> : (
            <div>
              {[...new Set(collegues.map(c => c.jour))].sort().map(jour => (
                <div key={jour} className="list-row"><div className="grow"><Two main={jourLong(jour)} sub={collegues.filter(c => c.jour === jour).map(c => `${d.personName(c.empId!)} : ${c.horaire}`).sort().join(' · ')} /></div></div>
              ))}
            </div>
          )}
          <Fine>Seuls les postes planifiés de vos collègues sont montrés, pour proposer un échange : ni leurs absences, ni leurs repos.</Fine>
        </Panel>
      )}
    </Page>
  );
}
