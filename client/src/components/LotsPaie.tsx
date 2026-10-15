// Écran Temps, espace RH : transmission des variables de paie à Sage. Mode réel de l'intégration (simulation, fichier
// d'import, API : server/src/integrations/sage.ts), feuilles validées en attente par période de paie, rappels d'une
// période close compris (shared/rules/paie.ts), réglages de paie en vigueur, rubriques et leur code Sage
// (RubriquesPaie.tsx), dernière transmission. Le bouton n'existe qu'en simulation, qui le dit : le fichier d'import
// arrive avec la prochaine étape et l'API n'existe pas ; rien n'est alors marqué transmis. Transmission : administrateur
// RH et gestionnaire de paie ; le service RH et la lecture seule consultent.
import { parse } from '../../../shared/dates.ts';
import { fmt, plural } from '../../../shared/format.ts';
import {
  feuillesParPeriode, MODES_HEURES_SUP, MODES_SAGE, periodeLabel, RATTACHEMENTS, rubriquesAConfirmer, rubriquesPaie, rubriquesTexte,
} from '../../../shared/rules/paie.ts';
import { rubriquesEmises, sagePending } from '../../../shared/rules/temps.ts';
import { transmissionSage } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { RubriquesPaie } from './RubriquesPaie.tsx';
import { Fine, Panel, Pre, SectionLabel, Tag, Two } from './ui.tsx';

/** « le dernier jour du mois », « le 25 du mois ». */
const clotureTexte = (jour: number) => (jour >= 1 && jour <= 28 ? `le ${jour === 1 ? '1er' : jour} du mois` : 'le dernier jour du mois');

export function LotsPaie() {
  const d = useDomain();
  const { session, openDialog } = useStore();
  const { paie } = useRole();
  const mode = session?.integrations.sage ?? 'simulation';
  const s = d.ds.settings;
  const aTransmettre = sagePending(d);
  const pending = aTransmettre.length;
  const groupes = feuillesParPeriode(aTransmettre, s, d.ti);
  const aConfirmer = rubriquesAConfirmer(rubriquesEmises(d, aTransmettre), rubriquesPaie(d.ds.rubriquesPaie));
  const push = d.ds.lastSagePush;
  const salaries = new Set(aTransmettre.map(sh => sh.empId)).size;

  return (
    <Panel head={
      <div className="panel-head" style={{ alignItems: 'center' }}>
        <div>
          <h2>Transmission à Sage Paie</h2>
          <div className="text-muted sub">
            {pending ? `${plural(pending, 'feuille validée', 'feuilles validées')} en attente de transmission (${plural(salaries, 'salarié', 'salariés')})` : 'Toutes les feuilles validées ont été transmises'} · intérimaires (relevé envoyé à l’agence) et cadres dirigeants exclus
          </div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          <Tag cls={mode === 'simulation' ? 'tag-outline' : mode === 'fichier' ? 'tag-neutral' : 'tag-accent'}>{MODES_SAGE[mode].label}</Tag>
          {paie && mode === 'simulation' && (
            <button type="button" className="btn btn-primary" disabled={pending === 0}
              onClick={() => openDialog({ type: 'confirmer', c: transmissionSage(pending, salaries, groupes) })}>Transmettre (simulation)</button>
          )}
        </div>
      </div>
    }>
      <Fine muted={mode === 'simulation'}>{MODES_SAGE[mode].aide}</Fine>
      {!paie && <Fine>Transmission réservée à l’administrateur RH et au gestionnaire de paie.</Fine>}

      {groupes.length > 0 && (
        <div className="scroll-x">
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>Période de paie</th><th className="right">Feuilles</th><th className="right">Salariés</th></tr></thead>
            <tbody>
              {groupes.map(g => (
                <tr key={`${g.periode}|${g.origine ?? ''}`}>
                  <td><Two main={periodeLabel(g.periode)} sub={g.origine ? `rappel : semaines de ${periodeLabel(g.origine)}, période close` : undefined} /></td>
                  <td className="right tnum">{g.feuilles}</td>
                  <td className="right tnum">{g.salaries}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mode !== 'simulation' && aConfirmer.length > 0 && (
        <div className="note-accent">Code Sage à confirmer avant toute transmission : {rubriquesTexte(aConfirmer)}.</div>
      )}
      <Fine>
        Heures validées du lundi au vendredi seulement : absences, déplacements et heures du samedi, du dimanche ou de nuit restent saisis dans Sage.
        {' '}Heures supplémentaires {MODES_HEURES_SUP[s.heuresSupMode].label.toLowerCase()}{s.heuresSupMode === 'repos' && s.heuresSupAccord ? ` (${s.heuresSupAccord})` : ''}, mode figé sur chaque feuille à sa validation
        {' '}· semaine à cheval sur deux mois : {RATTACHEMENTS[s.periodeRattachement].label.toLowerCase()} · clôture des variables {clotureTexte(s.clotureJour)} ; une semaine d’une période close part en rappel. Réglages de l’administrateur RH (Paramètres → Paie).
      </Fine>

      <RubriquesPaie aConfirmer={new Set(aConfirmer.map(r => r.code))} />

      {push && <>
        <SectionLabel>Dernière transmission{push.mode === 'simulation' ? ' (simulation)' : ''}</SectionLabel>
        <Fine>
          {`Le ${fmt(parse(push.envoye_le.slice(0, 10)))} · ${push.periodes?.length ? `${push.periodes.length > 1 ? 'périodes' : 'période'} ${push.periodes.map(periodeLabel).join(', ')}` : `période ${push.periode_paie ?? '—'}`} · ${plural(push.lignes.length, 'ligne', 'lignes')} · dossier ${push.dossier}`}
        </Fine>
        <Pre maxHeight={320}>{JSON.stringify(push, null, 2)}</Pre>
      </>}
    </Panel>
  );
}
