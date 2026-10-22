// Forfait jours (t043, shared/rules/forfait-jours.ts) : cumul annuel des jours travaillés comparé au forfait, alertes,
// jours de repos restants et avenants de renonciation. Ligne de la fiche collaborateur (service RH, paie, lecture seule,
// manager de l'équipe) et lignes du récapitulatif de la feuille de temps et de la file de validation (pages/Temps.tsx).
// L'avenant s'enregistre seulement quand l'accord collectif est référencé (Paramètres → Forfait jours) ; dialogue :
// dialogs/AvenantForfaitDialog.tsx ; annulation avec motif : state/confirmations-forfait.ts.
import { addD } from '../../../shared/dates.ts';
import { fJ, fmtIso } from '../../../shared/format.ts';
import type { Domain } from '../../../shared/domain.ts';
import { alerteForfait, cumulForfaitJours, cumulTexte, elementsRachats, etatRachat, rachatOuvert, reposForfaitInfo } from '../../../shared/rules/forfait-jours.ts';
import { periodeLabel, rubriquesPaie } from '../../../shared/rules/paie.ts';
import type { Employe, ISODate } from '../../../shared/types.ts';
import { annulationAvenantForfait } from '../state/confirmations-forfait.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Bar, Btn, Fine, NoteAccent, Tag } from './ui.tsx';

/** Années d'une semaine (deux pour une semaine à cheval sur le 31 décembre). */
const anneesDe = (week: ISODate) => [...new Set([Number(week.slice(0, 4)), Number(addD(week, 6).slice(0, 4))])];

/**
 * Lignes du récapitulatif paie d'une feuille de forfait jours : cumul validé de chaque année de la semaine, cible à date
 * (année en cours), alerte du cumul (seuil ou plafond).
 */
export function recapForfait(d: Domain, emp: Employe, week: ISODate): { rows: [string, string][]; alertes: string[] } {
  const rows: [string, string][] = [], alertes: string[] = [];
  for (const annee of anneesDe(week)) {
    const k = cumulForfaitJours(d, emp, annee);
    if (!k) continue;
    rows.push([`Cumul validé ${annee}`, `${fJ(k.done)} / ${fJ(k.plafond)}`]);
    if (k.rachetes) rows.push([`Dont jours rachetés ${annee} (avenant)`, fJ(k.rachetes)]);
    if (annee === d.year) rows.push(['Cible à date', fJ(k.prorata)]);
    const a = alerteForfait(k);
    if (a) alertes.push(a);
  }
  return { rows, alertes };
}

/** Sous-titre de la file de validation : « cumul 2026 : 180 j / 218 j » et l'état du cumul. */
export function fileForfait(d: Domain, emp: Employe, week: ISODate): string {
  return anneesDe(week).flatMap(annee => {
    const k = cumulForfaitJours(d, emp, annee);
    if (!k) return [];
    return [`cumul ${annee} : ${fJ(k.done)} / ${fJ(k.plafond)}${k.etat === 'depasse' ? ' (plafond dépassé)' : k.etat === 'alerte' ? ` (alerte ${k.seuil} %)` : ''}`];
  }).join(' · ');
}

/** Ligne de la fiche collaborateur : cumul de l'année, jours de repos restants, avenants de renonciation. */
export function ForfaitJoursFiche({ e }: { e: Employe }) {
  const d = useDomain();
  const { rh, paie, consultation, manager, soi } = useRole();
  const { openDialog } = useStore();
  // Référent HSE : il ne reçoit ni les feuilles ni les avenants, le cumul serait faux (et le régime n'est pas de son ressort).
  if (!(rh || paie || consultation || manager)) return null;
  const k = cumulForfaitJours(d, e, d.year);
  const avenants = (d.ds.avenantsForfait ?? []).filter(a => a.empId === e.id).sort((a, b) => b.annee - a.annee || b.id - a.id);
  if (!k && !avenants.length) return null;
  const repos = k ? reposForfaitInfo(d, e, k) : null;
  const alerte = k ? alerteForfait(k) : '';
  const ouvert = rachatOuvert(d.ds.settings);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div className="text-muted sub">Forfait jours {d.year}</div>
      {k && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 14, flexWrap: 'wrap' }}>
            <span className="tnum">{cumulTexte(k)}</span>
            <Bar pct={k.plafond ? k.done / k.plafond * 100 : 0} width={120} color={k.etat === 'ok' ? 'var(--color-accent-600)' : 'var(--color-accent-300)'} />
          </div>
          <div className="text-muted sub">
            Cible à date {fJ(k.prorata)}{k.cible !== k.forfait ? ` · forfait de ${k.forfait} jours au prorata de la présence : ${k.cible}` : ''} · alerte à {k.seuil} % du plafond
            {repos ? ` · jours de repos : ${fJ(repos.droit)} de droit, ${fJ(repos.pris)} pris, ${fJ(repos.poses)} posés${repos.rachetes ? `, ${fJ(repos.rachetes)} rachetés` : ''}, reste ${fJ(repos.reste)}` : ''}
          </div>
          {alerte && <NoteAccent>{alerte}</NoteAccent>}
        </>
      )}
      {avenants.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {avenants.map(a => (
            <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', fontSize: 13 }}>
              <span className={a.annuleLe ? 'text-muted' : undefined}>
                Avenant de renonciation {a.annee} · {fJ(a.jours)} rachetés{a.taux ? ` · majoration ${a.taux} %` : ''} · signé le {fmtIso(a.signeLe)}{a.reference ? ` · ${a.reference}` : ''}
              </span>
              {a.annuleLe && <Tag cls="tag-neutral">Annulé</Tag>}
              {rh && <span className="text-muted sub">{etatRachat(a)}</span>}
              {rh && !a.annuleLe && e.id !== soi && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: annulationAvenantForfait(a, e.nom) })}>Annuler l’avenant</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {rh && k && e.id !== soi && d.contratOf(e).forfait && (ouvert
        ? <div><Btn small onClick={() => openDialog({ type: 'avenantForfait', empId: e.id })}>Enregistrer un avenant de renonciation</Btn></div>
        : <Fine>Renonciation à des jours de repos fermée : elle suppose l’accord collectif qui autorise le forfait jours, à référencer dans Paramètres → Forfait jours.</Fine>)}
    </div>
  );
}

/** Jours rachetés en attente d'un lot de paie (écran Temps, components/LotsPaie.tsx) : JREN active, ou à saisir dans Sage. */
export function RachatsEnAttente() {
  const d = useDomain();
  const table = rubriquesPaie(d.ds.rubriquesPaie);
  const rachats = elementsRachats(d, '9999-12', table);
  const dansLeFichier = rachats.filter(x => x.codeSage), aSaisir = rachats.filter(x => !x.codeSage);
  const texte = (l: { empId: number; quantite: number; periode: string }[]) => l.map(x => `${d.personName(x.empId)} (${fJ(x.quantite)}, ${periodeLabel(x.periode)})`).join(', ');
  if (!dansLeFichier.length && !aSaisir.length) return null;
  return (
    <Fine>
      {dansLeFichier.length > 0 && `Jours rachetés d’un forfait jours (JREN) dans le prochain lot de leur période : ${texte(dansLeFichier)}. `}
      {aSaisir.length > 0 && `Jours rachetés d’un forfait jours à saisir dans Sage (rubrique JREN désactivée) : ${texte(aSaisir)} ; chaque lot les liste dans son résumé.`}
    </Fine>
  );
}
