"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ChangedIndicator } from "@/components/ui/ChangedIndicator";
import { Combobox } from "@/components/ui/Combobox";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import {
  EMPTY_RESTRICTED_ACCESS_DRAFT,
  RestrictedAccessPicker,
  type RestrictedAccessDraft,
} from "@/components/knowledge/RestrictedAccessPicker";
import { useRouter } from "@/i18n/navigation";
import { addAccessGrant, removeAccessGrant } from "@/lib/api/accessGrants";
import { createFailure, getComponents, getProjects, updateFailure, type FailureWritePayload } from "@/lib/api/engineering";
import type {
  ComponentSummary,
  FailureDetail,
  FailureSeverity,
  FailureStatus,
  ProjectSummary,
  Visibility,
} from "@/lib/api/types";
import { FAILURE_SEVERITY_ICONS, FAILURE_STATUS_ICONS, VISIBILITY_ICONS } from "@/lib/optionIcons";

const SEVERITY_VALUES: FailureSeverity[] = ["LOW", "MEDIUM", "HIGH"];
const STATUS_VALUES: FailureStatus[] = ["UNDER_INVESTIGATION", "RESOLVED"];
const VISIBILITY_VALUES: Visibility[] = ["PUBLIC", "RESTRICTED"];

interface FailureEditorProps {
  failure?: FailureDetail;
  onDirtyChange?: (dirty: boolean) => void;
}

