// Contact d'urgence (t068, `employe.contactUrgence`) : personne à prévenir et son téléphone, facultatifs. Le salarié le
// saisit depuis son portail ; le service RH peut le saisir pour lui depuis la fiche. Vu du service RH et de l'intéressé
// seulement, jamais du manager (server/src/dataset.ts). Champs vidés ensemble : contact retiré.
import { useState } from 'react';
import { controlerContactUrgence } from '../../../shared/rules/vigilance.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

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
    <Dialog title="Contact d’urgence" width={480} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer</SubmitButton>
    </>}>
      {espaceRh && <Field label="Collaborateur"><Static>{e.nom} · {e.poste}</Static></Field>}
      <Field label="Personne à prévenir (et lien)" htmlFor="cu-nom" erreur={nom.trim() ? erreurs.nom ?? null : v.erreur(erreurs.nom)}>
        <input className="input" id="cu-nom" type="text" autoFocus maxLength={120} value={nom} placeholder="Nadia Benali (sœur)" onChange={ev => setNom(ev.target.value)} />
      </Field>
      <Field label="Téléphone" htmlFor="cu-tel" erreur={tel.trim() ? erreurs.tel ?? null : v.erreur(erreurs.tel)}>
        <input className="input" id="cu-tel" type="tel" inputMode="tel" maxLength={30} value={tel} placeholder="+33 6 12 34 56 78" onChange={ev => setTel(ev.target.value)} style={{ maxWidth: 240 }} />
      </Field>
      <Fine>
        Facultatif : utile en déplacement comme sur le site. Seul le service RH le voit, jamais le manager ; videz les deux champs pour le retirer.
        Mentionné dans la page Confidentialité et compris dans la copie de vos données.
      </Fine>
    </Dialog>
  );
}
