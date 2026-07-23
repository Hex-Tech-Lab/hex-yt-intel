
import type { WorkflowScope } from '@/lib/types/workflow';
import * as Sentry from '@sentry/nextjs';

export interface WorkflowContext {
  scope: WorkflowScope;
  traceId: string;
  startTime: number;
}

export type WorkflowResult<T> =
  | { success: true; data: T; context: WorkflowContext }
  | { success: false; error: string; code: string; status: number; context: WorkflowContext };

function handleWorkflowError(error: unknown, context: WorkflowContext): { success: false; error: string; code: string; status: number; context: WorkflowContext } {
  const message = error instanceof Error ? error.message : String(error);
  Sentry.captureException(error, {
    tags: { workflow: context.scope, traceId: context.traceId },
  });
  return { success: false, error: message, code: 'ERR_INTERNAL', status: 500, context };
}


export class WorkflowConductor {

  /**
   * Execute a handler within a named room. Creates a WorkflowContext with
   * trace ID and timing, wraps the handler in try/catch with Sentry flush
   * on error, and returns a typed WorkflowResult.
   */
  async routeToRoom<T>(
    room: WorkflowScope,
    handler: (context: WorkflowContext) => Promise<T>
  ): Promise<WorkflowResult<T>> {
    const context: WorkflowContext = {
      scope: room,
      traceId: crypto.randomUUID(),
      startTime: Date.now(),
    };

    try {
      const data = await handler(context);
      return { success: true, data, context };
    } catch (error) {
      await Sentry.flush(2000).catch(() => {});
      return handleWorkflowError(error, context);
    }
  }
}