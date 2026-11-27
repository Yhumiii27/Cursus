// Effacement des données échues d'un ou plusieurs salariés sortis, ou anonymisation de leur dossier (t016, administrateur
// RH, Paramètres → Conservation des dossiers) : « Cursus propose, le RH confirme ». Le dialogue liste, pour chaque dossier,
// ce qui sera effacé ; un motif est exigé (gardé avec la trace de l'effacement, jamais au journal). `avantEcheance` : droit
// à l'effacement exercé par un salarié sorti avant l'échéance : seules les catégories sans obligation légale en cours sont
// effacées, le dialogue liste ce qui reste et jusqu'à quand (art. 17-3-b du RGPD). Irréversible : les sauvegardes gardent
// les données jusqu'à leur rotation.
import { useState } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { CATEGORIES_CONSERVATION, categoriesDroitEffacement } from '../../../shared/rules/conservation.ts';
import type { CategorieConservation } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, NoteAccent, Tag } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

/** Motif : 500 caractères au plus (contrôle du serveur). */
const MOTIF_MAX = 500;

export function AnonymiserDialog({ ids, avantEcheance = false }: { ids: number[]; avantEcheance?: boolean }) {
  const d = useDomain();
  const { admin } = useRole();
  const { run, closeDialog } = useStore();
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!admin) return null;
  const echus = new Map((d.ds.conservation ?? []).map(x => [x.empId, x]));
  const dossiers = ids.map(id => {
    const e = d.emp(id);
    // Droit à l'effacement : le serveur écarte en plus les catégories sans donnée.
    const droit = avantEcheance && e ? categoriesDroitEffacement(e, d.ds.settings, d.ti) : null;
    const categories: CategorieConservation[] = droit ? droit.categories : echus.get(id)?.categories ?? [];
    return { id, nom: e?.nom ?? `${t('no. ')}${id}`, fin: e?.fin ?? null, categories, anonymise: categories.includes('dossier'), gardees: droit?.gardees ?? [] };
  });
  const anonymises = dossiers.filter(x => x.anonymise).length;
  const erreur = !motif.trim() ? t('Enter the reason: DPO’s decision, employee’s request…') : null;

  const confirmer = async () => {
    if (busy || !v.verifier(erreur)) return;
    setBusy(true);
    const r = await run('employe.anonymiser', { ids, motif: motif.trim(), ...(avantEcheance ? { avantEcheance: true } : {}) });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  const titre = avantEcheance ? t('Right to erasure') : anonymises === dossiers.length && anonymises ? `${t('Anonymise ')}${tn(anonymises, 'file#dossier', 'files#dossier')}` : t('Erase the expired data');
  return (
    <Dialog title={titre} width={620} onSubmit={confirmer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Erase permanently')}</SubmitButton>
    </>}>
      <NoteAccent>
        {t('Permanent erasure: nothing can be restored from Cursus. The backups keep these data until their rotation (restoring an earlier copy would bring them back).')}
      </NoteAccent>
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', margin: 0, padding: 0, listStyle: 'none' }}>
        {dossiers.map(x => (
          <li key={x.id} className="boxed">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14 }}>{x.nom}</span>
              {x.fin && <span className="text-muted sub">{t('left on ')}{fmtIso(x.fin)}</span>}
              <Tag cls={x.anonymise ? 'tag-accent' : 'tag-outline'}>{x.anonymise ? t('Anonymisation of the file') : t('Partial erasure')}</Tag>
            </div>
            <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-5)' }}>
              {(x.anonymise ? ['dossier' as const] : x.categories).map(c => (
                <li key={c} className="text-muted sub">
                  <strong>{CATEGORIES_CONSERVATION[c].label}</strong>{t(': ')}{CATEGORIES_CONSERVATION[c].effacement}
                  {c === 'dossier' && t('; everything that remains of the other categories is erased with it')}
                </li>
              ))}
            </ul>
            {x.gardees.length > 0 && (
              <>
                <div className="text-muted sub" style={{ marginTop: 'var(--space-2)' }}>{t('Kept until the due date, the law requiring it:')}</div>
                <ul style={{ margin: 'var(--space-1) 0 0', paddingLeft: 'var(--space-5)' }}>
                  {x.gardees.map(g => (
                    <li key={g.categorie} className="text-muted sub">
                      <strong>{CATEGORIES_CONSERVATION[g.categorie].label}</strong>{t(', until ')}{fmtIso(g.jusquAu)}{t(': ')}{CATEGORIES_CONSERVATION[g.categorie].obligation}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </li>
        ))}
      </ul>
      <Field label={t('Reason')} htmlFor="anonymiser-motif" requis erreur={v.erreur(erreur)}>
        <textarea className="input mid" id="anonymiser-motif" rows={3} autoFocus maxLength={MOTIF_MAX}
          placeholder={avantEcheance ? t('Erasure request of the employee received on …, DPO’s agreement') : t('Durations set by the DPO’s decision …')}
          value={motif} onChange={e => setMotif(e.target.value)} style={{ resize: 'vertical' }} />
        <span className="text-muted sub">{motif.trim().length} / {MOTIF_MAX}{t(' characters · kept with the trace of the erasure; the log names no one')}</span>
      </Field>
      {avantEcheance && (
        <Fine>
          {t('Before the due date, the employer may refuse to erase what the law requires them to keep (art. 17-3-b of the GDPR): Cursus erases at once what comes under no obligation and keeps the rest until its due date, when the file will be offered to you. To examine with the DPO.')}
        </Fine>
      )}
    </Dialog>
  );
}
