import { createProgram, glsl, useQuad, vertexShaderSource, RenderTarget } from '../passes/gl';

const fragment = glsl`#version 300 es
  precision highp float;
  in vec2 texCoords;
  uniform sampler2D u_previous;
  uniform int u_iterations;
  out vec4 fragColor;

  void main() {
    vec4 acc = texture(u_previous, texCoords);
    for (int i = 0; i < 4096; i++) {
      if (i >= u_iterations) break;
      acc = sin(acc * 1.7 + vec4(texCoords, float(i) * 0.01, 1.0));
    }
    fragColor = acc;
  }
`;

/** Extra full-screen passes whose output nobody reads, to make the GPU the bottleneck on a fast machine. */
export class GpuLoad {
	private readonly program: WebGLProgram;

	private readonly targets: [RenderTarget, RenderTarget];

	private readonly vertexBuffer: WebGLBuffer;

	private readonly uniforms;

	constructor(private readonly gl: WebGL2RenderingContext) {
		this.program = createProgram(gl, vertexShaderSource(false), fragment);
		this.targets = [new RenderTarget(gl), new RenderTarget(gl)];
		this.targets.forEach((target) => target.ensure(640, 360));
		const buffer = gl.createBuffer();
		if (!buffer) {
			throw new Error('createBuffer failed');
		}
		this.vertexBuffer = buffer;
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, -1, -1, 1, 1, 1, -1]), gl.STATIC_DRAW);
		this.uniforms = {
			previous: gl.getUniformLocation(this.program, 'u_previous'),
			iterations: gl.getUniformLocation(this.program, 'u_iterations'),
		};
	}

	run(passes: number, iterations: number): void {
		const gl = this.gl;
		const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
		gl.bindVertexArray(null);
		useQuad(gl, this.program, this.vertexBuffer);
		gl.uniform1i(this.uniforms.iterations, iterations);
		for (let i = 0; i < passes; i++) {
			const [read, write] = i % 2 === 0 ? this.targets : [this.targets[1], this.targets[0]];
			write.bind();
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, read.texture);
			gl.uniform1i(this.uniforms.previous, 0);
			gl.drawArrays(gl.TRIANGLES, 0, 6);
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
	}

	dispose(): void {
		this.gl.deleteProgram(this.program);
		this.targets.forEach((target) => target.dispose());
		this.gl.deleteBuffer(this.vertexBuffer);
	}
}

/** Waits for the GPU to finish everything queued so far, by reading one pixel back. Returns the wait in ms. */
export const forcedReadback = (gl: WebGL2RenderingContext): number => {
	const pixel = new Uint8Array(4);
	const start = performance.now();
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
	return performance.now() - start;
};
