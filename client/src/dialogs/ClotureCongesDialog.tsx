// Clôture d'une période de congés (service RH, `conges.cloturer`). Congés payés : solde restant de chaque salarié et
// décision ligne par ligne — report (plafonné au solde, jusqu'au 31 mai suivant) ou perte ; jamais de perte d'office, ni
// des jours d'un report imposé (absence de santé, maternité, paternité ou adoption dans la période : 15 mois ; report
// légal reçu encore en cours : jusqu'à son échéance). Une ligne sans décision reste à clôturer ; une ligne dont une demande
// de CP de la période attend une décision aussi ; un salarié sans solde est clos d'emblée ; un membre du RH ne décide pas
// de son propre solde. RTT : non reportables, soldes non pris photographiés après le rappel du compte épargne-temps.
// Règles : shared/rules/clotures.ts ; relancer une clôture est sans effet.
import { useMemo, useState } from 'react';
import { parse } from '../../../shared/dates.ts';
import { equipeLabel, fJ, fmt, fmtIso, plural } from '../../../shared/format.ts';
import { periodeTexte } from '../../../shared/rules/absences.ts';
import { echeanceReport, lignesClotureCp, lignesClotureRtt, MOTIF_CLOTURE_LABEL, type LigneClotureCp } from '../../../shared/rules/clotures.ts';
import { finPeriodeCp, periodeCp } from '../../../shared/rules/conges.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Empty, Fine, NoteAccent, Seg, Tag } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function ClotureCongesDialog({ conges, periode }: { conges: 'CP' | 'RTT'; periode: number }) {
  return conges === 'CP' ? <ClotureCp A={periode} /> : <ClotureRtt Y={periode} />;
}

/** Choix du service RH pour une ligne : décision (vide : pas encore décidée) et jours reportés saisis (report imposé compris). */
interface Choix { decision: 'reporter' | 'perdre' | ''; jours: string }

const egal = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const saisie = (n: number) => String(n).replace('.', ',');

/** Choix initial d'une ligne : la proposition de Cursus. */
const initial = (l: LigneClotureCp): Choix => ({ decision: l.proposition.decision ?? '', jours: saisie(l.proposition.jours) });

/** Erreur d'une ligne à reporter : jours (tout le solde, le report imposé, ou une partie par demi-journée). */
function erreur(l: LigneClotureCp, c: Choix): string | null {
  if (c.decision !== 'reporter') return null;
  const j = Number(c.jours.replace(',', '.'));
  return !c.jours.trim() || Number.isNaN(j) ? 'Indiquez le nombre de jours.'
    : egal(j, l.solde) || egal(j, l.legal) ? null
    : !(j > 0) || (j * 2) % 1 !== 0 ? 'Nombre de jours par demi-journée : 0,5, 1, 1,5…'
    : j > l.solde ? `${fJ(l.solde)} au plus.`
    : j < l.legal ? `${fJ(l.legal)} au moins (report légal).` : null;
}

