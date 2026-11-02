// Paramètres → Planning d'équipe (lot 12, chantier C5, étape 2 ; shared/rules/planning-controles.ts) : activation du module
// (désactivé jusqu'à l'avis du CSE, art. L2312-8), délai de prévenance (7 jours à défaut d'accord, art. L3121-47), repos
// quotidien réduit par l'accord en travail posté (9 h au moins, jamais pour un mineur), durées du travailleur de nuit (8 h et
// 40 h, jusqu'à 12 h et 44 h par accord), référence de l'accord (exigée dès qu'une valeur s'écarte de la loi : COHERENCE de
// shared/reglages.ts), planning des collègues visible du salarié (fermé par défaut : leurs postes planifiés seulement,
// jamais leurs absences), et reprise des équipes par quart en groupes de roulement, proposée une fois le module activé.
// Date de l'avis du CSE (`planningCseLe`) : notée avant l'activation, qui la suppose (COHERENCE, comme le badgeage).
// Réglages de l'administrateur RH ; les autres profils de l'espace RH consultent. Les cases s'enregistrent aussitôt ; les
// valeurs et la référence de l'accord, ensemble, au bouton « Enregistrer ».
import { useState } from 'react';
import {
  DELAI_PREVENANCE_PLANNING, DELAI_PREVENANCE_PLANNING_MIN, MSG_AVIS_CSE_PLANNING, NUIT_JOUR_ACCORD_MAX, NUIT_JOUR_LEGAL, NUIT_MOYENNE_ACCORD_MAX, NUIT_MOYENNE_LEGALE, planningHorsLoi,
  REPOS_QUOTIDIEN_ACCORD_MIN,
} from '../../../../shared/rules/planning-controles.ts';
import { equipesParQuart } from '../../../../shared/rules/planning-reprise.ts';
import { fmtIso } from '../../../../shared/format.ts';
import { REPOS_QUOTIDIEN } from '../../../../shared/rules/repos-nuit.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, NoteAccent, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useData, useStore } from '../../state/store.tsx';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

/** Valeurs réglables : clé, libellé, bornes. */
const VALEURS = [
  ['planningDelaiPrevenance', 'Délai de prévenance (jours)', DELAI_PREVENANCE_PLANNING_MIN, 60],
  ['planningReposQuotidienAccord', 'Repos quotidien de l’accord (heures)', REPOS_QUOTIDIEN_ACCORD_MIN, REPOS_QUOTIDIEN],
  ['planningNuitJour', 'Poste de nuit au plus (heures)', NUIT_JOUR_LEGAL, NUIT_JOUR_ACCORD_MAX],
  ['planningNuitMoyenne', 'Moyenne du travailleur de nuit sur 12 semaines (heures)', NUIT_MOYENNE_LEGALE, NUIT_MOYENNE_ACCORD_MAX],
] as const;
type Cle = typeof VALEURS[number][0];
const valeursDe = (s: SectionProps['s']) => Object.fromEntries(VALEURS.map(([k]) => [k, String(s[k])])) as Record<Cle, string>;

