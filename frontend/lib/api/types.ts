/** Standard DRF pagination envelope (see backend/config/pagination.py) - every list endpoint returns this shape now. */
export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  /** Free-text role in the team (e.g. "Lead Systems Integration") - distinct from `roles`, which drives permissions. */
  title: string;
  roles: string[];
  permissions: string[];
  date_joined: string;
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

/** PUBLIC/ORGANIZATION currently enforce identically (see backend/knowledge/models.py's Visibility) - RESTRICTED is the one that changes access today. */
export type Visibility = "PUBLIC" | "ORGANIZATION" | "RESTRICTED";

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
}

export type RelatableType = "article" | "question" | "project" | "component" | "failure" | "sop";

export type SearchResult = { type: RelatableType; id: string; title: string; excerpt: string };

export interface KnowledgeRelation {
  id: string;
  relation_type: string;
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
// No draft/review workflow and no `visibility` field on any of these (see
// backend/knowledge/models.py's module docstring) - simpler shape than
// Article/Question throughout.

export type ProjectStatus = "ACTIVE" | "ON_HOLD" | "COMPLETED";

export interface ProjectSummary {
  id: string;
  name: string;
  status: ProjectStatus;
  tags: Tag[];
  created_by: KnowledgeAuthor | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail extends ProjectSummary {
  description: string;
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
  tags: Tag[];
  created_by: KnowledgeAuthor | null;
  created_at: string;
  updated_at: string;
}

export interface ComponentDetail extends ComponentSummary {
  summary: string;
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
  created_by: KnowledgeAuthor | null;
  created_at: string;
  updated_at: string;
}

export interface FailureDetail extends FailureSummary {
  summary: string;
  root_cause: string;
  corrective_action: string;
  preventive_action: string;
}

export interface SopSummary {
  id: string;
  title: string;
  category: Category | null;
  mandatory: boolean;
  tags: Tag[];
  created_by: KnowledgeAuthor | null;
  created_at: string;
  updated_at: string;
}

export interface SopDetail extends SopSummary {
  safety_notes: string;
  content: string;
}
