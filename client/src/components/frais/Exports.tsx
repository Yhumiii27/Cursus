// lot 11 — notes de frais (étape 2) : exports comptables (comptabilité, service RH). Les exports se lisent par leur route
// (GET /api/frais/exports, hors de l'instantané) ; la génération fige les écritures des notes contrôlées, en paiement ou
// payées pas encore exportées (`frais.export.generer`, nombre affiché envoyé contre une liste changée ou un double clic) ;
// le fichier se télécharge au gabarit de Paramètres → Notes de frais, tracé au journal. Le remboursement passe par la
// paie (lots de paie, écran Temps) : pas de virement SEPA (réponse de l'entreprise du 31 octobre 2026).
import { useCallback, useEffect, useState } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { isoParis } from '../../../../shared/dates.ts';
import { fmtIso } from '../../../../shared/format.ts';
import { notesAExporter } from '../../../../shared/rules/frais-export.ts';
import { totauxVue } from '../../../../shared/rules/frais-fenetre.ts';
import type { ExportFraisVue } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { useAgir } from '../../state/actions.ts';
import { annulationExport } from '../../state/confirmations-frais.ts';
import { useDomain } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { Btn, Empty, Fine, Panel, Tag, Two } from '../ui.tsx';
import { euros } from './commun.ts';
import { t, tn } from '../../i18n/langue.ts';

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
  // lot 12 — C2 : note payée depuis plus de 2 mois, total de son résumé (dépenses hors de l'instantané).
  const retenu = (n: (typeof aExporter)[number]) => totauxVue(n, d.ds.lignesFrais, d.ds.resumesFrais).retenu;
  const avecMontant = aExporter.filter(n => retenu(n) > 0);
  const total = avecMontant.reduce((s, n) => s + retenu(n), 0);
  const telecharger = async (id: number) => {
    try { await api.fichierExportFrais(id); relire(); } catch (e) { notify(`${t('File not downloaded — ')}${(e as Error).message}`, true); }
  };
  const generer = async () => {
    const r = await run('frais.export.generer', { attendues: aExporter.length });
    relire();
    return r;
  };

  return (
    <>
      <Panel title={t('Notes to export')} aside={exports ? tn(avecMontant.length, 'note', 'notes') : undefined}>
        {erreur && <div className="note-accent" role="alert">{erreur}</div>}
        {!exports ? <Empty>{t('Loading…')}</Empty> : avecMontant.length === 0 ? <Empty>{t('No checked note to export.')}</Empty> : <>
          <div>{tn(avecMontant.length, 'checked note', 'checked notes')}{avecMontant.length > 1 ? t(' not yet exported#plural') : t(' not yet exported')}, {euros(total)}{t(' in total.')}</div>
          <div><Btn variant="primary" small disabled={occupe} onClick={agir(generer)}>{t('Generate the accounting export')}</Btn></div>
        </>}
        <Fine>{t('One entry per note: expenses by account, recoverable VAT, credit of the employee’s account. Medical expenses carry the generic account and label. Accounts, journal and file format: Settings → Expense reports.')}</Fine>
      </Panel>
      <Panel title={t('Accounting exports')}>
        {!exports ? <Empty>{t('Loading…')}</Empty> : exports.length === 0 ? <Empty>{t('No export.')}</Empty> : exports.map(x => (
          <div key={x.id} className="list-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px', minWidth: 0 }}>
              <Two main={`${t('Export no. ')}${x.id} — ${fmtIso(isoParis(new Date(x.creation)))}`}
                sub={`${tn(x.notes?.length ?? 0, 'note', 'notes')} · ${tn(x.ecritures, 'line', 'lines')} · ${euros(x.montant)}${t(' · by ')}${x.auteur}${x.telechargements ? `${t(' · downloaded ')}${x.telechargements}${t(' times, last time by ')}${x.telechargePar}` : ''}`} />
            </div>
            {x.annuleLe ? <Tag cls="tag-outline">{t('Cancelled#masc')}</Tag> : <>
              <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={() => void telecharger(x.id)}>{t('Download')}</Btn>
              <Btn small onClick={() => openDialog({ type: 'confirmer', c: annulationExport(x.id, x.notes?.length ?? 0, x.telechargements > 0) })}>{t('Cancel')}</Btn>
            </>}
          </div>
        ))}
      </Panel>
    </>
  );
}
