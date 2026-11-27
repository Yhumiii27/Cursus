// Feuilles de temps : saisie hebdomadaire par projet, validation par le manager,
// récapitulatif paie selon l'organisation du temps et le mode des heures supplémentaires (payées ou en repos), transmission
// des variables à Sage Paie (components/LotsPaie.tsx).
// Une feuille soumise ou validée est décomptée avec le régime figé à la soumission (`FeuilleTemps.contrat`).
// Aucune heure un jour d'absence (validée, ou signalée en attendant sa qualification) ni hors contrat : une cellule
// déjà remplie ce jour-là reste modifiable pour être vidée. Une semaine entièrement couverte par une absence se soumet sans heure
// et ne se valide que si elle l'est encore (une absence annulée ou raccourcie renvoie la feuille).
// Une demande d'absence en attente sur des jours qui portent des heures est décidée avant la validation de la feuille.
// Une journée compte 24 h au plus (toutes lignes cumulées) ; au-delà des durées maximales (10 h par jour, 48 h par
// semaine), la soumission exige un motif, que le valideur lit (ou donne, s'il a lui-même corrigé la feuille).
// Semaine à 7 jours (shared/rules/semaine.ts) : samedi et dimanche grisés et repliés tant qu'ils sont vides, saisissables
// pour un chantier, un déplacement ou un impératif ; repos hebdomadaire et dominical signalés en alerte, sans blocage,
// et repris pour le service RH après validation (components/ReposAVerifier.tsx).
// Jours fériés (shared/rules/majorations.ts) : saisissables si le réglage le permet, mention « Férié travaillé » et
// majoration (1er mai : 100 %) au récapitulatif. Moyenne sur 12 semaines, temps partiel à requalifier et contingent annuel
// (shared/rules/durees.ts) : alertes sur la feuille et, pour le service RH, dans un encart (components/AlertesDurees.tsx).
// Réouverture d'une feuille validée (t131) : administrateur RH, motif obligatoire (dialogs/RouvrirFeuilleDialog.tsx) ;
// déjà transmise, seul son écart part à la revalidation (lot correctif, shared/rules/regularisation.ts).
// Horaire de poste du jour (lot 6, components/HorairesFeuille.tsx) : une ligne au-dessus des projets, proposée d'après
// l'équipe, figée à la soumission ; journée de solidarité travaillée (shared/rules/feries.ts) signalée sur son jour.
// Forfait jours (t043, components/ForfaitJours.tsx) : cumul annuel au récapitulatif et dans la file de validation, alerte au
// seuil ; au-delà du plafond (forfait, plus les jours rachetés par avenant), motif du valideur exigé à la validation.
import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { ABS_ABREGE, ACTIVITE_ASTREINTE, TEMPS_TRAVAIL, TS_CLS, TS_LABEL } from '../../../shared/constants.ts';
import type { Domain } from '../../../shared/domain.ts';
import { addD, estJourneeSolidarite, isoWeek, isoWeekYear, joursSemaine, mondayOf, parse } from '../../../shared/dates.ts';
import { DIMANCHE, estWeekEnd, SAMEDI } from '../../../shared/rules/semaine.ts';
import { cap, equipeLabel, fH, fJ, fmt, fmtShort, key, num } from '../../../shared/format.ts';
import { jourHorsContrat, semaineHorsContrat } from '../../../shared/rules/absences.ts';
import { DEMI_LABEL } from '../../../shared/rules/demi-journees.ts';
import {
  absenceCeJour, calcSheet, corDeLaFeuille, cumulAnnuel, demandesAbsence, demiJoursAbsence, demiJourneeTexte, demandesEnAttenteMessage, employeDeLaFeuille, heuresSurAbsence,
  heuresSurAbsenceMessage, heuresSurDemandes, joursAbsence,
  joursAbsenceTexte, natureAbsence, semaineCouverte, tachesDeLaSemaine, type SheetCalc,
} from '../../../shared/rules/temps.ts';
import { formationsAProposer } from '../../../shared/rules/formations-temps.ts';
import { MODES_HEURES_SUP } from '../../../shared/rules/paie.ts';
import { aRegulariser, mentionReouverture } from '../../../shared/rules/regularisation.ts';
import { feriesDeLaSemaine, MAJORATION_1ER_MAI, mentionFerie, plafondComplementaires } from '../../../shared/rules/majorations.ts';
import { contingentsDeLaSemaine, contingentTexte, moyenne12Semaines, moyenneTexte, requalificationPartiel, requalificationTexte } from '../../../shared/rules/durees.ts';
import type { Employe, FeuilleTemps, ISODate } from '../../../shared/types.ts';
import { ChoixCollaborateur } from '../components/ChoixCollaborateur.tsx';
import { CloseButton, Fine, Page, Panel, Seg, stop, Tag, Two } from '../components/ui.tsx';
import { Ouvrir } from '../components/Cliquable.tsx';
import { LotsPaie } from '../components/LotsPaie.tsx';
import { SuiviFeuilles } from '../components/SuiviFeuilles.tsx';
import { jourLong, nomChamp } from '../components/heures.ts';
import { useAgir } from '../state/actions.ts';
import { suppressionLigne } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { AlerteAutorisation } from '../components/ContratFiche.tsx';
import { MINEUR_JOUR_MAX } from '../../../shared/rules/mineurs.ts';
import { RelevesPanel } from './Releves.tsx';
import { ChampHeures, SaisieJour, useVueJour } from './SaisieJour.tsx';
import { CompteurDelegation } from '../components/Delegation.tsx';
import { useLectureSeule } from '../components/Hierarchie.tsx';
import { ReposAVerifier } from '../components/ReposAVerifier.tsx';
import { AlertesDurees } from '../components/AlertesDurees.tsx';
import { CopierLien } from '../components/CopierLien.tsx';
import { LegendeHoraires, LigneHoraires, useHorairesFeuille } from '../components/HorairesFeuille.tsx';
import { fileForfait, recapForfait } from '../components/ForfaitJours.tsx';
import { controleValidationForfait } from '../../../shared/rules/forfait-jours.ts';
import { decideur } from '../state/delegues.ts';
import { InterventionsFeuille, PlanningAstreintes } from '../components/Astreintes.tsx';
import { ligneAstreinte } from '../components/astreintes-etat.ts';
// lot 12 — socle : onglets de l'écran (le contenu de chaque onglet de chantier est dans un composant à lui).
import type { OngletTemps } from './temps-onglets.ts';
// lot 12 — C1 (forfait annuel en heures)
import { RecapForfaitHeures, useDroitsForfaitHeures } from '../components/temps/RecapForfaitHeures.tsx';
import { ongletForfaitHeures } from '../components/temps/forfait-heures-vue.ts';
// lot 12 — C5 (planning d'équipe)
import { PlanningEquipe } from '../components/planning/PlanningEquipe.tsx';
// lot 12 — C6 (badgeage virtuel)
import { PointagesSemaine } from '../components/temps/Pointages.tsx';
import { estLignePointee } from '../../../shared/rules/pointage-feuille.ts';
import { t, tn } from '../i18n/langue.ts';

