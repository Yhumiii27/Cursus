// Adaptateur de messagerie : e-mails envoyés par l'API Microsoft Graph (POST /v1.0/users/{expéditeur}/sendMail)
// avec un jeton applicatif (client credentials), depuis la boîte d'envoi dédiée CURSUS_MAIL_FROM. Les e-mails
// passent par la file d'envoi (server/src/envois.ts, cible `email`) : mis en file dans la transaction de l'action,
// puis transmis par le processus de fond — jamais d'appel réseau dans une action. Sans configuration
// (configMail de config.ts), mode simulation : rien ne part, chaque e-mail est tracé dans le journal et visible
// dans Paramètres → Envois. Mise en service par le service informatique : docs/EMAILS.md.
import type { Courriel, ISODate, PieceJointe } from '../../../shared/types.ts';
import { configMail, type ConfigMail, type Env } from '../config.ts';
import type { Db } from '../db.ts';
import { ErreurEnvoi, mettreEnFile, type Envoi, type Transport } from '../envois.ts';

export const emailMode = (env: Env = process.env) => (configMail(env) ? 'api' : 'simulation');

/** Adresse publique de Cursus (lien des e-mails), sans « / » final ; null si elle n'est pas définie. */
export function lienCursus(env: Env = process.env): string | null {
  try {
    const u = new URL((env.CURSUS_PUBLIC_URL ?? '').trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * Met un e-mail en file, dans la transaction en cours. En simulation, il est marqué « simulé » et tracé dans
 * le journal (destinataires et objet) : rien ne part. Sans destinataire, rien n'est fait (null).
 */
export function envoyerEmail(db: Db, type: string, c: Courriel): Envoi | null {
  const a = [...new Set(c.a.filter(Boolean))];
  if (!a.length) return null;
  const simule = !configMail();
  const contenu: Courriel = { a, objet: c.objet, texte: c.texte, ...(c.repondreA ? { repondreA: c.repondreA } : {}), ...(c.pj?.length ? { pj: c.pj } : {}) };
  const e = mettreEnFile(db, 'email', type, contenu as unknown as Record<string, unknown>, simule);
  if (simule) {
    db.insert('journal', {
      at: e.creation, actor: 'Cursus', role: 'integration', action: `email.${type}`,
      message: `E-mail « ${c.objet} » pour ${a.join(', ')} (simulation)`, payload: { envoi: e.id },
    });
  }
  return e;
}

/** Pièce jointe texte (relevé CSV, invitation .ics), encodée en base64. */
export const pieceJointe = (nom: string, type: string, texte: string): PieceJointe => ({ nom, type, base64: Buffer.from(texte, 'utf8').toString('base64') });

const court = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Jeton applicatif Microsoft (client credentials, portée Graph), gardé jusqu'à 5 min avant son expiration.
 * Refus du service de jetons (secret expiré, application inconnue…) : échec définitif, la configuration est à
 * corriger ; erreur réseau, 429 ou 5xx : nouvelle tentative.
 */
function jetonApplicatif(cfg: ConfigMail, delai: number) {
  let jeton: { valeur: string; expire: number } | null = null;
  return {
    oublier() { jeton = null; },
    async valeur(): Promise<string> {
      if (jeton && jeton.expire > Date.now()) return jeton.valeur;
      let status: number, texte: string;
      try {
        const r = await fetch(`${cfg.autorite}/${cfg.tenant}/oauth2/v2.0/token`, {
          method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(delai),
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: `${cfg.graph}/.default`, grant_type: 'client_credentials' }),
        });
        status = r.status;
        texte = await r.text();
      } catch (err) {
        const nom = (err as Error)?.name;
        throw new ErreurEnvoi(nom === 'TimeoutError' || nom === 'AbortError' ? `Jeton Microsoft : aucune réponse en ${delai / 1000} s` : 'Jeton Microsoft : service de connexion injoignable', false);
      }
      let j: { access_token?: unknown; expires_in?: unknown; error?: unknown; error_description?: unknown } = {};
      try { j = JSON.parse(texte); } catch { /* réponse non JSON : traitée comme un refus */ }
      if (status === 200 && typeof j.access_token === 'string') {
        const duree = Number(j.expires_in) > 0 ? Number(j.expires_in) : 3600;
        jeton = { valeur: j.access_token, expire: Date.now() + Math.max(60, duree - 300) * 1000 };
        return jeton.valeur;
      }
      // Seule la première phrase du motif (AADSTS…) est gardée : la suite cite des identifiants de trace.
      const motif = typeof j.error_description === 'string' ? j.error_description.split(/\r?\n|\. /)[0] : '';
      const detail = [typeof j.error === 'string' ? j.error : '', motif].filter(Boolean).join(' — ');
      const temporaire = status === 429 || status >= 500;
      throw new ErreurEnvoi(court(`Jeton Microsoft refusé : HTTP ${status}${detail ? ` · ${detail}` : ''}${temporaire ? '' : ' (voir docs/EMAILS.md)'}`, 300), !temporaire);
    },
  };
}

/** Corps de l'appel sendMail : texte brut, réponses vers `repondreA`, copie dans les éléments envoyés de la boîte d'envoi. */
export function messageGraph(c: Courriel) {
  const adresse = (address: string) => ({ emailAddress: { address } });
  return {
    message: {
      subject: c.objet,
      body: { contentType: 'Text', content: c.texte },
      toRecipients: c.a.map(adresse),
      ...(c.repondreA ? { replyTo: [adresse(c.repondreA)] } : {}),
      ...(c.pj?.length ? {
        attachments: c.pj.map(p => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: p.nom, contentType: p.type, contentBytes: p.base64 })),
      } : {}),
    },
    saveToSentItems: true,
  };
}

