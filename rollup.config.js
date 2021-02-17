import ts from "@wessberg/rollup-plugin-ts";
import { nodeResolve } from '@rollup/plugin-node-resolve';
import pkg from "./package.json";
import {builtinModules} from "module";
console.log(pkg);
export default {
	input: "src/index.ts",
	output: [
		{
			file: pkg.main,
			format: "iife",
			sourcemap: true,
			name: "sync",
		},
	],
	plugins: [
		ts(),
		nodeResolve(),
	],
	external: [
		...builtinModules,
		...(pkg.dependencies == null ? [] : Object.keys(pkg.dependencies)),
		...(pkg.devDependencies == null ? [] : Object.keys(pkg.devDependencies)),
		...(pkg.peerDependencies == null ? [] : Object.keys(pkg.peerDependencies))
	]
};

