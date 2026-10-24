"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Modal } from "@/components/ui/Modal";
import { importCurriculum, type ImportCurriculumModule } from "@/lib/api/training";
import type { CourseDetail } from "@/lib/api/types";
import { errorMessage } from "@/lib/errors";
import { LESSON_TYPE_ICONS } from "@/lib/optionIcons";
import { parseCurriculumText } from "@/lib/training/curriculumParser";

interface ImportCurriculumModalProps {
  courseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (course: CourseDetail) => void;
}

export function ImportCurriculumModal({
  courseId,
  open,
  onOpenChange,
  onSuccess,
}: ImportCurriculumModalProps) {
  const t = useTranslations("training.manage");
  const commonT = useTranslations("common");
  const textareaId = useId();

  const [rawText, setRawText] = useState("");
  const [parsedModules, setParsedModules] = useState<ImportCurriculumModule[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync parsing whenever rawText changes
  function handleTextChange(val: string) {
    setRawText(val);
    const result = parseCurriculumText(val);
    setParsedModules(result.modules);
  }

  const totalLessons = useMemo(
    () => parsedModules.reduce((acc, m) => acc + m.lessons.length, 0),
    [parsedModules],
  );

  async function handleImport() {
    if (parsedModules.length === 0) return;
    setIsImporting(true);
    setError(null);
    try {
      const updated = await importCurriculum(courseId, parsedModules);
      onSuccess(updated);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsImporting(false);
    }
  }

  function handleDeleteModule(idx: number) {
    setParsedModules((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleDeleteLesson(moduleIdx: number, lessonIdx: number) {
    setParsedModules((prev) =>
      prev.map((mod, i) =>
        i === moduleIdx
          ? { ...mod, lessons: mod.lessons.filter((_, li) => li !== lessonIdx) }
          : mod,
      ),
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("importCurriculumTitle")}
      description={t("importCurriculumDescription")}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isImporting}>
            {commonT("cancel")}
          </Button>
          <Button
            onClick={handleImport}
            disabled={parsedModules.length === 0 || isImporting}
            loading={isImporting}
          >
            {isImporting ? commonT("saving") : t("importCurriculumConfirm", { count: totalLessons })}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={textareaId} className="font-label-caps text-label-caps uppercase text-on-surface-variant">
            {t("pasteOutlineLabel")}
          </label>
        </div>

        <textarea
          id={textareaId}
          rows={7}
          className="w-full p-3 font-mono text-body-sm rounded-lg bg-surface border border-outline-variant text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          placeholder={t("pasteOutlinePlaceholder")}
          value={rawText}
          onChange={(e) => handleTextChange(e.target.value)}
        />

        {error && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {error}
          </p>
        )}

        {parsedModules.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-outline-variant">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-label-caps text-label-caps uppercase text-on-surface">
                {t("parsedPreviewTitle")} ({parsedModules.length} Modules, {totalLessons} Lessons)
              </h4>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-3 pe-1">
              {parsedModules.map((module, mIdx) => (
                <div
                  key={mIdx}
                  className="rounded-lg border border-outline-variant bg-surface-container-low p-3 space-y-2 text-start"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-headline-sm text-headline-sm font-bold text-on-surface">
                      {module.title}
                    </span>
                    <IconButton
                      icon="delete"
                      size={16}
                      variant="danger"
                      aria-label="Delete module"
                      onClick={() => handleDeleteModule(mIdx)}
                    />
                  </div>
                  {module.description && (
                    <p className="font-body-sm text-body-sm text-on-surface-variant italic">
                      {module.description}
                    </p>
                  )}

                  <ul className="space-y-1 ps-2 border-s-2 border-outline-variant/60">
                    {module.lessons.map((lesson, lIdx) => (
                      <li
                        key={lIdx}
                        className="flex items-center justify-between gap-2 text-body-sm py-0.5"
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <Icon
                            name={LESSON_TYPE_ICONS[lesson.lesson_type ?? "TEXT"].icon}
                            size={14}
                            className="text-primary shrink-0"
                          />
                          <span className="text-on-surface truncate">{lesson.title}</span>
                          <span className="text-[10px] uppercase font-mono px-1 rounded bg-surface-variant text-on-surface-variant shrink-0">
                            {lesson.lesson_type}
                          </span>
                        </span>
                        <IconButton
                          icon="delete"
                          size={14}
                          variant="ghost"
                          aria-label="Delete lesson"
                          onClick={() => handleDeleteLesson(mIdx, lIdx)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
