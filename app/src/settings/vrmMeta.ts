// VRM metadata extraction for the Settings persona picker (Task E).
//
// A .vrm file is a glTF-Binary (.glb): 12-byte header, then chunks — the first
// is a JSON chunk whose extensions.VRMC_vrm.meta (VRM 1.0) or extensions.VRM.meta
// (VRM 0.x) carries the embedded license. Parsing the GLB container directly (no
// three.js import) keeps this pure and unit-testable in node; the display side
// uses extractLicenseMeta() from persona/avatar/licenseMeta.ts as specified.
//
// Never throws: a malformed/truncated file degrades to null ("no metadata").

import { extractLicenseMeta, type VrmLicenseInfo } from '../persona/avatar/licenseMeta';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const GLB_JSON_CHUNK = 0x4e4f534a; // 'JSON'
const HEADER_SIZE = 12;
const CHUNK_HEADER_SIZE = 8;

/** Parse the JSON chunk out of a GLB container. Returns null on any malformed input. */
export function parseGlbJson(buffer: ArrayBuffer): unknown | null {
  try {
    if (buffer.byteLength < HEADER_SIZE + CHUNK_HEADER_SIZE) return null;
    const view = new DataView(buffer);

    if (view.getUint32(0, true) !== GLB_MAGIC) return null;
    if (view.getUint32(4, true) !== 2) return null; // glTF 2.0 only (VRM is 2.0-based)

    const totalLength = view.getUint32(8, true);
    if (totalLength < HEADER_SIZE || totalLength > buffer.byteLength) return null;

    let offset = HEADER_SIZE;
    while (offset + CHUNK_HEADER_SIZE <= totalLength) {
      const chunkLength = view.getUint32(offset, true);
      const chunkType = view.getUint32(offset + 4, true);
      const dataStart = offset + CHUNK_HEADER_SIZE;
      if (chunkLength > totalLength - dataStart) return null; // truncated chunk
      if (chunkType === GLB_JSON_CHUNK) {
        const bytes = new Uint8Array(buffer, dataStart, chunkLength);
        const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        try {
          // Trailing NUL padding (some exporters pad with 0x00 instead of the
          // spec's 0x20 space) is not JSON whitespace — strip it before parsing.
          return JSON.parse(text.replace(/[\0]+$/, '')) as unknown;
        } catch {
          return null;
        }
      }
      offset = dataStart + chunkLength;
    }
    return null; // no JSON chunk found
  } catch {
    return null;
  }
}

/**
 * Pull the VRM meta object (VRM1 `VRMC_vrm.meta` | VRM0 `VRM.meta`) out of a
 * parsed glTF JSON. Null when absent — never throws.
 */
export function extractVrmMetaObject(gltf: unknown): unknown | null {
  if (!gltf || typeof gltf !== 'object') return null;
  const extensions = (gltf as { extensions?: unknown }).extensions;
  if (!extensions || typeof extensions !== 'object') return null;
  const ext = extensions as Record<string, unknown>;
  if (ext['VRMC_vrm'] && typeof ext['VRMC_vrm'] === 'object') {
    const meta = (ext['VRMC_vrm'] as Record<string, unknown>)['meta'];
    if (meta && typeof meta === 'object') return meta;
  }
  if (ext['VRM'] && typeof ext['VRM'] === 'object') return ext['VRM'];
  return null;
}

/** Fetch a .vrm (object URL or file URL) and extract its displayable license info. */
export async function readVrmLicense(url: string): Promise<VrmLicenseInfo | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const gltf = parseGlbJson(buffer);
    const meta = extractVrmMetaObject(gltf);
    return meta === null ? null : extractLicenseMeta(meta);
  } catch {
    return null;
  }
}