/** Année d'une feuille : celle de sa semaine ISO (son jeudi) ; le cumul annuel ventile une semaine à cheval jour par jour. */
const anneeDe = (week: ISODate) => isoWeekYear(week);

/**
 * Colonne « Total » de la file de validation, selon l'organisation du temps de la feuille.
 * `aRenvoyer` : feuille sans heure dont la semaine n'est plus couverte par une absence, que le serveur ne valide pas.
 * `motifManquant` : durées maximales dépassées sans motif (feuille corrigée par le valideur) ; il se donne en ouvrant la feuille.
 */
function queueTotal(d: Domain, e: Employe, sh: FeuilleTemps): { main: string; sub: string; aRenvoyer?: boolean; motifManquant?: boolean } {
  const tot = totalFile(d, e, sh), c = calcSheet(d, e, sh);
  // Repos hebdomadaire ou dominical : signalé au valideur, sans empêcher la validation.
  const repos = c.repos.length ? { ...tot, sub: `${tot.sub}${t(' · weekly rest to check')}` } : tot;
  if (c.depassements.length && !sh.motifDepassement) return { ...repos, sub: `${repos.sub}${t(' · reason for the excess to give')}`, motifManquant: true };
  // Forfait jours au-delà du plafond de l'année : le motif se donne en ouvrant la feuille.
  return controleValidationForfait(d, e, sh).depassements.length ? { ...repos, sub: `${repos.sub}${t(' · reason for the package excess to give')}`, motifManquant: true } : repos;
}
function totalFile(d: Domain, e: Employe, sh: FeuilleTemps): { main: string; sub: string; aRenvoyer?: boolean } {
  const c = calcSheet(d, e, sh), k = c.c;
  if (k.forfait) {
    const cumul = fileForfait(d, employeDeLaFeuille(e, sh), sh.week);
    return { main: fJ(c.jours), sub: `${t('annual days package · ')}${fH(c.total)}${t(' declared#hours')}${cumul ? ` · ${cumul}` : ''}` };
  }
  if (k.dirigeant) return { main: fJ(c.jours), sub: `${t('senior executive · ')}${fH(c.total)}${t(' declared#hours')}` };
  if (k.annuel) {
    const cum = cumulAnnuel(d, employeDeLaFeuille(e, sh), anneeDe(sh.week));
    return { main: fH(c.total), sub: `${t('annual package · approved cumulative total ')}${cum.annee} ${fH(cum.done)} / ${fH(cum.cible)}` };
  }
  // Seules les heures majorées dépassent le contrat ; les heures incluses au forfait hebdomadaire n'en font pas partie.
  const extra = c.sup25 + c.sup50 + c.hc10 + c.hc25;
  // Sans heure : la semaine doit encore être couverte par une absence (elle a pu être annulée ou raccourcie depuis).
  if (!c.total) return semaineCouverte(d, e, sh.week, sh)
    ? { main: fH(0), sub: t('week of absence, without hours') }
    : { main: fH(0), sub: t('no hours: week no longer covered by an absence, to send back'), aRenvoyer: true };
  return { main: fH(c.total), sub: extra > 0 ? `${t('of which ')}${fH(extra)}${t(' beyond the contract')}` : t('no hours beyond the contract') };
}

interface Recap { rows: [string, string][]; mention?: string; alert?: string; aide: string }

/**
 * Récapitulatif paie de la semaine et texte explicatif, selon l'organisation du temps de la feuille.
 * `emp` est le collaborateur tel qu'il était la semaine de la feuille (`employeDeLaFeuille`) ; `sh` : la feuille
 * (contrepartie obligatoire en repos figée à sa validation).
 */
