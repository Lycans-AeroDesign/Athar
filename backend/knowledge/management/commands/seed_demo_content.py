import datetime

from django.core.management.base import BaseCommand, CommandError

from accounts.models import User
from organization.models import Organization
from rbac.models import Role

from knowledge import services
from knowledge.models import (
    Answer,
    Article,
    Bookmark,
    Category,
    Component,
    Document,
    Failure,
    KnowledgeRelation,
    Project,
    Question,
    RestrictedAccessGrant,
    Sop,
    Test,
    Visibility,
)

# Mirrors frontend/lib/knowledgeTypes.ts's RELATABLE_ROUTE_PREFIX - kept in
# sync by hand, same precedent as that file's own comment about
# knowledge/relationships.py, since nothing generates one from the other.
RELATABLE_ROUTE_PREFIX = {
    "article": "/knowledge/articles",
    "question": "/knowledge/questions",
    "project": "/projects",
    "component": "/components",
    "failure": "/failures",
    "sop": "/sops",
    "test": "/tests",
    "document": "/documents",
}

# email -> (first_name, last_name, role name). Three tiers deliberately, not
# one actor for everything - realistic authorship (a Member asking a
# question a Mentor answers, a Subteam Head creating the project/component
# records) exercises the same ownership/permission checks a real team would
# hit, not just "can the seed script write rows".
DEMO_USERS = {
    "member1@demo.local": ("Casey", "Nguyen", "Member"),
    "mentor1@demo.local": ("Priya", "Sharma", "Mentor"),
    "head1@demo.local": ("Jordan", "Lee", "Subteam Head"),
}
DEMO_PASSWORD = "demopass123"

# (model, owner-field) pairs, leaves-first (mirrors backend/backups/restore.py's
# own _DELETE_SPECS precedent) - used by --reset to remove exactly what this
# command created (anything owned by one of DEMO_USERS) without touching
# anything a real user added by hand.
_RESET_SPECS = [
    (Bookmark, "user", "organization"),
    (RestrictedAccessGrant, "granted_by", "organization"),
    (KnowledgeRelation, "created_by", "organization"),
    # Answer has no `organization` FK of its own - it's only ever reached
    # through its parent Question (see models.py), same as ArticleRevision
    # is only reached through Article.
    (Answer, "author", "question__organization"),
    (Question, "author", "organization"),
    (Article, "author", "organization"),
    (Failure, "created_by", "organization"),
    (Sop, "created_by", "organization"),
    (Test, "created_by", "organization"),
    (Document, "created_by", "organization"),
    (Component, "created_by", "organization"),
    (Project, "created_by", "organization"),
]


