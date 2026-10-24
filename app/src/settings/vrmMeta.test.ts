// VRM GLB meta extraction — node-pure unit tests (synthetic GLB buffers).

import { describe, expect, it } from 'vitest';
import { extractLicenseMeta } from '../persona/avatar/licenseMeta';
import { extractVrmMetaObject, parseGlbJson } from './vrmMeta';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;

function makeGlb(json: unknown, opts: { corruptLength?: boolean; truncate?: boolean } = {}): ArrayBuffer {
  const text = JSON.stringify(json);
  const jsonBytes = new TextEncoder().encode(text);
  const pad = (4 - (jsonBytes.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + pad;
  const buf = new ArrayBuffer(opts.truncate ? total - 6 : total);
  const view = new DataView(buf);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, opts.corruptLength ? total + 1000 : total, true);
  view.setUint32(12, jsonBytes.length + pad, true);
  view.setUint32(16, JSON_CHUNK, true);
  new Uint8Array(buf, 20).set(jsonBytes.subarray(0, buf.byteLength - 20));
  return buf;
}

describe('parseGlbJson', () => {
  it('parses the JSON chunk of a well-formed GLB', () => {
    const gltf = { asset: { version: '2.0' }, extensions: {} };
    expect(parseGlbJson(makeGlb(gltf))).toEqual(gltf);
  });

  it('returns null for non-GLB garbage, wrong version, or truncated buffers', () => {
    const garbage = new TextEncoder().encode('not a glb at all').slice(); // exact-size copy
    expect(parseGlbJson(garbage.buffer as ArrayBuffer)).toBeNull();
    const badVersion = makeGlb({});
    new DataView(badVersion).setUint32(4, 1, true); // glTF 1.0
    expect(parseGlbJson(badVersion)).toBeNull();
    expect(parseGlbJson(makeGlb({ a: 1 }, { truncate: true }))).toBeNull();
    expect(parseGlbJson(new ArrayBuffer(4))).toBeNull();
  });

  it('returns null when the declared total length overruns the buffer', () => {
    expect(parseGlbJson(makeGlb({ a: 1 }, { corruptLength: true }))).toBeNull();
  });
});

describe('extractVrmMetaObject', () => {
  it('finds the VRM 1.0 meta under extensions.VRMC_vrm.meta', () => {
    const meta = { metaVersion: '1', name: 'Aria' };
    expect(extractVrmMetaObject({ extensions: { VRMC_vrm: { specVersion: '1.0', meta } } })).toBe(meta);
  });

  it('finds the VRM 0.x meta under extensions.VRM', () => {
    const meta = { title: 'Old model' };
    expect(extractVrmMetaObject({ extensions: { VRM: meta } })).toBe(meta);
  });

  it('returns null when there is no VRM extension or the input is not an object', () => {
    expect(extractVrmMetaObject({})).toBeNull();
    expect(extractVrmMetaObject(null)).toBeNull();
    expect(extractVrmMetaObject('nope')).toBeNull();
  });
});

describe('end-to-end: GLB → VRM meta → license info', () => {
  it('surfaces a VRM 0.x license from a synthetic .vrm buffer', () => {
    const gltf = {
      extensions: {
        VRM: { title: 'Test Avatar', author: 'Pixiv', licenseName: 'CC_BY' },
      },
    };
    const meta = extractVrmMetaObject(parseGlbJson(makeGlb(gltf)));
    expect(meta).not.toBeNull();
    const info = extractLicenseMeta(meta);
    expect(info?.title).toBe('Test Avatar');
    expect(info?.authors).toEqual(['Pixiv']);
    expect(info?.licenseLabel).toBe('CC BY');
  });

  it('surfaces a VRM 1.0 license (metaVersion 1)', () => {
    const gltf = {
      extensions: {
        VRMC_vrm: {
          specVersion: '1.0',
          meta: { metaVersion: '1', name: 'Aria', authors: ['AC'], licenseUrl: 'https://example.com/lic' },
        },
      },
    };
    const info = extractLicenseMeta(extractVrmMetaObject(parseGlbJson(makeGlb(gltf))));
    expect(info?.title).toBe('Aria');
    expect(info?.licenseUrl).toBe('https://example.com/lic');
  });
});
