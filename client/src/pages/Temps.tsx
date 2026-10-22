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
import { useState, type MouseEvent } from 'react';
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { ABS_ABREGE, TEMPS_TRAVAIL, TS_CLS, TS_LABEL } from '../../../shared/constants.ts';
import type { Domain } from '../../../shared/domain.ts';
import { addD, estJourneeSolidarite, isoWeek, isoWeekYear, joursSemaine, mondayOf, parse } from '../../../shared/dates.ts';
import { DIMANCHE, estWeekEnd, SAMEDI } from '../../../shared/rules/semaine.ts';
import { cap, equipeLabel, fH, fJ, fmt, fmtShort, key, num, plural } from '../../../shared/format.ts';
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
import { CloseButton, Fine, Page, Panel, stop, Tag, Two } from '../components/ui.tsx';
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

/** Année d'une feuille : celle de sa semaine ISO (son jeudi) ; le cumul annuel ventile une semaine à cheval jour par jour. */
const anneeDe = (week: ISODate) => isoWeekYear(week);

/**
 * Colonne « Total » de la file de validation, selon l'organisation du temps de la feuille.
 * `aRenvoyer` : feuille sans heure dont la semaine n'est plus couverte par une absence, que le serveur ne valide pas.
 * `motifManquant` : durées maximales dépassées sans motif (feuille corrigée par le valideur) ; il se donne en ouvrant la feuille.
 */
