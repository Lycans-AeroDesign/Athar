/**
 * All landing-page copy, links and screenshot metadata live here so the
 * page can be updated without touching component code.
 *
 * Rules for editing (see README.md):
 *  - Only list a feature under `features` once it is merged on `main`.
 *    Anything not shipped yet goes under `roadmap`.
 *  - Every external link must point to a destination you have opened.
 *  - Screenshots must come from a demo instance with fictional data.
 */

const REPO = "https://github.com/Lycans-AeroDesign/Athar";

export const site = {
  name: "Athar",
  nameAr: "أثر",
  tagline: "Knowledge that doesn't graduate.",
  title: "Athar — Knowledge that doesn't graduate",
  description:
    "Athar (أثر) is an open-source, self-hosted knowledge management system for engineering and student teams. Connect articles, Q&A, projects, components, failures, SOPs, tests and training in one searchable knowledge base you host yourself.",
  keywords: [
    "open-source knowledge management system",
    "knowledge management for engineering teams",
    "knowledge management for student teams",
    "self-hosted knowledge base",
    "engineering documentation",
    "technical team knowledge management",
    "AeroDesign",
    "Formula Student",
    "robotics team wiki",
  ],
  /** Set NEXT_PUBLIC_SITE_URL in production; see README "Production domain". */
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  license: { name: "Apache License 2.0", short: "Apache-2.0", href: `${REPO}/blob/main/LICENSE` },
};

export const links = {
  repo: REPO,
  quickstart: `${REPO}#quickstart-docker`,
  deployment: `${REPO}/blob/main/DEPLOYMENT.md`,
  contributing: `${REPO}/blob/main/CONTRIBUTING.md`,
  vision: `${REPO}/blob/main/docs/VISION.md`,
  issues: `${REPO}/issues`,
  license: site.license.href,
  lycansGithub: "https://github.com/Lycans-AeroDesign",
  lycansSite: "https://www.lycansteam.com",
};

export const nav = [
  { label: "Product", href: "#product" },
  { label: "Features", href: "#features" },
  { label: "About", href: "#about" },
  { label: "Documentation", href: links.quickstart, external: true },
];

export const hero = {
  eyebrow: "Open-source knowledge management for engineering teams",
  headlineLead: "Knowledge that",
  headlineAccent: "doesn't graduate.",
  body: "Engineering teams build years of experience through projects, experiments, failures, and countless decisions. Athar helps preserve that knowledge so the next generation can build on it instead of starting over.",
  primaryCta: { label: "Explore on GitHub", href: links.repo },
  secondaryCta: { label: "Self-host Athar", href: "#self-host" },
  specs: ["Apache-2.0", "Self-hosted", "English · العربية"],
};

/** The knowledge-loss problem, written as an incident log. */
export const problem = {
  eyebrow: "The problem",
  heading: "Every season, a team loses part of what it knows.",
  body: "Student and technical teams turn over constantly. The work survives in CAD files and spreadsheets, but the reasoning behind it walks out the door with the people who did it.",
  incidents: [
    {
      code: "LOSS-01",
      title: "Experienced members graduate",
      detail: "The people who know why the wing spar is that thickness are gone by next season.",
    },
    {
      code: "LOSS-02",
      title: "Decisions lose their context",
      detail: "A choice survives as a part number, without the alternatives and trade-offs behind it.",
    },
    {
      code: "LOSS-03",
      title: "Failures happen twice",
      detail: "Without a record of root cause and corrective action, the same mistake comes back on the test stand.",
    },
    {
      code: "LOSS-04",
      title: "Documentation scatters",
      detail: "Notes end up in chat threads, personal drives and slide decks no one can find.",
    },
    {
      code: "LOSS-05",
      title: "New members start from zero",
      detail: "Each intake spends its first months rediscovering what the team already learned.",
    },
  ],
};

