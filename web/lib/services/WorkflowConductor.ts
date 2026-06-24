import type { CreateAnalysisUseCase, CreateAnalysisUseCaseParams, UseCaseResult } from '@/lib/usecases/CreateAnalysisUseCase';
import { PathAInputSchema, PathBInputSchema, type WorkflowScope } from '@/lib/types/workflow';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

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

function validationFailure(parsed: { error: { issues: Array<{ message: string }> } }, context: WorkflowContext): { success: false; error: string; code: string; status: number; context: WorkflowContext } {
  return {
    success: false,
    error: parsed.error.issues.map((e: { message: string }) => e.message).join('; '),
    code: 'ERR_VALIDATION_FAILED',
    status: 400,
    context,
  };
}

export class WorkflowConductor {
  private useCase: CreateAnalysisUseCase;

  constructor(useCase: CreateAnalysisUseCase) {
    this.useCase = useCase;
  }

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

  async executeSingleVideo(params: CreateAnalysisUseCaseParams): Promise<WorkflowResult<UseCaseResult>> {
    const context: WorkflowContext = {
      scope: 'single_video',
      traceId: crypto.randomUUID(),
      startTime: Date.now(),
    };

    const parsed = PathAInputSchema.safeParse({
      ...params,
      url: params.url,
    });
    if (!parsed.success) return validationFailure(parsed, context);

    try {
      const result = await this.useCase.execute(parsed.data as CreateAnalysisUseCaseParams);
      return { success: true, data: result, context };
    } catch (error) {
      await Sentry.flush(2000).catch(() => {});
      return handleWorkflowError(error, context);
    }
  }

  async executeCrossAnalysis(params: z.infer<typeof PathBInputSchema>): Promise<WorkflowResult<unknown>> {
    const context: WorkflowContext = {
      scope: 'cross_analysis',
      traceId: crypto.randomUUID(),
      startTime: Date.now(),
    };

    const parsed = PathBInputSchema.safeParse(params);
    if (!parsed.success) return validationFailure(parsed, context);

    try {
      const { SupabasePersistenceAdapter } = await import('@/lib/adapters');
      const persistence = new SupabasePersistenceAdapter();
      const analyses = await persistence.getAnalysesByTenant(parsed.data.userId);

      const knowledgeBase = analyses.map(a => ({
        analysisId: a.id,
        title: a.title,
        nodes: a.nodes,
        edges: a.edges,
      }));

      return { success: true, data: { scope: 'global', knowledgeBase }, context };
    } catch (error) {
      await Sentry.flush(2000).catch(() => {});
      return handleWorkflowError(error, context);
    }
  }
}