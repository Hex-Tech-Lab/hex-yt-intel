import * as fs from "fs";
import * as path from "path";
import type { FileSystemPort } from "../application/ports/FileSystemPort";

export class NodeFileSystem implements FileSystemPort {
  exists(p: string): boolean {
    return fs.existsSync(p);
  }

  resolve(p: string): string {
    return path.resolve(p);
  }
}
