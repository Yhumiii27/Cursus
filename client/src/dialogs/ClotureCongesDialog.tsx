// Clôture d'une période de congés (service RH, `conges.cloturer`). Congés payés : solde restant de chaque salarié et
// décision ligne par ligne — report (plafonné au solde, jusqu'à une échéance) ou perte ; jamais de perte d'office, ni pour
// un salarié dont le report est imposé (absence de santé, maternité, paternité ou adoption dans la période : 15 mois).
// Une ligne sans décision reste à clôturer ; un salarié sans solde est clos d'emblée ; un membre du RH ne décide pas de
// son propre solde. RTT : non reportables, soldes non pris photographiés après le rappel du compte épargne-temps.
// Règles : shared/rules/clotures.ts ; relancer une clôture est sans effet.
import { useMemo, useState } from 'react';
import { isValidDate, parse } from '../../../shared/dates.ts';
import { equipeLabel, fJ, fmt, fmtIso, plural } from '../../../shared/format.ts';
import { echeanceMax, lignesClotureCp, lignesClotureRtt, MOTIF_CLOTURE_LABEL, type LigneClotureCp } from '../../../shared/rules/clotures.ts';
import { finPeriodeCp, periodeCp } from '../../../shared/rules/conges.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Empty, Fine, NoteAccent, Seg, Tag } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function ClotureCongesDialog({ conges, periode }: { conges: 'CP' | 'RTT'; periode: number }) {
  return conges === 'CP' ? <ClotureCp A={periode} /> : <ClotureRtt Y={periode} />;
}

/** Choix du service RH pour une ligne : décision (vide : pas encore décidée), jours reportés et échéance saisis. */
interface Choix { decision: 'reporter' | 'perdre' | ''; jours: string; expire: string }

const egal = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** Erreurs d'une ligne à reporter : jours (tout le solde, ou une partie par demi-journée) et échéance. */
function erreurs(A: number, l: LigneClotureCp, c: Choix) {
  if (c.decision !== 'reporter') return { jours: null, expire: null };
  const j = Number(c.jours.replace(',', '.'));
  const jours = !c.jours.trim() || Number.isNaN(j) ? 'Indiquez le nombre de jours.'
    : egal(j, l.solde) ? null
    : !(j > 0) || (j * 2) % 1 !== 0 ? 'Nombre de jours par demi-journée : 0,5, 1, 1,5…'
    : j > l.solde ? `${fJ(l.solde)} au plus.` : null;
  const expire = !isValidDate(c.expire) ? 'Indiquez l’échéance du report.'
    : c.expire < l.echeanceMin ? `Le ${fmtIso(l.echeanceMin)} au plus tôt.`
    : c.expire > echeanceMax(A) ? `Le ${fmtIso(echeanceMax(A))} au plus tard.` : null;
  return { jours, expire };
}

