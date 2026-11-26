// Pièces justificatives (t133) dans les dialogues : choix d'un fichier, envoyé à l'enregistrement puis joint par l'action
// du dialogue (jeton, server/src/actions/pieces.ts), et pièces déjà jointes à l'objet, que le service RH ouvre avant de
// valider. Rien ne s'affiche tant que l'administrateur RH n'a pas activé la fonction (Paramètres → Pièces justificatives).
// Les fichiers sont contrôlés ici (PDF, JPEG, PNG, 10 Mo) et de nouveau par le serveur, sur leur contenu.
import { useRef, useState } from 'react';
import { isoParis } from '../../../shared/dates.ts';
import { decap, fmtIso } from '../../../shared/format.ts';
import { depotOuvert, erreurPiece, LISTE_TYPES_PIECES, OBJETS_PIECE, piecesDe, TAILLE_MAX_PIECE, tailleTexte, TYPES_PIECES } from '../../../shared/rules/pieces.ts';
import type { ObjetPiece, Piece } from '../../../shared/types.ts';
import { api, lienPiece } from '../api.ts';
import { t } from '../i18n/langue.ts';
import { useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Field } from './Dialog.tsx';
import { Btn } from './ui.tsx';

const ACCEPTE = [...LISTE_TYPES_PIECES, '.pdf', '.jpg', '.jpeg', '.png'].join(',');

export interface PieceAJoindre {
  /** Fonction activée (stockage local) : sinon le champ ne s'affiche pas et rien n'est envoyé. */
  actif: boolean;
  fichier: File | null;
  choisir: (f: File | null) => void;
  /** Fichier refusé (format, taille), affiché dès le choix. */
  erreur: string | null;
  /**
   * Envoie le fichier choisi : jetons à passer à l'action (`pieces`), [] sans fichier, null si l'envoi a échoué (message
   * affiché). Un fichier déjà envoyé n'est pas renvoyé quand l'action est refusée puis reprise.
   */
  envoyer: () => Promise<string[] | null>;
}

/** Fichier joint à la saisie d'un dialogue. */
export function usePieceJointe(): PieceAJoindre {
  const { data, session, notify } = useStore();
  const [fichier, setFichier] = useState<File | null>(null);
  const envoye = useRef<{ fichier: File; jeton: string } | null>(null);
  const actif = depotOuvert(data?.settings.piecesStockage);
  return {
    actif, fichier, choisir: setFichier,
    erreur: fichier ? erreurPiece({ type: fichier.type, taille: fichier.size }) : null,
    envoyer: async () => {
      if (!actif || !fichier) return [];
      if (envoye.current?.fichier === fichier) return [envoye.current.jeton];
      try {
        const p = await api.envoyerPiece(fichier, session?.role);
        envoye.current = { fichier, jeton: p.jeton };
        return [p.jeton];
      } catch (e) {
        notify(`${t('Supporting document not sent')} — ${(e as Error).message}`, true);
        return null;
      }
    },
  };
}

/** Champ « fichier » d'un dialogue : PDF, JPEG ou PNG de 10 Mo au plus ; rien si la fonction est désactivée. */
export function ChoixPiece({ piece, id, label, aide, onChoix, requis, erreur }: {
  piece: PieceAJoindre; id: string; label: string; aide?: string; onChoix?: (f: File | null) => void;
  /** Fichier exigé (dialogue qui ne sert qu'à joindre) ; `erreur` : son absence, après une première tentative. */
  requis?: boolean; erreur?: string | null;
}) {
  // Clé du champ : changée pour le vider (un champ fichier ne se remet pas à zéro par sa valeur).
  const [cle, setCle] = useState(0);
  if (!piece.actif) return null;
  const choisir = (f: File | null) => { piece.choisir(f); onChoix?.(f); };
  return (
    <Field label={label} htmlFor={id} requis={requis} erreur={piece.erreur ?? erreur}>
      <input key={cle} className="input" id={id} type="file" accept={ACCEPTE} onChange={ev => choisir(ev.target.files?.[0] ?? null)} />
      <div className="text-muted sub" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <span>{piece.fichier && !piece.erreur ? `${piece.fichier.name} · ${tailleTexte(piece.fichier.size)} ·` : `${t('PDF, JPEG or PNG, ')}${tailleTexte(TAILLE_MAX_PIECE)}${t(' at most.')}`}{aide ? ` ${aide}` : ''}</span>
        {piece.fichier && <Btn small onClick={() => { choisir(null); setCle(c => c + 1); }}>{t('Remove the file')}</Btn>}
      </div>
    </Field>
  );
}

