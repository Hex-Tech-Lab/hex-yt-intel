import { Project, type SourceFile } from "ts-morph";
import type { FileLoaderPort } from "../application/ports/FileLoaderPort";

export class TsMorphLoader implements FileLoaderPort {
  constructor(private readonly project: Project) {}

  async load(path: string): Promise<SourceFile> {
    return this.project.getSourceFile(path) || this.project.addSourceFileAtPath(path);
  }

  async loadFromText(path: string, text: string): Promise<SourceFile> {
    const existing = this.project.getSourceFile(path);
    if (existing) {
      existing.replaceWithText(text);
      return existing;
    }
    return this.project.createSourceFile(path, text, { overwrite: true });
  }

  getImports(ast: unknown): string[] {
    const sf = ast as SourceFile;
    if (!sf || typeof sf.getImportDeclarations !== "function") return [];
    
    return sf
      .getImportDeclarations()
      .filter((d) => {
        const val = d.getModuleSpecifierValue();
        return val.startsWith(".") || val.startsWith("@/") || val.startsWith("@lib/") || val.startsWith("@components/") || val.startsWith("@hooks/") || val.startsWith("@api/");
      })
      .map((d) => d.getModuleSpecifierSourceFile()?.getFilePath())
      .filter((p): p is string => Boolean(p));
  }
}
