// Passeport de prévention (lot 7, chantier B, t066 ; shared/rules/passeport-prevention.ts) : export CSV des lignes à
// déclarer sur la plateforme, depuis l'écran Formations.
//   GET /api/formations/passeport-prevention?du=AAAA-MM-JJ&au=AAAA-MM-JJ[&vue=a-declarer|declarees]
//                                      service RH et référent HSE (droit « formations ») : une ligne par certification ou
//                                      formation suivie d'une formation marquée, dont le dernier jour tombe dans la période ;
//                                      `a-declarer` (par défaut) : lignes sans marque, intérimaires exclus (leur formation se
//                                      déclare en principe par l'agence, comme le C2P) ; `declarees` : lignes marquées
//                                      seulement (celles de la vue « Déjà déclarées ») ; colonnes du gabarit réglé dans Paramètres.
// Nombre de lignes du fichier et d'intérimaires écartés : en-têtes `X-Passeport-Nombre` et `X-Passeport-Interimaires`.
// Les clés des lignes à déclarer exportées (« cert:12 », « suivie:4 ») sont renvoyées dans l'en-tête `X-Passeport-Lignes` :
// l'écran les garde et ne propose à la marque « déclarées » que ce qui a réellement été exporté (une ligne saisie depuis
// n'est pas marquée sans avoir été envoyée). Au-delà de `MAX_ENTETE` caractères, l'en-tête est omis (les lignes se cochent
// alors à la main dans le dialogue).
// Produit ici, et non dans le navigateur : la date de naissance (colonne du gabarit par défaut) n'est jamais transmise au
// référent HSE dans l'instantané. Format de la plateforme à confirmer (mention sur chaque ligne) ; aucun NIR. Chaque export
// est tracé (`passeport.exporter` : période, vue, nombre de lignes, intérimaires écartés, salariés concernés), sans
// intitulé ni nom.
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

/** Longueur au-delà de laquelle les clés exportées ne sont pas renvoyées en en-tête (limites des mandataires HTTP). */
export const MAX_ENTETE = 6000;

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
    const vue = req.query.vue ?? 'a-declarer';
    if (vue !== 'a-declarer' && vue !== 'declarees') return res.status(400).json({ error: 'Vue inconnue : « a-declarer » ou « declarees »' });
    const declarees = vue === 'declarees';
    const full = await loadFull(db, id.user);
    const d = new Domain(full);
    // La règle rend toutes les lignes de la période ; la vue garde soit les seules lignes marquées, soit les seules à déclarer.
    const periodeEntiere = lignesPasseport(d, { ...periode, declarees: true });
    const choisies = periodeEntiere.filter(l => (declarees ? !!l.declareLe : !l.declareLe));
    const interimaires = declarees ? 0 : choisies.filter(l => l.interim).length;
    const lignes = declarees ? choisies : choisies.filter(l => !l.interim);
    const x = exportPasseport(d, lignes, full.settings.passeportColonnes, periode);
    await journaliser(db, {
      actor: id.user.nom, role: id.user.role, action: 'passeport.exporter', compte: id.compte,
      salaries: [...new Set(lignes.map(l => l.empId))],
      message: `Passeport de prévention : lignes ${declarees ? 'déjà déclarées' : 'à déclarer'} du ${fmtIso(periode.du)} au ${fmtIso(periode.au)} exportées — ${plural(lignes.length, 'ligne', 'lignes')}`
        + (interimaires ? ` (${plural(interimaires, 'ligne d’intérimaire écartée', 'lignes d’intérimaires écartées')} : déclarées par l’agence)` : ''),
      payload: { du: periode.du, au: periode.au, vue, lignes: lignes.length, interimaires },
    });
    const cles = lignes.map(l => l.cle).join(',');
    if (!declarees && cles.length <= MAX_ENTETE) res.set('X-Passeport-Lignes', cles);
    res.set({ 'X-Passeport-Nombre': String(lignes.length), 'X-Passeport-Interimaires': String(interimaires) });
    fichierJoint(res, 'text/csv; charset=utf-8', x.fichier, texteCsv(x.head, x.rows));
  }));

  return r;
}
