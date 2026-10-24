// Récapitulatif des échéances par e-mail (t034), envoyé par les tâches de fond (`tachesEmails`, server/src/notifications.ts)
// une fois par jour à partir de 7 h, ou un jour de la semaine (Paramètres → Messagerie, réglages `relances*`). Destinataires :
// - la boîte du service RH : tout le périmètre ;
// - chaque manager (adresse de sa fiche) : les membres de son équipe, sans lui-même, sans visite médicale ni vaccination
//   (verdict seul, comme son instantané) ni entretien de reprise (il trahirait un arrêt long), ni titre de séjour, ni
//   échéance d'un salarié mineur (18 ans, dérogation pour travaux réglementés : `sante` de la relance) ; pendant une
//   délégation des entretiens (t135), son suppléant reçoit aussi les entretiens dus des membres dont il décide ;
// - chaque référent HSE (compte actif) : formations et habilitations, et la couverture minimale des équipes calculée
//   comme à son écran, sans les absences hors chantiers (`couvertureVueHse`), sous des clés à part (`hse:couverture:…`).
// Seuls les paliers franchis depuis le dernier envoi partent (table `relances`, clé de l'objet et palier) : un objet n'est
// relancé qu'une fois par palier. Tant que la boîte du service RH, destinataire de tout le périmètre, n'est pas renseignée,
// le passage n'envoie ni ne note rien : les paliers franchis partiront au premier passage qui suit son réglage. Règles et contenu :
// shared/rules/relances.ts ; jamais de donnée de santé ni de texte libre dans l'e-mail (docs/EMAILS.md). La boîte du
// service RH reçoit aussi, sous « Exploitation », l'échéance du secret client Entra (server/src/secret-microsoft.ts).
import { HEURE_RECAPITULATIF } from '../../shared/constants.ts';
import { addD, weekday } from '../../shared/dates.ts';
import { Domain } from '../../shared/domain.ts';
import { equipeLabel, fmtIso, plural } from '../../shared/format.ts';
import { CATEGORIES_HSE, jourDEnvoi, relancesCouverture, relancesDues, titrePalier, type Relance } from '../../shared/rules/relances.ts';
import { delegationEnVigueur, delegationPour } from '../../shared/rules/delegations-manager.ts';
import type { CurrentUser, Employe } from '../../shared/types.ts';
import type { Compte } from './comptes.ts';
import { couvertureVueHse, loadFull, todayIso } from './dataset.ts';
import type { Db } from './db.ts';
import { envoyerEmail } from './integrations/email.ts';
import { adresseSalarie, courriel, lireMessagerie } from './messagerie.ts';
import { relanceSecret, relanceSecretEnvoi } from './secret-microsoft.ts';

/** Lecture du périmètre complet, comme le service RH. */
const SUIVI: CurrentUser = { role: 'rh', empId: null, nom: 'Cursus', intitule: 'Relance des échéances' };

/** Réglage : jour du dernier passage du récapitulatif des échéances (un seul par jour, même après un redémarrage). */
const DERNIERE_RELANCE = 'relancesEcheancesLe';
/** Relances notées gardées 400 jours : au-delà, l'échéance est renouvelée ou le salarié sorti depuis longtemps. */
const CONSERVATION_JOURS = 400;

interface Destinataire { adresse: string; nom: string | null; relances: Relance[] }

/**
 * Texte du récapitulatif : par palier, de l'échéance dépassée à la plus lointaine, une ligne par objet ; puis les lignes
 * d'exploitation (secret client Entra), pour la seule boîte du service RH.
 */
