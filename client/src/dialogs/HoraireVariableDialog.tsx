// Écran Référentiels, onglet Horaires : horaire variable (lot 12, chantier C6, étape 2 ; horaires individualisés, art.
// L3121-48 à L3121-52). Plages fixes (présence obligatoire) entourées de plages mobiles, durée de référence d'une journée,
// plafonds du report d'une semaine à l'autre et du cumul (supplétifs 3 h et 10 h ; d'autres valeurs exigent la référence
// de l'accord collectif). Contrôles partagés avec le serveur (shared/rules/horaires-variables.ts, action
// `referentiel.horaire.variable`, service RH).
import { useState } from 'react';
import { fH } from '../../../shared/format.ts';
import { CUMUL_MAX_MIN, REPORT_MAX_SEMAINE_MIN } from '../../../shared/rules/debit-credit.ts';
import { ACCORD_VARIABLE_MAX, controlerHoraireVariable, PLAGES_MAX, TYPES_PLAGE } from '../../../shared/rules/horaires-variables.ts';
import { dureeHoraire, horaireDe, plageTexte } from '../../../shared/rules/horaires.ts';
import type { PlageHoraire } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { CloseButton, Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Minutes → heures saisies (« 7,5 ») ; vide sans valeur. */
const heures = (m: number | null | undefined) => (m == null ? '' : String(Math.round((m / 60) * 100) / 100).replace('.', ','));

export function HoraireVariableDialog({ code }: { code: string }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [h] = useState(() => horaireDe(d.ds.referentiels, code));
  const [variable, setVariable] = useState(!!h?.variable);
  const [plages, setPlages] = useState<PlageHoraire[]>(() => h?.plages?.length ? h.plages : h ? [
    { type: 'mobile', debut: h.debut, fin: '' }, { type: 'fixe', debut: '', fin: '' }, { type: 'mobile', debut: '', fin: h.fin },
  ] : []);
  const [duree, setDuree] = useState(heures(h?.dureeReference));
  const [report, setReport] = useState(heures(h?.reportMaxSemaine));
  const [cumul, setCumul] = useState(heures(h?.cumulMax));
  const [accord, setAccord] = useState(h?.accordVariable ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!h) return <Dialog title="Horaire variable" width={480} actions={<CancelButton label="Fermer" />}><Bloquant>Cet horaire n’existe plus.</Bloquant></Dialog>;

  const saisie = { variable, plages, dureeReference: duree, reportMaxSemaine: report, cumulMax: cumul, accordVariable: accord };
  const { erreurs } = controlerHoraireVariable(h, saisie);
  const changer = (i: number, x: Partial<PlageHoraire>) => setPlages(l => l.map((p, j) => (j === i ? { ...p, ...x } : p)));

  const envoyer = async () => {
    if (busy || (variable && !v.verifier(erreurs.plages, erreurs.dureeReference, erreurs.reportMaxSemaine, erreurs.cumulMax, erreurs.accordVariable))) return;
    setBusy(true);
    const r = await run('referentiel.horaire.variable', { id: h.code, ...saisie });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={`Horaire ${h.code} · horaire variable`} width={600} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer</SubmitButton>
    </>}>
      <Field label="Horaire"><Static>{h.nom} · {plageTexte(h)}, pause {h.pause} min ({fH(dureeHoraire(h))} de travail)</Static></Field>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={variable} onChange={x => setVariable(x.target.checked)} style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          Horaire variable (horaires individualisés)
          <span className="text-muted sub" style={{ display: 'block' }}>Arrivée et départ au choix dans les plages mobiles, présence obligatoire dans les plages fixes ; suppose que le CSE n’y soit pas opposé (art. L3121-48).</span>
        </span>
      </label>
      {variable && <>
        <Field label="Plages, dans l’ordre de la journée" requis erreur={v.erreur(erreurs.plages)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {plages.map((p, i) => (
              <div key={i} className="row-wrap" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
                <select className="input" aria-label={`Type de la plage ${i + 1}`} value={p.type} onChange={x => changer(i, { type: x.target.value as PlageHoraire['type'] })} style={{ maxWidth: 230 }}>
                  {Object.entries(TYPES_PLAGE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <input className="input tnum" aria-label={`Début de la plage ${i + 1}`} inputMode="numeric" maxLength={8} placeholder="09:00" value={p.debut} onChange={x => changer(i, { debut: x.target.value })} style={{ maxWidth: 96 }} />
                <span className="text-muted">–</span>
                <input className="input tnum" aria-label={`Fin de la plage ${i + 1}`} inputMode="numeric" maxLength={8} placeholder="11:30" value={p.fin} onChange={x => changer(i, { fin: x.target.value })} style={{ maxWidth: 96 }} />
                {plages.length > 1 && <CloseButton size={28} label={`Retirer la plage ${i + 1}`} onClick={() => setPlages(l => l.filter((_, j) => j !== i))} />}
              </div>
            ))}
            {plages.length < PLAGES_MAX && (
              <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlages(l => [...l, { type: 'fixe', debut: '', fin: '' }])}>Ajouter une plage</button></div>
            )}
          </div>
        </Field>
        <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
          <Field label="Durée de référence (heures par jour)" htmlFor="hv-duree" erreur={v.erreur(erreurs.dureeReference)}>
            <input className="input tnum" id="hv-duree" inputMode="decimal" maxLength={6} placeholder={heures(Math.round(dureeHoraire(h) * 60))} value={duree} onChange={x => setDuree(x.target.value)} style={{ maxWidth: 120 }} />
          </Field>
          <Field label="Report par semaine (heures)" htmlFor="hv-report" erreur={v.erreur(erreurs.reportMaxSemaine)}>
            <input className="input tnum" id="hv-report" inputMode="decimal" maxLength={6} placeholder={heures(REPORT_MAX_SEMAINE_MIN)} value={report} onChange={x => setReport(x.target.value)} style={{ maxWidth: 120 }} />
          </Field>
          <Field label="Cumul autorisé (heures)" htmlFor="hv-cumul" erreur={v.erreur(erreurs.cumulMax)}>
            <input className="input tnum" id="hv-cumul" inputMode="decimal" maxLength={6} placeholder={heures(CUMUL_MAX_MIN)} value={cumul} onChange={x => setCumul(x.target.value)} style={{ maxWidth: 120 }} />
          </Field>
        </div>
        <Field label="Référence de l’accord collectif" htmlFor="hv-accord" erreur={v.erreur(erreurs.accordVariable)}>
          <input className="input" id="hv-accord" maxLength={ACCORD_VARIABLE_MAX} placeholder="Accord d’entreprise sur les horaires variables du …" value={accord} onChange={x => setAccord(x.target.value)} />
        </Field>
        <Fine>
          Vides : la durée de l’horaire et les plafonds supplétifs ({fH(REPORT_MAX_SEMAINE_MIN / 60)} reportées d’une semaine à l’autre, {fH(CUMUL_MAX_MIN / 60)} de cumul).
          D’autres plafonds exigent la référence de l’accord. Un report dans les plafonds n’est pas une heure supplémentaire (art. L3121-51) ; au-delà,
          l’excédent est signalé au débit-crédit. Les pointages hors d’une plage fixe sont signalés à justifier.
        </Fine>
      </>}
    </Dialog>
  );
}
