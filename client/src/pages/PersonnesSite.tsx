// lot 14 — personnes sur site (demande de Vigie du 4 novembre 2026, décision CV-10 ; shared/rules/personnes-site.ts) :
// salariés d'entreprises extérieures (fiches tenues par le service RH, matricule E) et intérimaires (matricule I, fiche
// ordinaire de l'annuaire), avec leurs titres et habilitations. Service RH (création, modification, titres), référent HSE
// et lecture seule en consultation. lot 14, étape 2 : pré-déclarations (shared/rules/declarations-presence.ts) — à valider et
// liens par entreprise ou agence pour le service RH, présences prévues validées pour tous les lecteurs de l'écran.
import { useState } from 'react';
import { fmt, fmtIso } from '../../../shared/format.ts';
import { CONSERVATION_DEFAUT_MOIS, nomComplet, refDeclaration, STATUT_DECLARATION_LABEL } from '../../../shared/rules/declarations-presence.ts';
import { present } from '../../../shared/rules/contrats.ts';
import type { DeclarationPresence, Employe } from '../../../shared/types.ts';
import { annulationDeclaration, refusDeclaration, revocationLien } from '../state/confirmations-declarations.ts';
import { Btn, Empty, Page, Panel, Two } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

function Titres({ e }: { e: Employe }) {
  const d = useDomain();
  const { certs, habs } = d.titresDe(e, d.ds.settings.horizonAlerte);
  const parts = [
    ...certs.map(c => `${c.fm.nom}${c.fm.validite ? `${t(' · until ')}${fmt(c.exp)}` : ''}`),
    ...habs.map(h => `${h.hm.nom}${h.exp ? `${t(' · until ')}${fmt(h.exp)}` : ''}`),
  ];
  return parts.length ? <span>{parts.join(' — ')}</span> : <span className="text-muted">{t('no title')}</span>;
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
        <thead><tr><th>{t('Person')}</th><th>{t(aValider ? 'Reference' : 'Employee number')}</th><th>{t('Site')}</th><th>{t('Visit')}</th><th>{t('Purpose')}</th><th></th></tr></thead>
        <tbody>
          {liste.map(x => (
            <tr key={x.id}>
              <td><Two main={fiche(x)?.nom ?? nomComplet(x)} sub={`${x.entreprise}${x.categorie === 'interimaire' ? t(' (agency)') : ''}${x.email ? ` · ${x.email}` : ''}`} nowrap /></td>
              <td className="tnum" style={{ whiteSpace: 'nowrap' }}>{aValider ? refDeclaration(x.id) : fiche(x)?.matriculeSite ?? '—'}</td>
              <td>{site(x.siteCode)}</td>
              <td className="tnum" style={{ whiteSpace: 'nowrap' }}>{venue(x)}{x.statut === 'annulee' && <> · <span className="text-danger">{STATUT_DECLARATION_LABEL.annulee}</span></>}</td>
              <td>{x.objet}</td>
              <td className="right">
                {rh && (
                  <div style={{ display: 'flex', gap: 'var(--space-1)', justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    {aValider && <Btn small onClick={() => openDialog({ type: 'confirmer', c: refusDeclaration(x, mois) })}>{t('Refuse')}</Btn>}
                    {(x.statut === 'validee' || aValider) && <Btn small onClick={() => openDialog({ type: 'confirmer', c: annulationDeclaration(x, mois) })}>{t(aValider ? 'No follow-up' : 'Cancel')}</Btn>}
                    {aValider && <Btn small variant="secondary" onClick={() => openDialog({ type: 'validerDeclaration', id: x.id })}>{t('Approve')}</Btn>}
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
      kicker={t('Temporary workers and employees of outside companies · permanent site number (I, E)')}
      title={t('People on site')}
      actions={rh ? <>
        <button type="button" className="btn btn-secondary" onClick={() => openDialog({ type: 'lienDeclaration' })}>{t('New declaration link')}</button>
        <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'exterieur' })}>{t('New outside worker')}</button>
      </> : undefined}
    >
      <div className="filtres-liste">
        <input className="input" type="search" placeholder={t('Name, company, agency or number…')} aria-label={t('Search for a person on site')} value={recherche} onChange={ev => setRecherche(ev.target.value)} />
      </div>
      {rh && (
        <Panel title={t('Declarations to approve')} aside={tn(aValider.length, 'declaration', 'declarations')} highlight={aValider.length > 0}>
          {aValider.length === 0 ? <Empty>{t('No declaration pending')}{q ? t(' for this search') : ''}.</Empty> : <Declarations liste={aValider} aValider />}
        </Panel>
      )}
      <Panel title={t('Planned presences')} aside={`${tn(prevues.length, 'visit', 'visits')} · ${t('approved by HR#visits')}`}>
        {prevues.length === 0 ? <Empty>{t('No visit planned')}{q ? t(' for this search') : ''}.</Empty> : <Declarations liste={prevues} aValider={false} />}
      </Panel>
      <Panel title={t('Employees of outside companies')} aside={tn(exterieurs.length, 'sheet', 'sheets')}>
        {exterieurs.length === 0 ? <Empty>{t('No outside worker’s sheet')}{q ? t(' for this search') : ''}.</Empty> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Person')}</th><th>{t('Employee number')}</th><th>{t('Titles and authorisations')}</th><th></th></tr></thead>
              <tbody>
                {exterieurs.map(e => (
                  <tr key={e.id}>
                    <td><Two main={e.nom} sub={`${e.entreprise ?? '—'}${e.email ? ` · ${e.email}` : ''}`} nowrap /></td>
                    <td className="tnum">{e.matriculeSite}</td>
                    <td><Titres e={e} /></td>
                    <td className="right">
                      <div style={{ display: 'flex', gap: 'var(--space-1)', justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        {formations && <Btn small onClick={() => openDialog({ type: 'cert', empId: e.id })}>{t('Certification')}</Btn>}
                        {formations && <Btn small onClick={() => openDialog({ type: 'hab', empId: e.id, mode: 'deliver' })}>{t('Authorisation')}</Btn>}
                        {rh && <Btn small onClick={() => openDialog({ type: 'exterieur', id: e.id })}>{t('Edit')}</Btn>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title={t('Temporary workers present')} aside={`${tn(interimaires.length, 'temporary worker', 'temporary workers')} · ${t('sheet in the directory')}`}>
        {interimaires.length === 0 ? <Empty>{t('No temporary worker present')}{q ? t(' for this search') : ''}.</Empty> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Person')}</th><th>{t('Site number')}</th><th>{t('Agency')}</th></tr></thead>
              <tbody>
                {interimaires.map(e => (
                  <tr key={e.id}>
                    <td><Two main={e.nom} sub={e.equipe ?? t('to assign')} nowrap /></td>
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
        <Panel title={t('Declaration links')} aside={tn(liens.length, 'link in force', 'links in force')}>
          {liens.length === 0 ? <Empty>{t('No link: create one per outside company or per temporary work agency.')}</Empty> : (
            <div className="scroll-x">
              <table className="table">
                <thead><tr><th>{t('Company or agency')}</th><th>{t('Created#masc')}</th><th>{t('Last declaration')}</th><th></th></tr></thead>
                <tbody>
                  {liens.map(l => (
                    <tr key={l.id}>
                      <td><Two main={l.entreprise} sub={t(l.categorie === 'interimaire' ? 'Temporary work agency' : 'Outside company')} nowrap /></td>
                      <td>{fmt(new Date(l.creeLe))} · {l.creePar}</td>
                      <td>{l.dernierUsage ? fmt(new Date(l.dernierUsage)) : '—'}</td>
                      <td className="right"><Btn small onClick={() => openDialog({ type: 'confirmer', c: revocationLien(l) })}>{t('Revoke')}</Btn></td>
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
