// Relevés d'heures des intérimaires envoyés aux agences d'intérim (décision de l'entreprise : chaque semaine,
// par e-mail, à l'adresse de l'agence). Le relevé d'une agence pour une semaine révolue part tout seul dès que
// toutes les feuilles de ses intérimaires sont validées (après la validation, et à chaque relevé des tâches
// de fond) ; le service RH le consulte, l'envoie s'il reste une feuille en attente, ou le renvoie
// (`releve.envoyer`). Chaque envoi est conservé (table releves) : c'est l'indicateur « relevé transmis ».
import { Domain } from '../../shared/domain.ts';
import { addD, isoWeek, mondayOf } from '../../shared/dates.ts';
import { key, plural } from '../../shared/format.ts';
import { adresseAgence, agencesInterim } from '../../shared/rules/messagerie.ts';
import { csvTexte, heuresTexte, releveAgence, releveCsv, semainesAutomatiques, type Releve } from '../../shared/rules/releves.ts';
import type { CurrentUser, Messagerie, ReleveInterim } from '../../shared/types.ts';
import { loadFull } from './dataset.ts';
import type { Db } from './db.ts';
import { envoyerEmail, pieceJointe } from './integrations/email.ts';
import { courriel, lireMessagerie, periodeLongue } from './messagerie.ts';

/** Lecture du périmètre complet, comme le service RH. */
const RELEVES: CurrentUser = { role: 'rh', empId: null, nom: 'Cursus', intitule: 'Relevés d’heures des intérimaires' };

/** Texte de l'e-mail : heures de chaque intérimaire, feuilles encore en attente, total. */
function texteReleve(r: Releve): string {
  return [
    `Veuillez trouver ci-joint le relevé des heures validées de vos intérimaires pour la semaine ${isoWeek(r.semaine)} (${periodeLongue(r.semaine, addD(r.semaine, 4))}) :`,
    '',
    ...r.lignes.map(l => `• ${l.nom} (${l.poste}) : ${heuresTexte(l.total)} h, dont ${heuresTexte(l.normal)} h normales`
      + `${l.maj10 + l.maj25 + l.maj50 > 0 ? `, ${heuresTexte(l.maj10 + l.maj25 + l.maj50)} h majorées` : ''}${l.absences ? ` · ${plural(l.absences, 'jour d’absence', 'jours d’absence')}` : ''}`),
    '',
    `Total : ${heuresTexte(r.heures)} h · ${plural(r.lignes.length, 'intérimaire', 'intérimaires')}.`,
    ...(r.enAttente.length ? ['', `Feuille${r.enAttente.length > 1 ? 's' : ''} pas encore validée${r.enAttente.length > 1 ? 's' : ''} : ${r.enAttente.map(x => x.nom).join(', ')} — un relevé complémentaire suivra.`] : []),
    '',
    'Le détail par jour et les heures majorées (10 %, 25 %, 50 %) figurent dans le fichier joint (CSV).',
  ].join('\n');
}

/**
 * Met en file le relevé d'une agence pour une semaine et l'enregistre comme transmis. Renvoie le message
 * d'erreur au lieu d'envoyer : agence sans adresse, aucune feuille validée.
 */
export function envoyerReleve(db: Db, d: Domain, agence: string, semaine: string, par: string, m: Messagerie = lireMessagerie(db)): { releve: ReleveInterim; r: Releve } | string {
  const adresse = adresseAgence(m, agence);
  if (!adresse) return `Adresse de l’agence ${agence} à renseigner (Paramètres → Messagerie)`;
  const r = releveAgence(d, agence, semaine);
  if (!r.lignes.length) return `Aucune feuille de temps validée la semaine ${isoWeek(semaine)} pour les intérimaires de ${agence}`;
  const csv = releveCsv(r);
  const e = envoyerEmail(db, 'releve.interim', courriel(m, adresse, `Relevé d’heures des intérimaires — ${agence} — semaine ${isoWeek(semaine)}`, texteReleve(r), {
    pj: [pieceJointe(csv.fichier, 'text/csv; charset=utf-8', csvTexte(csv.head, csv.rows))],
  }));
  const releve = db.insert<ReleveInterim>('releves', {
    agence, semaine, adresse, creation: e?.creation ?? new Date().toISOString(), par, envoiId: e?.id ?? null, interimaires: r.lignes.length, heures: r.heures,
  });
  return { releve: { ...releve, envoi: e?.statut ?? null }, r };
}

/** Relevé déjà transmis pour cette agence et cette semaine (nom d'agence comparé sans casse ni accents). */
const dejaTransmis = (db: Db, agence: string, semaine: string) =>
  (db.sql.prepare('SELECT agence FROM releves WHERE semaine = ?').all(semaine) as { agence: string }[]).some(x => key(x.agence) === key(agence));

/**
 * Envoi automatique : pour la semaine précédente et la semaine en cours une fois son vendredi passé, le relevé de
 * chaque agence qui a une adresse part s'il n'a pas encore été transmis et que toutes les feuilles de ses
 * intérimaires sont validées. `seulement` restreint à une agence et une semaine (après une validation).
 * Renvoie les relevés mis en file.
 */
export function relevesAutomatiques(db: Db, seulement?: { agence: string; semaine: string }): ReleveInterim[] {
  const d = new Domain(loadFull(db, RELEVES));
  const m = lireMessagerie(db);
  const semaines = semainesAutomatiques(mondayOf(d.ti), d.ti).filter(w => !seulement || w === seulement.semaine);
  const agences = agencesInterim(d.ds.employes).filter(a => !seulement || key(a) === key(seulement.agence));
  const out: ReleveInterim[] = [];
  for (const agence of agences) {
    if (!adresseAgence(m, agence)) continue;
    for (const semaine of semaines) {
      if (dejaTransmis(db, agence, semaine)) continue;
      const r = releveAgence(d, agence, semaine);
      if (!r.lignes.length || r.enAttente.length) continue;
      const x = envoyerReleve(db, d, agence, semaine, 'Cursus', m);
      if (typeof x !== 'string') out.push(x.releve);
    }
  }
  return out;
}