class Command(BaseCommand):
    help = (
        "Seeds a rich, interconnected set of demo content spanning every "
        "knowledge/engineering type - projects, components, failures, SOPs, "
        "tests, documents, articles, and Q&A - so the system can be clicked "
        "through/demoed end-to-end rather than starting from an empty "
        "organization. Articles and questions mention other seeded items "
        "inline (a real markdown link plus the matching KnowledgeRelation - "
        "the same combo MarkdownEditor's own @-mention picker creates, see "
        "that component's docstring), and the set also includes tags, a "
        "RESTRICTED article with an access grant, and a couple of bookmarks - "
        "one pass through this command touches nearly every model in the app. "
        "Meant for manual exploration/demoing, not automated tests (which "
        "build their own minimal fixtures via core.testing) and not "
        "production data."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--organization", default=None, help="Organization slug - required if more than one organization exists."
        )
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete this command's own previously-seeded content (anything owned by its demo users) before reseeding.",
        )

    def _resolve_organization(self, slug: str | None) -> Organization:
        if slug:
            try:
                return Organization.objects.get(slug=slug)
            except Organization.DoesNotExist as exc:
                raise CommandError(f"No organization with slug '{slug}'.") from exc
        count = Organization.objects.count()
        if count == 0:
            raise CommandError("No organizations exist yet - create one first.")
        if count > 1:
            slugs = ", ".join(Organization.objects.order_by("slug").values_list("slug", flat=True))
            raise CommandError(f"Multiple organizations exist - pass --organization <slug>. Options: {slugs}")
        return Organization.objects.get()

    def _reset(self, organization) -> None:
        demo_emails = list(DEMO_USERS.keys())
        for model, owner_field, org_lookup in _RESET_SPECS:
            model.objects.filter(
                **{org_lookup: organization, f"{owner_field}__email__in": demo_emails}
            ).delete()
        self.stdout.write("Cleared previously-seeded demo content.")

    def _seed_users(self, organization) -> dict[str, User]:
        users = {}
        for email, (first_name, last_name, role_name) in DEMO_USERS.items():
            try:
                role = Role.objects.get(organization=organization, name=role_name)
            except Role.DoesNotExist as exc:
                raise CommandError(
                    f"Role '{role_name}' doesn't exist yet for '{organization.slug}' - run `manage.py seed_rbac` first."
                ) from exc
            user, created = User.objects.get_or_create(
                email=email,
                defaults={"organization": organization, "first_name": first_name, "last_name": last_name},
            )
            if created:
                user.set_password(DEMO_PASSWORD)
                user.save(update_fields=["password"])
            role.user_roles.get_or_create(user=user)
            users[email] = user
        return users

    def _mention(self, relatable_type: str, object_id, title: str) -> str:
        return f"[{title}]({RELATABLE_ROUTE_PREFIX[relatable_type]}/{object_id})"

    def _link(self, *, actor, source_type: str, source, target_type: str, target) -> None:
        """Creates the KnowledgeRelation a real mention would - always called
        with the article/question as `source` (so the ownership check in
        create_relation passes via its own author), mirroring
        MarkdownEditor.selectMention's relateFrom always being the item
        currently being edited, never the mentioned target."""
        services.create_relation(
            actor=actor, source_type=source_type, source_id=source.pk, target_type=target_type, target_id=target.pk
        )

    def handle(self, *args, **options):
        organization = self._resolve_organization(options["organization"])
        if options["reset"]:
            self._reset(organization)

        users = self._seed_users(organization)
        member = users["member1@demo.local"]
        mentor = users["mentor1@demo.local"]
        head = users["head1@demo.local"]

        categories = {c.slug: c for c in Category.objects.filter(organization=organization)}
        avionics_cat = categories.get("avionics")
        propulsion_cat = categories.get("propulsion")
        testing_cat = categories.get("testing-qa")
        # Components have their own category list (see ComponentCategory).
        avionics_parts = services.get_or_create_component_category("Avionics", actor=head)
        propulsion_parts = services.get_or_create_component_category("Propulsion", actor=head)
        structures_parts = services.get_or_create_component_category("Structures", actor=head)

        today = datetime.date.today()

        # --- Engineering domain first, so articles/questions below can
        # mention real ids in their markdown content at creation time. ---

        falcon = services.create_project(
            actor=head,
            name="Falcon Aircraft 2027",
            description="This season's competition aircraft - a fixed-wing autonomous platform.",
            tag_names=["flight-ready"],
        )
        ground_station = services.create_project(
            actor=head,
            name="Ground Station Rework",
            description="Rebuilding the ground control station software and telemetry link.",
        )

        flight_controller = services.create_component(
            actor=head,
            name="Pixhawk 6X Flight Controller",
            category=avionics_parts,
            manufacturer="Holybro",
            part_number="PIX6X",
            status=Component.Status.CERTIFIED,
            inventory_type=Component.InventoryType.ELECTRICAL,
            location_name="Avionics Cabinet -> Drawer 1",
            quantity_available=2,
            unit="each",
            condition=Component.Condition.GOOD,
            min_quantity=1,
            summary="Primary flight controller running ArduPilot - handles stabilization, navigation, and telemetry.",
            specifications=[
                {"label": "Processor", "value": "STM32H753, dual-core"},
                {"label": "IMU", "value": "Triple redundant"},
                {"label": "Weight", "value": "50g"},
            ],
            tag_names=["avionics", "flight-ready"],
        )
        motor = services.create_component(
            actor=mentor,
            name="T-Motor MN5212 KV340",
            category=propulsion_parts,
            manufacturer="T-Motor",
            part_number="MN5212-340",
            status=Component.Status.TESTING,
            inventory_type=Component.InventoryType.ELECTRICAL,
            location_name="Motors, ESCs and BECs Box",
            quantity_available=1,
            unit="each",
            condition=Component.Condition.NEW,
            min_quantity=2,
            inventory_notes="Spare ordered for the competition build.",
            summary="Primary propulsion motor, paired with a 17x6 propeller.",
            specifications=[
                {"label": "KV Rating", "value": "340 KV"},
                {"label": "Max Thrust", "value": "3.8 kg @ 22.2V"},
            ],
            tag_names=["propulsion"],
        )
        battery = services.create_component(
            actor=mentor,
            name="4S 6000mAh LiPo Battery",
            category=propulsion_parts,
            manufacturer="Tattu",
            part_number="TA-4S-6000",
            status=Component.Status.TESTING,
            inventory_type=Component.InventoryType.ELECTRICAL,
            location_name="LiPo Safe Bag Shelf",
            quantity_available=4,
            unit="each",
            condition=Component.Condition.GOOD,
            summary="Main flight battery pack - see the safety-critical handling SOP before use.",
            specifications=[{"label": "Capacity", "value": "6000mAh"}, {"label": "Discharge Rate", "value": "25C"}],
            tag_names=["propulsion", "safety-critical"],
        )
        wing_spar = services.create_component(
            actor=member,
            name="Carbon Fiber Wing Spar",
            category=structures_parts,
            manufacturer="In-house",
            status=Component.Status.CERTIFIED,
            inventory_type=Component.InventoryType.MECHANICAL,
            location_name="Fuselage Box -> Carbon Fiber",
            quantity_available=0,
            unit="each",
            stock_status=Component.StockStatus.ON_ORDER,
            summary="Primary structural spar for the Falcon airframe's main wing.",
            tag_names=["structures"],
        )

        battery_sop = services.create_sop(
            actor=mentor,
            title="LiPo Battery Handling & Charging",
            category=propulsion_cat,
            mandatory=True,
            safety_notes="LiPo cells can catch fire if punctured, over-discharged, or charged unattended. Always charge in a fireproof bag.",
            content=(
                "## Purpose\n\nSafe handling, storage, and charging of LiPo battery packs.\n\n"
                "## Procedure\n\n1. Inspect the pack for swelling or damage before every use.\n"
                "2. Charge only in a fireproof LiPo bag, never unattended.\n"
                "3. Store at storage voltage (~3.8V/cell) when not flying within 48 hours.\n"
                "4. Never discharge below 3.3V/cell in flight.\n"
            ),
            tag_names=["safety-critical"],
        )
        preflight_sop = services.create_sop(
            actor=head,
            title="Pre-Flight Checklist",
            mandatory=True,
            safety_notes="Skipping any step below has directly caused a prior incident - see linked failure reports.",
            content=(
                "## Procedure\n\n1. Verify battery voltage and physical condition.\n"
                "2. Confirm control surface deflection direction and range.\n"
                "3. GPS lock with at least 8 satellites before arming.\n"
                "4. Range-check the radio link at 50m before every flight.\n"
            ),
            tag_names=["flight-ready"],
        )

        battery_failure = services.create_failure(
            actor=mentor,
            title="Battery thermal runaway during ground test",
            component=battery,
            project=falcon,
            aircraft="Falcon-1",
            date=today - datetime.timedelta(days=21),
            severity=Failure.Severity.HIGH,
            status=Failure.Status.RESOLVED,
            summary="Pack began swelling and smoking during a static ground test after being left on charge unattended overnight.",
            root_cause="Charger left connected past full charge with no timer/alarm; cell balance was already poor from prior over-discharge.",
            corrective_action="Pack was safely discharged in sand and disposed of. No injuries.",
            preventive_action="Charging is now only permitted per the LiPo Battery Handling SOP - no unattended charging.",
        )
        gps_failure = services.create_failure(
            actor=head,
            title="GPS lock lost mid-flight",
            project=falcon,
            aircraft="Falcon-1",
            date=today - datetime.timedelta(days=10),
            severity=Failure.Severity.MEDIUM,
            status=Failure.Status.UNDER_INVESTIGATION,
            summary="Aircraft briefly lost GPS lock at altitude, triggering an automatic RTL that landed safely off the intended pad.",
            root_cause="Suspected antenna placement interference from the telemetry radio - not yet confirmed.",
        )

        thrust_test = services.create_test(
            actor=mentor,
            title="Static Thrust Test - MN5212",
            test_type=Test.TestType.THRUST,
            date=today - datetime.timedelta(days=30),
            location="Workshop test stand",
            project=falcon,
            objective="Confirm measured thrust matches the manufacturer's rated curve before flight installation.",
            status=Test.Status.COMPLETED,
            configuration="MN5212 KV340 + 17x6 prop + 4S 6000mAh pack.",
            procedure="Ramped throttle 0-100% in 10% steps, logging thrust/current/RPM at each step.",
            results="Peak thrust 3.7kg at 100% throttle, within 5% of rated spec.",
            pass_fail=Test.PassFail.PASS,
            conclusion="Motor/prop combination approved for flight installation.",
            tag_names=["propulsion"],
        )
        flight_test = services.create_test(
            actor=head,
            title="Autonomous Flight Test #3",
            test_type=Test.TestType.FLIGHT,
            date=today - datetime.timedelta(days=10),
            location="Team airfield",
            project=falcon,
            objective="Validate the autonomous waypoint mission plan end-to-end, including RTL failsafe behavior.",
            status=Test.Status.COMPLETED,
            configuration="Full production airframe, Pixhawk 6X, mission plan v3.",
            procedure="Flew a 6-waypoint autonomous mission at 60m AGL.",
            results="Mission completed; one automatic RTL triggered by a brief GPS lock loss (see linked failure report).",
            pass_fail=Test.PassFail.PARTIAL,
            conclusion="Mission logic performed correctly; GPS antenna placement needs investigation before the next flight.",
            tag_names=["flight-ready"],
        )
        self._link(actor=head, source_type="test", source=flight_test, target_type="failure", target=gps_failure)
        self._link(actor=mentor, source_type="failure", source=battery_failure, target_type="sop", target=battery_sop)

        rules_doc = services.create_document(
            actor=head,
            title="2027 Competition Rules",
            description="Official rulebook for this season's competition.",
            doc_type=Document.DocType.REGULATION,
            source=Document.Source.EXTERNAL,
            external_organization="Competition Organizing Committee",
            publication_date=today - datetime.timedelta(days=120),
            url="https://example.org/2027-rules.pdf",
            category=testing_cat,
        )
        datasheet_doc = services.create_document(
            actor=mentor,
            title="Pixhawk 6X Datasheet",
            description="Manufacturer datasheet for the primary flight controller.",
            doc_type=Document.DocType.DATASHEET,
            source=Document.Source.EXTERNAL,
            external_organization="Holybro",
            url="https://example.org/pixhawk-6x-datasheet.pdf",
            category=avionics_cat,
        )

        # --- Articles - each mentions real seeded items inline, and each
        # mention is backed by a real KnowledgeRelation (not just a link). ---

        overview_article = services.create_article(
            actor=member,
            title="Avionics Systems Overview",
            excerpt="A tour of the flight-critical electronics on the Falcon platform.",
            content=(
                "## Overview\n\n"
                f"The {self._mention('project', falcon.pk, falcon.name)} avionics stack is built around the "
                f"{self._mention('component', flight_controller.pk, flight_controller.name)}, which handles "
                "stabilization, navigation, and telemetry.\n\n"
                "## Reference\n\n"
                f"See the {self._mention('document', datasheet_doc.pk, datasheet_doc.title)} for full specifications.\n"
            ),
            category=avionics_cat,
            tag_names=["avionics"],
        )
        services.publish_article(actor=member, article=overview_article)
        self._link(actor=member, source_type="article", source=overview_article, target_type="project", target=falcon)
        self._link(
            actor=member,
            source_type="article",
            source=overview_article,
            target_type="component",
            target=flight_controller,
        )
        self._link(
            actor=member, source_type="article", source=overview_article, target_type="document", target=datasheet_doc
        )

        safety_article = services.create_article(
            actor=mentor,
            title="Battery Safety Best Practices",
            excerpt="Why we changed our charging procedure, and what to do differently.",
            content=(
                "## What happened\n\n"
                f"We had a real incident: {self._mention('failure', battery_failure.pk, battery_failure.title)}. "
                "Nobody was hurt, but it easily could have gone worse.\n\n"
                "## What changed\n\n"
                f"Every pack now follows {self._mention('sop', battery_sop.pk, battery_sop.title)} without exception - "
                "no unattended charging, full stop.\n"
            ),
            category=propulsion_cat,
            tag_names=["safety-critical"],
        )
        services.publish_article(actor=mentor, article=safety_article)
        self._link(
            actor=mentor, source_type="article", source=safety_article, target_type="failure", target=battery_failure
        )
        self._link(actor=mentor, source_type="article", source=safety_article, target_type="sop", target=battery_sop)

        flight_test_article = services.create_article(
            actor=head,
            title="Getting Started with Flight Testing",
            excerpt="What a new member should know before their first flight test.",
            content=(
                "## Before you fly\n\n"
                f"Read the {self._mention('sop', preflight_sop.pk, preflight_sop.title)} - every item on it exists "
                "because of a real prior incident.\n\n"
                "## Example test\n\n"
                f"See {self._mention('test', flight_test.pk, flight_test.title)} on "
                f"{self._mention('project', falcon.pk, falcon.name)} for what a completed test record looks like.\n"
            ),
            category=testing_cat,
        )
        services.publish_article(actor=head, article=flight_test_article)
        self._link(actor=head, source_type="article", source=flight_test_article, target_type="sop", target=preflight_sop)
        self._link(actor=head, source_type="article", source=flight_test_article, target_type="test", target=flight_test)
        self._link(actor=head, source_type="article", source=flight_test_article, target_type="project", target=falcon)

        restricted_article = services.create_article(
            actor=head,
            title="Board Meeting Notes - Budget",
            excerpt="Internal notes - restricted to people explicitly granted access.",
            content="## Budget\n\nInternal financial discussion - not for general distribution.\n",
            visibility=Visibility.RESTRICTED,
        )
        services.publish_article(actor=head, article=restricted_article)
        services.add_restricted_access(
            actor=head, content_type="article", object_id=restricted_article.pk, user_id=member.id
        )

        # --- Questions & answers - same mention pattern. ---

        battery_question = services.create_question(
            actor=member,
            title="Why did our battery overheat during the last ground test?",
            body=(
                f"We had {self._mention('failure', battery_failure.pk, battery_failure.title)} last week. "
                "Is there a checklist so this doesn't happen again?"
            ),
        )
        self._link(
            actor=member, source_type="question", source=battery_question, target_type="failure", target=battery_failure
        )
        battery_answer = services.create_answer(
            question=battery_question,
            actor=mentor,
            body=(
                f"Yes - see {self._mention('sop', battery_sop.pk, battery_sop.title)}. The short version: never leave "
                "a pack charging unattended, and always charge in a fireproof bag."
            ),
        )
        self._link(
            actor=mentor, source_type="question", source=battery_question, target_type="sop", target=battery_sop
        )

        motor_question = services.create_question(
            actor=member,
            title="What KV rating do we need for the new motor?",
            body=(
                f"Looking at replacing the {self._mention('component', motor.pk, motor.name)} - what should I keep in "
                "mind when comparing alternatives?"
            ),
        )
        self._link(
            actor=member, source_type="question", source=motor_question, target_type="component", target=motor
        )
        services.create_answer(
            question=motor_question,
            actor=mentor,
            body=(
                f"Match the KV to your prop pitch/diameter and battery cell count - see "
                f"{self._mention('test', thrust_test.pk, thrust_test.title)} for how we validated the current one."
            ),
        )
        self._link(
            actor=mentor, source_type="question", source=motor_question, target_type="test", target=thrust_test
        )

        # --- A few bookmarks, so /bookmarks isn't empty either. ---
        services.create_bookmark(actor=member, content_type="component", object_id=flight_controller.pk)
        services.create_bookmark(actor=member, content_type="article", object_id=safety_article.pk)
        services.create_bookmark(actor=mentor, content_type="sop", object_id=preflight_sop.pk)

        self.stdout.write(
            self.style.SUCCESS(
                f"\nSeeded demo content in '{organization.slug}'. Demo logins (password '{DEMO_PASSWORD}'):\n"
                f"  member1@demo.local -> Member\n"
                f"  mentor1@demo.local -> Mentor\n"
                f"  head1@demo.local   -> Subteam Head\n"
            )
        )
