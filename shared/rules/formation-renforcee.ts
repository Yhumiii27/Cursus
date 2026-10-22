// Postes à risques particuliers et formation renforcée à la sécurité (t061, art. L4154-2 et L4154-3) : un salarié en CDD,
// un intérimaire ou un alternant affecté à un poste de la liste des postes à risques particuliers pour la santé ou la
// sécurité doit recevoir une formation renforcée à la sécurité, en plus de l'accueil et de l'information de tout salarié.
// - Liste des postes : case « Liste des postes à risques particuliers (art. L4154-2) » du référentiel (`Poste.risquesL4154`),
//   distincte du suivi individuel renforcé (`sir`) et de l'exposition (`expose`). Décochée par défaut : aucun effet tant
//   que le service RH n'a rien coché. Cursus propose d'examiner les postes déjà en suivi renforcé, exposés, ou qui
//   exigent une habilitation SIR ou ATEX (`raisonsDExaminer`), sans jamais les cocher d'office. La liste s'imprime : elle
//   est établie après avis du médecin du travail et du CSE, et tenue à la disposition de l'inspection du travail.
// - Formation exigée : celle du catalogue désignée dans Paramètres (`formationRenforceeCode`, vide par défaut : aucune
//   exigence, avertissement `avertissementRenforcee`). Elle n'est satisfaite que par une certification obtenue depuis
//   l'entrée du contrat en cours : celle d'un contrat précédent ne vaut pas pour le nouveau poste.
// - Effets (shared/rules/exigences.ts) : exigence manquante, donc « Non conforme », échéance « exigence manquante » et
//   action « Inscrire à la formation » ; au Go / No Go, No Go sous le code CERTIFICATION (contrat de l'API v1 inchangé),
//   réserve si une session est planifiée avant le démarrage (`motifRenforcee`).
import { TYPES_CONTRAT } from '../constants.ts';
import { fmtIso } from '../format.ts';
import type { Chantier, Dataset, Employe, Formation, HabType, ISODate, Poste, Settings, TypeContrat } from '../types.ts';
import { actif } from './referentiels.ts';

/** Contrats concernés par la formation renforcée (art. L4154-2 : CDD et intérim ; l'alternance en CDD, retenue par prudence). */
export const CONTRATS_RENFORCEE: readonly TypeContrat[] = ['cdd', 'interim', 'alternance'];
export const contratRenforcee = (t: TypeContrat | null | undefined) => !!t && CONTRATS_RENFORCEE.includes(t);

/** Article cité à l'écran et dans l'origine de l'exigence. */
export const ARTICLE_L4154 = 'art. L4154-2';

type Ref = { referentiels: Pick<Dataset['referentiels'], 'formations'> } & { settings?: Partial<Pick<Settings, 'formationRenforceeCode'>> };

/** Formation désignée dans Paramètres, si elle est au catalogue et en vigueur ; null : aucune exigence. */
export function formationRenforcee(ds: Ref): Formation | null {
  const code = ds.settings?.formationRenforceeCode;
  if (!code) return null;
  const f = ds.referentiels.formations.find(x => x.id === code);
  return f && actif(f) ? f : null;
}

/**
 * Exigence de formation renforcée d'un salarié, sur le poste `poste` : formation désignée, date depuis laquelle une
 * certification la satisfait (entrée du contrat en cours) et origine affichée. Null : poste non coché, CDI, ou formation
 * non désignée.
 */
export function exigenceRenforcee(ds: Ref, e: Partial<Pick<Employe, 'typeContrat' | 'entree'>>, poste: Poste | null):
  { formation: string; depuis: ISODate; origine: string } | null {
  if (!poste?.risquesL4154 || !contratRenforcee(e.typeContrat) || !e.entree) return null;
  const f = formationRenforcee(ds);
  if (!f) return null;
  return { formation: f.id, depuis: e.entree, origine: `contrat ${TYPES_CONTRAT[e.typeContrat!].label} sur poste à risques (${ARTICLE_L4154})` };
}

