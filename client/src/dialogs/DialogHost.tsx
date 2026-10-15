// Affiche le dialogue ouvert (un seul à la fois), quel que soit l'écran d'origine. Une erreur de rendu du
// dialogue affiche un message à sa place ; la page derrière reste intacte.
import { ErreurDialogue, ErreurRendu } from '../components/ErreurRendu.tsx';
import { useStore, type DialogState } from '../state/store.tsx';
import { AbsDialog } from './AbsDialog.tsx';
import { AbsAnnulerDialog } from './AbsAnnulerDialog.tsx';
import { AbsNatureDialog } from './AbsNatureDialog.tsx';
import { AbsProlongerDialog } from './AbsProlongerDialog.tsx';
import { AbsSignalDialog } from './AbsSignalDialog.tsx';
import { BudgetDialog } from './BudgetDialog.tsx';
import { CertDialog } from './CertDialog.tsx';
import { CetDialog } from './CetDialog.tsx';
import { ClotureCongesDialog } from './ClotureCongesDialog.tsx';
import { ClotureDialog } from './ClotureDialog.tsx';
import { CompteDialog } from './CompteDialog.tsx';
import { DetachementDialog } from './DetachementDialog.tsx';
import { ConfirmerDialog } from './ConfirmerDialog.tsx';
import { EntDialog } from './EntDialog.tsx';
import { EmployeDialog } from './EmployeDialog.tsx';
import { EntPlanDialog } from './EntPlanDialog.tsx';
import { EquipeDialog } from './EquipeDialog.tsx';
import { ExerciceClotureDialog } from './ExerciceClotureDialog.tsx';
import { FormaliteDialog } from './FormaliteDialog.tsx';
import { HabDialog } from './HabDialog.tsx';
import { HabMesureDialog } from './HabMesureDialog.tsx';
import { MembreDialog } from './MembreDialog.tsx';
import { MotDePasseDialog } from './MotDePasseDialog.tsx';
import { MotDePasseProvisoireDialog } from './MotDePasseProvisoireDialog.tsx';
import { PlanDialog } from './PlanDialog.tsx';
import { PlanImportDialog } from './PlanImportDialog.tsx';
import { RefDestinationDialog } from './RefDestinationDialog.tsx';
import { RefFormationDialog } from './RefFormationDialog.tsx';
import { RefHabilitationDialog } from './RefHabilitationDialog.tsx';
import { PlanRealiserDialog } from './PlanRealiserDialog.tsx';
import { RemiseDialog } from './RemiseDialog.tsx';
import { ReportDialog } from './ReportDialog.tsx';
import { ReqFormDialog } from './ReqFormDialog.tsx';
import { ReqHabDialog } from './ReqHabDialog.tsx';
import { RubriqueDialog } from './RubriqueDialog.tsx';
import { SessionDetailDialog } from './SessionDetailDialog.tsx';
import { SessionDialog } from './SessionDialog.tsx';
import { SortieDialog } from './SortieDialog.tsx';
import { TripDialog } from './TripDialog.tsx';
import { TripImportDialog } from './TripImportDialog.tsx';
import { AvisDialog } from './AvisDialog.tsx';
import { VisiteDialog } from './VisiteDialog.tsx';

export function DialogHost() {
  const { dialog: d } = useStore();
  if (!d) return null;
  return (
    <ErreurRendu cle={d} repli={(erreur, reessayer) => <ErreurDialogue erreur={erreur} reessayer={reessayer} />}>
      <Dialogue d={d} />
    </ErreurRendu>
  );
}

function Dialogue({ d }: { d: DialogState }) {
  switch (d.type) {
    case 'plan': return <PlanDialog {...d} />;
    case 'cert': return <CertDialog {...d} />;
    case 'session': return <SessionDialog {...d} />;
    case 'sessionDetail': return <SessionDetailDialog {...d} />;
    case 'cloture': return <ClotureDialog {...d} />;
    case 'hab': return <HabDialog {...d} />;
    case 'habMesure': return <HabMesureDialog {...d} />;
    case 'trip': return <TripDialog />;
    case 'fo': return <FormaliteDialog {...d} />;
    case 'detachement': return <DetachementDialog {...d} />;
    case 'visite': return <VisiteDialog {...d} />;
    case 'avis': return <AvisDialog {...d} />;
    case 'reqForm': return <ReqFormDialog {...d} />;
    case 'reqHab': return <ReqHabDialog {...d} />;
    case 'employe': return <EmployeDialog {...d} />;
    case 'sortie': return <SortieDialog {...d} />;
    case 'membre': return <MembreDialog {...d} />;
    case 'equipe': return <EquipeDialog {...d} />;
    case 'abs': return <AbsDialog {...d} />;
    case 'absSignal': return <AbsSignalDialog {...d} />;
    case 'absNature': return <AbsNatureDialog {...d} />;
    case 'absProlonger': return <AbsProlongerDialog {...d} />;
    case 'absAnnuler': return <AbsAnnulerDialog {...d} />;
    case 'cet': return <CetDialog {...d} />;
    case 'report': return <ReportDialog {...d} />;
    case 'clotureConges': return <ClotureCongesDialog {...d} />;
    case 'entPlan': return <EntPlanDialog {...d} />;
    case 'ent': return <EntDialog {...d} />;
    case 'entRemise': return <RemiseDialog {...d} />;
    case 'planRealiser': return <PlanRealiserDialog {...d} />;
    case 'exerciceCloture': return <ExerciceClotureDialog {...d} />;
    case 'tripImport': return <TripImportDialog />;
    case 'planImport': return <PlanImportDialog {...d} />;
    case 'budget': return <BudgetDialog {...d} />;
    case 'compte': return <CompteDialog />;
    case 'motDePasseProvisoire': return <MotDePasseProvisoireDialog {...d} />;
    case 'motDePasse': return <MotDePasseDialog />;
    case 'refFormation': return <RefFormationDialog {...d} />;
    case 'refHabilitation': return <RefHabilitationDialog {...d} />;
    case 'refDestination': return <RefDestinationDialog {...d} />;
    case 'rubrique': return <RubriqueDialog {...d} />;
    case 'confirmer': return <ConfirmerDialog c={d.c} />;
  }
}
