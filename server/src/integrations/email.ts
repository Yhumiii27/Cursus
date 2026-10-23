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
export async function envoyerEmail(db: Db, type: string, c: Courriel): Promise<Envoi | null> {
  const a = [...new Set(c.a.filter(Boolean))];
  if (!a.length) return null;
  const simule = !configMail();
  const contenu: Courriel = { a, objet: c.objet, texte: c.texte, ...(c.repondreA ? { repondreA: c.repondreA } : {}), ...(c.pj?.length ? { pj: c.pj } : {}) };
  const e = await mettreEnFile(db, 'email', type, contenu as unknown as Record<string, unknown>, simule);
  if (simule) {
    await db.insert('journal', {
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
const addJour = (d: ISODate, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const lendemain = (d: ISODate) => addJour(d, 1);

/** Créneau horaire d'un jour, à l'heure de Paris (« HH:MM »). */
export interface CreneauAgenda { jour: ISODate; debut: string; fin: string }

/** Fuseau Europe/Paris (RFC 5545, VTIMEZONE exigé par les agendas pour un TZID) : heure d'été du dernier dimanche de mars au dernier dimanche d'octobre. */
const FUSEAU_PARIS = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Paris',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];
const icsHeure = (jour: ISODate, hm: string) => `${icsDate(jour)}T${hm.replace(':', '')}00`;
const joursEntre = (du: ISODate, au: ISODate) => Math.round((Date.parse(`${au}T12:00:00Z`) - Date.parse(`${du}T12:00:00Z`)) / 864e5);

export interface EvenementAgenda {
  /** Identifiant stable de l'événement : une convocation renvoyée met à jour l'événement déjà dans l'agenda. */
  uid: string;
  /** Premier jour ; sans créneau, journées entières jusqu'à `fin` (le même jour par défaut). */
  date: ISODate;
  /** Dernier jour d'un événement en journées entières sur plusieurs jours (session de formation sans horaire). */
  fin?: ISODate;
  /**
   * Créneaux horaires, un par jour, à l'heure de Paris (session de formation avec horaires) : un seul événement qui se
   * répète chaque jour du premier au dernier créneau (RRULE), sans les jours sautés (EXDATE), un jour à l'horaire
   * différent remplaçant son occurrence (RECURRENCE-ID) ; un seul UID, qu'une annulation retire en entier.
   */
  creneaux?: CreneauAgenda[];
  /**
   * Plage continue à l'heure de Paris, du jour `date` à l'heure `debut` jusqu'au jour `finJour` à l'heure `fin` (astreinte,
   * t049) : un seul événement, sans répétition ; ignorée avec des créneaux.
   */
  plage?: { debut: string; finJour: ISODate; fin: string };
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

/**
 * Fichier .ics d'un événement, ou de son annulation : journées entières (une ou plusieurs, `fin`), ou créneaux horaires
 * à l'heure de Paris (`creneaux`, fuseau joint).
 */
export function calendrier(ev: EvenementAgenda, maintenant = new Date()): string {
  const horodatage = maintenant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  // Numéro de version croissant d'un envoi à l'autre : le client d'agenda retient la dernière.
  const sequence = Math.floor((maintenant.getTime() - Date.UTC(2026, 0, 1)) / 1000);
  const creneaux = [...(ev.creneaux ?? [])].sort((a, b) => a.jour.localeCompare(b.jour));
  const premier = creneaux[0];
  const commun = [
    `DTSTAMP:${horodatage}`, `SEQUENCE:${Math.max(0, sequence)}`,
    ...(ev.organisateur ? [`ORGANIZER;CN=${ev.organisateur.nom}:mailto:${ev.organisateur.adresse}`] : []),
    `SUMMARY:${ICS_TEXTE(ev.titre)}`,
    ...(ev.lieu ? [`LOCATION:${ICS_TEXTE(ev.lieu)}`] : []),
    ...(ev.description ? [`DESCRIPTION:${ICS_TEXTE(ev.description)}`] : []),
    `STATUS:${ev.annule ? 'CANCELLED' : ev.provisoire ? 'TENTATIVE' : 'CONFIRMED'}`, 'TRANSP:OPAQUE',
  ];
  let dates: string[];
  const remplacements: string[] = [];
  const plage = !premier && ev.plage ? ev.plage : null;
  if (plage) {
    dates = [`DTSTART;TZID=Europe/Paris:${icsHeure(ev.date, plage.debut)}`, `DTEND;TZID=Europe/Paris:${icsHeure(plage.finJour, plage.fin)}`];
  } else if (!premier) {
    dates = [`DTSTART;VALUE=DATE:${icsDate(ev.date)}`, `DTEND;VALUE=DATE:${icsDate(lendemain(ev.fin && ev.fin > ev.date ? ev.fin : ev.date))}`];
  } else {
    const tz = (jour: ISODate, hm: string) => `;TZID=Europe/Paris:${icsHeure(jour, hm)}`;
    dates = [`DTSTART${tz(premier.jour, premier.debut)}`, `DTEND${tz(premier.jour, premier.fin)}`];
    const dernier = creneaux[creneaux.length - 1];
    if (dernier.jour !== premier.jour) {
      // Chaque jour du premier au dernier, moins ceux où la session n'a pas lieu (week-end, jour sauté).
      const n = joursEntre(premier.jour, dernier.jour) + 1;
      const tenus = new Set(creneaux.map(c => c.jour));
      const sautes = Array.from({ length: n }, (_, i) => addJour(premier.jour, i)).filter(j => !tenus.has(j));
      dates.push(`RRULE:FREQ=DAILY;COUNT=${n}`, ...(sautes.length ? [`EXDATE;TZID=Europe/Paris:${sautes.map(j => icsHeure(j, premier.debut)).join(',')}`] : []));
      // Jour à un autre horaire : son occurrence est remplacée (même UID, RECURRENCE-ID à l'heure de la série).
      if (!ev.annule) {
        for (const c of creneaux.slice(1).filter(c => c.debut !== premier.debut || c.fin !== premier.fin)) {
          remplacements.push('BEGIN:VEVENT', `UID:${ev.uid}`, `RECURRENCE-ID${tz(c.jour, premier.debut)}`, `DTSTART${tz(c.jour, c.debut)}`, `DTEND${tz(c.jour, c.fin)}`, ...commun, 'END:VEVENT');
        }
      }
    }
  }
  const lignes = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cursus//Convocations//FR', 'CALSCALE:GREGORIAN', `METHOD:${ev.annule ? 'CANCEL' : 'PUBLISH'}`,
    ...(premier || plage ? FUSEAU_PARIS : []),
    'BEGIN:VEVENT', `UID:${ev.uid}`, ...dates, ...commun, 'END:VEVENT',
    ...remplacements,
    'END:VCALENDAR',
  ];
  return lignes.map(plier).join('\r\n') + '\r\n';
}

/** Domaine des identifiants d'événements : celui de l'adresse publique de Cursus. */
export const domaineAgenda = (env: Env = process.env) => { const l = lienCursus(env); return l ? new URL(l).hostname : 'cursus.local'; };
