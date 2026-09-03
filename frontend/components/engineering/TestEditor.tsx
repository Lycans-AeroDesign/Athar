"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import {
  EMPTY_RESTRICTED_ACCESS_DRAFT,
  RestrictedAccessPicker,
  type RestrictedAccessDraft,
} from "@/components/knowledge/RestrictedAccessPicker";
import { useRouter } from "@/i18n/navigation";
import { addAccessGrant, removeAccessGrant } from "@/lib/api/accessGrants";
import { createTest, getProjects, updateTest, type TestWritePayload } from "@/lib/api/engineering";
import type { ProjectSummary, TestDetail, TestPassFail, TestRunStatus, TestType, Visibility } from "@/lib/api/types";

const TEST_TYPE_VALUES: TestType[] = [
  "FLIGHT",
  "THRUST",
  "STRUCTURAL",
  "ELECTRICAL",
  "GROUND",
  "SOFTWARE",
  "CALIBRATION",
  "EXPERIMENT",
  "OTHER",
];
const STATUS_VALUES: TestRunStatus[] = ["PLANNED", "IN_PROGRESS", "COMPLETED"];
const PASS_FAIL_VALUES: TestPassFail[] = ["PASS", "FAIL", "PARTIAL", "NOT_APPLICABLE"];
const VISIBILITY_VALUES: Visibility[] = ["PUBLIC", "RESTRICTED"];

interface TestEditorProps {
  test?: TestDetail;
  onDirtyChange?: (dirty: boolean) => void;
}

