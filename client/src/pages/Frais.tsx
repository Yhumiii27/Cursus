// Notes de frais (lot 11, chantier C5, étape 2) : un écran par espace (onglets : components/frais/onglets.ts).
// - Collaborateur (« Mes frais », téléphone d'abord, une colonne) : nouvelle dépense en trois champs et une photo, notes
//   du mois et leur suivi, avances, véhicule personnel. Raccourci « Nouvelle dépense » de l'application installée
//   (/frais?nouveau=1) ; la même dépense rapide s'ouvre aussi depuis la page « Hors ligne ».
// - Manager : notes et avances à valider (équipe directe et délégations « frais », jamais une note médicale), notes de
//   l'équipe avec ses totaux (sans frais médicaux : `totauxEquipe`), ses propres notes.
// - Service RH et comptabilité : notes à contrôler (frais médicaux compris), toutes les notes, avances, exports comptables,
//   tableau de bord, taux des devises (comptabilité ou service RH).
// Module désactivé (réglage notesFraisActives) : l'écran le dit (la comptabilité n'a que cet écran) ; ailleurs, la vue
// est fermée (state/store.tsx).
import { useEffect, type ReactNode } from 'react';
import { CameraIcon, PlusIcon } from '@phosphor-icons/react';
import { droitsRh } from '../../../shared/constants.ts';
import { totauxEquipeVue } from '../../../shared/rules/frais-fenetre.ts';
import { Btn, Empty, Fine, Kpi, Kpis, Page, Panel, Seg } from '../components/ui.tsx';
import { controleur, decideAvance, droitsNote, euros, parRecence } from '../components/frais/commun.ts';
import { ExportsFrais } from '../components/frais/Exports.tsx';
import { DetailNote, ListeAvances, ListeNotes, Vehicules } from '../components/frais/Notes.tsx';
// lot 12 — C2 (notes de frais : activation)
import { NotesAnciennes, RechercheFrais } from '../components/frais/Historique.tsx';
import { FENETRE_FRAIS_MOIS } from '../../../shared/rules/frais-fenetre.ts';
import { LIBELLES_ONGLETS_FRAIS, ongletFraisDe, ongletsFrais } from '../components/frais/onglets.ts';
import { TableauFrais } from '../components/frais/Tableau.tsx';
import { prendreNouvelleDepense } from '../pwa/enregistrement.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

/** Notes, avances et véhicule du salarié connecté (collaborateur, et onglet « Notes » du manager). */
function MesNotes({ empId }: { empId: number }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const notes = (d.ds.notesFrais ?? []).filter(n => n.empId === empId).sort(parRecence);
  const enCours = notes.filter(n => n.statut !== 'payee' && n.statut !== 'annulee');
  const closes = notes.filter(n => n.statut === 'payee' || n.statut === 'annulee');
  const avances = (d.ds.avancesFrais ?? []).filter(a => a.empId === empId);
  return (
    <>
      <div className="frais-actions">
        <Btn variant="primary" icon={<CameraIcon size={16} />} onClick={() => openDialog({ type: 'fraisDepense' })}>{t('New expense')}</Btn>
        <Btn icon={<PlusIcon size={16} />} onClick={() => openDialog({ type: 'fraisNote', empId })}>{t('New note')}</Btn>
      </div>
      <Fine>{t('“New expense” files the expense in the note of the month, created if needed; a note is submitted when it is complete. Medical expenses form a separate note (“New note”).')}</Fine>
      <Panel title={t('Notes in progress')} aside={tn(enCours.length, 'note', 'notes')}>
        <ListeNotes notes={enCours} vide={t('No note in progress: photograph your first receipt with “New expense”.')} />
      </Panel>
      <Panel title={t('Expense advances')} aside={<Btn small onClick={() => openDialog({ type: 'fraisAvance', empId })}>{t('Request an advance')}</Btn>}>
        <ListeAvances avances={avances} />
      </Panel>
      <Vehicules empId={empId} />
      {closes.length > 0 && (
        <Panel title={t('Notes paid or cancelled')} aside={tn(closes.length, 'note', 'notes')}>
          <ListeNotes notes={closes} vide="" />
        </Panel>
      )}
      {/* lot 12 — C2 : notes payées depuis plus de 13 mois, chargées à la demande. */}
      <NotesAnciennes empId={empId} />
    </>
  );
}

