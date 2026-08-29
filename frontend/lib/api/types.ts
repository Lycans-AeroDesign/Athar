export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
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

export interface ArticleSummary {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  status: ArticleStatus;
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

export interface Answer {
  id: string;
  question_id: string;
  body: string;
  author: KnowledgeAuthor | null;
  is_accepted: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuestionSummary {
  id: string;
  title: string;
  tags: Tag[];
  author: KnowledgeAuthor | null;
  answer_count: number;
  has_accepted_answer: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuestionDetail extends QuestionSummary {
  body: string;
  answers: Answer[];
}
