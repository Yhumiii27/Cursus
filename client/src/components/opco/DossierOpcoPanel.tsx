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

  // Chronologie : étapes datées (et signées pour la création et les corrections), versements compris.
  const chrono: { le: string; texte: string }[] = [
    { le: x.creeLe.slice(0, 10), texte: `Dossier créé par ${x.creePar}` },
    ...(x.deposeLe ? [{ le: x.deposeLe, texte: `Déposé${x.reference ? ` (dossier ${x.reference})` : ''}` }] : []),
    ...(x.accordLe ? [{ le: x.accordLe, texte: `Accordé : ${eurosOpco(x.montantAccorde ?? 0)}${x.accordReference ? ` (réf. ${x.accordReference})` : ''}` }] : []),
    ...(x.refusLe ? [{ le: x.refusLe, texte: `Refusé${x.refusMotif ? ` — ${decap(MOTIFS_REFUS_OPCO[x.refusMotif])}` : ''}` }] : []),
    ...(x.factureLe ? [{ le: x.factureLe, texte: `Justificatifs envoyés : ${eurosOpco(x.montantFacture ?? 0)} facturés` }] : []),
    ...versements.map(v => ({ le: v.le, texte: `Versement de ${eurosOpco(v.montant)} ${v.destinataire === 'organisme' ? 'à l’organisme' : 'à l’entreprise'}` })),
    ...(x.soldeLe ? [{ le: x.soldeLe, texte: `Soldé${x.soldeEcart ? ` — écart de ${eurosOpco(x.soldeEcart)} : ${decap(ECARTS_SOLDE_OPCO[x.soldeNature ?? 'aucun'])}` : ', sans écart'}` }] : []),
    ...(x.abandonLe ? [{ le: x.abandonLe, texte: `Abandonné${x.abandonMotif ? ` — ${decap(MOTIFS_ABANDON_OPCO[x.abandonMotif])}` : ''}` }] : []),
    ...(x.corrigeLe ? [{ le: x.corrigeLe, texte: `Corrigé par ${x.corrigePar ?? '—'}${x.corrigeMotif ? ` — ${x.corrigeMotif}` : ''}` }] : []),
  ].sort((a, b) => a.le.localeCompare(b.le));

  const retirerPiece = (p: Piece) => openDialog({
    type: 'confirmer',
    c: {
      titre: 'Retirer la pièce du dossier OPCO', question: `Retirer « ${p.nom} » du dossier OPCO de ${nom} ?`,
      suites: ['Le fichier est effacé ; sa description (nature, date, auteur) reste dans le dossier.', 'Les sauvegardes en gardent la copie jusqu’à leur rotation.'],
      bouton: 'Retirer la pièce', action: 'piece.retirer', payload: { id: p.id },
      motif: { label: 'Motif du retrait', requis: true, aide: 'Gardé avec la pièce, lu par le service RH seulement ; jamais recopié au journal.', placeholder: 'Mauvais document, doublon…' },
    },
  });
  // Pièce comptable encore à conserver (facture, accord) : retrait par l'administrateur RH seulement.
  const retirable = (p: Piece) => rh && (admin || !p.conserverJusquau || p.conserverJusquau < d.ti);

  return (
    <aside ref={panneau} tabIndex={-1} aria-labelledby="dossier-opco-nom" className="card elev-md side-panel" style={{ flex: '0 1 420px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 id="dossier-opco-nom">{nom}</h3>
          <div className="text-muted" style={{ fontSize: 13 }}>{OPCOS[x.opco]} · {DISPOSITIFS_OPCO[x.dispositif].label}</div>
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Tag cls={CLS_OPCO[x.statut]}>{STATUTS_OPCO[x.statut].label}</Tag>
        {x.subrogation && <Tag cls="tag-outline">Subrogation</Tag>}
        {x.reference && <span className="text-muted sub">Dossier {x.reference}</span>}
      </div>
      {e && <div className={e.retard ? 'note-accent' : 'text-muted sub'}>{e.libelle} : {fmtIso(e.echeance)} ({rel(e.jours)})</div>}
      {x.statut === 'a_deposer' && !x.organismeQualiopi && <div className="note-accent">Organisme sans certification Qualiopi déclarée : condition de la prise en charge par l’OPCO.</div>}

      <div>
        <SectionLabel>Montants</SectionLabel>
        <Ligne label="Demandé">{eurosOpco(m.demande)}</Ligne>
        {x.accordLe && <Ligne label="Accordé">{eurosOpco(m.accorde)}{x.plafondHoraire != null ? ` · plafond ${eurosOpco(x.plafondHoraire)} / h` : ''}</Ligne>}
        {m.facture != null && <Ligne label="Facturé">{eurosOpco(m.facture)}</Ligne>}
        {m.recuEntreprise > 0 && <Ligne label="Reçu par l’entreprise">{eurosOpco(m.recuEntreprise)}</Ligne>}
        {m.payeOrganisme > 0 && <Ligne label="Payé à l’organisme">{eurosOpco(m.payeOrganisme)}</Ligne>}
        {m.aRecuperer > 0 && <Ligne label="À récupérer">{eurosOpco(m.aRecuperer)}</Ligne>}
        {m.attenduOrganisme > 0 && <Ligne label="Attendu par l’organisme">{eurosOpco(m.attenduOrganisme)}</Ligne>}
        {reste && <Ligne label="Coût de l’action · reste à charge">{fmtEur(reste.cout)} · {fmtEur(reste.reste)}</Ligne>}
      </div>

      <div>
        <SectionLabel>Formation et organisme</SectionLabel>
        <Ligne label="Dates">{x.du ? `${fmtIso(x.du)}${x.au && x.au !== x.du ? ` → ${fmtIso(x.au)}` : ''}` : 'à préciser'}</Ligne>
        <Ligne label="Heures · effectif">{x.heures != null ? `${x.heures.toLocaleString('fr-FR')} h` : '—'} · {x.effectif ?? '—'}</Ligne>
        {l?.f && <Ligne label="Organisme">{d.fm(l.f)?.organisme ?? '—'}</Ligne>}
        <Ligne label="SIRET · NDA">{x.organismeSiret ?? '—'} · {x.organismeNda ?? '—'}</Ligne>
        <Ligne label="Qualiopi">{x.organismeQualiopi ? 'Certifié' : 'Non déclaré'}</Ligne>
      </div>

      <div>
        <SectionLabel>Chronologie</SectionLabel>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {chrono.map((c, i) => <li key={i} style={{ fontSize: 13 }}><span className="text-muted tnum">{fmtIso(c.le)}</span> · {c.texte}</li>)}
        </ul>
      </div>

      {(versements.length > 0 || annules.length > 0) && (
        <div>
          <SectionLabel>Versements</SectionLabel>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {versements.map(v => (
              <li key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', fontSize: 13 }}>
                <span className="tnum">{fmtIso(v.le)} · {eurosOpco(v.montant)}</span>
                <span className="text-muted sub">{v.destinataire === 'organisme' ? 'à l’organisme' : 'à l’entreprise'}{v.reference ? ` · ${v.reference}` : ''}</span>
                <span style={{ flex: 1 }} />
                {admin && x.statut !== 'solde' && (
                  <Btn small onClick={() => openDialog({ type: 'confirmer', c: annulationVersementOpco(v, nom, versements.length === 1, x.statut === 'rembourse' ? STATUTS_OPCO[x.factureLe ? 'facture' : 'accorde'].label : null) })}>Annuler</Btn>
                )}
              </li>
            ))}
            {annules.map(v => (
              <li key={v.id} className="text-muted sub" style={{ textDecoration: 'line-through' }}>{fmtIso(v.le)} · {eurosOpco(v.montant)} — annulé{v.annulePar ? ` par ${v.annulePar}` : ''}</li>
            ))}
          </ul>
        </div>
      )}

      {rh && (
        <div>
          <SectionLabel>Pièces</SectionLabel>
          {piecesActives && (
            <ul style={{ listStyle: 'none', margin: '0 0 var(--space-2)', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1) var(--space-2)' }} aria-label="Pièces attendues">
              {attendues.map(a => {
                const manque = manquantes.includes(a.nature);
                // Certificat de réalisation absent mais feuilles d'émargement jointes : elles le remplacent.
                const etat = manque ? 'à joindre' : pieces.some(p => p.nature === a.nature) ? 'jointe' : a.requise ? 'émargement joint' : 'facultative';
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
                    {p.nature ? NATURES_PIECE_OPCO[p.nature] : 'Pièce'} · {TYPES_PIECES[p.type]?.label ?? p.type} · {tailleTexte(p.taille)} · {fmtIso(isoParis(new Date(p.deposeLe)))}
                    {p.conserverJusquau ? ` · conservée jusqu’au ${fmtIso(p.conserverJusquau)}` : ''}
                  </span>
                  <span style={{ flex: 1 }} />
                  {retirable(p) && <Btn small onClick={() => retirerPiece(p)}>Retirer</Btn>}
                </li>
              ))}
            </ul>
          )}
          {!piecesActives && <Fine>Pièces justificatives désactivées : l’administrateur RH les active dans Paramètres → Pièces justificatives. Les pièces attendues ne sont alors qu’indiquées.</Fine>}
          {piecesActives && !pieces.length && <Fine>Aucune pièce jointe.</Fine>}
        </div>
      )}

      {rh && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {etapes.deposer && <Btn variant="secondary" onClick={() => openDialog({ type: 'opcoEtape', id: x.id, etape: 'deposer' })}>Dossier déposé</Btn>}
          {etapes.accorder && <Btn variant="secondary" onClick={() => openDialog({ type: 'opcoEtape', id: x.id, etape: 'accorder' })}>Accord reçu</Btn>}
          {etapes.refuser && <Btn onClick={() => openDialog({ type: 'opcoEtape', id: x.id, etape: 'refuser' })}>Refus reçu</Btn>}
          {etapes.facturer && <Btn variant="secondary" onClick={() => openDialog({ type: 'opcoEtape', id: x.id, etape: 'facturer' })}>Justificatifs envoyés</Btn>}
          {etapes.versement && <Btn variant="secondary" onClick={() => openDialog({ type: 'opcoVersement', id: x.id })}>Versement reçu</Btn>}
          {etapes.solder && <Btn onClick={() => openDialog({ type: 'opcoEtape', id: x.id, etape: 'solder' })}>Solder</Btn>}
          {piecesActives && <Btn onClick={() => openDialog({ type: 'opcoPiece', id: x.id })}>Joindre une pièce</Btn>}
          {etapes.modifier && <Btn onClick={() => openDialog({ type: 'opcoDossier', id: x.id })}>{x.statut === 'a_deposer' ? 'Modifier' : 'Corriger'}</Btn>}
          {etapes.abandonner && <Btn onClick={() => openDialog({ type: 'opcoEtape', id: x.id, etape: 'abandonner' })}>Abandonner</Btn>}
          {reouverture && precedent && <Btn onClick={() => openDialog({ type: 'confirmer', c: reouverture })}>Revenir à « {STATUTS_OPCO[precedent].label} »</Btn>}
          {admin && !versements.length && !pieces.length && <Btn onClick={() => openDialog({ type: 'confirmer', c: suppressionDossierOpco(x, nom) })}>Supprimer</Btn>}
        </div>
      )}
      {!rh && <Fine>Consultation : les motifs (refus, abandon, corrections) et les pièces restent au service RH.</Fine>}
    </aside>
  );
}
