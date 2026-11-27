'use client';
// Pièces communes de « Mes tâches » et « Mes approbations » (Norma 2.4, charte/COQUE.md § 2 bis) : outil d'origine (logo et
// nom), échéance, état, bandeau « source indisponible ». Texte saisi (titre, référence) affiché tel quel, jamais par `t()`.
import { ArrowSquareOut, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import { useI18n } from '@/i18n/client';
import { Tag } from './Tag';
import { ToolLogo, type ToolCode, TOOL_CODES } from './ToolLogo';
import { TOOL_NAMES } from './base-nav';
import { isLate, type TaskRow, type TaskState } from './task-rules';

/** English sources of the states (French in ./taches-fr.ts). */
export const STATE_LABELS: Record<TaskState, string> = {
  a_faire: 'To do', en_cours: 'In progress', en_attente: 'Waiting', faite: 'Done', annulee: 'Cancelled',
};

const isTool = (c: string): c is ToolCode => (TOOL_CODES as readonly string[]).includes(c);
export const toolName = (code: string) => (isTool(code) ? TOOL_NAMES[code] : code);

/** Source tool of a row: 16 px logo and name (the logo is decorative, the name is read). */
export function TaskSource({ outil }: { outil: string }) {
  return (
    <span className="coque-task-src">
      {isTool(outil) && <ToolLogo code={outil} size={16} />}
      <span>{toolName(outil)}</span>
    </span>
  );
}

/** Due date in the viewer's language; late = accent text with the warning icon (never the colour alone). */
export function DueText({ row, today }: { row: Pick<TaskRow, 'echeance' | 'etat'>; today: string }) {
  const { t, lang } = useI18n();
  if (!row.echeance) return <span className="coque-task-muted">{t('No due date')}</span>;
  const text = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${row.echeance}T00:00:00Z`));
  const late = isLate(row, today);
  return (
    <time dateTime={row.echeance} className={late ? 'coque-task-late' : undefined}>
      {late && <WarningCircle size={13} aria-hidden />}
      {text}
      {late && <span className="coque-sr-only"> — {t('Late')}</span>}
    </time>
  );
}

export function StateTag({ etat }: { etat: TaskState }) {
  const { t } = useI18n();
  const tone = etat === 'a_faire' ? 'outline' : etat === 'en_cours' ? 'accent' : 'neutral';
  return <Tag tone={tone} size="sm">{t(STATE_LABELS[etat])}</Tag>;
}

/** Deep link to the task in its owner tool (absolute `lien` of the row); a new tab when it is another tool. */
export function OpenInTool({ row, tool }: { row: Pick<TaskRow, 'lien' | 'outil'>; tool: string }) {
  const { t } = useI18n();
  const other = row.outil !== tool;
  return (
    <a className="btn btn-ghost coque-task-open" href={row.lien} target={other ? '_blank' : undefined} rel={other ? 'noopener' : undefined}>
      {other ? `${t('Open in')} ${toolName(row.outil)}` : t('Open')}
      {other && <ArrowSquareOut size={13} aria-hidden />}
    </a>
  );
}

/** « <Tool>: source unavailable » for each tool whose publication could not be read (Norma § 5: a state, never an error). */
export function SourcesBanner({ unavailable }: { unavailable?: readonly string[] }) {
  const { t } = useI18n();
  if (!unavailable?.length) return null;
  return (
    <div className="coque-task-unavail" role="status">
      <WarningCircle size={15} aria-hidden />
      <span>
        {unavailable.map((o) => toolName(o)).join(', ')} : {t('source unavailable')} — {t('their tasks are not shown')}
      </span>
    </div>
  );
}
