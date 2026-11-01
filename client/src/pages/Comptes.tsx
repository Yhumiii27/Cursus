// Paramètres → Comptes et accès (administrateur RH) : comptes de connexion, profil (service RH ou profil restreint), espaces,
// rattachement d'un compte externe à une fiche salarié, désactivation, mot de passe provisoire (compte Cursus) ou
// rattachement Microsoft retiré (identité Microsoft recréée). La liste est rechargée après chaque action.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { COMPTE_TYPE_LABEL, ESPACE_LABEL, PROFILS_RH } from '../../../shared/constants.ts';
import { equipeLabel, fmt, norm, plural } from '../../../shared/format.ts';
import type { CompteVue, ProfilRh } from '../../../shared/types.ts';
import { api, type NomAction } from '../api.ts';
import { parDate, parTexte, trier, usePagination, useTri, type Colonne } from '../components/tri.ts';
import { SuiteListe, ThTri } from '../components/TriListe.tsx';
import { Btn, Chips, Empty, Fine, Panel, Tag, Two } from '../components/ui.tsx';
import { delierCompte, desactivationCompte, nouveauMotDePasse, rattachementCompte } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useData, useStore } from '../state/store.tsx';

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 };
const heure = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const minuscule = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** Profils restreints de l'espace RH (décidés par l'entreprise), expliqués sous la liste. */
const RESTREINTS: ProfilRh[] = ['referent_hse', 'paie', 'lecture_seule', 'comptabilite']; // lot 11 — notes de frais : profil « Comptabilité »
/** Adresse coupée de préférence avant « @ » quand la colonne est étroite. */
const coupure = (id: string) => { const i = id.indexOf('@'); return i > 0 ? <>{id.slice(0, i)}<wbr />{id.slice(i)}</> : id; };

/** Colonnes triables de la liste des comptes ; « Dernière connexion » : la plus récente d'abord, jamais connecté en dernier. */
const COLONNES: Record<string, Colonne<CompteVue>> = {
  nom: parTexte(c => c.nom),
  identifiant: parTexte(c => c.identifiant),
  profil: parTexte(c => PROFILS_RH[c.profilRh]?.label),
  etat: parTexte(c => etat(c).label),
  connexion: parDate(c => c.derniereConnexion, 'desc'),
};

/** État de connexion d'un compte : le premier motif qui empêche ou conditionne la connexion. */
function etat(c: CompteVue): { label: string; cls: string } {
  if (!c.actif) return { label: 'Désactivé', cls: 'tag-accent' };
  if (c.sorti) return { label: 'Salarié sorti', cls: 'tag-accent' };
  if (!c.espaces.length) return { label: 'Aucun espace', cls: 'tag-accent' };
  if (c.bloqueJusqua) return { label: `Bloqué jusqu’à ${heure(c.bloqueJusqua)}`, cls: 'tag-accent' };
  if (c.changerMotDePasse) return { label: 'Mot de passe provisoire', cls: 'tag-outline' };
  return { label: 'Actif', cls: 'tag-neutral' };
}

