// Planning d'équipe (lot 12, chantier C5, t192, étape 3) : conflits d'un créneau planifié avec les autres engagements du
// salarié, signalés au planificateur (grille, aperçu de la publication et de la validation d'un échange) sans jamais rien
// bloquer ni exiger de motif (gravité « info » de shared/rules/planning-controles.ts). Calculé, jamais stocké ni journalisé.
// - Mission Keystone (`Dataset.missions`, transmise par Keystone, jamais écrite chez lui) qui couvre le jour d'un poste ou
//   d'un repos planifié : le salarié serait sur un chantier.
// - Tâche Keystone avec des heures prévues un jour de repos planifié (un jour de poste, les heures de la tâche peuvent se
//   faire pendant le poste : rien n'est signalé).
// - Session de formation où le salarié est inscrit (`sessionsInscrit`, shared/rules/conflits.ts) : un jour de repos
//   planifié (le temps de formation est du temps de travail), ou un jour de poste dont l'horaire de la session chevauche
//   la plage du poste (session sans horaire : la journée entière). Le temps de formation étant du temps de travail, une
//   session de la veille, du jour ou du lendemain d'un poste qui laisse moins que le repos quotidien entre elle et le poste
//   (11 h, art. L3131-1 ; la valeur réduite de l'accord `planningReposQuotidienAccord` ; 12 h et 14 h pour un mineur,
//   art. L3164-1) est aussi signalée, au jour du poste (exemple : session de 9 h à 12 h le jour d'un poste de nuit qui
//   commence à 21 h, ou à 8 h le lendemain d'un poste de nuit fini à 5 h).
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
import { mineurAu, moins16Au } from './mineurs.ts';
import { instantParis, type JourPlanifie, plageReelle, reglagesPlanning } from './planning-controles.ts';
import { REPOS_QUOTIDIEN, REPOS_QUOTIDIEN_MINEUR, REPOS_QUOTIDIEN_MOINS_16 } from './repos-nuit.ts';

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
  // Sessions lues un jour de part et d'autre de la période : leur repos avec un poste de la période se contrôle aussi.
  const veilleDu = addD(du, -1), lendemainAu = addD(au, 1);
  const sessions = sessionsInscrit(d, empId).map(s => ({ s, jours: joursSession(s) })).filter(x => x.jours.some(j => j >= veilleDu && j <= lendemainAu));
  const astreintes = (ds.astreintes ?? []).filter(a => a.empId === empId && astreinteActive(a) && a.au >= addD(du, -1) && a.du <= addD(au, 1))
    .map(a => ({ a, debut: instantParis(a.du, a.debut), fin: instantParis(a.au, a.fin) }));
  // Postes tenus (absences exclues) de tous les jours reçus, période et voisins, pour le repos autour d'une session.
  const postes = new Map(jours.filter(j => j.horaire && !absents.has(j.jour)).map(j => [j.jour, { code: j.horaire!.code, ...plageReelle(j.jour, j.horaire!) }]));
  const reposPlanifies = new Set(retenus.filter(j => !j.horaire).map(j => j.jour));
  const e = ds.employes.find(x => x.id === empId);
  /** Repos quotidien exigé autour d'un poste du jour `jour` (heures) et sa référence. */
  const seuilRepos = (jour: ISODate): { h: number; ref: string } => {
    if (e && mineurAu(e, jour)) {
      const moins16 = moins16Au(e, jour);
      return { h: moins16 ? REPOS_QUOTIDIEN_MOINS_16 : REPOS_QUOTIDIEN_MINEUR, ref: `salarié de moins de ${moins16 ? 16 : 18} ans, art. L3164-1` };
    }
    const accord = reglagesPlanning(ds.settings).planningReposQuotidienAccord;
    return accord < REPOS_QUOTIDIEN ? { h: accord, ref: 'fixé par l’accord, art. D3131-1' } : { h: REPOS_QUOTIDIEN, ref: 'art. L3131-1' };
  };
  const vus = new Set<string>();
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
    const nomSession = (x: { formation: string }) => `session de formation ${d.fm(x.formation)?.court ?? x.formation}`;
    if (!poste) {
      for (const { s } of sessions.filter(x => x.jours.includes(jour))) {
        const h = horaireDuJour(s, jour);
        ajouter(jour, 'conflit_session', `${nomSession(s)}${h ? ` de ${h.debut} à ${h.fin}` : ''} ${quoi}`);
      }
    } else {
      // Sessions de la veille, du jour et du lendemain face aux postes voisins : chevauchement, puis repos quotidien. Une
      // session d'un jour de repos planifié de la période y est déjà signalée ; une paire (session, poste) ne l'est qu'une fois.
      const seuil = seuilRepos(jour);
      for (const sj of [addD(jour, -1), jour, addD(jour, 1)]) {
        if (sj !== jour && reposPlanifies.has(sj)) continue;
        for (const { s } of sessions.filter(x => x.jours.includes(sj))) {
          const h = horaireDuJour(s, sj);
          if (!h) {
            if (sj === jour) ajouter(jour, 'conflit_session', `${nomSession(s)} ${quoi}`);
            continue;
          }
          const plage = { debut: instantParis(sj, h.debut), fin: instantParis(sj, h.fin) };
          // Le poste du jour face à une session voisine ; une session du jour face aux postes de la veille et du lendemain aussi.
          const face = sj === jour ? [addD(jour, -1), jour, addD(jour, 1)] : [jour];
          for (const pj of face) {
            const p = postes.get(pj);
            const cle = `${s.id}|${sj}|${pj}`;
            if (!p || vus.has(cle)) continue;
            const quand = sj === jour ? `de ${h.debut} à ${h.fin}` : `du ${fmtIso(sj)} de ${h.debut} à ${h.fin}`;
            const duPoste = pj === jour ? `le poste ${p.code} planifié` : `le poste ${p.code} du ${fmtIso(pj)}`;
            if (chevauche(p, plage)) {
              vus.add(cle);
              ajouter(jour, 'conflit_session', `${nomSession(s)} ${quand} pendant ${duPoste}`);
              continue;
            }
            const avant = plage.fin <= p.debut;
            const repos = Math.round((avant ? p.debut - plage.fin : plage.debut - p.fin) / 60 * 100) / 100;
            if (repos >= seuil.h) continue;
            vus.add(cle);
            ajouter(jour, 'conflit_session', `${nomSession(s)} ${quand} : ${fH(repos)} de repos ${avant ? 'avant' : 'après'} ${duPoste}, moins que le repos quotidien de ${seuil.h} h (${seuil.ref})`);
          }
        }
      }
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
