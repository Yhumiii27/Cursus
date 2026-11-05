// lot 14 — personnes sur site (demande de Vigie du 4 novembre 2026, décision CV-10 ; shared/rules/personnes-site.ts) :
// salariés d'entreprises extérieures (fiches tenues par le service RH, matricule E) et intérimaires (matricule I, fiche
// ordinaire de l'annuaire), avec leurs titres et habilitations. Service RH (création, modification, titres), référent HSE
// et lecture seule en consultation.
import { useState } from 'react';
import { fmt, plural } from '../../../shared/format.ts';
import { present } from '../../../shared/rules/contrats.ts';
import type { Employe } from '../../../shared/types.ts';
import { Btn, Empty, Page, Panel, Two } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

function Titres({ e }: { e: Employe }) {
  const d = useDomain();
  const { certs, habs } = d.titresDe(e, d.ds.settings.horizonAlerte);
  const parts = [
    ...certs.map(c => `${c.fm.nom}${c.fm.validite ? ` · jusqu’au ${fmt(c.exp)}` : ''}`),
    ...habs.map(h => `${h.hm.nom}${h.exp ? ` · jusqu’au ${fmt(h.exp)}` : ''}`),
  ];
  return parts.length ? <span>{parts.join(' — ')}</span> : <span className="text-muted">aucun titre</span>;
}

export function PersonnesSite() {
  const d = useDomain();
  const { rh, formations } = useRole();
  const { openDialog } = useStore();
  const [recherche, setRecherche] = useState('');
  const q = recherche.trim().toLowerCase();
  const garde = (e: Employe) => !q || [e.nom, e.entreprise, e.agence, e.matriculeSite].some(v => v?.toLowerCase().includes(q));
  const exterieurs = (d.ds.exterieurs ?? []).filter(garde).sort((a, b) => a.nom.localeCompare(b.nom));
  const interimaires = d.ds.employes.filter(e => e.typeContrat === 'interim' && present(e, d.ti)).filter(garde).sort((a, b) => a.nom.localeCompare(b.nom));
  return (
    <Page
      kicker="Intérimaires et salariés d’entreprises extérieures · matricule de site permanent (I, E)"
      title="Personnes sur site"
      actions={rh ? <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'exterieur' })}>Nouvel extérieur</button> : undefined}
    >
      <div className="filtres-liste">
        <input className="input" type="search" placeholder="Nom, entreprise, agence ou matricule…" aria-label="Rechercher une personne sur site" value={recherche} onChange={ev => setRecherche(ev.target.value)} />
      </div>
      <Panel title="Salariés d’entreprises extérieures" aside={plural(exterieurs.length, 'fiche', 'fiches')}>
        {exterieurs.length === 0 ? <Empty>Aucune fiche d’extérieur{q ? ' pour cette recherche' : ''}.</Empty> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Personne</th><th>Matricule</th><th>Titres et habilitations</th><th></th></tr></thead>
              <tbody>
                {exterieurs.map(e => (
                  <tr key={e.id}>
                    <td><Two main={e.nom} sub={`${e.entreprise ?? '—'}${e.email ? ` · ${e.email}` : ''}`} nowrap /></td>
                    <td className="tnum">{e.matriculeSite}</td>
                    <td><Titres e={e} /></td>
                    <td className="right">
                      <div style={{ display: 'flex', gap: 'var(--space-1)', justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        {formations && <Btn small onClick={() => openDialog({ type: 'cert', empId: e.id })}>Certification</Btn>}
                        {formations && <Btn small onClick={() => openDialog({ type: 'hab', empId: e.id, mode: 'deliver' })}>Habilitation</Btn>}
                        {rh && <Btn small onClick={() => openDialog({ type: 'exterieur', id: e.id })}>Modifier</Btn>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Intérimaires présents" aside={`${plural(interimaires.length, 'intérimaire', 'intérimaires')} · fiche dans l’annuaire`}>
        {interimaires.length === 0 ? <Empty>Aucun intérimaire présent{q ? ' pour cette recherche' : ''}.</Empty> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Personne</th><th>Matricule de site</th><th>Agence</th></tr></thead>
              <tbody>
                {interimaires.map(e => (
                  <tr key={e.id}>
                    <td><Two main={e.nom} sub={e.equipe ?? 'à affecter'} nowrap /></td>
                    <td className="tnum">{e.matriculeSite ?? '—'}</td>
                    <td>{e.agence ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Page>
  );
}
