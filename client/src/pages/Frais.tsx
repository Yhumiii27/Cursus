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
import { plural } from '../../../shared/format.ts';
import { totauxEquipe } from '../../../shared/rules/frais.ts';
import { Btn, Empty, Fine, Kpi, Kpis, Page, Panel, Seg } from '../components/ui.tsx';
import { controleur, decideAvance, droitsNote, euros, parRecence } from '../components/frais/commun.ts';
import { ExportsFrais } from '../components/frais/Exports.tsx';
import { DetailNote, ListeAvances, ListeNotes, Vehicules } from '../components/frais/Notes.tsx';
import { LIBELLES_ONGLETS_FRAIS, ongletFraisDe, ongletsFrais } from '../components/frais/onglets.ts';
import { TableauFrais } from '../components/frais/Tableau.tsx';
import { prendreNouvelleDepense } from '../pwa/enregistrement.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

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
        <Btn variant="primary" icon={<CameraIcon size={16} />} onClick={() => openDialog({ type: 'fraisDepense' })}>Nouvelle dépense</Btn>
        <Btn icon={<PlusIcon size={16} />} onClick={() => openDialog({ type: 'fraisNote', empId })}>Nouvelle note</Btn>
      </div>
      <Fine>« Nouvelle dépense » range la dépense dans la note du mois, créée au besoin ; une note se soumet quand elle est complète. Les frais médicaux forment une note à part (« Nouvelle note »).</Fine>
      <Panel title="Notes en cours" aside={plural(enCours.length, 'note', 'notes')}>
        <ListeNotes notes={enCours} vide="Aucune note en cours : photographiez votre premier reçu avec « Nouvelle dépense »." />
      </Panel>
      <Panel title="Avances sur frais" aside={<Btn small onClick={() => openDialog({ type: 'fraisAvance', empId })}>Demander une avance</Btn>}>
        <ListeAvances avances={avances} />
      </Panel>
      <Vehicules empId={empId} />
      {closes.length > 0 && (
        <Panel title="Notes payées ou annulées" aside={plural(closes.length, 'note', 'notes')}>
          <ListeNotes notes={closes} vide="" />
        </Panel>
      )}
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
    return <Page title="Notes de frais"><Empty>Notes de frais désactivées : l’administrateur RH les active dans Paramètres → Notes de frais.</Empty></Page>;
  }
  const onglet = ongletFraisDe(role, ui.fraisOnglet);
  const notes = d.ds.notesFrais ?? [];
  const ouverte = ui.fraisNote != null && notes.some(n => n.id === ui.fraisNote) ? ui.fraisNote : null;
  const detail = ouverte != null && <DetailNote id={ouverte} onClose={() => setUi({ fraisNote: null })} />;

  if (role === 'collaborateur') {
    return (
      <Page title="Mes frais" kicker="Notes de frais · remboursées avec la paie du mois suivant">
        {detail}
        {me != null ? <MesNotes empId={me} /> : <Empty>Aucun dossier collaborateur n’est associé à votre compte.</Empty>}
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
      <Panel highlight title="Notes à valider" aside={plural(aValider.length, 'note', 'notes')}>
        <ListeNotes notes={aValider} avecNom vide="Aucune note à valider." />
      </Panel>
      <Panel title="Avances à valider" aside={plural(avancesAValider.length, 'avance', 'avances')}>
        <ListeAvances avances={avancesAValider} avecNom />
      </Panel>
    </>;
  } else if (onglet === 'equipe') {
    const equipe = notes.filter(n => n.empId !== me).sort(parRecence);
    const t = totauxEquipe(equipe.filter(n => n.periode >= d.ti.slice(0, 4)), d.ds.lignesFrais ?? []);
    contenu = <>
      <Kpis>
        <Kpi kicker={`Notes ${d.ti.slice(0, 4)}`} value={t.notes} sub="de l’équipe, hors annulées" />
        <Kpi kicker="Remboursé ou à rembourser" value={euros(t.retenu)} sub={`sur ${euros(t.demande)} demandés`} />
        <Kpi kicker="À valider" value={aValider.length} sub="notes soumises" />
      </Kpis>
      <Panel title="Notes de l’équipe" aside={plural(equipe.length, 'note', 'notes')}>
        <ListeNotes notes={equipe} avecNom vide="Aucune note de l’équipe." />
      </Panel>
      <Fine>Votre équipe directe et les salariés dont vous validez les frais par délégation. Les frais médicaux ne passent jamais par le manager : ils ne sont ni listés ni comptés ici.</Fine>
    </>;
  } else if (onglet === 'notes' && role === 'manager') {
    contenu = me != null ? <MesNotes empId={me} /> : null;
  } else if (onglet === 'controle') {
    contenu = <>
      <Panel highlight title="Notes à contrôler" aside={plural(aControler.length, 'note', 'notes')}>
        <ListeNotes notes={aControler} avecNom vide="Aucune note à contrôler." />
      </Panel>
      <Fine>Validées par le manager, ou transmises directement (frais médicaux, salarié sans manager). Un point bloquant empêche le contrôle ; une dépense se refuse ou se ramène au plafond avec un motif.</Fine>
    </>;
  } else if (onglet === 'notes') {
    contenu = <>
      {rh && <div className="frais-actions"><Btn small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'fraisNote' })}>Nouvelle note pour un salarié</Btn></div>}
      <Panel title="Toutes les notes" aside={plural(notes.length, 'note', 'notes')}>
        <ListeNotes notes={[...notes].sort(parRecence)} avecNom vide="Aucune note de frais." />
      </Panel>
    </>;
  } else if (onglet === 'avances') {
    contenu = <Panel title="Avances sur frais"><ListeAvances avances={d.ds.avancesFrais ?? []} avecNom /></Panel>;
  } else if (onglet === 'exports') {
    contenu = ctrl ? <ExportsFrais /> : null;
  } else if (onglet === 'tableau') {
    contenu = <>
      <TableauFrais />
      <Panel title="Taux des devises" aside={<Btn small onClick={() => openDialog({ type: 'fraisTaux' })}>Saisir un taux</Btn>}>
        {(d.ds.referentiels.tauxDevises ?? []).length === 0 ? <Empty>Aucun taux saisi.</Empty> : (
          <table className="table">
            <thead><tr><th>Devise</th><th>Mois</th><th>1 unité en euros</th></tr></thead>
            <tbody>{[...(d.ds.referentiels.tauxDevises ?? [])].sort((a, b) => b.mois.localeCompare(a.mois) || a.devise.localeCompare(b.devise)).slice(0, 24).map(t => (
              <tr key={t.id}><td>{t.devise}</td><td>{t.mois}</td><td className="tnum">{String(t.taux).replace('.', ',')}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Panel>
    </>;
  }

  return (
    <Page title="Notes de frais" kicker={role === 'manager' ? 'Validation de l’équipe · vos notes' : 'Contrôle, avances, exports comptables'}>
      <Seg name="fraisOnglet" label="Onglet des notes de frais" value={onglet} onChange={v => setUi({ fraisOnglet: v, fraisNote: null })} style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }} options={options} />
      {detail}
      {contenu}
    </Page>
  );
}
