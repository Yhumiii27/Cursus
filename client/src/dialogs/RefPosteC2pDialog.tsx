// Écran Référentiels, onglet Postes : facteurs d'exposition du compte professionnel de prévention (t052,
// shared/rules/c2p.ts) que Cursus ne mesure pas — travail répétitif, milieu hyperbare, températures extrêmes, bruit —,
// cochés par le service RH ou le référent HSE quand les titulaires du poste y sont exposés au-delà du seuil réglementaire
// après les protections collectives et individuelles. Décochés par défaut ; nuits et équipes alternantes se comptent
// d'après les horaires de poste, elles ne se cochent pas.
import { useState } from 'react';
import { FACTEURS_C2P } from '../../../shared/constants.ts';
import { titulaires } from '../../../shared/rules/exigences.ts';
import { ARTICLE_C2P, FACTEURS_POSTE, facteursDuPoste } from '../../../shared/rules/c2p.ts';
import type { FacteurPoste } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Dialog, SubmitButton } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

export function RefPosteC2pDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  // Poste figé à l'ouverture ; disparu entre-temps : rien à enregistrer.
  const [poste] = useState(() => d.ds.referentiels.postes.find(p => p.id === id) ?? null);
  const [facteurs, setFacteurs] = useState<FacteurPoste[]>(() => facteursDuPoste(poste));
  const [busy, setBusy] = useState(false);
  const n = poste ? titulaires(d.ds, poste.id).length : 0;

  const basculer = (f: FacteurPoste, coche: boolean) => setFacteurs(x => FACTEURS_POSTE.filter(y => (y === f ? coche : x.includes(y))));
  const envoyer = async () => {
    if (busy || !poste) return;
    setBusy(true);
    const r = await run('referentiel.poste.expositions', { id: poste.id, facteurs });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={poste ? `${t('Exposure factors')} · ${poste.nom}` : t('Exposure factors')} width={600} onSubmit={envoyer}
      actions={!poste ? <CancelButton label={t('Close')} /> : <>
        <CancelButton />
        <SubmitButton busy={busy}>{t('Save')}</SubmitButton>
      </>}>
      {!poste ? <Bloquant>{t('This job no longer exists.')}</Bloquant> : <>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <legend className="sr-only">{t('Exposure factors beyond the threshold, after protection')}</legend>
          {FACTEURS_POSTE.map(f => (
            <label key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', fontSize: 14 }}>
              <input type="checkbox" checked={facteurs.includes(f)} onChange={e => basculer(f, e.target.checked)} style={{ accentColor: 'var(--color-accent)', marginTop: 3 }} />
              <span>
                {FACTEURS_C2P[f].label}
                <span className="text-muted sub" style={{ display: 'block' }}>{t('Threshold: ')}{FACTEURS_C2P[f].seuil}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Fine>
          {t('To tick when the holders of the job (')}{tn(n, 'present employee', 'present employees')}{t(') are exposed to it beyond the threshold (')}{ARTICLE_C2P}{t('), given the collective and individual protections, according to the risk assessment (DUERP) or an approved branch reference. Their exposure is that of the job they hold, over their period of the year (Exposures screen). Night work and alternating successive shifts are not ticked: Cursus counts them from the shift schedules.')}
        </Fine>
      </>}
    </Dialog>
  );
}
