// lot 12 — C4 (organismes de formation et e-learning) : fusion d'un doublon dans la fiche qui reste (administrateur RH).
// La fiche absorbée est archivée et désigne celle qui la remplace ; ses objets (formations, sessions, formations suivies,
// lignes du plan, dossiers OPCO, modules, contacts, tarifs) sont réaffectés, ses graphies gardées en alias. Jamais deux
// fiches aux SIRET différents, ni un service interne avec un organisme externe (`refusFusion`). Pas de défusion simple :
// la liste des objets réaffectés est confirmée, et leur nombre envoyé (refus si l'écran est en retard). Motif obligatoire,
// gardé sur la fiche absorbée (service RH), jamais recopié au journal.
import { useState } from 'react';
import { erreurMotifCorrection, MOTIF_CORRECTION_MAX } from '../../../shared/rules/corrections.ts';
import { organismeActif, rattachementsDe, refusFusion, TYPES_ORGANISME, type Rattachements } from '../../../shared/rules/organismes.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, NoteAccent } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

/** Singulier et pluriel, sources anglaises (`tn`, CU-N01). */
const LIBELLES: Record<keyof Rattachements, [string, string]> = {
  formations: ['catalogue training course', 'catalogue training courses'], sessions: ['session', 'sessions'], suivies: ['training course followed', 'training courses followed'],
  plan: ['plan line', 'plan lines'], dossiers: ['OPCO file#count', 'OPCO files#count'], modules: ['e-learning module', 'e-learning modules'],
  contacts: [t('contact'), t('contacts')], tarifs: ['rate', 'rates'],
};

/** Objets réaffectés, en toutes lettres (« 2 formations du catalogue, 5 sessions »). */
export const objetsTexte = (r: Rattachements) =>
  (Object.keys(LIBELLES) as (keyof Rattachements)[]).filter(k => r[k] > 0).map(k => tn(r[k], LIBELLES[k][0], LIBELLES[k][1])).join(', ');

export function OrganismeFusionDialog({ source: id }: { source: number }) {
  const d = useDomain();
  const { run, closeDialog, setUi } = useStore();
  const liste = d.ds.organismes ?? [];
  const source = liste.find(o => o.id === id) ?? null;
  const [cible, setCible] = useState('');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const v = useVerification();
  const c = liste.find(o => o.id === Number(cible)) ?? null;
  // Fiches proposées : en vigueur, de même nature (interne ou non) ; une fiche au SIRET différent reste listée, refusée à l'envoi.
  const candidates = source ? liste.filter(o => o.id !== source.id && organismeActif(o) && (o.type === 'interne') === (source.type === 'interne'))
    .sort((a, b) => a.nomUsuel.localeCompare(b.nomUsuel, 'fr')) : [];
  const r = source ? rattachementsDe(d.ds, source.id) : null;
  const total = r ? Object.values(r).reduce((a, b) => a + b, 0) : 0;
  const errCible = !cible ? t('Choose the sheet that stays.') : refusFusion(source, c);
  const errMotif = erreurMotifCorrection(motif);
  const envoyer = async (force = false) => {
    if (busy || !v.verifier(errCible, errMotif, !source)) return;
    if (!force) { setConfirmer(true); return; }
    setBusy(true);
    const res = await run('organisme.fusionner', { source: source!.id, cible: c!.id, motif, objets: total });
    setBusy(false);
    setConfirmer(false);
    if (!res.ok) return;
    closeDialog();
    setUi({ orgSel: c!.id });
  };
  return (
    <Dialog title={`${t('Merge ')}${source?.nomUsuel ?? t('the provider')}`} width={560} onSubmit={() => envoyer()}
      confirmation={confirmer && c ? {
        texte: `${t('Merge “')}${source!.nomUsuel}${t('” into “')}${c.nomUsuel}${t('”? ')}${total ? `${objetsTexte(r!)}${t(' move to “')}${c.nomUsuel}${t('”.')}` : t('No object to reassign.')}${t(' There is no simple unmerge.')}`,
        bouton: t('Merge#verb'), occupe: busy, confirmer: () => envoyer(true), annuler: () => setConfirmer(false),
      } : null}
      actions={!source ? <CancelButton label={t('Close')} /> : <><CancelButton /><SubmitButton busy={busy}>{t('Merge#verb')}</SubmitButton></>}>
      {!source ? <Bloquant>{t('This provider no longer exists.')}</Bloquant> : <>
        <Field label={t('Absorbed sheet (archived afterwards)')}><Static pad>{source.nomUsuel} · {TYPES_ORGANISME[source.type]}{source.siret ? `${t(' · SIRET ')}${source.siret}` : ''}</Static></Field>
        <Field label={t('Sheet that stays')} htmlFor="of-cible" requis erreur={cible ? errCible : v.erreur(errCible)}>
          <select className="input" id="of-cible" autoFocus value={cible} onChange={e => setCible(e.target.value)}>
            <option value="">{t('Choose…')}</option>
            {candidates.map(o => <option key={o.id} value={o.id}>{o.nomUsuel}{o.siret ? `${t(' · SIRET ')}${o.siret}` : ''}{o.aVerifier ? t(' · to be checked') : ''}</option>)}
          </select>
        </Field>
        {r && <p style={{ margin: 0, fontSize: 14 }}>{total ? `${t('Reassigned: ')}${objetsTexte(r)}.` : t('No object designates this sheet.')}{t(' Its spellings (')}{[...new Set([source.nomUsuel, ...source.alias])].join(', ')}{t(') become aliases of the sheet that stays.')}</p>}
        {c && !errCible && !c.siret && source.siret && <NoteAccent>{t('The SIRET ')}{source.siret}{t(' moves to “')}{c.nomUsuel}{t('”, which had none.')}</NoteAccent>}
        <Field label={t('Reason for the merge')} htmlFor="of-motif" requis erreur={motif.trim() ? errMotif : v.erreur(errMotif)}>
          <textarea className="input" id="of-motif" rows={2} value={motif} maxLength={MOTIF_CORRECTION_MAX} placeholder={t('Same SIRET, spelling taken over from an old free text…')} onChange={e => setMotif(e.target.value)} />
        </Field>
        <Fine>{t('The reason stays on the absorbed sheet, read by HR only; the log records the codes of both sheets and the number of objects reassigned.')}</Fine>
      </>}
    </Dialog>
  );
}
