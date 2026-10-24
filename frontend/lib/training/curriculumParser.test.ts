import { describe, expect, it } from "vitest";
import { parseCurriculumText } from "./curriculumParser";

describe("parseCurriculumText", () => {
  it("handles empty or blank text", () => {
    expect(parseCurriculumText("").modules).toHaveLength(0);
    expect(parseCurriculumText("   \n  \n").modules).toHaveLength(0);
  });

  it("correctly parses user Fuselage training syllabus into 5 modules and lessons", () => {
    const raw = `Advanced Training Fuselage Advanced Training We'll cover the key aspects of the Fuselage Sub-team and the necessary skills for the role and the tasks. 1. Advanced Features in SolidWorks The following videos include the needed features: • Creating Lofted Parts of The Fuselage First, you need to have the initial dimensions of the fuselage, width, length and height, based on the payload selection and configuration, then use the needed features to generate the lofted fuselage. ➢ 43-using-the-convert-entities-tool-720.mp4 ➢ 5-Edit Sketch Plane.mp4 ➢ 37-creating-offset-geometry-720.mp4 ➢ 40-using-the-mirror-tools-720.mp4  ➢ 1-Planes.mp4 ➢ 57-loft-tool-720.mp4 • Mass Distribution Planes are used to make mass distribution task easier, as the components will be mated to a specific plane. So, when you need to move one or more components, just change the plane position and it will move the related component with it. ➢ 1-Planes.mp4 ➢  29 - Standard mates.mp4 ➢ 13-Smart Mates.mp4 ➢ 95-creating-component-mates-720.mp4 ➢ 53 - Add advanced mates to an assembly.mp4 ➢ 99-mating-parts-by-aligning-planes-720 (1).mp4 ➢ 96-mating-parts-with-advanced-mates-720.mp4 • The Overall Mass of the Fuselage Needed to verify the mass of the fuselage with the tail sub team. At first, the tail sub team works with an estimation of the fuselage’s weight. But the fuselage’s mass evaluation after the detailed design is a must. ➢ Custom Material: https://youtu.be/sample12345 (To add new material, Ex: Plywood) ➢ 18-applying-materials-colors-and-finishes-720.mp4 ➢ 19-finding-mass-properties-720.mp4 (Structure weight including vinyl, screws and nuts, No electrical components or payload) 2. Detailed Fuselage Structure  The video contains a sample of the steps of the detailed design of the fuselage structure, with clarification of the steps and the features to be used. >>>>>>>  https://example.com/sharepoint/detailed-fuselage-structure ➢ Mirror parts ➢ Mirror parts in assembly ➢ 68-direct-editing-move-copy-bodies-720.mp4 ➢ 69-Direct Editing- Move Face.mp4 ➢ 70-direct-editing-combine-720.mp4 ➢ 71-direct-editing-split-720.mp4 ➢ Delete/Keep body feature ➢ 53-using-the-shell-command-720.mp4 ➢ 15 - Shell.mp4 ➢ Cavity Feature ➢ 65-working-with-configurations-720.mp4 3. Drawing Packages The necessary technical documents are grouped as the Drawing Package, which contains drawings detailing the overall aircraft configuration (including dimensions), the structural arrangement, the layout and location of all systems, and the specifics of payload integration. ➢ Drawing Introduction ➢ 112-choosing-the-correct-projection-angle-720.mp4 ➢ 113-adding-model-views-to-a-drawing-720.mp4 ➢ 124-adding-assemblies-to-drawings-720.mp4 ➢ 5-Dimensions.mp4 ➢ 6-Associativity.mp4 ➢ 7-Annotations.mp4 ➢ 126-adding-balloons-on-an-assembly-drawing-720.mp4 ➢ 9-Section View.mp4 ➢ 13-Cropped View.mp4 ➢ 8-Detail View.mp4 ➢ 129-detailing-mode-720.mp4 ➢ 127-making-an-exploded-view-720.mp4 ➢ 128-adding-in-custom-properties-and-revision-720.mp4 ➢ 14-Alternate Position View.mp4 ➢ 15-Guided Exercise & Video - Assembly Drawing - Brace.mp4 (It is highly encouraged to view previous reports on AIAA DBF website of other teams to build a good knowledge) 4. Nesting It is the final step after finishing the structure and before manufacturing. It is very important to be able to organize the parts correctly in the plywood sheet. • Optimize the use of the plywood sheet. • Organizing ribs and stringers in what orientation (Pay attention!) ➢ Nesting  5. General Knowledge ➢ Configurations in SolidWorks ➢ SolidWorks Visualize Tutorials     (To get high quality rendered images of the plane)`;

    const result = parseCurriculumText(raw);
    expect(result.modules).toHaveLength(5);
    expect(result.modules[0].title).toContain("1. Advanced Features in SolidWorks");
    expect(result.modules[1].title).toContain("2. Detailed Fuselage Structure");
    expect(result.modules[2].title).toContain("3. Drawing Packages");
    expect(result.modules[3].title).toContain("4. Nesting");
    expect(result.modules[4].title).toContain("5. General Knowledge");

    // Check lessons in module 1
    expect(result.modules[0].lessons.length).toBeGreaterThan(10);
    const videoLessons = result.modules[0].lessons.filter((l) => l.lesson_type === "VIDEO");
    expect(videoLessons.length).toBeGreaterThan(5);

    // Module 2 has mirror parts and .mp4s
    expect(result.modules[1].lessons.length).toBeGreaterThan(5);

    // Module 4 nesting
    expect(result.modules[3].lessons.some((l) => l.title.includes("Nesting"))).toBe(true);
    expect(result.modules[3].description).toContain("final step after finishing");

    // Module 5 general knowledge
    expect(result.modules[4].lessons.some((l) => l.title.includes("Configurations in SolidWorks"))).toBe(true);
    expect(result.modules[4].lessons.some((l) => l.title.includes("SolidWorks Visualize Tutorials"))).toBe(true);
  });
});
