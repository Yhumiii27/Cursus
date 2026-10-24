// Écran Référentiels : nouvelle formation du catalogue, ou modification d'une formation (son code ne change plus).
// Contrôles partagés avec le serveur (shared/rules/referentiels.ts). Une validité modifiée vaut aussi pour les
// certifications déjà obtenues : les titres qui deviennent échus sont annoncés, et l'enregistrement se confirme.
import { useMemo, useState } from 'react';
import { VALIDATION_LABEL } from '../../../shared/constants.ts';
import { plural, validiteLabel } from '../../../shared/format.ts';
import {
  codeSuggere, controlerFormation, effetModification, MODES_VALIDATION, titresTexte, TYPES_FORMATION, VALIDITE_MAX, type ChampFormation,
} from '../../../shared/rules/referentiels.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, NoteAccent } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { dureeHeuresDe } from '../../../shared/rules/heures-formation.ts';
import { ARTICLE_PASSEPORT, passeportPropose } from '../../../shared/rules/passeport-prevention.ts';

export function RefFormationDialog({ id }: { id?: string | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const liste = d.ds.referentiels.formations;
  // Formation figée à l'ouverture (modification) ; disparue entre-temps : rien à enregistrer.
  const [avant] = useState(() => (id ? liste.find(f => f.id === id) ?? null : null));
  const [nom, setNom] = useState(avant?.nom ?? '');
  const [court, setCourt] = useState(avant?.court ?? '');
  const [code, setCode] = useState('');
  const [type, setType] = useState<string>(avant?.type ?? 'Réglementaire');
  const [validite, setValidite] = useState(avant ? String(avant.validite) : '');
  const [validation, setValidation] = useState<string>(avant?.validation ?? 'presence');
  const [duree, setDuree] = useState(avant?.duree ?? '');
  // Durée en heures (t122), facultative : proposée d'après le texte de la durée tant qu'elle n'est pas saisie.
  const [dureeHeures, setDureeHeures] = useState(avant?.dureeHeures != null ? String(avant.dureeHeures) : '');
  const [organisme, setOrganisme] = useState(avant?.organisme ?? '');
  const [cout, setCout] = useState(avant ? String(avant.cout) : '');
  // Passeport de prévention (lot 7, t066) : jamais coché d'office à la création ; proposé pour une formation santé-sécurité.
  const [passeport, setPasseport] = useState(!!avant?.passeportPrevention);
  const [busy, setBusy] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const v = useVerification();
  const disparue = !!id && !avant;

  // Code proposé d'après le nom court tant que la personne n'en saisit pas un autre.
  const propose = court.trim() ? codeSuggere(court, liste.map(f => f.id)) : '';
  const codeFinal = code.trim() || propose;
  const champs = { nom, court, type, validite, validation, duree, organisme, cout, dureeHeures: dureeHeures.trim().replace(',', '.'), passeportPrevention: passeport };
  const { erreurs, formation } = controlerFormation({ ...champs, code: codeFinal }, liste, avant?.id ?? null);
  // Champ vide : signalé à l'envoi ; saisie incorrecte (format, doublon, borne) : dès la saisie.
  const erreur = (k: ChampFormation, saisi: string) => (saisi.trim() ? erreurs[k] ?? null : v.erreur(erreurs[k]));
  const n = Number(validite);
  // Titres dont la validité change : certifications de la formation et habilitations qui l'exigent. Seule la validité
  // compte : le calcul n'est refait que lorsqu'elle change.
  const nouvelle = formation?.validite ?? null;
  const effet = useMemo(
    () => (avant && nouvelle != null && nouvelle !== avant.validite ? effetModification(d.ds, 'formations', { ...avant, validite: nouvelle }) : null),
    [d, avant, nouvelle],
  );
  const echus = effet?.echus ?? [];

  const envoyer = async (force = false) => {
    if (busy || !v.verifier(...Object.values(erreurs), disparue)) return;
    if (!force && echus.length) { setConfirmer(true); return; }
    setBusy(true);
    const r = await run('referentiel.formation.enregistrer', avant ? { id: avant.id, ...champs } : { code: codeFinal, ...champs });
    setBusy(false);
    if (r.ok) closeDialog();
    else setConfirmer(false);
  };

  return (
    <Dialog title={avant ? `Formation ${avant.court}` : 'Nouvelle formation'} width={600} onSubmit={() => envoyer()}
      confirmation={confirmer ? {
        texte: `${plural(echus.length, 'titre devient échu', 'titres deviennent échus')} avec cette validité : ${titresTexte(echus)}. Enregistrer quand même ?`,
        bouton: 'Enregistrer quand même', occupe: busy, confirmer: () => envoyer(true), annuler: () => setConfirmer(false),
      } : null}
      actions={disparue ? <CancelButton label="Fermer" /> : <>
        <CancelButton />
        <SubmitButton busy={busy}>{avant ? 'Enregistrer' : 'Ajouter au catalogue'}</SubmitButton>
      </>}>
      {disparue ? <Bloquant>Cette formation n’existe plus.</Bloquant> : <>
        <Field label="Intitulé" htmlFor="rf-nom" requis erreur={erreur('nom', nom)}>
          <input className="input" id="rf-nom" type="text" autoFocus value={nom} maxLength={120} placeholder="Sauveteur secouriste du travail (SST)" onChange={e => setNom(e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label="Nom court" htmlFor="rf-court" requis erreur={erreur('court', court)}>
            <input className="input" id="rf-court" type="text" value={court} maxLength={40} placeholder="SST" onChange={e => setCourt(e.target.value)} />
          </Field>
          {avant
            ? <Field label="Code"><Static pad>{avant.id}</Static></Field>
            : (
              <Field label="Code" htmlFor="rf-code" requis erreur={erreur('code', code)}>
                <input className="input" id="rf-code" type="text" value={code} maxLength={32} placeholder={propose || 'd’après le nom court'} onChange={e => setCode(e.target.value)} />
              </Field>
            )}
        </div>
        <div className="grid-2">
          <Field label="Type" htmlFor="rf-type" requis erreur={v.erreur(erreurs.type)}>
            <select className="input" id="rf-type" value={type} onChange={e => setType(e.target.value)}>
              {TYPES_FORMATION.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Validation" htmlFor="rf-validation" requis erreur={v.erreur(erreurs.validation)}>
            <select className="input" id="rf-validation" value={validation} onChange={e => setValidation(e.target.value)}>
              {MODES_VALIDATION.map(m => <option key={m} value={m}>{VALIDATION_LABEL[m]}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Validité (mois)" htmlFor="rf-validite" requis erreur={erreur('validite', validite)}>
            <input className="input" id="rf-validite" type="number" inputMode="numeric" min={1} max={VALIDITE_MAX} step={1} value={validite} placeholder="24" onChange={e => setValidite(e.target.value)} />
          </Field>
          <Field label="Coût par stagiaire (€)" htmlFor="rf-cout" erreur={erreur('cout', cout)}>
            <input className="input" id="rf-cout" type="number" inputMode="decimal" min={0} step="any" value={cout} placeholder="0" onChange={e => setCout(e.target.value)} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Durée" htmlFor="rf-duree" erreur={erreur('duree', duree)}>
            <input className="input" id="rf-duree" type="text" value={duree} maxLength={40} placeholder="7 h (MAC)" onChange={e => setDuree(e.target.value)} />
          </Field>
          <Field label="Durée en heures" htmlFor="rf-heures" erreur={erreur('dureeHeures', dureeHeures)}>
            <input className="input tnum" id="rf-heures" inputMode="decimal" value={dureeHeures} placeholder={dureeHeuresDe(duree) != null ? String(dureeHeuresDe(duree)) : '7'}
              onChange={e => setDureeHeures(e.target.value)} />
          </Field>
        </div>
        <Field label="Organisme" htmlFor="rf-organisme" erreur={erreur('organisme', organisme)}>
          <input className="input" id="rf-organisme" type="text" value={organisme} maxLength={80} placeholder="Interne · HSE" onChange={e => setOrganisme(e.target.value)} />
        </Field>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', fontSize: 14 }}>
          <input type="checkbox" checked={passeport} onChange={e => setPasseport(e.target.checked)} style={{ accentColor: 'var(--color-accent)', marginTop: 3 }} />
          <span>
            Formation santé-sécurité à déclarer au Passeport de prévention
            <span className="text-muted sub" style={{ display: 'block' }}>
              {ARTICLE_PASSEPORT} : ses certifications et formations suivies sont proposées à l’export (écran Formations)
              {!passeport && passeportPropose({ id: codeFinal, court, nom }) ? ' · formation santé-sécurité : à cocher ?' : ''}
            </span>
          </span>
        </label>
        <Fine>
          {Number.isInteger(n) && n >= 1 && n <= VALIDITE_MAX ? `Validité : ${validiteLabel(n)}. ` : ''}
          La durée en heures compte les heures des formations suivies dans les indicateurs du plan (sans horaires de session) ;
          vide, elles comptent « durée inconnue ».{' '}
          {avant
            ? 'Une nouvelle validité vaut aussi pour les certifications déjà obtenues : leurs échéances sont recalculées.'
            : 'Le code identifie la formation dans les dossiers et auprès de Keystone (exigences des chantiers) : il ne change plus après la création.'}
        </Fine>
        {effet && echus.length > 0 && !confirmer && (
          <NoteAccent>{plural(echus.length, 'titre devient échu', 'titres deviennent échus')} avec cette validité : {titresTexte(echus)}.</NoteAccent>
        )}
        {effet && effet.retablis.length > 0 && <Fine>{plural(effet.retablis.length, 'titre redevient valide', 'titres redeviennent valides')} avec cette validité.</Fine>}
      </>}
    </Dialog>
  );
}
