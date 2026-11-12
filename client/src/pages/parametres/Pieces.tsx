// Paramètres → Pièces justificatives (t133, shared/rules/pieces.ts) : stockage des attestations, cartes CACES, titres
// d'habilitation signés, justificatifs d'absence et copies de documents. Décision de l'entreprise du 18 octobre 2026 :
// livré désactivé, l'administrateur RH l'active (dossier des données de Cursus, sauvegardé avec la base) après avis du
// DPO. Lot 16 (décision du 10 novembre 2026) : tous les documents de la suite dans Codex ; le choix « Codex » est contrôlé
// par le serveur (raccordement et catégories, server/src/pieces-codex.ts), les écrans ne changent pas.
import { STOCKAGE_LABEL, TAILLE_MAX_PIECE, tailleTexte } from '../../../../shared/rules/pieces.ts';
import type { StockagePieces } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, NoteAccent, Panel, Tag } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

export function Pieces({ s }: SectionProps) {
  const { admin } = useRole();
  const enregistrer = useEnregistrerReglages();
  const actif = s.piecesStockage === 'local' || s.piecesStockage === 'ged';
  return (
    <Panel title="Pièces justificatives" aside={<Tag cls={actif ? 'tag-neutral' : 'tag-outline'}>{actif ? 'Activées' : 'Désactivées'}</Tag>} style={{ gap: 'var(--space-4)' }}>
      <Field label="Stockage des pièces" htmlFor="param-pieces">
        <select className="input" id="param-pieces" value={s.piecesStockage} disabled={!admin}
          onChange={e => enregistrer({ piecesStockage: e.target.value as StockagePieces })}>
          <option value="desactive">{STOCKAGE_LABEL.desactive}</option>
          <option value="local">{STOCKAGE_LABEL.local}</option>
          <option value="ged">{STOCKAGE_LABEL.ged}</option>
        </select>
      </Field>
      {!actif && <NoteAccent>À activer après l’avis du DPO : les justificatifs d’absence et les copies de documents peuvent contenir des données de santé.</NoteAccent>}
      <Fine>
        Activées, les dialogues proposent de joindre un fichier : justificatif d’absence (saisie, qualification, signalement par
        l’intéressé), attestation de formation, titre d’habilitation signé, copie d’un document déclaré par le collaborateur ; la
        fiche du collaborateur liste les pièces et en joint aux certifications et habilitations déjà enregistrées. PDF, JPEG ou PNG,
        reconnus sur leur contenu, {tailleTexte(TAILLE_MAX_PIECE)} au plus.
      </Fine>
      <Fine>
        Accès : le service RH voit tout ; le référent HSE / formation, les attestations et titres d’habilitation ; le salarié, ses
        propres pièces ; le manager, les attestations et titres de son équipe, jamais un justificatif d’absence ni un document
        déclaré ; ni la paie, ni la lecture seule. Chaque envoi, consultation et retrait est tracé dans le journal, sans le nom
        du fichier.
      </Fine>
      <Fine>
        Stockage : dossier « pieces » à côté de la base (volume des données), sous un nom aléatoire, chiffré par le serveur
        quand le service informatique a défini la clé de chiffrement (obligatoire en production ; sans elle, hors production,
        les fichiers sont écrits en clair), avec l’empreinte SHA-256 de
        chaque fichier, vérifiée à chaque ouverture et par le contrôle d’intégrité. Les sauvegardes emportent les fichiers que
        désigne chaque copie, et la restauration les remet en place. Une pièce retirée garde sa description, son fichier est
        effacé ; la durée de conservation suit celle du dossier qu’elle justifie. Désactiver la fonction n’efface rien : les
        pièces déjà jointes restent consultables.
      </Fine>
      <Fine>
        Codex : chaque pièce attend dans le dossier local d’être jointe, puis elle est versée dans Codex au passage horaire
        (catégorie du dossier du personnel, matricule, fin de conservation, empreinte), et sa copie locale est effacée. Les
        pièces déjà dans le dossier local sont reprises de la même façon. Cursus la relit pour ses utilisateurs, avec les
        mêmes droits, et la fait détruire dans Codex à son retrait. Choix refusé tant que Codex n’est pas raccordé par le
        service informatique ou que ses catégories manquent dans son registre.
      </Fine>
    </Panel>
  );
}
