/** Standard DRF pagination envelope (see backend/config/pagination.py) - every list endpoint returns this shape now. */
export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Personal UI settings, self-service via PATCH /auth/me/ (see backend/accounts/models.py's User.preferences) - add keys as features need them. */
export interface UserPreferences {
  /** Show the per-page search filter (with its active-filter chip) on the Projects/Components/Failures/SOPs list pages. Defaults to on. */
  engineering_list_filters?: boolean;
}

export interface User {
  id: string;
  email: string;
  /** Optional, unique when set - not required for login (still email-based). null until a user opts in via /account. */
  username: string | null;
  first_name: string;
  last_name: string;
  /** Free-text role in the team (e.g. "Lead Systems Integration") - distinct from `roles`, which drives permissions. */
  title: string;
  roles: string[];
  permissions: string[];
  preferences: UserPreferences;
  date_joined: string;
  /** Read-only here - toggled only via rbac.setUserActive (requires user.manage), never self-service. */
  is_active: boolean;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  is_system: boolean;
  permissions: Permission[];
  created_at: string;
  updated_at: string;
}

export interface Permission {
  id: string;
  codename: string;
  description: string;
  created_at: string;
}

export interface InvitationCode {
  id: string;
  code: string;
  created_by: string | null;
  max_uses: number;
  uses_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  is_valid: boolean;
}

export interface AuditLogEntry {
  id: string;
  actor: string | null;
  actor_email: string | null;
  action: string;
  target_repr: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

export interface StoredFile {
  id: string;
  original_filename: string;
  content_type: string;
  size: number;
  uploaded_by: string | null;
  required_permission: string;
  download_url: string;
  created_at: string;
}

export interface LoginResponse {
  access: string;
  user: User;
}

export interface StoredFileRef {
  id: string;
  original_filename: string;
  download_url: string;
}

export interface OrganizationSettings {
  id: string;
  name: string;
  primary_domain: string;
  logo: StoredFileRef | null;
  favicon: StoredFileRef | null;
  /** Always-public URL (no auth needed) - use this to actually render the image. */
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  secondary_color: string;
  primary_color_dark: string;
  secondary_color_dark: string;
  updated_at: string;
}

export interface KnowledgeAuthor {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  title: string;
  username: string | null;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  article_count: number;
}

export interface Tag {
  id: string;
  name: string;
}

export type ArticleStatus = "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "REJECTED" | "ARCHIVED";

/** getArticles()'s ?status= param accepts this in addition to a real ArticleStatus -
 * "ALL" isn't a status an article can actually have (see ArticleStatus above), it just
 * tells the list endpoint to skip the status filter (see ArticleListCreateView.get). */
export type ArticleStatusFilter = ArticleStatus | "ALL";

/** PUBLIC = organization-wide (the default); RESTRICTED = only the owner/creator, an org admin, an
 * override-permission holder, or an explicitly granted user - see backend/knowledge/visibility.py. */
export type Visibility = "PUBLIC" | "RESTRICTED";

/** One user granted access to a RESTRICTED item, on top of its owner/creator - see AccessGrantSerializer. */
export interface AccessGrant {
  grant_id: string;
  user: KnowledgeAuthor;
}

export interface ArticleSummary {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  status: ArticleStatus;
  visibility: Visibility;
  category: Category | null;
  tags: Tag[];
  author: KnowledgeAuthor | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface ArticleDetail extends ArticleSummary {
  content: string;
  /** Distinct authors of every create/update to this article - see AuthorSerializer/ContributorsMixin. */
  contributors: KnowledgeAuthor[];
  /** Who's been explicitly granted access, on top of the author - meaningful only when visibility is RESTRICTED. */
  restricted_to: AccessGrant[];
  /** This viewer's own Bookmark id if they've bookmarked this article, else null. */
  bookmark_id: string | null;
}

export interface ArticleRevision {
  id: string;
  title: string;
  content: string;
  edited_by: KnowledgeAuthor | null;
  created_at: string;
}

export interface Answer {
  id: string;
  question_id: string;
  body: string;
  author: KnowledgeAuthor | null;
  is_accepted: boolean;
  created_at: string;
  updated_at: string;
}

export type QuestionStatus = "OPEN" | "ANSWERED" | "SOLVED" | "CLOSED";

export interface QuestionSummary {
  id: string;
  title: string;
  status: QuestionStatus;
  visibility: Visibility;
  tags: Tag[];
  author: KnowledgeAuthor | null;
  answer_count: number;
  has_accepted_answer: boolean;
  promoted_to_article: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuestionDetail extends QuestionSummary {
  body: string;
  answers: Answer[];
  contributors: KnowledgeAuthor[];
  restricted_to: AccessGrant[];
  bookmark_id: string | null;
}

export type RelatableType =
  | "article"
  | "question"
  | "project"
  | "component"
  | "failure"
  | "sop"
  | "test"
  | "document";

export type SearchResult = { type: RelatableType; id: string; title: string; excerpt: string };

export interface KnowledgeRelation {
  id: string;
  relation_type: string;
  /** Direction-aware display verb (e.g. "USES" from the source's side, "USED_IN" from
   * the target's - see backend/knowledge/relationships.py) - use this, not relation_type,
   * for anything shown to the user. Falls back to "RELATED" (symmetric) when no more
   * specific relationship applies. */
  relation_label: string;
  other_type: RelatableType;
  other_id: string;
  other_title: string | null;
  created_at: string;
}

/** Shape shared by every X AttachmentSerializer (Article/Question/Project/Component/Failure/Sop) - identical fields. */
export interface KnowledgeAttachment {
  id: string;
  file: StoredFile;
  uploaded_by: KnowledgeAuthor | null;
  created_at: string;
}

// --- Engineering domain -----------------------------------------------------
// No draft/review workflow on any of these (see backend/knowledge/models.py's
// module docstring), but each does carry `visibility` (same RESTRICTED rule
// as Article/Question/Document - see backend/knowledge/visibility.py).

export type ProjectStatus = "ACTIVE" | "ON_HOLD" | "COMPLETED";

export interface ProjectSummary {
  id: string;
  name: string;
  status: ProjectStatus;
  visibility: Visibility;
  tags: Tag[];
  created_by: KnowledgeAuthor | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail extends ProjectSummary {
  description: string;
  contributors: KnowledgeAuthor[];
  restricted_to: AccessGrant[];
  bookmark_id: string | null;
}

export type ComponentStatus = "CERTIFIED" | "TESTING" | "DEPRECATED";

export interface ComponentSpecRow {
  label: string;
  value: string;
}

export interface ComponentSummary {
  id: string;
  name: string;
  category: Category | null;
  manufacturer: string;
  part_number: string;
  status: ComponentStatus;
  specifications: ComponentSpecRow[];
  visibility: Visibility;
  tags: Tag[];
  created_by: KnowledgeAuthor | null;
  created_at: string;
  updated_at: string;
}

export interface ComponentDetail extends ComponentSummary {
  summary: string;
  contributors: KnowledgeAuthor[];
  restricted_to: AccessGrant[];
  bookmark_id: string | null;
}

export type FailureSeverity = "LOW" | "MEDIUM" | "HIGH";
export type FailureStatus = "UNDER_INVESTIGATION" | "RESOLVED";

export interface FailureSummary {
  id: string;
  title: string;
  component: ComponentSummary | null;
  project: ProjectSummary | null;
  aircraft: string;
  date: string | null;
  severity: FailureSeverity;
  status: FailureStatus;
  visibility: Visibility;
  created_by: KnowledgeAuthor | null;
  created_at: string;
  updated_at: string;
}

export interface FailureDetail extends FailureSummary {
  summary: string;
  root_cause: string;
  corrective_action: string;
  preventive_action: string;
  contributors: KnowledgeAuthor[];
  restricted_to: AccessGrant[];
  bookmark_id: string | null;
}

export interface SopSummary {
  id: string;
  title: string;
  category: Category | null;
  mandatory: boolean;
  visibility: Visibility;
  tags: Tag[];
  created_by: KnowledgeAuthor | null;
  created_at: string;
  updated_at: string;
}

export interface SopDetail extends SopSummary {
  safety_notes: string;
  content: string;
  contributors: KnowledgeAuthor[];
  restricted_to: AccessGrant[];
  bookmark_id: string | null;
}

export type TestType =
  | "FLIGHT"
  | "THRUST"
  | "STRUCTURAL"
  | "ELECTRICAL"
  | "GROUND"
  | "SOFTWARE"
  | "CALIBRATION"
  | "EXPERIMENT"
  | "OTHER";
export type TestRunStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED";
export type TestPassFail = "PASS" | "FAIL" | "PARTIAL" | "NOT_APPLICABLE" | "";

export interface TestSummary {
  id: string;
  title: string;
  test_type: TestType;
  date: string | null;
  location: string;
  project: ProjectSummary | null;
  status: TestRunStatus;
  pass_fail: TestPassFail;
  visibility: Visibility;
  tags: Tag[];
  created_by: KnowledgeAuthor | null;
  created_at: string;
  updated_at: string;
}

export interface TestDetail extends TestSummary {
  objective: string;
  configuration: string;
  procedure: string;
  results: string;
  conclusion: string;
  contributors: KnowledgeAuthor[];
  restricted_to: AccessGrant[];
  bookmark_id: string | null;
}

export type DocType =
  | "COMPETITION_REPORT"
  | "TECHNICAL_REPORT"
  | "RESEARCH_PAPER"
  | "DATASHEET"
  | "MANUAL"
  | "REGULATION"
  | "PRESENTATION"
  | "TRAINING_MATERIAL"
  | "REFERENCE"
  | "OTHER";
export type DocumentSource = "INTERNAL" | "EXTERNAL";

export interface DocumentSummary {
  id: string;
  title: string;
  doc_type: DocType;
  source: DocumentSource;
  author: string;
  organization: string;
  publication_date: string | null;
  url: string;
  file: StoredFile | null;
  category: Category | null;
  tags: Tag[];
  visibility: Visibility;
  created_by: KnowledgeAuthor | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentDetail extends DocumentSummary {
  description: string;
  contributors: KnowledgeAuthor[];
  restricted_to: AccessGrant[];
  bookmark_id: string | null;
}

/** One row of GET /knowledge/bookmarks/ - deliberately thin (no full Summary
 * shape per type) since a bookmarks list only ever needs to link out. */
export interface BookmarkEntry {
  id: string;
  type: RelatableType;
  object_id: string;
  title: string | null;
  created_at: string;
}

// --- User profile -----------------------------------------------------------

export type ContributionType =
  | "article"
  | "question"
  | "answer"
  | "project"
  | "component"
  | "failure"
  | "sop"
  | "test"
  | "document";

/** One row of GET /knowledge/leaderboard/ - see knowledge/scoring.py's CONTRIBUTION_POINTS table. */
export interface LeaderboardEntry {
  user: KnowledgeAuthor;
  score: number;
}

export interface UserProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  title: string;
  username: string | null;
  date_joined: string;
  /** One count per ContributionType, plus accepted_answers (a subset of "answer", not a separate contribution type of its own). */
  stats: Record<ContributionType, number> & { accepted_answers: number };
  /** The same weighted score the leaderboard sorts by - see knowledge/scoring.py's CONTRIBUTION_POINTS table. */
  score: number;
}
