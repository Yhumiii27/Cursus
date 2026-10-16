// Paramètres → Matricules de paie : identifiant des salariés échangé avec Keystone (administrateur RH) et salariés à
// payer sans matricule de paie, refusés d'une transmission réelle à Sage Paie tant qu'il n'est pas saisi sur leur fiche.
import { matricule, plural } from '../../../../shared/format.ts';
import { sansMatriculePaie } from '../../../../shared/rules/matricules.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel, SectionLabel, Seg, Tag } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useData, useStore } from '../../state/store.tsx';
import { MONO, type SectionProps, useEnregistrerReglages } from './commun.ts';

export function MatriculesPaie({ s }: SectionProps) {
  const data = useData();
  const { go } = useStore();
  const { admin, rh } = useRole();
  const save = useEnregistrerReglages();
  const sans = sansMatriculePaie(data.employes, data.today);
  return (
    <Panel title="Matricules de paie" style={{ gap: 'var(--space-4)' }}
      aside={sans.length ? <Tag cls="tag-accent">{plural(sans.length, 'matricule à saisir', 'matricules à saisir')}</Tag> : <Tag cls="tag-neutral">Tous saisis</Tag>}>
      <Field label="Identifiant envoyé à Keystone">
        <Seg name="param-identifiant-keystone" label="Identifiant envoyé à Keystone" value={s.identifiantKeystone} disabled={!admin}
          options={[['cursus', 'Matricule Cursus'], ['paie', 'Matricule de paie']]} onChange={v => save({ identifiantKeystone: v })} />
      </Field>
      <Fine>
        Matricule Cursus (<span style={MONO}>EMP-0001</span>) : contrat de l’API Keystone v1, par défaut. Le matricule de paie le remplace dans les
        deux sens (messages envoyés, appels reçus) : prévenir Keystone avant la bascule. Un salarié sans matricule de paie garde son matricule Cursus.
      </Fine>
      <SectionLabel>Salariés sans matricule de paie</SectionLabel>
      {sans.length > 0 ? (
        <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
          {sans.map(e => (
            <div key={e.id} className="list-row">
              <div className="grow">
                <div style={{ fontSize: 14 }}>{e.nom}</div>
                <div className="text-muted sub">{e.poste} · <span style={MONO}>{matricule(e.id)}</span></div>
              </div>
              {rh && <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('collaborateurs', { selectedId: e.id, search: '' })}>Fiche →</button>}
            </div>
          ))}
        </div>
      ) : <Fine>Tous les salariés présents ont leur matricule de paie (intérimaires exclus : payés par leur agence).</Fine>}
      <Fine>
        Le matricule de paie se saisit sur la fiche (1 à 20 lettres et chiffres, unique). Tant qu’il manque, le salarié est transmis sous son
        matricule Cursus en simulation et refusé d’une transmission réelle à Sage Paie.
      </Fine>
    </Panel>
  );
}
