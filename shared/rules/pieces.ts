// Pièces justificatives (t133) : ce qui est accepté et qui voit quoi, partagé par le serveur (server/src/pieces.ts) et
// l'interface (client/src/components/PieceJointe.tsx). Décisions de l'entreprise du 18 octobre 2026 : fonction livrée
// désactivée, que l'administrateur RH active (mode « local », dossier sauvegardé) après avis du DPO ; l'espace
// documentaire de l'entreprise (GED) prendra le relais par un adaptateur, sans changer l'interface.
// - Fichiers : PDF, JPEG et PNG seulement, reconnus sur leurs premiers octets (une extension ne prouve rien), 10 Mo au plus.
// - Droits : le service RH voit tout ; le référent HSE / formation, les certifications et les habilitations ; le salarié,
//   ses propres pièces ; le manager, les certifications et habilitations de son équipe, jamais un justificatif d'absence
//   (santé) ni un document déclaré (passeport, visa, vaccin) ; la paie et la lecture seule, aucune.
import type { Absence, CurrentUser, ObjetPiece, Piece, StockagePieces, TypePiece } from '../types.ts';
import { droitsRh } from '../constants.ts';

/** Taille maximale d'une pièce : 10 Mo (une attestation scannée, une photo de carte CACES). */
export const TAILLE_MAX_PIECE = 10 * 1024 * 1024;
/** Pièces envoyées et pas encore jointes (dialogue abandonné) : effacées après ce délai. */
export const DELAI_PIECE_EN_ATTENTE_MS = 24 * 3600_000;
/** Pièces en attente au plus par compte : l'envoi n'ouvre pas un stockage illimité. */
export const MAX_PIECES_EN_ATTENTE = 20;
/**
 * Pièces en vigueur au plus par objet (une absence, une certification…) : une fois jointes, les pièces ne comptent plus
 * parmi celles en attente, et rien d'autre ne borne le volume que chacun dépose sur le disque des données.
 */
export const MAX_PIECES_PAR_OBJET = 10;
/** Longueur au plus du nom de fichier gardé. */
export const NOM_PIECE_MAX = 120;

