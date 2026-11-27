// Paramètres → Matricules de paie : identifiant des salariés échangé avec Keystone (administrateur RH) et salariés à
// payer sans matricule de paie, refusés d'une transmission réelle à Sage Paie tant qu'il n'est pas saisi sur leur fiche.
import { matricule } from '../../../../shared/format.ts';
import { sansMatriculePaie } from '../../../../shared/rules/matricules.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel, SectionLabel, Seg, Tag } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useData, useStore } from '../../state/store.tsx';
import { MONO, type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t, tn } from '../../i18n/langue.ts';

export function MatriculesPaie({ s }: SectionProps) {
  const data = useData();
  const { go } = useStore();
  const { admin, rh } = useRole();
  const save = useEnregistrerReglages();
  const sans = sansMatriculePaie(data.employes, data.today);
  return (
    <Panel title={t('Payroll employee numbers')} style={{ gap: 'var(--space-4)' }}
      aside={sans.length ? <Tag cls="tag-accent">{tn(sans.length, 'employee number to enter', 'employee numbers to enter')}</Tag> : <Tag cls="tag-neutral">{t('All entered')}</Tag>}>
      <Field label={t('Identifier sent to Keystone')}>
        <Seg name="param-identifiant-keystone" label={t('Identifier sent to Keystone')} value={s.identifiantKeystone} disabled={!admin}
          options={[['cursus', t('Cursus employee number')], ['paie', t('Payroll employee number')]]} onChange={v => save({ identifiantKeystone: v })} />
      </Field>
      <Fine>
        {t('Cursus employee number (')}<span style={MONO}>EMP-0001</span>{t('): contract of the Keystone v1 API, by default. The payroll employee number replaces it in both directions (messages sent, calls received): warn Keystone before the switch. An employee without a payroll employee number keeps their Cursus number.')}
      </Fine>
      <SectionLabel>{t('Employees without a payroll employee number')}</SectionLabel>
      {sans.length > 0 ? (
        <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
          {sans.map(e => (
            <div key={e.id} className="list-row">
              <div className="grow">
                <div style={{ fontSize: 14 }}>{e.nom}</div>
                <div className="text-muted sub">{e.poste} · <span style={MONO}>{matricule(e.id)}</span></div>
              </div>
              {rh && <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('collaborateurs', { selectedId: e.id, search: '' })}>{t('Sheet →')}</button>}
            </div>
          ))}
        </div>
      ) : <Fine>{t('All present employees have their payroll employee number (temps excluded: paid by their agency).')}</Fine>}
      <Fine>
        {t('The payroll employee number is entered on the sheet (1 to 20 letters and digits, unique). As long as it is missing, the employee is transmitted under their Cursus number in simulation and refused from a real transmission to Sage Paie.')}
      </Fine>
    </Panel>
  );
}
