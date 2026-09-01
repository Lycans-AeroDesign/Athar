import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bell,
  Bold,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Compass,
  Component,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  FlaskConical,
  Folder,
  Globe,
  Image,
  Info,
  Italic,
  LayoutDashboard,
  Link2,
  List,
  ListOrdered,
  Lock,
  Mail,
  Menu as MenuIcon,
  MessageSquare,
  Monitor,
  Moon,
  Pencil,
  Plus,
  Search,
  Send,
  Settings,
  Share2,
  Sparkles,
  Sun,
  Table,
  Tag,
  Trash2,
  Undo2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";

// Maps the icon names used across the app (kept as the same short identifiers
// the old Material Symbols font used, so call sites and data-driven icon
// props - e.g. SideNav's NAV_ITEMS, Menu's MenuEntry.icon - didn't need to
// change) to their lucide-react equivalents.
const ICONS: Record<string, LucideIcon> = {
  add: Plus,
  archive: Archive,
  unarchive: ArchiveRestore,
  architecture: Building2,
  arrow_back: ArrowLeft,
  auto_awesome: Sparkles,
  calendar_month: CalendarDays,
  check: Check,
  check_circle: CheckCircle2,
  chevron_right: ChevronRight,
  close: X,
  code: Code2,
  computer: Monitor,
  content_copy: Copy,
  dark_mode: Moon,
  dashboard: LayoutDashboard,
  delete: Trash2,
  description: FileText,
  download: Download,
  edit: Pencil,
  expand_more: ChevronDown,
  folder: Folder,
  format_bold: Bold,
  format_italic: Italic,
  format_list_bulleted: List,
  format_list_numbered: ListOrdered,
  forum: MessageSquare,
  hub: Share2,
  image: Image,
  info: Info,
  label: Tag,
  language: Globe,
  light_mode: Sun,
  link: Link2,
  lock: Lock,
  mail: Mail,
  menu: MenuIcon,
  menu_book: BookOpen,
  notifications: Bell,
  report_problem: AlertTriangle,
  schedule: Clock,
  science: FlaskConical,
  search: Search,
  send: Send,
  settings: Settings,
  settings_input_component: Component,
  share: Share2,
  table_chart: Table,
  travel_explore: Compass,
  undo: Undo2,
  upload: Upload,
  visibility: Eye,
  visibility_off: EyeOff,
};

interface IconProps {
  name: string;
  className?: string;
  /** Solid fill instead of outline - only reaches for this on simple glyphs
   * (e.g. BrandMark's "hub" logomark) where filling the shape solid still
   * reads cleanly. Detail-heavy icons (a book's page-fold, a gear's teeth)
   * lose that detail when filled, so nav "selected" state doesn't use this -
   * it gets its emphasis from the pill background + bold label instead (see
   * SideNav.tsx). */
  filled?: boolean;
  size?: number;
}

export function Icon({ name, className, filled, size }: IconProps) {
  const LucideIconComponent = ICONS[name];
  if (!LucideIconComponent) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`Icon: no lucide-react mapping for "${name}"`);
    }
    return null;
  }

  return (
    <LucideIconComponent
      className={className}
      size={size ?? 24}
      strokeWidth={2}
      fill={filled ? "currentColor" : "none"}
      aria-hidden="true"
    />
  );
}
