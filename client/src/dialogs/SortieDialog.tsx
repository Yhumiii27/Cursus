// Sortie d'un salarié (service RH), pour tous les contrats, CDI compris : dernier jour du contrat et motif en liste
// fermée. Les contrôles et les effets sont ceux du serveur (`controleSortie` de shared/rules/contrats.ts) : ce qui bloque
// la sortie, ce qu'elle annule ou retire, ce qu'il reste à voir. Une sortie déjà enregistrée se modifie ici et s'annule
// depuis la fiche (« Annuler la sortie »).
import { useState } from 'react';
import { ENT_TYPES } from '../../../shared/constants.ts';
import { isoWeek } from '../../../shared/dates.ts';
import { fmtIso } from '../../../shared/format.ts';
import { periodeTexte } from '../../../shared/rules/absences.ts';
import { controleSortie, finContrat, MOTIFS_SORTIE } from '../../../shared/rules/contrats.ts';
import type { MotifSortie } from '../../../shared/types.ts';
import { erreurDate } from '../components/controles.ts';
import { CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, NoteAccent } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function SortieDialog({ empId }: { empId: number }) {
  const d = useDomain();
  const { rh } = useRole();
  const { run, closeDialog } = useStore();
  const emp = d.emp(empId);
  const prevue = emp ? finContrat(emp) : null;
  // Sortie déjà enregistrée : reprise telle quelle ; sinon la fin prévue au contrat et le motif qui la suit d'ordinaire.
  const [date, setDate] = useState(emp?.fin ?? '');
  const [motif, setMotif] = useState<MotifSortie | ''>(() => emp?.motifSortie
    ?? (emp?.typeContrat === 'cdd' ? 'fin_cdd' : emp?.typeContrat === 'interim' ? 'fin_mission' : ''));
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!emp || !rh) return null;

  const dateErr = erreurDate(date, 'Indiquez le dernier jour du contrat.');
  const motifErr = motif ? null : 'Choisissez le motif de sortie.';
  const c = dateErr ? null : controleSortie(d, emp, date);
  // Effets, en détail : ce que la sortie annule ou retire (jamais la nature d'une absence).
  const sessionTexte = (id: number | null) => { const s = d.session(id); return s ? `Session ${d.fm(s.formation)?.court ?? s.formation} du ${fmtIso(s.date)}` : 'Session'; };
  const effets = !c ? [] : [
    ...c.absences.map(a => `${a.statut === 'demandee' ? 'Demande d’absence' : 'Absence'} ${periodeTexte(a.du, a.au)} : annulée${a.keystone ? ', Keystone prévenu' : ''}`),
    ...c.certs.map(x => `${sessionTexte(x.sessionId)} (recyclage) : inscription retirée, convocation annulée par e-mail si elle a été envoyée`),
    ...c.inscriptions.map(i => `${sessionTexte(i.sessionId)} (formation initiale) : inscription retirée, convocation annulée par e-mail si elle a été envoyée`),
    ...c.entretiens.map(x => `${ENT_TYPES[x.type].nom} du ${fmtIso(x.date)} : retiré`),
    ...c.visites.map(x => `Demande de visite médicale du ${fmtIso(x.le)} : annulée (service de santé au travail à prévenir)`),
    ...(c.feuilles.length ? [`Feuilles de temps vides des semaines ${c.feuilles.map(f => isoWeek(f.week)).join(', ')} : retirées`] : []),
  ];
  const passee = !dateErr && date < d.ti;

  const confirm = async () => {
    if (busy || !v.verifier(dateErr, motifErr, c?.bloquants.length)) return;
    setBusy(true);
    const r = await run('employe.sortie', { id: emp.id, date, motif });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={`${emp.motifSortie ? 'Modifier la sortie' : 'Enregistrer la sortie'} — ${emp.nom}`} width={600} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{emp.motifSortie ? 'Enregistrer la modification' : 'Enregistrer la sortie'}</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{emp.nom} · {emp.poste}</Static></Field>
        <Field label="Contrat">
          <Static>{d.contratOf(emp).libelle}<div className="text-muted sub">Entrée le {fmtIso(emp.entree)}{prevue ? ` · fin prévue le ${fmtIso(prevue)}` : ''}</div></Static>
        </Field>
        <Field label="Dernier jour du contrat" htmlFor="so-date" requis erreur={date ? dateErr : v.erreur(dateErr)}>
          <input className="input" id="so-date" type="date" autoFocus min={emp.entree} max={prevue ?? undefined} value={date} onChange={ev => setDate(ev.target.value)} />
          <span className="text-muted sub">Préavis compris : date de fin du contrat de travail</span>
        </Field>
        <Field label="Motif de sortie" htmlFor="so-motif" requis erreur={v.erreur(motifErr)}>
          {/* Liste fermée, sans texte libre. */}
          <select className="input" id="so-motif" value={motif} onChange={ev => setMotif(ev.target.value as MotifSortie | '')}>
            <option value="">Choisir…</option>
            {(Object.keys(MOTIFS_SORTIE) as MotifSortie[]).map(k => <option key={k} value={k}>{MOTIFS_SORTIE[k]}</option>)}
          </select>
        </Field>
      </div>
      {c && <Controles msgs={c.bloquants.map(text => ({ text, bad: true }))} />}
      {effets.length > 0 && <>
        <Fine>Annulé ou retiré par la sortie :</Fine>
        <Controles msgs={effets.map(text => ({ text, bad: false }))} />
      </>}
      {c?.avertissements.map(a => <NoteAccent key={a}>{a}</NoteAccent>)}
      <Fine>
        Passé cette date, {emp.nom} ne se connecte plus à Cursus, ne reçoit plus de notification et n’a plus ni feuille de temps ni
        absence ; {emp.nom} quitte la conformité, les échéances et les tableaux de bord, et reste consultable avec le filtre « Sortis »
        de Collaborateurs. Sur les chantiers où {emp.nom} est affecté, Keystone reçoit « No Go CONTRAT ».
        {passee ? ' Date passée : les sessions de connexion ouvertes sont fermées aussitôt.' : ''}
      </Fine>
      <Fine>
        Une sortie saisie par erreur s’annule depuis la fiche{prevue ? ` : la fin prévue au contrat (${fmtIso(prevue)}) est alors rétablie` : ''}. Ce que la
        sortie a annulé n’est pas rétabli. Le motif n’est transmis qu’au service RH (lecture seule comprise), à la paie et à l’intéressé : le manager ne
        voit que la date.
      </Fine>
    </Dialog>
  );
}
