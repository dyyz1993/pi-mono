import path from 'path';

const source = "./packages/coding-agent/examples/extensions/openviking-memory";
console.log("source:", source);
console.log("resolved:", path.resolve(source));
console.log("exists:", require("fs").existsSync(path.resolve(source)));
console.log("isDir:", require("fs").statSync(path.resolve(source)).isDirectory());
