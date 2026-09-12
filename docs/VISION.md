# Athar (أثر) — Agreed System Specification

> This is the baseline product specification agreed on before writing the full SRS. It defines the product vision, design principles, and roadmap. Feature IDs, page-by-page functionality, and detailed acceptance criteria will follow in the SRS.

## 1. Product Vision

**Athar** is an open-source, self-hosted Knowledge Management System designed initially for student AeroDesign teams.

Its purpose is to preserve and connect the team's accumulated:

* Engineering knowledge
* Design practices
* Problems and solutions
* Failures
* Lessons learned
* Projects
* Components
* Procedures
* Flight history
* Training material
* Engineering decisions

The goal is that when experienced members graduate, their knowledge **does not leave with them**.

A new member should be able to search the system and understand not only **what the team does**, but also **why it does it**.

---

## 2. Open-Source Philosophy

Athar will **not be a hosted SaaS platform by default**.

> **Status update**: the sentence above and the diagram/bullets below described the *only* supported shape as of the original spec. As of the multi-tenancy retrofit, the backend is genuinely multi-tenant (a real `Organization` model, every tenant-owned row scoped to it, and a self-service "create a new organization" signup alongside invitation-based joining) — one deployment can now serve several independent organizations with full data isolation, not only one. The rest of this section is kept largely as originally written because **both shapes remain valid and the self-hosted, single-org deployment is still the default/primary intended use** — nothing about self-hosting a single-org instance changed. What changed is that "hosting other teams," previously described below as a hypothetical future option outside the core product, is now an actual built-in capability of the core product itself. Whichever framing this section should settle on long-term is a product decision, not something this note resolves — flagged here so the text below isn't read as still fully accurate.

Instead:

```text
Athar Open Source
        │
        ├── Lycans
        │     └── Self-hosted instance
        │
        ├── Team B
        │     └── Self-hosted instance
        │
        └── Team C
              └── Self-hosted instance
```

