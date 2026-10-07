import * as THREE from "./lib/three.module.js";

export function frameAtTime(seconds, spec) {
  return Math.max(0, Math.min(spec.frames - 1, Math.floor(Math.max(0, seconds) * spec.fps + 0.0001)));
}

export function clampOrbit(degrees) {
  return Math.max(-25, Math.min(25, degrees));
}

// Shared geometry for both eyes, in display metres. The input is relative
// monocular depth normalized around the face, not surveyed metric geometry.
export function createDepthSubject(colorTexture, depthTexture, spec) {
  depthTexture.colorSpace = THREE.NoColorSpace;
  depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
  depthTexture.generateMipmaps = false;
  const material = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: {
      colorMap: { value: colorTexture },
      depthMap: { value: depthTexture },
      tile: { value: new THREE.Vector2() },
      tileSize: { value: new THREE.Vector2(spec.tileWidth, spec.tileHeight) },
      atlasSize: { value: new THREE.Vector2(spec.columns * spec.tileWidth, spec.rows * spec.tileHeight) },
      depthRange: { value: new THREE.Vector2(spec.near, spec.far) },
      intrinsics: { value: new THREE.Vector4() },
      center: { value: new THREE.Vector2() },
      anchorDepth: { value: spec.anchorDepth },
      strength: { value: 1 },
      talking: { value: 1 },
    },
    vertexShader: `
      uniform sampler2D depthMap;
      uniform vec2 tile, tileSize, atlasSize, depthRange, center;
      uniform vec4 intrinsics;
      uniform float anchorDepth, strength;
      varying vec2 vUv;
      varying float vDistance;
      vec2 atlasUV(vec2 sourceUV) {
        vec2 pixel = tile * tileSize + vec2(sourceUV.x, 1.0-sourceUV.y) * (tileSize-1.0) + 0.5;
        return vec2(pixel.x / atlasSize.x, 1.0-pixel.y / atlasSize.y);
      }
      void main() {
        vUv = uv;
        vec4 packed = texture2D(depthMap, atlasUV(uv));
        float encoded = (packed.r*255.0*256.0 + packed.g*255.0) / 65535.0;
        float distance = mix(anchorDepth, mix(depthRange.x, depthRange.y, encoded), strength);
        vDistance = distance;
        vec2 imageUV = vec2(uv.x, 1.0-uv.y);
        vec2 ray = (imageUV-intrinsics.zw) / intrinsics.xy;
        vec2 originRay = (center-intrinsics.zw) / intrinsics.xy;
        vec3 point = vec3(ray.x*distance-originRay.x*anchorDepth,
                         -ray.y*distance+originRay.y*anchorDepth,
                         anchorDepth-distance);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point,1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D colorMap, depthMap;
      uniform vec2 tile, tileSize, atlasSize, depthRange;
      uniform float anchorDepth, strength, talking;
      varying vec2 vUv;
      varying float vDistance;
      void main() {
        vec2 pixel = tile*tileSize + vec2(vUv.x,1.0-vUv.y)*(tileSize-1.0)+0.5;
        vec4 packed = texture2D(depthMap,vec2(pixel.x/atlasSize.x,1.0-pixel.y/atlasSize.y));
        float alpha = smoothstep(0.1,0.8,packed.b);
        if (alpha < 0.04) discard;
        float distance = mix(anchorDepth,mix(depthRange.x,depthRange.y,
          (packed.r*255.0*256.0+packed.g*255.0)/65535.0),strength);
        // Reject stretched bridges between the person and removed background.
        if(talking > 0.5 && abs(vDistance-distance) > 0.10) discard;
        gl_FragColor = vec4(texture2D(colorMap,vUv).rgb,alpha);
        #include <colorspace_fragment>
      }
    `,
  });
  const subject = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, spec.tileWidth - 1, spec.tileHeight - 1), material);
  subject.frustumCulled = false; // Shader displacement exceeds the flat input bound.
  subject.setFrame = (index) => {
    index = Math.max(0, Math.min(spec.frames - 1, index));
    const shot = spec.shots.find((shot) => index >= shot.start && index < shot.end);
    if (!shot) throw new Error("Depth frame has no shot metadata");
    material.uniforms.tile.value.set(index % spec.columns, Math.floor(index / spec.columns));
    material.uniforms.intrinsics.value.fromArray(shot.intrinsics);
    material.uniforms.center.value.fromArray(shot.center);
    material.uniforms.talking.value = shot.talking ? 1 : 0;
    return shot;
  };
  subject.setFrame(0);
  return subject;
}
