// Paramètres → Confidentialité : coordonnées du responsable du traitement et du délégué à la protection des données,
// affichées sur la page Confidentialité (lisible de tous, connexion comprise). Administrateur RH ; les autres profils
// consultent. Vides, la page renvoie au service RH. Texte libre, hors du journal (seuls les champs modifiés y sont
// nommés) : action `confidentialite.regler`, clé `confidentialite` de la table settings.
import { useCallback, useEffect, useState } from 'react';
import { CONTACTS_VIDES, controleContact, type ContactsConfidentialite } from '../../../../shared/confidentialite.ts';
import { api } from '../../api.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import type { SectionProps } from './commun.ts';

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
    .catch((err: Error) => notify(`Coordonnées de la page Confidentialité indisponibles — ${err.message}`, true)), [notify]);
  useEffect(() => { charger(); }, [charger]);

  const erreurs = { responsable: erreurDe(f.responsable, 'Responsable du traitement'), dpo: erreurDe(f.dpo, 'Délégué à la protection des données') };
  const dirty = !!enVigueur && JSON.stringify(f) !== JSON.stringify(formDe(enVigueur));
  const enregistrer = async () => {
    if (erreurs.responsable || erreurs.dpo) return;
    setBusy(true);
    const r = await run('confidentialite.regler', { responsable: f.responsable, dpo: f.dpo });
    setBusy(false);
    if (r.ok) await charger();
  };

  return (
    <Panel title="Confidentialité" style={{ gap: 'var(--space-4)' }}>
      <Fine>
        Coordonnées affichées sur la page <a href="/confidentialite" onClick={e => { e.preventDefault(); go('confidentialite'); }}>Confidentialité</a>,
        ouverte à tous les salariés depuis leur espace et depuis l’écran de connexion. Non renseignées, la page renvoie au service RH.
      </Fine>
      <Field label="Responsable du traitement" htmlFor="conf-responsable" erreur={erreurs.responsable}>
        <textarea className="input short" id="conf-responsable" rows={2} disabled={!admin || !enVigueur}
          placeholder="Raison sociale, adresse du siège, représentant légal" value={f.responsable} onChange={e => setF({ ...f, responsable: e.target.value })} />
      </Field>
      <Field label="Délégué à la protection des données (DPO)" htmlFor="conf-dpo" erreur={erreurs.dpo}>
        <textarea className="input short" id="conf-dpo" rows={2} disabled={!admin || !enVigueur}
          placeholder="Nom, adresse e-mail ou postale" value={f.dpo} onChange={e => setF({ ...f, dpo: e.target.value })} />
      </Field>
      <Fine>Ni le texte de la page ni ces coordonnées ne remplacent le registre des traitements : descriptif complet dans docs/RGPD.md, à compléter avec le DPO.</Fine>
      {admin && (
        <div className="actions-end">
          <Btn variant="primary" disabled={!dirty || busy} onClick={enregistrer}>Enregistrer les coordonnées</Btn>
        </div>
      )}
    </Panel>
  );
}
