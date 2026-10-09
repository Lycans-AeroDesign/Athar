"""Starter Privacy Policy and Confidentiality Agreement for a student
engineering team's knowledge base - published as version 1 for every
organization (existing ones by migrations/0002, new ones when they're
created - see services.seed_default_policies). Admins review and adapt them
in Settings > Policies; they aren't legal advice."""

PRIVACY_POLICY = """\
## 1. Who we are

This knowledge management system ("the platform") is operated by the team for its members, alumni and mentors. It stores the team's engineering knowledge: articles, questions, projects, components, test and failure reports, SOPs, documents and training material.

## 2. What we collect

- **Account details:** your name, email address, optional username, job title and profile picture.
- **Content you contribute:** everything you write, upload, link or comment on, along with who created or edited it and when.
- **Activity records:** an audit log of actions such as signing in, creating, editing, publishing and deleting content, including the IP address and browser used. This keeps the platform secure and shows who contributed what.
- **Preferences:** settings such as language, theme and list filters.

We don't use advertising or third-party tracking, and we don't sell or share your data with anyone outside the team.

## 3. Why we use it

- To let you sign in and use the platform according to your role.
- To credit contributions (contributor lists, leaderboards, co-authorship).
- To keep the platform secure, investigate misuse, and recover from mistakes using backups.

## 4. Who can see it

- Your name, title and profile picture are visible to other members of the organization.
- Content marked **Restricted** is only visible to its owner, the people it's shared with, and administrators.
- Administrators can see account details and the audit log in order to run the platform.

## 5. How long we keep it

Content stays on the platform as part of the team's knowledge base, even after you leave the team, so future members can learn from it. Audit records and backups are kept for as long as needed to keep the platform secure and recoverable.

## 6. Your choices

You can update your profile at any time from your account page. To ask for a copy of your personal data, a correction, or removal of your account, contact a team administrator. Content you contributed to shared team knowledge may be kept with your name removed instead of being deleted.

## 7. Changes to this policy

When this policy changes, you'll be asked to review and accept the new version before you continue using the platform.
"""

CONFIDENTIALITY_AGREEMENT = """\
## 1. Purpose

The platform holds the team's technical knowledge: designs, analyses, test data, failure investigations, procedures, supplier information and competition strategy. Much of it was costly to produce, and some of it is shared with us by sponsors and partners in confidence. This agreement explains how you must handle it.

## 2. What counts as confidential

Treat everything on the platform as **confidential** unless it has clearly been made public by the team, including:

- aircraft designs, CAD models, drawings, calculations and simulation results;
- test plans, test data, flight logs and failure reports;
- SOPs, manufacturing processes and component specifications;
- sponsor, supplier and pricing information;
- competition reports, scores, strategy and anything marked **Restricted**.

## 3. Your obligations

As a member you agree to:

1. **Use** confidential information only for team work.
2. **Not share** it outside the team (including on social media, with other teams, or with employers) without approval from a team lead or administrator.
3. **Not copy or export** content in bulk to personal storage, or keep it after you leave the team, except where a team lead has approved it.
4. **Respect access levels:** don't try to view Restricted content you haven't been given access to, and don't share your account or reset links with anyone.
5. **Protect sponsor information** according to any sponsor agreement the team has signed.
6. **Report** any suspected leak, lost device or compromised account to an administrator as soon as possible.

## 4. Exceptions

This agreement doesn't cover information that is already public through no fault of yours, that you knew before joining the team, or that you're legally required to disclose. If a disclosure is legally required, let the team know first where you're allowed to.

## 5. After you leave the team

Your confidentiality obligations continue after you leave the team or your access ends.

## 6. Breaches

Breaking this agreement can lead to your access being removed and to action by the team, university or sponsor, depending on how serious it is.

## 7. Changes to this agreement

When this agreement changes, you'll be asked to review and accept the new version before you continue using the platform.
"""

DEFAULT_POLICIES = (
    ("PRIVACY", "Privacy Policy", PRIVACY_POLICY),
    ("CONFIDENTIALITY", "Confidentiality Agreement", CONFIDENTIALITY_AGREEMENT),
)
