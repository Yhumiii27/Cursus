// Écran Référentiels, onglet Postes : formations et habilitations exigées de tous les membres d'une équipe, quel que soit
// leur poste (shared/rules/exigences.ts). Même proposition et même annonce que pour un poste (dialogs/RefPosteDialog.tsx).
// Case « travail de nuit ou en continu » : aucun salarié de moins de 18 ans dans une équipe cochée (shared/rules/mineurs.ts).
// Horaire de poste par défaut (lot 6, shared/rules/horaires.ts) : proposé sur les feuilles de temps de ses membres.
import { useMemo, useState } from 'react';
import { present } from '../../../shared/rules/contrats.ts';
import { controlerExigences, effetExigences, effetTexte, exigencesEquipe, exigencesProposees, nombreExigences } from '../../../shared/rules/exigences.ts';
import { plural } from '../../../shared/format.ts';
import { mineursDeLEquipe } from '../../../shared/rules/mineurs.ts';
import { horaireDe, horairesEnVigueur, horaireTexte } from '../../../shared/rules/horaires.ts';
import type { Exigences } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { ExigencesChoix } from '../components/ExigencesChoix.tsx';
import { Btn, Fine, NoteAccent, Seg } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function RefEquipeDialog({ nom }: { nom: string }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const ref = d.ds.referentiels;
  const [equipe] = useState(() => ref.equipes.find(q => q.nom === nom) ?? null);
  const avant = equipe ? exigencesEquipe(equipe) : null;
  const [exigences, setExigences] = useState<Exigences>(() => avant ?? { formations: [], habilitations: [] });
  // Choix explicite : tant que le service RH n'a répondu ni oui ni non, la case reste à renseigner et n'est pas envoyée
  // (le serveur la laisse inchangée) ; enregistrer les seules exigences ne vaut pas déclaration « pas de travail de nuit ».
  const [nuit, setNuit] = useState<'nr' | 'oui' | 'non'>(() => (equipe?.nuit == null ? 'nr' : equipe.nuit ? 'oui' : 'non'));
  // Horaire par défaut : « » pour aucun ; un horaire archivé depuis reste affiché tant qu'il n'est pas changé.
  const [horaire, setHoraire] = useState(equipe?.horaire ?? '');
  const horaires = horairesEnVigueur(ref), horaireArchive = horaireDe(ref, equipe?.horaire);
  const [busy, setBusy] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const v = useVerification();

  const { erreurs } = controlerExigences(exigences, ref, avant);
  const membres = useMemo(() => d.ds.employes.filter(e => e.equipe === nom && present(e, d.ti)), [d, nom]);
  const mineurs = useMemo(() => mineursDeLEquipe(d.ds.employes, nom, d.ti), [d, nom]);
  const errNuit = nuit === 'oui' && mineurs.length
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
    const r = await run('referentiel.equipe.exigences', {
      nom, ...exigences, ...(nuit === 'nr' ? {} : { nuit: nuit === 'oui' }), ...(horaire !== (equipe?.horaire ?? '') ? { horaire } : {}),
    });
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
            <span style={{ fontSize: 14 }}>Travail de nuit ou en continu</span>
            <Seg name="equipe-nuit" label="Travail de nuit ou en continu" value={nuit} onChange={setNuit} style={{ alignSelf: 'flex-start' }}
              options={[...(equipe.nuit == null ? [['nr', 'À renseigner'] as ['nr', string]] : []), ['oui', 'Oui'], ['non', 'Non']]} />
            <span className="text-muted sub">
              {nuit === 'nr' ? 'Tant que la réponse n’est pas donnée, la fiche des salariés de moins de 18 ans rappelle l’interdiction du travail de nuit. '
                : ''}Une équipe de nuit ou en continu ne reçoit aucun salarié de moins de 18 ans (art. L3163-2).
            </span>
          </div>
        </Field>
        <Field label="Horaire de poste par défaut" htmlFor="equipe-horaire">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <select className="input" id="equipe-horaire" value={horaire} onChange={e => setHoraire(e.target.value)} style={{ maxWidth: 360 }}>
              <option value="">Aucun horaire</option>
              {horaireArchive?.archive && <option value={horaireArchive.code}>{horaireTexte(horaireArchive)} (archivé)</option>}
              {horaires.map(h => <option key={h.code} value={h.code}>{horaireTexte(h)} — {h.nom}</option>)}
            </select>
            <span className="text-muted sub">
              Proposé chaque jour où des heures sont saisies sur les feuilles de temps des membres, qui peuvent le changer jour par jour (Référentiels →
              Horaires). Facultatif : sans horaire, la feuille se tient comme avant.
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
