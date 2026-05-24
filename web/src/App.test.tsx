import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { App } from "@/App";

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("App", () => {
  it("renders the health probe result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "ok",
            db: { connected: true },
            version: "0.1.0",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    renderWithClient(<App />);

    await waitFor(() => {
      expect(screen.getByText("connected")).toBeInTheDocument();
    });
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
  });
});
