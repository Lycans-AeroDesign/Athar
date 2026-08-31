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

Each organization owns and operates its own installation and data.

Teams can:

* Clone/fork the repository
* Deploy it on their own server
* Configure their own branding
* Configure their own teams
* Configure their own roles
* Configure their own categories
* Configure their own content

If organizations want someone else to host/manage it, that can be offered separately in the future, but **hosting other teams is not part of the core product**.

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
Inventory
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

Features:

* Learning paths
* Courses
* Lessons
* Assessments
* Practical tasks
* Training progress
* Completion status

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

Public knowledge only.

### Applicant

Public/team handbook and permitted training.

### Member

Can:

* Read knowledge
* Create articles/drafts
* Ask questions
* Answer questions
* Report failures
* Submit flights
* Upload resources
* Comment

### Senior Member

Additional:

* Review articles
* Edit content
* Moderate questions
* Update failures

### Team/Subteam Head

Additional:

* Publish content
* Manage subteam knowledge
* Manage training
* Assign reviewers

### Organization Admin

Additional:

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
* shadcn/ui

### Backend

* Python
* Django
* Django REST Framework
* OpenAPI / `drf-spectacular`

### Database

* PostgreSQL

### Caching / Background Work

* Redis
* Celery

### File Storage

Development:

* Local filesystem

Production:

* S3-compatible storage
* MinIO as a self-hosted option

### Deployment

* Docker
* Docker Compose
* Linux

### CI/CD

* GitHub Actions
* Docker image builds
* Automated tests
* Security checks

### Testing

* pytest
* Django/DRF tests
* Vitest/React Testing Library
* Playwright

---

## 33. Search Technology

### V1

PostgreSQL full-text search.

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

### V0.1 — Foundation

* Django
* PostgreSQL
* Next.js
* TypeScript
* Docker
* Authentication
* RBAC
* Organization configuration

### V0.2 — Knowledge

* Wiki
* Articles
* Categories
* Tags
* Attachments
* Revisions
* Relationships

### V0.3 — Engineering

* Projects
* Components
* Failures
* SOPs
* Flight Logs
* Design Decisions
* Lessons Learned

### V0.4 — Collaboration

* Q&A
* Comments
* Notifications
* Reviews
* Activity

### V0.5 — Search

* Full-text search
* Filters
* Related knowledge
* Mention detection

### V1.0 — Open Source Release

* Production deployment
* Security hardening
* Backups
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
