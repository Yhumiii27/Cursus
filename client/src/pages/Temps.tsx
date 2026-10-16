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
import { useState, type MouseEvent } from 'react';
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { ABS_ABREGE, TEMPS_TRAVAIL, TS_CLS, TS_LABEL } from '../../../shared/constants.ts';
import type { Domain } from '../../../shared/domain.ts';
import { addD, isFerie, isoWeek, isoWeekYear, mondayOf, parse, wDays } from '../../../shared/dates.ts';
import { cap, equipeLabel, fH, fJ, fmt, fmtShort, key, num, plural } from '../../../shared/format.ts';
import { jourHorsContrat, semaineHorsContrat } from '../../../shared/rules/absences.ts';
import {
  absenceCeJour, calcSheet, cumulAnnuel, demandesAbsence, demandesEnAttenteMessage, employeDeLaFeuille, heuresSurAbsence, heuresSurAbsenceMessage, joursAbsence,
  joursAbsenceTexte, natureAbsence, semaineCouverte, tachesDeLaSemaine, type SheetCalc,
} from '../../../shared/rules/temps.ts';
import { MODES_HEURES_SUP } from '../../../shared/rules/paie.ts';
import type { Employe, FeuilleTemps, ISODate } from '../../../shared/types.ts';
import { CloseButton, Fine, Page, Panel, stop, Tag, Two } from '../components/ui.tsx';
import { LotsPaie } from '../components/LotsPaie.tsx';
import { SuiviFeuilles } from '../components/SuiviFeuilles.tsx';
import { jourLong, nomChamp } from '../components/heures.ts';
import { useAgir } from '../state/actions.ts';
import { suppressionLigne } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { AlerteAutorisation } from '../components/ContratFiche.tsx';
import { RelevesPanel } from './Releves.tsx';
import { ChampHeures, SaisieJour, useVueJour } from './SaisieJour.tsx';

/** Année d'une feuille : celle de sa semaine ISO (son jeudi) ; le cumul annuel ventile une semaine à cheval jour par jour. */
const anneeDe = (week: ISODate) => isoWeekYear(week);

/**
 * Colonne « Total » de la file de validation, selon l'organisation du temps de la feuille.
 * `aRenvoyer` : feuille sans heure dont la semaine n'est plus couverte par une absence, que le serveur ne valide pas.
 * `motifManquant` : durées maximales dépassées sans motif (feuille corrigée par le valideur) ; il se donne en ouvrant la feuille.
 */
