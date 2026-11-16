import { num } from '../lib/params';
import type { PassDefinition } from './types';
import { RenderTarget, bindTexture, createProgram, glsl, useQuad, vertexShaderSource } from './gl';

const fragment = glsl`#version 300 es
  precision mediump float;
  in vec2 texCoords;
  uniform sampler2D u_current;
  uniform sampler2D u_previous;
  uniform float u_weight;
  out vec4 fragColor;

  void main() {
    float current = texture(u_current, texCoords).r;
    float previous = texture(u_previous, texCoords).r;
    fragColor = vec4(vec3(mix(previous, current, u_weight)), 1.0);
  }
`;

/**
 * Blends each mask with the previous output (an exponential moving average), which holds a flickering edge still at
 * the cost of trailing fast movement. History is kept across model switches and dropped when the mask is resized.
 */
export const temporalPass: PassDefinition = {
	id: 'temporal',
	label: 'Temporal EMA',
	stage: 'mask',
	description: 'mix(previous, current, weight). Weight 1 disables smoothing.',
	params: [{ key: 'weight', label: 'Weight of the new mask', kind: 'number', min: 0.05, max: 1, step: 0.05 }],
	defaults: { weight: 0.4 },
	create(gl) {
		const program = createProgram(gl, vertexShaderSource(false), fragment);
		const targets = [new RenderTarget(gl), new RenderTarget(gl)];
		const uniforms = {
			current: gl.getUniformLocation(program, 'u_current'),
			previous: gl.getUniformLocation(program, 'u_previous'),
			weight: gl.getUniformLocation(program, 'u_weight'),
		};
		let write = 1;
		let hasPrevious = false;
		return {
			run(ctx, input, params) {
				for (const target of targets) {
					if (target.ensure(ctx.maskWidth, ctx.maskHeight)) {
						hasPrevious = false;
					}
				}
				const read = 1 - write;
				useQuad(gl, program, ctx.vertexBuffer);
				targets[write].bind();
				bindTexture(gl, 0, input, uniforms.current);
				bindTexture(gl, 1, targets[read].texture, uniforms.previous);
				gl.uniform1f(uniforms.weight, hasPrevious ? num(params, 'weight', 0.4) : 1);
				gl.drawArrays(gl.TRIANGLES, 0, 6);
				gl.bindFramebuffer(gl.FRAMEBUFFER, null);
				hasPrevious = true;
				const output = targets[write].texture;
				write = read;
				return output;
			},
			reset() {
				hasPrevious = false;
			},
			dispose() {
				gl.deleteProgram(program);
				targets.forEach((target) => target.dispose());
			},
		};
	},
};