function queueTotal(d: Domain, e: Employe, sh: FeuilleTemps): { main: string; sub: string; aRenvoyer?: boolean; motifManquant?: boolean } {
  const t = totalFile(d, e, sh), c = calcSheet(d, e, sh);
  // Repos hebdomadaire ou dominical : signalé au valideur, sans empêcher la validation.
  const repos = c.repos.length ? { ...t, sub: `${t.sub} · repos hebdomadaire à vérifier` } : t;
  return c.depassements.length && !sh.motifDepassement ? { ...repos, sub: `${repos.sub} · motif du dépassement à indiquer`, motifManquant: true } : repos;
}
function totalFile(d: Domain, e: Employe, sh: FeuilleTemps): { main: string; sub: string; aRenvoyer?: boolean } {
  const c = calcSheet(d, e, sh), k = c.c;
  if (k.forfait) return { main: fJ(c.jours), sub: `forfait jours · ${fH(c.total)} déclarées` };
  if (k.dirigeant) return { main: fJ(c.jours), sub: `cadre dirigeant · ${fH(c.total)} déclarées` };
  if (k.annuel) {
    const cum = cumulAnnuel(d, employeDeLaFeuille(e, sh), anneeDe(sh.week));
    return { main: fH(c.total), sub: `forfait annuel · cumul validé ${cum.annee} ${fH(cum.done)} / ${fH(cum.cible)}` };
  }
  // Seules les heures majorées dépassent le contrat ; les heures incluses au forfait hebdomadaire n'en font pas partie.
  const extra = c.sup25 + c.sup50 + c.hc10 + c.hc25;
  // Sans heure : la semaine doit encore être couverte par une absence (elle a pu être annulée ou raccourcie depuis).
  if (!c.total) return semaineCouverte(d, e, sh.week, sh)
    ? { main: fH(0), sub: 'semaine d’absence, sans heure' }
    : { main: fH(0), sub: 'aucune heure : semaine plus couverte par une absence, à renvoyer', aRenvoyer: true };
  return { main: fH(c.total), sub: extra > 0 ? `dont ${fH(extra)} au-delà du contrat` : 'aucune heure au-delà du contrat' };
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
  const recupRows: [string, string][] = c.interim ? [['Récupération', 'géré par l’agence']]
    : calc.modeHS === 'paiement' ? [] : [['Repos compensateur acquis', fH(calc.recup)]];
  const recupAide = c.interim
    ? ' Intérim : heures supplémentaires relevées et réglées par l’agence.'
    : ` ${MODES_HEURES_SUP[calc.modeHS].aide}`;
  // Lignes ajoutées au décompte : heures du dimanche (comprises dans les autres) : rubrique HDIM, et majoration si le
  // réglage en prévoit une.
  const annexes: [string, string][] = !calc.dimanche || c.forfait ? []
    : [['Dont heures du dimanche', fH(calc.dimanche)], ...(calc.majDimanche ? [[`Majoration du dimanche (${calc.majDimanche} %)`, fH(calc.dimanche * calc.majDimanche / 100)] as [string, string]] : [])];
  // Jours fériés travaillés (comprises dans les autres) : 1er mai majoré de 100 % (MAJ_1MAI), autres fériés en quantité
  // (FERIE_TRAV) et leur majoration réglée (MAJ_FERIE). Contrepartie obligatoire en repos figée à la validation (COR_ACQUIS).
  const cor = corDeLaFeuille(sh);
  if (!c.forfait) {
    if (calc.mai1) annexes.push(['Dont heures du 1er mai', fH(calc.mai1)], [`Majoration du 1er mai (${MAJORATION_1ER_MAI} %)`, fH(calc.mai1 * MAJORATION_1ER_MAI / 100)]);
    if (calc.ferie) annexes.push(['Dont heures un jour férié', fH(calc.ferie)], ...(calc.majFerie ? [[`Majoration des fériés (${calc.majFerie} %)`, fH(calc.ferie * calc.majFerie / 100)] as [string, string]] : []));
    if (cor) annexes.push(['Contrepartie obligatoire en repos', fH(cor)]);
  }
  // Contingent annuel d'heures supplémentaires de chaque année de la semaine (deux pour une semaine à cheval sur le
  // 31 décembre ; feuilles validées).
  if (!(c.forfait || c.dirigeant || c.annuel || c.partiel || c.interim)) {
    for (const k of contingentsDeLaSemaine(d, emp, week)) annexes.push([`Contingent ${k.annee} (heures sup validées)`, `${fH(k.cumul)} / ${fH(k.max)}`]);
  }

  if (c.forfait) return {
    rows: [['Jours travaillés', fJ(calc.jours)], ['Heures déclarées (répartition projets)', fH(calc.total)]],
    aide: tt.aide + art,
  };
  if (c.dirigeant) return {
    rows: [['Jours de présence', fJ(calc.jours)], ['Heures déclarées (répartition projets)', fH(calc.total)]],
    mention: 'Non soumis à la durée du travail, art. L3111-2',
    aide: tt.aide,
  };
  if (c.annuel) {
    // Cumul de l'année de la feuille ; cible proratisée selon la présence (entrée, fin de contrat).
    const cum = cumulAnnuel(d, emp, anneeDe(week));
    const rows: [string, string][] = [
      ['Heures de la semaine', fH(calc.total)],
      ...annexes,
      [`Cumul annuel validé ${cum.annee}`, `${fH(cum.done)} / ${fH(cum.cible)}`],
    ];
    if (cum.cible !== c.heuresAnnuelles) rows.push([`Forfait ${cum.annee} au prorata de la présence`, `${fH(cum.cible)} sur ${fH(c.heuresAnnuelles)}`]);
    if (cum.annee === d.year) rows.push(['Cible à date', fH(cum.prorata)]);
    return {
      rows,
      alert: cum.depasse ? `Forfait annuel ${cum.annee} dépassé de ${fH(cum.done - cum.cible)} : heures à régulariser en fin d’année` : undefined,
      aide: tt.aide + art,
    };
  }
  if (c.partiel) {
    // Plafond réglé : le dixième, ou le tiers avec la référence d'un accord (Paramètres → Décompte des heures).
    const p = plafondComplementaires(d.ds.settings);
    return {
      rows: [['Heures contractuelles', fH(Math.min(calc.total, c.base))], ['Complémentaires +10 %', fH(calc.hc10)], ['Complémentaires +25 %', fH(calc.hc25)], ...annexes],
      aide: `${tt.aide} Plafond en vigueur : le ${p.label} de la durée contractuelle, soit ${fH(c.base / p.diviseur)} cette semaine (${p.article}).${art}`,
    };
  }
  if (c.hebdo) {
    // Heures incluses au forfait : +25 % jusqu'à la 43e heure, +50 % au-delà (forfait supérieur à 43 h).
    const rows: [string, string][] = [['Heures normales (jusqu’à 35 h)', fH(calc.normal)], ['Incluses au forfait +25 %', fH(calc.incluses25)]];
    if ((c.seuil ?? 0) > 43 || calc.incluses50 > 0) rows.push(['Incluses au forfait +50 %', fH(calc.incluses50)]);
    rows.push(['Supplémentaires +25 %', fH(calc.sup25)], ['Supplémentaires +50 %', fH(calc.sup50)], ...recupRows, ...annexes);
    return { rows, aide: tt.aide + recupAide + art };
  }
  return {
    rows: [['Heures normales', fH(calc.normal)], ['Supplémentaires +25 %', fH(calc.sup25)], ['Supplémentaires +50 %', fH(calc.sup50)], ...recupRows, ...annexes],
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
    .filter((q): q is { sh: FeuilleTemps; e: Employe } => !!q.e && (espaceRh || (manager && d.mgrOf(q.e) === me)));
  const valide = (e: Employe) => (rh && e.id !== soi) || (manager && d.mgrOf(e) === me);

  return (
    <Page
      kicker={`Semaine ${isoWeek(wk)} · ${fmtShort(parse(wdays[0]))} → ${fmt(parse(wdays[DIMANCHE]))}`}
      title="Temps de travail"
      actions={<>
        {/* Choix du salarié par suggestions (t152) : nom, poste, équipe ou matricule. */}
        {!collab && (
          <ChoixCollaborateur id="temps-salarie" label="Collaborateur" emps={options} valeur={tsId} style={{ minWidth: 240 }}
            onChange={id => { if (id != null) setUi({ tsEmp: id }); }} suffixe={e => lecture.has(e.id) ? ' (lecture seule)' : ''} />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <button type="button" className="btn btn-ghost btn-icon plain" aria-label="Semaine précédente" title="Semaine précédente" onClick={() => setUi({ weekStart: addD(wk, -7) })}><CaretLeftIcon size={14} /></button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUi({ weekStart: mondayOf(data.today) })}>Cette semaine</button>
          <button type="button" className="btn btn-ghost btn-icon plain" aria-label="Semaine suivante" title="Semaine suivante" onClick={() => setUi({ weekStart: addD(wk, 7) })}><CaretRightIcon size={14} /></button>
        </div>
        {/* Lien de la feuille affichée : salarié (sauf l'espace collaborateur, toujours sa propre feuille) et semaine. */}
        <CopierLien chemin={`/temps?${collab || tsId == null ? '' : `salarie=${tsId}&`}semaine=${wk}`} />
      </>}
    >
      {!collab && queue.length > 0 && (
        <Panel highlight title="Feuilles à valider" aside={plural(queue.length, 'feuille à valider', 'feuilles à valider')}>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Collaborateur</th><th>Semaine</th><th>Total</th><th></th></tr></thead>
              <tbody>
                {queue.map(({ sh, e }) => {
                  const tot = queueTotal(d, e, sh);
                  const open = () => setUi({ tsEmp: e.id, weekStart: sh.week });
                  return (
                    <tr key={sh.id} className="clickable" onClick={open}>
                      <td><Two main={<Ouvrir onOpen={open}>{e.nom}</Ouvrir>} sub={equipeLabel(e)} nowrap /></td>
                      <td className="nowrap">S{isoWeek(sh.week)} · {fmtShort(parse(sh.week))}</td>
                      <td>
                        <div className="tnum">{tot.main}</div>
                        <div className="text-muted sub">{tot.sub}</div>
                      </td>
                      <td className="right">
                        <div className="actions-end">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={stop(open)}>Ouvrir</button>
                          {!tot.aRenvoyer && !tot.motifManquant && valide(e) && <button type="button" className="btn btn-secondary btn-sm" disabled={occupe} onClick={agir(() => run('temps.validate', { empId: e.id, week: sh.week }))}>Valider</button>}
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

      {tsEmp && lecture.has(tsEmp.id) && <Fine>Consultation en lecture seule (équipe rattachée) : la feuille de {tsEmp.nom} est saisie par lui et validée par {d.mgrName(d.mgrOf(tsEmp))}.</Fine>}
      {tsEmp && <AlerteAutorisation e={tsEmp} />}
      {tsEmp && <Sheet key={`${tsEmp.id}|${wk}`} emp={tsEmp} wk={wk} />}

      {tsEmp && <CompteurDelegation emp={tsEmp} />}

      {espaceRh && <LotsPaie />}

      {rh && <RelevesPanel wk={wk} />}
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
  const regimeNote = !autreRegime ? '' : st === 'soumise' || st === 'validee' ? 'régime figé à la soumission' : 'régime en vigueur cette semaine';
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
  const submitLabel = isValidator ? 'Soumettre pour validation' : validator ? 'Soumettre au manager' : 'Soumettre au service RH';
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
      note: fer ? mentionFerie(fer, calc.perDay[i], calc.majFerie) : hors ? 'Hors contrat'
        : a ? `${ABS_ABREGE[a.type]}${a.statut === 'signalee' ? ' (signalée)' : ''}`
        : demis[i] ? `${ABS_ABREGE[demis[i].absence.type]} ${DEMI_LABEL[demis[i].demi]} · ${fH(demis[i].max)} max.`
        : dem ? `${cap(natureAbsence(dem.type))}${demDemi ? ` ${DEMI_LABEL[demDemi]}` : ''} demandé${dem.type === 'RECUP' ? 'e' : ''}` : off ? 'Non travaillé'
        : estJourneeSolidarite(day) ? 'Journée de solidarité' : m ? `Mission ${m.projet}` : estWeekEnd(i) ? 'Week-end' : '—',
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
    if (a && h > 0) return `${absenceCeJour(a)} : ${editable ? 'videz la cellule' : 'aucune heure ne devrait être saisie'}`;
    if (feries[di] && ferieBloque && h > 0) return `Férié non saisissable : ${editable ? 'videz la cellule' : 'aucune heure ne devrait être saisie'}`;
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
  const projOptions = data.referentiels.projets.filter(p => !used.has(p.code) && p.statut !== 'archive');
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
  const paie = sh?.sage ? ' · transmise à Sage Paie' : sh?.lotId ? ` · dans le lot de paie n° ${sh.lotId}, import dans Sage à confirmer`
    : c.interim ? (releve ? ` · relevé transmis à l’agence le ${fmtShort(new Date(releve.creation))}` : ' · relevé hebdomadaire à l’agence d’intérim')
    : c.dirigeant ? ' · non transmise à la paie (cadre dirigeant, art. L3111-2)'
    : sh && aRegulariser(sh) ? ' · écart à transmettre à Sage Paie (régularisation, lot correctif)'
    : ' · en attente de transmission à Sage Paie';
  const flow = st === 'validee'
    ? `Validée${sh!.keystone ? ' · heures par projet renvoyées à Keystone' : ''}${paie}`
    : st === 'soumise' ? `En attente de validation par ${d.mgrName(validator)}` : 'Saisie par jour et par projet — proposée à partir des tâches Keystone';

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
  const motifLibelle = calc.depassementsMineur.length ? 'Motif du dépassement ou référence de la dérogation de l’inspection du travail' : 'Motif du dépassement';

  return (
    <div className="row-wrap">
      <Panel style={{ flex: '1 1 640px', gap: 'var(--space-4)' }} head={
        <div className="panel-head top">
          <div><h2>{emp.nom}</h2><div className="text-muted sub">{c.label}{regimeNote && ` · ${regimeNote}`} · validation : {d.mgrName(validator)}</div></div>
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
        {sh?.comment && st === 'rejetee' && <div style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>{sh.reouverture?.renvoyee ? 'Feuille rouverte par le service RH' : 'Retour du manager'} : {sh.comment}</div>}

        {vueJour ? (
          <SaisieJour wk={wk} days={days} lignes={lignes} perDay={calc.perDay} total={calc.total} editable={editable} occupe={occupe}
            projet={code => d.projet(code)} alerteDe={alerteDe} enregistrer={enregistrer} supprimer={supprimer} horaires={horaires} />
        ) : (
        <div className="scroll-x">
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr>
              <th>Projet · tâche</th>
              {colonnes.map(i => { const x = days[i]; return (
                <th key={x.day} className={`center nowrap${x.weekend ? ' col-weekend' : ''}`}>
                  <div>{x.label}</div>
                  <div style={{ fontSize: 11, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: x.hl ? 'var(--color-accent-300)' : 'var(--color-neutral-500)' }}>{x.note}</div>
                  {i === DIMANCHE && <button type="button" className="btn btn-ghost btn-sm weekend-bascule" aria-expanded onClick={() => setVoirWeekEnd(false)}>Replier</button>}
                </th>
              ); })}
              {!voirWeekEnd && (
                <th className="center nowrap col-weekend">
                  <button type="button" className="btn btn-ghost btn-sm weekend-bascule" aria-expanded={false} onClick={() => setVoirWeekEnd(true)}>Sam. · Dim.</button>
                  <div style={{ fontSize: 11, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--color-neutral-500)' }}>Week-end</div>
                </th>
              )}
              <th className="right">Total</th><th></th>
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
                        <ChampHeures value={num(l.h[di])} disabled={!editable || (days[di].locked && !alerte)} label={nomChamp(l, days[di].long)}
                          alerte={alerte} alerteId={alerteId} onCommit={raw => enregistrer(li, di, raw)}
                          style={{ width: 56, textAlign: 'right', padding: '0 var(--space-3)' }} />
                        {alerte && <span id={alerteId} className="sr-only">{alerte}</span>}
                      </td>
                    );
                  })}
                  {!voirWeekEnd && <td className="center col-weekend tnum nowrap">{heuresWeekEnd(l.h) ? fH(heuresWeekEnd(l.h)) : '—'}</td>}
                  <td className="right nowrap tnum">{fH(l.h.reduce((n, v) => n + num(v), 0))}</td>
                  <td className="right">{editable && <CloseButton size={28} label={`Supprimer la ligne ${l.projet}`} disabled={occupe} onClick={ev => supprimer(li, ev)} />}</td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 500 }}>Total jour</td>
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
        {horsSemaine && <div className="note-accent">Semaine hors contrat : {horsSemaine}. Aucune feuille de temps.</div>}
        {!horsSemaine && lignes.length === 0 && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Aucune heure saisie pour cette semaine.</p>}
        {couverte && !(calc.total > 0) && editable && !correction && <Fine>Semaine couverte par une absence : la feuille se soumet sans heure.</Fine>}

        {editable && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <select className="input" aria-label="Ajouter un projet" value="" disabled={occupe} style={{ width: 'auto', minWidth: 240 }}
              onChange={ev => { const projet = ev.target.value; if (projet) agir(() => run('temps.addLine', { ...base, projet }))(); }}>
              <option value="">+ Ajouter un projet…</option>
              {projOptions.map(p => <option key={p.code} value={p.code}>{p.code} · {p.nom}</option>)}
            </select>
            {canSuggest && <button type="button" className="btn btn-secondary" disabled={occupe} onClick={agir(() => run('temps.suggest', base))}>{formations ? (keystone ? 'Proposer les heures prévues' : 'Proposer les heures de formation') : 'Proposer depuis Keystone'}</button>}
            {correction
              ? <span className="text-muted sub" style={{ marginLeft: 'auto' }}>Correction avant validation : la feuille reste soumise</span>
              : <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} disabled={!(calc.total > 0 || couverte) || surAbsence.length > 0 || motifManquant || occupe}
                  onClick={agir(() => run('temps.submit', { ...base, ...(depasse ? { motif: motif.trim() } : {}) }))}>{submitLabel}</button>}
          </div>
        )}
        {surAbsence.length > 0 && (
          <div className="note-accent">
            {editable
              ? heuresSurAbsenceMessage(surAbsence, correction ? 'ou renvoyez la feuille avant de la valider' : 'avant de soumettre la feuille')
              : `${[
                surAbsence.some(x => !x.demi) ? `Absence ${joursAbsenceTexte(surAbsence.filter(x => !x.demi))} : des heures y sont saisies` : '',
                surAbsence.some(x => x.demi) ? `${demiJourneeTexte(surAbsence.filter(x => x.demi))} : plus d’une demi-journée de travail saisie` : '',
              ].filter(Boolean).join(' ; ')}${st === 'validee' ? ' — feuille validée, non modifiée rétroactivement' : ''}`}
          </div>
        )}
        {enAttente.length > 0 && st !== 'validee' && <div className="note-accent">{demandesEnAttenteMessage(enAttente, canValidate)}</div>}
        {plusCouverte && <div className="note-accent">Aucune heure et la semaine n’est plus couverte par une absence : renvoyez la feuille pour saisie des heures.</div>}
        {calc.warn.length + alertesDurees.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {[...calc.warn, ...alertesDurees].map(w => <div key={w} className="note-accent">{w}</div>)}
          </div>
        )}
        {depasse && editable && !correction && (
          <div className="field">
            <label htmlFor="ts-motif">{motifLibelle} (obligatoire pour soumettre)</label>
            <textarea className="input short" id="ts-motif" rows={2} placeholder="Panne, intervention urgente, inventaire…" value={motif} onChange={ev => setMotif(ev.target.value)} style={{ resize: 'vertical' }} />
          </div>
        )}
        {motifSoumis && (st === 'soumise' || st === 'validee') && <Fine>Motif du dépassement : {motifSoumis}</Fine>}
        <Fine>{flow}</Fine>
        {/* Réouverture (t131) : administrateur RH, jamais sa propre feuille ; une feuille transmise se régularise par écart. */}
        {sh?.reouverture && <Fine>{mentionReouverture(sh, iso => fmtShort(new Date(iso)))}{sh.reouverture.motif ? ` — motif : ${sh.reouverture.motif}` : ''}</Fine>}
        {st === 'validee' && admin && emp.id !== soi && (
          <div className="actions-end">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'rouvrirFeuille', empId: emp.id, week: wk })}>Rouvrir la feuille</button>
          </div>
        )}
      </Panel>

      <aside className="card elev-sm panel" style={{ flex: '0 1 320px', minWidth: 280 }}>
        <h3>Récapitulatif paie</h3>
        {autreRegime && <Fine>{cap(regimeNote)} : {c.libelle}. Contrat actuel : {actuel.libelle}.</Fine>}
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
              <textarea className="input short" rows={2} aria-label={motifLibelle} placeholder={`${motifLibelle} (obligatoire pour valider)`} value={motif} onChange={ev => setMotif(ev.target.value)} style={{ resize: 'vertical' }} />
            )}
            <textarea className="input short" rows={2} aria-label="Commentaire" placeholder="Commentaire en cas de renvoi (facultatif)" value={comment} onChange={ev => setComment(ev.target.value)} style={{ resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" disabled={occupe} onClick={reject}>Renvoyer</button>
              <button type="button" className="btn btn-primary" disabled={surAbsence.length + enAttente.length > 0 || plusCouverte || (motifValideur && motifManquant) || occupe}
                onClick={agir(() => run('temps.validate', { ...base, ...(motifValideur ? { motif: motif.trim() } : {}) }))}>Valider la semaine</button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
