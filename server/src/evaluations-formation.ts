// Demandes et relances des évaluations de formation par e-mail (lot 7, chantier C, t121 ; règles :
// shared/rules/evaluation-formation.ts, `demandesEvaluation`). Tâche de fond appelée par `tachesEmails`
// (server/src/notifications.ts), une fois par jour à partir de 7 h, évaluations activées :
// - au salarié : son avis à chaud, demandé une fois après la formation (sans relance), et l'évaluation à froid, demandée
//   le jour de l'échéance (90 jours après par défaut) puis relancée 15 et 30 jours après ;
// - au manager : l'évaluation à froid des formations de son équipe directe, aux mêmes paliers (réponse de l'entreprise du
//   23 octobre 2026 : salarié et manager, chacun avec échéance et relances).
// Un e-mail par destinataire et par passage, qui liste ses évaluations attendues. Chaque palier n'est envoyé qu'une fois
// (table `relances`, clé « evaluation:<formation>:<type>:<répondant> », purgée avec les autres relances) ; une évaluation
// donnée entre-temps n'est plus relancée. Sans adresse e-mail, le palier est noté sans envoi : l'encart « À faire » de
// Cursus reste. Jamais de note ni de commentaire dans l'e-mail (docs/EMAILS.md).
import { HEURE_RECAPITULATIF } from '../../shared/constants.ts';
import { Domain } from '../../shared/domain.ts';
import { fmtIso, plural } from '../../shared/format.ts';
import { type DemandeEvaluation, demandesEvaluation } from '../../shared/rules/evaluation-formation.ts';
import type { CurrentUser } from '../../shared/types.ts';
import { loadSettings, todayIso } from './dataset.ts';
import type { Db } from './db.ts';
import { envoyerEmail } from './integrations/email.ts';
import { adresseSalarie, courriel, lireMessagerie } from './messagerie.ts';
import { type Lecture, lectureDirecte } from './lecture-partagee.ts';

/** Lecture du périmètre complet, comme le service RH. */
const SUIVI: CurrentUser = { role: 'rh', empId: null, nom: 'Cursus', intitule: 'Évaluation des formations' };

/** Réglage : jour du dernier passage (un seul par jour, même après un redémarrage). */
const DERNIER_PASSAGE = 'evaluationsDemandeesLe';

/**
 * Ligne d'une évaluation attendue dans l'e-mail. `relance` : un palier précédent de la même clé est déjà parti ; sinon,
 * même à un palier de relance (fonction réactivée, délai réduit, formations reprises), c'est une première demande.
 */
function ligne(d: Domain, x: DemandeEvaluation, manager: boolean, relance: boolean): string {
  const qui = manager ? `${d.personName(x.cible.empId)} — ` : '';
  const quoi = x.type === 'chaud'
    ? `votre avis sur la formation (note de 1 à 5)`
    : manager ? 'la formation a-t-elle été efficace ?' : 'la formation vous a-t-elle été utile dans votre travail ?';
  const mention = relance && x.palier !== 'demande' ? ` (relance : demandée le ${fmtIso(x.depuis)})` : '';
  return `• ${qui}${x.cible.intitule}, terminée le ${fmtIso(x.cible.fin)} : ${quoi}${mention}`;
}

/** Texte de l'e-mail d'un destinataire : ses évaluations attendues, puis où répondre. */
function texte(d: Domain, liste: DemandeEvaluation[], manager: boolean, envoyees: Set<string>): string {
  return [
    manager
      ? 'Quelques mois après leur formation, Cursus vous demande si elle a été efficace pour ces membres de votre équipe :'
      : 'Cursus vous demande votre avis sur les formations que vous avez suivies :',
    '',
    ...liste.map(x => ligne(d, x, manager, envoyees.has(x.cle))),
    '',
    manager
      ? 'Répondez dans Cursus, écran Formations (espace manager), encart « Évaluations à froid à faire » : efficace, partiellement ou pas efficace, avec un commentaire si besoin. Votre réponse sert à améliorer le plan de formation ; seul le service RH lit les commentaires.'
      : 'Répondez dans Cursus, Mon espace, encart « À faire ». Votre avis sert à améliorer les formations ; seul le service RH lit les commentaires, votre manager ne voit pas votre avis.',
  ].join('\n');
}

/**
 * Un passage : demandes et relances dues pas encore envoyées, un e-mail par destinataire, paliers notés. Renvoie le nombre
 * d'e-mails et d'évaluations demandées ou relancées.
 */
export async function demanderEvaluations(db: Db, lire: Lecture = lectureDirecte(db)): Promise<{ emails: number; demandes: number }> {
  // Réglages d'abord (lot 8, chantier E, étape 2) : évaluations désactivées, aucune lecture complète de la base.
  if (!(await loadSettings(db)).evaluationsActives) return { emails: 0, demandes: 0 };
  const full = await lire(SUIVI);
  const d = new Domain(full), today = full.today;
  const notes = await db.query('SELECT cle, palier FROM relances WHERE cle LIKE ?', ['evaluation:%']) as { cle: string; palier: string }[];
  const deja = new Set(notes.map(r => `${r.cle}|${r.palier}`)), envoyees = new Set(notes.map(r => r.cle));
  const nouvelles = demandesEvaluation(d).filter(x => !deja.has(`${x.cle}|${x.palier}`));
  if (!nouvelles.length) return { emails: 0, demandes: 0 };
  const m = await lireMessagerie(db);
  let emails = 0;
  // Un e-mail par destinataire : ses propres évaluations, puis, pour un manager, celles de son équipe.
  for (const dest of new Set(nouvelles.map(x => x.destinataire))) {
    const a = await adresseSalarie(db, dest, today);
    if (!a) continue;
    const siennes = nouvelles.filter(x => x.destinataire === dest && x.repondant === 'salarie');
    const equipe = nouvelles.filter(x => x.destinataire === dest && x.repondant === 'manager');
    if (siennes.length) {
      const e = await envoyerEmail(db, 'evaluation.demande', courriel(m, a.adresse, `Cursus — votre avis sur ${siennes.length > 1 ? 'des formations' : 'une formation'}`, texte(d, siennes, false, envoyees), { nom: a.nom }));
      if (e) emails++;
    }
    if (equipe.length) {
      const e = await envoyerEmail(db, 'evaluation.manager', courriel(m, a.adresse, `Cursus — efficacité des formations de votre équipe : ${plural(equipe.length, 'évaluation à faire', 'évaluations à faire')}`, texte(d, equipe, true, envoyees), { nom: a.nom }));
      if (e) emails++;
    }
  }
  for (const x of nouvelles) await db.insert('relances', { cle: x.cle, palier: x.palier, le: today });
  return { emails, demandes: nouvelles.length };
}

/**
 * Tâche de fond (appelée par `tachesEmails`, dans sa transaction) : à partir de 7 h, une fois par jour. Null : rien à
 * faire à ce passage (heure, déjà passé aujourd'hui).
 */
export async function evaluationsDuJour(db: Db, heure: number, lire: Lecture = lectureDirecte(db)): Promise<{ emails: number; demandes: number } | null> {
  const jour = todayIso();
  if (heure < HEURE_RECAPITULATIF || await db.getSetting<string | null>(DERNIER_PASSAGE, null) === jour) return null;
  await db.setSetting(DERNIER_PASSAGE, jour);
  return await demanderEvaluations(db, lire);
}
