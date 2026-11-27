// Souhait de formation exprimé à l'entretien (lot 12, chantier C3 ; `entretien.souhait`, règles : shared/rules/souhaits.ts) :
// formation du catalogue ou intitulé libre, priorité, objectif lié éventuel. Le salarié (son espace) ou l'évaluateur
// ajoute, modifie ou retire ses propres souhaits tant que l'entretien est planifié ; l'avis du manager se donne dans le
// compte rendu. À la clôture, seuls les souhaits à avis favorable deviennent une demande de formation au service RH
// (réponse du propriétaire du 1er novembre 2026). Toujours ouvert depuis le compte rendu, rouvert après l'envoi.
import { useState } from 'react';
import { CATEGORIE_OBJECTIF_LABEL, TYPES_AVEC_OBJECTIFS } from '../../../shared/rules/objectifs.ts';
import { LIBELLE_SOUHAIT_MAX, PRIORITE_SOUHAIT_LABEL, PRIORITES_SOUHAIT, souhaitsDe } from '../../../shared/rules/souhaits.ts';
import type { PrioriteSouhait } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

/** Valeur du choix « intitulé libre » dans la liste des formations (comme la demande de formation). */
const AUTRE = 'autre';

export function SouhaitDialog({ entretienId, cle }: { entretienId: number; cle?: string }) {
  const d = useDomain();
  const { collab } = useRole();
  const { run, openDialog } = useStore();
  const x = d.ds.entretiens.find(y => y.id === entretienId);
  const s = x && cle ? souhaitsDe(x).find(y => y.cle === cle) : undefined;
  const [f, setF] = useState(s ? s.f ?? AUTRE : '');
  const [libelle, setLibelle] = useState(s?.libelle ?? '');
  const [priorite, setPriorite] = useState<PrioriteSouhait>(s?.priorite ?? 'normale');
  const [objectifId, setObjectifId] = useState(s?.objectifId != null ? String(s.objectifId) : '');
  const [busy, setBusy] = useState(false);
  const [retirer, setRetirer] = useState(false);
  const v = useVerification();
  const e = x ? d.emp(x.empId) : undefined;
  if (!x || !e || (cle && !s)) return null;

  // Catalogue en vigueur, plus la formation du souhait si elle a été archivée depuis (le serveur la refuse alors).
  const formations = d.ds.referentiels.formations.filter(y => !y.archive || y.id === s?.f).sort((a, b) => a.nom.localeCompare(b.nom));
  // Objectifs du salarié qu'un souhait peut servir : fixés ou repris à cet entretien, ou encore en cours ; seulement dans un
  // entretien qui porte des objectifs, réglage actif (jamais un parcours professionnel ni une reprise : art. L6315-1).
  const avecObjectif = d.ds.settings.objectifsActifs && TYPES_AVEC_OBJECTIFS.includes(x.type);
  const objectifs = avecObjectif ? (d.ds.objectifs ?? []).filter(o => o.empId === e.id && (o.statut === 'ouvert' || o.entretienId === x.id)) : [];
  const fErr = !f ? t('Choose a training course of the catalogue, or “Other (free title)”.') : null;
  const libelleErr = f !== AUTRE ? null : !libelle.trim() ? t('Enter the title of the training course wanted.')
    : libelle.trim().length > LIBELLE_SOUHAIT_MAX ? t(`${LIBELLE_SOUHAIT_MAX} characters at most.`) : null;
  const revenir = () => openDialog({ type: 'ent', entId: x.id });
  const saisie = { f: f === AUTRE ? null : f, libelle: f === AUTRE ? libelle : null, priorite,
    // Réglage coupé sur un annuel : lien déjà posé gardé tel quel (champ absent) ; hors des types à objectifs : aucun lien.
    objectifId: avecObjectif ? (objectifId ? Number(objectifId) : null) : TYPES_AVEC_OBJECTIFS.includes(x.type) ? undefined : null };

  const envoyer = async () => {
    if (busy || !v.verifier(fErr, libelleErr)) return;
    setBusy(true);
    const r = await run('entretien.souhait', { id: x.id, op: s ? 'modifier' : 'ajouter', ...(s ? { cle: s.cle } : {}), ...saisie });
    setBusy(false);
    if (r.ok) revenir();
  };
  const confirmerRetrait = async () => {
    setBusy(true);
    const r = await run('entretien.souhait', { id: x.id, op: 'retirer', cle: s!.cle });
    setBusy(false);
    if (r.ok) revenir();
    else setRetirer(false);
  };

  return (
    <Dialog title={`${t(s ? 'Edit the wish' : 'Training wish')} — ${e.nom}`} width={560} onSubmit={envoyer} fermer={revenir}
      confirmation={retirer ? { texte: t('Remove this training wish from the report?'), bouton: t('Remove'), occupe: busy, confirmer: confirmerRetrait, annuler: () => setRetirer(false) } : null}
      actions={<>
        <CancelButton />
        {s && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRetirer(true)}>{t('Remove')}</button>}
        <SubmitButton busy={busy}>{t(s ? 'Save' : 'Add the wish')}</SubmitButton>
      </>}>
      <Field label={t('Training course wanted')} htmlFor="souhait-f" requis erreur={v.erreur(fErr)}>
        <select className="input" id="souhait-f" value={f} onChange={ev => setF(ev.target.value)}>
          <option value="">{t('Choose…')}</option>
          {formations.map(y => <option key={y.id} value={y.id}>{y.nom}{y.archive ? t(' (withdrawn from the catalogue)') : ''}</option>)}
          <option value={AUTRE}>{t('Other (free title)')}</option>
        </select>
      </Field>
      {f === AUTRE && (
        <Field label={t('Title#label')} htmlFor="souhait-libelle" requis erreur={v.erreur(libelleErr)}>
          <input className="input" id="souhait-libelle" value={libelle} maxLength={LIBELLE_SOUHAIT_MAX} onChange={ev => setLibelle(ev.target.value)} />
        </Field>
      )}
      <div className="grid-2">
        <Field label={t('Priority')} htmlFor="souhait-priorite">
          <select className="input" id="souhait-priorite" value={priorite} onChange={ev => setPriorite(ev.target.value as PrioriteSouhait)}>
            {PRIORITES_SOUHAIT.map(p => <option key={p} value={p}>{PRIORITE_SOUHAIT_LABEL[p]}</option>)}
          </select>
        </Field>
        {objectifs.length > 0 && (
          <Field label={t('Linked objective (optional)')} htmlFor="souhait-objectif">
            <select className="input" id="souhait-objectif" value={objectifId} onChange={ev => setObjectifId(ev.target.value)}>
              <option value="">{t('None#masc')}</option>
              {objectifs.map(o => <option key={o.id} value={o.id}>{o.libelle} ({CATEGORIE_OBJECTIF_LABEL[o.categorie].toLowerCase()})</option>)}
            </select>
          </Field>
        )}
      </div>
      <Fine>
        {collab
          ? t('Your manager gives their opinion before the closing: a wish with a favourable opinion then becomes a training request to HR. ')
          : t('Give your opinion in the report: at the closing, each wish with a favourable opinion becomes a training request to HR. ')}
        {t(s && collab && s.avis ? 'Changing the training course wanted erases the opinion already given.' : 'Put no health data in it.')}
      </Fine>
    </Dialog>
  );
}
