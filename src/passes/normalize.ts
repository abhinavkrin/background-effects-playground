import type { PassDefinition } from './types';
import { RenderTarget, bindTexture, createProgram, glsl, useQuad, vertexShaderSource } from './gl';

const fragment = glsl`#version 300 es
  precision mediump float;
  in vec2 texCoords;
  uniform sampler2D u_mask;
  uniform bool u_maskIsBackground;
  out vec4 fragColor;

  void main() {
    float raw = texture(u_mask, texCoords).r;
    fragColor = vec4(vec3(u_maskIsBackground ? raw : 1.0 - raw), 1.0);
  }
`;

/**
 * Turns the model's mask into the probability that each pixel is background, which is what the composite expects.
 */
export const normalizePass: PassDefinition = {
	id: 'normalize',
	label: 'To background probability',
	stage: 'mask',
	description: 'Person mask -> 1 - p; multiclass -> mask 0 (background). Leave it out to use the raw mask as the library does.',
	params: [],
	defaults: {},
	create(gl) {
		const program = createProgram(gl, vertexShaderSource(false), fragment);
		const target = new RenderTarget(gl);
		const mask = gl.getUniformLocation(program, 'u_mask');
		const isBackground = gl.getUniformLocation(program, 'u_maskIsBackground');
		return {
			run(ctx, input) {
				target.ensure(ctx.maskWidth, ctx.maskHeight);
				useQuad(gl, program, ctx.vertexBuffer);
				target.bind();
				bindTexture(gl, 0, input, mask);
				gl.uniform1i(isBackground, ctx.maskIsBackground ? 1 : 0);
				gl.drawArrays(gl.TRIANGLES, 0, 6);
				gl.bindFramebuffer(gl.FRAMEBUFFER, null);
				return target.texture;
			},
			dispose() {
				gl.deleteProgram(program);
				target.dispose();
			},
		};
	},
};