function texteRecapitulatif(d: Domain, relances: Relance[], exploitation: string[] = []): string {
  const ordre = ['echu', ...[...new Set(relances.map(r => r.palier).filter(p => p !== 'echu'))].sort((a, b) => Number(a) - Number(b))];
  const blocs = ordre.filter(p => relances.some(r => r.palier === p)).map(p => [
    `${titrePalier(p)} :`,
    ...relances.filter(r => r.palier === p).map(r => {
      // Couverture minimale d'une équipe : aucun salarié désigné.
      // Manque déjà là : depuis son début (ou « en cours », sans cause datée) ; à venir : à partir de sa date.
      if (r.equipe) return `• Équipe ${r.equipe} — ${r.libelle} : ${r.cle.endsWith(':en-cours') ? 'en cours' : `${r.palier === 'echu' ? 'depuis le' : 'à partir du'} ${fmtIso(r.echeance)}`}`;
      const e = d.emp(r.empId)!;
      return `• ${e.nom} (${equipeLabel(e)}) — ${r.libelle} : ${r.jours < 0 ? 'dépassée depuis le' : 'échéance le'} ${fmtIso(r.echeance)}`;
    }),
  ].join('\n'));
  if (exploitation.length) blocs.push(['Exploitation :', ...exploitation].join('\n'));
  return [
    'Voici les échéances qui viennent d’atteindre un palier de relance :',
    '',
    blocs.join('\n\n'),
    '',
    // Lignes d'exploitation seules : rien à voir dans Cursus, la marche à suivre est dans le guide.
    relances.length || !exploitation.length
      ? 'Chacune n’est rappelée qu’une fois par palier. Le détail et la suite à donner sont dans Cursus (Échéances, Entretiens, Voyages).'
      : 'Chacune n’est rappelée qu’une fois par palier. La marche à suivre est dans le guide docs/CONNEXION-MICROSOFT.md, section 3.',
  ].join('\n');
}

/** Destinataires et ce que chacun reçoit (adresses identiques réunies). */
async function destinataires(db: Db, d: Domain, relances: Relance[], today: string): Promise<Destinataire[]> {
  const out = new Map<string, Destinataire>();
  const ajouter = (adresse: string | null | undefined, nom: string | null, liste: Relance[]) => {
    if (!adresse || !liste.length) return;
    const k = adresse.toLowerCase(), x = out.get(k);
    // Même adresse pour le service RH et un référent HSE : la couverture sous sa clé commune suffit.
    if (x) x.relances = [...new Set([...x.relances, ...liste])].filter((r, _, t) => !r.hse || !t.some(y => !y.hse && `hse:${y.cle}` === r.cle));
    else out.set(k, { adresse, nom, relances: liste });
  };
  // Couverture calculée pour le référent HSE : à lui seul.
  const communes = relances.filter(r => !r.hse);
  ajouter((await lireMessagerie(db)).rh, null, communes);
  // Managers : équipes encadrées par un salarié présent, chacun pour ses membres (lui-même relève de son responsable).
  const managers = new Set(d.ds.referentiels.equipes.map(q => q.managerId).filter((m): m is number => !!m));
  for (const m of managers) {
    const a = await adresseSalarie(db, m, today);
    ajouter(a?.adresse, a?.nom ?? null, communes.filter(r => (r.equipe ? d.teamsOf(m).includes(r.equipe) : !r.sante && r.empId !== m && d.mgrOf(d.emp(r.empId) as Employe) === m
      && !(r.categorie === 'entretien' && r.cle.split(':')[2] === 'reprise'))));
  }
  // Suppléant d'un manager absent (t135), pendant une délégation qui comprend les entretiens : les entretiens dus des
  // membres dont il décide, avec les mêmes exclusions que pour le manager (reprise, santé).
  for (const g of (d.ds.delegations ?? []).filter(x => delegationEnVigueur(x, today))) {
    const a = await adresseSalarie(db, g.suppleantId, today);
    ajouter(a?.adresse, a?.nom ?? null, communes.filter(r => !r.equipe && !r.sante && r.categorie === 'entretien' && r.cle.split(':')[2] !== 'reprise'
      && delegationPour(d.ds, d.emp(r.empId) as Employe, g.suppleantId, today, 'entretiens')?.id === g.id));
  }
  // Référents HSE : formations et habilitations de tous, couverture sans les absences hors chantiers.
  for (const c of (await db.where<Compte>('comptes', 'profilRh', 'referent_hse')).filter(x => x.actif)) {
    const a = c.empId ? await adresseSalarie(db, c.empId, today) : c.adresse ? { adresse: c.adresse, nom: c.nom } : null;
    ajouter(a?.adresse, a?.nom ?? null, relances.filter(r => CATEGORIES_HSE.includes(r.categorie) && (r.categorie !== 'couverture' || r.hse)));
  }
  return [...out.values()];
}

