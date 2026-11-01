// Référentiels → Entités et sites (lot 11, chantier C1, étape 2) : nouvelle entité (code et type choisis une fois pour
// toutes) ou modification du nom, de la société parente d'un établissement, du SIREN, du SIRET, de l'IDCC et du site.
// Contrôles partagés avec le serveur (shared/rules/entites.ts, `controlerEntite`) : format et clé de Luhn, SIRET qui
// commence par le SIREN de la société, unicité, société ouverte, site connu et actif.
import { useState } from 'react';
import { controlerEntite, entiteOuverte, NOM_ENTITE_MAX, TYPES_ENTITE } from '../../../shared/rules/entites.ts';
import type { TypeEntite } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function RefEntiteDialog({ code }: { code?: string | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const entites = d.ds.referentiels.entites ?? [];
  const sites = d.ds.referentiels.sites ?? [];
  const [avant] = useState(() => (code ? entites.find(x => x.code === code) ?? null : null));
  const [saisi, setSaisi] = useState('');
  const [nom, setNom] = useState(avant?.nom ?? '');
  const [type, setType] = useState<TypeEntite | ''>(avant?.type ?? (entites.some(x => x.type === 'societe') ? '' : 'societe'));
  const [parente, setParente] = useState(avant?.parente ?? '');
  const [siren, setSiren] = useState(avant?.siren ?? '');
  const [siret, setSiret] = useState(avant?.siret ?? '');
  const [idcc, setIdcc] = useState(avant?.idcc ?? '');
  const [siteCode, setSiteCode] = useState(avant?.siteCode ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const disparu = !!code && !avant;
  const matrix = avant?.source === 'matrix';
  const societe = type === 'societe';
  const champs = { nom, parente: societe ? '' : parente, siren: societe ? siren : '', siret, idcc, siteCode };
  const { erreurs } = controlerEntite({ code: saisi, type, ...champs }, entites, sites, avant);
  // Erreur de format dès la saisie ; champ obligatoire vide : à l'envoi.
  const tape = (s: string, e: string | undefined) => (s.trim() ? e ?? null : v.erreur(e));
  const societes = entites.filter(x => x.type === 'societe' && (entiteOuverte(x) || x.code === avant?.parente));
  const sitesProposes = sites.filter(s => s.actif || s.code === avant?.siteCode);

  const envoyer = async () => {
    if (busy || matrix || !v.verifier(avant ? null : erreurs.code, erreurs.nom, avant ? null : erreurs.type, erreurs.parente, erreurs.siren, erreurs.siret, erreurs.idcc, erreurs.siteCode, disparu)) return;
    setBusy(true);
    const r = await run(avant ? 'entite.modifier' : 'entite.creer', avant ? { code: avant.code, ...champs } : { code: saisi, type, ...champs });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  const titre = avant ? `${TYPES_ENTITE[avant.type]} ${avant.nom}` : 'Nouvelle entité';
  return (
    <Dialog title={titre} width={560} onSubmit={envoyer}
      actions={disparu || matrix ? <CancelButton label="Fermer" /> : <>
        <CancelButton />
        <SubmitButton busy={busy}>{avant ? 'Enregistrer' : 'Ajouter au référentiel'}</SubmitButton>
      </>}>
      {disparu ? <Bloquant>Cette entité n’existe plus.</Bloquant> : matrix ? <Bloquant>Cette entité est tenue par Matrix (référentiel commun) : elle s’y modifie.</Bloquant> : <>
        {!avant && (
          <div className="grid-2">
            <Field label="Type" htmlFor="rent-type" requis erreur={v.erreur(erreurs.type)}>
              <select className="input" id="rent-type" autoFocus value={type} onChange={e => setType(e.target.value as TypeEntite | '')}>
                <option value="" disabled>Choisir…</option>
                <option value="societe">{TYPES_ENTITE.societe}</option>
                <option value="etablissement">{TYPES_ENTITE.etablissement}</option>
              </select>
            </Field>
            <Field label="Code" htmlFor="rent-code" requis erreur={tape(saisi, erreurs.code)}>
              <input className="input" id="rent-code" type="text" value={saisi} maxLength={32} placeholder="epc2i" autoComplete="off" spellCheck={false}
                onChange={e => setSaisi(e.target.value.toLowerCase())} />
            </Field>
          </div>
        )}
        <Field label={societe ? 'Raison sociale' : 'Nom de l’établissement'} htmlFor="rent-nom" requis erreur={tape(nom, erreurs.nom)}>
          <input className="input" id="rent-nom" type="text" autoFocus={!!avant} value={nom} maxLength={NOM_ENTITE_MAX}
            placeholder={societe ? 'EPC2I SAS' : 'Établissement de Lyon'} onChange={e => setNom(e.target.value)} />
        </Field>
        {type === 'etablissement' && (
          <Field label="Société" htmlFor="rent-parente" requis erreur={v.erreur(erreurs.parente)}>
            <select className="input" id="rent-parente" value={parente} onChange={e => setParente(e.target.value)}>
              <option value="">Choisir la société…</option>
              {societes.map(x => <option key={x.code} value={x.code}>{x.nom}</option>)}
            </select>
          </Field>
        )}
        <div className="grid-2">
          {societe && (
            <Field label="SIREN" htmlFor="rent-siren" erreur={siren.trim() ? erreurs.siren ?? null : null}>
              <input className="input tnum" id="rent-siren" type="text" inputMode="numeric" value={siren} maxLength={11} placeholder="552 100 554" autoComplete="off"
                onChange={e => setSiren(e.target.value)} />
            </Field>
          )}
          <Field label={societe ? 'SIRET du siège' : 'SIRET'} htmlFor="rent-siret" erreur={siret.trim() ? erreurs.siret ?? null : null}>
            <input className="input tnum" id="rent-siret" type="text" inputMode="numeric" value={siret} maxLength={17} placeholder="552 100 554 00013" autoComplete="off"
              onChange={e => setSiret(e.target.value)} />
          </Field>
          {societe && (
            <Field label="IDCC" htmlFor="rent-idcc" erreur={idcc.trim() ? erreurs.idcc ?? null : null}>
              <input className="input tnum" id="rent-idcc" type="text" inputMode="numeric" value={idcc} maxLength={4} placeholder="0044" autoComplete="off"
                onChange={e => setIdcc(e.target.value.replace(/\D/g, ''))} />
            </Field>
          )}
          <Field label="Site" htmlFor="rent-site" erreur={erreurs.siteCode ?? null}>
            <select className="input" id="rent-site" value={siteCode} onChange={e => setSiteCode(e.target.value)}>
              <option value="">Aucun</option>
              {sitesProposes.map(s => <option key={s.code} value={s.code}>{s.libelle}</option>)}
            </select>
          </Field>
        </div>
        <Fine>
          {avant ? 'Le code et le type ne changent plus. ' : 'Le code (lettres minuscules, chiffres, « _ ») identifie l’entité et ne change plus, comme son type. '}
          SIREN et SIRET sont contrôlés par leur clé ; le SIRET commence par le SIREN de la société. IDCC des Industries chimiques : 0044.
          Le site, facultatif, vaut pour les équipes qui n’en portent pas.
        </Fine>
      </>}
    </Dialog>
  );
}
