// Notifications et convocations par e-mail.
// - Étapes de validation (demande de congés, décision, feuille soumise ou renvoyée, entretien clos, décision sur
//   une demande au service RH) : envoyées au destinataire aussitôt, ou regroupées dans son récapitulatif quotidien
//   selon son réglage (fiche du salarié ; Paramètres → Messagerie pour le service RH). Rien n'est envoyé à la
//   personne qui fait l'action, ni à un salarié sans adresse ou sorti de l'entreprise.
// - Convocations (formation, entretien) : toujours aussitôt, avec le fichier .ics de l'événement.
// Tout passe par la file d'envoi, dans la transaction de l'action (server/src/integrations/email.ts).
import { ENT_TYPES, HEURE_RECAPITULATIF, MOTIFS_VISITE } from '../../shared/constants.ts';
import { addD, isoWeek, parse } from '../../shared/dates.ts';
import { type Domain, sessionActive } from '../../shared/domain.ts';
import { equipeLabel, fmt, fmtIso, plural } from '../../shared/format.ts';
import { matriculeAffiche } from '../../shared/rules/matricules.ts';
import { demiTexte } from '../../shared/rules/demi-journees.ts';
import { convocationEnvoyee } from '../../shared/rules/sessions.ts';
import type { Absence, Certification, CurrentUser, Dataset, DemandeCollab, DemandeVisite, Employe, Entretien, Messagerie, Session } from '../../shared/types.ts';
import { configMail } from './config.ts';
import { todayIso } from './dataset.ts';
import type { Db } from './db.ts';
import { calendrier, domaineAgenda, envoyerEmail, pieceJointe, type EvenementAgenda } from './integrations/email.ts';
import { adresseSalarie, courriel, jourLong, lireMessagerie, periodeLongue } from './messagerie.ts';
import { relevesAutomatiques } from './releves.ts';
import { relancerEcheances } from './relances.ts';

/** Ce dont une notification a besoin du contexte d'une action. */
type Contexte = { db: Db; ds: Dataset; user: CurrentUser };

export interface Notification { type: string; objet: string; texte: string }

/** Le destinataire est-il la personne qui agit ? (0 : le service RH, comme `Domain.mgrOf`.) */
const soiMeme = (user: CurrentUser, dest: number) => dest === 0 ? user.role === 'rh' : user.role !== 'rh' && user.empId === dest;

const messagerie = (cx: Contexte): Messagerie => cx.ds.messagerie ?? lireMessagerie(cx.db);

/**
 * Notifie un salarié (`dest` : son identifiant) ou le service RH (`dest` = 0) : e-mail aussitôt, ou notification
 * gardée pour le récapitulatif quotidien. Renvoie le mode retenu, ou null si rien n'est envoyé.
 */
export function notifier(cx: Contexte, dest: number, n: Notification): 'immediat' | 'quotidien' | null {
  if (soiMeme(cx.user, dest)) return null;
  const m = messagerie(cx);
  const d = dest === 0 ? (m.rh ? { nom: null, adresse: m.rh, mode: m.rhMode } : null) : adresseSalarie(cx.db, dest, cx.ds.today);
  if (!d) return null;
  if (d.mode === 'quotidien') {
    cx.db.insert('notifications', { empId: dest || null, adresse: d.adresse, type: n.type, objet: n.objet, texte: n.texte, creation: new Date().toISOString(), envoiId: null });
    return 'quotidien';
  }
  envoyerEmail(cx.db, n.type, courriel(m, d.adresse, n.objet, n.texte, { nom: d.nom }));
  return 'immediat';
}