function ClotureCp({ A }: { A: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const { soi } = useRole();
  const lignes = useMemo(() => lignesClotureCp(d, A), [d, A]);
  // Décisions saisies ; une ligne apparue depuis l'ouverture (données relues) part de la proposition de Cursus.
  const [saisis, setChoix] = useState<Record<number, Choix>>({});
  const choix = (l: LigneClotureCp) => saisis[l.e.id] ?? initial(l);
  const [busy, setBusy] = useState(false);
  const v = useVerification();

  // Demande de CP de la période en attente : la ligne attend sa décision, même à solde nul.
  const enAttente = lignes.filter(l => !l.deja && l.attente.length);
  const ouvertes = lignes.filter(l => !l.deja && !l.attente.length && l.solde > 0);
  const decidables = ouvertes.filter(l => l.e.id !== soi);
  const miennes = ouvertes.filter(l => l.e.id === soi);
  const sansSolde = lignes.filter(l => !l.deja && !l.attente.length && l.solde <= 0);
  const faites = lignes.filter(l => l.deja);
  const decidees = decidables.filter(l => choix(l).decision);
  const sansDecision = decidables.length - decidees.length;
  const set = (l: LigneClotureCp, patch: Partial<Choix>) => setChoix(c => ({ ...c, [l.e.id]: { ...(c[l.e.id] ?? initial(l)), ...patch } }));
  // Report proposé à toutes les lignes encore sans décision (jamais une perte en bloc : elle se décide ligne par ligne).
  const reporterTout = () => setChoix(c => ({
    ...c, ...Object.fromEntries(decidables.filter(l => !(c[l.e.id] ?? initial(l)).decision).map(l => [l.e.id, { decision: 'reporter' as const, jours: saisie(l.solde) }])),
  }));

  const rien = !decidees.length && !sansSolde.length ? 'Choisissez le report ou la perte du solde pour au moins un salarié.' : null;
  const bloquants = decidees.map(l => erreur(l, choix(l)));
  const reportes = decidees.filter(l => choix(l).decision === 'reporter').length;
  const pertes = decidees.length - reportes;

  const confirm = async () => {
    if (busy || !v.verifier(rien, ...bloquants)) return;
    setBusy(true);
    const r = await run('conges.cloturer', {
      type: 'CP', periode: A,
      lignes: decidees.map(l => {
        const c = choix(l);
        return c.decision === 'perdre' ? { empId: l.e.id, decision: 'perdre' } : { empId: l.e.id, decision: 'reporter', jours: Number(c.jours.replace(',', '.')) };
      }),
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  if (!ouvertes.length && !sansSolde.length && !enAttente.length) {
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
        période {periodeCp(A + 1)} (plafonné au solde, utilisable jusqu’au {fmt(parse(echeanceReport(A)))}) ou sa perte. Une ligne sans décision reste à clôturer.
      </p>
      {decidables.length > 0 && sansDecision > 0 && (
        <div className="actions-end">
          <button type="button" className="btn btn-ghost btn-sm" onClick={reporterTout}>Reporter les {plural(sansDecision, 'solde sans décision', 'soldes sans décision')}</button>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {decidables.map(l => {
          const c = choix(l), err = erreur(l, c), j = Number(c.jours.replace(',', '.'));
          const perdus = c.decision === 'perdre' ? l.solde : c.decision === 'reporter' && !err && j < l.solde ? Math.round((l.solde - j) * 100) / 100 : 0;
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
                  options={l.legal > 0 ? [['reporter', 'Reporter']] : [['reporter', 'Reporter'], ['perdre', 'Perdre']]}
                  onChange={x => set(l, { decision: x })} />
              </div>
              {l.impose && (
                <NoteAccent>
                  {MOTIF_CLOTURE_LABEL[l.impose]} : perte impossible pour {egal(l.legal, l.solde) ? 'tout le solde' : fJ(l.legal)}, reporté{l.legal > 1 ? 's' : ''} jusqu’au {fmtIso(l.expireLegal!)}.
                </NoteAccent>
              )}
              {c.decision === 'reporter' && (
                <div className="grid-2">
                  <Field label={l.legal > 0 && !egal(l.legal, l.solde) ? 'Jours reportés, report légal compris' : 'Jours reportés'} htmlFor={`cl-j-${l.e.id}`} erreur={v.erreur(err)}>
                    <input className="input" id={`cl-j-${l.e.id}`} type="text" inputMode="decimal" value={c.jours} onChange={ev => set(l, { jours: ev.target.value })} />
                  </Field>
                  <Field label="Utilisables jusqu’au">
                    <Static>
                      {l.legal > 0 ? `${fmtIso(l.expireLegal!)} (report légal)${egal(l.legal, l.solde) ? '' : `, ${fmtIso(echeanceReport(A))} au-delà`}` : fmtIso(echeanceReport(A))}
                    </Static>
                  </Field>
                </div>
              )}
              {perdus > 0 && <Fine>{fJ(perdus)} perdu{perdus > 1 ? 's' : ''} à la clôture.</Fine>}
              {!c.decision && <Tag cls="tag-outline" style={{ alignSelf: 'flex-start' }}>Sans décision : reste à clôturer</Tag>}
            </div>
          );
        })}
        {enAttente.map(l => (
          <div key={l.e.id} className="boxed">
            <div style={{ fontSize: 14 }}>{l.e.nom}</div>
            <div className="text-muted sub">
              Demande de congés payés en attente ({l.attente.map(a => periodeTexte(a.du, a.au)).join(', ')}) : à valider ou refuser avant de clôturer son solde.
            </div>
          </div>
        ))}
        {miennes.map(l => (
          <div key={l.e.id} className="boxed">
            <div style={{ fontSize: 14 }}>{l.e.nom}</div>
            <div className="text-muted sub">Votre solde ({fJ(l.solde)}) : décision par un autre membre du service RH.</div>
          </div>
        ))}
        {!ouvertes.length && !enAttente.length && <Empty pad="sm">Aucun solde restant à décider.</Empty>}
      </div>
      {rien && v.tente && <Bloquant>{rien}</Bloquant>}
      <Fine>
        À la validation : {plural(reportes, 'report', 'reports')} (report reçu sur la période {periodeCp(A + 1)}, jusqu’à son échéance),
        {' '}{plural(pertes, 'perte', 'pertes')}{sansSolde.length ? `, ${plural(sansSolde.length, 'salarié sans solde clôturé', 'salariés sans solde clôturés')} d’emblée` : ''}
        {sansDecision + miennes.length + enAttente.length ? ` ; ${plural(sansDecision + miennes.length + enAttente.length, 'ligne reste', 'lignes restent')} à décider` : ''}.
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
  // Demande de RTT de l'année en attente : le salarié n'est pas clôturé tant qu'elle n'est pas décidée.
  const attente = lignes.filter(l => l.attente.length), closes = lignes.filter(l => !l.attente.length);
  const perdus = closes.reduce((n, l) => n + Math.max(0, l.solde), 0);
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
                <td className="tnum">
                  {l.solde > 0 ? fJ(l.solde) : '—'}
                  {l.attente.length > 0 && <div className="text-muted sub">Demande en attente ({l.attente.map(a => periodeTexte(a.du, a.au)).join(', ')}) : non clôturé</div>}
                </td>
                <td className="tnum">{l.cet > 0 ? fJ(l.cet) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {attente.length > 0 && (
        <NoteAccent>
          {plural(attente.length, 'salarié a', 'salariés ont')} une demande de RTT {Y} en attente : à valider ou refuser d’abord, puis relancer la clôture
          ({attente.map(l => l.e.nom).join(', ')}).
        </NoteAccent>
      )}
      <Fine>À la validation : {plural(closes.length, 'salarié clôturé', 'salariés clôturés')}, {perdus ? `${fJ(perdus)} non pris perdus` : 'aucun RTT perdu'}. Tracé et définitif.</Fine>
    </Dialog>
  );
}
