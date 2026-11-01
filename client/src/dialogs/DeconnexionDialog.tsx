// Déconnexion avec des saisies encore gardées sur l'appareil (lot 11, chantier C2, t196) : elles seraient perdues (la file
// est purgée à la déconnexion, pour que la personne suivante n'en hérite pas). La personne peut d'abord les envoyer
// (réseau revenu) ou se déconnecter quand même.
import { plural } from '../../../shared/format.ts';
import { CancelButton, Dialog, SubmitButton } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useStore } from '../state/store.tsx';

export function DeconnexionDialog({ n }: { n: number }) {
  const { logout, closeDialog, horsLigne: hl } = useStore();
  const quitter = async () => { closeDialog(); await logout(); };
  return (
    <Dialog title="Se déconnecter" width={480} onSubmit={quitter} actions={<>
      <CancelButton />
      <SubmitButton>Se déconnecter quand même</SubmitButton>
    </>}>
      <p style={{ margin: 0, fontSize: 14 }}>
        {plural(n, 'saisie n’a pas encore été envoyée', 'saisies n’ont pas encore été envoyées')} : la déconnexion {n > 1 ? 'les efface' : 'l’efface'} de cet appareil.
      </p>
      <Fine>{hl.enLigne ? 'Le réseau est revenu : annulez, puis « Envoyer maintenant » depuis le bandeau.' : 'Attendez le retour du réseau pour les envoyer, ou refaites-les plus tard.'}</Fine>
    </Dialog>
  );
}
