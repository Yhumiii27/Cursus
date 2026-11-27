// Paramètres → Pièces justificatives (t133, shared/rules/pieces.ts) : stockage des attestations, cartes CACES, titres
// d'habilitation signés, justificatifs d'absence et copies de documents. Décision de l'entreprise du 18 octobre 2026 :
// livré désactivé, l'administrateur RH l'active (dossier des données de Cursus, sauvegardé avec la base) après avis du
// DPO. Lot 16 (décision du 10 novembre 2026) : tous les documents de la suite dans Codex ; le choix « Codex » est contrôlé
// par le serveur (raccordement et catégories, server/src/integrations/codex/pieces-codex.ts), les écrans ne changent pas.
import { STOCKAGE_LABEL, TAILLE_MAX_PIECE, tailleTexte } from '../../../../shared/rules/pieces.ts';
import type { StockagePieces } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, NoteAccent, Panel, Tag } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

export function Pieces({ s }: SectionProps) {
  const { admin } = useRole();
  const enregistrer = useEnregistrerReglages();
  const actif = s.piecesStockage === 'local' || s.piecesStockage === 'ged';
  return (
    <Panel title={t('Supporting documents')} aside={<Tag cls={actif ? 'tag-neutral' : 'tag-outline'}>{actif ? t('Activated#fem-plural') : t('Deactivated#fem-plural')}</Tag>} style={{ gap: 'var(--space-4)' }}>
      <Field label={t('Storage of the documents')} htmlFor="param-pieces">
        <select className="input" id="param-pieces" value={s.piecesStockage} disabled={!admin}
          onChange={e => enregistrer({ piecesStockage: e.target.value as StockagePieces })}>
          <option value="desactive">{STOCKAGE_LABEL.desactive}</option>
          <option value="local">{STOCKAGE_LABEL.local}</option>
          <option value="ged">{STOCKAGE_LABEL.ged}</option>
        </select>
      </Field>
      {!actif && <NoteAccent>{t('To activate after the DPO’s opinion: the absence supporting documents and the copies of documents may contain health data.')}</NoteAccent>}
      <Fine>
        {t('Activated, the dialogs offer to attach a file: absence supporting document (entry, qualification, report by the person concerned), training certificate, signed authorisation title, copy of a document declared by the employee; the employee’s sheet lists the documents and attaches some to the certifications and authorisations already recorded. PDF, JPEG or PNG, recognised on their content, ')}{tailleTexte(TAILLE_MAX_PIECE)}{t(' at most.')}
      </Fine>
      <Fine>
        {t('Access: HR sees everything; the HSE / training referent, the certificates and authorisation titles; the employee, their own documents; the manager, the certificates and titles of their team, never an absence supporting document nor a declared document; neither payroll, nor the read-only role. Each upload, consultation and removal is traced in the log, without the file name.')}
      </Fine>
      <Fine>
        {t('Storage: “pieces” folder next to the database (data volume), under a random name, encrypted by the server when the IT department has defined the encryption key (mandatory in production; without it, outside production, the files are written in clear), with the SHA-256 fingerprint of each file, checked at each opening and by the integrity check. The backups carry the files that each copy designates, and the restoration puts them back in place. A removed document keeps its description, its file is erased; the retention period follows that of the file it supports. Deactivating the function erases nothing: the documents already attached stay readable.')}
      </Fine>
      <Fine>
        {t('Codex: each document waits in the local folder to be attached, then it is filed in Codex at the hourly pass (category of the personnel file, employee number, end of retention, fingerprint), and its local copy is erased. The documents already in the local folder are taken over the same way. Cursus reads it again for its users, with the same rights, and has it destroyed in Codex when it is removed. Choice refused as long as Codex is not connected by the IT department or its categories are missing from its register.')}
      </Fine>
    </Panel>
  );
}