/** Auteur d'une décision, tel qu'il est nommé au destinataire. */
const auteur = (user: CurrentUser) => user.role === 'rh' ? 'le service RH' : user.nom;
const CONGE: Record<string, { objet: string; texte: string }> = {
  CP: { objet: 'congés payés', texte: 'des congés payés' }, RTT: { objet: 'RTT / repos', texte: 'des jours de RTT / repos' }, RECUP: { objet: 'récupération', texte: 'une récupération' },
};
/** Seuls les congés (CP, RTT, récupération) font l'objet d'une demande : toute autre nature reste « absence ». */
const conge = (t: string) => (Object.hasOwn(CONGE, t) ? CONGE[t] : { objet: 'absence', texte: 'une absence' });
const semaineTexte = (week: string) => `semaine ${isoWeek(week)} (${periodeLongue(week, addD(week, 6))})`;

// — Étapes de validation —

/** Demande de congés : au valideur (manager direct, sinon le service RH). */
/** Demi-journées d'un congé dans un e-mail : « (après-midi le premier jour) », vide pour des journées entières. */
const demiCourriel = (a: Pick<Absence, 'du' | 'au' | 'debutDemi' | 'finDemi'>) => { const t = demiTexte(a); return t ? ` (${t})` : ''; };

export function notifierDemandeConge(cx: Contexte, emp: Employe, a: Pick<Absence, 'type' | 'du' | 'au' | 'debutDemi' | 'finDemi'>, valideur: number) {
  const c = conge(a.type);
  return notifier(cx, valideur, {
    type: 'absence.demande', objet: `Demande de ${c.objet} à valider — ${emp.nom}`,
    texte: `${emp.nom} demande ${c.texte} ${periodeLongue(a.du, a.au)}${demiCourriel(a)}. La demande attend votre décision (Congés & absences).`,
  });
}

/** Décision sur une demande de congés, ou congés posés et validés par le manager : au salarié. */
export function notifierDecisionConge(cx: Contexte, emp: Employe, a: Pick<Absence, 'type' | 'du' | 'au' | 'debutDemi' | 'finDemi'>, ok: boolean, posee = false) {
  const c = conge(a.type);
  const objet = posee ? `Congés posés pour vous : ${c.objet}` : `Demande de ${c.objet} ${ok ? 'validée' : 'refusée'}`;
  const texte = posee
    ? `${auteur(cx.user)} a posé et validé pour vous ${c.texte} ${periodeLongue(a.du, a.au)}${demiCourriel(a)}.`
    : `Votre demande de ${c.objet} ${periodeLongue(a.du, a.au)}${demiCourriel(a)} a été ${ok ? 'validée' : 'refusée'} par ${auteur(cx.user)}.`;
  return notifier(cx, emp.id, { type: 'absence.decision', objet, texte });
}

/** Feuille de temps soumise : au valideur. */
export function notifierFeuilleSoumise(cx: Contexte, emp: Employe, week: string, valideur: number) {
  const par = cx.user.role !== 'rh' && cx.user.empId === emp.id ? `${emp.nom} a soumis sa feuille de temps` : `La feuille de temps de ${emp.nom} a été soumise`;
  return notifier(cx, valideur, {
    type: 'temps.soumise', objet: `Feuille de temps à valider — ${emp.nom}, semaine ${isoWeek(week)}`,
    texte: `${par} pour la ${semaineTexte(week)}. Elle attend votre validation (Temps de travail).`,
  });
}

/** Feuille de temps renvoyée au salarié, par son valideur ou après l'annulation d'une absence (`auto`). */
export function notifierFeuilleRenvoyee(cx: Contexte, emp: Employe, week: string, auto = false) {
  return notifier(cx, emp.id, {
    type: 'temps.renvoyee', objet: `Feuille de temps de la semaine ${isoWeek(week)} à corriger`,
    texte: auto
      ? `Votre feuille de temps de la ${semaineTexte(week)} vous est renvoyée : l’absence qui couvrait la semaine a été annulée ou raccourcie. Saisissez les heures travaillées, puis soumettez-la de nouveau.`
      : `Votre feuille de temps de la ${semaineTexte(week)} vous est renvoyée pour correction par ${auteur(cx.user)}. Le commentaire est à lire dans Cursus (Temps de travail).`,
  });
}

