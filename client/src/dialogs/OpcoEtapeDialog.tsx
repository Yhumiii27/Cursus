// lot 11 — dossiers OPCO : une étape du dossier (shared/rules/opco.ts, TRANSITIONS_OPCO), avec ce qu'elle demande :
//   déposer      date du dépôt, numéro du dossier chez l'OPCO (opco.deposer)
//   accorder     date, montant accordé, référence de l'accord, plafond horaire (opco.accorder)
//   refuser      date, motif de la liste fermée (opco.refuser) : jamais au journal ni à la lecture seule
//   facturer     justificatifs envoyés : date, montant facturé ; facture et certificat de réalisation joints au dossier
//                quand les pièces justificatives sont activées (opco.facturer)
//   solder       date, et la nature de l'écart accordé − reçu s'il en reste un (opco.solder)
//   abandonner   motif de la liste fermée (opco.abandonner)
// L'état affiché part avec la demande (`de`) : un double clic ou un autre onglet ne refait pas l'étape.
import { useState } from 'react';
import { decap, fmtIso } from '../../../shared/format.ts';
import {
  ecartAuSolde, ECARTS_SOLDE_OPCO, type EtapeOpco, eurosOpco, montantOpco, MOTIFS_ABANDON_OPCO, MOTIFS_REFUS_OPCO, NATURES_PIECE_OPCO, piecesPourFacturer,
  referenceValide, STATUTS_OPCO,
} from '../../../shared/rules/opco.ts';
import { depotOuvert, piecesDe } from '../../../shared/rules/pieces.ts';
import type { EcartSoldeOpco, MotifAbandonOpco, MotifRefusOpco } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { erreurDate } from '../components/controles.ts';
import { Btn, Fine } from '../components/ui.tsx';
import { nomDossierOpco } from '../components/opco/commun.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import type { NomAction } from '../api.ts';
import { t } from '../i18n/langue.ts';

/** Titre, bouton et libellé de la date de chaque étape : chaînes sources anglaises, traduites au rendu. */
const TITRES: Record<EtapeOpco, { titre: string; bouton: string; date: string }> = {
  deposer: { titre: 'File filed with the OPCO', bouton: 'Save the filing', date: 'Filed on' },
  accorder: { titre: 'Approval of the OPCO', bouton: 'Save the approval', date: 'Granted on' },
  refuser: { titre: 'Refusal of the OPCO', bouton: 'Save the refusal', date: 'Refused on' },
  facturer: { titre: 'Supporting documents sent to the OPCO', bouton: 'Save the sending', date: 'Sent on#plural' },
  solder: { titre: 'Settle the OPCO file', bouton: 'Settle the file', date: 'Settled on' },
  abandonner: { titre: 'Abandon the OPCO file', bouton: 'Abandon the file', date: '' },
};

/** Action de chaque étape, nommée en entier (tests/actions-contrat.test.ts : aucun nom construit). */
const ACTIONS = {
  deposer: 'opco.deposer', accorder: 'opco.accorder', refuser: 'opco.refuser', facturer: 'opco.facturer', solder: 'opco.solder', abandonner: 'opco.abandonner',
} as const satisfies Record<EtapeOpco, NomAction>;

/** Message sous un montant : vide (exigé) ou mal écrit. */
function erreurMontant(v: string, vide: string | null): string | null {
  if (!v.trim()) return vide;
  return montantOpco(v) === null ? t('Amount in euros, from 0 to 1,000,000.') : null;
}
const erreurReference = (v: string) => (v.trim() && !referenceValide(v.trim()) ? t('Letters, digits, “.”, “/”, “_” or “-”, without a space, 40 characters at most.') : null);

