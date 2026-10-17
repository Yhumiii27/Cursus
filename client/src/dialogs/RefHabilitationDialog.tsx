// Écran Référentiels : nouvelle habilitation, ou modification d'une habilitation (son code ne change plus) :
// formations prérequises prises dans le catalogue, aptitude médicale exigée, validité, signataire proposé par défaut
// à la délivrance, suivi individuel renforcé de ses titulaires (case décochée par défaut). Une règle modifiée (validité, prérequis, aptitude) vaut aussi pour les titres déjà délivrés :
// ceux qui deviennent non valides sont annoncés, et l'enregistrement se confirme.
import { useMemo, useState } from 'react';
import { plural, validiteLabel } from '../../../shared/format.ts';
import {
  actif, codeSuggere, controlerHabilitation, effetModification, titresTexte, VALIDITE_MAX, type ChampHabilitation,
} from '../../../shared/rules/referentiels.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, NoteAccent } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function RefHabilitationDialog({ id }: { id?: string | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const liste = d.ds.referentiels.habilitations;
  const [avant] = useState(() => (id ? liste.find(h => h.id === id) ?? null : null));
  const [nom, setNom] = useState(avant?.nom ?? '');
  const [detail, setDetail] = useState(avant?.detail ?? '');
  const [code, setCode] = useState('');
  const [prereqs, setPrereqs] = useState<string[]>(avant?.prereqs ?? []);
  const [medical, setMedical] = useState(avant?.medical ?? false);
  const [sir, setSir] = useState(avant?.sir ?? false);
  const [validite, setValidite] = useState(avant ? String(avant.validite) : '');
  const [signataire, setSignataire] = useState(avant?.signataire ?? '');
  const [busy, setBusy] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const v = useVerification();
  const disparue = !!id && !avant;

  // Formations proposées : le catalogue en vigueur, et les prérequis déjà inscrits d'une formation archivée depuis (une
  // habilitation archivée les garde ; en vigueur, elle ne peut pas les exiger : controlerHabilitation les signale).
  const formations = d.ds.referentiels.formations.filter(f => actif(f) || avant?.prereqs.includes(f.id));
  const propose = nom.trim() ? codeSuggere(nom, liste.map(h => h.id)) : '';
  const codeFinal = code.trim() || propose;
  // Prérequis dans l'ordre du catalogue, quel que soit l'ordre des cases cochées.
  const champs = { nom, detail, prereqs: formations.map(f => f.id).filter(f => prereqs.includes(f)), medical, validite, signataire, sir };
  const { erreurs, habilitation } = controlerHabilitation({ ...champs, code: codeFinal }, liste, d.ds.referentiels.formations, avant?.id ?? null);
  const erreur = (k: ChampHabilitation, saisi: string) => (saisi.trim() ? erreurs[k] ?? null : v.erreur(erreurs[k]));
  const n = Number(validite);
  // Titres délivrés dont le statut change avec la nouvelle règle (validité, prérequis, aptitude).
  const regle = habilitation ? JSON.stringify([habilitation.validite, [...habilitation.prereqs].sort(), habilitation.medical]) : null;
  const effet = useMemo(() => {
    if (!avant || !regle || regle === JSON.stringify([avant.validite, [...avant.prereqs].sort(), avant.medical])) return null;
    const [val, pre, med] = JSON.parse(regle) as [number, string[], boolean];
    return effetModification(d.ds, 'habilitations', { ...avant, validite: val, prereqs: pre, medical: med });
  }, [d, avant, regle]);
  const echus = effet?.echus ?? [];
  const cocher = (f: string, oui: boolean) => setPrereqs(p => (oui ? [...p, f] : p.filter(x => x !== f)));

  const envoyer = async (force = false) => {
    if (busy || !v.verifier(...Object.values(erreurs), disparue)) return;
    if (!force && echus.length) { setConfirmer(true); return; }
    setBusy(true);
    const p = { ...champs, signataire: signataire.trim() };
    const r = await run('referentiel.habilitation.enregistrer', avant ? { id: avant.id, ...p } : { code: codeFinal, ...p });
    setBusy(false);
    if (r.ok) closeDialog();
    else setConfirmer(false);
  };

  return (
    <Dialog title={avant ? avant.nom : 'Nouvelle habilitation'} width={620} onSubmit={() => envoyer()}
      confirmation={confirmer ? {
        texte: `${plural(echus.length, 'titre devient non valide', 'titres deviennent non valides')} avec cette règle : ${titresTexte(echus)}. Enregistrer quand même ?`,
        bouton: 'Enregistrer quand même', occupe: busy, confirmer: () => envoyer(true), annuler: () => setConfirmer(false),
      } : null}
      actions={disparue ? <CancelButton label="Fermer" /> : <>
        <CancelButton />
        <SubmitButton busy={busy}>{avant ? 'Enregistrer' : 'Ajouter au référentiel'}</SubmitButton>
      </>}>
      {disparue ? <Bloquant>Cette habilitation n’existe plus.</Bloquant> : <>
        <Field label="Intitulé" htmlFor="rhab-nom" requis erreur={erreur('nom', nom)}>
          <input className="input" id="rhab-nom" type="text" autoFocus value={nom} maxLength={120} placeholder="Habilitation électrique" onChange={e => setNom(e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label="Précision" htmlFor="rhab-detail" erreur={erreur('detail', detail)}>
            <input className="input" id="rhab-detail" type="text" value={detail} maxLength={120} placeholder="B1V · B2V · BR — NF C18-510" onChange={e => setDetail(e.target.value)} />
          </Field>
          {avant
            ? <Field label="Code"><Static pad>{avant.id}</Static></Field>
            : (
              <Field label="Code" htmlFor="rhab-code" requis erreur={erreur('code', code)}>
                <input className="input" id="rhab-code" type="text" value={code} maxLength={32} placeholder={propose || 'd’après l’intitulé'} onChange={e => setCode(e.target.value)} />
              </Field>
            )}
        </div>
        <Field label="Formations prérequises" erreur={v.erreur(erreurs.prereqs)}>
          {formations.length
            ? (
              <div className="chips" role="group" aria-label="Formations prérequises" style={{ gap: 'var(--space-2) var(--space-4)' }}>
                {formations.map(f => (
                  <label key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, cursor: 'pointer' }}>
                    <input type="checkbox" checked={prereqs.includes(f.id)} onChange={e => cocher(f.id, e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
                    {f.court}{f.archive ? <span className="text-muted"> · archivée</span> : null}
                  </label>
                ))}
              </div>
            )
            : <Static pad>Catalogue des formations vide : aucun prérequis possible.</Static>}
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
          <input type="checkbox" checked={medical} onChange={e => setMedical(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
          Aptitude médicale exigée (visite d’aptitude en cours de validité)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
          <input type="checkbox" checked={sir} onChange={e => setSir(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
          Suivi individuel renforcé de ses titulaires (art. R4624-23 : autorisation de conduite, habilitation électrique…)
        </label>
        <div className="grid-2">
          <Field label="Validité (mois)" htmlFor="rhab-validite" requis erreur={erreur('validite', validite)}>
            <input className="input" id="rhab-validite" type="number" inputMode="numeric" min={1} max={VALIDITE_MAX} step={1} value={validite} placeholder="36" onChange={e => setValidite(e.target.value)} />
          </Field>
          <Field label="Signataire par défaut" htmlFor="rhab-signataire" requis erreur={erreur('signataire', signataire)}>
            <input className="input" id="rhab-signataire" type="text" value={signataire} maxLength={80} placeholder="Responsable maintenance" onChange={e => setSignataire(e.target.value)} />
          </Field>
        </div>
        <Fine>
          {Number.isInteger(n) && n >= 1 && n <= VALIDITE_MAX ? `Validité : ${validiteLabel(n)}. ` : ''}
          Le signataire est proposé à chaque délivrance, modifiable.{' '}
          {avant
            ? 'Validité, prérequis et aptitude valent aussi pour les titres déjà délivrés.'
            : 'Le code identifie l’habilitation dans les dossiers et auprès de Keystone (exigences des chantiers) : il ne change plus après la création.'}
        </Fine>
        {echus.length > 0 && !confirmer && <NoteAccent>{plural(echus.length, 'titre devient non valide', 'titres deviennent non valides')} avec cette règle : {titresTexte(echus)}.</NoteAccent>}
        {effet && effet.retablis.length > 0 && <Fine>{plural(effet.retablis.length, 'titre redevient valide', 'titres redeviennent valides')} avec cette règle.</Fine>}
      </>}
    </Dialog>
  );
}
