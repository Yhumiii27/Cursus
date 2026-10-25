// Échéance du secret client de l'application Cursus dans Entra ID (t184) : la connexion Microsoft 365 et, sauf
// application distincte, l'envoi des e-mails s'arrêtent le jour où il expire (AADSTS7000222). Entra ne prévient pas ;
// la date relevée à sa création se pose dans CURSUS_OIDC_SECRET_EXPIRE (facultative, server/src/config.ts). À partir de
// 30 jours avant l'expiration, et jusqu'à ce qu'un nouveau secret et sa date soient posés :
// - le point de santé /api/health passe en « degrade » (server/src/supervision.ts), échéance dans le détail réservé à la
//   supervision ;
// - le récapitulatif des échéances (server/src/relances.ts) ajoute une ligne « Exploitation » à l'e-mail de la boîte du
//   service RH, une fois par palier (30 jours, 7 jours, expiré), comme les autres relances. Si l'envoi des e-mails passe
//   par ce même secret, la ligne « expiré » échoue avec lui (Graph refuse le jeton) : seuls /api/health et Paramètres →
//   Envois le signalent alors.
// Ni le secret ni son identifiant ne sont jamais lus ici : la date seule. Guide : docs/CONNEXION-MICROSOFT.md, section 3.
import { days, parse } from '../../shared/dates.ts';
import { fmtIso } from '../../shared/format.ts';
import { palierDe } from '../../shared/rules/relances.ts';
import { type Env, configMail, expirationSecretEnvoi, expirationSecretOidc } from './config.ts';

/** Délai de l'alerte avant l'expiration du secret, en jours. */
export const ALERTE_SECRET_JOURS = 30;
/** Paliers de la ligne du récapitulatif (puis « echu » une fois la date passée). */
const PALIERS_SECRET = [ALERTE_SECRET_JOURS, 7] as const;

export interface EcheanceSecret {
  /** Date d'expiration posée dans CURSUS_OIDC_SECRET_EXPIRE. */
  expireLe: string;
  /** Jours restants au jour `today` (négatif : expiré). */
  jours: number;
  /** Dans les 30 jours, ou déjà expiré. */
  alerte: boolean;
}

/** Échéance d'une date d'expiration au jour `today`. */
function echeance(today: string, expireLe: string): EcheanceSecret {
  const jours = days(parse(today), parse(expireLe));
  return { expireLe, jours, alerte: jours <= ALERTE_SECRET_JOURS };
}

/** Échéance du secret au jour `today` ; null sans date d'expiration lisible (rien à surveiller). */
export function echeanceSecret(today: string, env: Env = process.env): EcheanceSecret | null {
  const expireLe = expirationSecretOidc(env);
  return expireLe ? echeance(today, expireLe) : null;
}

/**
 * Échéance du secret propre à l'envoi des e-mails (CURSUS_MAIL_SECRET_EXPIRE, lot 8) au jour `today` ; null sans date,
 * ou quand l'envoi passe par le secret de la connexion (déjà suivi par `echeanceSecret`).
 */
export function echeanceSecretEnvoi(today: string, env: Env = process.env): EcheanceSecret | null {
  const expireLe = expirationSecretEnvoi(env);
  return expireLe && (env.CURSUS_MAIL_CLIENT_SECRET ?? '').trim() ? echeance(today, expireLe) : null;
}

/**
 * L'envoi des e-mails dépend-il de ce secret ? Oui s'il est configuré (CURSUS_MAIL_FROM, sinon simulation) et passe par
 * l'application de la connexion : CURSUS_MAIL_CLIENT_SECRET absente ou identique à CURSUS_OIDC_CLIENT_SECRET.
 */
export function envoiParSecretOidc(env: Env = process.env): boolean {
  const mail = configMail(env);
  return !!mail && mail.clientSecret === (env.CURSUS_OIDC_CLIENT_SECRET ?? '').trim();
}

/** Ligne du récapitulatif des échéances : clé (une par date d'expiration), palier franchi et texte ; null hors alerte. */
export function relanceSecret(today: string, env: Env = process.env): { cle: string; palier: string; texte: string } | null {
  const e = echeanceSecret(today, env);
  const palier = e?.alerte ? palierDe(e.jours, PALIERS_SECRET) : null;
  if (!e || !palier) return null;
  const quand = e.jours < 0 ? `a expiré le ${fmtIso(e.expireLe)}` : `expire le ${fmtIso(e.expireLe)}`;
  const parEnvoi = envoiParSecretOidc(env);
  // Expiré et servant aussi à l'envoi, l'e-mail ne part que si un nouveau secret est déjà en place sans sa date : le dire.
  const suite = e.jours < 0 && parEnvoi
    ? 'Si ce message vous parvient, un nouveau secret est en place mais sa date n’a pas été reportée : le service informatique '
      + 'pose la nouvelle date dans Coolify (CURSUS_OIDC_SECRET_EXPIRE) et redéploie : docs/CONNEXION-MICROSOFT.md, section 3.'
    : 'Le service informatique en crée un nouveau, le saisit dans Coolify avec sa date d’expiration (CURSUS_OIDC_CLIENT_SECRET, '
      + 'CURSUS_OIDC_SECRET_EXPIRE) et redéploie : docs/CONNEXION-MICROSOFT.md, section 3.';
  return {
    cle: `exploitation:secret-oidc:${e.expireLe}`, palier,
    texte: `• Secret client de l’application Cursus dans Entra ID (${parEnvoi ? 'connexion Microsoft 365, envoi des e-mails' : 'connexion Microsoft 365'}) : il ${quand}. ${suite}`,
  };
}

/**
 * Ligne du récapitulatif pour le secret propre à l'envoi des e-mails (lot 8) : mêmes paliers que celui de la connexion.
 * Une fois ce secret expiré, l'e-mail lui-même ne part plus : seuls /api/health et Paramètres → Envois le signalent.
 */
export function relanceSecretEnvoi(today: string, env: Env = process.env): { cle: string; palier: string; texte: string } | null {
  const e = echeanceSecretEnvoi(today, env);
  const palier = e?.alerte ? palierDe(e.jours, PALIERS_SECRET) : null;
  if (!e || !palier) return null;
  const quand = e.jours < 0 ? `a expiré le ${fmtIso(e.expireLe)}` : `expire le ${fmtIso(e.expireLe)}`;
  return {
    cle: `exploitation:secret-envoi:${e.expireLe}`, palier,
    texte: `• Secret client de l’application d’envoi des e-mails dans Entra ID : il ${quand}. Le service informatique en crée un nouveau, `
      + 'le saisit dans Coolify avec sa date d’expiration (CURSUS_MAIL_CLIENT_SECRET, CURSUS_MAIL_SECRET_EXPIRE) et redéploie : docs/EMAILS.md.',
  };
}
