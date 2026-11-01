// lot 11 — dossiers OPCO : versement de l'OPCO (acompte ou solde, `opco.versement`) sur un dossier accordé, aux
// justificatifs envoyés ou déjà remboursé : date, montant, destinataire (l'entreprise, ou l'organisme en subrogation,
// proposé d'après le dossier), référence du virement ou de l'avis de paiement. Le nombre de versements affichés part avec
// la demande : un double clic n'enregistre pas le versement deux fois. Le dossier passe « Remboursé ».
import { useState } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { eurosOpco, montantOpco, montantsOpco, referenceValide, versementsDe } from '../../../shared/rules/opco.ts';
import type { DestinataireVersementOpco } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { erreurDate } from '../components/controles.ts';
import { Fine, Seg } from '../components/ui.tsx';
import { nomDossierOpco } from '../components/opco/commun.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function OpcoVersementDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const dossier = (d.ds.dossiersOpco ?? []).find(x => x.id === id) ?? null;
  const m = dossier ? montantsOpco(dossier, d.ds.versementsOpco) : null;
  const [le, setLe] = useState(d.ti);
  // Proposé : ce qui reste attendu (de l'entreprise, ou de l'organisme en subrogation).
  const [montant, setMontant] = useState(() => {
    const reste = m ? (dossier?.subrogation ? m.attenduOrganisme : m.aRecuperer) : 0;
    return reste > 0 ? String(reste).replace('.', ',') : '';
  });
  const [destinataire, setDestinataire] = useState<DestinataireVersementOpco>(dossier?.subrogation ? 'organisme' : 'entreprise');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!dossier || !m) return null;
  const deja = versementsDe(d.ds.versementsOpco, dossier.id);

  const montantNum = montant.trim() ? montantOpco(montant) : null;
  const montantErr = !montant.trim() ? 'Indiquez le montant versé.' : montantNum === null || montantNum === 0 ? 'Montant en euros, plus de 0 et 1 000 000 au plus.' : null;
  const dateErr = erreurDate(le, 'Indiquez la date du versement.')
    ?? (le > d.ti ? 'La date ne peut pas être dans le futur.' : dossier.accordLe && le < dossier.accordLe ? `Le versement précède l’accord (${fmtIso(dossier.accordLe)}).` : null);
  const refErr = reference.trim() && !referenceValide(reference.trim()) ? 'Lettres, chiffres, « . », « / », « _ » ou « - », sans espace, 40 caractères au plus.' : null;

  const envoyer = async () => {
    if (busy || !v.verifier(montantErr, dateErr, refErr)) return;
    setBusy(true);
    const r = await run('opco.versement', {
      id: dossier.id, le, montant: montant.trim().replace(/\s/g, '').replace(',', '.'), destinataire, reference: reference.trim(), versements: deja.length,
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Versement de l’OPCO" width={520} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer le versement</SubmitButton>
    </>}>
      <Field label="Dossier">
        <Static>{nomDossierOpco(d, dossier)}
          <div className="text-muted sub">
            {`Attendu ${eurosOpco(m.attendu)} · reçu ${eurosOpco(m.recuEntreprise + m.payeOrganisme)}`}
            {deja.length ? ` · ${deja.length} versement${deja.length > 1 ? 's' : ''} déjà enregistré${deja.length > 1 ? 's' : ''}` : ''}
          </div>
        </Static>
      </Field>
      <div className="grid-2">
        <Field label="Versé le" htmlFor="opco-v-le" requis erreur={v.erreur(dateErr) || (le ? dateErr : null)}>
          <input className="input" id="opco-v-le" type="date" min={dossier.accordLe ?? undefined} max={d.ti} value={le} onChange={e => setLe(e.target.value)} />
        </Field>
        <Field label="Montant (€)" htmlFor="opco-v-montant" requis erreur={v.erreur(montantErr) || (montant.trim() ? montantErr : null)}>
          <input className="input tnum" id="opco-v-montant" inputMode="decimal" value={montant} onChange={e => setMontant(e.target.value)} autoFocus />
        </Field>
      </div>
      <Field label="Payé à">
        <Seg name="opco-destinataire" label="Destinataire du versement" value={destinataire} onChange={setDestinataire} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
          options={[['entreprise', 'L’entreprise'], ['organisme', 'L’organisme (subrogation)']]} />
      </Field>
      <Field label="Référence du virement ou de l’avis de paiement" htmlFor="opco-v-ref" erreur={refErr}>
        <input className="input" id="opco-v-ref" value={reference} onChange={e => setReference(e.target.value)} autoComplete="off" />
      </Field>
      <Fine>
        Le dossier passe « Remboursé » ; un acompte n’empêche pas d’envoyer ensuite les justificatifs. Un versement saisi par erreur
        s’annule avec un motif, par l’administrateur RH.
      </Fine>
    </Dialog>
  );
}
