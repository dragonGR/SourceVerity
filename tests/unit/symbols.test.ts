import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type * as tsType from "typescript";
import { RuleRegistry } from "../../src/engine/registry.js";
import { resolveReactHook, isFetchResponseMethod } from "../../src/engine/symbols.js";
import { loadRepositoryTypeScript } from "../../src/repository/tsLoader.js";
import type { Rule } from "../../src/core/types.js";

describe("engine symbols helpers and rule registry", () => {
  test("rule registry handles registration, duplicate check, and category queries", () => {
    const registry = new RuleRegistry();

    const mockRuleA: Rule = {
      meta: {
        id: "async/async-foreach",
        category: "async",
        defaultSeverity: "error",
        defaultConfidence: "high",
        description: "test rule A",
        requiresTypeInformation: true,
      },
      analyze: () => {},
    };

    const mockRuleB: Rule = {
      meta: {
        id: "react/async-effect-callback",
        category: "react",
        defaultSeverity: "error",
        defaultConfidence: "high",
        description: "test rule B",
        requiresTypeInformation: true,
      },
      analyze: () => {},
    };

    registry.register(mockRuleA);
    registry.register(mockRuleB);

    assert.equal(registry.getAll().length, 2);
    assert.equal(registry.get("async/async-foreach"), mockRuleA);
    assert.deepEqual(registry.getByCategory("react"), [mockRuleB]);

    assert.throws(
      () => registry.register(mockRuleA),
      /Duplicate rule ID registered: 'async\/async-foreach'/
    );
  });

  test("resolveReactHook adversarial matrix matches authentic hooks and rejects lookalikes", () => {
    const tsInst = loadRepositoryTypeScript(process.cwd());
    if (!tsInst) {
      throw new Error("TypeScript required");
    }
    const ts = tsInst.ts;

    const source = `
import { useEffect, useCallback, useMemo, useState, useRef, useLayoutEffect } from 'react';
import { useEffect as myEffect, useCallback as myCb, useState as myState, useRef as myRef } from 'react';
import * as React from 'react';
import { useEffect as customEffect, useCallback as customCb } from './custom-hooks';

function localEffect() {}
function localCallback() {}

export function TestComponent() {
  // AUTHENTIC MATCH
  React.useEffect(() => {}, []);
  myEffect(() => {}, []);
  React.useLayoutEffect(() => {}, []);
  myCb(() => {}, []);
  myRef(null);
  myState(0);

  // AUTHENTIC NON-MATCH
  useCallback(() => {}, []);
  useMemo(() => 42, []);
  useState(0);
  useRef(null);
  useEffect(() => {}, []);
  useLayoutEffect(() => {}, []);

  // LOCAL NON-MATCH
  localEffect();
  localCallback();
  customEffect();
  customCb();
}
    `.trim();

    const compilerOptions: tsType.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      jsx: ts.JsxEmit.ReactJSX,
      strict: true,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    };

    const defaultLibFileName = ts.getDefaultLibFilePath(compilerOptions);
    const files = new Map<string, string>();
    files.set("test.tsx", source);

    const host: tsType.CompilerHost = {
      getSourceFile(name: string) {
        if (files.has(name)) {
          const content = files.get(name);
          return content !== undefined ? ts.createSourceFile(name, content, ts.ScriptTarget.ES2022, true) : undefined;
        }
        if (ts.sys.fileExists(name)) {
          const libText = ts.sys.readFile(name) ?? "";
          return ts.createSourceFile(name, libText, ts.ScriptTarget.ES2022, true);
        }
        return undefined;
      },
      getDefaultLibFileName: () => defaultLibFileName,
      writeFile: () => {},
      getCurrentDirectory: () => process.cwd(),
      getDirectories: () => [],
      getCanonicalFileName: (f: string) => f,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
      fileExists: (f: string) => files.has(f) || ts.sys.fileExists(f),
      readFile: (f: string) => files.get(f) ?? ts.sys.readFile(f),
    };

    const program = ts.createProgram({
      rootNames: ["test.tsx"],
      options: compilerOptions,
      host,
    });

    const checker = program.getTypeChecker();
    const sf = program.getSourceFile("test.tsx");
    assert.ok(sf);

    const calls: tsType.CallExpression[] = [];
    function visit(node: tsType.Node) {
      if (ts.isCallExpression(node)) {
        calls.push(node);
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);

    const findCall = (name: string): tsType.CallExpression => {
      const found = calls.find((c) => c.expression.getText(sf) === name);
      assert.ok(found, `Expected call expression for ${name}`);
      return found;
    };

    const reactUseEffect = findCall("React.useEffect");
    const aliasedEffect = findCall("myEffect");
    const reactUseLayoutEffect = findCall("React.useLayoutEffect");
    const aliasedCb = findCall("myCb");
    const aliasedRef = findCall("myRef");
    const aliasedState = findCall("myState");

    const directUseCallback = findCall("useCallback");
    const directUseMemo = findCall("useMemo");
    const directUseState = findCall("useState");
    const directUseRef = findCall("useRef");
    const directUseEffect = findCall("useEffect");
    const directUseLayoutEffect = findCall("useLayoutEffect");

    const localEffectCall = findCall("localEffect");
    const localCallbackCall = findCall("localCallback");
    const customEffectCall = findCall("customEffect");
    const customCbCall = findCall("customCb");

    // 1. AUTHENTIC MATCH
    assert.equal(resolveReactHook(reactUseEffect, checker, "useEffect"), true);
    assert.equal(resolveReactHook(aliasedEffect, checker, "useEffect"), true);
    assert.equal(resolveReactHook(reactUseLayoutEffect, checker, "useLayoutEffect"), true);
    assert.equal(resolveReactHook(aliasedCb, checker, "useCallback"), true);
    assert.equal(resolveReactHook(aliasedRef, checker, "useRef"), true);
    assert.equal(resolveReactHook(aliasedState, checker, "useState"), true);

    // 2. AUTHENTIC NON-MATCH (hook identity cross-checks)
    assert.equal(resolveReactHook(directUseCallback, checker, "useEffect"), false);
    assert.equal(resolveReactHook(directUseMemo, checker, "useEffect"), false);
    assert.equal(resolveReactHook(directUseState, checker, "useEffect"), false);
    assert.equal(resolveReactHook(directUseRef, checker, "useEffect"), false);
    assert.equal(resolveReactHook(directUseEffect, checker, "useLayoutEffect"), false);
    assert.equal(resolveReactHook(directUseLayoutEffect, checker, "useEffect"), false);
    assert.equal(resolveReactHook(aliasedCb, checker, "useEffect"), false);
    assert.equal(resolveReactHook(aliasedEffect, checker, "useCallback"), false);

    // 3. LOCAL NON-MATCH
    assert.equal(resolveReactHook(localEffectCall, checker, "useEffect"), false);
    assert.equal(resolveReactHook(localCallbackCall, checker, "useCallback"), false);
    assert.equal(resolveReactHook(customEffectCall, checker, "useEffect"), false);
    assert.equal(resolveReactHook(customCbCall, checker, "useCallback"), false);
  });

  test("isFetchResponseMethod matches authentic responses and rejects local/merged declarations", () => {
    const tsInst = loadRepositoryTypeScript(process.cwd());
    if (!tsInst) {
      throw new Error("TypeScript required");
    }
    const ts = tsInst.ts;

    const source = `
interface User {
  id: string;
}

class CustomResponse {
  json() {
    return {};
  }
}

class Response {
  json(): unknown {
    return {};
  }
}

const customConverter = {
  json() {
    return {};
  }
};

export async function runTest(domResp: globalThis.Response, localResp: Response, customResp: CustomResponse) {
  const r1 = await fetch('/api');
  const a = r1.json();
  const b = domResp.json();
  const c = localResp.json();
  const d = customResp.json();
  const e = customConverter.json();
}
    `.trim();

    const compilerOptions: tsType.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    };

    const defaultLibFileName = ts.getDefaultLibFilePath(compilerOptions);
    const files = new Map<string, string>();
    files.set("test.ts", source);

    const host: tsType.CompilerHost = {
      getSourceFile(name: string) {
        if (files.has(name)) {
          const content = files.get(name);
          return content !== undefined ? ts.createSourceFile(name, content, ts.ScriptTarget.ES2022, true) : undefined;
        }
        if (ts.sys.fileExists(name)) {
          const libText = ts.sys.readFile(name) ?? "";
          return ts.createSourceFile(name, libText, ts.ScriptTarget.ES2022, true);
        }
        return undefined;
      },
      getDefaultLibFileName: () => defaultLibFileName,
      writeFile: () => {},
      getCurrentDirectory: () => process.cwd(),
      getDirectories: () => [],
      getCanonicalFileName: (f: string) => f,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
      fileExists: (f: string) => files.has(f) || ts.sys.fileExists(f),
      readFile: (f: string) => files.get(f) ?? ts.sys.readFile(f),
    };

    const program = ts.createProgram({
      rootNames: ["test.ts"],
      options: compilerOptions,
      host,
    });

    const checker = program.getTypeChecker();
    const sf = program.getSourceFile("test.ts");
    assert.ok(sf);

    const accesses: tsType.PropertyAccessExpression[] = [];
    function visit(node: tsType.Node) {
      if (ts.isPropertyAccessExpression(node) && node.name.text === "json") {
        accesses.push(node);
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);

    const findAccess = (text: string): tsType.PropertyAccessExpression => {
      const found = accesses.find((a) => a.getText(sf) === text);
      assert.ok(found, `Expected property access for ${text}`);
      return found;
    };

    const fetchJson = findAccess("r1.json");
    const domJson = findAccess("domResp.json");
    const localJson = findAccess("localResp.json");
    const customJson = findAccess("customResp.json");
    const converterJson = findAccess("customConverter.json");

    // Authentic network Response matches
    assert.equal(isFetchResponseMethod(fetchJson, checker, ts), true);
    assert.equal(isFetchResponseMethod(domJson, checker, ts), true);

    // Local / custom declarations rejected
    assert.equal(isFetchResponseMethod(localJson, checker, ts), false);
    assert.equal(isFetchResponseMethod(customJson, checker, ts), false);
    assert.equal(isFetchResponseMethod(converterJson, checker, ts), false);
  });
});
