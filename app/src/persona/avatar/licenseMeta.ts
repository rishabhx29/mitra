// Pure extraction of VRM embedded license metadata for display.
// No DOM / three imports — unit-tested in node (orb.test.tsx).
//
// Field names verified against @pixiv/three-vrm-core 3.x types:
//   types/meta/VRM1Meta.d.ts (metaVersion '1', licenseUrl, commercialUsage…)
//   types/meta/VRM0Meta.d.ts (metaVersion '0', licenseName, *UssageName…).
//
// Why: user-supplied .vrm models carry their own usage terms. Mitra never
// bundles a model; it renders whatever terms the user's model declares
// (research/05 §3: "nice 'we care about licenses' judge moment").

/** Normalized license summary for a loaded VRM. */
export interface VrmLicenseInfo {
  /** Model title / name (meta.title for VRM0, meta.name for VRM1). */
  title: string;
  /** Model version string, if declared. */
  version?: string;
  /** Authors (VRM1 `authors` array, VRM0 `author` string). */
  authors: string[];
  /** Copyright notice (VRM1 only). */
  copyright?: string;
  /** Human-readable license label. */
  licenseLabel: string;
  /** URL to the full license document, when the model declares one. */
  licenseUrl?: string;
  /** Short usage conditions worth showing the user. */
  usageNotes: string[];
}

const VRM0_LICENSE_LABELS: Record<string, string> = {
  CC0: 'CC0 (public domain)',
  CC_BY: 'CC BY',
  CC_BY_NC: 'CC BY-NC',
  CC_BY_NC_ND: 'CC BY-NC-ND',
  CC_BY_NC_SA: 'CC BY-NC-SA',
  CC_BY_ND: 'CC BY-ND',
  CC_BY_SA: 'CC BY-SA',
  Other: 'Custom license (see license URL)',
  Redistribution_Prohibited: 'Custom license — redistribution prohibited',
};

const VRM1_COMMERCIAL_LABELS: Record<string, string> = {
  personalNonProfit: 'personal, non-profit use',
  personalProfit: 'personal, for-profit use',
  corporation: 'corporate use',
};

function pushNotes(list: string[], note?: string | false): void {
  if (typeof note === 'string' && note.length > 0) list.push(note);
}

/**
 * Extract displayable license info from any VRM meta object
 * (`vrm.meta`, typed `VRMMeta` = VRM0Meta | VRM1Meta).
 * Structural detection (not instanceof) so plain test objects work.
 * Returns null when the meta is missing or carries no usable fields —
 * never throws.
 */
export function extractLicenseMeta(meta: unknown): VrmLicenseInfo | null {
  if (!meta || typeof meta !== 'object') return null;
  const m = meta as Record<string, unknown>;

  if (m.metaVersion === '1') {
    return extractVrm1(m);
  }
  return extractVrm0(m);
}

function extractVrm1(m: Record<string, unknown>): VrmLicenseInfo | null {
  const authors = Array.isArray(m.authors)
    ? m.authors.filter((a): a is string => typeof a === 'string' && a.length > 0)
    : [];
  const title = typeof m.name === 'string' ? m.name : '';
  const licenseUrl = typeof m.licenseUrl === 'string' && m.licenseUrl.length > 0 ? m.licenseUrl : undefined;

  const usageNotes: string[] = [];
  if (typeof m.avatarPermission === 'string') {
    usageNotes.push(`Avatar permission: ${m.avatarPermission}`);
  }
  if (typeof m.commercialUsage === 'string') {
    usageNotes.push(
      `Commercial use: ${VRM1_COMMERCIAL_LABELS[m.commercialUsage] ?? m.commercialUsage}`,
    );
  }
  if (m.allowExcessivelyViolentUsage === false) {
    usageNotes.push('Violent content: not permitted');
  }
  if (m.allowExcessivelySexualUsage === false) {
    usageNotes.push('Sexual content: not permitted');
  }
  if (typeof m.creditNotation === 'string') {
    usageNotes.push(`Credit: ${m.creditNotation}`);
  }
  if (m.allowRedistribution === false) {
    usageNotes.push('Redistribution: not permitted');
  }
  if (typeof m.modification === 'string') {
    usageNotes.push(`Modification: ${m.modification}`);
  }

  const info: VrmLicenseInfo = {
    title,
    version: typeof m.version === 'string' && m.version.length > 0 ? m.version : undefined,
    authors,
    copyright: typeof m.copyrightInformation === 'string' && m.copyrightInformation.length > 0 ? m.copyrightInformation : undefined,
    licenseLabel: licenseUrl ? 'Declared license (see URL)' : 'No license URL declared',
    licenseUrl,
    usageNotes,
  };
  return isUsable(info) ? info : null;
}

function extractVrm0(m: Record<string, unknown>): VrmLicenseInfo | null {
  const authors =
    typeof m.author === 'string' && m.author.length > 0 ? [m.author] : [];
  const title = typeof m.title === 'string' ? m.title : '';
  const licenseName = typeof m.licenseName === 'string' ? m.licenseName : undefined;
  const licenseUrl =
    (typeof m.otherLicenseUrl === 'string' && m.otherLicenseUrl.length > 0
      ? m.otherLicenseUrl
      : undefined) ??
    (typeof m.otherPermissionUrl === 'string' && m.otherPermissionUrl.length > 0
      ? m.otherPermissionUrl
      : undefined);

  const usageNotes: string[] = [];
  if (typeof m.allowedUserName === 'string') {
    usageNotes.push(`Avatar permission: ${m.allowedUserName}`);
  }
  if (typeof m.commercialUssageName === 'string') {
    usageNotes.push(`Commercial use: ${m.commercialUssageName}`);
  }
  if (typeof m.violentUssageName === 'string') {
    usageNotes.push(`Violent content: ${m.violentUssageName}`);
  }
  if (typeof m.sexualUssageName === 'string') {
    usageNotes.push(`Sexual content: ${m.sexualUssageName}`);
  }

  const info: VrmLicenseInfo = {
    title,
    version: typeof m.version === 'string' && m.version.length > 0 ? m.version : undefined,
    authors,
    licenseLabel: licenseName ? (VRM0_LICENSE_LABELS[licenseName] ?? licenseName) : 'No license declared',
    licenseUrl,
    usageNotes,
  };
  return isUsable(info) ? info : null;
}

function isUsable(info: VrmLicenseInfo): boolean {
  return Boolean(
    info.title ||
    info.authors.length > 0 ||
    info.licenseUrl ||
    info.usageNotes.length > 0 ||
    info.copyright,
  );
}
