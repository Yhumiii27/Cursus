// Mise en service (administrateur RH, ouvert depuis Paramètres) : reprise des données de Lucca en cinq imports CSV —
// salariés, soldes de congés, certifications, habilitations, visites médicales. Pour chacun : modèle CSV, fichier chargé
// ou collé, colonnes reconnues par leur nom puis rapprochées à la main, aperçu ligne par ligne (ajout, mise à jour,
// ignorée, refusée avec son motif), cases de confirmation (réembauche sur un matricule, visite sans avis), puis import
// confirmé. Chaque lot reste listé avec son compte rendu ; « Rejouer » reprend son type, ses colonnes et sa date, le
// fichier étant rechargé (son contenu n'est pas conservé). Règles : shared/rules/reprise.ts ; serveur : actions/reprise.ts.
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { t, tn } from '../i18n/langue.ts';
import { lireCsv } from '../../../shared/rules/imports.ts';
import {
  analyserReprise, bilanReprise, DATE_REPRISE_CONSEILLEE, ISSUE_LABEL, type IssueReprise, modeleReprise, reconnaitreColonnes, REPRISES,
  type TypeReprise, TYPES_REPRISE,
} from '../../../shared/rules/reprise.ts';
import type { LotReprise } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Field } from '../components/Dialog.tsx';
import { Empty, Fine, NoteAccent, Page, Panel, SectionLabel, Seg, Tag } from '../components/ui.tsx';
import { readText } from '../dialogs/PlanImportDialog.tsx';
import { downloadCsv } from '../print.ts';
import { useAgir } from '../state/actions.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useData, useStore } from '../state/store.tsx';
import { quand } from './parametres/commun.ts';

const ISSUE_CLS: Record<IssueReprise, string> = { creation: 'tag-neutral', maj: 'tag-neutral', ignoree: 'tag-outline', refus: 'tag-accent' };
type Filtre = 'toutes' | 'ecrites' | 'refus';

/** Colonnes, équipes et options d'un lot à rejouer : appliquées au prochain fichier qui a les mêmes en-têtes. */
interface Rejeu { lot: number; entetes: string[]; colonnes: (string | null)[]; equipes: Record<string, string> }

