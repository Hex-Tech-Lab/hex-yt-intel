import * as Sentry from '@sentry/nextjs';
/**
 * Re-exported so existing call sites (`import { showToast } from
 * '@/lib/dashboard/export'`) keep working unchanged. Real implementation
 * now fires an Astryx `Toast` via the imperative bridge in
 * `@/lib/dashboard/toast-bridge` instead of hand-rolled DOM manipulation --
 * see that module for why an imperative bridge is needed for a function
 * called from plain (non-component) code.
 */
import { showToast } from './toast-bridge';
import type { KnowledgeGraph } from '@/lib/types/knowledge-graph';
import type { RelationInsight } from '@/lib/types/knowledge-graph';

export { showToast };

export type PanelId = 'insights' | 'knowledge-graph' | 'word-cloud' | 'mind-map';

export function reportClipboardError(error: unknown, context: string) {
  const message = error instanceof Error ? error.message : String(error);
  Sentry.captureException(error, { contexts: { clipboard: { context } } });
  console.error('[DashboardContainer] Clipboard copy failed:', { message, context });
}

/**
 * Copies the given right-panel's content to the clipboard as plain text and
 * surfaces a success/error toast. Falls back to download if clipboard API unavailable.
 * Mirrors the panel-specific text formats previously inlined in DashboardContainer's `handleCopy`.
 */
export function copyPanelContent(
  id: PanelId,
  { graph, insights }: { graph: KnowledgeGraph; insights: RelationInsight[] },
) {
  try {
    const getTextForPanel = () => {
      switch (id) {
        case 'insights':
          return insights.map((ins) => `${ins.sourceLabel} -[${ins.kind}]-> ${ins.targetLabel}: ${ins.rationale || ''}`).join('\n');
        case 'knowledge-graph':
          return graph.nodes.map((n) => `${n.label} (${n.entityType || 'concept'})`).join('\n');
        case 'word-cloud':
          return graph.nodes.map((n) => n.label).join(', ');
        case 'mind-map':
          return graph.nodes.map((n) => `- ${n.label}`).join('\n');
        default:
          return '';
      }
    };

    const text = getTextForPanel();
    const successMessage = {
      'insights': 'Insights copied to clipboard!',
      'knowledge-graph': 'Knowledge Graph nodes list copied!',
      'word-cloud': 'Word Cloud text copied!',
      'mind-map': 'Mind Map nodes list copied!',
    }[id];

    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API unavailable in this browser');
    }

    navigator.clipboard.writeText(text)
      .then(() => showToast(successMessage || 'Copied to clipboard!'))
      .catch((err) => {
        reportClipboardError(err, id);
        showToast('Failed to copy. Try downloading instead.', 'error');
      });
  } catch (err) {
    reportClipboardError(err, 'outer');
    showToast('Copy failed. Try downloading instead.', 'error');
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
  try {
    if (id === 'insights') {
      const text = insights.map((ins) => `${ins.sourceLabel} -[${ins.kind}]-> ${ins.targetLabel}: ${ins.rationale || ''}`).join('\n');
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${title || 'analysis'}-insights.txt`;
        anchor.click();
        showToast('Insights exported successfully');
      } finally {
        URL.revokeObjectURL(url);
      }
    } else if (id === 'knowledge-graph') {
      const canvas = document.querySelector('.js-knowledge-graph-container canvas') as HTMLCanvasElement | null;
      if (!canvas) {
        throw new Error('Knowledge graph canvas element not found');
      }
      const url = canvas.toDataURL('image/png');
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${title || 'analysis'}-knowledge-graph.png`;
      anchor.click();
      showToast('Knowledge graph exported successfully');
    } else if (id === 'word-cloud') {
      const canvas = document.querySelector('.js-word-cloud-canvas') as HTMLCanvasElement | null;
      if (!canvas) {
        throw new Error('Word cloud canvas element not found');
      }
      const url = canvas.toDataURL('image/png');
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${title || 'analysis'}-word-cloud.png`;
      anchor.click();
      showToast('Word cloud exported successfully');
    } else if (id === 'mind-map') {
      const svg = document.querySelector('.js-mind-map-container svg') as SVGElement | null;
      if (!svg) {
        throw new Error('Mind map SVG element not found');
      }
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svg);
      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${title || 'analysis'}-mind-map.svg`;
        anchor.click();
        showToast('Mind map exported successfully');
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during export';
    Sentry.captureException(err, { contexts: { export: { panelId: id, title } } });
    console.error('[export] Panel export failed:', { panelId: id, message });
    showToast('Export failed: ' + message, 'error');
  }
}

export interface ChatMessageForExport {
  role: 'user' | 'assistant' | string;
  /** Already stripped of the trailing OPTIONS:[...] chip payload -- pass ChatDock's parseAssistant().body for assistant turns. */
  body: string;
}

/** Formats a chat thread as a markdown document: `## User` / `## Assistant` per turn. */
export function chatToMarkdown(messages: ChatMessageForExport[], title?: string | null): string {
  const header = `# ${title || 'Chat conversation'}\n`;
  const turns: string[] = [];
  for (const itemMsg of messages) {
    const trimmedBody = itemMsg.body.trim();
    if (trimmedBody.length > 0) {
      turns.push(`## ${itemMsg.role === 'user' ? 'User' : 'Assistant'}\n\n${trimmedBody}`);
    }
  }
  return [header, ...turns].join('\n\n');
}

/** Copies the full chat thread to the clipboard as markdown. */
export async function copyChatAsMarkdown(messages: ChatMessageForExport[], title?: string | null): Promise<void> {
  try {
    await navigator.clipboard.writeText(chatToMarkdown(messages, title));
    showToast('Chat copied to clipboard!');
  } catch (err) {
    reportClipboardError(err, 'chat-copy-all');
    showToast('Failed to copy chat.', 'error');
  }
}

/** Downloads the full chat thread as a .md file. */
export function exportChatAsMarkdown(messages: ChatMessageForExport[], title?: string | null): void {
  try {
    const blob = new Blob([chatToMarkdown(messages, title)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${title || 'chat'}.md`;
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during export';
    Sentry.captureException(err, { contexts: { export: { context: 'chat-markdown', title } } });
    console.error('[export] Chat markdown export failed:', { message });
    showToast('Export failed: ' + message, 'error');
  }
}
