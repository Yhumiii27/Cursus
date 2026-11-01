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

const TITRES: Record<EtapeOpco, { titre: string; bouton: string; date: string }> = {
  deposer: { titre: 'Dossier déposé à l’OPCO', bouton: 'Enregistrer le dépôt', date: 'Déposé le' },
  accorder: { titre: 'Accord de l’OPCO', bouton: 'Enregistrer l’accord', date: 'Accordé le' },
  refuser: { titre: 'Refus de l’OPCO', bouton: 'Enregistrer le refus', date: 'Refusé le' },
  facturer: { titre: 'Justificatifs envoyés à l’OPCO', bouton: 'Enregistrer l’envoi', date: 'Envoyés le' },
  solder: { titre: 'Solder le dossier OPCO', bouton: 'Solder le dossier', date: 'Soldé le' },
  abandonner: { titre: 'Abandonner le dossier OPCO', bouton: 'Abandonner le dossier', date: '' },
};

/** Action de chaque étape, nommée en entier (tests/actions-contrat.test.ts : aucun nom construit). */
const ACTIONS = {
  deposer: 'opco.deposer', accorder: 'opco.accorder', refuser: 'opco.refuser', facturer: 'opco.facturer', solder: 'opco.solder', abandonner: 'opco.abandonner',
} as const satisfies Record<EtapeOpco, NomAction>;

