import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Avatar } from "./Avatar";
import type { KnowledgeAuthor } from "@/lib/api/types";

// AuthenticatedImage does its own apiFetch/blob-URL dance (see
// AuthenticatedImage.tsx) - irrelevant to what Avatar itself decides to
// render, so it's stubbed down to something that proves it was reached.
vi.mock("./AuthenticatedImage", () => ({
  AuthenticatedImage: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- test stub, not a real rendered image.
    <img data-testid="authenticated-image" src={src} alt={alt} />
  ),
}));

const basePerson: KnowledgeAuthor = {
  id: "1",
  first_name: "Ahmad",
  last_name: "Wael",
  email: "ahmad@example.com",
  title: "",
  username: null,
  profile_picture: null,
};

describe("Avatar", () => {
  it("renders initials when the person has no profile_picture", () => {
    render(<Avatar person={basePerson} />);
    expect(screen.getByText("AW")).toBeInTheDocument();
    expect(screen.queryByTestId("authenticated-image")).not.toBeInTheDocument();
  });

  it("renders AuthenticatedImage when the person has a profile_picture", () => {
    const person: KnowledgeAuthor = {
      ...basePerson,
      profile_picture: { id: "f1", original_filename: "photo.jpg", download_url: "/api/v1/files/f1/download/" },
    };
    render(<Avatar person={person} />);
    const image = screen.getByTestId("authenticated-image");
    expect(image).toHaveAttribute("src", "/api/v1/files/f1/download/");
  });

  it("falls back to initials for a null/undefined person", () => {
    render(<Avatar person={null} />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });
});