/** Feuille en retard d'une relance (temps.relancer) : semaine et état, jamais d'heure ni de commentaire. */
/** « Relance du service RH. » ou « Relance de Karim Haddad. » (auteur() donnerait « de le service RH »). */
const relancePar = (user: CurrentUser) => `Relance ${user.role === 'rh' ? 'du service RH' : `de ${user.nom}`}.`;

export interface FeuilleARelancer { week: string; etat: 'absente' | 'brouillon' | 'a_corriger' }
const ETAT_RELANCE = { absente: 'non saisie', brouillon: 'en brouillon, pas encore soumise', a_corriger: 'renvoyée pour correction' } as const;

/** Relance des feuilles de temps en retard (suivi des feuilles) : au salarié, semaine par semaine. */
export function notifierRelanceFeuilles(cx: Contexte, emp: Employe, feuilles: FeuilleARelancer[]) {
  const plus = feuilles.length > 1;
  return notifier(cx, emp.id, {
    type: 'temps.relance',
    objet: `${plus ? 'Feuilles' : 'Feuille'} de temps à ${feuilles.every(f => f.etat === 'a_corriger') ? 'corriger' : 'saisir'} — ${plus ? 'semaines' : 'semaine'} ${feuilles.map(f => isoWeek(f.week)).join(', ')}`,
    texte: `${plus ? 'Vos feuilles de temps ne sont' : 'Votre feuille de temps n’est'} pas encore ${plus ? 'soumises' : 'soumise'} :\n`
      + feuilles.map(f => `- ${semaineTexte(f.week)} : ${ETAT_RELANCE[f.etat]}`).join('\n')
      + `\nSaisissez vos heures et soumettez ${plus ? 'chaque feuille' : 'la feuille'} dans Cursus (Temps de travail) : les heures partent à la paie une fois validées. ${relancePar(cx.user)}`,
  });
}

/** Relance des feuilles de temps en retard : à leur valideur (manager direct, sinon le service RH), membre par membre. */
export function notifierRelanceValideur(cx: Contexte, valideur: number, retards: { emp: Employe; feuilles: FeuilleARelancer[] }[]) {
  const n = retards.reduce((k, r) => k + r.feuilles.length, 0);
  return notifier(cx, valideur, {
    type: 'temps.relance', objet: `${plural(n, 'feuille de temps en retard', 'feuilles de temps en retard')} — ${plural(retards.length, 'collaborateur', 'collaborateurs')}`,
    texte: `Ces feuilles de temps ne sont pas encore soumises ; ${retards.length > 1 ? 'chaque collaborateur a été relancé' : 'le collaborateur a été relancé'} :\n`
      + retards.map(r => `- ${r.emp.nom} : ${r.feuilles.map(f => `semaine ${isoWeek(f.week)} (${ETAT_RELANCE[f.etat]})`).join(', ')}`).join('\n')
      + `\nElles sont à valider ensuite dans Cursus (Temps de travail), avant l’envoi des heures à la paie. ${relancePar(cx.user)}`,
  });
}

const nomEntretien = (x: Pick<Entretien, 'type'>) => { const n = ENT_TYPES[x.type]?.nom ?? 'Entretien'; return n.charAt(0).toLowerCase() + n.slice(1); };

/** Compte rendu clos par l'évaluateur : au salarié, pour relecture et signature. */
export function notifierEntretienClos(cx: Contexte, emp: Employe, x: Pick<Entretien, 'type' | 'date'>) {
  return notifier(cx, emp.id, {
    type: 'entretien.clos', objet: 'Compte rendu d’entretien à signer',
    texte: `Le compte rendu de votre ${nomEntretien(x)} ${periodeLongue(x.date, x.date)} a été clos et signé par ${auteur(cx.user)}. Relisez-le, complétez vos sections et signez-le (Entretiens).`,
  });
}

