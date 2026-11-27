// Aide : guide court par rôle (shared/aide.ts ; version longue et procédure de paie détaillée : docs/GUIDE-UTILISATEUR.md).
// Vue commune comme Confidentialité : ouverte dans tous les espaces (lien sous le menu) et depuis l'écran de connexion,
// sans être connecté ; la page ne lit donc que la session, jamais l'instantané des données. La partie de l'espace ouvert
// s'affiche d'abord ; les autres restent consultables (un manager est aussi collaborateur, la paie suit le groupe pilote).
import { Fragment, useState, type ReactNode } from 'react';
import { A_COMPLETER_PAIE, GUIDE_AIDE, partieParDefaut, type PartieAideId, type RubriqueAide } from '../../../shared/aide.ts';
import { Fine, Page, Panel, Seg } from '../components/ui.tsx';
// lot 11 — pwa : installation de l'application (bouton Android, encart iPhone).
import { InstallerApplication } from '../components/InstallerApplication.tsx';
import { allowedView, useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

/**
 * Texte où la mention « à compléter par le gestionnaire de paie » ressort ; espaces insécables à l'intérieur des guillemets,
 * pour qu'un libellé cité ne se sépare pas de son guillemet en fin de ligne.
 */
function avecMentions(texte: string): ReactNode {
  const morceaux = texte.replace(/« /g, '«\u00a0').replace(/ »/g, '\u00a0»').split(A_COMPLETER_PAIE);
  return morceaux.map((m, i) => (
    <Fragment key={i}>{m}{i < morceaux.length - 1 && <em className="a-completer">{A_COMPLETER_PAIE}</em>}</Fragment>
  ));
}

function Rubrique({ r }: { r: RubriqueAide }) {
  return (
    <Panel title={r.titre}>
      {r.intro && <p className="info-intro">{avecMentions(r.intro)}</p>}
      {r.etapes && <ol className="aide-liste">{r.etapes.map(x => <li key={x}>{avecMentions(x)}</li>)}</ol>}
      {r.points && <ul className="aide-liste">{r.points.map(x => <li key={x}>{avecMentions(x)}</li>)}</ul>}
    </Panel>
  );
}

export function Aide() {
  const { session, go } = useStore();
  const user = session?.user ?? null;
  const [partie, setPartie] = useState<PartieAideId>(() => partieParDefaut(user ? session!.role : null, user?.profilRh));
  const p = GUIDE_AIDE.find(x => x.id === partie) ?? GUIDE_AIDE[0];
  // Rubriques réparties sur deux colonnes, dans l'ordre (la première moitié à gauche).
  const moitie = Math.ceil(p.rubriques.length / 2);
  // Sans connexion : retour à l'écran de connexion (toute vue autre que celle-ci l'affiche).
  const retour = () => go(allowedView(session?.role ?? 'rh', ''));

  return (
    <Page kicker={t('User guide')} title={t('Help')}
      note={t('The gestures of each role in Cursus, the monthly payroll procedure and the gradual opening to the pilot group.')}
      actions={!user && <a className="btn btn-secondary" href="/" onClick={e => { e.preventDefault(); retour(); }}>{t('Back to the sign-in')}</a>}>
      <Seg name="aide-partie" label={t('Part of the guide')} value={p.id} onChange={setPartie} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
        options={GUIDE_AIDE.map(x => [x.id, x.court] as [PartieAideId, string])} />
      <p className="info-intro">{p.pour}</p>
      <InstallerApplication />
      <div className="row-wrap">
        <div className="col-stack" style={{ flex: '1 1 480px' }}>
          {p.rubriques.slice(0, moitie).map(r => <Rubrique key={r.titre} r={r} />)}
        </div>
        <div className="col-stack" style={{ flex: '1 1 380px' }}>
          {p.rubriques.slice(moitie).map(r => <Rubrique key={r.titre} r={r} />)}
        </div>
      </div>
      <Fine>
        {t('A question, a remark from the pilot group: ask HR. Detailed version of this guide, with the payroll procedure step by step: docs/GUIDE-UTILISATEUR.md, handed over by HR.')}
      </Fine>
    </Page>
  );
}
