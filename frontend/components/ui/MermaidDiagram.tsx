"use client";

import { useEffect, useId, useState } from "react";

import { useTheme } from "@/lib/theme/ThemeProvider";

interface MermaidDiagramProps {
  code: string;
}

interface RenderResult {
  key: string;
  svg?: string;
  error?: string;
}

// Renders a ```mermaid fenced code block as an actual diagram - see
// Markdown.tsx's CodeBlock, which delegates here instead of the normal
// code-box UI whenever the fence's language is "mermaid". mermaid.render()
// needs a live DOM (it measures text to lay out the diagram), so this can
// only run client-side, in an effect, never during the render pass itself -
// and mermaid is dynamically imported so its ~600KB doesn't load for every
// article, only ones that actually use a diagram.
export function MermaidDiagram({ code }: MermaidDiagramProps) {
  // React's useId() includes colons, which aren't safe in the id mermaid.render()
  // hands to document.getElementById() internally.
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const { resolvedTheme } = useTheme();
  const key = `${resolvedTheme}:${code}`;

  // Keyed by (theme, code) rather than reset with a plain setSvg(null) at
  // the top of the effect below - resetting stale state that way runs
  // setState synchronously in the effect body (a cascading-render footgun
  // React's own lint rule flags); comparing keys at render time instead
  // means the only setState call is the one already inside the async
  // .then(), which is the pattern the rule wants.
  const [result, setResult] = useState<RenderResult | null>(null);
  const current = result?.key === key ? result : null;

  useEffect(() => {
    let cancelled = false;

    import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        // Matches ThemeProvider's resolvedTheme (system preference already
        // resolved to light/dark), not the app's CSS-variable palette - mermaid
        // ships its own fixed theme presets, it can't read our custom properties.
        theme: resolvedTheme === "dark" ? "dark" : "default",
        securityLevel: "strict",
      });
      try {
        const { svg } = await mermaid.render(`mermaid-${id}`, code);
        if (!cancelled) setResult({ key, svg });
      } catch (err) {
        if (!cancelled) setResult({ key, error: err instanceof Error ? err.message : String(err) });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [code, id, key, resolvedTheme]);

  if (current?.error) {
    // Falls back to showing the raw source (not just the error) so a typo
    // in the diagram doesn't make the author's content disappear entirely.
    return (
      <div className="rounded-xl border border-error bg-error-container p-4 mb-4 space-y-2">
        <p className="font-body-md text-body-md text-on-error-container" role="alert">
          {current.error}
        </p>
        <pre className="font-mono-sm text-mono-sm text-on-error-container overflow-x-auto">{code}</pre>
      </div>
    );
  }

  if (!current?.svg) {
    return <div className="animate-pulse bg-surface-variant rounded-xl h-48 mb-4" />;
  }

  return <div className="mb-4 overflow-x-auto [&_svg]:mx-auto" dangerouslySetInnerHTML={{ __html: current.svg }} />;
}