/**
 * Un passage du récapitulatif des échéances : paliers atteints et pas encore relancés, un e-mail par destinataire
 * concerné, paliers notés envoyés. Renvoie le nombre d'e-mails et de relances nouvelles.
 */
export async function recapitulatifEcheances(db: Db): Promise<{ emails: number; relances: number }> {
  // Boîte du service RH non renseignée (mise en service…) : rien n'est noté, rien ne se perd.
  if (!(await lireMessagerie(db)).rh) return { emails: 0, relances: 0 };
  const full = await loadFull(db, SUIVI), d = new Domain(full), today = full.today;
  const paliers = full.settings.relancesPaliers;
  const dues = [
    ...relancesDues(d, d.enrich(full.settings.horizonAlerte, full.settings.uniquementReglementaire), paliers),
    // Couverture du référent HSE, calculée sans les absences hors chantiers qu'il ne reçoit pas (server/src/dataset.ts).
    ...relancesCouverture(d, couvertureVueHse({ ...full, settings: { ...full.settings, horizonAlerte: Math.max(...paliers, 90) } }), paliers, 'hse:'),
  ];
  const deja = new Set((await db.query('SELECT cle, palier FROM relances') as { cle: string; palier: string }[]).map(r => `${r.cle}|${r.palier}`));
  const nouvelles = dues.filter(r => !deja.has(`${r.cle}|${r.palier}`));
  // Secret client Entra : une ligne pour la boîte du service RH, une fois par palier et par date d'expiration.
  // Lot 8 : de même pour le secret propre à l'envoi des e-mails (CURSUS_MAIL_SECRET_EXPIRE).
  type Ligne = NonNullable<ReturnType<typeof relanceSecret>>;
  const exploitation = [relanceSecret(today), relanceSecretEnvoi(today)].filter((r): r is Ligne => !!r && !deja.has(`${r.cle}|${r.palier}`));
  let emails = 0;
  if (nouvelles.length || exploitation.length) {
    const m = await lireMessagerie(db), rh = m.rh!.toLowerCase();
    const liste = await destinataires(db, d, nouvelles, today);
    if (exploitation.length && !liste.some(x => x.adresse.toLowerCase() === rh)) liste.push({ adresse: m.rh!, nom: null, relances: [] });
    for (const x of liste) {
      const siennes = nouvelles.filter(r => x.relances.includes(r));
      const lignes = x.adresse.toLowerCase() === rh ? exploitation.map(r => r.texte) : [];
      const n = siennes.length + lignes.length;
      const e = await envoyerEmail(db, 'echeances.recapitulatif', courriel(m, x.adresse, `Cursus — échéances à traiter : ${plural(n, 'nouvelle relance', 'nouvelles relances')}`, texteRecapitulatif(d, siennes, lignes), { nom: x.nom }));
      if (e) emails++;
    }
    for (const r of [...nouvelles, ...exploitation]) await db.insert('relances', { cle: r.cle, palier: r.palier, le: today });
  }
  await db.run('DELETE FROM relances WHERE le < ?', [addD(today, -CONSERVATION_JOURS)]);
  return { emails, relances: nouvelles.length + exploitation.length };
}

/**
 * Tâche de fond (appelée par `tachesEmails`, dans sa transaction) : à partir de 7 h, une fois par jour, le jour réglé,
 * si le récapitulatif est actif. Null : rien à faire à ce passage.
 */
export async function relancerEcheances(db: Db, heure: number): Promise<{ emails: number; relances: number } | null> {
  const jour = todayIso();
  if (heure < HEURE_RECAPITULATIF || await db.getSetting<string | null>(DERNIERE_RELANCE, null) === jour) return null;
  const s = (await loadFull(db, SUIVI)).settings;
  await db.setSetting(DERNIERE_RELANCE, jour);
  if (!s.relancesActives || !jourDEnvoi(s, weekday(jour))) return null;
  return await recapitulatifEcheances(db);
}
