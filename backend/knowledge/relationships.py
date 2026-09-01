"""Canonical relationship-type registry for KnowledgeRelation.

One entry per (name, source_type, target_type) triple, each carrying the
reverse verb to display when the relation is viewed from the target side -
e.g. Project--USES-->Component is the same stored row as
Component--USED_IN-->Project when viewed from the other end. A relation is
always *stored* in its canonical forward direction (services.create_relation
normalizes this); which verb to *display* depends only on which side the
current viewer is on (serializers.KnowledgeRelationSerializer.get_relation_label).

Sourced from docs/VISION.md sections 15-23. Where the spec names an explicit
reverse verb, it's used verbatim; where it doesn't, a reverse is proposed
here (marked below) - the one place this module makes a naming call the spec
itself left open.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class RelationshipDefinition:
    name: str
    reverse_name: str
    source_type: str
    target_type: str


# The generic fallback (VISION.md #24) - used whenever no more specific
# definition matches. Symmetric (same verb both directions), and exactly what
# every KnowledgeRelation created before this registry existed already
# stores - no data migration needed for those rows to keep working.
GENERIC_RELATED = "RELATED"

# fmt: off
RELATIONSHIP_DEFINITIONS: list[RelationshipDefinition] = [
    RelationshipDefinition("USES", "USED_IN", "project", "component"),                 # VISION #15.1
    RelationshipDefinition("HAS_FAILURE", "OCCURRED_IN", "project", "failure"),         # #15.2
    RelationshipDefinition("HAS_TEST", "PART_OF", "project", "test"),                   # #15.3
    RelationshipDefinition("DOCUMENTED_BY", "RELEVANT_TO", "project", "article"),       # #15.4
    RelationshipDefinition("HAS_QUESTION", "RELATED_TO", "project", "question"),        # #15.5
    RelationshipDefinition("USES", "USED_IN", "project", "sop"),                        # #15.6
    RelationshipDefinition("DOCUMENTED_BY", "RELEVANT_TO", "project", "document"),      # #15.7
    RelationshipDefinition("INVOLVED_IN", "INVOLVES", "component", "failure"),          # #16.1 + #17.5
    RelationshipDefinition("TESTED_IN", "TESTS", "component", "test"),                  # #16.2; reverse proposed
    RelationshipDefinition("DOCUMENTED_BY", "DOCUMENTS", "component", "article"),       # #16.3; reverse proposed
    RelationshipDefinition("APPLIES_TO", "HAS_SOP", "sop", "component"),                # #19 example + #16.4
    RelationshipDefinition("HAS_QUESTION", "RELATED_TO", "component", "question"),      # #16.5; reverse proposed
    RelationshipDefinition("HAS_RESOURCE", "RESOURCE_FOR", "component", "document"),    # #16.6; reverse proposed
    RelationshipDefinition("DISCOVERED_FAILURE", "DISCOVERED_DURING", "test", "failure"),  # #17.1
    RelationshipDefinition("DOCUMENTED_BY", "DOCUMENTS", "test", "article"),            # #18.1; reverse proposed
    RelationshipDefinition("FOLLOWED_BY", "FOLLOWS", "sop", "test"),                    # #18.2; reverse proposed
    RelationshipDefinition("EXPLAINED_BY", "EXPLAINS", "failure", "article"),           # #17.2; reverse proposed
    RelationshipDefinition("RESOLVES", "RESOLVED_BY", "sop", "failure"),                # #17.3
    RelationshipDefinition("RAISED_QUESTION", "RAISED_BY", "failure", "question"),      # #17.4; reverse proposed
]
# fmt: on


def get_definition(name: str, source_type: str, target_type: str) -> RelationshipDefinition | None:
    """Exact canonical-direction lookup - used to resolve a *stored* relation's
    display label, since create_relation() only ever stores the canonical
    `.name` direction, never `.reverse_name`."""
    for definition in RELATIONSHIP_DEFINITIONS:
        if definition.name == name and definition.source_type == source_type and definition.target_type == target_type:
            return definition
    return None


def find_definition_for_creation(name: str, source_type: str, target_type: str) -> tuple[RelationshipDefinition, bool] | None:
    """Look up a registry entry for a relation someone is about to *create*,
    given the (name, source_type, target_type) they submitted. Also tries
    matching `name` against each definition's reverse_name with source/target
    swapped, so picking a relation type from either side works without the
    caller needing to know the canonical direction.

    Returns (definition, is_reversed) - is_reversed=True means the caller's
    source/target must be swapped before storing, since the canonical
    direction is the other way around. Returns None if nothing matches (the
    generic "RELATED" fallback isn't looked up here - callers should check
    `name == GENERIC_RELATED` separately, since it's valid for every type
    pair without needing an entry of its own)."""
    for definition in RELATIONSHIP_DEFINITIONS:
        if definition.name == name and definition.source_type == source_type and definition.target_type == target_type:
            return definition, False
        if definition.reverse_name == name and definition.source_type == target_type and definition.target_type == source_type:
            return definition, True
    return None


def definitions_for_pair(source_type: str, target_type: str) -> list[tuple[str, RelationshipDefinition]]:
    """Every (verb, definition) choice valid between two types, from either
    side - e.g. for (component, project) this includes USED_IN (component is
    the reverse side of project--USES-->component). Used to populate the
    frontend's relation-type picker once a target has been chosen; mirrored
    as a static table in frontend/lib/knowledgeTypes.ts rather than fetched,
    same precedent as RELATABLE_ICON/RELATABLE_ROUTE_PREFIX."""
    choices = []
    for definition in RELATIONSHIP_DEFINITIONS:
        if definition.source_type == source_type and definition.target_type == target_type:
            choices.append((definition.name, definition))
        elif definition.source_type == target_type and definition.target_type == source_type:
            choices.append((definition.reverse_name, definition))
    return choices
