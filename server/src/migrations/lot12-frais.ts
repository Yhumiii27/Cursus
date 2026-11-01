// Migration nommée du lot 12, chantier C2 (activation des notes de frais), étape 1 : index de la fenêtre des notes de
// frais dans l'instantané (`FENETRES`, server/src/lecture-brute.ts) et des lectures ciblées en base
// (server/src/frais-base.ts, server/src/frais-historique.ts). Les tables du lot 11 sont créées d'après TABLES
// (server/src/db.ts), sans index : ceux de 0020_notes_frais.sql (dépenses d'une note, notes et dépenses d'un salarié)
// sont posés ici aussi, avec celui de la migration PostgreSQL 0023_frais_fenetre.sql (notes par statut et date de
// paiement). `pieces_objet` existe déjà (lot6-pieces).
import { index } from './exploitation.ts';

export const INDEX_FRAIS_FENETRE = index('lot12-frais-index', {
  notes_frais_statut_payee: 'CREATE INDEX IF NOT EXISTS notes_frais_statut_payee ON notes_frais (statut, payee_le)',
  notes_frais_emp: 'CREATE INDEX IF NOT EXISTS notes_frais_emp ON notes_frais (emp_id)',
  lignes_frais_note: 'CREATE INDEX IF NOT EXISTS lignes_frais_note ON lignes_frais (note_id)',
  lignes_frais_emp: 'CREATE INDEX IF NOT EXISTS lignes_frais_emp ON lignes_frais (emp_id)',
});