Each organization owns and operates its own installation and data. (Still fully supported — a `docker compose up` deploys one instance that can serve exactly one organization, same as always, if that's all a team ever registers.)

Teams can:

* Clone/fork the repository
* Deploy it on their own server
* Configure their own branding
* Configure their own teams
* Configure their own roles
* Configure their own categories
* Configure their own content

If organizations want someone else to host/manage it, that can be offered separately in the future, but **hosting other teams is not part of the core product**. (See the status update above — this specific sentence is the one now out of date: the same deployment hosting multiple organizations, each fully isolated, is implemented today, not just planned.)

---

## 3. Generic / Organization-Configurable Design

The application must not hard-code Lycans-specific concepts.

For example, the software should **not assume** that teams are:

```text
Mechanical
Electrical
Autonomous
Compumissions
```

Instead, the organization configures its own structure.

One team might have:

```text
Structures
Propulsion
Avionics
GNC
```

while another has:

```text
Mechanical
Electrical
Software
Operations
```

The software provides the functionality; the organization provides the configuration.

---

## 4. Branding

Organizations can configure:

* Organization name
* Logo
* Favicon
* Primary color
* Secondary color
* Background/theme
* Description
* Contact information
* Login page branding
* Footer
* Custom domain if desired

Therefore the same software can appear as:

```text
Lycans Knowledge Portal
```

or:

```text
XYZ Aero Knowledge Hub
```

without changing the source code.

---

## 5. Core Design Principle — Connected Knowledge

This is one of the most important decisions.

> **Knowledge should not exist as isolated documents.**

Every major knowledge object should be able to connect to other relevant knowledge.

For example:

```text
Pixhawk 6X
   │
   ├── Used In → DBF 2027
   ├── Related → GPS M10
   ├── Documented In → Pixhawk Setup SOP
   ├── Failure → GPS EKF Failure
   ├── Question → Pixhawk Configuration
   ├── Training → Autonomous Level 1
   ├── Decision → Why Pixhawk was selected
   └── Article → Flight Controllers
```

And the relationship works in reverse.

---

## 6. Knowledge Graph Concept

The system will conceptually contain **Knowledge Objects**.

Examples:

* Article
* Component
* Project
* Failure
* SOP
* Question
* Flight
* Design Decision
* Lesson Learned
* Training Module
* Resource

Objects can have relationships such as:

* `RELATED_TO`
* `USED_IN`
* `DEPENDS_ON`
* `CAUSED_BY`
* `SOLVED_BY`
* `DOCUMENTS`
* `REFERENCES`
* `MENTIONS`
* `RESULTED_IN`
* `PART_OF`
* `CREATED_FROM`

This creates a connected engineering knowledge graph.

---

## 7. Related Knowledge

Every major detail page should have a **Related Knowledge** section.

For example, a Component page can show:

```text
Related Components
Projects
SOPs
Failures
Flight Logs
Questions
Articles
Training
Design Decisions
Lessons Learned
Files
```

A Project can show:

```text
Components
Articles
SOPs
Failures
Flights
Decisions
Lessons
Questions
Resources
```

A Failure can show:

```text
Affected Components
Project
Flight
SOPs
Articles
Questions
Lessons Learned
```

---

## 8. Explicit Relationships vs Mentions

The system should distinguish between:

### Explicit relationship

An author deliberately links:

```text
Failure #31 → Component → Pixhawk 6X
```

### Mention

An article simply mentions:

> "The Pixhawk 6X was selected..."

The system can later detect these mentions.

The UI can show:

**Related Knowledge**

and:

**Mentioned In**

separately.

---

## 9. Global Search

Search is a core feature, not an afterthought.

A global search should search across:

```text
Articles
SOPs
Projects
Components
Failures
Questions
Answers
Training
Resources
Design Decisions
Lessons Learned
Flight Logs
```

Search filters include:

* Content type
* Category
* Tag
* Team/subteam
* Project
* Author
* Date
* Status
* Competition
* Aircraft

Search results should provide contextual information and links to related knowledge.

**Tag filtering status: implemented, as a dedicated browse page rather than a checkbox inside the main search UI** — clicking any tag chip (on an article, question, project, component, or SOP) opens `/knowledge/tags/[id]`, showing everything with that exact tag across every taggable type, reusing the same backend search endpoint (`?tag=<id>` alongside its existing `?q=`), the same per-type visibility rules, and the same results/pagination UI as a text search. Category/tag-*name* matching as free-text search terms (typing "propulsion" and having it also surface items merely tagged "propulsion") is a distinct, still-unimplemented idea — see `backend/knowledge/views.py`'s `SearchView` docstring for the standing note on this.

---

## 10. Main UI Navigation

The primary application navigation will contain:

```text
Dashboard
Wiki / Knowledge
Projects
Components
SOPs
Failures
Flight Logs
Q&A
Training
Resources
Design Decisions
Lessons Learned
Notifications
Profile
Administration
```

Not every item has to be visible to every user; visibility can depend on permissions.

---

## 11. Dashboard

The dashboard should include:

* Welcome
* Global search
* Recent activity
* Recently viewed
* Bookmarks
* Unanswered questions
* Assigned reviews
* Training progress
* Announcements
* Upcoming events
* Quick actions

Quick actions can include:

* New Article
* Ask Question
* Report Failure
* Add Component
* Add Project
* Submit Document

Only authorized actions should appear.

---

## 12. Wiki / Knowledge Base

Features:

* Categories
* Tags
* Articles
* Rich Markdown/editor
* Table of contents
* Images
* Videos
* Attachments
* Related knowledge
* Comments
* Revisions
* Version history
* Drafts
* Reviews
* Publishing
* Bookmarks
* Author information
* Last updated information

Article lifecycle:

```text
Draft
  ↓
Review
  ↓
Approved
  ↓
Published
  ↓
Updated / New Revision
  ↓
Archived
```

---

## 13. Projects

Each aircraft or major engineering project can have its own workspace.

Example:

```text
DBF 2027
├── Overview
├── Requirements
├── Team
├── Timeline
├── Documents
├── Mechanical
├── Electrical
├── Software
├── Manufacturing
├── Testing
├── Flights
├── Failures
├── Decisions
├── Lessons Learned
└── Resources
```

---

## 14. Component Library

Every component can have a dedicated page.

Example:

```text
Pixhawk 6X

Overview
Specifications
Datasheet
Files
Inventory  (done: on-hand quantity, photo, external link, plus a filtered CSV export from the Components list)
Projects Used In
Related Components
Failures
SOPs
Questions
Articles
Training
Design Decisions
```

---

## 15. SOP Library

Standard Operating Procedures.

Examples:

* ESC calibration
* Pixhawk setup
* Firmware update
* Motor testing
* Servo installation
* Carbon layup
* Preflight inspection

An SOP contains:

* Purpose
* Prerequisites
* Required equipment
* Safety notes
* Procedure
* Verification
* Common mistakes
* Troubleshooting
* References
* Related knowledge

---

## 16. Failure Database

Structured engineering failure reports.

Each failure contains:

* Title
* Aircraft
* Project
* Date
* Symptoms
* Evidence
* Investigation
* Root cause
* Corrective action
* Preventive action
* Severity
* Status
* Attachments
* Related components
* Related SOPs
* Related flights
* Lessons learned

---

## 17. Flight Logs

Each flight can contain:

* Aircraft
* Project
* Date
* Pilot
* Weather
* Wind
* Battery
* Payload
* Mission
* Parameters
* Result
* Notes
* Flight controller logs
* Videos
* Photos
* GPS data
* Detected issues
* Related failures

---

## 18. Q&A

An internal Stack Overflow-style system.

Questions contain:

* Title
* Description
* Images
* Files
* Tags
* Related components
* Related articles
* Related projects
* Answers
* Comments
* Accepted answer

Important workflow:

```text
Question
   ↓
Answer
   ↓
Accepted Answer
   ↓
Promote to Knowledge Article
```

This allows useful questions to become permanent documentation.

---

## 19. Training

Training is integrated into the KMS.

**Status: implemented (V1 scope), added beyond the original roadmap** — see [`README.md`](../README.md#roadmap). A `training` Django app, structurally separate from Knowledge (lessons *reference* existing Knowledge content instead of duplicating it, respecting Knowledge's own RESTRICTED-visibility rules rather than a second authorization system), mirroring Article's DRAFT → IN_REVIEW → PUBLISHED → REJECTED → ARCHIVED workflow for courses.

Features:

* Learning paths — done, as Course → Module → Lesson (not a separate "path" concept spanning multiple courses)
* Courses — done, with category/difficulty/estimated-duration and the same draft/review/publish workflow as Article
* Lessons — done, five types (text, video, document, external link, exercise); a lesson's primary video/document resource is either an external URL (e.g. a Google Drive share link, embedded via a narrowly-scoped iframe for Drive links specifically) or an Athar-hosted file, never a second file-storage mechanism
* Assessments — **not started** (quizzes/scored assessments remain future scope, per the spec's own "don't overbuild V1" guidance)
* Practical tasks — partially done, as the `EXERCISE` lesson type (presented + a manual "mark complete", no submission/grading workflow yet)
* Training progress — done, per-lesson completion tracking, with automatic course completion once every *required* lesson is done (optional lessons don't block it)
* Completion status — done, `CourseEnrollment.status` (`IN_PROGRESS`/`COMPLETED`), with "not started" represented as the absence of an enrollment row rather than a third stored state

Example:

```text
Electrical Beginner
    ↓
Module 1
    ↓
Module 2
    ↓
Module 3
    ↓
Assessment
```

---

## 20. Resources

Central resource library for:

* PDFs
* Datasheets
* CAD
* Code
* Templates
* Images
* Videos
* Research papers
* External links
* Manuals

---

## 21. Design Decision Records

A dedicated system for documenting **why** engineering decisions were made.

Each record can contain:

```text
Problem
Context
Alternatives
Evaluation Criteria
Decision
Reasoning
Trade-offs
Consequences
Status
```

Example:

> Why did we select Pixhawk 6X?

This prevents future members from repeatedly reconsidering decisions without knowing the historical context.

---

## 22. Lessons Learned

Structured records of knowledge gained from:

* Projects
* Competitions
* Failures
* Experiments
* Manufacturing
* Testing

They can be linked to the relevant project, failure, component, etc.

---

## 23. Collaboration

Features:

* Comments
* Discussions
* Notifications
* Mentions
* Activity feed
* Bookmarks
* Reviews

Notifications include:

* Mentioned
* Question answered
* Draft approved/rejected
* Review requested
* Comment added
* Training assigned
* Announcement published

---

## 24. User Profiles

A user's profile can show:

* Name
* Organization
* Team/subteam
* Role
* Skills
* Contributions
* Articles
* Questions
* Answers
* Projects
* Training progress
* Activity
* Bookmarks

---

## 25. Authentication

Initial authentication:

* Login
* Logout
* Registration if enabled
* Password reset
* Email verification
* Session/token management

Future integrations can include:

* Google
* GitHub
* Microsoft
* LDAP
* SSO
* Keycloak

---

## 26. Roles

The system should have default roles but **roles must be configurable**.

Potential defaults:

### Guest

Public knowledge only. Also the default role a self-registered user lands in
before a board member or subteam head promotes them to Member.

### Member

Current team members. Can:

* Read knowledge
* Create articles/drafts
* Ask questions
* Answer questions
* Report failures
* Submit flights
* Upload resources
* Comment

### Mentor

Graduated members who stay on to review and guide the current team.
Additional:

* Review articles
* Edit content
* Moderate questions
* Update failures

### Subteam Head

Additional:

* Publish content
* Manage subteam knowledge
* Manage training
* Assign reviewers

### Organization Admin

The board. Additional:

* Manage users
* Manage roles
* Manage permissions
* Manage organization configuration
* Manage branding
* View audit logs

### Platform Admin

Only relevant if someone operates multiple installations centrally.

This is **not an organization role**.

---

## 27. Permission System

Roles are collections of permissions.

Don't hard-code:

```text
if user.role == "team_leader"
```

Instead:

```text
User
 ↓
Role
 ↓
Permissions
 ↓
Authorization
```

Example permissions:

```text
article.read
article.create
article.update
article.review
article.publish
article.delete

failure.read
failure.create
failure.update
failure.delete

question.create
question.answer
question.moderate

project.create
project.update
project.delete

user.manage
role.manage
permission.manage
organization.manage
branding.manage
audit.read
```

The exact permission catalogue will be defined in the SRS.

---

## 28. Backend Security

**The frontend is not a security boundary.**

If the UI hides:

```text
Delete
```

that does not mean the user is prevented from deleting.

Every API request must perform authorization:

```text
Request
 ↓
Authentication
 ↓
Organization membership
 ↓
Permission check
 ↓
Object-level authorization
 ↓
Action
```

Someone using Postman/curl must have exactly the same restrictions as someone using the UI.

---

## 29. Content Visibility

Knowledge objects can eventually have visibility levels such as:

```text
PUBLIC
ORGANIZATION
TEAM
PRIVATE
RESTRICTED
```

This is separate from roles.

A user might technically have permission to read articles but still not have access to a particular restricted project.

---

## 30. Audit System

The system should record important actions:

* Login
* Logout
* Create
* Edit
* Delete
* Publish
* Approve
* Reject
* Permission change
* Role change
* User management
* File upload/delete

With:

```text
Who
What
When
Object
Action
```

---

## 31. Branding / Organization Configuration

Organizations should be able to configure:

* Name
* Logo
* Favicon
* Colors
* Description
* Teams
* Categories
* Tags
* Roles
* Settings
* Content terminology

The application itself remains generic.

---

## 32. Technology Stack

### Frontend

* Next.js
* React
* TypeScript
* Tailwind CSS
* A custom Radix/cmdk-based UI kit (`frontend/components/ui/`) — shadcn/ui is under evaluation against it, not yet adopted

### Backend

* Python
* Django
* Django REST Framework
* OpenAPI / `drf-spectacular`

### Database

* PostgreSQL

### Caching / Background Work

* Redis — done
* Celery — done; currently powers the org-scoped backup/restore background job (see §41 V1.0)

### File Storage

Development:

* Local filesystem

Production:

* S3-compatible storage — done, opt-in via env vars (`AWS_STORAGE_BUCKET_NAME` and friends); local filesystem remains the default when unset
* MinIO as a self-hosted option — untested against this app specifically, but any S3-compatible endpoint should work through the same env vars

### Deployment

* Docker
* Docker Compose
* nginx (reverse proxy in front of the backend - rate limiting, security headers, `/api/v1/health/` liveness check; see `nginx/nginx.conf`) - done, not originally listed here
* Linux

### CI/CD

* GitHub Actions
* Docker image builds
* Automated tests
* Security checks

### Testing

* Django/DRF `APITestCase` suite, run via `manage.py test` — done (backend)
* pytest — planned, possible future migration off `manage.py test`
* Vitest/React Testing Library — done (frontend), a starting suite covering pure `lib/` helpers and a first component test
* Playwright — not started

---

## 33. Search Technology

### V1

**Status: implemented.** PostgreSQL full-text search (`SearchVector`/`SearchRank`), with a trigram-similarity fallback for substring/typo matches, ranked by relevance.

No need to introduce Elasticsearch/OpenSearch initially.

### Future

Potentially:

* OpenSearch
* Semantic search
* Vector embeddings

---

## 34. Relationship Technology

Start with PostgreSQL relationships.

We do **not** need a graph database such as Neo4j initially.

A generic relationship model can represent:

```text
Source
Relationship Type
Target
```

For example:

```text
Failure #31
    CAUSED_BY
GPS M10
```

If the graph becomes sufficiently large/complex later, a specialized graph database can be evaluated.

---

## 35. Versioning

Knowledge articles should maintain revisions:

```text
Article
├── Revision 1
├── Revision 2
├── Revision 3
└── Current Revision
```

Users with appropriate permissions can:

* View history
* Compare revisions
* Restore previous versions

---

## 36. Docker / Self-Hosting

A major goal should be:

```bash
git clone ...
cd athar
docker compose up
```

and the complete application runs locally/self-hosted.

Potential services:

```text
Frontend
Backend
PostgreSQL
Redis
Celery
MinIO
Nginx      (done - reverse proxy in front of the backend, both dev and prod
            Compose stacks; see docs/VISION.md §32 and nginx/nginx.conf)
```

The exact production architecture can be finalized later.

---

## 37. Future AI Assistant

This is a **future feature**, not a V1 requirement.

The idea:

> An AI assistant that uses the team's KMS as its primary knowledge source.

Architecture:

```text
User
 ↓
AI Assistant
 ↓
Query
 ↓
Permission-aware Retrieval
 ├── Keyword Search
 └── Semantic Search
        ↓
Relevant KMS Knowledge
        ↓
LLM
        ↓
Answer + Sources
```

The AI should be able to answer questions such as:

> What failures have we experienced with Pixhawk?

or:

> Why did the team change the BEC configuration?

---

## 38. AI Must Respect Permissions

This is critical.

If a user cannot access a document, the AI must not retrieve it and reveal its contents.

```text
User
 ↓
Permissions
 ↓
Allowed Knowledge
 ↓
RAG Retrieval
 ↓
LLM
 ↓
Answer
```

The AI becomes another interface to the existing authorization system—not a bypass around it.

---

## 39. AI Sources

AI answers should cite KMS objects.

For example:

```text
Answer

The configuration was changed because...

Sources:
• Failure #42
• DBF 2027 Power System
• BEC Configuration SOP
```

Clicking a source takes the user directly to that KMS object.

---

## 40. AI + Knowledge Graph

The future AI should understand relationships.

Instead of simply searching for:

```text
"Pixhawk"
```

it could retrieve:

```text
Pixhawk
├── Components
├── Projects
├── Failures
├── Flights
├── SOPs
├── Questions
├── Decisions
└── Lessons Learned
```

This is where the connected knowledge model becomes extremely valuable.

---

## 41. Development Roadmap

> This section is the target plan, not a status report — see `README.md`'s own Roadmap section for a condensed, kept-current summary of what's actually built. The status notes below exist so this document alone doesn't read as a plan nobody has started on.

### V0.1 — Foundation *(done)*

* Django
* PostgreSQL
* Next.js
* TypeScript
* Docker
* Authentication
* RBAC
* Organization configuration
* Multi-tenancy — done, beyond what this section originally scoped: a real `Organization` model, every tenant-owned row scoped to it, self-service org creation alongside invitation-based joining, and adversarial cross-org isolation tests. See §2's status update.
* Nginx reverse proxy (rate limiting, security headers, a `/api/v1/health/` liveness check) in front of the backend, in both the dev and prod Docker Compose stacks — not part of the original spec, added for basic production-readiness.

### V0.2 — Knowledge *(mostly done)*

* Wiki
* Articles
* Categories
* Tags
* Attachments
* Revisions
* Relationships

### V0.3 — Engineering *(partially done)*

* Projects — done
* Components — done
* Failures — done
* SOPs — done
* Test/Experiment records — done (not originally in this section's list; a full CRUD type covering test/flight/thrust/structural/etc. records, permission-gated like the four above, added alongside them)
* Document/Resource — done (not originally in this section's list; closest in shape to §20 Resources below - datasheets/manuals/reports/external references with a category, tags, and one primary file, plus `visibility`, which none of the other five Engineering types have)
* Flight Logs — **status unclear, not simply "not started"**: Test/Experiment above now covers flight/thrust/etc. test *records*, which overlaps a lot of what this line originally meant, but there is still no `Flight`/`Aircraft` model - whether Test is meant to fully replace this line or the two are meant to coexist as separate concepts was never resolved when Test was added. Flagged as an open question, not resolved here.
* Design Decisions — not started
* Lessons Learned — not started

### V0.4 — Collaboration *(partially done)*

* Q&A — done
* Comments — not started (no model)
* Notifications — not started (no model)
* Reviews — done, as Article's draft/review/publish workflow
* Activity — done, as the audit log + a public Knowledge activity feed, plus a per-user personal activity feed
* Contribution recognition — done, not originally in this section's list: a weighted per-action scoring system (creating/publishing/answering/etc. each worth different points, not a flat count), an org-scoped leaderboard, and a "contributors" list on every knowledge/engineering object

### V0.5 — Search *(partially done)*

* Full-text search — done (Postgres full-text search + ranking, with a trigram fallback; see §33)
* Filters — done, both cross-type (the global search bar/results page) and per-type (each engineering list page's own search box)
* Related knowledge — done, as the generic `KnowledgeRelation` graph (§34)
* Browse by tag — done, a dedicated per-tag page reusing the same search endpoint/UI (see §9)
* Mention detection — not started; the closest thing today is an explicit `@`-mention picker that inserts a link and creates a real relation when you deliberately pick a result — not automatic scanning of prose

### Training *(done, V1 scope — added beyond the original roadmap; see §19)*

* Courses, modules, lessons — done, mirroring Article's draft/review/publish workflow
* Five lesson types (text, video, document, external link, exercise) — done
* Enrollment and per-lesson progress tracking — done
* Lessons reference existing Knowledge content rather than duplicating it — done
* Assessments/quizzes, assignment submission and grading — not started, deliberately deferred (see §19)

### V1.0 — Open Source Release

* Production deployment
* Security hardening
* Backups — done (org-scoped self-service export/restore via a background job; a whole-instance CLI-only `pg_dump`/`pg_restore` pair for operators)
* Documentation
* Self-hosting guide
* CI/CD
* Contribution guidelines
* Versioned Docker images

### V2+ — AI

* Embeddings
* Vector search
* RAG
* AI assistant
* Semantic relationships
* AI recommendations
* Duplicate detection
* AI-assisted documentation

---

## 42. The Core Architecture in One Picture

The system we're converging on is essentially:

```text
                         ATHAR
                            │
          ┌─────────────────┼──────────────────┐
          │                 │                  │
       Users            Knowledge          Organization
          │                 │                  │
       Roles            Articles             Branding
     Permissions         Projects             Teams
      Security          Components            Categories
          │              Failures              Roles
          │               SOPs                 Settings
          │              Flights
          │              Q&A
          │              Training
          │              Decisions
          │              Lessons
          │                 │
          └─────────────────┼──────────────────┘
                            │
                     Relationships
                            │
                    ┌───────┴───────┐
                    │               │
               Search          Knowledge Graph
                    │               │
                    └───────┬───────┘
                            │
                       Future AI
                          / RAG
```

### The three principles at the top of the SRS

**1. Self-hosted and open source**
Every organization should be able to independently deploy and operate the system.

**2. Connected knowledge**
Knowledge objects should be linkable and navigable so users can discover the complete context surrounding a subject.

**3. Backend-enforced authorization**
All access control must be enforced server-side through authentication, permissions, and object-level authorization; the frontend must never be treated as a security boundary.

This is the baseline from which the actual SRS feature/requirements list will be built, including unique requirement IDs, page-by-page functionality, roles/permissions, workflows, and acceptance criteria.
