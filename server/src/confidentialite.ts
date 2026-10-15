// Page Confidentialité (information des salariés, art. 13 du RGPD) : coordonnées du responsable du traitement et du
// DPO, réglées par l'administrateur RH (`confidentialite.regler`, server/src/actions/confidentialite.ts) dans la clé
// `confidentialite` de la table `settings`. Lisibles sans connexion : la page s'ouvre aussi depuis l'écran de connexion,
// et ces coordonnées sont destinées à être portées à la connaissance de chacun (le texte de la page est dans
// shared/confidentialite.ts). Ni donnée d'un salarié ni texte saisi par un salarié.
//   GET /api/confidentialite  → { responsable, dpo } (null : non renseigné, la page renvoie au service RH)
import express, { type Router } from 'express';
import { CONTACTS_VIDES, type ContactsConfidentialite } from '../../shared/confidentialite.ts';
import type { Db } from './db.ts';

/** Réglage `confidentialite`, complété des valeurs par défaut (aucune coordonnée). */
export function lireConfidentialite(db: Db): ContactsConfidentialite {
  const c = db.getSetting<Partial<ContactsConfidentialite>>('confidentialite', {});
  const texte = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  return { ...CONTACTS_VIDES, responsable: texte(c.responsable), dpo: texte(c.dpo) };
}

export function routesConfidentialite(db: Db): Router {
  const r = express.Router();
  r.get('/api/confidentialite', (_req, res) => { res.json(lireConfidentialite(db)); });
  return r;
}
