// Exports comptables des notes de frais (lot 11, chantier C5, étape 2), lus hors de l'instantané (table exportsFrais dans
// HORS_INSTANTANE, server/src/lecture-brute.ts) :
//   GET /api/frais/exports              comptabilité (droit « compta ») et service RH : exports, du plus récent au plus
//                                       ancien, sans leurs écritures (nombre et total seulement), notes emportées
//   GET /api/frais/exports/:id/fichier  le fichier d'écritures, tiré du contenu figé de l'export au gabarit en vigueur
//                                       (Paramètres → Notes de frais), comme le fichier d'import Sage ; chaque
//                                       téléchargement est tracé (`frais.export.fichier`, archive paie de 3 ans, salariés
//                                       de l'export) et compté sur l'export ; un export annulé ne se télécharge plus.
// Refus tracés (acces.refuse). Les deux routes sont gardées contre une navigation provoquée depuis un autre site
// (server/src/app.ts, exigerNavigationInterne) : l'écran les lit par fetch, avec l'en-tête d'espace.
import express, { type Request, type Response, type Router } from 'express';
import { droitsRh } from '../../shared/constants.ts';
import { plural } from '../../shared/format.ts';
import { fichierEcritures, GABARIT_FRAIS_DEFAUT, nomFichierEcritures, octetsEcritures } from '../../shared/rules/frais-export.ts';
import type { GabaritExportComptable } from '../../shared/rules/export-comptable.ts';
import type { CurrentUser, ExportFraisEnregistre, ExportFraisVue, NoteFrais } from '../../shared/types.ts';
import { journaliser } from './comptes.ts';
import { identite, type Identite } from './connexion.ts';
import { loadSettings } from './dataset.ts';
import { type Db, enSerie } from './db.ts';
import { fichierJoint, tracerRefus } from './journal.ts';

/** Comptabilité ou service RH. */
export const controleurFrais = (u: Pick<CurrentUser, 'role' | 'profilRh'>) => droitsRh(u).some(d => d === 'rh' || d === 'compta');

/** Gabarit en vigueur (réglage `fraisGabarit`, déjà contrôlé à l'enregistrement), sinon celui proposé. */
const gabaritEnVigueur = async (db: Db): Promise<GabaritExportComptable> => (await loadSettings(db)).fraisGabarit ?? GABARIT_FRAIS_DEFAUT;

/** Vue d'un export pour l'écran : sans écritures ni clé. */
export const vueExport = (x: ExportFraisEnregistre): ExportFraisVue => ({
  id: x.id, type: x.type, creation: x.creation, auteur: x.auteur, notes: x.notes ?? [], telechargements: x.telechargements ?? 0, telechargeLe: x.telechargeLe,
  telechargePar: x.telechargePar, annuleLe: x.annuleLe, ecritures: x.contenu?.ecritures ?? 0, montant: x.contenu?.debit ?? 0,
});

export function routesFraisExports(db: Db): Router {
  const r = express.Router();

  /** Personne connectée qui contrôle les frais, sinon réponse 401 ou 403 (refus tracé). */
  async function controleur(req: Request, res: Response, quoi: string): Promise<Identite | null> {
    const id = await identite(db, req);
    if (!id) { res.status(401).json({ error: 'Connexion requise' }); return null; }
    if (!controleurFrais(id.user)) {
      await db.tx(async () => await tracerRefus(db, id, quoi, 'réservé à la comptabilité et au service RH'));
      res.status(403).json({ error: 'Exports comptables réservés à la comptabilité et au service RH' });
      return null;
    }
    return id;
  }

  r.get('/api/frais/exports', enSerie(db, async (req: Request, res: Response) => {
    if (!(await controleur(req, res, 'Exports comptables des notes de frais'))) return;
    const tous = await db.all<ExportFraisEnregistre>('exportsFrais');
    res.set('Cache-Control', 'no-store').json({ exports: tous.sort((a, b) => b.id - a.id).map(vueExport) });
  }));

  r.get('/api/frais/exports/:id/fichier', enSerie(db, async (req: Request, res: Response) => {
    const id = await controleur(req, res, 'Fichier d’écritures des notes de frais');
    if (!id) return;
    const x = await db.get<ExportFraisEnregistre>('exportsFrais', Number(req.params.id) || 0);
    if (!x || !x.contenu) return res.status(404).json({ error: 'Export comptable introuvable' });
    if (x.annuleLe) return res.status(409).json({ error: `Export comptable n° ${x.id} annulé : son fichier ne doit pas être importé` });
    const g = await gabaritEnVigueur(db);
    const texte = fichierEcritures(x.contenu.lignes, g);
    const salaries = new Set<number>();
    for (const n of x.notes ?? []) {
      const note = await db.get<NoteFrais>('notesFrais', n);
      if (note) salaries.add(note.empId);
    }
    await db.tx(async () => {
      await db.update<ExportFraisEnregistre>('exportsFrais', x.id, { telechargeLe: new Date().toISOString(), telechargePar: id.user.nom, telechargements: (x.telechargements ?? 0) + 1 });
      await journaliser(db, {
        actor: id.user.nom, role: id.user.role, action: 'frais.export.fichier', compte: id.compte, salaries: [...salaries],
        message: `Fichier d’écritures de l’export comptable n° ${x.id} téléchargé — ${plural(x.contenu!.ecritures, 'ligne', 'lignes')}`,
        payload: { export: x.id, notes: x.notes?.length ?? 0, lignes: x.contenu!.ecritures, montant: x.contenu!.debit, gabarit: g },
      });
    });
    fichierJoint(res, `text/${g.separateur === 'tab' ? 'plain' : 'csv'}; charset=${g.encodage}`, nomFichierEcritures(x.id, g), Buffer.from(octetsEcritures(texte, g)));
  }));

  return r;
}