/** Habilitation qui signale un poste à risques : cochée « SIR » au référentiel, ou habilitation ATEX (comme visites-dues.ts). */
const habRisque = (h: HabType | undefined) => !!h && actif(h) && (!!h.sir || /atex/i.test(`${h.id} ${h.nom}`));

/**
 * Raisons de proposer d'inscrire un poste sur la liste des postes à risques (sans le cocher) : suivi individuel renforcé,
 * exposition à des risques particuliers, habilitation SIR ou ATEX exigée. Vide : rien à signaler, ou déjà coché.
 */
export function raisonsDExaminer(ref: Pick<Dataset['referentiels'], 'habilitations'>, p: Pick<Poste, 'sir' | 'expose' | 'habilitations' | 'risquesL4154'>): string[] {
  if (p.risquesL4154) return [];
  const habs = p.habilitations.map(id => ref.habilitations.find(h => h.id === id)).filter(habRisque).map(h => h!.nom);
  return [
    p.sir ? 'suivi individuel renforcé' : '',
    p.expose ? 'exposé à des risques particuliers' : '',
    habs.length ? `${habs.length > 1 ? 'habilitations exigées' : 'habilitation exigée'} : ${habs.join(', ')}` : '',
  ].filter(Boolean);
}

/** Postes en vigueur de la liste des postes à risques particuliers, par intitulé. */
export const postesARisques = (postes: readonly Poste[]) => postes.filter(p => actif(p) && p.risquesL4154).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

/**
 * Avertissement de Paramètres et de Référentiels : formation renforcée non désignée (ou disparue du catalogue en
 * vigueur), d'autant plus nette qu'un poste est coché. Null : formation désignée et en vigueur.
 */
export function avertissementRenforcee(ds: Ref & { referentiels: Pick<Dataset['referentiels'], 'postes'> }): string | null {
  const code = ds.settings?.formationRenforceeCode ?? '';
  if (formationRenforcee(ds)) return null;
  const n = postesARisques(ds.referentiels.postes).length;
  const suite = n
    ? ` : ${n > 1 ? `les ${n} postes à risques particuliers n’exigent` : 'le poste à risques particuliers n’exige'} encore rien des CDD, intérimaires et alternants`
    : ' : aucune exigence tant qu’elle ne l’est pas';
  return code
    ? `Formation renforcée « ${code} » absente du catalogue ou archivée${suite}.`
    : `Formation renforcée non désignée${suite}.`;
}

/** Inscription à une session ouverte de la formation, finie avant `avant` (le démarrage d'un chantier). */
type Planif = Pick<Dataset, 'inscriptions' | 'sessions'>;
function sessionAvant(ds: Planif, empId: number, f: string, avant: ISODate, ti: ISODate) {
  return ds.sessions
    .filter(s => s.formation === f && s.statut !== 'Clôturée' && s.statut !== 'Annulée' && s.date >= ti && (s.fin ?? s.date) < avant
      && ds.inscriptions.some(i => i.empId === empId && i.sessionId === s.id))
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
}

/**
 * Motif Go / No Go d'une formation renforcée manquante (`Domain.resourceStatus`) : No Go, ou réserve si une session est
 * planifiée avant le démarrage du chantier. Code CERTIFICATION : le contrat de l'API Keystone v1 ne change pas.
 */
export function motifRenforcee(ds: Planif & { today: ISODate }, e: { id: number; manquants: readonly { id: string; label: string; renforcee?: boolean }[] }, c: Pick<Chantier, 'debut'>):
  { level: 'reserve' | 'nogo'; minimal: string; detailed: string }[] {
  return e.manquants.filter(m => m.renforcee).map(m => {
    const s = sessionAvant(ds, e.id, m.id, c.debut, ds.today);
    return s
      ? { level: 'reserve' as const, minimal: 'Formation renforcée planifiée avant le démarrage', detailed: `${m.label} — formation renforcée à la sécurité, session le ${fmtIso(s.date)}` }
      : { level: 'nogo' as const, minimal: 'Formation renforcée à la sécurité non suivie', detailed: `${m.label} — formation renforcée à la sécurité exigée sur un poste à risques particuliers, non suivie` };
  });
}
