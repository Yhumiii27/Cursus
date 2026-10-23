// Passeport de prévention (lot 7, chantier B, t066 ; shared/rules/passeport-prevention.ts) : export CSV des lignes à
// déclarer sur la plateforme, depuis l'écran Formations.
//   GET /api/formations/passeport-prevention?du=AAAA-MM-JJ&au=AAAA-MM-JJ[&declarees=1]
//                                      service RH et référent HSE (droit « formations ») : une ligne par certification ou
//                                      formation suivie d'une formation marquée, dont le dernier jour tombe dans la période ;
//                                      déjà déclarées exclues sauf `declarees=1` ; colonnes du gabarit réglé dans Paramètres.
// Produit ici, et non dans le navigateur : la date de naissance (colonne du gabarit par défaut) n'est jamais transmise au
// référent HSE dans l'instantané. Format de la plateforme à confirmer (mention sur chaque ligne) ; aucun NIR. Chaque export
// est tracé (`passeport.exporter` : période, nombre de lignes, salariés concernés), sans intitulé ni nom.
import express, { type Request, type Response, type Router } from 'express';
import { droitsRh } from '../../shared/constants.ts';
import { Domain } from '../../shared/domain.ts';
import { fmtIso, plural } from '../../shared/format.ts';
import { texteCsv } from '../../shared/csv.ts';
import { controlerPeriode, exportPasseport, lignesPasseport } from '../../shared/rules/passeport-prevention.ts';
import { journaliser } from './comptes.ts';
import { identite } from './connexion.ts';
import { loadFull } from './dataset.ts';
import { type Db, enSerie } from './db.ts';
import { fichierJoint, tracerRefus } from './journal.ts';

export function routesPasseportPrevention(db: Db): Router {
  const r = express.Router();

  r.get('/api/formations/passeport-prevention', enSerie(db, async (req: Request, res: Response) => {
    const id = await identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    if (!droitsRh(id.user).includes('formations')) {
      await tracerRefus(db, id, 'Export du Passeport de prévention', 'réservé au service RH et au référent HSE');
      return res.status(403).json({ error: 'Export du Passeport de prévention réservé au service RH et au référent HSE' });
    }
    const { periode, erreur } = controlerPeriode(req.query.du, req.query.au);
    if (!periode) return res.status(400).json({ error: erreur });
    const declarees = req.query.declarees === '1';
    const full = await loadFull(db, id.user);
    const d = new Domain(full);
    const lignes = lignesPasseport(d, { ...periode, declarees });
    const x = exportPasseport(d, lignes, full.settings.passeportColonnes, periode);
    await journaliser(db, {
      actor: id.user.nom, role: id.user.role, action: 'passeport.exporter', compte: id.compte,
      salaries: [...new Set(lignes.map(l => l.empId))],
      message: `Passeport de prévention : lignes ${declarees ? 'de la période (déjà déclarées comprises)' : 'à déclarer'} du ${fmtIso(periode.du)} au ${fmtIso(periode.au)} exportées — ${plural(lignes.length, 'ligne', 'lignes')}`,
      payload: { du: periode.du, au: periode.au, declarees, lignes: lignes.length },
    });
    fichierJoint(res, 'text/csv; charset=utf-8', x.fichier, texteCsv(x.head, x.rows));
  }));

  return r;
}
