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
import { t } from '../i18n/langue.ts';

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
    rows.push([`${t('Approved cumulative total ')}${annee}`, `${fJ(k.done)} / ${fJ(k.plafond)}`]);
    if (k.rachetes) rows.push([`${t('Of which days bought back ')}${annee}${t(' (amendment)')}`, fJ(k.rachetes)]);
    if (annee === d.year) rows.push([t('Target to date'), fJ(k.prorata)]);
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
    return [`${t('cumulative total ')}${annee}${t(': ')}${fJ(k.done)} / ${fJ(k.plafond)}${k.etat === 'depasse' ? t(' (ceiling exceeded)') : k.etat === 'alerte' ? `${t(' (alert ')}${k.seuil} %)` : ''}`];
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
      <div className="text-muted sub">{t('Annual days package ')}{d.year}</div>
      {k && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 14, flexWrap: 'wrap' }}>
            <span className="tnum">{cumulTexte(k)}</span>
            <Bar pct={k.plafond ? k.done / k.plafond * 100 : 0} width={120} color={k.etat === 'ok' ? 'var(--color-accent-600)' : 'var(--color-accent-300)'} />
          </div>
          <div className="text-muted sub">
            {t('Target to date ')}{fJ(k.prorata)}{k.cible !== k.forfait ? `${t(' · package of ')}${k.forfait}${t(' days pro rata of attendance: ')}${k.cible}` : ''}{t(' · alert at ')}{k.seuil}{t(' % of the ceiling')}
            {repos ? `${t(' · rest days: ')}${fJ(repos.droit)}${t(' entitled, ')}${fJ(repos.pris)}${t(' taken, ')}${fJ(repos.poses)}${t(' booked#rest-days')}${repos.rachetes ? `, ${fJ(repos.rachetes)}${t(' bought back')}` : ''}${t(', remaining ')}${fJ(repos.reste)}` : ''}
          </div>
          {alerte && <NoteAccent>{alerte}</NoteAccent>}
        </>
      )}
      {avenants.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {avenants.map(a => (
            <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', fontSize: 13 }}>
              <span className={a.annuleLe ? 'text-muted' : undefined}>
                {t('Waiver amendment ')}{a.annee} · {fJ(a.jours)}{t(' bought back')}{a.taux ? `${t(' · increase ')}${a.taux} %` : ''}{t(' · signed on ')}{fmtIso(a.signeLe)}{a.reference ? ` · ${a.reference}` : ''}
              </span>
              {a.annuleLe && <Tag cls="tag-neutral">{t('Cancelled#masc')}</Tag>}
              {rh && <span className="text-muted sub">{etatRachat(a)}</span>}
              {rh && !a.annuleLe && e.id !== soi && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: annulationAvenantForfait(a, e.nom) })}>{t('Cancel the amendment')}</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {rh && k && e.id !== soi && d.contratOf(e).forfait && (ouvert
        ? <div><Btn small onClick={() => openDialog({ type: 'avenantForfait', empId: e.id })}>{t('Record a waiver amendment')}</Btn></div>
        : <Fine>{t('Waiver of rest days closed: it requires the collective agreement that authorises the annual days package, to reference in Settings → Annual days package.')}</Fine>)}
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
      {dansLeFichier.length > 0 && `${t('Days bought back from an annual days package (JREN) in the next batch of their period: ')}${texte(dansLeFichier)}. `}
      {aSaisir.length > 0 && `${t('Days bought back from an annual days package to enter in Sage (JREN item disabled): ')}${texte(aSaisir)}${t('; each batch lists them in its summary.')}`}
    </Fine>
  );
}
