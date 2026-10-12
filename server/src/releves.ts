// Relevés d'heures des intérimaires envoyés aux agences d'intérim (décision de l'entreprise : chaque semaine,
// par e-mail, à l'adresse de l'agence). Le relevé d'une agence pour une semaine révolue (jusqu'à cinq semaines en
// arrière) part tout seul dès que toutes les feuilles de ses intérimaires sont validées (après la validation, et
// à chaque relevé des tâches de fond) ; le service RH le consulte, l'envoie s'il reste une feuille en attente
// (le relevé complet suit alors automatiquement), ou le renvoie (`releve.envoyer`). Chaque envoi est conservé
// (table releves) : c'est l'indicateur « relevé transmis ».
import { Domain } from '../../shared/domain.ts';
import { addD, isoWeek } from '../../shared/dates.ts';
import { fmt, key, plural } from '../../shared/format.ts';
import { adresseAgence, agencesInterim } from '../../shared/rules/messagerie.ts';
import { csvTexte, heuresTexte, releveAgence, releveCsv, semainesAutomatiques, type Releve } from '../../shared/rules/releves.ts';
import type { CurrentUser, Messagerie, ReleveInterim } from '../../shared/types.ts';
import { loadFull } from './dataset.ts';
import type { Db } from './db.ts';
import { envoyerEmail, pieceJointe } from './integrations/email.ts';
import { courriel, lireMessagerie, periodeLongue } from './messagerie.ts';

/** Lecture du périmètre complet, comme le service RH. */
const RELEVES: CurrentUser = { role: 'rh', empId: null, nom: 'Cursus', intitule: 'Relevés d’heures des intérimaires' };

/** Dernier relevé transmis à cette agence pour cette semaine (nom d'agence comparé sans casse ni accents). */
function dernierReleve(db: Db, agence: string, semaine: string): Pick<ReleveInterim, 'creation' | 'enAttente'> | null {
  const rows = db.sql.prepare('SELECT agence, creation, en_attente AS enAttente FROM releves WHERE semaine = ? ORDER BY id DESC').all(semaine) as
    { agence: string; creation: string; enAttente: number | null }[];
  const x = rows.find(r => key(r.agence) === key(agence));
  return x ? { creation: x.creation, enAttente: x.enAttente ?? 0 } : null;
}

/**
 * Texte de l'e-mail : heures de chaque intérimaire, feuilles encore en attente (le relevé complet suivra :
 * automatiquement si la semaine est couverte par l'envoi automatique, sinon par le service RH), total. Relevé
 * complet après un relevé incomplet : il le remplace.
 */
function texteReleve(r: Releve, precedent: Pick<ReleveInterim, 'creation' | 'enAttente'> | null, suiteAuto: boolean): string {
  const remplace = precedent?.enAttente && !r.enAttente.length;
  const leur = r.enAttente.length > 1 ? 'leur' : 'sa';
  return [
    `Veuillez trouver ci-joint le relevé des heures validées de vos intérimaires pour la semaine ${isoWeek(r.semaine)} (${periodeLongue(r.semaine, addD(r.semaine, 4))}) :`,
    '',
    ...r.lignes.map(l => `• ${l.nom} (${l.poste}) : ${heuresTexte(l.total)} h, dont ${heuresTexte(l.normal)} h normales`
      + `${l.maj10 + l.maj25 + l.maj50 > 0 ? `, ${heuresTexte(l.maj10 + l.maj25 + l.maj50)} h majorées` : ''}${l.absences ? ` · ${plural(l.absences, 'jour d’absence', 'jours d’absence')}` : ''}`),
    '',
    `Total : ${heuresTexte(r.heures)} h · ${plural(r.lignes.length, 'intérimaire', 'intérimaires')}.`,
    ...(r.enAttente.length ? ['', `Feuille${r.enAttente.length > 1 ? 's' : ''} pas encore validée${r.enAttente.length > 1 ? 's' : ''} : ${r.enAttente.map(x => x.nom).join(', ')} — ${suiteAuto ? `le relevé complet vous sera envoyé dès ${leur} validation` : `le service RH vous enverra le relevé complet après ${leur} validation`}.`] : []),
    ...(remplace ? ['', `Ce relevé complet remplace celui du ${fmt(new Date(precedent!.creation))}, envoyé avant la validation de toutes les feuilles.`] : []),
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
  const suiteAuto = semainesAutomatiques(d.ti, m.agences.find(a => key(a.nom) === key(agence))?.depuis).includes(semaine);
  const texte = texteReleve(r, dernierReleve(db, agence, semaine), suiteAuto);
  const e = envoyerEmail(db, 'releve.interim', courriel(m, adresse, `Relevé d’heures des intérimaires — ${agence} — semaine ${isoWeek(semaine)}`, texte, {
    pj: [pieceJointe(csv.fichier, 'text/csv; charset=utf-8', csvTexte(csv.head, csv.rows))],
  }));
  const releve = db.insert<ReleveInterim>('releves', {
    agence, semaine, adresse, creation: e?.creation ?? new Date().toISOString(), par, envoiId: e?.id ?? null, interimaires: r.lignes.length, heures: r.heures,
    enAttente: r.enAttente.length,
  });
  return { releve: { ...releve, envoi: e?.statut ?? null }, r };
}

/**
 * Envoi automatique : pour les semaines révolues que couvre l'envoi automatique (`semainesAutomatiques` : cinq
 * semaines en arrière, pas avant l'enregistrement de l'adresse de l'agence), le relevé de chaque agence qui a une
 * adresse part dès que toutes les feuilles de ses intérimaires sont validées, s'il n'a pas encore été transmis, ou
 * si le dernier envoi était incomplet (feuilles alors en attente). `seulement` restreint à une agence et une
 * semaine (après une validation). Renvoie les relevés mis en file.
 */
export function relevesAutomatiques(db: Db, seulement?: { agence: string; semaine: string }): ReleveInterim[] {
  const d = new Domain(loadFull(db, RELEVES));
  const m = lireMessagerie(db);
  const agences = agencesInterim(d.ds.employes).filter(a => !seulement || key(a) === key(seulement.agence));
  const out: ReleveInterim[] = [];
  for (const agence of agences) {
    const reglage = m.agences.find(a => key(a.nom) === key(agence));
    if (!reglage?.adresse) continue;
    for (const semaine of semainesAutomatiques(d.ti, reglage.depuis).filter(w => !seulement || w === seulement.semaine)) {
      const dernier = dernierReleve(db, agence, semaine);
      if (dernier && !dernier.enAttente) continue;
      const r = releveAgence(d, agence, semaine);
      if (!r.lignes.length || r.enAttente.length) continue;
      const x = envoyerReleve(db, d, agence, semaine, 'Cursus', m);
      if (typeof x !== 'string') out.push(x.releve);
    }
  }
  return out;
}
