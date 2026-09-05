import { SourceGraph } from "../domain/SourceGraph";
import type { Finding } from "../domain/Finding";
import type { Rule } from "../domain/Rule";
import type { RuleError } from "../domain/RuleError";
import type { CachePort } from "./ports/CachePort";
import type { FileLoaderPort } from "./ports/FileLoaderPort";
import type { FileSystemPort } from "./ports/FileSystemPort";
import { SourceRegistry } from "./SourceRegistry";
import type { EngineConfig } from "./EngineConfig";

export class QualityEngine {
  private registry = new SourceRegistry();
  ruleErrors: RuleError[] = [];

  constructor(
    private readonly rules: Rule[],
    private readonly loader: FileLoaderPort,
    private readonly cache: CachePort | undefined,
    private readonly fs: FileSystemPort,
    private readonly config: EngineConfig
  ) {}

  async analyze(files: string[]): Promise<Finding[]> {
    this.ruleErrors = [];
    const existing = files.filter((f) => this.fs.exists(f));

    // GRAPH CONSTRUCTION: buildGraph() parses imports and constructs the overall dependency graph
    const needsGraph = this.rules.some(r => r.scope === "graph" || r.scope === "neighbors" || this.config.defaultScope === "graph" || this.config.defaultScope === "neighbors");
    const graph = needsGraph ? await this.buildGraph(existing) : new SourceGraph();

    const findings: Finding[] = [];
    const concurrency = this.config.concurrency ?? 3;

    // Filter file queue to suppress self-analysis false positives
    const fileQueue = existing.filter(file => {
      return !(file.includes("scripts/quality-engine/rules/") || file.includes("scripts/verify-quality-engine.ts"));
    });

    // Bounded Async Concurrency: Worker pool runner to parse files safely and execute rule checks in parallel
    const worker = async (queue: string[]) => {
      while (queue.length > 0) {
        const file = queue.shift();
        if (!file) break;

        try {
          console.log(`[QualityEngine] Processing: ${file} (Queue: ${queue.length})`);
          const ast = await this.loadAST(file);

          for (const rule of this.rules) {
            try {
              const scope = rule.scope ?? this.config.defaultScope ?? "file";

              // GRAPH PASSING: Inject the graph into the context parameter
              // GRAPH CONSUMPTION: Only rules with scope: "graph" (like GraphAwareBoundaryRule) consume ctx.graph
              const ruleFindings = rule.check({
                filePath: file,
                ast,
                graph: scope === "file" ? undefined : graph,
              });

              findings.push(...ruleFindings);
            } catch (ruleErr) {
              const errorMsg = ruleErr instanceof Error ? ruleErr.message : String(ruleErr);
              console.error(`Rule "${rule.name}" failed on file ${file}:`, ruleErr);
              this.ruleErrors.push({
                ruleName: rule.name,
                filePath: file,
                message: errorMsg,
                timestamp: Date.now(),
              });
            }
          }
        } catch (fileErr) {
          console.error(`Failed to process file ${file}:`, fileErr);
        }
      }
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(concurrency, fileQueue.length); i++) {
      workers.push(worker(fileQueue));
    }
    await Promise.all(workers);

    return findings;
  }

  private async loadAST(path: string): Promise<unknown> {
    if (this.registry.has(path)) {
      return this.registry.get(path)!;
    }

    const cached = await this.cache?.getAST(path);
    if (cached) {
      // Use cached AST text to construct AST structure without hitting disk
      const ast = await this.loader.loadFromText(path, cached);
      this.registry.add(path, ast);
      return ast;
    }

    const ast = await this.loader.load(path);
    try {
      const astAny = ast as any;
      if (astAny && typeof astAny.getText === "function") {
        await this.cache?.setAST(path, astAny.getText());
      } else {
        await this.cache?.setAST(path, String(ast));
      }
    } catch (e) {
      console.warn(`Failed to write cache for ${path}:`, e);
    }
    this.registry.add(path, ast);
    return ast;
  }

  private async buildGraph(roots: string[]): Promise<SourceGraph> {
    const graph = new SourceGraph();
    const queue = [...roots];
    const seen = new Set(queue);

    while (queue.length) {
      const path = queue.shift()!;
      try {
        const ast = await this.loadAST(path);
        const imports = this.loader.getImports(ast);

        graph.add({ path, imports });

        for (const imp of imports) {
          if (!seen.has(imp) && this.fs.exists(imp)) {
            seen.add(imp);
            queue.push(imp);
          }
        }
      } catch (err) {
        console.warn(`Failed to process imports for graph at ${path}:`, err);
      }
    }

    return graph;
  }
}
