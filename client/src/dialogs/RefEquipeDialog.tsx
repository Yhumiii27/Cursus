// Écran Référentiels, onglet Postes : formations et habilitations exigées de tous les membres d'une équipe, quel que soit
// leur poste (shared/rules/exigences.ts). Même proposition et même annonce que pour un poste (dialogs/RefPosteDialog.tsx).
// Case « travail de nuit ou en continu » : aucun salarié de moins de 18 ans dans une équipe cochée (shared/rules/mineurs.ts).
// Couverture minimale (SST, EPI incendie…) : aucun seuil par défaut, « 1 SST au minimum » proposé (shared/rules/couverture.ts).
import { useMemo, useState } from 'react';
import { present } from '../../../shared/rules/contrats.ts';
import { controlerExigences, effetExigences, effetTexte, exigencesEquipe, exigencesProposees, nombreExigences } from '../../../shared/rules/exigences.ts';
import { plural } from '../../../shared/format.ts';
import { mineursDeLEquipe } from '../../../shared/rules/mineurs.ts';
import { controlerCouverture, COUVERTURE_LIGNES_MAX, COUVERTURE_PROPOSEE, couvertureEquipe, RECOMMANDATION_INRS } from '../../../shared/rules/couverture.ts';
import { actif } from '../../../shared/rules/referentiels.ts';
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
  // Couverture minimale : lignes { formation, minimum } en cours de saisie (minimum gardé en texte pendant la frappe).
  const couvertureAvant = couvertureEquipe(equipe);
  const [couverture, setCouverture] = useState(() => couvertureAvant.map(l => ({ formation: l.formation, min: String(l.min) })));
  const [busy, setBusy] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const v = useVerification();

  const { erreurs } = controlerExigences(exigences, ref, avant);
  const membres = useMemo(() => d.ds.employes.filter(e => e.equipe === nom && present(e, d.ti)), [d, nom]);
  const saisie = couverture.map(l => ({ formation: l.formation, min: l.min.trim() === '' ? NaN : Number(l.min) }));
  const errCouverture = controlerCouverture(saisie, ref, membres.length, couvertureAvant).erreur;
  const couvertureChangee = JSON.stringify(saisie) !== JSON.stringify(couvertureAvant);
  // Formations proposées : catalogue en vigueur, et celles déjà suivies archivées depuis (gardées, sans effet).
  const formationsCouverture = ref.formations.filter(f => actif(f) || couvertureAvant.some(l => l.formation === f.id));
  const sst = ref.formations.find(f => f.id === COUVERTURE_PROPOSEE.formation && actif(f));
  const ligne = (i: number, x: Partial<{ formation: string; min: string }>) => setCouverture(c => c.map((l, j) => (j === i ? { ...l, ...x } : l)));
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
    if (busy || !v.verifier(erreurs.formations, erreurs.habilitations, errNuit, errCouverture, !equipe)) return;
    if (!force && nouveaux.length) { setConfirmer(true); return; }
    setBusy(true);
    const r = await run('referentiel.equipe.exigences', { nom, ...exigences, ...(nuit === 'nr' ? {} : { nuit: nuit === 'oui' }), ...(couvertureChangee ? { couverture: saisie } : {}) });
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
        <Field label="Couverture minimale (secouristes, équipiers incendie)" erreur={v.erreur(errCouverture)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {couverture.map((l, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <select className="input" aria-label={`Formation du seuil ${i + 1}`} value={l.formation} onChange={e => ligne(i, { formation: e.target.value })} style={{ flex: '1 1 220px' }}>
                  <option value="">Formation…</option>
                  {formationsCouverture.map(f => <option key={f.id} value={f.id}>{f.court}{actif(f) ? '' : ' (archivée)'}</option>)}
                </select>
                <input className="input" type="number" min={1} max={Math.max(1, membres.length)} step={1} inputMode="numeric" aria-label={`Minimum du seuil ${i + 1}`}
                  value={l.min} onChange={e => ligne(i, { min: e.target.value })} style={{ width: 96 }} />
                <span className="text-muted sub">au minimum</span>
                <Btn small onClick={() => setCouverture(c => c.filter((_, j) => j !== i))}>Retirer</Btn>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {couverture.length === 0 && sst && <Btn small onClick={() => setCouverture([{ formation: sst.id, min: String(COUVERTURE_PROPOSEE.min) }])}>Proposer 1 {sst.court} au minimum</Btn>}
              {couverture.length < COUVERTURE_LIGNES_MAX && <Btn small onClick={() => setCouverture(c => [...c, { formation: '', min: '1' }])}>Ajouter un seuil</Btn>}
            </div>
            <span className="text-muted sub">
              {couverture.length ? 'Chaque jour, au moins ce nombre de membres présents, sans absence en cours, titulaires d’une certification valide ; sinon une alerte datée. '
                : 'Aucun seuil : pas de suivi de la couverture pour cette équipe. '}{RECOMMANDATION_INRS} Équipes successives (2x8, 3x8, continu) : une équipe par quart.
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
