import { Project, Node, SourceFile } from "ts-morph";
import * as path from "path";
import * as fs from "fs";

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
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
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
        .map(f => path.resolve(this.rootDir, f))
        .filter(f => fs.existsSync(f))
        .map(f => this.project.addSourceFileAtPath(f));

    for (const source of files) {
      for (const rule of this.rules) {
        try {
          findings.push(...rule.check(source));
        } catch (error) {
          console.error(`Rule "${rule.name}" failed on file ${source.getFilePath()}:`, error);
        }
      }
    }
    return findings;
  }
}