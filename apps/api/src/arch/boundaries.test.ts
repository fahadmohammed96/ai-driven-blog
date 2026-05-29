import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  findBoundaryViolations,
  scanSourceFiles,
  type SourceFile,
} from "./boundaries";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, ".."); // src/arch -> src

describe("findBoundaryViolations (unit)", () => {
  it("flags a cross-module import that reaches into another module's internals", () => {
    const files: SourceFile[] = [
      {
        path: "modules/content/content.service.ts",
        imports: ["../tenancy/tenancy.service", "@nestjs/common"],
      },
    ];
    const violations = findBoundaryViolations(files);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.resolved).toBe("modules/tenancy/tenancy.service");
  });

  it("allows cross-module imports through the public barrel", () => {
    const files: SourceFile[] = [
      {
        path: "modules/content/content.service.ts",
        imports: ["../tenancy", "../../platform", "@nestjs/common"],
      },
      {
        path: "modules/content/content.module.ts",
        imports: ["../tenancy", "./content.service"],
      },
    ];
    expect(findBoundaryViolations(files)).toEqual([]);
  });

  it("does not constrain files outside modules/verticals (composition root)", () => {
    const files: SourceFile[] = [
      { path: "app.module.ts", imports: ["./modules/tenancy/tenancy.service"] },
    ];
    expect(findBoundaryViolations(files)).toEqual([]);
  });
});

describe("module boundaries (architecture)", () => {
  it("no module imports the internals of another module", () => {
    const violations = findBoundaryViolations(scanSourceFiles(srcRoot));
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
