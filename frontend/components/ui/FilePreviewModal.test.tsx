import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FilePreviewModal } from "./FilePreviewModal";
import type { StoredFile } from "@/lib/api/types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const apiFetchMock = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiFetch: (path: string) => apiFetchMock(path),
}));

describe("FilePreviewModal", () => {
  it("forces the blob MIME type to the stored file content_type", async () => {
    const file: StoredFile = {
      id: "f1",
      original_filename: "spec.pdf",
      content_type: "application/pdf",
      size: 123,
      uploaded_by: "u1",
      required_permission: "file.read",
      download_url: "/api/v1/files/f1/download/",
      created_at: "2026-01-01T00:00:00Z",
    };

    apiFetchMock.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["fake"], { type: "application/octet-stream" })),
    });

    const createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const { unmount } = render(<FilePreviewModal open onOpenChange={() => {}} file={file} />);

    await waitFor(() => expect(createObjectURLSpy).toHaveBeenCalledTimes(1));

    const createdBlob = createObjectURLSpy.mock.calls[0]?.[0];
    expect(createdBlob).toBeInstanceOf(Blob);
    expect((createdBlob as Blob).type).toBe("application/pdf");

    unmount();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock-url");
  });
});
