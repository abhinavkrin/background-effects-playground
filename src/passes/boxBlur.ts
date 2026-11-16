import { num } from '../lib/params';
import type { PassDefinition } from './types';
import { RenderTarget, bindTexture, createProgram, glsl, useQuad, vertexShaderSource } from './gl';

// The library's box blur shader (src/webgl/shader-programs/boxBlurShader.ts), unchanged.
const fragment = glsl`#version 300 es
precision mediump float;

in vec2 texCoords;

uniform sampler2D u_texture;
uniform vec2 u_texelSize;
uniform vec2 u_direction;
uniform float u_radius;

out vec4 fragColor;

void main() {
    vec3 sum = vec3(0.0);
    float count = 0.0;

    const int MAX_RADIUS = 16;
    int radius = int(min(float(MAX_RADIUS), u_radius));

    for (int i = -MAX_RADIUS; i <= MAX_RADIUS; ++i) {
        if (abs(i) > radius) continue;

        vec2 offset = u_direction * u_texelSize * float(i);
        sum += texture(u_texture, texCoords + offset).rgb;
        count += 1.0;
  }

  fragColor = vec4(sum / count, 1.0);
}
`;

/** Softens the mask with a separable box blur, as the library does before compositing. */
export const boxBlurPass: PassDefinition = {
	id: 'boxBlur',
	label: 'Mask box blur',
	stage: 'mask',
	description: 'Separable box blur of the mask. The radius is in frame pixels and is scaled down with the mask buffer, as in the library (8).',
	params: [{ key: 'radius', label: 'Radius (frame px)', kind: 'number', min: 0, max: 64, step: 1 }],
	defaults: { radius: 8 },
	create(gl) {
		// The library draws both directions with the flipping vertex shader; two flips cancel out.
		const program = createProgram(gl, vertexShaderSource(true), fragment);
		const horizontal = new RenderTarget(gl);
		const vertical = new RenderTarget(gl);
		const uniforms = {
			texture: gl.getUniformLocation(program, 'u_texture'),
			texelSize: gl.getUniformLocation(program, 'u_texelSize'),
			direction: gl.getUniformLocation(program, 'u_direction'),
			radius: gl.getUniformLocation(program, 'u_radius'),
		};
		return {
			run(ctx, input, params) {
				horizontal.ensure(ctx.maskWidth, ctx.maskHeight);
				vertical.ensure(ctx.maskWidth, ctx.maskHeight);
				const radius = Math.max(1, Math.round((num(params, 'radius', 8) || 1) / ctx.maskDownsampleFactor));
				useQuad(gl, program, ctx.vertexBuffer);
				gl.uniform2f(uniforms.texelSize, 1 / ctx.maskWidth, 1 / ctx.maskHeight);
				gl.uniform1f(uniforms.radius, radius);
				horizontal.bind();
				bindTexture(gl, 0, input, uniforms.texture);
				gl.uniform2f(uniforms.direction, 1, 0);
				gl.drawArrays(gl.TRIANGLES, 0, 6);
				vertical.bind();
				bindTexture(gl, 0, horizontal.texture, uniforms.texture);
				gl.uniform2f(uniforms.direction, 0, 1);
				gl.drawArrays(gl.TRIANGLES, 0, 6);
				gl.bindFramebuffer(gl.FRAMEBUFFER, null);
				return vertical.texture;
			},
			dispose() {
				gl.deleteProgram(program);
				horizontal.dispose();
				vertical.dispose();
			},
		};
	},
};
