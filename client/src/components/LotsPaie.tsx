// Écran Temps, espace RH : transmission des variables de paie à Sage. Mode réel de l'intégration (simulation ou fichier
// d'import : server/src/integrations/sage.ts), feuilles validées en attente par période de paie, rappels d'une
// période close compris (shared/rules/paie.ts), lots de paie (shared/rules/lots-paie.ts) : génération du lot d'une
// période, téléchargement de son fichier d'import, confirmation de l'import dans Sage (seule à marquer les feuilles
// transmises) ou annulation avant elle, historique. En simulation, la transmission en un clic reste possible. Format du
// fichier, réglages de paie en vigueur, rubriques et leur code Sage (RubriquesPaie.tsx). Lots, fichier et rubriques :
// administrateur RH et gestionnaire de paie ; le service RH et la lecture seule consultent.
import { useState } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { fmtIso, plural } from '../../../shared/format.ts';
import { sansMatriculePaie } from '../../../shared/rules/matricules.ts';
import {
  COLONNES_FICHIER, DECIMALES, ENCODAGES, FORMAT_FICHIER_DEFAUT, feuillesDuLot, PERIMETRE_FICHIER, periodeDeLaFeuille, SEPARATEURS, STATUTS_LOT, totauxTexte,
} from '../../../shared/rules/lots-paie.ts';
import {
  feuillesParPeriode, MODES_HEURES_SUP, MODES_SAGE, periodeLabel, RATTACHEMENTS, rubriquesAConfirmer, rubriquesPaie, rubriquesTexte,
} from '../../../shared/rules/paie.ts';
import { rubriquesEmises, sagePending } from '../../../shared/rules/temps.ts';
import type { LotPaie } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { annulationLot, generationLot, transmissionSage } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { SansMatriculePaie } from './MatriculesPaie.tsx';
import { RubriquesPaie } from './RubriquesPaie.tsx';
import { Btn, Fine, Panel, SectionLabel, Tag, Two } from './ui.tsx';

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
  const aConfirmer = rubriquesAConfirmer(rubriquesEmises(d, aTransmettre), rubriquesPaie(d.ds.rubriquesPaie));
  const salaries = new Set(aTransmettre.map(sh => sh.empId)).size;
  const lots = d.ds.lotsPaie;
  const format = d.ds.formatFichierPaie ?? FORMAT_FICHIER_DEFAUT;
  // Une ligne par période de destination : le lot d'une période emporte aussi les feuilles des périodes antérieures.
  const periodes = [...new Set(groupes.map(g => g.periode))];

  const generer = (periode: string) => {
    const sheets = feuillesDuLot(aTransmettre, periode, s, d.ti);
    const ids = sheets.map(sh => sh.empId);
    openDialog({
      type: 'confirmer', c: generationLot({
        periode, feuilles: sheets.length, salaries: new Set(ids).size, mode,
        rappels: feuillesParPeriode(sheets, s, d.ti).filter(g => g.origine),
        sansMatricule: mode === 'simulation' ? sansMatriculePaie(d.ds.employes, d.ti, ids).map(e => e.nom) : [],
      }),
    });
  };
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
            {pending ? `${plural(pending, 'feuille validée', 'feuilles validées')} en attente de transmission (${plural(salaries, 'salarié', 'salariés')})` : 'Aucune feuille validée en attente : chacune est transmise ou dans un lot'} · intérimaires (relevé envoyé à l’agence) et cadres dirigeants exclus
          </div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          <Tag cls={mode === 'simulation' ? 'tag-outline' : 'tag-neutral'}>{MODES_SAGE[mode].label}</Tag>
          {paie && mode === 'simulation' && (
            <button type="button" className="btn btn-secondary" disabled={pending === 0}
              onClick={() => openDialog({ type: 'confirmer', c: transmissionSage(pending, salaries, groupes) })}>Transmettre (simulation)</button>
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
            <thead><tr><th>Période de paie</th><th className="right">Feuilles</th><th className="right">Salariés</th><th></th></tr></thead>
            <tbody>
              {periodes.map(p => {
                const sheets = aTransmettre.filter(sh => periodeDeLaFeuille(sh.week, s, d.ti) === p);
                const rappels = groupes.filter(g => g.periode === p && g.origine);
                return (
                  <tr key={p}>
                    <td><Two main={periodeLabel(p)} sub={rappels.length ? `dont rappel : ${rappels.map(r => `${plural(r.feuilles, 'feuille', 'feuilles')} de ${periodeLabel(r.origine!)}`).join(', ')}, période close` : undefined} /></td>
                    <td className="right tnum">{sheets.length}</td>
                    <td className="right tnum">{new Set(sheets.map(sh => sh.empId)).size}</td>
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
      {mode !== 'simulation' && aConfirmer.length > 0 && (
        <div className="note-accent">Code Sage à confirmer avant toute génération de lot : {rubriquesTexte(aConfirmer)}.</div>
      )}
      <Fine>
        {PERIMETRE_FICHIER}
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
                  <td><Two main={`n° ${l.id}${l.mode === 'simulation' ? ' · simulation' : ''}`} sub={l.historique ? 'repris d’avant les lots' : `le ${date(l.creation)} · ${l.auteur}`} /></td>
                  <td><Two main={periodeLabel(l.periode)} sub={l.rappels.length ? `rappel de ${l.rappels.map(periodeLabel).join(', ')}` : undefined} /></td>
                  <td className="right"><Two main={<span className="tnum">{l.feuilles.length}</span>} sub={l.historique ? undefined : plural(l.resume.lignes, 'ligne', 'lignes')} /></td>
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
      {lots[0]?.statut === 'transmis' && lots[0].resume.lignes > 0 && <Fine>Dernier lot transmis : {totauxTexte(lots[0].resume)}.</Fine>}

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
