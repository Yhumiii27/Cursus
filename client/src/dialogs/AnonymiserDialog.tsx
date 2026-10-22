// Effacement des données échues d'un ou plusieurs salariés sortis, ou anonymisation de leur dossier (t016, administrateur
// RH, Paramètres → Conservation des dossiers) : « Cursus propose, le RH confirme ». Le dialogue liste, pour chaque dossier,
// ce qui sera effacé ; un motif est exigé (gardé avec la trace de l'effacement, jamais au journal). `avantEcheance` : droit
// à l'effacement exercé par un salarié sorti avant l'échéance, dossier anonymisé en entier. Irréversible : les sauvegardes
// gardent les données jusqu'à leur rotation.
import { useState } from 'react';
import { fmtIso, plural } from '../../../shared/format.ts';
import { CATEGORIES_CONSERVATION, CATEGORIES } from '../../../shared/rules/conservation.ts';
import type { CategorieConservation } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, NoteAccent, Tag } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

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
    const categories: CategorieConservation[] = avantEcheance ? CATEGORIES : echus.get(id)?.categories ?? [];
    return { id, nom: e?.nom ?? `n° ${id}`, fin: e?.fin ?? null, categories, anonymise: avantEcheance || categories.includes('dossier') };
  });
  const anonymises = dossiers.filter(x => x.anonymise).length;
  const erreur = !motif.trim() ? 'Indiquez le motif : décision du DPO, demande du salarié…' : null;

  const confirmer = async () => {
    if (busy || !v.verifier(erreur)) return;
    setBusy(true);
    const r = await run('employe.anonymiser', { ids, motif: motif.trim(), ...(avantEcheance ? { avantEcheance: true } : {}) });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  const titre = avantEcheance ? 'Droit à l’effacement' : anonymises === dossiers.length && anonymises ? `Anonymiser ${plural(anonymises, 'dossier', 'dossiers')}` : 'Effacer les données échues';
  return (
    <Dialog title={titre} width={620} onSubmit={confirmer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Effacer définitivement</SubmitButton>
    </>}>
      <NoteAccent>
        Effacement définitif : rien ne pourra être rétabli depuis Cursus. Les sauvegardes gardent ces données jusqu’à leur rotation
        (restaurer une copie antérieure les ferait revenir).
      </NoteAccent>
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', margin: 0, padding: 0, listStyle: 'none' }}>
        {dossiers.map(x => (
          <li key={x.id} className="boxed">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14 }}>{x.nom}</span>
              {x.fin && <span className="text-muted sub">sorti le {fmtIso(x.fin)}</span>}
              <Tag cls={x.anonymise ? 'tag-accent' : 'tag-outline'}>{x.anonymise ? 'Anonymisation du dossier' : 'Effacement partiel'}</Tag>
            </div>
            <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-5)' }}>
              {(x.anonymise ? ['dossier' as const] : x.categories).map(c => (
                <li key={c} className="text-muted sub">
                  <strong>{CATEGORIES_CONSERVATION[c].label}</strong> : {CATEGORIES_CONSERVATION[c].effacement}
                  {c === 'dossier' && ' ; tout ce qui reste des autres catégories est effacé avec lui'}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <Field label="Motif" htmlFor="anonymiser-motif" requis erreur={v.erreur(erreur)}>
        <textarea className="input mid" id="anonymiser-motif" rows={3} autoFocus maxLength={MOTIF_MAX}
          placeholder={avantEcheance ? 'Demande d’effacement du salarié reçue le …, accord du DPO' : 'Durées fixées par la décision du DPO …'}
          value={motif} onChange={e => setMotif(e.target.value)} style={{ resize: 'vertical' }} />
        <span className="text-muted sub">{motif.trim().length} / {MOTIF_MAX} caractères · gardé avec la trace de l’effacement ; le journal ne nomme personne</span>
      </Field>
      {avantEcheance && (
        <Fine>
          Avant l’échéance, l’effacement reste limité par les obligations de l’employeur (paie, temps de travail, santé au travail) :
          à décider avec le DPO. Les heures, absences, coûts de formation et lots de paie restent, sans nom.
        </Fine>
      )}
    </Dialog>
  );
}
