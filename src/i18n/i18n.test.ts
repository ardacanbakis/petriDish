import { describe, expect, it } from 'vitest';
import en from './en.json';
import tr from './tr.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`),
  );
}

describe('translations', () => {
  it('tr has exactly the same keys as en', () => {
    expect(flatten(tr).sort()).toEqual(flatten(en).sort());
  });
});
