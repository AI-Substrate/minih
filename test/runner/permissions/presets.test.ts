/**
 * Plan 018 R1 — preset registry tests (T-R1.2).
 *
 * Snapshot the kind-decision matrix per preset to prevent accidental
 * loosening. If you intentionally change a preset, update the snapshot
 * after explicit reasoning.
 */
import { describe, expect, it } from 'vitest';
import {
  getPreset,
  isPresetName,
  listPresetNames,
  UnknownPresetError,
} from '../../../src/runner/permissions/presets.js';

describe('preset registry', () => {
  it('lists exactly the 6 documented presets', () => {
    expect(listPresetNames().slice().sort()).toEqual(
      [
        'build-only',
        'network',
        'read-only',
        'restricted',
        'trusted',
        'yolo',
      ].sort(),
    );
  });

  it('isPresetName narrows correctly', () => {
    expect(isPresetName('yolo')).toBe(true);
    expect(isPresetName('something-else')).toBe(false);
  });

  it('throws on unknown name', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing runtime guard
    expect(() => getPreset('bogus' as any)).toThrow(UnknownPresetError);
  });

  it('yolo allows everything', () => {
    expect(getPreset('yolo')).toEqual({
      shell: 'allow',
      write: 'allow',
      mcp: 'allow',
      read: 'allow',
      url: 'allow',
      'custom-tool': 'allow',
      memory: 'allow',
      hook: 'allow',
    });
  });

  it('restricted denies shell/write/url; allows read+mcp only', () => {
    expect(getPreset('restricted')).toEqual({
      shell: 'deny',
      write: 'deny',
      mcp: 'allow',
      read: 'allow',
      url: 'deny',
      'custom-tool': 'deny',
      memory: 'deny',
      hook: 'deny',
    });
  });

  it('read-only matches restricted shape', () => {
    expect(getPreset('read-only')).toEqual(getPreset('restricted'));
  });

  it('network = restricted + url:allow', () => {
    expect(getPreset('network').url).toBe('allow');
    expect(getPreset('network').shell).toBe('deny');
    expect(getPreset('network').write).toBe('deny');
  });

  it('trusted allows shell+write+url+mcp+read but denies custom/memory/hook', () => {
    expect(getPreset('trusted')).toEqual({
      shell: 'allow',
      write: 'allow',
      mcp: 'allow',
      read: 'allow',
      url: 'allow',
      'custom-tool': 'deny',
      memory: 'deny',
      hook: 'deny',
    });
  });

  it('build-only denies network + mcp', () => {
    expect(getPreset('build-only').url).toBe('deny');
    expect(getPreset('build-only').mcp).toBe('deny');
    expect(getPreset('build-only').shell).toBe('allow');
    expect(getPreset('build-only').write).toBe('allow');
  });

  it('preset objects are frozen (mutation throws)', () => {
    const yolo = getPreset('yolo');
    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: testing readonly enforcement
      (yolo as any).shell = 'deny';
    }).toThrow();
  });
});
