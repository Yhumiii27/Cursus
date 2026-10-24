// Astreintes (t049, lot 7, étape 2), écran Temps : planning des astreintes (manager pour son équipe, espace RH pour tous ;
// planifier, modifier, annuler avec motif), interventions déclarées sur la feuille de la semaine (déclarer, retirer) et
// astreintes terminées en attente de la paie (AST_H, AST_PER, « à saisir dans Sage » tant que les rubriques sont
// désactivées). Règles : shared/rules/astreintes.ts et shared/rules/astreintes-paie.ts ; actions :
// server/src/actions/astreintes.ts. Le récapitulatif mensuel du salarié est au portail (AstreintesPortail.tsx).
import { useState } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { addD, parse } from '../../../shared/dates.ts';
import { cap, equipeLabel, fH, fmtIso, plural } from '../../../shared/format.ts';
import {
  astreinteActive, astreinteCommencee, debutAstreinte, finAstreinte, heuresAstreinte, heureTexte, instant, periodeAstreinteTexte,
} from '../../../shared/rules/astreintes.ts';
import { elementsAstreintes, etatPaieAstreinte, totauxAstreintes } from '../../../shared/rules/astreintes-paie.ts';
import { periodeLabel, rubriquesPaie } from '../../../shared/rules/paie.ts';
import type { Astreinte, Employe, ISODate } from '../../../shared/types.ts';
import { annulationAstreinte, retraitIntervention } from '../state/confirmations-astreintes.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { ETAT_ASTREINTE, etatAstreinte, type EtatAstreinte, maintenant, peutPlanifier, salariesPlanifiables } from './astreintes-etat.ts';
import { Btn, Empty, Fine, Panel, Seg, Tag, Two } from './ui.tsx';

type Vue = 'semaine' | 'avenir' | 'passees' | 'annulees';
const VUES: [Vue, string][] = [['semaine', 'Semaine affichée'], ['avenir', 'En cours et à venir'], ['passees', 'Terminées'], ['annulees', 'Annulées']];

/** « Mer. 14 oct. » */
const jourCourt = (j: ISODate) => cap(parse(j).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }));

/**
 * Planning des astreintes (écran Temps) : celles de la semaine affichée (par défaut, avec la navigation de la page), à
 * venir, terminées ou annulées. Manager : son équipe (et les équipes rattachées, en consultation) ; espace RH : tous les
 * salariés (la paie et la lecture seule consultent, sans les motifs) ; référent HSE et collaborateur : rien ici.
 */
