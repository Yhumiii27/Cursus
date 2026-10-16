// Dialogue ouvert alors que le référentiel qu'il propose est vide (base de production qui démarre, tout archivé) :
// il le dit au lieu de ne rien afficher, et mène à l'écran Référentiels quand la personne peut l'ouvrir.
import { vuesDe } from '../../../shared/constants.ts';
import type { ReferentielId } from '../../../shared/rules/referentiels.ts';
import { useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { CancelButton, Dialog } from './Dialog.tsx';
import { Empty } from './ui.tsx';

/** Écran dont le référentiel est vide (catalogue des formations, habilitations) : le dire, et mener aux référentiels. */
export function CatalogueVide({ onglet, texte }: { onglet: ReferentielId; texte: string }) {
  const { go } = useStore();
  const { user } = useRole();
  const ouvrir = vuesDe(user.role, user.profilRh).includes('referentiels');
  return (
    <div className="card elev-sm panel" style={{ alignItems: 'flex-start' }}>
      <Empty>{ouvrir ? `${texte} Ajoutez-les, ou chargez le référentiel type, dans l’écran Référentiels.` : `${texte} Le service RH les ajoute dans Cursus.`}</Empty>
      {ouvrir && <button type="button" className="btn btn-secondary btn-sm" onClick={() => go('referentiels', { refOnglet: onglet })}>Ouvrir les référentiels</button>}
    </div>
  );
}

export function ReferentielVide({ titre, onglet, texte }: { titre: string; onglet: ReferentielId; texte: string }) {
  const { go, closeDialog } = useStore();
  const { user } = useRole();
  const ouvrir = vuesDe(user.role, user.profilRh).includes('referentiels');
  return (
    <Dialog title={titre} actions={<>
      <CancelButton label="Fermer" />
      {ouvrir && <button type="button" className="btn btn-primary" onClick={() => { closeDialog(); go('referentiels', { refOnglet: onglet }); }}>Ouvrir les référentiels</button>}
    </>}>
      <Empty>{ouvrir ? `${texte} Ajoutez-les dans l’écran Référentiels.` : `${texte} Adressez-vous au service RH.`}</Empty>
    </Dialog>
  );
}
