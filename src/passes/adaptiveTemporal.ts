import { num } from '../lib/params';
import type { PassDefinition } from './types';
import { RenderTarget, bindTexture, createProgram, glsl, useQuad, vertexShaderSource } from './gl';

// The adaptive mask shader from https://github.com/livekit/track-processors-js/pull/135 (adaptiveMaskShader.ts), with its constants made
// uniforms so they can be tuned live.
const blendFragment = glsl`#version 300 es
  precision highp float;
  in vec2 texCoords;
  uniform sampler2D u_previousMask;
  uniform sampler2D u_currentMask;
  uniform sampler2D u_previousFrame;
  uniform sampler2D u_currentFrame;
  uniform float u_hasPrevious;
  uniform float u_stillWeight;
  uniform float u_movingWeight;
  uniform float u_motionLow;
  uniform float u_motionHigh;
  uniform float u_probeStep;
  out vec4 fragColor;

  float frameDifference(vec2 uv) {
    vec3 difference = abs(texture(u_currentFrame, uv).rgb - texture(u_previousFrame, uv).rgb);
    return max(difference.r, max(difference.g, difference.b));
  }

  void main() {
    float previous = texture(u_previousMask, texCoords).r;
    float current = texture(u_currentMask, texCoords).r;
    vec2 stepUV = u_probeStep / vec2(textureSize(u_currentFrame, 0));
    float movement = max(
      frameDifference(texCoords),
      max(
        frameDifference(clamp(texCoords + vec2(stepUV.x, 0.0), 0.0, 1.0)),
        frameDifference(clamp(texCoords + vec2(0.0, stepUV.y), 0.0, 1.0))
      )
    );
    float motionFactor = smoothstep(u_motionLow, u_motionHigh, movement);
    float weight = mix(u_stillWeight, u_movingWeight, motionFactor);
    // No history yet: take the new mask as is.
    weight = mix(1.0, weight, u_hasPrevious);
    fragColor = vec4(vec3(mix(previous, current, weight)), 1.0);
  }
`;

const copyFragment = glsl`#version 300 es
  precision mediump float;
  in vec2 texCoords;
  uniform sampler2D u_source;
  out vec4 fragColor;

  void main() {
    fragColor = texture(u_source, texCoords);
  }
`;

/**
 * Motion-adaptive temporal EMA (livekit/track-processors-js#135). Compares the camera frame at this segmentation
 * with the one at the previous segmentation (max channel difference at the pixel and two neighbours `probeStep`
 * frame pixels right and down). Still areas take only `stillWeight` of the new mask, so the edge holds steady;
 * moving areas take up to `movingWeight`, so the mask follows the person. Needs the frame in the mask stage.
 */
export const adaptiveTemporalPass: PassDefinition = {
	id: 'adaptiveTemporal',
	label: 'Motion-adaptive temporal EMA',
	stage: 'mask',
	description: 'mix(previous, current, w), w from 0.15 (still) to 0.90 (moving) by frame difference, smoothstep 0.035..0.14.',
	params: [
		{ key: 'stillWeight', label: 'New-mask weight when still', kind: 'number', min: 0.05, max: 1, step: 0.05 },
		{ key: 'movingWeight', label: 'New-mask weight when moving', kind: 'number', min: 0.05, max: 1, step: 0.05 },
		{ key: 'motionLow', label: 'Motion: start (frame diff)', kind: 'number', min: 0, max: 0.3, step: 0.005, help: 'Below this max-channel difference a pixel counts as still.' },
		{ key: 'motionHigh', label: 'Motion: full (frame diff)', kind: 'number', min: 0.01, max: 0.5, step: 0.005, help: 'Above this a pixel counts as fully moving.' },
		{ key: 'probeStep', label: 'Neighbour probe (frame px)', kind: 'number', min: 0, max: 8, step: 1 },
	],
	defaults: { stillWeight: 0.15, movingWeight: 0.9, motionLow: 0.035, motionHigh: 0.14, probeStep: 2 },
	create(gl) {
		const blend = createProgram(gl, vertexShaderSource(false), blendFragment);
		const copy = createProgram(gl, vertexShaderSource(false), copyFragment);
		const masks = [new RenderTarget(gl), new RenderTarget(gl)];
		// The frame at the previous segmentation, at full frame size as in the PR.
		const previousFrame = new RenderTarget(gl);
		const u = (name: string) => gl.getUniformLocation(blend, name);
		const uniforms = {
			previousMask: u('u_previousMask'),
			currentMask: u('u_currentMask'),
			previousFrame: u('u_previousFrame'),
			currentFrame: u('u_currentFrame'),
			hasPrevious: u('u_hasPrevious'),
			stillWeight: u('u_stillWeight'),
			movingWeight: u('u_movingWeight'),
			motionLow: u('u_motionLow'),
			motionHigh: u('u_motionHigh'),
			probeStep: u('u_probeStep'),
		};
		const copySource = gl.getUniformLocation(copy, 'u_source');
		let write = 1;
		let hasPrevious = false;
		return {
			run(ctx, input, params) {
				for (const target of masks) {
					if (target.ensure(ctx.maskWidth, ctx.maskHeight)) {
						hasPrevious = false;
					}
				}
				if (previousFrame.ensure(ctx.frameWidth, ctx.frameHeight)) {
					hasPrevious = false;
				}
				const read = 1 - write;
				useQuad(gl, blend, ctx.vertexBuffer);
				masks[write].bind();
				bindTexture(gl, 0, masks[read].texture, uniforms.previousMask);
				bindTexture(gl, 1, input, uniforms.currentMask);
				bindTexture(gl, 2, previousFrame.texture, uniforms.previousFrame);
				bindTexture(gl, 3, ctx.frameTexture, uniforms.currentFrame);
				gl.uniform1f(uniforms.hasPrevious, hasPrevious ? 1 : 0);
				gl.uniform1f(uniforms.stillWeight, num(params, 'stillWeight', 0.15));
				gl.uniform1f(uniforms.movingWeight, num(params, 'movingWeight', 0.9));
				gl.uniform1f(uniforms.motionLow, num(params, 'motionLow', 0.035));
				gl.uniform1f(uniforms.motionHigh, Math.max(num(params, 'motionHigh', 0.14), num(params, 'motionLow', 0.035) + 0.001));
				gl.uniform1f(uniforms.probeStep, num(params, 'probeStep', 2));
				gl.drawArrays(gl.TRIANGLES, 0, 6);

				// Keep this frame for the next segmentation.
				useQuad(gl, copy, ctx.vertexBuffer);
				previousFrame.bind();
				bindTexture(gl, 0, ctx.frameTexture, copySource);
				gl.drawArrays(gl.TRIANGLES, 0, 6);
				gl.bindFramebuffer(gl.FRAMEBUFFER, null);

				hasPrevious = true;
				const output = masks[write].texture;
				write = read;
				return output;
			},
			reset() {
				hasPrevious = false;
			},
			dispose() {
				gl.deleteProgram(blend);
				gl.deleteProgram(copy);
				masks.forEach((target) => target.dispose());
				previousFrame.dispose();
			},
		};
	},
};
