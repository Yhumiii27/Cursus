// Clôture d'une action engagée du plan de formation (`plan.avancer` vers « réalisé ») : coût réel (prérempli du coût
// prévu, 0 accepté) et effectif réel (prérempli de l'effectif prévu, facultatif). Le coût réel compte dans le réalisé des
// enveloppes ; l'écart au prévu s'affiche dans Plan & budget. Bénéficiaires (t116), facultatifs : membres de l'équipe (et
// demandeur d'une demande acceptée qui a créé la ligne, coché d'office) dont la formation suivie s'enregistre, avec ses
// dates ; sans objet quand une session clôturée réalise la ligne (ses participants ont leur certification).
import { useMemo, useState } from 'react';
import { fmtEur } from '../../../shared/format.ts';
import { COUT_REEL_MAX, effectifReel, montantReel } from '../../../shared/rules/exercices.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { controlerSuivie } from '../../../shared/rules/formations-suivies.ts';
import { present } from '../../../shared/rules/contrats.ts';
import { t } from '../i18n/langue.ts';

/** Message sous le champ du coût réel (aussi dans la clôture d'une session, ClotureDialog). */
export function erreurCoutReel(v: string): string | null {
  if (!v.trim()) return t('Enter the actual cost (0 if the action cost nothing).');
  return montantReel(v) === null ? `${t('Amount in euros, from 0 to ')}${fmtEur(COUT_REEL_MAX)}.` : null;
}

export function PlanRealiserDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const l = d.ds.plan.find(x => x.id === id);
  const [cout, setCout] = useState(() => (l ? String(l.cout) : ''));
  const [effectif, setEffectif] = useState(() => (l ? String(l.effectif) : ''));
  const [busy, setBusy] = useState(false);
  // Demandeurs d'une demande acceptée rattachée à la ligne : cochés d'office.
  const demandeurs = useMemo(() => d.ds.demandesCollab.filter(r => r.type === 'formation' && r.statut === 'acceptee' && r.suite?.planId === id).map(r => r.empId), [d, id]);
  const [choisis, setChoisis] = useState<number[]>(demandeurs);
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [duree, setDuree] = useState('');
  const v = useVerification();
  if (!l) return null;
  const parSession = d.ds.sessions.some(s => s.planId === l.id && s.statut === 'Clôturée');
  const candidats = parSession ? [] : d.ds.employes
    .filter(e => (e.equipe === l.equipe && present(e, d.ti)) || demandeurs.includes(e.id))
    .sort((a, b) => a.nom.localeCompare(b.nom));
  const cocher = (empId: number, oui: boolean) => setChoisis(c => (oui ? [...c, empId] : c.filter(x => x !== empId)));
  // Dates et durée de la formation, contrôlées comme une saisie directe (shared/rules/formations-suivies.ts).
  const suivie = choisis.length ? controlerSuivie(d, { f: l.f ?? '', libelle: l.libelle ?? '', du, au, duree }, l.f ? { f: l.f } : null).erreurs : {};
  const fm = l.f ? d.fm(l.f) : null;
  const coutErr = erreurCoutReel(cout);
  const effectifErr = effectif.trim() && effectifReel(effectif) === null ? t('Whole number of people, 0 or more.') : null;
  const montant = montantReel(cout);
  const ecart = montant === null ? 0 : montant - l.cout;

  const envoyer = async () => {
    if (busy || !v.verifier(coutErr, effectifErr, suivie.du, suivie.au, suivie.duree)) return;
    setBusy(true);
    const r = await run('plan.avancer', {
      id: l.id, de: 'engage', coutReel: cout.trim().replace(',', '.'), effectifReel: effectif.trim(),
      ...(choisis.length ? { beneficiaires: choisis, du, au: au || du, duree: duree.trim().replace(',', '.') } : {}),
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t('Close the action of the plan')} width={520} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Close the action')}</SubmitButton>
    </>}>
      <Field label={t('Action')}>
        <Static>{fm ? fm.nom : l.libelle}<div className="text-muted sub">{l.equipe} · {l.periode} {l.exercice} · {t('planned ')}{fmtEur(l.cout)}{t(' for ')}{l.effectif}{t(' pers.')}</div></Static>
      </Field>
      <div className="grid-2">
        <Field label={t('Actual cost (€)')} htmlFor="pr-cout" requis erreur={v.erreur(coutErr) || (cout.trim() ? coutErr : null)}>
          <input className="input tnum" id="pr-cout" inputMode="decimal" value={cout} onChange={e => setCout(e.target.value)} autoFocus />
        </Field>
        <Field label={t('Actual headcount')} htmlFor="pr-effectif" erreur={effectifErr}>
          <input className="input tnum" id="pr-effectif" inputMode="numeric" value={effectif} onChange={e => setEffectif(e.target.value)} />
        </Field>
      </div>
      {candidats.length > 0 && <>
        <Field label={t('Beneficiaries (training attended recorded)')}>
          <div className="chips" role="group" aria-label={t('Beneficiaries')} style={{ gap: 'var(--space-2) var(--space-4)' }}>
            {candidats.map(e => (
              <label key={e.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={choisis.includes(e.id)} onChange={ev => cocher(e.id, ev.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
                {e.nom}
              </label>
            ))}
          </div>
        </Field>
        {choisis.length > 0 && (
          <div className="grid-2">
            <Field label={t('Training attended from')} htmlFor="pr-du" requis erreur={v.erreur(suivie.du) || (du ? suivie.du ?? null : null)}>
              <input className="input" id="pr-du" type="date" max={d.ti} value={du} onChange={e => setDu(e.target.value)} />
            </Field>
            <Field label={t('To#date-cap')} htmlFor="pr-au" erreur={au ? suivie.au ?? null : v.erreur(suivie.au)}>
              <input className="input" id="pr-au" type="date" min={du || undefined} max={d.ti} value={au} onChange={e => setAu(e.target.value)} />
            </Field>
          </div>
        )}
        {choisis.length > 0 && fm?.dureeHeures == null && (
          <Field label={t('Length (hours)')} htmlFor="pr-duree" erreur={duree ? suivie.duree ?? null : null}>
            <input className="input tnum" id="pr-duree" inputMode="decimal" value={duree} placeholder="14" onChange={e => setDuree(e.target.value)} />
          </Field>
        )}
      </>}
      <Fine>
        {montant !== null && ecart ? `${t('Difference from the plan: ')}${ecart > 0 ? '+' : '−'}${fmtEur(Math.abs(ecart))}. ` : ''}
        {t('The action becomes “Done”: its actual cost counts in the done amount of the envelope ')}{l.equipe}.
        {parSession ? t(' Its participants have their certification through the closing of the session.') : candidats.length ? t(' The ticked beneficiaries receive the training in their trainings attended (passport, 8-year review, indicators).') : ''}
        {!parSession && fm && choisis.length > 0 ? t(' Training from the catalogue: also record the certification of each one from their sheet, it is the one that counts for compliance; it then stands for the training in the passport and in the indicators, without double counting.') : ''}
      </Fine>
    </Dialog>
  );
}