/** Message sous un montant : vide (exigé) ou mal écrit. */
function erreurMontant(v: string, vide: string | null): string | null {
  if (!v.trim()) return vide;
  return montantOpco(v) === null ? 'Montant en euros, de 0 à 1 000 000.' : null;
}
const erreurReference = (v: string) => (v.trim() && !referenceValide(v.trim()) ? 'Lettres, chiffres, « . », « / », « _ » ou « - », sans espace, 40 caractères au plus.' : null);

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
  const t = TITRES[etape];
  const nom = nomDossierOpco(d, dossier);

  // Pièces de la demande de remboursement : exigées par le serveur quand les pièces justificatives sont activées.
  const piecesActives = depotOuvert(d.ds.settings.piecesStockage);
  const manquent = etape === 'facturer' && piecesActives ? piecesPourFacturer(piecesDe(d.ds.pieces, 'dossierOpco', dossier.id).map(p => p.nature)) : [];
  const solde = etape === 'solder' ? ecartAuSolde(dossier, d.ds.versementsOpco) : null;
  // Date du fait : jamais dans le futur, jamais avant l'étape précédente (contrôle repris du serveur).
  const avant = etape === 'accorder' || etape === 'refuser' ? dossier.deposeLe : etape === 'facturer' ? dossier.accordLe : etape === 'solder' ? dossier.factureLe : null;
  const dateErr = etape === 'abandonner' ? null : erreurDate(le, 'Indiquez la date.')
    ?? (le > d.ti ? 'La date ne peut pas être dans le futur.' : avant && le < avant ? `La date précède celle de l’étape précédente (${fmtIso(avant)}).` : null);
  const montantErr = etape === 'accorder' ? erreurMontant(montant, 'Indiquez le montant accordé.') : etape === 'facturer' ? erreurMontant(montant, 'Indiquez le montant facturé.') : null;
  const plafondErr = etape === 'accorder' ? erreurMontant(plafond, null) : null;
  const refErr = erreurReference(reference);
  const motifErr = (etape === 'refuser' || etape === 'abandonner') && !motif ? 'Choisissez le motif.' : null;
  const piecesErr = manquent.length ? `Joignez d’abord au dossier : ${manquent.map(n => decap(NATURES_PIECE_OPCO[n])).join(', ')}.` : null;

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
    <Dialog title={t.titre} width={520} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t.bouton}</SubmitButton>
    </>}>
      <Field label="Dossier">
        <Static>{nom}<div className="text-muted sub">« {STATUTS_OPCO[dossier.statut].label} »{dossier.reference ? ` · dossier ${dossier.reference}` : ''}</div></Static>
      </Field>
      {etape !== 'abandonner' && (
        <Field label={t.date} htmlFor="opco-le" requis erreur={v.erreur(dateErr) || (le ? dateErr : null)}>
          <input className="input" id="opco-le" type="date" min={avant ?? undefined} max={d.ti} value={le} onChange={e => setLe(e.target.value)} />
        </Field>
      )}
      {etape === 'deposer' && (
        <Field label="Numéro du dossier chez l’OPCO" htmlFor="opco-ref" erreur={refErr}>
          <input className="input" id="opco-ref" value={reference} onChange={e => setReference(e.target.value)} autoComplete="off" />
        </Field>
      )}
      {etape === 'accorder' && <>
        <div className="grid-2">
          <Field label="Montant accordé (€)" htmlFor="opco-montant" requis erreur={v.erreur(montantErr) || (montant.trim() ? montantErr : null)}>
            <input className="input tnum" id="opco-montant" inputMode="decimal" value={montant} onChange={e => setMontant(e.target.value)} autoFocus />
          </Field>
          <Field label="Plafond horaire (€ / h)" htmlFor="opco-plafond" erreur={plafondErr}>
            <input className="input tnum" id="opco-plafond" inputMode="decimal" value={plafond} onChange={e => setPlafond(e.target.value)} />
          </Field>
        </div>
        <Field label="Référence de l’accord" htmlFor="opco-ref" erreur={refErr}>
          <input className="input" id="opco-ref" value={reference} onChange={e => setReference(e.target.value)} autoComplete="off" />
        </Field>
      </>}
      {etape === 'facturer' && (
        <Field label="Montant facturé (€)" htmlFor="opco-montant" requis erreur={v.erreur(montantErr) || (montant.trim() ? montantErr : null)}>
          <input className="input tnum" id="opco-montant" inputMode="decimal" value={montant} onChange={e => setMontant(e.target.value)} autoFocus />
        </Field>
      )}
      {(etape === 'refuser' || etape === 'abandonner') && (
        <Field label={etape === 'refuser' ? 'Motif du refus' : 'Motif de l’abandon'} htmlFor="opco-motif" requis erreur={v.erreur(motifErr)}>
          <select className="input" id="opco-motif" value={motif} onChange={e => setMotif(e.target.value)}>
            <option value="">Choisir…</option>
            {Object.entries<string>(etape === 'refuser' ? MOTIFS_REFUS_OPCO : MOTIFS_ABANDON_OPCO).map(([k, l]) => <option key={k} value={k as MotifRefusOpco | MotifAbandonOpco}>{l}</option>)}
          </select>
        </Field>
      )}
      {solde && (
        solde.ecart > 0
          ? <Field label={`Écart restant : ${eurosOpco(solde.ecart)} accordés non reçus`} htmlFor="opco-ecart">
              <select className="input" id="opco-ecart" value={nature || solde.nature} onChange={e => setNature(e.target.value as EcartSoldeOpco)}>
                {(['partiel', 'perte'] as const).map(k => <option key={k} value={k}>{ECARTS_SOLDE_OPCO[k]}</option>)}
              </select>
            </Field>
          : <Fine>Tout l’accordé a été reçu : le dossier se solde sans écart.</Fine>
      )}
      {piecesErr && (
        <div className={`note-accent${v.tente ? ' bloquant' : ''}`} tabIndex={v.tente ? -1 : undefined} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span style={{ flex: 1 }}>{piecesErr}</span>
          <Btn small onClick={() => openDialog({ type: 'opcoPiece', id: dossier.id, nature: manquent[0] })}>Joindre une pièce</Btn>
        </div>
      )}
      <Fine>
        {etape === 'refuser' || etape === 'abandonner' ? 'Le motif reste sur le dossier, au service RH : jamais au journal ni à la lecture seule. ' : ''}
        {etape === 'facturer' ? 'Demande de remboursement : facture et certificat de réalisation (ou feuilles d’émargement) à transmettre à l’OPCO. ' : ''}
        {etape === 'solder' ? 'Le solde fige l’écart entre l’accordé et le reçu ; le dossier sort des relances. ' : ''}
        {etape === 'abandonner' ? 'Le dossier sort des relances ; la ligne du plan peut de nouveau être supprimée. ' : ''}
        L’administrateur RH peut revenir sur une étape enregistrée par erreur.
      </Fine>
    </Dialog>
  );
}