/** Une pièce jointe : lien qui l'ouvre dans un nouvel onglet, aperçu d'une image, retrait pour qui en a le droit. */
function LignePiece({ p, retirable }: { p: Piece; retirable: boolean }) {
  const { openDialog, dialog } = useStore();
  const retirer = () => openDialog({
    type: 'confirmer',
    c: {
      titre: t('Remove the supporting document'), question: t(`Remove “${p.nom}” from the file?`),
      suites: [t('The file is erased; its description (date, author) stays in the file.'), t('Backups keep their copy until they are rotated.')],
      bouton: t('Remove the document'), action: 'piece.retirer', payload: { id: p.id },
      motif: { label: t('Reason for the removal'), requis: true, aide: t('Kept with the document: read by HR, and by the employee in the export of their data.'), placeholder: t('Unreadable document, wrong employee…') },
      ensuite: dialog ? { retour: dialog } : undefined,
    },
  });
  return (
    <li className="boxed" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <a href={lienPiece(p.id)} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere' }}>{p.nom}</a>
        <span className="text-muted sub">{TYPES_PIECES[p.type]?.label ?? p.type} · {tailleTexte(p.taille)} · {t('sent on ')}{fmtIso(isoParis(new Date(p.deposeLe)))}{t(' by ')}{p.deposePar}</span>
        <span style={{ flex: 1 }} />
        <a className="btn btn-ghost btn-sm" href={lienPiece(p.id, true)}>{t('Download')}</a>
        {retirable && <Btn small onClick={retirer}>{t('Remove')}</Btn>}
      </div>
      {p.type !== 'application/pdf' && (
        <img src={lienPiece(p.id)} alt={`${t('Preview: ')}${decap(OBJETS_PIECE[p.objet].label)}`} loading="lazy"
          style={{ maxWidth: '100%', maxHeight: 220, objectFit: 'contain', alignSelf: 'flex-start', borderRadius: 'var(--radius-sm)' }} />
      )}
    </li>
  );
}

/** Pièces déjà jointes à un objet (rien s'il n'en a pas) : à ouvrir avant de valider. */
export function PiecesJointes({ objet, objetId, label }: { objet: ObjetPiece; objetId: number | null | undefined; label?: string }) {
  const { data } = useStore();
  const { rh, formations } = useRole();
  const pieces = piecesDe(data?.pieces, objet, objetId);
  if (!pieces.length) return null;
  const retirable = rh || (formations && (objet === 'certification' || objet === 'habTitre'));
  return (
    <Field label={label ?? t('Attachments')}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {pieces.map(p => <LignePiece key={p.id} p={p} retirable={retirable} />)}
      </ul>
    </Field>
  );
}

/**
 * Liens vers les pièces d'un objet, sur une ligne de liste (demande à valider) : ouverture dans un nouvel onglet, sans
 * déclencher le clic de la ligne.
 */
export function LiensPieces({ objet, objetId }: { objet: ObjetPiece; objetId: number }) {
  const { data } = useStore();
  const pieces = piecesDe(data?.pieces, objet, objetId);
  if (!pieces.length) return null;
  return (
    <div className="sub" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-1)' }}>
      <span className="text-muted">{pieces.length > 1 ? t('Attachments:') : t('Attachment:')}</span>
      {pieces.map(p => (
        <a key={p.id} href={lienPiece(p.id)} target="_blank" rel="noopener noreferrer" onClick={ev => ev.stopPropagation()} style={{ overflowWrap: 'anywhere' }}>
          {p.nom} ({TYPES_PIECES[p.type]?.label ?? p.type}, {tailleTexte(p.taille)})
        </a>
      ))}
    </div>
  );
}
