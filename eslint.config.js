// ESLint exists here for the bug classes `tsc -b` structurally cannot catch —
// above all stale/missing hook dependency arrays, which this codebase is full
// of opportunities for: every hook in src/hooks closes over a roomId and a
// subscription that must be torn down when it changes (see the `evtRoomId !==
// channelId` room-scoping invariant in CLAUDE.md). Type checking says nothing
// about those.
//
// Stylistic rules are deliberately absent: formatting is not enforced, and
// anything `tsc` already reports (unused locals/params, unreachable code) is
// left to `tsc` rather than duplicated here with a second, differently-worded
// error.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    // Generated wasm/JS output (never hand-edited — see CLAUDE.md), build
    // output, the fetched mistlib source trees (both gitignored), and the Rust
    // CLI's own crate.
    ignores: [
      "dist/**",
      "src/vendor/**",
      ".mistlib-src/**",
      ".mistlib-examples-src/**",
      "cli/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // The whole reason this config exists. A missing dep is a real bug in a
      // P2P app whose hooks subscribe per room; warn rather than error so it
      // never blocks a build, but it must be visible.
      "react-hooks/exhaustive-deps": "warn",

      // eslint-plugin-react-hooks v7 ships rules that exist to make a codebase
      // safe for the React Compiler to memoize automatically. This app is
      // Preact with no compiler in the pipeline, and all three of these fire
      // on idioms used deliberately and pervasively here:
      //
      //   refs         — `localNameRef.current = localName` at hook top level,
      //                  the pattern that keeps a value fresh inside a
      //                  long-lived subscription without re-subscribing (see
      //                  usePostStream/useTyping/useRoomMeta).
      //   purity       — `Date.now()` inside `createPost`/`sendText`, which are
      //                  event handlers declared in the hook body; the rule
      //                  can't tell them apart from render code.
      //   immutability — assigning to a debounce/timer ref from a handler
      //                  (MessageInput, GifPicker, Lightbox).
      //
      // Turning them on would mean ~29 permanent errors or rewriting working
      // code to satisfy a compiler that isn't here. Revisit only if this app
      // ever moves to React + the compiler.
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",

      // TypeScript already resolves every identifier, and `no-undef` on TS
      // files is both redundant and wrong (it doesn't understand `declare`).
      "no-undef": "off",

      // `tsc -b` already reports these with better messages
      // (noUnusedLocals/noUnusedParameters), so don't double-report.
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off",

      // Peer-supplied wire content arrives as `unknown` and is narrowed by
      // hand-written validators (isPostEnc, verifyWire, ...). Casting after a
      // validation is the intended pattern here, not a smell.
      "@typescript-eslint/no-explicit-any": "warn",

      // Empty catch blocks are a deliberate, documented pattern: every
      // localStorage/clipboard access in this app must fail soft (see the
      // "Local persistence" section of CLAUDE.md). Those sites carry a comment
      // explaining the swallow, so don't flag the shape itself.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // The service worker is plain JS in a worker global scope, not a module,
    // and is never type-checked or bundled.
    files: ["public/sw.js"],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },
  {
    // Build tooling runs under Node, not in a browser (scripts/fetch-mistlib.mjs).
    files: ["scripts/**/*.{js,mjs}", "*.config.{js,ts}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