function recapOf(d: Domain, emp: Employe, calc: SheetCalc, week: ISODate, sh: FeuilleTemps | null): Recap {
  const c = calc.c, tt = TEMPS_TRAVAIL[c.temps];
  const art = tt.article ? ` ${tt.article}.` : '';
  // Heures supplémentaires payées, ou remplacées par un repos (mode figé sur la feuille à sa validation) : la ligne du
  // repos acquis n'apparaît que s'il y en a un ; l'intérimaire est réglé par son agence.
  const recupRows: [string, string][] = c.interim ? [[t('Time off in lieu'), t('managed by the agency')]]
    : calc.modeHS === 'paiement' ? [] : [[t('Compensatory rest acquired'), fH(calc.recup)]];
  const recupAide = c.interim
    ? t(' Temporary work: overtime recorded and paid by the agency.')
    : ` ${MODES_HEURES_SUP[calc.modeHS].aide}`;
  // Lignes ajoutées au décompte : heures du dimanche (comprises dans les autres) : rubrique HDIM, et majoration si le
  // réglage en prévoit une.
  const annexes: [string, string][] = !calc.dimanche || c.forfait ? []
    : [[t('Of which Sunday hours'), fH(calc.dimanche)], ...(calc.majDimanche ? [[`${t('Sunday premium (')}${calc.majDimanche} %)`, fH(calc.dimanche * calc.majDimanche / 100)] as [string, string]] : [])];
  // Jours fériés travaillés (comprises dans les autres) : 1er mai majoré de 100 % (MAJ_1MAI), autres fériés en quantité
  // (FERIE_TRAV) et leur majoration réglée (MAJ_FERIE). Contrepartie obligatoire en repos figée à la validation (COR_ACQUIS).
  const cor = corDeLaFeuille(sh);
  if (!c.forfait) {
    if (calc.mai1) annexes.push([t('Of which 1 May hours'), fH(calc.mai1)], [`${t('1 May premium (')}${MAJORATION_1ER_MAI} %)`, fH(calc.mai1 * MAJORATION_1ER_MAI / 100)]);
    if (calc.ferie) annexes.push([t('Of which hours on a public holiday'), fH(calc.ferie)], ...(calc.majFerie ? [[`${t('Public holiday premium (')}${calc.majFerie} %)`, fH(calc.ferie * calc.majFerie / 100)] as [string, string]] : []));
    if (cor) annexes.push([t('Mandatory rest compensation'), fH(cor)]);
    // Heures de nuit d'après les horaires de poste (shared/rules/repos-nuit.ts) : HNUIT, et MAJ_NUIT au taux réglé.
    if (calc.nuit) annexes.push([t('Of which night hours'), fH(calc.nuit)], ...(calc.majNuit ? [[`${t('Night premium (')}${calc.majNuit} %)`, fH(calc.nuit * calc.majNuit / 100)] as [string, string]] : []));
  }
  // Contingent annuel d'heures supplémentaires de chaque année de la semaine (deux pour une semaine à cheval sur le
  // 31 décembre ; feuilles validées).
  if (!(c.forfait || c.dirigeant || c.annuel || c.partiel || c.interim)) {
    for (const k of contingentsDeLaSemaine(d, emp, week)) annexes.push([`${t('Quota ')}${k.annee}${t(' (approved overtime)')}`, `${fH(k.cumul)} / ${fH(k.max)}`]);
  }

  if (c.forfait) {
    // Cumul validé de l'année (deux pour une semaine à cheval), plafond avec les jours rachetés, alerte au seuil.
    const f = recapForfait(d, emp, week);
    return {
      rows: [[t('Days worked'), fJ(calc.jours)], [t('Hours declared (project split)'), fH(calc.total)], ...f.rows],
      alert: f.alertes.join(' · ') || undefined,
      aide: tt.aide + art,
    };
  }
  if (c.dirigeant) return {
    rows: [[t('Days present'), fJ(calc.jours)], [t('Hours declared (project split)'), fH(calc.total)]],
    mention: t('Not subject to working time rules, art. L3111-2'),
    aide: tt.aide,
  };
  if (c.annuel) {
    // Cumul de l'année de la feuille ; cible proratisée selon la présence (entrée, fin de contrat).
    const cum = cumulAnnuel(d, emp, anneeDe(week));
    const rows: [string, string][] = [
      [t('Hours of the week'), fH(calc.total)],
      ...annexes,
      [`${t('Approved annual cumulative total ')}${cum.annee}`, `${fH(cum.done)} / ${fH(cum.cible)}`],
    ];
    if (cum.cible !== c.heuresAnnuelles) rows.push([`${t('Package ')}${cum.annee}${t(' pro rata of attendance')}`, `${fH(cum.cible)}${t(' of ')}${fH(c.heuresAnnuelles)}`]);
    if (cum.annee === d.year) rows.push([t('Target to date'), fH(cum.prorata)]);
    return {
      rows,
      alert: cum.depasse ? `${t('Annual package ')}${cum.annee}${t(' exceeded by ')}${fH(cum.done - cum.cible)}${t(': hours to regularise at the end of the year')}` : undefined,
      aide: tt.aide + art,
    };
  }
  if (c.partiel) {
    // Plafond réglé : le dixième, ou le tiers avec la référence d'un accord (Paramètres → Décompte des heures).
    const p = plafondComplementaires(d.ds.settings);
    return {
      rows: [[t('Contractual hours'), fH(Math.min(calc.total, c.base))], [t('Additional +10 %'), fH(calc.hc10)], [t('Additional +25 %'), fH(calc.hc25)], ...annexes],
      aide: `${tt.aide}${t(' Ceiling in force: the ')}${p.label}${t(' of the contractual duration, i.e. ')}${fH(c.base / p.diviseur)}${t(' this week (')}${p.article}).${art}`,
    };
  }
  if (c.hebdo) {
    // Heures incluses au forfait : +25 % jusqu'à la 43e heure, +50 % au-delà (forfait supérieur à 43 h).
    const rows: [string, string][] = [[t('Normal hours (up to 35 h)'), fH(calc.normal)], [t('Included in the package +25 %'), fH(calc.incluses25)]];
    if ((c.seuil ?? 0) > 43 || calc.incluses50 > 0) rows.push([t('Included in the package +50 %'), fH(calc.incluses50)]);
    rows.push([t('Overtime +25 %'), fH(calc.sup25)], [t('Overtime +50 %'), fH(calc.sup50)], ...recupRows, ...annexes);
    return { rows, aide: tt.aide + recupAide + art };
  }
  return {
    rows: [[t('Normal hours'), fH(calc.normal)], [t('Overtime +25 %'), fH(calc.sup25)], [t('Overtime +50 %'), fH(calc.sup50)], ...recupRows, ...annexes],
    aide: tt.aide + recupAide + art,
  };
}

