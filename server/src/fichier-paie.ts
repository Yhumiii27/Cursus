// Fichier d'import d'un lot de paie pour Sage (t019, mode fichier) :
//   GET /api/paie/lots/:id/fichier   administrateur RH et gestionnaire de paie (droit « paie ») : CSV tiré du contenu
//                                    figé du lot, au format réglé par la paie (shared/rules/lots-paie.ts), encodé en
//                                    UTF-8 sans BOM ou en Windows-1252 selon ce format.
// Chaque téléchargement est tracé (`sage.fichier`, archive paie de 3 ans, salariés du lot) et compté sur le lot : la
// confirmation de l'import d'un lot de fichier suppose au moins un téléchargement. Un lot annulé ne se télécharge plus
// (son fichier ne doit pas être importé) ; un lot historique, repris d'avant les lots, n'a pas de contenu.
import express, { type Router } from 'express';
import { droitsRh } from '../../shared/constants.ts';
import { plural } from '../../shared/format.ts';
import { fichierLot, libellesSage, nomFichierLot, octetsFichierLot, typeFichierLot } from '../../shared/rules/lots-paie.ts';
import { periodeLabel, rubriquesPaie } from '../../shared/rules/paie.ts';
import type { RubriquePaie } from '../../shared/types.ts';
import { journaliser } from './comptes.ts';
import { identite } from './connexion.ts';
import type { Db } from './db.ts';
import { fichierJoint, tracerRefus } from './journal.ts';
import { lireFormatFichier, type LotEnregistre } from './lots-paie.ts';

export function routesFichierPaie(db: Db): Router {
  const r = express.Router();

  r.get('/api/paie/lots/:id/fichier', (req, res) => {
    const id = identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    if (!droitsRh(id.user).includes('paie')) {
      tracerRefus(db, id, 'Fichier d’import Sage', 'réservé à l’administrateur RH et au gestionnaire de paie');
      return res.status(403).json({ error: 'Fichier d’import réservé à l’administrateur RH et au gestionnaire de paie' });
    }
    const lot = db.get<LotEnregistre>('lotsPaie', Number(req.params.id));
    if (!lot) return res.status(404).json({ error: 'Lot de paie introuvable' });
    if (lot.statut === 'annule') return res.status(409).json({ error: `Lot n° ${lot.id} annulé : son fichier ne doit pas être importé dans Sage` });
    if (!lot.contenu) return res.status(409).json({ error: `Lot n° ${lot.id} repris d’avant les lots de paie : aucun fichier` });
    const format = lireFormatFichier(db);
    // Libellés figés à la génération ; lot d'avant la colonne « libellé » : ceux de la table en vigueur.
    const libelles = lot.contenu.libelles ?? libellesSage(lot.contenu, rubriquesPaie(db.all<RubriquePaie>('rubriquesPaie')));
    const texte = fichierLot(lot.contenu, format, libelles);
    const lignes = texte.split('\r\n').filter(Boolean).length - (format.entete ? 1 : 0);
    db.tx(() => {
      db.update('lotsPaie', lot.id, { telechargeLe: new Date().toISOString(), telechargePar: id.user.nom, telechargements: (lot.telechargements ?? 0) + 1 });
      journaliser(db, {
        actor: id.user.nom, role: id.user.role, action: 'sage.fichier', compte: id.compte, salaries: [...new Set([...lot.feuilles.map(f => f.empId), ...(lot.absences ?? []).map(a => a.empId)])],
        message: `Fichier d’import Sage du lot n° ${lot.id} téléchargé — ${periodeLabel(lot.periode)}, ${plural(lignes, 'ligne', 'lignes')}${lot.mode === 'simulation' ? ' (simulation)' : ''}`,
        payload: { lot: lot.id, cle: lot.cle, periode: lot.periode, lignes, format },
      });
    });
    fichierJoint(res, typeFichierLot(format), nomFichierLot(lot, format), Buffer.from(octetsFichierLot(texte, format)));
  });

  return r;
}
