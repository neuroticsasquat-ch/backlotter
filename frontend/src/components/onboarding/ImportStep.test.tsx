import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/AuthContext";
import { env } from "@/env";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { importJobHandlers, importUploadFailure } from "@/test/msw/imports";
import { ImportStep } from "./ImportStep";

function renderStep(overrides: Partial<Parameters<typeof ImportStep>[0]> = {}) {
  const props = {
    job: null,
    onStarted: vi.fn(),
    onContinue: vi.fn(),
    onSkip: vi.fn(),
    ...overrides,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <ImportStep {...props} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return props;
}

const fileInput = () => screen.getByLabelText(/letterboxd export file/i) as HTMLInputElement;

/** A drop onto the dashed target. `fireEvent` rather than `userEvent`, which has no drag-drop
 *  gesture: what matters here is the `dataTransfer.files` the handler reads. */
const drop = (file: File) =>
  fireEvent.drop(screen.getByText(/drop your letterboxd export here/i).parentElement!, {
    dataTransfer: { files: [file] },
  });

const exportZip = (name = "letterboxd-export.zip", size = 1024) => {
  const file = new File(["x"], name, { type: "application/zip" });
  // `File` has no writable size, and building a multi-megabyte buffer to test the cap would
  // make the suite allocate 5 MB to assert on a comparison.
  Object.defineProperty(file, "size", { value: size });
  return file;
};

describe("ImportStep", () => {
  it("uploads the chosen file and hands the job id upwards", async () => {
    server.use(meHandler({ entitled: true }), ...importJobHandlers().handlers);
    const { onStarted } = renderStep();

    await userEvent.upload(fileInput(), exportZip());

    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
    expect(onStarted).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333");
  });

  it("accepts a drop as well as a pick", async () => {
    server.use(meHandler({ entitled: true }), ...importJobHandlers().handlers);
    const { onStarted } = renderStep();

    drop(exportZip());

    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
  });

  it("refuses a dropped file that is not a zip or a csv before it costs an upload", async () => {
    server.use(meHandler({ entitled: true }), ...importJobHandlers().handlers);
    const { onStarted } = renderStep();

    // Dropped rather than picked, because a drop is the case the extension check exists for:
    // the picker's own `accept` already filters this out, and a drag target has no `accept`.
    drop(new File(["x"], "diary.pdf", { type: "application/pdf" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/export zip|\.csv/i);
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("refuses a file over the 5 MB cap locally rather than uploading it to be told", async () => {
    server.use(meHandler({ entitled: true }), ...importJobHandlers().handlers);
    const { onStarted } = renderStep();

    await userEvent.upload(fileInput(), exportZip("huge.zip", 6 * 1024 * 1024));

    expect(await screen.findByRole("alert")).toHaveTextContent(/larger than 5 MB/i);
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("explains a 409 as another import still running, not as a failure to retry", async () => {
    server.use(meHandler({ entitled: true }), importUploadFailure(409, "import_in_progress"));
    renderStep();

    await userEvent.upload(fileInput(), exportZip());

    expect(await screen.findByRole("alert")).toHaveTextContent(/still running/i);
  });

  it("turns the 422 identifier into something the uploader can act on", async () => {
    server.use(meHandler({ entitled: true }), importUploadFailure(422, "invalid_import_file"));
    renderStep();

    await userEvent.upload(fileInput(), exportZip());

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not read that file/i);
  });

  it("does not print the rate limiter's identifier at the user", async () => {
    server.use(meHandler({ entitled: true }), importUploadFailure(429, "rate_limited"));
    renderStep();

    await userEvent.upload(fileInput(), exportZip());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/try again in an hour/i);
    expect(alert).not.toHaveTextContent("rate_limited");
  });

  it("offers the TMDB approve flow as a live link (NEU-1359)", () => {
    server.use(meHandler({ entitled: true }));
    renderStep();

    // The panel's own behaviour is covered in `TmdbConnect.test.tsx`; what this step owes is
    // that it is mounted and no longer the disabled placeholder it shipped as.
    expect(screen.getByRole("link", { name: /connect tmdb/i })).toHaveAttribute(
      "href",
      `${env.apiBaseUrl}/me/import/tmdb/start`,
    );
  });

  it("skips and continues to the same place — the step is optional either way (D-17)", async () => {
    server.use(meHandler({ entitled: true }));
    const { onSkip, onContinue } = renderStep();

    await userEvent.click(screen.getByRole("button", { name: /skip this step/i }));
    expect(onSkip).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
