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
import { t } from '../i18n/langue.ts';

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
    <Dialog title={`${t('CSE mandate')}${e ? ` — ${e.nom}` : ''}`} width={520} onSubmit={envoyer}
      confirmation={retirer ? {
        texte: t('Remove this mandate? Its delegation hours counter disappears (the hours already charged stay on the timesheets). An ended mandate is rather kept with its end date.'),
        bouton: t('Remove the mandate'), occupe: busy, confirmer: supprimer, annuler: () => setRetirer(false),
      } : null}
      actions={disparu ? <CancelButton label={t('Close')} /> : <>
        {avant && <Btn onClick={() => setRetirer(true)} disabled={busy}>{t('Remove')}</Btn>}
        <CancelButton />
        <SubmitButton busy={busy}>{t('Save')}</SubmitButton>
      </>}>
      {disparu ? <Bloquant>{t('This mandate no longer exists.')}</Bloquant> : <>
        <Field label={t('Mandate')} erreur={v.erreur(erreurs.role)}>
          <Seg name="mandat-role" label={t('Mandate')} value={role} options={ROLES} onChange={choisirRole} />
        </Field>
        <div className="grid-2">
          <Field label={t('Start of the mandate')} htmlFor="mandat-du" requis erreur={du ? erreurs.du ?? null : v.erreur(erreurs.du)}>
            <input className="input" id="mandat-du" type="date" value={du} onChange={ev => setDu(ev.target.value)} />
          </Field>
          <Field label={t('End of the mandate')} htmlFor="mandat-au" erreur={erreurs.au ?? null}>
            <input className="input" id="mandat-au" type="date" value={au} onChange={ev => setAu(ev.target.value)} />
          </Field>
        </div>
        <Field label={t('Delegation hours credit per month')} htmlFor="mandat-credit" requis erreur={credit.trim() ? erreurs.credit ?? null : v.erreur(erreurs.credit)}>
          <input className="input" id="mandat-credit" inputMode="decimal" value={credit} onChange={ev => setCredit(ev.target.value.replace(/[^\d.,]/g, '').slice(0, 6))} style={{ maxWidth: 120 }} />
        </Field>
        <Fine>
          {legal != null
            ? `${t('Table of art. R2314-1 for a headcount of ')}${effectif}${t(' employees (excluding temporary work, to check): ')}${fH(legal)}${t(' a month for a full member. ')}`
            : `${t('Headcount of ')}${effectif}${t(' employees: credit to enter according to art. R2314-1. ')}`}
          {t('A substitute has no credit of their own: they receive hours by pooling (art. R2315-6). The counter alerts beyond one and a half times the credit within the month and when the 12-month carry-over is used up, without ever blocking.')}
        </Fine>
      </>}
    </Dialog>
  );
}
