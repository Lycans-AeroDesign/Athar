import { describe, expect, it } from "vitest";

import { getGoogleDriveEmbedUrl, getVideoEmbedUrl, getYoutubeEmbedUrl } from "./video";

describe("getYoutubeEmbedUrl", () => {
  it("extracts the video id from a watch URL", () => {
    expect(getYoutubeEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    );
  });

  it("extracts the video id from a watch URL with extra query params", () => {
    expect(getYoutubeEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    );
  });

  it("extracts the video id from a youtu.be short link", () => {
    expect(getYoutubeEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("extracts the video id from an already-embed URL", () => {
    expect(getYoutubeEmbedUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    );
  });

  it("extracts the video id from a shorts URL", () => {
    expect(getYoutubeEmbedUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    );
  });

  it("returns null for a non-YouTube URL", () => {
    expect(getYoutubeEmbedUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("returns null for a YouTube channel/homepage URL with no video id", () => {
    expect(getYoutubeEmbedUrl("https://www.youtube.com/@somechannel")).toBeNull();
  });

  it("returns null for an unparseable string", () => {
    expect(getYoutubeEmbedUrl("not a url")).toBeNull();
  });
});

describe("getGoogleDriveEmbedUrl", () => {
  it("extracts the file id from a view URL", () => {
    expect(getGoogleDriveEmbedUrl("https://drive.google.com/file/d/1abcDEF23/view")).toBe(
      "https://drive.google.com/file/d/1abcDEF23/preview",
    );
  });

  it("returns null for a non-Drive URL", () => {
    expect(getGoogleDriveEmbedUrl("https://example.com/file/d/1abcDEF23/view")).toBeNull();
  });
});

describe("getVideoEmbedUrl", () => {
  it("prefers a YouTube match", () => {
    expect(getVideoEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("falls back to a Google Drive match", () => {
    expect(getVideoEmbedUrl("https://drive.google.com/file/d/1abcDEF23/preview")).toBe(
      "https://drive.google.com/file/d/1abcDEF23/preview",
    );
  });

  it("returns null for a plain website link", () => {
    expect(getVideoEmbedUrl("https://github.com/lycans/athar")).toBeNull();
  });
});
