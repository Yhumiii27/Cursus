// Paramètres → Confidentialité : coordonnées du responsable du traitement et du délégué à la protection des données,
// affichées sur la page Confidentialité (lisible de tous, connexion comprise). Administrateur RH ; les autres profils
// consultent. Vides, la page renvoie au service RH. Texte libre, hors du journal (seuls les champs modifiés y sont
// nommés) : action `confidentialite.regler`, clé `confidentialite` de la table settings.
import { useCallback, useEffect, useState } from 'react';
import { CONTACTS_VIDES, controleContact, type ContactsConfidentialite } from '../../../../shared/confidentialite.ts';
import { api } from '../../api.ts';
import { oublierEnteteEmployeur } from '../../print.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import type { SectionProps } from './commun.ts';
import { t } from '../../i18n/langue.ts';

interface Form { responsable: string; dpo: string }
const formDe = (c: ContactsConfidentialite): Form => ({ responsable: c.responsable ?? '', dpo: c.dpo ?? '' });
const erreurDe = (v: string, libelle: string) => { const c = controleContact(v, libelle); return 'erreur' in c ? c.erreur : null; };

export function Rgpd(_: SectionProps) {
  const { admin } = useRole();
  const { run, go, notify } = useStore();
  const [enVigueur, setEnVigueur] = useState<ContactsConfidentialite | null>(null);
  const [f, setF] = useState<Form>(formDe(CONTACTS_VIDES));
  const [busy, setBusy] = useState(false);
  const charger = useCallback(() => api.confidentialite().then(c => { setEnVigueur(c); setF(formDe(c)); })
    .catch((err: Error) => notify(`${t('Contact details of the Privacy page unavailable — ')}${err.message}`, true)), [notify]);
  useEffect(() => { charger(); }, [charger]);

  const erreurs = { responsable: erreurDe(f.responsable, t('Data controller')), dpo: erreurDe(f.dpo, t('Data protection officer')) };
  const dirty = !!enVigueur && JSON.stringify(f) !== JSON.stringify(formDe(enVigueur));
  const enregistrer = async () => {
    if (erreurs.responsable || erreurs.dpo) return;
    setBusy(true);
    const r = await run('confidentialite.regler', { responsable: f.responsable, dpo: f.dpo });
    setBusy(false);
    if (!r.ok) return;
    // Le responsable du traitement sert d'en-tête aux documents imprimés : relu à la prochaine impression.
    oublierEnteteEmployeur();
    await charger();
  };

  return (
    <Panel title={t('Privacy')} style={{ gap: 'var(--space-4)' }}>
      <Fine>
        {t('Contact details shown on the ')}<a href="/confidentialite" onClick={e => { e.preventDefault(); go('confidentialite'); }}>{t('Privacy')}</a>{t(', open to all employees from their space and from the sign-in screen. Not filled in, the page refers to HR.')}
      </Fine>
      <Field label={t('Data controller')} htmlFor="conf-responsable" erreur={erreurs.responsable}>
        <textarea className="input short" id="conf-responsable" rows={2} disabled={!admin || !enVigueur}
          placeholder={t('Company name, address of the head office, legal representative')} value={f.responsable} onChange={e => setF({ ...f, responsable: e.target.value })} />
      </Field>
      <Field label={t('Data protection officer (DPO)')} htmlFor="conf-dpo" erreur={erreurs.dpo}>
        <textarea className="input short" id="conf-dpo" rows={2} disabled={!admin || !enVigueur}
          placeholder={t('Name, e-mail or postal address')} value={f.dpo} onChange={e => setF({ ...f, dpo: e.target.value })} />
      </Field>
      <Fine>{t('Neither the text of the page nor these contact details replace the record of processing activities: full description in docs/RGPD.md, to complete with the DPO.')}</Fine>
      {admin && (
        <div className="actions-end">
          <Btn variant="primary" disabled={!dirty || busy} onClick={enregistrer}>{t('Save the contact details')}</Btn>
        </div>
      )}
    </Panel>
  );
}