// Structured like FailureEditor.tsx - no draft/review workflow (see
// backend/knowledge/models.py's Test docstring), so one Save action. Four
// separate markdown bodies (configuration/procedure/results/conclusion)
// collapsing the spec's fuller section breakdown, same precedent as Failure.
export function TestEditor({ test, onDirtyChange }: TestEditorProps) {
  const t = useTranslations("engineering.test");
  const commonT = useTranslations("common");
  const testTypeT = useTranslations("engineering.testType");
  const statusT = useTranslations("engineering.testStatus");
  const passFailT = useTranslations("engineering.testPassFail");
  const router = useRouter();

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [title, setTitle] = useState(test?.title ?? "");
  const [testType, setTestType] = useState<TestType>(test?.test_type ?? "OTHER");
  const [projectId, setProjectId] = useState<string | null>(test?.project?.id ?? null);
  const [location, setLocation] = useState(test?.location ?? "");
  const [date, setDate] = useState<string | null>(test?.date ?? null);
  const [status, setStatus] = useState<TestRunStatus>(test?.status ?? "PLANNED");
  const [passFail, setPassFail] = useState<TestPassFail>(test?.pass_fail ?? "");
  const [objective, setObjective] = useState(test?.objective ?? "");
  const [configuration, setConfiguration] = useState(test?.configuration ?? "");
  const [procedure, setProcedure] = useState(test?.procedure ?? "");
  const [results, setResults] = useState(test?.results ?? "");
  const [conclusion, setConclusion] = useState(test?.conclusion ?? "");
  const [visibility, setVisibility] = useState<Visibility>(test?.visibility ?? "PUBLIC");
  const [restrictedAccessDraft, setRestrictedAccessDraft] = useState<RestrictedAccessDraft>(
    EMPTY_RESTRICTED_ACCESS_DRAFT,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // First page only (20 items) for this picker dropdown - same known
    // limitation as FailureEditor.tsx's own Component/Project pickers.
    getProjects().then((data) => setProjects(data.results));
  }, []);

  const isDirty =
    title !== (test?.title ?? "") ||
    testType !== (test?.test_type ?? "OTHER") ||
    projectId !== (test?.project?.id ?? null) ||
    location !== (test?.location ?? "") ||
    date !== (test?.date ?? null) ||
    status !== (test?.status ?? "PLANNED") ||
    passFail !== (test?.pass_fail ?? "") ||
    objective !== (test?.objective ?? "") ||
    configuration !== (test?.configuration ?? "") ||
    procedure !== (test?.procedure ?? "") ||
    results !== (test?.results ?? "") ||
    conclusion !== (test?.conclusion ?? "") ||
    visibility !== (test?.visibility ?? "PUBLIC") ||
    restrictedAccessDraft.pendingAdd.length > 0 ||
    restrictedAccessDraft.pendingRemoveGrantIds.length > 0;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  function buildPayload(): TestWritePayload {
    return {
      title,
      test_type: testType,
      project_id: projectId,
      location,
      date,
      status,
      pass_fail: passFail,
      objective,
      configuration,
      procedure,
      results,
      conclusion,
      visibility,
    };
  }

  async function syncRestrictedAccess(testId: string) {
    for (const grantId of restrictedAccessDraft.pendingRemoveGrantIds) {
      await removeAccessGrant(grantId);
    }
    for (const user of restrictedAccessDraft.pendingAdd) {
      await addAccessGrant("test", testId, user.id);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const saved = test ? await updateTest(test.id, buildPayload()) : await createTest(buildPayload());
      await syncRestrictedAccess(saved.id);
      router.push(`/tests/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-[800px] mx-auto">
      <div className="space-y-4 border-b border-outline-variant pb-4">
        <input
          className="w-full font-headline-lg text-headline-lg font-bold border-none bg-transparent placeholder:text-on-surface-variant/50 focus:ring-0 p-0 text-on-surface outline-none"
          placeholder={t("titlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Combobox
            label={t("testTypeLabel")}
            options={TEST_TYPE_VALUES.map((value) => ({ value, label: testTypeT(value) }))}
            value={testType}
            onChange={(value) => setTestType(value as TestType)}
          />
          <Combobox
            label={t("projectLabel")}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            value={projectId}
            onChange={setProjectId}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
            placeholder={t("locationPlaceholder")}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          {/* Native date input, not DatePicker - Test.date is a plain
              "YYYY-MM-DD" calendar date (Django DateField), same as
              Failure.date - see FailureEditor.tsx's matching comment. */}
          <div className="space-y-2">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
              {t("dateLabel")}
            </label>
            <input
              type="date"
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              value={date ?? ""}
              onChange={(e) => setDate(e.target.value || null)}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Combobox
            label={t("statusLabel")}
            options={STATUS_VALUES.map((value) => ({ value, label: statusT(value) }))}
            value={status}
            onChange={(value) => setStatus(value as TestRunStatus)}
          />
          <Combobox
            label={t("passFailLabel")}
            options={[
              { value: "", label: passFailT("notSet") },
              ...PASS_FAIL_VALUES.map((value) => ({ value, label: passFailT(value) })),
            ]}
            value={passFail}
            onChange={(value) => setPassFail((value || "") as TestPassFail)}
          />
        </div>
        <div className="w-48">
          <Combobox
            placeholder={t("visibilityLabel")}
            options={VISIBILITY_VALUES.map((value) => ({ value, label: t(`visibility${value}`) }))}
            value={visibility}
            onChange={(value) => setVisibility(value as Visibility)}
          />
        </div>
        {visibility === "RESTRICTED" && (
          <RestrictedAccessPicker
            initialGrants={test?.restricted_to ?? []}
            value={restrictedAccessDraft}
            onChange={setRestrictedAccessDraft}
          />
        )}
      </div>

      <div className="space-y-2">
        <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("objectiveLabel")}</h3>
        <MarkdownEditor
          value={objective}
          onChange={setObjective}
          placeholder={t("objectivePlaceholder")}
          relateFrom={test ? { type: "test", id: test.id } : undefined}
        />
      </div>
      <div className="space-y-2">
        <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("configurationLabel")}</h3>
        <MarkdownEditor
          value={configuration}
          onChange={setConfiguration}
          placeholder={t("configurationPlaceholder")}
          relateFrom={test ? { type: "test", id: test.id } : undefined}
        />
      </div>
      <div className="space-y-2">
        <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("procedureLabel")}</h3>
        <MarkdownEditor
          value={procedure}
          onChange={setProcedure}
          placeholder={t("procedurePlaceholder")}
          relateFrom={test ? { type: "test", id: test.id } : undefined}
        />
      </div>
      <div className="space-y-2">
        <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("resultsLabel")}</h3>
        <MarkdownEditor
          value={results}
          onChange={setResults}
          placeholder={t("resultsPlaceholder")}
          relateFrom={test ? { type: "test", id: test.id } : undefined}
        />
      </div>
      <div className="space-y-2">
        <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("conclusionLabel")}</h3>
        <MarkdownEditor
          value={conclusion}
          onChange={setConclusion}
          placeholder={t("conclusionPlaceholder")}
          relateFrom={test ? { type: "test", id: test.id } : undefined}
        />
      </div>

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isSaving || !title.trim()}>
          {isSaving ? commonT("saving") : commonT("save")}
        </Button>
      </div>
    </div>
  );
}
