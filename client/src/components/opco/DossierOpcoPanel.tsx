// lot 11 — dossiers OPCO : panneau de détail du dossier ouvert dans l'onglet « Dossiers OPCO » de Plan & budget :
// état et prochaine échéance, montants calculés (shared/rules/opco.ts, jamais stockés), formation et organisme, chronologie
// datée et signée, versements, pièces attendues et jointes, et les étapes possibles (service RH ; réouverture, annulation
// d'un versement et suppression : administrateur RH). La lecture seule voit le dossier sans motif ni pièce ni bouton.
import type { RefObject } from 'react';
import { decap, fmtEur, fmtIso, rel } from '../../../../shared/format.ts';
import { isoParis } from '../../../../shared/dates.ts';
import {
  DISPOSITIFS_OPCO, ECARTS_SOLDE_OPCO, echeanceOpco, etapesProposees, eurosOpco, MOTIFS_ABANDON_OPCO, MOTIFS_REFUS_OPCO, montantsOpco, NATURES_PIECE_OPCO, OPCOS,
  piecesAttendues, piecesManquantes, resteACharge, statutPrecedent, STATUTS_OPCO, versementsDe,
} from '../../../../shared/rules/opco.ts';
import { depotOuvert, piecesDe, tailleTexte, TYPES_PIECES } from '../../../../shared/rules/pieces.ts';
import type { DossierOpco, Piece } from '../../../../shared/types.ts';
import { lienPiece } from '../../api.ts';
import { useDomain, useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { annulationVersementOpco, reouvertureOpco, suppressionDossierOpco } from '../../state/confirmations-opco.ts';
import { Btn, CloseButton, Fine, SectionLabel, Tag } from '../ui.tsx';
import { CLS_OPCO, nomDossierOpco } from './commun.ts';
// lot 12 — C4 (organismes de formation et e-learning) : avertissements Qualiopi et NDA de la fiche de l'organisme.
import { avertissementsOrganisme, organismeDuPlan, organismeFinal } from '../../../../shared/rules/organismes.ts';
import { t } from '../../i18n/langue.ts';

/** Ligne libellé / valeur du panneau. */
function Ligne({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', fontSize: 13, padding: '2px 0' }}>
      <span className="text-muted">{label}</span>
      <span className="tnum" style={{ textAlign: 'right' }}>{children}</span>
    </div>
  );
}

export function DossierOpcoPanel({ panneau, dossier: x, onClose }: { panneau: RefObject<HTMLElement | null>; dossier: DossierOpco; onClose: () => void }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const { rh, admin } = useRole();
  const versements = versementsDe(d.ds.versementsOpco, x.id);
  const annules = (d.ds.versementsOpco ?? []).filter(v => v.dossierId === x.id && v.annuleLe);
  const m = montantsOpco(x, d.ds.versementsOpco);
  const e = echeanceOpco(x, d.ds.versementsOpco, d.ds.settings, d.ti);
  const l = d.ds.plan.find(p => p.id === x.planActionId) ?? null;
  const reste = l ? resteACharge(l, (d.ds.dossiersOpco ?? []).filter(y => y.planActionId === l.id), d.ds.versementsOpco) : null;
  const nom = nomDossierOpco(d, x);
  const etapes = etapesProposees(x, versements.length);
  const piecesActives = depotOuvert(d.ds.settings.piecesStockage);
  const pieces = piecesDe(d.ds.pieces, 'dossierOpco', x.id);
  const attendues = piecesAttendues(x, versements.length);
  const manquantes = piecesManquantes(attendues, pieces.map(p => p.nature));
  const reouverture = admin ? reouvertureOpco(x, nom, versements.length) : null;
  const retour = statutPrecedent(x, versements.length);
  const precedent = 'vers' in retour ? retour.vers : null;
  // lot 12 — C4 : fiche du dossier (sinon celle de la ligne du plan) ; à déposer ou déposé, avertissements à la date de début
  // de la formation (l'OPCO ne finance pas un organisme non certifié) — jamais un blocage.
  const fiche = organismeFinal(d.ds.organismes, x.organismeId) ?? (l ? organismeDuPlan(d.ds, l) : null);
  const avertissements = fiche && (x.statut === 'a_deposer' || x.statut === 'depose') ? avertissementsOrganisme(fiche, x.du ?? d.ti) : [];

  // Chronologie : étapes datées (et signées pour la création et les corrections), versements compris.
  const chrono: { le: string; texte: string }[] = [
    { le: x.creeLe.slice(0, 10), texte: `${t('File created by ')}${x.creePar}` },
    ...(x.deposeLe ? [{ le: x.deposeLe, texte: `${t('Filed#opco')}${x.reference ? `${t(' (file ')}${x.reference})` : ''}` }] : []),
    ...(x.accordLe ? [{ le: x.accordLe, texte: `${t('Granted: ')}${eurosOpco(x.montantAccorde ?? 0)}${x.accordReference ? `${t(' (ref. ')}${x.accordReference})` : ''}` }] : []),
    ...(x.refusLe ? [{ le: x.refusLe, texte: `${t('Refused#masc')}${x.refusMotif ? ` — ${decap(MOTIFS_REFUS_OPCO[x.refusMotif])}` : ''}` }] : []),
    ...(x.factureLe ? [{ le: x.factureLe, texte: `${t('Supporting documents sent: ')}${eurosOpco(x.montantFacture ?? 0)}${t(' invoiced#plural')}` }] : []),
    ...versements.map(v => ({ le: v.le, texte: `${t('Payment of ')}${eurosOpco(v.montant)} ${t(v.destinataire === 'organisme' ? 'to the provider' : 'to the company')}` })),
    ...(x.soldeLe ? [{ le: x.soldeLe, texte: `${t('Settled#opco')}${x.soldeEcart ? `${t(' — difference of ')}${eurosOpco(x.soldeEcart)}${t(': ')}${decap(ECARTS_SOLDE_OPCO[x.soldeNature ?? 'aucun'])}` : t(', without difference')}` }] : []),
    ...(x.abandonLe ? [{ le: x.abandonLe, texte: `${t('Abandoned#masc')}${x.abandonMotif ? ` — ${decap(MOTIFS_ABANDON_OPCO[x.abandonMotif])}` : ''}` }] : []),
    ...(x.corrigeLe ? [{ le: x.corrigeLe, texte: `${t('Corrected by ')}${x.corrigePar ?? '—'}${x.corrigeMotif ? ` — ${x.corrigeMotif}` : ''}` }] : []),
  ].sort((a, b) => a.le.localeCompare(b.le));

  const retirerPiece = (p: Piece) => openDialog({
    type: 'confirmer',
    c: {
      titre: t('Remove the document from the OPCO file'), question: `${t('Remove “')}${p.nom}${t('” from the OPCO file of ')}${nom}${t('?#question')}`,
      suites: [t('The file is erased; its description (nature, date, author) stays in the file.'), t('Backups keep their copy until they are rotated.')],
      bouton: t('Remove the document'), action: 'piece.retirer', payload: { id: p.id },
      motif: { label: t('Reason for the removal'), requis: true, aide: t('Kept with the document, read by HR only; never copied to the log.'), placeholder: t('Wrong document, duplicate…') },
    },
  });
  // Pièce comptable encore à conserver (facture, accord) : retrait par l'administrateur RH seulement.
  const retirable = (p: Piece) => rh && (admin || !p.conserverJusquau || p.conserverJusquau < d.ti);

  return (
    <aside ref={panneau} tabIndex={-1} aria-labelledby="dossier-opco-nom" className="card elev-md panneau-colonne" style={{ flex: '0 1 420px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 id="dossier-opco-nom">{nom}</h3>
          <div className="text-muted" style={{ fontSize: 13 }}>{OPCOS[x.opco]} · {DISPOSITIFS_OPCO[x.dispositif].label}</div>
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Tag cls={CLS_OPCO[x.statut]}>{STATUTS_OPCO[x.statut].label}</Tag>
        {x.subrogation && <Tag cls="tag-outline">{t('Subrogation')}</Tag>}
        {x.reference && <span className="text-muted sub">{t('File ')}{x.reference}</span>}
      </div>
      {e && <div className={e.retard ? 'note-accent' : 'text-muted sub'}>{e.libelle}{t(': ')}{fmtIso(e.echeance)} ({rel(e.jours)})</div>}
      {x.statut === 'a_deposer' && !x.organismeQualiopi && !avertissements.length && <div className="note-accent">{t('Provider without a declared Qualiopi certification: condition of the funding by the OPCO.')}</div>}
      {/* lot 12 — C4 */}
      {avertissements.map(a => <div key={a} className="note-accent">{a}</div>)}

      <div>
        <SectionLabel>{t('Amounts')}</SectionLabel>
        <Ligne label={t('Requested#masc')}>{eurosOpco(m.demande)}</Ligne>
        {x.accordLe && <Ligne label={t('Granted')}>{eurosOpco(m.accorde)}{x.plafondHoraire != null ? ` · ${t('cap ')}${eurosOpco(x.plafondHoraire)} / h` : ''}</Ligne>}
        {m.facture != null && <Ligne label={t('Invoiced')}>{eurosOpco(m.facture)}</Ligne>}
        {m.recuEntreprise > 0 && <Ligne label={t('Received by the company')}>{eurosOpco(m.recuEntreprise)}</Ligne>}
        {m.payeOrganisme > 0 && <Ligne label={t('Paid to the provider')}>{eurosOpco(m.payeOrganisme)}</Ligne>}
        {m.aRecuperer > 0 && <Ligne label={t('To recover')}>{eurosOpco(m.aRecuperer)}</Ligne>}
        {m.attenduOrganisme > 0 && <Ligne label={t('Expected by the provider')}>{eurosOpco(m.attenduOrganisme)}</Ligne>}
        {reste && <Ligne label={t('Cost of the action · remaining cost')}>{fmtEur(reste.cout)} · {fmtEur(reste.reste)}</Ligne>}
      </div>

      <div>
        <SectionLabel>{t('Training and provider')}</SectionLabel>
        <Ligne label={t('Dates')}>{x.du ? `${fmtIso(x.du)}${x.au && x.au !== x.du ? ` → ${fmtIso(x.au)}` : ''}` : t('to specify')}</Ligne>
        <Ligne label={t('Hours · headcount')}>{x.heures != null ? `${x.heures.toLocaleString('fr-FR')} h` : '—'} · {x.effectif ?? '—'}</Ligne>
        {(fiche || l?.f) && <Ligne label={t('Provider')}>{fiche?.nomUsuel ?? (l?.f ? d.fm(l.f)?.organisme : null) ?? '—'}</Ligne>}
        <Ligne label="SIRET · NDA">{x.organismeSiret ?? '—'} · {x.organismeNda ?? '—'}</Ligne>
        <Ligne label="Qualiopi">{t(x.organismeQualiopi ? 'Certified' : 'Not declared')}</Ligne>
      </div>

      <div>
        <SectionLabel>{t('Chronology')}</SectionLabel>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {chrono.map((c, i) => <li key={i} style={{ fontSize: 13 }}><span className="text-muted tnum">{fmtIso(c.le)}</span> · {c.texte}</li>)}
        </ul>
      </div>

      {(versements.length > 0 || annules.length > 0) && (
        <div>
          <SectionLabel>{t('Payments')}</SectionLabel>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {versements.map(v => (
              <li key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', fontSize: 13 }}>
                <span className="tnum">{fmtIso(v.le)} · {eurosOpco(v.montant)}</span>
                <span className="text-muted sub">{t(v.destinataire === 'organisme' ? 'to the provider' : 'to the company')}{v.reference ? ` · ${v.reference}` : ''}</span>
                <span style={{ flex: 1 }} />
                {admin && x.statut !== 'solde' && (
                  <Btn small onClick={() => openDialog({ type: 'confirmer', c: annulationVersementOpco(v, nom, versements.length === 1, x.statut === 'rembourse' ? STATUTS_OPCO[x.factureLe ? 'facture' : 'accorde'].label : null) })}>{t('Cancel')}</Btn>
                )}
              </li>
            ))}
            {annules.map(v => (
              <li key={v.id} className="text-muted sub" style={{ textDecoration: 'line-through' }}>{fmtIso(v.le)} · {eurosOpco(v.montant)}{t(' — cancelled#masc')}{v.annulePar ? `${t(' by ')}${v.annulePar}` : ''}</li>
            ))}
          </ul>
        </div>
      )}

      {rh && (
        <div>
          <SectionLabel>{t('Documents')}</SectionLabel>
          {piecesActives && (
            <ul style={{ listStyle: 'none', margin: '0 0 var(--space-2)', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1) var(--space-2)' }} aria-label={t('Expected documents')}>
              {attendues.map(a => {
                const manque = manquantes.includes(a.nature);
                // Certificat de réalisation absent mais feuilles d'émargement jointes : elles le remplacent.
                const etat = t(manque ? 'to attach' : pieces.some(p => p.nature === a.nature) ? 'attached#fem' : a.requise ? 'attendance sheet attached' : 'optional#fem');
                return (
                  <li key={a.nature}>
                    <Tag cls={manque ? 'tag-accent' : 'tag-neutral'}>{NATURES_PIECE_OPCO[a.nature]} · {etat}</Tag>
                  </li>
                );
              })}
            </ul>
          )}
          {pieces.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {pieces.map(p => (
                <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', fontSize: 13 }}>
                  <a href={lienPiece(p.id)} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere' }}>{p.nom}</a>
                  <span className="text-muted sub">
                    {p.nature ? NATURES_PIECE_OPCO[p.nature] : t('Document')} · {TYPES_PIECES[p.type]?.label ?? p.type} · {tailleTexte(p.taille)} · {fmtIso(isoParis(new Date(p.deposeLe)))}
                    {p.conserverJusquau ? ` · ${t('kept until ')}${fmtIso(p.conserverJusquau)}` : ''}
                  </span>
                  <span style={{ flex: 1 }} />
                  {retirable(p) && <Btn small onClick={() => retirerPiece(p)}>{t('Remove')}</Btn>}
                </li>
              ))}
            </ul>
          )}
          {!piecesActives && <Fine>{t('Supporting documents disabled: the HR administrator enables them in Settings → Supporting documents. The expected documents are then only shown.')}</Fine>}
          {piecesActives && !pieces.length && <Fine>{t('No document attached.')}</Fine>}
        </div>
      )}

      {rh && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {etapes.deposer && <Btn variant="secondary" onClick={() => openDialog({ type: 'opcoEtape', id: x.id, etape: 'deposer' })}>{t('File filed')}</Btn>}
          {etapes.accorder && <Btn variant="secondary" onClick={() => openDialog({ type: 'opcoEtape', id: x.id, etape: 'accorder' })}>{t('Approval received')}</Btn>}
          {etapes.refuser && <Btn onClick={() => openDialog({ type: 'opcoEtape', id: x.id, etape: 'refuser' })}>{t('Refusal received')}</Btn>}
          {etapes.facturer && <Btn variant="secondary" onClick={() => openDialog({ type: 'opcoEtape', id: x.id, etape: 'facturer' })}>{t('Supporting documents sent')}</Btn>}
          {etapes.versement && <Btn variant="secondary" onClick={() => openDialog({ type: 'opcoVersement', id: x.id })}>{t('Payment received')}</Btn>}
          {etapes.solder && <Btn onClick={() => openDialog({ type: 'opcoEtape', id: x.id, etape: 'solder' })}>{t('Settle')}</Btn>}
          {piecesActives && <Btn onClick={() => openDialog({ type: 'opcoPiece', id: x.id })}>{t('Attach a document')}</Btn>}
          {etapes.modifier && <Btn onClick={() => openDialog({ type: 'opcoDossier', id: x.id })}>{x.statut === 'a_deposer' ? t('Edit') : t('Correct')}</Btn>}
          {etapes.abandonner && <Btn onClick={() => openDialog({ type: 'opcoEtape', id: x.id, etape: 'abandonner' })}>{t('Abandon')}</Btn>}
          {reouverture && precedent && <Btn onClick={() => openDialog({ type: 'confirmer', c: reouverture })}>{t('Back to “')}{STATUTS_OPCO[precedent].label}{t('”#close')}</Btn>}
          {admin && !versements.length && !pieces.length && <Btn onClick={() => openDialog({ type: 'confirmer', c: suppressionDossierOpco(x, nom) })}>{t('Delete')}</Btn>}
        </div>
      )}
      {!rh && <Fine>{t('Read only: the reasons (refusal, abandonment, corrections) and the documents stay with HR.')}</Fine>}
    </aside>
  );
}
