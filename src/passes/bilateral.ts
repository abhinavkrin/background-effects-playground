import { num } from '../lib/params';
import type { PassDefinition } from './types';
import { RenderTarget, bindTexture, createProgram, glsl, glslFloat, useQuad, vertexShaderSource } from './gl';

// The parameters are baked in as constants, as the proposed library build does, and the program is rebuilt when
// they change.
const fragment = (radius: number, step: number, spatialSigma: number, rangeSigma: number) => glsl`#version 300 es
  precision mediump float;
  in vec2 texCoords;
  uniform sampler2D u_mask;
  uniform sampler2D u_frame;
  uniform vec2 u_texelSize;
  out vec4 fragColor;

  const int RADIUS = ${Math.round(radius)};
  const float STEP = ${glslFloat(step)};
  const float SPATIAL_SIGMA = ${glslFloat(spatialSigma)};
  const float RANGE_SIGMA = ${glslFloat(rangeSigma)};

  void main() {
    vec3 center = texture(u_frame, texCoords).rgb;
    float sum = 0.0;
    float weights = 0.0;
    for (int y = -RADIUS; y <= RADIUS; y++) {
      for (int x = -RADIUS; x <= RADIUS; x++) {
        vec2 uv = texCoords + vec2(float(x), float(y)) * u_texelSize * STEP;
        vec3 diff = texture(u_frame, uv).rgb - center;
        float w = exp(
          -float(x * x + y * y) / (2.0 * SPATIAL_SIGMA * SPATIAL_SIGMA)
          - dot(diff, diff) / (2.0 * RANGE_SIGMA * RANGE_SIGMA)
        );
        sum += texture(u_mask, uv).r * w;
        weights += w;
      }
    }
    fragColor = vec4(vec3(sum / weights), 1.0);
  }
`;

/** Pulls the mask's edge onto the edge in the picture: each pixel takes the mask of nearby pixels that look like it. */
export const bilateralPass: PassDefinition = {
	id: 'bilateral',
	label: 'Joint bilateral refine',
	stage: 'frame',
	description: 'Guided by the frame. Proposed build: 9x9 window (radius 4), step 2, spatial sigma 3, range sigma 0.1.',
	params: [
		{ key: 'radius', label: 'Radius (taps)', kind: 'number', min: 1, max: 8, step: 1 },
		{ key: 'step', label: 'Step (mask texels)', kind: 'number', min: 0.5, max: 4, step: 0.5 },
		{ key: 'spatialSigma', label: 'Spatial sigma', kind: 'number', min: 0.5, max: 8, step: 0.5 },
		{ key: 'rangeSigma', label: 'Range sigma', kind: 'number', min: 0.02, max: 0.5, step: 0.01 },
	],
	defaults: { radius: 4, step: 2, spatialSigma: 3, rangeSigma: 0.1 },
	create(gl) {
		const target = new RenderTarget(gl);
		let built: { key: string; program: WebGLProgram; mask: WebGLUniformLocation | null; frame: WebGLUniformLocation | null; texel: WebGLUniformLocation | null } | undefined;
		return {
			run(ctx, input, params) {
				const radius = num(params, 'radius', 4);
				const step = num(params, 'step', 2);
				const spatial = num(params, 'spatialSigma', 3);
				const range = num(params, 'rangeSigma', 0.1);
				const key = `${radius}|${step}|${spatial}|${range}`;
				if (built?.key !== key) {
					if (built) {
						gl.deleteProgram(built.program);
					}
					const program = createProgram(gl, vertexShaderSource(false), fragment(radius, step, spatial, range));
					built = {
						key,
						program,
						mask: gl.getUniformLocation(program, 'u_mask'),
						frame: gl.getUniformLocation(program, 'u_frame'),
						texel: gl.getUniformLocation(program, 'u_texelSize'),
					};
				}
				target.ensure(ctx.maskWidth, ctx.maskHeight);
				useQuad(gl, built.program, ctx.vertexBuffer);
				target.bind();
				bindTexture(gl, 0, input, built.mask);
				bindTexture(gl, 1, ctx.frameTexture, built.frame);
				gl.uniform2f(built.texel, 1 / ctx.maskWidth, 1 / ctx.maskHeight);
				gl.drawArrays(gl.TRIANGLES, 0, 6);
				gl.bindFramebuffer(gl.FRAMEBUFFER, null);
				return target.texture;
			},
			dispose() {
				if (built) {
					gl.deleteProgram(built.program);
				}
				target.dispose();
			},
		};
	},
};
