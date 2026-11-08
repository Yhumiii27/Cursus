// lot 14 — page publique de pré-déclaration (`/declarer/<jeton>`, hors session : rendue par client/src/main.tsx sans le
// magasin ni l'instantané). L'entreprise extérieure ou l'agence d'intérim déclare une personne et sa venue ; le service RH
// valide. Seules les routes GET et POST /api/declaration/<jeton> sont appelées (server/src/declarations.ts) ; information
// des personnes déclarées (art. 13 et 14 du RGPD) : responsable du traitement et DPO lus sur GET /api/confidentialite.
import { useEffect, useState } from 'react';
import { erreursDeclaration, normaliserDeclaration, OBJET_MAX } from '../../../shared/rules/declarations-presence.ts';
import { TEXTE_MAX } from '../../../shared/rules/personnes-site.ts';

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
      if (!r) return setErreurLien('Cursus est injoignable : réessayez plus tard.');
      const corps = await r.json().catch(() => ({}));
      if (!r.ok) return setErreurLien(corps.error ?? 'Lien de déclaration introuvable.');
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
    if (!r || !r.ok) return setErreur(corps.error ?? 'Envoi impossible : réessayez plus tard.');
    setFaites(x => [{ ref: corps.ref, nom: `${saisie.prenom} ${saisie.nom}` }, ...x]);
    // Même entreprise, même site et mêmes dates : la déclaration suivante ne demande que la personne.
    setF(x => ({ ...x, nom: '', prenom: '', email: '' }));
  };

  if (erreurLien) {
    return <main className="declarer"><h1>Déclaration de présence sur site</h1><p role="alert">{erreurLien}</p></main>;
  }
  if (!lien) return <main className="declarer"><p>Chargement…</p></main>;
  const agence = lien.categorie === 'interimaire';
  if (lien.sites.length === 0) {
    return <main className="declarer"><h1>Déclaration de présence sur site</h1><p role="alert">Aucun site n’est ouvert aux déclarations : contactez le service RH.</p></main>;
  }
  return (
    <main className="declarer">
      <h1>Déclaration de présence sur site</h1>
      <p className="text-muted">{agence ? 'Agence d’intérim' : 'Entreprise'} : <strong>{lien.entreprise}</strong></p>
      <p>
        Déclarez chaque personne {agence ? 'que vous mettez à disposition' : 'que vous enverrez sur site'}, avant sa venue. Le service RH
        vérifie la déclaration puis la valide : la personne est alors attendue au poste de garde. Une personne déjà venue garde son
        matricule de site.
      </p>
      <form onSubmit={envoyer} noValidate>
        <div className="declarer-grille">
          <label>Nom<input className="input" required maxLength={TEXTE_MAX} autoComplete="off" {...champ('nom')} /></label>
          <label>Prénom<input className="input" required maxLength={TEXTE_MAX} autoComplete="off" {...champ('prenom')} /></label>
          <label className="declarer-large">Adresse e-mail professionnelle (facultative)<input className="input" type="email" autoComplete="off" {...champ('email')} /></label>
          <label className="declarer-large">Site
            <select className="input" {...champ('siteCode')}>
              {lien.sites.map(s => <option key={s.code} value={s.code}>{s.libelle}</option>)}
            </select>
          </label>
          <label>Du<input className="input" type="date" min={lien.today} {...champ('du')} /></label>
          <label>Au<input className="input" type="date" min={f.du || lien.today} {...champ('au')} /></label>
          <label className="declarer-large">Objet de la venue<textarea className="input" rows={3} maxLength={OBJET_MAX} {...champ('objet')} /></label>
          {/* Champ piège : invisible, jamais rempli par une personne. */}
          <label className="declarer-piege" aria-hidden="true">Site web<input tabIndex={-1} autoComplete="off" {...champ('siteWeb')} /></label>
        </div>
        {erreur && <p className="text-danger" role="alert">{erreur}</p>}
        <button className="btn btn-primary" type="submit" disabled={envoi === 'encours'}>{envoi === 'encours' ? 'Envoi…' : 'Déclarer'}</button>
      </form>
      {faites.length > 0 && (
        <section aria-live="polite">
          <h2>Déclarations envoyées</h2>
          <ul>{faites.map(x => <li key={x.ref}>{x.ref} — {x.nom} : à valider par le service RH</li>)}</ul>
        </section>
      )}
      <section className="declarer-info">
        <h2>Vos données</h2>
        <p>
          Ces informations servent à préparer l’accueil sur site et le contrôle des titres et habilitations de la personne. Elles sont
          lues par le service RH{contacts.responsable ? ` de ${contacts.responsable}` : ''} et, une fois la déclaration validée, par
          l’outil QHSE (poste de garde, sécurité du site). Une déclaration refusée ou restée sans suite est effacée
          {` ${lien.conservationMois} mois`} après. Informez la personne déclarée de cette transmission.
          {contacts.dpo ? ` Pour exercer ses droits : ${contacts.dpo}.` : ' Pour exercer ses droits : le service RH.'}
        </p>
      </section>
    </main>
  );
}
