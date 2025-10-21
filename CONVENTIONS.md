# Conventions

These conventions must always be followed when writing code.

## General

- Never write comments. Comments are excuses for inexplicit or unexpressive code.
- Write good abstractions. It is better to have overly abstracted code than under abstracted code.
- Each language should be written as idiomatically as possible.
- Dependencies should always be adequately inverted. The method of dependency inversion may change depending on the
  language and situation.

## Rust

### Tests

- Unit tests should be at the bottom of the code file they are testing.

## TypeScript

### General

- Never make an explicit or implicit `any` type.

### Tests

- Unit tests should run in Jest and test files should next to the files they test. E.g. a file called `/src/foo/bar.ts`
  would have an accompanying file called `/src/foo/bar.test.ts`.
