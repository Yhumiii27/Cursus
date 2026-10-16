// Confidentialité : information des salariés sur le traitement de leurs données (art. 13 du RGPD). Ouverte depuis tous
// les espaces (lien sous le menu) et depuis l'écran de connexion, sans être connecté : la page ne lit donc que la session,
// jamais l'instantané des données. Texte : INFO_CONFIDENTIALITE de shared/confidentialite.ts (modèle à faire valider par
// le DPO, mentions « à compléter par le DPO ») ; responsable du traitement et contact du DPO : GET /api/confidentialite,
// réglés par l'administrateur RH (Paramètres → Confidentialité). Non renseignés, la page renvoie au service RH.
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { droitsRh } from '../../../shared/constants.ts';
import { A_COMPLETER, INFO_CONFIDENTIALITE, type ContactsConfidentialite, type RubriqueConfidentialite } from '../../../shared/confidentialite.ts';
import { api } from '../api.ts';
import { Fine, Page, Panel } from '../components/ui.tsx';
import { allowedView, useStore } from '../state/store.tsx';

/** Rubriques de la colonne de gauche (ce que fait Cursus) ; les autres (qui, combien de temps, vos droits) à droite. */
const GAUCHE = new Set(['finalites', 'donnees', 'bases']);

/** Texte où la mention « à compléter par le DPO » ressort. */
function avecMentions(texte: string): ReactNode {
  const morceaux = texte.split(A_COMPLETER);
  return morceaux.map((m, i) => (
    <Fragment key={i}>{m}{i < morceaux.length - 1 && <em className="a-completer">{A_COMPLETER}</em>}</Fragment>
  ));
}

function Rubrique({ r }: { r: RubriqueConfidentialite }) {
  return (
    <Panel title={r.titre}>
      {r.intro && <p className="info-intro">{r.intro}</p>}
      <dl className="info-points">
        {r.points.map(([terme, texte]) => (
          <div key={terme}><dt>{terme}</dt><dd>{avecMentions(texte)}</dd></div>
        ))}
      </dl>
    </Panel>
  );
}

/** Coordonnée réglée par l'administrateur RH, sur plusieurs lignes au besoin (adresse). */
const Lignes = ({ texte }: { texte: string }) => <>{texte.split('\n').map((l, i) => <Fragment key={i}>{i > 0 && <br />}{l}</Fragment>)}</>;

export function Confidentialite() {
  const { session, go } = useStore();
  const user = session?.user ?? null;
  const [contacts, setContacts] = useState<ContactsConfidentialite | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let actif = true;
    api.confidentialite().then(c => { if (actif) setContacts(c); }).catch((err: Error) => { if (actif) setErreur(err.message); });
    return () => { actif = false; };
  }, []);
  const admin = !!user && droitsRh(user).includes('admin');
  // Sans connexion : retour à l'écran de connexion (toute vue autre que celle-ci l'affiche).
  const retour = () => go(allowedView(session?.role ?? 'rh', ''));

  return (
    <Page kicker="Vos données personnelles" title="Confidentialité"
      note="Ce que Cursus enregistre sur vous, pourquoi, qui peut le voir, combien de temps, et comment exercer vos droits."
      actions={!user && <a className="btn btn-secondary" href="/" onClick={e => { e.preventDefault(); retour(); }}>Retour à la connexion</a>}>
      <div className="row-wrap">
        <div className="col-stack" style={{ flex: '1 1 480px' }}>
          <Panel title="Responsable et contact">
            {erreur && <p className="form-error" role="alert">Coordonnées indisponibles — {erreur}</p>}
            <dl className="info-points">
              <div>
                <dt>Responsable du traitement</dt>
                <dd>{contacts?.responsable ? <Lignes texte={contacts.responsable} /> : 'Votre employeur. Pour toute question sur vos données, adressez-vous au service RH.'}</dd>
              </div>
              <div>
                <dt>Délégué à la protection des données</dt>
                <dd>{contacts?.dpo ? <Lignes texte={contacts.dpo} /> : 'Adressez-vous au service RH, qui transmet votre demande à la personne chargée de la protection des données.'}</dd>
              </div>
            </dl>
            {admin && (
              <Fine>
                Coordonnées réglées dans <a href="/parametres" onClick={e => { e.preventDefault(); go('parametres'); }}>Paramètres → Confidentialité</a>.
                Le descriptif complet du traitement, pour le registre et l’analyse d’impact, est dans docs/RGPD.md.
              </Fine>
            )}
          </Panel>
          {INFO_CONFIDENTIALITE.filter(r => GAUCHE.has(r.id)).map(r => <Rubrique key={r.id} r={r} />)}
        </div>
        <div className="col-stack" style={{ flex: '1 1 380px' }}>
          {INFO_CONFIDENTIALITE.filter(r => !GAUCHE.has(r.id)).map(r => <Rubrique key={r.id} r={r} />)}
        </div>
      </div>
    </Page>
  );
}
