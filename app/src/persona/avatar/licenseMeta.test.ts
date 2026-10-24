// licenseMeta — VRM1 structural-detection tests (node-pure).
//
// The main extraction suite lives in src/persona/orb/orb.test.tsx (historical home).
// This file covers the raw-gltf case that suite missed: a VRM 1.0 meta WITHOUT
// `metaVersion` — exactly what settings/vrmMeta.ts parseGlbJson() hands over, and
// exactly the shape of the bundled Seed-san sample (assets/avatars/Seed-san.vrm,
// verified by parsing its JSON chunk). Without structural detection its attribution
// would degrade to "no metadata" in the settings license panel.

import { describe, expect, it } from 'vitest';
import { extractLicenseMeta } from './licenseMeta';

// Verbatim field values from assets/avatars/Seed-san.vrm (extensions.VRMC_vrm.meta).
const SEED_SAN_RAW_META = {
  allowAntisocialOrHateUsage: true,
  allowExcessivelySexualUsage: true,
  allowExcessivelyViolentUsage: true,
  allowPoliticalOrReligiousUsage: true,
  allowRedistribution: true,
  authors: ['VirtualCast, Inc.'],
  avatarPermission: 'everyone',
  commercialUsage: 'corporation',
  copyrightInformation: 'VirtualCast, Inc.',
  creditNotation: 'required',
  licenseUrl: 'https://vrm.dev/licenses/1.0/',
  modification: 'allowModificationRedistribution',
  name: 'Seed-san',
  thumbnailImage: 14,
  version: '1',
};

describe('extractLicenseMeta — raw VRM 1.0 meta (no metaVersion)', () => {
  it('detects Seed-san-shaped meta by VRM1-only fields and surfaces full attribution', () => {
    const info = extractLicenseMeta(SEED_SAN_RAW_META);
    expect(info).not.toBeNull();
    expect(info?.title).toBe('Seed-san');
    expect(info?.version).toBe('1');
    expect(info?.authors).toEqual(['VirtualCast, Inc.']);
    expect(info?.copyright).toBe('VirtualCast, Inc.');
    expect(info?.licenseUrl).toBe('https://vrm.dev/licenses/1.0/');
    expect(info?.usageNotes).toContain('Avatar permission: everyone');
    expect(info?.usageNotes).toContain('Credit: required');
  });

  it('still treats a VRM 0.x meta (author string, no VRM1 markers) as VRM0', () => {
    const info = extractLicenseMeta({
      title: 'Legacy model',
      author: 'Someone',
      licenseName: 'CC_BY_NC',
    });
    expect(info?.title).toBe('Legacy model');
    expect(info?.authors).toEqual(['Someone']);
    expect(info?.licenseLabel).toBe('CC BY-NC');
  });

  it('metaVersion "1" alone still routes to the VRM1 extractor', () => {
    const info = extractLicenseMeta({ metaVersion: '1', name: 'Aria' });
    expect(info?.title).toBe('Aria');
  });
});
