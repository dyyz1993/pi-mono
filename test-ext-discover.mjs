import path from 'path';
import fs from 'fs';

const extPath = './packages/coding-agent/examples/extensions/openviking-memory';
const resolved = path.resolve(extPath);
console.log("Resolved path:", resolved);
console.log("Exists:", fs.existsSync(resolved));
console.log("Is dir:", fs.statSync(resolved).isDirectory());

const pkgPath = path.join(resolved, 'package.json');
console.log("package.json exists:", fs.existsSync(pkgPath));
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  console.log("package.json:", JSON.stringify(pkg, null, 2));
  console.log("Has pi field:", !!pkg.pi);
  console.log("pi.extensions:", pkg.pi?.extensions);
}
