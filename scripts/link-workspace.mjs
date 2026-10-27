import fs from "node:fs";
import path from "node:path";

const pkgsDir = path.resolve("packages");
const appsDir = path.resolve("apps");
const scopeDir = path.resolve("node_modules/@savingroup");
fs.mkdirSync(scopeDir, { recursive: true });

// Remove any incomplete nested node_modules/@savingroup folders created by symlink=false
for (const root of [pkgsDir, appsDir]) {
  if (!fs.existsSync(root)) continue;
  for (const sub of fs.readdirSync(root)) {
    const nestedScope = path.join(root, sub, "node_modules", "@savingroup");
    if (fs.existsSync(nestedScope)) {
      fs.rmSync(nestedScope, { recursive: true, force: true });
    }
  }
}

for (const dir of fs.readdirSync(pkgsDir)) {
  const pkgJsonPath = path.join(pkgsDir, dir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  if (!pkg.name || !pkg.name.startsWith("@savingroup/")) continue;
  const shortName = pkg.name.split("/")[1];
  const targetDir = path.join(scopeDir, shortName);
  fs.mkdirSync(targetDir, { recursive: true });

  const createStub = (subpathKey, targetRelPath) => {
    if (subpathKey.includes("*")) {
      const targetPatternDir = path.resolve(pkgsDir, dir, path.dirname(targetRelPath));
      const stubPatternDir = path.join(
        targetDir,
        path.dirname(subpathKey.replace(/^\.\//, "")),
      );
      fs.mkdirSync(stubPatternDir, { recursive: true });
      if (fs.existsSync(targetPatternDir)) {
        for (const file of fs.readdirSync(targetPatternDir)) {
          const realFile = path.join(targetPatternDir, file);
          if (!fs.statSync(realFile).isFile()) continue;
          const stubFile = path.join(stubPatternDir, file);
          const rel = path.relative(stubPatternDir, realFile).replace(/\\/g, "/");
          fs.writeFileSync(stubFile, `export * from "${rel}";\n`);
        }
      }
      const ext = path.extname(targetRelPath) || ".ts";
      return `${subpathKey.replace(/\*$/, "*")}${ext.startsWith(".") ? ext : ""}`;
    }
    const cleanKey = subpathKey === "." ? "index" : subpathKey.replace(/^\.\//, "");
    const ext = path.extname(targetRelPath) || ".ts";
    const hasExt = cleanKey.endsWith(ext);
    const stubRelFile = hasExt ? `./${cleanKey}` : `./${cleanKey}${ext}`;
    const stubAbsFile = path.join(targetDir, hasExt ? cleanKey : `${cleanKey}${ext}`);
    fs.mkdirSync(path.dirname(stubAbsFile), { recursive: true });
    const realTargetAbs = path.resolve(pkgsDir, dir, targetRelPath);
    const relFromStub = path.relative(path.dirname(stubAbsFile), realTargetAbs).replace(/\\/g, "/");
    if (ext === ".css") {
      fs.copyFileSync(realTargetAbs, stubAbsFile);
    } else {
      fs.writeFileSync(stubAbsFile, `export * from "${relFromStub}";\n`);
    }
    return stubRelFile;
  };

  const exportsMap = {};
  if (pkg.exports && typeof pkg.exports === "object") {
    for (const [key, val] of Object.entries(pkg.exports)) {
      const targetStr =
        typeof val === "string" ? val : val?.default || val?.development || val?.types;
      if (!targetStr) continue;
      const stubFile = createStub(key, targetStr);
      exportsMap[key] = {
        types: stubFile,
        development: stubFile,
        default: stubFile,
      };
    }
  } else {
    const stubFile = createStub(".", "./src/index.ts");
    exportsMap["."] = {
      types: stubFile,
      development: stubFile,
      default: stubFile,
    };
  }

  const proxyPkg = {
    name: pkg.name,
    version: pkg.version,
    type: pkg.type || "module",
    exports: exportsMap,
    main: "./index.ts",
    types: "./index.ts",
  };
  fs.writeFileSync(path.join(targetDir, "package.json"), JSON.stringify(proxyPkg, null, 2));
}
