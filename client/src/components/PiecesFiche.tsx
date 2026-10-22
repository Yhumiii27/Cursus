// Fiche collaborateur : pièces justificatives du dossier (t133). Attestations des certifications en vigueur et titres
// signés des habilitations délivrées, avec « Joindre » pour le service RH et le référent HSE / formation (une
// certification reprise de Lucca reçoit ainsi son attestation) ; pour le service RH, aussi les justificatifs d'absence et
// les documents déclarés. Ce que la personne ne peut pas ouvrir ne lui est pas transmis (server/src/pieces.ts).
import { certEnVigueur } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { fmt } from '../../../shared/format.ts';
import { depotOuvert, OBJETS_PIECE, piecesDe, tailleTexte, TYPES_PIECES } from '../../../shared/rules/pieces.ts';
import type { ObjetPiece } from '../../../shared/types.ts';
import { lienPiece } from '../api.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { SectionLabel } from './ui.tsx';

interface Ligne { objet: ObjetPiece; objetId: number; libelle: string }

export function PiecesFiche({ empId, parti }: { empId: number; parti: boolean }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const { rh, formations } = useRole();
  const e = d.emp(empId);
  if (!e) return null;
  const actif = depotOuvert(d.ds.settings.piecesStockage);
  const joindre = actif && formations && !parti;
  const titres: Ligne[] = [
    ...[...new Set(e.certs.map(c => c.f))].map(f => certEnVigueur(e.certs, f)).filter(c => !!c)
      .map(c => ({ objet: 'certification' as const, objetId: c!.id, libelle: `${d.fm(c!.f)?.nom ?? c!.f} · obtenue le ${fmt(parse(c!.obtenue))}` })),
    ...e.habs.filter(h => h.delivree).map(h => ({ objet: 'habTitre' as const, objetId: h.id, libelle: `${d.hm(h.h)?.nom ?? h.h} · délivrée le ${fmt(parse(h.delivree!))}` })),
  ];
  // Autres pièces (justificatifs d'absence, documents déclarés, déplacements) : celles que l'instantané transmet.
  const autres = (d.ds.pieces ?? []).filter(p => p.empId === empId && !p.retireeLe && p.objet !== 'certification' && p.objet !== 'habTitre');
  const avecPieces = titres.filter(l => piecesDe(d.ds.pieces, l.objet, l.objetId).length);
  if (!joindre && !avecPieces.length && !autres.length) return null;
  const lignes = joindre ? titres : avecPieces;
  const lien = (id: number, nom: string, type: string, taille: number) => (
    <a key={id} href={lienPiece(id)} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere' }}>
      {nom} <span className="text-muted">({TYPES_PIECES[type as keyof typeof TYPES_PIECES]?.label ?? type}, {tailleTexte(taille)})</span>
    </a>
  );
  return <>
    <SectionLabel>Pièces justificatives</SectionLabel>
    <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
      {lignes.map(l => {
        const pieces = piecesDe(d.ds.pieces, l.objet, l.objetId);
        return (
          <div key={`${l.objet}-${l.objetId}`} className="list-row stack">
            <div className="item-head">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14 }}>{l.libelle}</div>
                <div className="sub" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {pieces.length ? pieces.map(p => lien(p.id, p.nom, p.type, p.taille)) : <span className="text-muted">{OBJETS_PIECE[l.objet].label} : aucune pièce jointe</span>}
                </div>
              </div>
              {joindre && (
                <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 'none' }}
                  onClick={() => openDialog({ type: 'piece', objet: l.objet, objetId: l.objetId, empId, libelle: l.libelle })}>Joindre</button>
              )}
            </div>
          </div>
        );
      })}
      {rh && autres.map(p => (
        <div key={p.id} className="list-row stack">
          <div style={{ fontSize: 14 }}>{OBJETS_PIECE[p.objet].label}</div>
          <div className="sub">{lien(p.id, p.nom, p.type, p.taille)}</div>
        </div>
      ))}
    </div>
  </>;
}