/** Types acceptés : libellé, extension proposée au téléchargement, premiers octets du contenu. */
export const TYPES_PIECES: Record<TypePiece, { label: string; extension: string; signature: readonly number[] }> = {
  'application/pdf': { label: 'PDF', extension: 'pdf', signature: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  'image/jpeg': { label: 'JPEG', extension: 'jpg', signature: [0xff, 0xd8, 0xff] },
  'image/png': { label: 'PNG', extension: 'png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
};
export const LISTE_TYPES_PIECES = Object.keys(TYPES_PIECES) as TypePiece[];
export const estTypePiece = (t: unknown): t is TypePiece => typeof t === 'string' && t in TYPES_PIECES;

/** Objets auxquels une pièce se joint, avec leur libellé et la nature du contenu. */
export const OBJETS_PIECE: Record<ObjetPiece, { label: string; sante: boolean }> = {
  absence: { label: 'Justificatif d’absence', sante: true },
  certification: { label: 'Attestation de formation', sante: false },
  habTitre: { label: 'Titre d’habilitation signé', sante: false },
  declaration: { label: 'Document déclaré', sante: true },
  voyage: { label: 'Pièce du dossier de déplacement', sante: false },
};
export const estObjetPiece = (o: unknown): o is ObjetPiece => typeof o === 'string' && o in OBJETS_PIECE;

/** Libellés du réglage `piecesStockage` (Paramètres → Pièces justificatives). */
export const STOCKAGE_LABEL: Record<StockagePieces, string> = {
  desactive: 'Désactivé',
  local: 'Dossier des données de Cursus',
  ged: 'Espace documentaire de l’entreprise (GED)',
};

/** Type reconnu sur les premiers octets du fichier, ou null (ni PDF, ni JPEG, ni PNG). */
export function typeDuContenu(octets: Uint8Array): TypePiece | null {
  for (const t of LISTE_TYPES_PIECES) {
    const sig = TYPES_PIECES[t].signature;
    if (octets.length >= sig.length && sig.every((b, i) => octets[i] === b)) return t;
  }
  return null;
}

/** Taille lisible : « 850 Ko », « 2,4 Mo ». */
export function tailleTexte(o: number): string {
  if (o < 1024 * 1024) return `${Math.max(1, Math.round(o / 1024))} Ko`;
  return `${(o / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}

/**
 * Contrôle d'un fichier avant l'envoi (interface) ou à la réception (serveur, sur le contenu) : message d'erreur, ou null.
 * `type` : type déclaré par le navigateur, ou reconnu sur le contenu par le serveur.
 */
export function erreurPiece(f: { type: string | null; taille: number }): string | null {
  if (!f.taille) return 'Fichier vide : choisissez le document scanné ou photographié.';
  if (f.taille > TAILLE_MAX_PIECE) return `Fichier trop volumineux (${tailleTexte(f.taille)}) : ${tailleTexte(TAILLE_MAX_PIECE)} au plus.`;
  if (!estTypePiece(f.type)) return 'Format refusé : PDF, JPEG ou PNG seulement.';
  return null;
}

/**
 * Nom du fichier gardé : sans chemin, sans caractère de contrôle ni guillemet (il passe dans l'en-tête du téléchargement),
 * borné, avec l'extension du type reconnu.
 */
export function nomPiece(nom: unknown, type: TypePiece): string {
  const ext = TYPES_PIECES[type].extension;
  const brut = typeof nom === 'string' ? nom.split(/[\\/]/).pop()! : '';
  // oxlint-disable-next-line no-control-regex -- caractères de contrôle retirés volontairement d'un texte reçu
  const base = brut.normalize('NFC').replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '').replace(/\s+/g, ' ').trim().replace(/\.[^.]{1,5}$/, '').slice(0, NOM_PIECE_MAX - ext.length - 1).trim();
  return `${base || 'piece'}.${ext}`;
}

/** Pièces en vigueur (non retirées) jointes à un objet. */
export const piecesDe = (pieces: readonly Piece[] | undefined, objet: ObjetPiece, objetId: number | null | undefined) =>
  objetId == null ? [] : (pieces ?? []).filter(p => p.objet === objet && p.objetId === objetId && !p.retireeLe);

/**
 * Justificatif d'absence joint (par l'intéressé, souvent après la qualification) sans que le service RH en ait encore
 * inscrit la réception : c'est lui qui la décide, après avoir ouvert la pièce (« Justificatif reçu » dans la qualification).
 */
export const justificatifAVerifier = (a: Pick<Absence, 'id' | 'statut' | 'justificatif'>, pieces: readonly Piece[] | undefined) =>
  !a.justificatif && a.statut !== 'annulee' && a.statut !== 'refusee' && piecesDe(pieces, 'absence', a.id).length > 0;

/** Le stockage reçoit-il de nouvelles pièces ? (Désactivé : non ; GED : pas avant que son adaptateur existe.) */
export const depotOuvert = (s: StockagePieces | undefined) => s === 'local';

/**
 * Peut-on consulter cette pièce ? `equipe` : le salarié fait partie de l'équipe du manager connecté. Les règles sont les
 * mêmes pour la description (instantané) et pour le contenu (téléchargement).
 */
export function voitPiece(user: CurrentUser, p: Pick<Piece, 'empId' | 'objet'>, equipe: (empId: number) => boolean): boolean {
  const titre = p.objet === 'certification' || p.objet === 'habTitre';
  if (user.role === 'rh') {
    const droits = droitsRh(user);
    return droits.includes('rh') || (droits.includes('formations') && titre);
  }
  if (p.empId === user.empId) return true;
  return user.role === 'manager' && titre && equipe(p.empId);
}
