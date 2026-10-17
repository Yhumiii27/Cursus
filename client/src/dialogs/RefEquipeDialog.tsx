// Écran Référentiels, onglet Postes : formations et habilitations exigées de tous les membres d'une équipe, quel que soit
// leur poste (shared/rules/exigences.ts). Même proposition et même annonce que pour un poste (dialogs/RefPosteDialog.tsx).
// Case « travail de nuit ou en continu » : aucun salarié de moins de 18 ans dans une équipe cochée (shared/rules/mineurs.ts).
import { useMemo, useState } from 'react';
import { present } from '../../../shared/rules/contrats.ts';
import { controlerExigences, effetExigences, effetTexte, exigencesEquipe, exigencesProposees, nombreExigences } from '../../../shared/rules/exigences.ts';
import { plural } from '../../../shared/format.ts';
import { mineursDeLEquipe } from '../../../shared/rules/mineurs.ts';
import type { Exigences } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { ExigencesChoix } from '../components/ExigencesChoix.tsx';
import { Btn, Fine, NoteAccent } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function RefEquipeDialog({ nom }: { nom: string }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const ref = d.ds.referentiels;
  const [equipe] = useState(() => ref.equipes.find(q => q.nom === nom) ?? null);
  const avant = equipe ? exigencesEquipe(equipe) : null;
  const [exigences, setExigences] = useState<Exigences>(() => avant ?? { formations: [], habilitations: [] });
  // Décochée tant qu'elle n'est pas renseignée ; l'enregistrement la renseigne (le rappel de la fiche des mineurs cesse).
  const [nuit, setNuit] = useState(equipe?.nuit === true);
  const [busy, setBusy] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const v = useVerification();

  const { erreurs } = controlerExigences(exigences, ref, avant);
  const membres = useMemo(() => d.ds.employes.filter(e => e.equipe === nom && present(e, d.ti)), [d, nom]);
  const mineurs = useMemo(() => mineursDeLEquipe(d.ds.employes, nom, d.ti), [d, nom]);
  const errNuit = nuit && mineurs.length
    ? `L’équipe compte un salarié de moins de 18 ans (${mineurs.map(e => e.nom).join(', ')}) : il ne peut pas travailler de nuit (art. L3163-2) — affectez-le d’abord à une autre équipe.`
    : null;
  const proposees = useMemo(() => exigencesProposees(d.ds, membres), [d, membres]);
  const cle = JSON.stringify(exigences);
  const effet = useMemo(() => {
    const x = JSON.parse(cle) as Exigences;
    const valeur = x.formations.length || x.habilitations.length ? x : null;
    return effetExigences(d.ds, { equipes: ref.equipes.map(q => (q.nom === nom ? { ...q, exigences: valeur } : q)) });
  }, [d, ref.equipes, nom, cle]);
  const nouveaux = effet.nouveaux;
  const deja = (k: keyof Exigences, id: string) => exigences[k].includes(id);
  const aReprendre = [...proposees.formations.filter(f => !deja('formations', f)), ...proposees.habilitations.filter(h => !deja('habilitations', h))].length;

  const envoyer = async (force = false) => {
    if (busy || !v.verifier(erreurs.formations, erreurs.habilitations, errNuit, !equipe)) return;
    if (!force && nouveaux.length) { setConfirmer(true); return; }
    setBusy(true);
    const r = await run('referentiel.equipe.exigences', { nom, ...exigences, nuit });
    setBusy(false);
    if (r.ok) closeDialog();
    else setConfirmer(false);
  };

  return (
    <Dialog title={`Équipe ${nom} — exigences et organisation`} width={620} onSubmit={() => envoyer()}
      confirmation={confirmer ? {
        texte: `${effetTexte(effet)}. Enregistrer quand même ?`,
        bouton: 'Enregistrer quand même', occupe: busy, confirmer: () => envoyer(true), annuler: () => setConfirmer(false),
      } : null}
      actions={!equipe ? <CancelButton label="Fermer" /> : <>
        <CancelButton />
        <SubmitButton busy={busy}>Enregistrer</SubmitButton>
      </>}>
      {!equipe ? <Bloquant>Cette équipe n’existe plus.</Bloquant> : <>
        <ExigencesChoix value={exigences} onChange={setExigences} avant={avant} erreurs={{ formations: v.erreur(erreurs.formations), habilitations: v.erreur(erreurs.habilitations) }} />
        {nombreExigences(proposees) > 0 && aReprendre > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Fine>
              Détenus par {membres.length > 1 ? `les ${membres.length} membres` : 'son membre'} :{' '}
              {[...proposees.formations.map(f => d.fm(f).court), ...proposees.habilitations.map(h => d.hm(h).nom)].join(', ')}.
            </Fine>
            <Btn small onClick={() => setExigences({ formations: [...new Set([...exigences.formations, ...proposees.formations])], habilitations: [...new Set([...exigences.habilitations, ...proposees.habilitations])] })}>
              Reprendre ces titres
            </Btn>
          </div>
        )}
        <Field label="Organisation du travail" erreur={v.erreur(errNuit)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={nuit} onChange={ev => setNuit(ev.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
              Travail de nuit ou en continu
            </label>
            <span className="text-muted sub">
              {equipe.nuit == null ? 'À renseigner : tant que la case ne l’est pas, la fiche des salariés de moins de 18 ans rappelle l’interdiction du travail de nuit. '
                : ''}Une équipe cochée ne reçoit aucun salarié de moins de 18 ans (art. L3163-2).
            </span>
          </div>
        </Field>
        <Fine>
          {plural(membres.length, 'membre', 'membres')}. Ces exigences s’ajoutent à celles du poste de chacun (une exigence
          commune aux deux ne compte qu’une fois) ; sans exigence, le statut des membres ne change pas.
        </Fine>
        {nouveaux.length > 0 && !confirmer && <NoteAccent>{effetTexte(effet)}.</NoteAccent>}
        {effet.resolus > 0 && <Fine>{plural(effet.resolus, 'salarié n’a plus d’exigence manquante', 'salariés n’ont plus d’exigence manquante')}.</Fine>}
      </>}
    </Dialog>
  );
}