export function OpcoEtapeDialog({ id, etape }: { id: number; etape: EtapeOpco }) {
  const d = useDomain();
  const { run, closeDialog, openDialog } = useStore();
  const dossier = (d.ds.dossiersOpco ?? []).find(x => x.id === id) ?? null;
  const [le, setLe] = useState(d.ti);
  const [reference, setReference] = useState(() => (etape === 'deposer' ? dossier?.reference ?? '' : ''));
  const [montant, setMontant] = useState(() => {
    if (etape === 'accorder') return dossier?.montantDemande != null ? String((dossier.montantDemande ?? 0) + (dossier.montantDemandeAnnexes ?? 0)).replace('.', ',') : '';
    if (etape === 'facturer') return dossier?.montantAccorde != null ? String(dossier.montantAccorde).replace('.', ',') : '';
    return '';
  });
  const [plafond, setPlafond] = useState('');
  const [motif, setMotif] = useState('');
  const [nature, setNature] = useState<EcartSoldeOpco | ''>('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!dossier) return null;
  const ti = TITRES[etape];
  const nom = nomDossierOpco(d, dossier);

  // Pièces de la demande de remboursement : exigées par le serveur quand les pièces justificatives sont activées.
  const piecesActives = depotOuvert(d.ds.settings.piecesStockage);
  const manquent = etape === 'facturer' && piecesActives ? piecesPourFacturer(piecesDe(d.ds.pieces, 'dossierOpco', dossier.id).map(p => p.nature)) : [];
  const solde = etape === 'solder' ? ecartAuSolde(dossier, d.ds.versementsOpco) : null;
  // Date du fait : jamais dans le futur, jamais avant l'étape précédente (contrôle repris du serveur).
  const avant = etape === 'accorder' || etape === 'refuser' ? dossier.deposeLe : etape === 'facturer' ? dossier.accordLe : etape === 'solder' ? dossier.factureLe : null;
  const dateErr = etape === 'abandonner' ? null : erreurDate(le, t('Enter the date.'))
    ?? (le > d.ti ? t('The date cannot be in the future.') : avant && le < avant ? `${t('The date comes before that of the previous step (')}${fmtIso(avant)}).` : null);
  const montantErr = etape === 'accorder' ? erreurMontant(montant, t('Enter the amount granted.')) : etape === 'facturer' ? erreurMontant(montant, t('Enter the amount invoiced.')) : null;
  const plafondErr = etape === 'accorder' ? erreurMontant(plafond, null) : null;
  const refErr = erreurReference(reference);
  const motifErr = (etape === 'refuser' || etape === 'abandonner') && !motif ? t('Choose the reason.') : null;
  const piecesErr = manquent.length ? `${t('First attach to the file: ')}${manquent.map(n => decap(NATURES_PIECE_OPCO[n])).join(', ')}.` : null;

  const envoyer = async () => {
    if (busy || !v.verifier(dateErr, montantErr, plafondErr, refErr, motifErr, piecesErr)) return;
    setBusy(true);
    const m = montant.trim().replace(/\s/g, '').replace(',', '.');
    const payload: Record<string, unknown> = { id: dossier.id, de: dossier.statut };
    if (etape === 'deposer') Object.assign(payload, { deposeLe: le, reference: reference.trim() });
    if (etape === 'accorder') Object.assign(payload, { accordLe: le, montantAccorde: m, accordReference: reference.trim(), plafondHoraire: plafond.trim().replace(',', '.') });
    if (etape === 'refuser') Object.assign(payload, { refusLe: le, motif });
    if (etape === 'facturer') Object.assign(payload, { factureLe: le, montantFacture: m });
    if (etape === 'solder') Object.assign(payload, { soldeLe: le, ...(nature ? { nature } : {}) });
    if (etape === 'abandonner') Object.assign(payload, { motif });
    const r = await run(ACTIONS[etape], payload);
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t(ti.titre)} width={520} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t(ti.bouton)}</SubmitButton>
    </>}>
      <Field label={t('File#opco')}>
        <Static>{nom}<div className="text-muted sub">{t('“#open')}{STATUTS_OPCO[dossier.statut].label}{t('”#close')}{dossier.reference ? ` · ${t('file#opco')} ${dossier.reference}` : ''}</div></Static>
      </Field>
      {etape !== 'abandonner' && (
        <Field label={t(ti.date)} htmlFor="opco-le" requis erreur={v.erreur(dateErr) || (le ? dateErr : null)}>
          <input className="input" id="opco-le" type="date" min={avant ?? undefined} max={d.ti} value={le} onChange={e => setLe(e.target.value)} />
        </Field>
      )}
      {etape === 'deposer' && (
        <Field label={t('Number of the file at the OPCO')} htmlFor="opco-ref" erreur={refErr}>
          <input className="input" id="opco-ref" value={reference} onChange={e => setReference(e.target.value)} autoComplete="off" />
        </Field>
      )}
      {etape === 'accorder' && <>
        <div className="grid-2">
          <Field label={t('Amount granted (€)')} htmlFor="opco-montant" requis erreur={v.erreur(montantErr) || (montant.trim() ? montantErr : null)}>
            <input className="input tnum" id="opco-montant" inputMode="decimal" value={montant} onChange={e => setMontant(e.target.value)} autoFocus />
          </Field>
          <Field label={t('Hourly cap (€ / h)')} htmlFor="opco-plafond" erreur={plafondErr}>
            <input className="input tnum" id="opco-plafond" inputMode="decimal" value={plafond} onChange={e => setPlafond(e.target.value)} />
          </Field>
        </div>
        <Field label={t('Reference of the approval')} htmlFor="opco-ref" erreur={refErr}>
          <input className="input" id="opco-ref" value={reference} onChange={e => setReference(e.target.value)} autoComplete="off" />
        </Field>
      </>}
      {etape === 'facturer' && (
        <Field label={t('Amount invoiced (€)')} htmlFor="opco-montant" requis erreur={v.erreur(montantErr) || (montant.trim() ? montantErr : null)}>
          <input className="input tnum" id="opco-montant" inputMode="decimal" value={montant} onChange={e => setMontant(e.target.value)} autoFocus />
        </Field>
      )}
      {(etape === 'refuser' || etape === 'abandonner') && (
        <Field label={t(etape === 'refuser' ? 'Reason for the refusal' : 'Reason for the abandonment')} htmlFor="opco-motif" requis erreur={v.erreur(motifErr)}>
          <select className="input" id="opco-motif" value={motif} onChange={e => setMotif(e.target.value)}>
            <option value="">{t('Choose…')}</option>
            {Object.entries<string>(etape === 'refuser' ? MOTIFS_REFUS_OPCO : MOTIFS_ABANDON_OPCO).map(([k, l]) => <option key={k} value={k as MotifRefusOpco | MotifAbandonOpco}>{l}</option>)}
          </select>
        </Field>
      )}
      {solde && (
        solde.ecart > 0
          ? <Field label={`${t('Remaining difference: ')}${eurosOpco(solde.ecart)}${t(' granted not received')}`} htmlFor="opco-ecart">
              <select className="input" id="opco-ecart" value={nature || solde.nature} onChange={e => setNature(e.target.value as EcartSoldeOpco)}>
                {(['partiel', 'perte'] as const).map(k => <option key={k} value={k}>{ECARTS_SOLDE_OPCO[k]}</option>)}
              </select>
            </Field>
          : <Fine>{t('All of the granted amount has been received: the file is settled without difference.')}</Fine>
      )}
      {piecesErr && (
        <div className={`note-accent${v.tente ? ' bloquant' : ''}`} tabIndex={v.tente ? -1 : undefined} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span style={{ flex: 1 }}>{piecesErr}</span>
          <Btn small onClick={() => openDialog({ type: 'opcoPiece', id: dossier.id, nature: manquent[0] })}>{t('Attach a document')}</Btn>
        </div>
      )}
      <Fine>
        {etape === 'refuser' || etape === 'abandonner' ? t('The reason stays on the file, with HR: never in the log nor in read only. ') : ''}
        {etape === 'facturer' ? t('Reimbursement request: invoice and certificate of completion (or attendance sheets) to send to the OPCO. ') : ''}
        {etape === 'solder' ? t('The settlement freezes the difference between the granted and the received amounts; the file leaves the reminders. ') : ''}
        {etape === 'abandonner' ? t('The file leaves the reminders; the line of the plan can be deleted again. ') : ''}
        {t('The HR administrator can go back on a step recorded by mistake.')}
      </Fine>
    </Dialog>
  );
}
