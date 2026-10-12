// Affiche le dialogue ouvert (un seul à la fois), quel que soit l'écran d'origine.
import { useStore } from '../state/store.tsx';
import { AbsDialog } from './AbsDialog.tsx';
import { AbsAnnulerDialog } from './AbsAnnulerDialog.tsx';
import { AbsNatureDialog } from './AbsNatureDialog.tsx';
import { AbsProlongerDialog } from './AbsProlongerDialog.tsx';
import { AbsSignalDialog } from './AbsSignalDialog.tsx';
import { BudgetDialog } from './BudgetDialog.tsx';
import { CertDialog } from './CertDialog.tsx';
import { CetDialog } from './CetDialog.tsx';
import { CompteDialog } from './CompteDialog.tsx';
import { EntDialog } from './EntDialog.tsx';
import { EmployeDialog } from './EmployeDialog.tsx';
import { EntPlanDialog } from './EntPlanDialog.tsx';
import { EquipeDialog } from './EquipeDialog.tsx';
import { FormaliteDialog } from './FormaliteDialog.tsx';
import { HabDialog } from './HabDialog.tsx';
import { HabMesureDialog } from './HabMesureDialog.tsx';
import { MembreDialog } from './MembreDialog.tsx';
import { MotDePasseDialog } from './MotDePasseDialog.tsx';
import { MotDePasseProvisoireDialog } from './MotDePasseProvisoireDialog.tsx';
import { PlanDialog } from './PlanDialog.tsx';
import { PlanImportDialog } from './PlanImportDialog.tsx';
import { ReportDialog } from './ReportDialog.tsx';
import { ReqFormDialog } from './ReqFormDialog.tsx';
import { ReqHabDialog } from './ReqHabDialog.tsx';
import { SessionDialog } from './SessionDialog.tsx';
import { TripDialog } from './TripDialog.tsx';
import { TripImportDialog } from './TripImportDialog.tsx';

export function DialogHost() {
  const { dialog: d } = useStore();
  if (!d) return null;
  switch (d.type) {
    case 'plan': return <PlanDialog {...d} />;
    case 'cert': return <CertDialog {...d} />;
    case 'session': return <SessionDialog {...d} />;
    case 'hab': return <HabDialog {...d} />;
    case 'habMesure': return <HabMesureDialog {...d} />;
    case 'trip': return <TripDialog />;
    case 'fo': return <FormaliteDialog {...d} />;
    case 'reqForm': return <ReqFormDialog {...d} />;
    case 'reqHab': return <ReqHabDialog {...d} />;
    case 'employe': return <EmployeDialog {...d} />;
    case 'membre': return <MembreDialog {...d} />;
    case 'equipe': return <EquipeDialog {...d} />;
    case 'abs': return <AbsDialog {...d} />;
    case 'absSignal': return <AbsSignalDialog {...d} />;
    case 'absNature': return <AbsNatureDialog {...d} />;
    case 'absProlonger': return <AbsProlongerDialog {...d} />;
    case 'absAnnuler': return <AbsAnnulerDialog {...d} />;
    case 'cet': return <CetDialog {...d} />;
    case 'report': return <ReportDialog {...d} />;
    case 'entPlan': return <EntPlanDialog {...d} />;
    case 'ent': return <EntDialog {...d} />;
    case 'tripImport': return <TripImportDialog />;
    case 'planImport': return <PlanImportDialog {...d} />;
    case 'budget': return <BudgetDialog {...d} />;
    case 'compte': return <CompteDialog />;
    case 'motDePasseProvisoire': return <MotDePasseProvisoireDialog {...d} />;
    case 'motDePasse': return <MotDePasseDialog />;
  }
}