export function MiseEnService() {
  const data = useData();
  const d = useDomain();
  const { run, go } = useStore();
  const { admin, rh } = useRole();
  const { occupe, agir } = useAgir();
  const [type, setType] = useState<TypeReprise>('salaries');
  const [texte, setTexte] = useState('');
  const [fichier, setFichier] = useState('');
  const [colonnes, setColonnes] = useState<(string | null)[]>([]);
  const [dateReprise, setDateReprise] = useState(DATE_REPRISE_CONSEILLEE);
  const [equipes, setEquipes] = useState<Record<string, string>>({});
  const [confirmations, setConfirmations] = useState<number[]>([]);
  const [comptes, setComptes] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const [filtre, setFiltre] = useState<Filtre>('toutes');
  const [rejeu, setRejeu] = useState<Rejeu | null>(null);
  const [ouvert, setOuvert] = useState<number | null>(null);
  const champFichier = useRef<HTMLInputElement>(null);
  // Case des comptes cochée : fiches qui ont déjà un compte (liste des comptes, administrateur RH), pour annoncer dans
  // l'aperçu les comptes à créer, y compris sur une fiche déjà à jour (ouverture progressive du site).
  const [avecCompte, setAvecCompte] = useState<number[] | null>(null);
  const voirComptes = admin && type === 'salaries' && comptes;
  useEffect(() => {
    if (!voirComptes) { setAvecCompte(null); return; }
    let actif = true;
    api.comptes().then(l => { if (actif) setAvecCompte(l.map(c => c.empId).filter((x): x is number => x != null)); }, () => { if (actif) setAvecCompte(null); });
    return () => { actif = false; };
  }, [voirComptes, data.reprises.length]);

  const R = REPRISES[type];
  const soiMeme = data.user.role === 'rh' ? data.user.salarieId ?? null : null;
  const analyse = useMemo(() => (texte.trim() ? analyserReprise(d, type, texte, { colonnes, dateReprise, equipes, confirmations, avecCompte, soiMeme }) : null),
    [d, type, texte, colonnes, dateReprise, equipes, confirmations, avecCompte, soiMeme]);
  const b = analyse ? bilanReprise(analyse.lignes) : null;
  const aEcrire = b ? b.crees + b.majs : 0;
  const premiere = useMemo(() => lireCsv(texte).lignes[1] ?? [], [texte]);

  if (!rh) return <Page title={t('Set-up')}><Empty>{t('Set-up reserved to HR.')}</Empty></Page>;

  /** Nouveau contenu : colonnes reconnues par leur nom, ou celles du lot rejoué si les en-têtes sont les mêmes. */
  const charger = (contenu: string, nom: string) => {
    const entetes = lireCsv(contenu).lignes[0] ?? [], cle = entetes.join('\u0001');
    const meme = rejeu && rejeu.entetes.join('\u0001') === cle;
    setTexte(contenu);
    setFichier(nom);
    setConfirmer(false);
    // Saisie dans la zone de texte sans changer les en-têtes : les colonnes rapprochées à la main restent.
    if (!nom && (lireCsv(texte).lignes[0] ?? []).join('\u0001') === cle) return;
    setColonnes(meme ? rejeu.colonnes : reconnaitreColonnes(type, entetes));
    setEquipes(meme ? rejeu.equipes : {});
    setConfirmations([]);
  };
  const onFile = (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (file) readText(file, contenu => charger(contenu, file.name));
    ev.target.value = '';
  };
  const changerType = (ty: TypeReprise) => {
    setType(ty);
    setTexte(''); setFichier(''); setColonnes([]); setEquipes({}); setConfirmations([]); setConfirmer(false); setRejeu(null); setComptes(false);
  };
  /** Une colonne par champ : choisir un champ déjà pris le retire de l'autre colonne. */
  const choisirColonne = (i: number, champ: string) => setColonnes(cs => cs.map((c, j) => (j === i ? champ || null : c === champ ? null : c)));
  const basculer = (n: number, oui: boolean) => setConfirmations(cs => (oui ? [...new Set([...cs, n])] : cs.filter(x => x !== n)));
  const modele = () => { const m = modeleReprise(type); downloadCsv(`modele-reprise-${type}.csv`, m.entetes, m.lignes); };
  const rejouer = (lot: LotReprise) => {
    if (!(TYPES_REPRISE as string[]).includes(lot.type)) return;
    changerType(lot.type as TypeReprise);
    setRejeu({ lot: lot.id, entetes: lot.options?.entetes ?? [], colonnes: lot.colonnes, equipes: lot.options?.equipes ?? {} });
    if (lot.dateReprise) setDateReprise(lot.dateReprise);
    setComptes(!!lot.options?.comptes);
    champFichier.current?.focus();
  };
  const importer = () => run('reprise.importer', {
    type, texte, colonnes, dateReprise: type === 'soldes' ? dateReprise : null, equipes, confirmations, comptes: type === 'salaries' && comptes, fichier,
  }).then(r => {
    setConfirmer(false);
    if (!r.ok) return;
    const lot = (r.result as { lot?: number } | undefined)?.lot ?? null;
    setTexte(''); setFichier(''); setConfirmations([]); setRejeu(null); setOuvert(lot);
  });

  const lignes = (analyse?.lignes ?? []).filter(l => filtre === 'toutes' || (filtre === 'refus' ? l.issue === 'refus' : l.ecriture));
  const lots = data.reprises;
  const faits = (ty: TypeReprise) => lots.filter(l => l.type === ty).length;

  return (
    <Page kicker={`${t('Administration')} · ${t('Takeover from Lucca')}`} title={t('Set-up')} actions={
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('parametres')}>{t('← Settings')}</button>
    } note={t('Recommended order: reference data (Reference data screen), employees, leave balances, certifications, medical visits (fitness, prerequisite of several authorisations), authorisations. Each import can be run again without creating duplicates; after the takeover, Cursus is the reference for the employees and the counters.')}>
      <Panel title={t('Importing')} aside={!admin ? <Tag cls="tag-outline">{t('Read only#tag')}</Tag> : undefined} style={{ gap: 'var(--space-4)' }}>
        <Seg name="reprise-type" label={t('Data to import')} value={type} onChange={changerType}
          options={TYPES_REPRISE.map(ty => [ty, <>{REPRISES[ty].label}{faits(ty) ? t(' · imported') : ''}</>])} />
        <Fine>{R.aide}</Fine>
        {!admin ? <Fine>{t('Imports are reserved to the HR administrator; the batches already imported and their report stay readable below.')}</Fine> : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={modele}>{t('Download the CSV template')}</button>
              <span className="text-muted sub">{t('Columns: ')}{R.champs.map(c => c.label).join(t('; '))}{t('. Separator “;”, first line of headers.')}</span>
            </div>
            {rejeu && <NoteAccent>{t('Run batch no. ')}{rejeu.lot}{t(' again: load the file again (its content is not kept in Cursus). Its columns and its matchings will be taken over if the headers have not changed.')}</NoteAccent>}
            <div className="grid-2">
              <Field label={t('CSV file')} htmlFor="reprise-fichier">
                <input ref={champFichier} id="reprise-fichier" type="file" accept=".csv,.txt,text/csv" onChange={onFile} className="text-n300" style={{ fontSize: 13, maxWidth: '100%' }} />
              </Field>
              {type === 'soldes' && (
                <Field label={t('Date of the balances')} htmlFor="reprise-date" requis erreur={analyse?.bloquant?.startsWith('Date') ? t('Invalid date.') : null}>
                  <input className="input" id="reprise-date" type="date" value={dateReprise} onChange={e => setDateReprise(e.target.value)} />
                </Field>
              )}
              {type === 'salaries' && (
                <Field label={t('Sign-in accounts')}>
                  <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', fontSize: 13 }}>
                    <input type="checkbox" checked={comptes} onChange={e => setComptes(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
                    {t('Create the Microsoft 365 accounts from the e-mail addresses')}
                  </label>
                </Field>
              )}
            </div>
            {fichier && <span className="note-accent">{t('File loaded: ')}{fichier}</span>}
            <Field label={t('Or paste the content')} htmlFor="reprise-texte">
              <textarea className="input mono-input" id="reprise-texte" rows={3} value={texte} placeholder={modeleReprise(type).entetes.join(';')}
                onChange={e => charger(e.target.value, '')} />
            </Field>
          </>
        )}
        {admin && analyse && analyse.entetes.length > 0 && (
          <>
            <SectionLabel>{t('Columns of the file')}</SectionLabel>
            <div className="scroll-x">
              <table className="table" style={{ fontSize: 13 }}>
                <thead><tr><th>{t('Column')}</th><th>{t('First line')}</th><th>{t('Field of Cursus')}</th></tr></thead>
                <tbody>
                  {analyse.entetes.map((h, i) => (
                    <tr key={i}>
                      <td>{h || <span className="text-muted">{t('(untitled)')}</span>}</td>
                      <td className="text-muted">{premiere[i] || '—'}</td>
                      <td>
                        <select className="input" aria-label={`${t('Field of the column ')}${h || i + 1}`} value={colonnes[i] ?? ''} onChange={e => choisirColonne(i, e.target.value)}>
                          <option value="">{t('— Ignored —')}</option>
                          {R.champs.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {admin && analyse && analyse.equipesInconnues.length > 0 && (
          <>
            <SectionLabel>{t('Teams missing from Cursus')}</SectionLabel>
            <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
              {analyse.equipesInconnues.map(q => (
                <div key={q} className="list-row">
                  <div className="grow" style={{ fontSize: 14 }}>{q}</div>
                  <select className="input" style={{ maxWidth: 280 }} aria-label={`${t('Team ')}${q}`} value={equipes[q] ?? ''} onChange={e => setEquipes(x => ({ ...x, [q]: e.target.value }))}>
                    <option value="">{t('Create the team “')}{q}{t('”#close')}</option>
                    {d.equipes.map(x => <option key={x} value={x}>{t('Attach to ')}{x}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </>
        )}
        {admin && analyse?.bloquant && <p className="field-erreur bloquant" role="alert">{analyse.bloquant}</p>}
        {admin && analyse && b && !analyse.bloquant && (
          <>
            <div className="panel-head">
              <h3 style={{ fontSize: 14, margin: 0 }}>{t('Preview')}</h3>
              <span className="text-muted sub">
                {tn(analyse.lignes.length, 'line', 'lines')} · {tn(b.crees, 'addition', 'additions')} · {tn(b.majs, 'update', 'updates')} · {tn(b.ignorees, 'ignored#fem', 'ignored#fem-plural')} · {tn(b.refusees, 'refused#fem', 'refused#fem-plural')}
              </span>
            </div>
            <Seg name="reprise-filtre" label={t('Lines shown')} value={filtre} onChange={setFiltre}
              options={[['toutes', t('All#fem')], ['ecrites', t('To write')], ['refus', t('Refused#fem-plural')]]} />
            <div className="scroll-x">
              <table className="table" style={{ fontSize: 13 }}>
                <thead><tr><th>{t('Line#row')}</th><th>{t('Employee#salarie')}</th><th>{t('Result')}</th><th>{t('Detail')}</th></tr></thead>
                <tbody>
                  {lignes.map(l => (
                    <tr key={l.n} style={l.issue === 'refus' || l.issue === 'ignoree' ? { opacity: l.confirmation ? 1 : 0.7 } : undefined}>
                      <td className="tnum">{l.n}</td>
                      <td className="nowrap">{l.nom}</td>
                      <td><Tag cls={ISSUE_CLS[l.issue]}>{ISSUE_LABEL[l.issue]}</Tag></td>
                      <td>
                        {l.detail && <div>{l.detail}</div>}
                        {l.erreurs.map((x, i) => <div key={`e${i}`} className="note-accent">{x}</div>)}
                        {l.avertissements.map((x, i) => <div key={`a${i}`} className="text-muted sub-11">{x}</div>)}
                        {l.confirmation && (
                          <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginTop: 4 }}>
                            <input type="checkbox" checked={l.confirmee} onChange={e => basculer(l.n, e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
                            {l.confirmation}
                          </label>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!lignes.length && <tr><td colSpan={4} className="text-muted">{t('No line in this filter.')}</td></tr>}
                </tbody>
              </table>
            </div>
            {confirmer ? (
              <div className="card" role="group" aria-label={t('Confirm the import')} style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div style={{ fontSize: 14 }}>
                  {t('Import ')}{tn(aEcrire, 'line', 'lines')} ({tn(b.crees, 'addition', 'additions')}, {tn(b.majs, 'update', 'updates')}){type === 'soldes' && dateReprise ? `${t(', balances at ')}${fmtIso(dateReprise)}` : ''}{t('?#question')}
                  {b.refusees ? ` ${tn(b.refusees, 'refused line will not be imported', 'refused lines will not be imported')}${t(': correct the file and run the import again.')}` : ''}
                  {type === 'salaries' && comptes ? t(' The Microsoft 365 accounts of the present employees who have none will be created.') : ''}
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-primary" disabled={occupe} onClick={agir(importer)}>{t('Confirm the import')}</button>
                  <button type="button" className="btn btn-secondary" disabled={occupe} onClick={() => setConfirmer(false)}>{t('Cancel')}</button>
                </div>
              </div>
            ) : (
              <div>
                {aEcrire > 0
                  ? <button type="button" className="btn btn-primary" onClick={() => setConfirmer(true)}>{t('Import ')}{tn(aEcrire, 'line', 'lines')}</button>
                  : <p className="field-erreur bloquant">{t('No line to import: ')}{t(b.refusees ? 'correct the refused lines' : 'everything is already up to date')}.</p>}
              </div>
            )}
          </>
        )}
      </Panel>

      <Panel title={t('Imported batches')} aside={lots.length ? tn(lots.length, 'batch', 'batches') : undefined}>
        {lots.length ? (
          <div className="list">
            {lots.map(lot => {
              const rep = (TYPES_REPRISE as string[]).includes(lot.type) ? REPRISES[lot.type as TypeReprise] : null;
              const deplie = ouvert === lot.id;
              return (
                <div key={lot.id} className="list-row stack">
                  <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div className="grow" style={{ minWidth: 220, flex: 1 }}>
                      <div style={{ fontSize: 14 }}>{rep?.label ?? lot.type} · {t('batch no. ')}{lot.id}{lot.fichier ? ` · ${lot.fichier}` : ''}</div>
                      <div className="text-muted sub">
                        {quand(lot.le)} · {lot.par}{lot.dateReprise ? ` · ${t('balances at ')}${fmtIso(lot.dateReprise)}` : ''} · {tn(lot.crees, 'addition', 'additions')}, {tn(lot.majs, 'update', 'updates')}, {tn(lot.ignorees, 'ignored#fem', 'ignored#fem-plural')}, {tn(lot.refusees, 'refused#fem', 'refused#fem-plural')}
                      </div>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" aria-expanded={deplie} onClick={() => setOuvert(deplie ? null : lot.id)}>{t(deplie ? 'Hide the report' : 'Report#import')}</button>
                    {admin && rep && <button type="button" className="btn btn-secondary btn-sm" onClick={() => rejouer(lot)}>{t('Run again')}</button>}
                  </div>
                  {deplie && (
                    <div className="scroll-x">
                      <table className="table" style={{ fontSize: 13 }}>
                        <thead><tr><th>{t('Line#row')}</th><th>{t('Employee#salarie')}</th><th>{t('Result')}</th><th>{t('Reason')}</th></tr></thead>
                        <tbody>{lot.rapport.map(x => <tr key={x.n}><td className="tnum">{x.n}</td><td className="nowrap">{x.nom}</td><td>{x.issue}</td><td>{x.motif}</td></tr>)}</tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : <Empty pad="sm">{t('No import for now.')}</Empty>}
      </Panel>
    </Page>
  );
}