/** Intitulé d'une demande au service RH, sans texte libre ni contenu d'un document déclaré. */
function intituleDemande(cx: Contexte, r: DemandeCollab): string {
  if (r.type === 'formation') {
    const fm = r.f ? cx.ds.referentiels.formations.find(f => f.id === r.f) : null;
    return fm ? `demande de formation « ${fm.nom} »` : 'demande de formation hors catalogue';
  }
  if (r.type === 'habilitation') return `demande d’habilitation « ${cx.ds.referentiels.habilitations.find(h => h.id === r.h)?.nom ?? r.h} »`;
  return 'déclaration de document de voyage';
}

/**
 * Décision du service RH sur une demande : au salarié (sauf s'il vient de recevoir sa convocation, qui en tient
 * lieu) et au manager qui l'a émise pour lui.
 */
export function notifierDecisionDemande(cx: Contexte, emp: Employe, r: DemandeCollab, ok: boolean, convoque = false) {
  const intitule = intituleDemande(cx, r), etat = ok ? (r.type === 'document' ? 'validée' : 'acceptée') : 'refusée';
  const quand = `du ${fmt(parse(r.date))}`;
  const objet = `${intitule.charAt(0).toUpperCase()}${intitule.slice(1)} ${etat}`;
  if (!convoque) notifier(cx, emp.id, { type: 'demande.reponse', objet, texte: `Votre ${intitule} ${quand} a été ${etat} par le service RH. La réponse est à lire dans Cursus.` });
  if (r.parId && r.parId !== emp.id) {
    notifier(cx, r.parId, { type: 'demande.reponse', objet: `${objet} — ${emp.nom}`, texte: `La ${intitule} que vous avez faite ${quand} pour ${emp.nom} a été ${etat} par le service RH.` });
  }
}

// — Convocations (aussitôt, avec le fichier .ics) —

/**
 * Organisateur des événements .ics (exigé par les agendas pour une publication ou une annulation) : la boîte
 * d'envoi de Cursus, à défaut (simulation) la boîte du service RH.
 */
function organisateur(cx: Contexte): EvenementAgenda['organisateur'] {
  const from = configMail()?.from;
  if (from) return { nom: 'Cursus', adresse: from };
  const rh = messagerie(cx).rh;
  return rh ? { nom: 'Service RH', adresse: rh } : null;
}

/** Convocation à une session de formation. Renvoie faux si le salarié n'a pas d'adresse (convocation à remettre). */
export function convoquerFormation(cx: Contexte, s: Session, emp: Pick<Employe, 'id' | 'nom'>, parcours: 'recyclage' | 'initiale'): boolean {
  const d = adresseSalarie(cx.db, emp.id, cx.ds.today);
  if (!d) return false;
  const fm = cx.ds.referentiels.formations.find(f => f.id === s.formation);
  const nom = fm?.nom ?? s.formation;
  // Session « à confirmer » par l'organisme : événement provisoire dans l'agenda.
  const ics = calendrier({
    uid: `formation-${s.id}-${emp.id}@${domaineAgenda()}`, date: s.date, titre: `Formation : ${nom}`, lieu: s.lieu,
    description: [fm?.organisme && `Organisme : ${fm.organisme}`, fm?.duree && `Durée : ${fm.duree}`].filter(Boolean).join(' · '),
    provisoire: s.statut === 'À confirmer', organisateur: organisateur(cx),
  });
  envoyerEmail(cx.db, 'convocation', courriel(messagerie(cx), d.adresse, `Convocation : ${nom} — ${fmt(parse(s.date))}`, [
    `Votre inscription à la formation « ${nom} »${parcours === 'recyclage' ? ' (recyclage)' : ''} est confirmée :`,
    '',
    `Date : ${jourLong(s.date)}${s.statut === 'À confirmer' ? ' (date à confirmer par l’organisme)' : ''}`,
    `Lieu : ${s.lieu}`,
    ...(fm?.organisme ? [`Organisme : ${fm.organisme}`] : []),
    ...(fm?.duree ? [`Durée : ${fm.duree}`] : []),
    '',
    'Ouvrez le fichier joint pour ajouter la session à votre agenda. Cette convocation remplace toute convocation précédente pour cette session.',
    'En cas d’empêchement, prévenez au plus tôt votre manager et le service RH.',
  ].join('\n'), { nom: emp.nom, pj: [pieceJointe(`convocation-${s.date}.ics`, 'text/calendar; charset=utf-8; method=PUBLISH', ics)] }));
  return true;
}

