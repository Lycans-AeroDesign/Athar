import { useId } from "react";
import {
  AlertTriangle,
  Archive,
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

// Settings' lucide glyph is one solid gear-teeth path plus a separate
// decorative <circle> drawn on top for the center hole - in the outline
// (unfilled) version neither shape is filled, so the circle's stroke alone
// reads as a hole. Filling the path solid (for the "selected" state) fills
// that entire silhouette, hole included; setting just the circle's own fill
// to "none" only stops it from double-painting that area - the solid path
// underneath is still there. Actually punching a hole needs an SVG mask.
function FilledSettingsIcon({ size, className }: { size: number; className?: string }) {
  const maskId = useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <mask id={maskId}>
        <rect width="24" height="24" fill="white" />
        <circle cx="12" cy="12" r="3" fill="black" />
      </mask>
      <path
        d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

interface IconProps {
  name: string;
  className?: string;
  filled?: boolean;
  size?: number;
}

export function Icon({ name, className, filled, size }: IconProps) {
  if (name === "settings" && filled) {
    return <FilledSettingsIcon size={size ?? 24} className={className} />;
  }

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
      strokeWidth={filled ? 2.5 : 2}
      fill={filled ? "currentColor" : "none"}
      aria-hidden="true"
    />
  );
}
