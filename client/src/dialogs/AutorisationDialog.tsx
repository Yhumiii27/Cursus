// Titre de séjour valant autorisation de travail (service RH) : non requise (ressortissant français, de l'UE, de l'EEE ou
// de la Suisse), ou titre { type, numéro, expiration, vérification en préfecture }, sans copie du document (GED à venir).
// Contrôles partagés avec le serveur (`validerAutorisation` de shared/rules/contrats.ts) ; information du salarié (art. 13
// du RGPD) affichée avant l'enregistrement, sur le modèle des vaccinations.
import { useState } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { INFO_TITRE_SEJOUR, joursOuvrablesAvant, TYPES_TITRE_SEJOUR, validerAutorisation } from '../../../shared/rules/contrats.ts';
import type { TypeTitreSejour } from '../../../shared/types.ts';
import { CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, NoteAccent, SectionLabel, Seg } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Information du salarié (art. 13 du RGPD), à porter à sa connaissance avant l'enregistrement. */
function InfoTitre() {
  return (
    <div className="boxed-lg" role="note" aria-label={INFO_TITRE_SEJOUR.titre} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <SectionLabel>{INFO_TITRE_SEJOUR.titre}</SectionLabel>
      <p className="text-muted fine">À porter à la connaissance du salarié avant d’enregistrer son titre (art. 13 du RGPD) ; texte à faire valider par le délégué à la protection des données.</p>
      <ul className="rules">
        {INFO_TITRE_SEJOUR.points.map(([k, v]) => <li key={k}><span style={{ color: 'var(--color-text)' }}>{k}</span> : {v}</li>)}
      </ul>
    </div>
  );
}

export function AutorisationDialog({ empId }: { empId: number }) {
  const d = useDomain();
  const { rh } = useRole();
  const { run, closeDialog } = useStore();
  const emp = d.emp(empId);
  const t0 = emp?.autorisationTravail ?? null;
  const [requise, setRequise] = useState<'non' | 'oui'>(t0 ? 'oui' : 'non');
  const [type, setType] = useState<TypeTitreSejour | ''>(t0?.type ?? '');
  const [numero, setNumero] = useState(t0?.numero ?? '');
  const [expire, setExpire] = useState(t0?.expire ?? '');
  const [verifieLe, setVerifieLe] = useState(t0?.verifieLe ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!emp || !rh) return null;

  const saisie = { requise: requise === 'oui', type, numero, expire, verifieLe };
  const r = validerAutorisation(saisie, { entree: emp.entree, ti: d.ti });
  // Erreurs rattachées à leur champ, reconnues à leur message (comme la fiche).
  const erreur = (re: RegExp) => r.errors.filter(m => re.test(m)).join(' ') || null;
  const errType = erreur(/^Type de titre/), errNumero = erreur(/^Numéro du titre/), errExpire = erreur(/expiration/), errVerif = erreur(/vérification en préfecture/i);
  const permanent = type === 'resident_permanent';
  const limite = joursOuvrablesAvant(emp.entree, 2);

  const confirm = async () => {
    if (busy || !v.verifier(r.errors.length)) return;
    setBusy(true);
    const res = await run('employe.autorisationTravail', { id: emp.id, ...saisie, type: saisie.requise ? type : null, expire: permanent ? null : expire });
    setBusy(false);
    if (res.ok) closeDialog();
  };

  return (
    <Dialog title={`Titre de séjour — ${emp.nom}`} width={620} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{emp.nom} · {emp.poste}</Static></Field>
        <Field label="Embauche"><Static>Entrée le {fmtIso(emp.entree)}</Static></Field>
      </div>
      <Field label="Autorisation de travail">
        <Seg name="titre-requise" label="Autorisation de travail" value={requise} onChange={setRequise} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
          options={[['non', 'Non requise'], ['oui', 'Titre de séjour']]} />
      </Field>
      {requise === 'non' ? (
        <Fine>Ressortissant français, d’un État de l’Union européenne, de l’Espace économique européen ou de la Suisse : aucun titre à suivre{t0 ? ' — le titre enregistré sera effacé' : ''}.</Fine>
      ) : <>
        <div className="grid-2">
          <Field label="Type de titre" htmlFor="titre-type" requis erreur={v.erreur(errType)}>
            <select className="input" id="titre-type" value={type} onChange={ev => setType(ev.target.value as TypeTitreSejour | '')}>
              <option value="">Choisir…</option>
              {(Object.keys(TYPES_TITRE_SEJOUR) as TypeTitreSejour[]).map(k => <option key={k} value={k}>{TYPES_TITRE_SEJOUR[k].label}</option>)}
            </select>
          </Field>
          <Field label="Numéro du titre" htmlFor="titre-numero" requis erreur={numero ? errNumero : v.erreur(errNumero)}>
            <input className="input" id="titre-numero" type="text" autoComplete="off" spellCheck={false} maxLength={40} value={numero} onChange={ev => setNumero(ev.target.value)} />
            <span className="text-muted sub">Registre unique du personnel ; visible du service RH seulement, jamais au journal</span>
          </Field>
          {!permanent && (
            <Field label="Expire le" htmlFor="titre-expire" requis erreur={expire ? errExpire : v.erreur(errExpire)}>
              <input className="input" id="titre-expire" type="date" value={expire} onChange={ev => setExpire(ev.target.value)} />
            </Field>
          )}
          <Field label="Vérifié auprès de la préfecture le" htmlFor="titre-verif" erreur={errVerif}>
            <input className="input" id="titre-verif" type="date" max={d.ti} value={verifieLe} onChange={ev => setVerifieLe(ev.target.value)} />
            <span className="text-muted sub">Embauche : demande d’authentification au moins 2 jours ouvrables avant, soit le {fmtIso(limite)} (art. R5221-41)</span>
          </Field>
        </div>
        {r.warnings.map(w => <NoteAccent key={w}>{w}</NoteAccent>)}
        <Fine>
          Alerte {d.ds.settings.titreSejourAlerte} jours avant l’expiration (demande de renouvellement en préfecture), relance à {d.ds.settings.titreSejourRelance} jours
          (Paramètres → Contrats). Expiré, le titre rend le salarié non conforme et le passe en « No Go » sur les chantiers ; Keystone ne reçoit qu’une
          « situation contractuelle à régulariser ». La copie du titre ira dans la GED, pas dans Cursus.
        </Fine>
        <InfoTitre />
      </>}
      {v.tente && r.errors.length > 0 && !errType && !errNumero && !errExpire && !errVerif && <Controles msgs={r.errors.map(text => ({ text, bad: true }))} />}
    </Dialog>
  );
}
