// Équipes & managers (lot 11, chantier C1, étape 2) : entité, site et unité Matrix d'une équipe, en un formulaire.
// - Entité : équipe racine seulement (une équipe rattachée relève de l'entité de son équipe racine) ; entité ouverte.
// - Site (D14) et unité de l'organigramme de Matrix (D15, code saisi à la main, unique) : vides, ceux d'une équipe
//   au-dessus (et, pour le site, celui de l'entité). Le site et l'unité des membres suivent (server/src/rattachements.ts).
// Aucun valideur ne change. Chaque champ modifié part par son action (`equipe.entite`, `equipe.site`, `equipe.unite`) ;
// les contrôles sont ceux du serveur (shared/rules/entites.ts).
import { useState } from 'react';
import { controleEntiteEquipe, controleSite, controleUnite, entiteEquipe, entiteOuverte, normaliserCodeUnite, rattachementSalarie } from '../../../shared/rules/entites.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { libelleSite } from '../organigramme-vue.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function EquipeRattachementDialog({ nom }: { nom: string }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const r = d.ds.referentiels;
  const entites = r.entites ?? [], sites = r.sites ?? [];
  const [q] = useState(() => r.equipes.find(x => x.nom === nom) ?? null);
  const [entite, setEntite] = useState(q?.entite ?? '');
  const [site, setSite] = useState(q?.siteCode ?? '');
  const [unite, setUnite] = useState(q?.uniteCode ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!q) {
    return <Dialog title="Rattachement de l’équipe" width={480} actions={<CancelButton label="Fermer" />}><Bloquant>Cette équipe n’existe plus.</Bloquant></Dialog>;
  }
  const racine = !q.parente;
  const code = normaliserCodeUnite(unite) || null;
  const changeEntite = racine && (entite || null) !== (q.entite ?? null);
  const changeSite = (site || null) !== (q.siteCode ?? null);
  const changeUnite = code !== (q.uniteCode ?? null);
  const erreurEntite = changeEntite ? controleEntiteEquipe(r.equipes, entites, q.nom, entite || null) : null;
  const erreurSite = changeSite ? controleSite(sites, site || null, q.siteCode) : null;
  const erreurUnite = changeUnite ? controleUnite(r.equipes, q.nom, code) : null;
  // Valeurs héritées quand le champ est vide : entité de l'équipe racine, site et unité d'une équipe au-dessus.
  const heritee = entites.find(x => x.code === entiteEquipe(r.equipes, q.nom));
  const sansLuiMeme = r.equipes.map(x => (x.nom === q.nom ? { ...x, siteCode: null, uniteCode: null, entite: entite || null } : x));
  const herite = rattachementSalarie(sansLuiMeme, entites, q.nom);

  const envoyer = async () => {
    if (busy || !v.verifier(erreurEntite, erreurSite, erreurUnite)) return;
    if (!changeEntite && !changeSite && !changeUnite) { closeDialog(); return; }
    setBusy(true);
    // Une action par champ modifié ; la suivante n'est envoyée qu'après le succès de la précédente.
    const envois: [Parameters<typeof run>[0], Record<string, unknown>][] = [];
    if (changeEntite) envois.push(['equipe.entite', { nom: q.nom, entite }]);
    if (changeSite) envois.push(['equipe.site', { nom: q.nom, siteCode: site }]);
    if (changeUnite) envois.push(['equipe.unite', { nom: q.nom, uniteCode: code ?? '' }]);
    let ok = true;
    for (const [action, p] of envois) {
      ok = (await run(action, p)).ok;
      if (!ok) break;
    }
    setBusy(false);
    if (ok) closeDialog();
  };

  const entitesProposees = entites.filter(x => entiteOuverte(x) || x.code === q.entite);
  const sitesProposes = sites.filter(s => s.actif || s.code === q.siteCode);
  return (
    <Dialog title={`Rattachement de ${q.nom}`} width={520} onSubmit={envoyer}
      actions={<>
        <CancelButton />
        <SubmitButton busy={busy}>Enregistrer</SubmitButton>
      </>}>
      {racine ? (
        <Field label="Entité (société ou établissement)" htmlFor="rat-entite" erreur={v.erreur(erreurEntite) ?? (entite ? erreurEntite : null)}>
          <select className="input" id="rat-entite" autoFocus value={entite} onChange={e => setEntite(e.target.value)}>
            <option value="">Aucune — signalée au service RH</option>
            {entitesProposees.map(x => <option key={x.code} value={x.code}>{x.type === 'etablissement' ? `— ${x.nom}` : x.nom}</option>)}
          </select>
        </Field>
      ) : (
        <Fine>Équipe rattachée à {q.parente} : elle relève de l’entité de son équipe racine{heritee ? ` (${heritee.nom})` : ''}.</Fine>
      )}
      <div className="grid-2">
        <Field label="Site" htmlFor="rat-site" erreur={erreurSite}>
          <select className="input" id="rat-site" autoFocus={!racine} value={site} onChange={e => setSite(e.target.value)}>
            <option value="">{herite.siteCode ? `Hérité : ${libelleSite(sites, herite.siteCode)}` : 'Aucun'}</option>
            {sitesProposes.map(s => <option key={s.code} value={s.code}>{s.libelle}</option>)}
          </select>
        </Field>
        <Field label="Unité Matrix" htmlFor="rat-unite" erreur={unite.trim() ? erreurUnite : v.erreur(erreurUnite)}>
          <input className="input" id="rat-unite" type="text" value={unite} maxLength={40} autoComplete="off" spellCheck={false}
            placeholder={herite.uniteCode ? `Héritée : ${herite.uniteCode}` : 'PRD-MAINT'} onChange={e => setUnite(e.target.value.toUpperCase())} />
        </Field>
      </div>
      <Fine>
        Aucun valideur ne change : les validations suivent les managers et les équipes parentes. Le site et l’unité, vides, sont ceux d’une équipe
        au-dessus (le site, à défaut, celui de l’entité) ; ceux des membres suivent et partent à Matrix avec leur fiche. Code d’unité au format de
        l’organigramme de Matrix : PRD, PRD-MAINT, PRD-MAINT-EQ1.
      </Fine>
    </Dialog>
  );
}
