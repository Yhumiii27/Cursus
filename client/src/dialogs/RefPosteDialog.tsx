// Écran Référentiels, onglet Postes : nouveau poste, ou modification d'un poste (intitulé, formations et habilitations
// exigées, suivi individuel renforcé de ses titulaires, exposition à des risques particuliers). Contrôles partagés avec le serveur (shared/rules/exigences.ts). Point de départ proposé : les titres que
// détiennent déjà tous ses titulaires, à valider. Une exigence ajoutée rend non conformes les titulaires à qui elle
// manque : ils sont annoncés, et l'enregistrement se confirme.
import { useMemo, useState } from 'react';
import { plural } from '../../../shared/format.ts';
import { controlerPoste, effetExigences, effetTexte, exigencesProposees, nombreExigences, titulaires } from '../../../shared/rules/exigences.ts';
import type { Exigences } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { ExigencesChoix } from '../components/ExigencesChoix.tsx';
import { Btn, Fine, NoteAccent } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Proposition déjà toute cochée : rien à reprendre. */
const inclus = (a: Exigences, b: Exigences) => a.formations.every(f => b.formations.includes(f)) && a.habilitations.every(h => b.habilitations.includes(h));

export function RefPosteDialog({ id }: { id?: number | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const ref = d.ds.referentiels;
  // Poste figé à l'ouverture (modification) ; disparu entre-temps : rien à enregistrer.
  const [avant] = useState(() => (id != null ? ref.postes.find(p => p.id === id) ?? null : null));
  const [nom, setNom] = useState(avant?.nom ?? '');
  const [exigences, setExigences] = useState<Exigences>({ formations: avant?.formations ?? [], habilitations: avant?.habilitations ?? [] });
  // Poste à risques particuliers : ses titulaires relèvent du suivi individuel renforcé (décoché par défaut).
  const [sir, setSir] = useState(avant?.sir ?? false);
  // Poste exposé à des risques particuliers : visite post-exposition de ses titulaires à leur sortie (décoché par défaut).
  const [expose, setExpose] = useState(avant?.expose ?? false);
  const [busy, setBusy] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const v = useVerification();
  const disparu = id != null && !avant;

  const { erreurs, poste } = controlerPoste({ nom, ...exigences, sir, expose }, ref, avant?.id ?? null);
  const membres = useMemo(() => (avant ? titulaires(d.ds, avant.id) : []), [d, avant]);
  const proposees = useMemo(() => exigencesProposees(d.ds, membres), [d, membres]);
  // Salariés à qui il manquera une exigence de plus : calculé quand les exigences changent.
  const cle = poste ? JSON.stringify(poste) : null;
  const effet = useMemo(() => {
    if (!avant || !cle) return null;
    const x = JSON.parse(cle) as typeof poste;
    return effetExigences(d.ds, { postes: ref.postes.map(p => (p.id === avant.id ? { ...p, ...x } : p)) });
  }, [d, ref.postes, avant, cle]);
  const nouveaux = effet?.nouveaux ?? [];

  const envoyer = async (force = false) => {
    if (busy || !v.verifier(erreurs.nom, erreurs.formations, erreurs.habilitations, disparu)) return;
    if (!force && nouveaux.length) { setConfirmer(true); return; }
    setBusy(true);
    const p = { nom: nom.trim(), ...exigences, sir, expose };
    const r = await run('referentiel.poste.enregistrer', avant ? { id: avant.id, ...p } : p);
    setBusy(false);
    if (r.ok) closeDialog();
    else setConfirmer(false);
  };

  return (
    <Dialog title={avant ? `Poste ${avant.nom}` : 'Nouveau poste'} width={620} onSubmit={() => envoyer()}
      confirmation={confirmer ? {
        texte: `${effetTexte(effet!)}. Enregistrer quand même ?`,
        bouton: 'Enregistrer quand même', occupe: busy, confirmer: () => envoyer(true), annuler: () => setConfirmer(false),
      } : null}
      actions={disparu ? <CancelButton label="Fermer" /> : <>
        <CancelButton />
        <SubmitButton busy={busy}>{avant ? 'Enregistrer' : 'Ajouter au référentiel'}</SubmitButton>
      </>}>
      {disparu ? <Bloquant>Ce poste n’existe plus.</Bloquant> : <>
        <Field label="Intitulé du poste" htmlFor="rposte-nom" requis erreur={nom.trim() ? erreurs.nom ?? null : v.erreur(erreurs.nom)}>
          <input className="input" id="rposte-nom" type="text" autoFocus value={nom} maxLength={80} placeholder="Cariste" onChange={e => setNom(e.target.value)} />
        </Field>
        <ExigencesChoix value={exigences} onChange={setExigences} avant={avant} erreurs={{ formations: v.erreur(erreurs.formations), habilitations: v.erreur(erreurs.habilitations) }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
          <input type="checkbox" checked={sir} onChange={e => setSir(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
          Poste à risques particuliers : suivi individuel renforcé de ses titulaires (art. R4624-23)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
          <input type="checkbox" checked={expose} onChange={e => setExpose(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
          Poste exposé à des risques particuliers (agents chimiques dangereux, CMR, ATEX…) : visite post-exposition à la sortie (art. L4624-2-1)
        </label>
        {avant && nombreExigences(proposees) > 0 && !inclus(proposees, exigences) && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Fine>
              Détenus par {membres.length > 1 ? `les ${membres.length} titulaires` : 'son titulaire'} :{' '}
              {[...proposees.formations.map(f => d.fm(f).court), ...proposees.habilitations.map(h => d.hm(h).nom)].join(', ')}.
            </Fine>
            <Btn small onClick={() => setExigences({ formations: [...new Set([...exigences.formations, ...proposees.formations])], habilitations: [...new Set([...exigences.habilitations, ...proposees.habilitations])] })}>
              Reprendre ces titres
            </Btn>
          </div>
        )}
        <Fine>
          {avant ? `${plural(membres.length, 'salarié occupe', 'salariés occupent')} ce poste. ` : ''}
          Une exigence jamais obtenue rend le salarié « Non conforme », avec une échéance « exigence manquante » (inscrire à la
          formation, demander l’habilitation). Sans exigence, le statut des titulaires ne change pas.
          {avant && nom.trim() && nom.trim() !== avant.nom ? ' Le nouvel intitulé est recopié sur leurs fiches.' : ''}
        </Fine>
        {nouveaux.length > 0 && !confirmer && <NoteAccent>{effetTexte(effet!)}.</NoteAccent>}
        {effet && effet.resolus > 0 && <Fine>{plural(effet.resolus, 'salarié n’a plus d’exigence manquante', 'salariés n’ont plus d’exigence manquante')}.</Fine>}
      </>}
    </Dialog>
  );
}
