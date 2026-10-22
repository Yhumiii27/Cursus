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

/** Message sous le champ du coût réel (aussi dans la clôture d'une session, ClotureDialog). */
export function erreurCoutReel(v: string): string | null {
  if (!v.trim()) return 'Indiquez le coût réel (0 si l’action n’a rien coûté).';
  return montantReel(v) === null ? `Montant en euros, de 0 à ${fmtEur(COUT_REEL_MAX)}.` : null;
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
  const effectifErr = effectif.trim() && effectifReel(effectif) === null ? 'Nombre entier de personnes, 0 ou plus.' : null;
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
    <Dialog title="Clôturer l’action du plan" width={520} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Clôturer l’action</SubmitButton>
    </>}>
      <Field label="Action">
        <Static>{fm ? fm.nom : l.libelle}<div className="text-muted sub">{l.equipe} · {l.periode} {l.exercice} · prévu {fmtEur(l.cout)} pour {l.effectif} pers.</div></Static>
      </Field>
      <div className="grid-2">
        <Field label="Coût réel (€)" htmlFor="pr-cout" requis erreur={v.erreur(coutErr) || (cout.trim() ? coutErr : null)}>
          <input className="input tnum" id="pr-cout" inputMode="decimal" value={cout} onChange={e => setCout(e.target.value)} autoFocus />
        </Field>
        <Field label="Effectif réel" htmlFor="pr-effectif" erreur={effectifErr}>
          <input className="input tnum" id="pr-effectif" inputMode="numeric" value={effectif} onChange={e => setEffectif(e.target.value)} />
        </Field>
      </div>
      {candidats.length > 0 && <>
        <Field label="Bénéficiaires (formation suivie enregistrée)">
          <div className="chips" role="group" aria-label="Bénéficiaires" style={{ gap: 'var(--space-2) var(--space-4)' }}>
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
            <Field label="Formation suivie du" htmlFor="pr-du" requis erreur={v.erreur(suivie.du) || (du ? suivie.du ?? null : null)}>
              <input className="input" id="pr-du" type="date" max={d.ti} value={du} onChange={e => setDu(e.target.value)} />
            </Field>
            <Field label="Au" htmlFor="pr-au" erreur={au ? suivie.au ?? null : v.erreur(suivie.au)}>
              <input className="input" id="pr-au" type="date" min={du || undefined} max={d.ti} value={au} onChange={e => setAu(e.target.value)} />
            </Field>
          </div>
        )}
        {choisis.length > 0 && fm?.dureeHeures == null && (
          <Field label="Durée (heures)" htmlFor="pr-duree" erreur={duree ? suivie.duree ?? null : null}>
            <input className="input tnum" id="pr-duree" inputMode="decimal" value={duree} placeholder="14" onChange={e => setDuree(e.target.value)} />
          </Field>
        )}
      </>}
      <Fine>
        {montant !== null && ecart ? `Écart au prévu : ${ecart > 0 ? '+' : '−'}${fmtEur(Math.abs(ecart))}. ` : ''}
        L’action passe « Réalisée » : son coût réel compte dans le réalisé de l’enveloppe {l.equipe}.
        {parSession ? ' Ses participants ont leur certification par la clôture de la session.' : candidats.length ? ' Les bénéficiaires cochés reçoivent la formation dans leurs formations suivies (passeport, bilan à 8 ans, indicateurs).' : ''}
        {!parSession && fm && choisis.length > 0 ? ' Formation du catalogue : enregistrez aussi la certification de chacun depuis sa fiche, c’est elle qui compte pour la conformité ; elle représente alors la formation au passeport et dans les indicateurs, sans double compte.' : ''}
      </Fine>
    </Dialog>
  );
}
