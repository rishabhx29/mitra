// GLSL sources for the Mitra orb.
//
// adapted from samantha-ui (MIT) — src/components/SoulOrb/{vertexShader,fragmentShader}.glsl.
// The vertex shader embeds the Ashima/Ian McEwan 3D simplex noise
// (Copyright (C) 2011 Ashima Arts, MIT — https://github.com/ashima/webgl-noise),
// exactly as in the samantha-ui source.
//
// Differences from the reference, per the Mitra persona contract:
// - `uAmplitude` → `uAudio` (0..1 audio amplitude)
// - `uColorPrimary`/`uColorSecondary` → `uColorA`/`uColorB` (user-customizable)
// - added `uState` (0 idle, 1 listening, 2 thinking, 3 speaking, 4 error) which
//   drives a high-frequency surface jitter in the error state.
// - UI-polish wave (docs/DESIGN_BRIEF.md §Overlay "Orb shape"): dual-frequency
//   simplex — a slow low-frequency swell is layered under the detail noise for
//   a softer, more organic blob; plus the inner additive-glow core shaders
//   (ORB_CORE_*) drawn over the shell so the orb appears lit from within.

/** uState index mapping — keep in sync with orbTheme. */
export const ORB_STATE_UNIFORM_INDEX = {
  idle: 0,
  listening: 1,
  thinking: 2,
  speaking: 3,
  error: 4,
} as const;

export const ORB_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uAudio;
uniform float uState;          // 0 idle, 1 listening, 2 thinking, 3 speaking, 4 error
uniform float uNoiseFrequency;
uniform float uNoiseAmplitude;
uniform float uShapeMorph;     // 0.0 = Blob, 1.0 = Liquid Silk

varying vec3 vNormal;
varying vec3 vPosition;
varying float vPattern;
varying vec3 vViewPosition;

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
  //   x2 = x0 - i2  + 2.0 * C.xxx;
  //   x3 = x0 - 1.0 + 3.0 * C.xxx;
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
  vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y

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
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
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

void main() {
  vNormal = normalMatrix * normal;
  vViewPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;

  // Pattern for fragment shader
  float noise = snoise(position * uNoiseFrequency + uTime * 0.2);

  // Dual-frequency surface (design brief): a slow, low-frequency swell layered
  // under the detail noise — large soft lobes that drift far slower than the
  // detail noise, making the blob read organic instead of fizzy.
  float lowFreq = snoise(position * 0.35 + uTime * 0.06);

  // Keep the color-mix pattern within [-1, 1] after blending the two octaves.
  vPattern = clamp(noise * 0.8 + lowFreq * 0.2, -1.0, 1.0);

  // --- 1. BLOB LOGIC (idle/listening/thinking/error) ---
  float baseDisplacement = noise * uNoiseAmplitude + lowFreq * uNoiseAmplitude * 0.55;

  float speechNoise1 = snoise(position * 3.0 + uTime * 6.0);
  float speechNoise2 = snoise(position * 1.5 + uTime * 4.0);
  float speechNoise3 = snoise(position * 5.0 + uTime * 8.0);
  float speechNoise4 = snoise(position * 0.8 + uTime * 2.0);

  float blobAudioDisplacement = uAudio * 1.1 * (
    speechNoise1 * 0.35 +
    speechNoise2 * 0.25 +
    speechNoise3 * 0.15 +
    speechNoise4 * 0.25
  );

  float totalBlobDisplacement = baseDisplacement + blobAudioDisplacement;

  // --- 2. LIQUID SILK LOGIC (speaking) ---
  // Domain warping for fluid look
  vec3 warp = position + vec3(sin(uTime), cos(uTime), 0.0) * 0.5;
  float flow = snoise(warp * 1.5);
  float ripples = sin(position.y * 10.0 + uTime * 5.0 + flow * 2.0);

  // High-pass filter on the flow to get the "tips" or outward edges
  float tips = smoothstep(0.0, 0.8, flow);

  // The low-frequency swell rides the silk shape too (slow breathing under the flow).
  float silkDisplacement =
    (flow * 0.1) + (lowFreq * 0.05) + (uAudio * tips * 0.3) + (uAudio * ripples * 0.02);

  // --- 3. BLEND ---
  float finalDisplacement = mix(totalBlobDisplacement, silkDisplacement, uShapeMorph);

  // Error state: high-frequency nervous jitter on top of everything else.
  float errorJitter = step(3.5, uState) * 0.02 * sin(position.x * 41.0 + position.y * 33.0 + uTime * 34.0);

  vec3 newPosition = position + normal * (finalDisplacement + errorJitter);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
}
`;

export const ORB_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uEmissiveIntensity;
uniform float uFresnelPower;

varying vec3 vNormal;
varying vec3 vViewPosition;
varying float vPattern;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(-vViewPosition);

  // Fresnel
  float fresnel = pow(1.0 - abs(dot(viewDir, normal)), uFresnelPower);

  // Mix colors
  vec3 color = mix(uColorA, uColorB, vPattern * 0.5 + 0.5);
  color = mix(color, uColorB, fresnel);

  // Emissive glow centered on fresnel/pattern
  vec3 emissive = uColorB * uEmissiveIntensity * (fresnel + vPattern * 0.2);

  gl_FragColor = vec4(color + emissive, 1.0);
}
`;

// Inner additive-glow core (design brief §Overlay "Orb shape"): a ~0.5-scale
// sphere drawn OVER the opaque shell (depthTest off + AdditiveBlending) so it
// reads as a soft light from within the orb. No noise — facing-ratio falloff
// only, brightest dead-center (an inner heart, not another rim).
export const ORB_CORE_VERTEX_SHADER = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vNormal = normalMatrix * normal;
  vViewPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ORB_CORE_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uCoreIntensity; // 0..1 per-state base brightness (orbTheme.coreGlow)
uniform float uAudio;         // smoothed 0..1 amplitude
uniform float uTime;          // frozen under prefers-reduced-motion (static glow)

varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(-vViewPosition);

  // Facing ratio: 1 at the sphere's center, 0 at the silhouette → soft radial falloff.
  float facing = pow(max(dot(viewDir, normal), 0.0), 1.6);

  // Gentle heartbeat + a modest audio lift (scaled 0..~1.5, clamped below).
  float beat = 0.85 + 0.15 * sin(uTime * 1.8) + uAudio * 0.5;

  vec3 coreColor = mix(uColorA, uColorB, 0.65);
  gl_FragColor = vec4(coreColor, clamp(uCoreIntensity * facing * beat, 0.0, 1.0));
}
`;
