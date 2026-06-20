import { Project, type SourceFile } from "ts-morph";
import type { FileLoaderPort } from "../application/ports/FileLoaderPort";

export class TsMorphLoader implements FileLoaderPort {
  constructor(private readonly project: Project) {}

  async load(path: string): Promise<any> {
    return this.project.getSourceFile(path) || this.project.addSourceFileAtPath(path);
  }

  getImports(ast: any): string[] {
    const sf = ast as SourceFile;
    if (!sf || typeof sf.getImportDeclarations !== "function") return [];
    
    return sf
      .getImportDeclarations()
      .map((d) => d.getModuleSpecifierSourceFile()?.getFilePath())
      .filter((p): p is string => Boolean(p));
  }
}
