// lot 11 — notes de frais (étape 2) : exports comptables (comptabilité, service RH). Les exports se lisent par leur route
// (GET /api/frais/exports, hors de l'instantané) ; la génération fige les écritures des notes contrôlées, en paiement ou
// payées pas encore exportées (`frais.export.generer`, nombre affiché envoyé contre une liste changée ou un double clic) ;
// le fichier se télécharge au gabarit de Paramètres → Notes de frais, tracé au journal. Le remboursement passe par la
// paie (lots de paie, écran Temps) : pas de virement SEPA (réponse de l'entreprise du 31 octobre 2026).
import { useCallback, useEffect, useState } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { isoParis } from '../../../../shared/dates.ts';
import { fmtIso, plural } from '../../../../shared/format.ts';
import { notesAExporter } from '../../../../shared/rules/frais-export.ts';
import { totauxNote, lignesDe } from '../../../../shared/rules/frais.ts';
import type { ExportFraisVue } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { useAgir } from '../../state/actions.ts';
import { annulationExport } from '../../state/confirmations-frais.ts';
import { useDomain } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { Btn, Empty, Fine, Panel, Tag, Two } from '../ui.tsx';
import { euros } from './commun.ts';

export function ExportsFrais() {
  const d = useDomain();
  const { run, notify, openDialog } = useStore();
  const { occupe, agir } = useAgir();
  const [exports, setExports] = useState<ExportFraisVue[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const relire = useCallback(() => {
    api.exportsFrais().then(r => { setExports(r.exports); setErreur(null); }).catch((e: Error) => setErreur(e.message));
  }, []);
  // Relu à chaque changement de l'instantané (génération, annulation, contrôle d'une note).
  const revision = d.ds.revision;
  useEffect(() => { relire(); }, [relire, revision]);

  const aExporter = exports ? notesAExporter(d.ds.notesFrais ?? [], exports.map(x => ({ id: x.id, notes: x.notes, annuleLe: x.annuleLe }))) : [];
  const avecMontant = aExporter.filter(n => totauxNote(lignesDe(d.ds.lignesFrais, n.id)).retenu > 0);
  const total = avecMontant.reduce((s, n) => s + totauxNote(lignesDe(d.ds.lignesFrais, n.id)).retenu, 0);
  const telecharger = async (id: number) => {
    try { await api.fichierExportFrais(id); relire(); } catch (e) { notify(`Fichier non téléchargé — ${(e as Error).message}`, true); }
  };
  const generer = async () => {
    const r = await run('frais.export.generer', { attendues: aExporter.length });
    relire();
    return r;
  };

  return (
    <>
      <Panel title="Notes à exporter" aside={exports ? plural(avecMontant.length, 'note', 'notes') : undefined}>
        {erreur && <div className="note-accent" role="alert">{erreur}</div>}
        {!exports ? <Empty>Chargement…</Empty> : avecMontant.length === 0 ? <Empty>Aucune note contrôlée à exporter.</Empty> : <>
          <div>{plural(avecMontant.length, 'note contrôlée', 'notes contrôlées')} pas encore exportée{avecMontant.length > 1 ? 's' : ''}, {euros(total)} au total.</div>
          <div><Btn variant="primary" small disabled={occupe} onClick={agir(generer)}>Générer l’export comptable</Btn></div>
        </>}
        <Fine>Une écriture par note : charges par compte, TVA récupérable, crédit du compte du salarié. Les frais médicaux portent le compte et le libellé génériques. Comptes, journal et format du fichier : Paramètres → Notes de frais.</Fine>
      </Panel>
      <Panel title="Exports comptables">
        {!exports ? <Empty>Chargement…</Empty> : exports.length === 0 ? <Empty>Aucun export.</Empty> : exports.map(x => (
          <div key={x.id} className="list-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px', minWidth: 0 }}>
              <Two main={`Export n° ${x.id} — ${fmtIso(isoParis(new Date(x.creation)))}`}
                sub={`${plural(x.notes?.length ?? 0, 'note', 'notes')} · ${plural(x.ecritures, 'ligne', 'lignes')} · ${euros(x.montant)} · par ${x.auteur}${x.telechargements ? ` · téléchargé ${x.telechargements} fois, dernière fois par ${x.telechargePar}` : ''}`} />
            </div>
            {x.annuleLe ? <Tag cls="tag-outline">Annulé</Tag> : <>
              <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={() => void telecharger(x.id)}>Télécharger</Btn>
              <Btn small onClick={() => openDialog({ type: 'confirmer', c: annulationExport(x.id, x.notes?.length ?? 0, x.telechargements > 0) })}>Annuler</Btn>
            </>}
          </div>
        ))}
      </Panel>
    </>
  );
}
