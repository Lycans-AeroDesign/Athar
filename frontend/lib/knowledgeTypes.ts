import type { RelatableType } from "@/lib/api/types";

// Article/Question routes live under /knowledge/; Project/Component/Failure/
// Sop are top-level (see SideNav's NAV_ITEMS) - so "prefix the plural type
// onto /knowledge/" doesn't hold for all six. Shared by RelatedContent.tsx
// (relation picker/chips) and MarkdownEditor.tsx (@-mention picker) so both
// stay in sync as new relatable types are added.
export const RELATABLE_ROUTE_PREFIX: Record<RelatableType, string> = {
  article: "/knowledge/articles",
  question: "/knowledge/questions",
  project: "/projects",
  component: "/components",
  failure: "/failures",
  sop: "/sops",
};

export const RELATABLE_ICON: Record<RelatableType, string> = {
  article: "menu_book",
  question: "forum",
  project: "architecture",
  component: "settings_input_component",
  failure: "report_problem",
  sop: "description",
};
