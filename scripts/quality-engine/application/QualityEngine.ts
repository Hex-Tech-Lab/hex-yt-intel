import { SourceGraph } from "../domain/SourceGraph";
import type { Finding } from "../domain/Finding";
import type { Rule } from "../domain/Rule";
import type { CachePort } from "./ports/CachePort";
import type { FileLoaderPort } from "./ports/FileLoaderPort";
import type { FileSystemPort } from "./ports/FileSystemPort";
import { SourceRegistry } from "./SourceRegistry";
import type { EngineConfig } from "./EngineConfig";

export class QualityEngine {
  private registry = new SourceRegistry();

  constructor(
    private readonly rules: Rule[],
    private readonly loader: FileLoaderPort,
    private readonly cache: CachePort | undefined,
    private readonly fs: FileSystemPort,
    private readonly config: EngineConfig
  ) {}

  async analyze(files: string[]): Promise<Finding[]> {
    const existing = files.filter((f) => this.fs.exists(f));
    const graph = await this.buildGraph(existing);

    const findings: Finding[] = [];
    for (const file of existing) {
      try {
        const ast = await this.loadAST(file);

        for (const rule of this.rules) {
          try {
            const scope = rule.scope ?? this.config.defaultScope ?? "file";

            // file-local stays default; graph is available only if rule wants it
            findings.push(
              ...rule.check({
                filePath: file,
                ast,
                graph: scope === "file" ? undefined : graph,
              })
            );
          } catch (ruleErr) {
            console.error(`Rule "${rule.name}" failed on file ${file}:`, ruleErr);
          }
        }
      } catch (fileErr) {
        console.error(`Failed to process file ${file}:`, fileErr);
      }
    }

    return findings;
  }

  private async loadAST(path: string): Promise<any> {
    if (this.registry.has(path)) {
      return this.registry.get(path)!;
    }

    const cached = await this.cache?.getAST(path);
    if (cached) {
      // Load source file structure
      const ast = await this.loader.load(path);
      this.registry.add(path, ast);
      return ast;
    }

    const ast = await this.loader.load(path);
    try {
      if (ast && typeof ast.getText === "function") {
        await this.cache?.setAST(path, ast.getText());
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
