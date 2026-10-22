// Messagerie : adresses (salariés, service RH, santé au travail, agences d'intérim), forme commune des e-mails
// (salutation, lien vers Cursus, adresse de réponse) et reprise des adresses des comptes Microsoft 365.
// Les e-mails ne portent jamais de donnée de santé, de motif d'absence médical, de numéro de passeport, ni les
// textes libres saisis dans Cursus (commentaires, motifs) : ils renvoient à Cursus pour le détail.
import { parse } from '../../shared/dates.ts';
import { MESSAGERIE_VIDE, normaliserAdresse } from '../../shared/rules/messagerie.ts';
import { adresseValide } from '../../shared/rules/comptes.ts';
import type { Courriel, Messagerie, ModeNotification } from '../../shared/types.ts';
import type { Compte } from './comptes.ts';
import type { Db } from './db.ts';
import { lienCursus } from './integrations/email.ts';

/** Réglage `messagerie` (Paramètres → Messagerie), complété des valeurs par défaut. */
export async function lireMessagerie(db: Db): Promise<Messagerie> {
  const m = await db.getSetting<Partial<Messagerie>>('messagerie', {});
  return { ...MESSAGERIE_VIDE, ...m, agences: Array.isArray(m.agences) ? m.agences : [] };
}

/** Salarié destinataire : adresse de sa fiche et réglage de ses notifications ; aucun s'il a quitté l'entreprise. */
export async function adresseSalarie(db: Db, empId: number, today: string): Promise<{ nom: string; adresse: string; mode: ModeNotification } | null> {
  const e = await db.get<{ nom: string; email: string | null; notifications: ModeNotification | null; fin: string | null }>('employes', empId);
  if (!e?.email || (e.fin && e.fin < today)) return null;
  return { nom: e.nom, adresse: e.email, mode: e.notifications === 'quotidien' ? 'quotidien' : 'immediat' };
}

/** Pied commun : lien vers Cursus, et à qui répondre. */
function pied(m: Messagerie): string {
  const lien = lienCursus();
  return [
    '—',
    lien ? `Cursus : ${lien}` : 'Cursus, l’outil RH de l’entreprise.',
    m.rh
      ? 'Message envoyé automatiquement par Cursus. Pour toute question, répondez à cet e-mail : il parviendra au service RH.'
      : 'Message envoyé automatiquement par Cursus : ne répondez pas à cet e-mail. Pour toute question, adressez-vous au service RH.',
  ].join('\n');
}

/** E-mail mis en forme : salutation (« Bonjour Prénom Nom, » ou « Bonjour, »), texte, pied ; réponses vers le service RH. */
export function courriel(m: Messagerie, a: string, objet: string, texte: string, opts: { nom?: string | null; pj?: Courriel['pj'] } = {}): Courriel {
  return {
    a: [a], objet, texte: `Bonjour${opts.nom ? ` ${opts.nom}` : ''},\n\n${texte.trim()}\n\n${pied(m)}\n`, repondreA: m.rh, ...(opts.pj?.length ? { pj: opts.pj } : {}),
  };
}

// — Dates en toutes lettres : « mercredi 18 novembre 2026 » —
export const jourLong = (s: string) => parse(s).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
/** « le mercredi 18 novembre 2026 », « du lundi 7 décembre au mardi 8 décembre 2026 ». */
export function periodeLongue(du: string, au: string): string {
  if (du === au) return `le ${jourLong(du)}`;
  const memeAnnee = du.slice(0, 4) === au.slice(0, 4);
  const debut = parse(du).toLocaleDateString('fr-FR', memeAnnee ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `du ${debut} au ${jourLong(au)}`;
}

/**
 * Adresse du compte Microsoft 365 d'un salarié (identifiant de connexion) reprise sur sa fiche quand elle
 * n'en a pas : c'est son adresse professionnelle. Rien si elle est déjà attribuée à un autre salarié.
 */
export async function adresseDuCompte(db: Db, c: Pick<Compte, 'empId' | 'type' | 'identifiant'>): Promise<string | null> {
  if (!c.empId || c.type !== 'microsoft') return null;
  const e = await db.get<{ email: string | null }>('employes', c.empId);
  const a = normaliserAdresse(c.identifiant);
  if (!e || e.email || !a || !adresseValide(a)) return null;
  if ((await db.where('employes', 'email', a)).length) return null;
  await db.update('employes', c.empId, { email: a });
  return a;
}

/** Réglage : reprise des adresses des comptes Microsoft déjà faite (une seule fois, pour ne pas remplir une adresse effacée). */
const REPRISE = 'adressesComptesReprises';

/**
 * Base antérieure aux adresses e-mail : chaque salarié sans adresse qui a un compte Microsoft 365 reçoit
 * l'adresse de ce compte. Une seule fois ; ensuite, la création d'un compte Microsoft la reprend (compte.creer).
 */
export async function reprendreAdressesDesComptes(db: Db, avant = () => {}) {
  if (await db.getSetting<boolean>(REPRISE, false)) return;
  const comptes = await db.query(`SELECT c.emp_id AS "empId", c.identifiant FROM comptes c JOIN employes e ON e.id = c.emp_id
    WHERE c.type = 'microsoft' AND e.email IS NULL ORDER BY c.id`) as { empId: number; identifiant: string }[];
  if (comptes.length) avant();
  let n = 0;
  await db.tx(async () => {
    for (const c of comptes) if (await adresseDuCompte(db, { ...c, type: 'microsoft' })) n++;
    await db.setSetting(REPRISE, true);
  });
  if (n) console.log(`Migration : ${n} adresse${n > 1 ? 's' : ''} e-mail reprise${n > 1 ? 's' : ''} des comptes Microsoft 365.`);
}