export function Planning({ s }: SectionProps) {
  const { admin, espaceRh, rh } = useRole();
  const { openDialog } = useStore();
  const data = useData();
  const save = useEnregistrerReglages();
  const [valeurs, setValeurs] = useState(() => valeursDe(s));
  const [accord, setAccord] = useState(s.planningAccord);
  const [cseLe, setCseLe] = useState(s.planningCseLe ?? '');
  const [tente, setTente] = useState(false);
  // Activation demandée sans date d'avis du CSE enregistrée : refus à l'écran, sous la case.
  const [sansAvis, setSansAvis] = useState(false);
  const [busy, setBusy] = useState(false);
  // Réglages changés ailleurs (enregistrement, autre administrateur) : la saisie repart des valeurs en vigueur.
  const cle = `${VALEURS.map(([k]) => s[k]).join('|')}|${s.planningAccord}|${s.planningCseLe ?? ''}`;
  const [source, setSource] = useState(cle);
  if (source !== cle) { setSource(cle); setValeurs(valeursDe(s)); setAccord(s.planningAccord); setCseLe(s.planningCseLe ?? ''); setTente(false); setSansAvis(false); }
  if (!espaceRh) return null;

  const erreurs = Object.fromEntries(VALEURS.map(([k, , min, max]) => {
    const v = valeurs[k].trim(), n = Number(v);
    return [k, !/^\d{1,2}$/.test(v) || n < min || n > max ? `Un nombre entier de ${min} à ${max}.` : null];
  })) as Record<Cle, string | null>;
  const nombres = Object.fromEntries(VALEURS.map(([k]) => [k, Number(valeurs[k])])) as Record<Cle, number>;
  const erreurAccord = !Object.values(erreurs).some(Boolean) && planningHorsLoi(nombres) && !accord.trim()
    ? 'Un délai de moins de 7 jours, un repos quotidien réduit ou d’autres durées du travail de nuit supposent un accord collectif : indiquez sa référence.' : null;
  // Date de l'avis : facultative tant que le module est désactivé ; jamais effacée quand il est actif.
  const erreurCse = cseLe && !/^\d{4}-\d{2}-\d{2}$/.test(cseLe) ? 'Une date (jour, mois, année).'
    : !cseLe && s.planningActif ? 'Module activé : la date de l’avis du CSE reste exigée.' : null;
  const modifie = VALEURS.some(([k]) => nombres[k] !== s[k]) || accord.trim() !== s.planningAccord || (cseLe || null) !== s.planningCseLe;
  const enregistrer = async () => {
    const erreur = [...VALEURS.map(([k]) => [`pla-${k}`, erreurs[k]] as const), ['pla-accord', erreurAccord] as const, ['pla-cse', erreurCse] as const].find(([, e]) => e);
    if (erreur) { setTente(true); document.getElementById(erreur[0])?.focus(); return; }
    setBusy(true);
    await save({ ...nombres, planningAccord: accord.trim(), planningCseLe: cseLe || null });
    setBusy(false);
  };
  const activer = (oui: boolean) => {
    if (oui && !s.planningCseLe) { setSansAvis(true); document.getElementById('pla-cse')?.focus(); return; }
    setSansAvis(false);
    void save({ planningActif: oui });
  };
  const quarts = equipesParQuart(data.referentiels.equipes);

  return (
    <Panel title="Planning d’équipe" style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.planningActif} disabled={!admin} onChange={e => activer(e.target.checked)} aria-describedby={sansAvis ? 'pla-sans-avis' : undefined}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          Activer le planning d’équipe
          <span className="text-muted sub" style={{ display: 'block' }}>
            Cycles de roulement, planning publié aux salariés, échanges de poste. Les cycles et les besoins de poste se préparent avant (Référentiels).
          </span>
        </span>
      </label>
      {sansAvis && <p className="field-erreur" id="pla-sans-avis" role="alert">{MSG_AVIS_CSE_PLANNING} : notez-la ci-dessous et enregistrez, puis activez.</p>}
      {!s.planningActif && <NoteAccent>Module désactivé : l’organisation en cycles et l’outil de planning relèvent de la consultation du CSE (art. L2312-8). Activez-le après son avis.</NoteAccent>}
      {s.planningActif && s.planningCseLe && <Fine>Activé après l’avis du CSE du {fmtIso(s.planningCseLe)}.</Fine>}
      <Field label={<>Date de l’avis du CSE{!s.planningActif && <span className="who"> · exigée pour activer</span>}</>} htmlFor="pla-cse" requis={s.planningActif} erreur={(tente || sansAvis) && erreurCse}>
        <input className="input" id="pla-cse" type="date" value={cseLe} disabled={!admin} onChange={e => setCseLe(e.target.value)} style={{ maxWidth: 200 }} />
      </Field>

      <div className="grid-2">
        {VALEURS.map(([k, label]) => (
          <Field key={k} label={label} htmlFor={`pla-${k}`} requis erreur={tente && erreurs[k]}>
            <input className="input tnum" id={`pla-${k}`} inputMode="numeric" value={valeurs[k]} disabled={!admin} maxLength={2}
              onChange={e => setValeurs({ ...valeurs, [k]: e.target.value })} style={{ maxWidth: 120 }} />
          </Field>
        ))}
      </div>
      <Field label={<>Référence de l’accord sur le planning{!planningHorsLoi(nombres) && <span className="who"> · facultatif</span>}</>} htmlFor="pla-accord"
        requis={planningHorsLoi(nombres)} erreur={tente && erreurAccord}>
        <input className="input" id="pla-accord" maxLength={120} placeholder="Accord d’entreprise sur le travail posté du …" value={accord} disabled={!admin} onChange={e => setAccord(e.target.value)} />
      </Field>
      {admin && modifie && <div className="actions-end"><Btn variant="primary" disabled={busy} onClick={enregistrer}>Enregistrer les valeurs</Btn></div>}
      <Fine>
        Valeurs de la loi par défaut : délai de prévenance de {DELAI_PREVENANCE_PLANNING} jours (art. L3121-47), repos quotidien de {REPOS_QUOTIDIEN} h (art. L3131-1 ; un accord
        peut le ramener à {REPOS_QUOTIDIEN_ACCORD_MIN} h en travail posté, jamais pour un mineur, avec un repos compensateur), poste de nuit de {NUIT_JOUR_LEGAL} h et moyenne
        de {NUIT_MOYENNE_LEGALE} h sur 12 semaines (art. L3122-6 et L3122-7). Sous le délai de prévenance, la publication exige le motif des circonstances
        exceptionnelles, communiqué aux salariés.
      </Fine>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.planningCollegues} disabled={!admin} onChange={e => save({ planningCollegues: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          Montrer au salarié les postes planifiés de ses collègues d’équipe
          <span className="text-muted sub" style={{ display: 'block' }}>
            Décoché par défaut : chacun ne voit que son planning et propose un échange en nommant le collègue. Coché : nom et horaire des postes publiés de
            l’équipe, jamais une absence ni un repos. Informez les salariés avant de l’ouvrir.
          </span>
        </span>
      </label>

      {s.planningActif && rh && (
        <div className="list-row">
          <div className="grow">
            <div>Reprise des équipes par quart</div>
            <div className="text-muted sub">
              Les équipes créées par quart (2x8, 3x8) pour la couverture minimale deviennent les groupes d’un cycle : chaque membre y est affecté.
              {quarts.length ? ` Repérées : ${quarts.map(x => `${x.parente} (${x.equipes.join(', ')})`).join(' ; ')}.` : ' Aucune équipe par quart repérée : choisissez les équipes à reprendre.'}
            </div>
          </div>
          <Btn small onClick={() => openDialog({ type: 'planningReprise' })}>Reprendre…</Btn>
        </div>
      )}
    </Panel>
  );
}
