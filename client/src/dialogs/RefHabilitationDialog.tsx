// Écran Référentiels : nouvelle habilitation, ou modification d'une habilitation (son code ne change plus) :
// formations prérequises prises dans le catalogue, aptitude médicale exigée, validité, signataire proposé par défaut
// à la délivrance, suivi individuel renforcé de ses titulaires (case décochée par défaut), modèle du titre imprimé (t115). Une règle modifiée (validité, prérequis, aptitude) vaut aussi pour les titres déjà délivrés :
// ceux qui deviennent non valides sont annoncés, et l'enregistrement se confirme.
import { useMemo, useState } from 'react';
import { validiteLabel } from '../../../shared/format.ts';
import {
  actif, codeSuggere, controlerHabilitation, effetModification, MODELES_TITRE, titresTexte, VALIDITE_MAX, type ChampHabilitation,
} from '../../../shared/rules/referentiels.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, NoteAccent } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { MODELE_TITRE_LABEL } from '../titre-habilitation.ts';
import type { ModeleTitre } from '../../../shared/types.ts';
import { t, tn } from '../i18n/langue.ts';

export function RefHabilitationDialog({ id }: { id?: string | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const liste = d.ds.referentiels.habilitations;
  const [avant] = useState(() => (id ? liste.find(h => h.id === id) ?? null : null));
  const [nom, setNom] = useState(avant?.nom ?? '');
  const [detail, setDetail] = useState(avant?.detail ?? '');
  const [code, setCode] = useState('');
  const [prereqs, setPrereqs] = useState<string[]>(avant?.prereqs ?? []);
  const [medical, setMedical] = useState(avant?.medical ?? false);
  const [sir, setSir] = useState(avant?.sir ?? false);
  const [validite, setValidite] = useState(avant ? String(avant.validite) : '');
  const [signataire, setSignataire] = useState(avant?.signataire ?? '');
  // Modèle du titre imprimé à la délivrance (t115) : générique par défaut.
  const [modele, setModele] = useState<ModeleTitre>(avant?.modele ?? 'generique');
  const [busy, setBusy] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const v = useVerification();
  const disparue = !!id && !avant;

  // Formations proposées : le catalogue en vigueur, et les prérequis déjà inscrits d'une formation archivée depuis (une
  // habilitation archivée les garde ; en vigueur, elle ne peut pas les exiger : controlerHabilitation les signale).
  const formations = d.ds.referentiels.formations.filter(f => actif(f) || avant?.prereqs.includes(f.id));
  const propose = nom.trim() ? codeSuggere(nom, liste.map(h => h.id)) : '';
  const codeFinal = code.trim() || propose;
  // Prérequis dans l'ordre du catalogue, quel que soit l'ordre des cases cochées.
  const champs = { nom, detail, prereqs: formations.map(f => f.id).filter(f => prereqs.includes(f)), medical, validite, signataire, sir, modele };
  const { erreurs, habilitation } = controlerHabilitation({ ...champs, code: codeFinal }, liste, d.ds.referentiels.formations, avant?.id ?? null);
  const erreur = (k: ChampHabilitation, saisi: string) => (saisi.trim() ? erreurs[k] ?? null : v.erreur(erreurs[k]));
  const n = Number(validite);
  // Titres délivrés dont le statut change avec la nouvelle règle (validité, prérequis, aptitude).
  const regle = habilitation ? JSON.stringify([habilitation.validite, [...habilitation.prereqs].sort(), habilitation.medical]) : null;
  const effet = useMemo(() => {
    if (!avant || !regle || regle === JSON.stringify([avant.validite, [...avant.prereqs].sort(), avant.medical])) return null;
    const [val, pre, med] = JSON.parse(regle) as [number, string[], boolean];
    return effetModification(d.ds, 'habilitations', { ...avant, validite: val, prereqs: pre, medical: med });
  }, [d, avant, regle]);
  const echus = effet?.echus ?? [];
  const cocher = (f: string, oui: boolean) => setPrereqs(p => (oui ? [...p, f] : p.filter(x => x !== f)));

  const envoyer = async (force = false) => {
    if (busy || !v.verifier(...Object.values(erreurs), disparue)) return;
    if (!force && echus.length) { setConfirmer(true); return; }
    setBusy(true);
    const p = { ...champs, signataire: signataire.trim() };
    const r = await run('referentiel.habilitation.enregistrer', avant ? { id: avant.id, ...p } : { code: codeFinal, ...p });
    setBusy(false);
    if (r.ok) closeDialog();
    else setConfirmer(false);
  };

  return (
    <Dialog title={avant ? avant.nom : t('New authorisation')} width={620} onSubmit={() => envoyer()}
      confirmation={confirmer ? {
        texte: `${tn(echus.length, 'title becomes invalid', 'titles become invalid')}${t(' with this rule: ')}${titresTexte(echus)}${t('. Save anyway?')}`,
        bouton: t('Save anyway'), occupe: busy, confirmer: () => envoyer(true), annuler: () => setConfirmer(false),
      } : null}
      actions={disparue ? <CancelButton label={t('Close')} /> : <>
        <CancelButton />
        <SubmitButton busy={busy}>{avant ? t('Save') : t('Add to the reference data')}</SubmitButton>
      </>}>
      {disparue ? <Bloquant>{t('This authorisation no longer exists.')}</Bloquant> : <>
        <Field label={t('Title#heading')} htmlFor="rhab-nom" requis erreur={erreur('nom', nom)}>
          <input className="input" id="rhab-nom" type="text" autoFocus value={nom} maxLength={120} placeholder={t('Electrical authorisation')} onChange={e => setNom(e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label={t('Detail#precision')} htmlFor="rhab-detail" erreur={erreur('detail', detail)}>
            <input className="input" id="rhab-detail" type="text" value={detail} maxLength={120} placeholder="B1V · B2V · BR — NF C18-510" onChange={e => setDetail(e.target.value)} />
          </Field>
          {avant
            ? <Field label={t('Code')}><Static pad>{avant.id}</Static></Field>
            : (
              <Field label={t('Code')} htmlFor="rhab-code" requis erreur={erreur('code', code)}>
                <input className="input" id="rhab-code" type="text" value={code} maxLength={32} placeholder={propose || t('from the title')} onChange={e => setCode(e.target.value)} />
              </Field>
            )}
        </div>
        <Field label={t('Prerequisite training courses')} erreur={v.erreur(erreurs.prereqs)}>
          {formations.length
            ? (
              <div className="chips" role="group" aria-label={t('Prerequisite training courses')} style={{ gap: 'var(--space-2) var(--space-4)' }}>
                {formations.map(f => (
                  <label key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, cursor: 'pointer' }}>
                    <input type="checkbox" checked={prereqs.includes(f.id)} onChange={e => cocher(f.id, e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
                    {f.court}{f.archive ? <span className="text-muted">{t(' · archived#fem')}</span> : null}
                  </label>
                ))}
              </div>
            )
            : <Static pad>{t('Training catalogue empty: no prerequisite possible.')}</Static>}
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
          <input type="checkbox" checked={medical} onChange={e => setMedical(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
          {t('Medical fitness required (fitness visit in validity)')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
          <input type="checkbox" checked={sir} onChange={e => setSir(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
          {t('Enhanced individual monitoring of its holders (art. R4624-23: driving authorisation, electrical authorisation…)')}
        </label>
        <div className="grid-2">
          <Field label={t('Validity (months)')} htmlFor="rhab-validite" requis erreur={erreur('validite', validite)}>
            <input className="input" id="rhab-validite" type="number" inputMode="numeric" min={1} max={VALIDITE_MAX} step={1} value={validite} placeholder="36" onChange={e => setValidite(e.target.value)} />
          </Field>
          <Field label={t('Default signatory')} htmlFor="rhab-signataire" requis erreur={erreur('signataire', signataire)}>
            <input className="input" id="rhab-signataire" type="text" value={signataire} maxLength={80} placeholder={t('Maintenance manager')} onChange={e => setSignataire(e.target.value)} />
          </Field>
        </div>
        <Field label={t('Template of the printed title')} htmlFor="rhab-modele" erreur={v.erreur(erreurs.modele)}>
          <select className="input" id="rhab-modele" value={modele} onChange={e => setModele(e.target.value as ModeleTitre)}>
            {MODELES_TITRE.map(m => <option key={m} value={m}>{t(MODELE_TITRE_LABEL[m])}</option>)}
          </select>
        </Field>
        <Fine>
          {Number.isInteger(n) && n >= 1 && n <= VALIDITE_MAX ? `${t('Validity: ')}${validiteLabel(n)}. ` : ''}
          {t('Title templates to have validated by the HSE referent.')}{' '}
          {t('The signatory is offered at each issue, editable.')}{' '}
          {avant
            ? t('Validity, prerequisites and fitness also apply to the titles already issued.')
            : t('The code identifies the authorisation in the files and with Keystone (worksite requirements): it no longer changes after creation.')}
        </Fine>
        {echus.length > 0 && !confirmer && <NoteAccent>{tn(echus.length, 'title becomes invalid', 'titles become invalid')}{t(' with this rule: ')}{titresTexte(echus)}.</NoteAccent>}
        {effet && effet.retablis.length > 0 && <Fine>{tn(effet.retablis.length, 'title becomes valid again', 'titles become valid again')}{t(' with this rule.')}</Fine>}
      </>}
    </Dialog>
  );
}
