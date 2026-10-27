// GLSL sources for the Mitra wave orb — "wave ribbons in a glass sphere"
// (docs/DECISION_TIER_PLAN.md §3).
//
// adapted from samantha-ui (MIT) — src/components/SoulOrb/{vertexShader,fragmentShader}.glsl:
// the shell/core shaders keep the reference's fresnel + palette-mix framing,
// and the core keeps the reference's blob/liquid-silk displacement. The vertex
// shader embeds the Ashima/Ian McEwan 3D simplex noise
// (Copyright (C) 2011 Ashima Arts, MIT — https://github.com/ashima/webgl-noise),
// exactly as in the samantha-ui source.
//
// The old single-sphere look is replaced outright (plan §3) by:
// - ORB_SHELL_*: transparent glass sphere with a strong fresnel rim (additive).
// - ORB_CORE_*: noise-displaced gradient blob, vertical a→b gradient, audio
//   breathing; still morphs to the reference's liquid silk while speaking.
// - ORB_RIBBON_*: closed wavy tube strands (geometry built once in Orb.tsx —
//   no per-frame geometry rebuilds; displacement bends the static tube).

/** The Ashima/Ian McEwan simplex noise, verbatim from the samantha-ui source. */
export const SIMPLEX_NOISE_GLSL = /* glsl */ `
//
// Description : Array and textureless GLSL 2D/3D/4D simplex
//               noise functions.
//      Author : Ian McEwan, Ashima Arts.
//  Maintainer : stegu
//     Lastmod : 20110822 (ijm)
//     License : Copyright (C) 2011 Ashima Arts. All rights reserved.
//               Distributed under the MIT License. See LICENSE file.
//               https://github.com/ashima/webgl-noise
//

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
     return mod289(((x*34.0)+1.0)*x);
}

vec4 taylorInvSqrt(vec4 r)
{
  return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v)
  {
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

// First corner
  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 = v - i + dot(i, C.xxx) ;

// Other corners
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );

  //   x0 = x0 - 0.0 + 0.0 * C.xxx;
  //   x1 = x0 - i1  + 1.0 * C.xxx;
  //   x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
  //   x3 = x0 - 1.0 + 3.0*C.xxx; // -1.0+3.0*C.x = -0.5 = -D.y

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

// Permutations
  i = mod289(i);
  vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

// Gradients: 7x7x6 points over a cube, mapped onto a 4-cross polytope
// 7*7*6 = 294, which is close to 343 = 7*7*7
  float n_ = 0.142857142857; // 1.0/7.0
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );

  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

//Normalise gradients
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

// Mix final noise value
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                dot(p2,x2), dot(p3,x3) ) );
  }
`;

// ---------------------------------------------------------------------------
// Glass shell — transparent sphere, strong fresnel rim (the reference image's
// blue ring), additive. The center stays almost clear (faint glass body) so
// the core + ribbons read as floating inside a bubble.
// ---------------------------------------------------------------------------

export const ORB_SHELL_VERTEX_SHADER = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vNormal = normalMatrix * normal;
  vViewPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ORB_SHELL_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uRim;       // rim brightness (wave theme shellRim * brightness)
uniform float uRimPower;  // fresnel power (orbTheme.fresnelPower)
uniform float uAudio;     // smoothed 0..1 amplitude

varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(-vViewPosition);

  float fresnel = pow(1.0 - abs(dot(viewDir, normal)), uRimPower);
  vec3 rim = mix(uColorA, uColorB, fresnel);

  // Additive: rgb * alpha is what gets added — the rim ring is bright, the
  // flat-on faces add only a faint glass body so the sphere still reads.
  float alpha = clamp(fresnel * uRim * (1.0 + uAudio * 0.5) + 0.05, 0.0, 1.0);
  gl_FragColor = vec4(rim, alpha);
}
`;

// ---------------------------------------------------------------------------
// Gradient core — noise-displaced blob with a vertical a→b gradient. The
// displacement (dual-frequency blob + audio pump + liquid-silk morph while
// speaking) is carried over from the samantha-ui reference, so every
// orbTheme.OrbStateTheme surface field stays live on the new look.
// ---------------------------------------------------------------------------

export const ORB_CORE_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uAudio;
uniform float uNoiseFrequency;
uniform float uNoiseAmplitude;
uniform float uShapeMorph;     // 0.0 = blob, 1.0 = liquid silk (speaking)

varying vec3 vNormal;
varying vec3 vViewPosition;
varying float vLocalY;         // vertical gradient coordinate (~-1.2..1.2)
varying float vPattern;

${SIMPLEX_NOISE_GLSL}

void main() {
  vNormal = normalMatrix * normal;

  float noise = snoise(position * uNoiseFrequency + uTime * 0.2);

  // Dual-frequency surface (design brief): a slow, low-frequency swell layered
  // under the detail noise — soft organic lobes, carried over from the old orb.
  float lowFreq = snoise(position * 0.35 + uTime * 0.06);
  vPattern = clamp(noise * 0.8 + lowFreq * 0.2, -1.0, 1.0);

  // --- 1. BLOB LOGIC (idle/listening/thinking/error) ---
  float baseDisplacement = noise * uNoiseAmplitude + lowFreq * uNoiseAmplitude * 0.55;
  // Audio pumps the core (speaking): two octaves of travelling noise. The
  // gain is tuned so even full-scale amplitude stays inside the shell.
  float audioNoise1 = snoise(position * 3.0 + uTime * 6.0);
  float audioNoise2 = snoise(position * 1.5 + uTime * 4.0);
  float blobAudioDisplacement = uAudio * 0.3 * (audioNoise1 * 0.6 + audioNoise2 * 0.4);
  float totalBlobDisplacement = baseDisplacement + blobAudioDisplacement;

  // --- 2. LIQUID SILK LOGIC (speaking) — from the samantha-ui reference ---
  vec3 warp = position + vec3(sin(uTime), cos(uTime), 0.0) * 0.5;
  float flow = snoise(warp * 1.5);
  float ripples = sin(position.y * 10.0 + uTime * 5.0 + flow * 2.0);
  float tips = smoothstep(0.0, 0.8, flow);
  float silkDisplacement =
    (flow * 0.1) + (lowFreq * 0.05) + (uAudio * tips * 0.3) + (uAudio * ripples * 0.02);

  float finalDisplacement = mix(totalBlobDisplacement, silkDisplacement, uShapeMorph);

  vec3 newPosition = position + normal * finalDisplacement;
  vLocalY = clamp(newPosition.y, -1.2, 1.2);
  vViewPosition = (modelViewMatrix * vec4(newPosition, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
}
`;

export const ORB_CORE_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uEmissiveIntensity;

varying vec3 vNormal;
varying vec3 vViewPosition;
varying float vLocalY;
varying float vPattern;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(-vViewPosition);
  float fresnel = pow(1.0 - abs(dot(viewDir, normal)), 2.0);

  // Vertical gradient: uColorA at the bottom → uColorB at the top (plan §3).
  float g = clamp(vLocalY * 0.5 + 0.5, 0.0, 1.0);
  vec3 color = mix(uColorA, uColorB, g);
  color = mix(color, uColorB, fresnel * 0.4); // silhouette leans toward B
  color *= 0.9 + 0.15 * vPattern;             // subtle noise shading

  vec3 emissive = uColorB * uEmissiveIntensity * (0.5 + 0.5 * g + fresnel * 0.5);
  gl_FragColor = vec4(color + emissive, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Ribbons — closed wavy tubes. The geometry is STATIC (TubeGeometry built once
// from ribbonCurvePoint samples); this vertex shader bends it along the tube
// normal with a position-based travelling wave (seam-safe on closed tubes),
// so animation is uniforms-only. Audio amplitude wobbles the strands.
// ---------------------------------------------------------------------------

export const ORB_RIBBON_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uAudio;       // smoothed 0..1 amplitude
uniform float uWobble;      // ambient travelling-wave amplitude (wave theme)
uniform float uAudioWobble; // audio-driven displacement gain (wave theme)
uniform float uAmbient;     // 1 normally, 0 under prefers-reduced-motion

varying float vWave;
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  // Position-based (not t-based) wave: identical on both sides of the tube
  // seam, and free of any per-frame geometry work.
  float wave = sin(position.x * 4.0 + position.y * 3.0 + uTime * 2.4);
  float displacement = wave * (uWobble * uAmbient + uAudio * uAudioWobble);
  vec3 newPosition = position + normal * displacement;

  vWave = wave;
  vNormal = normalMatrix * normal;
  vViewPosition = (modelViewMatrix * vec4(newPosition, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
}
`;

export const ORB_RIBBON_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uAudio;

varying float vWave;

void main() {
  // Additive: a gentle shimmer rides the travelling wave; audio brightens.
  float shimmer = 0.8 + 0.2 * vWave;
  float alpha = clamp(uIntensity * shimmer * (1.0 + uAudio * 0.6), 0.0, 1.0);
  gl_FragColor = vec4(uColor, alpha);
}
`;