export function ComptesPanel() {
  const data = useData();
  const d = useDomain();
  const { user } = useRole();
  const { run, openDialog } = useStore();
  const [comptes, setComptes] = useState<CompteVue[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [recherche, setRecherche] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  const charger = useCallback(() => {
    let annule = false;
    api.comptes()
      .then(rows => { if (!annule) { setComptes(rows); setErreur(null); } })
      .catch(err => { if (!annule) setErreur((err as Error).message); });
    return () => { annule = true; };
  }, []);
  // Rechargée au montage et à chaque nouvel instantané (donc après chaque action).
  useEffect(() => charger(), [data, charger]);

  // Tri par colonne et pagination (t145) : l'ordre du serveur tant qu'aucun en-tête n'est cliqué.
  const t = useTri('comptes');
  const liste = useMemo(() => {
    const q = norm(recherche.trim());
    return trier((comptes ?? []).filter(c => !q || norm(`${c.nom} ${c.identifiant}`).includes(q)), COLONNES, t.tri);
  }, [comptes, recherche, t.tri]);
  const page = usePagination(liste, recherche);

  // Salariés présents sans compte : un compte externe peut être rattaché à l'une de ces fiches.
  const libres = useMemo(() => {
    const pris = new Set((comptes ?? []).map(c => c.empId));
    return d.ds.employes.filter(e => !pris.has(e.id) && !(e.fin && e.fin < d.ti)).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }, [d, comptes]);

  const agir = async (c: CompteVue, name: NomAction, payload: Record<string, unknown>) => {
    setBusy(c.id);
    const r = await run(name, { id: c.id, ...payload });
    setBusy(null);
    return r;
  };
  // Désactiver, délier, attribuer un mot de passe : confirmation (state/confirmations.ts) ; réactiver : aussitôt.
  const basculer = (c: CompteVue) => {
    if (c.actif) openDialog({ type: 'confirmer', c: desactivationCompte(c) });
    else agir(c, 'compte.activer', { actif: true });
  };
  const delier = (c: CompteVue) => openDialog({ type: 'confirmer', c: delierCompte(c) });
  const reinitialiser = (c: CompteVue) => openDialog({ type: 'confirmer', c: nouveauMotDePasse(c) });

  const rattacher = (c: CompteVue, empId: string) => {
    const e = empId ? d.emp(Number(empId)) : undefined;
    if (e) openDialog({ type: 'confirmer', c: rattachementCompte(c, e) });
  };

  const actifs = (comptes ?? []).filter(c => c.actif).length;

  return (
    <Panel head={
      <div className="panel-head center">
        <div>
          <h2>Comptes et accès</h2>
          <div className="text-muted sub">
            {comptes ? `${plural(comptes.length, 'compte', 'comptes')} · ${plural(actifs, 'actif', 'actifs')}` : 'Chargement…'}
          </div>
        </div>
        <div className="actions-end" style={{ alignItems: 'center' }}>
          <input className="input" type="search" placeholder="Rechercher un compte…" aria-label="Rechercher un compte" value={recherche}
            onChange={e => setRecherche(e.target.value)} style={{ width: 220 }} />
          <Btn variant="primary" small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'compte' })}>Créer un compte</Btn>
        </div>
      </div>
    }>
      <Fine>
        {PROFILS_RH.rh_gestionnaire.label} : {minuscule(PROFILS_RH.rh_gestionnaire.aide)}. {PROFILS_RH.rh_admin.label} : {minuscule(PROFILS_RH.rh_admin.aide)}.
        {' '}Un salarié ouvre aussi son espace collaborateur, et l’espace manager s’il encadre une équipe. Désactiver un compte ferme aussitôt ses sessions.
        {' '}Un membre du service RH qui est aussi salarié porte son profil sur le compte rattaché à sa fiche : Cursus l’empêche alors de décider de ses propres absences, feuilles de temps ou entretiens. Un compte externe créé avant la fiche s’y rattache (« Rattacher à une fiche »).
      </Fine>
      <Fine>
        Profils restreints, dans l’espace RH : {RESTREINTS.map(p => `${PROFILS_RH[p].label} (${minuscule(PROFILS_RH[p].aide)})`).join(' ; ')}.
      </Fine>
      {erreur && <p className="form-error">{erreur}</p>}
      {comptes != null && liste.length === 0 && <Empty pad="sm">{recherche ? 'Aucun compte ne correspond à la recherche.' : 'Aucun compte.'}</Empty>}
      {liste.length > 0 && (
        <div className="scroll-x" style={{ maxHeight: 560, overflowY: 'auto' }}>
          <table className="table">
            <thead><tr>
              <ThTri t={t} col="nom">Personne</ThTri>
              <ThTri t={t} col="identifiant">Identifiant</ThTri>
              <ThTri t={t} col="profil">Profil RH</ThTri>
              <th>Espaces</th>
              <ThTri t={t} col="etat">État</ThTri>
              <ThTri t={t} col="connexion" premier="desc">Dernière connexion</ThTri>
              <th></th>
            </tr></thead>
            <tbody>
              {page.lignes.map(c => {
                const e = c.empId ? d.emp(c.empId) : undefined;
                const st = etat(c);
                const moi = c.id === user.compteId;
                const last = c.derniereConnexion ? new Date(c.derniereConnexion) : null;
                return (
                  <tr key={c.id}>
                    <td><Two main={<>{c.nom}{moi && <span className="text-muted"> · vous</span>}</>} sub={e ? `${e.poste} · ${equipeLabel(e)}` : `Externe · ${c.adresse ?? ''}`} /></td>
                    <td title={`Créé le ${fmt(new Date(c.creation))}${c.creePar ? ` par ${c.creePar}` : ''}`}>
                      <Two main={<span style={MONO}>{coupure(c.identifiant)}</span>}
                        sub={c.type === 'microsoft' && !c.rattache ? `${COMPTE_TYPE_LABEL.microsoft} · rattaché à la première connexion` : COMPTE_TYPE_LABEL[c.type]} />
                    </td>
                    <td>
                      <select className="input" aria-label={`Profil RH de ${c.nom}`} value={c.profilRh} disabled={busy === c.id}
                        onChange={ev => agir(c, 'compte.profil', { profilRh: ev.target.value })} style={{ minWidth: 160 }}>
                        {(Object.keys(PROFILS_RH) as ProfilRh[]).map(p => <option key={p} value={p} disabled={!c.empId && p === 'aucun'}>{PROFILS_RH[p].label}</option>)}
                      </select>
                    </td>
                    <td>{c.espaces.length ? <Chips items={c.espaces.map(r => ({ key: r, label: r === 'rh' ? PROFILS_RH[c.profilRh]?.espace ?? ESPACE_LABEL.rh : ESPACE_LABEL[r], cls: 'tag-outline' }))} /> : <span className="text-muted">—</span>}</td>
                    <td><Tag cls={st.cls}>{st.label}</Tag></td>
                    <td>{last ? <Two main={fmt(last)} sub={heure(c.derniereConnexion!)} nowrap /> : <span className="text-muted">Jamais</span>}</td>
                    <td>
                      <div className="actions-end">
                        {/* Compte externe, le sien compris : la fiche du même nom est proposée en premier. */}
                        {!c.empId && libres.length > 0 && (
                          <select className="input" aria-label={`Rattacher le compte de ${c.nom} à une fiche salarié`} value="" disabled={busy === c.id}
                            onChange={ev => rattacher(c, ev.target.value)} style={{ width: 180 }}>
                            <option value="">Rattacher à une fiche…</option>
                            {[...libres.filter(e => norm(e.nom) === norm(c.nom)), ...libres.filter(e => norm(e.nom) !== norm(c.nom))]
                              .map(e => <option key={e.id} value={e.id}>{e.nom} — {e.poste}</option>)}
                          </select>
                        )}
                        {!moi && <>
                          {c.type === 'local' && c.actif && <Btn small disabled={busy === c.id} onClick={() => reinitialiser(c)} title="Attribuer un nouveau mot de passe provisoire">Mot de passe</Btn>}
                          {c.type === 'microsoft' && c.rattache && <Btn small disabled={busy === c.id} onClick={() => delier(c)} title="Identité Microsoft recréée : rattacher le compte à la prochaine connexion">Délier</Btn>}
                          <Btn small disabled={busy === c.id} onClick={() => basculer(c)}>{c.actif ? 'Désactiver' : 'Réactiver'}</Btn>
                        </>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <SuiteListe p={page} unite={['compte', 'comptes']} />
    </Panel>
  );
}