// Structured like ArticleEditor.tsx - no draft/review workflow (see
// backend/knowledge/models.py's Failure docstring), so one Save action.
// Four separate markdown bodies (summary/root cause/corrective/preventive)
// instead of one - matches docs/VISION.md #16's field list and the
// athar_failure_detail mockup's actual section breakdown.
export function FailureEditor({ failure, onDirtyChange }: FailureEditorProps) {
  const t = useTranslations("engineering.failure");
  const commonT = useTranslations("common");
  const severityT = useTranslations("engineering.failureSeverity");
  const statusT = useTranslations("engineering.failureStatus");
  const router = useRouter();

  const [components, setComponents] = useState<ComponentSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [title, setTitle] = useState(failure?.title ?? "");
  const [componentId, setComponentId] = useState<string | null>(failure?.component?.id ?? null);
  const [projectId, setProjectId] = useState<string | null>(failure?.project?.id ?? null);
  const [aircraft, setAircraft] = useState(failure?.aircraft ?? "");
  const [date, setDate] = useState<string | null>(failure?.date ?? null);
  const [severity, setSeverity] = useState<FailureSeverity>(failure?.severity ?? "MEDIUM");
  const [status, setStatus] = useState<FailureStatus>(failure?.status ?? "UNDER_INVESTIGATION");
  const [summary, setSummary] = useState(failure?.summary ?? "");
  const [rootCause, setRootCause] = useState(failure?.root_cause ?? "");
  const [correctiveAction, setCorrectiveAction] = useState(failure?.corrective_action ?? "");
  const [preventiveAction, setPreventiveAction] = useState(failure?.preventive_action ?? "");
  const [visibility, setVisibility] = useState<Visibility>(failure?.visibility ?? "PUBLIC");
  const [restrictedAccessDraft, setRestrictedAccessDraft] = useState<RestrictedAccessDraft>(
    EMPTY_RESTRICTED_ACCESS_DRAFT,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // First page only (20 items) for these picker dropdowns - same known
    // limitation as the Components/Projects list pages before their own
    // Pagination controls were added, just not worth a paged combobox here too.
    getComponents().then((data) => setComponents(data.results));
    getProjects().then((data) => setProjects(data.results));
  }, []);

  const fieldChanged = {
    title: title !== (failure?.title ?? ""),
    component: componentId !== (failure?.component?.id ?? null),
    project: projectId !== (failure?.project?.id ?? null),
    aircraft: aircraft !== (failure?.aircraft ?? ""),
    date: date !== (failure?.date ?? null),
    severity: severity !== (failure?.severity ?? "MEDIUM"),
    status: status !== (failure?.status ?? "UNDER_INVESTIGATION"),
    summary: summary !== (failure?.summary ?? ""),
    rootCause: rootCause !== (failure?.root_cause ?? ""),
    correctiveAction: correctiveAction !== (failure?.corrective_action ?? ""),
    preventiveAction: preventiveAction !== (failure?.preventive_action ?? ""),
    visibility: visibility !== (failure?.visibility ?? "PUBLIC"),
    restrictedAccess:
      restrictedAccessDraft.pendingAdd.length > 0 || restrictedAccessDraft.pendingRemoveGrantIds.length > 0,
  };

  const isDirty = Object.values(fieldChanged).some(Boolean);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  function buildPayload(): FailureWritePayload {
    return {
      title,
      component_id: componentId,
      project_id: projectId,
      aircraft,
      date,
      severity,
      status,
      summary,
      root_cause: rootCause,
      corrective_action: correctiveAction,
      preventive_action: preventiveAction,
      visibility,
    };
  }

  async function syncRestrictedAccess(failureId: string) {
    for (const grantId of restrictedAccessDraft.pendingRemoveGrantIds) {
      await removeAccessGrant(grantId);
    }
    for (const user of restrictedAccessDraft.pendingAdd) {
      await addAccessGrant("failure", failureId, user.id);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const saved = failure ? await updateFailure(failure.id, buildPayload()) : await createFailure(buildPayload());
      await syncRestrictedAccess(saved.id);
      router.push(`/failures/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-[800px] mx-auto">
      <div className="space-y-4 border-b border-outline-variant pb-4">
        <ChangedIndicator changed={fieldChanged.title}>
          <input
            className="w-full font-headline-lg text-headline-lg font-bold border-none bg-transparent placeholder:text-on-surface-variant/50 focus:ring-0 p-0 text-on-surface outline-none"
            placeholder={t("titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </ChangedIndicator>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ChangedIndicator changed={fieldChanged.component}>
            <Combobox
              label={t("componentLabel")}
              options={components.map((c) => ({ value: c.id, label: c.name }))}
              value={componentId}
              onChange={setComponentId}
            />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.project}>
            <Combobox
              label={t("projectLabel")}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              value={projectId}
              onChange={setProjectId}
            />
          </ChangedIndicator>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ChangedIndicator changed={fieldChanged.aircraft}>
            <input
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              placeholder={t("aircraftPlaceholder")}
              value={aircraft}
              onChange={(e) => setAircraft(e.target.value)}
            />
          </ChangedIndicator>
          {/* Native date input, not DatePicker - DatePicker's value/onChange
              speak UTC timestamps (see its own JSDoc), but Failure.date is a
              plain "YYYY-MM-DD" calendar date (Django DateField). A native
              <input type="date"> already speaks that exact format with no
              timezone conversion in either direction. */}
          <ChangedIndicator changed={fieldChanged.date} className="space-y-2">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
              {t("dateLabel")}
            </label>
            <input
              type="date"
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              value={date ?? ""}
              onChange={(e) => setDate(e.target.value || null)}
            />
          </ChangedIndicator>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ChangedIndicator changed={fieldChanged.severity}>
            <Combobox
              label={t("severityLabel")}
              options={SEVERITY_VALUES.map((value) => ({ value, label: severityT(value), ...FAILURE_SEVERITY_ICONS[value] }))}
              value={severity}
              onChange={(value) => setSeverity(value as FailureSeverity)}
            />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.status}>
            <Combobox
              label={t("statusLabel")}
              options={STATUS_VALUES.map((value) => ({ value, label: statusT(value), ...FAILURE_STATUS_ICONS[value] }))}
              value={status}
              onChange={(value) => setStatus(value as FailureStatus)}
            />
          </ChangedIndicator>
        </div>
        <ChangedIndicator changed={fieldChanged.visibility} className="w-48">
          <Combobox
            placeholder={t("visibilityLabel")}
            options={VISIBILITY_VALUES.map((value) => ({ value, label: t(`visibility${value}`), ...VISIBILITY_ICONS[value] }))}
            value={visibility}
            onChange={(value) => setVisibility(value as Visibility)}
          />
        </ChangedIndicator>
        {visibility === "RESTRICTED" && (
          <ChangedIndicator changed={fieldChanged.restrictedAccess}>
            <RestrictedAccessPicker
              initialGrants={failure?.restricted_to ?? []}
              value={restrictedAccessDraft}
              onChange={setRestrictedAccessDraft}
            />
          </ChangedIndicator>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("summaryLabel")}</h3>
        <ChangedIndicator changed={fieldChanged.summary}>
          <MarkdownEditor
            value={summary}
            onChange={setSummary}
            placeholder={t("summaryPlaceholder")}
            relateFrom={failure ? { type: "failure", id: failure.id } : undefined}
          />
        </ChangedIndicator>
      </div>
      <div className="space-y-2">
        <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("rootCauseLabel")}</h3>
        <ChangedIndicator changed={fieldChanged.rootCause}>
          <MarkdownEditor
            value={rootCause}
            onChange={setRootCause}
            placeholder={t("rootCausePlaceholder")}
            relateFrom={failure ? { type: "failure", id: failure.id } : undefined}
          />
        </ChangedIndicator>
      </div>
      <div className="space-y-2">
        <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("correctiveActionLabel")}</h3>
        <ChangedIndicator changed={fieldChanged.correctiveAction}>
          <MarkdownEditor
            value={correctiveAction}
            onChange={setCorrectiveAction}
            placeholder={t("correctiveActionPlaceholder")}
            relateFrom={failure ? { type: "failure", id: failure.id } : undefined}
          />
        </ChangedIndicator>
      </div>
      <div className="space-y-2">
        <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("preventiveActionLabel")}</h3>
        <ChangedIndicator changed={fieldChanged.preventiveAction}>
          <MarkdownEditor
            value={preventiveAction}
            onChange={setPreventiveAction}
            placeholder={t("preventiveActionPlaceholder")}
            relateFrom={failure ? { type: "failure", id: failure.id } : undefined}
          />
        </ChangedIndicator>
      </div>

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isSaving || !title.trim() || (!!failure && !isDirty)}>
          {isSaving ? commonT("saving") : commonT("save")}
        </Button>
      </div>
    </div>
  );
}
