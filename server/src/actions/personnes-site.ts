// lot 14 — personnes sur site : fiches des salariés d'entreprises extérieures (demande de Vigie du 4 novembre 2026,
// décision CV-10). Service RH seulement. Une fiche d'extérieur porte un nom, une entreprise, une adresse e-mail facultative
// et un matricule de site E permanent, posé à la création ; elle n'a ni contrat, ni équipe, ni poste, et n'entre dans
// aucun module des salariés (server/src/lecture-brute.ts la range à part). Ses titres et habilitations se tiennent par les
// actions habituelles (cert.ajouter, hab.delivrer…, ouvertes aux extérieurs par `getPersonne`).
// Règles : shared/rules/personnes-site.ts.
import { erreursExterieur, normaliserExterieur } from '../../../shared/rules/personnes-site.ts';
import type { Employe } from '../../../shared/types.ts';
import { matriculeSiteSuivant } from '../personnes-site.ts';
import { ActionError, type ActionHandler, type Ctx, requireRh } from './context.ts';

/** Adresses déjà attribuées (salariés et extérieurs), sauf celle de la fiche `sauf`. */
function adressesPrises(ctx: Ctx, sauf?: number): Record<string, string> {
  return Object.fromEntries([...ctx.ds.employes, ...(ctx.ds.exterieurs ?? [])].filter(e => e.email && e.id !== sauf).map(e => [e.email!, e.nom]));
}

function exterieurDe(ctx: Ctx, id: unknown): Employe {
  const e = (ctx.ds.exterieurs ?? []).find(x => x.id === Number(id));
  if (!e) throw new ActionError('Fiche d’extérieur introuvable', 404);
  return e;
}

const creer: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const s = normaliserExterieur(p);
  const erreurs = erreursExterieur(s, adressesPrises(ctx));
  if (erreurs.length) throw new ActionError(erreurs.join(' '));
  const matriculeSite = await matriculeSiteSuivant(ctx.db, 'E');
  // Fiche sans contrat avec l'entreprise : statut et contrat par défaut de la table (jamais lus pour un extérieur), ni
  // équipe, ni poste, ni entrée ; présente tant que le service RH ne la retire pas.
  const row = await ctx.db.insert<Employe>('employes', {
    nom: s.nom, entreprise: s.entreprise, email: s.email, exterieur: true, matriculeSite,
    equipe: null, poste: '', posteId: null, statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', heures: null, forfaitHeures: null, forfaitJours: null,
    jourOff: [], tempsDepuis: null, entree: ctx.d.ti, fin: null, agence: null, notifications: 'immediat',
  } as Partial<Employe> as Employe);
  return { message: `Fiche d’extérieur créée — ${s.nom} (${s.entreprise}) · matricule ${matriculeSite}`, result: { id: row.id, matriculeSite } };
};

const modifier: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const e = exterieurDe(ctx, p.id);
  const s = normaliserExterieur({ nom: p.nom ?? e.nom, entreprise: p.entreprise ?? e.entreprise, email: p.email !== undefined ? p.email : e.email });
  const erreurs = erreursExterieur(s, adressesPrises(ctx, e.id));
  if (erreurs.length) throw new ActionError(erreurs.join(' '));
  await ctx.db.update<Employe>('employes', e.id, { nom: s.nom, entreprise: s.entreprise, email: s.email });
  return { message: `Fiche d’extérieur modifiée — ${s.nom} (${e.matriculeSite})`, result: { id: e.id } };
};

export const personnesSiteActions = {
  'exterieur.creer': creer,
  'exterieur.modifier': modifier,
} satisfies Record<string, ActionHandler>;
