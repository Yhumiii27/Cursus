// Paramètres → Messagerie (service RH) : mode d'envoi des e-mails (Microsoft 365 ou simulation), adresses du
// service RH, du service de santé au travail et des agences d'intérim (administrateur RH), salariés sans adresse,
// notifications en attente du récapitulatif quotidien, e-mail d'essai pour la mise en service (docs/EMAILS.md).
import { useEffect, useMemo, useState } from 'react';
import { EnvelopeSimpleIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { HEURE_RECAPITULATIF, MODE_NOTIFICATION_LABEL } from '../../../shared/constants.ts';
import { key, plural } from '../../../shared/format.ts';
import { MESSAGERIE_VIDE, agencesInterim, normaliserAdresse } from '../../../shared/rules/messagerie.ts';
import type { ModeNotification } from '../../../shared/types.ts';
import type { EnvoisState } from '../api.ts';
import { Field } from '../components/Dialog.tsx';
import { Btn, Fine, Panel, SectionLabel, Seg, Tag } from '../components/ui.tsx';
import { useRole } from '../state/derived.ts';
import { useData, useStore } from '../state/store.tsx';

const MODES = Object.entries(MODE_NOTIFICATION_LABEL) as [ModeNotification, string][];

/** État de la messagerie : simulation, échecs en cours, envoi en reprise, ou à jour. */
function MessagerieTag({ etat }: { etat: EnvoisState['email'] | null }) {
  if (!etat) return null;
  if (etat.mode !== 'api') return <Tag cls="tag-outline">Simulation</Tag>;
  if (etat.echecsEnCours) return <Tag cls="tag-accent">{plural(etat.echecsEnCours, 'e-mail en échec', 'e-mails en échec')}</Tag>;
  if (etat.enReprise) return <Tag cls="tag-accent">Microsoft 365 ne répond pas</Tag>;
  return <Tag cls="tag-neutral">Microsoft 365</Tag>;
}

interface Form { rh: string; rhMode: ModeNotification; santeTravail: string; agences: Record<string, string> }

export function MessageriePanel({ etat, reload }: { etat: EnvoisState['email'] | null; reload: () => void }) {
  const data = useData();
  const { admin } = useRole();
  const { run } = useStore();
  const m = data.messagerie ?? MESSAGERIE_VIDE;
  // Agences citées par les fiches des intérimaires, et celles déjà réglées (fiche modifiée depuis).
  const agences = useMemo(() => {
    const noms = agencesInterim(data.employes);
    m.agences.forEach(a => { if (!noms.some(n => key(n) === key(a.nom))) noms.push(a.nom); });
    return noms;
  }, [data.employes, m.agences]);
  const initial = useMemo<Form>(() => ({
    rh: m.rh ?? '', rhMode: m.rhMode, santeTravail: m.santeTravail ?? '',
    agences: Object.fromEntries(agences.map(nom => [nom, m.agences.find(a => key(a.nom) === key(nom))?.adresse ?? ''])),
  }), [m, agences]);
  const [f, setF] = useState<Form>(initial);
  // Valeurs en vigueur changées (adresses enregistrées, fiche d'un intérimaire modifiée) : le formulaire en repart.
  const enVigueur = JSON.stringify(initial);
  useEffect(() => setF(JSON.parse(enVigueur) as Form), [enVigueur]);
  const [essai, setEssai] = useState('');
  const [busy, setBusy] = useState(false);

  const dirty = JSON.stringify(f) !== enVigueur;
  const sansAdresse = data.employes.filter(e => !e.email && !(e.fin && e.fin < data.today)).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  const agir = async (name: string, payload: Record<string, unknown> = {}) => {
    setBusy(true);
    const r = await run(name, payload);
    setBusy(false);
    if (r.ok) reload();
    return r;
  };
  const enregistrer = () => agir('messagerie.regler', {
    rh: f.rh, rhMode: f.rhMode, santeTravail: f.santeTravail,
    agences: Object.entries(f.agences).map(([nom, adresse]) => ({ nom, adresse })),
  });
  const envoyerEssai = async () => { if ((await agir('messagerie.essai', { adresse: essai })).ok) setEssai(''); };

  return (
    <Panel title="Messagerie" aside={<MessagerieTag etat={etat} />} style={{ gap: 'var(--space-4)' }}>
      <Fine>
        {etat?.mode === 'api'
          ? `E-mails envoyés par Microsoft 365 depuis ${etat.expediteur} : notifications des étapes de validation, convocations (avec leur fichier .ics), relevés d’heures des agences d’intérim. Chacun passe par la file d’envoi, suivie ci-dessous (Envois).`
          : 'Mode simulation (CURSUS_MAIL_FROM non définie) : aucun e-mail ne part. Chacun est tracé dans le journal et visible dans Envois, marqué « simulé ». Mise en service par le service informatique : docs/EMAILS.md.'}
      </Fine>
      <Fine>Les e-mails ne contiennent ni donnée de santé, ni motif d’absence médical, ni numéro de passeport, ni les commentaires saisis dans Cursus : ils renvoient à Cursus pour le détail.</Fine>

      <div className="grid-2">
        <Field label="Service RH" htmlFor="msg-rh">
          <input className="input" id="msg-rh" type="email" placeholder="rh@entreprise.fr" value={f.rh} disabled={!admin} onChange={e => setF({ ...f, rh: e.target.value })} />
          <span className="text-muted sub">Valideur des salariés sans manager ; les réponses aux e-mails lui parviennent</span>
        </Field>
        <Field label="Notifications du service RH">
          <Seg name="msg-rh-mode" label="Notifications du service RH" value={f.rhMode} options={MODES} disabled={!admin} onChange={v => setF({ ...f, rhMode: v })} style={{ flexWrap: 'wrap' }} />
        </Field>
        <Field label="Service de santé au travail" htmlFor="msg-sante">
          <input className="input" id="msg-sante" type="email" placeholder="contact@sante-travail.fr" value={f.santeTravail} disabled={!admin} onChange={e => setF({ ...f, santeTravail: e.target.value })} />
        </Field>
      </div>

      <SectionLabel>Agences d’intérim</SectionLabel>
      {agences.length ? (
        <div className="grid-2" style={{ marginTop: 'calc(-1 * var(--space-2))' }}>
          {agences.map((nom, i) => (
            <Field key={nom} label={nom} htmlFor={`msg-agence-${i}`}>
              <input className="input" id={`msg-agence-${i}`} type="email" placeholder="releves@agence.fr" value={f.agences[nom] ?? ''} disabled={!admin}
                onChange={e => setF({ ...f, agences: { ...f.agences, [nom]: e.target.value } })} />
            </Field>
          ))}
        </div>
      ) : <Fine>Aucun intérimaire : l’agence se saisit sur la fiche de l’intérimaire.</Fine>}
      <Fine>Le relevé hebdomadaire des heures validées de leurs intérimaires (CSV joint) part à cette adresse dès que toutes les feuilles de la semaine sont validées ; le service RH le suit et le renvoie depuis Temps de travail.</Fine>
      {admin && (
        <div className="actions-end">
          <Btn variant="primary" disabled={!dirty || busy} onClick={enregistrer}>Enregistrer les adresses</Btn>
        </div>
      )}

      <SectionLabel>Destinataires</SectionLabel>
      <Fine muted={!sansAdresse.length}>
        {sansAdresse.length
          ? `${plural(sansAdresse.length, 'salarié sans adresse e-mail', 'salariés sans adresse e-mail')} (fiche à compléter) : ${sansAdresse.slice(0, 8).map(e => e.nom).join(', ')}${sansAdresse.length > 8 ? '…' : ''}. Ses convocations sont à remettre en main propre.`
          : 'Chaque salarié a une adresse e-mail professionnelle sur sa fiche.'}
      </Fine>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <span className="text-muted sub">
          {etat ? `${plural(etat.recapitulatif, 'notification en attente', 'notifications en attente')} du récapitulatif quotidien (chaque jour à partir de ${HEURE_RECAPITULATIF} h)` : 'Récapitulatif quotidien : chargement…'}
        </span>
        <Btn small icon={<PaperPlaneTiltIcon size={14} />} disabled={!etat?.recapitulatif || busy} onClick={() => agir('messagerie.recapituler')}>Envoyer maintenant</Btn>
      </div>

      {admin && <>
        <SectionLabel>E-mail d’essai</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <input className="input" type="email" aria-label="Adresse du destinataire de l’e-mail d’essai" placeholder="prenom.nom@entreprise.fr" value={essai}
            onChange={e => setEssai(e.target.value)} style={{ flex: '1 1 220px', width: 'auto' }} />
          <Btn icon={<EnvelopeSimpleIcon size={14} />} disabled={!normaliserAdresse(essai) || busy} onClick={envoyerEssai}>Envoyer un e-mail d’essai</Btn>
        </div>
        <Fine>Mise en service : l’e-mail d’essai part de la boîte d’envoi ; son suivi (accusé de Microsoft 365 ou erreur) figure dans Envois.</Fine>
      </>}
    </Panel>
  );
}
