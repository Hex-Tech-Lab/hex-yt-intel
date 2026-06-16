import { Project, Node, SourceFile } from "ts-morph";
import * as path from "path";

export interface Finding {
  file: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  why: string;
  fix: string;
}

export interface IRule {
  name: string;
  check: (source: SourceFile) => Finding[];
}

export class QualityIntelligenceEngine {
  private project: Project;
  private rules: IRule[] = [];

  constructor(rootDir: string) {
    this.project = new Project({
      tsConfigFilePath: path.join(rootDir, "tsconfig.json"),
      skipAddingFilesFromTsConfig: true,
    });
  }

  addRule(rule: IRule) {
    this.rules.push(rule);
  }

  analyze(changedFiles: string[]): Finding[] {
    const findings: Finding[] = [];
    // Only analyze files that exist in the project
    const files = changedFiles
        .map(f => path.join(process.cwd(), f))
        .filter(f => fs.existsSync(f))
        .map(f => this.project.addSourceFileAtPath(f));

    for (const source of files) {
      for (const rule of this.rules) {
        findings.push(...rule.check(source));
      }
    }
    return findings;
  }
}
import * as fs from "fs";