function ClotureCp({ A }: { A: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const { soi } = useRole();
  const lignes = useMemo(() => lignesClotureCp(d, A), [d, A]);
  const [choix, setChoix] = useState<Record<number, Choix>>(() => Object.fromEntries(lignes.filter(l => !l.deja && l.solde > 0)
    .map(l => [l.e.id, { decision: l.proposition.decision ?? '', jours: String(l.proposition.jours).replace('.', ','), expire: l.proposition.expire }])));
  const [busy, setBusy] = useState(false);
  const v = useVerification();

  const ouvertes = lignes.filter(l => !l.deja && l.solde > 0);
  const decidables = ouvertes.filter(l => l.e.id !== soi);
  const miennes = ouvertes.filter(l => l.e.id === soi);
  const sansSolde = lignes.filter(l => !l.deja && l.solde <= 0);
  const faites = lignes.filter(l => l.deja);
  const decidees = decidables.filter(l => choix[l.e.id]?.decision);
  const sansDecision = decidables.length - decidees.length;
  const set = (id: number, patch: Partial<Choix>) => setChoix(c => ({ ...c, [id]: { ...c[id], ...patch } }));
  // Report proposé à toutes les lignes encore sans décision (jamais une perte en bloc : elle se décide ligne par ligne).
  const reporterTout = () => setChoix(c => ({
    ...c, ...Object.fromEntries(decidables.filter(l => !c[l.e.id]?.decision).map(l => [l.e.id, { ...c[l.e.id], decision: 'reporter' as const, jours: String(l.solde).replace('.', ',') }])),
  }));

  const rien = !decidees.length && !sansSolde.length ? 'Choisissez le report ou la perte du solde pour au moins un salarié.' : null;
  const bloquants = decidees.flatMap(l => Object.values(erreurs(A, l, choix[l.e.id])));
  const reportes = decidees.filter(l => choix[l.e.id].decision === 'reporter').length;
  const pertes = decidees.length - reportes;

  const confirm = async () => {
    if (busy || !v.verifier(rien, ...bloquants)) return;
    setBusy(true);
    const r = await run('conges.cloturer', {
      type: 'CP', periode: A,
      lignes: decidees.map(l => {
        const c = choix[l.e.id];
        return c.decision === 'perdre' ? { empId: l.e.id, decision: 'perdre' }
          : { empId: l.e.id, decision: 'reporter', jours: l.impose ? l.solde : Number(c.jours.replace(',', '.')), expire: c.expire };
      }),
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  if (!ouvertes.length && !sansSolde.length) {
    return (
      <Dialog title={`Clôture des congés payés ${periodeCp(A)}`} actions={<CancelButton label="Fermer" />}>
        <p className="text-muted" style={{ margin: 0 }}>
          {faites.length ? `Période déjà clôturée pour ${plural(faites.length, 'salarié', 'salariés')} : rien à refaire.` : 'Aucun salarié concerné par cette période.'}
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog title={`Clôture des congés payés ${periodeCp(A)}`} width={720} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Clôturer {decidees.length ? plural(decidees.length + sansSolde.length, 'ligne', 'lignes') : 'les soldes nuls'}</SubmitButton>
    </>}>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        Période terminée le {fmt(parse(finPeriodeCp(A)))}. Aucun jour n’est perdu d’office : pour chaque salarié, choisissez le report du solde sur la
        période {periodeCp(A + 1)} (plafonné au solde) ou sa perte. Une ligne sans décision reste à clôturer.
      </p>
      {decidables.length > 0 && sansDecision > 0 && (
        <div className="actions-end">
          <button type="button" className="btn btn-ghost btn-sm" onClick={reporterTout}>Reporter les {plural(sansDecision, 'solde sans décision', 'soldes sans décision')}</button>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {decidables.map(l => {
          const c = choix[l.e.id], e = erreurs(A, l, c), j = Number(c.jours.replace(',', '.'));
          const perdus = c.decision === 'perdre' ? l.solde : c.decision === 'reporter' && !l.impose && j > 0 && j < l.solde ? l.solde - j : 0;
          return (
            <div key={l.e.id} className="boxed" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14 }}>{l.e.nom}</div>
                  <div className="text-muted sub">
                    {equipeLabel(l.e)} · solde {fJ(l.solde)}{l.accorde ? ` · report accordé en cours de période : ${fJ(l.accorde)}` : ''}
                  </div>
                </div>
                <Seg name={`cl-${l.e.id}`} label={`Décision pour ${l.e.nom}`} value={c.decision}
                  options={l.impose ? [['reporter', 'Reporter']] : [['reporter', 'Reporter'], ['perdre', 'Perdre']]}
                  onChange={x => set(l.e.id, { decision: x })} />
              </div>
              {l.impose && <NoteAccent>{MOTIF_CLOTURE_LABEL[l.impose]} : perte impossible, tout le solde est reporté.</NoteAccent>}
              {c.decision === 'reporter' && (
                <div className="grid-2">
                  <Field label="Jours reportés" htmlFor={`cl-j-${l.e.id}`} erreur={v.erreur(e.jours)}>
                    {l.impose ? <Static>{fJ(l.solde)}</Static> : (
                      <input className="input" id={`cl-j-${l.e.id}`} type="text" inputMode="decimal" value={c.jours} onChange={ev => set(l.e.id, { jours: ev.target.value })} />
                    )}
                  </Field>
                  <Field label="Utilisables jusqu’au" htmlFor={`cl-e-${l.e.id}`} erreur={v.erreur(e.expire)}>
                    <input className="input" id={`cl-e-${l.e.id}`} type="date" min={l.echeanceMin} max={echeanceMax(A)} value={c.expire} onChange={ev => set(l.e.id, { expire: ev.target.value })} />
                  </Field>
                </div>
              )}
              {perdus > 0 && <Fine>{fJ(perdus)} perdu{perdus > 1 ? 's' : ''} à la clôture.</Fine>}
              {!c.decision && <Tag cls="tag-outline" style={{ alignSelf: 'flex-start' }}>Sans décision : reste à clôturer</Tag>}
            </div>
          );
        })}
        {miennes.map(l => (
          <div key={l.e.id} className="boxed">
            <div style={{ fontSize: 14 }}>{l.e.nom}</div>
            <div className="text-muted sub">Votre solde ({fJ(l.solde)}) : décision par un autre membre du service RH.</div>
          </div>
        ))}
        {!ouvertes.length && <Empty pad="sm">Aucun solde restant à décider.</Empty>}
      </div>
      {rien && v.tente && <Bloquant>{rien}</Bloquant>}
      <Fine>
        À la validation : {plural(reportes, 'report', 'reports')} (report reçu sur la période {periodeCp(A + 1)}, jusqu’à son échéance),
        {' '}{plural(pertes, 'perte', 'pertes')}{sansSolde.length ? `, ${plural(sansSolde.length, 'salarié sans solde clôturé', 'salariés sans solde clôturés')} d’emblée` : ''}
        {sansDecision + miennes.length ? ` ; ${plural(sansDecision + miennes.length, 'ligne reste', 'lignes restent')} à décider` : ''}.
        {faites.length ? ` Déjà clôturés : ${plural(faites.length, 'salarié', 'salariés')}.` : ''} Chaque ligne clôturée est tracée et définitive.
      </Fine>
    </Dialog>
  );
}

function ClotureRtt({ Y }: { Y: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const lignes = useMemo(() => lignesClotureRtt(d, Y).filter(l => !l.deja), [d, Y]);
  const [busy, setBusy] = useState(false);
  const perdus = lignes.reduce((n, l) => n + Math.max(0, l.solde), 0);
  const cet = lignes.filter(l => l.cet > 0);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    const r = await run('conges.cloturer', { type: 'RTT', periode: Y });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  if (!lignes.length) {
    return (
      <Dialog title={`Clôture des RTT ${Y}`} actions={<CancelButton label="Fermer" />}>
        <p className="text-muted" style={{ margin: 0 }}>Année déjà clôturée : rien à refaire.</p>
      </Dialog>
    );
  }

  return (
    <Dialog title={`Clôture des RTT et jours de repos ${Y}`} width={640} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Clôturer les RTT {Y}</SubmitButton>
    </>}>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        Les RTT et jours de repos ne sont pas reportables : le solde non pris au 31 décembre {Y} est perdu. La clôture le photographie pour chaque
        salarié ; ceux de {Y + 1} restent posables sur leur propre droit.
      </p>
      {cet.length > 0 && (
        <NoteAccent>
          Rappel : jusqu’à 5 RTT par an se placent sur le compte épargne-temps. {plural(cet.length, 'salarié peut', 'salariés peuvent')} encore y placer des
          RTT {Y} jusqu’à cette confirmation (bouton « Épargner » de l’écran Congés &amp; absences).
        </NoteAccent>
      )}
      <div className="scroll-x">
        <table className="table">
          <thead><tr><th>Collaborateur</th><th>Droit</th><th>Pris</th><th>Non pris</th><th>Plaçables sur le CET</th></tr></thead>
          <tbody>
            {lignes.map(l => (
              <tr key={l.e.id}>
                <td><div className="nowrap">{l.e.nom}</div><div className="text-muted sub">{l.info.label}</div></td>
                <td className="tnum">{fJ(l.info.droit)}</td>
                <td className="tnum">{fJ(l.info.pris + l.info.poses)}</td>
                <td className="tnum">{l.solde > 0 ? fJ(l.solde) : '—'}</td>
                <td className="tnum">{l.cet > 0 ? fJ(l.cet) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Fine>À la validation : {plural(lignes.length, 'salarié clôturé', 'salariés clôturés')}, {perdus ? `${fJ(perdus)} non pris perdus` : 'aucun RTT perdu'}. Tracé et définitif.</Fine>
    </Dialog>
  );
}
