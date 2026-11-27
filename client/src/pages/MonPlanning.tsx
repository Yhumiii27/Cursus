// « Mon planning » (lot 12, chantier C5, étape 2) : espace collaborateur, et espace manager pour un manager lui-même planifié
// (membre d'une équipe en cycle : ses postes, les échanges qu'on lui propose), le module activé (réglage `planningActif`), aussi
// dans l'application installée (lecture hors ligne par le cache de l'instantané ; aucune action de planning dans la file
// hors ligne : un échange exige un état frais). Le salarié voit ses postes publiés (la version communiquée, jamais un
// brouillon) sur quatre semaines à partir de la semaine choisie, avec la version et la date de communication ; un jour sans
// poste publié s'affiche vide. Il propose un échange sur un poste à venir en nommant un collègue de son équipe, répond aux
// échanges qu'on lui propose et retire les siens. Les postes de ses collègues (nom, horaire ; jamais une absence ni un repos)
// ne s'affichent que si le réglage `planningCollegues` l'ouvre. Notifications sur le téléphone : planning publié ou modifié,
// étapes d'un échange (préférences dans l'accueil) ; agenda : les postes publiés figurent dans le flux personnel (.ics).
// Semaines hors de la fenêtre de l'instantané : postes lus dans l'historique (client/src/planning-api.ts).
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { addD, mondayOf } from '../../../shared/dates.ts';
import { fmtIso } from '../../../shared/format.ts';
import { t } from '../i18n/langue.ts';
import { debutCreneau, ECHANGE_OUVERT, horsFenetre } from '../../../shared/rules/planning.ts';
import { Empty, Fine, Page, Panel, Tag, Two } from '../components/ui.tsx';
import { echangeTexte, joursDe, joursDuSalarie, jourCourt, jourLong, posteTexte } from '../components/planning/planning-vue.ts';
import { useAgir } from '../state/actions.ts';
import { maintenant as maintenantParis, refusEchange } from '../dialogs/PlanningDialog.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useData, useStore } from '../state/store.tsx';
import { useHistoriquePlanning } from '../planning-api.ts';

/** Semaines affichées. */
const SEMAINES = 4;

