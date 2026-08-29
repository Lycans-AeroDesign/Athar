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
  default_language: string;
  logo: StoredFileRef | null;
  favicon: StoredFileRef | null;
  /** Always-public URL (no auth needed) - use this to actually render the image. */
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  secondary_color: string;
  updated_at: string;
}