export function PlanningAstreintes({ wk }: { wk: ISODate }) {
  const d = useDomain();
  const role = useRole();
  const { openDialog } = useStore();
  const [vue, setVue] = useState<Vue>('semaine');
  const voit = role.manager || role.rh || role.paie || role.consultation;
  if (!voit) return null;

  const m = maintenant(d.ti);
  const planifiables = salariesPlanifiables(d, role);
  const lundi = instant(wk, '00:00'), lundiSuivant = instant(addD(wk, 7), '00:00');
  const etats = new Map((d.ds.astreintes ?? []).map(a => [a.id, etatAstreinte(a, m)]));
  const garder = (a: Astreinte, e: EtatAstreinte) => vue === 'semaine' ? e !== 'annulee' && debutAstreinte(a) < lundiSuivant && finAstreinte(a) > lundi
    : vue === 'avenir' ? e === 'avenir' || e === 'encours' : vue === 'passees' ? e === 'terminee' : e === 'annulee';
  const liste = (d.ds.astreintes ?? []).filter(a => garder(a, etats.get(a.id)!))
    .sort((a, b) => (vue === 'passees' || vue === 'annulees' ? debutAstreinte(b) - debutAstreinte(a) : debutAstreinte(a) - debutAstreinte(b)) || a.id - b.id);
  const interventions = (id: number) => (d.ds.interventionsAstreinte ?? []).filter(x => x.astreinteId === id);
  const vide = vue === 'semaine' ? 'Aucune astreinte cette semaine.' : vue === 'avenir' ? 'Aucune astreinte en cours ou à venir.' : vue === 'passees' ? 'Aucune astreinte terminée.' : 'Aucune astreinte annulée.';

  return (
    <Panel head={
      <div className="panel-head" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2>Planning des astreintes</h2>
          <div className="text-muted sub">{plural(liste.length, 'astreinte', 'astreintes')} · délai de prévenance : {d.ds.settings.astreinteDelaiPrevenance} jours</div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Seg name="astreintes-vue" label="Astreintes affichées" value={vue} options={VUES} onChange={setVue} style={{ flexWrap: 'wrap' }} />
          {planifiables.length > 0 && <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'astreinte' })}>Planifier une astreinte</Btn>}
        </div>
      </div>
    }>
      {liste.length === 0 ? <Empty pad="sm">{vide}</Empty> : (
        <div className="scroll-x">
          {/* Nom du tableau en attribut : un texte masqué (sr-only, en position absolue) élargirait la page au téléphone. */}
          <table className="table" style={{ fontSize: 13 }} aria-label={`Astreintes : ${VUES.find(([v]) => v === vue)![1].toLowerCase()}`}>
            <thead><tr><th scope="col">Collaborateur</th><th scope="col">Période</th><th scope="col">Interventions</th><th scope="col">État</th><th scope="col" aria-label="Actions"></th></tr></thead>
            <tbody>
              {liste.map(a => {
                const e = d.emp(a.empId), etat = etats.get(a.id)!, ints = interventions(a.id);
                const planifie = !!e && peutPlanifier(d, role, e);
                const paie = role.espaceRh ? etatPaieAstreinte(a) : null;
                return (
                  <tr key={a.id}>
                    <td><Two main={e?.nom ?? '—'} sub={a.equipe ?? (e ? equipeLabel(e) : '')} nowrap /></td>
                    <td>
                      <Two main={cap(periodeAstreinteTexte(a))}
                        sub={`${fH(heuresAstreinte(a))} · communiquée le ${fmtIso(a.communiqueLe)}${a.motif ? ` · délai court : ${a.motif}` : ''}${a.annuleLe ? ` · annulée le ${fmtIso(a.annuleLe.slice(0, 10))}${a.annuleMotif ? ` : ${a.annuleMotif}` : ''}` : ''}${paie ? ` · ${paie}` : ''}`} />
                    </td>
                    <td className="nowrap">{ints.length ? `${plural(ints.length, 'intervention', 'interventions')} · ${fH(ints.reduce((n, x) => n + x.heures, 0))}` : '—'}</td>
                    <td><Tag cls={ETAT_ASTREINTE[etat].cls}>{ETAT_ASTREINTE[etat].label}</Tag></td>
                    <td className="right">
                      {planifie && (etat === 'avenir' || etat === 'encours') && (
                        <div className="actions-end">
                          <button type="button" className="btn btn-ghost btn-sm" aria-label={`Modifier l’astreinte de ${e!.nom} ${periodeAstreinteTexte(a)}`}
                            onClick={() => openDialog({ type: 'astreinte', id: a.id })}>{etat === 'encours' ? 'Avancer la fin' : 'Modifier'}</button>
                          {etat === 'avenir' && (
                            <button type="button" className="btn btn-ghost btn-sm" aria-label={`Annuler l’astreinte de ${e!.nom} ${periodeAstreinteTexte(a)}`}
                              onClick={() => openDialog({ type: 'confirmer', c: annulationAstreinte(a, e!.nom) })}>Annuler</button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Fine>
        Programmation communiquée au salarié par e-mail, avec l’événement pour son agenda. Une astreinte se modifie ou s’annule jusqu’à son début ; ensuite,
        seule sa fin s’avance. Les interventions se déclarent sur la feuille de temps du salarié ; le temps d’astreinte sans intervention compte comme repos.
      </Fine>
    </Panel>
  );
}

/**
 * Feuille de temps de la semaine : astreintes du salarié qui la couvrent et interventions déclarées (jour de leur début),
 * avec « Déclarer une intervention » et « Retirer » tant que la feuille se saisit. Rien sans astreinte ni intervention.
 */
export function InterventionsFeuille({ emp, wk, editable }: { emp: Employe; wk: ISODate; editable: boolean }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const { me } = useRole();
  const m = maintenant(d.ti);
  const lundi = instant(wk, '00:00'), lundiSuivant = instant(addD(wk, 7), '00:00'), dimanche = addD(wk, 6);
  const astreintes = (d.ds.astreintes ?? []).filter(a => a.empId === emp.id && astreinteActive(a) && debutAstreinte(a) < lundiSuivant && finAstreinte(a) > lundi)
    .sort((a, b) => debutAstreinte(a) - debutAstreinte(b));
  const ints = (d.ds.interventionsAstreinte ?? []).filter(x => x.empId === emp.id && x.jour >= wk && x.jour <= dimanche)
    .sort((a, b) => a.jour.localeCompare(b.jour) || a.debut.localeCompare(b.debut));
  if (!astreintes.length && !ints.length) return null;
  const declarable = editable && astreintes.some(a => astreinteCommencee(a, m));
  const qui = emp.id === me ? 'Vous êtes' : `${emp.nom} est`;

  return (
    <div className="boxed-lg" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-3)' }}>
      <div className="item-head">
        <div>
          <div style={{ fontSize: 14 }}>Astreinte</div>
          <div className="text-muted sub">{qui} d’astreinte {astreintes.map(a => periodeAstreinteTexte(a)).join(', ') || 'cette semaine'}</div>
        </div>
        {declarable && (
          <Btn small variant="secondary" style={{ flex: 'none' }}
            onClick={() => openDialog({ type: 'interventionAstreinte', empId: emp.id, jour: d.ti >= wk && d.ti <= dimanche ? d.ti : dimanche })}>Déclarer une intervention</Btn>
        )}
      </div>
      {ints.map(x => (
        <div key={x.id} className="list-row" style={{ alignItems: 'center' }}>
          <div className="grow" style={{ fontSize: 13 }}>
            {jourCourt(x.jour)} · de {heureTexte(x.debut)} à {heureTexte(x.fin)}{x.fin <= x.debut ? ' (le lendemain)' : ''} · <span className="tnum">{fH(x.heures)}</span>
          </div>
          {editable && <Btn small style={{ flex: 'none' }} onClick={() => openDialog({ type: 'confirmer', c: retraitIntervention(x, emp.nom) })}>Retirer</Btn>}
        </div>
      ))}
      <Fine>
        {ints.length ? 'Heures portées par la ligne « Intervention d’astreinte » de la feuille, qui ne se saisit pas à la main. ' : 'Aucune intervention déclarée cette semaine. '}
        Une intervention est du travail effectif ; 11 heures de repos consécutives sont dues après sa fin.
      </Fine>
    </div>
  );
}

/** Astreintes terminées en attente d'un lot de paie (écran Temps, components/LotsPaie.tsx) : AST_H et AST_PER, ou à saisir dans Sage. */
export function AstreintesEnAttente() {
  const d = useDomain();
  const elements = elementsAstreintes(d, '9999-12', rubriquesPaie(d.ds.rubriquesPaie), maintenant(d.ti));
  if (!elements.length) return null;
  const dansLeFichier = elements.filter(x => x.codeSage), aSaisir = elements.filter(x => !x.codeSage);
  const parSalarie = (l: typeof elements) => [...new Set(l.map(x => x.empId))]
    .map(id => { const s = l.filter(x => x.empId === id); return `${d.personName(id)} (${totauxAstreintes(s)}, ${[...new Set(s.map(x => periodeLabel(x.periode)))].join(', ')})`; }).join(' ; ');
  return (
    <Fine>
      {dansLeFichier.length > 0 && `Astreintes terminées dans le prochain lot de leur période : ${parSalarie(dansLeFichier)}. `}
      {aSaisir.length > 0 && `Astreintes terminées à saisir dans Sage (rubriques AST_H et AST_PER désactivées) : ${parSalarie(aSaisir)} ; chaque lot les liste dans son résumé.`}
    </Fine>
  );
}