export const solution = {
  eyebrow: "The approach",
  heading: "Not another folder of documents. A connected record of the work.",
  body: [
    "Athar stores engineering knowledge as structured records — projects, components, failures, procedures, tests, articles and questions — and lets you link any of them to any other.",
    "Open the write-up of a failure and the failure record, the parts involved, the test where it showed up, the procedure that changed because of it and the project it belongs to are all one click away. The context travels with the knowledge.",
  ],
  figureCaption:
    "Records linked to one article in the Athar demo data, as listed in its Related Content panel. Each line is an explicit link a member created.",
};

export type FeatureGroup = {
  id: string;
  label: string;
  summary: string;
  items: { title: string; body: string; icon: IconName }[];
};

export type IconName =
  | "article" | "question" | "search" | "link" | "project" | "component"
  | "failure" | "sop" | "test" | "document" | "training" | "shield"
  | "language" | "backup";

export const features: FeatureGroup[] = [
  {
    id: "knowledge",
    label: "Knowledge",
    summary: "The written record: explanations, answers and the links between them.",
    items: [
      { icon: "article", title: "Articles & documentation", body: "Markdown articles with categories, tags, attachments, revision history and a draft → review → publish workflow." },
      { icon: "question", title: "Questions & answers", body: "Ask once, answer once. Recurring questions get a permanent, searchable answer instead of a lost chat message." },
      { icon: "link", title: "Connected knowledge", body: "Link any record to any other. Each page shows its related articles, parts, failures, SOPs, tests and documents." },
      { icon: "search", title: "Search & discovery", body: "Ranked full-text search across every content type, typo-tolerant matching, type filters and browse-by-tag pages." },
    ],
  },
  {
    id: "engineering",
    label: "Engineering records",
    summary: "Structured records for the practical side of the work.",
    items: [
      { icon: "project", title: "Projects & components", body: "Projects with their parts. The component library doubles as workshop inventory, with stock status and two-way CSV sync." },
      { icon: "failure", title: "Failure tracking", body: "Severity, status, root cause, corrective and preventive actions — linked to the component, project and test involved." },
      { icon: "sop", title: "Standard operating procedures", body: "Procedures the team actually follows, linked to the components and failures that shaped them." },
      { icon: "test", title: "Tests & engineering records", body: "Test, flight, thrust and structural records, plus datasheets, manuals and reports in a document library." },
    ],
  },
  {
    id: "team",
    label: "Team & platform",
    summary: "What makes it usable and trustworthy day to day.",
    items: [
      { icon: "training", title: "Training Center", body: "Courses, modules and lessons — text, video, documents, links and exercises — with enrollment and progress tracking." },
      { icon: "shield", title: "Roles & access control", body: "Five organization roles from Guest to Admin, enforced server-side on every request rather than hidden in the UI." },
      { icon: "language", title: "English & Arabic", body: "The full interface in both languages, with right-to-left layout for Arabic." },
      { icon: "backup", title: "Backups you control", body: "Organization-level export and restore for admins, plus whole-instance backup commands for operators." },
    ],
  },
];

/** Planned — from docs/VISION.md §41. Not available today. */
export const roadmap = [
  "Design decision records",
  "Dedicated lessons-learned records",
  "Comments & notifications",
  "Flight logs",
  "Course quizzes & assessments",
  "AI-assisted search over your own knowledge",
];

export type Screenshot = {
  id: string;
  label: string;
  src: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
};

