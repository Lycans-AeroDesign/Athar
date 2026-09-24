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
  /** Whether this user has finished (or skipped) the first-run interactive product tour - see lib/onboarding/tour.ts. Defaults to off (not yet seen). */
  has_completed_tour?: boolean;
  /** Whether this user has seen the MarkdownEditor's "Formatting tips" popover at least once - see components/ui/MarkdownEditor.tsx. Defaults to off (not yet seen), which auto-opens it once. */
  has_seen_markdown_help?: boolean;
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
  profile_picture: StoredFileRef | null;
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

export type BackupJobStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";

export interface BackupJob {
  id: string;
  status: BackupJobStatus;
  requested_by: string | null;
  error: string;
  created_at: string;
  completed_at: string | null;
  can_download: boolean;
}

export type RestoreJobStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";

export interface RestoreSummary {
  created: Record<string, number>;
  orphaned_user_refs: number;
  missing_files: number;
}

export interface RestoreJob {
  id: string;
  source_backup_id: string;
  status: RestoreJobStatus;
  requested_by: string | null;
  summary: RestoreSummary | Record<string, never>;
  error: string;
  created_at: string;
  completed_at: string | null;
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
  logo: StoredFileRef | null;
  favicon: StoredFileRef | null;
  /** Always-public URL (no auth needed) - use this to actually render the image. */
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  secondary_color: string;
  primary_color_dark: string;
  secondary_color_dark: string;
  /** Org-wide kill switch for the first-run interactive product tour - see UserPreferences.has_completed_tour for the per-user "already seen it" flag. */
  product_tour_enabled: boolean;
  /** Instance-wide (not per-org) - mirrors the backend's ENABLE_ORGANIZATION_REGISTRATION setting. Controls whether the register page's "create a new organization" tab is shown. */
  organization_registration_enabled: boolean;
  updated_at: string;
}

export interface KnowledgeAuthor {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  title: string;
  username: string | null;
  profile_picture: StoredFileRef | null;
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
  photo: StoredFileRef | null;
  manufacturer: string;
  part_number: string;
  /** External reference - a datasheet, vendor/purchase page, etc. */
  link: string;
  /** Workshop inventory count on hand. */
  quantity_available: number;
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

/** Query param for both GET /knowledge/leaderboard/ and the per-window
 * breakdown in UserProfile.periods below - "month"/"year" are calendar
 * to-date, "all" is lifetime (see backend knowledge/services.py's
 * period_since). */
export type ContributionPeriod = "month" | "year" | "all";

export interface ContributionPeriodStat {
  /** The same weighted score the leaderboard sorts by - see knowledge/scoring.py's CONTRIBUTION_POINTS table. */
  score: number;
  /** 1-indexed standing among total_members for this window, or null if this user has no scored activity in it yet. */
  rank: number | null;
}

export interface UserProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  title: string;
  username: string | null;
  profile_picture: StoredFileRef | null;
  date_joined: string;
  /** One count per ContributionType, plus accepted_answers (a subset of "answer", not a separate contribution type of its own). */
  stats: Record<ContributionType, number> & { accepted_answers: number };
  periods: Record<ContributionPeriod, ContributionPeriodStat>;
  /** Org member count - the denominator for periods[x].rank's "#N of total_members" display. */
  total_members: number;
}

// --- Training -----------------------------------------------------------
// See backend/training/models.py - Course mirrors Article's 5-state
// workflow exactly (REJECTED included), but has no `visibility` field:
// gating is status-based only (see training/views.py's _ensure_course_visible).

export type CourseStatus = "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "REJECTED" | "ARCHIVED";
export type CourseStatusFilter = CourseStatus | "ALL";
export type CourseDifficulty = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
export type LessonType = "TEXT" | "VIDEO" | "DOCUMENT" | "EXTERNAL" | "EXERCISE";
export type CourseResourceType = "EXTERNAL_LINK" | "STORED_FILE";
export type CourseResourceProvider = "GOOGLE_DRIVE" | "YOUTUBE" | "VIMEO" | "GITHUB" | "WEBSITE" | "OTHER" | "";

export interface CourseCategory {
  id: string;
  name: string;
  slug: string;
  description: string;
  course_count: number;
}

export interface CourseSummary {
  id: string;
  title: string;
  slug: string;
  short_description: string;
  cover_image: StoredFileRef | null;
  category: CourseCategory | null;
  difficulty: CourseDifficulty;
  estimated_minutes: number;
  status: CourseStatus;
  visibility: Visibility;
  author: KnowledgeAuthor | null;
  module_count: number;
  lesson_count: number;
  enrollment_count: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface LessonSummary {
  id: string;
  title: string;
  short_description: string;
  lesson_type: LessonType;
  order: number;
  estimated_minutes: number;
  is_required: boolean;
}

export interface CourseModule {
  id: string;
  title: string;
  description: string;
  order: number;
  estimated_minutes: number;
  lessons: LessonSummary[];
}

export interface CourseDetail extends CourseSummary {
  description: string;
  modules: CourseModule[];
  restricted_to: AccessGrant[];
}

export interface LearningObjective {
  id: string;
  text: string;
  order: number;
}

export interface CourseResource {
  id: string;
  title: string;
  description: string;
  resource_type: CourseResourceType;
  provider: CourseResourceProvider;
  url: string;
  stored_file: StoredFile | null;
  is_primary: boolean;
  order: number;
  created_by: KnowledgeAuthor | null;
  created_at: string;
}

/** A lesson's pointer to an existing Knowledge object (not a RelatableType-
 * shaped generic relation - see backend/training/models.py's
 * LessonKnowledgeReference docstring for why this is its own mechanism). */
export type KnowledgeReferenceType = RelatableType;

export interface LessonKnowledgeReferenceEntry {
  id: string;
  content_type_name: KnowledgeReferenceType;
  object_id: string;
  title: string | null;
  note: string;
  order: number;
  created_by: KnowledgeAuthor | null;
  created_at: string;
}

export interface LessonDetail {
  id: string;
  module_id: string;
  course_id: string;
  title: string;
  short_description: string;
  lesson_type: LessonType;
  content: string;
  order: number;
  estimated_minutes: number;
  is_required: boolean;
  objectives: LearningObjective[];
  resources: CourseResource[];
  knowledge_references: LessonKnowledgeReferenceEntry[];
  created_at: string;
  updated_at: string;
}

export type CourseEnrollmentStatus = "IN_PROGRESS" | "COMPLETED";

export interface CourseEnrollment {
  id: string;
  course: CourseSummary;
  status: CourseEnrollmentStatus;
  enrolled_at: string;
  completed_at: string | null;
}

export interface CourseProgress {
  enrolled: boolean;
  status: CourseEnrollmentStatus | null;
  percent: number;
  completed_lessons: number;
  total_lessons: number;
  completed_required_lessons: number;
  total_required_lessons: number;
  next_lesson_id: string | null;
  completed_lesson_ids: string[];
}

export interface CourseStats {
  total_enrolled: number;
  active: number;
  completed: number;
  completion_rate: number;
}

export interface TrainingStats {
  courses_by_status: Record<CourseStatus, number>;
  total_learners: number;
  active_learners: number;
  completed_learners: number;
  most_popular_courses: Array<{ id: string; title: string; enrolled: number }>;
}
