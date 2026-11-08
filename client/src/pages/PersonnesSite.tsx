// lot 14 — personnes sur site (demande de Vigie du 4 novembre 2026, décision CV-10 ; shared/rules/personnes-site.ts) :
// salariés d'entreprises extérieures (fiches tenues par le service RH, matricule E) et intérimaires (matricule I, fiche
// ordinaire de l'annuaire), avec leurs titres et habilitations. Service RH (création, modification, titres), référent HSE
// et lecture seule en consultation. lot 14, étape 2 : pré-déclarations (shared/rules/declarations-presence.ts) — à valider et
// liens par entreprise ou agence pour le service RH, présences prévues validées pour tous les lecteurs de l'écran.
import { useState } from 'react';
import { fmt, fmtIso, plural } from '../../../shared/format.ts';
import { CONSERVATION_DEFAUT_MOIS, nomComplet, refDeclaration, STATUT_DECLARATION_LABEL } from '../../../shared/rules/declarations-presence.ts';
import { present } from '../../../shared/rules/contrats.ts';
import type { DeclarationPresence, Employe } from '../../../shared/types.ts';
import { annulationDeclaration, refusDeclaration, revocationLien } from '../state/confirmations-declarations.ts';
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

const venue = (x: DeclarationPresence) => (x.du === x.au ? fmtIso(x.du) : `${fmtIso(x.du)} → ${fmtIso(x.au)}`);

/** Déclarations : à valider (service RH) ou présences prévues (validées, venue pas encore finie ; annulées signalées). */
function Declarations({ liste, aValider }: { liste: DeclarationPresence[]; aValider: boolean }) {
  const d = useDomain();
  const { rh } = useRole();
  const { openDialog } = useStore();
  const mois = d.ds.settings.declarationsConservationMois ?? CONSERVATION_DEFAUT_MOIS;
  const site = (code: string) => d.ds.referentiels.sites?.find(x => x.code === code)?.libelle ?? code;
  const fiche = (x: DeclarationPresence) => (x.empId != null ? d.emp(x.empId) : undefined);
  return (
    <div className="scroll-x">
      <table className="table">
        <thead><tr><th>Personne</th><th>{aValider ? 'Référence' : 'Matricule'}</th><th>Site</th><th>Venue</th><th>Objet</th><th></th></tr></thead>
        <tbody>
          {liste.map(x => (
            <tr key={x.id}>
              <td><Two main={fiche(x)?.nom ?? nomComplet(x)} sub={`${x.entreprise}${x.categorie === 'interimaire' ? ' (agence)' : ''}${x.email ? ` · ${x.email}` : ''}`} nowrap /></td>
              <td className="tnum" style={{ whiteSpace: 'nowrap' }}>{aValider ? refDeclaration(x.id) : fiche(x)?.matriculeSite ?? '—'}</td>
              <td>{site(x.siteCode)}</td>
              <td className="tnum" style={{ whiteSpace: 'nowrap' }}>{venue(x)}{x.statut === 'annulee' && <> · <span className="text-danger">{STATUT_DECLARATION_LABEL.annulee}</span></>}</td>
              <td>{x.objet}</td>
              <td className="right">
                {rh && (
                  <div style={{ display: 'flex', gap: 'var(--space-1)', justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    {aValider && <Btn small onClick={() => openDialog({ type: 'confirmer', c: refusDeclaration(x, mois) })}>Refuser</Btn>}
                    {(x.statut === 'validee' || aValider) && <Btn small onClick={() => openDialog({ type: 'confirmer', c: annulationDeclaration(x, mois) })}>{aValider ? 'Sans suite' : 'Annuler'}</Btn>}
                    {aValider && <Btn small variant="secondary" onClick={() => openDialog({ type: 'validerDeclaration', id: x.id })}>Valider</Btn>}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
  // lot 14, étape 2 — pré-déclarations
  const gardeDecl = (x: DeclarationPresence) => !q || [nomComplet(x), x.entreprise, refDeclaration(x.id)].some(v => v.toLowerCase().includes(q));
  const declarations = (d.ds.declarationsPresence ?? []).filter(gardeDecl);
  const aValider = declarations.filter(x => x.statut === 'a_valider').sort((a, b) => a.du.localeCompare(b.du) || a.id - b.id);
  const prevues = declarations.filter(x => (x.statut === 'validee' || (x.statut === 'annulee' && x.valideeLe)) && x.au >= d.ti).sort((a, b) => a.du.localeCompare(b.du) || a.id - b.id);
  const liens = (d.ds.liensDeclaration ?? []).filter(l => !l.revoqueLe).sort((a, b) => a.entreprise.localeCompare(b.entreprise));
  return (
    <Page
      kicker="Intérimaires et salariés d’entreprises extérieures · matricule de site permanent (I, E)"
      title="Personnes sur site"
      actions={rh ? <>
        <button type="button" className="btn btn-secondary" onClick={() => openDialog({ type: 'lienDeclaration' })}>Nouveau lien de déclaration</button>
        <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'exterieur' })}>Nouvel extérieur</button>
      </> : undefined}
    >
      <div className="filtres-liste">
        <input className="input" type="search" placeholder="Nom, entreprise, agence ou matricule…" aria-label="Rechercher une personne sur site" value={recherche} onChange={ev => setRecherche(ev.target.value)} />
      </div>
      {rh && (
        <Panel title="Déclarations à valider" aside={plural(aValider.length, 'déclaration', 'déclarations')} highlight={aValider.length > 0}>
          {aValider.length === 0 ? <Empty>Aucune déclaration en attente{q ? ' pour cette recherche' : ''}.</Empty> : <Declarations liste={aValider} aValider />}
        </Panel>
      )}
      <Panel title="Présences prévues" aside={`${plural(prevues.length, 'venue', 'venues')} · validées par le service RH`}>
        {prevues.length === 0 ? <Empty>Aucune venue prévue{q ? ' pour cette recherche' : ''}.</Empty> : <Declarations liste={prevues} aValider={false} />}
      </Panel>
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
      {rh && (
        <Panel title="Liens de déclaration" aside={plural(liens.length, 'lien en vigueur', 'liens en vigueur')}>
          {liens.length === 0 ? <Empty>Aucun lien : créez-en un par entreprise extérieure ou par agence d’intérim.</Empty> : (
            <div className="scroll-x">
              <table className="table">
                <thead><tr><th>Entreprise ou agence</th><th>Créé</th><th>Dernière déclaration</th><th></th></tr></thead>
                <tbody>
                  {liens.map(l => (
                    <tr key={l.id}>
                      <td><Two main={l.entreprise} sub={l.categorie === 'interimaire' ? 'Agence d’intérim' : 'Entreprise extérieure'} nowrap /></td>
                      <td>{fmt(new Date(l.creeLe))} · {l.creePar}</td>
                      <td>{l.dernierUsage ? fmt(new Date(l.dernierUsage)) : '—'}</td>
                      <td className="right"><Btn small onClick={() => openDialog({ type: 'confirmer', c: revocationLien(l) })}>Révoquer</Btn></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </Page>
  );
}
