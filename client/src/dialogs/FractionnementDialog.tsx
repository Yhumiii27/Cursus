// Jours de fractionnement d'une période de congés payés (service RH, `conges.fractionnement`, t046) : après la fin de la
// période du congé principal, Cursus propose pour chaque salarié les jours dus (shared/rules/fractionnement.ts) ; le
// service RH les crédite, note la renonciation du salarié (art. L3141-19) ou laisse la ligne pour plus tard. Jamais de
// crédit d'office ; un membre du RH ne décide pas pour lui-même. Une ligne décidée entre-temps (autre onglet, autre
// membre du RH) est ignorée par le serveur, qui le dit dans son message.
import { useMemo, useState } from 'react';
import { equipeLabel, fJ, fmtIso, plural } from '../../../shared/format.ts';
import { finPeriodeCp, periodeCp } from '../../../shared/rules/conges.ts';
import { CREDIT_MAX, etatTexte, fenetrePrincipale, fenetreTexte, fractionnementsAProposer, regleFractionnement, type LigneFractionnement } from '../../../shared/rules/fractionnement.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Empty, Fine, Seg } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Choix du service RH pour une ligne : vide (plus tard), crédit (jours saisis) ou renonciation du salarié. */
interface Choix { decision: 'crediter' | 'renoncer' | ''; jours: string }

const initial = (l: LigneFractionnement): Choix => ({ decision: '', jours: String(l.propose) });

export function FractionnementDialog({ periode }: { periode: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const { soi } = useRole();
  const lignes = useMemo(() => fractionnementsAProposer(d, periode), [d, periode]);
  const [saisis, setChoix] = useState<Record<number, Choix>>({});
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const regle = regleFractionnement(d.ds.settings);
  const max = regle === 'aucun' ? 0 : CREDIT_MAX[regle];
  const choix = (l: LigneFractionnement) => saisis[l.e.id] ?? initial(l);
  const set = (l: LigneFractionnement, patch: Partial<Choix>) => setChoix(c => ({ ...c, [l.e.id]: { ...(c[l.e.id] ?? initial(l)), ...patch } }));
  const decidables = lignes.filter(l => l.e.id !== soi), miennes = lignes.filter(l => l.e.id === soi);
  const decidees = decidables.filter(l => choix(l).decision);

  /** Jours saisis pour un crédit : 1 ou 2 selon la loi ; par demi-journée jusqu'au plafond retenu sous un accord. */
  const erreur = (l: LigneFractionnement): string | null => {
    const c = choix(l);
    if (c.decision !== 'crediter') return null;
    const j = Number(c.jours.replace(',', '.'));
    return !c.jours.trim() || Number.isNaN(j) ? 'Indiquez le nombre de jours.'
      : regle === 'legal' && j !== 1 && j !== 2 ? '1 ou 2 jours (art. L3141-23).'
      : !(j > 0) || j > max || (j * 2) % 1 !== 0 ? `${fJ(max)} au plus, par demi-journée.` : null;
  };
  const rien = !decidees.length ? 'Choisissez le crédit ou la renonciation pour au moins un salarié.' : null;

  const confirm = async () => {
    if (busy || !v.verifier(rien, ...decidees.map(erreur))) return;
    setBusy(true);
    const r = await run('conges.fractionnement', {
      periode,
      lignes: decidees.map(l => {
        const c = choix(l);
        return c.decision === 'renoncer' ? { empId: l.e.id, decision: 'renoncer' } : { empId: l.e.id, decision: 'crediter', jours: Number(c.jours.replace(',', '.')) };
      }),
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  const titre = `Jours de fractionnement — congés payés ${periodeCp(periode)}`;
  if (!lignes.length) {
    return (
      <Dialog title={titre} actions={<CancelButton label="Fermer" />}>
        <p className="text-muted" style={{ margin: 0 }}>Aucun jour de fractionnement à décider sur cette période.</p>
      </Dialog>
    );
  }
  const credites = decidees.filter(l => choix(l).decision === 'crediter').length;

  return (
    <Dialog title={titre} width={720} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer {decidees.length ? plural(decidees.length, 'décision', 'décisions') : 'les décisions'}</SubmitButton>
    </>}>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        Période du congé principal {fenetreTexte(fenetrePrincipale(d.ds.settings, periode))} terminée. Jours du congé principal (4 semaines, 5e exclue) pris
        hors de cette période : 2 jours pour 6 jours ouvrables ou plus, 1 jour pour 3 à 5 (art. L3141-23{regle === 'accord' ? ' ; règle de l’accord d’entreprise à appliquer' : ''}).
        Les jours crédités s’ajoutent aux droits de la période, jusqu’au {fmtIso(finPeriodeCp(periode))}. Le salarié peut y renoncer par écrit (art. L3141-19).
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {decidables.map(l => {
          const c = choix(l);
          return (
            <div key={l.e.id} className="boxed" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14 }}>{l.e.nom}</div>
                  <div className="text-muted sub">{equipeLabel(l.e)} · {etatTexte(l.etat)} · proposé : {fJ(l.propose)}</div>
                </div>
                <Seg name={`fr-${l.e.id}`} label={`Décision pour ${l.e.nom}`} value={c.decision}
                  options={[['', 'Plus tard'], ['crediter', 'Créditer'], ['renoncer', 'Renonciation']]} onChange={x => set(l, { decision: x })} />
              </div>
              {c.decision === 'crediter' && (
                <Field label="Jours crédités" htmlFor={`fr-j-${l.e.id}`} erreur={v.erreur(erreur(l))}>
                  <input className="input" id={`fr-j-${l.e.id}`} type="text" inputMode="decimal" value={c.jours} onChange={ev => set(l, { jours: ev.target.value })} style={{ maxWidth: 120 }} />
                </Field>
              )}
              {c.decision === 'renoncer' && <Fine>Renonciation écrite du salarié, à conserver dans son dossier : aucun jour crédité.</Fine>}
            </div>
          );
        })}
        {miennes.map(l => (
          <div key={l.e.id} className="boxed">
            <div style={{ fontSize: 14 }}>{l.e.nom}</div>
            <div className="text-muted sub">Vos jours de fractionnement ({fJ(l.propose)} proposés) : décision par un autre membre du service RH.</div>
          </div>
        ))}
        {!decidables.length && <Empty pad="sm">Aucune ligne à décider par vous.</Empty>}
      </div>
      {rien && v.tente && <Bloquant>{rien}</Bloquant>}
      <Fine>
        À la validation : {plural(credites, 'crédit', 'crédits')}, {plural(decidees.length - credites, 'renonciation', 'renonciations')} ; une ligne laissée
        « Plus tard » reste proposée. Chaque décision est tracée et définitive.
      </Fine>
    </Dialog>
  );
}