export function Frais() {
  const d = useDomain();
  const { role, me, user } = useRole();
  const { ui, setUi, openDialog } = useStore();
  // Raccourci « Nouvelle dépense » (/frais?nouveau=1) : saisie ouverte une fois, pour un salarié connecté.
  useEffect(() => { if (me != null && role !== 'rh' && prendreNouvelleDepense()) openDialog({ type: 'fraisDepense' }); }, [me, role, openDialog]);
  if (!d.ds.settings.notesFraisActives) {
    return <Page title={t('Expense reports')}><Empty>{t('Expense reports deactivated: the HR administrator activates them in Settings → Expense reports.')}</Empty></Page>;
  }
  const onglet = ongletFraisDe(role, ui.fraisOnglet);
  const notes = d.ds.notesFrais ?? [];
  const ouverte = ui.fraisNote != null && notes.some(n => n.id === ui.fraisNote) ? ui.fraisNote : null;
  const detail = ouverte != null && <DetailNote id={ouverte} onClose={() => setUi({ fraisNote: null })} />;

  if (role === 'collaborateur') {
    return (
      <Page title={t('My expenses')} kicker={t('Expense reports · reimbursed with the following month’s payroll')}>
        {detail}
        {me != null ? <MesNotes empId={me} /> : <Empty>{t('No employee file is linked to your account.')}</Empty>}
      </Page>
    );
  }

  const ctrl = controleur(user), rh = droitsRh(user).includes('rh');
  const aValider = notes.filter(n => droitsNote(d, user, n).valider).sort(parRecence);
  const aControler = notes.filter(n => n.statut === 'validee' && droitsNote(d, user, n).controler).sort(parRecence);
  const avancesAValider = (d.ds.avancesFrais ?? []).filter(a => decideAvance(d, user, a));
  const badge: Partial<Record<typeof onglet, number>> = { valider: aValider.length + avancesAValider.length, controle: aControler.length };
  const options = ongletsFrais(role).map(o => [o, <>{LIBELLES_ONGLETS_FRAIS[o]}{badge[o] ? ` (${badge[o]})` : ''}</>] as [typeof o, ReactNode]);

  let contenu: ReactNode = null;
  if (onglet === 'valider') {
    contenu = <>
      <Panel highlight title={t('Notes to approve')} aside={tn(aValider.length, 'note', 'notes')}>
        <ListeNotes notes={aValider} avecNom vide={t('No note to approve.')} />
      </Panel>
      <Panel title={t('Advances to approve')} aside={tn(avancesAValider.length, 'advance', 'advances')}>
        <ListeAvances avances={avancesAValider} avecNom />
      </Panel>
    </>;
  } else if (onglet === 'equipe') {
    const equipe = notes.filter(n => n.empId !== me).sort(parRecence);
    // lot 12 — C2 : notes payées depuis plus de 2 mois comptées par leur résumé.
    const tot = totauxEquipeVue(equipe.filter(n => n.periode >= d.ti.slice(0, 4)), d.ds.lignesFrais ?? [], d.ds.resumesFrais);
    contenu = <>
      <Kpis>
        <Kpi kicker={`${t('Notes ')}${d.ti.slice(0, 4)}`} value={tot.notes} sub={t('of the team, cancelled excluded')} />
        <Kpi kicker={t('Reimbursed or to reimburse')} value={euros(tot.retenu)} sub={`${t('out of ')}${euros(tot.demande)}${t(' requested#plural')}`} />
        <Kpi kicker={t('To approve')} value={aValider.length} sub={t('notes submitted')} />
      </Kpis>
      <Panel title={t('Notes of the team')} aside={tn(equipe.length, 'note', 'notes')}>
        <ListeNotes notes={equipe} avecNom vide={t('No note of the team.')} />
      </Panel>
      <Fine>{t('Your direct team and the employees whose expenses you approve by delegation. Medical expenses never go through the manager: they are neither listed nor counted here.')}</Fine>
    </>;
  } else if (onglet === 'notes' && role === 'manager') {
    contenu = me != null ? <MesNotes empId={me} /> : null;
  } else if (onglet === 'controle') {
    contenu = <>
      <Panel highlight title={t('Notes to check')} aside={tn(aControler.length, 'note', 'notes')}>
        <ListeNotes notes={aControler} avecNom vide={t('No note to check.')} />
      </Panel>
      <Fine>{t('Approved by the manager, or sent directly (medical expenses, employee without a manager). A blocking point prevents the check; an expense is refused or brought down to the cap with a reason.')}</Fine>
    </>;
  } else if (onglet === 'notes') {
    contenu = <>
      {rh && <div className="frais-actions"><Btn small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'fraisNote' })}>{t('New note for an employee')}</Btn></div>}
      <Panel title={t('All the notes')} aside={tn(notes.length, 'note', 'notes')}>
        <ListeNotes notes={[...notes].sort(parRecence)} avecNom vide={t('No expense report.')} />
      </Panel>
      {/* lot 12 — C2 : notes payées depuis plus de 13 mois, par la recherche de l'onglet Historique. */}
      <div className="frais-actions">
        <Btn small onClick={() => setUi({ fraisOnglet: 'historique', fraisNote: null })}>{t('Older notes')}</Btn>
        <Fine>{t('Notes paid more than ')}{FENETRE_FRAIS_MOIS}{t(' months ago: loaded on demand, in the History tab.')}</Fine>
      </div>
    </>;
  } else if (onglet === 'avances') {
    contenu = <Panel title={t('Expense advances')}><ListeAvances avances={d.ds.avancesFrais ?? []} avecNom /></Panel>;
  } else if (onglet === 'exports') {
    contenu = ctrl ? <ExportsFrais /> : null;
  } else if (onglet === 'historique') {
    // lot 12 — C2 : recherche dans toute la base (notes archivées comprises).
    contenu = <RechercheFrais />;
  } else if (onglet === 'tableau') {
    contenu = <>
      <TableauFrais />
      <Panel title={t('Currency rates')} aside={<Btn small onClick={() => openDialog({ type: 'fraisTaux' })}>{t('Enter a rate')}</Btn>}>
        {(d.ds.referentiels.tauxDevises ?? []).length === 0 ? <Empty>{t('No rate entered.')}</Empty> : (
          <table className="table">
            <thead><tr><th>{t('Currency')}</th><th>{t('Month')}</th><th>{t('1 unit in euros')}</th></tr></thead>
            <tbody>{[...(d.ds.referentiels.tauxDevises ?? [])].sort((a, b) => b.mois.localeCompare(a.mois) || a.devise.localeCompare(b.devise)).slice(0, 24).map(x => (
              <tr key={x.id}><td>{x.devise}</td><td>{x.mois}</td><td className="tnum">{String(x.taux).replace('.', ',')}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Panel>
    </>;
  }

  return (
    <Page title={t('Expense reports')} kicker={role === 'manager' ? t('Approval of the team · your notes') : t('Check, advances, accounting exports')}>
      <Seg name="fraisOnglet" label={t('Expense reports tab')} value={onglet} onChange={v => setUi({ fraisOnglet: v, fraisNote: null })} style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }} options={options} />
      {detail}
      {contenu}
    </Page>
  );
}
