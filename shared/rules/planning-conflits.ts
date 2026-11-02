// Planning d'équipe (lot 12, chantier C5, t192, étape 3) : conflits d'un créneau planifié avec les autres engagements du
// salarié, signalés au planificateur (grille, aperçu de la publication et de la validation d'un échange) sans jamais rien
// bloquer ni exiger de motif (gravité « info » de shared/rules/planning-controles.ts). Calculé, jamais stocké ni journalisé.
// - Mission Keystone (`Dataset.missions`, transmise par Keystone, jamais écrite chez lui) qui couvre le jour d'un poste ou
//   d'un repos planifié : le salarié serait sur un chantier.
// - Tâche Keystone avec des heures prévues un jour de repos planifié (un jour de poste, les heures de la tâche peuvent se
//   faire pendant le poste : rien n'est signalé).
// - Session de formation où le salarié est inscrit (`sessionsInscrit`, shared/rules/conflits.ts) : un jour de repos
//   planifié (le temps de formation est du temps de travail), ou un jour de poste dont l'horaire de la session chevauche
//   la plage du poste (session sans horaire : la journée entière).
// - Astreinte en vigueur (non annulée) qui chevauche la plage du poste : l'astreinte est une période hors du temps de
//   travail (art. L3121-9) ; le repos qui suit une intervention se contrôle déjà sur la feuille de temps.
// Plages comptées en temps réel à l'heure de Paris (`instantParis`, changement d'heure compris). Les jours d'absence en
// vigueur ne sont pas contrôlés (le poste n'y est pas tenu) ; la nature d'une absence n'est jamais lue.
import { addD } from '../dates.ts';
import type { Domain } from '../domain.ts';
import { fH, fmtIso } from '../format.ts';
import type { ISODate } from '../types.ts';
import { astreinteActive } from './astreintes.ts';
import { sessionsInscrit } from './conflits.ts';
import { horaireDuJour, joursSession } from './plage-session.ts';
import { instantParis, type JourPlanifie, plageReelle } from './planning-controles.ts';

/** Engagement en conflit avec le créneau. */
export type CodeConflit = 'conflit_mission' | 'conflit_session' | 'conflit_astreinte';
export interface ConflitCreneau { empId: number; jour: ISODate; code: CodeConflit; texte: string }

/** Intervalles réels [début, fin[ qui se chevauchent. */
const chevauche = (a: { debut: number; fin: number }, b: { debut: number; fin: number }) => a.debut < b.fin && b.debut < a.fin;

/**
 * Conflits des jours planifiés `jours` du salarié `empId` compris entre `du` et `au` (bornes comprises), `absents` exclus,
 * avec ses missions et tâches Keystone, ses sessions de formation et ses astreintes de l'instantané `d`. Un conflit par
 * engagement et par jour, dans l'ordre des jours.
 */
export function conflitsPlanning(d: Domain, empId: number, jours: readonly JourPlanifie[], du: ISODate, au: ISODate,
  absents: ReadonlySet<ISODate> = new Set()): ConflitCreneau[] {
  const ds = d.ds;
  const retenus = jours.filter(j => j.jour >= du && j.jour <= au && !absents.has(j.jour));
  if (!retenus.length) return [];
  const missions = (ds.missions ?? []).filter(m => m.empId === empId && m.au >= du && m.du <= au);
  const taches = (ds.taches ?? []).filter(t => t.empId === empId && t.fin >= du && t.debut <= au);
  const sessions = sessionsInscrit(d, empId).map(s => ({ s, jours: joursSession(s) })).filter(x => x.jours.some(j => j >= du && j <= au));
  const astreintes = (ds.astreintes ?? []).filter(a => a.empId === empId && astreinteActive(a) && a.au >= addD(du, -1) && a.du <= addD(au, 1))
    .map(a => ({ a, debut: instantParis(a.du, a.debut), fin: instantParis(a.au, a.fin) }));
  const out: ConflitCreneau[] = [];
  const ajouter = (jour: ISODate, code: CodeConflit, texte: string) => out.push({ empId, jour, code, texte: `${fmtIso(jour)} : ${texte}` });
  for (const { jour, horaire } of retenus) {
    const poste = horaire ? plageReelle(jour, horaire) : null;
    const quoi = horaire ? `pendant le poste ${horaire.code} planifié` : 'un jour de repos planifié';
    for (const m of missions.filter(x => x.du <= jour && jour <= x.au)) {
      ajouter(jour, 'conflit_mission', `mission Keystone ${m.projet}${m.lieu ? ` (${m.lieu})` : ''} ${quoi}`);
    }
    if (!poste) {
      for (const t of taches.filter(x => (x.heures[jour] ?? 0) > 0)) ajouter(jour, 'conflit_mission', `${fH(t.heures[jour])} prévues par Keystone (${t.projet}) un jour de repos planifié`);
    }
    for (const { s } of sessions.filter(x => x.jours.includes(jour))) {
      const h = horaireDuJour(s, jour);
      if (poste && h && !chevauche(poste, { debut: instantParis(jour, h.debut), fin: instantParis(jour, h.fin) })) continue;
      ajouter(jour, 'conflit_session', `session de formation ${d.fm(s.formation)?.court ?? s.formation}${h ? ` de ${h.debut} à ${h.fin}` : ''} ${quoi}`);
    }
    if (poste) {
      for (const x of astreintes.filter(x => chevauche(poste, x))) {
        ajouter(jour, 'conflit_astreinte', `astreinte du ${fmtIso(x.a.du)} ${x.a.debut} au ${fmtIso(x.a.au)} ${x.a.fin} ${quoi}`);
      }
    }
  }
  return out;
}

/** Conflits qui concernent le créneau d'un salarié un jour donné. */
export const conflitsDuJour = (conflits: readonly ConflitCreneau[], empId: number, jour: ISODate) => conflits.filter(c => c.empId === empId && c.jour === jour);
