import type { FailureSeverity, FailureStatus, ProjectStatus, TestPassFail, TestRunStatus } from "@/lib/api/types";

export const FAILURE_SEVERITY_CLASSES: Record<FailureSeverity, string> = {
  LOW: "bg-surface-variant text-on-surface-variant",
  MEDIUM: "bg-callout-warning/15 text-callout-warning ring-1 ring-inset ring-callout-warning/40",
  HIGH: "bg-error-container text-on-error-container",
};

export const FAILURE_STATUS_CLASSES: Record<FailureStatus, string> = {
  UNDER_INVESTIGATION: "border border-outline-variant text-on-surface-variant",
  RESOLVED: "bg-secondary-container text-on-secondary-container",
};

export const TEST_STATUS_CLASSES: Record<TestRunStatus, string> = {
  PLANNED: "border border-outline-variant text-on-surface-variant",
  IN_PROGRESS: "bg-callout-warning/15 text-callout-warning ring-1 ring-inset ring-callout-warning/40",
  COMPLETED: "bg-secondary-container text-on-secondary-container",
};

export const TEST_PASS_FAIL_CLASSES: Record<Exclude<TestPassFail, "">, string> = {
  PASS: "bg-secondary-container text-on-secondary-container",
  FAIL: "bg-error-container text-on-error-container",
  PARTIAL: "bg-callout-warning/15 text-callout-warning ring-1 ring-inset ring-callout-warning/40",
  NOT_APPLICABLE: "border border-outline-variant text-on-surface-variant",
};

export const PROJECT_STATUS_CLASSES: Record<ProjectStatus, string> = {
  ACTIVE: "bg-primary-container text-on-primary-container",
  ON_HOLD: "bg-callout-warning/15 text-callout-warning ring-1 ring-inset ring-callout-warning/40",
  COMPLETED: "bg-surface-variant text-on-surface-variant",
};