function queueTotal(d: Domain, e: Employe, sh: FeuilleTemps): { main: string; sub: string; aRenvoyer?: boolean; motifManquant?: boolean } {
  const t = totalFile(d, e, sh);
  return calcSheet(d, e, sh).depassements.length && !sh.motifDepassement ? { ...t, sub: `${t.sub} · motif du dépassement à indiquer`, motifManquant: true } : t;
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
 * `emp` est le collaborateur tel qu'il était la semaine de la feuille (`employeDeLaFeuille`).
 */
function recapOf(d: Domain, emp: Employe, calc: SheetCalc, week: ISODate): Recap {
  const c = calc.c, tt = TEMPS_TRAVAIL[c.temps];
  const art = tt.article ? ` ${tt.article}.` : '';
  // Heures supplémentaires payées, ou remplacées par un repos (mode figé sur la feuille à sa validation) : la ligne du
  // repos acquis n'apparaît que s'il y en a un ; l'intérimaire est réglé par son agence.
  const recupRows: [string, string][] = c.interim ? [['Récupération', 'géré par l’agence']]
    : calc.modeHS === 'paiement' ? [] : [['Repos compensateur acquis', fH(calc.recup)]];
  const recupAide = c.interim
    ? ' Intérim : heures supplémentaires relevées et réglées par l’agence.'
    : ` ${MODES_HEURES_SUP[calc.modeHS].aide}`;

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
  if (c.partiel) return {
    rows: [['Heures contractuelles', fH(Math.min(calc.total, c.base))], ['Complémentaires +10 %', fH(calc.hc10)], ['Complémentaires +25 %', fH(calc.hc25)]],
    aide: tt.aide + art,
  };
  if (c.hebdo) {
    // Heures incluses au forfait : +25 % jusqu'à la 43e heure, +50 % au-delà (forfait supérieur à 43 h).
    const rows: [string, string][] = [['Heures normales (jusqu’à 35 h)', fH(calc.normal)], ['Incluses au forfait +25 %', fH(calc.incluses25)]];
    if ((c.seuil ?? 0) > 43 || calc.incluses50 > 0) rows.push(['Incluses au forfait +50 %', fH(calc.incluses50)]);
    rows.push(['Supplémentaires +25 %', fH(calc.sup25)], ['Supplémentaires +50 %', fH(calc.sup50)], ...recupRows);
    return { rows, aide: tt.aide + recupAide + art };
  }
  return {
    rows: [['Heures normales', fH(calc.normal)], ['Supplémentaires +25 %', fH(calc.sup25)], ['Supplémentaires +50 %', fH(calc.sup50)], ...recupRows],
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
  const wdays = wDays(wk);

  const inScope = (id: number | null): id is number => id != null && data.employes.some(e => e.id === id);
  const tsId = collab ? me : manager ? (inScope(ui.tsEmp) ? ui.tsEmp : me) : (inScope(ui.tsEmp) ? ui.tsEmp : data.employes[0]?.id ?? null);
  const tsEmp = tsId != null ? d.emp(tsId) : undefined;
  const options = [...data.employes].sort((a, b) => a.nom.localeCompare(b.nom));

  const queue = data.feuilles
    .filter(sh => sh.statut === 'soumise')
    .map(sh => ({ sh, e: d.emp(sh.empId) }))
    .filter((q): q is { sh: FeuilleTemps; e: Employe } => !!q.e && (espaceRh || (manager && d.mgrOf(q.e) === me)));
  const valide = (e: Employe) => (rh && e.id !== soi) || (manager && d.mgrOf(e) === me);

  return (
    <Page
      kicker={`Semaine ${isoWeek(wk)} · ${fmtShort(parse(wdays[0]))} → ${fmt(parse(wdays[4]))}`}
      title="Temps de travail"
      actions={<>
        {!collab && (
          <select className="input" aria-label="Collaborateur" value={String(tsId ?? '')} onChange={ev => setUi({ tsEmp: Number(ev.target.value) })} style={{ width: 'auto', minWidth: 200 }}>
            {options.map(e => <option key={e.id} value={e.id}>{e.nom}</option>)}
          </select>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <button type="button" className="btn btn-ghost btn-icon plain" aria-label="Semaine précédente" title="Semaine précédente" onClick={() => setUi({ weekStart: addD(wk, -7) })}><CaretLeftIcon size={14} /></button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUi({ weekStart: mondayOf(data.today) })}>Cette semaine</button>
          <button type="button" className="btn btn-ghost btn-icon plain" aria-label="Semaine suivante" title="Semaine suivante" onClick={() => setUi({ weekStart: addD(wk, 7) })}><CaretRightIcon size={14} /></button>
        </div>
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
                      <td><Two main={e.nom} sub={equipeLabel(e)} nowrap /></td>
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

      {tsEmp && <AlerteAutorisation e={tsEmp} />}
      {tsEmp && <Sheet key={`${tsEmp.id}|${wk}`} emp={tsEmp} wk={wk} />}

      {espaceRh && <LotsPaie />}

      {rh && <RelevesPanel wk={wk} />}
    </Page>
  );
}

/** Feuille de la semaine d'un collaborateur : grille de saisie et récapitulatif paie. */
function Sheet({ emp, wk }: { emp: Employe; wk: ISODate }) {
  const d = useDomain();
  const data = d.ds;
  const { rh, manager, me, soi } = useRole();
  const { run, openDialog } = useStore();
  const { occupe, agir } = useAgir();
  const [comment, setComment] = useState('');
  // Téléphone, tablette : la feuille se saisit jour par jour (pages/SaisieJour.tsx) ; le PC garde la grille de la semaine.
  const vueJour = useVueJour();

  const wdays = wDays(wk);
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
  const submitLabel = isValidator ? 'Soumettre pour validation' : validator ? 'Soumettre au manager' : 'Soumettre au service RH';
  const base = { empId: emp.id, week: wk };

  const absences = joursAbsence(d, emp.id, wk);
  // Heures restées sur un jour d'absence : à retirer avant soumission et validation.
  const surAbsence = sh ? heuresSurAbsence(d, sh) : [];
  // Demande d'absence en attente : saisie libre, mais à décider avant de valider une feuille qui porte des heures ces jours-là.
  const demandes = demandesAbsence(d), demandeJours = joursAbsence(d, emp.id, wk, demandes);
  const enAttente = sh ? heuresSurAbsence(d, sh, demandes) : [];
  // Semaine d'arrêt, de congés… : aucune heure attendue, la feuille se soumet sans heure.
  const couverte = semaineCouverte(d, emp, wk, sh);
  // Soumise sans heure, la semaine n'est plus couverte (absence annulée ou raccourcie) : à renvoyer, pas à valider.
  const plusCouverte = st === 'soumise' && !(calc.total > 0) && !couverte;
  const days = wdays.map((day, i) => {
    const a = absences[i], dem = demandeJours[i], off = c.jourOff.includes(i), fer = isFerie(day), hors = !!jourHorsContrat(emp, day);
    const m = data.missions.find(x => x.empId === emp.id && x.du <= day && x.au >= day);
    return {
      day, a, locked: fer || !!a || hors, hl: (!!m && !fer && !a) || [...surAbsence, ...enAttente].some(x => x.di === i),
      label: cap(parse(day).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })), long: jourLong(day),
      note: fer ? 'Férié' : hors ? 'Hors contrat'
        : a ? `${ABS_ABREGE[a.type]}${a.statut === 'signalee' ? ' (signalée)' : ''}`
        : dem ? `${cap(natureAbsence(dem.type))} demandé${dem.type === 'RECUP' ? 'e' : ''}` : off ? 'Non travaillé' : m ? `Mission ${m.projet}` : '—',
    };
  });
  const lignes = sh ? sh.lignes : [];
  // Cellule remplie un jour d'absence : signalée (à vider) ; elle reste modifiable pour être vidée, vide elle est verrouillée.
  const alerteDe = (li: number, di: number) => {
    const a = days[di].a;
    return a && num(lignes[li]?.h[di]) > 0 ? `${absenceCeJour(a)} : ${editable ? 'videz la cellule' : 'aucune heure ne devrait être saisie'}` : undefined;
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
  const canSuggest = editable && !correction && tachesDeLaSemaine(d, emp.id, wk).length > 0;
  const missions = data.missions.filter(m => m.empId === emp.id && m.du <= wdays[4] && m.au >= wdays[0]);

  const recap = recapOf(d, empF, calc, wk);
  const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', fontSize: 13, padding: 'var(--space-2) 0', background: 'var(--rule-soft) no-repeat bottom / 100% 1px' } as const;

  // Intérimaire : relevé hebdomadaire à l'agence (le service RH voit s'il a été transmis).
  const releve = data.releves.filter(r => key(r.agence) === key(emp.agence) && r.semaine === wk).at(-1);
  const paie = sh?.sage ? ' · transmise à Sage Paie' : sh?.lotId ? ` · dans le lot de paie n° ${sh.lotId}, import dans Sage à confirmer`
    : c.interim ? (releve ? ` · relevé transmis à l’agence le ${fmtShort(new Date(releve.creation))}` : ' · relevé hebdomadaire à l’agence d’intérim')
    : c.dirigeant ? ' · non transmise à la paie (cadre dirigeant, art. L3111-2)'
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
        {sh?.comment && st === 'rejetee' && <div style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>Retour du manager : {sh.comment}</div>}

        {vueJour ? (
          <SaisieJour wk={wk} days={days} lignes={lignes} perDay={calc.perDay} total={calc.total} editable={editable} occupe={occupe}
            projet={code => d.projet(code)} alerteDe={alerteDe} enregistrer={enregistrer} supprimer={supprimer} />
        ) : (
        <div className="scroll-x">
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr>
              <th>Projet · tâche</th>
              {days.map(x => (
                <th key={x.day} className="center nowrap">
                  <div>{x.label}</div>
                  <div style={{ fontSize: 11, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: x.hl ? 'var(--color-accent-300)' : 'var(--color-neutral-500)' }}>{x.note}</div>
                </th>
              ))}
              <th className="right">Total</th><th></th>
            </tr></thead>
            <tbody>
              {lignes.map((l, li) => (
                <tr key={li}>
                  <td style={{ minWidth: 180 }}>
                    <div><span style={{ color: 'var(--color-accent-300)' }}>{l.projet}</span> · {d.projet(l.projet)}</div>
                    <div className="text-muted sub">{l.tache}</div>
                  </td>
                  {l.h.map((v, di) => {
                    // Chaque cellule est nommée (projet, tâche, jour) ; l'alerte d'absence lui est reliée pour un lecteur d'écran.
                    const alerte = alerteDe(li, di), alerteId = `ts-alerte-${li}-${di}`;
                    return (
                      <td key={di} className="center">
                        <ChampHeures value={num(v)} disabled={!editable || (days[di].locked && !alerte)} label={nomChamp(l, days[di].long)}
                          alerte={alerte} alerteId={alerteId} onCommit={raw => enregistrer(li, di, raw)}
                          style={{ width: 56, textAlign: 'right', padding: '0 var(--space-3)' }} />
                        {alerte && <span id={alerteId} className="sr-only">{alerte}</span>}
                      </td>
                    );
                  })}
                  <td className="right nowrap tnum">{fH(l.h.reduce((n, v) => n + num(v), 0))}</td>
                  <td className="right">{editable && <CloseButton size={28} label={`Supprimer la ligne ${l.projet}`} disabled={occupe} onClick={ev => supprimer(li, ev)} />}</td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 500 }}>Total jour</td>
                {calc.perDay.map((h, i) => (
                  <td key={i} className="center"><span className="tnum nowrap" style={{ color: h > 10 ? 'var(--color-accent-300)' : 'inherit' }}>{h ? fH(h) : '—'}</span></td>
                ))}
                <td className="right nowrap tnum" style={{ fontWeight: 500 }}>{fH(calc.total)}</td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
        )}
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
            {canSuggest && <button type="button" className="btn btn-secondary" disabled={occupe} onClick={agir(() => run('temps.suggest', base))}>Proposer depuis Keystone</button>}
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
              : `Absence ${joursAbsenceTexte(surAbsence)} : des heures y sont saisies${st === 'validee' ? ' — feuille validée, non modifiée rétroactivement' : ''}`}
          </div>
        )}
        {enAttente.length > 0 && st !== 'validee' && <div className="note-accent">{demandesEnAttenteMessage(enAttente, canValidate)}</div>}
        {plusCouverte && <div className="note-accent">Aucune heure et la semaine n’est plus couverte par une absence : renvoyez la feuille pour saisie des heures.</div>}
        {calc.warn.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {calc.warn.map(w => <div key={w} className="note-accent">{w}</div>)}
          </div>
        )}
        {depasse && editable && !correction && (
          <div className="field">
            <label htmlFor="ts-motif">Motif du dépassement (obligatoire pour soumettre)</label>
            <textarea className="input short" id="ts-motif" rows={2} placeholder="Panne, intervention urgente, inventaire…" value={motif} onChange={ev => setMotif(ev.target.value)} style={{ resize: 'vertical' }} />
          </div>
        )}
        {motifSoumis && (st === 'soumise' || st === 'validee') && <Fine>Motif du dépassement : {motifSoumis}</Fine>}
        <Fine>{flow}</Fine>
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
              <textarea className="input short" rows={2} aria-label="Motif du dépassement" placeholder="Motif du dépassement (obligatoire pour valider)" value={motif} onChange={ev => setMotif(ev.target.value)} style={{ resize: 'vertical' }} />
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
