// Écran Temps, espace RH : transmission des variables de paie à Sage. Mode réel de l'intégration (simulation ou fichier
// d'import : server/src/integrations/sage.ts), feuilles validées en attente par période de paie, rappels d'une
// période close compris (shared/rules/paie.ts), lots de paie (shared/rules/lots-paie.ts) : génération du lot d'une
// période, téléchargement de son fichier d'import, confirmation de l'import dans Sage (seule à marquer les feuilles
// transmises) ou annulation avant elle, historique. En simulation, la transmission en un clic reste possible. Format du
// fichier, réglages de paie en vigueur, rubriques et leur code Sage (RubriquesPaie.tsx). Lots, fichier et rubriques :
// administrateur RH et gestionnaire de paie ; le service RH et la lecture seule consultent.
// Absences (t028, réglage `absencesFichierPaie`) : absences en attente par période, calculées par le serveur
// (`absencesPaie` de l'instantané, shared/rules/absences-paie.ts), dans le lot avec les feuilles ; export des variables
// de la période (VariablesPaie.tsx). Feuilles rouvertes après leur transmission (t131) : « à régulariser » dans l'attente,
// lots « correctifs » dans l'historique (shared/rules/regularisation.ts).
// de la période (VariablesPaie.tsx). Soldes de sortie (t128) : photographiés à la sortie, dans le lot du mois de la
// sortie quand les rubriques de sortie sont actives (shared/rules/solde-sortie.ts), sinon à saisir dans Sage.
// Lot 6 : déplacements en attente (t031) et éléments « à saisir dans Sage » des lots (ElementsLotPaie.tsx).
import { useState } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { fmtIso, plural } from '../../../shared/format.ts';
import { absencesDansLeFichier, absencesDuLot } from '../../../shared/rules/absences-paie.ts';
import { sansMatriculePaie } from '../../../shared/rules/matricules.ts';
import {
  COLONNES_FICHIER, DECIMALES, ENCODAGES, estCorrectif, FORMAT_FICHIER_DEFAUT, feuillesDuLot, perimetreFichier, periodeDeLaFeuille, SEPARATEURS, STATUTS_LOT, totauxTexte,
} from '../../../shared/rules/lots-paie.ts';
import {
  feuillesParPeriode, MODES_HEURES_SUP, MODES_SAGE, periodeLabel, RATTACHEMENTS, rubriquesAConfirmer, rubriquesPaie, rubriquesTexte,
} from '../../../shared/rules/paie.ts';
import { elementsSorties, quantitesSortie, sortiesDuContenu } from '../../../shared/rules/solde-sortie.ts';
import { rubriquesEmises, sagePending } from '../../../shared/rules/temps.ts';
import { aRegulariser, modeRegularisation, MODES_REGULARISATION } from '../../../shared/rules/regularisation.ts';
import type { LotPaie } from '../../../shared/types.ts';
import { elementsRachats } from '../../../shared/rules/forfait-jours.ts';
import { RachatsEnAttente } from './ForfaitJours.tsx';
import { AstreintesEnAttente } from './Astreintes.tsx';
import { maintenant } from './astreintes-etat.ts';
import { elementsAstreintes } from '../../../shared/rules/astreintes-paie.ts';
import { api } from '../api.ts';
import { annulationLot, generationLot, transmissionSage } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { SansMatriculePaie } from './MatriculesPaie.tsx';
import { RubriquesPaie } from './RubriquesPaie.tsx';
import { Btn, Fine, Panel, SectionLabel, Tag, Two } from './ui.tsx';
import { VariablesPaie } from './VariablesPaie.tsx';
import { ASaisirDuLot, DeplacementsEnAttente, resumeASaisir } from './ElementsLotPaie.tsx';

/** « le dernier jour du mois », « le 25 du mois ». */
const clotureTexte = (jour: number) => (jour >= 1 && jour <= 28 ? `le ${jour === 1 ? '1er' : jour} du mois` : 'le dernier jour du mois');
/** Lots affichés avant « Afficher tout l'historique ». */
const LOTS_VISIBLES = 8;
const date = (iso: string | null) => (iso ? fmtIso(iso.slice(0, 10)) : '—');