/** Convocation à une session annulée, ou désinscription : l'événement est retiré de l'agenda. */
export function annulerConvocationFormation(cx: Contexte, s: Session, emp: Pick<Employe, 'id' | 'nom'>, raison: 'desinscription' | 'annulation'): boolean {
  const d = adresseSalarie(cx.db, emp.id, cx.ds.today);
  if (!d) return false;
  const nom = cx.ds.referentiels.formations.find(f => f.id === s.formation)?.nom ?? s.formation;
  const ics = calendrier({ uid: `formation-${s.id}-${emp.id}@${domaineAgenda()}`, date: s.date, titre: `Formation : ${nom}`, lieu: s.lieu, annule: true, organisateur: organisateur(cx) });
  const texte = raison === 'annulation'
    ? `La session de la formation « ${nom} » ${periodeLongue(s.date, s.date)} est annulée : votre convocation ne vaut plus. Le service RH vous inscrira à une prochaine session.`
    : `Votre inscription à la session de la formation « ${nom} » ${periodeLongue(s.date, s.date)} est annulée : votre convocation ne vaut plus.`;
  envoyerEmail(cx.db, 'convocation.annulee', courriel(messagerie(cx), d.adresse, `Annulation : ${nom} — ${fmt(parse(s.date))}`,
    `${texte}\n\nOuvrez le fichier joint pour retirer l’événement de votre agenda, ou supprimez-le vous-même.`,
    { nom: emp.nom, pj: [pieceJointe(`annulation-${s.date}.ics`, 'text/calendar; charset=utf-8; method=CANCEL', ics)] }));
  return true;
}

/**
 * Inscrit qui quitte une session ouverte et à venir (désinscription, changement de session, recyclage enregistré
 * entre-temps, session annulée) : la convocation qu'il a reçue, même remise « à renvoyer » par un changement de
 * date ou de lieu, est annulée par e-mail. Renvoie vrai si l'annulation part.
 */
export function annulerSiConvoque(
  cx: Contexte, s: Session | null | undefined, emp: Pick<Employe, 'id' | 'nom'>, x: Pick<Certification, 'convoc' | 'convocLe'>, raison: 'desinscription' | 'annulation' = 'desinscription',
): boolean {
  if (!s || !sessionActive(s) || s.date < cx.ds.today || !convocationEnvoyee(x)) return false;
  return annulerConvocationFormation(cx, s, emp, raison);
}

/** Convocation à un entretien planifié : au salarié, avec le fichier .ics. Faux s'il n'a pas d'adresse. */
export function convoquerEntretien(cx: Contexte, emp: Pick<Employe, 'id' | 'nom'>, x: Pick<Entretien, 'id' | 'type' | 'date'>): boolean {
  const d = adresseSalarie(cx.db, emp.id, cx.ds.today);
  if (!d) return false;
  const nom = nomEntretien(x);
  const ics = calendrier({
    uid: `entretien-${x.id}@${domaineAgenda()}`, date: x.date, titre: ENT_TYPES[x.type]?.nom ?? 'Entretien', description: 'Préparation et compte rendu dans Cursus (Entretiens).',
    organisateur: organisateur(cx),
  });
  envoyerEmail(cx.db, 'entretien.convocation', courriel(messagerie(cx), d.adresse, `Convocation : ${nom} — ${fmt(parse(x.date))}`, [
    `${auteur(cx.user) === 'le service RH' ? 'Le service RH' : auteur(cx.user)} vous convoque à un ${nom} ${periodeLongue(x.date, x.date)}.`,
    '',
    'Vous pouvez préparer vos sections du compte rendu dans Cursus (Entretiens). Ouvrez le fichier joint pour ajouter l’entretien à votre agenda.',
  ].join('\n'), { nom: emp.nom, pj: [pieceJointe(`entretien-${x.date}.ics`, 'text/calendar; charset=utf-8; method=PUBLISH', ics)] }));
  return true;
}

