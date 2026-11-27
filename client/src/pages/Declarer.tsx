// lot 14 — page publique de pré-déclaration (`/declarer/<jeton>`, hors session : rendue par client/src/main.tsx sans le
// magasin ni l'instantané). L'entreprise extérieure ou l'agence d'intérim déclare une personne et sa venue ; le service RH
// valide. Seules les routes GET et POST /api/declaration/<jeton> sont appelées (server/src/declarations.ts) ; information
// des personnes déclarées (art. 13 et 14 du RGPD) : responsable du traitement et DPO lus sur GET /api/confidentialite.
import { useEffect, useState } from 'react';
import { erreursDeclaration, normaliserDeclaration, OBJET_MAX } from '../../../shared/rules/declarations-presence.ts';
import { TEXTE_MAX } from '../../../shared/rules/personnes-site.ts';
import { t } from '../i18n/langue.ts';

interface Lien { entreprise: string; categorie: 'exterieur' | 'interimaire'; sites: { code: string; libelle: string }[]; today: string; conservationMois: number }
interface Contacts { responsable?: string | null; dpo?: string | null }

const VIDE = { nom: '', prenom: '', email: '', siteCode: '', du: '', au: '', objet: '', siteWeb: '' };

export function Declarer({ jeton }: { jeton: string }) {
  const [lien, setLien] = useState<Lien | null>(null);
  const [erreurLien, setErreurLien] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contacts>({});
  const [f, setF] = useState(VIDE);
  const [envoi, setEnvoi] = useState<'non' | 'encours'>('non');
  const [erreur, setErreur] = useState<string | null>(null);
  const [faites, setFaites] = useState<{ ref: string; nom: string }[]>([]);

  useEffect(() => {
    void (async () => {
      const r = await fetch(`/api/declaration/${encodeURIComponent(jeton)}`, { headers: { accept: 'application/json' } }).catch(() => null);
      if (!r) return setErreurLien(t('Cursus cannot be reached: try again later.'));
      const corps = await r.json().catch(() => ({}));
      if (!r.ok) return setErreurLien(corps.error ?? t('Declaration link not found.'));
      setLien(corps as Lien);
      setF(x => ({ ...x, siteCode: (corps as Lien).sites[0]?.code ?? '' }));
    })();
    void fetch('/api/confidentialite').then(r => (r.ok ? r.json() : {})).then(c => setContacts(c as Contacts)).catch(() => undefined);
  }, [jeton]);

  const saisie = normaliserDeclaration(f);
  const erreurs = lien ? erreursDeclaration(saisie, { today: lien.today, sites: lien.sites.map(s => s.code) }) : [];
  const champ = (k: keyof typeof VIDE) => ({ value: f[k], onChange: (ev: { target: { value: string } }) => setF(x => ({ ...x, [k]: ev.target.value })) });

  const envoyer = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (envoi === 'encours') return;
    if (erreurs.length) return setErreur(erreurs[0]);
    setEnvoi('encours');
    setErreur(null);
    const r = await fetch(`/api/declaration/${encodeURIComponent(jeton)}`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ...saisie, siteWeb: f.siteWeb }),
    }).catch(() => null);
    setEnvoi('non');
    const corps = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) return setErreur(corps.error ?? t('Sending impossible: try again later.'));
    setFaites(x => [{ ref: corps.ref, nom: `${saisie.prenom} ${saisie.nom}` }, ...x]);
    // Même entreprise, même site et mêmes dates : la déclaration suivante ne demande que la personne.
    setF(x => ({ ...x, nom: '', prenom: '', email: '' }));
  };

  if (erreurLien) {
    return <main className="declarer"><h1>{t('Declaration of presence on site')}</h1><p role="alert">{erreurLien}</p></main>;
  }
  if (!lien) return <main className="declarer"><p>{t('Loading…')}</p></main>;
  const agence = lien.categorie === 'interimaire';
  if (lien.sites.length === 0) {
    return <main className="declarer"><h1>{t('Declaration of presence on site')}</h1><p role="alert">{t('No site is open to declarations: contact HR.')}</p></main>;
  }
  return (
    <main className="declarer">
      <h1>{t('Declaration of presence on site')}</h1>
      <p className="text-muted">{t(agence ? 'Temporary work agency' : 'Company')}{t(': ')}<strong>{lien.entreprise}</strong></p>
      <p>
        {t(agence ? 'Declare each person you make available, before their visit.' : 'Declare each person you will send on site, before their visit.')}
        {' '}{t('HR checks the declaration then approves it: the person is then expected at the gatehouse. A person who has already come keeps their site number.')}
      </p>
      <form onSubmit={envoyer} noValidate>
        <div className="declarer-grille">
          <label>{t('Last name')}<input className="input" required maxLength={TEXTE_MAX} autoComplete="off" {...champ('nom')} /></label>
          <label>{t('First name')}<input className="input" required maxLength={TEXTE_MAX} autoComplete="off" {...champ('prenom')} /></label>
          <label className="declarer-large">{t('Work e-mail address (optional)')}<input className="input" type="email" autoComplete="off" {...champ('email')} /></label>
          <label className="declarer-large">{t('Site')}
            <select className="input" {...champ('siteCode')}>
              {lien.sites.map(s => <option key={s.code} value={s.code}>{s.libelle}</option>)}
            </select>
          </label>
          <label>{t('From#date')}<input className="input" type="date" min={lien.today} {...champ('du')} /></label>
          <label>{t('To#date-cap')}<input className="input" type="date" min={f.du || lien.today} {...champ('au')} /></label>
          <label className="declarer-large">{t('Purpose of the visit')}<textarea className="input" rows={3} maxLength={OBJET_MAX} {...champ('objet')} /></label>
          {/* Champ piège : invisible, jamais rempli par une personne. */}
          <label className="declarer-piege" aria-hidden="true">{t('Website')}<input tabIndex={-1} autoComplete="off" {...champ('siteWeb')} /></label>
        </div>
        {erreur && <p className="text-danger" role="alert">{erreur}</p>}
        <button className="btn btn-primary" type="submit" disabled={envoi === 'encours'}>{t(envoi === 'encours' ? 'Sending…' : 'Declare')}</button>
      </form>
      {faites.length > 0 && (
        <section aria-live="polite">
          <h2>{t('Declarations sent')}</h2>
          <ul>{faites.map(x => <li key={x.ref}>{x.ref} — {x.nom}{t(': to approve by HR')}</li>)}</ul>
        </section>
      )}
      <section className="declarer-info">
        <h2>{t('Your data')}</h2>
        <p>
          {t('This information serves to prepare the welcome on site and the check of the titles and authorisations of the person. It is read by HR')}{contacts.responsable ? `${t(' of #org')}${contacts.responsable}` : ''}{t(' and, once the declaration is approved, by the QHSE tool (gatehouse, site safety). A declaration refused or left without follow-up is erased')}
          {` ${lien.conservationMois}${t(' months after. Inform the declared person of this transmission.')}`}
          {contacts.dpo ? `${t(' To exercise their rights: ')}${contacts.dpo}.` : t(' To exercise their rights: HR.')}
        </p>
      </section>
    </main>
  );
}
