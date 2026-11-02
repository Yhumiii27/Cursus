// lot 12 — C4 (organismes de formation et e-learning) : import d'un fichier d'avancement exporté d'une plateforme
// d'e-learning (CSV, droit « formations »). Colonnes fermées : matricule ou e-mail professionnel, code du module, statut,
// avancement, date de fin, réussite ; toute autre colonne (temps de connexion, journal d'activité, score détaillé) fait
// refuser le fichier entier. Aperçu ligne à ligne (même règle que le serveur, shared/rules/elearning.ts), puis lignes
// valides appliquées ; une valeur identique ne change rien. Fin d'office seulement si le réglage l'admet, pour un module
// sans attestation exigée, une ligne « terminé » et « réussi » ; sinon la fin attend la validation du service RH.
import { useMemo, useState, type ChangeEvent } from 'react';
import { plural } from '../../../shared/format.ts';
import { COLONNES_IMPORT_ELEARNING, effetImport, finAutomatique, lireImportElearning } from '../../../shared/rules/elearning.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Btn, Fine, NoteAccent, Tag } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Exemple affiché (« Charger un exemple ») : colonnes admises seulement. */
const EXEMPLE = 'matricule;module;statut;avancement;date de fin;reussite\n';

export function ElearningImportDialog() {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [texte, setTexte] = useState('');
  const [fichier, setFichier] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const auto = !!d.ds.settings.elearningFinAutoImport;

  const lu = useMemo(() => (texte.trim() ? lireImportElearning(texte, { ...d.ds, employes: d.ds.employes }, d.ti) : null), [d, texte]);
  const lignes = lu && 'lignes' in lu ? lu.lignes : [];
  const ins = d.ds.inscriptionsElearning ?? [], modules = d.ds.modulesElearning ?? [];
  // Effet de chaque ligne valide : mise à jour, inchangée, fin d'office.
  const effets = lignes.map(l => {
    if (l.errs.length) return null;
    const i = ins.find(x => x.id === l.inscriptionId);
    const m = modules.find(x => x.id === l.moduleId);
    if (!i || !m) return null;
    const fin = finAutomatique(auto, m, l);
    return fin ? 'fin' : effetImport(l, i, d.ti) ? 'maj' : 'inchangee';
  });
  const valides = effets.filter(Boolean).length;

  const onFile = (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const read = (enc: string) => {
      const fr = new FileReader();
      fr.onload = () => {
        const t = String(fr.result || '');
        if (enc === 'utf-8' && t.includes('�')) read('windows-1252');
        else { setTexte(t); setFichier(file.name); }
      };
      fr.readAsText(file, enc);
    };
    read('utf-8');
  };
  // Exemple : les inscriptions ouvertes de la liste reçue, sans rien inventer.
  const exemple = () => {
    const ouvertes = ins.filter(i => !i.annuleLe && (i.statut === 'inscrit' || i.statut === 'en_cours')).slice(0, 3);
    const corps = ouvertes.map((i, n) => {
      const e = d.emp(i.empId), m = modules.find(x => x.id === i.moduleId);
      return `${e?.matriculePaie || `EMP-${String(i.empId).padStart(4, '0')}`};${m?.code ?? ''};${n === 0 ? 'terminé' : 'en cours'};${n === 0 ? 100 : 50};${n === 0 ? d.ti : ''};${n === 0 ? 'oui' : ''}`;
    });
    setTexte(EXEMPLE + corps.join('\n'));
    setFichier('exemple-avancement.csv');
  };

  const errTexte = !texte.trim() ? 'Chargez un fichier ou collez son contenu.' : lu && 'refus' in lu ? lu.refus : !valides ? 'Aucune ligne valide : corrigez le fichier (voir l’aperçu).' : null;
  const envoyer = async () => {
    if (busy || !v.verifier(errTexte)) return;
    setBusy(true);
    const r = await run('elearning.importer', { texte });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  const nom = (id: number | null) => (id != null ? d.emp(id)?.nom ?? '—' : '—');
  const code = (id: number | null) => modules.find(x => x.id === id)?.code ?? '—';
  return (
    <Dialog title="Importer l’avancement e-learning" width={760} tall onSubmit={envoyer}
      actions={<><CancelButton /><SubmitButton busy={busy}>{valides ? `Appliquer ${plural(valides, 'ligne', 'lignes')}` : 'Importer'}</SubmitButton></>}>
      <Field label="Fichier exporté de la plateforme (CSV)" htmlFor="ie-file">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <input id="ie-file" type="file" accept=".csv,.txt,text/csv" onChange={onFile} className="text-n300" style={{ fontSize: 13, maxWidth: '100%' }} />
          <Btn small onClick={exemple}>Charger un exemple</Btn>
          {fichier && <span className="note-accent">Fichier chargé : {fichier}</span>}
        </div>
        <span className="text-muted sub">
          Colonnes admises : {COLONNES_IMPORT_ELEARNING}. Toute autre colonne (temps de connexion, journal d’activité, score détaillé) fait refuser le
          fichier. Le salarié doit déjà être inscrit au module : l’import n’inscrit personne.
        </span>
      </Field>
      <Field label="Ou coller le contenu" htmlFor="ie-text" erreur={texte.trim() ? errTexte : v.erreur(errTexte)}>
        <textarea className="input mono-input" id="ie-text" rows={4} value={texte} onChange={e => { setTexte(e.target.value); setFichier(''); }}
          placeholder={EXEMPLE.trim()} style={{ height: 'auto', minHeight: 88, resize: 'vertical' }} />
      </Field>
      {lignes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div className="panel-head">
            <h3 style={{ fontSize: 14, margin: 0 }}>Aperçu</h3>
            <span className="text-muted sub">{plural(lignes.length, 'ligne', 'lignes')} · {valides} valides · {lignes.length - valides} en erreur</span>
          </div>
          <div className="scroll-x">
            <table className="table" style={{ fontSize: 13 }}>
              <thead><tr><th>Ligne</th><th>Salarié</th><th>Module</th><th>Avancement</th><th>Effet</th></tr></thead>
              <tbody>
                {lignes.map((l, k) => (
                  <tr key={l.n} style={l.errs.length ? { opacity: 0.6 } : undefined}>
                    <td className="tnum">{l.n}</td>
                    <td className="nowrap">{nom(l.empId)}</td>
                    <td className="nowrap">{code(l.moduleId)}</td>
                    <td className="nowrap">{l.statut === 'termine' || l.dateFin ? `terminé${l.dateFin ? ` le ${l.dateFin.split('-').reverse().join('/')}` : ''}` : l.avancement != null ? `${l.avancement} %` : '—'}{l.reussi === true ? ' · réussi' : l.reussi === false ? ' · non réussi' : ''}</td>
                    <td>{l.errs.length ? <span className="note-accent">{l.errs.join(' · ')}</span>
                      : effets[k] === 'fin' ? <Tag cls="tag-accent">Fin validée d’office</Tag>
                      : effets[k] === 'maj' ? <Tag cls="tag-neutral">Mise à jour</Tag> : <Tag cls="tag-outline">Inchangée</Tag>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {auto
        ? <NoteAccent>Fin automatique à l’import activée (Paramètres) : une ligne « terminé » et « réussi » d’un module sans attestation exigée crée la formation suivie.</NoteAccent>
        : <Fine>Les fins importées attendent la validation du service RH (onglet E-learning, « Fins à valider »).</Fine>}
      <Fine>Le journal ne garde que le nombre de lignes. Le DPO valide l’import depuis une plateforme tierce ; ce suivi n’est jamais un contrôle de l’activité.</Fine>
    </Dialog>
  );
}
