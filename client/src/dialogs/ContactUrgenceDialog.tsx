// Contact d'urgence (t068, `employe.contactUrgence`) : personne à prévenir et son téléphone, facultatifs. Le salarié le
// saisit depuis son portail ; le service RH peut le saisir pour lui depuis la fiche. Vu du service RH et de l'intéressé
// seulement, jamais du manager (server/src/dataset.ts). Champs vidés ensemble : contact retiré.
import { useState } from 'react';
import { controlerContactUrgence } from '../../../shared/rules/vigilance.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function ContactUrgenceDialog({ empId }: { empId: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const { espaceRh } = useRole();
  const e = d.emp(empId);
  const [nom, setNom] = useState(e?.urgenceNom ?? '');
  const [tel, setTel] = useState(e?.urgenceTel ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!e) return null;

  const { erreurs } = controlerContactUrgence(nom, tel);
  const inchange = nom.trim() === (e.urgenceNom ?? '') && tel.trim() === (e.urgenceTel ?? '');

  const confirm = async () => {
    if (busy || !v.verifier(erreurs.nom, erreurs.tel)) return;
    if (inchange) { closeDialog(); return; }
    setBusy(true);
    const r = await run('employe.contactUrgence', { empId, nom, telephone: tel });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t('Emergency contact')} width={480} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Save')}</SubmitButton>
    </>}>
      {espaceRh && <Field label={t('Employee')}><Static>{e.nom} · {e.poste}</Static></Field>}
      <Field label={t('Person to notify (and relationship)')} htmlFor="cu-nom" erreur={nom.trim() ? erreurs.nom ?? null : v.erreur(erreurs.nom)}>
        <input className="input" id="cu-nom" type="text" autoFocus maxLength={120} value={nom} placeholder={t('Nadia Benali (sister)')} onChange={ev => setNom(ev.target.value)} />
      </Field>
      <Field label={t('Phone')} htmlFor="cu-tel" erreur={tel.trim() ? erreurs.tel ?? null : v.erreur(erreurs.tel)}>
        <input className="input" id="cu-tel" type="tel" inputMode="tel" maxLength={30} value={tel} placeholder="+33 6 12 34 56 78" onChange={ev => setTel(ev.target.value)} style={{ maxWidth: 240 }} />
      </Field>
      <Fine>
        {t('Optional: useful when travelling as on site. Only HR sees it, never the manager; empty both fields to remove it. Mentioned on the Privacy page and included in the copy of your data.')}
      </Fine>
    </Dialog>
  );
}
