import type {
  ArticleStatus,
  ComponentCondition,
  ComponentStatus,
  CourseDifficulty,
  CourseResourceProvider,
  CourseStatus,
  DocType,
  DocumentSource,
  FailureSeverity,
  FailureStatus,
  InventoryType,
  LessonType,
  ProjectStatus,
  StockStatus,
  TestPassFail,
  TestRunStatus,
  TestType,
  Visibility,
} from "@/lib/api/types";

// One icon per fixed enum value, shared by every dropdown (editors and list
// filters alike) so the same value always shows the same glyph. Spread into
// a ComboboxOption: `{ value, label, ...VISIBILITY_ICONS[value] }`. Names are
// components/ui/Icon.tsx's keys, not lucide component names.
export interface OptionIcon {
  icon: string;
  iconClassName?: string;
}

const ERROR = "text-error";

export const VISIBILITY_ICONS: Record<Visibility, OptionIcon> = {
  PUBLIC: { icon: "public" },
  RESTRICTED: { icon: "lock" },
};

// Article and course share the same draft/review/publish workflow.
export const PUBLISH_STATUS_ICONS: Record<ArticleStatus & CourseStatus, OptionIcon> = {
  DRAFT: { icon: "edit_note" },
  IN_REVIEW: { icon: "rate_review" },
  PUBLISHED: { icon: "check_circle" },
  REJECTED: { icon: "cancel", iconClassName: ERROR },
  ARCHIVED: { icon: "archive" },
};

export const PROJECT_STATUS_ICONS: Record<ProjectStatus, OptionIcon> = {
  ACTIVE: { icon: "play_circle" },
  ON_HOLD: { icon: "pause_circle" },
  COMPLETED: { icon: "check_circle" },
};

export const COMPONENT_STATUS_ICONS: Record<ComponentStatus, OptionIcon> = {
  CERTIFIED: { icon: "verified" },
  TESTING: { icon: "science" },
  DEPRECATED: { icon: "block" },
};

export const INVENTORY_TYPE_ICONS: Record<InventoryType, OptionIcon> = {
  MECHANICAL: { icon: "handyman" },
  ELECTRICAL: { icon: "bolt" },
};

export const CONDITION_ICONS: Record<ComponentCondition, OptionIcon> = {
  NEW: { icon: "auto_awesome" },
  GOOD: { icon: "check_circle" },
  FAIR: { icon: "timelapse" },
  WORN: { icon: "hourglass" },
  NEEDS_REPAIR: { icon: "build" },
  BROKEN: { icon: "cancel", iconClassName: ERROR },
};

export const STOCK_STATUS_ICONS: Record<StockStatus, OptionIcon> = {
  IN_STOCK: { icon: "check_circle" },
  LOW_STOCK: { icon: "trending_down" },
  MISSING: { icon: "shopping_cart", iconClassName: ERROR },
  ON_ORDER: { icon: "local_shipping" },
  RETIRED: { icon: "archive" },
};

export const FAILURE_SEVERITY_ICONS: Record<FailureSeverity, OptionIcon> = {
  LOW: { icon: "info" },
  MEDIUM: { icon: "report_problem" },
  HIGH: { icon: "report", iconClassName: ERROR },
};

export const FAILURE_STATUS_ICONS: Record<FailureStatus, OptionIcon> = {
  UNDER_INVESTIGATION: { icon: "manage_search" },
  RESOLVED: { icon: "check_circle" },
};

export const TEST_TYPE_ICONS: Record<TestType, OptionIcon> = {
  FLIGHT: { icon: "flight" },
  THRUST: { icon: "rocket_launch" },
  STRUCTURAL: { icon: "construction" },
  ELECTRICAL: { icon: "bolt" },
  GROUND: { icon: "landscape" },
  SOFTWARE: { icon: "code" },
  CALIBRATION: { icon: "speed" },
  EXPERIMENT: { icon: "science" },
  OTHER: { icon: "more_horiz" },
};

export const TEST_STATUS_ICONS: Record<TestRunStatus, OptionIcon> = {
  PLANNED: { icon: "event_upcoming" },
  IN_PROGRESS: { icon: "pending" },
  COMPLETED: { icon: "check_circle" },
};

// "" is the "not set" option - listed (as no icon) so the map stays exhaustive.
export const TEST_PASS_FAIL_ICONS: Record<TestPassFail, OptionIcon | undefined> = {
  "": undefined,
  PASS: { icon: "check_circle" },
  FAIL: { icon: "cancel", iconClassName: ERROR },
  PARTIAL: { icon: "timelapse" },
  NOT_APPLICABLE: { icon: "do_not_disturb" },
};

export const DOC_TYPE_ICONS: Record<DocType, OptionIcon> = {
  COMPETITION_REPORT: { icon: "emoji_events" },
  TECHNICAL_REPORT: { icon: "description" },
  RESEARCH_PAPER: { icon: "article" },
  DATASHEET: { icon: "datasheet" },
  MANUAL: { icon: "menu_book" },
  REGULATION: { icon: "gavel" },
  PRESENTATION: { icon: "slideshow" },
  TRAINING_MATERIAL: { icon: "school" },
  REFERENCE: { icon: "local_library" },
  OTHER: { icon: "draft" },
};

export const DOC_SOURCE_ICONS: Record<DocumentSource, OptionIcon> = {
  INTERNAL: { icon: "domain" },
  EXTERNAL: { icon: "open_in_new" },
};

export const DIFFICULTY_ICONS: Record<CourseDifficulty, OptionIcon> = {
  BEGINNER: { icon: "signal_low" },
  INTERMEDIATE: { icon: "signal_medium" },
  ADVANCED: { icon: "signal_high" },
};

// Also used for components/training/CurriculumList.tsx's lesson rows.
export const LESSON_TYPE_ICONS: Record<LessonType, OptionIcon> = {
  TEXT: { icon: "menu_book" },
  VIDEO: { icon: "play_circle" },
  DOCUMENT: { icon: "description" },
  EXTERNAL: { icon: "link" },
  EXERCISE: { icon: "science" },
};

// lucide dropped brand logos, so these are generic stand-ins.
export const RESOURCE_PROVIDER_ICONS: Record<CourseResourceProvider, OptionIcon | undefined> = {
  "": undefined,
  GOOGLE_DRIVE: { icon: "hard_drive" },
  YOUTUBE: { icon: "smart_display" },
  VIMEO: { icon: "videocam" },
  GITHUB: { icon: "fork_right" },
  WEBSITE: { icon: "public" },
  OTHER: { icon: "link" },
};
