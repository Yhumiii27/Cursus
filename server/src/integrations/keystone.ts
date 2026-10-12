// Adaptateur Keystone (gestion de projets / chantiers) : messages sortants et clé des appels entrants.
// Les messages (décisions sur les demandes de déplacement, heures et absences validées, verdicts
// modifiés) passent par la file d'envoi (server/src/envois.ts) : mis en file dans la transaction de
// l'action, puis transmis par le processus de fond à POST ${KEYSTONE_URL}/api/cursus/v1/evenements
// avec le jeton KEYSTONE_TOKEN. Sans KEYSTONE_URL, ils sont seulement tracés dans le journal
// (simulation). Contrat : docs/API-KEYSTONE.md, « Événements envoyés par Cursus ».
import { createHash, timingSafeEqual } from 'node:crypto';
import { ACTIVITES_INTERNES, GNG_CODE, type CodeMotif } from '../../../shared/constants.ts';
import { matricule, num } from '../../../shared/format.ts';
import type { Absence, ISODate, LigneTemps } from '../../../shared/types.ts';
import { demoActive, KEYSTONE_CLE_DEMO, type Env } from '../config.ts';
import type { Db } from '../db.ts';
import { mettreEnFile, type Envoi, type Transport } from '../envois.ts';

export type CodeGng = typeof GNG_CODE[keyof typeof GNG_CODE];
/** Motif d'un verdict, comme dans l'API v1 : code et effet, jamais de libellé. */
export interface MotifKeystone { code: CodeMotif; niveau: CodeGng }

export type KeystoneEvent =
  | { type: 'demande.decision'; demande: number; reference: string | null; matricule: string; chantier: string; decision: 'acceptee' | 'refusee'; date: ISODate }
  | { type: 'heures.validees'; matricule: string; semaine: ISODate; projets: Record<string, number> }
  | { type: 'absence.validee' | 'absence.annulee'; absence: number; matricule: string; du: ISODate; au: ISODate }
  | { type: 'verdict.modifie'; chantier: string; statut: CodeGng; ressource: { matricule: string; statut: CodeGng; motifs: MotifKeystone[]; precedent: CodeGng | null } };

/** Adresse et jeton des envois à Keystone ; null sans KEYSTONE_URL (simulation). */
export function keystoneSortant(env: Env = process.env): { url: string; token: string | null } | null {
  const base = env.KEYSTONE_URL?.trim();
  return base ? { url: `${base.replace(/\/+$/, '')}/api/cursus/v1/evenements`, token: env.KEYSTONE_TOKEN || null } : null;
}

export const KEYSTONE_MODE = keystoneSortant() ? 'api' : 'simulation';

/** Met un message en file pour Keystone ; en simulation, il est tracé dans le journal et marqué « simulé ». */
export function sendToKeystone(db: Db, event: KeystoneEvent): Envoi {
  const { type, ...donnees } = event;
  const simule = !keystoneSortant();
  const e = mettreEnFile(db, 'keystone', type, donnees, simule);
  if (simule) db.insert('journal', { at: e.creation, actor: 'Cursus', role: 'integration', action: `keystone.${type}`, message: 'Message Keystone (simulation)', payload: event });
  return e;
}

/** Requête des envois (processus de fond de la file) : enveloppe commune à tous les événements. Null en simulation. */
export function transportKeystone(env: Env = process.env): Transport | null {
  const cfg = keystoneSortant(env);
  if (!cfg) return null;
  return {
    url: cfg.url,
    // Sans jeton (refusé en production par config.ts), l'envoi part sans authentification.
    entetes: (): Record<string, string> => (cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
    corps: e => ({ id: e.cle, type: e.type, emis_le: e.creation, donnees: e.contenu }),
  };
}

/**
 * Heures d'une feuille validée transmises à Keystone, par projet : seuls ses projets comptent ;
 * les activités internes (INT-*) et les cours en CFA (ECOLE) sont écartés, comme les projets sans heure.
 */
export function heuresKeystone(lignes: LigneTemps[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lignes) {
    if (ACTIVITES_INTERNES.test(l.projet)) continue;
    const h = l.h.reduce((a, b) => a + num(b), 0);
    if (h > 0) out[l.projet] = (out[l.projet] ?? 0) + h;
  }
  for (const p in out) out[p] = Math.round(out[p] * 100) / 100;
  return out;
}

/** Absence validée ou annulée : période seulement, jamais sa nature (congé, maladie…), sans utilité pour la planification. */
export function absenceKeystone(type: 'absence.validee' | 'absence.annulee', a: Pick<Absence, 'id' | 'empId' | 'du' | 'au'>): KeystoneEvent {
  return { type, absence: a.id, matricule: matricule(a.empId), du: a.du, au: a.au };
}

/**
 * Clé attendue des appels entrants de Keystone (en-tête X-Api-Key). Sans KEYSTONE_API_KEY,
 * la clé de démonstration n'est acceptée qu'en mode démonstration ; ailleurs, l'intégration
 * n'est pas configurée (null : les routes répondent 503).
 */
export const KEYSTONE_API_KEY: string | null = process.env.KEYSTONE_API_KEY || (demoActive() ? KEYSTONE_CLE_DEMO : null);

const empreinte = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** Comparaison en temps constant (empreintes de même longueur, quelle que soit la clé reçue). */
export function keystoneKeyOk(given: string | undefined): boolean {
  if (!KEYSTONE_API_KEY || !given) return false;
  return timingSafeEqual(empreinte(given), empreinte(KEYSTONE_API_KEY));
}
