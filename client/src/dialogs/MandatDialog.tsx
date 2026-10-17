// Mandat d'élu au CSE (fiche Collaborateurs, service RH) : titulaire ou suppléant, dates, crédit d'heures de délégation
// par mois. Le crédit d'un titulaire est proposé d'après la table de l'art. R2314-1 selon l'effectif (modifiable : accord,
// effectif à vérifier) ; un suppléant n'a pas de crédit propre (heures reçues par mutualisation). Contrôles partagés
// avec le serveur (shared/rules/delegation.ts) ; un mandat saisi par erreur se retire après confirmation.
import { useState } from 'react';
import { fH } from '../../../shared/format.ts';
import { controlerMandat, creditLegal, creditPropose, effectifReference, mandatsDe, ROLES_MANDAT } from '../../../shared/rules/delegation.ts';
import type { RoleMandat } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Btn, Fine, Seg } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

const ROLES = Object.entries(ROLES_MANDAT) as [RoleMandat, string][];

export function MandatDialog({ empId, id }: { empId: number; id?: number | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const e = d.emp(empId);
  const [avant] = useState(() => (id != null ? mandatsDe(d.ds, empId).find(m => m.id === id) ?? null : null));
  const effectif = effectifReference(d.ds, d.ti);
  const [role, setRole] = useState<RoleMandat>(avant?.role ?? 'titulaire');
  const [du, setDu] = useState(avant?.du ?? '');
  const [au, setAu] = useState(avant?.au ?? '');
  const [credit, setCredit] = useState(String(avant?.credit ?? creditPropose('titulaire', effectif)).replace('.', ','));
  const [busy, setBusy] = useState(false);
  const [retirer, setRetirer] = useState(false);
  const v = useVerification();
  const disparu = (id != null && !avant) || !e;

  const { erreurs } = controlerMandat({ role, du, au, credit: credit.replace(',', '.') }, mandatsDe(d.ds, empId).filter(m => m.id !== avant?.id));
  const legal = creditLegal(effectif);
  const choisirRole = (r: RoleMandat) => {
    setRole(r);
    // Crédit proposé tant que la saisie n'a pas été modifiée à la main.
    if (!avant) setCredit(String(creditPropose(r, effectif)).replace('.', ','));
  };

  const envoyer = async () => {
    if (busy || !v.verifier(erreurs.role, erreurs.du, erreurs.au, erreurs.credit, disparu)) return;
    setBusy(true);
    const r = await run('mandat.enregistrer', { ...(avant ? { id: avant.id } : { empId }), role, du, au: au || null, credit: credit.replace(',', '.') });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  const supprimer = async () => {
    setBusy(true);
    const r = await run('mandat.supprimer', { id: avant!.id });
    setBusy(false);
    if (r.ok) closeDialog();
    else setRetirer(false);
  };

  return (
    <Dialog title={`Mandat au CSE${e ? ` — ${e.nom}` : ''}`} width={520} onSubmit={envoyer}
      confirmation={retirer ? {
        texte: 'Retirer ce mandat ? Son compteur d’heures de délégation disparaît (les heures déjà imputées restent sur les feuilles). Un mandat terminé se garde plutôt avec sa date de fin.',
        bouton: 'Retirer le mandat', occupe: busy, confirmer: supprimer, annuler: () => setRetirer(false),
      } : null}
      actions={disparu ? <CancelButton label="Fermer" /> : <>
        {avant && <Btn onClick={() => setRetirer(true)} disabled={busy}>Retirer</Btn>}
        <CancelButton />
        <SubmitButton busy={busy}>Enregistrer</SubmitButton>
      </>}>
      {disparu ? <Bloquant>Ce mandat n’existe plus.</Bloquant> : <>
        <Field label="Mandat" erreur={v.erreur(erreurs.role)}>
          <Seg name="mandat-role" label="Mandat" value={role} options={ROLES} onChange={choisirRole} />
        </Field>
        <div className="grid-2">
          <Field label="Début du mandat" htmlFor="mandat-du" requis erreur={du ? erreurs.du ?? null : v.erreur(erreurs.du)}>
            <input className="input" id="mandat-du" type="date" value={du} onChange={ev => setDu(ev.target.value)} />
          </Field>
          <Field label="Fin du mandat" htmlFor="mandat-au" erreur={erreurs.au ?? null}>
            <input className="input" id="mandat-au" type="date" value={au} onChange={ev => setAu(ev.target.value)} />
          </Field>
        </div>
        <Field label="Crédit d’heures de délégation par mois" htmlFor="mandat-credit" requis erreur={credit.trim() ? erreurs.credit ?? null : v.erreur(erreurs.credit)}>
          <input className="input" id="mandat-credit" inputMode="decimal" value={credit} onChange={ev => setCredit(ev.target.value.replace(/[^\d.,]/g, '').slice(0, 6))} style={{ maxWidth: 120 }} />
        </Field>
        <Fine>
          {legal != null
            ? `Table de l’art. R2314-1 pour un effectif de ${effectif} salariés (hors intérim, à vérifier) : ${fH(legal)} par mois pour un titulaire. `
            : `Effectif de ${effectif} salariés : crédit à saisir d’après l’art. R2314-1. `}
          Un suppléant n’a pas de crédit propre : il reçoit des heures par mutualisation (art. R2315-6). Le compteur alerte au-delà d’une fois et demie le crédit
          dans le mois et quand le report sur 12 mois est épuisé, sans jamais bloquer.
        </Fine>
      </>}
    </Dialog>
  );
}
