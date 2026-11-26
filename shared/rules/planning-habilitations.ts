// Planning d'équipe (CU-142, lot 18) : habilitations et formations exigées sur les postes déjà planifiés.
// La publication refuse un poste dont l'habilitation exigée manque déjà et demande un motif pour celle qui expirera avant
// lui (shared/rules/planning-controles.ts, `alertesHabilitations`). Mais une fois le planning publié, une habilitation
// retirée, suspendue, une délivrance encore attendue ou une échéance qui tombe avant un poste à venir ne se voyaient plus.
// Ce calcul reprend les mêmes contrôles, à la date de chaque poste, sur les postes à venir que le planificateur voit (la
// version publiée, ou le brouillon qui la remplacera) : ni stocké, ni journalisé, refait à chaque affichage.
// - Exigences : celles du poste et de l'équipe du salarié, plus celles du besoin de poste de l'horaire tenu ce jour-là
//   (`joursExiges`, shared/rules/planning-apercu.ts), comme à la publication.
// - Jours d'absence en vigueur : pas tenus, donc pas contrôlés (la nature de l'absence n'est jamais lue).
// - La réserve d'aptitude (donnée de santé, même neutre) n'est jamais rendue ici : elle reste dans l'aperçu de la publication.
// - Réservé au planificateur (service RH, manager ou suppléant « planning ») : l'appelant filtre les salariés (`retenir`).
import type { Domain, EmpX } from '../domain.ts';
import type { ISODate } from '../types.ts';
import type { Creneau } from '../types-planning.ts';
import { creneauxPlanificateur, horaireDuCreneau, sansBrouillonsPasses } from './planning.ts';
import { joursAbsents, joursExiges, nomsExigences } from './planning-apercu.ts';
import { alertesHabilitations, type CodePlanning, type JourPlanifie } from './planning-controles.ts';

/** Codes rendus : habilitation manquante (ou plus valide), expirée avant le poste, formation exigée non valide. */
export const CODES_HABILITATION_PLANIFIEE: readonly CodePlanning[] = ['habilitation', 'habilitation_expire', 'formation'];

/** Poste à venir d'un salarié dont une habilitation ou une formation exigée ne sera pas valide ce jour-là. */
export interface ManqueHabilitation {
  empId: number;
  equipe: string;
  jour: ISODate;
  horaire: string;
  /** « publie » : déjà communiqué au salarié ; « brouillon » : à publier (la publication le refusera ou demandera un motif). */
  statut: 'publie' | 'brouillon';
  code: CodePlanning;
  /** Texte sans la date : « habilitation exigée Habilitation électrique BR expirée le 2 oct. 2026 ». */
  texte: string;
}

/**
 * Postes à venir (du `du`, au plus tôt aujourd'hui, au `au`) dont une habilitation ou une formation exigée manque à leur
 * date. `creneaux` : créneaux nominatifs lus par le planificateur ; `fiches` : fiches enrichies (`fichesEnrichies`) ;
 * `retenir` : salariés que la personne connectée planifie. Triés par jour, puis par nom.
 */
export function habilitationsPlanifiees(d: Domain, x: {
  creneaux: readonly Creneau[]; fiches: ReadonlyMap<number, Pick<EmpX, 'id' | 'habs' | 'rawCerts' | 'med'>>; du?: ISODate; au: ISODate; retenir?: (empId: number) => boolean;
}): ManqueHabilitation[] {
  const du = x.du && x.du > d.ti ? x.du : d.ti;
  if (x.au < du) return [];
  const enVigueur = creneauxPlanificateur(sansBrouillonsPasses(x.creneaux.filter(c => c.empId != null && c.jour >= du && c.jour <= x.au), d.ti));
  const parSalarie = new Map<number, Creneau[]>();
  for (const c of enVigueur) {
    if (x.retenir && !x.retenir(c.empId!)) continue;
    parSalarie.set(c.empId!, [...(parSalarie.get(c.empId!) ?? []), c]);
  }
  const noms = nomsExigences(d);
  const out: ManqueHabilitation[] = [];
  for (const [empId, siens] of parSalarie) {
    const emp = d.emp(empId), ex = x.fiches.get(empId);
    if (!emp || !ex) continue;
    const parJour = new Map(siens.map(c => [c.jour, c]));
    const jours: JourPlanifie[] = siens.map(c => ({ jour: c.jour, horaire: horaireDuCreneau(c) })).sort((a, b) => a.jour.localeCompare(b.jour));
    const exiges = joursExiges(d, emp, jours, du, x.au, joursAbsents(d, empId, jours));
    // `du` = aujourd'hui : ce qui manque déjà est « habilitation », ce qui expirera avant le poste « habilitation_expire ».
    for (const a of alertesHabilitations(ex, exiges, d.ti, d.ti, noms)) {
      if (!CODES_HABILITATION_PLANIFIEE.includes(a.code)) continue;
      const c = parJour.get(a.jour);
      if (!c?.horaire) continue;
      out.push({
        empId, equipe: c.equipe ?? emp.equipe ?? '', jour: a.jour, horaire: c.horaire, statut: c.statut === 'brouillon' ? 'brouillon' : 'publie', code: a.code,
        texte: a.texte.slice(a.texte.indexOf(' : ') + 3).replace(', pendant la période', ', avant ce poste'),
      });
    }
  }
  return out.sort((a, b) => a.jour.localeCompare(b.jour) || d.personName(a.empId).localeCompare(d.personName(b.empId)) || a.texte.localeCompare(b.texte));
}

/** Manques d'un salarié un jour donné (texte de la case de la grille). */
export const manquesDuJour = (manques: readonly ManqueHabilitation[], empId: number, jour: ISODate) => manques.filter(m => m.empId === empId && m.jour === jour);
