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
  test: "/tests",
  document: "/documents",
};

export const RELATABLE_ICON: Record<RelatableType, string> = {
  article: "menu_book",
  question: "forum",
  project: "architecture",
  component: "settings_input_component",
  failure: "report_problem",
  sop: "description",
  test: "science",
  document: "folder",
};

// Mirrors backend/knowledge/relationships.py's RELATIONSHIP_DEFINITIONS -
// same precedent as RELATABLE_ICON/RELATABLE_ROUTE_PREFIX above (a small,
// fixed table duplicated client-side rather than fetched).
export interface RelationshipDefinition {
  name: string;
  reverseName: string;
  sourceType: RelatableType;
  targetType: RelatableType;
}

export const RELATIONSHIP_DEFINITIONS: RelationshipDefinition[] = [
  { name: "USES", reverseName: "USED_IN", sourceType: "project", targetType: "component" },
  { name: "HAS_FAILURE", reverseName: "OCCURRED_IN", sourceType: "project", targetType: "failure" },
  { name: "HAS_TEST", reverseName: "PART_OF", sourceType: "project", targetType: "test" },
  { name: "DOCUMENTED_BY", reverseName: "RELEVANT_TO", sourceType: "project", targetType: "article" },
  { name: "HAS_QUESTION", reverseName: "RELATED_TO", sourceType: "project", targetType: "question" },
  { name: "USES", reverseName: "USED_IN", sourceType: "project", targetType: "sop" },
  { name: "DOCUMENTED_BY", reverseName: "RELEVANT_TO", sourceType: "project", targetType: "document" },
  { name: "INVOLVED_IN", reverseName: "INVOLVES", sourceType: "component", targetType: "failure" },
  { name: "TESTED_IN", reverseName: "TESTS", sourceType: "component", targetType: "test" },
  { name: "DOCUMENTED_BY", reverseName: "DOCUMENTS", sourceType: "component", targetType: "article" },
  { name: "APPLIES_TO", reverseName: "HAS_SOP", sourceType: "sop", targetType: "component" },
  { name: "HAS_QUESTION", reverseName: "RELATED_TO", sourceType: "component", targetType: "question" },
  { name: "HAS_RESOURCE", reverseName: "RESOURCE_FOR", sourceType: "component", targetType: "document" },
  { name: "DISCOVERED_FAILURE", reverseName: "DISCOVERED_DURING", sourceType: "test", targetType: "failure" },
  { name: "DOCUMENTED_BY", reverseName: "DOCUMENTS", sourceType: "test", targetType: "article" },
  { name: "FOLLOWED_BY", reverseName: "FOLLOWS", sourceType: "sop", targetType: "test" },
  { name: "EXPLAINED_BY", reverseName: "EXPLAINS", sourceType: "failure", targetType: "article" },
  { name: "RESOLVES", reverseName: "RESOLVED_BY", sourceType: "sop", targetType: "failure" },
  { name: "RAISED_QUESTION", reverseName: "RAISED_BY", sourceType: "failure", targetType: "question" },
];

/** Every (verb, isReversed) choice valid between two types, from either
 * side - e.g. for (component, project) this includes USED_IN (component is
 * the reverse side of project--USES-->component). `isReversed` is just for
 * the caller's own bookkeeping (the API call itself doesn't need it - the
 * backend re-derives the same normalization from `verb` + the two types). */
export function relationshipChoicesFor(
  sourceType: RelatableType,
  targetType: RelatableType,
): { verb: string; isReversed: boolean }[] {
  const choices: { verb: string; isReversed: boolean }[] = [];
  for (const definition of RELATIONSHIP_DEFINITIONS) {
    if (definition.sourceType === sourceType && definition.targetType === targetType) {
      choices.push({ verb: definition.name, isReversed: false });
    } else if (definition.sourceType === targetType && definition.targetType === sourceType) {
      choices.push({ verb: definition.reverseName, isReversed: true });
    }
  }
  return choices;
}