/**
 * Requête des envois d'e-mails (processus de fond de la file) ; null en simulation. Graph répond 202 sans corps :
 * l'accusé est le statut HTTP. Un 401 (jeton expiré ou révoqué) renouvelle le jeton à la tentative suivante ;
 * un 403 (autorisation Mail.Send absente, boîte hors de la stratégie d'accès) est définitif.
 */
export function transportEmail(cfg: ConfigMail | null = configMail(), delai?: number): Transport | null {
  if (!cfg) return null;
  const jeton = jetonApplicatif(cfg, delai ?? 10_000);
  return {
    url: `${cfg.graph}/v1.0/users/${encodeURIComponent(cfg.from)}/sendMail`,
    entetes: async () => ({ authorization: `Bearer ${await jeton.valeur()}` }),
    corps: e => messageGraph(e.contenu as unknown as Courriel),
    delai,
    surRefus: status => {
      if (status !== 401) return false;
      jeton.oublier();
      return true;
    },
  };
}

// — Invitations d'agenda (.ics, RFC 5545) jointes aux convocations —

const ICS_TEXTE = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Ligne repliée à 75 octets (suite précédée d'une espace), sans couper un caractère multi-octets. */
function plier(ligne: string): string {
  const out: string[] = [];
  let cur = '', n = 0;
  for (const ch of ligne) {
    const t = Buffer.byteLength(ch, 'utf8');
    if (n + t > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
    cur += ch;
    n += t;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const icsDate = (d: ISODate) => d.replace(/-/g, '');
const lendemain = (d: ISODate) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

export interface EvenementAgenda {
  /** Identifiant stable de l'événement : une convocation renvoyée met à jour l'événement déjà dans l'agenda. */
  uid: string;
  /** Journée entière (les sessions et entretiens n'ont pas encore d'horaire). */
  date: ISODate;
  titre: string;
  lieu?: string | null;
  description?: string;
  /** Annulation : retire l'événement de l'agenda qui l'avait reçu. */
  annule?: boolean;
  /** Date encore à confirmer (session « à confirmer » par l'organisme) : événement provisoire. */
  provisoire?: boolean;
  /** Organisateur (RFC 5546 : exigé pour une publication ou une annulation) ; nom sans « ; », « : » ni « , ». */
  organisateur?: { nom: string; adresse: string } | null;
}

/** Fichier .ics d'un événement d'une journée, ou de son annulation. */
export function calendrier(ev: EvenementAgenda, maintenant = new Date()): string {
  const horodatage = maintenant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  // Numéro de version croissant d'un envoi à l'autre : le client d'agenda retient la dernière.
  const sequence = Math.floor((maintenant.getTime() - Date.UTC(2026, 0, 1)) / 1000);
  const lignes = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cursus//Convocations//FR', 'CALSCALE:GREGORIAN', `METHOD:${ev.annule ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT', `UID:${ev.uid}`, `DTSTAMP:${horodatage}`, `SEQUENCE:${Math.max(0, sequence)}`,
    `DTSTART;VALUE=DATE:${icsDate(ev.date)}`, `DTEND;VALUE=DATE:${icsDate(lendemain(ev.date))}`,
    ...(ev.organisateur ? [`ORGANIZER;CN=${ev.organisateur.nom}:mailto:${ev.organisateur.adresse}`] : []),
    `SUMMARY:${ICS_TEXTE(ev.titre)}`,
    ...(ev.lieu ? [`LOCATION:${ICS_TEXTE(ev.lieu)}`] : []),
    ...(ev.description ? [`DESCRIPTION:${ICS_TEXTE(ev.description)}`] : []),
    `STATUS:${ev.annule ? 'CANCELLED' : ev.provisoire ? 'TENTATIVE' : 'CONFIRMED'}`, 'TRANSP:OPAQUE',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lignes.map(plier).join('\r\n') + '\r\n';
}

/** Domaine des identifiants d'événements : celui de l'adresse publique de Cursus. */
export const domaineAgenda = (env: Env = process.env) => { const l = lienCursus(env); return l ? new URL(l).hostname : 'cursus.local'; };
