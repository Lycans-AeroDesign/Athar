"""Contribution/recognition scoring - a fixed weight per audit action type,
seeded from the user's own suggested table (ask=+1, answer=+2, accepted
answer=+5, publish=+5, document a failure/test=+5, create an SOP=+6, ...)
rather than a flat "1 object = 1 point" count, so the leaderboard rewards
useful knowledge over object-farming (per the user's own explicit framing).

Deliberately excludes quality/validation signals (peer rating, usefulness
votes, ...) - the user's own brief defers those explicitly ("you can later
add quality signals"), so this is creation-weighted only, v1.

Mirrors knowledge/relationships.py's precedent: a small standalone lookup
module, not scoring logic buried inside services.py.
"""

# action string -> points. Only knowledge-contributing actions are listed -
# anything not in this dict (auth.login, role.assign, organization.update,
# file.delete, ...) is worth 0, not an oversight.
CONTRIBUTION_POINTS: dict[str, int] = {
    "question.create": 1,
    "question.answer": 2,
    "question.promote": 2,
    # "question.accept_answer" is deliberately NOT scored by a flat lookup
    # here - see compute_contribution_score()'s own docstring for why it
    # needs special-case attribution to the *answer's author*, not the
    # actor who clicked accept.
    "article.create": 3,
    "article.publish": 5,
    "article.update": 2,  # approximates "major revision" - every content-changing edit counts equally, a deliberate simplification
    "project.create": 2,
    "component.create": 2,
    "failure.create": 5,
    "test.create": 5,
    "sop.create": 6,
    "document.create": 2,
}

# The one action scored by attributing to someone other than the audit
# entry's own `actor` (see compute_contribution_score).
ACCEPTED_ANSWER_ACTION = "question.accept_answer"
ACCEPTED_ANSWER_POINTS = 5