export const screenshots: Screenshot[] = [
  {
    id: "article",
    label: "Article",
    src: "/screenshots/light-hero.png",
    width: 3200, height: 2000,
    alt: "An Athar article titled 'Battery Thermal Runaway: Root Cause & Lessons Learned', with a table of contents on the left and a Related Content panel on the right listing linked projects, components, failures, SOPs, tests and documents.",
    caption: "A post-mortem article with its auto-generated contents and every linked record beside it.",
  },
  {
    id: "failure",
    label: "Failure record",
    src: "/screenshots/light-failure.png",
    width: 3200, height: 2000,
    alt: "An Athar failure record marked High severity and Resolved, with summary, root cause, corrective action and preventive action sections and a Related Content panel.",
    caption: "A failure record: severity, root cause, corrective and preventive action, linked to what it touched.",
  },
  {
    id: "components",
    label: "Components",
    src: "/screenshots/light-components.png",
    width: 3200, height: 2000,
    alt: "The Athar component library as a grid of cards, each showing category, certification status, part number, stock count and key specifications.",
    caption: "The component library, which doubles as workshop inventory.",
  },
  {
    id: "search",
    label: "Search",
    src: "/screenshots/light-search.png",
    width: 3200, height: 2000,
    alt: "Athar search results for 'battery' with content-type filters and result counts, showing articles, a question and components with the matching term highlighted.",
    caption: "One search across articles, questions, components, failures, SOPs, tests and documents.",
  },
  {
    id: "training",
    label: "Training",
    src: "/screenshots/light-course.png",
    width: 3200, height: 2000,
    alt: "An Athar Training Center course page for 'Introduction to Git & GitHub' showing duration, module and lesson counts, and a curriculum of text, video and external-link lessons.",
    caption: "A Training Center course built from lessons the team already wrote.",
  },
  {
    id: "data",
    label: "Engineering data",
    src: "/screenshots/light-test-data.png",
    width: 3200, height: 2000,
    alt: "Part of an Athar article showing a table of per-cell voltage, internal resistance and temperature data, followed by a corrective-actions checklist.",
    caption: "Real engineering detail — tables, checklists and data — kept next to its context.",
  },
];

export const origin = {
  eyebrow: "About",
  heading: "Built by an engineering team that needed a better way to preserve what it learned.",
  body: [
    "Athar started inside Lycans AeroDesign, a university team that designs and builds aircraft for competition. Every year, graduating members took hard-won knowledge with them, and every year new members rediscovered it.",
    "Athar was built to fix that for Lycans. It is now developed in the open so other engineering and student teams can run it for themselves. Lycans is its creator and first real-world user — not its only one.",
  ],
  definition: {
    word: "أثر",
    transliteration: "athar",
    ipa: "/ˈæ.θɑːr/",
    meaning: "A trace, mark, or remnant left behind by something that has passed.",
  },
};

export const selfHost = {
  eyebrow: "Open source & self-hosted",
  heading: "Your instance. Your server. Your knowledge.",
  body: "Athar is not a hosted service. You run it on infrastructure you control, and your team's knowledge stays there.",
  points: [
    { title: "Open source", body: `Every line is public under the ${site.license.name}.` },
    { title: "Self-hosted", body: "Deploy with Docker Compose on your own server. No external account required." },
    { title: "You own the data", body: "PostgreSQL, local or S3-compatible file storage, and backups you can export at any time." },
    { title: "Built for technical teams", body: "Django, Next.js, PostgreSQL and Redis — a conventional stack your members can read and extend." },
  ],
  commands: [
    "git clone https://github.com/Lycans-AeroDesign/Athar.git",
    "cd Athar",
    "python scripts/generate_env.py",
    "docker compose up",
  ],
  stack: ["Django 6", "Next.js 16", "PostgreSQL", "Redis + Celery", "Docker Compose", "nginx"],
};

export const footer = {
  columns: [
    {
      title: "Project",
      links: [
        { label: "GitHub repository", href: links.repo },
        { label: "Quickstart", href: links.quickstart },
        { label: "Deployment guide", href: links.deployment },
        { label: "Contributing", href: links.contributing },
      ],
    },
    {
      title: "Lycans AeroDesign",
      links: [
        { label: "lycansteam.com", href: links.lycansSite },
        { label: "GitHub organization", href: links.lycansGithub },
      ],
    },
  ],
};
