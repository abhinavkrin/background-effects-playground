// WebGL helpers ported from @livekit/track-processors (src/webgl/utils.ts), so the editable pipeline's passes draw the way the
// library does.

export const glsl = (strings: TemplateStringsArray, ...values: unknown[]): string =>
	strings.reduce((source, string, i) => source + string + (i < values.length ? String(values[i]) : ''), '');

/** The library's full-screen-quad vertex shader. Mask passes use `flipY = false`; see docs/pipeline.md. */
export const vertexShaderSource = (flipY = true): string => `#version 300 es
  in vec2 position;
  out vec2 texCoords;

  void main() {
    texCoords = (position + 1.0) / 2.0;
    texCoords.y = ${flipY ? '1.0 - texCoords.y' : 'texCoords.y'};
    gl_Position = vec4(position, 0, 1.0);
  }
`;

/** A GLSL float literal, which needs a decimal point. */
export const glslFloat = (value: number): string => (Number.isInteger(value) ? value.toFixed(1) : String(value));

export const createShader = (gl: WebGL2RenderingContext, type: number, source: string): WebGLShader => {
	const shader = gl.createShader(type);
	if (!shader) {
		throw new Error('createShader failed');
	}
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const info = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error(`Shader compile failed: ${info}`);
	}
	return shader;
};

export const createProgram = (gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram => {
	const program = gl.createProgram();
	if (!program) {
		throw new Error('createProgram failed');
	}
	const vs = createShader(gl, gl.VERTEX_SHADER, vertexSource);
	const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
	}
	gl.deleteShader(vs);
	gl.deleteShader(fs);
	return program;
};

export const initTexture = (gl: WebGL2RenderingContext): WebGLTexture => {
	const texture = gl.createTexture();
	if (!texture) {
		throw new Error('createTexture failed');
	}
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	return texture;
};

export const resizeTexture = (gl: WebGL2RenderingContext, texture: WebGLTexture, width: number, height: number): void => {
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
};

export const createVertexBuffer = (gl: WebGL2RenderingContext): WebGLBuffer => {
	const buffer = gl.createBuffer();
	if (!buffer) {
		throw new Error('createBuffer failed');
	}
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, -1, -1, 1, 1, 1, -1]), gl.STATIC_DRAW);
	return buffer;
};

/** An RGBA8 texture with a framebuffer, the unit every pass renders into. Resizes itself on demand. */
export class RenderTarget {
	readonly texture: WebGLTexture;

	readonly framebuffer: WebGLFramebuffer;

	width = 0;

	height = 0;

	constructor(private readonly gl: WebGL2RenderingContext) {
		this.texture = initTexture(gl);
		const framebuffer = gl.createFramebuffer();
		if (!framebuffer) {
			throw new Error('createFramebuffer failed');
		}
		this.framebuffer = framebuffer;
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	}

	/** Returns true when the size changed, so the owner can drop history kept at the old size. */
	ensure(width: number, height: number): boolean {
		if (width === this.width && height === this.height) {
			return false;
		}
		resizeTexture(this.gl, this.texture, width, height);
		this.width = width;
		this.height = height;
		return true;
	}

	bind(): void {
		this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
		this.gl.viewport(0, 0, this.width, this.height);
	}

	dispose(): void {
		this.gl.deleteTexture(this.texture);
		this.gl.deleteFramebuffer(this.framebuffer);
	}
}

/** Points the program's `position` attribute at the shared quad. */
export const useQuad = (gl: WebGL2RenderingContext, program: WebGLProgram, vertexBuffer: WebGLBuffer): void => {
	gl.useProgram(program);
	const position = gl.getAttribLocation(program, 'position');
	gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
	gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
	gl.enableVertexAttribArray(position);
};

export const bindTexture = (gl: WebGL2RenderingContext, unit: number, texture: WebGLTexture, location: WebGLUniformLocation | null): void => {
	gl.activeTexture(gl.TEXTURE0 + unit);
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.uniform1i(location, unit);
};

/** The GL defaults every lab pass assumes; MediaPipe renders into the same context and may leave others behind. */
export const resetSharedState = (gl: WebGL2RenderingContext): void => {
	gl.bindVertexArray(null);
	gl.disable(gl.SCISSOR_TEST);
	gl.disable(gl.DEPTH_TEST);
	gl.disable(gl.STENCIL_TEST);
	gl.disable(gl.CULL_FACE);
	gl.colorMask(true, true, true, true);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	gl.disable(gl.BLEND);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
	gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
};

/** Reads the WebGL renderer string, unmasked where the browser allows it. */
export const rendererOf = (gl: WebGL2RenderingContext | WebGLRenderingContext): string => {
	const info = gl.getExtension('WEBGL_debug_renderer_info');
	return String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
};