export function MonPlanning() {
  const d = useDomain();
  const { me } = useRole();
  const { ui, setUi, openDialog, run } = useStore();
  const { occupe, agir } = useAgir();
  const wk = ui.weekStart ?? mondayOf(d.ti);
  const jours = joursDe(wk, 7 * SEMAINES);
  // Semaines hors de la fenêtre de l'instantané (plus de 8 semaines passées, plus de 12 à venir) : lues dans l'historique.
  const data = useData();
  const hist = useHistoriquePlanning(horsFenetre(jours[0], jours.at(-1)!, d.ti) ? { du: jours[0], au: jours.at(-1)!, equipe: null } : null, data.user.role, data.revision);
  if (!me) return <Page title={t('My schedule')}><Empty>{t('No employee attached to your account.')}</Empty></Page>;
  const lus = hist ? hist.creneaux ?? [] : d.ds.creneaux;
  const siens = joursDuSalarie(lus, me, jours);
  // Heure réelle de Paris, comme le dialogue : un poste du jour déjà commencé ne s'échange plus.
  const maintenant = maintenantParis(d.ti);
  const echanges = (d.ds.echangesPoste ?? []).filter(e => e.demandeurId === me || e.partenaireId === me).sort((a, b) => b.creeLe.localeCompare(a.creeLe)).slice(0, 12);
  const enEchange = new Set((d.ds.echangesPoste ?? []).filter(e => ECHANGE_OUVERT.includes(e.statut)).flatMap(e => [e.creneauDemandeur, e.creneauPartenaire]));
  // Collègues de son équipe seulement (un manager planifié reçoit aussi les postes des équipes qu'il encadre).
  const monEquipe = d.emp(me)?.equipe ?? null;
  const collegues = (lus ?? []).filter(c => c.empId !== me && c.empId != null && c.equipe === monEquipe && c.statut === 'publie' && c.horaire && c.jour >= jours[0] && c.jour <= jours.at(-1)!);
  const derniere = siens.map(j => j.creneau).filter(c => c != null).sort((a, b) => (b!.publieLe ?? '').localeCompare(a!.publieLe ?? ''))[0];
  return (
    <Page title={t('My schedule')} kicker={`${t('From ')}${fmtIso(jours[0])}${t(' to ')}${fmtIso(jours.at(-1)!)}`}
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <button type="button" className="btn btn-ghost btn-icon plain" aria-label={t('Previous weeks')} title={t('Previous weeks')} onClick={() => setUi({ weekStart: addD(wk, -7 * SEMAINES) })}><CaretLeftIcon size={14} /></button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUi({ weekStart: mondayOf(d.ti) })}>{t('This week')}</button>
          <button type="button" className="btn btn-ghost btn-icon plain" aria-label={t('Next weeks')} title={t('Next weeks')} onClick={() => setUi({ weekStart: addD(wk, 7 * SEMAINES) })}><CaretRightIcon size={14} /></button>
        </div>
      }>
      <Panel title={t('My shifts')} aside={derniere ? `${t('version ')}${derniere.version ?? 1} · ${t('communicated on ')}${fmtIso(derniere.communiqueLe ?? d.ti)}` : undefined}>
        {hist?.erreur ? <Empty pad="sm">{t('History unreadable: ')}{hist.erreur}</Empty>
          : hist && !hist.creneaux ? <Empty pad="sm">{t('Reading the history…')}</Empty>
          : siens.every(j => !j.creneau) ? <Empty pad="sm">{t('No shift published over these four weeks.')}</Empty> : (
          <div className="mon-planning">
            {siens.map(j => {
              const c = j.creneau;
              const echangeable = !!c && !!c.horaire && debutCreneau(c) > maintenant && j.jour >= d.ti && !enEchange.has(c.id);
              return (
                <div key={j.jour} className={`list-row mon-planning-jour${j.jour === d.ti ? ' aujourdhui' : ''}${mondayOf(j.jour) === j.jour ? ' lundi' : ''}`}>
                  <span className="mon-planning-date tnum">{jourCourt(j.jour)}</span>
                  <span className="grow">{j.texte}{c?.horsDelai && c.motif ? <span className="text-muted sub">{t(' · short notice: ')}{c.motif}</span> : null}</span>
                  {echangeable && <button type="button" className="btn btn-ghost btn-sm" aria-label={`${t('Propose a swap of the shift of ')}${jourLong(j.jour)}`} onClick={() => openDialog({ type: 'planningEchange', creneauId: c!.id })}>{t('Swap…')}</button>}
                </div>
              );
            })}
          </div>
        )}
        <Fine>
          {t('Your schedule stays a forecast: the hours actually worked are declared on your timesheet, where the schedule of the published shift is offered to you. Your published shifts also appear in your calendar if you subscribe to the feed of Cursus (Home → Calendar).')}
        </Fine>
      </Panel>

      {echanges.length > 0 && (
        <Panel title={t('My shift swaps')} aside={t(`${echanges.filter(e => e.statut === 'propose' && e.partenaireId === me).length} to handle`)}>
          <div>
            {echanges.map(e => {
              const a = (d.ds.creneaux ?? []).find(c => c.id === e.creneauDemandeur);
              return (
                <div key={e.id} className="list-row">
                  <div className="grow"><Two main={echangeTexte(d, e, me)} sub={a ? `${jourCourt(a.jour)} · ${posteTexte(a)}${e.motifRefus ? ` · ${t('reason: ')}${e.motifRefus}` : ''}` : undefined} /></div>
                  <div className="actions-end">
                    {e.statut === 'propose' && e.partenaireId === me && <>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={occupe} onClick={agir(() => run('planning.echange.accepter', { id: e.id }))}>{t('Accept')}</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: refusEchange(e.id, d.personName(e.demandeurId)) })}>{t('Refuse')}</button>
                    </>}
                    {ECHANGE_OUVERT.includes(e.statut) && e.demandeurId === me && <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={agir(() => run('planning.echange.annuler', { id: e.id }))}>{t('Withdraw')}</button>}
                    {!ECHANGE_OUVERT.includes(e.statut) && <Tag cls="tag-outline">{e.statut === 'valide' ? t('Approved#masc') : e.statut === 'refuse' ? t('Refused#masc') : e.statut === 'expire' ? t('Expired#masc') : t('Cancelled#masc')}</Tag>}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {d.ds.settings.planningCollegues && (
        <Panel title={t('Shifts of my team')}>
          {collegues.length === 0 ? <Empty pad="sm">{t('No published shift of your colleagues over these four weeks.')}</Empty> : (
            <div>
              {[...new Set(collegues.map(c => c.jour))].sort().map(jour => (
                <div key={jour} className="list-row"><div className="grow"><Two main={jourLong(jour)} sub={collegues.filter(c => c.jour === jour).map(c => `${d.personName(c.empId!)} : ${c.horaire}`).sort().join(' · ')} /></div></div>
              ))}
            </div>
          )}
          <Fine>{t('Only the planned shifts of your colleagues are shown, to propose a swap: neither their absences nor their rest days.')}</Fine>
        </Panel>
      )}
    </Page>
  );
}