/**
 * Entretien planifié annulé (`entretien.annuler`) : le salarié reçoit l'annulation de l'événement d'agenda de sa
 * convocation (même UID `entretien-<id>`, méthode CANCEL). Faux s'il n'a pas d'adresse (à prévenir de vive voix).
 */
export function annulerConvocationEntretien(cx: Contexte, emp: Pick<Employe, 'id' | 'nom'>, x: Pick<Entretien, 'id' | 'type' | 'date'>): boolean {
  const d = adresseSalarie(cx.db, emp.id, cx.ds.today);
  if (!d) return false;
  const nom = nomEntretien(x);
  const ics = calendrier({ uid: `entretien-${x.id}@${domaineAgenda()}`, date: x.date, titre: ENT_TYPES[x.type]?.nom ?? 'Entretien', annule: true, organisateur: organisateur(cx) });
  envoyerEmail(cx.db, 'convocation.annulee', courriel(messagerie(cx), d.adresse, `Annulation : ${nom} — ${fmt(parse(x.date))}`,
    `Votre ${nom} ${periodeLongue(x.date, x.date)} est annulé par ${auteur(cx.user)} : votre convocation ne vaut plus. Une nouvelle date vous sera proposée s’il y a lieu.\n\nOuvrez le fichier joint pour retirer l’événement de votre agenda, ou supprimez-le vous-même.`,
    { nom: emp.nom, pj: [pieceJointe(`annulation-entretien-${x.date}.ics`, 'text/calendar; charset=utf-8; method=CANCEL', ics)] }));
  return true;
}

/**
 * Demande de visite médicale adressée au service de prévention et de santé au travail (Paramètres → Messagerie) :
 * le contenu de la demande imprimable, sans aucune information médicale. Renvoie faux sans adresse : la demande est
 * alors à imprimer et à transmettre par le service RH.
 */
export function transmettreDemandeVisite(cx: Contexte & { d: Domain }, emp: Employe, x: Pick<DemandeVisite, 'motif' | 'le' | 'par'>): boolean {
  const m = messagerie(cx);
  if (!m.santeTravail) return false;
  const motif = MOTIFS_VISITE[x.motif];
  const habs = emp.habs.filter(h => h.delivree && h.mesure !== 'retrait' && cx.d.hm(h.h)?.medical).map(h => cx.d.hm(h.h).nom);
  envoyerEmail(cx.db, 'visite.demande', courriel(m, m.santeTravail, `Demande de visite médicale — ${emp.nom}`, [
    'Le service RH vous demande de convoquer le salarié ci-dessous à une visite médicale.',
    '',
    `Salarié : ${emp.nom} (matricule ${matriculeAffiche(emp)}), né en ${emp.naissance}`,
    `Poste : ${emp.poste} — équipe ${equipeLabel(emp)}`,
    `Contrat : ${cx.d.contratOf(emp).libelle}, depuis le ${fmtIso(emp.entree)}`,
    '',
    `Visite demandée : ${motif.label} (${motif.article} du Code du travail)`,
    `Demandée le ${fmtIso(x.le)} par ${x.par}, service RH`,
    `Dernière visite enregistrée : ${emp.visite ? fmtIso(emp.visite) : 'aucune'}`,
    ...(habs.length ? [`Habilitations du poste qui exigent l’aptitude médicale : ${habs.join(', ')}`] : []),
    '',
    'Merci d’adresser l’avis d’aptitude au service RH, qui l’enregistre dans Cursus. Cette demande ne contient aucune information médicale.',
  ].join('\n')));
  return true;
}

// — Récapitulatif quotidien —

interface EnAttente { id: number; empId: number | null; adresse: string; type: string; objet: string; texte: string }