export function LotsPaie() {
  const d = useDomain();
  const { session, openDialog, notify, refresh } = useStore();
  const { paie } = useRole();
  const [tout, setTout] = useState(false);
  const [telechargement, setTelechargement] = useState<number | null>(null);
  const mode = session?.integrations.sage ?? 'simulation';
  const s = d.ds.settings;
  const aTransmettre = sagePending(d);
  const pending = aTransmettre.length;
  const groupes = feuillesParPeriode(aTransmettre, s, d.ti);
  const avecAbsences = absencesDansLeFichier(s);
  const absences = avecAbsences ? d.ds.absencesPaie ?? [] : [];
  const nbAbsences = absences.reduce((n, g) => n + g.absences, 0);
  // Soldes de sortie en attente d'un lot (rubriques de sortie actives), et ceux qui restent à saisir dans Sage.
  const sorties = elementsSorties(d, '9999-12', rubriquesPaie(d.ds.rubriquesPaie));
  const sortiesDe = (periode: string) => sortiesDuContenu(sorties.filter(x => x.periode <= periode));
  const sortiesASaisir = (d.ds.soldesSortie ?? []).filter(x => x.lotId == null && !x.sage && quantitesSortie(x.etat).length && !sorties.some(y => y.sortie === x.id));
  // Déplacements en attente (t031, calculés par le serveur) : ceux du fichier comptent dans les codes à confirmer.
  const deplacements = d.ds.deplacementsPaie?.elements ?? [];
  // Jours rachetés d'un forfait jours (t043) : JREN active, ou à saisir dans Sage ; leur période compte comme les autres.
  const rachats = elementsRachats(d, '9999-12', rubriquesPaie(d.ds.rubriquesPaie));
  // Astreintes terminées (t049) : AST_H et AST_PER actives, ou à saisir dans Sage.
  const astreintes = elementsAstreintes(d, '9999-12', rubriquesPaie(d.ds.rubriquesPaie), maintenant(d.ti));
  const aConfirmer = rubriquesAConfirmer([...rubriquesEmises(d, aTransmettre), ...absences.flatMap(g => g.rubriques), ...sorties.map(x => x.rubrique), ...deplacements.filter(x => !x.aSaisir).map(x => x.rubrique), ...rachats.filter(x => x.codeSage).map(x => x.rubrique), ...astreintes.filter(x => x.codeSage).map(x => x.rubrique)], rubriquesPaie(d.ds.rubriquesPaie));
  // Absences sous une rubrique désactivée : leur nature reste à saisir dans Sage (liste du résumé du lot).
  const absencesASaisir = [...new Set(absences.flatMap(g => g.rubriques))].filter(r => !rubriquesPaie(d.ds.rubriquesPaie).find(t => t.code === r)?.active);
  const salaries = new Set(aTransmettre.map(sh => sh.empId)).size;
  // Feuilles rouvertes après leur transmission, revalidées : seul leur écart partira (lot correctif, t131).
  const regularisations = aTransmettre.filter(aRegulariser).length;
  const lots = d.ds.lotsPaie;
  const format = d.ds.formatFichierPaie ?? FORMAT_FICHIER_DEFAUT;
  const perimetre = perimetreFichier(avecAbsences, s.deplacementsFichierPaie);
  // Une ligne par période de destination : le lot d'une période emporte aussi les feuilles et absences des périodes antérieures.
  const periodes = [...new Set([...groupes.map(g => g.periode), ...absences.map(g => g.periode), ...sorties.map(x => x.periode), ...deplacements.map(x => x.periode), ...rachats.map(x => x.periode), ...astreintes.map(x => x.periode)])].sort();

  const generer = (periode: string) => {
    const toutes = feuillesDuLot(aTransmettre, periode, s, d.ti);
    // « Annule et remplace » : le lot correctif ne porte que les régularisations, le reste attend le lot suivant (serveur :
    // selectionRemplace, server/src/regularisation-paie.ts).
    const seul = modeRegularisation(format) === 'remplace' && toutes.some(aRegulariser);
    const sheets = seul ? toutes.filter(aRegulariser) : toutes;
    const abs = seul ? null : absencesDuLot(absences, periode);
    const so = seul ? [] : sortiesDe(periode);
    const dep = seul ? [] : deplacements.filter(x => x.periode <= periode);
    const ids = [...sheets.map(sh => sh.empId), ...(abs?.empIds ?? []), ...so.map(x => x.empId), ...dep.map(x => x.empId)];
    openDialog({
      type: 'confirmer', c: generationLot({
        periode, feuilles: sheets.length, salaries: new Set(ids).size, mode, perimetre, absences: abs, sorties: so.length,
        deplacements: dep.length ? { salaries: new Set(dep.map(x => x.empId)).size, aSaisir: dep.filter(x => x.aSaisir).length } : undefined,
        correctifs: sheets.filter(aRegulariser).length, regularisation: modeRegularisation(format), enAttente: seul ? toutes.length - sheets.length : 0,
        rappels: feuillesParPeriode(sheets, s, d.ti).filter(g => g.origine),
        sansMatricule: mode === 'simulation' ? sansMatriculePaie(d.ds.employes, d.ti, ids).map(e => e.nom) : [],
      }),
    });
  };
  // Simulation en un clic : toutes les feuilles en attente, et les absences jusqu'à la dernière de leurs périodes.
  const derniere = groupes.map(g => g.periode).sort().at(-1);
  const absencesSimulation = derniere ? absencesDuLot(absences, derniere) : null;
  const telecharger = async (lot: LotPaie) => {
    setTelechargement(lot.id);
    try {
      await api.fichierLotPaie(lot.id);
      notify(`Fichier d’import du lot n° ${lot.id} téléchargé — téléchargement tracé dans le journal`);
      await refresh();
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setTelechargement(null);
    }
  };

  return (
    <Panel head={
      <div className="panel-head" style={{ alignItems: 'center' }}>
        <div>
          <h2>Transmission à Sage Paie</h2>
          <div className="text-muted sub">
            {pending ? `${plural(pending, 'feuille validée', 'feuilles validées')} en attente de transmission (${plural(salaries, 'salarié', 'salariés')})${regularisations ? `, dont ${plural(regularisations, 'feuille rouverte', 'feuilles rouvertes')} à régulariser` : ''}` : 'Aucune feuille validée en attente : chacune est transmise ou dans un lot'} · intérimaires (relevé envoyé à l’agence) et cadres dirigeants exclus
            {avecAbsences && ` · ${nbAbsences ? `${plural(nbAbsences, 'absence', 'absences')} en attente` : 'aucune absence en attente'}`}
          </div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          <Tag cls={mode === 'simulation' ? 'tag-outline' : 'tag-neutral'}>{MODES_SAGE[mode].label}</Tag>
          {paie && mode === 'simulation' && (
            <button type="button" className="btn btn-secondary" disabled={pending === 0}
              onClick={() => openDialog({ type: 'confirmer', c: transmissionSage(pending, salaries, groupes, perimetre, absencesSimulation) })}>Transmettre (simulation)</button>
          )}
        </div>
      </div>
    }>
      <Fine muted={mode === 'simulation'}>{MODES_SAGE[mode].aide}</Fine>
      {!paie && <Fine>Lots, fichier d’import et transmission réservés à l’administrateur RH et au gestionnaire de paie.</Fine>}
      <SansMatriculePaie empIds={aTransmettre.map(sh => sh.empId)} />

      {periodes.length > 0 && (
        <div className="scroll-x">
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>Période de paie</th><th className="right">Feuilles</th>{avecAbsences && <th className="right">Absences</th>}<th className="right">Salariés</th><th></th></tr></thead>
            <tbody>
              {periodes.map(p => {
                const sheets = aTransmettre.filter(sh => periodeDeLaFeuille(sh.week, s, d.ti) === p);
                const rappels = groupes.filter(g => g.periode === p && g.origine);
                const abs = absences.find(g => g.periode === p);
                const rappelsAbs = abs?.rappels.length ? [`absences de ${abs.rappels.map(periodeLabel).join(', ')}`] : [];
                const textes = [...rappels.map(r => `${plural(r.feuilles, 'feuille', 'feuilles')} de ${periodeLabel(r.origine!)}`), ...rappelsAbs];
                return (
                  <tr key={p}>
                    <td><Two main={periodeLabel(p)} sub={textes.length ? `dont rappel : ${textes.join(', ')}, période close` : undefined} /></td>
                    <td className="right">
                      <Two main={<span className="tnum">{sheets.length}</span>} sub={sheets.some(aRegulariser) ? plural(sheets.filter(aRegulariser).length, 'régularisation', 'régularisations') : undefined} />
                    </td>
                    {avecAbsences && (
                      <td className="right">
                        <Two main={<span className="tnum">{abs?.absences ?? 0}</span>} sub={abs?.regularisations ? plural(abs.regularisations, 'régularisation', 'régularisations') : undefined} />
                      </td>
                    )}
                    <td className="right tnum">{new Set([...sheets.map(sh => sh.empId), ...(abs?.empIds ?? []), ...sorties.filter(x => x.periode === p).map(x => x.empId), ...deplacements.filter(x => x.periode === p).map(x => x.empId)]).size}</td>
                    <td className="right">
                      {paie && (
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => generer(p)}>
                          {mode === 'simulation' ? 'Générer le lot (essai)' : 'Générer le fichier'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {(sorties.length > 0 || sortiesASaisir.length > 0) && (
        <Fine>
          {sorties.length > 0 && `Soldes de sortie dans le prochain lot de leur période : ${sortiesDuContenu(sorties).map(x => `${d.personName(x.empId)} (${periodeLabel(sorties.find(y => y.sortie === x.id)!.periode)})`).join(', ')}. `}
          {sortiesASaisir.length > 0 && `${plural(sortiesASaisir.length, 'solde de sortie', 'soldes de sortie')} à saisir dans Sage (rubriques de sortie désactivées) : ${sortiesASaisir.map(x => d.personName(x.empId)).join(', ')}.`}
        </Fine>
      )}
      <DeplacementsEnAttente />
      <RachatsEnAttente />
      <AstreintesEnAttente />
      {absencesASaisir.length > 0 && <Fine>Absences sous une rubrique désactivée ({absencesASaisir.join(', ')}) : leur nature est à saisir dans Sage ; chaque lot les liste dans son résumé.</Fine>}
      {mode !== 'simulation' && aConfirmer.length > 0 && (
        <div className="note-accent">Code Sage à confirmer avant toute génération de lot : {rubriquesTexte(aConfirmer)}.</div>
      )}
      <Fine>
        {perimetre}
        {avecAbsences && ' Une absence annulée, raccourcie ou requalifiée après sa transmission part en régularisation (quantité négative) dans le lot suivant.'}
        {' '}Une feuille rouverte après sa transmission (administrateur RH, motif obligatoire) puis revalidée part en lot correctif : {MODES_REGULARISATION[modeRegularisation(format)].label.toLowerCase()} (format du fichier).
        {' '}Heures supplémentaires {MODES_HEURES_SUP[s.heuresSupMode].label.toLowerCase()}{s.heuresSupMode === 'repos' && s.heuresSupAccord ? ` (${s.heuresSupAccord})` : ''}, mode figé sur chaque feuille à sa validation
        {' '}· semaine à cheval sur deux mois : {RATTACHEMENTS[s.periodeRattachement].label.toLowerCase()} · clôture des variables {clotureTexte(s.clotureJour)} ; une semaine d’une période close part en rappel. Réglages de l’administrateur RH (Paramètres → Paie).
      </Fine>

      <SectionLabel>Lots de paie</SectionLabel>
      {lots.length === 0 ? <Fine>Aucun lot pour le moment.</Fine> : (
        <div className="scroll-x">
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>Lot</th><th>Période</th><th className="right">Feuilles</th><th>État</th><th>Accusé</th><th></th></tr></thead>
            <tbody>
              {(tout ? lots : lots.slice(0, LOTS_VISIBLES)).map(l => (
                <tr key={l.id}>
                  <td>
                    <Two main={<>{`n° ${l.id}${l.mode === 'simulation' ? ' · simulation' : ''}`}{estCorrectif(l) && <> <Tag cls="tag-accent">Correctif</Tag></>}</>}
                      sub={l.historique ? 'repris d’avant les lots' : `le ${date(l.creation)} · ${l.auteur}${l.correctifs?.length ? ` · ${plural(l.correctifs.length, 'feuille régularisée', 'feuilles régularisées')}` : ''}`} />
                  </td>
                  <td><Two main={periodeLabel(l.periode)} sub={l.rappels.length ? `rappel de ${l.rappels.map(periodeLabel).join(', ')}` : undefined} /></td>
                  <td className="right">
                    <Two main={<span className="tnum">{l.feuilles.length}</span>}
                      sub={l.historique ? undefined : [l.absences?.length ? plural(l.absences.length, 'absence', 'absences') : '', l.sorties?.length ? plural(l.sorties.length, 'solde de sortie', 'soldes de sortie') : '', l.deplacements?.length ? plural(l.deplacements.length, 'séjour', 'séjours') : '', plural(l.resume.lignes, 'ligne', 'lignes'), l.resume.aSaisir?.length ? resumeASaisir(l.resume.aSaisir) : ''].filter(Boolean).join(' · ')} />
                  </td>
                  <td>
                    <Two main={<Tag cls={STATUTS_LOT[l.statut].cls}>{STATUTS_LOT[l.statut].label}</Tag>}
                      sub={l.statut === 'genere' ? (l.telechargeLe ? `fichier téléchargé le ${date(l.telechargeLe)}` : l.mode === 'simulation' ? undefined : 'fichier à télécharger') : undefined} />
                  </td>
                  <td>
                    {l.statut === 'transmis' && <Two main={`le ${date(l.confirmeLe)}`} sub={`${l.confirmePar ?? ''}${l.reference ? ` · réf. ${l.reference}` : ''}`} />}
                    {l.statut === 'annule' && <Two main={`annulé le ${date(l.annuleLe)}`} sub={l.annulePar ?? undefined} />}
                    {l.statut === 'genere' && <span className="text-muted">—</span>}
                  </td>
                  <td className="right">
                    {paie && (
                      <div className="actions-end">
                        {l.statut !== 'annule' && !l.historique && (
                          <Btn small icon={<DownloadSimpleIcon size={14} />} disabled={telechargement === l.id} onClick={() => telecharger(l)} title={`Fichier d’import du lot n° ${l.id}`}>Fichier</Btn>
                        )}
                        {l.statut === 'genere' && <>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'lotImport', id: l.id })}>
                            {l.mode === 'simulation' ? 'Marquer transmis' : 'Confirmer l’import'}
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: annulationLot(l) })}>Annuler</button>
                        </>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lots.length > LOTS_VISIBLES && (
        <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setTout(x => !x)}>{tout ? 'Afficher les derniers lots' : `Afficher tout l’historique (${lots.length} lots)`}</button></div>
      )}
      {lots[0]?.statut === 'transmis' && lots[0].resume.lignes > 0 && (
        <Fine>
          Dernier lot transmis : {totauxTexte(lots[0].resume) || 'aucune heure'}
          {/* Codes d'absence : droit « paie » seulement (vides sinon, server/src/dataset.ts). */}
          {lots[0].resume.absences && ` · absences : ${totauxTexte({ ...lots[0].resume, rubriques: lots[0].resume.absences.rubriques }) || plural(lots[0].resume.absences.elements, 'élément', 'éléments')}`}.
        </Fine>
      )}
      {/* Liste nominative « à saisir dans Sage » : lots à confirmer, et le dernier lot transmis. */}
      {lots.filter((l, i) => !l.historique && (l.statut === 'genere' || (l.statut === 'transmis' && i === lots.findIndex(x => x.statut === 'transmis')))).map(l => <ASaisirDuLot key={l.id} lot={l} />)}
      {paie && <VariablesPaie periodes={[...new Set([...periodes, ...lots.filter(l => l.statut !== 'annule' && !l.historique).map(l => l.periode)])].sort().reverse()} />}

      <div className="item-head" style={{ alignItems: 'center' }}>
        <SectionLabel>Fichier d’import</SectionLabel>
        {paie && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'formatFichier' })}>Modifier le format</button>}
      </div>
      <Fine>
        Colonnes : {format.colonnes.map(c => COLONNES_FICHIER[c].replace(/^./, x => x.toLowerCase())).join(', ')} · séparateur {SEPARATEURS[format.separateur].toLowerCase()} · période {format.formatPeriode}
        {format.colonnes.some(c => c === 'debut' || c === 'fin') ? ` · dates ${format.formatDate}` : ''}
        {' '}· décimale {DECIMALES[format.decimale].toLowerCase()} · {format.entete ? 'avec' : 'sans'} ligne d’en-tête · encodage {ENCODAGES[format.encodage]}. Une ligne par salarié, période et rubrique ;
        {' '}le gestionnaire de paie ajuste le format au modèle d’import de son Sage. Chaque téléchargement est tracé dans le journal.
      </Fine>

      <RubriquesPaie aConfirmer={new Set(aConfirmer.map(r => r.code))} />
    </Panel>
  );
}
