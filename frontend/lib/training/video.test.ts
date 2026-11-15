import { describe, expect, it } from "vitest";

import {
  detectResourceProvider,
  getGoogleDriveEmbedUrl,
  getSharePointEmbedUrl,
  getVideoEmbedUrl,
  getYoutubeEmbedUrl,
  hostMatches,
} from "./video";

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

describe("hostMatches", () => {
  it("accepts the domain itself and real subdomains", () => {
    expect(hostMatches("https://sharepoint.com/x", ["sharepoint.com"])).toBe(true);
    expect(hostMatches("https://alexuuni-my.sharepoint.com/x", ["sharepoint.com"])).toBe(true);
  });

  it("rejects look-alike hosts and domains hidden in the path or query", () => {
    expect(hostMatches("https://evilsharepoint.com/x", ["sharepoint.com"])).toBe(false);
    expect(hostMatches("https://sharepoint.com.evil.example/x", ["sharepoint.com"])).toBe(false);
    expect(hostMatches("https://evil.example/?u=sharepoint.com", ["sharepoint.com"])).toBe(false);
    expect(hostMatches("not a url", ["sharepoint.com"])).toBe(false);
  });
});

describe("detectResourceProvider", () => {
  it("classifies by host, not by substring", () => {
    expect(detectResourceProvider("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("YOUTUBE");
    expect(detectResourceProvider("https://youtu.be/dQw4w9WgXcQ")).toBe("YOUTUBE");
    expect(detectResourceProvider("https://drive.google.com/file/d/abc/view")).toBe("GOOGLE_DRIVE");
    expect(detectResourceProvider("https://evil.example/?next=youtube.com")).toBe("WEBSITE");
    expect(detectResourceProvider("https://notgithub.com/repo")).toBe("WEBSITE");
  });
});

describe("getSharePointEmbedUrl", () => {
  it("embeds real SharePoint embed links but not look-alike hosts", () => {
    expect(getSharePointEmbedUrl("https://team.sharepoint.com/_layouts/15/embed.aspx?id=1")).toBe(
      "https://team.sharepoint.com/_layouts/15/embed.aspx?id=1",
    );
    expect(getSharePointEmbedUrl("https://evilsharepoint.com/_layouts/15/embed.aspx?id=1")).toBeNull();
  });
});
