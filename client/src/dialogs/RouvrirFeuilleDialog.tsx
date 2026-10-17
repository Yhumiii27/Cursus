// Réouverture d'une feuille de temps validée (t131, administrateur RH, écran Temps) : motif obligatoire (500 caractères
// au plus), feuille corrigée par son valideur (« soumise ») ou renvoyée au salarié (« à corriger », motif en
// commentaire). Suites annoncées avant d'envoyer : écart dans le prochain lot de paie (lot correctif) pour une feuille
// déjà transmise, Keystone mis à jour à la revalidation. Refus du serveur repris sans bouton : feuille d'un lot de paie
// à confirmer (annuler d'abord le lot), intérimaire dont le relevé est parti à l'agence.
import { useState } from 'react';
import { isoWeek } from '../../../shared/dates.ts';
import { key } from '../../../shared/format.ts';
import { periodeLabel } from '../../../shared/rules/paie.ts';
import { erreurMotifReouverture, MOTIF_REOUVERTURE_MAX } from '../../../shared/rules/regularisation.ts';
import { employeDeLaFeuille } from '../../../shared/rules/temps.ts';
import type { ISODate } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, NoteAccent } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

const SUITES = {
  corriger: { label: 'Corriger moi-même', aide: 'La feuille repasse « soumise » : son valideur la corrige puis la valide de nouveau.' },
  renvoyer: { label: 'Renvoyer au salarié', aide: 'La feuille repasse « à corriger » : le salarié est prévenu ; le motif est montré en commentaire au salarié et à son valideur.' },
} as const;

export function RouvrirFeuilleDialog({ empId, week }: { empId: number; week: ISODate }) {
  const d = useDomain();
  const { admin } = useRole();
  const { run, closeDialog } = useStore();
  const [motif, setMotif] = useState('');
  const [suite, setSuite] = useState<keyof typeof SUITES>('corriger');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const emp = d.emp(empId);
  const sh = d.ds.feuilles.find(f => f.empId === empId && f.week === week);
  if (!emp || !sh || !admin) return null;

  const lot = sh.lotId && !sh.sage ? d.ds.lotsPaie.find(l => l.id === sh.lotId && l.statut === 'genere') : undefined;
  const interim = d.contratOf(employeDeLaFeuille(emp, sh)).interim;
  const releve = interim && d.ds.releves.some(r => key(r.agence) === key(emp.agence) && r.semaine === week);
  const refus = lot
    ? `Feuille comprise dans le lot de paie n° ${lot.id} (${periodeLabel(lot.periode)}), import à confirmer : annulez d’abord ce lot (« Transmission à Sage Paie »), qui la libère, puis rouvrez-la.`
    : releve ? `Relevé d’heures de la semaine ${isoWeek(week)} déjà envoyé à l’agence ${emp.agence} : la feuille ne se rouvre pas, la correction se règle avec l’agence.` : null;
  const transmise = sh.sage || !!sh.reouverture?.rubriques;
  const erreur = erreurMotifReouverture(motif);

  const confirm = async () => {
    if (busy || refus || !v.verifier(erreur)) return;
    setBusy(true);
    const r = await run('temps.rouvrir', { empId, week, motif: motif.trim(), renvoyer: suite === 'renvoyer' });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={`Rouvrir la feuille — semaine ${isoWeek(week)}`} width={560} onSubmit={confirm} actions={<>
      <CancelButton label={refus ? 'Fermer' : 'Annuler'} />
      {!refus && <SubmitButton busy={busy}>Rouvrir la feuille</SubmitButton>}
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{emp.nom}</Static></Field>
        <Field label="Feuille"><Static>Validée{sh.sage ? ' · transmise à Sage Paie' : ''}</Static></Field>
      </div>
      {refus ? <NoteAccent>{refus}</NoteAccent> : <>
        <Field label="Motif de la réouverture" htmlFor="ro-motif" requis erreur={v.erreur(erreur)}>
          <textarea className="input mid" id="ro-motif" rows={3} autoFocus maxLength={MOTIF_REOUVERTURE_MAX} placeholder="Heures imputées au mauvais projet, journée oubliée, erreur de saisie…"
            value={motif} onChange={e => setMotif(e.target.value)} style={{ resize: 'vertical' }} />
          <span className="text-muted sub">{motif.trim().length} / {MOTIF_REOUVERTURE_MAX} caractères · gardé sur la feuille ; le journal trace la réouverture, sans son texte</span>
        </Field>
        <Field label="Correction">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {(Object.keys(SUITES) as (keyof typeof SUITES)[]).map(k => (
              <label key={k} className="boxed" style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', cursor: 'pointer' }}>
                <input type="radio" name="ro-suite" value={k} checked={suite === k} onChange={() => setSuite(k)}
                  style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
                <span>
                  <span style={{ fontSize: 14 }}>{SUITES[k].label}</span>
                  <span className="text-muted sub" style={{ display: 'block' }}>{SUITES[k].aide}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>
        <Fine muted={false}>
          {transmise
            ? 'Feuille déjà transmise à la paie : les rubriques parties sont gardées. À la revalidation, seul l’écart partira dans le prochain lot de paie (lot correctif), en rappel si sa période est close.'
            : 'Feuille pas encore transmise à la paie : revalidée, elle partira dans le prochain lot comme les autres.'}
        </Fine>
        {sh.keystone && <Fine>Keystone recevra les heures corrigées à la revalidation ; un projet retiré y sera remis à 0.</Fine>}
        <Fine>Récupération et contrepartie en repos sont recalculées à la revalidation ; le régime et le mode des heures supplémentaires figés restent ceux de la semaine.</Fine>
      </>}
    </Dialog>
  );
}
