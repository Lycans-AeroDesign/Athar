import type { ImportCurriculumModule } from "@/lib/api/training";
import type { LessonType } from "@/lib/api/types";

const VIDEO_PATTERN = /(\.mp4|\.mov|\.webm|\.mkv|youtu\.be|youtube\.com|vimeo\.com|\bvideo\b|\/:v:\/)/i;
const DOCUMENT_PATTERN = /(\.pdf|\.docx?|\.xlsx?|\.pptx?)/i;
const EXERCISE_PATTERN = /(\bexercise\b|\bguided exercise\b|\bassignment\b|\bquiz\b|\btask\b|\bpractice\b)/i;
const URL_PATTERN = /https?:\/\/[^\s)]+/g;

function detectLessonType(text: string): LessonType {
  if (VIDEO_PATTERN.test(text)) return "VIDEO";
  if (EXERCISE_PATTERN.test(text)) return "EXERCISE";
  if (DOCUMENT_PATTERN.test(text)) return "DOCUMENT";
  if (/https?:\/\//i.test(text)) return "EXTERNAL";
  return "TEXT";
}

function cleanTitle(title: string): string {
  return title
    .replace(/^([➢•\-\*\+]\s*|\d+(\.\d+)*[\.\)]\s*)+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCurriculumText(rawText: string): {
  courseTitle?: string;
  courseDescription?: string;
  modules: ImportCurriculumModule[];
} {
  if (!rawText.trim()) {
    return { modules: [] };
  }

  // Normalize numbered modules and bullet points so each starts on its own line
  const normalized = rawText
    .replace(/\r\n/g, "\n")
    .replace(/(^|\s)(\d+[\.\)]\s+[A-Z])/g, "$1\n$2")
    .replace(/([^\n])([➢•])/g, "$1\n$2")
    .replace(/(>>>>>>>\s*https?:\/\/[^\s]+)/g, "\n$1\n");

  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);

  const modules: ImportCurriculumModule[] = [];
  let currentModule: ImportCurriculumModule | null = null;
  let currentLesson: ImportCurriculumModule["lessons"][0] | null = null;
  const preModuleLines: string[] = [];

  const isModuleHeading = (line: string): boolean => {
    // Matches "1. Title", "1) Title", "Chapter 1", "Module 1", "## Title"
    return (
      /^(\d+[\.\)]\s+[^a-z0-9]*[A-Z0-9].*)/.test(line) ||
      /^(chapter|module|part)\s+\d+[:\.\-]?\s*.+/i.test(line) ||
      /^#{1,3}\s+.+/.test(line)
    );
  };

  const isBullet = (line: string): boolean => {
    return /^[➢•\-\*\+]\s+/.test(line) || /^➢|•/.test(line);
  };

  for (const line of lines) {
    if (isModuleHeading(line)) {
      currentLesson = null;
      let title = line.replace(/^#{1,3}\s+/, "").trim();
      let description = "";

      // If the heading line contains a short title followed by sentence description (e.g. "4. Nesting It is the final step...")
      const splitMatch = title.match(/^(\d+[\.\)]\s+[\w\s]{2,30}?)(?:[\.\:\-]\s*|\s{2,}|\s+(?=[A-Z][a-z]+\s+(?:is|are|contains|covers|focuses)\b))(.*)$/i);
      if (splitMatch && splitMatch[2].trim()) {
        title = splitMatch[1].trim();
        description = splitMatch[2].trim();
      }

      currentModule = {
        title,
        description,
        lessons: [],
      };
      modules.push(currentModule);
      continue;
    }

    if (!currentModule) {
      preModuleLines.push(line);
      continue;
    }

    if (isBullet(line)) {
      // Start a new lesson under the current module
      let lineText = line;
      const mdMatch = line.match(/^([➢•\-\*\+]\s*)?\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/);
      let mdUrl: string | null = null;
      if (mdMatch) {
        lineText = (mdMatch[1] || "➢ ") + mdMatch[2];
        mdUrl = mdMatch[3];
      }

      const urls = line.match(URL_PATTERN);
      const textWithoutUrls = lineText.replace(URL_PATTERN, "").replace(/[:\-\–\—\s]+$/, "");
      let rawTitle = cleanTitle(textWithoutUrls || lineText);
      if (!rawTitle) continue;

      let shortDesc = "";
      // If a bullet is long (e.g. title + sentence explanation on the same line)
      if (rawTitle.length > 50) {
        const splitMatch = rawTitle.match(
          /^([\w\s\-\/\(\)]{3,50}?)(?:[\.\:\-]\s*|\s{2,}|\s+(?=[A-Z][a-z]+\s+(?:is|are|contains|covers|need|needed|must|works|you|first)\b))(.*)$/i,
        );
        if (splitMatch && splitMatch[2].trim()) {
          rawTitle = splitMatch[1].trim();
          shortDesc = splitMatch[2].trim();
        }
      }

      const lessonType = detectLessonType(line);
      const primaryUrl = mdUrl || (urls && urls.length > 0 ? urls[0] : undefined);
      const lessonContent = mdUrl ? "" : urls && urls.length > 0 ? "" : "";

      currentLesson = {
        title: rawTitle.slice(0, 180).trim(),
        lesson_type: lessonType,
        short_description: shortDesc.slice(0, 280).trim(),
        content: lessonContent,
        primary_url: primaryUrl,
        is_required: true,
      };
      currentModule.lessons.push(currentLesson);
    } else {
      // Subtitle, note, or standalone URL line
      if (currentLesson) {
        const lineUrls = line.match(URL_PATTERN);
        if (lineUrls && lineUrls.length > 0) {
          const url = lineUrls[0];
          if (!currentLesson.primary_url) {
            currentLesson.primary_url = url;
          }
          if (currentLesson.lesson_type === "TEXT") {
            currentLesson.lesson_type = detectLessonType(line);
          }
          const nonUrlText = line.replace(URL_PATTERN, "").replace(/[()\[\]:–—-]+/g, " ").trim();
          if (nonUrlText) {
            const combined = currentLesson.short_description
              ? `${currentLesson.short_description} ${nonUrlText}`
              : nonUrlText;
            currentLesson.short_description = combined.slice(0, 280);
          }
        } else {
          // Regular text description / note
          const combined = currentLesson.short_description
            ? `${currentLesson.short_description} ${line}`
            : line;
          if (combined.length <= 280) {
            currentLesson.short_description = combined;
          } else {
            currentLesson.short_description = combined.slice(0, 280);
            const remainder = combined.slice(280);
            currentLesson.content = currentLesson.content
              ? `${currentLesson.content}\n${remainder}`
              : remainder;
          }
        }
      } else if (currentModule) {
        if (currentModule.description) {
          currentModule.description += "\n" + line;
        } else {
          currentModule.description = line;
        }
      }
    }
  }

  // If no module headings were found but lines exist, wrap them in a single default module
  if (modules.length === 0 && lines.length > 0) {
    const singleModule: ImportCurriculumModule = {
      title: "Module 1",
      description: "",
      lessons: [],
    };
    for (const line of lines) {
      if (isBullet(line)) {
        singleModule.lessons.push({
          title: cleanTitle(line),
          lesson_type: detectLessonType(line),
          is_required: true,
        });
      }
    }
    if (singleModule.lessons.length > 0) {
      modules.push(singleModule);
    }
  }

  return {
    courseTitle: preModuleLines.length > 0 ? preModuleLines[0] : undefined,
    courseDescription: preModuleLines.slice(1).join("\n"),
    modules,
  };
}
