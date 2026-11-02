// lot 12 — C4 (organismes de formation et e-learning) : fusion d'un doublon dans la fiche qui reste (administrateur RH).
// La fiche absorbée est archivée et désigne celle qui la remplace ; ses objets (formations, sessions, formations suivies,
// lignes du plan, dossiers OPCO, modules, contacts, tarifs) sont réaffectés, ses graphies gardées en alias. Jamais deux
// fiches aux SIRET différents, ni un service interne avec un organisme externe (`refusFusion`). Pas de défusion simple :
// la liste des objets réaffectés est confirmée, et leur nombre envoyé (refus si l'écran est en retard). Motif obligatoire,
// gardé sur la fiche absorbée (service RH), jamais recopié au journal.
import { useState } from 'react';
import { plural } from '../../../shared/format.ts';
import { erreurMotifCorrection, MOTIF_CORRECTION_MAX } from '../../../shared/rules/corrections.ts';
import { organismeActif, rattachementsDe, refusFusion, TYPES_ORGANISME, type Rattachements } from '../../../shared/rules/organismes.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, NoteAccent } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

const LIBELLES: Record<keyof Rattachements, [string, string]> = {
  formations: ['formation du catalogue', 'formations du catalogue'], sessions: ['session', 'sessions'], suivies: ['formation suivie', 'formations suivies'],
  plan: ['ligne du plan', 'lignes du plan'], dossiers: ['dossier OPCO', 'dossiers OPCO'], modules: ['module d’e-learning', 'modules d’e-learning'],
  contacts: ['contact', 'contacts'], tarifs: ['tarif', 'tarifs'],
};

/** Objets réaffectés, en toutes lettres (« 2 formations du catalogue, 5 sessions »). */
export const objetsTexte = (r: Rattachements) =>
  (Object.keys(LIBELLES) as (keyof Rattachements)[]).filter(k => r[k] > 0).map(k => plural(r[k], LIBELLES[k][0], LIBELLES[k][1])).join(', ');

export function OrganismeFusionDialog({ source: id }: { source: number }) {
  const d = useDomain();
  const { run, closeDialog, setUi } = useStore();
  const liste = d.ds.organismes ?? [];
  const source = liste.find(o => o.id === id) ?? null;
  const [cible, setCible] = useState('');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const v = useVerification();
  const c = liste.find(o => o.id === Number(cible)) ?? null;
  // Fiches proposées : en vigueur, de même nature (interne ou non) ; une fiche au SIRET différent reste listée, refusée à l'envoi.
  const candidates = source ? liste.filter(o => o.id !== source.id && organismeActif(o) && (o.type === 'interne') === (source.type === 'interne'))
    .sort((a, b) => a.nomUsuel.localeCompare(b.nomUsuel, 'fr')) : [];
  const r = source ? rattachementsDe(d.ds, source.id) : null;
  const total = r ? Object.values(r).reduce((a, b) => a + b, 0) : 0;
  const errCible = !cible ? 'Choisissez la fiche qui reste.' : refusFusion(source, c);
  const errMotif = erreurMotifCorrection(motif);
  const envoyer = async (force = false) => {
    if (busy || !v.verifier(errCible, errMotif, !source)) return;
    if (!force) { setConfirmer(true); return; }
    setBusy(true);
    const res = await run('organisme.fusionner', { source: source!.id, cible: c!.id, motif, objets: total });
    setBusy(false);
    setConfirmer(false);
    if (!res.ok) return;
    closeDialog();
    setUi({ orgSel: c!.id });
  };
  return (
    <Dialog title={`Fusionner ${source?.nomUsuel ?? 'l’organisme'}`} width={560} onSubmit={() => envoyer()}
      confirmation={confirmer && c ? {
        texte: `Fusionner « ${source!.nomUsuel} » dans « ${c.nomUsuel} » ? ${total ? `${objetsTexte(r!)} passent à « ${c.nomUsuel} ».` : 'Aucun objet à réaffecter.'} Il n’y a pas de défusion simple.`,
        bouton: 'Fusionner', occupe: busy, confirmer: () => envoyer(true), annuler: () => setConfirmer(false),
      } : null}
      actions={!source ? <CancelButton label="Fermer" /> : <><CancelButton /><SubmitButton busy={busy}>Fusionner</SubmitButton></>}>
      {!source ? <Bloquant>Cet organisme n’existe plus.</Bloquant> : <>
        <Field label="Fiche absorbée (archivée ensuite)"><Static pad>{source.nomUsuel} · {TYPES_ORGANISME[source.type]}{source.siret ? ` · SIRET ${source.siret}` : ''}</Static></Field>
        <Field label="Fiche qui reste" htmlFor="of-cible" requis erreur={cible ? errCible : v.erreur(errCible)}>
          <select className="input" id="of-cible" autoFocus value={cible} onChange={e => setCible(e.target.value)}>
            <option value="">Choisir…</option>
            {candidates.map(o => <option key={o.id} value={o.id}>{o.nomUsuel}{o.siret ? ` · SIRET ${o.siret}` : ''}{o.aVerifier ? ' · à vérifier' : ''}</option>)}
          </select>
        </Field>
        {r && <p style={{ margin: 0, fontSize: 14 }}>{total ? `Réaffectés : ${objetsTexte(r)}.` : 'Aucun objet ne désigne cette fiche.'} Ses graphies ({[...new Set([source.nomUsuel, ...source.alias])].join(', ')}) deviennent des alias de la fiche qui reste.</p>}
        {c && !errCible && !c.siret && source.siret && <NoteAccent>Le SIRET {source.siret} passe à « {c.nomUsuel} », qui n’en avait pas.</NoteAccent>}
        <Field label="Motif de la fusion" htmlFor="of-motif" requis erreur={motif.trim() ? errMotif : v.erreur(errMotif)}>
          <textarea className="input" id="of-motif" rows={2} value={motif} maxLength={MOTIF_CORRECTION_MAX} placeholder="Même SIRET, graphie reprise d’un ancien texte libre…" onChange={e => setMotif(e.target.value)} />
        </Field>
        <Fine>Le motif reste sur la fiche absorbée, lu par le service RH seulement ; le journal note les codes des deux fiches et le nombre d’objets réaffectés.</Fine>
      </>}
    </Dialog>
  );
}