/** Notifications en attente du prochain récapitulatif. */
export const recapitulatifEnAttente = (db: Db): number =>
  Number((db.sql.prepare('SELECT COUNT(*) AS n FROM notifications WHERE envoi_id IS NULL').get() as { n: number }).n);

/**
 * Un e-mail par destinataire avec ses notifications en attente, dans l'ordre d'arrivée, à son adresse du moment
 * (fiche, ou boîte du service RH) : une adresse corrigée depuis la notification est suivie. Destinataire sans
 * adresse ou sorti de l'entreprise : ses notifications sont closes sans envoi. Renvoie le nombre d'e-mails.
 */
export function envoyerRecapitulatifs(db: Db): number {
  const items = (db.sql.prepare('SELECT id FROM notifications WHERE envoi_id IS NULL ORDER BY id').all() as { id: number }[])
    .map(r => db.get<EnAttente>('notifications', r.id)!);
  if (!items.length) return 0;
  const m = lireMessagerie(db), today = todayIso();
  // Par destinataire : le salarié, ou le service RH (0).
  const parDestinataire = new Map<number, EnAttente[]>();
  items.forEach(n => parDestinataire.set(n.empId ?? 0, [...(parDestinataire.get(n.empId ?? 0) ?? []), n]));
  let emails = 0;
  for (const [dest, liste] of parDestinataire) {
    const d = dest ? adresseSalarie(db, dest, today) : m.rh ? { nom: null, adresse: m.rh } : null;
    const texte = [
      'Voici les notifications de Cursus depuis votre dernier récapitulatif :',
      ...liste.map(n => `\n• ${n.objet}\n  ${n.texte.replace(/\n/g, '\n  ')}`),
      '\nDétail et suite à donner dans Cursus.',
    ].join('\n');
    const e = d && envoyerEmail(db, 'recapitulatif', courriel(m, d.adresse, `Cursus — récapitulatif du ${fmt(parse(today))} : ${plural(liste.length, 'notification', 'notifications')}`, texte, { nom: d.nom }));
    if (e) emails++;
    liste.forEach(n => db.update('notifications', n.id, { envoiId: e ? e.id : 0 }));
  }
  return emails;
}

/** Réglage : date du dernier récapitulatif quotidien envoyé. */
const DERNIER_RECAPITULATIF = 'recapitulatifLe';

/**
 * Un passage des tâches de fond des e-mails, dans une transaction : relevés d'heures des intérimaires dont toutes
 * les feuilles sont validées, puis, à partir de 7 h (`heure` : heure locale), le récapitulatif quotidien, une fois
 * par jour (réglage `recapitulatifLe`, gardé en base : un redémarrage ne le renvoie pas). Renvoie le nombre de
 * relevés et de récapitulatifs mis en file (null : pas l'heure, ou déjà fait aujourd'hui).
 */
export function tachesEmails(db: Db, heure = new Date().getHours()): { releves: number; recapitulatifs: number | null } {
  return db.tx(() => {
    const releves = relevesAutomatiques(db).length;
    // Récapitulatif des échéances par paliers (server/src/relances.ts) : sa propre date de passage, son propre réglage.
    relancerEcheances(db, heure);
    const jour = todayIso();
    if (heure < HEURE_RECAPITULATIF || db.getSetting<string | null>(DERNIER_RECAPITULATIF, null) === jour) return { releves, recapitulatifs: null };
    const recapitulatifs = envoyerRecapitulatifs(db);
    db.setSetting(DERNIER_RECAPITULATIF, jour);
    return { releves, recapitulatifs };
  });
}

/** Tâches de fond des e-mails (`tachesEmails`), au démarrage puis tous les quarts d'heure. */
export function planifierEmails(db: Db, intervalle = 15 * 60_000): () => void {
  const relever = () => {
    try {
      tachesEmails(db);
    } catch (err) {
      console.error('E-mails planifiés :', err);
    }
  };
  relever();
  const timer = setInterval(relever, intervalle);
  timer.unref();
  return () => clearInterval(timer);
}
