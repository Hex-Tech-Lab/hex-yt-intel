import * as Sentry from '@sentry/nextjs';
import type { KnowledgeGraph } from '@/lib/types/knowledge-graph';
import type { RelationInsight } from '@/lib/types/knowledge-graph';

export type PanelId = 'insights' | 'knowledge-graph' | 'word-cloud' | 'mind-map';

/**
 * Fires a transient, DOM-imperative toast in the bottom-right corner.
 * Not a React component — this is intentionally a direct DOM manipulation
 * (no toast/notification primitive exists elsewhere in the codebase to
 * reuse), matching the original inline implementation in DashboardContainer.
 */
export function showToast(message: string, type: 'success' | 'error' = 'success') {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.textContent = message;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  el.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 18px;border-radius:10px;font:600 12px/1.4 var(--font-mono);pointer-events:none;opacity:0;transition:opacity .2s;color:var(--ink);background:${type === 'error' ? 'rgba(239,68,68,0.9)' : 'rgba(6,182,212,0.9)'};backdrop-filter:blur(8px);`;
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2000);
}

export function reportClipboardError(error: unknown, context: string) {
  const message = error instanceof Error ? error.message : String(error);
  Sentry.captureException(error, { contexts: { clipboard: { context } } });
  console.error('[DashboardContainer] Clipboard copy failed:', { message, context });
}

/**
 * Copies the given right-panel's content to the clipboard as plain text and
 * surfaces a success/error toast. Mirrors the panel-specific text formats
 * previously inlined in DashboardContainer's `handleCopy`.
 */
export function copyPanelContent(
  id: PanelId,
  { graph, insights }: { graph: KnowledgeGraph; insights: RelationInsight[] },
) {
  try {
    if (id === 'insights') {
      const text = insights.map((ins) => `${ins.sourceLabel} -[${ins.kind}]-> ${ins.targetLabel}: ${ins.rationale || ''}`).join('\n');
      navigator.clipboard.writeText(text).then(() => showToast('Insights copied to clipboard!')).catch((err) => reportClipboardError(err, 'insights'));
    } else if (id === 'knowledge-graph') {
      const text = graph.nodes.map((n) => `${n.label} (${n.entityType || 'concept'})`).join('\n');
      navigator.clipboard.writeText(text).then(() => showToast('Knowledge Graph nodes list copied!')).catch((err) => reportClipboardError(err, 'knowledge-graph'));
    } else if (id === 'word-cloud') {
      const text = graph.nodes.map((n) => n.label).join(', ');
      navigator.clipboard.writeText(text).then(() => showToast('Word Cloud text copied!')).catch((err) => reportClipboardError(err, 'word-cloud'));
    } else if (id === 'mind-map') {
      const text = graph.nodes.map((n) => `- ${n.label}`).join('\n');
      navigator.clipboard.writeText(text).then(() => showToast('Mind Map nodes list copied!')).catch((err) => reportClipboardError(err, 'mind-map'));
    }
  } catch (err) {
    reportClipboardError(err, 'outer');
    showToast('Copy failed', 'error');
  }
}

/**
 * Exports the given right-panel's content as a downloaded file (txt/png/svg
 * depending on panel). Mirrors the panel-specific export logic previously
 * inlined in DashboardContainer's `handlePanelExport`.
 */
export function exportPanelContent(
  id: PanelId,
  { insights, title }: { insights: RelationInsight[]; title?: string | null },
) {
  if (id === 'insights') {
    const text = insights.map((ins) => `${ins.sourceLabel} -[${ins.kind}]-> ${ins.targetLabel}: ${ins.rationale || ''}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${title || 'analysis'}-insights.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  } else if (id === 'knowledge-graph') {
    const canvas = document.querySelector('.js-knowledge-graph-container canvas') as HTMLCanvasElement;
    if (canvas) {
      const url = canvas.toDataURL('image/png');
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${title || 'analysis'}-knowledge-graph.png`;
      anchor.click();
    } else {
      showToast('Could not locate canvas element to export.', 'error');
    }
  } else if (id === 'word-cloud') {
    const canvas = document.querySelector('.js-word-cloud-canvas') as HTMLCanvasElement;
    if (canvas) {
      const url = canvas.toDataURL('image/png');
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${title || 'analysis'}-word-cloud.png`;
      anchor.click();
    } else {
      showToast('Could not locate canvas element to export.', 'error');
    }
  } else if (id === 'mind-map') {
    const svg = document.querySelector('.js-mind-map-container svg') as SVGElement;
    if (svg) {
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svg);
      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${title || 'analysis'}-mind-map.svg`;
      anchor.click();
      URL.revokeObjectURL(url);
    } else {
      showToast('Could not locate SVG element to export.', 'error');
    }
  }
}