export function Temps() {
  const d = useDomain();
  const data = d.ds;
  // Espace RH : toutes les feuilles ; validation par le service RH (jamais sa propre feuille), transmission à Sage par
  // l'administrateur RH et le gestionnaire de paie (components/LotsPaie.tsx) ; la paie et la lecture seule consultent.
  const { espaceRh, rh, manager, collab, me, soi } = useRole();
  const { ui, setUi, run } = useStore();
  const { occupe, agir } = useAgir();
  const wk = ui.weekStart ?? mondayOf(data.today);
  const wdays = joursSemaine(wk);

  const inScope = (id: number | null): id is number => id != null && data.employes.some(e => e.id === id);
  const tsId = collab ? me : manager ? (inScope(ui.tsEmp) ? ui.tsEmp : me) : (inScope(ui.tsEmp) ? ui.tsEmp : data.employes[0]?.id ?? null);
  const tsEmp = tsId != null ? d.emp(tsId) : undefined;
  const options = [...data.employes].sort((a, b) => a.nom.localeCompare(b.nom));
  // Consultation N+2 (t136) : feuilles des équipes rattachées consultées, jamais saisies ni validées.
  const lecture = useLectureSeule();

  const queue = data.feuilles
    .filter(sh => sh.statut === 'soumise')
    .map(sh => ({ sh, e: d.emp(sh.empId) }))
    .filter((q): q is { sh: FeuilleTemps; e: Employe } => !!q.e && (espaceRh || (manager && decideur(d, q.e, me, 'feuilles'))));
  const valide = (e: Employe) => (rh && e.id !== soi) || (manager && decideur(d, e, me, 'feuilles'));

  // Onglets de l'écran (lot 12, socle ; pages/temps-onglets.ts) : chaque chantier n'ajoute que son onglet (libellé, et
  // contenu dans un composant à lui), dans son bloc. La barre n'est montrée qu'à partir de deux onglets ; un onglet
  // absent pour cet espace (adresse d'un autre) ramène aux feuilles de temps.
  const onglets: [OngletTemps, string][] = [['feuilles', t('Timesheets')]];
  const contenus: Partial<Record<OngletTemps, ReactNode>> = {};
  // lot 12 — C1 (forfait annuel en heures) : bandeau de clôture, suivi de la période, lignes enregistrées (onglet affiché
  // seulement s'il a quelque chose à montrer ; jamais au référent HSE).
  const droitsForfait = useDroitsForfaitHeures();
  const libelleForfait = useMemo(() => ongletForfaitHeures(d, droitsForfait), [d, droitsForfait]);
  if (libelleForfait) { onglets.push(['forfait-heures', libelleForfait]); contenus['forfait-heures'] = <RecapForfaitHeures />; }
  // lot 12 — C5 (planning d'équipe) : module activé ; service RH, paie et lecture seule, manager (ses équipes).
  if (data.settings.planningActif && !collab) { onglets.push(['planning', t('Team schedule')]); contenus.planning = <PlanningEquipe />; }
  // lot 12 — C6 (badgeage virtuel) : semaine de pointages du salarié affiché, le module activé (pas pour les profils
  // restreints, qui lisent la feuille).
  if (data.settings.pointageActif && (rh || manager || collab)) {
    onglets.push(['pointages', t('Clock-ins')]);
    contenus.pointages = tsEmp ? <PointagesSemaine key={`${tsEmp.id}|${wk}`} emp={tsEmp} wk={wk} /> : null;
  }
  const onglet: OngletTemps = onglets.some(([o]) => o === ui.tempsOnglet) ? ui.tempsOnglet : 'feuilles';

  return (
    <Page
      kicker={`${t('Week ')}${isoWeek(wk)} · ${fmtShort(parse(wdays[0]))} → ${fmt(parse(wdays[DIMANCHE]))}`}
      title={t('Working time')}
      actions={<>
        {/* Choix du salarié par suggestions (t152) : nom, poste, équipe ou matricule. */}
        {!collab && (
          <ChoixCollaborateur id="temps-salarie" label={t('Employee')} emps={options} valeur={tsId} style={{ minWidth: 240 }}
            onChange={id => { if (id != null) setUi({ tsEmp: id }); }} suffixe={e => lecture.has(e.id) ? t(' (read only)') : ''} />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <button type="button" className="btn btn-ghost btn-icon plain" aria-label={t('Previous week')} title={t('Previous week')} onClick={() => setUi({ weekStart: addD(wk, -7) })}><CaretLeftIcon size={14} /></button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUi({ weekStart: mondayOf(data.today) })}>{t('This week')}</button>
          <button type="button" className="btn btn-ghost btn-icon plain" aria-label={t('Next week')} title={t('Next week')} onClick={() => setUi({ weekStart: addD(wk, 7) })}><CaretRightIcon size={14} /></button>
        </div>
        {/* Lien de la feuille affichée : salarié (sauf l'espace collaborateur, toujours sa propre feuille) et semaine. */}
        <CopierLien chemin={`/temps?${collab || tsId == null ? '' : `salarie=${tsId}&`}semaine=${wk}`} />
      </>}
    >
      {onglets.length > 1 && (
        <Seg name="tempsOnglet" label={t('Working time tab')} value={onglet} onChange={v => setUi({ tempsOnglet: v })} style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}
          options={onglets} />
      )}
      {onglet !== 'feuilles' ? contenus[onglet] : <>
      {!collab && queue.length > 0 && (
        <Panel highlight title={t('Timesheets to approve')} aside={tn(queue.length, 'timesheet to approve', 'timesheets to approve')}>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Employee')}</th><th>{t('Week')}</th><th>{t('Total')}</th><th></th></tr></thead>
              <tbody>
                {queue.map(({ sh, e }) => {
                  const tot = queueTotal(d, e, sh);
                  const open = () => setUi({ tsEmp: e.id, weekStart: sh.week });
                  return (
                    <tr key={sh.id} className="clickable" onClick={open}>
                      <td><Two main={<Ouvrir onOpen={open}>{e.nom}</Ouvrir>} sub={equipeLabel(e)} nowrap /></td>
                      <td className="nowrap">{t('W#week-short')}{isoWeek(sh.week)} · {fmtShort(parse(sh.week))}</td>
                      <td>
                        <div className="tnum">{tot.main}</div>
                        <div className="text-muted sub">{tot.sub}</div>
                      </td>
                      <td className="right">
                        <div className="actions-end">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={stop(open)}>{t('Open')}</button>
                          {!tot.aRenvoyer && !tot.motifManquant && valide(e) && <button type="button" className="btn btn-secondary btn-sm" disabled={occupe} onClick={agir(() => run('temps.validate', { empId: e.id, week: sh.week }))}>{t('Approve')}</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {!collab && <SuiviFeuilles />}

      {espaceRh && <ReposAVerifier />}

      {espaceRh && <AlertesDurees />}

      {tsEmp && lecture.has(tsEmp.id) && <Fine>{t('Read-only consultation (attached team): the timesheet of ')}{tsEmp.nom}{t(' is entered by them and approved by ')}{d.mgrName(d.mgrOf(tsEmp))}.</Fine>}
      {tsEmp && <AlerteAutorisation e={tsEmp} />}
      {tsEmp && <Sheet key={`${tsEmp.id}|${wk}`} emp={tsEmp} wk={wk} />}

      {tsEmp && <CompteurDelegation emp={tsEmp} />}

      {/* Astreintes (lot 7, t049) : planning de l'équipe (manager) ou de tous (espace RH). */}
      {!collab && <PlanningAstreintes wk={wk} />}

      {espaceRh && <LotsPaie />}

      {rh && <RelevesPanel wk={wk} />}
      </>}
    </Page>
  );
}

/** Feuille de la semaine d'un collaborateur : grille de saisie et récapitulatif paie. */
function Sheet({ emp, wk }: { emp: Employe; wk: ISODate }) {
  const d = useDomain();
  const data = d.ds;
  const { rh, admin, manager, me, soi } = useRole();
  const { run, openDialog } = useStore();
  const { occupe, agir } = useAgir();
  const [comment, setComment] = useState('');
  // Téléphone, tablette : la feuille se saisit jour par jour (pages/SaisieJour.tsx) ; le PC garde la grille de la semaine.
  const vueJour = useVueJour();

  const wdays = joursSemaine(wk);
  const sh = data.feuilles.find(f => f.empId === emp.id && f.week === wk) ?? null;
  // Motif d'un dépassement des durées maximales : repris de la feuille (renvoyée pour correction, ou soumise).
  const [motif, setMotif] = useState(sh?.motifDepassement ?? '');
  // Régime de la semaine : figé sur la feuille (soumission ou changement de contrat), sinon celui de la fiche.
  const empF = employeDeLaFeuille(emp, sh);
  const calc = calcSheet(d, emp, sh);
  const c = calc.c;
  const st = sh ? sh.statut : 'vide';
  const actuel = d.contratOf(emp);
  const autreRegime = !!sh?.contrat && (c.libelle !== actuel.libelle || c.jourOff.join() !== actuel.jourOff.join());
  const regimeNote = !autreRegime ? '' : t(st === 'soumise' || st === 'validee' ? 'arrangement frozen at submission' : 'arrangement in force this week');
  const validator = d.mgrOf(emp);
  // Un membre du RH ne valide pas sa propre feuille : son manager ou un autre membre du RH le fait.
  const isValidator = (rh && emp.id !== soi) || (manager && validator === me);
  const directMgr = manager && emp.id !== me && validator === me;
  // Le valideur peut corriger une feuille soumise avant de la valider : elle reste soumise.
  const correction = st === 'soumise' && isValidator;
  // Semaine avant l'entrée ou après la fin du contrat : aucune feuille.
  const horsSemaine = semaineHorsContrat(emp, wk);
  const editable = !horsSemaine && (correction || ((st === 'vide' || st === 'brouillon' || st === 'rejetee') && (rh || emp.id === me || directMgr)));
  const canValidate = st === 'soumise' && isValidator;
  // Horaire de poste du jour : proposé d'après l'équipe, choisi jour par jour (null : aucun horaire à montrer).
  const horaires = useHorairesFeuille(emp, wk, sh, calc.perDay, editable);
  const submitLabel = t(isValidator ? 'Submit for approval' : validator ? 'Submit to the manager' : 'Submit to HR');
  const base = { empId: emp.id, week: wk };

  const absences = joursAbsence(d, emp.id, wk);
  // Demi-journée d'absence (CP, RTT, récupération) : le jour reste saisissable, une demi-journée de travail au plus.
  const demis = demiJoursAbsence(d, emp.id, wk);
  // Heures restées sur un jour d'absence : à retirer avant soumission et validation.
  const surAbsence = sh ? heuresSurAbsence(d, sh) : [];
  // Demande d'absence en attente : saisie libre, mais à décider avant de valider une feuille qui porte des heures ces jours-là.
  // Demande d'une demi-journée : notée comme telle ; heures en attente calculées avec les absences en vigueur, comme à la
  // décision (une demi-journée demandée à côté d'une demi-journée validée fait un jour entier).
  const demandes = demandesAbsence(d), demandeJours = joursAbsence(d, emp.id, wk, demandes), demandeDemis = demiJoursAbsence(d, emp.id, wk, demandes);
  const enAttente = sh ? heuresSurDemandes(d, sh) : [];
  // Semaine d'arrêt, de congés… : aucune heure attendue, la feuille se soumet sans heure.
  const couverte = semaineCouverte(d, emp, wk, sh);
  // Soumise sans heure, la semaine n'est plus couverte (absence annulée ou raccourcie) : à renvoyer, pas à valider.
  const plusCouverte = st === 'soumise' && !(calc.total > 0) && !couverte;
  // Jours fériés : saisissables si le réglage le permet (par défaut), mention « Férié travaillé » quand des heures y sont.
  const feries = feriesDeLaSemaine(wk), ferieBloque = data.settings.feriesTravaillesAutorises === false;
  const days = wdays.map((day, i) => {
    const a = absences[i], dem = demandeJours[i] ?? demandeDemis[i]?.absence, demDemi = demandeJours[i] ? null : demandeDemis[i]?.demi, off = c.jourOff.includes(i), fer = feries[i], hors = !!jourHorsContrat(emp, day);
    const m = data.missions.find(x => x.empId === emp.id && x.du <= day && x.au >= day);
    return {
      day, a, locked: (!!fer && ferieBloque) || !!a || hors, hl: (!!m && !fer && !a) || (!!fer && calc.perDay[i] > 0) || [...surAbsence, ...enAttente].some(x => x.di === i),
      label: cap(parse(day).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })), long: jourLong(day), weekend: estWeekEnd(i),
      note: fer ? mentionFerie(fer, calc.perDay[i], calc.majFerie) : hors ? t('Outside the contract')
        : a ? `${ABS_ABREGE[a.type]}${a.statut === 'signalee' ? t(' (reported)#fem') : ''}`
        : demis[i] ? `${ABS_ABREGE[demis[i].absence.type]} ${DEMI_LABEL[demis[i].demi]} · ${fH(demis[i].max)} max.`
        : dem ? `${cap(natureAbsence(dem.type))}${demDemi ? ` ${DEMI_LABEL[demDemi]}` : ''}${dem.type === 'RECUP' ? t(' requested#fem') : t(' requested#masc')}` : off ? t('Not worked#masc')
        : estJourneeSolidarite(day) ? t('Solidarity day') : m ? `${t('Assignment ')}${m.projet}` : estWeekEnd(i) ? t('Weekend') : '—',
    };
  });
  // Samedi et dimanche : repliés en une colonne tant qu'ils sont vides (grille de la semaine) ; dépliés pour y saisir.
  const [voirWeekEnd, setVoirWeekEnd] = useState(calc.perDay[SAMEDI] + calc.perDay[DIMANCHE] > 0);
  const colonnes = days.map((_, i) => i).filter(i => voirWeekEnd || !estWeekEnd(i));
  const heuresWeekEnd = (h: readonly number[]) => num(h[SAMEDI]) + num(h[DIMANCHE]);
  const lignes = sh ? sh.lignes : [];
  // Cellule remplie un jour d'absence : signalée (à vider) ; elle reste modifiable pour être vidée, vide elle est verrouillée.
  // De même pour un jour férié quand le réglage n'en permet plus la saisie : les heures déjà posées restent à retirer.
  const alerteDe = (li: number, di: number) => {
    const a = days[di].a, h = num(lignes[li]?.h[di]);
    if (a && h > 0) return `${absenceCeJour(a)}${t(': ')}${t(editable ? 'empty the cell' : 'no hours should be entered')}`;
    if (feries[di] && ferieBloque && h > 0) return `${t('Public holiday not enterable: ')}${t(editable ? 'empty the cell' : 'no hours should be entered')}`;
    return undefined;
  };
  const enregistrer = async (li: number, di: number, raw: string) => (await run('temps.setCell', { ...base, li, di, value: raw }, { silent: true })).ok;
  // La ligne visée accompagne l'indice : un second clic ne supprime pas la ligne venue à sa place.
  // Une ligne qui porte des heures n'est supprimée qu'après confirmation.
  const supprimer = (li: number, ev: MouseEvent) => {
    const l = lignes[li];
    const ligne = { ...base, li, projet: l.projet, tache: l.tache, lignes: lignes.length };
    const heures = l.h.reduce((n, v) => n + num(v), 0);
    if (heures > 0) openDialog({ type: 'confirmer', c: suppressionLigne(ligne, `${l.projet} · ${l.tache}`, heures) });
    else agir(() => run('temps.removeLine', ligne))(ev);
  };
  const used = new Set(lignes.map(l => l.projet));
  // Ligne INT-AST : tenue par la déclaration des interventions d'astreinte (t049), jamais ajoutée à la main.
  const projOptions = data.referentiels.projets.filter(p => !used.has(p.code) && p.statut !== 'archive' && p.code !== ACTIVITE_ASTREINTE.code);
  // Proposition Keystone : seulement si des heures sont planifiées cette semaine-là.
  // Tâches Keystone de la semaine, ou heures des sessions de formation (ligne INT-FORM, shared/rules/formations-temps.ts).
  const keystone = tachesDeLaSemaine(d, emp.id, wk).length > 0, formations = formationsAProposer(d, emp.id, wk);
  const canSuggest = editable && !correction && (keystone || formations);
  const missions = data.missions.filter(m => m.empId === emp.id && m.du <= wdays[DIMANCHE] && m.au >= wdays[0]);

  const recap = recapOf(d, empF, calc, wk, sh);
  // Durées sur plusieurs semaines (feuilles validées, jusqu'à cette semaine) : alertes, sans blocage.
  const moyenne = moyenne12Semaines(d, emp, wk), requalification = requalificationPartiel(d, emp, wk);
  const alertesDurees = [
    moyenne?.depasse ? moyenneTexte(moyenne) : '',
    requalification?.depasse ? requalificationTexte(requalification) : '',
    ...contingentsDeLaSemaine(d, emp, wk).map(k => (k.etat ? contingentTexte(k) : '')),
  ].filter(Boolean);
  const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', fontSize: 13, padding: 'var(--space-2) 0', background: 'var(--rule-soft) no-repeat bottom / 100% 1px' } as const;

  // Intérimaire : relevé hebdomadaire à l'agence (le service RH voit s'il a été transmis).
  const releve = data.releves.filter(r => key(r.agence) === key(emp.agence) && r.semaine === wk).at(-1);
  const paie = sh?.sage ? t(' · passed to Sage Paie') : sh?.lotId ? `${t(' · in payroll batch no. ')}${sh.lotId}${t(', import into Sage to confirm')}`
    : c.interim ? (releve ? `${t(' · statement sent to the agency on ')}${fmtShort(new Date(releve.creation))}` : t(' · weekly statement to the temporary work agency'))
    : c.dirigeant ? t(' · not passed to payroll (senior executive, art. L3111-2)')
    : sh && aRegulariser(sh) ? t(' · difference to pass to Sage Paie (regularisation, corrective batch)')
    : t(' · awaiting transmission to Sage Paie');
  const flow = st === 'validee'
    ? `${t('Approved#fem')}${sh!.keystone ? t(' · hours per project sent back to Keystone') : ''}${paie}`
    : st === 'soumise' ? `${t('Awaiting approval by ')}${d.mgrName(validator)}` : t('Entered by day and by project — proposed from the Keystone tasks');

  const reject = agir(async () => {
    const r = await run('temps.reject', { ...base, comment });
    if (r.ok) setComment('');
  });
  // Durées maximales dépassées : motif exigé à la soumission ; à la validation, s'il manque encore (correction du valideur).
  const depasse = calc.depassements.length > 0;
  const motifSoumis = sh?.motifDepassement ?? '';
  const motifManquant = depasse && !motif.trim();
  const motifValideur = canValidate && depasse && !motifSoumis;
  // Salarié mineur au-delà de 8 h par jour ou de 35 h par semaine : motif, ou référence de la dérogation de l'inspection.
  const motifLibelle = calc.depassementsMineur.length ? t('Reason for the excess or reference of the labour inspectorate derogation')
    // Repos quotidien ou pause insuffisants seulement (horaires de poste, shared/rules/repos-nuit.ts).
    : calc.depassements.every(x => calc.reposQuotidien.includes(x)) ? t('Reason for the insufficient daily rest or break') : t('Reason for the excess');
  // Forfait jours : plafond de l'année dépassé avec cette feuille (comptée validée) : motif du valideur exigé.
  const [motifForfait, setMotifForfait] = useState(sh?.motifForfait ?? '');
  const forfaitDepasse = canValidate && sh ? controleValidationForfait(d, emp, sh).depassements : [];
  const motifForfaitManquant = forfaitDepasse.length > 0 && !motifForfait.trim();

  return (
    <div className="row-wrap">
      <Panel style={{ flex: '1 1 640px', gap: 'var(--space-4)' }} head={
        <div className="panel-head top">
          <div><h2>{emp.nom}</h2><div className="text-muted sub">{c.label}{regimeNote && ` · ${regimeNote}`}{t(' · approval: ')}{d.mgrName(validator)}</div></div>
          <Tag cls={TS_CLS[st]}>{TS_LABEL[st]}</Tag>
        </div>
      }>
        {missions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {missions.map(m => (
              <div key={m.id} className="note-accent">Keystone · {m.type} · {m.projet} {d.projet(m.projet)} · {m.lieu} · {fmtShort(parse(m.du))} → {fmtShort(parse(m.au))}</div>
            ))}
          </div>
        )}
        {sh?.comment && st === 'rejetee' && <div style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>{t(sh.reouverture?.renvoyee ? 'Timesheet reopened by HR' : 'Feedback from the manager')}{t(': ')}{sh.comment}</div>}

        {vueJour ? (
          <SaisieJour wk={wk} days={days} lignes={lignes} perDay={calc.perDay} total={calc.total} editable={editable} occupe={occupe}
            projet={code => d.projet(code)} alerteDe={alerteDe} enregistrer={enregistrer} supprimer={supprimer} horaires={horaires}
            /* lot 12 — C6 (badgeage virtuel) : bouton « Pointer » sur sa propre feuille de la semaine en cours. */
            pointer={emp.id === me && wk === mondayOf(data.today)} />
        ) : (
        <div className="scroll-x">
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr>
              <th>{t('Project · task')}</th>
              {colonnes.map(i => { const x = days[i]; return (
                <th key={x.day} className={`center nowrap${x.weekend ? ' col-weekend' : ''}`}>
                  <div>{x.label}</div>
                  <div style={{ fontSize: 11, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: x.hl ? 'var(--color-accent-300)' : 'var(--color-neutral-500)' }}>{x.note}</div>
                  {i === DIMANCHE && <button type="button" className="btn btn-ghost btn-sm weekend-bascule" aria-expanded onClick={() => setVoirWeekEnd(false)}>{t('Fold')}</button>}
                </th>
              ); })}
              {!voirWeekEnd && (
                <th className="center nowrap col-weekend">
                  <button type="button" className="btn btn-ghost btn-sm weekend-bascule" aria-expanded={false} onClick={() => setVoirWeekEnd(true)}>{t('Sat. · Sun.')}</button>
                  <div style={{ fontSize: 11, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--color-neutral-500)' }}>{t('Weekend')}</div>
                </th>
              )}
              <th className="right">{t('Total')}</th><th></th>
            </tr></thead>
            <tbody>
              {horaires && <LigneHoraires h={horaires} colonnes={colonnes} weekEndReplie={!voirWeekEnd} long={days.map(x => x.long)} />}
              {lignes.map((l, li) => (
                <tr key={li}>
                  <td style={{ minWidth: 180 }}>
                    <div><span style={{ color: 'var(--color-accent-300)' }}>{l.projet}</span> · {d.projet(l.projet)}</div>
                    <div className="text-muted sub">{l.tache}</div>
                  </td>
                  {colonnes.map(di => {
                    // Chaque cellule est nommée (projet, tâche, jour) ; l'alerte d'absence lui est reliée pour un lecteur d'écran.
                    // Une ligne enregistrée avant la semaine à 7 jours n'a que 5 valeurs : samedi et dimanche vides.
                    const alerte = alerteDe(li, di), alerteId = `ts-alerte-${li}-${di}`;
                    return (
                      <td key={di} className={`center${days[di].weekend ? ' col-weekend' : ''}`}>
                        <ChampHeures value={num(l.h[di])} disabled={!editable || (days[di].locked && !alerte) || ligneAstreinte(l) || /* lot 12 — C6 */ estLignePointee(l)} label={nomChamp(l, days[di].long)}
                          alerte={alerte} alerteId={alerteId} onCommit={raw => enregistrer(li, di, raw)}
                          style={{ width: 56, textAlign: 'right', padding: '0 var(--space-3)' }} />
                        {alerte && <span id={alerteId} className="sr-only">{alerte}</span>}
                      </td>
                    );
                  })}
                  {!voirWeekEnd && <td className="center col-weekend tnum nowrap">{heuresWeekEnd(l.h) ? fH(heuresWeekEnd(l.h)) : '—'}</td>}
                  <td className="right nowrap tnum">{fH(l.h.reduce((n, v) => n + num(v), 0))}</td>
                  <td className="right">{editable && !(ligneAstreinte(l) && l.h.some(v => num(v) > 0)) && /* lot 12 — C6 */ !estLignePointee(l) && <CloseButton size={28} label={`${t('Delete the line ')}${l.projet}`} disabled={occupe} onClick={ev => supprimer(li, ev)} />}</td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 500 }}>{t('Day total')}</td>
                {colonnes.map(i => { const h = calc.perDay[i]; return (
                  <td key={i} className={`center${estWeekEnd(i) ? ' col-weekend' : ''}`}><span className="tnum nowrap" style={{ color: h > 10 || (calc.depassementsMineur.length > 0 && h > MINEUR_JOUR_MAX) ? 'var(--color-accent-300)' : 'inherit' }}>{h ? fH(h) : '—'}</span></td>
                ); })}
                {!voirWeekEnd && <td className="center col-weekend tnum nowrap">{heuresWeekEnd(calc.perDay) ? fH(heuresWeekEnd(calc.perDay)) : '—'}</td>}

                <td className="right nowrap tnum" style={{ fontWeight: 500 }}>{fH(calc.total)}</td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
        )}
        {horaires && <LegendeHoraires h={horaires} />}
        {/* Astreintes de la semaine et interventions déclarées (ligne INT-AST, en lecture seule dans la grille). */}
        <InterventionsFeuille emp={emp} wk={wk} editable={editable} />
        {horsSemaine && <div className="note-accent">{t('Week outside the contract: ')}{horsSemaine}{t('. No timesheet.')}</div>}
        {!horsSemaine && lignes.length === 0 && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{t('No hours entered for this week.')}</p>}
        {couverte && !(calc.total > 0) && editable && !correction && <Fine>{t('Week covered by an absence: the timesheet is submitted without hours.')}</Fine>}

        {editable && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <select className="input" aria-label={t('Add a project')} value="" disabled={occupe} style={{ width: 'auto', minWidth: 240 }}
              onChange={ev => { const projet = ev.target.value; if (projet) agir(() => run('temps.addLine', { ...base, projet }))(); }}>
              <option value="">{t('+ Add a project…')}</option>
              {projOptions.map(p => <option key={p.code} value={p.code}>{p.code} · {p.nom}</option>)}
            </select>
            {canSuggest && <button type="button" className="btn btn-secondary" disabled={occupe} onClick={agir(() => run('temps.suggest', base))}>{t(formations ? (keystone ? 'Propose the planned hours' : 'Propose the training hours') : 'Propose from Keystone')}</button>}
            {correction
              ? <span className="text-muted sub" style={{ marginLeft: 'auto' }}>{t('Correction before approval: the timesheet stays submitted')}</span>
              : <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} disabled={!(calc.total > 0 || couverte) || surAbsence.length > 0 || motifManquant || occupe}
                  onClick={agir(() => run('temps.submit', { ...base, ...(depasse ? { motif: motif.trim() } : {}) }))}>{submitLabel}</button>}
          </div>
        )}
        {surAbsence.length > 0 && (
          <div className="note-accent">
            {editable
              ? heuresSurAbsenceMessage(surAbsence, correction ? 'ou renvoyez la feuille avant de la valider' : 'avant de soumettre la feuille')
              : `${[
                surAbsence.some(x => !x.demi) ? `${t('Absence')} ${joursAbsenceTexte(surAbsence.filter(x => !x.demi))}${t(': hours are entered on it')}` : '',
                surAbsence.some(x => x.demi) ? `${demiJourneeTexte(surAbsence.filter(x => x.demi))}${t(': more than a half-day of work entered')}` : '',
              ].filter(Boolean).join(' ; ')}${st === 'validee' ? t(' — timesheet approved, not changed retroactively') : ''}`}
          </div>
        )}
        {enAttente.length > 0 && st !== 'validee' && <div className="note-accent">{demandesEnAttenteMessage(enAttente, canValidate)}</div>}
        {plusCouverte && <div className="note-accent">{t('No hours and the week is no longer covered by an absence: send the timesheet back for the hours to be entered.')}</div>}
        {calc.warn.length + alertesDurees.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {[...calc.warn, ...alertesDurees].map(w => <div key={w} className="note-accent">{w}</div>)}
          </div>
        )}
        {depasse && editable && !correction && (
          <div className="field">
            <label htmlFor="ts-motif">{motifLibelle}{t(' (mandatory to submit)')}</label>
            <textarea className="input short" id="ts-motif" rows={2} placeholder={t('Breakdown, urgent intervention, inventory…')} value={motif} onChange={ev => setMotif(ev.target.value)} style={{ resize: 'vertical' }} />
          </div>
        )}
        {motifSoumis && (st === 'soumise' || st === 'validee') && <Fine>{t('Reason for the excess: ')}{motifSoumis}</Fine>}
        {sh?.motifForfait && st === 'validee' && <Fine>{t('Reason for the annual days package excess: ')}{sh.motifForfait}</Fine>}
        <Fine>{flow}</Fine>
        {/* Réouverture (t131) : administrateur RH, jamais sa propre feuille ; une feuille transmise se régularise par écart. */}
        {sh?.reouverture && <Fine>{mentionReouverture(sh, iso => fmtShort(new Date(iso)))}{sh.reouverture.motif ? `${t(' — reason: ')}${sh.reouverture.motif}` : ''}</Fine>}
        {st === 'validee' && admin && emp.id !== soi && (
          <div className="actions-end">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'rouvrirFeuille', empId: emp.id, week: wk })}>{t('Reopen the timesheet')}</button>
          </div>
        )}
      </Panel>

      <aside className="card elev-sm panel" style={{ flex: '0 1 320px', minWidth: 280 }}>
        <h3>{t('Payroll summary')}</h3>
        {autreRegime && <Fine>{cap(regimeNote)}{t(': ')}{c.libelle}{t('. Current contract: ')}{actuel.libelle}.</Fine>}
        {recap.rows.map(([label, val]) => (
          <div key={label} style={rowStyle}>
            <span className="text-muted">{label}</span><span className="tnum nowrap">{val}</span>
          </div>
        ))}
        {recap.mention && <div style={rowStyle}><span className="text-muted">{recap.mention}</span></div>}
        {recap.alert && <div className="note-accent">{recap.alert}</div>}
        <Fine>{recap.aide}</Fine>
        {canValidate && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', paddingTop: 'var(--space-2)' }}>
            {motifValideur && (
              <textarea className="input short" rows={2} aria-label={motifLibelle} placeholder={`${motifLibelle}${t(' (mandatory to approve)')}`} value={motif} onChange={ev => setMotif(ev.target.value)} style={{ resize: 'vertical' }} />
            )}
            {forfaitDepasse.map(x => <div key={x} className="note-accent">{x}{t(' with this week: reason required to approve.')}</div>)}
            {forfaitDepasse.length > 0 && (
              <textarea className="input short" rows={2} aria-label={t('Reason for the annual days package excess')} placeholder={t('Reason for the annual days package excess (mandatory to approve)')} value={motifForfait} onChange={ev => setMotifForfait(ev.target.value)} style={{ resize: 'vertical' }} />
            )}
            <textarea className="input short" rows={2} aria-label={t('Comment')} placeholder={t('Comment if sent back (optional)')} value={comment} onChange={ev => setComment(ev.target.value)} style={{ resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" disabled={occupe} onClick={reject}>{t('Send back')}</button>
              <button type="button" className="btn btn-primary" disabled={surAbsence.length + enAttente.length > 0 || plusCouverte || (motifValideur && motifManquant) || motifForfaitManquant || occupe}
                onClick={agir(() => run('temps.validate', { ...base, ...(motifValideur ? { motif: motif.trim() } : {}), ...(forfaitDepasse.length ? { motifForfait: motifForfait.trim() } : {}) }))}>{t('Approve the week')}</button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
