/**
 * CSV parser for the SmellyCode++ dataset (multi-smell-dataset-v1_2.csv).
 *
 * The dataset contains 107,554 Java code snippets with 14 numerical code-metric
 * columns and 6 binary code-smell labels (blob, dataClass, featureEnvy, godClass,
 * longMethod, longParameterList).
 *
 * SOURCE: Alomari et al. (2025) SmellyCode++.csv. figshare.
 *   DOI: 10.6084/m9.figshare.28519385.v1  |  License: CC0 1.0 Universal
 */
import type { CalibrationExample } from "./types";
import type { SmellyCodeExample, SmellyCodeMetrics, SmellyCodeLabels } from "./SmellyCodeTypes";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

export class SmellyCodeIngester {
  private examples: SmellyCodeExample[] = [];

  /**
   * Load and parse the CSV dataset via streaming to handle ~590 MB file.
   * Returns parsed SmellyCodeExample[].
   * Silently returns empty array if file is missing (optional/local-only).
   */
  public async loadFromCsv(csvPath: string, maxRows = 0): Promise<SmellyCodeExample[]> {
    if (!fs.existsSync(csvPath)) {
      console.warn(`[SmellyCodeIngester] Dataset not found at ${csvPath}. Download with fetch-smellycode.sh`);
      return [];
    }

    const rl = readline.createInterface({
      input: fs.createReadStream(csvPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    const examples: SmellyCodeExample[] = [];
    let headerLine: string | undefined;
    let col: Record<string, number> = {};

    for await (const line of rl) {
      if (!line.trim()) continue;

      if (!headerLine) {
        headerLine = line;
        col = this.buildColumnMap(this.parseCsvLine(line));
        continue;
      }

      if (maxRows > 0 && examples.length >= maxRows) break;

      const row = this.parseCsvLine(line);
      if (row.length < Object.keys(col).length / 2) continue;

      try {
        const code = row[col.code] ?? "";
        const metrics = this.extractMetrics(row, col);
        const labels = this.extractLabels(row, col);
        examples.push({ code, metrics, labels });
      } catch {
        // Skip malformed rows silently
      }
    }

    this.examples = examples;
    console.log(`[SmellyCodeIngester] Parsed ${examples.length.toLocaleString()} examples from ${path.basename(csvPath)}`);
    return examples;
  }

  /**
   * Convert SmellyCodeExamples into CalibrationExample[] for the engine.
   * Maps numerical metric thresholds to abstract complexity rules.
   */
  public toCalibrationExamples(sampleSize?: number): CalibrationExample[] {
    const pool = sampleSize ? this.examples.slice(0, sampleSize) : this.examples;
    return pool.map((ex, i) => ({
      sourceName: "SmellyCode++",
      externalId: `SC-${i}`,
      filePath: `smellycode_synthetic_${i}.ts`,
      codeSnippet: `// SmellyCode++ example ${i}\n// Metrics: cyclo=${ex.metrics.cycloComplexity}, loc=${ex.metrics.linesOfCode}\nexport function synthetic_${i}() {\n  // ${ex.code.slice(0, 120).replace(/\n/g, " ")}\n}`,
      expectedOutcome: this.hasActiveSmell(ex.labels) ? "finding" : "clean",
      issueCategory: this.mapSmellCategory(ex.labels),
      expectedSeverity: this.mapSmellSeverity(ex.metrics),
      metadata: { metrics: ex.metrics, labels: ex.labels },
    }));
  }

  /**
   * Abstract metric thresholds mapped from SmellyCode++ numerical features.
   * These are language-agnostic — they test cyclomatic complexity, LOC, etc.
   */
  public evaluateMetricThresholds(examples: SmellyCodeExample[]): {
    highComplexity: number;
    longMethod: number;
    manyParams: number;
  } {
    let highComplexity = 0;
    let longMethod = 0;
    let manyParams = 0;

    for (const ex of examples) {
      if (ex.metrics.cycloComplexity > 10) highComplexity++;
      if (ex.metrics.linesOfCode > 100) longMethod++;
      if (ex.metrics.distinctOperands > 30) manyParams++;
    }

    return { highComplexity, longMethod, manyParams };
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  private buildColumnMap(header: string[]): Record<string, number> {
    const map: Record<string, number> = {};
    for (let i = 0; i < header.length; i++) {
      const key = header[i]!.toLowerCase().replace(/[^a-z]/g, "");
      map[key] = i;
    }
    // Key aliases the dataset likely uses
    map.code = map.code ?? map.code ?? 0;
    return map;
  }

  private extractMetrics(row: string[], col: Record<string, number>): SmellyCodeMetrics {
    const val = (idx: number | undefined, fallback = 0): number =>
      idx !== undefined ? (parseFloat(row[idx] ?? "") || fallback) : fallback;

    return {
      logicalLoc: val(col.logicalloc ?? col.logical_loc),
      cycloComplexity: val(col.cyclomaticcomplexity ?? col.cyclo_complexity),
      basicCyclo: val(col.basiccyclo ?? col.basic_cyclo),
      essentialCyclo: val(col.essentialcyclo ?? col.essential_cyclo),
      designCyclo: val(col.designcyclo ?? col.design_cyclo),
      linesOfCode: val(col.linesofcode ?? col.loc),
      numOperands: val(col.numoperands ?? col.total_operands),
      numOperators: val(col.numoperators ?? col.total_operators),
      distinctOperands: val(col.distinctoperands ?? col.distinct_operands),
      distinctOperators: val(col.distinctoperators ?? col.distinct_operators),
      effort: val(col.effort),
      volume: val(col.volume),
      difficulty: val(col.difficulty),
      intelligence: val(col.intelligence),
    };
  }

  private extractLabels(row: string[], col: Record<string, number>): SmellyCodeLabels {
    const bool = (idx: number | undefined): boolean => {
      if (idx === undefined) return false;
      const val = row[idx]?.trim().toLowerCase() ?? "";
      return val === "true" || val === "1";
    };

    return {
      blob: bool(col.blob),
      dataClass: bool(col.dataclass ?? col.data_class),
      featureEnvy: bool(col.featureenvy ?? col.feature_envy),
      godClass: bool(col.godclass ?? col.god_class),
      longMethod: bool(col.longmethod ?? col.long_method),
      longParameterList: bool(col.longparameterlist ?? col.long_parameter_list),
    };
  }

  private hasActiveSmell(labels: SmellyCodeLabels): boolean {
    return Object.values(labels).some(Boolean);
  }

  private mapSmellCategory(labels: SmellyCodeLabels): string {
    if (labels.godClass || labels.blob) return "code-complexity";
    if (labels.longMethod) return "code-complexity";
    if (labels.longParameterList) return "code-complexity";
    if (labels.featureEnvy) return "code-complexity";
    if (labels.dataClass) return "code-complexity";
    return "code-complexity";
  }

  private mapSmellSeverity(metrics: SmellyCodeMetrics): "critical" | "high" | "medium" {
    if (metrics.cycloComplexity > 20 || metrics.linesOfCode > 500) return "critical";
    if (metrics.cycloComplexity > 10 || metrics.linesOfCode > 200) return "high";
    return "medium";
  }
}